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
- name (optional text, up to 60 characters, e.g. "Seawall Loop"; blank is stored as NULL)

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
- GET    /api/weekly        km per week for the last 12 weeks, oldest first, empty weeks included (for the chart)
- GET    /api/health        quick check that the server and database are up (returns status and run count)

GET endpoints are public so a portfolio page can read them later.
Auth is a single password (WRITE_PASSWORD) stored in a .env file (gitignored; .env.example is the committed template), sent in the X-Password request header. Wrong or missing password on a write returns 401. The server refuses to start if .env or the password is missing, or still the placeholder.
The page asks for the password on the first add/edit/delete and remembers it for that browser tab only (sessionStorage), with a "Forget password" button.
Keep it simple: no user accounts, no login system.

## Progress features
- All-time totals: km, elevation, number of runs, total time
- Weekly and monthly totals (this week = Monday to today, this month = 1st to today: km and number of runs), with a bar chart of km per week (last 12 weeks; weeks with no runs show as empty bars; the current week runs Monday to today; hover shows dates and km)
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

## Artifact 3: training plan from my run history

Goal: `node plan.js --goal marathon --race-date 2027-05-02 --runs-per-week 4`
generates a week-by-week plan based on my past runs.

### Plain code, before the model (plan.js)
- Reads runs from the database (same db module the server uses).
- Computes my baseline from the last 4 weeks: avg km/week, runs/week, longest run, typical pace.
- Checks the goal is realistic (weeks until race vs. how far baseline is from the goal).
  If not, stops with a clear message and a suggested earliest race date. The model is not called.

### What the model does (claude -p, headless)
- Receives ONLY: baseline numbers, goal distance, race date, runs per week, today's date, and the rules below.
- Returns ONLY JSON: weeks[] -> { week_start, days[] -> { date, run_type, distance_km, note } }.
- run_type must come from the app's allowed list; "rest" days are simply left out.

### Plain code, after the model
- Parses the JSON; if invalid, shows the raw output and stops.
- Validates the plan:
  - week 1 total within ±15% of baseline avg km/week
  - each week ≤ 110% of the previous week (cutback weeks may go down)
  - long run ≤ 35% of that week's total
  - final 2–3 weeks taper down; last run before race is short
  - all dates between today and race day; runs per week ≤ the requested number
- If any rule fails: send the exact errors back to the model and retry ONCE, then stop and show the errors.
- Saves the plan to plans/<goal>-<race-date>.json and prints a table (week, days, total km, long run).
- Logs each run (inputs, model output, validation result, retry yes/no) to logs/plan.jsonl.

### Rules
- The model never reads the database or .env; code passes it only the summary numbers.
- Every safety limit is enforced by code, not trusted to the model.
- README notes that these limits are general guidelines, not coaching or medical advice.

## Training plan on the web page

Server:
- POST /api/plan/check: body {goal, race_date, runs_per_week}. Returns baseline + realism result. Plain code only; never calls the model. Public.
- POST /api/plan/generate: same body. Requires the password (same X-Password check). Only runs if realistic. Calls claude -p exactly as plan.js does, validates, retries once, saves, logs. Returns the plan, the 9 PASS/FAIL results with numbers, and whether a retry happened.
- Only one generate can run at a time; a second request gets 409 with a clear message.
- Generate times out after 5 minutes with a clear error.
- GET /api/plan/latest: returns the most recently saved plan, or none.
- Reuse plan.js and plan-validate.js logic through a shared module; don't duplicate it.

Page:
- New "Training plan" section below the runs table: Goal (5k/10k/half/marathon), Race date, Runs per week (1–7).
- "Check" button shows baseline and Realistic yes/no with the reason. Free (no model).
- "Generate plan" button appears only when realistic. While running: button disabled, message "Generating plan… this takes about 2 minutes." Uses the same password dialog as add/edit/delete.
- Result: a table (week, dates, runs, total km, long run) plus the rule results. Clicking a week shows its days.
- On page load, show the latest saved plan if there is one.
- Plain HTML/CSS/JS, matching the existing style.

## UI and accessibility improvements

Reviewed on 2026-10-20; batches 1–6 done on 2026-10-21. Lighthouse (Edge, desktop), before → after: Performance 98 → 100, Accessibility 97 → 100, Best Practices 96 → 100, SEO 90 → 100.

### Items
Look
1. Color tokens: define all colors once as CSS variables on `:root`.
2. Button system: one `.btn` base with primary / secondary / danger / small, each with hover, pressed, focus and disabled states.
3. Typography: uppercase style only for card labels, plan title as a normal heading, line-height 1.5, a fixed size scale.
4. Spacing and form layout: fixed spacing steps, time hint full width under the form, buttons aligned without the `&nbsp;` spacer.
5. Summary cards: one big headline number per card, short date ranges, personal bests as matching cards.
6. Run-type labels: capitalized colored label with visible text, in the runs table and plan day rows.
7. Empty states: a short line with a next step for runs, chart and plan.
8. Dark mode: redefine the color variables under `prefers-color-scheme: dark`.

Ease of use
9. Today / Yesterday buttons next to the date input.
10. Live pace preview under the time field, with inline time-format errors.
11. Shorter messages: success clears after about 5 s, errors stay; password and load messages shown in their own place.
12. Errors next to the field: `aria-invalid`, message under the field, focus the first bad field.
13. Narrow-window layout: auto-fit cards, tables scroll sideways, still desktop-only.
14. Plan week rows show they open (▸/▾), plus Expand all / Collapse all.
15. Running timer while a plan is generating.

Accessibility
16. Plan weeks: a real `<button aria-expanded aria-controls>` in the first cell instead of `aria-expanded`/`tabindex` on the `<tr>` (the Lighthouse failure).
17. Focus outlines: one global `:focus-visible` outline, including the chart columns.
18. Chart keyboard: one tab stop, arrow keys between weeks, Home/End.
19. Contrast: input and button borders at least 3:1 (about `#8c959f`), darker danger border.
20. Color not the only signal: "Editing" tag and `aria-current` on the edited row, icon and word on messages.
21. Screen-reader messages: message areas always present, `role="alert"` for errors, announce the Check verdict, no `role` on the chart tooltip.
22. Button sizes: at least 32px tall with 8px between buttons.

### Build order (one commit per batch)
1. #16
2. #1, #2, #17, #19, #22
3. #21, #11, #20
4. #9, #10
5. #6, #5
6. #3, #4, #7, #13, #14, plus the viewport meta tag, a meta description and a favicon

Later: #8, #12, #15, #18

### Rules for this work
- Plain HTML/CSS/JS, no libraries.
- Don't change any server behavior unless an item needs it.
- After each batch, tell me exactly what to check in the browser and whether to rerun Lighthouse.

## Deploy to Vercel

Planned on 2026-10-26 (Hobby plan, connected to the GitHub repo). Not built yet.

### Changes
1. Password from env (`config.js`): use `WRITE_PASSWORD` from `process.env` if set, otherwise read `.env` as now; same refusal for missing or placeholder. Small.
2. Database layer (`store.js`): async queries that use Turso (`@libsql/client`) when `TURSO_DATABASE_URL` is set, otherwise `runs.db` through `db.js` as now; `server.js`, `plan-core.js` and `plan.js` await it; Turso table created with `CREATE TABLE IF NOT EXISTS`. Medium.
3. Model env (`plan-core.js`): `modelEnv()` also removes `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Small.
4. Time zone (`summary.js`): `APP_TIME_ZONE` (e.g. `America/Vancouver`) sets "today" through `Intl`; unset, the laptop clock is used as now. Small.
5. Plan generation off on Vercel: when `VERCEL` is set, `/api/plan/generate` returns 501 and the page hides "Generate plan" with a note to generate on the laptop. Small.
6. `package.json`: `"engines": { "node": "24.x" }` and add `@libsql/client`. Small.
7. Vercel settings (no code): `WRITE_PASSWORD`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_TIME_ZONE` for Production only; Node.js 24.x. Small.
8. README "Deploy to Vercel" section, plus LOG.md and CLAUDE.md updates. Small.

### Decisions
- One log everywhere: the laptop also uses Turso when the Turso settings are in `.env`. `runs.db` is used only when they're not set (offline/local fallback).
- Training plan: Check works on Vercel; Generate only on the laptop. Saving plans to Turso is left for later.

### Build order
1. Changes 1, 3, 4, 6 (one commit each)
2. Change 2, the database layer, tested locally first with a test database
3. Change 5, plan generation off on Vercel
4. Change 7, Vercel settings, then deploy
5. Change 8, the README

### Rules
- Keep the local version working exactly as now.
- Test each commit locally before the next.
- Never commit secrets (Turso token, password).
