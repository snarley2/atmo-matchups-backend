# Supabase migration — application storage

This package switches **the Express app's `server/sheets.mjs` storage** from Google Sheets to Supabase PostgreSQL. It keeps the same HTTP APIs and existing frontend unchanged. **The standalone WorkMyT and gap-generation runners are not yet natively migrated** (`last-day-worked.mjs`, `run-week-days-fix.mjs`, `generate-team-rep-gaps.mjs`, `generate-matchups-with-overrides.mjs`, `write-agents-to-sheet.mjs`); they still write Google Sheets. Do not shut off Google Sheets or assume weekly data is refreshed in Supabase until the runner migration is completed.

## Setup
1. Create a Supabase project. In Supabase **SQL Editor**, run `supabase/schema.sql`.
2. Under Supabase database connection settings obtain the **Postgres connection string** (prefer the session pooler when on IPv4-only infrastructure). Set `SUPABASE_DB_URL` on Render and locally. Do not put this string in Vite variables or frontend code.
3. Install backend dependencies with `npm install` (adds `pg`). The SQL table is private; its RLS is enabled with no client policies.
4. KEEP your existing Google Sheets credentials temporarily **for one-time migration and legacy automation**.
5. While the old app is paused for writes, run `npm run migrate:supabase`. This copies all tab rows from the existing Sheets workbook into `project_tabs`, without replacing existing Supabase tabs. To overwrite existing Supabase tab snapshots intentionally, run `npm run migrate:supabase -- --replace-existing` only with a verified backup.
6. Confirm in Supabase SQL Editor: `select title, jsonb_array_length(rows) as rows_count from public.project_tabs order by title;`. Specifically verify the restored Agents roster, the Work/Store Matchups documents, and weekly tabs.
7. Deploy the backend source files, set `SUPABASE_DB_URL` and restart Render. The frontend is unchanged. Do not remove Google credentials until standalone runners are also migrated.

## Important behavior
- Changes to Attendance go into Supabase, **not** Google Sheets, after the backend switches. Old scripts that directly write Sheets will **not** update Supabase.
- Rows are stored in a tab-compatible JSON array to preserve existing app routes and sheet structures; this is a compatibility transition, not a final relational model. Team edits and multi-user concurrency should be load tested.
- All backend storage writes are PostgreSQL transactions. During cutover, stop concurrent app writes; otherwise edits between snapshot and restart can be lost.
- The `project_tabs` table is not intended for browser access. Only the Express backend knows the Postgres URL.
- The current adapter maps known Sheets operations only. Export/formatting actions outside `server/sheets.mjs` still rely on Google APIs.
- Always keep an external backup before migration.

## Transitional automation bridge
The updated `run.mjs` skips the old `write-agents-to-sheet.mjs` task when Supabase is enabled, and runs `scripts/sync-workmyt-to-supabase.mjs` after WorkMyT and gap generation. The bridge copies only seven performance/gap tabs — **never Agents, attendance, matchups, notes, or other user-managed data**. It is safe for an incremental cutover, but the Google-based gap generator may still use stale Agents data in Google Sheets. Full migration of the collector and gap generator is recommended before decommissioning Sheets.
