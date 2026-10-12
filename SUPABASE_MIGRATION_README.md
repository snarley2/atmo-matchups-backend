# Direct Supabase storage

WorkMyT collectors now write directly into Supabase PostgreSQL using the existing public.project_tabs table. Google Sheets is no longer used in daily collection, gap generation, agent discovery, or standalone matchup generation.

## Update

1. Extract this patch into the backend project and replace the included files.
2. Keep SUPABASE_DB_URL configured both locally and on Render. This is a server-side Postgres connection string, not SUPABASE_URL or an API key. Existing SUPABASE_DB_SSL and SUPABASE_DB_SSL_VERIFY options still apply.
3. Keep WORKMYT_EMAIL, WORKMYT_PASSWORD and existing browser/campaign settings. Browser login and scraping behavior are unchanged.
4. The existing public.project_tabs table must be present (supabase/schema.sql). Existing Supabase data and application APIs are preserved; no new migration or reimport is required for an already configured project.
5. Push the changed backend files and redeploy/restart. No frontend changes are required.
6. Run npm run run to collect Last Worked, append new Agents, collect Current Week plus the previous three weeks, and generate Team/Rep Gaps directly in Supabase.

Existing environment variables naming tabs remain supported, including GOOGLE_SHEET_TAB. They identify Supabase data tabs; they do not initiate a Google Sheets connection. The migrated commands do not require GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_FILE, or Google API credentials.

The write-agents-to-sheet.mjs filename is retained for existing commands, but now reads Last Worked and appends only missing identities in Supabase. Existing UUIDs, attendance, roles, teams, and trainer assignments are retained.

The sync:performance command is now a compatibility no-op. This prevents an old scheduled copy from overwriting direct Supabase output with old Google Sheets values. The explicit migrate:supabase import command remains available for a deliberate initial import, and still requires Google access; do not run it for routine refreshes.

Production totals for Weekly Training, Work Matchups and Stores still come from the supplied TSV logs. WorkMyT performance is stored in Supabase; this patch does not replace the agreed TSV production source.

Reports are published atomically, so shrinking a report removes stale rows without exposing an empty intermediate report. Last Worked history and historical-only collection keep their existing behavior.

## Checks

Syntax checks passed for all changed runtime files. Mocked database integration tests cover direct daily/history writes, all four weekly periods, gap generation, preserving attendance/assignments during rep discovery, and rollback on database failure. Existing training tests also pass.

Run from the backend folder (Node 24):
node --experimental-test-module-mocks --test tests/supabase-collectors.test.mjs tests/training.test.mjs

A real WorkMyT browser session and live Supabase connection have not been exercised here.
