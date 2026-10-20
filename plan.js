// Training plan generator (PowerShell). The logic lives in plan-core.js, which the
// server also uses for the page; this file reads the arguments and prints.
// 1. Plain code: reads my runs, works out a baseline from the last 4 full weeks,
//    and checks whether the goal is realistic. If not, it stops here.
// 2. The model (claude -p, no tools) gets only the summary numbers and rules,
//    and returns the plan as JSON.
// 3. Plain code: checks every rule (plan-validate.js), retries once with the exact
//    errors, then saves the plan and logs every attempt.
//
// Usage: node plan.js --goal marathon --race-date 2027-05-02 --runs-per-week 4 [--dry-run]

const path = require('node:path');
const { parseArgs } = require('node:util');
const { todayLocal, round2 } = require('./summary');
const {
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
} = require('./plan-core');

// Up to 10 minutes for each of the two model calls
const MODEL_TIMEOUT_MS = 2 * 10 * 60 * 1000;

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

  const { errors, request } = checkRequest(
    { goal: values.goal, raceDate: values['race-date'], runsPerWeek: values['runs-per-week'] },
    today,
    { goal: '--goal', raceDate: '--race-date', runsPerWeek: '--runs-per-week' },
  );
  if (errors) fail(errors);
  return { ...request, dryRun: values['dry-run'] === true };
}

// ---- Printing ----

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

function printDryRun(request) {
  console.log('Dry run: the model is not called. This is exactly what would be sent.');
  console.log('');
  console.log(`Command: ${CLAUDE_BIN} ${claudeArgs().map((a) => (a === '' || /[\s"{]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  console.log('(the prompt below goes to its standard input; it runs in an empty temp folder)');
  console.log('');
  console.log('----- system prompt -----');
  console.log(SYSTEM_PROMPT);
  console.log('----- prompt -----');
  console.log(planPrompt(request));
  console.log('----- end -----');
}

// Asks the model for a plan (plan-core.js checks, retries and saves). Returns the exit code.
async function makePlan(request) {
  const logName = path.relative(__dirname, LOG_FILE);
  const result = await generatePlan({
    ...request,
    timeoutMs: MODEL_TIMEOUT_MS,
    onEvent(e) {
      if (e.type === 'asking') {
        console.log(e.attempt === 1 ? 'Asking the model for a plan (this can take a minute or two)...' : 'Retrying once with the exact errors...');
      } else if (e.type === 'checked') {
        console.log(`Reply received in ${Math.round(e.durationMs / 1000)} s. Checking attempt ${e.attempt}:`);
        printValidation(e.validation);
        console.log('');
      }
    },
  });

  if (result.status === 'saved') {
    console.log(`All checks passed${result.retried ? ' after one retry' : ''}. Plan saved to ${path.relative(__dirname, result.file)}`);
    console.log('');
    printPlanTable(result.rows);
    console.log('');
    console.log(`Logged to ${logName}.`);
    return 0;
  }
  if (result.status === 'invalid') {
    console.log('Still failing after one retry. These checks failed:');
    for (const e of result.errors) console.log(`  - ${e}`);
    console.log(`No plan was saved. Every attempt is in ${logName}.`);
    return 1;
  }
  console.log(`${result.error}. Raw output:`);
  console.log(result.raw || '(empty)');
  console.log(`Stopped. Logged to ${logName}.`);
  return 1;
}

// ---- Main ----

async function main() {
  // PLAN_TODAY lets tests pretend it's another day (like DB_PATH for the database)
  const today = process.env.PLAN_TODAY || todayLocal();
  const { goal, raceDate, runsPerWeek, dryRun } = readArgs(process.argv.slice(2), today);

  // Same db module the server uses, opened read-only so this script can never change runs.db
  process.env.DB_READ_ONLY = '1';
  const window = baselineWindow(today);
  let runs;
  try {
    runs = baselineRuns(require('./db'), window);
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
    console.log(`  Reason: ${realismReason(c)}`);
    console.log('  Suggested earliest race date: none yet. Log a few weeks of running, then try again.');
  } else {
    console.log(`  Growth weeks (+10% a week):   ${c.growth}   (${formatDistance(b.avgKmPerWeek)} km -> ${c.peak} km)`);
    console.log(`  Cutback weeks:                ${c.cutback}   (one after every ${GROWTH_WEEKS_PER_CUTBACK} growth weeks)`);
    console.log(`  Taper weeks:                  ${c.taper}`);
    console.log(`  Weeks needed:                 ${c.weeksNeeded}`);
    console.log(`  Weeks available:              ${c.weeksAvailable}   (${today} to ${raceDate})`);
    console.log(`Realistic: ${c.realistic ? 'yes' : 'no'}`);
    console.log(`  Reason: ${realismReason(c)}`);
    if (c.realistic) {
      console.log(`  Earliest race date by this rule: ${weekday(c.earliestRaceDate)} ${c.earliestRaceDate}`);
    } else {
      console.log(`  Suggested earliest race date: ${weekday(c.earliestRaceDate)} ${c.earliestRaceDate}`);
    }
  }
  console.log('');
  console.log('These limits are general guidelines, not coaching or medical advice.');

  // The model is only called when the goal is realistic
  if (!c.realistic) return;
  console.log('');
  const request = { goal, raceDate, runsPerWeek, today, b };
  if (dryRun) {
    printDryRun(request);
    return;
  }
  process.exitCode = await makePlan(request);
}

main();
