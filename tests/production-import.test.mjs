import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_SOURCES} from "../production-sources.mjs";
import {productionWeekEnd,selectProductionTabs,fetchProductionSnapshots,saveProductionSnapshots} from "../server/production-import.mjs";
import {parseProductionRows,setProductionLogRecords,getProductionLogRecords,productionRepDirectory,attachTrainingProduction} from "../server/production-csv.mjs";

function grid(office){
  const ai=office==="MADHAV MEHTA",noctis=office==="CANYON TUMAN",start=ai?3:1,total=start+21;
  const header=Array(total+6).fill("");header[0]=ai?"Rep Name":"Name";
  for(let d=0;d<7;d++){
    header[start+3*d]=noctis||ai?`${["SUN","MON","TUE","WED","THUR","FRI","SAT"][d]} ${4+d}`:"Electric";
    if(!noctis&&!ai){header[start+d*3+1]="Gas";header[start+d*3+2]="Partials";}
  }
  header[total]=noctis?"T Ele":ai?"TW Elec":"Electric";
  header[total+1]=noctis?"T Gas":ai?"TW Gas":"Gas";
  header[total+2]=noctis?"LW T El":ai?"LW Elec":"Prev. Week";
  if(noctis||ai)header[total+3]=noctis?"LW T Gas":"LW Gas";
  const detail=Array(total+6).fill("");if(ai)for(let d=0;d<7;d++)detail[start+d*3+2]="P";
  const row=Array(total+6).fill("");row[0]="Example Person";
  row[start]="0";row[start+3]="x";row[start+6]="2";row[start+7]="1";row[start+8]="1";
  row[total]="3";row[total+1]="1";row[total+2]=noctis||ai?"18":"18/2";
  row[total+3]="2";
  return ai?[header,detail,row]:[header,row];
}

test("compact titles, previous years and year rollover pick the two correct weeks",()=>{
  for(const title of ["101726","1017"])assert.equal(productionWeekEnd(title,"2026-10-12"),"2026-10-17");
  assert.equal(productionWeekEnd("103","2026-10-12"),"2026-10-03");
  assert.equal(productionWeekEnd("10.10.26","2026-10-12"),"2026-10-10");
  assert.equal(productionWeekEnd("1227","2026-01-02"),"2025-12-27");
  assert.equal(productionWeekEnd("SETTINGS","2026-10-12"),null);
  const sheets=["1017","1010","103","NRG_RAW","1024"].map((title,sheetId)=>({properties:{title,sheetId}}));
  assert.deepEqual(selectProductionTabs(sheets,"2026-10-12").map(t=>t.weekEnd),["2026-10-17","2026-10-10"]);
});

test("all office layouts retain zeros, absence, partials and weekly totals",()=>{
  for(const source of PRODUCTION_SOURCES){
    const records=parseProductionRows(grid(source.office),`${source.prefix} - 10.10.2026.sheet`);
    assert.equal(records.length,1,source.office);
    assert.equal(records[0].weekElectric,3);assert.equal(records[0].weekGas,1);
    assert.equal(records[0].days.length,3);
    assert.equal(records[0].days[0].worked,true);assert.equal(records[0].days[0].production,0);
    assert.equal(records[0].days[1].worked,false);
    assert.equal(records[0].days[2].production,138);
  }
});

test("Sheets snapshots cover four offices and reject empty source before publication",async()=>{
  const client={spreadsheets:{get:async()=>({data:{sheets:["1017","1010","103","Notes"].map((title,sheetId)=>({properties:{title,sheetId}}))}}),values:{get:async({spreadsheetId})=>({data:{values:grid(PRODUCTION_SOURCES.find(s=>s.spreadsheetId===spreadsheetId).office)}})}}};
  const snapshots=await fetchProductionSnapshots(client,"2026-10-12");
  assert.equal(snapshots.length,8);assert.equal(new Set(snapshots.map(s=>s.office)).size,4);
  setProductionLogRecords(snapshots.flatMap(s=>s.records));
  assert.equal(productionRepDirectory().length,4,"same name is isolated by office");
  const agent={repName:"Example Person",office:"MADHAV MEHTA"};
  assert.equal(attachTrainingProduction([agent],"2026-10-12")[0].trainingProduction.electric,3);
  assert.equal(getProductionLogRecords().length,8);
  client.spreadsheets.values.get=async()=>({data:{values:[]}});
  await assert.rejects(fetchProductionSnapshots(client,"2026-10-12"),/no valid reps/);
});

test("publication replaces daily/week rows inside a transaction and rolls back on failure",async()=>{
  const source=PRODUCTION_SOURCES[0];
  const snapshot={...source,weekEnd:"2026-10-10",sheetId:7,title:"101026",rows:grid(source.office),records:parseProductionRows(grid(source.office),`${source.prefix} - 10.10.2026.sheet`)};
  const queries=[];
  await saveProductionSnapshots({query:async(sql,args)=>{queries.push([sql,args]);}},[snapshot]);
  assert.equal(queries[0][0],"BEGIN");assert.equal(queries.at(-1)[0],"COMMIT");
  assert.equal(queries.filter(([sql])=>sql.startsWith("INSERT INTO public.production_days")).length,3);
  const weekly=queries.find(([sql])=>sql.startsWith("INSERT INTO public.production_weekly_reps"));
  assert.equal(weekly[1].at(-1),138,"weekly totals already include partials; do not count twice");
  const failed=[];
  await assert.rejects(saveProductionSnapshots({query:async(sql)=>{failed.push(sql);if(sql.startsWith("INSERT"))throw new Error("write failed");}},[snapshot]),/write failed/);
  assert.equal(failed.at(-1),"ROLLBACK");assert(!failed.includes("COMMIT"));
});
