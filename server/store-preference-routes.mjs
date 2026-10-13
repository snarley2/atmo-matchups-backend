import {canonicalOffice,OFFICES} from '../offices.mjs';
import * as storage from './store-preferences.mjs';
export function registerStorePreferenceRoutes(app,{requireAdmin,resolveRepLogin,getAgents,expandAgentsFromProduction,getWorkMatchups,catalog,io,today,store=storage}){
 const wrap=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(error){next(error)}};
 const scope=req=>{const value=req.query.office||req.body?.office||'ALL';if(value==='ALL')return value;const office=canonicalOffice(value);if(!OFFICES.some(item=>item.name===office))throw Object.assign(new Error('Choose a valid office.'),{status:400});return office};
 app.get('/api/store-preferences',wrap(async(req,res)=>res.json({preferences:await store.listPreferences()})));
 app.put('/api/store-preferences/:repKey',wrap(async(req,res)=>{
  // Resolve the authenticated identity again; never trust a role from the body.
  const user=await resolveRepLogin(req.user.repId,req.user.office);
  const repKey=String(req.params.repKey),office=canonicalOffice(req.body?.office||user.office);
  if(!user.isAdmin&&(repKey!==String(user.repKey)||office!==user.office))return res.status(403).json({error:'You can only edit your own top five stores.'});
  const rep=expandAgentsFromProduction(await getAgents()).find(rep=>String(rep.repKey)===repKey&&canonicalOffice(rep.office)===office);
  if(!rep)return res.status(404).json({error:'Choose a rep from this office.'});
  const storeIds=storage.validateStorePreferences(req.body?.storeIds,catalog);
  const saved=await store.savePreferences(office,repKey,storeIds);io.emit('store-preferences:updated');res.json(saved);
 }));
 app.get('/api/store-next-up',wrap(async(req,res)=>res.json(await store.getNextUp(scope(req),today()))));
 app.put('/api/store-next-up',requireAdmin,wrap(async(req,res)=>{
  const selectedScope=scope(req),teamId=String(req.body?.teamId||'');
  const {groups=[]}=await getWorkMatchups();
  if(teamId&&!groups.some(team=>String(team.id)===teamId&&(selectedScope==='ALL'||(team.office&&canonicalOffice(team.office)===selectedScope)||(team.members||[]).some(rep=>rep.office&&canonicalOffice(rep.office)===selectedScope))))return res.status(400).json({error:'Choose a work team in this office.'});
  const saved=await store.setNextUp(selectedScope,today(),teamId);io.emit('store-preferences:updated');res.json(saved);
 }));
}
