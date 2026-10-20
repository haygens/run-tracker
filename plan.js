// Training plan generator.
// 1. Plain code: reads my runs, works out a baseline from the last 4 full weeks,
//    and checks whether the goal is realistic. If not, it stops here.
// 2. The model (claude -p, no tools) gets only the summary numbers and rules,
//    and returns the plan as JSON.
// 3. Plain code: checks every rule (plan-validate.js), retries once with the exact
//    errors, then saves the plan and logs every attempt.
//
// Usage: node plan.js --goal marathon --race-date 2027-05-02 --runs-per-week 4 [--dry-run]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { isValidDate, RUN_TYPES } = require('./validate');
const { addDays, mondayOf, todayLocal, round2 } = require('./summary');
const {
  validatePlan,
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

// ---- Arguments ----

const USAGE = 'Usage: node plan.js --goal <5k|10k|half|marathon> --race-date YYYY-MM-DD --runs-per-week <1-7> [--dry-run]';

function fail(errors) {
  console.error('Cannot make a plan:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${USAGE}`);
  process.exit(1);
}

// Returns { goal, raceDate, runsPerWeek, dryRun }, or exits listing every problem at once
function readArgs(argv, today) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        goal: { type: 'string' },
        'race-date': { type: 'string' },
        'runs-per-week': { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    fail([err.message]);
  }

  const errors = [];
  const goal = values.goal;
  const raceDate = values['race-date'];
  const runsText = values['runs-per-week'];

  if (goal === undefined) {
    errors.push('--goal is missing');
  } else if (!Object.hasOwn(GOAL_KM, goal)) {
    errors.push(`Unknown goal "${goal}". Use one of: ${Object.keys(GOAL_KM).join(', ')}`);
  }

  if (raceDate === undefined) {
    errors.push('--race-date is missing');
  } else if (!isValidDate(raceDate)) {
    errors.push(`Race date "${raceDate}" must be a real date in YYYY-MM-DD format`);
  } else if (raceDate <= today) {
    errors.push(`Race date ${raceDate} must be after today (${today})`);
  }

  if (runsText === undefined) {
    errors.push('--runs-per-week is missing');
  } else if (!/^[1-7]$/.test(runsText)) {
    errors.push(`Runs per week "${runsText}" must be a whole number from 1 to 7`);
  }

  if (errors.length > 0) fail(errors);
  return { goal, raceDate, runsPerWeek: Number(runsText), dryRun: values['dry-run'] === true };
}

// ---- Baseline ----

// Last 4 full weeks, Monday to Sunday, not counting the current week
function baselineWindow(today) {
  const thisMonday = mondayOf(today);
  return { start: addDays(thisMonday, -7 * BASELINE_WEEKS), end: addDays(thisMonday, -1) };
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

// ---- Model step (claude -p) ----

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL_TIMEOUT_MS = 10 * 60 * 1000;
const PLANS_DIR = path.join(__dirname, 'plans');
const LOG_FILE = path.join(__dirname, 'logs', 'plan.jsonl');

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

// The model's process gets no database path, .env path or password
function modelEnv() {
  const env = { ...process.env };
  for (const key of ['DB_PATH', 'DB_READ_ONLY', 'ENV_FILE', 'WRITE_PASSWORD', 'PLAN_TODAY']) delete env[key];
  return env;
}

// Returns { plan, raw, error, durationMs, reportedCostUsd }; plan is null if the reply wasn't usable JSON
function callModel(prompt) {
  // An empty folder as the working directory, so there's nothing nearby to read either
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tracker-plan-'));
  const started = Date.now();
  try {
    const res = spawnSync(CLAUDE_BIN, claudeArgs(), {
      cwd: dir,
      input: prompt,
      encoding: 'utf8',
      timeout: MODEL_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      env: modelEnv(),
    });
    const durationMs = Date.now() - started;
    if (res.error) {
      return { plan: null, raw: '', error: `Could not run ${CLAUDE_BIN}: ${res.error.message}`, durationMs };
    }

    let outer;
    try {
      outer = JSON.parse(res.stdout);
    } catch {
      const raw = `${res.stdout}${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`;
      return { plan: null, raw, error: `claude exited with code ${res.status} and its output wasn't JSON`, durationMs };
    }

    const raw = typeof outer.result === 'string' ? outer.result : res.stdout;
    const meta = { durationMs, reportedCostUsd: outer.total_cost_usd };
    if (outer.is_error || res.status !== 0) {
      return { plan: null, raw, error: `claude reported an error (${outer.subtype || `exit code ${res.status}`})`, ...meta };
    }
    if (outer.structured_output !== undefined) return { plan: outer.structured_output, raw, error: null, ...meta };
    try {
      return { plan: JSON.parse(outer.result), raw, error: null, ...meta };
    } catch {
      return { plan: null, raw, error: 'The model\'s reply is not valid JSON', ...meta };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function logAttempt(entry) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

function printValidation(validation) {
  for (const r of validation.results) {
    console.log(`  ${r.status.padEnd(4)}  ${r.rule}${r.detail ? `: ${r.detail}` : ''}`);
    for (const e of r.errors) console.log(`          - ${e}`);
  }
}

function printPlanTable(weeks) {
  console.log('  Week  Dates                      Runs   Total km   Long run');
  for (const w of weeks) {
    console.log(
      `  ${String(w.n).padStart(4)}  ${w.start} to ${w.end}  ${String(w.runs).padStart(4)}  ${km(w.total).padStart(9)}  ${km(w.longest).padStart(9)}`,
    );
  }
  const total = round2(weeks.reduce((s, w) => s + w.total, 0));
  console.log(`  Total: ${km(total)} km over ${weeks.length} weeks`);
}

function km(n) {
  return formatDistance(n);
}

// Asks the model for a plan, checks it, retries once with the exact errors, then saves it.
// Returns the exit code.
function makePlan({ goal, raceDate, runsPerWeek, dryRun, today, b }) {
  const ctx = {
    today,
    raceDate,
    runsPerWeek,
    baselineKmPerWeek: b.avgKmPerWeek,
    taperWeeks: TAPER_WEEKS[goal],
    goalKm: GOAL_KM[goal],
  };
  const inputs = modelInputs({ goal, raceDate, runsPerWeek, today, b });
  const prompt = buildPrompt(inputs, ctx);

  if (dryRun) {
    console.log('Dry run: the model is not called. This is exactly what would be sent.');
    console.log('');
    console.log(`Command: ${CLAUDE_BIN} ${claudeArgs().map((a) => (a === '' || /[\s"{]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    console.log('(the prompt below goes to its standard input; it runs in an empty temp folder)');
    console.log('');
    console.log('----- system prompt -----');
    console.log(SYSTEM_PROMPT);
    console.log('----- prompt -----');
    console.log(prompt);
    console.log('----- end -----');
    return 0;
  }

  let attemptPrompt = prompt;
  let errorsSent = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(attempt === 1 ? 'Asking the model for a plan (this can take a minute or two)...' : 'Retrying once with the exact errors...');
    const reply = callModel(attemptPrompt);
    const seconds = Math.round((reply.durationMs || 0) / 1000);

    if (!reply.plan) {
      logAttempt({ attempt, retry: attempt > 1, inputs, errors_sent: errorsSent, model_output: reply.raw, parsed: false, error: reply.error, validation: null, passed: false, duration_ms: reply.durationMs, reported_cost_usd: reply.reportedCostUsd });
      console.log(`${reply.error}. Raw output:`);
      console.log(reply.raw || '(empty)');
      console.log(`Stopped. Logged to ${path.relative(__dirname, LOG_FILE)}.`);
      return 1;
    }

    const validation = validatePlan(reply.plan, ctx);
    logAttempt({
      attempt,
      retry: attempt > 1,
      inputs,
      errors_sent: errorsSent,
      model_output: reply.raw,
      parsed: true,
      error: null,
      validation: validation.results,
      passed: validation.ok,
      duration_ms: reply.durationMs,
      reported_cost_usd: reply.reportedCostUsd,
    });

    console.log(`Reply received in ${seconds} s. Checking attempt ${attempt}:`);
    printValidation(validation);
    console.log('');

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
        weeks: reply.plan.weeks,
      };
      fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
      console.log(`All checks passed${attempt > 1 ? ' after one retry' : ''}. Plan saved to ${path.relative(__dirname, file)}`);
      console.log('');
      printPlanTable(validation.weeks);
      console.log('');
      console.log(`Logged to ${path.relative(__dirname, LOG_FILE)}.`);
      return 0;
    }

    errorsSent = failureLines(validation);
    if (attempt === 1) attemptPrompt = buildRetryPrompt(prompt, reply.plan, errorsSent);
  }

  console.log('Still failing after one retry. These checks failed:');
  for (const e of errorsSent) console.log(`  - ${e}`);
  console.log(`No plan was saved. Every attempt is in ${path.relative(__dirname, LOG_FILE)}.`);
  return 1;
}

// ---- Main ----

function main() {
  // PLAN_TODAY lets tests pretend it's another day (like DB_PATH for the database)
  const today = process.env.PLAN_TODAY || todayLocal();
  const { goal, raceDate, runsPerWeek, dryRun } = readArgs(process.argv.slice(2), today);

  // Same db module the server uses, opened read-only so this script can never change runs.db
  process.env.DB_READ_ONLY = '1';
  const window = baselineWindow(today);
  let runs;
  try {
    const db = require('./db');
    runs = db
      .prepare(
        `SELECT id, date, distance_km, duration_sec, run_type, name
           FROM runs WHERE date BETWEEN ? AND ? ORDER BY date, id`,
      )
      .all(window.start, window.end);
  } catch (err) {
    console.error(`Cannot read runs from the database: ${err.message}`);
    console.error('Start the server once (npm start) to create or update the database, then try again.');
    process.exit(1);
  }

  const b = computeBaseline(runs, window);

  console.log(`Goal: ${goal} (${GOAL_KM[goal]} km), race on ${weekday(raceDate)} ${raceDate}, ${runsPerWeek} runs per week`);
  console.log(`Today: ${weekday(today)} ${today}`);
  console.log('');
  console.log(`Baseline window: ${window.start} to ${window.end} (last ${BASELINE_WEEKS} full weeks, Monday to Sunday; this week not counted)`);
  console.log('');

  console.log(`Runs counted (${b.runCount}):`);
  if (runs.length === 0) console.log('  (none)');
  for (const r of runs) {
    const pace = formatDuration(Math.round(r.duration_sec / r.distance_km));
    console.log(
      `  ${r.date}  ${displayName(r).padEnd(20)}  ${r.run_type.padEnd(9)}  ${(formatDistance(r.distance_km) + ' km').padStart(9)}  ${formatDuration(r.duration_sec).padStart(7)}  ${pace.padStart(5)} /km`,
    );
  }
  console.log('');

  console.log('Per week:');
  for (const w of b.weeks) {
    console.log(`  ${w.start} to ${w.end}  ${(formatDistance(w.km) + ' km').padStart(9)}  ${w.runs} run${w.runs === 1 ? '' : 's'}`);
  }
  console.log('');

  console.log('Baseline:');
  console.log(`  Avg km/week:    ${formatDistance(b.avgKmPerWeek)} km   (${formatDistance(b.totalKm)} km total ÷ ${BASELINE_WEEKS} weeks)`);
  console.log(`  Avg runs/week:  ${formatDistance(b.avgRunsPerWeek)}   (${b.runCount} runs ÷ ${BASELINE_WEEKS} weeks)`);
  console.log(
    `  Longest run:    ${b.longest ? `${formatDistance(b.longest.distance_km)} km · ${displayName(b.longest)} (${b.longest.date})` : 'none'}`,
  );
  console.log(
    `  Typical pace:   ${b.typicalPaceSec === null ? 'none' : `${formatDuration(b.typicalPaceSec)} /km   (median of ${b.paces.length} run paces: ${b.paces.map(formatDuration).join(', ')})`}`,
  );
  console.log('');

  const c = checkGoal(goal, raceDate, today, b.avgKmPerWeek);
  console.log('Goal check:');
  console.log(`  Peak week needed for ${goal}: ${c.peak} km`);
  if (c.noBaseline) {
    console.log(`  Weeks available:              ${c.weeksAvailable}`);
    console.log('Realistic: no');
    console.log(`  Reason: no runs in the last ${BASELINE_WEEKS} full weeks, so there is no baseline to build from.`);
    console.log('  Suggested earliest race date: none yet. Log a few weeks of running, then try again.');
  } else {
    console.log(`  Growth weeks (+10% a week):   ${c.growth}   (${formatDistance(b.avgKmPerWeek)} km -> ${c.peak} km)`);
    console.log(`  Cutback weeks:                ${c.cutback}   (one after every ${GROWTH_WEEKS_PER_CUTBACK} growth weeks)`);
    console.log(`  Taper weeks:                  ${c.taper}`);
    console.log(`  Weeks needed:                 ${c.weeksNeeded}`);
    console.log(`  Weeks available:              ${c.weeksAvailable}   (${today} to ${raceDate})`);
    if (c.realistic) {
      console.log('Realistic: yes');
      console.log(`  Reason: ${c.weeksAvailable} weeks available is enough for the ${c.weeksNeeded} needed.`);
      console.log(`  Earliest race date by this rule: ${weekday(c.earliestRaceDate)} ${c.earliestRaceDate}`);
    } else {
      console.log('Realistic: no');
      console.log(`  Reason: only ${c.weeksAvailable} weeks until race day, but ${c.weeksNeeded} are needed.`);
      console.log(`  Suggested earliest race date: ${weekday(c.earliestRaceDate)} ${c.earliestRaceDate}`);
    }
  }
  console.log('');
  console.log('These limits are general guidelines, not coaching or medical advice.');

  // The model is only called when the goal is realistic
  if (!c.realistic) return;
  console.log('');
  process.exitCode = makePlan({ goal, raceDate, runsPerWeek, dryRun, today, b });
}

main();
