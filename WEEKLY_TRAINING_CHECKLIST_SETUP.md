# Checklist focus points in Weekly Training

Extract the backend ZIP into the backend project and the frontend ZIP into the frontend project, replacing the included files. Deploy/restart both projects.

No new tables, dependencies or environment variables are required. This uses the coaching_methods and coaching_rep_methods tables from the Gap Methods / Rep Improvement Checklist update.

Weekly Training now shows methods matching each rep's existing Training focus gap:
- Needs practice: unchecked methods, including new methods without a saved assessment.
- Implements well: checked methods for that rep.

Only active methods from the selected office and the matching funnel gap appear. Other reps' checks and methods from other offices do not affect the summary. The list shows up to three methods in each column initially. Expand a rep to see all methods, their instructions and the existing funnel rates.

Edit assessments in Coaching → Rep Improvement Checklist. Weekly Training reads those saved Supabase checks when opened or through its existing one-minute refresh. It also refreshes on a production import notification. This does not change the electric target, production values, role eligibility or absent-rep filtering.

When no gap is identified, the page explains that it needs a funnel gap. When a gap has no methods, it points to Gap Methods rather than displaying unrelated techniques. Archiving a method removes it from the active focus summary while retaining the rep's assessment.

Validation: frontend production build passed. Eight regression checks passed, including all five gap labels, checked/unchecked separation, rep/office isolation, archived methods, existing eligibility rules, and batched Supabase checklist reads with mocked database data. Live Supabase writes and browser visual inspection were not performed.

Backend tests:
node --experimental-test-module-mocks --test tests/training-focus.test.mjs tests/training.test.mjs tests/coaching.test.mjs
