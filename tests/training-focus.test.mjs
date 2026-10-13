import test from "node:test";
import assert from "node:assert/strict";
import {attachFocusChecklist,focusGapKey,trainingWatch} from "../server/training.mjs";

test("recognizes all five funnel gaps and preserves unknown focus",()=>{
 for(const [label,key] of [["Talk → Stop","talkToStop"],["Stop -> Zip","stopToZip"],["Zip → Pres","zipToPresentation"],["Presentation → Info","presentationToInfo"],["Info → Close","infoToClose"]])assert.equal(focusGapKey(label),key);
 assert.equal(focusGapKey("On Target"),null);assert.equal(focusGapKey("Needs review"),null);
});

test("focus points use the matching gap, office and rep's saved checks",()=>{
 const methods=[
  {id:"a",office:"MADHAV MEHTA",active:true,gapKey:"talkToStop",title:"Confident opener",details:"Keep it clear."},
  {id:"b",office:"MADHAV MEHTA",active:true,gapKey:"talkToStop",title:"Make eye contact",details:""},
  {id:"c",office:"MADHAV MEHTA",active:true,gapKey:"stopToZip",title:"Ask for the ZIP",details:""},
  {id:"old",office:"MADHAV MEHTA",active:false,gapKey:"talkToStop",title:"Archived method"},
  {id:"other",office:"CANYON TUMAN",active:true,gapKey:"talkToStop",title:"Other office method"},
 ];
 const checks=[{repKey:"one",methodId:"a",implemented:true},{repKey:"one",methodId:"b",implemented:false},{repKey:"two",methodId:"b",implemented:true}];
 const rows=[{repKey:"one",office:"MADHAV MEHTA",focus:"Talk → Stop"},{repKey:"two",office:"MADHAV MEHTA",focus:"Talk → Stop"},{repKey:"three",office:"MADHAV MEHTA",focus:"Stop → Zip"}];
 const [one,two,three]=attachFocusChecklist(rows,{methods,checks});
 assert.deepEqual(one.focusChecklist.excelsAt.map(m=>m.id),["a"]);
 assert.deepEqual(one.focusChecklist.needsWork.map(m=>m.id),["b"]);
 assert.equal(one.focusChecklist.total,2);
 assert.deepEqual(two.focusChecklist.excelsAt.map(m=>m.id),["b"]);
 assert.deepEqual(two.focusChecklist.needsWork.map(m=>m.id),["a"]);
 assert.deepEqual(three.focusChecklist.needsWork.map(m=>m.id),["c"]);
 assert.equal(three.focusChecklist.excelsAt.length,0,"new methods begin unchecked");
 const unchecked=attachFocusChecklist([rows[0]],{methods,checks:[{repKey:"one",methodId:"a",implemented:false}]})[0];
 assert.equal(unchecked.focusChecklist.needsWork.length,2);
 assert.equal(attachFocusChecklist([{...rows[0],focus:"Needs review"}],{methods,checks})[0].focusChecklist,null);
 assert.equal(attachFocusChecklist([rows[0]])[0].focusChecklist.total,0);
});

test("checklist strengths do not change production eligibility or absence rules",()=>{
 const agent={repKey:"one",repName:"Example Rep",office:"MADHAV MEHTA",repType:"New Rep",attendance:"in",trainingProduction:{electric:10},stats:{"Biggest Gap Stage":"Talk → Stop"}};
 const rows=trainingWatch([agent,{...agent,repKey:"absent",attendance:"absent"},{...agent,repKey:"on-target",trainingProduction:{electric:20}}]);
 assert.equal(rows.length,1);
 const result=attachFocusChecklist(rows,{methods:[{id:"a",office:agent.office,active:true,gapKey:"talkToStop",title:"Opener"}],checks:[{repKey:agent.repKey,methodId:"a",implemented:true}]});
 assert.equal(result.length,1);assert.equal(result[0].lastWeekElectric,10);assert.equal(result[0].focusChecklist.excelsAt.length,1);
});
