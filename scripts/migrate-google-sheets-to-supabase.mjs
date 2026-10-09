// Run ONCE before switching the backend to Supabase. Non-destructive by default.
import 'dotenv/config';
import {google} from 'googleapis';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
const spreadsheetId=process.env.GOOGLE_SHEET_ID;
const dbUrl=process.env.SUPABASE_DB_URL;
if(!spreadsheetId||!dbUrl)throw new Error('Set GOOGLE_SHEET_ID and SUPABASE_DB_URL');
const keyfile=process.env.GOOGLE_SERVICE_ACCOUNT_FILE||process.env.GOOGLE_APPLICATION_CREDENTIALS;
const auth = keyfile ? new google.auth.GoogleAuth({keyFile:path.resolve(keyfile),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']}) :
  new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_CLIENT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n')},scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const sheets=google.sheets({version:'v4',auth});
const pool=new pg.Pool({connectionString:dbUrl,ssl:process.env.SUPABASE_DB_SSL==='false'?false:{rejectUnauthorized:process.env.SUPABASE_DB_SSL_VERIFY==='true'}});
const replace=process.argv.includes('--replace-existing');
try {
 const book=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets.properties.title'});
 let copied=0,skipped=0;
 for (const sheet of book.data.sheets||[]) {
  const title=sheet.properties.title;
  const data=await sheets.spreadsheets.values.get({spreadsheetId,range:`'${title.replace(/'/g,"''")}'!A:AZ`});
  const rows=data.data.values||[];
  const c=await pool.connect();
  try {await c.query('BEGIN');
   const existing=await c.query('SELECT title FROM public.project_tabs WHERE title=$1 FOR UPDATE',[title]);
   if(existing.rowCount&&!replace){skipped++; console.log('SKIPPED existing',title);await c.query('COMMIT');continue;}
   await c.query(`INSERT INTO public.project_tabs (title,rows) VALUES ($1,$2::jsonb)
     ON CONFLICT(title) DO UPDATE SET rows=excluded.rows,revision=public.project_tabs.revision+1,updated_at=now()`,[title,JSON.stringify(rows)]);
   await c.query('COMMIT');copied++;console.log('COPIED',title,rows.length,'rows');
  } catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 console.log(`Migration complete: copied ${copied}; skipped ${skipped}. Validate Agents count before enabling app.`);
} finally{await pool.end();}
