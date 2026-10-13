import "dotenv/config";
import {importProductionSheets,closeProductionDatabase} from "../server/production-import.mjs";
try {console.log(await importProductionSheets());}
catch(error){console.error("[production-import]",error.message);process.exitCode=1;}
finally {await closeProductionDatabase();}
