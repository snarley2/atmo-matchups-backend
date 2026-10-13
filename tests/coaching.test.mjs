import {test,mock} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {canonicalOffice} from "../offices.mjs";

const methods=new Map(),checks=new Map();
class Pool {
 async query(sql,args=[]){
  if(sql.startsWith("CREATE TABLE"))return {};
  if(sql.startsWith("INSERT INTO public.coaching_methods")){
   const [id,office,gap_key,title,details]=args;
   const row={id,office,gap_key,title,details,active:true,updated_at:new Date().toISOString()};methods.set(id,row);return {rows:[row]};
  }
  if(sql.startsWith("UPDATE public.coaching_methods")){
   const [office,id,title,details,active]=args,row=methods.get(id);if(!row||row.office!==office)return {rows:[]};
   Object.assign(row,{title:title??row.title,details:details??row.details,active:active??row.active});return {rows:[row]};
  }
  if(sql.startsWith("SELECT * FROM public.coaching_methods"))return {rows:[...methods.values()].filter(row=>row.office===args[0])};
  if(sql.startsWith("SELECT m.*"))return {rows:[...methods.values()].filter(row=>row.office===args[0]&&row.active).map(row=>({...row,implemented:false,...checks.get(`${args[0]}|${args[1]}|${row.id}`)}))};
  if(sql.startsWith("SELECT rep_key,method_id"))return {rows:[...checks].flatMap(([key,row])=>{const [office,rep_key,method_id]=key.split("|");return office===args[0]&&args[1].includes(rep_key)?[{rep_key,method_id,...row}]:[]})};
  if(sql.startsWith("INSERT INTO public.coaching_rep_methods")){
   const [office,repKey,id,implemented,actor]=args,row=methods.get(id);if(!row||row.office!==office||!row.active)return {rows:[]};
   const saved={implemented,updated_at:new Date().toISOString(),updated_by:actor};checks.set(`${office}|${repKey}|${id}`,saved);return {rows:[saved]};
  }
  throw new Error("Unexpected coaching SQL");
 }
 async end(){}
}
mock.module("pg",{defaultExport:{Pool}});
process.env.SUPABASE_DB_URL="postgres://test-only";
const {registerCoachingRoutes}=await import("../server/coaching-routes.mjs");
const {closeCoachingDatabase,trainingCoaching}=await import("../server/coaching-store.mjs");

test("method management and rep checks preserve office, rep, authentication and archive boundaries",async()=>{
 const app=express();app.use(express.json());
 const roster=[{repKey:"one",office:"MADHAV MEHTA"},{repKey:"two",office:"MADHAV MEHTA"},{repKey:"other",office:"CANYON TUMAN"}];
 const requireAdmin=(req,res,next)=>{if(req.headers.authorization!=="Bearer test")return res.status(401).json({error:"Admin required"});req.admin={repName:"Test Coach"};next()};
 registerCoachingRoutes(app,{requireAdmin,requestedOffice:req=>canonicalOffice(req.query.office||req.body?.office),getAgents:async()=>roster,expandAgentsFromProduction:x=>x});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,body,verb="GET",auth=true)=>{
  const response=await fetch(base+path,{method:verb,headers:{"Content-Type":"application/json",...auth?{Authorization:"Bearer test"}:{}},...body?{body:JSON.stringify(body)}:{}});
  return {status:response.status,data:await response.json()};
 };
 try{
  assert.equal((await call("/api/coaching-methods",null,"GET",false)).status,401);
  assert.equal((await call("/api/coaching-methods",{gapKey:"bad",title:"test"},"POST")).status,400);
  assert.equal((await call("/api/coaching-methods",{},"POST")).status,400);
  const created=await call("/api/coaching-methods",{office:"MADHAV MEHTA",gapKey:"stopToZip",title:"Ask for the ZIP early",details:"Practice a clear transition."},"POST");
  assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call(`/api/coaching-methods/${id}`,{title:"Clear ZIP transition"},"PUT")).data.title,"Clear ZIP transition");
  assert.equal((await call(`/api/coaching-methods/${id}`,{office:"CANYON TUMAN",title:"Wrong office"},"PUT")).status,404);
  assert.equal((await call("/api/coaching-methods?office=CANYON%20TUMAN")).data.methods.length,0);
  assert.equal((await call("/api/coaching-checklist/one")).data.methods[0].implemented,false);
  assert.equal((await call(`/api/coaching-checklist/one/${id}`,{implemented:true},"PUT")).data.updatedBy,"Test Coach");
  assert.equal((await call("/api/coaching-checklist/one")).data.methods[0].implemented,true);
  const training=await trainingCoaching("MADHAV MEHTA",["one","two"]);
  assert.equal(training.methods.length,1);
  assert.equal(training.checks.length,1);
  assert.equal(training.checks[0].repKey,"one");
  assert.equal(training.checks[0].implemented,true);
  assert.equal((await trainingCoaching("CANYON TUMAN",["one"])).checks.length,0);
  assert.equal((await call("/api/coaching-checklist/two")).data.methods[0].implemented,false);
  assert.equal((await call(`/api/coaching-checklist/other/${id}`,{office:"CANYON TUMAN",implemented:true},"PUT")).status,404);
  assert.equal((await call("/api/coaching-checklist/other?office=MADHAV%20MEHTA")).status,404);
  assert.equal((await call(`/api/coaching-checklist/one/${id}`,{implemented:"true"},"PUT")).status,400);
  assert.equal((await call(`/api/coaching-methods/${id}`,{active:false},"PUT")).status,200);
  assert.equal((await call("/api/coaching-checklist/one")).data.methods.length,0);
  assert.equal((await call(`/api/coaching-checklist/one/${id}`,{implemented:false},"PUT")).status,404);
  await call(`/api/coaching-methods/${id}`,{active:true},"PUT");
  assert.equal((await call("/api/coaching-checklist/one")).data.methods[0].implemented,true,"restore keeps prior checks");
  await call(`/api/coaching-checklist/one/${id}`,{implemented:false},"PUT");
  assert.equal((await call("/api/coaching-checklist/one")).data.methods[0].implemented,false);
 }finally{await closeCoachingDatabase();await new Promise(resolve=>server.close(resolve));}
});
