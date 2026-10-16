const path = require('node:path');
const express = require('express');
const db = require('./db');
const { validateRun } = require('./validate');

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
