import 'dotenv/config';
import {closeRoadtripDatabase} from '../server/roadtrips.mjs';
import {importProductionSheets,closeProductionDatabase} from '../server/production-import.mjs';
import {getAgents} from '../server/sheets.mjs';
import {attachProductionLogs} from '../server/production-csv.mjs';
import {closeSupabase} from '../server/supabase-sheets-client.mjs';
try{
 const result=await importProductionSheets();console.log(result);
 if(result.success)for(const rep of attachProductionLogs(await getAgents())){const day=rep.productionLog?.lastDay;console.log(`${rep.office} | ${rep.repName} | ${rep.rep_id||'no Rep ID'} | ${day?.date||'no worked day'} | E ${day?(day.electric+day.partials):'—'} G ${day?.gas??'—'} | $${day?.production??'—'}`)}
}catch(error){console.error('[update-production]',error.message);process.exitCode=1}
finally{await closeProductionDatabase();await closeSupabase();await closeRoadtripDatabase()}
