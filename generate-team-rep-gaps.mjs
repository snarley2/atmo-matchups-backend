import fs from "fs";
import path from "path";
import process from "process";
import dotenv from "dotenv";
import { google } from "googleapis";

 dotenv.config();

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const LAST_WORKED_TAB = process.env.GOOGLE_SHEET_TAB || "Last Worked";
const CURRENT_WEEK_TAB = process.env.CURRENT_WEEK_SHEET_TAB || "Current Week Avg";
const LAST_WEEK_TAB = process.env.LAST_WEEK_SHEET_TAB || "Last Week Avg";
const OUTPUT_TAB = process.env.TEAM_REP_GAPS_TAB || "Team/Rep Gaps";
const GAP_SETTINGS_TAB = process.env.GAP_FOCUS_SETTINGS_TAB || "Gap Focus Settings";
const GOOGLE_SERVICE_ACCOUNT_FILE =
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE ||
  path.join(process.cwd(), "google-service-account.json");

const CREDENTIALS_PATH = path.isAbsolute(GOOGLE_SERVICE_ACCOUNT_FILE)
  ? GOOGLE_SERVICE_ACCOUNT_FILE
  : path.join(process.cwd(), GOOGLE_SERVICE_ACCOUNT_FILE);


const DEFAULT_GAP_CONFIG = [
  // Earlier funnel stages intentionally carry more weight.
  // focusScore = relative shortfall × priorityWeight
  { key: "talkToStop", label: "Talk → Stop", standard: 0.5, yellowFloor: 0.425, priorityWeight: 1.50 },
  { key: "stopToZip", label: "Stop → Zip", standard: 0.3, yellowFloor: 0.25, priorityWeight: 1.40 },
  { key: "zipToPresentation", label: "Zip → Presentation", standard: 1, yellowFloor: 0.9, priorityWeight: 1.30 },
  { key: "presentationToInfo", label: "Presentation → Info", standard: 0.3, yellowFloor: 0.25, priorityWeight: 1.15 },
  { key: "infoToClose", label: "Info → Close", standard: 1, yellowFloor: 0.9, priorityWeight: 1.00 },
];

let GAP_CONFIG = DEFAULT_GAP_CONFIG.map((item) => ({ ...item }));

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
    const parsed = Number(text.slice(0, -1));
    return Number.isFinite(parsed) ? parsed / 100 : 0;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePercentSetting(value, fallback) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
}

function normalizeWeightSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
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

function valueAt(row, index) {
  return index >= 0 ? row[index] : "";
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

const AGENTS_TAB = process.env.AGENTS_SHEET_TAB || "Agents";

async function loadAgents(sheets) {
  const { headers, rows } = await readTab(sheets, AGENTS_TAB);

  const nameIndex = getHeaderIndex(headers, ["repName"], true);
  const teamIndex = getHeaderIndex(headers, ["team"], true);
  const leadIndex = getHeaderIndex(headers, [
    "teamLead",
    "trainer",
    "manager",
  ]);

  return rows
    .map((row) => ({
      repName: normalizeText(row[nameIndex]),
      team: normalizeText(row[teamIndex]),
      teamLead: normalizeText(row[leadIndex]),
    }))
    .filter((r) => r.repName);
}

async function readTab(sheets, tab) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${tab}'!A:AZ`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values = response.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  return { headers: values[0], rows: values.slice(1) };
}

function statusFor(rate, config) {
  if (rate >= config.standard) return "green";
  if (rate >= config.yellowFloor) return "yellow";
  return "orange";
}

function primaryGapFromRates(rates, repName = "") {
  const candidates = GAP_CONFIG.map((config, order) => {
    const rate = toNumber(rates[config.key]);
    const gap = Math.max(0, config.standard - rate);

    // MAIN FOCUS RULE:
    // 1) Measure how far the rep is below success RELATIVE to that stage's target.
    // 2) Apply the editable funnel-priority weight.
    // This prevents a 100% target late in the funnel from automatically looking worse
    // than a much weaker early-funnel conversion.
    const relativeGap = config.standard > 0 ? gap / config.standard : 0;
    const focusScore = relativeGap * (config.priorityWeight || 1);

    return {
      ...config,
      rate,
      gap,
      relativeGap,
      focusScore,
      status: statusFor(rate, config),
      order,
    };
  }).filter((item) => item.rate < item.standard);

  candidates.sort(
    (a, b) =>
      b.focusScore - a.focusScore ||
      b.relativeGap - a.relativeGap ||
      a.order - b.order ||
      b.gap - a.gap
  );

  if (process.env.GAP_FOCUS_DEBUG === "1" && repName) {
    const details = candidates
      .map((item) =>
        `${item.label}: rate=${(item.rate * 100).toFixed(1)}% ` +
        `target=${(item.standard * 100).toFixed(1)}% ` +
        `relativeMiss=${(item.relativeGap * 100).toFixed(1)}% ` +
        `weight=${item.priorityWeight} score=${item.focusScore.toFixed(3)}`
      )
      .join(" | ");
    console.log(`[gap-focus-choice] ${repName}: ${details}`);
    if (candidates[0]) {
      console.log(
        `[gap-focus-choice] ${repName}: MAIN FOCUS = ${candidates[0].label} ` +
        `(score=${candidates[0].focusScore.toFixed(3)})`
      );
    }
  }

  return candidates[0] || {
    key: "onTarget",
    label: "On Target / Peer Leader",
    rate: "",
    standard: "",
    gap: 0,
    relativeGap: 0,
    focusScore: 0,
    status: "green",
  };
}

function onTargetStagesFromRates(rates) {
  if (!rates) return [];
  return GAP_CONFIG
    .map((config) => ({ ...config, rate: toNumber(rates[config.key]) }))
    .filter((item) => item.rate >= item.standard)
    .map((item) => item.label);
}

function excelStageFromPeriods(...periodRates) {
  const validPeriods = periodRates.filter(Boolean);
  if (!validPeriods.length) return null;

  const candidates = GAP_CONFIG.map((config, order) => {
    const values = validPeriods
      .map((rates) => toNumber(rates?.[config.key]))
      .filter((rate) => Number.isFinite(rate));

    if (!values.length) return null;
    const averageRate = values.reduce((sum, rate) => sum + rate, 0) / values.length;
    const targetRatio = config.standard > 0 ? averageRate / config.standard : 0;
    const aboveTarget = averageRate - config.standard;

    return { ...config, averageRate, targetRatio, aboveTarget, order };
  }).filter(Boolean);

  // Prefer stages actually at/above target. If none are on target, return the stage
  // closest to success so the UI can still show a strongest area.
  const onTarget = candidates.filter((item) => item.averageRate >= item.standard);
  const pool = onTarget.length ? onTarget : candidates;
  pool.sort((a, b) =>
    b.targetRatio - a.targetRatio ||
    b.aboveTarget - a.aboveTarget ||
    a.order - b.order
  );

  return pool[0] || null;
}

async function loadGapFocusSettings(sheets) {
  await getOrCreateSheet(sheets, GAP_SETTINGS_TAB);

  let tab = await readTab(sheets, GAP_SETTINGS_TAB);

  if (!tab.headers.length) {
    const values = [
      ["Stage", "Success Target %", "Yellow Floor %", "Funnel Priority Weight"],
      ...DEFAULT_GAP_CONFIG.map((gap) => [
        gap.label,
        gap.standard,
        gap.yellowFloor,
        gap.priorityWeight,
      ]),
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${GAP_SETTINGS_TAB}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    // Format the editable target columns as percentages.
    const sheetId = await getOrCreateSheet(sheets, GAP_SETTINGS_TAB);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: values.length,
                startColumnIndex: 1,
                endColumnIndex: 3,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: "PERCENT", pattern: "0.0%" },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 1 },
              },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: 4,
              },
            },
          },
        ],
      },
    });

    tab = await readTab(sheets, GAP_SETTINGS_TAB);
  }

  const stageIndex = getHeaderIndex(tab.headers, ["Stage"], true);
  const targetIndex = getHeaderIndex(
    tab.headers,
    ["Success Target %", "Success Target", "Target %", "Target"],
    true
  );
  const yellowIndex = getHeaderIndex(
    tab.headers,
    ["Yellow Floor %", "Yellow Floor", "Yellow Threshold %", "Yellow Threshold"]
  );
  const weightIndex = getHeaderIndex(
    tab.headers,
    ["Funnel Priority Weight", "Priority Weight", "Weight"],
    true
  );

  const byStage = new Map(
    tab.rows
      .map((row) => [normalizeName(valueAt(row, stageIndex)), row])
      .filter(([stage]) => stage)
  );

  GAP_CONFIG = DEFAULT_GAP_CONFIG.map((fallback) => {
    const row = byStage.get(normalizeName(fallback.label));
    if (!row) return { ...fallback };

    const standard = normalizePercentSetting(
      valueAt(row, targetIndex),
      fallback.standard
    );

    const yellowFloor = yellowIndex >= 0
      ? normalizePercentSetting(valueAt(row, yellowIndex), fallback.yellowFloor)
      : Math.max(0, standard - (fallback.standard - fallback.yellowFloor));

    return {
      ...fallback,
      standard,
      yellowFloor: Math.min(yellowFloor, standard),
      priorityWeight: normalizeWeightSetting(
        valueAt(row, weightIndex),
        fallback.priorityWeight
      ),
    };
  });

  console.log(`[gap-focus] settings loaded from "${GAP_SETTINGS_TAB}"`);
  for (const gap of GAP_CONFIG) {
    console.log(
      `[gap-focus] ${gap.label}: target=${(gap.standard * 100).toFixed(1)}% ` +
      `yellow=${(gap.yellowFloor * 100).toFixed(1)}% weight=${gap.priorityWeight}`
    );
  }
}

function parseLastWorked(tab) {
  const { headers, rows } = tab;
  const indexes = {
    repName: getHeaderIndex(headers, ["Rep Name"], true),
    office: getHeaderIndex(headers, ["Office"]),
    lastWorkedDate: getHeaderIndex(headers, ["Last Worked Date", "Last Worked"]),
    daysInactive: getHeaderIndex(headers, ["Days Since Last Worked", "Days Inactive"]),
    flag: getHeaderIndex(headers, ["Flag", "Activity Flag"]),
    talkToStop: getHeaderIndex(headers, ["Talk → Stop", "Talk -> Stop"]),
    stopToZip: getHeaderIndex(headers, ["Stop → Zip", "Stop -> Zip"]),
    zipToPresentation: getHeaderIndex(headers, ["Zip → Presentation", "Zip -> Presentation"]),
    presentationToInfo: getHeaderIndex(headers, ["Presentation → Info", "Presentation -> Info"]),
    infoToClose: getHeaderIndex(headers, ["Info → Close", "Info -> Close"]),
  };

  const map = new Map();
  for (const row of rows) {
    const repName = normalizeText(valueAt(row, indexes.repName));
    if (!repName) continue;
    const rates = Object.fromEntries(
      GAP_CONFIG.map((gap) => [gap.key, toNumber(valueAt(row, indexes[gap.key]))])
    );
    map.set(normalizeName(repName), {
      repName,
      office: normalizeText(valueAt(row, indexes.office)),
      lastWorkedDate: valueAt(row, indexes.lastWorkedDate),
      daysInactive: toNumber(valueAt(row, indexes.daysInactive)),
      flag: normalizeText(valueAt(row, indexes.flag)) || "unknown",
      rates,
      onTargetStages: onTargetStagesFromRates(rates),
      primaryGap: primaryGapFromRates(rates, repName),
    });
  }
  return map;
}

function parseWeekly(tab) {
  const { headers, rows } = tab;
  if (!headers.length) return new Map();

  const indexes = {
    repName: getHeaderIndex(headers, ["Rep Name"], true),
    office: getHeaderIndex(headers, ["Office"]),
    talk: getHeaderIndex(headers, ["Talk", "Talks"]),
    stops: getHeaderIndex(headers, ["Stops", "Stop"]),
    zips: getHeaderIndex(headers, ["Zips", "Zip"]),
    presentation: getHeaderIndex(headers, ["Presentation", "Presentations"]),
    info: getHeaderIndex(headers, ["Info", "Infos"]),
    close: getHeaderIndex(headers, ["Close", "Closes", "Sales", "Total Sales"]),
    electricSale: getHeaderIndex(headers, ["Electric Sale", "Electric Sales"]),
    gasSale: getHeaderIndex(headers, ["Gas Sale", "Gas Sales"]),
  };

  const map = new Map();
  for (const row of rows) {
    const repName = normalizeText(valueAt(row, indexes.repName));
    if (!repName) continue;

    const talk = toNumber(valueAt(row, indexes.talk));
    const stops = toNumber(valueAt(row, indexes.stops));
    const zips = toNumber(valueAt(row, indexes.zips));
    const presentation = toNumber(valueAt(row, indexes.presentation));
    const info = toNumber(valueAt(row, indexes.info));
    const explicitClose = toNumber(valueAt(row, indexes.close));
    const close = explicitClose ||
      toNumber(valueAt(row, indexes.electricSale)) +
      toNumber(valueAt(row, indexes.gasSale));

    const rates = {
      talkToStop: safeDivide(stops, talk),
      stopToZip: safeDivide(zips, stops),
      zipToPresentation: safeDivide(presentation, zips),
      presentationToInfo: safeDivide(info, presentation),
      infoToClose: safeDivide(close, info),
    };

    map.set(normalizeName(repName), {
      repName,
      office: normalizeText(valueAt(row, indexes.office)),
      metrics: { talk, stops, zips, presentation, info, close },
      rates,
      onTargetStages: onTargetStagesFromRates(rates),
      primaryGap: primaryGapFromRates(rates, repName),
    });
  }
  return map;
}

function buildReport(agents, lastWorkedMap, currentMap, lastMap) {
  const names = new Set([
    ...agents.map((a) => normalizeName(a.repName)),
    ...lastWorkedMap.keys(),
    ...currentMap.keys(),
    ...lastMap.keys(),
  ]);
  const agentMap = new Map(agents.map((a) => [normalizeName(a.repName), a]));

  const reps = [...names].map((key) => {
    const agent = agentMap.get(key) || {};
    const worked = lastWorkedMap.get(key) || {};
    const current = currentMap.get(key) || {};
    const last = lastMap.get(key) || {};
    return {
      team: agent.team || "Unassigned Team",
      teamLead: agent.teamLead || "",
      repName: agent.repName || worked.repName || current.repName || last.repName || key,
      office: agent.office || worked.office || current.office || last.office || "",
      lastWorkedDate: worked.lastWorkedDate || "",
      daysInactive: worked.daysInactive ?? "",
      flag: worked.flag || "unknown",
      lastWorkedGap: worked.primaryGap || null,
      currentGap: current.primaryGap || null,
      lastWeekGap: last.primaryGap || null,
      lastWorkedOnTarget: worked.onTargetStages || [],
      currentWeekOnTarget: current.onTargetStages || [],
      lastWeekOnTarget: last.onTargetStages || [],
      excelsAt: excelStageFromPeriods(worked.rates, current.rates, last.rates),
    };
  });

  reps.sort((a, b) =>
    a.team.localeCompare(b.team) ||
    a.teamLead.localeCompare(b.teamLead) ||
    a.repName.localeCompare(b.repName)
  );
  return reps;
}

function gapCells(gap) {
  if (!gap) return ["No Data", "no-data"];
  return [gap.label, gap.status];
}

function buildRows(reps) {
  const rows = [[
    "Team",
    "Team Lead",
    "Rep Name",
    "Last Worked Gap",
    "Last Worked Status",
    "Last Day On Target",
    "Current Week Gap",
    "Current Week Status",
    "Current Week On Target",
    "Last Week Gap",
    "Last Week Status",
    "Last Week On Target",
    "Excels At (Avg)",
    "Excel Avg Rate",
    "Last Worked Date",
    "Days Inactive",
    "Activity Flag",
  ]];

  let priorTeam = null;

  for (const rep of reps) {
    if (priorTeam !== null && priorTeam !== rep.team) {
      rows.push(new Array(17).fill(""));
    }

    rows.push([
      rep.team,
      rep.teamLead,
      rep.repName,
      ...gapCells(rep.lastWorkedGap),
      rep.lastWorkedOnTarget.join(", ") || "—",
      ...gapCells(rep.currentGap),
      rep.currentWeekOnTarget.join(", ") || "—",
      ...gapCells(rep.lastWeekGap),
      rep.lastWeekOnTarget.join(", ") || "—",
      rep.excelsAt?.label || "No Data",
      rep.excelsAt?.averageRate ?? "",
      rep.lastWorkedDate,
      rep.daysInactive,
      rep.flag,
    ]);

    priorTeam = rep.team;
  }

  return rows;
}

async function getOrCreateSheet(sheets, title) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    fields: "sheets.properties",
  });
  const existing = spreadsheet.data.sheets?.find((s) => s.properties?.title === title);
  if (existing) return existing.properties.sheetId;
  const result = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  return result.data.replies?.[0]?.addSheet?.properties?.sheetId;
}

function statusFormat(status) {
  const formats = {
    green: ["#B6D7A8", "#274E13"],
    yellow: ["#FFE599", "#5F4B00"],
    orange: ["#F6B26B", "#783F04"],
    "no-data": ["#D9D9D9", "#555555"],
  };
  return formats[status] || formats["no-data"];
}

function gapFormat(gap) {
  const formats = {
    talkToStop: ["#C6E0B4", "#274E13"],
    stopToZip: ["#9DC3E6", "#1F4E78"],
    zipToPresentation: ["#FFD966", "#7F6000"],
    presentationToInfo: ["#F4B183", "#843C0C"],
    infoToClose: ["#D9B3FF", "#4C2F63"],
    onTarget: ["#A9D18E", "#274E13"],
    "no-data": ["#D9D9D9", "#555555"],
  };

  return formats[gap?.key || "no-data"] || formats["no-data"];
}

const TEAM_FORMATS = [
  ["#D9EAF7", "#1F4E78"],
  ["#E2F0D9", "#375623"],
  ["#FFF2CC", "#7F6000"],
  ["#FCE4D6", "#843C0C"],
  ["#E4DFEC", "#4C2F63"],
  ["#DDEBF7", "#1F4E78"],
  ["#EADCF8", "#5B2C6F"],
  ["#DDEFEF", "#205B5B"],
];

function buildTeamFormats(reps) {
  const teams = [...new Set(reps.map((rep) => rep.team))];
  return new Map(
    teams.map((team, index) => [team, TEAM_FORMATS[index % TEAM_FORMATS.length]])
  );
}

function borderStyle(color = "#B7B7B7") {
  return {
    style: "SOLID",
    color: hexColor(color),
  };
}

async function formatSheet(sheets, sheetId, reps, rows) {
  const columnCount = 17;
  const teamFormats = buildTeamFormats(reps);

  const requests = [
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
            textFormat: {
              foregroundColor: hexColor("#000000"),
              bold: false,
            },
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
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
            textFormat: {
              foregroundColor: hexColor("#FFFFFF"),
              bold: true,
            },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: rows.length,
        },
        properties: { pixelSize: 30 },
        fields: "pixelSize",
      },
    },
    {
      // Last Worked Date: force a readable date format and clear any old percentage format.
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rows.length,
          startColumnIndex: 14,
          endColumnIndex: 15,
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
      // Days Inactive: force a normal whole number instead of inherited percent/date formatting.
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rows.length,
          startColumnIndex: 15,
          endColumnIndex: 16,
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
          gridProperties: {
            frozenRowCount: 1,
            frozenColumnCount: 3,
          },
        },
        fields:
          "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    // Explicit widths keep labels readable; auto-resize was too narrow after old formats remained.
    ...[
      [0, 170], [1, 150], [2, 170],
      [3, 180], [4, 110], [5, 330],
      [6, 180], [7, 110], [8, 330],
      [9, 180], [10, 110], [11, 330],
      [12, 190], [13, 115], [14, 125], [15, 105], [16, 115],
    ].map(([columnIndex, pixelSize]) => ({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: columnIndex,
          endIndex: columnIndex + 1,
        },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    })),
  ];

  let rowIndex = 1;
  let previousTeam = null;

  for (const rep of reps) {
    if (previousTeam !== null && previousTeam !== rep.team) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
          properties: { pixelSize: 12 },
          fields: "pixelSize",
        },
      });

      rowIndex += 1;
    }

    const [teamBackground, teamText] =
      teamFormats.get(rep.team) || TEAM_FORMATS[0];

    requests.push(
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 0,
            endColumnIndex: 2,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: hexColor(teamBackground),
              textFormat: {
                foregroundColor: hexColor(teamText),
                bold: true,
              },
              verticalAlignment: "MIDDLE",
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
        },
      },
      {
        updateBorders: {
          range: {
            sheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 0,
            endColumnIndex: columnCount,
          },
          top: borderStyle(),
          bottom: borderStyle(),
          left: borderStyle(),
          right: borderStyle(),
          innerVertical: borderStyle("#D9D9D9"),
        },
      }
    );

    const periods = [
      {
        gap: rep.lastWorkedGap,
        gapColumn: 3,
        statusColumn: 4,
      },
      {
        gap: rep.currentGap,
        gapColumn: 6,
        statusColumn: 7,
      },
      {
        gap: rep.lastWeekGap,
        gapColumn: 9,
        statusColumn: 10,
      },
    ];

    for (const period of periods) {
      const [gapBackground, gapText] = gapFormat(period.gap);
      const [statusBackground, statusText] = statusFormat(
        period.gap?.status || "no-data"
      );

      requests.push(
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: period.gapColumn,
              endColumnIndex: period.gapColumn + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor(gapBackground),
                textFormat: {
                  foregroundColor: hexColor(gapText),
                  bold: true,
                },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: period.statusColumn,
              endColumnIndex: period.statusColumn + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor(statusBackground),
                textFormat: {
                  foregroundColor: hexColor(statusText),
                  bold: true,
                },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
          },
        }
      );
    }

    // Highlight every stage where the rep is on target for each period.
    const onTargetColumns = [
      { stages: rep.lastWorkedOnTarget, column: 5 },
      { stages: rep.currentWeekOnTarget, column: 8 },
      { stages: rep.lastWeekOnTarget, column: 11 },
    ];
    for (const item of onTargetColumns) {
      const hasTargets = Array.isArray(item.stages) && item.stages.length > 0;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: item.column, endColumnIndex: item.column + 1 },
          cell: { userEnteredFormat: {
            backgroundColor: hexColor(hasTargets ? "#D9EAD3" : "#F3F4F6"),
            textFormat: { foregroundColor: hexColor(hasTargets ? "#274E13" : "#6B7280"), bold: hasTargets },
            wrapStrategy: "WRAP", verticalAlignment: "MIDDLE"
          } },
          fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)",
        },
      });
    }

    const [excelBackground, excelText] = gapFormat(rep.excelsAt);
    requests.push(
      { repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 12, endColumnIndex: 13 },
        cell: { userEnteredFormat: { backgroundColor: hexColor(excelBackground), textFormat: { foregroundColor: hexColor(excelText), bold: true }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      } },
      { repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 13, endColumnIndex: 14 },
        cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, horizontalAlignment: "CENTER", textFormat: { bold: true } } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)",
      } }
    );

    const activityColors = {
      black: ["#1F1F1F", "#FFFFFF"],
      red: ["#E06666", "#FFFFFF"],
      yellow: ["#FFD966", "#5F4B00"],
      none: ["#B6D7A8", "#274E13"],
      unknown: ["#D9D9D9", "#333333"],
    };

    const [flagBackground, flagText] =
      activityColors[rep.flag] || activityColors.unknown;

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 16,
          endColumnIndex: 17,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexColor(flagBackground),
            textFormat: {
              foregroundColor: hexColor(flagText),
              bold: true,
            },
            horizontalAlignment: "CENTER",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });

    rowIndex += 1;
    previousTeam = rep.team;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests },
  });
}

async function run() {
  const sheets = await getSheetsClient();
  await loadGapFocusSettings(sheets);

  const agents = await loadAgents(sheets);
  const [lastWorkedTab, currentWeekTab, lastWeekTab] = await Promise.all([
    readTab(sheets, LAST_WORKED_TAB),
    readTab(sheets, CURRENT_WEEK_TAB),
    readTab(sheets, LAST_WEEK_TAB),
  ]);

  const reps = buildReport(
    agents,
    parseLastWorked(lastWorkedTab),
    parseWeekly(currentWeekTab),
    parseWeekly(lastWeekTab)
  );
  const rows = buildRows(reps);
  const sheetId = await getOrCreateSheet(sheets, OUTPUT_TAB);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${OUTPUT_TAB}'!A:AZ`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${OUTPUT_TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
  await formatSheet(sheets, sheetId, reps, rows);

  const teams = new Set(reps.map((rep) => rep.team));
  console.log(`[team-gaps] reps=${reps.length}`);
  console.log(`[team-gaps] teams=${teams.size}`);
  console.log(`[team-gaps] source last-worked="${LAST_WORKED_TAB}"`);
  console.log(`[team-gaps] source current-week="${CURRENT_WEEK_TAB}"`);
  console.log(`[team-gaps] source last-week="${LAST_WEEK_TAB}"`);
  console.log(`[team-gaps] gap-focus settings="${GAP_SETTINGS_TAB}"`);
  console.log(`[team-gaps] tab="${OUTPUT_TAB}" updated`);
  console.log(`[team-gaps] https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}`);
}

run().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
