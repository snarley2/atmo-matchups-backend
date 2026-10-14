Apply these changed files over the matching backend and frontend projects.

Restart/redeploy both projects, then run this from the backend folder with the
same SUPABASE_DB_URL as the live server:

    npm run update:production

This reads the four configured Google Sheets into Supabase, links IDs in the
Agents rep_id field, and prints each rep's latest recorded E/G/production.
The Mehta and Skye workbook IDs in the supplied config were swapped; this
patch restores their correct office mappings. The import removes a wrong-office
copy only when the corrected logs verify its office, an identical-key/name row
exists in the correct office, and the copy has only default/manual-empty fields.
Rows with manual team/trainer/attendance/readiness/other fields are preserved and
reported for review. Stable keys, trainer assignments and other board references
are not rewritten through aliases. The old alias table is no longer used here.

Attendance has In / Absent / Roadtrips tabs and an editable Rep ID field.
Roadtrips has a Monday–Saturday weekly planner; overlapping trips are allowed.
Select Roadtrip in Attendance, then select the trip. Assigned reps are excluded
from local matchups on that trip's scheduled days. An unassigned Roadtrip status
keeps the rep out until a trip is selected. Scheduling creates its Supabase table
automatically with the existing backend database credentials.

Create Matchups: click a rep, then its destination's leader spot to swap leaders,
or its Reps area to add a member. Select a leader/trainer and use the new group
button to create a group led by that person. Drag-and-drop still works.
Work Matchups: click a rep and then a team; Add team starts a new team with the
selected rep. Existing three-person capacity checks remain in place.

Stores also has a Refresh production from sheets button. It imports into
Supabase and refreshes the live boards. New roster entries are added only via
Attendance or the explicit Import missing production reps action, so production
reads do not manufacture duplicate agents.

Suggestions no longer references undefined office/agent variables.
All application changes save in Supabase; Google Sheets is only the source of
production imports. No local TSV files are used for live production.

Verification: frontend build, 52 automated tests, and render checks of Create
Matchups, Work Matchups, Attendance and Suggestions passed. The live database
and actual Google API imports were not executed during this patch.
