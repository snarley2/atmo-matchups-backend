# ATMO API updates

The `/api/matchups/auto` route now uses a team-first generator. Active reps remain inside their teams, managers/trainers are excluded from rep slots, and a coach from the same team is preferred.

Agent updates through `PUT /api/agents/:repKey` support `teamLead`, so the independent React UI can update team leads directly in the Agents sheet.

## v3 performance data
The bootstrap and auto-matchup routes also read:
- Last Worked
- Current Week Avg
- Last Week Avg

Each agent includes counts and funnel conversion percentages for those three periods.
