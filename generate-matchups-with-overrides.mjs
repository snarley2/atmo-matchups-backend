import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SOURCE_TAB = process.env.GOOGLE_SHEET_TAB || "Last Worked";
const OUTPUT_TAB = process.env.TEAM_TRAINER_MATCHUPS_TAB || "Team Trainer Match Ups";
const CONTROLS_TAB = process.env.MATCHUP_OVERRIDES_TAB || "Matchup Overrides";
const AGENTS_FILE = process.env.AGENTS_FILE || path.join(process.cwd(), "atmomatchups", "outputs", "agents.json");
const GOOGLE_SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || path.join(process.cwd(), "google-service-account.json");

const CREDENTIALS_PATH = path.isAbsolute(GOOGLE_SERVICE_ACCOUNT_FILE)
  ? GOOGLE_SERVICE_ACCOUNT_FILE
  : path.join(process.cwd(), GOOGLE_SERVICE_ACCOUNT_FILE);
const AGENTS_PATH = path.isAbsolute(AGENTS_FILE)
  ? AGENTS_FILE
  : path.join(process.cwd(), AGENTS_FILE);

const GAP_CONFIG = [
  { key: "talkToStop", header: "Talk → Stop", standard: 0.5, yellowFloor: 0.425, label: "Talk → Stop" },
  { key: "stopToZip", header: "Stop → Zip", standard: 0.3, yellowFloor: 0.25, label: "Stop → Zip" },
  { key: "zipToPresentation", header: "Zip → Presentation", standard: 1, yellowFloor: 0.9, label: "Zip → Presentation" },
  { key: "presentationToInfo", header: "Presentation → Info", standard: 0.3, yellowFloor: 0.25, label: "Presentation → Info" },
  { key: "infoToClose", header: "Info → Close", standard: 1, yellowFloor: 0.9, label: "Info → Close" },
];

const VALID_FOCUS = new Map([
  ...GAP_CONFIG.map((gap) => [gap.label.toLowerCase(), gap.label]),
  ["on target", "On Target / Peer Leader"],
  ["on target / peer leader", "On Target / Peer Leader"],
  ["auto", ""],
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}
function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value).replace(/,/g, "");
  if (!text) return 0;
  if (text.endsWith("%")) {
    const number = Number(text.slice(0, -1));
    return Number.isFinite(number) ? number / 100 : 0;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}
function valueAt(row, index) {
  return index >= 0 ? row[index] : "";
}
function hexColor(hex) {
  const clean = hex.replace("#", "");
  return {
    red: parseInt(clean.slice(0, 2), 16) / 255,
    green: parseInt(clean.slice(2, 4), 16) / 255,
    blue: parseInt(clean.slice(4, 6), 16) / 255,
  };
}
function getHeaderIndex(headers, aliases, required = false) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(normalizeHeader(alias));
    if (index >= 0) return index;
  }
  if (required) throw new Error(`Missing required column: ${aliases.join(" / ")}`);
  return -1;
}

async function getSheetsClient() {
  if (!GOOGLE_SHEET_ID) throw new Error("GOOGLE_SHEET_ID is missing from .env");
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Google credentials file not found: ${CREDENTIALS_PATH}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getOrCreateSheet(sheets, title, headers = null) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    fields: "sheets.properties",
  });
  const existing = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === title);
  if (existing) return existing.properties.sheetId;

  const result = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const sheetId = result.data.replies?.[0]?.addSheet?.properties?.sheetId;

  if (headers?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${title}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
  return sheetId;
}

async function readTab(sheets, title) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${title}'!A:AZ`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = response.data.values || [];
    return { headers: values[0] || [], rows: values.slice(1) };
  } catch (error) {
    if (error?.code === 400) return { headers: [], rows: [] };
    throw error;
  }
}

function loadAgents() {
  if (!fs.existsSync(AGENTS_PATH)) throw new Error(`Agents file not found: ${AGENTS_PATH}`);
  const parsed = JSON.parse(fs.readFileSync(AGENTS_PATH, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("agents.json must contain an array");
  const excludedTypes = new Set(["absent", "trainer", "manager"]);
  const eligibleAgents = parsed.filter(
    (agent) => !excludedTypes.has(normalizeText(agent.repType).toLowerCase())
  );

  const countsByType = parsed.reduce((counts, agent) => {
    const type = normalizeText(agent.repType).toLowerCase();
    if (excludedTypes.has(type)) counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});

  console.log(
    `[team-trainer-matchups] removed absent=${countsByType.absent || 0}, ` +
    `trainers=${countsByType.trainer || 0}, managers=${countsByType.manager || 0}`
  );

  return eligibleAgents
    .map((agent) => ({
      repName: normalizeText(agent.repName),
      repType: normalizeText(agent.repType),
      team: normalizeText(agent.team) || normalizeText(agent.teamLead) || "Unassigned Team",
      trainer: normalizeText(agent.trainer) || normalizeText(agent.teamLead) || "Unassigned Trainer",
    }))
    .filter((agent) => agent.repName);
}

function getStatus(rate, gap) {
  if (rate >= gap.standard) return "green";
  if (rate >= gap.yellowFloor) return "yellow";
  return "orange";
}

function findPrimaryGap(rates) {
  const candidates = GAP_CONFIG.map((gap, order) => {
    const rate = toNumber(rates[gap.key]);
    const shortfallRatio = gap.standard > 0 ? Math.max(0, gap.standard - rate) / gap.standard : 0;
    return { ...gap, rate, status: getStatus(rate, gap), shortfallRatio, order };
  })
    .filter((gap) => gap.rate < gap.standard)
    .sort((a, b) => b.shortfallRatio - a.shortfallRatio || a.order - b.order);

  return candidates[0] || {
    key: "onTarget",
    label: "On Target / Peer Leader",
    rate: "",
    standard: "",
    status: "green",
    shortfallRatio: 0,
  };
}

function parseSource(tab) {
  const { headers, rows } = tab;
  const indexes = {
    repName: getHeaderIndex(headers, ["Rep Name"], true),
    lastWorked: getHeaderIndex(headers, ["Last Worked Date", "Last Worked"]),
    daysInactive: getHeaderIndex(headers, ["Days Since Last Worked", "Days Inactive"]),
    flag: getHeaderIndex(headers, ["Flag", "Activity Flag"]),
    ...Object.fromEntries(GAP_CONFIG.map((gap) => [gap.key, getHeaderIndex(headers, [gap.header, gap.header.replace("→", "->")])])),
  };

  return rows
    .map((row) => {
      const repName = normalizeText(valueAt(row, indexes.repName));
      if (!repName) return null;
      const rates = Object.fromEntries(
        GAP_CONFIG.map((gap) => [gap.key, toNumber(valueAt(row, indexes[gap.key]))])
      );
      return {
        repName,
        lastWorked: valueAt(row, indexes.lastWorked),
        daysInactive: toNumber(valueAt(row, indexes.daysInactive)),
        flag: normalizeText(valueAt(row, indexes.flag)) || "unknown",
        automaticGap: findPrimaryGap(rates),
      };
    })
    .filter(Boolean);
}

function parseControls(tab) {
  if (!tab.headers.length) return new Map();
  const indexes = {
    timestamp: getHeaderIndex(tab.headers, ["Timestamp"]),
    repName: getHeaderIndex(tab.headers, ["Rep Name", "Representative"], true),
    team: getHeaderIndex(tab.headers, ["Team"]),
    trainer: getHeaderIndex(tab.headers, ["Trainer", "Team Lead", "Coach"]),
    focus: getHeaderIndex(tab.headers, ["Focus", "Coaching Focus", "Gap"]),
    enabled: getHeaderIndex(tab.headers, ["Enabled", "Include", "Active"]),
    notes: getHeaderIndex(tab.headers, ["Notes", "Coach Notes"]),
  };

  const controls = new Map();
  for (const row of tab.rows) {
    const repName = normalizeText(valueAt(row, indexes.repName));
    if (!repName) continue;
    const rawFocus = normalizeText(valueAt(row, indexes.focus));
    const canonicalFocus = VALID_FOCUS.get(rawFocus.toLowerCase()) ?? rawFocus;
    const enabledText = normalizeText(valueAt(row, indexes.enabled)).toLowerCase();
    controls.set(normalizeName(repName), {
      timestamp: valueAt(row, indexes.timestamp),
      repName,
      team: normalizeText(valueAt(row, indexes.team)),
      trainer: normalizeText(valueAt(row, indexes.trainer)),
      focus: canonicalFocus,
      enabled: !["no", "false", "0", "exclude", "disabled"].includes(enabledText),
      notes: normalizeText(valueAt(row, indexes.notes)),
    });
  }
  return controls;
}

function buildReps(agents, sourceReps, controls) {
  // The agents map contains only eligible trainees because loadAgents() already
  // removed Absent, Trainer, and Manager records.
  const agentMap = new Map(agents.map((agent) => [normalizeName(agent.repName), agent]));
  const seenRepNames = new Set();
  const reps = [];

  for (const rep of sourceReps) {
    const key = normalizeName(rep.repName);

    // Do not allow source-sheet rows for trainers, managers, absent agents,
    // unknown agents, or duplicate copies of the same rep.
    const agent = agentMap.get(key);
    if (!agent || seenRepNames.has(key)) continue;

    const override = controls.get(key) || {};
    if (override.enabled === false) continue;

    seenRepNames.add(key);
    reps.push({
      ...rep,
      team: override.team || agent.team || "Unassigned Team",
      trainer: override.trainer || agent.trainer || "Unassigned Trainer",
      focus: override.focus || rep.automaticGap.label,
      focusSource: override.focus ? "Manual" : "Automatic",
      notes: override.notes || "",
    });
  }

  return reps.sort((a, b) =>
    a.team.localeCompare(b.team) ||
    a.trainer.localeCompare(b.trainer) ||
    getFocusOrder(a.focus) - getFocusOrder(b.focus) ||
    a.repName.localeCompare(b.repName)
  );
}

function getFocusOrder(focus) {
  const index = GAP_CONFIG.findIndex((gap) => gap.label === focus);
  if (index >= 0) return index;
  return focus === "On Target / Peer Leader" ? GAP_CONFIG.length : GAP_CONFIG.length + 1;
}

function chooseGroupSizes(count) {
  if (count <= 0) return [];
  if (count === 1) return [1];

  // Build only groups of 2 or 3 whenever mathematically possible.
  // Examples: 4 => 2+2, 5 => 3+2, 7 => 3+2+2, 8 => 3+3+2.
  const sizes = [];
  let remaining = count;

  while (remaining > 0) {
    if (remaining === 2 || remaining === 3) {
      sizes.push(remaining);
      break;
    }
    if (remaining === 4) {
      sizes.push(2, 2);
      break;
    }
    if (remaining === 5) {
      sizes.push(3, 2);
      break;
    }

    sizes.push(3);
    remaining -= 3;
  }

  return sizes;
}

function summarizeGroupFocus(members) {
  const focuses = [...new Set(members.map((member) => member.focus).filter(Boolean))];
  if (!focuses.length) return "No Focus";
  if (focuses.length === 1) return focuses[0];
  return "Mixed Focus";
}

function buildGroups(reps) {
  // Group first by team and trainer so small focus buckets do not create
  // unnecessary one-person matchups. Individual rep focus remains visible.
  const buckets = new Map();
  for (const rep of reps) {
    const key = `${rep.team}\u0000${rep.trainer}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        team: rep.team,
        trainer: rep.trainer,
        reps: [],
      });
    }
    buckets.get(key).reps.push(rep);
  }

  const groups = [];
  let groupNumber = 1;

  for (const bucket of buckets.values()) {
    bucket.reps.sort((a, b) =>
      getFocusOrder(a.focus) - getFocusOrder(b.focus) ||
      a.repName.localeCompare(b.repName)
    );

    const sizes = chooseGroupSizes(bucket.reps.length);
    let cursor = 0;

    for (const size of sizes) {
      const members = bucket.reps.slice(cursor, cursor + size);
      groups.push({
        groupNumber: groupNumber++,
        team: bucket.team,
        trainer: bucket.trainer,
        focus: summarizeGroupFocus(members),
        members,
      });
      cursor += size;
    }
  }

  return groups;
}

function buildRows(groups) {
  const rows = [[
    "Matchup", "Team", "Trainer", "Rep Name", "Coaching Focus",
    "Last Worked", "Days Inactive", "Activity Flag", "Coach Notes",
  ]];

  for (const group of groups) {
    group.members.forEach((member, memberIndex) => {
      rows.push([
        memberIndex === 0 ? `Matchup ${group.groupNumber}` : "",
        memberIndex === 0 ? group.team : "",
        memberIndex === 0 ? group.trainer : "",
        member.repName,
        member.focus,
        member.lastWorked,
        member.daysInactive,
        member.flag,
        member.notes,
      ]);
    });

    rows.push(new Array(9).fill(""));
  }

  return rows;
}

const TEAM_FORMATS = [
  ["#D9EAF7", "#1F4E78"], ["#E2F0D9", "#375623"], ["#FFF2CC", "#7F6000"],
  ["#FCE4D6", "#843C0C"], ["#E4DFEC", "#4C2F63"], ["#DDEFEF", "#205B5B"],
];
const FOCUS_FORMATS = {
  "Talk → Stop": ["#C6E0B4", "#274E13"],
  "Stop → Zip": ["#BDD7EE", "#1F4E78"],
  "Zip → Presentation": ["#FFE699", "#7F6000"],
  "Presentation → Info": ["#F8CBAD", "#843C0C"],
  "Info → Close": ["#D9E1F2", "#4C2F63"],
  "On Target / Peer Leader": ["#B6D7A8", "#274E13"],
};

function borderStyle(color = "#D9D9D9") {
  return { style: "SOLID", color: hexColor(color) };
}

async function formatOutput(sheets, sheetId, groups, rows) {
  const columnCount = 9;
  const teams = [...new Set(groups.map((group) => group.team))];
  const teamFormats = new Map(
    teams.map((team, index) => [team, TEAM_FORMATS[index % TEAM_FORMATS.length]])
  );

  const requests = [
    // Reset old formatting so previous layouts cannot leak into this one.
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: Math.max(rows.length, 1),
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexColor("#FFFFFF"),
            textFormat: { foregroundColor: hexColor("#000000"), bold: false },
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            numberFormat: { type: "TEXT" },
          },
        },
        fields: "userEnteredFormat",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexColor("#5B9BD5"),
            textFormat: { foregroundColor: hexColor("#FFFFFF"), bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rows.length,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "DATE", pattern: "M/d/yyyy" },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rows.length,
          startColumnIndex: 6,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "NUMBER", pattern: "0" },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1, frozenColumnCount: 4 },
        },
        fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: rows.length },
        properties: { pixelSize: 38 },
        fields: "pixelSize",
      },
    },
  ];

  // Matchup, Team, Trainer, Rep, Focus, Date, Days, Flag, Notes
  const widths = [115, 175, 175, 190, 205, 115, 105, 115, 280];
  widths.forEach((pixelSize, index) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: index,
          endIndex: index + 1,
        },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    });
  });

  let rowIndex = 1;

  for (const group of groups) {
    const groupStart = rowIndex;
    const groupEnd = rowIndex + group.members.length;
    const [teamBackground, teamText] =
      teamFormats.get(group.team) || TEAM_FORMATS[0];

    // Matchup / team / trainer block color for the complete group.
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: groupStart,
          endRowIndex: groupEnd,
          startColumnIndex: 0,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexColor(teamBackground),
            textFormat: { foregroundColor: hexColor(teamText), bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    });

    group.members.forEach((member, memberIndex) => {
      const memberRow = groupStart + memberIndex;
      const [focusBackground, focusText] =
        FOCUS_FORMATS[member.focus] || ["#D9D9D9", "#333333"];

      requests.push(
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: memberRow,
              endRowIndex: memberRow + 1,
              startColumnIndex: 4,
              endColumnIndex: 5,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor(focusBackground),
                textFormat: { foregroundColor: hexColor(focusText), bold: true },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: memberRow,
              endRowIndex: memberRow + 1,
              startColumnIndex: 7,
              endColumnIndex: 8,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,textFormat)",
          },
        }
      );
    });

    // Strong outside border and lighter interior row separators.
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: groupStart,
          endRowIndex: groupEnd,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        top: borderStyle("#7F7F7F"),
        bottom: borderStyle("#7F7F7F"),
        left: borderStyle("#7F7F7F"),
        right: borderStyle("#7F7F7F"),
        innerHorizontal: borderStyle("#D9D9D9"),
        innerVertical: borderStyle("#D9D9D9"),
      },
    });

    rowIndex = groupEnd;

    // Spacer row after the group.
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowIndex,
          endIndex: rowIndex + 1,
        },
        properties: { pixelSize: 16 },
        fields: "pixelSize",
      },
    });
    rowIndex += 1;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests },
  });
}

async function run() {
  const sheets = await getSheetsClient();
  await getOrCreateSheet(sheets, CONTROLS_TAB, [
    "Timestamp", "Rep Name", "Team", "Trainer", "Coaching Focus", "Enabled", "Coach Notes",
  ]);

  const [sourceTab, controlsTab] = await Promise.all([
    readTab(sheets, SOURCE_TAB),
    readTab(sheets, CONTROLS_TAB),
  ]);

  const reps = buildReps(loadAgents(), parseSource(sourceTab), parseControls(controlsTab));
  const groups = buildGroups(reps);
  const rows = buildRows(groups);
  const outputSheetId = await getOrCreateSheet(sheets, OUTPUT_TAB);

  await sheets.spreadsheets.values.clear({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${OUTPUT_TAB}'!A:AZ` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${OUTPUT_TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
  await formatOutput(sheets, outputSheetId, groups, rows);

  console.log(`[team-trainer-matchups] reps=${reps.length}`);
  console.log(`[team-trainer-matchups] groups=${groups.length}`);
  console.log(`[team-trainer-matchups] duplicate reps removed; trainers/managers/absent agents excluded from rep slots`);
  console.log(`[team-trainer-matchups] overrides="${CONTROLS_TAB}"`);
  console.log(`[team-trainer-matchups] output="${OUTPUT_TAB}"`);
  console.log(`[team-trainer-matchups] https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}`);
}

run().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
