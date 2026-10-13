import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";

export const COACHING_GAPS=[
  {key:"talkToStop",label:"Talk → Stop"}, {key:"stopToZip",label:"Stop → Zip"},
  {key:"zipToPresentation",label:"Zip → Presentation"}, {key:"presentationToInfo",label:"Presentation → Info"},
  {key:"infoToClose",label:"Info → Close"},
];
export function validateMethod(body={},partial=false){
  const result={};
  if(!partial||body.gapKey!==undefined){
    if(!COACHING_GAPS.some(g=>g.key===body.gapKey))throw Object.assign(new Error("Choose a valid funnel gap."),{status:400});
    result.gapKey=body.gapKey;
  }
  if(!partial||body.title!==undefined){
    if(typeof body.title!=="string"||!body.title.trim()||body.title.trim().length>160)throw Object.assign(new Error("Enter a method name of 1–160 characters."),{status:400});
    result.title=body.title.trim();
  }
  if(!partial||body.details!==undefined){
    if(body.details!==undefined&&(typeof body.details!=="string"||body.details.length>2000))throw Object.assign(new Error("Method instructions must be 2,000 characters or fewer."),{status:400});
    result.details=(body.details||"").trim();
  }
  if(body.active!==undefined){
    if(typeof body.active!=="boolean")throw Object.assign(new Error("Active must be true or false."),{status:400});
    result.active=body.active;
  }
  return result;
}
let pool,ready;
async function db(){
  if(!process.env.SUPABASE_DB_URL)throw new Error("Missing SUPABASE_DB_URL");
  pool ||= new pg.Pool({connectionString:process.env.SUPABASE_DB_URL,ssl:process.env.SUPABASE_DB_SSL==="false"?false:{rejectUnauthorized:process.env.SUPABASE_DB_SSL_VERIFY==="true"}});
  ready ||= fs.readFile(new URL("../supabase/coaching.sql",import.meta.url),"utf8").then(sql=>pool.query(sql)).catch(error=>{ready=null;throw error});
  await ready;return pool;
}
const method=row=>({id:row.id,office:row.office,gapKey:row.gap_key,title:row.title,details:row.details,active:row.active,updatedAt:row.updated_at});
export async function listMethods(office){
  const result=await (await db()).query("SELECT * FROM public.coaching_methods WHERE office=$1 ORDER BY created_at,id",[office]);return result.rows.map(method);
}
export async function addMethod(office,input){
  const data=validateMethod(input);
  const result=await (await db()).query("INSERT INTO public.coaching_methods(id,office,gap_key,title,details) VALUES($1,$2,$3,$4,$5) RETURNING *",[crypto.randomUUID(),office,data.gapKey,data.title,data.details]);return method(result.rows[0]);
}
export async function updateMethod(office,id,input){
  const data=validateMethod(input,true);
  // A method's gap stays fixed so existing rep checks retain their meaning.
  if(data.gapKey!==undefined)throw Object.assign(new Error("Add a new method to move it to a different gap."),{status:400});
  const result=await (await db()).query(`UPDATE public.coaching_methods SET title=COALESCE($3,title),details=COALESCE($4,details),active=COALESCE($5,active),updated_at=now() WHERE office=$1 AND id=$2 RETURNING *`,[office,id,data.title??null,data.details??null,data.active??null]);
  if(!result.rows.length)throw Object.assign(new Error("Method was not found in this office."),{status:404});return method(result.rows[0]);
}
export async function repChecklist(office,repKey){
  const result=await (await db()).query(`SELECT m.*,COALESCE(c.implemented,false) AS implemented,c.updated_at AS checked_at,c.updated_by
    FROM public.coaching_methods m LEFT JOIN public.coaching_rep_methods c
    ON c.method_id=m.id AND c.office=m.office AND c.rep_key=$2
    WHERE m.office=$1 AND m.active=true ORDER BY m.created_at,m.id`,[office,repKey]);
  return result.rows.map(row=>({...method(row),implemented:row.implemented,checkedAt:row.checked_at,updatedBy:row.updated_by}));
}
export async function trainingCoaching(office,repKeys){
  if(!repKeys.length)return {methods:[],checks:[]};
  const methods=(await listMethods(office)).filter(method=>method.active);
  const result=await (await db()).query(`SELECT rep_key,method_id,implemented,updated_at,updated_by
    FROM public.coaching_rep_methods WHERE office=$1 AND rep_key=ANY($2::text[])`,[office,repKeys]);
  return {methods,checks:result.rows.map(row=>({repKey:row.rep_key,methodId:row.method_id,implemented:row.implemented,updatedAt:row.updated_at,updatedBy:row.updated_by}))};
}
export async function setRepMethod(office,repKey,methodId,implemented,actor){
  if(typeof implemented!=="boolean")throw Object.assign(new Error("Implemented must be true or false."),{status:400});
  // Office/active checks are part of the write, including concurrent archiving.
  const result=await (await db()).query(`INSERT INTO public.coaching_rep_methods(office,rep_key,method_id,implemented,updated_by)
    SELECT office,$2,id,$4,$5 FROM public.coaching_methods WHERE office=$1 AND id=$3 AND active=true
    ON CONFLICT(office,rep_key,method_id) DO UPDATE SET implemented=excluded.implemented,updated_by=excluded.updated_by,updated_at=now()
    RETURNING implemented,updated_at,updated_by`,[office,repKey,methodId,implemented,actor]);
  if(!result.rows.length)throw Object.assign(new Error("Method is archived or belongs to another office."),{status:404});
  return {methodId,implemented:result.rows[0].implemented,checkedAt:result.rows[0].updated_at,updatedBy:result.rows[0].updated_by};
}
export async function closeCoachingDatabase(){if(pool)await pool.end();pool=undefined;ready=null;}
