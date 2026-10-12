import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const tables=new Map();
let failWrite=false, committed=0, rolledBack=0;
class Pool {
  async connect(){
    let before;
    return {query:async (sql,args=[])=>{
      if(sql==='BEGIN'){before=structuredClone(tables);return {};}
      if(sql==='COMMIT'){committed++;return {};}
      if(sql==='ROLLBACK'){rolledBack++;tables.clear();for(const [k,v] of before)tables.set(k,v);return {};}
      if(sql.includes('pg_advisory_xact_lock'))return {};
      if(sql.startsWith('SELECT rows')){const rows=tables.get(args[0]);return {rowCount:rows?1:0,rows:rows?[{rows:structuredClone(rows)}]:[]};}
      if(sql.startsWith('INSERT INTO')){if(failWrite)throw new Error('simulated database write failure');tables.set(args[0],JSON.parse(args[1]));return {};}
      if(sql.startsWith('SELECT title'))return {rows:[...tables.keys()].sort().map(title=>({title}))};
      throw new Error('Unexpected SQL: '+sql);
    },release(){}};
  }
  async query(sql,args){const c=await this.connect();return c.query(sql,args);}
  async end(){}
}
mock.module('pg',{defaultExport:{Pool}});
process.env.SUPABASE_DB_URL='postgres://test-only';
delete process.env.GOOGLE_SHEET_ID;
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
const {supabaseSheetsClient,closeSupabase}=await import('../server/supabase-sheets-client.mjs');
const {writeOutputToSupabase}=await import('../last-day-worked.mjs');
const {writeWeeklyOutputToSupabase}=await import('../run-week-days-fix.mjs');
const {run:generateGaps}=await import('../generate-team-rep-gaps.mjs');
const {run:importAgents}=await import('../write-agents-to-sheet.mjs');
const api=supabaseSheetsClient().spreadsheets.values;
const perf={workedHours:7,talk:100,stops:50,zips:15,presentations:15,info:5,electricSales:3,gasSales:2,electricPartials:1,gasPartials:0};
const rep={repName:'Example Rep',office:'CANYON TUMAN',lastWorkedDate:'2026-10-10',daysSinceLastWorked:1,inactivityFlag:'none',performance:perf};
const generatedAt='2026-10-12T03:20:00Z';

test('direct collectors persist history, four weekly periods and gaps without Google credentials',async()=>{
  tables.set('Agents',[['repKey','repName','office','repType','team','teamLead','trainer','attendance','experienceLevel'],['existing','Example Rep','CANYON TUMAN','Leader','Example Team','Coach','Coach','absent','Vetted']]);
  const roster=structuredClone(tables.get('Agents'));
  await writeOutputToSupabase({generatedAt,reps:[rep]},[{...perf,repName:rep.repName,office:rep.office,date:rep.lastWorkedDate}]);
  const snapshot=structuredClone(tables.get('Last Worked'));
  await writeOutputToSupabase({generatedAt,reps:[rep]},[{...perf,repName:rep.repName,office:rep.office,date:'2026-10-09'}],{historyOnly:true});
  assert.deepEqual(tables.get('Last Worked'),snapshot);
  assert.equal(tables.get('Last Worked History').length,3);
  for(const title of ['Current Week Avg','Last Week Avg','2 Weeks Ago Avg','3 Weeks Ago Avg']){
    await writeWeeklyOutputToSupabase({generatedAt,weekLabel:title,reps:[rep,{...rep,repName:'Second Rep'}]},title);
    await writeWeeklyOutputToSupabase({generatedAt,weekLabel:title,reps:[rep]},title);
    assert.equal(tables.get(title).length,2,'shrinking snapshots remove old rows');
    const rows=tables.get(title), col=rows[0].indexOf('Electric Sales');
    assert.equal(rows[1][col],3);
  }
  await generateGaps();
  assert.equal(tables.get('Team/Rep Gaps').length,2);
  assert(tables.get('Team/Rep Gaps')[1].includes('Example Team'));
  assert(tables.get('Team/Rep Gaps')[1].includes('CANYON TUMAN'));
  assert.deepEqual(tables.get('Agents'),roster,'manual attendance and assignments survive');
  assert(committed>0);
  await closeSupabase();
});

test('discovery only appends new reps and preserves existing attendance and assignments',async()=>{
  const before=structuredClone(tables.get('Agents'));
  await writeOutputToSupabase({generatedAt,reps:[rep,{...rep,repName:'New Workmyt Rep'}]},[]);
  await importAgents();
  await importAgents();
  const roster=tables.get('Agents');
  assert.deepEqual(roster.slice(0,before.length),before);
  assert.equal(roster.length,before.length+1);
  assert.equal(roster.at(-1)[1],'New Workmyt Rep');
  assert.equal(roster.at(-1)[2],'CANYON TUMAN');
  await closeSupabase();
});

test('failed snapshot publication rolls back and preserves the old report',async()=>{
  const old=structuredClone(tables.get('Last Worked'));
  failWrite=true;
  await assert.rejects(api.replace({range:"'Last Worked'!A1",requestBody:{values:[['bad']]}}),/simulated/);
  failWrite=false;
  assert.deepEqual(tables.get('Last Worked'),old);
  assert(rolledBack>0);
  await closeSupabase();
});

test('scheduled collection has no Sheets bridge or Google client',async()=>{
  for(const file of ['last-day-worked.mjs','run-week-days-fix.mjs','generate-team-rep-gaps.mjs','generate-matchups-with-overrides.mjs','write-agents-to-sheet.mjs']){
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert(!/googleapis|google\.sheets\(|GoogleAuth/.test(source),file);
  }
  assert(!(await readFile(new URL('../run.mjs',import.meta.url),'utf8')).includes('scripts/sync-workmyt-to-supabase.mjs'));
});
