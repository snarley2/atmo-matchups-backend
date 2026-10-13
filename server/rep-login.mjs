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
 await refreshProductionCache();
 const officeRecords=getProductionLogRecords().filter(record=>validRepId(record.repId)&&(!office||productionOffice(record.sourceFile)===canonicalOffice(office)));
 let records=officeRecords.filter(record=>comparableId(record.repId)===comparableId(repId));
 if(!records.length&&!repId.startsWith("CYD1-"))records=officeRecords.filter(record=>comparableId(record.repId)===comparableId(`CYD1-${repId}`));
 const numericSuffix=repId.match(/^(?:CYD1-)?(\d+)$/)?.[1];
 if(!records.length&&numericSuffix)records=officeRecords.filter(record=>normalizeRepId(record.repId).startsWith("CYD1-")&&normalizeRepId(record.repId).split("-").at(-1)===numericSuffix);
 if(new Set(records.map(record=>comparableId(record.repId))).size>1)throw Object.assign(new Error("More than one rep has that ID number. Enter the initials and number after CYD1-, as shown in your production log."),{status:409});
 const offices=new Set(records.map(record=>productionOffice(record.sourceFile)));
 if(!records.length)throw Object.assign(new Error("Rep ID not found in the imported production sheets. Check your office or ask an admin to refresh production."),{status:404});
 if(offices.size!==1)throw Object.assign(new Error("This Rep ID appears in more than one office. Select your office."),{status:409});
 const selected=[...offices][0];
 const identities=[...new Map(records.map(record=>[record.keys?.at(-1)||record.repName,record])).values()];
 if(identities.length>1&&!identities.every(record=>uniqueNameMatch([identities[0]],record.repName)))throw Object.assign(new Error("This Rep ID is assigned to different reps in the source sheets. Ask an admin to correct it."),{status:409});
 const dateKey=record=>{const match=record.sourceFile.match(/(\d{2})\.(\d{2})\.(\d{4})/);return match?`${match[3]}-${match[1]}-${match[2]}`:""};
 const newest=[...records].sort((a,b)=>dateKey(b).localeCompare(dateKey(a)))[0];
 const source={...productionRepDirectory().find(rep=>rep.office===selected&&comparableId(rep.repId)===comparableId(newest.repId)),...newest};
 const agents=(await getAgents()).filter(agent=>canonicalOffice(agent.office)===selected);
 const agent=agents.find(agent=>comparableId(agent.repKey)===comparableId(source.repId))||uniqueNameMatch(agents,source.repName);
 if(!agent&&agents.some(candidate=>nameScore(candidate.repName,source.repName)>=2))throw Object.assign(new Error("More than one roster identity matches this Rep ID. Ask an admin to resolve the names."),{status:409});
 const role=adminRole(source.repType)?source.repType:adminRole(agent?.repType)?agent.repType:source.repType||agent?.repType||"New Rep";
 return {repKey:source.repId,repId:source.repId,repName:agent?.repName||source.repName,repType:role,office:selected,isAdmin:adminRole(role),generalAdmin:false};
}

export function registerRepLogin(app,{bearerToken,verifySessionToken,issueSessionToken}){
 const attempts=new Map();
 app.post("/api/auth/rep",async(req,res,next)=>{
  const key=req.ip||"unknown",now=Date.now(),recent=(attempts.get(key)||[]).filter(time=>now-time<60000);
  if(recent.length>=120)return res.status(429).json({error:"Too many attempts. Wait a minute and try again."});
  attempts.set(key,[...recent,now]);if(attempts.size>5000)for(const [key,times] of attempts)if(now-times.at(-1)>60000)attempts.delete(key);
  try{
   const user=await resolveRepLogin(req.body?.repId,req.body?.office);
   if(!user.generalAdmin)await synchronizeRepIdentities();
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
