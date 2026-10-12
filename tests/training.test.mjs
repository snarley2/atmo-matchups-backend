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

test("training reads weekly totals rather than the last day's store production", () => {
  const agents=[{repKey:"test",repName:"Brennon Hill",office:"MADHAV MEHTA",repType:"New Rep"}];
  const [previous] = attachTrainingProduction(agents,"2026-10-04");
  assert.equal(previous.trainingProduction.weekEnd,"2026-10-03");
  assert.equal(previous.trainingProduction.electric,20);
  assert.equal(trainingWatch([previous]).length,0);
  const [latest] = attachTrainingProduction(agents,"2026-10-11");
  assert.equal(latest.trainingProduction.weekEnd,"2026-10-10");
  assert.equal(latest.trainingProduction.electric,8);
  assert.equal(trainingWatch([latest]).length,1);
});
