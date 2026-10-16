const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Single-file database next to the code (gitignored via *.db)
const DB_PATH = path.join(__dirname, 'runs.db');

const db = new DatabaseSync(DB_PATH);

// CHECK constraints are a safety net; the API validates first and returns clear 400s
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    distance_km  REAL    NOT NULL CHECK (distance_km > 0),
    elevation_m  INTEGER NOT NULL DEFAULT 0 CHECK (elevation_m >= 0),
    duration_sec INTEGER NOT NULL CHECK (duration_sec > 0),
    run_type     TEXT    NOT NULL CHECK (run_type IN ('easy', 'long', 'tempo', 'intervals', 'race', 'trail'))
  );
  CREATE INDEX IF NOT EXISTS idx_runs_date ON runs (date);
`);

module.exports = db;
