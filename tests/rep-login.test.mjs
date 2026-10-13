import {test,mock} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {setProductionLogRecords} from "../server/production-csv.mjs";

const roster=[{repKey:"uuid-one",repName:"John Michael Smith",office:"MADHAV MEHTA",repType:"New Rep",trainer:"Jane Coach"},{repKey:"R-2222",repName:"Jane Jones",office:"MADHAV MEHTA",repType:"New Rep"}];
let migrations=0;
mock.module("../server/sheets.mjs",{namedExports:{getAgents:async()=>roster}});
mock.module("../server/production-import.mjs",{namedExports:{refreshProductionCache:async()=>{},synchronizeRepIdentities:async()=>{migrations++}}});
const {resolveRepLogin,registerRepLogin}=await import("../server/rep-login.mjs");
setProductionLogRecords([
 {repId:"CYD1-BXH-8448",repName:"Brennon Hill",repType:"Leader",keys:["brennonhill"],sourceFile:"AI production log - 10.10.2026.sheet"},
 {repId:"CYD1-AXB-5555",repName:"Alex Brown",repType:"New Rep",keys:["alexbrown"],sourceFile:"AI production log - 10.10.2026.sheet"},
 {repId:"CYD1-CXD-5555",repName:"Chris Davis",repType:"New Rep",keys:["chrisdavis"],sourceFile:"AI production log - 10.10.2026.sheet"},
 {repId:"CYD1-0012",repName:"Alex Taylor",repType:"New Rep",keys:["alextaylor"],sourceFile:"AI production log - 10.10.2026.sheet"},
 {repId:"R-1111",repName:"John Smith",repType:"Trainer",keys:["johnsmith"],sourceFile:"AI production log - 10.10.2026.sheet"},
 {repId:"R-2222",repName:"Jane Jones",repType:"New Rep",keys:["janejones"],sourceFile:"AI production log - 10.10.2026.sheet"},
]);

test("production ID login resolves personal identity, trainers and general admin",async()=>{
 const trainer=await resolveRepLogin(" r-1111 ","MADHAV MEHTA");
 assert.equal(trainer.repKey,"R-1111");assert.equal(trainer.repName,"John Michael Smith");assert.equal(trainer.isAdmin,true);
 assert.equal((await resolveRepLogin("R-2222","MADHAV MEHTA")).isAdmin,false);
 assert.equal((await resolveRepLogin("mxm - 1324","MADHAV MEHTA")).generalAdmin,true);
 await assert.rejects(resolveRepLogin("missing","MADHAV MEHTA"),error=>error.status===404);
 await assert.rejects(resolveRepLogin("R-1111","CANYON TUMAN"),error=>error.status===404);
 assert.equal(roster[0].trainer,"Jane Coach");
});

test("saved rep session restores identity and never trusts a submitted role",async()=>{
 const app=express();app.use(express.json());const issued=new Map();
 registerRepLogin(app,{bearerToken:req=>req.headers.authorization?.replace("Bearer ",""),verifySessionToken:token=>issued.get(token),issueSessionToken:user=>{const token="signed-"+user.repId;issued.set(token,{kind:"rep",repKey:user.repKey,repId:user.repId,office:user.office});return token}});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const response=await fetch(base+"/api/auth/rep",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({repId:"R-2222",office:"MADHAV MEHTA",isAdmin:true,role:"Owner"})});
  assert.equal(response.status,200);const session=await response.json();assert.equal(session.user.isAdmin,false);assert.equal(migrations,1);
  const restored=await fetch(base+"/api/auth/rep/me",{headers:{Authorization:"Bearer "+session.token}});assert.equal(restored.status,200);assert.equal((await restored.json()).user.repId,"R-2222");
  assert.equal((await fetch(base+"/api/auth/rep/me")).status,401);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test("numeric login assumes CYD1 and preserves full IDs and leading zeros",async()=>{
 const numeric=await resolveRepLogin(" 0012 ","MADHAV MEHTA");
 assert.equal(numeric.repId,"CYD1-0012");assert.equal(numeric.isAdmin,false);
 assert.deepEqual(await resolveRepLogin("cyd1-0012","MADHAV MEHTA"),numeric);
 assert.equal((await resolveRepLogin("MXM - 1324","MADHAV MEHTA")).generalAdmin,true);
 await assert.rejects(resolveRepLogin("1324","MADHAV MEHTA"),error=>error.status===404);
});

test("real production IDs accept initials or unique numeric suffix and reject duplicates",async()=>{
 for(const id of ["BXH-8448","8448","CYD1-8448","CYD1-BXH-8448"]){
  assert.equal((await resolveRepLogin(id,"MADHAV MEHTA")).repId,"CYD1-BXH-8448");
 }
 await assert.rejects(resolveRepLogin("5555","MADHAV MEHTA"),error=>error.status===409);
 assert.equal((await resolveRepLogin("AXB-5555","MADHAV MEHTA")).repId,"CYD1-AXB-5555");
 await assert.rejects(resolveRepLogin("8448","CANYON TUMAN"),error=>error.status===404);
});
