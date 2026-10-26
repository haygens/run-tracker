// Training plan logic shared by plan.js (PowerShell) and the server (/api/plan/...).
// 1. Plain code: works out a baseline from the last 4 full weeks of runs and checks
//    whether the goal is realistic. If not, the model is never called.
// 2. The model (claude -p, no tools) gets only the summary numbers and rules,
//    and returns the plan as JSON.
// 3. Plain code: checks every rule (plan-validate.js), retries once with the exact
//    errors, then saves the plan and logs every attempt.
// Nothing here prints; plan.js and server.js decide how to show the results.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isValidDate, RUN_TYPES } = require('./validate');
const { addDays, mondayOf, round2 } = require('./summary');
const {
  validatePlan,
  weekRows,
  failureLines,
  limits,
  MAX_WEEKLY_GROWTH,
  MAX_LONG_RUN_SHARE,
  WEEK1_TOLERANCE,
} = require('./plan-validate');

const GOAL_KM = { '5k': 5, '10k': 10, half: 21.0975, marathon: 42.195 };

// ---- Realism rule (general guidelines, not coaching or medical advice) ----
//
// To be ready, my weekly km has to build from my baseline up to a peak week for
// the goal, then taper before race day. So the weeks needed are:
//
//   growth weeks  = smallest n with baseline × 1.10^n ≥ peak week
//                   (weekly km may go up at most 10% a week, the same limit the
//                   plan validation will enforce later)
//   cutback weeks = one easier week after every 3 growth weeks, which adds no
//                   km: floor((growth weeks − 1) / 3)
//   taper weeks   = 3 for a marathon, 2 for the other goals
//
//   weeks needed  = growth + cutback + taper
//   weeks available = whole weeks from today to race day
//
// Realistic if weeks available ≥ weeks needed. If not, the suggested earliest
// race date is today + weeks needed, moved forward to the next Sunday.
// If baseline is already at or above the peak, only the taper is needed.
// With no runs in the window there is no baseline to grow from (0 × 1.1 stays 0),
// so the answer is no, with no date.
const PEAK_WEEK_KM = { '5k': 20, '10k': 30, half: 40, marathon: 55 };
const TAPER_WEEKS = { '5k': 2, '10k': 2, half: 2, marathon: 3 };
const GROWTH_WEEKS_PER_CUTBACK = 3;

const BASELINE_WEEKS = 4;

// ---- Formatting (same rules as the page) ----

// 5 -> "5", 5.2 -> "5.2", 5.25 -> "5.25" (at most 2 decimals, no trailing zeros)
function formatDistance(km) {
  return String(Number(km.toFixed(2)));
}

// 3723 -> "1:02:03", 1620 -> "27:00"
function formatDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Unnamed runs show their type capitalized, like the page does
function displayName(run) {
  return run.name || run.run_type.charAt(0).toUpperCase() + run.run_type.slice(1);
}

function weekday(ymd) {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

function daysBetween(fromYmd, toYmd) {
  return Math.round((new Date(toYmd + 'T00:00:00Z') - new Date(fromYmd + 'T00:00:00Z')) / 86400000);
}

// ---- Inputs ----

// Checks goal, race date and runs per week. Returns { errors, request }.
// labels names the fields in "is missing" messages: --goal for plan.js, goal for the API.
// runsPerWeek may be a string ("4", from the command line) or a number (4, from JSON).
function checkRequest({ goal, raceDate, runsPerWeek }, today, labels) {
  const errors = [];

  if (goal === undefined || goal === null || goal === '') {
    errors.push(`${labels.goal} is missing`);
  } else if (typeof goal !== 'string' || !Object.hasOwn(GOAL_KM, goal)) {
    errors.push(`Unknown goal "${goal}". Use one of: ${Object.keys(GOAL_KM).join(', ')}`);
  }

  if (raceDate === undefined || raceDate === null || raceDate === '') {
    errors.push(`${labels.raceDate} is missing`);
  } else if (!isValidDate(raceDate)) {
    errors.push(`Race date "${raceDate}" must be a real date in YYYY-MM-DD format`);
  } else if (raceDate <= today) {
    errors.push(`Race date ${raceDate} must be after today (${today})`);
  }

  if (runsPerWeek === undefined || runsPerWeek === null || runsPerWeek === '') {
    errors.push(`${labels.runsPerWeek} is missing`);
  } else if (!(Number.isInteger(runsPerWeek) && runsPerWeek >= 1 && runsPerWeek <= 7) && !/^[1-7]$/.test(String(runsPerWeek))) {
    errors.push(`Runs per week "${runsPerWeek}" must be a whole number from 1 to 7`);
  }

  if (errors.length > 0) return { errors, request: null };
  return { errors: null, request: { goal, raceDate, runsPerWeek: Number(runsPerWeek) } };
}

// ---- Baseline ----

// Last 4 full weeks, Monday to Sunday, not counting the current week
function baselineWindow(today) {
  const thisMonday = mondayOf(today);
  return { start: addDays(thisMonday, -7 * BASELINE_WEEKS), end: addDays(thisMonday, -1) };
}

// Runs in the window, oldest first. db is the db.js module (read-only for plan.js).
function baselineRuns(db, window) {
  return db
    .prepare(
      `SELECT id, date, distance_km, duration_sec, run_type, name
         FROM runs WHERE date BETWEEN ? AND ? ORDER BY date, id`,
    )
    .all(window.start, window.end);
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeBaseline(runs, window) {
  const totalKm = round2(runs.reduce((sum, r) => sum + r.distance_km, 0));

  // Ties go to the earliest run, like the personal bests
  let longest = null;
  for (const r of runs) {
    if (longest === null || r.distance_km > longest.distance_km) longest = r;
  }

  // Median of each run's pace, rounded to the second first so it can be checked
  // by hand against the paces shown in the runs table
  const paces = runs.map((r) => Math.round(r.duration_sec / r.distance_km)).sort((a, b) => a - b);

  const weeks = [];
  for (let i = 0; i < BASELINE_WEEKS; i++) {
    const start = addDays(window.start, 7 * i);
    const end = addDays(start, 6);
    const inWeek = runs.filter((r) => r.date >= start && r.date <= end);
    weeks.push({ start, end, km: round2(inWeek.reduce((sum, r) => sum + r.distance_km, 0)), runs: inWeek.length });
  }

  return {
    totalKm,
    runCount: runs.length,
    avgKmPerWeek: round2(totalKm / BASELINE_WEEKS),
    avgRunsPerWeek: round2(runs.length / BASELINE_WEEKS),
    longest,
    paces,
    typicalPaceSec: paces.length > 0 ? Math.round(median(paces)) : null,
    weeks,
  };
}

// ---- Goal check ----

function checkGoal(goal, raceDate, today, avgKmPerWeek) {
  const peak = PEAK_WEEK_KM[goal];
  const taper = TAPER_WEEKS[goal];
  const weeksAvailable = Math.floor(daysBetween(today, raceDate) / 7);

  if (avgKmPerWeek <= 0) {
    return { realistic: false, noBaseline: true, peak, taper, weeksAvailable };
  }

  let growth = 0;
  if (avgKmPerWeek < peak) {
    growth = Math.ceil(Math.log(peak / avgKmPerWeek) / Math.log(1 + MAX_WEEKLY_GROWTH));
  }
  const cutback = growth > 0 ? Math.floor((growth - 1) / GROWTH_WEEKS_PER_CUTBACK) : 0;
  const weeksNeeded = growth + cutback + taper;

  // Races are usually on a Sunday, so round the earliest date forward to one
  const earliest = addDays(today, 7 * weeksNeeded);
  const earliestSunday = addDays(earliest, (7 - new Date(earliest + 'T00:00:00Z').getUTCDay()) % 7);

  return {
    realistic: weeksAvailable >= weeksNeeded,
    peak,
    taper,
    growth,
    cutback,
    weeksNeeded,
    weeksAvailable,
    earliestRaceDate: earliestSunday,
  };
}

// One sentence for "Realistic: yes/no", shared by plan.js and the page
function realismReason(c) {
  if (c.noBaseline) return `no runs in the last ${BASELINE_WEEKS} full weeks, so there is no baseline to build from.`;
  if (c.realistic) return `${c.weeksAvailable} weeks available is enough for the ${c.weeksNeeded} needed.`;
  return `only ${c.weeksAvailable} weeks until race day, but ${c.weeksNeeded} are needed.`;
}

// ---- Model step (claude -p) ----

// CLAUDE_BIN may also be a .js file (a fake claude for tests); it is run with this node.
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// PLAN_OUTPUT_DIR lets tests keep their plans/ and logs/ away from the real ones
const OUTPUT_DIR = process.env.PLAN_OUTPUT_DIR || __dirname;
const PLANS_DIR = path.join(OUTPUT_DIR, 'plans');
const LOG_FILE = path.join(OUTPUT_DIR, 'logs', 'plan.jsonl');
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

const SYSTEM_PROMPT =
  'You write running training plans. You have no tools and no other data: use only the numbers in the message. Reply with JSON only.';

// claude -p checks the reply against this shape and returns it as structured_output.
// plan-validate.js still checks everything itself.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    weeks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          week_start: { type: 'string' },
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                run_type: { type: 'string', enum: RUN_TYPES },
                distance_km: { type: 'number' },
                note: { type: 'string' },
              },
              required: ['date', 'run_type', 'distance_km', 'note'],
              additionalProperties: false,
            },
          },
        },
        required: ['week_start', 'days'],
        additionalProperties: false,
      },
    },
  },
  required: ['weeks'],
  additionalProperties: false,
};

// -p: one reply and exit. --output-format json: a single JSON result.
// --json-schema: the reply must match PLAN_SCHEMA. --tools "": no tools at all, so the
// model can't read files (runs.db, .env) or run commands. --safe-mode: no CLAUDE.md,
// hooks, skills or MCP servers. --no-session-persistence: nothing saved to resume.
function claudeArgs() {
  return [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(PLAN_SCHEMA),
    '--tools', '',
    '--safe-mode',
    '--no-session-persistence',
    '--system-prompt', SYSTEM_PROMPT,
  ];
}

// The only data the model receives
function modelInputs({ goal, raceDate, runsPerWeek, today, b }) {
  return {
    today,
    race_date: raceDate,
    goal,
    goal_distance_km: GOAL_KM[goal],
    runs_per_week: runsPerWeek,
    baseline: {
      avg_km_per_week: b.avgKmPerWeek,
      avg_runs_per_week: b.avgRunsPerWeek,
      longest_run_km: b.longest.distance_km,
      typical_pace_per_km: formatDuration(b.typicalPaceSec),
    },
    allowed_run_types: RUN_TYPES,
  };
}

function buildPrompt(inputs, ctx) {
  const L = limits(ctx);
  const first = L.weekStarts[0];
  const last = L.weekStarts[L.weekStarts.length - 1];
  return [
    'Write a week-by-week running training plan for the goal below, starting from the runner\'s baseline.',
    '',
    'Inputs:',
    JSON.stringify(inputs, null, 2),
    '',
    'Rules. Code checks the plan against every one of these, with these exact numbers:',
    `1. One entry in "weeks" per week, in order. Each week_start is a Monday: the first is ${first} and the last is ${last} (${L.weekStarts.length} weeks). Every run's date is inside its week (week_start to the Sunday after it).`,
    `2. Every date is after today (${ctx.today}) and before race day (${ctx.raceDate}). Race day itself is not part of the plan.`,
    `3. At most ${ctx.runsPerWeek} runs per week. Rest days are left out.`,
    `4. Week 1's total distance is between ${L.week1Min} and ${L.week1Max} km (baseline avg km/week ±${WEEK1_TOLERANCE * 100}%).`,
    `5. Each week's total is at most ${100 + MAX_WEEKLY_GROWTH * 100}% of the previous week's total. Cutback weeks may go down.`,
    `6. In every week, the longest run is at most ${MAX_LONG_RUN_SHARE * 100}% of that week's total.`,
    `7. Taper: each of the final ${ctx.taperWeeks} weeks has a lower total than the week before it.`,
    `8. The last run before race day is at most ${L.lastRunMaxKm} km.`,
    `9. run_type is one of: ${RUN_TYPES.join(', ')}. distance_km is a number greater than 0. note is a short sentence about the run.`,
    '',
    'Use distances with at most one decimal place.',
    'Return ONLY JSON in this shape, with no other text:',
    '{"weeks":[{"week_start":"YYYY-MM-DD","days":[{"date":"YYYY-MM-DD","run_type":"easy","distance_km":5,"note":"Easy, conversational pace"}]}]}',
  ].join('\n');
}

function buildRetryPrompt(prompt, plan, errors) {
  return [
    prompt,
    '',
    'Your previous plan failed these checks:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Your previous plan:',
    JSON.stringify(plan),
    '',
    'Return a corrected, complete plan that passes every rule, as JSON only.',
  ].join('\n');
}

// The model's process gets no database path or Turso settings, .env path or password
function modelEnv() {
  const env = { ...process.env };
  const hidden = ['DB_PATH', 'DB_READ_ONLY', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'ENV_FILE', 'WRITE_PASSWORD', 'PLAN_TODAY'];
  for (const key of hidden) delete env[key];
  return env;
}

// Turns claude's stdout into { plan, raw, error, reportedCostUsd }; plan is null if the reply wasn't usable JSON
function parseReply(stdout, stderr, code) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    const raw = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`;
    return { plan: null, raw, error: `claude exited with code ${code} and its output wasn't JSON` };
  }

  const raw = typeof outer.result === 'string' ? outer.result : stdout;
  const meta = { reportedCostUsd: outer.total_cost_usd };
  if (outer.is_error || code !== 0) {
    return { plan: null, raw, error: `claude reported an error (${outer.subtype || `exit code ${code}`})`, ...meta };
  }
  if (outer.structured_output !== undefined) return { plan: outer.structured_output, raw, error: null, ...meta };
  try {
    return { plan: JSON.parse(outer.result), raw, error: null, ...meta };
  } catch {
    return { plan: null, raw, error: 'The model\'s reply is not valid JSON', ...meta };
  }
}

// Runs claude without blocking (so the server keeps answering other requests).
// Resolves to { plan, raw, error, timedOut, durationMs, reportedCostUsd }.
// After timeoutMs the process is stopped and timedOut is true.
function callModel(prompt, timeoutMs) {
  return new Promise((resolve) => {
    // An empty folder as the working directory, so there's nothing nearby to read either
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tracker-plan-'));
    const started = Date.now();
    const [cmd, args] = CLAUDE_BIN.endsWith('.js')
      ? [process.execPath, [CLAUDE_BIN, ...claudeArgs()]]
      : [CLAUDE_BIN, claudeArgs()];

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    let timer = null;

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ timedOut: false, ...result, durationMs: Date.now() - started });
    }

    let child;
    try {
      child = spawn(cmd, args, { cwd: dir, env: modelEnv(), windowsHide: true });
    } catch (err) {
      finish({ plan: null, raw: '', error: `Could not run ${CLAUDE_BIN}: ${err.message}` });
      return;
    }

    const minutes = Math.round(timeoutMs / 6000) / 10;
    const timeoutResult = () => ({ plan: null, raw: stdout, error: `The model took longer than ${minutes} minutes and was stopped`, timedOut: true });
    timer = setTimeout(() => {
      timedOut = true;
      // Finish on exit, not close: anything still holding the output pipes can't keep us waiting
      child.once('exit', () => finish(timeoutResult()));
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > MAX_OUTPUT_BYTES) child.kill();
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d;
    });
    child.stdin.on('error', () => {}); // the process may exit before reading everything
    child.stdin.end(prompt);

    child.on('error', (err) => finish({ plan: null, raw: '', error: `Could not run ${CLAUDE_BIN}: ${err.message}` }));
    child.on('close', (code) => {
      finish(timedOut ? timeoutResult() : parseReply(stdout, stderr, code));
    });
  });
}

function logAttempt(entry) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

function planContext({ goal, raceDate, runsPerWeek, today, b }) {
  return {
    today,
    raceDate,
    runsPerWeek,
    baselineKmPerWeek: b.avgKmPerWeek,
    taperWeeks: TAPER_WEEKS[goal],
    goalKm: GOAL_KM[goal],
  };
}

// Prompt exactly as it would be sent (for plan.js --dry-run)
function planPrompt({ goal, raceDate, runsPerWeek, today, b }) {
  return buildPrompt(modelInputs({ goal, raceDate, runsPerWeek, today, b }), planContext({ goal, raceDate, runsPerWeek, today, b }));
}

// Asks the model for a plan, checks it, retries once with the exact errors, then saves it.
// Only call this when checkGoal said the goal is realistic.
// timeoutMs covers everything, retry included. onEvent (optional) hears about progress:
//   { type: 'asking', attempt }  and  { type: 'checked', attempt, validation, durationMs }
// Resolves to { status, attempts, retried, validation, errors, error, raw, saved, file, rows }
//   status: 'saved' | 'invalid' (still failing after the retry) | 'model-error' | 'timeout'
async function generatePlan({ goal, raceDate, runsPerWeek, today, b, timeoutMs, onEvent = () => {} }) {
  const ctx = planContext({ goal, raceDate, runsPerWeek, today, b });
  const inputs = modelInputs({ goal, raceDate, runsPerWeek, today, b });
  const prompt = buildPrompt(inputs, ctx);
  const deadline = Date.now() + timeoutMs;

  let attemptPrompt = prompt;
  let errorsSent = null;
  let validation = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const minutes = Math.round(timeoutMs / 6000) / 10;
      const error = `Generating took longer than ${minutes} minutes and was stopped before the retry`;
      return { status: 'timeout', attempts: attempt - 1, retried: false, validation, errors: errorsSent, error, raw: '' };
    }

    onEvent({ type: 'asking', attempt });
    const reply = await callModel(attemptPrompt, remaining);
    const base = { attempt, retry: attempt > 1, inputs, errors_sent: errorsSent, model_output: reply.raw };

    if (!reply.plan) {
      logAttempt({ ...base, parsed: false, error: reply.error, timed_out: reply.timedOut, validation: null, passed: false, duration_ms: reply.durationMs, reported_cost_usd: reply.reportedCostUsd });
      return {
        status: reply.timedOut ? 'timeout' : 'model-error',
        attempts: attempt,
        retried: attempt > 1,
        validation,
        errors: errorsSent,
        error: reply.error,
        raw: reply.raw,
      };
    }

    validation = validatePlan(reply.plan, ctx);
    logAttempt({
      ...base,
      parsed: true,
      error: null,
      validation: validation.results,
      passed: validation.ok,
      duration_ms: reply.durationMs,
      reported_cost_usd: reply.reportedCostUsd,
    });
    onEvent({ type: 'checked', attempt, validation, durationMs: reply.durationMs });

    if (validation.ok) {
      fs.mkdirSync(PLANS_DIR, { recursive: true });
      const file = path.join(PLANS_DIR, `${goal}-${raceDate}.json`);
      const saved = {
        goal,
        race_date: raceDate,
        runs_per_week: runsPerWeek,
        created: new Date().toISOString(),
        attempts: attempt,
        inputs,
        checks: validation.results,
        weeks: reply.plan.weeks,
      };
      fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
      return { status: 'saved', attempts: attempt, retried: attempt > 1, validation, errors: null, error: null, saved, file, rows: validation.weeks };
    }

    errorsSent = failureLines(validation);
    if (attempt === 1) attemptPrompt = buildRetryPrompt(prompt, reply.plan, errorsSent);
  }

  return { status: 'invalid', attempts: 2, retried: true, validation, errors: errorsSent, error: 'The plan still failed some checks after one retry' };
}

// The most recently saved plan (by its "created" time), or null if there is none.
// Returns { saved, file, rows }; rows are the week totals for the table.
function latestPlan() {
  let names;
  try {
    names = fs.readdirSync(PLANS_DIR).filter((n) => n.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  let latest = null;
  for (const name of names) {
    const file = path.join(PLANS_DIR, name);
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // skip a file that isn't a plan
    }
    if (!saved || !Array.isArray(saved.weeks)) continue;
    const created = saved.created || fs.statSync(file).mtime.toISOString();
    if (latest === null || created > latest.created) latest = { saved, file, created };
  }
  return latest && { saved: latest.saved, file: latest.file, rows: weekRows(latest.saved.weeks) };
}

module.exports = {
  GOAL_KM,
  GROWTH_WEEKS_PER_CUTBACK,
  BASELINE_WEEKS,
  CLAUDE_BIN,
  SYSTEM_PROMPT,
  LOG_FILE,
  formatDistance,
  formatDuration,
  displayName,
  weekday,
  checkRequest,
  baselineWindow,
  baselineRuns,
  computeBaseline,
  checkGoal,
  realismReason,
  claudeArgs,
  planPrompt,
  generatePlan,
  latestPlan,
};
