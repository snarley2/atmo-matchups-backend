import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import crypto from "node:crypto";
import cron from "node-cron";
import { getAgents, replaceAgents, getGaps, getPerformanceTabs, saveMatchups, getDraftMatchups, saveDraftMatchups, getFinalMatchups, getFieldNotes, addFieldNote, getManualNumbers, upsertManualNumbers, getSuggestions, addSuggestion, getNumbersTracking } from "./sheets.mjs";
import { combineAgentsAndGaps, generateGroups } from "./logic.mjs";
import { runDailyAutomation, isDailyAutomationRunning } from "../run.mjs";

const app = express();

// API responses are live application state. Never let Express/browser caches
// reuse an older bootstrap payload.
app.disable("etag");

const httpServer = createServer(app);
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  }),
);
app.use(express.json({ limit: "2mb" }));

// Every /api response is dynamic. This keeps normal users from ever needing
// to clear/disable their browser cache to see current data.
app.use("/api", (_req, res, next) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
});

// Real-time collaboration channel. Drag motion is kept in memory and relayed
// directly to browsers; it never writes high-frequency cursor data to Sheets.
const io = new SocketIOServer(httpServer, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST"],
  },
});

const sanitizeLiveName = (value) => {
  const name = String(value || "").trim().slice(0, 60);
  return name || `User${Math.floor(1000 + Math.random() * 9000)}`;
};

const ADMIN_SESSION_HOURS = 12;
const adminPassword = String(process.env.ADMIN_LOGIN_PASSWORD || "");
const adminSessionSecret = String(process.env.ADMIN_SESSION_SECRET || adminPassword);

function isAdminRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (!role) return false;
  return role === "trainer" || role === "manager" || role === "admin" || role === "owner" ||
    role.includes("trainer") || role.includes("manager") || role.includes("director");
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function issueAdminToken(agent) {
  if (!adminSessionSecret) throw new Error("ADMIN_SESSION_SECRET or ADMIN_LOGIN_PASSWORD is not configured");
  const payload = Buffer.from(JSON.stringify({
    repKey: agent.repKey,
    repName: agent.repName,
    role: agent.repType,
    exp: Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", adminSessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || !adminSessionSecret) return null;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", adminSessionSecret).update(payload).digest("base64url");
  if (!safeEqualText(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.repKey || !isAdminRole(data.role) || Number(data.exp) <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function bearerToken(req) {
  return String(req.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function requireAdmin(req, res, next) {
  const session = verifyAdminToken(bearerToken(req));
  if (!session) return res.status(401).json({ error: "Admin login required" });
  req.admin = session;
  next();
}

io.on("connection", (socket) => {
  socket.data.actor = sanitizeLiveName(socket.handshake.auth?.actor);
  socket.data.admin = verifyAdminToken(socket.handshake.auth?.token);
  console.log(`[live] connected ${socket.id} as ${socket.data.actor}${socket.data.admin ? " [admin]" : ""}`);

  socket.on("presence:join", ({ actor } = {}) => {
    socket.data.actor = sanitizeLiveName(actor);
    socket.broadcast.emit("presence:update", {
      type: "joined",
      socketId: socket.id,
      actor: socket.data.actor,
      at: new Date().toISOString(),
    });
  });

  socket.on("matchups:state", (payload = {}) => {
    if (!socket.data.admin) return;
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    socket.broadcast.emit("matchups:state", {
      groups,
      actor: sanitizeLiveName(payload.actor || socket.data.actor),
      action: String(payload.action || "updated the matchups").slice(0, 180),
      at: payload.at || new Date().toISOString(),
    });
  });

  socket.on("drag:start", (payload = {}) => {
    if (!socket.data.admin) return;
    socket.broadcast.emit("drag:start", {
      ...payload,
      socketId: socket.id,
      actor: sanitizeLiveName(payload.actor || socket.data.actor),
      at: new Date().toISOString(),
    });
  });

  socket.on("drag:move", (payload = {}) => {
    if (!socket.data.admin) return;
    // No DB/Sheets write here: this path is intentionally cheap enough for 60fps.
    socket.broadcast.volatile.emit("drag:move", {
      ...payload,
      socketId: socket.id,
      actor: sanitizeLiveName(payload.actor || socket.data.actor),
    });
  });

  socket.on("drag:end", () => {
    if (!socket.data.admin) return;
    socket.broadcast.emit("drag:end", { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    socket.broadcast.emit("drag:end", { socketId: socket.id });
    console.log(`[live] disconnected ${socket.id} (${socket.data.actor})`);
  });
});

// Log every incoming HTTP request and its completion.
// Example:
// [req] --> GET /api/bootstrap ip=127.0.0.1
// [req] <-- GET /api/bootstrap 200 143ms
app.use((req, res, next) => {
  const startedAt = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  console.log(`[req] --> ${method} ${url} ip=${ip}`);

  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[req] <-- ${method} ${url} ${res.statusCode} ${elapsedMs}ms`
    );
  });

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "online",
    automationRunning: isDailyAutomationRunning(),
    serverTime: new Date().toISOString(),
  });
});

let lastGoodBootstrap = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function buildBootstrap() {
  const [agents, gaps, performance, draft] = await Promise.all([
    getAgents(),
    getGaps(),
    getPerformanceTabs(),
    getDraftMatchups(),
  ]);

  // An empty Agents read is not a usable bootstrap for this app. Treat it as
  // a failed read so we retry instead of telling every browser to wipe itself.
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('Agents sheet returned 0 agents');
  }

  return {
    agents: combineAgentsAndGaps(agents, gaps, performance),
    draft,
  };
}

app.get("/api/bootstrap", async (_req, res, next) => {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const payload = await buildBootstrap();
      lastGoodBootstrap = payload;
      console.log(`[bootstrap] success attempt=${attempt} agents=${payload.agents.length} groups=${payload.draft?.groups?.length || 0}`);
      return res.json(payload);
    } catch (error) {
      lastError = error;
      console.error(`[bootstrap] attempt ${attempt}/3 failed:`, error?.message || error);
      if (attempt < 3) await sleep(attempt === 1 ? 250 : 750);
    }
  }

  // If Sheets has a short-lived failure after this Render instance already had
  // a successful read, keep serving the last known-good state rather than [].
  if (lastGoodBootstrap?.agents?.length) {
    console.warn(`[bootstrap] serving last-good snapshot agents=${lastGoodBootstrap.agents.length}`);
    return res.json({
      ...lastGoodBootstrap,
      meta: { degraded: true, reason: lastError?.message || "Temporary data read failure" },
    });
  }

  // On a fresh server with no safe snapshot, fail loudly. The frontend keeps
  // its current data and shows an error instead of replacing it with empties.
  const error = new Error(`Bootstrap unavailable: ${lastError?.message || "data read failed"}`);
  error.status = 503;
  next(error);
});

app.post("/api/auth/admin", async (req, res, next) => {
  try {
    if (!adminPassword) return res.status(503).json({ error: "ADMIN_LOGIN_PASSWORD is not configured on the server" });
    const password = String(req.body.password || "");
    if (!safeEqualText(password, adminPassword)) return res.status(403).json({ error: "Invalid admin password" });

    const agents = await getAgents();
    const requestedKey = String(req.body.repKey || "").trim();
    const requestedName = String(req.body.repName || "").trim().toLowerCase();
    const agent = agents.find((item) => requestedKey && item.repKey === requestedKey) ||
      agents.find((item) => requestedName && String(item.repName || "").trim().toLowerCase() === requestedName);

    if (!agent) return res.status(404).json({ error: "Admin user not found" });
    if (!isAdminRole(agent.repType)) return res.status(403).json({ error: "Admin access is limited to trainers and above" });

    const token = issueAdminToken(agent);
    res.json({ token, user: { repKey: agent.repKey, repName: agent.repName, repType: agent.repType } });
  } catch (error) { next(error); }
});

app.get("/api/auth/admin/me", requireAdmin, async (req, res) => {
  res.json({ user: { repKey: req.admin.repKey, repName: req.admin.repName, repType: req.admin.role } });
});

app.get("/api/agents", async (_req, res, next) => {
  try { res.json(await getAgents()); } catch (error) { next(error); }
});

app.post("/api/agents", requireAdmin, async (req, res, next) => {
  try {
    const agents = await getAgents();
    const agent = {
      repKey: crypto.randomUUID(),
      repName: String(req.body.repName || "").trim(),
      office: String(req.body.office || "MADHAV MEHTA").trim(),
      repType: String(req.body.repType || "New Rep").trim(),
      team: String(req.body.team || "").trim(),
      teamLead: String(req.body.teamLead || "").trim(),
      attendance: String(req.body.attendance || "in").trim().toLowerCase(),
      experienceLevel:
        String(req.body.repType || "New Rep").trim().toLowerCase() === "leader"
          ? String(req.body.experienceLevel || "Newer").trim()
          : "",
    };
    if (!agent.repName) return res.status(400).json({ error: "repName is required" });
    agents.push(agent);
    await replaceAgents(agents);
    res.status(201).json(agent);
  } catch (error) { next(error); }
});

app.put("/api/agents/:repKey", requireAdmin, async (req, res, next) => {
  try {
    const agents = await getAgents();
    const index = agents.findIndex((agent) => agent.repKey === req.params.repKey);
    if (index < 0) return res.status(404).json({ error: "Agent not found" });
    agents[index] = { ...agents[index], ...req.body, repKey: agents[index].repKey };
    await replaceAgents(agents);
    res.json(agents[index]);
  } catch (error) { next(error); }
});

app.delete("/api/agents/:repKey", requireAdmin, async (req, res, next) => {
  try {
    const agents = await getAgents();
    const nextAgents = agents.filter((agent) => agent.repKey !== req.params.repKey);
    if (nextAgents.length === agents.length) return res.status(404).json({ error: "Agent not found" });
    await replaceAgents(nextAgents);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/matchups/auto", requireAdmin, async (req, res, next) => {
  try {
    const [agents, gaps, performance] = await Promise.all([getAgents(), getGaps(), getPerformanceTabs()]);
    const combined = combineAgentsAndGaps(agents, gaps, performance);
    res.json({ groups: generateGroups(combined, {
      groupSize: Number(req.body.groupSize || 4),
      groupingMode: req.body.groupingMode === "team" ? "team" : "gaps",
      trainersOnly: Boolean(req.body.trainersOnly),
    }) });
  } catch (error) { next(error); }
});

app.get("/api/matchups/draft", async (_req, res, next) => {
  try { res.json(await getDraftMatchups()); } catch (error) { next(error); }
});

app.put("/api/matchups/draft", requireAdmin, async (req, res, next) => {
  try {
    const date = String(req.body.date || new Date().toISOString().slice(0, 10));
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    const saved = await saveDraftMatchups({ date, groups });
    io.emit("matchups:state", {
      groups,
      actor: sanitizeLiveName(req.body.actor || "Server"),
      action: String(req.body.action || "saved the shared draft"),
      at: new Date().toISOString(),
    });
    res.json(saved);
  } catch (error) { next(error); }
});

app.get("/api/matchups/final", requireAdmin, async (_req, res, next) => {
  try { res.json(await getFinalMatchups()); } catch (error) { next(error); }
});

app.post("/api/matchups", requireAdmin, async (req, res, next) => {
  try {
    const date = String(req.body.date || new Date().toISOString().slice(0, 10));
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    res.json(await saveMatchups({ date, groups }));
  } catch (error) { next(error); }
});


function easternDateParts(dateValue = "") {
  const parsed = dateValue ? new Date(`${dateValue}T12:00:00-04:00`) : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(parsed);
  return { date, day };
}

app.get("/api/suggestions", async (_req, res, next) => {
  try {
    res.json(await getSuggestions());
  } catch (error) {
    next(error);
  }
});

app.post("/api/suggestions", async (req, res, next) => {
  try {
    const suggestion = String(req.body.suggestion || "").trim().slice(0, 5000);
    if (!suggestion) return res.status(400).json({ error: "Suggestion is required" });
    const { date, day } = easternDateParts(String(req.body.date || "").trim());
    const saved = await addSuggestion({
      id: crypto.randomUUID(),
      date,
      day,
      author: sanitizeLiveName(req.body.author || "Unknown"),
      category: String(req.body.category || "General").trim().slice(0, 80) || "General",
      suggestion,
      status: "New",
      createdAt: new Date().toISOString(),
    });
    io.emit("suggestions:new", saved);
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});


app.get("/api/numbers-tracking", requireAdmin, async (_req, res, next) => {
  try { res.json(await getNumbersTracking()); } catch (error) { next(error); }
});
app.get("/api/manual-numbers", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getManualNumbers());
  } catch (error) {
    next(error);
  }
});

app.post("/api/manual-numbers", async (req, res, next) => {
  try {
    const repName = String(req.body.repName || "").trim().slice(0, 120);
    if (!repName) return res.status(400).json({ error: "Rep name is required" });
    const { date, day } = easternDateParts(String(req.body.date || "").trim());
    const agents = await getAgents();
    const requestedKey = String(req.body.repKey || "").trim();
    const matched =
      agents.find((agent) => requestedKey && agent.repKey === requestedKey) ||
      agents.find((agent) => String(agent.repName || "").trim().toLowerCase() === repName.toLowerCase());
    const number = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
    };
    const electric = number(req.body.electric);
    const electricPartial = number(req.body.electricPartial);
    const gas = number(req.body.gas);
    const now = new Date().toISOString();
    const saved = await upsertManualNumbers({
      id: crypto.randomUUID(),
      date,
      day,
      repKey: matched?.repKey || requestedKey,
      repName: matched?.repName || repName,
      team: matched?.team || String(req.body.team || "").trim(),
      talks: number(req.body.talks),
      stops: number(req.body.stops),
      zips: number(req.body.zips),
      presentations: number(req.body.presentations),
      info: number(req.body.info),
      electric,
      electricPartial,
      gas,
      totalSales: electric + electricPartial + gas,
      enteredBy: sanitizeLiveName(req.body.enteredBy || "Unknown"),
      createdAt: now,
      updatedAt: now,
    });
    io.emit("manual-numbers:saved", saved);
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

app.get("/api/field-notes", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getFieldNotes());
  } catch (error) {
    next(error);
  }
});

app.post("/api/field-notes", requireAdmin, async (req, res, next) => {
  try {
    const repName = String(req.body.repName || "").trim().slice(0, 120);
    const noteText = String(req.body.note || "").trim().slice(0, 5000);
    const author = sanitizeLiveName(req.body.author || "Unknown");
    if (!repName) return res.status(400).json({ error: "Rep name is required" });
    if (!noteText) return res.status(400).json({ error: "Note is required" });

    const { date, day } = easternDateParts(String(req.body.date || "").trim());
    const agents = await getAgents();
    const requestedKey = String(req.body.repKey || "").trim();
    const matched =
      agents.find((agent) => requestedKey && agent.repKey === requestedKey) ||
      agents.find((agent) => String(agent.repName || "").trim().toLowerCase() === repName.toLowerCase());

    const saved = await addFieldNote({
      id: crypto.randomUUID(),
      date,
      day,
      repKey: matched?.repKey || requestedKey,
      repName: matched?.repName || repName,
      team: matched?.team || String(req.body.team || "").trim(),
      author,
      note: noteText,
      createdAt: new Date().toISOString(),
    });

    io.emit("field-notes:new", saved);
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

function requireApiKey(req, res, next) {
  const expected = process.env.API_SECRET_KEY;
  if (!expected) return res.status(503).json({ error: "API_SECRET_KEY is not configured" });

  const received = req.get("X-API-Key") || req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!received) return res.status(401).json({ error: "Missing API key" });

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  const valid =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

  if (!valid) return res.status(403).json({ error: "Invalid API key" });
  next();
}

app.post("/api/automation/run", requireApiKey, async (_req, res, next) => {
  if (isDailyAutomationRunning()) {
    return res.status(409).json({ error: "Automation is already running" });
  }

  try {
    res.json(await runDailyAutomation());
  } catch (error) { next(error); }
});

const dailyRunCron = process.env.DAILY_RUN_CRON || "* * * * *";
const dailyRunTimezone = process.env.DAILY_RUN_TIMEZONE || "America/New_York";

cron.schedule(
  dailyRunCron,
  async () => {
    console.log(`[scheduler] Triggered at ${new Date().toISOString()}`);
    try {
      await runDailyAutomation();
    } catch (error) {
      console.error("[scheduler] Scheduled automation failed:", error);
    }
  },
  {
    timezone: dailyRunTimezone,
    noOverlap: true,
  },
);

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error.status) || (String(error.message || "").startsWith("CORS blocked") ? 403 : 500);
  res.status(status).json({ error: error.message || "Server error" });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[server] ATMO API running at http://localhost:${port}`);
  console.log(`[server] Allowed origins: ${allowedOrigins.join(", ")}`);
  console.log(`[scheduler] Daily run: ${dailyRunCron} (${dailyRunTimezone})`);
});
