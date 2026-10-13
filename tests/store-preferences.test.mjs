import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {validateStorePreferences} from '../server/store-preferences.mjs';
import {registerStorePreferenceRoutes} from '../server/store-preference-routes.mjs';
const catalog=Array.from({length:6},(_,i)=>({id:'s'+i}));
test('top stores require at most five distinct catalog IDs',()=>{
 assert.deepEqual(validateStorePreferences(['s1','s2'],catalog),['s1','s2']);
 for(const ids of [['s1','s1'],['missing'],catalog.map(s=>s.id),'s1',[null]])assert.throws(()=>validateStorePreferences(ids,catalog),error=>error.status===400);
 assert.deepEqual(validateStorePreferences([],catalog),[]);
});
test('reps edit only themselves; admins choose a scoped next team; state survives reads',async()=>{
 const office='MADHAV MEHTA',other='CANYON TUMAN';let preferences=[],choice='';
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={repId:req.get('x-user')||'rep',office};next()});
 const users={rep:{repKey:'rep',office,isAdmin:false},admin:{repKey:'admin',office,isAdmin:true}};
 registerStorePreferenceRoutes(app,{requireAdmin:(req,res,next)=>req.user.repId==='admin'?next():res.status(403).json({error:'Admin required'}),resolveRepLogin:async id=>users[id],getAgents:async()=>[{repKey:'rep',office},{repKey:'other',office:other}],expandAgentsFromProduction:x=>x,getWorkMatchups:async()=>({groups:[{id:'t1',members:[{office}]},{id:'t2',members:[{office:other}]}]}),catalog,io:{emit(){}},today:()=> '2026-10-13',store:{listPreferences:async()=>preferences,savePreferences:async(office,repKey,storeIds)=>{preferences=[{office,repKey,storeIds}];return preferences[0]},getNextUp:async()=>({teamId:choice}),setNextUp:async(scope,date,teamId)=>{choice=teamId;return {teamId}}}});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const send=(path,body,user='rep')=>fetch(base+path,{method:'PUT',headers:{'Content-Type':'application/json','x-user':user},body:JSON.stringify(body)});
 try{
  assert.equal((await send('/api/store-preferences/rep',{office,storeIds:['s1','s2']})).status,200);
  assert.deepEqual((await (await fetch(base+'/api/store-preferences')).json()).preferences[0].storeIds,['s1','s2']);
  assert.equal((await send('/api/store-preferences/other',{office:other,storeIds:['s3'],isAdmin:true})).status,403);
  assert.equal((await send('/api/store-preferences/rep',{office,storeIds:['s1','s1']})).status,400);
  assert.equal((await send('/api/store-preferences/other',{office:other,storeIds:['s3']},'admin')).status,200);
  assert.equal((await send('/api/store-next-up',{office,teamId:'t1'})).status,403);
  assert.equal((await send('/api/store-next-up',{office,teamId:'t2'},'admin')).status,400);
  assert.equal((await send('/api/store-next-up',{office,teamId:'t1'},'admin')).status,200);
  assert.equal((await (await fetch(base+'/api/store-next-up?office='+encodeURIComponent(office))).json()).teamId,'t1');
  assert.equal((await send('/api/store-next-up',{office,teamId:''},'admin')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
