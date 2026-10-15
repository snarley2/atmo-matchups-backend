import {test,mock} from 'node:test';import assert from 'node:assert/strict';import express from 'express';
const duties=new Map(),assignments=new Map(),subs=new Map();
function assignment(row){return {...row,dutyId:row.duty_id,weekStart:row.week_start,repKey:row.rep_key,repName:row.rep_name,repOffice:row.rep_office,updatedBy:row.updated_by,title:duties.get(row.duty_id).title,office:duties.get(row.duty_id).office}}
function substitution(row){const a=assignments.get(row.assignment_id);return {...row,assignmentId:row.assignment_id,date:row.work_date,repKey:row.rep_key,repName:row.rep_name,repOffice:row.rep_office,weekStart:a.week_start,updatedBy:row.updated_by,title:duties.get(a.duty_id).title,office:duties.get(a.duty_id).office,originalRepName:a.rep_name}}
async function query(sql,args=[]){
 if(sql.startsWith('CREATE')||['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('pg_advisory'))return {rows:[]};
 if(sql.startsWith('INSERT INTO public.office_responsibilities')){const [id,office,title,details]=args;const row={id,office,title,details,active:true};duties.set(id,row);return {rows:[row]}}
 if(sql.startsWith('UPDATE public.office_responsibilities')){const row=duties.get(args[0]);if(row?.office===args[1])row.active=false;return {rows:[]}}
 if(sql.startsWith('SELECT id,office'))return {rows:[...duties.values()].filter(row=>row.office===args[0]&&row.active)};
 if(sql.startsWith('SELECT id FROM public.office')){const row=duties.get(args[0]);return {rows:row?.office===args[1]&&row.active?[row]:[]}}
 if(sql.startsWith('SELECT id,rep_key'))return {rows:[...assignments.values()].filter(row=>row.duty_id===args[0]&&row.week_start===args[1]&&row.active)};
 if(sql.startsWith('INSERT INTO public.responsibility_assignments')){const [id,duty_id,week_start,rep_key,rep_name,rep_office,updated_by]=args;assignments.set(id,{id,duty_id,week_start,rep_key,rep_name,rep_office,updated_by,active:true});return {rows:[]}}
 if(sql.startsWith('UPDATE public.responsibility_assignments')){assignments.get(args[0]).active=false;return {rows:[]}}
 if(sql.startsWith('SELECT a.week_start')){const row=assignments.get(args[0]),duty=row&&duties.get(row.duty_id);return {rows:row?.active&&duty?.active&&duty.office===args[1]?[{week:row.week_start,rep_key:row.rep_key,rep_office:row.rep_office}]:[]}}
 if(sql.startsWith('UPDATE public.responsibility_substitutions')){for(const row of subs.values())if(row.assignment_id===args[0]&&row.work_date===args[1])row.active=false;return {rows:[]}}
 if(sql.startsWith('INSERT INTO public.responsibility_substitutions')){const [id,assignment_id,work_date,rep_key,rep_name,rep_office,notes,updated_by]=args;subs.set(id,{id,assignment_id,work_date,rep_key,rep_name,rep_office,notes,updated_by,active:true});return {rows:[]}}
 if(sql.startsWith('SELECT a.id')){const rows=[...assignments.values()].map(assignment);return {rows:rows.filter(row=>sql.includes('WHERE a.rep_key')?row.repKey===args[0]&&row.repOffice===args[1]:row.office===args[0]&&row.weekStart===args[1])}}
 if(sql.startsWith('SELECT s.id')){const rows=[...subs.values()].map(substitution);return {rows:rows.filter(row=>sql.includes('WHERE s.rep_key')?row.repKey===args[0]&&row.repOffice===args[1]:row.office===args[0]&&row.weekStart===args[1])}}
 throw new Error('Unexpected query: '+sql);
}
class Pool{query(...args){return query(...args)}async connect(){return {query,release(){}}}}
mock.module('pg',{defaultExport:{Pool}});process.env.SUPABASE_DB_URL='postgres://test-only';
const {registerResponsibilityRoutes}=await import('../server/responsibilities-routes.mjs');
test('weekly assignments, cross-office substitutes, replacement and removal preserve rep history',async()=>{
 const office='MADHAV MEHTA',other='KEASEL BROOM';const roster=[{repKey:'a',repName:'Rep One',office},{repKey:'b',repName:'Rep Two',office:other},{repKey:'c',repName:'Rep Three',office:other}];
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={repName:'Viewer'};next()});
 registerResponsibilityRoutes(app,{requireAdmin:(req,res,next)=>req.get('x-admin')==='yes'?(req.admin={repName:'Coach'},next()):res.status(403).json({error:'Admin required'}),requestedOffice:req=>req.query.office||req.body?.office||office,getAgents:async()=>roster,io:{emit(){}}});app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const send=(path,body,method='POST',admin=true)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(admin?{'x-admin':'yes'}:{})},body:JSON.stringify(body)});
 try{
  assert.equal((await send('/api/responsibilities',{title:'Doors',office},'POST',false)).status,403);
  const dutyResponse=await send('/api/responsibilities',{title:'Doors',details:'Open office',office});assert.equal(dutyResponse.status,201);const duty=await dutyResponse.json();
  const assign=reps=>send(`/api/responsibilities/${duty.id}/assignments`,{office,week:'2026-10-12',reps},'PUT');
  assert.equal((await assign([{repKey:'a',office},{repKey:'b',office:other}])).status,200);assert.equal(assignments.size,2);
  const board=await (await fetch(base+'/api/responsibilities?week=2026-10-12')).json();assert.equal(board.reps.length,3);assert.equal(board.assignments.length,2);
  const original=board.assignments.find(row=>row.repKey==='a');
  const sub=(date,key)=>send('/api/responsibilities/substitutes',{office,assignmentId:original.id,date,repKey:key,repOffice:other,notes:'Coverage'});
  assert.equal((await sub('2026-10-20','b')).status,400);
  assert.equal((await sub('2026-10-14','b')).status,200);assert.equal((await sub('2026-10-14','c')).status,200);assert.equal(subs.size,2);assert.equal([...subs.values()].filter(row=>row.active).length,1);
  assert.equal((await sub('2026-10-14','')).status,200);assert.equal([...subs.values()].filter(row=>row.active).length,0);assert.equal(subs.size,2);
  assert.equal((await assign([{repKey:'c',office:other}])).status,200);assert.equal(assignments.size,3);assert.equal([...assignments.values()].filter(row=>row.active).length,1);
  const before=await (await fetch(base+'/api/responsibilities/history/b?office='+other.replace(' ','%20'))).json();assert.equal(before.history.length,2);assert(before.history.some(row=>row.kind==='substitute'&&row.date==='2026-10-14'));
  await send(`/api/responsibilities/${duty.id}?office=${office.replace(' ','%20')}`,{},'DELETE');assert.equal(duties.get(duty.id).active,false);
  const after=await (await fetch(base+'/api/responsibilities/history/b?office='+other.replace(' ','%20'))).json();assert.equal(after.history.length,2);
  assert.equal((await assign([{repKey:'a',office}])).status,404);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
