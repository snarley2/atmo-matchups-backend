import process from "node:process";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1iV9tUK8fIVHPrkR7PlaOzIkBAdR6kOxWAatOQrzDWMw";
const SOURCE_SHEET_NAME = process.env.LAST_WORKED_SHEET_NAME || "Last Worked";
const AGENTS_SHEET_NAME = process.env.AGENTS_SHEET_NAME || "Agents";
const DEFAULT_OFFICE = process.env.DEFAULT_OFFICE || "MADHAV MEHTA";

const AGENT_HEADERS = [
  "repKey",
  "repName",
  "office",
  "repType",
  "team",
  "teamLead",
  "attendance",
  "experienceLevel",
];

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeHeader(value) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(headers, candidates) {
  const wanted = new Set(candidates.map(normalizeHeader));
  return headers.findIndex((header) => wanted.has(normalizeHeader(header)));
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

if (!SPREADSHEET_ID) {
  throw new Error("Missing GOOGLE_SHEET_ID in .env");
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_FILE in .env");
}

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const spreadsheet = await sheets.spreadsheets.get({
  spreadsheetId: SPREADSHEET_ID,
});

const sheetTitles = new Set(
  (spreadsheet.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean)
);

if (!sheetTitles.has(SOURCE_SHEET_NAME)) {
  throw new Error(
    `Source sheet "${SOURCE_SHEET_NAME}" was not found. ` +
      `Set LAST_WORKED_SHEET_NAME in .env if the tab uses a different name.`
  );
}

if (!sheetTitles.has(AGENTS_SHEET_NAME)) {
  console.log(`[agents] Creating missing sheet "${AGENTS_SHEET_NAME}"...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: AGENTS_SHEET_NAME },
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${AGENTS_SHEET_NAME}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [AGENT_HEADERS] },
  });
}

console.log(`[agents] Reading new reps directly from "${SOURCE_SHEET_NAME}"...`);

const sourceResponse = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${SOURCE_SHEET_NAME}'!A:Z`,
});

const sourceValues = sourceResponse.data.values ?? [];
if (sourceValues.length === 0) {
  console.log(`[agents] "${SOURCE_SHEET_NAME}" is empty. Nothing to add.`);
  process.exit(0);
}

const sourceHeaders = sourceValues[0] ?? [];
const sourceRows = sourceValues.slice(1);

const repNameIndex = findHeaderIndex(sourceHeaders, [
  "repName",
  "Rep Name",
  "Rep",
  "Agent",
  "Agent Name",
  "Name",
]);

if (repNameIndex < 0) {
  throw new Error(
    `Could not find the rep-name column in "${SOURCE_SHEET_NAME}". ` +
      `Headers found: ${sourceHeaders.join(", ")}`
  );
}

const officeIndex = findHeaderIndex(sourceHeaders, ["office", "campaign"]);
const repTypeIndex = findHeaderIndex(sourceHeaders, ["repType", "Rep Type", "type"]);
const teamIndex = findHeaderIndex(sourceHeaders, ["team"]);
const teamLeadIndex = findHeaderIndex(sourceHeaders, [
  "teamLead",
  "Team Lead",
  "trainer",
  "leader",
]);

const agentsResponse = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${AGENTS_SHEET_NAME}'!A:Z`,
});

const agentsValues = agentsResponse.data.values ?? [];
let agentsHeaders = agentsValues[0] ?? [];
let existingRows = agentsValues.slice(1);

if (agentsHeaders.length === 0) {
  agentsHeaders = [...AGENT_HEADERS];
  existingRows = [];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${AGENTS_SHEET_NAME}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [agentsHeaders] },
  });
}

const existingRepNameIndex = findHeaderIndex(agentsHeaders, [
  "repName",
  "Rep Name",
  "Rep",
  "Agent",
  "Agent Name",
  "Name",
]);

if (existingRepNameIndex < 0) {
  throw new Error(
    `Could not find repName in "${AGENTS_SHEET_NAME}". ` +
      `Headers found: ${agentsHeaders.join(", ")}`
  );
}

const existingNames = new Set(
  existingRows
    .map((row) => normalize(row[existingRepNameIndex]))
    .filter(Boolean)
);

const seenSourceNames = new Set();
const newAgents = [];

for (const row of sourceRows) {
  const repName = valueAt(row, repNameIndex);
  const key = normalize(repName);

  if (!key || existingNames.has(key) || seenSourceNames.has(key)) {
    continue;
  }

  seenSourceNames.add(key);

  newAgents.push({
    repKey: crypto.randomUUID(),
    repName,
    office: valueAt(row, officeIndex) || DEFAULT_OFFICE,
    repType: valueAt(row, repTypeIndex),
    team: valueAt(row, teamIndex),
    teamLead: valueAt(row, teamLeadIndex),
    attendance: "in",
    experienceLevel: "Newer",
  });
}

if (newAgents.length === 0) {
  console.log(
    `[agents] No new reps found. "${AGENTS_SHEET_NAME}" is already up to date.`
  );
  process.exit(0);
}

// Build rows in the Agents sheet's existing column order so manual/custom columns remain untouched.
const rowsToAppend = newAgents.map((agent) =>
  agentsHeaders.map((header) => {
    const normalized = normalizeHeader(header);
    if (normalized === "repkey") return agent.repKey;
    if (["repname", "rep", "agent", "agentname", "name"].includes(normalized)) {
      return agent.repName;
    }
    if (normalized === "office") return agent.office;
    if (normalized === "reptype") return agent.repType;
    if (normalized === "team") return agent.team;
    if (["teamlead", "trainer", "leader"].includes(normalized)) return agent.teamLead;
    if (normalized === "attendance") return agent.attendance;
    if (normalized === "experiencelevel" || normalized === "leadershipreadiness") {
      return agent.experienceLevel;
    }
    return "";
  })
);

await sheets.spreadsheets.values.append({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${AGENTS_SHEET_NAME}'!A:Z`,
  valueInputOption: "RAW",
  insertDataOption: "INSERT_ROWS",
  requestBody: { values: rowsToAppend },
});

console.log(
  `[agents] Added ${newAgents.length} new rep${newAgents.length === 1 ? "" : "s"} to "${AGENTS_SHEET_NAME}":`
);
for (const agent of newAgents) {
  console.log(`  + ${agent.repName}`);
}
