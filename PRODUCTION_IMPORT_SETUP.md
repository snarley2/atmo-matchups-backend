# Production imports from Google Sheets into Supabase

Replace the files from the backend patch in the backend project. Replace src/main.jsx from the frontend patch in the frontend project. No TSV files are read by the updated production module.

## Sources

production-sources.mjs maps the provided links to Canyon Tuman, Keasel Broom, Collin Willhelm and Madhav Mehta, respectively. These assignments were verified from the source rep names. The importer discovers dated weekly tabs in each workbook; the linked gid is retained as source configuration, but the importer selects the two most recent weekly tabs up to the current Saturday. It automatically follows new weekly tabs, including compact names 101726 and 1017 and dotted dates such as 10.10.26. Support and dashboard tabs are excluded.

## Connections

Keep SUPABASE_DB_URL configured locally and on Render. The backend creates the three production tables using supabase/production.sql on first use. If your database role cannot create tables, run that SQL file in Supabase SQL Editor first.

A Google service account must have Viewer access to all four production workbooks and the Google Sheets API enabled. Configure one of the following server-side options:
- GOOGLE_SERVICE_ACCOUNT_FILE (absolute path to an existing JSON key, including a Render secret file), or GOOGLE_APPLICATION_CREDENTIALS;
- GOOGLE_SERVICE_ACCOUNT_JSON (the complete JSON service-account key);
- GOOGLE_CLIENT_EMAIL plus GOOGLE_PRIVATE_KEY.

These credentials are only used to read the production workbooks. WorkMyT collection still writes directly to Supabase. Never put these credentials in Vite environment variables or commit them.

## Initial import and schedule

From the backend folder run:

npm run import:production

Then push the changed files and redeploy/restart the backend and frontend. The running backend imports every morning at 8:30 AM and 9:00 AM in America/New_York, including daylight saving changes. Production jobs run independently of WorkMyT browser collection. Local and PostgreSQL advisory locks prevent overlapping imports, including multiple server processes using the same database.

The backend process must be running at those times. If the hosting service sleeps or is stopped, an in-process cron cannot run; use an always-running service or an external cron invoking scripts/import-production-sheets.mjs with the same environment. A missed run is not automatically replayed. npm run import:production performs an immediate refresh when needed. An authenticated admin can also POST /api/production-sync.

## Stored data

- production_weeks: original grid and parsed snapshot per office/week, workbook/tab IDs and import time;
- production_weekly_reps: weekly E, G and total production per office/rep/week;
- production_days: dated daily E, G, partials, production and worked/absent status.

Weekly E/G totals are read from the workbook's weekly summary columns. Those E totals already include recorded partials in these workbooks, so partials are not added a second time to weekly production. Daily production is (E + partials) * 40 + G * 18. Weekly production is E * 40 + G * 18. Explicit zero is a worked day, x is absent, and blank daily cells remain unknown.

All requested office/week snapshots are fetched and checked before the publication transaction. Empty/malformed sheets or API failures preserve the last stored snapshots. Each successful transaction replaces that week's rows so corrected values and removed entries do not leave stale rows. Other weeks remain stored for history.

Weekly Training, Work Matchups, Stores and production rep search now use Supabase snapshots. Existing attendance/roles/trainers remain authoritative. Weekly Training's cutoff still uses the finished week; a current-week sheet does not replace it. Frontend production views refresh on import notifications and through periodic reads.

## Validation

Verified source layouts with read-only public workbook exports. The source list currently contains 10/17 and 10/10 for Canyon, Keasel and Collin; Mehta currently contains 10/10 and 10/03. The importer will select Mehta's 10/17 when that tab is added.

Frontend production build passed. Eight parser/import/training regression tests passed, covering four office layouts, tab/date selection, zero/absence/partial handling, office isolation, week rollover and transactional rollback. Actual source grids also parsed successfully. Live Google service-account authentication and Supabase writes were not exercised.

Run backend regression tests:
node --test tests/production-import.test.mjs tests/training.test.mjs
