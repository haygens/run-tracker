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
   You should see `Run Tracker listening on http://localhost:3000`. Leave this window open. Press **Ctrl+C** to stop the server.
6. **Open http://localhost:3000** in your browser.

The database file `runs.db` is created on first start, next to the code. It's gitignored too. To back it up, copy `runs.db` while the server is stopped.

`npm run dev` does the same as `npm start`, but restarts the server whenever you save a code file.

## How to use it

1. **Add a run:** fill in the form and click **Add run**.
   - **Name** is optional. A run without a name shows its type instead (e.g. "Long").
   - **Distance** can be whole or decimal: `5` or `5.2`.
   - **Time** is in minutes: `75` = 75 min, `65:30` = 65 min 30 s, and `1:05:30` also works. Seconds must be `00`–`59`.
   - The first time you add, edit or delete in a browser tab, you're asked for the password. It's remembered for that tab until you close it or click **Forget password** (top right).
2. **Edit:** click **Edit** on a row. The form fills in and switches to **Save changes**. **Cancel** or **Esc** stops editing.
3. **Delete:** click **Delete** on a row and confirm. This can't be undone.

Everything on the page (summary, chart and table) updates straight away after each change.

## API

GET endpoints are public. POST, PUT and DELETE need the password in an `X-Password` header. Without it they return **401**. Bad data returns **400** with a list of problems.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/runs` | All runs, newest first |
| POST | `/api/runs` | Add a run (password) |
| PUT | `/api/runs/:id` | Replace a run's fields (password) |
| DELETE | `/api/runs/:id` | Delete a run (password); returns 204 |
| GET | `/api/summary` | All-time totals, this week, this month, personal bests, current streak |
| GET | `/api/weekly` | Km and number of runs per week for the last 12 weeks, oldest first |
| GET | `/api/health` | `{ "status": "ok", "runs": N }`: quick check that the server and database are up |

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

- **"Run Tracker cannot start: port 3000 is already in use"**: another Run Tracker server is still running. Press **Ctrl+C** in its window, then run `npm start` again.
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
| `public/` | The page: `index.html`, `style.css`, `app.js` (form, table, summary, SVG chart, password dialog) |
| `CLAUDE.md` | Project spec |
| `LOG.md` | Build log: what changed and why |
