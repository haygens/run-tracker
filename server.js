const path = require('node:path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Quick check that the server and database are up
app.get('/api/health', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM runs').get();
  res.json({ status: 'ok', runs: count });
});

app.listen(PORT, () => {
  console.log(`Run Tracker listening on http://localhost:${PORT}`);
});
