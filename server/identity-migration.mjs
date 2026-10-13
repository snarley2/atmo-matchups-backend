import crypto from "node:crypto";
import {canonicalOffice} from "../offices.mjs";
import {normalizeRepId,validRepId,uniqueNameMatch} from "./rep-identity.mjs";

// Only identity columns/references are rewritten. Manual Attendance fields are
// copied unchanged, including trainer, team, attendance and readiness.
export function migrateIdentityRows(tabs,records){
 const clones=tabs.map(tab=>({...tab,rows:structuredClone(tab.rows)}));
 const agents=clones.find(tab=>tab.title===(process.env.AGENTS_SHEET_NAME||"Agents"));
 if(!agents?.rows.length)throw new Error("Agents must be populated before converting rep IDs.");
 const headers=agents.rows[0],keyCol=headers.indexOf("repKey"),nameCol=headers.indexOf("repName"),officeCol=headers.indexOf("office");
 if(keyCol<0||nameCol<0||officeCol<0)throw new Error("Agents identity headers are missing; refusing conversion.");
 const byId=new Map(),duplicateIds=new Set();
 for(const record of records){
  if(!validRepId(record.repId)||!record.office)continue;
  const key=`${canonicalOffice(record.office)}|${normalizeRepId(record.repId)}`;
  const old=byId.get(key);
  if(old&&!uniqueNameMatch([old],record.repName))duplicateIds.add(key);
  if(!old||String(record.weekEnd||"")>String(old.weekEnd||""))byId.set(key,record);
 }
 const aliases=[],warnings=[];
 const claimedRows=new Set();
 for(const [identityKey,record] of [...byId].sort((a,b)=>String(b[1].weekEnd||"").localeCompare(String(a[1].weekEnd||"")))){
  if(duplicateIds.has(identityKey)){warnings.push(`${record.office}: duplicate production ID; no identity changed`);continue;}
  const office=canonicalOffice(record.office),repId=normalizeRepId(record.repId);
  const officeRows=agents.rows.slice(1).filter(row=>canonicalOffice(row[officeCol])===office);
  const existing=officeRows.find(row=>normalizeRepId(row[keyCol])===repId);
  const matched=existing||uniqueNameMatch(officeRows,record.repName,row=>row[nameCol]);
  const matchingCount=officeRows.filter(row=>uniqueNameMatch([row],record.repName,r=>r[nameCol])).length;
  if(!matched&&matchingCount){warnings.push(`${office}: ambiguous identity for ${record.repName}; no identity changed`);continue;}
  if(matched&&claimedRows.has(matched))continue;
  if(matched){
   claimedRows.add(matched);
   const oldKey=String(matched[keyCol]);
   if(oldKey!==repId){aliases.push({office,oldKey,repId});matched[keyCol]=repId;}
  }else{
   const data={repKey:repId,repName:record.repName,office,repType:record.repType||"New Rep",team:"",teamLead:"",trainer:"",attendance:"in",experienceLevel:"Newer"};
   agents.rows.push(headers.map(header=>data[header]??""));
  }
  const oldProdKey="prod-"+crypto.createHash("sha256").update(`${office}|${record.keys?.at(-1)||""}`).digest("hex").slice(0,24);
  aliases.push({office,oldKey:oldProdKey,repId});
 }
 const replacements=new Map(aliases.map(alias=>[alias.oldKey,alias.repId]));
 const rewrite=value=>{
  if(Array.isArray(value))return value.map(rewrite);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,rewrite(v)]));
  if(typeof value!=="string")return value;
  if(replacements.has(value))return replacements.get(value);
  if(/^[\[{]/.test(value)){try{const parsed=JSON.parse(value),changed=rewrite(parsed);return JSON.stringify(parsed)===JSON.stringify(changed)?value:JSON.stringify(changed)}catch{}}
  return value;
 };
 for(const tab of clones)tab.rows=rewrite(tab.rows);
 return {tabs:clones,aliases,warnings};
}

export async function syncProductionIdentities(connection,records){
 await connection.query(`CREATE TABLE IF NOT EXISTS public.rep_id_aliases(office text NOT NULL,old_key text NOT NULL,rep_id text NOT NULL,PRIMARY KEY(office,old_key));
 ALTER TABLE public.rep_id_aliases ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.rep_id_aliases FROM anon,authenticated;`);
 await connection.query("BEGIN");
 try{
  await connection.query("SELECT pg_advisory_xact_lock(hashtext('atmo-rep-identity-migration'))");
  const result=await connection.query("SELECT title,rows FROM public.project_tabs ORDER BY title FOR UPDATE");
  const migrated=migrateIdentityRows(result.rows,records);
  for(const tab of migrated.tabs){const old=result.rows.find(row=>row.title===tab.title);if(JSON.stringify(old.rows)!==JSON.stringify(tab.rows))await connection.query("UPDATE public.project_tabs SET rows=$2::jsonb,revision=revision+1,updated_at=now() WHERE title=$1",[tab.title,JSON.stringify(tab.rows)]);}
  const definitions=[
   {table:"rep_store_preferences",columns:"office,rep_key,store_ids,updated_at",tail:"store_ids,updated_at"},
   {table:"coaching_rep_methods",columns:"office,rep_key,method_id,implemented,updated_at,updated_by",tail:"method_id,implemented,updated_at,updated_by"},
   {table:"production_weekly_reps",columns:"office,rep_key,rep_name,week_end,electric,gas,production,imported_at",tail:"rep_name,week_end,electric,gas,production,imported_at"},
   {table:"production_days",columns:"office,rep_key,rep_name,work_date,worked,electric,gas,partials,production,imported_at",tail:"rep_name,work_date,worked,electric,gas,partials,production,imported_at"},
  ];
  const present=new Set();for(const def of definitions){const check=await connection.query("SELECT to_regclass($1) AS name",[`public.${def.table}`]);if(check.rows[0].name)present.add(def.table);}
  for(const alias of migrated.aliases){
   if(alias.oldKey===alias.repId)continue;
   await connection.query("INSERT INTO public.rep_id_aliases(office,old_key,rep_id) VALUES($1,$2,$3) ON CONFLICT(office,old_key) DO UPDATE SET rep_id=excluded.rep_id",[alias.office,alias.oldKey,alias.repId]);
   for(const def of definitions)if(present.has(def.table)){
    await connection.query(`INSERT INTO public.${def.table}(${def.columns}) SELECT office,$3,${def.tail} FROM public.${def.table} WHERE office=$1 AND rep_key=$2 ${def.table==="coaching_rep_methods"?"ON CONFLICT(office,rep_key,method_id) DO UPDATE SET implemented=excluded.implemented,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE excluded.updated_at>coaching_rep_methods.updated_at":"ON CONFLICT DO NOTHING"}`,[alias.office,alias.oldKey,alias.repId]);
    await connection.query(`DELETE FROM public.${def.table} WHERE office=$1 AND rep_key=$2`,[alias.office,alias.oldKey]);
   }
  }
  await connection.query("COMMIT");for(const warning of migrated.warnings)console.warn("[rep-identity]",warning);return migrated;
 }catch(error){await connection.query("ROLLBACK");throw error;}
}
