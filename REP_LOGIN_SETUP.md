# Individual production-ID logins

Extract the backend patch into the backend project and the frontend patch into the frontend project. Keep folder paths and replace the included files. Existing dependencies are sufficient.

## Before signing in

Keep SUPABASE_DB_URL and the production Google Sheets read credentials configured on the backend. Set ADMIN_SESSION_SECRET to a stable, long random server-side value on Render and locally. Existing ADMIN_LOGIN_PASSWORD is accepted as the signing-secret fallback if already configured; reps do not enter that password in the new login form.

GENERAL_ADMIN_REP_ID defaults to MXM-1324 as requested. Spaces and letter case are ignored at login; MXM - 1324 and mxm-1324 are accepted. This is a shared general admin login, so possession of that code grants full admin access. Changing GENERAL_ADMIN_REP_ID changes the accepted general code.

1. Deploy/restart the updated backend.
2. From the backend folder run npm run import:production once. This imports Rep IDs and links them to existing people; scheduled morning imports continue to maintain those links.
3. Deploy the frontend and sign in with the Rep ID from the production log plus the office.

After this frontend update, sign in once using a production Rep ID (or the general admin code); the old password-based browser session is not reused.

Individual sessions are saved in browser localStorage and last 90 days by default, renewed on valid session restoration. REP_SESSION_DAYS can change that lifetime. Logout removes the saved session. Signed tokens identify the rep for submissions and live activity. Trainer/manager/director/owner/admin accounts receive admin access; standard reps retain the standard views. Role eligibility is checked server-side and is not taken from client-submitted role or admin flags.

## Rep IDs and roles

IDs are read from Rep ID or Agent ID header columns. Display formatting is preserved, including prefixes and leading zeros. In the layouts inspected earlier, Mehta supplies Rep IDs. Canyon, Keasel and Collin do not currently supply Rep ID columns in those inspected layouts; those offices need actual IDs added to their weekly sheets before individual ID login is available. Add a column at the end so daily E/G/partials columns stay in place. IDs are not guessed from names or replaced with invented numbers.

Production Position/Role values are used when available. Existing Attendance trainer-or-higher roles are also retained and recognized; assigning a trainee to a trainer does not make that trainee an admin. The trainer assignment field and repType role are separate.

The shared general login is available independently of the production rep list and can manage all offices.

## Preserving data during conversion

Existing Agents repKey UUIDs are converted to the verified production ID when the source rep has an unambiguous match. Trainer, teamLead, team, attendance, readiness, notes and custom columns are copied unchanged. Only the identity key is replaced. Repeat imports do not replace manual assignments or reset attendance. Explicit Attendance edits still work normally.

The backend updates matching IDs in existing project data, serialized matchup membership, coaching assessments and production tables within a transaction. Old UUID and provisional production-key aliases are retained in rep_id_aliases. The alias table is created automatically; if your database user cannot create tables, run supabase/rep-logins.sql first.

The newest source week is processed first. Duplicate source IDs or ambiguous identities are reported rather than silently merged. Existing IDs and personal assignments are not guessed across offices.

## Name matching

Names are normalized for capitalization, accents, punctuation, role suffixes and comma ordering. WorkMyT and production names can match when at least two distinct name parts agree within the same office. A unique best match is required. Ambiguous same-office names stay unresolved and appear in identity warnings instead of losing one rep's assignments to another.

Daily rep discovery avoids creating another agent when two name parts already match. Performance/gap views use the same matching rule so saved coaching data remains attached to the correct person.

## Validation and limits

Frontend production build passed. Backend tests cover role selection, general admin access, saved-session restoration, two-part names, ID formatting, office separation, UUID/reference conversion, preservation of trainer/manual fields, repeated imports and rollback on failure. Live Supabase migrations and browser visual inspection were not performed here.

Run checks with Node 24:
node --experimental-test-module-mocks --test tests/rep-login.test.mjs tests/rep-identity.test.mjs tests/production-import.test.mjs tests/training.test.mjs tests/training-focus.test.mjs tests/coaching.test.mjs tests/supabase-collectors.test.mjs
