// Transitional bridge: WorkMyT collectors still output to Sheets.
// Sync only machine-generated performance tabs. NEVER overwrite Agents/Attendance.
import 'dotenv/config';
import {google} from 'googleapis';
import pg from 'pg';
import path from 'node:path';
const tabs = [
 process.env.GOOGLE_SHEET_TAB||'Last Worked',
 process.env.LAST_WORKED_HISTORY_SHEET_NAME||'Last Worked History',
 process.env.CURRENT_WEEK_SHEET_TAB||'Current Week Avg',
 process.env.LAST_WEEK_SHEET_TAB||'Last Week Avg',
 process.env.TWO_WEEKS_AGO_SHEET_TAB||'2 Weeks Ago Avg',
 process.env.THREE_WEEKS_AGO_SHEET_TAB||'3 Weeks Ago Avg',
 process.env.TEAM_GAPS_SHEET_NAME||'Team/Rep Gaps',
];
if(!process.env.SUPABASE_DB_URL||!process.env.GOOGLE_SHEET_ID)throw new Error('Missing database or sheet connection');
const auth=process.env.GOOGLE_SERVICE_ACCOUNT_FILE||process.env.GOOGLE_APPLICATION_CREDENTIALS?
 new google.auth.GoogleAuth({keyFile:path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_FILE||process.env.GOOGLE_APPLICATION_CREDENTIALS),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']}):
 new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_CLIENT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n')},scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const sheets=google.sheets({version:'v4',auth});
const pool=new pg.Pool({connectionString:process.env.SUPABASE_DB_URL,ssl:process.env.SUPABASE_DB_SSL==='false'?false:{rejectUnauthorized:process.env.SUPABASE_DB_SSL_VERIFY==='true'}});
try {
 for (const title of new Set(tabs)) {
  let rows;
  try {const res=await sheets.spreadsheets.values.get({spreadsheetId:process.env.GOOGLE_SHEET_ID,range:`'${title.replace(/'/g,"''")}'!A:AZ`}); rows=res.data.values||[];}
  catch(e){if(e.code===400){console.warn('Missing tab',title);continue;}throw e;}
  if(rows.length<=1){console.warn('Skipping empty/unpopulated tab',title);continue;}
  await pool.query(`INSERT INTO public.project_tabs(title,rows) VALUES($1,$2::jsonb)
    ON CONFLICT(title) DO UPDATE SET rows=excluded.rows,revision=public.project_tabs.revision+1,updated_at=now()`,[title,JSON.stringify(rows)]);
  console.log('Synced performance:',title,rows.length-1,'rows');
 }
} finally {await pool.end();}
