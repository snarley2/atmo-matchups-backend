import test from "node:test";
import assert from "node:assert/strict";
import { OFFICES, canonicalOffice } from "../offices.mjs";
import { attachTrainingProduction } from "../server/production-csv.mjs";
import { trainingWatch } from "../server/training.mjs";

test("all selectable offices retain separate identities", () => {
  assert.equal(OFFICES.length, 4);
  for (const office of OFFICES) assert.equal(canonicalOffice(office.name), office.name);
  assert.equal(canonicalOffice("COLLIN WILHELM"), "COLLIN WILLHELM");
  assert.equal(canonicalOffice("KEASEL BROOME"), "KEASEL BROOM");
  assert.equal(canonicalOffice("Unknown Office"), "UNKNOWN OFFICE");
});

test("training filters offices, roles and recorded zero without losing unknown weeks", () => {
  const rep = (repKey, repType, electric, office="MADHAV MEHTA") => ({repKey, repName:repKey, repType, office, trainingProduction:{electric}});
  const reps = [rep("zero","New Rep",0), rep("below","Leader",19), rep("target","Leader",20), rep("trainer","Trainer",0), rep("other","New Rep",0,"KEASEL BROOM"), rep("unknown","New Rep",null)];
  assert.deepEqual(trainingWatch(reps,{mode:"leaders"}).map(r=>r.repKey), ["below"]);
  assert.deepEqual(trainingWatch(reps,{mode:"new"}).map(r=>r.repKey), ["unknown","zero"]);
  assert.equal(trainingWatch(reps).length,3);
  assert.equal(trainingWatch(reps,{threshold:0}).length,1);
});

test("uploaded totals remain the baseline Sunday and Monday", () => {
  const agents=[{repKey:"test",repName:"Brennon Hill",office:"MADHAV MEHTA",repType:"New Rep"}];
  for (const day of ["2026-10-11", "2026-10-12"]) {
    const [rep] = attachTrainingProduction(agents,day);
    assert.equal(rep.trainingProduction.weekEnd,"2026-10-10");
    assert.equal(rep.trainingProduction.electric,24);
    assert.equal(trainingWatch([rep]).length,0);
  }
});

test("Monday rollover, conflicting carry-forward, missing and stale logs", () => {
  const agent={repKey:"test",repName:"Example Rep",office:"MADHAV MEHTA",repType:"Leader"};
  const record=(week,electric,lastWeek=null)=>({repName:agent.repName,keys:["examplerep"],sourceFile:`AI production log - 10.${week}.26.tsv`,weekElectric:electric,lastWeek});
  const completed=record("10",24), newWeek=record("17",0,5);
  const get=(day,records)=>attachTrainingProduction([agent],day,records)[0];
  assert.equal(get("2026-10-11",[completed]).trainingProduction.electric,24);
  assert.equal(get("2026-10-12",[newWeek,completed]).trainingProduction.electric,24);
  assert.equal(get("2026-10-12",[completed,newWeek]).trainingProduction.currentWeekElectric,0);
  assert.equal(trainingWatch([get("2026-10-12",[completed,newWeek])]).length,0);
  assert.equal(get("2026-10-18",[completed,newWeek]).trainingProduction.weekEnd,"2026-10-17");
  assert.equal(trainingWatch([get("2026-10-18",[completed,newWeek])]).length,1);
  const carried=get("2026-10-12",[record("17",1,12)]);
  assert.equal(carried.trainingProduction.electric,12);
  assert.equal(carried.trainingProduction.weekEnd,"2026-10-10");
  assert.equal(get("2026-10-12",[record("17",1,null)]).trainingProduction.electric,null);
  const stale=get("2026-10-18",[completed]);
  assert.equal(stale.trainingProduction.weekEnd,"2026-10-10");
  assert.equal(stale.trainingProduction.electric,24);
  assert.equal(trainingWatch([{...carried,attendance:"absent"}]).length,0);
});
