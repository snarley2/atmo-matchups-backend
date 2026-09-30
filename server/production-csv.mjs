import fs from "node:fs";
import path from "node:path";

const productionDir = path.resolve(process.cwd(), process.env.PRODUCTION_LOG_DIR || "prod_logs");

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function weeklyElectric(value) {
  const match = String(value ?? "").trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*\/.*)?$/);
  return match ? Number(match[1]) : null;
}

function nameKeys(value) {
  const clean = String(value || "")
    .replace(/[↓↑]/g, "")
    .replace(/^--|--$/g, "")
    .trim();
  if (!clean || /team\s*$/i.test(clean)) return [];
  const normalize = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = [normalize(clean)];
  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    keys.push(normalize(`${rest.join(" ")} ${last}`));
  }
  return [...new Set(keys.filter(Boolean))];
}

function average(values) {
  const available = values.filter((value) => Number.isFinite(value));
  return available.length ? Math.round((available.reduce((sum, value) => sum + value, 0) / available.length) * 10) / 10 : 0;
}

function parseAiLog(rows, fileName) {
  const headerIndex = rows.findIndex((row) => String(row[0] || "").trim().toLowerCase() === "rep name");
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((value) => String(value || "").trim());
  const detail = rows[headerIndex + 1] || [];
  const currentIndex = header.findIndex((value) => value.toLowerCase() === "tw elec");
  const lastIndex = header.findIndex((value) => value.toLowerCase() === "lw elec");
  const twoIndex = header.findIndex((value) => value.toLowerCase() === "lw2 elec");
  const partialIndexes = detail.map((value, index) => String(value || "").trim().toLowerCase() === "p" && index < currentIndex ? index : -1).filter((index) => index >= 0);
  return rows.slice(headerIndex + 2).flatMap((row) => {
    const repName = String(row[0] || "").trim();
    const keys = nameKeys(repName);
    if (!keys.length) return [];
    const partials = partialIndexes.reduce((sum, index) => sum + number(row[index]), 0);
    const current = currentIndex >= 0 ? number(row[currentIndex]) + partials * 0.5 : null;
    const lastWeek = lastIndex >= 0 && String(row[lastIndex] || "").trim() !== "" ? number(row[lastIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 && String(row[twoIndex] || "").trim() !== "" ? number(row[twoIndex]) : null;
    return [{ repName: repName.replace(/[↓↑]/g, "").trim(), keys, current, lastWeek, twoWeeksAgo, overall: average([current, lastWeek, twoWeeksAgo]), partials, sourceFile: fileName }];
  });
}

function parseStandardLog(rows, fileName) {
  const headerIndex = rows.findIndex((row) => row.some((value) => /^prev\.?\s*week/i.test(String(value || "").trim())));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((value) => String(value || "").trim());
  const electricIndexes = header.map((value, index) => /^electric$/i.test(value) ? index : -1).filter((index) => index >= 0);
  const partialIndexes = header.map((value, index) => /^partials?$/i.test(value) ? index : -1).filter((index) => index >= 0);
  const totalElectricIndex = electricIndexes.at(-1);
  const prevIndex = header.findIndex((value) => /^prev\.?\s*week/i.test(value));
  const twoIndex = header.findIndex((value) => /^2\s*wk/i.test(value));
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const repName = String(row[0] || "").trim();
    const keys = nameKeys(repName);
    if (!keys.length) return [];
    const partials = partialIndexes.filter((index) => index < totalElectricIndex).reduce((sum, index) => sum + number(row[index]), 0);
    const current = Number.isInteger(totalElectricIndex) ? number(row[totalElectricIndex]) + partials * 0.5 : null;
    const lastWeek = prevIndex >= 0 ? weeklyElectric(row[prevIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 ? weeklyElectric(row[twoIndex]) : null;
    return [{ repName, keys, current, lastWeek, twoWeeksAgo, overall: average([current, lastWeek, twoWeeksAgo]), partials, sourceFile: fileName }];
  });
}

export function getProductionLogRecords() {
  if (!fs.existsSync(productionDir)) return [];
  const allFiles = fs.readdirSync(productionDir).filter((name) => !/daily plan/i.test(name));
  const tsvFiles = allFiles.filter((name) => name.toLowerCase().endsWith(".tsv"));
  // TSV is authoritative. CSV is only a backwards-compatible fallback when
  // there are no TSV exports in prod_logs.
  const files = (tsvFiles.length ? tsvFiles : allFiles.filter((name) => name.toLowerCase().endsWith(".csv"))).sort();
  return files.flatMap((fileName) => {
    const delimiter = fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const rows = parseDelimited(fs.readFileSync(path.join(productionDir, fileName), "utf8").replace(/^\uFEFF/, ""), delimiter);
    return rows.some((row) => String(row[0] || "").trim().toLowerCase() === "rep name")
      ? parseAiLog(rows, fileName)
      : parseStandardLog(rows, fileName);
  });
}

export function attachProductionLogs(agents = []) {
  const records = getProductionLogRecords();
  const byName = new Map();
  for (const record of records) for (const key of record.keys) {
    const existing = byName.get(key);
    if (!existing || record.overall > existing.overall) byName.set(key, record);
  }
  return agents.map((agent) => {
    const record = nameKeys(agent.repName).map((key) => byName.get(key)).find(Boolean);
    return { ...agent, productionLog: record ? {
      current: record.current,
      lastWeek: record.lastWeek,
      twoWeeksAgo: record.twoWeeksAgo,
      overall: record.overall,
      partials: record.partials,
      sourceFile: record.sourceFile,
    } : { current: 0, lastWeek: null, twoWeeksAgo: null, overall: 0, partials: 0, sourceFile: "" } };
  });
}
