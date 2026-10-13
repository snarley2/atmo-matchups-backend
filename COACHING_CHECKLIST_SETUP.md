# Gap methods and rep improvement checklists

Extract the backend patch into your backend project, preserving the server and supabase folder paths. Extract the frontend patch into the frontend project. Replace the included files, push and redeploy both projects.

No new dependencies or environment variables are needed. The existing SUPABASE_DB_URL and database SSL settings are used. On first access the backend creates coaching_methods and coaching_rep_methods using supabase/coaching.sql. If your database user cannot create tables, run the included SQL in Supabase SQL Editor before opening the pages.

Both pages appear under Coaching after admin login:

1. Gap Methods: select one of the five funnel gaps, add a method name and instructions, edit methods, or archive and restore them. Methods are specific to the selected office. Each new method starts unchecked for every rep.
2. Rep Improvement Checklist: search/select an office rep, then review all gaps or one gap. Check techniques the rep implements well; leave or make them unchecked for techniques that need work. Changes save automatically and show a saved status. The page shows an overall implemented count and a count for each gap.

Methods and rep assessments are kept in separate Supabase tables. Each checkbox save updates only that rep/method pair; changing one rep does not change another. Office and admin authorization are checked in the backend. Last updated time and coach are stored. A failed save rolls back the checkbox and displays an error.

Archiving removes a method from active checklists while retaining saved assessments. Restoring it brings back previous checks. Edit a method's wording or instructions in place. To move a technique to a different gap, add a new method there and archive the old one.

The roster, current funnel gaps and office selector keep their existing behavior. Provisional production reps remain selectable while their production cache is loaded; existing Attendance identities stay authoritative.

Validation: frontend production build passed. Thirteen backend checks passed using mocked databases, including create/edit/archive/restore, save/reload/unchecked state, separate reps/offices, missing/invalid inputs and admin authorization. Live Supabase writes and browser visual inspection were not performed in this environment.

Run backend checks with Node 24:
node --experimental-test-module-mocks --test tests/coaching.test.mjs
