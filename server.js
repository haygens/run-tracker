const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { WRITE_PASSWORD } = require('./config'); // exits with a clear message if .env isn't set up
const store = require('./store'); // runs.db, or Turso when its settings are present
const { validateRun } = require('./validate');
const { summarize, weeklyTotals, todayLocal } = require('./summary');
const plan = require('./plan-core');

const app = express();
const PORT = process.env.PORT || 3000;

// Generating a plan runs the claude command with my login, which only the laptop has.
// Vercel sets VERCEL=1, so online the page offers Check only and generate answers 501.
const CAN_GENERATE = !process.env.VERCEL;
const GENERATE_OFF = 'Generating a plan only works on the laptop version of Run Tracker, where the model runs. Check works here.';

// Generating a plan is stopped after 5 minutes (PLAN_TIMEOUT_MS lets tests use less)
const PLAN_TIMEOUT_MS = Number(process.env.PLAN_TIMEOUT_MS) || 5 * 60 * 1000;

// ---- Password for add, edit and delete (GET stays public) ----

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Compare hashes with timingSafeEqual so response time doesn't leak how much of a guess matched
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}
const passwordHash = sha256(WRITE_PASSWORD);

function passwordMatches(given) {
  if (crypto.timingSafeEqual(sha256(given), passwordHash)) return true;
  // The page URL-encodes the header so passwords with accents etc. survive HTTP headers
  try {
    return crypto.timingSafeEqual(sha256(decodeURIComponent(given)), passwordHash);
  } catch {
    return false; // not valid URL encoding
  }
}

// POSTs that only read data and are free to call, so they stay public like the GETs
const PUBLIC_POSTS = ['/plan/check'];

// Runs before JSON parsing, so a write without the right password always gets 401
app.use('/api', (req, res, next) => {
  if (!WRITE_METHODS.includes(req.method)) return next();
  if (req.method === 'POST' && PUBLIC_POSTS.includes(req.path)) return next();

  const given = req.get('X-Password');
  if (!given) {
    return res.status(401).json({ error: 'Password required to change runs or generate a plan (send it in the X-Password header)' });
  }
  if (!passwordMatches(given)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Quick check that the server and database are up
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', runs: await store.countRuns() });
});

// List runs, newest first (id breaks ties for runs on the same day)
app.get('/api/runs', async (req, res) => {
  res.json(await store.listRuns());
});

// Add a run
app.post('/api/runs', async (req, res) => {
  const { errors, run } = validateRun(req.body);
  if (errors) {
    return res.status(400).json({ error: 'Invalid run', details: errors });
  }

  res.status(201).json(await store.addRun(run));
});

// All-time totals, this week/month, personal bests and current streak
app.get('/api/summary', async (req, res) => {
  res.json(summarize(await store.allRuns()));
});

// Km per week for the last 12 weeks, oldest first (for the chart)
app.get('/api/weekly', async (req, res) => {
  res.json(weeklyTotals(await store.allRuns()));
});

// "12" -> 12; anything that isn't a positive whole number -> null
function parseId(text) {
  return /^[1-9]\d*$/.test(text) ? Number(text) : null;
}

// Edit a run (all fields are replaced, same rules as adding)
app.put('/api/runs/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Run id must be a positive whole number' });
  }

  const { errors, run } = validateRun(req.body);
  if (errors) {
    return res.status(400).json({ error: 'Invalid run', details: errors });
  }

  const updated = await store.updateRun(id, run);
  if (!updated) {
    return res.status(404).json({ error: `Run ${id} not found` });
  }
  res.json(updated);
});

// Delete a run
app.delete('/api/runs/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Run id must be a positive whole number' });
  }

  if (!(await store.deleteRun(id))) {
    return res.status(404).json({ error: `Run ${id} not found` });
  }
  res.status(204).end();
});

// ---- Training plan (logic in plan-core.js, shared with plan.js) ----

// PLAN_TODAY lets tests pretend it's another day, like it does for plan.js
function planToday() {
  return process.env.PLAN_TODAY || todayLocal();
}

// Body { goal, race_date, runs_per_week } -> { errors, request }
function readPlanRequest(body, today) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  return plan.checkRequest(
    { goal: b.goal, raceDate: b.race_date, runsPerWeek: b.runs_per_week },
    today,
    { goal: 'goal', raceDate: 'race_date', runsPerWeek: 'runs_per_week' },
  );
}

// Baseline from the last 4 full weeks and the realism check. Plain code, no model.
async function checkPlanGoal(request, today) {
  const window = plan.baselineWindow(today);
  const b = plan.computeBaseline(await plan.baselineRuns(store, window), window);
  const c = plan.checkGoal(request.goal, request.raceDate, today, b.avgKmPerWeek);
  const result = {
    goal: request.goal,
    goal_km: plan.GOAL_KM[request.goal],
    race_date: request.raceDate,
    runs_per_week: request.runsPerWeek,
    today,
    baseline: {
      window_start: window.start,
      window_end: window.end,
      weeks: b.weeks,
      total_km: b.totalKm,
      runs: b.runCount,
      avg_km_per_week: b.avgKmPerWeek,
      avg_runs_per_week: b.avgRunsPerWeek,
      longest_run_km: b.longest ? b.longest.distance_km : null,
      typical_pace: b.typicalPaceSec === null ? null : plan.formatDuration(b.typicalPaceSec),
    },
    realistic: c.realistic,
    reason: plan.realismReason(c),
    peak_week_km: c.peak,
    growth_weeks: c.noBaseline ? null : c.growth,
    cutback_weeks: c.noBaseline ? null : c.cutback,
    taper_weeks: c.taper,
    weeks_needed: c.noBaseline ? null : c.weeksNeeded,
    weeks_available: c.weeksAvailable,
    earliest_race_date: c.noBaseline ? null : c.earliestRaceDate,
  };
  return { b, c, result };
}

// Baseline and Realistic yes/no. Public and free: never calls the model.
app.post('/api/plan/check', async (req, res) => {
  const today = planToday();
  const { errors, request } = readPlanRequest(req.body, today);
  if (errors) {
    return res.status(400).json({ error: 'Invalid plan request', details: errors });
  }
  // can_generate tells the page whether to offer "Generate plan"
  res.json({ ...(await checkPlanGoal(request, today)).result, can_generate: CAN_GENERATE });
});

// Only one plan is generated at a time (each one runs claude for a minute or two)
let generating = false;

// Generate a plan with the model: password required, only when the goal is realistic
app.post('/api/plan/generate', async (req, res) => {
  if (!CAN_GENERATE) {
    return res.status(501).json({ error: GENERATE_OFF });
  }
  const today = planToday();
  const { errors, request } = readPlanRequest(req.body, today);
  if (errors) {
    return res.status(400).json({ error: 'Invalid plan request', details: errors });
  }
  if (generating) {
    return res.status(409).json({ error: 'A plan is already being generated. Wait for it to finish, then try again.' });
  }

  // Taken before the check: it reads the database (async), and a second request must not slip in meanwhile
  generating = true;
  let result;
  try {
    const { b, c, result: check } = await checkPlanGoal(request, today);
    if (!c.realistic) {
      return res.status(400).json({ error: `This goal is not realistic: ${check.reason}`, check });
    }
    result = await plan.generatePlan({ ...request, today, b, timeoutMs: PLAN_TIMEOUT_MS });
  } finally {
    generating = false;
  }

  const checks = result.validation ? result.validation.results : null;
  if (result.status === 'saved') {
    return res.json({ plan: result.saved, rows: result.rows, checks, retried: result.retried, file: `plans/${path.basename(result.file)}` });
  }
  if (result.status === 'timeout') {
    const minutes = Math.round(PLAN_TIMEOUT_MS / 6000) / 10;
    return res.status(504).json({
      error: `Generating the plan took longer than ${minutes} minutes and was stopped. Nothing was saved; try again.`,
      retried: result.retried,
    });
  }
  if (result.status === 'invalid') {
    return res.status(502).json({
      error: 'The model\'s plan still failed some checks after one retry. Nothing was saved.',
      checks,
      failures: result.errors,
      retried: true,
    });
  }
  res.status(502).json({ error: `${result.error}. Nothing was saved.`, raw: result.raw, checks, retried: result.retried });
});

// The most recently saved plan, or { plan: null }
app.get('/api/plan/latest', (req, res) => {
  const latest = plan.latestPlan();
  if (!latest) return res.json({ plan: null });
  res.json({ plan: latest.saved, rows: latest.rows, checks: latest.saved.checks || null, file: `plans/${path.basename(latest.file)}` });
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

// Express 5 passes a startup error (e.g. port already in use) to this callback
app.listen(PORT, (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nRun Tracker cannot start: port ${PORT} is already in use.`);
      console.error('  Another Run Tracker server is probably still running. Stop it with Ctrl+C in its window, then try again.\n');
    } else {
      console.error('\nRun Tracker cannot start:', err.message, '\n');
    }
    process.exit(1);
  }
  console.log(`Run Tracker listening on http://localhost:${PORT} (database: ${store.backendName})`);
});
