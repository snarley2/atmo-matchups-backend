import "dotenv/config";
import cron from "node-cron";
import { runDailyAutomation, isDailyAutomationRunning } from "../run.mjs";

const cronExpression = process.env.DAILY_RUN_CRON || "30 23 * * *";
const timezone = process.env.DAILY_RUN_TIMEZONE || "America/New_York";

let schedulerRunInProgress = false;

console.log("==================================================");
console.log("[automation] ATMO automation worker starting");
console.log(`[automation] Cron: ${cronExpression}`);
console.log(`[automation] Timezone: ${timezone}`);
console.log(`[automation] Node version: ${process.version}`);
console.log("[automation] Waiting for next trigger...");
console.log("==================================================");

cron.schedule(
  cronExpression,
  async () => {
    console.log("");
    console.log("==================================================");
    console.log(`[automation] Trigger fired at ${new Date().toISOString()}`);

    if (schedulerRunInProgress || isDailyAutomationRunning()) {
      console.log("[automation] Previous run is still active; skipping this trigger.");
      console.log("==================================================");
      return;
    }

    schedulerRunInProgress = true;

    try {
      const result = await runDailyAutomation();
      console.log("[automation] Run completed:", result);
    } catch (error) {
      console.error("[automation] Run failed:", error);
    } finally {
      schedulerRunInProgress = false;
      console.log(`[automation] Trigger finished at ${new Date().toISOString()}`);
      console.log("==================================================");
    }
  },
  {
    timezone,
    noOverlap: true,
  },
);
