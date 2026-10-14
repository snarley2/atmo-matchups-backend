import test from "node:test";
import assert from "node:assert/strict";
import {nameScore,uniqueNameMatch,normalizeRepId,productionRole,adminRole} from "../server/rep-identity.mjs";
import {migrateIdentityRows,syncProductionIdentities} from "../server/identity-migration.mjs";
import {combineAgentsAndGaps} from "../server/logic.mjs";
import {parseProductionRows} from "../server/production-csv.mjs";

test("IDs and two-part matching normalize safely and reject ambiguous names",()=>{
 assert.equal(normalizeRepId(" mxm - 1324 "),"MXM-1324");
 assert.equal(nameScore("Smith, John","John Michael Smith"),2);
 assert.equal(nameScore("John Smith","John Jones"),0);
 assert.equal(uniqueNameMatch([{repName:"John Michael Smith"},{repName:"John Avery Smith"}],"John Smith"),null);
 assert.equal(adminRole(productionRole("Assistant Manager")),true);
 assert.equal(adminRole(productionRole("Trainer")),true);
 assert.equal(adminRole(productionRole("Promoting Leader")),false);
});

test("ID linking preserves stable keys, trainer, settings, and references across repeated imports",()=>{
 const headers=["repKey","repName","office","repType","team","teamLead","trainer","attendance","experienceLevel","note"];
 const original=["old-uuid","John Michael Smith","MADHAV MEHTA","Trainer","Blue","Jane Coach","Jane Coach","absent","Vetted","Keep this note"];
 const tabs=[{title:"Agents",rows:[headers,original]},{title:"Work Matchups",rows:[["repKey","group"],["old-uuid",JSON.stringify({members:[{repKey:"old-uuid",trainer:"Jane Coach"}]})]]}];
 const records=[{office:"MADHAV MEHTA",repName:"John Smith",repId:"R-1234",repType:"Leader",keys:["johnsmith"],weekEnd:"2026-10-10"}];
 const result=migrateIdentityRows(tabs,records),row=result.tabs[0].rows[1];
 assert.equal(row[0],"old-uuid");assert.deepEqual(row.slice(1,original.length),original.slice(1));assert.equal(row.at(-1),"R-1234");
 assert.equal(result.tabs[1].rows[1][0],"old-uuid");assert.equal(JSON.parse(result.tabs[1].rows[1][1]).members[0].trainer,"Jane Coach");
 assert.equal(JSON.parse(result.tabs[1].rows[1][1]).members[0].repKey,"old-uuid");
 assert.equal(result.aliases.length,0);
 row[6]="Updated Coach";
 const repeated=migrateIdentityRows(result.tabs,records);
 assert.equal(repeated.tabs[0].rows[1][6],"Updated Coach");assert.equal(repeated.tabs[0].rows.length,2);
 assert.equal(tabs[0].rows[1][0],"old-uuid","input snapshot remains untouched");
});

test("migration never merges offices or ambiguous rep names",()=>{
 const headers=["repKey","repName","office","trainer"];
 const tabs=[{title:"Agents",rows:[headers,["a","John Michael Smith","MADHAV MEHTA","Coach One"],["b","John Avery Smith","MADHAV MEHTA","Coach Two"],["c","John Smith","CANYON TUMAN","Other Office"]]}];
 const result=migrateIdentityRows(tabs,[{office:"MADHAV MEHTA",repId:"R-42",repName:"John Smith",keys:["johnsmith"]}]);
 assert.deepEqual(result.tabs[0].rows.slice(1),tabs[0].rows.slice(1));assert(result.warnings.length>=1);
});

test("WorkMyT performance follows the unique matching name within its office",()=>{
 const agents=[{repKey:"R-1234",repName:"John Smith",office:"MADHAV MEHTA"}];
 const result=combineAgentsAndGaps(agents,[{"Rep Name":"John Michael Smith",Office:"MADHAV MEHTA","Biggest Gap Stage":"Talk → Stop"}],{lastWeek:[{"Rep Name":"Smith, John Michael",Office:"MADHAV MEHTA","Electric Sales":12},{"Rep Name":"John Smith",Office:"CANYON TUMAN","Electric Sales":99}]});
 assert.equal(result[0].stats["Biggest Gap Stage"],"Talk → Stop");assert.equal(result[0].performance.lastWeek.counts.electric,12);
});

test("production parser carries the actual Rep ID and source role",()=>{
 const header=Array(30).fill("");header[0]="Rep Name";header[1]="Position";header[2]="Rep ID";header[24]="TW Elec";header[25]="TW Gas";
 const row=Array(30).fill("");row[0]="John Smith";row[1]="Trainer";row[2]="r-1234";row[24]="8";row[25]="2";
 const [rep]=parseProductionRows([header,[],row],"AI production log - 10.10.2026.sheet");
 assert.equal(rep.repId,"R-1234");assert.equal(rep.repType,"Trainer");
});

test("failed identity publication rolls back rather than leaving partial IDs",async()=>{
 const calls=[];
 const connection={query:async(sql)=>{calls.push(sql);if(sql.startsWith("SELECT title"))return {rows:[{title:"Agents",rows:[["repKey","repName","office"],["old","John Smith","MADHAV MEHTA"]]}]};if(sql.startsWith("UPDATE public.project_tabs"))throw new Error("database failed");return {rows:[]}}};
 await assert.rejects(syncProductionIdentities(connection,[{office:"MADHAV MEHTA",repName:"John Smith",repId:"R-1234",keys:["johnsmith"]}]),/database failed/);
 assert.equal(calls.at(-1),"ROLLBACK");assert(!calls.includes("COMMIT"));
});
