# ATMO backend + automation worker split

This merge keeps the ATMO application backend and the WorkMyT automation in the same GitHub repository, but gives them separate process entry points.

## Source merge policy used

- The uploaded local ZIP was treated as the working scraper baseline. Its `last-day-worked.mjs`, weekly scrape, and aggregation scripts were preserved rather than replacing them with the newer experimental Bubble/network-discovery scraper.
- The current ATMO server/Bubble-facing backend structure was kept as the web application side.
- Browser automation scheduling was removed from `server/index.mjs` so Puppeteer cannot hang or crash the main ATMO web service.
- A dedicated `automation/index.mjs` process now owns the scheduler and calls the existing `run.mjs` sequence.
- Secrets, `.env`, `google-service-account.json`, `.git`, `node_modules`, and `.chrome-profile` were intentionally not included in this ZIP.

## Start commands

### ATMO web backend

```bash
npm run server
```

This starts Express + Socket.IO only.

### Automation worker

```bash
npm run automation
```

This starts a long-running scheduler and triggers `run.mjs` according to `DAILY_RUN_CRON` / `DAILY_RUN_TIMEZONE`.

### Run automation once

```bash
npm run automation:once
```

Useful for local testing.

## Render layout

Create two Render services from the same repository.

1. **ATMO Backend** — Web Service — Start Command: `npm run server`
2. **ATMO Automation** — Background Worker — Start Command: `npm run automation`

They can use separate environment variables even though they point at the same repository.

## Important: local scraper vs Render

The uploaded local `last-day-worked.mjs` is intentionally preserved as the known-working browser interaction baseline. It currently launches a local Chrome/profile. Do not expect that exact browser-launch section to be the final Render configuration.

The next phase is to change only the browser-creation layer to Browserless (or another remote Chrome service), while leaving the known-working FieldDay navigation/data extraction behavior intact. Login should remain conditional: first try FieldDay with the existing browser session, and only execute the login routine when the email/password form is actually present.

## Git safety

Do not copy the old local `.git` folder into the repository and push it. Use the current GitHub checkout/branch, overlay the files from this merged ZIP, inspect `git diff`, then commit. This avoids reverting unrelated GitHub history.
