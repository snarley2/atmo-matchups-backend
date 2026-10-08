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
    .replace(/\s*\((?:PL|L|Owner|Trainer|Manager|Rep)\)\s*$/i, "")
    .replace(/^--|--$/g, "")
    .trim();
  if (!clean || /team\s*$/i.test(clean) || /(?:daily|weekly|office)?\s*totals?$/i.test(clean)) return [];
  const normalize = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = [normalize(clean)];
  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    keys.push(normalize(`${rest.join(" ")} ${last}`));
  }
  return [...new Set(keys.filter(Boolean))];
}

function nameAliases(value) {
  let clean = String(value || "").replace(/[↓↑]/g, "").replace(/\s*\((?:PL|L|Owner|Trainer|Manager|Rep)\)\s*$/i, "").trim();
  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    clean = `${rest.join(" ")} ${last}`.trim();
  }
  const words = clean.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return [];
  const first = words[0], last = words.at(-1);
  return [...new Set([first, words.length > 1 ? `${first}${last[0]}` : "", words.length > 1 ? `${first[0]}${last}` : ""].filter(Boolean))];
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
    const keys = nameKeys(repName);
    if (!keys.length) return [];
    const partials = partialIndexes.reduce((sum, index) => sum + number(row[index]), 0);
    const electric = currentIndex >= 0 ? number(row[currentIndex]) : 0;
    const gas = gasIndex >= 0 ? number(row[gasIndex]) : 0;
    const production = (electric + partials) * 40 + gas * 18;
    const lastWeek = lastIndex >= 0 && String(row[lastIndex] || "").trim() !== "" ? number(row[lastIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 && String(row[twoIndex] || "").trim() !== "" ? number(row[twoIndex]) : null;
    return [{ repName: repName.replace(/[↓↑]/g, "").trim(), keys, aliases: nameAliases(repName), current: production, electric, gas, production, lastWeek, twoWeeksAgo, overall: production, partials, sourceFile: fileName }];
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
    const keys = nameKeys(repName);
    if (!keys.length) return [];
    const partials = partialIndexes.filter((index) => index < totalElectricIndex).reduce((sum, index) => sum + number(row[index]), 0);
    const electric = Number.isInteger(totalElectricIndex) ? number(row[totalElectricIndex]) : 0;
    const gas = Number.isInteger(totalGasIndex) ? number(row[totalGasIndex]) : 0;
    const production = (electric + partials) * 40 + gas * 18;
    const lastWeek = prevIndex >= 0 ? weeklyElectric(row[prevIndex]) : null;
    const twoWeeksAgo = twoIndex >= 0 ? weeklyElectric(row[twoIndex]) : null;
    return [{ repName, keys, aliases: nameAliases(repName), current: production, electric, gas, production, lastWeek, twoWeeksAgo, overall: production, partials, sourceFile: fileName }];
  });
}

// Dated daily production, separate from weekly totals. Empty/X cells are not worked;
// a numeric zero IS worked. The latest valid day wins, not the largest sale total.
function dailyDates(rows, fileName) {
  const year = Number(fileName.match(/20\d{2}/)?.[0]) || 2026;
  const monthNumbers = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  let month = null;
  const weekRange = rows.slice(0, 8).map(row => row.join(' ')).join(' ').match(/Week of\s+([A-Za-z]+)\s+\d+/i);
  if (weekRange) month = monthNumbers[weekRange[1].slice(0,3).toLowerCase()] || null;
  for (const row of rows.slice(0, 9)) {
    const candidates = [];
    for (let i=1;i<row.length;i++) {
      const value=String(row[i]||'').trim();
      const full=value.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
      const short=value.match(/^(?:SUN|MON|TUE|WED|THU|THUR|FRI|SAT)\s+(\d{1,2})$/i);
      if (full) candidates.push({index:i, day:+full[2],month:monthNumbers[full[1].slice(0,3).toLowerCase()]});
      else if(short) candidates.push({index:i,day:+short[1],month:null});
    }
    if (candidates.length>=5) {
      // Noctis/AI day columns use weekday-only headings; anchor month from
      // the file's ending date and roll backward across month boundaries.
      const ending=fileName.match(/(\d{1,2})[._-](\d{1,2})(?:[._-](?:20)?\d{2})?\.tsv$/i);
      let currentMonth=month || (ending?+ending[1]:null);
      if (!currentMonth && ending) currentMonth=+ending[1];
      let previousDay=null;
      for (const c of candidates) {
        if(c.month) currentMonth=c.month;
        else if (previousDay!==null && c.day<previousDay) currentMonth=(currentMonth%12)+1;
        if(currentMonth) {
          const y = currentMonth===12 && c.day>20 && year===2026 ? year : year;
          c.date=`${y}-${String(currentMonth).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
        }
        previousDay=c.day;
      }
      return candidates.filter(c=>c.date);
    }
  }
  return [];
}

function dailyForRep(row, dates) {
  return dates.flatMap(({index,date})=>{
    const cells=row.slice(index,index+3).map(v=>String(v??'').trim());
    if(!cells.some(v=>v!=='' && !/^x$/i.test(v)))return [];
    // Only actual numbers indicate work. Never treat a comment or label as a sale.
    if(!cells.some(v=>/^-?\d+(?:\.\d+)?$/.test(v)))return [];
    const [electric,gas,partials]=cells.map(v=>/^-?\d+(?:\.\d+)?$/.test(v)?Number(v):0);
    return [{date,electric,gas,partials,production:(electric+partials)*40+gas*18}];
  }).sort((a,b)=>b.date.localeCompare(a.date));
}

function parseNoctisLog(rows, fileName) {
  const headerIndex=rows.findIndex(row=>row.some(value=>/^T Ele$/i.test(String(value||'').trim())));
  if(headerIndex<0)return [];
  const header=rows[headerIndex].map(value=>String(value||'').trim());
  const total=header.findIndex(value=>/^T Ele$/i.test(value));
  const gas=header.findIndex(value=>/^T Gas$/i.test(value));
  const previous=header.findIndex(value=>/^LW T El$/i.test(value));
  const two=header.findIndex(value=>/^LW2 T El$/i.test(value));
  return rows.slice(headerIndex+1).flatMap(row=>{
    const repName=String(row[0]||'').trim(), keys=nameKeys(repName);
    if(!keys.length||/^daily|^weekly|^total/i.test(repName))return [];
    const electric=number(row[total]),gasCount=number(row[gas]);
    return [{repName,keys,aliases:nameAliases(repName),current:electric*40+gasCount*18,electric,gas:gasCount,partials:0,production:electric*40+gasCount*18,lastWeek:previous>=0?weeklyElectric(row[previous]):null,twoWeeksAgo:two>=0?weeklyElectric(row[two]):null,overall:electric*40+gasCount*18,sourceFile:fileName}];
  });
}

export function getProductionLogRecords() {
  if (!fs.existsSync(productionDir)) return [];
  const files = fs.readdirSync(productionDir).filter(name=>name.toLowerCase().endsWith('.tsv')).sort();
  return files.flatMap(fileName=>{
    const rows=parseDelimited(fs.readFileSync(path.join(productionDir,fileName),'utf8').replace(/^\uFEFF/,''),'\t');
    const records=rows.some(row=>String(row[0]||'').trim().toLowerCase()==='rep name')
      ?parseAiLog(rows,fileName):rows.some(row=>row.some(value=>/^T Ele$/i.test(String(value||'').trim())))
      ?parseNoctisLog(rows,fileName):parseStandardLog(rows,fileName);
    const dates=dailyDates(rows,fileName);
    return records.map(record=>{
      const source=rows.find(row=>nameKeys(row[0]).some(k=>record.keys.includes(k)));
      const now = new Date();
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const oldest = new Date(`${today}T12:00:00Z`); oldest.setUTCDate(oldest.getUTCDate()-13);
      const min = oldest.toISOString().slice(0,10);
      return {...record,days:(source?dailyForRep(source,dates):[]).filter(day=>day.date>=min&&day.date<=today),lastDay:null};
    }).map(record=>({...record,lastDay:record.days[0]||null}));
  });
}

export function attachProductionLogs(agents = []) {
  const records=getProductionLogRecords();
  const byName=new Map(),aliasBuckets=new Map();
  for(const record of records) {
    for(const key of record.keys) {
      if(!byName.has(key))byName.set(key,[]);
      byName.get(key).push(record);
    }
    for(const alias of record.aliases||[]) {
      if(!aliasBuckets.has(alias))aliasBuckets.set(alias,[]);
      aliasBuckets.get(alias).push(record);
    }
  }
  const aliases=new Map([...aliasBuckets].filter(([,matches])=>new Set(matches.flatMap(record=>record.keys)).size===1));
  return agents.map(agent=>{
    const keys=nameKeys(agent.repName);
    const matches=keys.flatMap(key=>byName.get(key)||[]);
    const found=matches.length?matches:nameAliases(agent.repName).flatMap(alias=>aliases.get(alias)||[]);
    const unique=[...new Set(found)];
    const lastDay=unique.flatMap(record=>record.days||[]).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
    const latest=unique.sort((a,b)=>String(b.lastDay?.date||'').localeCompare(String(a.lastDay?.date||'')))[0];
    return {...agent,productionLog:{
      current:lastDay?.production??0,
      electric:lastDay?.electric??0,
      gas:lastDay?.gas??0,
      partials:lastDay?.partials??0,
      production:lastDay?.production??0,
      lastWorkedDate:lastDay?.date||'',
      lastDay:lastDay||null,
      lastWeek:latest?.lastWeek??null,
      twoWeeksAgo:latest?.twoWeeksAgo??null,
      overall:lastDay?.production??0,
      sourceFile:latest?.sourceFile||''
    }};
  });
}

// A searchable inventory of every distinct rep across all TSV production logs.
export function getProductionRepDirectory() {
  const byKey = new Map();
  for (const record of getProductionLogRecords()) {
    const key = record.keys.find(Boolean);
    if (!key) continue;
    const previous = byKey.get(key);
    if (!previous || String(record.lastDay?.date||"") > String(previous.lastDay?.date||"")) byKey.set(key, record);
  }
  return [...byKey.values()].map(record => ({ repName: record.repName, productionLog: record, sourceFile: record.sourceFile })).sort((a,b) => a.repName.localeCompare(b.repName));
}
