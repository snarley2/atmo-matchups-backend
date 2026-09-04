// mehta-marketing/atmomatchups/run.mjs
import fs from "fs";
import path from "path";
import process from "process";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
dotenv.config();
import { google } from "googleapis";
// ============================================================
// CONFIG
// ============================================================
const FIELD_DAY_URL =
  process.env.WORKMYT_FIELD_DAY_URL || "https://workmyt.com/fieldday";
const email = process.env.WORKMYT_EMAIL;
const password = process.env.WORKMYT_PASSWORD;
const CAMPAIGN_NAME =
  process.env.WORKMYT_CAMPAIGN || "MADHAV MEHTA";

const LOOKBACK_DAYS = Number(
  process.env.PERFORMANCE_LOOKBACK_DAYS || 21
);

const OUTPUT_JSON =
  process.env.PERFORMANCE_OUTPUT_JSON ||
  path.join(
    process.cwd(),
    "atmomatchups",
    "outputs",
    "fieldday-performance.json"
  );

const GOOGLE_SHEET_ID =
  process.env.GOOGLE_SHEET_ID;

const GOOGLE_SHEET_TAB =
  process.env.GOOGLE_SHEET_TAB || "Last Worked";

const LAST_WORKED_HISTORY_TAB =
  process.env.LAST_WORKED_HISTORY_SHEET_NAME || "Last Worked History";

const GOOGLE_SERVICE_ACCOUNT_FILE =
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE ||
  path.join(
    process.cwd(),
    "google-service-account.json"
  );

const GOOGLE_CREDENTIALS_PATH =
  path.isAbsolute(GOOGLE_SERVICE_ACCOUNT_FILE)
    ? GOOGLE_SERVICE_ACCOUNT_FILE
    : path.join(
        process.cwd(),
        GOOGLE_SERVICE_ACCOUNT_FILE
      );

// Chrome configuration
const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  path.join(process.cwd(), ".chrome-profile");

// ============================================================
// GENERAL HELPERS
// ============================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateFlowRates(performance) {
  const talks =
    Number(performance.talk || 0);

  const stops =
    Number(performance.stops || 0);

  const zips =
    Number(performance.zips || 0);

  const presentations =
    Number(performance.presentations || 0);

  const info =
    Number(performance.info || 0);

  const closes =
    Number(performance.electricSales || 0) +
    //Number(performance.gasSales || 0) +
    Number(performance.electricPartials || 0) 
    //Number(performance.gasPartials || 0);

  return {
    talkToStop:
      talks > 0 ? stops / talks : 0,

    stopToZip:
      stops > 0 ? zips / stops : 0,

    zipToPresentation:
      zips > 0 ? presentations / zips : 0,

    presentationToInfo:
      presentations > 0
        ? info / presentations
        : 0,

    infoToClose:
      info > 0 ? closes / info : 0,
  };
}

function getGapColor(rate, standard, yellowAllowance) {
  if (rate >= standard) {
    return "green";
  }

  if (rate >= standard - yellowAllowance) {
    return "yellow";
  }

  return "orange";
}

function hexColor(hex) {
  const clean = hex.replace("#", "");

  return {
    red:
      parseInt(clean.slice(0, 2), 16) / 255,
    green:
      parseInt(clean.slice(2, 4), 16) / 255,
    blue:
      parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function getFlagFormat(flag) {
  const formats = {
    black: {
      background: "#1F1F1F",
      text: "#FFFFFF",
    },
    red: {
      background: "#E06666",
      text: "#FFFFFF",
    },
    yellow: {
      background: "#FFD966",
      text: "#5F4B00",
    },
    none: {
      background: "#B6D7A8",
      text: "#274E13",
    },
    unknown: {
      background: "#D9D9D9",
      text: "#333333",
    },
  };

  return formats[flag] || formats.unknown;
}

function getGapFormat(status) {
  const formats = {
    green: {
      background: "#B6D7A8",
      text: "#274E13",
    },
    yellow: {
      background: "#FFE599",
      text: "#5F4B00",
    },
    orange: {
      background: "#F6B26B",
      text: "#783F04",
    },
  };

  return formats[status];
}

async function loginIfNeeded(page) {
  const emailSelector = 'input[type="email"]';
  const passwordSelector = 'input[type="password"]';

  const loginPageVisible = await page
    .waitForSelector(emailSelector, {
      visible: true,
      timeout: 3000,
    })
    .then(() => true)
    .catch(() => false);

  if (!loginPageVisible) {
    console.log("[login] Already logged in.");
    return;
  }

  console.log("[login] Login page detected.");

  await page.click(emailSelector, { clickCount: 3 });
  await page.type(emailSelector, process.env.WORKMYT_EMAIL, {
    delay: 30,
  });

  await page.click(passwordSelector, { clickCount: 3 });
  await page.type(passwordSelector, process.env.WORKMYT_PASSWORD, {
    delay: 30,
  });
  if (!email || !password) {
    throw new Error(
      "WORKMYT_EMAIL or WORKMYT_PASSWORD environment variable is missing."
    );
  }
  await page.keyboard.press("Enter");

  await page.waitForFunction(
    () => !document.querySelector('input[type="email"]'),
    {
      timeout: 30000,
    }
  );

  console.log("[login] Login completed.");
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildLookbackDates(days = 14, endDate = new Date()) {
  const output = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(endDate);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);

    output.push({
      iso: toLocalIsoDate(date),
      label: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      timestamp: date.getTime(),
    });
  }

  return output;
}

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDaysSinceDate(isoDate, referenceDate = new Date()) {
  if (!isoDate) return null;

  const [year, month, day] = isoDate.split("-").map(Number);
  const workedDate = new Date(year, month - 1, day);
  workedDate.setHours(0, 0, 0, 0);

  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  return Math.max(
    0,
    Math.floor((today.getTime() - workedDate.getTime()) / 86400000)
  );
}

function getInactivityFlag(daysSinceLastWorked) {
  if (daysSinceLastWorked == null) return "unknown";
  if (daysSinceLastWorked >= 7) return "black";
  if (daysSinceLastWorked >= 4) return "red";
  if (daysSinceLastWorked >= 2) return "yellow";
  return "none";
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

async function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: GOOGLE_CREDENTIALS_PATH,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

function buildGoogleSheetRows(output) {
  return [
    [
      "Generated At",
      "Rep Name",
      "Office",
      "Last Worked Date",
      "Days Since Last Worked",
      "Flag",
      "Hours",
      "Talk",
      "Stops",
      "Zips",
      "Presentations",
      "Info",
      "Electric Sales",
      "Gas Sales",
      "Electric Partials",
      "Gas Partials",
      "Talk → Stop",
      "Stop → Zip",
      "Zip → Presentation",
      "Presentation → Info",
      "Info → Close",
    ],

    ...output.reps.map(rep => {
      const rates =
        calculateFlowRates(rep.performance);

      return [
        output.generatedAt,
        rep.repName,
        rep.office,
        rep.lastWorkedDate,
        rep.daysSinceLastWorked,
        rep.inactivityFlag,
        rep.performance.workedHours,
        rep.performance.talk,
        rep.performance.stops,
        rep.performance.zips,
        rep.performance.presentations,
        rep.performance.info,
        rep.performance.electricSales,
        rep.performance.gasSales,
        rep.performance.electricPartials,
        rep.performance.gasPartials,
        rates.talkToStop,
        rates.stopToZip,
        rates.zipToPresentation,
        rates.presentationToInfo,
        rates.infoToClose,
      ];
    }),
  ];
}

async function formatGoogleSheet(
  sheets,
  output,
  rowCount
) {
  const spreadsheet =
    await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      fields: "sheets.properties",
    });

  const targetSheet =
    spreadsheet.data.sheets.find(
      sheet =>
        sheet.properties.title ===
        GOOGLE_SHEET_TAB
    );

  if (!targetSheet) {
    throw new Error(
      `Google Sheet tab "${GOOGLE_SHEET_TAB}" was not found.`
    );
  }

  const sheetId =
    targetSheet.properties.sheetId;

  const requests = [
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 21,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor:
              hexColor("#5B9BD5"),
            textFormat: {
              foregroundColor:
                hexColor("#FFFFFF"),
              bold: true,
            },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
      },
    },

    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: Math.max(rowCount, 2),
          startColumnIndex: 0,
          endColumnIndex: 21,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor:
              hexColor("#FFFFFF"),
            textFormat: {
              foregroundColor:
                hexColor("#222222"),
            },
            verticalAlignment: "MIDDLE",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    },

    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: Math.max(rowCount, 2),
          startColumnIndex: 16,
          endColumnIndex: 21,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "PERCENT",
              pattern: "0.0%",
            },
            horizontalAlignment: "CENTER",
            textFormat: {
              bold: true,
            },
          },
        },
        fields:
          "userEnteredFormat(numberFormat,horizontalAlignment,textFormat.bold)",
      },
    },

    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields:
          "gridProperties.frozenRowCount",
      },
    },

    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 21,
        },
      },
    },
  ];

  const standards = [
    {
      key: "talkToStop",
      standard: 0.5,
      yellowAllowance: 0.075,
      columnIndex: 16,
    },
    {
      key: "stopToZip",
      standard: 0.3,
      yellowAllowance: 0.05,
      columnIndex: 17,
    },
    {
      key: "zipToPresentation",
      standard: 1,
      yellowAllowance: 0.10,
      columnIndex: 18,
    },
    {
      key: "presentationToInfo",
      standard: 0.3,
      yellowAllowance: 0.05,
      columnIndex: 19,
    },
    {
      key: "infoToClose",
      standard: 1,
      yellowAllowance: 0.10,
      columnIndex: 20,
    },
  ];

  output.reps.forEach((rep, index) => {
    const sheetRowIndex = index + 1;

    const flagFormat =
      getFlagFormat(rep.inactivityFlag);

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: sheetRowIndex,
          endRowIndex: sheetRowIndex + 1,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor:
              hexColor(flagFormat.background),
            textFormat: {
              foregroundColor:
                hexColor(flagFormat.text),
              bold: true,
            },
            horizontalAlignment: "CENTER",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });

    const rates =
      calculateFlowRates(rep.performance);

    standards.forEach(
      ({
        key,
        standard,
        yellowAllowance,
        columnIndex,
      }) => {
        const status = getGapColor(
          rates[key],
          standard,
          yellowAllowance
        );

        const format =
          getGapFormat(status);

        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: sheetRowIndex,
              endRowIndex:
                sheetRowIndex + 1,
              startColumnIndex:
                columnIndex,
              endColumnIndex:
                columnIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor:
                  hexColor(
                    format.background
                  ),
                textFormat: {
                  foregroundColor:
                    hexColor(format.text),
                  bold: true,
                },
                horizontalAlignment:
                  "CENTER",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        });
      }
    );
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests,
    },
  });
}

async function appendOutputToHistory(sheets, output) {
  const baseValues = buildGoogleSheetRows(output);
  const baseHeaders = baseValues[0] || [];
  const snapshotDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(output.generatedAt || Date.now()));

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    fields: "sheets.properties",
  });
  let historySheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === LAST_WORKED_HISTORY_TAB
  );
  if (!historySheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: LAST_WORKED_HISTORY_TAB } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${LAST_WORKED_HISTORY_TAB}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [["Snapshot Date", ...baseHeaders]] },
    });
  }

  const historyRows = baseValues.slice(1).map((row) => [snapshotDate, ...row]);
  if (historyRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `'${LAST_WORKED_HISTORY_TAB}'!A:AZ`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: historyRows },
    });
  }
  console.log(`[history] appended ${historyRows.length} Last Worked rows for ${snapshotDate}`);
}

async function writeOutputToGoogleSheet(output) {
  const sheets =
    await getGoogleSheetsClient();

  const values =
    buildGoogleSheetRows(output);

  await appendOutputToHistory(sheets, output);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${GOOGLE_SHEET_TAB}'!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `'${GOOGLE_SHEET_TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values,
    },
  });

  await formatGoogleSheet(
    sheets,
    output,
    values.length
  );


  console.log(
    "[sheet] Google Sheet updated."
  );
}
// ============================================================
// MANUAL LOGIN WAIT
// ============================================================

async function waitForManualLogin(page) {
  console.log("[auth] opening WorkMyT");
  console.log("[auth] log in manually in the Chrome window");
  console.log("[auth] the script will click the assessment icon after login");

  await page.goto(FIELD_DAY_URL, {
    waitUntil: "domcontentloaded",
  });

  await loginIfNeeded(page);

  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText || "";

      const alreadyOnFieldDay =
        bodyText.includes("Daily") &&
        bodyText.includes("Campaign") &&
        bodyText.includes("Rep Name");

      const assessmentButton = [
        ...document.querySelectorAll(
          "button.bubble-element.materialicons-Materialicon"
        ),
      ]
        .find((button) => {
          const iconText = button.querySelector(
            "text.material-icons-outline"
          )?.textContent?.trim().toLowerCase();

          return iconText === "assessment";
        });

      return alreadyOnFieldDay || Boolean(assessmentButton);
    },
    {
      timeout: 0,
    }
  );

  const navigationResult = await page.evaluate(async() => {
    const bodyText = document.body?.innerText || "";

    const alreadyOnFieldDay =
      bodyText.includes("Daily") &&
      bodyText.includes("Campaign") &&
      bodyText.includes("Rep Name");

    if (alreadyOnFieldDay) {
      return "already-on-fieldday";
    }

    const assessmentButton = [
      ...document.querySelectorAll(
        "button.bubble-element.materialicons-Materialicon"
      ),
    ]
      .find((button) => {
        const iconText = button.querySelector(
          "text.material-icons-outline"
        )?.textContent?.trim().toLowerCase();

        return iconText === "assessment";
      });

    if (!assessmentButton) {
      return "assessment-not-found";
    }
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    await delay(3000)

    assessmentButton.scrollIntoView({
      behavior: "instant",
      block: "center",
    });
   
    assessmentButton.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
    return "assessment-clicked";
  });

  if (navigationResult === "assessment-not-found") {
    throw new Error(
      'Could not find the navigation button with icon text "assessment".'
    );
  }

  if (navigationResult === "assessment-clicked") {
    console.log("[auth] assessment icon clicked");
  } else {
    console.log("[auth] already on FieldDay");
  }

  await waitForFieldDay(page);
  console.log("[auth] FieldDay detected; continuing");
}

// ============================================================
// FIELD DAY FILTERS
// ============================================================

async function waitForFieldDay(page) {
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText || "";

      return (
        text.includes("Daily") &&
        text.includes("Week") &&
        text.includes("Campaign") &&
        text.includes("Rep Name")
      );
    },
    {
      timeout: 60000,
    }
  );
}

async function waitForTableSettled(page, previousSignature = "") {
  await page.waitForSelector(".bubble-table", {
    timeout: 30000,
  });

  await page
    .waitForFunction(
      (oldSignature) => {
        const rows = [
          ...document.querySelectorAll(
            ".bubble-table .group-item"
          ),
        ];

        const signature = rows
          .map((row) =>
            (row.innerText || "")
              .replace(/\s+/g, " ")
              .trim()
          )
          .join("|");

        if (!oldSignature) {
          return rows.length >= 0;
        }

        return signature !== oldSignature;
      },
      {
        timeout: 10000,
      },
      previousSignature
    )
    .catch(() => {});

  // Bubble can update the DOM in multiple passes.
  await delay(1000);
}

async function getTableSignature(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".bubble-table .group-item")]
      .map((row) =>
        (row.innerText || "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .join("|")
  );
}

async function selectDailyView(page) {
  const previousSignature = await getTableSignature(page);

  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];

    const target = buttons.find(
      (button) =>
        (button.textContent || "")
          .trim()
          .toLowerCase() === "daily"
    );

    if (!target) return false;

    target.click();
    return true;
  });

  if (!clicked) {
    throw new Error('Could not find the "Daily" button.');
  }

  await waitForTableSettled(page, previousSignature);
  console.log("[filter] Daily view selected");
}

async function selectCampaign(page, campaignName) {
  const previousSignature = await getTableSignature(page);

  const result = await page.evaluate((wantedCampaign) => {
    const selects = [...document.querySelectorAll("select")];

    for (const select of selects) {
      const option = [...select.options].find(
        (candidate) =>
          (candidate.textContent || "").trim() ===
          wantedCampaign
      );

      if (!option) continue;

      select.value = option.value;

      select.dispatchEvent(
        new Event("input", { bubbles: true })
      );

      select.dispatchEvent(
        new Event("change", { bubbles: true })
      );

      return {
        found: true,
        value: option.value,
      };
    }

    return {
      found: false,
      value: "",
    };
  }, campaignName);

  if (!result.found) {
    throw new Error(
      `Campaign "${campaignName}" was not found.`
    );
  }

  await waitForTableSettled(page, previousSignature);
  console.log(`[filter] campaign="${campaignName}"`);
}

async function selectDate(page, dateLabel) {
  const previousSignature = await getTableSignature(page);

  const result = await page.evaluate((wantedDate) => {
    const datePattern =
      /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/;

    const selects = [...document.querySelectorAll("select")];

    const dateSelect = selects.find((select) =>
      [...select.options].some((option) =>
        datePattern.test(
          (option.textContent || "").trim()
        )
      )
    );

    if (!dateSelect) {
      return {
        foundSelect: false,
        foundDate: false,
      };
    }

    const option = [...dateSelect.options].find(
      (candidate) =>
        (candidate.textContent || "").trim() ===
        wantedDate
    );

    if (!option) {
      return {
        foundSelect: true,
        foundDate: false,
      };
    }

    dateSelect.value = option.value;

    dateSelect.dispatchEvent(
      new Event("input", { bubbles: true })
    );

    dateSelect.dispatchEvent(
      new Event("change", { bubbles: true })
    );

    return {
      foundSelect: true,
      foundDate: true,
      value: option.value,
    };
  }, dateLabel);

  if (!result.foundSelect) {
    throw new Error("Could not locate the FieldDay date dropdown.");
  }

  if (!result.foundDate) {
    return false;
  }

  await waitForTableSettled(page, previousSignature);
  return true;
}

// ============================================================
// TABLE EXTRACTION
// ============================================================

async function extractVisiblePerformanceRows(page) {
  return page.evaluate(() => {
    const clean = (value) =>
      String(value || "")
        .replace(/[▼▲↓↑]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const numberFrom = (value) => {
      const match = clean(value).match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : 0;
    };

    const hoursFrom = (value) => {
      const text = clean(value);
      const hoursMatch = text.match(
        /\(([\d.]+)\s*Hrs?\)/i
      );

      if (hoursMatch) {
        return Number(hoursMatch[1]);
      }

      return 0;
    };

    const isVisible = (element) => {
      const style = window.getComputedStyle(element);

      return (
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };

    const table =
      document.querySelector(".bubble-table");

    if (!table) return [];

    const headerAxis = [
      ...table.querySelectorAll(".bubble-cross-axis"),
    ].find((axis) => {
      const text = clean(axis.innerText);

      return (
        text.includes("Rep Name") &&
        text.includes("Time in Field")
      );
    });

    if (!headerAxis) return [];

    const headers = [...headerAxis.children]
      .filter(isVisible)
      .map((cell) => clean(cell.innerText));

    const dataRows = [
      ...table.querySelectorAll(".group-item"),
    ];

    return dataRows
      .map((row) => {
        const cells = [...row.children]
          .filter(isVisible)
          .map((cell) => clean(cell.innerText));

        const raw = {};

        headers.forEach((header, index) => {
          raw[header] = cells[index] ?? "";
        });

        const repName = raw["Rep Name"] || "";

        if (!repName) return null;

        return {
          rowNumber: numberFrom(raw["#"]),
          office: raw["Office"] || "",
          repName,
          timeInField: raw["Time in Field"] || "",
          workedHours: hoursFrom(raw["Time in Field"]),
          talk: numberFrom(raw["Talk"]),
          stops: numberFrom(raw["Stops"]),
          zips: numberFrom(raw["Zips"]),
          presentations: numberFrom(raw["Presentation"]),
          info: numberFrom(raw["Info"]),
          electricSales: numberFrom(raw["Electric Sale"]),
          gasSales: numberFrom(raw["Gas Sale"]),
          electricPartials: numberFrom(
            raw["Electric Partial"]
          ),
          gasPartials: numberFrom(raw["Gas Partial"]),
          raw,
        };
      })
      .filter(Boolean);
  });
}

// ============================================================
// NORMALIZATION / AGGREGATION
// ============================================================

function isLikelyWorkedDay(record) {
  return (
    Number(record.workedHours || 0) > 0 ||
    Number(record.talk || 0) > 0 ||
    Number(record.stops || 0) > 0 ||
    Number(record.presentations || 0) > 0 ||
    Number(record.info || 0) > 0 ||
    Number(record.electricSales || 0) > 0 ||
    Number(record.gasSales || 0) > 0 ||
    Number(record.electricPartials || 0) > 0 ||
    Number(record.gasPartials || 0) > 0
  );
}

function getLastWorkedDayByRep(dailyRecords) {
  const byRep = new Map();

  for (const record of dailyRecords) {
    if (!isLikelyWorkedDay(record)) continue;

    const repKey = normalizeName(record.repName);
    if (!repKey) continue;

    const existing = byRep.get(repKey);

    const recordTime = new Date(record.date).getTime();
    const existingTime = existing
      ? new Date(existing.date).getTime()
      : -Infinity;

    if (!existing || recordTime > existingTime) {
      byRep.set(repKey, record);
    }
  }

  return [...byRep.values()]
    .map((record) => ({
      repKey: normalizeName(record.repName),
      repName: record.repName,
      office: record.office,
      lastWorkedDate: record.date,
      lastWorkedDateLabel: record.dateLabel,
      daysSinceLastWorked: getDaysSinceDate(record.date),
      inactivityFlag: getInactivityFlag(
        getDaysSinceDate(record.date)
      ),
      performance: {
        timeInField: record.timeInField,
        workedHours: record.workedHours,
        talk: record.talk,
        stops: record.stops,
        zips: record.zips,
        presentations: record.presentations,
        info: record.info,
        electricSales: record.electricSales,
        gasSales: record.gasSales,
        electricPartials: record.electricPartials,
        gasPartials: record.gasPartials,
      },
    }))
    .sort((a, b) => a.repName.localeCompare(b.repName));
}

function sumPerformance(records) {
  const fields = [
    "workedHours",
    "talk",
    "stops",
    "zips",
    "presentations",
    "info",
    "electricSales",
    "gasSales",
    "electricPartials",
    "gasPartials",
  ];

  return Object.fromEntries(
    fields.map((field) => [
      field,
      round(
        records.reduce(
          (sum, record) =>
            sum + Number(record[field] || 0),
          0
        )
      ),
    ])
  );
}

function averagePerformance(totals, divisor) {
  if (!divisor) {
    return Object.fromEntries(
      Object.keys(totals).map((key) => [key, 0])
    );
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [
      key,
      round(value / divisor),
    ])
  );
}

function calculateRates(totals) {
  const totalSales =
    Number(totals.electricSales || 0) +
    Number(totals.gasSales || 0);

  return {
    stopsPerTalk:
      totals.talk > 0
        ? round(totals.stops / totals.talk)
        : 0,

    presentationsPerStop:
      totals.stops > 0
        ? round(
            totals.presentations / totals.stops
          )
        : 0,

    salesPerPresentation:
      totals.presentations > 0
        ? round(
            totalSales / totals.presentations
          )
        : 0,

    salesPerWorkedHour:
      totals.workedHours > 0
        ? round(totalSales / totals.workedHours)
        : 0,
  };
}

// ============================================================
// RUNNER
// ============================================================

async function run() {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), {
    recursive: true,
  });

  const isRender = Boolean(process.env.RENDER);

  const browser = await puppeteer.launch({
    headless: isRender ? true : false,
  
    ...(isRender ? {} : { executablePath: CHROME_PATH }),
    ...(isRender ? {} : { userDataDir: CHROME_USER_DATA_DIR }),
  
    defaultViewport: isRender
      ? { width: 1920, height: 1080 }
      : null,
  
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-notifications",
      "--window-size=1920,1080",
  
      // Make Render Chrome behave closer to normal Chrome
      "--disable-blink-features=AutomationControlled",
    ],
  });

  let cleaned = false;

  const safeCleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await browser.close().catch(() => {});
  };

  const onSigInt = async () => {
    console.log(
      "\n[signal] SIGINT received, closing Chrome..."
    );
    await safeCleanup();
    process.exit(130);
  };

  const onSigTerm = async () => {
    console.log(
      "\n[signal] SIGTERM received, closing Chrome..."
    );
    await safeCleanup();
    process.exit(143);
  };

  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);

  try {
    console.log("[chrome] launched");

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    
    if (isRender) {
      await page.setViewport({
        width: 1920,
        height: 1080,
      });
    
      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/151.0.0.0 Safari/537.36"
      );
    
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
    
      console.log("[chrome] Render browser compatibility settings applied");
    }
    
    console.log("[chrome] headless:", isRender);
    console.log("[chrome] userAgent:", await page.evaluate(() => navigator.userAgent));
    console.log("[chrome] webdriver:", await page.evaluate(() => navigator.webdriver));
    
    await waitForManualLogin(page);

   await page.bringToFront();
   await page.mouse.click(500, 300);

    await selectDailyView(page);
    await selectDailyView(page);
    await selectCampaign(page, CAMPAIGN_NAME);

    const dates = buildLookbackDates(LOOKBACK_DAYS);
    const dailyRecords = [];
    const skippedDates = [];
    const failedDates = [];

    console.log(
      `[run] collecting ${dates.length} calendar days`
    );

    for (const [index, date] of dates.entries()) {
      console.log(
        `\n[date ${index + 1}/${dates.length}] ${date.label}`
      );

      try {
        const available = await selectDate(
          page,
          date.label
        );

        if (!available) {
          console.log(
            `   [skip] date is not available in dropdown`
          );

          skippedDates.push({
            date: date.iso,
            label: date.label,
            reason: "DATE_NOT_AVAILABLE",
          });

          continue;
        }

        const rows =
          await extractVisiblePerformanceRows(page);

        const normalizedRows = rows.map((row) => ({
          ...row,
          date: date.iso,
          dateLabel: date.label,
          repKey: normalizeName(row.repName),
          likelyWorked: isLikelyWorkedDay(row),
        }));

        dailyRecords.push(...normalizedRows);

        console.log(
          `   [rows] collected=${normalizedRows.length}`
        );
      } catch (error) {
        console.error(
          `   [error] ${error?.message || error}`
        );

        failedDates.push({
          date: date.iso,
          label: date.label,
          error: error?.message || String(error),
        });

        // Re-center on FieldDay before the next date.
        await page
          .goto(FIELD_DAY_URL, {
            waitUntil: "domcontentloaded",
          })
          .catch(() => {});

        await waitForFieldDay(page).catch(() => {});
        await selectDailyView(page).catch(() => {});
        await selectCampaign(
          page,
          CAMPAIGN_NAME
        ).catch(() => {});
      }
    }

    const reps = getLastWorkedDayByRep(dailyRecords);

    const output = {
      generatedAt: new Date().toISOString(),
      source: {
        url: FIELD_DAY_URL,
        campaign: CAMPAIGN_NAME,
        mode: "Daily",
        lookbackDays: LOOKBACK_DAYS,
      },
      summary: {
        calendarDatesRequested: dates.length,
        skippedDateCount: skippedDates.length,
        failedDateCount: failedDates.length,
        rawRecordCount: dailyRecords.length,
        uniqueRepCount: reps.length,
        likelyWorkedRecordCount:
          dailyRecords.filter(isLikelyWorkedDay)
            .length,
      },
      skippedDates,
      failedDates,
      reps,
    };

    await writeOutputToGoogleSheet(output);

    console.log("\n[done]");
    console.log(
      `[done] unique reps=${output.summary.uniqueRepCount}`
    );
    console.log(
      `[done] raw records=${output.summary.rawRecordCount}`
    );
    console.log("[done] Uploaded to Google Sheets");
  } finally {
    await safeCleanup();
  }
}

run().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
