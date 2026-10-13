import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerRepProfileRoutes,profileAssignments,sameProfileRep} from '../server/rep-profile.mjs';
const office='MADHAV MEHTA',other='CANYON TUMAN';
const rep={repKey:'rep',repName:'Example Rep',office};
test('profile assignments match rep identity within office and join work teams to store IDs',()=>{
 const data=profileAssignments(rep,{date:'2026-10-13',groups:[{id:'t1',members:[rep]},{id:'t2',members:[{...rep,office:other}]}]},{groups:[{id:'s1',teamIds:['t1']},{id:'s2',teamIds:['t2']}]},{groups:[{id:'c1',leader:rep,members:[]}]},{groups:[]});
 assert.deepEqual(data.workTeams.map(x=>x.id),['t1']);assert.deepEqual(data.stores.map(x=>x.id),['s1']);assert.equal(data.coachingGroups.length,1);
 assert.equal(sameProfileRep({...rep,office:other},rep),false);
});
test('profile provides all matching sections, protects private data and tolerates a failed section',async()=>{
 let privateReads=0,failChecklist=false;
 const app=express();app.use((req,res,next)=>{req.user={repId:req.get('x-user')||'viewer',office};next()});
 registerRepProfileRoutes(app,{requestedOffice:req=>req.query.office||office,refreshProductionCache:async()=>{},loadReps:async()=>[rep],resolveRepLogin:async id=>({repKey:id,office,isAdmin:id==='admin'}),getFieldNotes:async()=>{privateReads++;return [{...rep,id:'note',note:'Practice stops',date:'2026-10-12'},{repKey:'another',note:'Not this rep'}]},getManualNumbers:async()=>{privateReads++;return [{...rep,date:'2026-10-12',talks:42},{...rep,office:other,talks:99}]},repChecklist:async()=>{privateReads++;if(failChecklist)throw new Error('offline');return [{id:'method',implemented:true}]},listPreferences:async()=>[{...rep,storeIds:['s1']}],getWorkMatchups:async()=>({groups:[{id:'t1',members:[rep]}]}),getStoreMatchups:async()=>({groups:[{id:'s1',teamIds:['t1']}]}),getDraftMatchups:async()=>({groups:[]}),getFinalMatchups:async()=>({groups:[]}),catalog:[{id:'s1',name:'Store'}]});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const read=user=>fetch(base+'/api/rep-profile/rep',{headers:{'x-user':user}}).then(r=>r.json());
 try{
  const publicData=await read('viewer');assert.equal(publicData.privateAccess,false);assert.equal(publicData.notes.length,0);assert.equal(publicData.manualEntries.length,0);assert.equal(privateReads,0);assert.deepEqual(publicData.storePreferences,['s1']);assert.equal(publicData.stores.length,1);
  const mine=await read('rep');assert.equal(mine.privateAccess,true);assert.equal(mine.notes.length,1);assert.equal(mine.manualEntries.length,1);assert.equal(mine.manualEntries[0].talks,42);assert.equal(mine.checklist.length,1);
  failChecklist=true;const admin=await read('admin');assert.equal(admin.privateAccess,true);assert.equal(admin.checklist.length,0);assert.equal(admin.notes.length,1);assert.equal(admin.warnings.length,1);
  assert.equal((await fetch(base+'/api/rep-profile/rep?office='+encodeURIComponent(other))).status,404);
  assert.equal((await fetch(base+'/api/rep-profile/missing')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
