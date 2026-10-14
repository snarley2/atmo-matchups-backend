import {test,mock} from 'node:test';import assert from 'node:assert/strict';import express from 'express';
const trips=new Map();
class Pool{async query(sql,args=[]){
 if(sql.startsWith('CREATE'))return {};
 if(sql.startsWith('SELECT'))return {rows:[...trips.values()].filter(row=>Array.isArray(args[0])?args[0].includes(row.id):row.office===args[0])};
 if(sql.startsWith('INSERT')){const [id,office,week_start,name,location,notes,days]=args;if(trips.has(id)&&trips.get(id).office!==office)return {rows:[]};const row={id,office,week_start,name,location,notes,days:JSON.parse(days)};trips.set(id,row);return {rows:[row]}}
 if(sql.startsWith('DELETE')){if(trips.get(args[1])?.office===args[0])trips.delete(args[1]);return {}}
 throw new Error('Unexpected query');
}async end(){}}
mock.module('pg',{defaultExport:{Pool}});process.env.SUPABASE_DB_URL='postgres://test-only';
const {registerRoadtripRoutes,decorateRoadtrips,closeRoadtripDatabase}=await import('../server/roadtrips.mjs');
test('roadtrips persist overlapping days, enforce office/admin boundaries and calculate daily attendance',async()=>{
 const office='MADHAV MEHTA';const app=express();app.use(express.json());
 registerRoadtripRoutes(app,{requireAdmin:(req,res,next)=>req.get('x-admin')==='yes'?next():res.status(403).json({error:'Admin required'}),requestedOffice:req=>req.query.office||req.body?.office||office,io:{emit(){}}});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const send=body=>fetch(base+'/api/roadtrips',{method:'POST',headers:{'Content-Type':'application/json','x-admin':'yes'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/api/roadtrips')).status,403);
  const first=await (await send({office,name:'First trip',weekStart:'2026-10-12',days:[2,3]})).json();
  const second=await (await send({office,name:'Second trip',weekStart:'2026-10-12',days:[3]})).json();
  assert.notEqual(first.id,second.id);assert.equal(trips.size,2);
  const rep={repKey:'rep',office,attendance:'roadtrip',roadtripId:first.id};
  assert.equal((await decorateRoadtrips([rep],'2026-10-14'))[0].roadtripActive,true);
  assert.equal((await decorateRoadtrips([rep],'2026-10-15'))[0].roadtripActive,false);
  assert.equal((await decorateRoadtrips([{...rep,roadtripId:''}],'2026-10-14'))[0].roadtripActive,true);
  assert.equal((await send({...first,office:'CANYON TUMAN'})).status,403);
  const list=await (await fetch(base+'/api/roadtrips?office='+encodeURIComponent(office),{headers:{'x-admin':'yes'}})).json();assert.equal(list.trips.length,2);
  await fetch(base+'/api/roadtrips/'+first.id+'?office=CANYON%20TUMAN',{method:'DELETE',headers:{'x-admin':'yes'}});assert.equal(trips.size,2);
  await fetch(base+'/api/roadtrips/'+first.id+'?office='+encodeURIComponent(office),{method:'DELETE',headers:{'x-admin':'yes'}});assert.equal(trips.size,1);
 }finally{await new Promise(resolve=>server.close(resolve));await closeRoadtripDatabase()}
});
