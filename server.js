const path = require('node:path');
const express = require('express');
const db = require('./db');
const { validateRun } = require('./validate');
const { summarize } = require('./summary');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Quick check that the server and database are up
app.get('/api/health', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM runs').get();
  res.json({ status: 'ok', runs: count });
});

// List runs, newest first (id breaks ties for runs on the same day)
app.get('/api/runs', (req, res) => {
  const runs = db.prepare('SELECT * FROM runs ORDER BY date DESC, id DESC').all();
  res.json(runs);
});

// Add a run
app.post('/api/runs', (req, res) => {
  const { errors, run } = validateRun(req.body);
  if (errors) {
    return res.status(400).json({ error: 'Invalid run', details: errors });
  }

  const result = db.prepare(`
    INSERT INTO runs (date, distance_km, elevation_m, duration_sec, run_type)
    VALUES (:date, :distance_km, :elevation_m, :duration_sec, :run_type)
  `).run(run);

  const created = db.prepare('SELECT * FROM runs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// All-time totals, this week/month, personal bests and current streak
app.get('/api/summary', (req, res) => {
  const runs = db.prepare('SELECT * FROM runs').all();
  res.json(summarize(runs));
});

// "12" -> 12; anything that isn't a positive whole number -> null
function parseId(text) {
  return /^[1-9]\d*$/.test(text) ? Number(text) : null;
}

// Edit a run (all fields are replaced, same rules as adding)
app.put('/api/runs/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Run id must be a positive whole number' });
  }

  const { errors, run } = validateRun(req.body);
  if (errors) {
    return res.status(400).json({ error: 'Invalid run', details: errors });
  }

  const result = db.prepare(`
    UPDATE runs
    SET date = :date, distance_km = :distance_km, elevation_m = :elevation_m,
        duration_sec = :duration_sec, run_type = :run_type
    WHERE id = :id
  `).run({ ...run, id });

  if (result.changes === 0) {
    return res.status(404).json({ error: `Run ${id} not found` });
  }
  res.json(db.prepare('SELECT * FROM runs WHERE id = ?').get(id));
});

// Delete a run
app.delete('/api/runs/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Run id must be a positive whole number' });
  }

  const result = db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: `Run ${id} not found` });
  }
  res.status(204).end();
});

// Unknown /api routes get JSON, not an HTML 404 page
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// Malformed JSON bodies and unexpected errors also come back as JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(PORT, () => {
  console.log(`Run Tracker listening on http://localhost:${PORT}`);
});
