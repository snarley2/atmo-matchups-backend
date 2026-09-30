# ATMO API updates

The `/api/matchups/auto` route now uses a team-first generator. Active reps remain inside their teams, managers/trainers are excluded from rep slots, and a coach from the same team is preferred.

Agent updates through `PUT /api/agents/:repKey` support `teamLead`, so the independent React UI can update team leads directly in the Agents sheet.

## v3 performance data
The bootstrap and auto-matchup routes also read:
- Last Worked
- Current Week Avg
- Last Week Avg

Each agent includes counts and funnel conversion percentages for those three periods.

## Store matchups

- `POST /api/store-matchups/generate` creates the current attendance-based store order (admin only).
- `GET /api/store-matchups` returns the posted store matchups.
- `POST /api/store-matchups` replaces the `Store Matchups` Google Sheet tab (admin only).
- The Agents sheet now supports an optional `trainer` column. New Reps fall back to their Team Lead when that person is a Trainer or Manager.
- Trainer/trainee groups receive first selection priority and are ordered by combined four-week production. Remaining reps follow their individual overall-production ranking.
- Stores contain two people by default, with one solo or three-person store when headcount requires it.

Set `STORE_MATCHUPS_SHEET_NAME` to override the default `Store Matchups` tab name.
