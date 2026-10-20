// Progress numbers for /api/summary, worked out from the list of runs.
// Kept separate from the database so it can be tested with any "today".

const PACE_PB_MIN_KM = 5;

// ---- Date helpers (YYYY-MM-DD strings, calculated in UTC to avoid DST shifts) ----

function toDate(ymd) {
  return new Date(ymd + 'T00:00:00Z');
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(ymd, days) {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

// Today on this computer's clock, as YYYY-MM-DD
function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Monday of the week containing ymd (weeks start on Monday)
function mondayOf(ymd) {
  const daysSinceMonday = (toDate(ymd).getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
  return addDays(ymd, -daysSinceMonday);
}

// ---- Calculations ----

// Avoid float noise like 15.700000000000001 in sums
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Totals for runs dated from `start` to `end` inclusive
function periodTotals(runs, start, end) {
  const inPeriod = runs.filter((r) => r.date >= start && r.date <= end);
  return {
    start,
    end,
    distance_km: round2(inPeriod.reduce((sum, r) => sum + r.distance_km, 0)),
    runs: inPeriod.length,
  };
}

// The run with the highest score; ties go to the earliest run (the first to set it)
function best(runs, score) {
  let winner = null;
  for (const run of runs) {
    if (
      winner === null ||
      score(run) > score(winner) ||
      (score(run) === score(winner) && (run.date < winner.date || (run.date === winner.date && run.id < winner.id)))
    ) {
      winner = run;
    }
  }
  return winner;
}

// Consecutive days with at least one run, counting back from today,
// or from yesterday if there's no run yet today
function currentStreak(runs, today) {
  const days = new Set(runs.map((r) => r.date));
  let day = days.has(today) ? today : addDays(today, -1);
  if (!days.has(day)) return { days: 0, start: null, end: null };

  const end = day;
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return { days: count, start: addDays(day, 1), end };
}

function summarize(runs, today = todayLocal()) {
  const fastestCandidates = runs.filter((r) => r.distance_km >= PACE_PB_MIN_KM);
  // Fastest = lowest seconds per km, so score by the negative
  const fastest = best(fastestCandidates, (r) => -(r.duration_sec / r.distance_km));

  return {
    today,
    all_time: {
      distance_km: round2(runs.reduce((sum, r) => sum + r.distance_km, 0)),
      elevation_m: runs.reduce((sum, r) => sum + r.elevation_m, 0),
      runs: runs.length,
      duration_sec: runs.reduce((sum, r) => sum + r.duration_sec, 0),
    },
    this_week: periodTotals(runs, mondayOf(today), today),
    this_month: periodTotals(runs, today.slice(0, 8) + '01', today),
    personal_bests: {
      longest_run: best(runs, (r) => r.distance_km),
      most_elevation: best(runs.filter((r) => r.elevation_m > 0), (r) => r.elevation_m),
      fastest_pace: fastest && {
        ...fastest,
        pace_sec_per_km: Math.round(fastest.duration_sec / fastest.distance_km),
      },
    },
    streak: currentStreak(runs, today),
  };
}

// Km per week for the last `count` weeks, oldest first. Weeks run Monday to Sunday;
// the current week stops at today (same range as "this week" in the summary).
// Weeks with no runs are included with 0 km, so the chart never skips a week.
function weeklyTotals(runs, today = todayLocal(), count = 12) {
  const thisMonday = mondayOf(today);
  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(thisMonday, -7 * i);
    const end = i === 0 ? today : addDays(start, 6);
    const { distance_km, runs: runCount } = periodTotals(runs, start, end);
    weeks.push({ week_start: start, week_end: end, distance_km, runs: runCount });
  }
  return weeks;
}

module.exports = { summarize, weeklyTotals, addDays, mondayOf, todayLocal, round2 };
