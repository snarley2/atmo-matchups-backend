import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrateIdentityRows} from '../server/identity-migration.mjs';
import {parseProductionRows} from '../server/production-csv.mjs';

test('production discovery appends each office once and preserves manual settings',()=>{
 const h=['repKey','repName','office','repType','trainer','attendance','rep_id'];
 const original=[{title:'Agents',rows:[h,['stable','Isaac Blawas','KEASEL BROOME','Trainer','Coach','absent','']]}];
 const records=[{office:'KEASEL BROOM',repName:'Blawas, Isaac'},{office:'KEASEL BROOME',repName:'Meghan Hart'},{office:'COLLIN WILHELM',repName:'Emily Davis'},{office:'COLLIN WILLHELM',repName:'Emily Davis'},{office:'COLLIN WILLHELM',repName:'Staffing Assignments'}];
 const result=migrateIdentityRows(original,records),rows=result.tabs[0].rows;
 assert.equal(rows.length,4);assert.deepEqual(rows[1],original[0].rows[1]);
 assert.equal(rows[2][2],'KEASEL BROOM');assert.equal(rows[3][2],'COLLIN WILLHELM');
 assert.match(rows[2][0],/^[a-f\d-]{36}$/);assert.equal(rows[2][5],'in');
 assert.deepEqual(migrateIdentityRows(result.tabs,records).tabs,result.tabs);
});
test('standard sheets without previous-week headers retain reps and reject operational headings',()=>{
 for(const prefix of ['Edmeston & Evans Production Log','Skye Production']){
  const names=prefix.includes('Evans')?['Broome, Keasel','Blawas, Isaac','Hart, Meghan']:['Davis, Emily','Kinzel, Kayla','Vose, William'];
  const records=parseProductionRows([['','October 4'],['Name','Electric','Gas'],...names.map(name=>[name,2,1]),['Minimum Standards Raised'],['Staffing Assignments'],['Tablet Inventory'],['Daily Total',6,3]],`${prefix} - 10.10.2026.sheet`);
  assert.deepEqual(records.map(r=>r.repName),names);assert.equal(records[0].weekElectric,2);
 }
});
test('AI sheets without detail rows retain their first rep and support initials',()=>{
 const records=parseProductionRows([['Rep Name','Role','Rep ID','SUN 4','','','TW Elec','TW Gas'],['J Smith','Trainer','CYD1-001',2,1,0,2,1],['Alex James Long Family Name Here','Rep','CYD1-002',1,0,0,1,0]],'AI production log - 10.10.2026.sheet');
 assert.deepEqual(records.map(r=>r.repName),['J Smith','Alex James Long Family Name Here']);assert.equal(records[0].repId,'CYD1-001');
});
