import {canonicalOffice} from "../offices.mjs";
import * as storage from "./coaching-store.mjs";

export function registerCoachingRoutes(app,{requireAdmin,requestedOffice,getAgents,expandAgentsFromProduction,store=storage}){
  const wrap=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(error){next(error)}};
  const ensureRep=async(office,repKey)=>{
    const reps=expandAgentsFromProduction(await getAgents());
    const rep=reps.find(rep=>String(rep.repKey)===repKey&&canonicalOffice(rep.office)===office);
    if(!rep)throw Object.assign(new Error("Choose a rep from the selected office."),{status:404});return rep;
  };
  const validId=id=>{if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))throw Object.assign(new Error("Invalid method identifier."),{status:400});};
  app.get("/api/coaching-methods",requireAdmin,wrap(async(req,res)=>{
    res.json({gaps:storage.COACHING_GAPS,methods:await store.listMethods(requestedOffice(req))});
  }));
  app.post("/api/coaching-methods",requireAdmin,wrap(async(req,res)=>{
    res.status(201).json(await store.addMethod(requestedOffice(req),req.body));
  }));
  app.put("/api/coaching-methods/:id",requireAdmin,wrap(async(req,res)=>{
    validId(req.params.id);res.json(await store.updateMethod(requestedOffice(req),req.params.id,req.body));
  }));
  app.get("/api/coaching-checklist/:repKey",requireAdmin,wrap(async(req,res)=>{
    const office=requestedOffice(req),rep=await ensureRep(office,req.params.repKey);
    res.json({repKey:rep.repKey,methods:await store.repChecklist(office,req.params.repKey)});
  }));
  app.put("/api/coaching-checklist/:repKey/:methodId",requireAdmin,wrap(async(req,res)=>{
    const office=requestedOffice(req);validId(req.params.methodId);await ensureRep(office,req.params.repKey);
    res.json(await store.setRepMethod(office,req.params.repKey,req.params.methodId,req.body?.implemented,req.admin?.repName||"Admin"));
  }));
}
