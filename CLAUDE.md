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
- distance_km (number, > 0; whole numbers like 5 are fine)
- elevation_m (integer, >= 0)
- duration_sec (integer, > 0) — entered in the form as minutes: 75 (75 min), 65:30 (65 min 30 s), or 1:05:30 (same as 65:30); seconds must be 00–59, anything else is rejected with a clear message
- run_type (one of: easy, long, tempo, intervals, race, trail, hike)
- name (optional text, up to 60 characters, e.g. "Seawall Loop"; blank is stored as empty)

Pace (min/km) is calculated from duration and distance, not stored.

Display:
- Distance without unneeded decimals: 5, 5.2, 5.25 (not 5.00 or 5.20)
- Time as h:mm:ss when an hour or more (1:05:30), otherwise mm:ss (27:00)
- Name: a run without a name shows its run type capitalized instead ("Long", "Hike")

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
- Weekly and monthly totals (this week = Monday to today, this month = 1st to today: km and number of runs), with a bar chart of km per week
- Personal bests: longest run, most elevation, fastest pace (runs of 5 km or more). Hikes count everywhere, like any other run type.
  Shown as the value and the run's name only, e.g. "Fastest pace: 3:45 /km · Seawall Loop"
- Streak: consecutive days with at least one run, counting back from today, or from yesterday if there's no run yet today
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
- When starting a test server, stop only that specific process (by its PID); never kill all node.exe processes
