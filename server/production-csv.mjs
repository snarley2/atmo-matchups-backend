import crypto from "node:crypto";
import { canonicalOffice } from "../offices.mjs";
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
  if (!clean || /^--.*--$/.test(clean) || /team\s*$/i.test(clean) || /(?:daily|weekly|office)?\s*totals?$/i.test(clean)) return [];
  const normalize = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = [normalize(clean.replace(/\s*\((?:PL|L|OWNER|TRAINER)\)\s*$/i,""))];
  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    keys.push(normalize(`${rest.join(" ")} ${last}`));
  }
  return [...new Set(keys.filter(Boolean))];
}

function nameAliases(value) {
  let clean = String(value || "").replace(/[↓↑]/g, "").trim();
  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    clean = `${rest.join(" ")} ${last}`.trim();
  }
  clean=clean.replace(/\s*\((?:PL|L|OWNER|TRAINER)\)\s*$/i,"");
  const words = clean.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return [];
  const first = words[0], last = words.at(-1);
  return [...new Set([first, words.length > 1 ? `${first}${last[0]}` : "", words.length > 1 ? `${first[0]}${last}` : ""].filter(Boolean))];
}

function fileWeekEnd(fileName) {
  const match = String(fileName).match(/(\d{1,2})[._-](\d{1,2})(?:[._-](\d{2,4}))?(?=\.tsv$)/i);
  if (!match) return null;
  const year = Number(match[3] || 2026);
  const date = new Date(Date.UTC(year < 100 ? 2000 + year : year, Number(match[1])-1, Number(match[2])));
  return Number.isNaN(date.getTime()) ? null : date;
}
function dailyResult(row, start, fileName) {
  const weekEnd=fileWeekEnd(fileName);
  if (!weekEnd) return null;
  let latest=null;
  for(let day=0;day<7;day++) {
    const values=row.slice(start+day*3,start+day*3+3).map(x=>String(x??"").trim());
    // A recorded zero is worked; x and empty cells are not work.
    if (!values.some(x=>x!=="" && x.toLowerCase()!=="x" && Number.isFinite(Number(x.replace(/,/g,""))))) continue;
    const electric=number(values[0]),gas=number(values[1]),partials=number(values[2]);
    const date=new Date(weekEnd.getTime()-(6-day)*86400000).toISOString().slice(0,10);
    latest={date,electric,gas,partials,production:(electric+partials)*40+gas*18};
  }
  return latest;
}
function datedRecord(record, row, start, fileName) {
  const lastDay=dailyResult(row,start,fileName);
  return {...record,lastDay, electric:lastDay?.electric||0,gas:lastDay?.gas||0,partials:lastDay?.partials||0,
    production:lastDay?.production||0,current:lastDay?.production||0,overall:lastDay?.production||0};
}
function parseNoctisLog(rows,fileName) {
  const head=rows.findIndex(row=>row.some(v=>/^SUN\s+\d+/i.test(String(v||"").trim())) && row.some(v=>/T\s*Ele/i.test(String(v||""))));
  if(head<0)return [];
  const header=rows[head];const totalE=header.findIndex(x=>/^T\s*Ele$/i.test(String(x||"").trim()));
  const totalG=header.findIndex(x=>/^T\s*Gas$/i.test(String(x||"").trim()));
  return rows.slice(head+1).flatMap(row=>{
    const raw=String(row[0]||"").trim();
    const repName=raw.replace(/\s*\((?:PL|L|OWNER|TRAINER)\)\s*$/i,"").trim();
    const keys=nameKeys(repName);
    if(!keys.length || !/[a-z]{2,}.*[a-z]{2,}/i.test(repName) || /^(total|electric|team|gas|week)/i.test(repName))return [];
    const lastDay=dailyResult(row,1,fileName);
    const e=totalE>=0?number(row[totalE]):0,g=totalG>=0?number(row[totalG]):0;
    return [{repName,repType:/\((?:PL|L|OWNER)\)\s*$/i.test(raw)?"Leader":"New Rep",keys,aliases:nameAliases(repName),sourceFile:fileName,lastWeek:null,twoWeeksAgo:null,
      lastDay,electric:lastDay?.electric||0,gas:lastDay?.gas||0,partials:lastDay?.partials||0,
      current:lastDay?.production||0,overall:lastDay?.production||0,production:lastDay?.production||0,
      weekElectric:e,weekGas:g}];
  });
}

function parseAiLog(rows, fileName) {
  const headerIndex = rows.findIndex((row) => String(row[0] || "").trim().toLowerCase() === "rep name");
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((value) => String(value || "").trim());
  const detail = rows[headerIndex + 1] || [];
  const currentIndex = header.findIndex((value) => value.toLowerCase() === "tw elec");
  const gasIndex = header.findIndex((value) => value.toLowerCase() === "tw gas");
  const lastIndex = header.findIndex((value) => value.toLowerCase() === "lw elec");
  const twoIndex = header.findIndex((value) => value.toLowerCase() === "lw2 elec");
  const partialIndexes = detail.map((value, index) => String(value || "").trim().toLowerCase() === "p" && index < currentIndex ? index : -1).filter((index) => index >= 0);
  return rows.slice(headerIndex + 2).flatMap((row) => {
    const repName = String(row[0] || "").trim();
    if (/^--/.test(repName) || /(?:team|total)s?$/i.test(repName)) return [];
    const keys = nameKeys(repName);
    if (!keys.length) return [];
    const partials = partialIndexes.reduce((sum, index) => sum + number(row[index]), 0);
    const electric = currentIndex >= 0 ? number(row[currentIndex]) : 0;
    const gas = gasIndex >= 0 ? number(row[gasIndex]) : 0;
    const production = (electric + partials) * 40 + gas * 18;
    const lastWeek = lastIndex >= 0 && String(row[lastIndex] || "").trim() !== "" ? number(row[lastIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 && String(row[twoIndex] || "").trim() !== "" ? number(row[twoIndex]) : null;
    return [datedRecord({ repName: repName.replace(/[↓↑]/g, "").trim(), repType: String(row[1]||"New Rep").trim(), keys, aliases: nameAliases(repName), current: production, electric, gas, production, lastWeek, twoWeeksAgo, overall: production, partials, sourceFile: fileName },row,3,fileName)];
  });
}

function parseStandardLog(rows, fileName) {
  const headerIndex = rows.findIndex((row) => row.some((value) => /^prev\.?\s*week/i.test(String(value || "").trim())));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((value) => String(value || "").trim());
  const electricIndexes = header.map((value, index) => /^electric$/i.test(value) ? index : -1).filter((index) => index >= 0);
  const partialIndexes = header.map((value, index) => /^partials?$/i.test(value) ? index : -1).filter((index) => index >= 0);
  const totalElectricIndex = electricIndexes.at(-1);
  const gasIndexes = header.map((value, index) => /^gas$/i.test(value) ? index : -1).filter((index) => index >= 0);
  const totalGasIndex = gasIndexes.at(-1);
  const prevIndex = header.findIndex((value) => /^prev\.?\s*week/i.test(value));
  const twoIndex = header.findIndex((value) => /^2\s*wk/i.test(value));
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const repName = String(row[0] || "").trim();
    if (/^--/.test(repName) || /(?:team|total)s?$/i.test(repName)) return [];
    const keys = nameKeys(repName);
    if (!keys.length) return [];
    const partials = partialIndexes.filter((index) => index < totalElectricIndex).reduce((sum, index) => sum + number(row[index]), 0);
    const electric = Number.isInteger(totalElectricIndex) ? number(row[totalElectricIndex]) : 0;
    const gas = Number.isInteger(totalGasIndex) ? number(row[totalGasIndex]) : 0;
    const production = (electric + partials) * 40 + gas * 18;
    const lastWeek = prevIndex >= 0 ? weeklyElectric(row[prevIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 ? weeklyElectric(row[twoIndex]) : null;
    return [datedRecord({ repName, keys, aliases: nameAliases(repName), current: production, electric, gas, production, lastWeek, twoWeeksAgo, overall: production, partials, sourceFile: fileName },row,1,fileName)];
  });
}

export function getProductionLogRecords() {
  if (!fs.existsSync(productionDir)) return [];
  // Stores intentionally use TSV production logs only. Do not fall back to
  // CSV files, WorkMyT data, or stored app performance.
  const files = fs.readdirSync(productionDir).filter((name) => name.toLowerCase().endsWith(".tsv")).sort();
  return files.flatMap((fileName) => {
    const rows = parseDelimited(fs.readFileSync(path.join(productionDir, fileName), "utf8").replace(/^\uFEFF/, ""), "\t");
    return productionOffice(fileName)==="CANYON TUMAN" ? parseNoctisLog(rows,fileName) : rows.some((row) => String(row[0] || "").trim().toLowerCase() === "rep name")
      ? parseAiLog(rows, fileName)
      : parseStandardLog(rows, fileName);
  });
}

export function attachProductionLogs(agents = []) {
  const records = getProductionLogRecords();
  const byName = new Map();
  const aliasBuckets = new Map();
  for (const record of records) for (const key of record.keys) {
    const existing = byName.get(`${productionOffice(record.sourceFile)}|${key}`);
    if (!existing || String(record.lastDay?.date||"") > String(existing.lastDay?.date||"")) byName.set(`${productionOffice(record.sourceFile)}|${key}`, record);
  }
  for (const record of records) for (const alias of record.aliases || []) {
    if (!aliasBuckets.has(alias)) aliasBuckets.set(alias, []);
    aliasBuckets.get(alias).push(record);
  }
  const uniqueAliases = new Map([...aliasBuckets].flatMap(([alias,matches])=>{
    const byOffice=new Map();for(const r of matches){const office=productionOffice(r.sourceFile);const old=byOffice.get(office);if(!old||String(r.lastDay?.date||"")>String(old.lastDay?.date||""))byOffice.set(office,r);}
    return [...byOffice].map(([office,record])=>[`${office}|${alias}`,record]);
  }));
  return agents.map((agent) => {
    const record = nameKeys(agent.repName).map((key) => byName.get(`${canonicalOffice(agent.office)}|${key}`)).find(Boolean) || nameAliases(agent.repName).map((key) => uniqueAliases.get(`${canonicalOffice(agent.office)}|${key}`)).find(Boolean);
    return { ...agent, productionLog: record ? {
      current: record.current,
      electric: record.electric,
      gas: record.gas,
      production: record.production,
      lastWeek: record.lastWeek,
      twoWeeksAgo: record.twoWeeksAgo,
      overall: record.overall,
      partials: record.partials,
      sourceFile: record.sourceFile,
      lastDay:record.lastDay,
    } : { current: 0, electric: 0, gas: 0, production: 0, lastWeek: null, twoWeeksAgo: null, overall: 0, partials: 0, sourceFile: "" } };
  });
}

// Each input file belongs to exactly one office; no guessed default to Mehta.
export function productionOffice(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.includes("skye")) return "COLLIN WILLHELM";
  if (name.includes("evans") || name.includes("edmeston")) return "KEASEL BROOM";
  if (name.includes("noctis")) return "CANYON TUMAN";
  if (name.includes("ai production") || name.includes("ai_production")) return "MADHAV MEHTA";
  return null;
}
export function productionRepDirectory() {
  const byKey = new Map();
  for (const record of getProductionLogRecords()) {
    const office = productionOffice(record.sourceFile);
    if (!office) continue;
    const rawName = String(record.repName || "").replace(/\s*\((PL|L|OWNER|TRAINER)\)\s*$/i, "").trim();
    const repName = rawName.includes(",") ? rawName.split(",").slice(1).join(",").trim()+" "+rawName.split(",")[0].trim() : rawName;
    if (!repName) continue;
    const key = `${office}|${nameKeys(repName).at(-1) || repName.toLowerCase()}`;
    const entry = { ...record, office, repName,
      repKey: `prod-${crypto.createHash("sha256").update(key).digest("hex").slice(0,24)}`,
      repType: record.repType || "New Rep", team: "", teamLead: "", trainer: "", attendance: "in",
      productionLog: {current:record.current, electric:record.electric,gas:record.gas,
        production:record.production,lastDay:record.lastDay,sourceFile:record.sourceFile}
    };
    const prior=byKey.get(key);
    if (!prior || String(record.lastDay?.date||"") > String(prior.lastDay?.date||"") || (!prior.lastDay && !record.lastDay && String(record.sourceFile)>String(prior.sourceFile))) byKey.set(key,entry);
  }
  return [...byKey.values()];
}
export function expandAgentsFromProduction(agents = []) {
  const normalized = value=>nameKeys(value).at(-1) || String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const existing = new Set(agents.map(a=>`${canonicalOffice(a.office)}|${normalized(a.repName)}`));
  const discovered = productionRepDirectory().filter(rep=>!existing.has(`${rep.office}|${normalized(rep.repName)}`));
  return [...agents,...discovered];
}
