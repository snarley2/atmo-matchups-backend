import {test} from 'node:test';import assert from 'node:assert/strict';
import {migrateIdentityRows} from '../server/identity-migration.mjs';
import {attachProductionLogs,setProductionLogRecords,expandAgentsFromProduction} from '../server/production-csv.mjs';
import {validateTrip,mondayOf} from '../server/roadtrips.mjs';
test('Agents ID links preserve keys, office, manual settings and all board references',()=>{
 const uuid='12345678-1234-1234-1234-123456789abc';const tabs=[{title:'Agents',rows:[['repKey','repName','office','trainer','attendance'],[uuid,'John Michael Smith','MADHAV MEHTA','My Coach','absent']]},{title:'Work Matchups',rows:[['data'],[JSON.stringify({members:[{repKey:uuid}]})]]}];
 const result=migrateIdentityRows(tabs,[{office:'MADHAV MEHTA',repName:'John Smith',repId:'CYD1-JXS-1234'}]);
 assert.equal(result.tabs[0].rows[1][0],uuid);assert.equal(result.tabs[0].rows[1][3],'My Coach');assert.equal(result.tabs[0].rows[1][4],'absent');assert.equal(result.tabs[0].rows[1][5],'CYD1-JXS-1234');assert.deepEqual(result.tabs[1],tabs[1]);assert.equal(result.aliases.length,0);
 assert.deepEqual(migrateIdentityRows(result.tabs,[]).tabs,result.tabs);
});
test('wrong-office empty duplicate is removed only with a verified production owner',()=>{
 const h=['repKey','repName','office','repType','team','trainer','attendance','experienceLevel'];const correct=['CYD1-JXS-1234','John Smith','MADHAV MEHTA','Trainer','My Team','Coach','in','Vetted'];const clone=['CYD1-JXS-1234','John Smith','COLLIN WILLHELM','Trainer','','','in','Newer'];
 const records=[{office:'MADHAV MEHTA',repName:'John Smith',repId:'CYD1-JXS-1234',repType:'Trainer'}];
 const cleaned=migrateIdentityRows([{title:'Agents',rows:[h,correct,clone]}],records);assert.equal(cleaned.tabs[0].rows.length,2);assert.equal(cleaned.tabs[0].rows[1][5],'Coach');
 clone[5]='Manual Trainer';const preserved=migrateIdentityRows([{title:'Agents',rows:[h,correct,clone]}],records);assert.equal(preserved.tabs[0].rows.length,3);
});
test('production uses Agents rep_id despite name variation and does not create virtual agents',()=>{
 const agents=[{repKey:'uuid',rep_id:'CYD1-JXS-1234',repName:'Different Nickname',office:'MADHAV MEHTA'}];
 setProductionLogRecords([{repId:'CYD1-JXS-1234',repName:'John Smith',keys:['johnsmith'],sourceFile:'AI production log - 10.10.2026.sheet',lastDay:{date:'2026-10-10',electric:5,partials:2,gas:3,production:334}}]);
 const result=attachProductionLogs(agents);assert.equal(result[0].productionLog.lastDay.production,334);assert.equal(result[0].repKey,'uuid');assert.equal(expandAgentsFromProduction(agents).length,1);
});
test('roadtrip schedules allow overlapping trips but only Monday through Saturday',()=>{
 assert.equal(mondayOf('2026-10-14'),'2026-10-12');assert.deepEqual(validateTrip({weekStart:'2026-10-14',name:'Trip',days:[1,3,6]}).days,[1,3,6]);
 for(const days of [[0],[7],[],[1,1]])assert.throws(()=>validateTrip({weekStart:'2026-10-12',name:'Trip',days}),error=>error.status===400);
});

import {liveWorkGroups} from '../server/work-state.mjs';
test('work boards hydrate current production and attendance and never mix office aliases',()=>{
 const agents=[{repKey:'id',repName:'John Smith',office:'MADHAV MEHTA',attendance:'in',productionLog:{lastDay:{electric:5,partials:2,gas:3}}},{repKey:'absent',repName:'Absent Rep',office:'MADHAV MEHTA',attendance:'absent'}];
 const groups=[{id:'team',office:'MADHAV MEHTA',members:[{repKey:'id',repName:'John Smith',office:'MADHAV MEHTA',production:1},{repKey:'absent',repName:'Absent Rep',office:'MADHAV MEHTA'}]},{id:'wrong',office:'COLLIN WILLHELM',members:[{repKey:'id',repName:'John Smith',office:'COLLIN WILLHELM'}]}];
 const result=liveWorkGroups(groups,agents);assert.equal(result[0].members.length,1);assert.equal(result[0].electric,7);assert.equal(result[0].production,334);assert.equal(result[1].members.length,0);
});
