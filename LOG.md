# Build Log

## 2026-10-15
- Planned scope, wrote CLAUDE.md, set up repo.

## 2026-10-16
- **Day 1, step 1: Express server + SQLite runs table.**
  - Added `server.js` (Express app on port 3000). It serves `public/` and has a `GET /api/health` check that returns `{ status, runs }`, so you can confirm the server and database are both up.
  - Added `db.js`, which opens `runs.db` and creates the `runs` table if it doesn't exist. The columns follow CLAUDE.md, with CHECK constraints as a safety net. Request validation and clear 400 messages come in step 2.
  - Used Node's built-in `node:sqlite` instead of an npm SQLite package. Why: no native module to compile on Windows, and one less dependency. This needs Node 22.13 or newer (this machine has v24).
  - Added a placeholder `public/index.html`. The real form and table come in step 3.
  - Added `npm start` and `npm run dev` (auto-restarts on file changes).
- **Added a rule to CLAUDE.md: stop only the test server's own process, never all `node.exe`.**
  - Why: while testing step 1, the server was stopped with a command that closed every Node process on the laptop. That could have closed other programs that were running.
- **Day 1, step 2: `POST` and `GET /api/runs` with validation.**
  - `GET /api/runs` returns all runs, newest date first. Runs on the same day are ordered newest-added first.
  - `POST /api/runs` adds a run and returns it with status 201. Bad input gets a 400 with `{ error, details }`, which lists every problem at once so you can fix them all in one go.
  - Validation lives in a new `validate.js`, so the edit endpoint in step 4 can reuse it. Rules:
    - `date` must be a real calendar date (`2026-02-30` is rejected).
    - `distance_km` must be a number > 0.
    - `elevation_m` must be a whole number >= 0.
    - `duration_sec` must be a whole number > 0.
    - `run_type` must be one of the six types.
    - Numbers sent as strings (`"5"`) are rejected, and unknown extra fields are ignored.
  - The API takes duration in seconds. The form in step 3 will turn hh:mm:ss into seconds before sending.
  - Broken JSON and unknown `/api/...` URLs now get JSON error messages instead of Express's HTML error pages.
  - `db.js` now reads an optional `DB_PATH` environment variable. Why: tests can use a throwaway database and leave the real `runs.db` alone.
- **Manual test of step 2.**
  - At first, `POST /api/runs` returned 404. An old server from step 1 was still running the old code. Restarting the server fixed it.
  - Then I tested one valid run and these bad inputs:
    - invalid date
    - negative distance
    - decimal elevation
    - zero duration
    - bad run type
    - numbers sent as text
    - an empty object
    - broken JSON
  - Every bad input was rejected with a 400, and only the valid run was saved.
- **Day 1, step 3: add-run form and runs table with a pace column.**
  - `public/index.html` now has an add-run form and a runs table. The form has date (defaults to today), distance, elevation (defaults to 0), time and type.
  - New `public/app.js`:
    - Turns the hh:mm:ss time into seconds before sending. `mm:ss` like `27:00` also works.
    - Posts the run to the API. The server's error messages are shown as a list under the form.
    - Reloads the table after a run is saved.
  - Pace is calculated in the browser from time ÷ distance and shown as min:sec per km. It is rounded to the nearest second, and it isn't stored, as CLAUDE.md says.
  - After a successful save, distance, elevation and time are cleared, but date and type are kept. Why: that makes it quick to enter several runs from the same day or week.
  - The table text is filled in safely (with `textContent`, not `innerHTML`), so data from the database can't inject HTML into the page.
  - New `public/style.css`: a simple desktop layout.
  - Validation is still done on the server. The browser only checks the time format, because that is the one field it has to convert.
