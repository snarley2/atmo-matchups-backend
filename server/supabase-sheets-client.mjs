// Compatibility layer for the existing tab-oriented storage API.
// All writes are PostgreSQL transactions; no Google Sheets calls.
import pg from 'pg';
const { Pool } = pg;
let pool;
function db() {
  if (!pool) {
    if (!process.env.SUPABASE_DB_URL) throw new Error('Missing SUPABASE_DB_URL');
    pool = new Pool({connectionString: process.env.SUPABASE_DB_URL,
      ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: process.env.SUPABASE_DB_SSL_VERIFY === 'true' }});
  }
  return pool;
}
const clean = v => String(v ?? '');
const clone = rows => rows.map(r => Array.isArray(r) ? [...r] : []);
function parse(range) {
  const match = String(range).match(/^(?:'((?:[^']|'')+)'|([^!]+))!([A-Z]+)(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
  if (!match) throw new Error('Invalid table range: ' + range);
  const letters = x => [...String(x || 'A').toUpperCase()].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1;
  return { title: (match[1] || match[2]).replace(/''/g,"'"), col:letters(match[3]), row: Math.max(0,Number(match[4]||1)-1), endCol:match[5]?letters(match[5]):null, endRow:match[6]?Number(match[6])-1:null };
}
async function transaction(fn) {
  const c=await db().connect();
  try { await c.query('BEGIN'); const out=await fn(c);await c.query('COMMIT');return out; }
  catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}
async function get(c,title,locked=false){
 const result=await c.query('SELECT rows FROM public.project_tabs WHERE title=$1'+(locked?' FOR UPDATE':''),[title]);
 return result.rowCount?clone(result.rows[0].rows):null;
}
async function put(c,title,rows) {
 await c.query(`INSERT INTO public.project_tabs(title,rows,revision) VALUES($1,$2::jsonb,1)
 ON CONFLICT (title) DO UPDATE SET rows=excluded.rows,revision=public.project_tabs.revision+1,updated_at=now()`,[title,JSON.stringify(rows)]);
}
const rowsGet = async ({range}) => {
 const r=parse(range); const c=await db().connect();try {const rows=await get(c,r.title);const values=(rows||[]).slice(r.row,r.endRow===null?undefined:r.endRow+1).map(row=>row.slice(r.col,r.endCol===null?undefined:r.endCol+1));return {data:{values}};}finally{c.release();}
};
const rowsUpdate = async ({range,requestBody}) => {
 const r=parse(range),incoming=requestBody?.values||[];
 return transaction(async c=>{
  const rows=await get(c,r.title,true)||[];
  for(let i=0;i<incoming.length;i++) {const index=r.row+i;while(rows.length<=index)rows.push([]);for(let j=0;j<incoming[i].length;j++)rows[index][r.col+j]=incoming[i][j]??'';}
  await put(c,r.title,rows);return {data:{updatedRows:incoming.length}};
 });
};
const rowsAppend=async ({range,requestBody}) => {
 const r=parse(range),incoming=requestBody?.values||[];
 return transaction(async c=>{const rows=await get(c,r.title,true)||[];for(const line of incoming)rows.push([...line]);await put(c,r.title,rows);return {data:{updates:{updatedRows:incoming.length}}};});
};
const rowsClear=async ({range})=>{
 const r=parse(range);
 return transaction(async c=>{const rows=await get(c,r.title,true)||[];for(let i=r.row;i<rows.length&&(r.endRow===null||i<=r.endRow);i++){
   for(let j=r.col;j<rows[i].length&&(r.endCol===null||j<=r.endCol);j++)rows[i][j]='';
  }await put(c,r.title,rows);return {data:{clearedRange:range}};});
};
async function meta(){const {rows}=await db().query('SELECT title FROM public.project_tabs ORDER BY title');return {data:{sheets:rows.map(v=>({properties:{title:v.title,sheetId:v.title}}))}};}
async function batch({requestBody}) {
 return transaction(async c=>{
  const replies=[];
  for(const req of requestBody?.requests||[]) {
    if(req.addSheet) {const title=req.addSheet.properties.title;const existing=await get(c,title,true);if(existing===null)await put(c,title,[]);replies.push({addSheet:{properties:{title,sheetId:title}}});}
    else if(req.updateCells) {const title=req.updateCells.range.sheetId;const old=await get(c,title,true)||[];
      // The existing application uses updateCells to clear a tab before rewriting it.
      if(req.updateCells.fields==='userEnteredValue')await put(c,title,[]);
      else throw new Error('Unsupported updateCells operation');replies.push({});}
    else if(req.deleteDimension) {const {sheetId,startIndex,endIndex}=req.deleteDimension.range;const rows=await get(c,sheetId,true)||[];rows.splice(startIndex,endIndex-startIndex);await put(c,sheetId,rows);replies.push({});}
    else if(req.repeatCell||req.autoResizeDimensions||req.updateSheetProperties||req.addConditionalFormatRule||req.deleteConditionalFormatRule)replies.push({});
    else throw new Error('Unsupported tab operation: '+Object.keys(req).join(','));
  }
  return {data:{replies}};
 });
}
export function supabaseSheetsClient(){return {spreadsheets:{get:meta,batchUpdate:batch,values:{get:rowsGet,update:rowsUpdate,append:rowsAppend,clear:rowsClear}}};}
export async function closeSupabase(){if(pool){await pool.end();pool=undefined;}}
