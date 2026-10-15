import {canonicalOffice} from '../offices.mjs';
export const sameProfileRep=(item,rep)=>String(item.repKey||'')===String(rep.repKey)&&(!item.office||canonicalOffice(item.office)===canonicalOffice(rep.office));
export function profileAssignments(rep,work,stores,coaching,final){
 const includes=group=>(group.members||[]).some(member=>sameProfileRep(member,rep))||(group.leader&&sameProfileRep(group.leader,rep));
 const workTeams=(work.groups||[]).filter(includes);
 const teamIds=new Set(workTeams.map(team=>String(team.id)));
 return {workTeams,workDate:work.date||'',stores:(stores.groups||[]).filter(store=>(store.teamIds||[]).some(id=>teamIds.has(String(id)))||includes(store)),storeDate:stores.date||'',coachingGroups:(coaching.groups||[]).filter(includes),coachingDate:coaching.date||'',finalGroups:(final.groups||[]).filter(includes),finalDate:final.date||''};
}
export function registerRepProfileRoutes(app,{loadReps,resolveRepLogin,requestedOffice,refreshProductionCache,getFieldNotes,getManualNumbers,repChecklist,listPreferences,getWorkMatchups,getStoreMatchups,getDraftMatchups,getFinalMatchups,getResponsibilityHistory=async()=>[],catalog}){
 app.get('/api/rep-profile/:repKey',async(req,res,next)=>{
  try{
   const office=requestedOffice(req);await refreshProductionCache();
   const rep=(await loadReps(office)).find(rep=>String(rep.repKey)===req.params.repKey&&canonicalOffice(rep.office)===office);
   if(!rep)return res.status(404).json({error:'Rep not found in this office.'});
   const user=await resolveRepLogin(req.user.repId,req.user.office);
   const privateAccess=user.isAdmin||(String(user.repKey)===String(rep.repKey)&&user.office===office);
   const sources={responsibilities:()=>getResponsibilityHistory(rep.repKey,office),work:()=>getWorkMatchups(),stores:()=>getStoreMatchups(),draft:()=>getDraftMatchups(office),final:()=>getFinalMatchups(office),preferences:()=>listPreferences()};
   if(privateAccess)Object.assign(sources,{notes:()=>getFieldNotes(),manual:()=>getManualNumbers(),checklist:()=>repChecklist(office,rep.repKey)});
   const names=Object.keys(sources),results=await Promise.allSettled(names.map(name=>sources[name]()));
   const data={},warnings=[];
   results.forEach((result,index)=>{if(result.status==='fulfilled')data[names[index]]=result.value;else warnings.push(`${names[index]} could not be loaded. Try refreshing the profile.`)});
   res.json({rep,privateAccess,responsibilities:data.responsibilities||[],...profileAssignments(rep,data.work||{},data.stores||{},data.draft||{},data.final||{}),notes:privateAccess?(data.notes||[]).filter(item=>sameProfileRep(item,rep)).sort((a,b)=>String(b.date).localeCompare(String(a.date))):[],manualEntries:privateAccess?(data.manual||[]).filter(item=>sameProfileRep(item,rep)).sort((a,b)=>String(b.date).localeCompare(String(a.date))):[],checklist:data.checklist||[],storePreferences:(data.preferences||[]).find(item=>sameProfileRep(item,rep))?.storeIds||[],catalog,warnings});
  }catch(error){next(error)}
 });
}
