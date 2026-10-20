// Training plan generator, step 1 of 3: plain code before the model.
// Reads my runs, works out a baseline from the last 4 full weeks, and checks
// whether the goal is realistic. The model step (claude -p) is not built yet.
//
// Usage: node plan.js --goal marathon --race-date 2027-05-02 --runs-per-week 4

const { parseArgs } = require('node:util');
const { isValidDate } = require('./validate');
const { addDays, mondayOf, todayLocal, round2 } = require('./summary');

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
const MAX_WEEKLY_GROWTH = 0.10;
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

const USAGE = 'Usage: node plan.js --goal <5k|10k|half|marathon> --race-date YYYY-MM-DD --runs-per-week <1-7>';

function fail(errors) {
  console.error('Cannot make a plan:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${USAGE}`);
  process.exit(1);
}

// Returns { goal, raceDate, runsPerWeek }, or exits listing every problem at once
function readArgs(argv, today) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        goal: { type: 'string' },
        'race-date': { type: 'string' },
        'runs-per-week': { type: 'string' },
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
  return { goal, raceDate, runsPerWeek: Number(runsText) };
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

// ---- Main ----

function main() {
  // PLAN_TODAY lets tests pretend it's another day (like DB_PATH for the database)
  const today = process.env.PLAN_TODAY || todayLocal();
  const { goal, raceDate, runsPerWeek } = readArgs(process.argv.slice(2), today);

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
  console.log('(Model step not built yet)');
}

main();
