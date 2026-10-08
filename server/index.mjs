import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import crypto from "node:crypto";
import cron from "node-cron";
import { getAgents, replaceAgents, getGaps, getPerformanceTabs, saveMatchups, getDraftMatchups, saveDraftMatchups, getFinalMatchups, saveStoreMatchups, getStoreMatchups, saveWorkMatchups, getWorkMatchups, getFieldNotes, addFieldNote, getManualNumbers, upsertManualNumbers, getSuggestions, addSuggestion, getNumbersTracking } from "./sheets.mjs";
import { combineAgentsAndGaps, generateGroups, generateStoreGroups, generateWorkGroups, STORE_CATALOG } from "./logic.mjs";
import { attachProductionLogs, expandAgentsFromProduction, productionRepDirectory } from "./production-csv.mjs";
import { runDailyAutomation, isDailyAutomationRunning } from "../run.mjs";
import { DEFAULT_OFFICE, OFFICES, canonicalOffice } from "../offices.mjs";

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

function getAgentRole(agent) {
  // Accept legacy/variant Agents sheet headers without granting access from
  // production-log guesses. Eligibility still comes from the Agents sheet.
  const normalized = Object.fromEntries(Object.entries(agent || {}).map(([key,value]) =>
    [String(key).replace(/[^a-z0-9]/gi, "").toLowerCase(), value]));
  return String(normalized.reptype || normalized.role || normalized.rank ||
    normalized.position || normalized.title || "").trim();
}

function isAdminRole(value) {
  const role = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!role) return false;
  return /(?:^|\b)(trainer|assistant manager|manager|director|owner|administrator|admin|executive)(?:\b|$)/.test(role);
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
    role: getAgentRole(agent),
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
      office: canonicalOffice(payload.office || DEFAULT_OFFICE),
      actor: sanitizeLiveName(payload.actor || socket.data.actor),
      action: String(payload.action || "updated the matchups").slice(0, 180),
      at: payload.at || new Date().toISOString(),
    });
  });

  socket.on("stores:state", (payload = {}) => {
    if (!socket.data.admin) return;
    const stores = Array.isArray(payload.stores) ? payload.stores : [];
    socket.broadcast.emit("stores:state", {
      stores,
      actor: sanitizeLiveName(payload.actor || socket.data.actor),
      action: String(payload.action || "updated the store board").slice(0, 180),
      at: payload.at || new Date().toISOString(),
    });
  });

  socket.on("work:state", (payload = {}) => {
    if (!socket.data.admin) return;
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    socket.broadcast.emit("work:state", {
      groups,
      actor: sanitizeLiveName(payload.actor || socket.data.actor),
      action: String(payload.action || "updated the work matchup board").slice(0, 180),
      at: payload.at || new Date().toISOString(),
    });
  });

  for (const eventName of ["store-drag:start", "store-drag:move", "store-drag:end"]) {
    socket.on(eventName, (payload = {}) => {
      if (!socket.data.admin) return;
      const message = {
        ...payload,
        socketId: socket.id,
        actor: sanitizeLiveName(payload.actor || socket.data.actor),
        at: new Date().toISOString(),
      };
      if (eventName === "store-drag:move") socket.broadcast.volatile.emit(eventName, message);
      else socket.broadcast.emit(eventName, message);
    });
  }

  for (const eventName of ["work-drag:start", "work-drag:move", "work-drag:end"]) {
    socket.on(eventName, (payload = {}) => {
      if (!socket.data.admin) return;
      const message = { ...payload, socketId: socket.id, actor: sanitizeLiveName(payload.actor || socket.data.actor), at: new Date().toISOString() };
      if (eventName === "work-drag:move") socket.broadcast.volatile.emit(eventName, message);
      else socket.broadcast.emit(eventName, message);
    });
  }

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
    socket.broadcast.emit("store-drag:end", { socketId: socket.id });
    socket.broadcast.emit("work-drag:end", { socketId: socket.id });
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

app.get("/api/offices", (_req, res) => {
  res.json({ defaultOffice: DEFAULT_OFFICE, offices: OFFICES });
});

const lastGoodBootstrap = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function agentsForOffice(agents, office) {
  const selected = canonicalOffice(office);
  return (agents || []).filter((agent) => canonicalOffice(agent.office) === selected);
}

function requestedOffice(req) {
  return canonicalOffice(req.query?.office || req.body?.office || DEFAULT_OFFICE);
}

async function buildBootstrap(office = DEFAULT_OFFICE) {
  const selectedOffice = canonicalOffice(office);
  const [allAgents, gaps, performance, draft] = await Promise.all([
    getAgents(),
    getGaps(),
    getPerformanceTabs(),
    getDraftMatchups(selectedOffice),
  ]);

  // An empty Agents read is not a usable bootstrap for this app. Treat it as
  // a failed read so we retry instead of telling every browser to wipe itself.
  if (!Array.isArray(allAgents) || allAgents.length === 0) {
    throw new Error('Agents sheet returned 0 agents');
  }

  const agents = agentsForOffice(expandAgentsFromProduction(allAgents), selectedOffice);

  return {
    agents: combineAgentsAndGaps(attachProductionLogs(agents), gaps, performance),
    draft,
    selectedOffice,
    offices: OFFICES,
  };
}

app.get("/api/bootstrap", async (req, res, next) => {
  const office = requestedOffice(req);
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const payload = await buildBootstrap(office);
      lastGoodBootstrap.set(office, payload);
      console.log(`[bootstrap] success office="${office}" attempt=${attempt} agents=${payload.agents.length} groups=${payload.draft?.groups?.length || 0}`);
      return res.json(payload);
    } catch (error) {
      lastError = error;
      console.error(`[bootstrap] attempt ${attempt}/3 failed:`, error?.message || error);
      if (attempt < 3) await sleep(attempt === 1 ? 250 : 750);
    }
  }

  // If Sheets has a short-lived failure after this Render instance already had
  // a successful read, keep serving the last known-good state rather than [].
  const fallback = lastGoodBootstrap.get(office);
  if (fallback) {
    console.warn(`[bootstrap] serving last-good snapshot office="${office}" agents=${fallback.agents.length}`);
    return res.json({
      ...fallback,
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
    if (!isAdminRole(getAgentRole(agent))) return res.status(403).json({ error: "Admin access is limited to trainers and above" });

    const token = issueAdminToken(agent);
    res.json({ token, user: { repKey: agent.repKey, repName: agent.repName, repType: getAgentRole(agent) } });
  } catch (error) { next(error); }
});

// Login choices are independent of the currently selected office.
// Only persistent Agents sheet roles can grant admin access.
app.get("/api/auth/admin/candidates", async (_req, res, next) => {
  try {
    const agents = await getAgents();
    res.json({ agents: agents.filter(agent => isAdminRole(getAgentRole(agent)))
      .map(agent => ({ repKey: agent.repKey, repName: agent.repName,
        repType: getAgentRole(agent), office: agent.office }))
      .sort((a, b) => a.repName.localeCompare(b.repName)) });
  } catch (error) { next(error); }
});

app.get("/api/auth/admin/me", requireAdmin, async (req, res) => {
  res.json({ user: { repKey: req.admin.repKey, repName: req.admin.repName, repType: req.admin.role } });
});

app.get("/api/production-reps", async (_req, res) => {
  res.json({ reps: productionRepDirectory() });
});
app.post("/api/production-reps/import", requireAdmin, async (_req,res,next)=>{
  try {
    const current=await getAgents();
    const combined=expandAgentsFromProduction(current);
    const added=combined.length-current.length;
    if(added) await replaceAgents(combined);
    res.json({added,total:combined.length});
  } catch(error){next(error)}
});
// Coaching's weekly training list: previous-week electric, not WorkMyT
// last-day activity. Keep missing previous-week totals distinct from zero.
app.get("/api/training-watch", requireAdmin, async (req, res, next) => {
  try {
    const threshold = Math.max(0, Number(req.query.threshold ?? 20) || 0);
    const mode = String(req.query.mode || "both").toLowerCase();
    const [agents, gaps, performance] = await Promise.all([
      getAgents(), getGaps(), getPerformanceTabs()
    ]);
    const merged = combineAgentsAndGaps(
      attachProductionLogs(expandAgentsFromProduction(agents)), gaps, performance
    );
    const reps = merged.filter(agent => {
      const role = String(agent.repType || "").trim().toLowerCase();
      const newRep = role === "new rep" || role === "new" || role === "trainee";
      const leader = role === "leader" || role === "team leader";
      return mode === "new" ? newRep : mode === "leaders" ? leader : (newRep || leader);
    }).map(agent => ({
      repKey: agent.repKey, repName: agent.repName, office: agent.office,
      role: getAgentRole(agent), previousWeek: agent.productionLog?.lastWeek ?? null,
      focus: agent.stats?.["Biggest Gap Stage"] || agent.stats?.["Biggest Gap"] ||
        agent.stats?.biggestGap || agent.stats?.Gap || "Review funnel gaps",
    })).filter(rep => rep.previousWeek !== null &&
      Number.isFinite(Number(rep.previousWeek)) && Number(rep.previousWeek) < threshold);
    res.json({ threshold, mode, reps });
  } catch (error) { next(error); }
});

app.get("/api/work-reps", async (_req, res, next) => {
  try { res.json({reps: attachProductionLogs(expandAgentsFromProduction(await getAgents()))}); }
  catch (error) { next(error); }
});

app.get("/api/agents", async (req, res, next) => {
  try { res.json(agentsForOffice(await getAgents(), requestedOffice(req))); } catch (error) { next(error); }
});

app.post("/api/agents", requireAdmin, async (req, res, next) => {
  try {
    const agents = await getAgents();
    const agent = {
      repKey: crypto.randomUUID(),
      repName: String(req.body.repName || "").trim(),
      office: requestedOffice(req),
      repType: String(req.body.repType || "New Rep").trim(),
      team: String(req.body.team || "").trim(),
      teamLead: String(req.body.teamLead || "").trim(),
      trainer: String(req.body.trainer || "").trim(),
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
    let index = agents.findIndex((agent) => String(agent.repKey) === String(req.params.repKey));

    // Production-log reps can appear in Attendance before being imported into
    // the persistent Agents sheet. Materialize that rep on the first edit.
    // Only accept IDs actually discovered in the production logs; never create
    // arbitrary Agents from an unknown identifier.
    if (index < 0) {
      const discovered = productionRepDirectory().find(
        (rep) => String(rep.repKey) === String(req.params.repKey)
      );
      if (!discovered) return res.status(404).json({ error: "Agent not found" });

      const normalize = (name) => String(name || "")
        .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s*\((?:PL|L|OWNER|TRAINER)\)\s*$/i, "")
        .toLowerCase().replace(/[^a-z0-9]/g, "");
      const office = canonicalOffice(discovered.office);
      index = agents.findIndex((agent) =>
        canonicalOffice(agent.office) === office &&
        normalize(agent.repName) === normalize(discovered.repName)
      );
      if (index < 0) {
        agents.push({
          repKey: discovered.repKey,
          repName: discovered.repName,
          office,
          repType: discovered.repType || "New Rep",
          team: "", teamLead: "", trainer: "",
          attendance: "in", experienceLevel: "",
        });
        index = agents.length - 1;
      }
    }

    // Identity fields cannot be changed via a routine Attendance edit.
    const { repKey: _ignoredKey, office: _ignoredOffice, ...changes } = req.body || {};
    agents[index] = { ...agents[index], ...changes, repKey: agents[index].repKey };
    await replaceAgents(agents);
    io.emit("agents:update", agents[index]);
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
    const office = requestedOffice(req);
    const combined = combineAgentsAndGaps(agentsForOffice(agents, office), gaps, performance);
    res.json({ groups: generateGroups(combined, {
      groupSize: Number(req.body.groupSize || 4),
      groupingMode: req.body.groupingMode === "team" ? "team" : "gaps",
      trainersOnly: Boolean(req.body.trainersOnly),
    }) });
  } catch (error) { next(error); }
});

app.get("/api/matchups/draft", async (req, res, next) => {
  try { res.json(await getDraftMatchups(requestedOffice(req))); } catch (error) { next(error); }
});

app.put("/api/matchups/draft", requireAdmin, async (req, res, next) => {
  try {
    const date = String(req.body.date || new Date().toISOString().slice(0, 10));
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    const office = requestedOffice(req);
    const saved = await saveDraftMatchups({ date, groups, office });
    io.emit("matchups:state", {
      groups,
      office,
      actor: sanitizeLiveName(req.body.actor || "Server"),
      action: String(req.body.action || "saved the shared draft"),
      at: new Date().toISOString(),
    });
    res.json(saved);
  } catch (error) { next(error); }
});

app.get("/api/matchups/final", requireAdmin, async (req, res, next) => {
  try { res.json(await getFinalMatchups(requestedOffice(req))); } catch (error) { next(error); }
});

app.post("/api/matchups", requireAdmin, async (req, res, next) => {
  try {
    const date = String(req.body.date || new Date().toISOString().slice(0, 10));
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    res.json(await saveMatchups({ date, groups, office: requestedOffice(req) }));
  } catch (error) { next(error); }
});

app.post("/api/store-matchups/generate", requireAdmin, async (_req, res, next) => {
  try {
    const [agents, gaps, performance] = await Promise.all([getAgents(), getGaps(), getPerformanceTabs()]);
    const combined = combineAgentsAndGaps(attachProductionLogs(expandAgentsFromProduction(agents)), gaps, performance);
    res.json({ groups: generateStoreGroups(combined) });
  } catch (error) { next(error); }
});

app.post("/api/work-matchups/generate", requireAdmin, async (_req, res, next) => {
  try {
    const [agents, gaps, performance] = await Promise.all([getAgents(), getGaps(), getPerformanceTabs()]);
    const combined = combineAgentsAndGaps(attachProductionLogs(expandAgentsFromProduction(agents)), gaps, performance);
    res.json({ groups: generateWorkGroups(combined) });
  } catch (error) { next(error); }
});

app.get("/api/work-matchups", async (_req, res, next) => {
  try { res.json(await getWorkMatchups()); } catch (error) { next(error); }
});

app.post("/api/work-matchups", requireAdmin, async (req, res, next) => {
  try {
    const date = String(req.body.date || easternDateParts().date);
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    const saved = await saveWorkMatchups({ date, groups });
    io.emit("work:state", { groups, actor: sanitizeLiveName(req.body.actor || req.admin?.repName || "Server"), action: String(req.body.action || "saved the work matchup board").slice(0, 180), at: new Date().toISOString() });
    res.json(saved);
  } catch (error) { next(error); }
});

app.get("/api/store-matchups/catalog", (_req, res) => {
  res.json({ stores: STORE_CATALOG });
});

app.get("/api/store-matchups", async (_req, res, next) => {
  try { res.json(await getStoreMatchups()); } catch (error) { next(error); }
});

app.post("/api/store-matchups", requireAdmin, async (req, res, next) => {
  try {
    const date = String(req.body.date || easternDateParts().date);
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    const saved = await saveStoreMatchups({ date, groups });
    io.emit("stores:state", {
      stores: groups,
      actor: sanitizeLiveName(req.body.actor || req.admin?.repName || "Server"),
      action: String(req.body.action || "saved the live store board").slice(0, 180),
      at: new Date().toISOString(),
    });
    res.json(saved);
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

app.get("/api/numbers-tracking", requireAdmin, async (req, res, next) => {
  try {
    const office = requestedOffice(req);
    const [tracking, agents] = await Promise.all([getNumbersTracking(), getAgents()]);
    const keys = new Set(agentsForOffice(agents, office).map((agent) => agent.repKey));
    res.json({ ...tracking, office, reps: (tracking.reps || []).filter((rep) => keys.has(rep.repKey)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/manual-numbers", requireAdmin, async (req, res, next) => {
  try {
    const office = requestedOffice(req);
    const [entries, agents] = await Promise.all([getManualNumbers(), getAgents()]);
    const keys = new Set(agentsForOffice(agents, office).map((agent) => agent.repKey));
    res.json(entries.filter((entry) => keys.has(entry.repKey)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/manual-numbers", async (req, res, next) => {
  try {
    const repName = String(req.body.repName || "").trim().slice(0, 120);
    if (!repName) return res.status(400).json({ error: "Rep name is required" });
    const { date, day } = easternDateParts(String(req.body.date || "").trim());
    const office = requestedOffice(req);
    const agents = agentsForOffice(await getAgents(), office);
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
    io.emit("manual-numbers:saved", { ...saved, office });
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

app.get("/api/field-notes", requireAdmin, async (req, res, next) => {
  try {
    const office = requestedOffice(req);
    const [notes, agents] = await Promise.all([getFieldNotes(), getAgents()]);
    const keys = new Set(agentsForOffice(agents, office).map((agent) => agent.repKey));
    res.json(notes.filter((note) => keys.has(note.repKey)));
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
    const office = requestedOffice(req);
    const agents = agentsForOffice(await getAgents(), office);
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

    io.emit("field-notes:new", { ...saved, office });
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

const dailyRunCron = process.env.DAILY_RUN_CRON || "30 11 * * *";
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
