import crypto from 'node:crypto';
import {isProductionRepName} from './production-csv.mjs';
import {canonicalOffice} from '../offices.mjs';
import {normalizeRepId,validRepId,uniqueNameMatch} from './rep-identity.mjs';
// Agents own identity. Link a production ID without changing keys, offices,
// manual fields, board references, or the legacy alias table.
export function migrateIdentityRows(tabs,records){
 const clones=tabs.map(tab=>({...tab,rows:structuredClone(tab.rows)}));
 const agents=clones.find(tab=>tab.title===(process.env.AGENTS_SHEET_NAME||'Agents'));
 if(!agents?.rows.length)throw new Error('Agents must be populated before linking rep IDs.');
 const h=agents.rows[0],key=h.indexOf('repKey'),name=h.indexOf('repName'),office=h.indexOf('office');
 if([key,name,office].some(i=>i<0))throw new Error('Agents identity headers are missing.');
 let id=h.indexOf('rep_id');if(id<0){id=h.length;h.push('rep_id')}
 const warnings=[];
 const owners=new Map();for(const record of records){if(!validRepId(record.repId)||!record.office)continue;const id=normalizeRepId(record.repId);if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(canonicalOffice(record.office))}
 const original=agents.rows.slice(1);
 agents.rows=[h,...original.filter(row=>{
  const sourceOwners=owners.get(normalizeRepId(row[id]||row[key]));
  if(!sourceOwners||sourceOwners.size!==1||sourceOwners.has(canonicalOffice(row[office])))return true;
  const owner=[...sourceOwners][0];
  const twin=original.find(other=>other!==row&&other[key]===row[key]&&canonicalOffice(other[office])===owner&&String(other[name]).toLowerCase()===String(row[name]).toLowerCase());
  const safe=h.every((field,index)=>['repKey','repName','office','rep_id','repType'].includes(field)||!row[index]||(field==='attendance'&&row[index]==='in')||(field==='experienceLevel'&&row[index]==='Newer'));
  const source=records.find(record=>normalizeRepId(record.repId)===normalizeRepId(row[id]||row[key])&&canonicalOffice(record.office)===owner);
  if(twin&&safe&&(!row[h.indexOf('repType')]||row[h.indexOf('repType')]===source?.repType)){
   warnings.push(`Removed empty duplicate ${row[name]} from ${row[office]}; verified production office is ${owner}.`);return false;
  }
  if(twin)warnings.push(`Review duplicate ${row[name]} in ${row[office]}: manual settings preserved.`);return true;
 })];
 for(const row of agents.rows.slice(1)){
  if(validRepId(row[id]))continue;
  if(validRepId(row[key])&&/-\d+$/.test(String(row[key]))&&!/^(?:prod-|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(String(row[key]))){row[id]=normalizeRepId(row[key]);continue}
  const source=records.filter(record=>canonicalOffice(record.office)===canonicalOffice(row[office])&&validRepId(record.repId));
  const candidates=[...new Map(source.map(record=>[normalizeRepId(record.repId)+'|'+record.repName,record])).values()];
  const matched=uniqueNameMatch(candidates,row[name]);
  if(!matched)continue;
  const sameNameRows=agents.rows.slice(1).filter(other=>canonicalOffice(other[office])===canonicalOffice(row[office])&&uniqueNameMatch([other],matched.repName,r=>r[name]));
  const conflict=candidates.some(other=>normalizeRepId(other.repId)===normalizeRepId(matched.repId)&&!uniqueNameMatch([other],matched.repName));
  if(sameNameRows.length!==1||conflict){warnings.push(`Ambiguous ID for ${row[name]} in ${row[office]}; link manually in Attendance.`);continue}
  row[id]=normalizeRepId(matched.repId);
 }
 // Production discovery is append-only; all existing manual settings stay put.
 const normalizeName=name=>String(name||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}]/gu,'');
 for(const record of records){
  const repName=String(record.repName||'').replace(/[↑↓]/g,'').trim(),repOffice=canonicalOffice(record.office);
  if(!record.office||!isProductionRepName(repName))continue;
  const roster=agents.rows.slice(1).filter(row=>canonicalOffice(row[office])===repOffice);
  if(roster.some(row=>(record.repId&&normalizeRepId(row[id]||row[key])===normalizeRepId(record.repId))||normalizeName(row[name])===normalizeName(repName)||uniqueNameMatch([row],repName,r=>r[name])))continue;
  const values={repKey:crypto.randomUUID(),repName,office:repOffice,rep_id:validRepId(record.repId)?normalizeRepId(record.repId):'',repType:record.repType||'New Rep',team:'',teamLead:'',trainer:'',attendance:'in',experienceLevel:''};
  agents.rows.push(h.map(field=>values[field]??''));
 }
 return {tabs:clones,aliases:[],warnings};
}
export async function syncProductionIdentities(connection,records){
 await connection.query('BEGIN');
 try{
  await connection.query("SELECT pg_advisory_xact_lock(hashtext('atmo-rep-identity-link'))");
  const result=await connection.query('SELECT title,rows FROM public.project_tabs ORDER BY title FOR UPDATE');
  const migrated=migrateIdentityRows(result.rows,records);
  for(const tab of migrated.tabs){const old=result.rows.find(row=>row.title===tab.title);if(JSON.stringify(old.rows)!==JSON.stringify(tab.rows))await connection.query('UPDATE public.project_tabs SET rows=$2::jsonb,revision=revision+1,updated_at=now() WHERE title=$1',[tab.title,JSON.stringify(tab.rows)])}
  await connection.query('COMMIT');for(const warning of migrated.warnings)console.warn('[rep-id]',warning);return migrated;
 }catch(error){await connection.query('ROLLBACK');throw error}
}
