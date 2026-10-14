import pg from 'pg';
import crypto from 'node:crypto';
import {canonicalOffice} from '../offices.mjs';
let pool,ready;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function mondayOf(date){const d=new Date(`${date}T12:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)throw Object.assign(new Error('Choose a valid week.'),{status:400});d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)}
export function validateTrip(body){
 const weekStart=mondayOf(String(body.weekStart||''));const name=String(body.name||'').trim(),location=String(body.location||'').trim(),notes=String(body.notes||'').trim();
 if(!name||name.length>120||location.length>200||notes.length>2000||!Array.isArray(body.days)||!body.days.length||body.days.some(day=>!Number.isInteger(day)||day<1||day>6)||new Set(body.days).size!==body.days.length)throw Object.assign(new Error('Enter a trip name and choose Monday–Saturday days.'),{status:400});
 return {weekStart,name,location,notes,days:[...body.days].sort()};
}
async function db(){
 if(!process.env.SUPABASE_DB_URL)throw new Error('Missing SUPABASE_DB_URL');
 pool ||= new pg.Pool({connectionString:process.env.SUPABASE_DB_URL,ssl:process.env.SUPABASE_DB_SSL==='false'?false:{rejectUnauthorized:process.env.SUPABASE_DB_SSL_VERIFY==='true'}});
 ready ||= pool.query(`CREATE TABLE IF NOT EXISTS public.roadtrips(id uuid PRIMARY KEY,office text NOT NULL,week_start date NOT NULL,name text NOT NULL,location text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',days jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());ALTER TABLE public.roadtrips ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.roadtrips FROM anon,authenticated;`).catch(error=>{ready=null;throw error});await ready;return pool;
}
const object=row=>({id:row.id,office:row.office,weekStart:typeof row.week_start==='string'?row.week_start.slice(0,10):row.week_start.toISOString().slice(0,10),name:row.name,location:row.location,notes:row.notes,days:row.days});
export async function listRoadtrips(office){return (await (await db()).query('SELECT * FROM public.roadtrips WHERE office=$1 ORDER BY week_start DESC,name',[office])).rows.map(object)}
export async function decorateRoadtrips(agents,date=today()){
 const ids=agents.map(rep=>rep.roadtripId).filter(Boolean);if(!ids.length)return agents.map(rep=>({...rep,roadtripActive:rep.attendance==='roadtrip'}));
 const trips=(await (await db()).query('SELECT * FROM public.roadtrips WHERE id::text=ANY($1::text[])',[ids])).rows.map(object);
 return agents.map(rep=>{const trip=trips.find(trip=>trip.id===rep.roadtripId&&trip.office===canonicalOffice(rep.office));const offset=trip?Math.round((new Date(`${date}T12:00:00Z`)-new Date(`${trip.weekStart}T12:00:00Z`))/86400000)+1:0;return {...rep,roadtripName:trip?.name||'',roadtripActive:rep.attendance==='roadtrip'&&(!trip||trip.days.includes(offset))}});
}
export function registerRoadtripRoutes(app,{requireAdmin,requestedOffice,io}){
 app.get('/api/roadtrips',requireAdmin,async(req,res,next)=>{try{res.json({trips:await listRoadtrips(requestedOffice(req))})}catch(error){next(error)}});
 app.post('/api/roadtrips',requireAdmin,async(req,res,next)=>{try{const data=validateTrip(req.body),office=requestedOffice(req),id=req.body.id||crypto.randomUUID();if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new Error('Invalid trip ID.'),{status:400});const result=await (await db()).query(`INSERT INTO public.roadtrips(id,office,week_start,name,location,notes,days) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO UPDATE SET week_start=excluded.week_start,name=excluded.name,location=excluded.location,notes=excluded.notes,days=excluded.days,updated_at=now() WHERE roadtrips.office=excluded.office RETURNING *`,[id,office,data.weekStart,data.name,data.location,data.notes,JSON.stringify(data.days)]);if(!result.rows.length)return res.status(403).json({error:'Trip belongs to another office.'});io.emit('agents:updated');res.json(object(result.rows[0]))}catch(error){next(error)}});
 app.delete('/api/roadtrips/:id',requireAdmin,async(req,res,next)=>{try{await (await db()).query('DELETE FROM public.roadtrips WHERE office=$1 AND id::text=$2',[requestedOffice(req),req.params.id]);io.emit('agents:updated');res.json({success:true})}catch(error){next(error)}});
}

export async function closeRoadtripDatabase(){if(pool)await pool.end();pool=undefined;ready=undefined}
