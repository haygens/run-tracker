const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { RUN_TYPES } = require('./validate');
const { runsTableSql, RUNS_INDEX_SQL } = require('./schema');

// Single-file database next to the code (gitignored via *.db).
// DB_PATH can point somewhere else, e.g. a throwaway file for testing.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'runs.db');

// DB_READ_ONLY=1 (set by plan.js) opens the file read-only: SQLite refuses any write,
// a missing file is an error instead of a new empty database, and the setup below is skipped.
const READ_ONLY = process.env.DB_READ_ONLY === '1';

const db = new DatabaseSync(DB_PATH, { readOnly: READ_ONLY });

// The table definition is in schema.js, shared with Turso
function createRunsTable(name) {
  db.exec(runsTableSql(name));
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
      INSERT INTO runs_new (id, date, distance_km, elevation_m, duration_sec, run_type, name)
      SELECT id, date, distance_km, elevation_m, duration_sec, run_type, name FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Older tables were created before runs had a name. Unlike a CHECK change, a new
// column can be added in place; existing runs get NULL (shown as their run type).
function migrateAddName() {
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get();
  if (!existing) return;
  const columns = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
  if (columns.includes('name')) return;

  console.log('Adding name column to runs table...');
  db.exec('ALTER TABLE runs ADD COLUMN name TEXT');
}

if (!READ_ONLY) {
  // Order matters: migrateRunTypes copies the name column, so it must exist first
  migrateAddName();
  migrateRunTypes();
  createRunsTable('runs');
  db.exec(RUNS_INDEX_SQL);
}

module.exports = db;
