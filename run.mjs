import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDirectory = path.dirname(currentFile);

let runInProgress = false;

function runNodeScriptOnce(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(rootDirectory, scriptName);

    console.log(`[runner] Starting ${scriptName}`);

    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDirectory,
      stdio: "inherit",
      env: process.env,
      windowsHide: false,
    });

    child.once("error", (error) => {
      reject(
        new Error(`[runner] Could not start ${scriptName}: ${error.message}`)
      );
    });

    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        console.log(`[runner] Finished ${scriptName}`);
        resolve();
        return;
      }

      reject(
        new Error(
          `[runner] ${scriptName} failed with exit code ${exitCode}` +
            (signal ? ` and signal ${signal}` : "")
        )
      );
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runNodeScriptUntilSuccess(
  scriptName,
  { retryDelayMs = 30_000, maxAttempts = Infinity } = {}
) {
  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      console.log(`[runner] Running ${scriptName}, attempt ${attempt}`);
      await runNodeScriptOnce(scriptName);
      console.log(`[runner] ${scriptName} succeeded on attempt ${attempt}`);
      return;
    } catch (error) {
      console.error(
        `[runner] ${scriptName} failed on attempt ${attempt}:`,
        error.message
      );

      if (attempt >= maxAttempts) throw error;

      console.log(
        `[runner] Retrying ${scriptName} in ${retryDelayMs / 1000} seconds`
      );
      await delay(retryDelayMs);
      attempt += 1;
    }
  }
}

export async function runDailyAutomation() {
  if (runInProgress) {
    console.log("[runner] A run is already in progress. Skipping this trigger.");
    return {
      success: false,
      skipped: true,
      message: "Automation is already running.",
    };
  }

  runInProgress = true;
  const startedAt = new Date();
  console.log(`[runner] Daily automation started at ${startedAt.toISOString()}`);

  try {
    // 1. Refresh the Last Worked sheet.
    await runNodeScriptUntilSuccess("last-day-worked.mjs", {
      retryDelayMs: 30_000,
    });

    // 2. Read Last Worked DIRECTLY from Google Sheets and append new reps to Agents.
    //    No agents.json file is used by this step.
    await runNodeScriptUntilSuccess("write-agents-to-sheet.mjs", {
      retryDelayMs: 30_000,
    });

    // 3. Continue the normal automation after the Agents sheet is current.
    await runNodeScriptUntilSuccess("run-week-days-fix.mjs", {
      retryDelayMs: 30_000,
    });

    await runNodeScriptUntilSuccess("generate-team-rep-gaps.mjs", {
      retryDelayMs: 30_000,
    });

    const finishedAt = new Date();
    console.log(`[runner] Daily automation finished at ${finishedAt.toISOString()}`);

    return {
      success: true,
      skipped: false,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  } finally {
    runInProgress = false;
  }
}

export function isDailyAutomationRunning() {
  return runInProgress;
}

const wasRunDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile);

if (wasRunDirectly) {
  runDailyAutomation().catch((error) => {
    console.error("[runner] Daily automation failed:", error);
    process.exitCode = 1;
  });
}
