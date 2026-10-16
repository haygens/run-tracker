const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { RUN_TYPES } = require('./validate');

// Single-file database next to the code (gitignored via *.db).
// DB_PATH can point somewhere else, e.g. a throwaway file for testing.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'runs.db');

const db = new DatabaseSync(DB_PATH);

// CHECK constraints are a safety net; the API validates first and returns clear 400s.
// The run_type list comes from validate.js so the two can't drift apart.
function createRunsTable(name) {
  const typeList = RUN_TYPES.map((t) => `'${t}'`).join(', ');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${name} (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      distance_km  REAL    NOT NULL CHECK (distance_km > 0),
      elevation_m  INTEGER NOT NULL DEFAULT 0 CHECK (elevation_m >= 0),
      duration_sec INTEGER NOT NULL CHECK (duration_sec > 0),
      run_type     TEXT    NOT NULL CHECK (run_type IN (${typeList}))
    )
  `);
}

// SQLite can't change a CHECK constraint in place. If the existing table was created
// with an older run_type list (e.g. before "hike"), rebuild it and copy the runs over.
function migrateRunTypes() {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get();
  if (!existing || RUN_TYPES.every((t) => existing.sql.includes(`'${t}'`))) return;

  console.log('Updating runs table to allow new run types...');
  db.exec('BEGIN');
  try {
    createRunsTable('runs_new');
    db.exec(`
      INSERT INTO runs_new (id, date, distance_km, elevation_m, duration_sec, run_type)
      SELECT id, date, distance_km, elevation_m, duration_sec, run_type FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

migrateRunTypes();
createRunsTable('runs');
db.exec('CREATE INDEX IF NOT EXISTS idx_runs_date ON runs (date)');

module.exports = db;
