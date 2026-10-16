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
