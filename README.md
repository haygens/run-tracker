# Run Tracker

A small personal app for logging runs and tracking progress over time. It runs on your own computer: a Node.js + Express server with a SQLite database, and a plain HTML/CSS/JS page (no framework, no chart library).

## What it does

The page has four parts, top to bottom:

- **Progress**: four cards and a personal-bests list.
  - **All time:** total distance, elevation, number of runs and total time.
  - **This week:** Monday to today, km and runs.
  - **This month:** the 1st to today, km and runs.
  - **Current streak:** consecutive days with at least one run. It counts back from today, or from yesterday if you haven't run yet today.
  - **Personal bests:** longest run, most elevation, and fastest pace (runs of 5 km or more), each shown as the value and the run's name, e.g. `3:45 /km · Seawall Loop`.
- **Km per week**: a bar chart of the last 12 weeks.
  - Weeks run Monday to Sunday, and the current week runs Monday to today.
  - Weeks with no runs show as empty bars.
  - Hovering a bar (or tabbing to it) shows its dates, km and number of runs.
  - **Show as table** lists the same numbers.
- **Add a run**: date, optional name, distance, elevation, time and type. The same form is used to edit a run.
- **Runs**: every run, newest first, with a calculated pace column and Edit / Delete buttons.

Adding, editing and deleting need a password. Viewing doesn't.

## Setup on Windows

You need Windows PowerShell and about 5 minutes.

1. **Install Node.js 22.13 or newer** (the LTS version is fine):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   Close and reopen PowerShell, then check the version. It should print `v22.13.0` or higher:
   ```powershell
   node -v
   ```
2. **Get the code** and go into the folder:
   ```powershell
   git clone https://github.com/haygens/run-tracker.git
   cd run-tracker
   ```
3. **Install dependencies:**
   ```powershell
   npm install
   ```
4. **Create `.env` with your password.** These commands hide the password as you type and keep it out of your PowerShell history. Run them one at a time:
   ```powershell
   $secure = Read-Host "Choose a Run Tracker password" -AsSecureString
   ```
   ```powershell
   $pw = [System.Net.NetworkCredential]::new("", $secure).Password
   ```
   ```powershell
   [IO.File]::WriteAllText("$PWD\.env", "WRITE_PASSWORD='$pw'`n", (New-Object Text.UTF8Encoding $false))
   ```
   ```powershell
   Remove-Variable secure, pw
   ```
   - Don't use a single quote (`'`) in the password.
   - `.env` is gitignored. Run `git status` to check it isn't listed.
   - To change the password later, run the same four commands again.
   - `.env.example` shows the file format.
5. **Start the server:**
   ```powershell
   npm start
   ```
   You should see `Run Tracker listening on http://localhost:3000 (database: runs.db)`. Leave this window open. Press **Ctrl+C** to stop the server.
6. **Open http://localhost:3000** in your browser.

The database file `runs.db` is created on first start, next to the code. It's gitignored too. To back it up, copy `runs.db` while the server is stopped.

`npm run dev` does the same as `npm start`, but restarts the server whenever you save a code file.

## Starting it by double-click (start.bat)

After setup, you can skip PowerShell for daily use: **double-click `start.bat`** in the project folder.

- **What it does:**
  - Checks that Node.js is installed and that `.env` exists. If not, it explains what to do and waits for a key press.
  - Runs `npm install` the first time, if `node_modules` is missing.
  - Starts the server and opens http://localhost:3000 in your default browser as soon as the server is ready.
- **Already running?** If Run Tracker is already running, it just opens the browser and closes itself after a few seconds.
- **Stopping:** the black window must stay open while you use the app. **Close it to stop Run Tracker.**
- **If the server stops with an error** (for example, another program is using port 3000), the window stays open so you can read the message.

It uses `curl.exe` (built into Windows 10 and 11) to check when the server is ready.

### Make a desktop shortcut

**With the mouse:**

1. In File Explorer, right-click `start.bat`, then click **Show more options**, then **Send to**, then **Desktop (create shortcut)**.
2. Rename the shortcut on your desktop to `Run Tracker` if you like.

**Or in PowerShell,** from the project folder:

```powershell
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\Run Tracker.lnk")
$shortcut.TargetPath = "$PWD\start.bat"
$shortcut.WorkingDirectory = "$PWD"
$shortcut.Save()
```

If you move the project folder, delete the shortcut and make a new one.

## How to use it

1. **Add a run:** fill in the form and click **Add run**.
   - **Name** is optional. A run without a name shows its type instead (e.g. "Long").
   - **Distance** can be whole or decimal: `5` or `5.2`.
   - **Time** is in minutes: `75` = 75 min, `65:30` = 65 min 30 s, and `1:05:30` also works. Seconds must be `00`–`59`.
   - The first time you add, edit or delete in a browser tab, you're asked for the password. It's remembered for that tab until you close it or click **Forget password** (top right).
2. **Edit:** click **Edit** on a row. The form fills in and switches to **Save changes**. **Cancel** or **Esc** stops editing.
3. **Delete:** click **Delete** on a row and confirm. This can't be undone.

Everything on the page (summary, chart and table) updates straight away after each change.

## Training plan (plan.js)

Makes a week-by-week plan for a race from your last 4 full weeks of runs. Use it from the **Training plan** section at the bottom of the page, or from PowerShell. Either way it needs the `claude` command (Claude Code) to be installed and signed in.

**On the page:**
1. Pick a goal, a race date and runs per week, then press **Check**. Check is free (no model). It shows your baseline and whether the goal is realistic, and why.
2. If it is realistic, a **Generate plan** button appears. It asks for the password (the same dialog as add/edit/delete) and takes about 2 minutes.
3. The plan shows as a table of weeks: click a week to see its runs. The 9 rule results are listed under the table.
4. When the page opens, it shows the latest saved plan. Plans made by `plan.js` before the page could make plans say "Rule results weren't saved for this plan".

**From PowerShell:**

```powershell
node plan.js --goal marathon --race-date 2027-05-02 --runs-per-week 4
```

- `--goal` is `5k`, `10k`, `half` or `marathon`. `--runs-per-week` is 1 to 7.
- Add `--dry-run` to see exactly what would be sent to the model, without calling it.
- It prints your baseline and every run it counted, then checks whether the goal is realistic. If not, it stops and suggests an earliest race date. The model is not called.
- If it is realistic, `claude -p` writes the plan with no tools, so it can't read `runs.db` or `.env`. It receives only your baseline numbers, the goal, the dates and the rules.
- Code checks the plan against every rule and prints PASS or FAIL for each. If anything fails, the errors go back to the model once. If it still fails, nothing is saved.
- A plan that passes is saved to `plans/<goal>-<race-date>.json`. Every attempt is logged to `logs/plan.jsonl`. Both folders are gitignored.
- Rules checked: week 1 within ±15% of your baseline km/week, each week at most 10% more than the week before, the longest run at most 35% of its week, the final weeks (3 for a marathon, 2 otherwise) each lower than the week before, the last run before the race at most 6 km, all runs after today and before race day, and no more runs per week than you asked for.
- `node test-plan-validate.js` tests the rule checks with hand-made plans, without the model.

**These limits are general guidelines, not coaching or medical advice.** Talk to a coach or doctor about your own training, especially if you're new to running or have an injury.

## API

GET endpoints and `POST /api/plan/check` are public. The other POSTs, PUT and DELETE need the password in an `X-Password` header. Without it they return **401**. Bad data returns **400** with a list of problems.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/runs` | All runs, newest first |
| POST | `/api/runs` | Add a run (password) |
| PUT | `/api/runs/:id` | Replace a run's fields (password) |
| DELETE | `/api/runs/:id` | Delete a run (password); returns 204 |
| GET | `/api/summary` | All-time totals, this week, this month, personal bests, current streak |
| GET | `/api/weekly` | Km and number of runs per week for the last 12 weeks, oldest first |
| GET | `/api/health` | `{ "status": "ok", "runs": N }`: quick check that the server and database are up |
| POST | `/api/plan/check` | Training plan baseline and Realistic yes/no with the reason. Never calls the model |
| POST | `/api/plan/generate` | Generate a training plan with `claude -p` (password); see below |
| GET | `/api/plan/latest` | The most recently saved plan, or `{ "plan": null }` |

Both plan POSTs take `{ "goal": "marathon", "race_date": "2027-05-02", "runs_per_week": 4 }`.

`/api/plan/generate` works like `plan.js`: same baseline, checks, retry and log, and it saves to `plans/`.
- It only runs when the goal is realistic. Otherwise it returns **400** with the check result.
- It returns the plan, a row per week (dates, runs, total km, long run), the 9 rule results with numbers, and `retried`.
- Only one generate runs at a time. A second request while one is running gets **409**.
- After 5 minutes it stops `claude` and returns **504**. If the plan still fails after the retry, or the reply isn't JSON, it returns **502**. In all three cases nothing is saved.

A run in JSON:

```json
{
  "date": "2026-10-16",
  "name": "Seawall Loop",
  "distance_km": 5.2,
  "elevation_m": 40,
  "duration_sec": 1620,
  "run_type": "easy"
}
```

- `run_type` is one of `easy`, `long`, `tempo`, `intervals`, `race`, `trail`, `hike`.
- `name` is optional, up to 60 characters.
- `elevation_m` and `duration_sec` are whole numbers.
- Pace isn't stored. It's calculated from time and distance.

Example (PowerShell):

```powershell
Invoke-RestMethod http://localhost:3000/api/summary
```

## Troubleshooting

- **"Run Tracker cannot start: port 3000 is already in use"**: another Run Tracker server is still running. Press **Ctrl+C** in its window (or close its `start.bat` window), then start it again. `start.bat` handles this for you: if Run Tracker is already running, it just opens the browser. If you still see this message from `start.bat`, a different program is using port 3000.
- **"Run Tracker cannot start: No .env file found"** or **"WRITE_PASSWORD is missing"**: redo setup step 4.
- **"…still the placeholder from .env.example"**: you copied `.env.example` without changing the password. Redo setup step 4.
- **Editing `.env` in Notepad doesn't seem to save**: use the PowerShell commands in step 4 instead.
- **The page looks out of date after an update**: press **Ctrl+F5**.

## Known limitations

- **Runs locally only.** There's no hosting yet.
  - GitHub Pages can't run it, because it needs a Node server.
  - The server listens on all network interfaces, so other devices on the same Wi-Fi can open it on port 3000 and read the runs. Writes still need the password.
- **Single password, no accounts.** There's one password for all writes.
  - It travels over plain HTTP, which is fine on your own computer but not on a public network.
  - There's no limit on wrong attempts.
- **Uses your computer's clock and time zone** for "today", which decides this week, this month and the streak.
  - A run dated in the future counts in all-time totals, but not in this week, this month or the chart until that date arrives.
- **Desktop browser only.** There's no mobile layout.
- **No undo for deletes.** Back up `runs.db` if your runs matter to you.

## For testing

These environment variables let you run a test server without touching your real data:

| Variable | Default | Use |
|---|---|---|
| `PORT` | `3000` | Run a second server on another port |
| `DB_PATH` | `runs.db` next to the code | Use a throwaway database |
| `ENV_FILE` | `.env` next to the code | Use a test password file |
| `NO_BROWSER` | not set | `start.bat` only: set to `1` to skip opening the browser |
| `PLAN_TODAY` | your computer's date | Training plan: pretend today is another date (`YYYY-MM-DD`) |
| `CLAUDE_BIN` | `claude` | Training plan: path to the `claude` command if it isn't on your PATH. A `.js` file is run with Node (for a fake `claude` in tests) |
| `PLAN_OUTPUT_DIR` | the project folder | Training plan: save `plans/` and `logs/plan.jsonl` somewhere else |
| `PLAN_TIMEOUT_MS` | `300000` (5 minutes) | Server only: how long `/api/plan/generate` may take |

```powershell
[IO.File]::WriteAllText("$env:TEMP\test.env", "WRITE_PASSWORD='test-only'`n", (New-Object Text.UTF8Encoding $false))
$env:PORT = "3999"; $env:DB_PATH = "$env:TEMP\test-runs.db"; $env:ENV_FILE = "$env:TEMP\test.env"; npm start
```

When you're done, run `Remove-Item Env:PORT, Env:DB_PATH, Env:ENV_FILE` so later `npm start` runs use the real files again.

## Project files

| File | What's in it |
|---|---|
| `server.js` | Express app: routes, password check, error handling |
| `config.js` | Reads `WRITE_PASSWORD` from `.env`; refuses to start if it's missing |
| `db.js` | Opens SQLite, creates the `runs` table, and updates older databases |
| `validate.js` | Checks run data and builds the 400 error messages |
| `summary.js` | Totals, personal bests, streak and weekly numbers |
| `plan-core.js` | Training plan logic shared by `plan.js` and the server: baseline, realism check, `claude -p` call, retry, save, log, latest plan |
| `plan.js` | Training plan from PowerShell: reads the arguments and prints the results |
| `plan-validate.js` | Checks a plan against every rule (no model) |
| `test-plan-validate.js` | Tests `plan-validate.js` with hand-made plans |
| `public/` | The page: `index.html`, `style.css`, `app.js` (form, table, summary, SVG chart, password dialog, training plan) |
| `start.bat` | Double-click launcher: checks setup, starts the server, opens the browser |
| `CLAUDE.md` | Project spec |
| `LOG.md` | Build log: what changed and why |
