import crypto from "node:crypto";
import { canonicalOffice } from "../offices.mjs";
let productionRecords = [];
export function setProductionLogRecords(records) { productionRecords = records; }

function number(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function weeklyElectric(value) {
  const match = String(value ?? "").trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*\/.*)?$/);
  return match ? Number(match[1]) : null;
}

function weeklyGasPair(value) {
  const match = String(value ?? "").trim().match(/^\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)$/);
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
  const match = String(fileName).match(/(\d{1,2})[._-](\d{1,2})(?:[._-](\d{2,4}))?(?=\.(?:tsv|sheet)$)/i);
  if (!match) return null;
  const year = Number(match[3] || 2026);
  const date = new Date(Date.UTC(year < 100 ? 2000 + year : year, Number(match[1])-1, Number(match[2])));
  return Number.isNaN(date.getTime()) ? null : date;
}
// Work/Store last worked dates come ONLY from dated production-log E/G cells.
// An explicit 0 is a worked day; x means absent; an empty cell is unknown.
function dailyResult(row, start, fileName) {
  const weekEnd = fileWeekEnd(fileName);
  if (!weekEnd) return null;
  let latest = null;
  for (let day = 0; day < 7; day += 1) {
    const values = row.slice(start + day * 3, start + day * 3 + 3)
      .map(value => String(value ?? "").trim());
    const [rawE = "", rawG = "", rawP = ""] = values;
    // E or G must be explicitly recorded. Partial-only columns do not imply
    // a worked day; neither do WorkMyT entries or weekly summary columns.
    const isRecordedNumber = value => value !== "" &&
      /^-?\d+(?:\.\d+)?$/.test(value.replace(/,/g, ""));
    if (!isRecordedNumber(rawE) && !isRecordedNumber(rawG)) continue;
    const electric = isRecordedNumber(rawE) ? number(rawE) : 0;
    const gas = isRecordedNumber(rawG) ? number(rawG) : 0;
    const partials = isRecordedNumber(rawP) ? number(rawP) : 0;
    const date = new Date(weekEnd.getTime() - (6 - day) * 86400000)
      .toISOString().slice(0, 10);
    latest = {date, electric, gas, partials,
      production: (electric + partials) * 40 + gas * 18,
      source: "production-log"};
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
    const e=totalE>=0?weeklyElectric(row[totalE]):null,g=totalG>=0?number(row[totalG]):0;
    return [{repName,repType:/\((?:PL|L|OWNER)\)\s*$/i.test(raw)?"Leader":"New Rep",keys,aliases:nameAliases(repName),sourceFile:fileName,lastWeek:weeklyElectric(row[header.findIndex(x=>/^LW T El$/i.test(String(x||"")))]),twoWeeksAgo:null,
      lastDay,electric:lastDay?.electric||0,gas:lastDay?.gas||0,partials:lastDay?.partials||0,
      current:lastDay?.production||0,overall:lastDay?.production||0,production:lastDay?.production||0,
      weekElectric:e,weekGas:totalG>=0?weeklyElectric(row[totalG]):null,lastWeekGas:weeklyElectric(row[header.findIndex(x=>/^LW T Gas$/i.test(String(x||"")))])}];
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
    const lastWeek = lastIndex >= 0 && String(row[lastIndex] || "").trim() !== "" ? weeklyElectric(row[lastIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 && String(row[twoIndex] || "").trim() !== "" ? number(row[twoIndex]) : null;
    return [datedRecord({ repName: repName.replace(/[↓↑]/g, "").trim(), repType: String(row[1]||"New Rep").trim(), keys, aliases: nameAliases(repName), current: production, electric, gas, production, lastWeek, twoWeeksAgo, overall: production, partials, sourceFile: fileName, weekElectric: currentIndex >= 0 ? weeklyElectric(row[currentIndex]) : null, weekGas:gasIndex>=0?weeklyElectric(row[gasIndex]):null, lastWeekGas:weeklyElectric(row[header.findIndex(value=>value.toLowerCase()==="lw gas")]) },row,3,fileName)];
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
    return [datedRecord({ repName, keys, aliases: nameAliases(repName), current: production, electric, gas, production, lastWeek, twoWeeksAgo, overall: production, partials, sourceFile: fileName, weekElectric: Number.isInteger(totalElectricIndex) ? weeklyElectric(row[totalElectricIndex]) : null, weekGas:Number.isInteger(totalGasIndex)?weeklyElectric(row[totalGasIndex]):null, lastWeekGas:prevIndex>=0?weeklyGasPair(row[prevIndex]):null },row,1,fileName)];
  });
}

export function getProductionLogRecords() { return productionRecords; }

export function parseProductionRows(rows, fileName) {
  const parsed = productionOffice(fileName)==="CANYON TUMAN" ? parseNoctisLog(rows,fileName) : rows.some(row=>String(row[0]||"").trim().toLowerCase()==="rep name") ? parseAiLog(rows,fileName) : parseStandardLog(rows,fileName);
  const ai=rows.some(row=>String(row[0]||"").trim().toLowerCase()==="rep name");
  const start=ai?3:1;
  const weekEnd=fileWeekEnd(fileName);
  return parsed.filter(record=>isProductionRepName(record.repName.replace(/[↑↓]/g,""))).map(record=>{
    const row=rows.find(row=>nameKeys(row[0]).some(key=>record.keys.includes(key)));
    const days=[];
    if(row && weekEnd) for(let day=0;day<7;day++){
      const [e,g,p]=row.slice(start+day*3,start+day*3+3).map(value=>String(value??"").trim());
      const numeric=value=>value!=="" && /^-?\d+(?:\.\d+)?$/.test(value.replace(/,/g,""));
      const worked=numeric(e)||numeric(g), absent=/^x$/i.test(e)||/^x$/i.test(g);
      if(!worked&&!absent)continue;
      const electric=numeric(e)?number(e):0,gas=numeric(g)?number(g):0,partials=numeric(p)?number(p):0;
      days.push({date:new Date(weekEnd.getTime()-(6-day)*86400000).toISOString().slice(0,10),worked,electric,gas,partials,production:worked?(electric+partials)*40+gas*18:0});
    }
    return {...record,days};
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
// Restrictive identity check. Production sheets include decorative labels and KPIs.
export function isProductionRepName(value) {
  const name = String(value || "").replace(/\s*\((?:PL|L|OWNER|TRAINER)\)\s*$/i, "").trim();
  if (!name || name.length > 70 || /[\d:%📊]/u.test(name)) return false;
  if (/^(?:roll\s*call|notes?|bonus(?:es|'?s)?(?:\s*\/\s*notes?)?|standards?\s+raised|championship|agents?\s+working|gas\s+attach|rep\s+name\s+colou?rs?|daily\s+metrics|totals?|team|office|average|legend|key)\b/i.test(name)) return false;
  if (/\b(?:notes?|metrics?|bonus|legend|colou?rs?|attach|percentage|summary|standard|quota|goals?)\b/i.test(name)) return false;
  // Names may contain hyphens/apostrophes but should be 2-5 name words.
  const words = name.replace(/[,.'’\-]/g," ").split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 && words.every(w=>/^[A-Za-zÀ-ÿ]{2,}$/.test(w));
}

export function productionRepDirectory() {
  const byKey = new Map();
  for (const record of getProductionLogRecords()) {
    const office = productionOffice(record.sourceFile);
    if (!office) continue;
    const rawName = String(record.repName || "").replace(/\s*\((PL|L|OWNER|TRAINER)\)\s*$/i, "").trim();
    const repName = rawName.includes(",") ? rawName.split(",").slice(1).join(",").trim()+" "+rawName.split(",")[0].trim() : rawName;
    // Production sheets contain notes and summary headings that are not agents.
    if (!isProductionRepName(repName)) continue;
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
// Attendance/Agents is authoritative for role, team, trainer, and attendance.
// Production logs only supply newly discovered identities and production metrics.
export function expandAgentsFromProduction(agents = []) {
  const existing = new Set();
  const identities = (rep) => nameKeys(rep.repName)
    .map((key) => `${canonicalOffice(rep.office)}|${key}`);
  for (const agent of agents) for (const key of identities(agent)) existing.add(key);

  const discovered = [];
  for (const rep of productionRepDirectory()) {
    const keys = identities(rep);
    if (!keys.length || keys.some((key) => existing.has(key))) continue;
    discovered.push({
      repKey: rep.repKey,
      repName: rep.repName,
      office: canonicalOffice(rep.office),
      repType: "New Rep", // provisional only; never replace existing Attendance roles
      team: "", teamLead: "", trainer: "", attendance: "in",
      experienceLevel: "",
      productionLog: rep.productionLog,
    });
    for (const key of keys) existing.add(key);
  }
  // Existing Agents objects are retained untouched, in their original order.
  return [...agents, ...discovered];
}

// Training eligibility always uses a finished Sunday-Saturday week. A new
// Monday log supplies current progress, never a replacement eligibility total.
export function attachTrainingProduction(agents = [], today = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()), records = getProductionLogRecords()) {
  const date = new Date(`${today}T12:00:00Z`);
  const previousEnd = new Date(date.getTime() - (date.getUTCDay() + 1) * 86400000).toISOString().slice(0,10);
  const currentEnd = new Date(new Date(`${previousEnd}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0,10);
  const dated = records.map(record => ({...record, weekEnd:fileWeekEnd(record.sourceFile)?.toISOString().slice(0,10)})).filter(record => record.weekEnd);
  return agents.map(agent => {
    const officeRecords = dated.filter(record => productionOffice(record.sourceFile) === canonicalOffice(agent.office));
    const keys = nameKeys(agent.repName);
    const matching = officeRecords.filter(record => record.keys.some(key => keys.includes(key)));
    const current = matching.find(record => record.weekEnd === currentEnd);
    // Choose the office's week, not a different old week for each missing rep.
    const availableEnd = officeRecords.filter(record => record.weekEnd <= previousEnd).map(record => record.weekEnd).sort().at(-1);
    const weekEnd = officeRecords.some(record => record.weekEnd === previousEnd) || officeRecords.some(record => record.weekEnd === currentEnd) ? previousEnd : availableEnd || previousEnd;
    const completed = matching.find(record => record.weekEnd === weekEnd && record.weekElectric != null);
    const useCurrentHistory = !completed && weekEnd === previousEnd && current?.lastWeek != null;
    const electric = completed?.weekElectric ?? (useCurrentHistory ? current.lastWeek : null);
    const gas = completed ? completed.weekGas ?? null : useCurrentHistory ? current.lastWeekGas ?? null : null;
    const currentWeekElectric=current?.weekElectric ?? null, currentWeekGas=current?.weekGas ?? null;
    const production=electric!==null&&gas!==null?electric*40+gas*18:null;
    const currentWeekProduction=currentWeekElectric!==null&&currentWeekGas!==null?currentWeekElectric*40+currentWeekGas*18:null;
    return {...agent, trainingProduction:{electric,gas,production,sourceFile:completed?.sourceFile || (useCurrentHistory ? current.sourceFile : ""),weekEnd,
      currentWeekElectric,currentWeekGas,currentWeekProduction,currentWeekEnd:currentEnd,currentSourceFile:current?.sourceFile || ""}};
  });
}
