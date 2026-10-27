const { TURSO } = require('./config');
const { runsTableSql, RUNS_INDEX_SQL } = require('./schema');

// Every query the app makes, in one place, as async functions. Two backends:
// - Turso (hosted SQLite) when TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set (on Vercel,
//   or on the laptop through .env), so every device sees the same runs.
// - Otherwise runs.db through db.js, exactly as before (node:sqlite, migrations, DB_PATH, read-only mode).
// Both run the same SQL, so the results are the same.

// DB_READ_ONLY=1 (set by plan.js): only reads, and the Turso table setup is skipped, like db.js does
const READ_ONLY = process.env.DB_READ_ONLY === '1';

// runs.db: node:sqlite is synchronous; wrapping it in async functions changes nothing else.
// db.js is only loaded here, so with Turso no runs.db file is opened or created.
function localBackend() {
  const db = require('./db');
  const call = (sql, method, args) => {
    const statement = db.prepare(sql);
    return Array.isArray(args) ? statement[method](...args) : statement[method](args);
  };
  return {
    name: 'runs.db',
    async all(sql, args = []) {
      return call(sql, 'all', args);
    },
    async run(sql, args = []) {
      const result = call(sql, 'run', args);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
  };
}

// Turso over HTTPS. The web build has no native code (the native build needs the
// Visual C++ runtime) and suits Vercel's short-lived functions.
function tursoBackend({ url, authToken }) {
  const { createClient } = require('@libsql/client/web');
  const client = createClient({ url, authToken });

  // Create the table once per process, on first use (not at startup, so a failure is a
  // clear error on that request instead of a crash). Turso starts with the current schema,
  // so db.js's migrations for older runs.db files aren't needed.
  let ready = null;
  function setUp() {
    if (READ_ONLY) return Promise.resolve();
    ready ??= client.batch([runsTableSql('runs'), RUNS_INDEX_SQL], 'write').catch((err) => {
      ready = null; // try again on the next request
      throw err;
    });
    return ready;
  }

  // Rows as plain objects, like node:sqlite returns them
  const toObjects = (result) => result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])));

  return {
    name: 'Turso',
    async all(sql, args = []) {
      await setUp();
      return toObjects(await client.execute({ sql, args }));
    },
    async run(sql, args = []) {
      await setUp();
      const result = await client.execute({ sql, args });
      return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid) };
    },
  };
}

const backend = TURSO.url ? tursoBackend(TURSO) : localBackend();

async function getRun(id) {
  const [run] = await backend.all('SELECT * FROM runs WHERE id = ?', [id]);
  return run ?? null;
}

module.exports = {
  backendName: backend.name,

  async countRuns() {
    const [{ count }] = await backend.all('SELECT COUNT(*) AS count FROM runs');
    return count;
  },

  // Newest first (id breaks ties for runs on the same day)
  listRuns() {
    return backend.all('SELECT * FROM runs ORDER BY date DESC, id DESC');
  },

  // In table order, for the summary and the chart
  allRuns() {
    return backend.all('SELECT * FROM runs');
  },

  getRun,

  // run comes from validateRun; returns the saved run
  async addRun(run) {
    const result = await backend.run(`
      INSERT INTO runs (date, distance_km, elevation_m, duration_sec, run_type, name)
      VALUES (:date, :distance_km, :elevation_m, :duration_sec, :run_type, :name)
    `, run);
    return getRun(result.lastInsertRowid);
  },

  // All fields are replaced; returns the saved run, or null if there's no run with that id
  async updateRun(id, run) {
    const result = await backend.run(`
      UPDATE runs
      SET date = :date, distance_km = :distance_km, elevation_m = :elevation_m,
          duration_sec = :duration_sec, run_type = :run_type, name = :name
      WHERE id = :id
    `, { ...run, id });
    return result.changes === 0 ? null : getRun(id);
  },

  // true if a run was deleted
  async deleteRun(id) {
    const result = await backend.run('DELETE FROM runs WHERE id = ?', [id]);
    return result.changes > 0;
  },

  // Runs from start to end (inclusive), oldest first: the training plan's baseline
  runsBetween(start, end) {
    return backend.all(
      `SELECT id, date, distance_km, duration_sec, run_type, name
         FROM runs WHERE date BETWEEN ? AND ? ORDER BY date, id`,
      [start, end],
    );
  },
};
