const { RUN_TYPES } = require('./validate');

// The runs table, shared by runs.db (db.js) and Turso (store.js) so both get exactly the same one.
// CHECK constraints are a safety net; the API validates first and returns clear 400s.
// The run_type list comes from validate.js so the two can't drift apart.
function runsTableSql(name) {
  const typeList = RUN_TYPES.map((t) => `'${t}'`).join(', ');
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      distance_km  REAL    NOT NULL CHECK (distance_km > 0),
      elevation_m  INTEGER NOT NULL DEFAULT 0 CHECK (elevation_m >= 0),
      duration_sec INTEGER NOT NULL CHECK (duration_sec > 0),
      run_type     TEXT    NOT NULL CHECK (run_type IN (${typeList})),
      name         TEXT
    )
  `;
}

const RUNS_INDEX_SQL = 'CREATE INDEX IF NOT EXISTS idx_runs_date ON runs (date)';

module.exports = { runsTableSql, RUNS_INDEX_SQL };
