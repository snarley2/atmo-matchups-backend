import crypto from "node:crypto";

const TRAINER_TYPES = new Set(["trainer", "manager"]);
const BLOCKED_REP_TYPES = new Set(["trainer", "manager", "absent"]);
const STORE_MENTOR_TYPES = new Set(["leader", "trainer", "manager", "admin", "owner", "director"]);
export const STORE_CATALOG = [
  { id: "walmart-carnegie", name: "Walmart- Carnegie", storeNumber: "5040", staffing: "Grocery", manager: "Lori", tier: "green" },
  { id: "walmart-gibsonia", name: "Walmart- Gibsonia", storeNumber: "", staffing: "Back of grocery", manager: "", tier: "yellow" },
  { id: "walmart-greensburg", name: "Walmart-Greensburg", storeNumber: "", staffing: "Middle of grocery", manager: "Christopher Glass", tier: "green" },
  { id: "walmart-connellsville", name: "Walmart- Connellsville", storeNumber: "", staffing: "Back of grocery", manager: "", tier: "red" },
  { id: "walmart-mt-pleasant", name: "Walmart- Mt. Pleasent", storeNumber: "", staffing: "Grocery", manager: "", tier: "yellow" },
  { id: "walmart-cranberry", name: "Walmart- Cranberry", storeNumber: "2603", staffing: "Electronics", manager: "", tier: "green" },
  { id: "walmart-hermitage", name: "Walmart- Hermitage", storeNumber: "1820", staffing: "Electronics", manager: "", tier: "yellow" },
  { id: "walmart-kittanning", name: "Walmart- Kittaning", storeNumber: "1883", staffing: "Grocery", manager: "Alicia Opel", tier: "yellow" },
  { id: "walmart-monaca", name: "Walmart- Monaca", storeNumber: "3738", staffing: "Electronics", manager: "Tony Solari / co-manager Kerry", tier: "green" },
  { id: "walmart-chippewa", name: "Walmart- Chippewa", storeNumber: "", staffing: "Grocery", manager: "Randy", tier: "green" },
  { id: "walmart-new-castle", name: "Walmart- New Castle", storeNumber: "2300", staffing: "Electronics / pets", manager: "Jon McPierson", tier: "green" },
  { id: "walmart-pittsburgh", name: "Walmart- Pittsburgh", storeNumber: "3838", staffing: "Electronics", manager: "Julian", tier: "green" },
  { id: "walmart-tarentum", name: "Walmart- Tarentum", storeNumber: "5339", staffing: "Electronics", manager: "Asst. Geoffery", tier: "green" },
  { id: "walmart-west-brownsville", name: "Walmart- West Brownsville", storeNumber: "", staffing: "Grocery", manager: "", tier: "yellow" },
  { id: "walmart-moon", name: "Walmart- Moon", storeNumber: "5381", staffing: "Electronics", manager: "", tier: "green" },
  { id: "walmart-washington", name: "Walmart- Washington", storeNumber: "", staffing: "Electronics", manager: "Store manager Mark", tier: "green" },
  { id: "walmart-indiana", name: "Walmart- Indiana", storeNumber: "1885", staffing: "Grocery", manager: "Nadine", tier: "yellow" },
  { id: "walmart-latrobe", name: "Walmart-Latrobe", storeNumber: "", staffing: "Grocery", manager: "", tier: "yellow" },
  { id: "walmart-waynesburg", name: "Walmart- Waynesburg", storeNumber: "", staffing: "Grocery", manager: "", tier: "yellow" },
  { id: "walmart-somerset", name: "Walmart-Somerset", storeNumber: "", staffing: "Meat section", manager: "", tier: "green" },
  { id: "walmart-uniontown", name: "Walmart-Uniontown", storeNumber: "", staffing: "Electronics", manager: "", tier: "green" },
  { id: "walmart-blairsville", name: "Walmart-Blairsville", storeNumber: "", staffing: "Electronics", manager: "", tier: "green" },
  { id: "walmart-belle-vernon", name: "Walmart-Belle Vernon", storeNumber: "", staffing: "Electronics", manager: "", tier: "green" },
  { id: "walmart-delmont", name: "Walmart-Delmont", storeNumber: "2193", staffing: "Grocery", manager: "", tier: "yellow" },
  { id: "steubenville", name: "Steubenville", storeNumber: "", staffing: "Grocery", manager: "", tier: "yellow" },
  { id: "east-liverpool", name: "East Liverpool", storeNumber: "", staffing: "Grocery", manager: "", tier: "green" },
  { id: "erie", name: "ERIE", storeNumber: "", staffing: "", manager: "", tier: "neutral" },
  { id: "titusville", name: "Titusville", storeNumber: "", staffing: "Grocery", manager: "", tier: "red" },
  { id: "warren", name: "Warren", storeNumber: "", staffing: "Grocery", manager: "", tier: "red" },
  { id: "corry", name: "Corry", storeNumber: "", staffing: "Grocery", manager: "", tier: "green" },
  { id: "west-ridge", name: "West Ridge", storeNumber: "", staffing: "Grocery", manager: "", tier: "green" },
  { id: "edinboro", name: "Edinboro", storeNumber: "", staffing: "Back of Grocery", manager: "", tier: "green" },
  { id: "harborcreek", name: "Harborcreek", storeNumber: "", staffing: "T in Grocery", manager: "", tier: "yellow" },
  { id: "elm-street", name: "Elm Street", storeNumber: "", staffing: "Grocery", manager: "", tier: "green" },
  { id: "grove-city", name: "Grove City", storeNumber: "", staffing: "Roam", manager: "", tier: "neutral" },
  { id: "greenville", name: "Greenville", storeNumber: "", staffing: "N/A", manager: "", tier: "green" },
  { id: "sams-club", name: "Sams Club", storeNumber: "", staffing: "", manager: "", tier: "neutral" },
  { id: "mt-nebo", name: "Mt. Nebo", storeNumber: "", staffing: "", manager: "", tier: "green" },
  { id: "tarentum", name: "Tarentum", storeNumber: "", staffing: "", manager: "", tier: "green" },
  { id: "monroeville", name: "Monroeville", storeNumber: "", staffing: "", manager: "", tier: "green" },
  { id: "west-mifflin", name: "West Mifflin", storeNumber: "", staffing: "Back of store by coffee", manager: "", tier: "green" },
  { id: "event", name: "EVENT", storeNumber: "", staffing: "Event", manager: "", tier: "neutral" },
  { id: "duncansville", name: "Duncansville", storeNumber: "", staffing: "Altoona", manager: "", tier: "yellow" },
  { id: "altoona-walmart", name: "Altoona Walmart", storeNumber: "", staffing: "Altoona", manager: "", tier: "green" },
  { id: "ebensburg", name: "Ebensburg", storeNumber: "", staffing: "Altoona", manager: "", tier: "yellow" },
  { id: "huntingdon", name: "Huntingdon", storeNumber: "", staffing: "Altoona", manager: "", tier: "green" },
  { id: "johnstown", name: "Johnstown", storeNumber: "", staffing: "Johnstown", manager: "", tier: "green" },
  { id: "sams-altoona", name: "Sam's Altoona", storeNumber: "", staffing: "Johnstown", manager: "", tier: "green" },
];
const GAP_DEFS = [
  { key: "talkToStop", label: "Talk → Stop", target: 0.50 },
  { key: "stopToZip", label: "Stop → Zip", target: 0.30 },
  { key: "zipToPresentation", label: "Zip → Presentation", target: 1.00 },
  { key: "presentationToInfo", label: "Presentation → Info", target: 0.30 },
  { key: "infoToClose", label: "Info → Close", target: 1.00 },
];

function clean(value) { return String(value ?? "").trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function num(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text) return 0;
  if (text.endsWith("%")) return Number(text.slice(0, -1)) || 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}
function pick(row, aliases) {
  const keys = Object.keys(row || {});
  const normalized = new Map(keys.map((key) => [lower(key).replace(/[^a-z0-9]/g, ""), key]));
  for (const alias of aliases) {
    const key = normalized.get(lower(alias).replace(/[^a-z0-9]/g, ""));
    if (key !== undefined && clean(row[key]) !== "") return row[key];
  }
  return "";
}
function rowName(row) { return lower(pick(row, ["Rep Name", "repName", "Name"])); }
function safeDivide(a, b) { return b > 0 ? a / b : null; }
function normalizeRecordedDate(value) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
function percent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return clean(value) || "—";
  const ratio = n > 1 ? n / 100 : n;
  return `${(ratio * 100).toFixed(1)}%`;
}
function periodDetails(row = {}) {
  const talks = num(pick(row, ["Talk", "Talks"]));
  const stops = num(pick(row, ["Stop", "Stops"]));
  const zips = num(pick(row, ["Zip", "Zips"]));
  const presentations = num(pick(row, ["Presentation", "Presentations", "Pres"]));
  const info = num(pick(row, ["Info", "Infos"]));
  const explicitClose = num(pick(row, ["Close", "Closes", "Sales", "Total Sales"]));
  const electric = num(pick(row, ["Electric Sale", "Electric Sales"]));
  const electricPartial = num(pick(row, ["Electric Partials", "Electric Partial Sales"]));
  const gas = num(pick(row, ["Gas Sale", "Gas Sales"]));
  const close = explicitClose || electric + electricPartial;
  const rate = (aliases, calculated) => {
    const raw = pick(row, aliases);
    return raw !== "" ? percent(raw) : percent(calculated);
  };
  const source = clean(pick(row, ["Data Source", "Source"])) || (Object.keys(row || {}).length ? "WorkMyT" : "No Data");
  const recordedDate = normalizeRecordedDate(pick(row, ["Recorded Date", "Date", "Last Worked Date", "Last Worked"]));
  return {
    source,
    recordedDate,
    counts: { talks, stops, zips, presentations, info, close, electric, electricPartial, gas },
    rates: {
      talkToStop: rate(["Talk → Stop", "Talk -> Stop"], safeDivide(stops, talks)),
      stopToZip: rate(["Stop → Zip", "Stop -> Zip"], safeDivide(zips, stops)),
      zipToPresentation: rate(["Zip → Presentation", "Zip -> Presentation", "Zip → Pres"], safeDivide(presentations, zips)),
      presentationToInfo: rate(["Presentation → Info", "Presentation -> Info", "Pres → Info"], safeDivide(info, presentations)),
      infoToClose: rate(["Info → Close", "Info -> Close"], safeDivide(close, info)),
    },
  };
}

export function combineAgentsAndGaps(agents, gaps, performance = {}) {
  const gapMap = new Map();
  for (const gap of gaps) {
    const name = rowName(gap);
    if (name) gapMap.set(name, gap);
  }
  const historyRows = Array.isArray(performance.lastWorkedHistory) ? performance.lastWorkedHistory : [];
  const maps = Object.fromEntries(Object.entries(performance).filter(([period]) => period !== "lastWorkedHistory").map(([period, rows]) => [period, new Map((rows || []).map((row) => [rowName(row), row]))]));
  return agents.map((agent) => {
    const name = lower(agent.repName);
    return {
      ...agent,
      stats: gapMap.get(name) || {},
      performance: {
        lastWorked: periodDetails(maps.lastWorked?.get(name)),
        currentWeek: periodDetails(maps.currentWeek?.get(name)),
        lastWeek: periodDetails(maps.lastWeek?.get(name)),
        twoWeeksAgo: periodDetails(maps.twoWeeksAgo?.get(name)),
        threeWeeksAgo: periodDetails(maps.threeWeeksAgo?.get(name)),
      },
      performanceHistory: historyRows
        .filter((row) => rowName(row) === name)
        .map((row) => ({ snapshotDate: normalizeRecordedDate(pick(row, ["Snapshot Date"])), ...periodDetails(row) }))
        .filter((item) => item.recordedDate)
        .sort((a, b) => String(b.recordedDate).localeCompare(String(a.recordedDate))),
    };
  });
}

function rateNumber(value) {
  const text = clean(value);
  if (!text || text === "—") return null;
  const parsed = Number(text.replace("%", ""));
  if (!Number.isFinite(parsed)) return null;
  return text.includes("%") || parsed > 1 ? parsed / 100 : parsed;
}

function averageGapRates(agent) {
  const periods = ["lastWorked", "currentWeek", "lastWeek"];
  return Object.fromEntries(GAP_DEFS.map((gap) => {
    const values = periods
      .map((period) => rateNumber(agent.performance?.[period]?.rates?.[gap.key]))
      .filter((value) => value !== null);
    return [gap.key, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  }));
}

const LEADER_WEEKLY_PERIODS = ["currentWeek", "lastWeek", "twoWeeksAgo", "threeWeeksAgo"];

function leaderGapConsistency(agent, gap) {
  const values = LEADER_WEEKLY_PERIODS
    .map((period) => rateNumber(agent.performance?.[period]?.rates?.[gap.key]))
    .filter((value) => value !== null);

  if (!values.length) {
    return {
      values: [],
      weeksWithData: 0,
      average: null,
      minimum: null,
      maximum: null,
      range: null,
      onTargetWeeks: 0,
      consistentOnTarget: false,
    };
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const onTargetWeeks = values.filter((value) => value >= gap.target).length;

  // Four-week consistency is preferred. With all four periods present,
  // 3+ on-target weeks plus an on-target average counts as consistently strong.
  // If one historical period has no data, require every available week on target.
  const requiredOnTarget = values.length >= 4 ? 3 : values.length;
  const consistentOnTarget =
    values.length >= 3 &&
    average >= gap.target &&
    onTargetWeeks >= requiredOnTarget;

  return {
    values,
    weeksWithData: values.length,
    average,
    minimum,
    maximum,
    range: maximum - minimum,
    onTargetWeeks,
    consistentOnTarget,
  };
}

function leaderConsistencyProfile(agent) {
  return Object.fromEntries(
    GAP_DEFS.map((gap) => [gap.key, leaderGapConsistency(agent, gap)])
  );
}

function focusForRep(agent) {
  const averages = averageGapRates(agent);
  const scored = GAP_DEFS
    .map((gap, index) => {
      const avg = averages[gap.key];
      if (avg === null) return null;
      return { ...gap, avg, index, ratio: avg / gap.target, shortfall: Math.max(0, gap.target - avg) };
    })
    .filter(Boolean);
  if (!scored.length) return { label: "Unassigned Focus", ratio: -1, shortfall: 0 };
  const below = scored.filter((item) => item.shortfall > 0);
  const chosen = (below.length ? below : scored)
    .sort((a, b) => b.shortfall - a.shortfall || a.ratio - b.ratio || a.index - b.index)[0];
  return { label: chosen.label, key: chosen.key, ratio: chosen.ratio, shortfall: chosen.shortfall };
}

function isPresent(agent) {
  // Attendance from the UI is the source of truth for auto-generation.
  // Only people explicitly marked "in" may be matched or selected to lead.
  return lower(agent?.attendance || "in") === "in";
}

function activeTrainees(agents) {
  return agents.filter((agent) => isPresent(agent) && !BLOCKED_REP_TYPES.has(lower(agent.repType)));
}

function activeTrainers(agents) {
  return agents.filter((agent) => TRAINER_TYPES.has(lower(agent.repType)) && isPresent(agent));
}

function chunkBalanced(reps, maxSize = 4) {
  const size = Math.max(2, Math.min(4, Number(maxSize) || 4));
  const groupCount = Math.max(1, Math.ceil(reps.length / size));
  const groups = Array.from({ length: groupCount }, () => []);
  reps.forEach((rep, index) => groups[index % groupCount].push(rep));
  return groups.filter((group) => group.length);
}

function lastWeekLeadershipSales(agent) {
  const counts = agent.performance?.lastWeek?.counts || {};
  const full = Number(counts.electric) || 0;
  const partial = Number(counts.electricPartial) || 0;
  return { full, partial, effective: full + partial * 0.5 };
}

function leadershipCandidates(agents, trainersOnly) {
  // Trainers/managers are leadership roles by definition and do not use the
  // Leadership Readiness field.
  const trainers = activeTrainers(agents).map((agent) => ({
    ...agent,
    _leaderKind: "trainer",
    _sales: lastWeekLeadershipSales(agent),
  }));

  if (trainersOnly) return trainers;

  // Regular reps and New Reps must NEVER enter the leader pool.
  // The only rep-level role that can auto-lead is an explicit Leader, and
  // Leaders must currently be marked Vetted.
  const leaders = agents
    .filter((agent) =>
      isPresent(agent) &&
      lower(agent.repType) === "leader" &&
      lower(agent.experienceLevel) === "vetted"
    )
    .map((agent) => ({
      ...agent,
      _leaderKind: "rep",
      _sales: lastWeekLeadershipSales(agent),
    }))
    .filter((agent) => agent._sales.effective >= 20);

  return [...trainers, ...leaders];
}

function leaderProfile(agent) {
  const consistency = leaderConsistencyProfile(agent);
  const onTarget = new Set();
  for (const gap of GAP_DEFS) {
    if (consistency[gap.key]?.consistentOnTarget) onTarget.add(gap.key);
  }
  return { agent, consistency, onTarget, breadth: onTarget.size };
}

function assignLeaders(groups, agents, trainersOnly) {
  const profiles = leadershipCandidates(agents, trainersOnly).map(leaderProfile);
  const used = new Set();

  // Assign the hardest-to-cover focus first. This leaves multi-gap stars available
  // to fill focuses that specialists cannot cover.
  const orderedGroups = groups.map((group, index) => {
    const def = GAP_DEFS.find((gap) => gap.label === group.focus);
    const specialistCount = def ? profiles.filter((profile) => profile.onTarget.has(def.key)).length : 0;
    return { group, index, def, specialistCount };
  }).sort((a, b) => a.specialistCount - b.specialistCount || a.index - b.index);

  for (const item of orderedGroups) {
    const available = profiles.filter((profile) => !used.has(profile.agent.repKey));
    if (!available.length) break;
    const key = item.def?.key;
    const target = item.def?.target || 1;
    const specialists = key ? available.filter((profile) => profile.onTarget.has(key)) : [];
    const pool = specialists.length ? specialists : available;
    pool.sort((a, b) => {
      // Narrow specialists get priority on the gaps they uniquely cover;
      // broadly excellent people remain flexible for later groups.
      if (specialists.length) {
        if (a.breadth !== b.breadth) return a.breadth - b.breadth;
      }
      const aConsistency = key ? a.consistency[key] : null;
      const bConsistency = key ? b.consistency[key] : null;

      // Prefer people who have actually been strong every week, not someone
      // whose four-week average is being carried by one unusually good week.
      const aWeeks = aConsistency?.weeksWithData || 0;
      const bWeeks = bConsistency?.weeksWithData || 0;
      if (bWeeks !== aWeeks) return bWeeks - aWeeks;

      const aOnTargetWeeks = aConsistency?.onTargetWeeks || 0;
      const bOnTargetWeeks = bConsistency?.onTargetWeeks || 0;
      if (bOnTargetWeeks !== aOnTargetWeeks) return bOnTargetWeeks - aOnTargetWeeks;

      const aMin = aConsistency?.minimum ?? -1;
      const bMin = bConsistency?.minimum ?? -1;
      if (bMin !== aMin) return bMin - aMin;

      const aRange = aConsistency?.range ?? Number.POSITIVE_INFINITY;
      const bRange = bConsistency?.range ?? Number.POSITIVE_INFINITY;
      if (aRange !== bRange) return aRange - bRange;

      const aAvg = aConsistency?.average ?? -1;
      const bAvg = bConsistency?.average ?? -1;
      if (bAvg !== aAvg) return bAvg - aAvg;

      const aTrainer = a.agent._leaderKind === "trainer" ? 1 : 0;
      const bTrainer = b.agent._leaderKind === "trainer" ? 1 : 0;
      if (bTrainer !== aTrainer) return bTrainer - aTrainer;

      const aRatio = aAvg >= 0 ? aAvg / target : -1;
      const bRatio = bAvg >= 0 ? bAvg / target : -1;
      return bRatio - aRatio || clean(a.agent.repName).localeCompare(clean(b.agent.repName));
    });
    const chosen = pool[0];
    item.group.coach = chosen.agent.repName;
    item.group.coachRepKey = chosen.agent.repKey;
    const chosenConsistency = key ? chosen.consistency[key] : null;
    item.group.coachMeta = {
      kind: chosen.agent._leaderKind,
      avgForFocus: chosenConsistency?.average !== null && chosenConsistency?.average !== undefined
        ? `${(chosenConsistency.average * 100).toFixed(1)}%`
        : "—",
      consistencyWeeks: chosenConsistency?.weeksWithData || 0,
      onTargetWeeks: chosenConsistency?.onTargetWeeks || 0,
      minimumWeekForFocus: chosenConsistency?.minimum !== null && chosenConsistency?.minimum !== undefined
        ? `${(chosenConsistency.minimum * 100).toFixed(1)}%`
        : "—",
      weeklyFocusRates: Object.fromEntries(
        LEADER_WEEKLY_PERIODS.map((period) => {
          const value = key ? rateNumber(chosen.agent.performance?.[period]?.rates?.[key]) : null;
          return [period, value === null ? "—" : `${(value * 100).toFixed(1)}%`];
        })
      ),
      lastWeekFullSales: chosen.agent._sales.full,
      lastWeekPartials: chosen.agent._sales.partial,
      effectiveFullSales: Math.round(chosen.agent._sales.effective * 10) / 10,
    };
    used.add(chosen.agent.repKey);
  }
  // A high-performing rep who is selected to lead should not also appear as a trainee.
  const repLeaderKeys = new Set(profiles
    .filter((profile) => used.has(profile.agent.repKey) && profile.agent._leaderKind === "rep")
    .map((profile) => profile.agent.repKey));
  if (repLeaderKeys.size) {
    groups.forEach((group) => {
      group.members = (group.members || []).filter((member) => !repLeaderKeys.has(member.repKey));
    });
  }
  return groups.filter((group) => (group.members || []).length > 0);
}

function buildGapGroups(reps, maxSize) {
  const buckets = new Map();
  for (const rep of reps) {
    const focus = focusForRep(rep).label;
    if (!buckets.has(focus)) buckets.set(focus, []);
    buckets.get(focus).push(rep);
  }
  const groups = [];
  for (const gap of [...GAP_DEFS.map((item) => item.label), "Unassigned Focus"]) {
    const bucket = buckets.get(gap) || [];
    bucket.sort((a, b) => {
      const af = focusForRep(a), bf = focusForRep(b);
      return bf.shortfall - af.shortfall || clean(a.repName).localeCompare(clean(b.repName));
    });
    for (const members of chunkBalanced(bucket, maxSize)) {
      groups.push({
        id: crypto.randomUUID(),
        name: `${gap.replaceAll(" → ", "-")} ${groups.filter((group) => group.focus === gap).length + 1}`,
        team: "Mixed",
        focus: gap,
        coach: "",
        members,
      });
    }
  }
  return groups;
}

function buildTeamGroups(reps, maxSize) {
  const teams = new Map();
  for (const rep of reps) {
    const team = clean(rep.team) || "Unassigned";
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push(rep);
  }
  const groups = [];
  for (const team of [...teams.keys()].sort((a, b) => a.localeCompare(b))) {
    const teamReps = teams.get(team);
    teamReps.sort((a, b) => focusForRep(a).label.localeCompare(focusForRep(b).label) || clean(a.repName).localeCompare(clean(b.repName)));
    for (const members of chunkBalanced(teamReps, maxSize)) {
      const focusCounts = new Map();
      members.forEach((member) => {
        const focus = focusForRep(member).label;
        focusCounts.set(focus, (focusCounts.get(focus) || 0) + 1);
      });
      const focus = [...focusCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Unassigned Focus";
      groups.push({
        id: crypto.randomUUID(),
        name: `${team} ${groups.filter((group) => group.team === team).length + 1}`,
        team,
        focus,
        coach: "",
        members,
      });
    }
  }
  return groups;
}

export function generateGroups(agents, options = {}) {
  const normalized = typeof options === "number" ? { groupSize: options } : options || {};
  // Auto-generated groups are capped at 4 total people INCLUDING the leader.
  // Reserve one seat for the coach by limiting the generated trainee side to 3.
  // Manual matchup editing remains unrestricted.
  const requestedSize = Math.max(2, Math.min(4, Number(normalized.groupSize || normalized.maxGroupSize || 4)));
  const traineeMaxSize = Math.min(3, requestedSize);
  const groupingMode = normalized.groupingMode === "team" ? "team" : "gaps";
  const trainersOnly = Boolean(normalized.trainersOnly);
  const reps = activeTrainees(agents);
  const groups = groupingMode === "team"
    ? buildTeamGroups(reps, traineeMaxSize)
    : buildGapGroups(reps, traineeMaxSize);
  return assignLeaders(groups, agents, trainersOnly);
}

const STORE_PRODUCTION_PERIODS = ["currentWeek", "lastWeek", "twoWeeksAgo", "threeWeeksAgo"];

function periodProduction(agent, period) {
  const counts = agent.performance?.[period]?.counts || {};
  const electric = Number(counts.electric) || 0;
  const partial = Number(counts.electricPartial) || 0;
  const close = Number(counts.close) || 0;
  if (electric > 0 || partial > 0) return electric + partial * 0.5;
  return close;
}

export function overallProduction(agent) {
  const csvOverall = Number(agent?.productionCsv?.overall);
  if (Number.isFinite(csvOverall)) return Math.round(csvOverall * 10) / 10;
  const weekly = STORE_PRODUCTION_PERIODS
    .map((period) => periodProduction(agent, period))
    .filter((value) => value > 0);
  if (!weekly.length) return 0;
  return Math.round((weekly.reduce((sum, value) => sum + value, 0) / weekly.length) * 10) / 10;
}

function trainerNameFor(agent, trainerNames) {
  // Store training follows the Agents sheet's Team Lead column. The older
  // Trainer column remains readable only as a backwards-compatible fallback.
  const teamLead = clean(agent.teamLead);
  if (teamLead && trainerNames.has(lower(teamLead))) return teamLead;
  const explicit = clean(agent.trainer);
  if (explicit && trainerNames.has(lower(explicit))) return explicit;
  return "";
}

function storeGroup(members, kind, index) {
  const memberRows = members.map((member) => ({
    ...member,
    production: overallProduction(member),
    trainer: clean(member.teamLead || member.trainer),
  }));
  const production = Math.round(memberRows.reduce((sum, member) => sum + member.production, 0) * 10) / 10;
  const store = STORE_CATALOG[index] || {};
  return {
    id: store.id || crypto.randomUUID(),
    name: store.name || `Store ${index + 1}`,
    storeNumber: store.storeNumber || "",
    staffing: store.staffing || "",
    manager: store.manager || "",
    tier: store.tier || "neutral",
    kind,
    priority: index + 1,
    production,
    members: memberRows,
  };
}

function standardStoreChunks(reps) {
  if (reps.length <= 3) return reps.length ? [reps] : [];
  const chunks = [];
  let cursor = 0;
  // Preserve the normal two-person store while avoiding a leftover solo rep.
  const pairUntil = reps.length % 2 === 1 ? reps.length - 3 : reps.length;
  while (cursor < pairUntil) {
    chunks.push(reps.slice(cursor, cursor + 2));
    cursor += 2;
  }
  if (cursor < reps.length) chunks.push(reps.slice(cursor));
  return chunks;
}

export function generateStoreGroups(agents = []) {
  const present = (agents || []).filter(isPresent);
  const trainers = present
    .filter((agent) => STORE_MENTOR_TYPES.has(lower(agent.repType)))
    .sort((a, b) => overallProduction(b) - overallProduction(a) || clean(a.repName).localeCompare(clean(b.repName)));
  const trainerNames = new Set(trainers.map((agent) => lower(agent.repName)));
  const trainerByName = new Map(trainers.map((agent) => [lower(agent.repName), agent]));
  const regularReps = present.filter((agent) => !STORE_MENTOR_TYPES.has(lower(agent.repType)) && lower(agent.repType) !== "absent");
  const traineesByTrainer = new Map();
  const remaining = [];

  for (const rep of regularReps) {
    const trainerName = trainerNameFor(rep, trainerNames);
    if (!trainerName) {
      remaining.push(rep);
      continue;
    }
    const key = lower(trainerName);
    if (!traineesByTrainer.has(key)) traineesByTrainer.set(key, []);
    traineesByTrainer.get(key).push({ ...rep, trainer: trainerByName.get(key)?.repName || trainerName });
  }

  const trainingStores = [];
  const usedTrainerKeys = new Set();
  for (const trainer of trainers) {
    const key = lower(trainer.repName);
    const trainees = (traineesByTrainer.get(key) || [])
      .sort((a, b) => overallProduction(b) - overallProduction(a) || clean(a.repName).localeCompare(clean(b.repName)));
    if (!trainees.length) {
      remaining.push(trainer);
      continue;
    }
    trainingStores.push([trainer, ...trainees.slice(0, 2)]);
    remaining.push(...trainees.slice(2));
    usedTrainerKeys.add(trainer.repKey);
  }

  // A stale text assignment should never make a rep disappear.
  for (const [key, trainees] of traineesByTrainer.entries()) {
    if (!trainerByName.has(key)) remaining.push(...trainees);
  }

  trainingStores.sort((a, b) => {
    const aScore = a.reduce((sum, rep) => sum + overallProduction(rep), 0);
    const bScore = b.reduce((sum, rep) => sum + overallProduction(rep), 0);
    return bScore - aScore || clean(a[0]?.repName).localeCompare(clean(b[0]?.repName));
  });

  const remainingUnique = [...new Map(
    remaining
      .filter((rep) => !usedTrainerKeys.has(rep.repKey))
      .map((rep) => [rep.repKey || lower(rep.repName), rep])
  ).values()].sort((a, b) => overallProduction(b) - overallProduction(a) || clean(a.repName).localeCompare(clean(b.repName)));

  const ordered = [
    ...trainingStores.map((members) => ({ members, kind: "Trainer / trainee" })),
    ...standardStoreChunks(remainingUnique).map((members) => ({ members, kind: members.length === 1 ? "Solo" : members.length === 3 ? "Three-person" : "Production" })),
  ];

  return ordered.map((group, index) => storeGroup(group.members, group.kind, index));
}
