import { canonicalOffice } from "../offices.mjs";

export function focusGapKey(value){
  const text=String(value||"").toLowerCase();
  if(/talk.*stop/.test(text))return "talkToStop";
  if(/stop.*zip/.test(text))return "stopToZip";
  if(/zip.*pres/.test(text))return "zipToPresentation";
  if(/pres.*info/.test(text))return "presentationToInfo";
  if(/info.*close/.test(text))return "infoToClose";
  return null;
}
export function attachFocusChecklist(reps,{methods=[],checks=[]}={}){
  const byRepMethod=new Map(checks.map(check=>[`${check.repKey}|${check.methodId}`,check]));
  return reps.map(rep=>{
    const gapKey=focusGapKey(rep.focus);
    if(!gapKey)return {...rep,focusChecklist:null};
    const points=methods.filter(method=>method.active&&method.gapKey===gapKey&&canonicalOffice(method.office)===canonicalOffice(rep.office)).map(method=>{
      const check=byRepMethod.get(`${rep.repKey}|${method.id}`);
      return {id:method.id,title:method.title,details:method.details,implemented:check?.implemented===true,updatedAt:check?.updatedAt||null,updatedBy:check?.updatedBy||null};
    });
    return {...rep,focusChecklist:{gapKey,total:points.length,excelsAt:points.filter(point=>point.implemented),needsWork:points.filter(point=>!point.implemented)}};
  });
}

// Roles come from Attendance. Missing production is shown for coaching review,
// rather than silently treating an unknown week as recorded zero sales.
export function trainingWatch(agents, { office, mode = "both", threshold = 20 } = {}) {
  const selected = canonicalOffice(office);
  return agents.filter(agent => canonicalOffice(agent.office) === selected).flatMap(agent => {
    if (String(agent.attendance || "in").trim().toLowerCase() !== "in") return [];
    const role = String(agent.repType || "New Rep").trim();
    const leader = /leader|^(?:pl|l)$/i.test(role);
    const newer = /new|trainee|rookie|^rep$/i.test(role);
    if (/trainer|manager|owner|director|admin/i.test(role) || !(leader || newer)) return [];
    if ((mode === "new" && !newer) || (mode === "leaders" && !leader)) return [];
    const electric = agent.trainingProduction?.electric ?? null;
    if (electric !== null && electric >= threshold) return [];
    const stats = agent.stats || {};
    const focus = stats["Biggest Gap Stage"] || stats["Primary Gap"] || stats["Last Week Gap"] || "Needs review";
    return [{repKey: agent.repKey, repName: agent.repName, office: selected, role, focus,
      lastWeekElectric: electric,lastWeekGas:agent.trainingProduction?.gas ?? null,lastWeekProduction:agent.trainingProduction?.production ?? null, weekEnd:agent.trainingProduction?.weekEnd || "",
      currentWeekElectric:agent.trainingProduction?.currentWeekElectric ?? null,currentWeekGas:agent.trainingProduction?.currentWeekGas ?? null,currentWeekProduction:agent.trainingProduction?.currentWeekProduction ?? null,currentWeekEnd:agent.trainingProduction?.currentWeekEnd || "", sourceFile: agent.trainingProduction?.sourceFile || ""}];
  }).sort((a,b) => (a.lastWeekElectric ?? -1) - (b.lastWeekElectric ?? -1) || a.repName.localeCompare(b.repName));
}
