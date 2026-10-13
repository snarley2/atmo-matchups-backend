import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {google} from "googleapis";
import pg from "pg";
import {PRODUCTION_SOURCES} from "../production-sources.mjs";
import {parseProductionRows,setProductionLogRecords} from "./production-csv.mjs";

let pool, schemaReady, refreshPromise, importedAt=0, inFlight;
const LOCK="atmo-production-import";
export const easternDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function database(){
  if(!process.env.SUPABASE_DB_URL)throw new Error("Missing SUPABASE_DB_URL");
  return pool ||= new pg.Pool({connectionString:process.env.SUPABASE_DB_URL,ssl:process.env.SUPABASE_DB_SSL==="false"?false:{rejectUnauthorized:process.env.SUPABASE_DB_SSL_VERIFY==="true"}});
}
async function ensureSchema(){
  if(!schemaReady)schemaReady=fs.readFile(new URL("../supabase/production.sql",import.meta.url),"utf8").then(sql=>database().query(sql)).catch(error=>{schemaReady=null;throw error});
  return schemaReady;
}
// Compact titles include 101726, 1017 and 103. Saturday validation and the
// current-week upper bound distinguish them from old tabs from other years.
export function productionWeekEnd(title,today=easternDate()){
  const date=new Date(`${today}T12:00:00Z`);
  const upper=new Date(date.getTime()+(6-date.getUTCDay())*86400000).toISOString().slice(0,10);
  const year=date.getUTCFullYear();
  const candidates=[];
  const add=(month,day,y)=>{
    y=Number(y);if(y<100)y+=2000;
    const d=new Date(Date.UTC(y,Number(month)-1,Number(day),12));
    if(d.getUTCFullYear()!==y||d.getUTCMonth()!==Number(month)-1||d.getUTCDate()!==Number(day)||d.getUTCDay()!==6)return;
    const iso=d.toISOString().slice(0,10);
    if(iso<=upper&&d>=new Date(`${year-2}-01-01T00:00:00Z`))candidates.push(iso);
  };
  const text=String(title).trim();
  const separated=text.match(/^(\d{1,2})[./_-](\d{1,2})(?:[./_-](\d{2}|\d{4}))?$/);
  if(separated){const [,m,d,y]=separated;for(const yy of y?[y]:[year,year-1,year-2])add(m,d,yy);}
  else if(/^\d{3,6}$/.test(text)){
    for(const ml of [1,2])for(const dl of [1,2]){
      if(ml+dl===text.length)for(const yy of [year,year-1,year-2])add(text.slice(0,ml),text.slice(ml),yy);
      if(ml+dl+2===text.length)add(text.slice(0,ml),text.slice(ml,ml+dl),text.slice(-2));
    }
  }
  return candidates.sort().at(-1)||null;
}
export function selectProductionTabs(sheets,today){
  const tabs=sheets.map(sheet=>({...sheet.properties,weekEnd:productionWeekEnd(sheet.properties.title,today)})).filter(tab=>tab.weekEnd).sort((a,b)=>b.weekEnd.localeCompare(a.weekEnd));
  const weeks=new Set();return tabs.filter(tab=>{if(weeks.has(tab.weekEnd))return false;weeks.add(tab.weekEnd);return true}).slice(0,2);
}
function sheetsClient(){
  const keyFile=process.env.GOOGLE_SERVICE_ACCOUNT_FILE||process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentials=raw?JSON.parse(raw):process.env.GOOGLE_CLIENT_EMAIL&&process.env.GOOGLE_PRIVATE_KEY?{client_email:process.env.GOOGLE_CLIENT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,"\n")}:undefined;
  if(!keyFile&&!credentials)throw new Error("Production imports require a Google service account with read access to the four production workbooks");
  const auth=new google.auth.GoogleAuth({...keyFile?{keyFile:path.resolve(keyFile)}:{credentials},scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]});
  return google.sheets({version:"v4",auth});
}
export async function fetchProductionSnapshots(client,today=easternDate()){
  const snapshots=[];
  for(const source of PRODUCTION_SOURCES){
    const book=await client.spreadsheets.get({spreadsheetId:source.spreadsheetId,fields:"sheets.properties"},{timeout:30000});
    const tabs=selectProductionTabs(book.data.sheets||[],today);
    if(!tabs.length)throw new Error(`${source.office}: no dated Saturday production tabs found`);
    for(const tab of tabs){
      const range=`'${tab.title.replace(/'/g,"''")}'!A:AZ`;
      const response=await client.spreadsheets.values.get({spreadsheetId:source.spreadsheetId,range,valueRenderOption:"UNFORMATTED_VALUE"},{timeout:30000});
      const rows=response.data.values||[];
      const fileName=`${source.prefix} - ${tab.weekEnd.slice(5,7)}.${tab.weekEnd.slice(8,10)}.${tab.weekEnd.slice(0,4)}.sheet`;
      const records=parseProductionRows(rows,fileName);
      if(!records.length)throw new Error(`${source.office} / ${tab.title}: no valid reps found; keeping stored production`);
      snapshots.push({...source,...tab,rows,records});
    }
  }
  return snapshots;
}
function repIdentity(office,record){return "prod-"+crypto.createHash("sha256").update(`${office}|${record.keys.at(-1)}`).digest("hex").slice(0,24);}
export async function saveProductionSnapshots(connection,snapshots){
  await connection.query("BEGIN");
  try{
    for(const snapshot of snapshots){
      const {office,weekEnd,spreadsheetId,sheetId,title,rows,records}=snapshot;
      await connection.query(`INSERT INTO public.production_weeks(office,week_end,spreadsheet_id,gid,source_title,raw_rows,records)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(office,week_end) DO UPDATE SET
        spreadsheet_id=excluded.spreadsheet_id,gid=excluded.gid,source_title=excluded.source_title,raw_rows=excluded.raw_rows,records=excluded.records,imported_at=now()`,[office,weekEnd,spreadsheetId,sheetId,title,JSON.stringify(rows),JSON.stringify(records)]);
      await connection.query("DELETE FROM public.production_weekly_reps WHERE office=$1 AND week_end=$2",[office,weekEnd]);
      await connection.query("DELETE FROM public.production_days WHERE office=$1 AND work_date BETWEEN $2::date - 6 AND $2::date",[office,weekEnd]);
      for(const record of records){
        const repKey=repIdentity(office,record), name=record.repName.replace(/[↑↓]/g,"").trim();
        const electric=record.weekElectric??null,gas=record.weekGas??null,production=electric!==null&&gas!==null?electric*40+gas*18:null;
        await connection.query("INSERT INTO public.production_weekly_reps(office,rep_key,rep_name,week_end,electric,gas,production) VALUES($1,$2,$3,$4,$5,$6,$7)",[office,repKey,name,weekEnd,electric,gas,production]);
        for(const day of record.days||[])await connection.query("INSERT INTO public.production_days(office,rep_key,rep_name,work_date,worked,electric,gas,partials,production) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[office,repKey,name,day.date,day.worked,day.electric,day.gas,day.partials,day.production]);
      }
    }
    await connection.query("COMMIT");
  }catch(error){await connection.query("ROLLBACK");throw error;}
}
export async function refreshProductionCache(force=false){
  if(!force&&Date.now()-importedAt<60000)return;
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    await ensureSchema();
    const result=await database().query("SELECT records FROM public.production_weeks ORDER BY week_end DESC,office");
    setProductionLogRecords(result.rows.flatMap(row=>row.records));importedAt=Date.now();
  })().finally(()=>{refreshPromise=null});return refreshPromise;
}
export async function importProductionSheets(){
  if(inFlight)return {skipped:true,reason:"already running"};
  inFlight=true;let connection,locked=false;
  try{
    await ensureSchema();connection=await database().connect();
    const result=await connection.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked",[LOCK]);locked=result.rows[0].locked;
    if(!locked)return {skipped:true,reason:"another server is importing"};
    const snapshots=await fetchProductionSnapshots(sheetsClient());
    await saveProductionSnapshots(connection,snapshots);await refreshProductionCache(true);
    console.log(`[production-import] Stored ${snapshots.length} office/week snapshots in Supabase`);
    return {success:true,weeks:snapshots.length,reps:snapshots.reduce((sum,snapshot)=>sum+snapshot.records.length,0)};
  }finally{
    if(locked)await connection.query("SELECT pg_advisory_unlock(hashtext($1))",[LOCK]).catch(()=>{});
    connection?.release();inFlight=false;
  }
}
export async function closeProductionDatabase(){if(pool)await pool.end();pool=undefined;schemaReady=null;importedAt=0;}
