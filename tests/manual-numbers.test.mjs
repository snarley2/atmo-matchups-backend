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
const {getManualNumbers,upsertManualNumbers}=await import('../server/sheets.mjs');
test('legacy manual rows retain metadata and gas partials round-trip through Supabase updates',async()=>{
 const old=['old-id','2026-10-12','Monday','CYD1-BXH-8448','Brennon Hill','Team',10,6,3,3,2,1,1,1,3,'Coach','created-original','updated-original'];
 tables.set('Manual Numbers',[Array.from({length:18},(_,i)=>'header'+i),old]);
 assert.equal((await getManualNumbers())[0].gasPartial,0);
 const entry={...(await getManualNumbers())[0],id:'new-id',gasPartial:4,totalSales:7,createdAt:'new-created',updatedAt:'new-updated'};
 await upsertManualNumbers(entry);
 const saved=(await getManualNumbers())[0];
 assert.equal(saved.gasPartial,4);assert.equal(saved.totalSales,7);assert.equal(saved.id,'old-id');assert.equal(saved.createdAt,'created-original');assert.equal(saved.updatedAt,'new-updated');
 assert.equal(tables.get('Manual Numbers')[0][18],'Gas Partials');assert.equal(tables.get('Manual Numbers').length,2);
 await upsertManualNumbers({...saved,gasPartial:5,totalSales:8});
 assert.equal((await getManualNumbers())[0].gasPartial,5);assert.equal(tables.get('Manual Numbers').length,2);
 assert.equal(tables.get('Manual Numbers')[1][15],'Coach');
 await closeSupabase();
});
