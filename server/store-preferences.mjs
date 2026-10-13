import fs from 'node:fs/promises';
import pg from 'pg';
export function validateStorePreferences(ids,catalog){
 if(!Array.isArray(ids)||ids.length>5||ids.some(id=>typeof id!=='string'||!catalog.some(store=>store.id===id))||new Set(ids).size!==ids.length)throw Object.assign(new Error('Choose up to five different stores from the catalog.'),{status:400});
 return ids;
}
let pool,ready;
async function db(){
 if(!process.env.SUPABASE_DB_URL)throw new Error('Missing SUPABASE_DB_URL');
 pool ||= new pg.Pool({connectionString:process.env.SUPABASE_DB_URL,ssl:process.env.SUPABASE_DB_SSL==='false'?false:{rejectUnauthorized:process.env.SUPABASE_DB_SSL_VERIFY==='true'}});
 ready ||= fs.readFile(new URL('../supabase/store-preferences.sql',import.meta.url),'utf8').then(sql=>pool.query(sql)).catch(error=>{ready=null;throw error});
 await ready;return pool;
}
export async function listPreferences(){return (await (await db()).query('SELECT office,rep_key AS "repKey",store_ids AS "storeIds" FROM public.rep_store_preferences')).rows;}
export async function savePreferences(office,repKey,storeIds){
 await (await db()).query('INSERT INTO public.rep_store_preferences(office,rep_key,store_ids) VALUES($1,$2,$3::jsonb) ON CONFLICT(office,rep_key) DO UPDATE SET store_ids=excluded.store_ids,updated_at=now()',[office,repKey,JSON.stringify(storeIds)]);
 return {office,repKey,storeIds};
}
export async function getNextUp(scope,date){return (await (await db()).query('SELECT team_id AS "teamId" FROM public.store_next_up WHERE scope=$1 AND work_date=$2',[scope,date])).rows[0]||{teamId:''};}
export async function setNextUp(scope,date,teamId){
 await (await db()).query('INSERT INTO public.store_next_up(scope,work_date,team_id) VALUES($1,$2,$3) ON CONFLICT(scope,work_date) DO UPDATE SET team_id=excluded.team_id,updated_at=now()',[scope,date,teamId]);return {teamId};
}
