import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import crypto from 'node:crypto';
test('reps reload only their own daily totals and cannot overwrite another rep',async()=>{
 const source=await readFile(new URL('../server/index.mjs',import.meta.url),'utf8');
 const start=source.indexOf('app.get("/api/manual-numbers"'),end=source.indexOf('\napp.',source.indexOf('app.post("/api/manual-numbers"',start)+5);
 const office='MADHAV MEHTA',roster=[{repKey:'rep',repName:'My Rep',office},{repKey:'other',repName:'Other Rep',office}];
 let entries=[{repKey:'rep',repName:'My Rep',date:'2026-10-12',talks:10},{repKey:'other',repName:'Other Rep',date:'2026-10-12',talks:80}],saved;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={repId:req.get('x-user')||'rep',office};next()});
 new Function('app','requestedOffice','getManualNumbers','getAgents','agentsForOffice','resolveRepLogin','easternDateParts','upsertManualNumbers','crypto','sanitizeLiveName','io',source.slice(start,end))(app,req=>req.query.office||req.body?.office||office,async()=>entries,async()=>roster,(agents,office)=>agents.filter(rep=>rep.office===office),async id=>({repKey:id,office,isAdmin:id==='admin'}),date=>({date,day:'Monday'}),async entry=>{saved=entry;return entry},crypto,value=>value,{emit(){}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const response=await fetch(base+'/api/manual-numbers');assert.equal(response.status,200,await response.clone().text());assert.deepEqual((await response.json()).map(rep=>rep.repKey),['rep']);
  const admin=await fetch(base+'/api/manual-numbers',{headers:{'x-user':'admin'}});assert.equal((await admin.json()).length,2);
  const post=body=>fetch(base+'/api/manual-numbers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({office,repKey:'other',repName:'Other Rep',date:'2026-10-12',talks:90})).status,403);
  assert.equal((await post({office,repKey:'rep',repName:'My Rep',date:'2026-10-12',talks:11,electric:1,electricPartial:2,gas:3,gasPartial:4})).status,201);
  assert.equal(saved.repKey,'rep');assert.equal(saved.talks,11);assert.equal(saved.gasPartial,4);assert.equal(saved.totalSales,10);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
