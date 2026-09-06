# ATMO single Render service + Browserless

This version runs the ATMO API, Socket.IO server, scheduler, and automation orchestration in one Render Web Service.

Browserless supplies the remote Chrome instance. Render does not need to launch Chrome when `BROWSER_PROVIDER=browserless`.

## Render service

Use one Render **Web Service** connected to this repository.

- Build command: `npm install`
- Start command: `npm run server`

The server starts Express/Socket.IO and also registers the automation cron from `DAILY_RUN_CRON`.

## Browser flow

When the scheduler fires:

1. `server/index.mjs` calls `runDailyAutomation()`.
2. `run.mjs` launches `last-day-worked.mjs` and the remaining aggregation scripts sequentially.
3. `last-day-worked.mjs` uses `puppeteer.connect()` when `BROWSER_PROVIDER=browserless`.
4. Browserless runs Chrome and loads WorkMyT FieldDay.
5. Login is conditional: if the visible login form is present, credentials are entered; otherwise the scraper continues with the existing authenticated session.

## Required Render environment variables

```text
BROWSER_PROVIDER=browserless
BROWSERLESS_ENDPOINT=wss://production-sfo.browserless.io
BROWSERLESS_TOKEN=<Browserless token>

WORKMYT_FIELD_DAY_URL=https://workmyt.com/fieldday
WORKMYT_EMAIL=<WorkMyT email>
WORKMYT_PASSWORD=<WorkMyT password>
WORKMYT_CAMPAIGN=MADHAV MEHTA

GOOGLE_SHEET_ID=<sheet id>
GOOGLE_SERVICE_ACCOUNT_FILE=./google-service-account.json

DAILY_RUN_CRON=30 11 * * *
DAILY_RUN_TIMEZONE=America/New_York
```

Also configure the existing API/admin/client-origin environment variables used by the ATMO backend.

## Local use

Set:

```text
BROWSER_PROVIDER=local
```

The existing local Chrome/profile path is then used instead of Browserless.

## Commands

```bash
npm run server
```

Runs the one Render-style service: web backend + scheduler.

```bash
npm run automation:once
```

Runs the automation sequence once for testing.

## Security

Do not commit `.env`, Browserless tokens, WorkMyT credentials, admin/API secrets, or `google-service-account.json`.
