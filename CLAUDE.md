# Run Tracker

Personal app for logging my runs and tracking progress over time.
Runs locally on my laptop for now (desktop browser only, no mobile layout needed).
Deploying online and linking it from my portfolio comes later, after the first version is due.

## Stack
- Node.js + Express REST API
- SQLite database (single file, gitignored)
- Plain HTML/CSS/JS front end served by Express (no framework)
- Developed on Windows; give PowerShell commands, numbered and copy-paste ready

## Data
A run has:
- id
- date (YYYY-MM-DD)
- distance_km (decimal, > 0)
- elevation_m (integer, >= 0)
- duration_sec (integer, > 0) — entered as hh:mm:ss in the form
- run_type (one of: easy, long, tempo, intervals, race, trail)

Pace (min/km) is calculated from duration and distance, not stored.

## API
- GET    /api/runs          list runs, newest first
- POST   /api/runs          add a run            (requires password)
- PUT    /api/runs/:id      edit a run           (requires password)
- DELETE /api/runs/:id      delete a run         (requires password)
- GET    /api/summary       all-time totals, this week/month totals, personal bests, current streak
- GET    /api/weekly        km per week for the last 12 weeks (for the chart)

GET endpoints are public so a portfolio page can read them later.
Auth is a single password stored in a .env file (gitignored), sent in a request header.
Keep it simple: no user accounts, no login system.

## Progress features
- All-time totals: km, elevation, number of runs, total time
- Weekly and monthly totals, with a bar chart of km per week
- Personal bests: longest run, most elevation, fastest pace (runs of 5 km or more)
- Streak: consecutive days with at least one run
- Weeks start on Monday

## Build order (3-day deadline)
Day 1 — core
1. Express server + SQLite runs table
2. POST and GET /api/runs with validation
3. Page with an add-run form and a runs table (with pace column)

Day 2 — progress
4. Edit and delete
5. /api/summary: totals, this week/month, personal bests, streak
6. Weekly km bar chart

Day 3 — finish
7. Password on write endpoints
8. Test everything, fix bugs, write README with setup steps
9. Final LOG.md entry

Later (not part of this deadline)
- Deploy to a host that can run Node (GitHub Pages cannot)
- Portfolio widget reading /api/summary

## Rules
- Validate input on the server; reject bad data with a 400 and a clear message
- Keep changes small; one feature per commit
- After each change, add an entry to LOG.md: what changed and why
- Tell me how to run and test anything you build
- Never commit secrets (.env) or the database file
