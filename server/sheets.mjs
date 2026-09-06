import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";

const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const agentsTab = process.env.AGENTS_SHEET_NAME || "Agents";
const gapsTab = process.env.TEAM_GAPS_SHEET_NAME || "Team/Rep Gaps";
const matchupsTab = process.env.MATCHUPS_SHEET_NAME || "Daily Matchups";
const matchupDraftTab = process.env.MATCHUP_DRAFT_SHEET_NAME || "Matchup Draft";
const lastWorkedTab = process.env.GOOGLE_SHEET_TAB || "Last Worked";
const lastWorkedHistoryTab = process.env.LAST_WORKED_HISTORY_SHEET_NAME || "Last Worked History";
const currentWeekTab = process.env.CURRENT_WEEK_SHEET_TAB || "Current Week Avg";
const lastWeekTab = process.env.LAST_WEEK_SHEET_TAB || "Last Week Avg";
const twoWeeksAgoTab = process.env.TWO_WEEKS_AGO_SHEET_TAB || "2 Weeks Ago Avg";
const threeWeeksAgoTab = process.env.THREE_WEEKS_AGO_SHEET_TAB || "3 Weeks Ago Avg";
const fieldNotesTab = process.env.FIELD_NOTES_SHEET_NAME || "Field Notes";
const manualNumbersTab = process.env.MANUAL_NUMBERS_SHEET_NAME || "Manual Numbers";
const suggestionsTab = process.env.SUGGESTIONS_SHEET_NAME || "Suggestions";

const AGENT_HEADERS = ["repKey", "repName", "office", "repType", "team", "teamLead", "attendance", "experienceLevel"];

function credentialsPath() {
  const configured = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!configured) return null;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export async function sheetsClient() {
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID in .env");
  const keyFile = credentialsPath();
  let auth;
  if (keyFile) {
    if (!fs.existsSync(keyFile)) throw new Error(`Google credentials not found: ${keyFile}`);
    auth = new google.auth.GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  } else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } else {
    throw new Error("Missing Google service-account credentials");
  }
  return google.sheets({ version: "v4", auth });
}

async function ensureTab(client, title, headers = []) {
  const book = await client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const found = book.data.sheets?.find((s) => s.properties?.title === title);
  if (!found) {
    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    if (headers.length) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${title}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  }
}

async function clearEntireTab(client, title) {
  const spreadsheet = await client.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  const sheet = spreadsheet.data.sheets?.find(
    (item) => item.properties?.title === title
  );

  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    throw new Error(`Google Sheet tab not found: ${title}`);
  }

  await client.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: {
              sheetId: sheet.properties.sheetId,
            },
            fields: "userEnteredValue",
          },
        },
      ],
    },
  });
}

export async function readTab(title) {
  const client = await sheetsClient();
  try {
    const res = await client.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A:AZ` });
    const values = res.data.values || [];
    return { headers: values[0] || [], rows: values.slice(1) };
  } catch (error) {
    if (error?.code === 400) return { headers: [], rows: [] };
    throw error;
  }
}

function rowsToObjects({ headers, rows }) {
  return rows.map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])));
}

export async function getAgents() {
  const tab = await readTab(agentsTab);
  return rowsToObjects(tab).filter((a) => a.repKey || a.repName);
}

export async function replaceAgents(agents) {
  const client = await sheetsClient();
  await ensureTab(client, agentsTab, AGENT_HEADERS);
  const rows = agents.map((agent) => AGENT_HEADERS.map((key) => agent[key] ?? ""));
  await client.spreadsheets.values.clear({ spreadsheetId, range: `'${agentsTab}'!A:Z` });
  await client.spreadsheets.values.update({
    spreadsheetId,
    range: `'${agentsTab}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [AGENT_HEADERS, ...rows] },
  });
  return agents;
}

export async function getGaps() {
  const tab = await readTab(gapsTab);
  return rowsToObjects(tab);
}

const MATCHUP_HEADERS = ["Date", "Group ID", "Group", "Coach", "Focus", "Rep Key", "Rep Name", "Team", "Updated At"];

function matchupRows({ date, groups, updatedAt = new Date().toISOString() }) {
  return groups.flatMap((group, index) => {
    const members = Array.isArray(group.members) ? group.members : [];
    const base = [
      date || "",
      group.id || `group-${index + 1}`,
      group.name || `Group ${index + 1}`,
      group.coach || "",
      group.focus || "",
    ];
    if (!members.length) return [[...base, "", "", group.team || "", updatedAt]];
    return members.map((member) => [
      ...base,
      member.repKey || "",
      member.repName || "",
      member.team || group.team || "",
      updatedAt,
    ]);
  });
}

function rowsToMatchups(rows = []) {
  const groups = [];
  const byId = new Map();
  let date = "";
  let updatedAt = "";
  for (const row of rows) {
    date ||= String(row[0] || "");
    updatedAt = String(row[8] || updatedAt || "");
    const id = String(row[1] || row[2] || `group-${groups.length + 1}`);
    let group = byId.get(id);
    if (!group) {
      group = { id, name: String(row[2] || "Group"), coach: String(row[3] || ""), focus: String(row[4] || ""), team: String(row[7] || ""), members: [] };
      byId.set(id, group);
      groups.push(group);
    }
    if (row[5] || row[6]) {
      group.members.push({ repKey: String(row[5] || ""), repName: String(row[6] || ""), team: String(row[7] || "") });
    }
  }
  return { date, groups, updatedAt };
}

async function replaceMatchupTab(title, payload) {
  const client = await sheetsClient();

  await ensureTab(client, title, MATCHUP_HEADERS);

  const updatedAt = new Date().toISOString();

  const rows = matchupRows({
    ...payload,
    updatedAt,
  });

  console.log(`[sheets] Clearing all existing entries from "${title}"`);

  await clearEntireTab(client, title);

  console.log(
    `[sheets] Writing ${rows.length} matchup rows to "${title}"`
  );

  await client.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [MATCHUP_HEADERS, ...rows],
    },
  });

  console.log(`[sheets] Finished replacing "${title}"`);

  return {
    ...payload,
    updatedAt,
  };
}

export async function saveMatchups({ date, groups }) {
  // Final save intentionally wipes every existing row before posting the new matchups.
  return replaceMatchupTab(matchupsTab, { date, groups });
}

export async function getFinalMatchups() {
  const tab = await readTab(matchupsTab);
  return rowsToMatchups(tab.rows);
}

export async function saveDraftMatchups({ date, groups }) {
  return replaceMatchupTab(matchupDraftTab, { date, groups });
}

export async function getDraftMatchups() {
  const tab = await readTab(matchupDraftTab);
  return rowsToMatchups(tab.rows);
}


const FIELD_NOTE_HEADERS = ["Note ID", "Date", "Day", "Rep Key", "Rep Name", "Team", "Author", "Note", "Created At"];

export async function getFieldNotes() {
  const client = await sheetsClient();
  await ensureTab(client, fieldNotesTab, FIELD_NOTE_HEADERS);
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${fieldNotesTab}'!A:I`,
  });
  const rows = (res.data.values || []).slice(1);
  return rows
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => ({
      id: String(row[0] || ""),
      date: String(row[1] || ""),
      day: String(row[2] || ""),
      repKey: String(row[3] || ""),
      repName: String(row[4] || ""),
      team: String(row[5] || ""),
      author: String(row[6] || ""),
      note: String(row[7] || ""),
      createdAt: String(row[8] || ""),
    }))
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}

export async function addFieldNote(note) {
  const client = await sheetsClient();
  await ensureTab(client, fieldNotesTab, FIELD_NOTE_HEADERS);
  const row = FIELD_NOTE_HEADERS.map((header) => ({
    "Note ID": note.id,
    Date: note.date,
    Day: note.day,
    "Rep Key": note.repKey,
    "Rep Name": note.repName,
    Team: note.team,
    Author: note.author,
    Note: note.note,
    "Created At": note.createdAt,
  })[header] ?? "");

  await client.spreadsheets.values.append({
    spreadsheetId,
    range: `'${fieldNotesTab}'!A:I`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return note;
}


const SUGGESTION_HEADERS = ["Suggestion ID", "Date", "Day", "Author", "Category", "Suggestion", "Status", "Created At"];

export async function getSuggestions() {
  const client = await sheetsClient();
  await ensureTab(client, suggestionsTab, SUGGESTION_HEADERS);
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${suggestionsTab}'!A:H`,
  });
  return (res.data.values || []).slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => ({
      id: String(row[0] || ""),
      date: String(row[1] || ""),
      day: String(row[2] || ""),
      author: String(row[3] || ""),
      category: String(row[4] || "General"),
      suggestion: String(row[5] || ""),
      status: String(row[6] || "New"),
      createdAt: String(row[7] || ""),
    }))
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}

export async function addSuggestion(item) {
  const client = await sheetsClient();
  await ensureTab(client, suggestionsTab, SUGGESTION_HEADERS);
  const row = [item.id, item.date, item.day, item.author, item.category, item.suggestion, item.status, item.createdAt];
  await client.spreadsheets.values.append({
    spreadsheetId,
    range: `'${suggestionsTab}'!A:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return item;
}


const MANUAL_NUMBER_HEADERS = [
  "Entry ID", "Date", "Day", "Rep Key", "Rep Name", "Team",
  "Talks", "Stops", "Zips", "Presentations", "Info",
  "Electric Sales", "Electric Partials", "Gas Sales", "Total Sales",
  "Entered By", "Created At", "Updated At"
];

function cleanNumber(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function manualObject(row = []) {
  return {
    id: String(row[0] || ""),
    date: String(row[1] || ""),
    day: String(row[2] || ""),
    repKey: String(row[3] || ""),
    repName: String(row[4] || ""),
    team: String(row[5] || ""),
    talks: cleanNumber(row[6]),
    stops: cleanNumber(row[7]),
    zips: cleanNumber(row[8]),
    presentations: cleanNumber(row[9]),
    info: cleanNumber(row[10]),
    electric: cleanNumber(row[11]),
    electricPartial: cleanNumber(row[12]),
    gas: cleanNumber(row[13]),
    totalSales: cleanNumber(row[14]),
    enteredBy: String(row[15] || ""),
    createdAt: String(row[16] || ""),
    updatedAt: String(row[17] || ""),
  };
}

export async function getManualNumbers() {
  const client = await sheetsClient();
  await ensureTab(client, manualNumbersTab, MANUAL_NUMBER_HEADERS);
  const res = await client.spreadsheets.values.get({ spreadsheetId, range: `'${manualNumbersTab}'!A:R` });
  return (res.data.values || []).slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map(manualObject)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function upsertManualNumbers(entry) {
  const client = await sheetsClient();
  await ensureTab(client, manualNumbersTab, MANUAL_NUMBER_HEADERS);
  const res = await client.spreadsheets.values.get({ spreadsheetId, range: `'${manualNumbersTab}'!A:R` });
  const values = res.data.values || [];
  const rows = values.slice(1);
  const key = String(entry.repKey || "").trim();
  const name = String(entry.repName || "").trim().toLowerCase();
  const matchIndex = rows.findIndex((row) => {
    const existing = manualObject(row);
    const sameRep = key ? existing.repKey === key : existing.repName.trim().toLowerCase() === name;
    return sameRep && existing.date === entry.date;
  });
  const existing = matchIndex >= 0 ? manualObject(rows[matchIndex]) : null;
  const normalized = {
    ...entry,
    id: existing?.id || entry.id,
    createdAt: existing?.createdAt || entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  const row = [
    normalized.id, normalized.date, normalized.day, normalized.repKey, normalized.repName, normalized.team,
    normalized.talks, normalized.stops, normalized.zips, normalized.presentations, normalized.info,
    normalized.electric, normalized.electricPartial, normalized.gas, normalized.totalSales,
    normalized.enteredBy, normalized.createdAt, normalized.updatedAt,
  ];
  if (matchIndex >= 0) {
    const sheetRow = matchIndex + 2;
    await client.spreadsheets.values.update({
      spreadsheetId, range: `'${manualNumbersTab}'!A${sheetRow}:R${sheetRow}`, valueInputOption: "RAW", requestBody: { values: [row] },
    });
  } else {
    await client.spreadsheets.values.append({
      spreadsheetId, range: `'${manualNumbersTab}'!A:R`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [row] },
    });
  }
  return normalized;
}

function easternYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function ymdDate(ymd) { return new Date(`${ymd}T12:00:00-04:00`); }
function addDaysYmd(ymd, days) { const d = ymdDate(ymd); d.setUTCDate(d.getUTCDate() + days); return easternYmd(d); }
function saturdayWeekStart(ymd) {
  const d = ymdDate(ymd);
  const day = d.getUTCDay();
  const back = (day - 6 + 7) % 7;
  return addDaysYmd(ymd, -back);
}
function manualRow(entry) {
  return {
    "Rep Name": entry.repName, "Rep Key": entry.repKey,
    Talk: entry.talks, Stop: entry.stops, Zip: entry.zips, Presentation: entry.presentations, Info: entry.info,
    "Electric Sales": entry.electric, "Electric Partials": entry.electricPartial, "Gas Sales": entry.gas,
    Close: entry.electric + entry.electricPartial, "Data Source": "Manual", "Recorded Date": entry.date,
  };
}
function sumManual(entries = []) {
  const byRep = new Map();
  for (const entry of entries) {
    const key = String(entry.repKey || entry.repName || "").trim().toLowerCase();
    if (!key) continue;
    const current = byRep.get(key) || { ...entry, talks:0,stops:0,zips:0,presentations:0,info:0,electric:0,electricPartial:0,gas:0,totalSales:0 };
    for (const field of ["talks","stops","zips","presentations","info","electric","electricPartial","gas","totalSales"]) current[field] += cleanNumber(entry[field]);
    if (entry.date > (current.date || "")) current.date = entry.date;
    byRep.set(key, current);
  }
  return [...byRep.values()].map(manualRow);
}
function rowActivity(row = {}) {
  const keys = Object.keys(row);
  const aliases = ["talk","talks","stop","stops","zip","zips","presentation","presentations","pres","info","electric sales","electric sale","electric partials","close","closes","sales","total sales"];
  const normalize = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = new Set(aliases.map(normalize));
  return keys.some((key) => wanted.has(normalize(key)) && cleanNumber(row[key]) > 0);
}
function mergeWorkMyTFirst(workRows = [], manualRows = []) {
  const normalize = (v) => String(v || "").trim().toLowerCase();
  const workNames = new Set(workRows.filter(rowActivity).map((row) => normalize(row["Rep Name"] || row.repName || row.Name)));
  return [...workRows, ...manualRows.filter((row) => !workNames.has(normalize(row["Rep Name"])))];
}
function rowRepName(row = {}) { return String(row["Rep Name"] || row.repName || row.Name || "").trim().toLowerCase(); }
function rowRecordedDate(row = {}) {
  const candidates = [row["Recorded Date"], row["Last Worked Date"], row["Last Worked"], row.Date, row.date];
  const raw = candidates.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()));
  return String(raw || "");
}
function mergeLastWorkedWorkMyTFirst(workRows = [], manualRows = []) {
  const workByName = new Map(workRows.map((row) => [rowRepName(row), row]).filter(([name]) => name));
  const manualByName = new Map(manualRows.map((row) => [rowRepName(row), row]).filter(([name]) => name));
  const names = new Set([...workByName.keys(), ...manualByName.keys()]);
  const merged = [];
  for (const name of names) {
    const work = workByName.get(name);
    const manual = manualByName.get(name);
    if (!work || !rowActivity(work)) { merged.push(manual || work); continue; }
    if (!manual) { merged.push(work); continue; }
    const workDate = rowRecordedDate(work);
    const manualDate = rowRecordedDate(manual);
    // A newer manual day can become the rep's last-worked day. If both sources
    // are for the same day, WorkMyT wins to prevent duplicate/manual overrides.
    merged.push(manualDate && workDate && manualDate > workDate ? manual : work);
  }
  return merged.filter(Boolean);
}

export async function getPerformanceTabs() {
  const [lastWorked, lastWorkedHistory, currentWeek, lastWeek, twoWeeksAgo, threeWeeksAgo, manual] = await Promise.all([
    readTab(lastWorkedTab),
    readTab(lastWorkedHistoryTab),
    readTab(currentWeekTab),
    readTab(lastWeekTab),
    readTab(twoWeeksAgoTab),
    readTab(threeWeeksAgoTab),
    getManualNumbers(),
  ]);
  const work = {
    lastWorked: rowsToObjects(lastWorked),
    lastWorkedHistory: rowsToObjects(lastWorkedHistory),
    currentWeek: rowsToObjects(currentWeek),
    lastWeek: rowsToObjects(lastWeek),
    twoWeeksAgo: rowsToObjects(twoWeeksAgo),
    threeWeeksAgo: rowsToObjects(threeWeeksAgo),
  };
  const today = easternYmd();
  const currentStart = saturdayWeekStart(today);
  const currentEnd = addDaysYmd(currentStart, 6);
  const lastStart = addDaysYmd(currentStart, -7);
  const lastEnd = addDaysYmd(currentStart, -1);

  const latestByRep = new Map();
  for (const entry of manual) {
    const key = String(entry.repKey || entry.repName || "").trim().toLowerCase();
    if (!key) continue;
    if (!latestByRep.has(key) || entry.date > latestByRep.get(key).date) latestByRep.set(key, entry);
  }
  const manualLast = [...latestByRep.values()].map(manualRow);
  const manualCurrent = sumManual(manual.filter((entry) => entry.date >= currentStart && entry.date <= currentEnd));
  const manualPrevious = sumManual(manual.filter((entry) => entry.date >= lastStart && entry.date <= lastEnd));

  return {
    lastWorked: mergeLastWorkedWorkMyTFirst(work.lastWorked, manualLast),
    lastWorkedHistory: work.lastWorkedHistory,
    currentWeek: mergeWorkMyTFirst(work.currentWeek, manualCurrent),
    lastWeek: mergeWorkMyTFirst(work.lastWeek, manualPrevious),
    // Historical weekly tabs are WorkMyT snapshots. They are used by
    // auto-generation leader scoring so leadership reflects consistency,
    // not a single strong week.
    twoWeeksAgo: work.twoWeeksAgo,
    threeWeeksAgo: work.threeWeeksAgo,
  };
}


function rowCountsForTracking(row = {}) {
  const value = (aliases) => {
    const normalized = new Map(Object.keys(row).map((key) => [String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), key]));
    for (const alias of aliases) {
      const key = normalized.get(String(alias).toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (key !== undefined) return cleanNumber(row[key]);
    }
    return 0;
  };
  return {
    talks: value(["Talk", "Talks"]),
    stops: value(["Stop", "Stops"]),
    zips: value(["Zip", "Zips"]),
    presentations: value(["Presentation", "Presentations", "Pres"]),
    info: value(["Info"]),
    electric: value(["Electric Sales", "Electric Sale"]),
    electricPartial: value(["Electric Partials", "Electric Partial Sales"]),
    gas: value(["Gas Sales", "Gas Sale"]),
  };
}
function trackingRecordedDate(row = {}) {
  return String(row["Recorded Date"] || row["Last Worked Date"] || row["Last Worked"] || row.Date || row.date || "").trim();
}
function trackingRepName(row = {}) { return String(row["Rep Name"] || row.repName || row.Name || "").trim(); }
function daysBetweenYmd(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return null;
  return Math.max(0, Math.round((ymdDate(to) - ymdDate(from)) / 86400000));
}
function averageCountRows(rows = []) {
  const fields = ["talks","stops","zips","presentations","info","electric","electricPartial","gas"];
  const result = Object.fromEntries(fields.map((field) => [field, 0]));
  if (!rows.length) return result;
  for (const row of rows) for (const field of fields) result[field] += Number(row.counts?.[field] || 0);
  for (const field of fields) result[field] = Math.round((result[field] / rows.length) * 10) / 10;
  return result;
}
export async function getNumbersTracking() {
  const [agents, current, history, manual] = await Promise.all([
    getAgents(), readTab(lastWorkedTab), readTab(lastWorkedHistoryTab), getManualNumbers(),
  ]);
  const workRows = [...rowsToObjects(history), ...rowsToObjects(current)];
  const byRepDate = new Map();
  for (const row of workRows) {
    const name = trackingRepName(row); const date = trackingRecordedDate(row);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const key = `${name.toLowerCase()}|${date}`;
    byRepDate.set(key, { repName:name, date, counts:rowCountsForTracking(row), source:"WorkMyT" });
  }
  // Manual data fills days WorkMyT does not have. WorkMyT wins on same rep/date.
  for (const entry of manual) {
    if (!entry.repName || !entry.date) continue;
    const key = `${entry.repName.toLowerCase()}|${entry.date}`;
    if (!byRepDate.has(key)) byRepDate.set(key, { repName:entry.repName, date:entry.date, counts:{ talks:entry.talks,stops:entry.stops,zips:entry.zips,presentations:entry.presentations,info:entry.info,electric:entry.electric,electricPartial:entry.electricPartial,gas:entry.gas }, source:"Manual" });
  }
  const today=easternYmd(), currentStart=saturdayWeekStart(today), currentEnd=addDaysYmd(currentStart,6);
  const records=[...byRepDate.values()];
  const reps=agents.map(agent=>{
    const own=records.filter(r=>r.repName.trim().toLowerCase()===String(agent.repName||"").trim().toLowerCase()).sort((a,b)=>b.date.localeCompare(a.date));
    const latest=own[0]||null;
    const week=own.filter(r=>r.date>=currentStart&&r.date<=currentEnd);
    const daysAgo=latest?daysBetweenYmd(latest.date,today):null;
    const status=daysAgo===null?"black":daysAgo<=2?"green":daysAgo<=5?"yellow":"black";
    return { repKey:agent.repKey, repName:agent.repName, team:agent.team||"Unassigned", teamLead:agent.teamLead||"", repType:agent.repType||"", attendance:agent.attendance||"in", lastRecordedDate:latest?.date||"", daysAgo, status, latestCounts:latest?.counts||averageCountRows([]), latestSource:latest?.source||"", weekRecordedDays:week.length, weekAverage:averageCountRows(week) };
  });
  return { generatedAt:new Date().toISOString(), weekStart:currentStart, weekEnd:currentEnd, reps };
}
