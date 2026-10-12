import { canonicalOffice } from "../offices.mjs";

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
      lastWeekElectric: electric, sourceFile: agent.trainingProduction?.sourceFile || ""}];
  }).sort((a,b) => (a.lastWeekElectric ?? -1) - (b.lastWeekElectric ?? -1) || a.repName.localeCompare(b.repName));
}
