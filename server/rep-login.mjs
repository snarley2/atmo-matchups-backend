import crypto from "node:crypto";
import {canonicalOffice} from "../offices.mjs";
import {getAgents} from "./sheets.mjs";
import {getProductionLogRecords,productionOffice,productionRepDirectory} from "./production-csv.mjs";
import {refreshProductionCache,synchronizeRepIdentities} from "./production-import.mjs";
import {normalizeRepId,validRepId,uniqueNameMatch,nameScore,adminRole} from "./rep-identity.mjs";

const generalId=()=>normalizeRepId(process.env.GENERAL_ADMIN_REP_ID||"MXM-1324");
const comparableId=value=>normalizeRepId(value).replace(/-/g,"");
export async function resolveRepLogin(value,office){
 const enteredId=normalizeRepId(value);
 const repId=enteredId;
 if(!repId)throw Object.assign(new Error("Enter your production Rep ID."),{status:400});
 if(comparableId(repId)===comparableId(generalId()))return {repKey:generalId(),repId:generalId(),repName:"General Admin",repType:"Admin",office:canonicalOffice(office),isAdmin:true,generalAdmin:true};
 const roster=(await getAgents()).filter(agent=>!office||canonicalOffice(agent.office)===canonicalOffice(office));
 const storedId=agent=>normalizeRepId(agent.rep_id||(/-\d+$/.test(agent.repKey||'')&&!/^(?:prod-|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(agent.repKey||'')?agent.repKey:''));
 let matches=roster.filter(agent=>storedId(agent)&&comparableId(storedId(agent))===comparableId(repId));
 if(!matches.length&&!repId.startsWith('CYD1-'))matches=roster.filter(agent=>comparableId(storedId(agent))===comparableId(`CYD1-${repId}`));
 const suffix=repId.match(/^(?:CYD1-)?(\d+)$/)?.[1];
 if(!matches.length&&suffix)matches=roster.filter(agent=>storedId(agent).startsWith('CYD1-')&&storedId(agent).split('-').at(-1)===suffix);
 if(!matches.length)throw Object.assign(new Error('Rep ID not found in Agents. Ask an admin to set your Rep ID in Attendance.'),{status:404});
 if(matches.length!==1)throw Object.assign(new Error('Rep ID matches more than one Agents row. Select your office or ask an admin to correct the Rep IDs.'),{status:409});
 const agent=matches[0],role=agent.repType||'New Rep';
 return {repKey:agent.repKey,repId:storedId(agent),repName:agent.repName,repType:role,office:canonicalOffice(agent.office),isAdmin:adminRole(role),generalAdmin:false};
}

export function registerRepLogin(app,{bearerToken,verifySessionToken,issueSessionToken}){
 const attempts=new Map();
 app.post("/api/auth/rep",async(req,res,next)=>{
  const key=req.ip||"unknown",now=Date.now(),recent=(attempts.get(key)||[]).filter(time=>now-time<60000);
  if(recent.length>=120)return res.status(429).json({error:"Too many attempts. Wait a minute and try again."});
  attempts.set(key,[...recent,now]);if(attempts.size>5000)for(const [key,times] of attempts)if(now-times.at(-1)>60000)attempts.delete(key);
  try{
   const user=await resolveRepLogin(req.body?.repId,req.body?.office);
   res.json({token:issueSessionToken(user),user});
  }catch(error){next(error)}
 });
 app.get("/api/auth/rep/me",async(req,res,next)=>{
  const session=verifySessionToken(bearerToken(req));
  if(!session)return res.status(401).json({error:"Please sign in with your Rep ID."});
  try{
   if(session.kind!=="rep")return res.json({user:{repKey:session.repKey,repName:session.repName,repType:session.role,isAdmin:adminRole(session.role)}});
   const user=await resolveRepLogin(session.repId,session.office);
   res.json({token:issueSessionToken(user),user});
  }catch(error){next(error)}
 });
}
