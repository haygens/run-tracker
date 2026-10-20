// Checks a training plan from the model against every rule in the Artifact 3 spec.
// Plain code with no model calls, so it can be tested with hand-made plans.
// The same numbers are written into the prompt, so the model is told the exact limits.

const { RUN_TYPES, isValidDate } = require('./validate');
const { addDays, mondayOf, round2 } = require('./summary');

const WEEK1_TOLERANCE = 0.15; // week 1 total within ±15% of baseline avg km/week
const MAX_WEEKLY_GROWTH = 0.10; // each week ≤ 110% of the previous week
const MAX_LONG_RUN_SHARE = 0.35; // longest run ≤ 35% of that week's total
const SHORT_LAST_RUN_KM = 6; // last run before the race ≤ 6 km (≤ the race distance for a 5k)

// 5 -> "5", 5.2 -> "5.2", 5.25 -> "5.25"
function km(n) {
  return String(Number(n.toFixed(2)));
}

function pct(n) {
  return `${Math.round(n * 1000) / 10}%`;
}

// Weeks the plan must contain: Monday starts, from the Monday after today to the
// week holding the last day before the race. The race itself is not in the plan.
function expectedWeekStarts(today, raceDate) {
  const first = addDays(mondayOf(today), 7);
  const last = mondayOf(addDays(raceDate, -1));
  const starts = [];
  for (let d = first; d <= last; d = addDays(d, 7)) starts.push(d);
  return starts;
}

// Limits for a given context, shared by the validator and the prompt
function limits(ctx) {
  return {
    weekStarts: expectedWeekStarts(ctx.today, ctx.raceDate),
    week1Min: round2(ctx.baselineKmPerWeek * (1 - WEEK1_TOLERANCE)),
    week1Max: round2(ctx.baselineKmPerWeek * (1 + WEEK1_TOLERANCE)),
    lastRunMaxKm: Math.min(SHORT_LAST_RUN_KM, ctx.goalKm),
  };
}

// Shape check. Returns a list of problems; the number rules only run when it's empty.
function formatErrors(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Array.isArray(plan.weeks)) {
    return ['The plan must be a JSON object with a "weeks" array'];
  }
  plan.weeks.forEach((week, i) => {
    const w = `week ${i + 1}`;
    if (!week || typeof week !== 'object') {
      errors.push(`${w}: must be an object`);
      return;
    }
    if (!isValidDate(week.week_start)) errors.push(`${w}: week_start "${week.week_start}" must be a real date in YYYY-MM-DD format`);
    if (!Array.isArray(week.days)) {
      errors.push(`${w}: "days" must be an array`);
      return;
    }
    week.days.forEach((day, j) => {
      const d = `${w}, day ${j + 1}${day && day.date ? ` (${day.date})` : ''}`;
      if (!day || typeof day !== 'object') {
        errors.push(`${d}: must be an object`);
        return;
      }
      if (!isValidDate(day.date)) errors.push(`${d}: date "${day.date}" must be a real date in YYYY-MM-DD format`);
      if (!RUN_TYPES.includes(day.run_type)) {
        errors.push(`${d}: run_type "${day.run_type}" is not allowed. Use one of: ${RUN_TYPES.join(', ')} (rest days are left out)`);
      }
      if (typeof day.distance_km !== 'number' || !Number.isFinite(day.distance_km) || day.distance_km <= 0) {
        errors.push(`${d}: distance_km must be a number greater than 0`);
      }
      if (typeof day.note !== 'string') errors.push(`${d}: note must be text`);
    });
  });
  return errors;
}

// Totals per week, in the order the model sent them (also the rows of the plan table).
// Only call this on weeks that passed the format check.
function weekRows(planWeeks) {
  return planWeeks.map((wk, i) => {
    const total = round2(wk.days.reduce((s, d) => s + d.distance_km, 0));
    const longest = wk.days.reduce((m, d) => Math.max(m, d.distance_km), 0);
    const dates = wk.days.map((d) => d.date).sort();
    return { n: i + 1, start: wk.week_start, end: addDays(wk.week_start, 6), runs: wk.days.length, total, longest, dates };
  });
}

// Returns { ok, results: [{ rule, status: 'PASS'|'FAIL'|'SKIP', detail, errors[] }], weeks }
// ctx: { today, raceDate, runsPerWeek, baselineKmPerWeek, taperWeeks, goalKm }
function validatePlan(plan, ctx) {
  const L = limits(ctx);
  const results = [];
  const add = (rule, errors, passDetail) =>
    results.push({ rule, status: errors.length ? 'FAIL' : 'PASS', detail: errors.length ? '' : passDetail, errors });

  const fmt = formatErrors(plan);
  add('Format: JSON shape, real dates, allowed run types, distance > 0', fmt, `${plan && plan.weeks ? plan.weeks.length : 0} weeks, all fields valid`);

  const numberRules = [
    'Weeks: Mondays, one per week, no gaps',
    'Dates: after today and before race day',
    'Runs per week',
    'Week 1 total within ±15% of baseline',
    'Each week ≤ 110% of the previous week',
    'Long run ≤ 35% of the week total',
    'Taper: final weeks go down',
    'Last run before race is short',
  ];
  if (fmt.length) {
    for (const rule of numberRules) results.push({ rule, status: 'SKIP', detail: 'fix the format errors first', errors: [] });
    return { ok: false, results, weeks: [] };
  }

  const weeks = weekRows(plan.weeks);

  // Weeks
  {
    const errors = [];
    const got = weeks.map((w) => w.start);
    if (got.length !== L.weekStarts.length) {
      errors.push(`expected ${L.weekStarts.length} weeks (${L.weekStarts[0]} to ${L.weekStarts[L.weekStarts.length - 1]}), got ${got.length}`);
    }
    L.weekStarts.forEach((start, i) => {
      if (got[i] !== undefined && got[i] !== start) errors.push(`week ${i + 1}: week_start is ${got[i]}, expected ${start}`);
    });
    for (const w of weeks) {
      for (const date of w.dates) {
        if (date < w.start || date > w.end) errors.push(`week ${w.n}: ${date} is outside ${w.start} to ${w.end}`);
      }
    }
    add(numberRules[0], errors, `${got.length} weeks, ${L.weekStarts[0]} to ${L.weekStarts[L.weekStarts.length - 1]}`);
  }

  // Dates
  {
    const errors = [];
    const all = weeks.flatMap((w) => w.dates).sort();
    for (const date of all) {
      if (date <= ctx.today) errors.push(`${date} is not after today (${ctx.today})`);
      if (date >= ctx.raceDate) errors.push(`${date} is not before race day (${ctx.raceDate})`);
    }
    add(numberRules[1], errors, all.length ? `first run ${all[0]}, last run ${all[all.length - 1]}, race ${ctx.raceDate}` : 'no runs');
  }

  // Runs per week
  {
    const errors = weeks
      .filter((w) => w.runs > ctx.runsPerWeek)
      .map((w) => `week ${w.n} (${w.start}): ${w.runs} runs, more than the ${ctx.runsPerWeek} requested`);
    const most = Math.max(0, ...weeks.map((w) => w.runs));
    add(numberRules[2], errors, `most in a week: ${most}, limit ${ctx.runsPerWeek}`);
  }

  // Week 1 total
  {
    const errors = [];
    const t = weeks.length ? weeks[0].total : 0;
    const range = `${km(L.week1Min)}–${km(L.week1Max)} km (baseline ${km(ctx.baselineKmPerWeek)} km ±15%)`;
    if (t < L.week1Min || t > L.week1Max) errors.push(`week 1 total is ${km(t)} km, must be ${range}`);
    add(numberRules[3], errors, `week 1 total ${km(t)} km, allowed ${range}`);
  }

  // Each week ≤ 110% of the previous
  {
    const errors = [];
    let biggest = null;
    for (let i = 1; i < weeks.length; i++) {
      const prev = weeks[i - 1].total;
      const cur = weeks[i].total;
      const max = round2(prev * (1 + MAX_WEEKLY_GROWTH));
      const change = prev > 0 ? cur / prev - 1 : Infinity;
      if (biggest === null || change > biggest.change) biggest = { n: weeks[i].n, change, prev, cur };
      if (cur > max) {
        errors.push(`week ${weeks[i].n} (${weeks[i].start}): ${km(cur)} km is more than 110% of week ${weeks[i - 1].n}'s ${km(prev)} km (max ${km(max)} km)`);
      }
    }
    const detail = biggest
      ? `biggest increase: week ${biggest.n}, ${km(biggest.prev)} -> ${km(biggest.cur)} km (${biggest.change >= 0 ? '+' : ''}${pct(biggest.change)})`
      : 'only one week';
    add(numberRules[4], errors, detail);
  }

  // Long run share
  {
    const errors = [];
    let highest = null;
    for (const w of weeks) {
      if (w.runs === 0) continue;
      const share = w.longest / w.total;
      if (highest === null || share > highest.share) highest = { ...w, share };
      if (w.longest > round2(w.total * MAX_LONG_RUN_SHARE)) {
        errors.push(`week ${w.n} (${w.start}): long run ${km(w.longest)} km is ${pct(share)} of ${km(w.total)} km (max ${km(round2(w.total * MAX_LONG_RUN_SHARE))} km)`);
      }
    }
    const detail = highest ? `highest: week ${highest.n}, ${km(highest.longest)} of ${km(highest.total)} km (${pct(highest.share)})` : 'no runs';
    add(numberRules[5], errors, detail);
  }

  // Taper: each of the last N weeks lower than the week before it
  {
    const errors = [];
    const n = ctx.taperWeeks;
    const from = Math.max(1, weeks.length - n);
    if (weeks.length < n + 1) errors.push(`plan has ${weeks.length} weeks, too few for a ${n}-week taper`);
    for (let i = from; i < weeks.length; i++) {
      if (!(weeks[i].total < weeks[i - 1].total)) {
        errors.push(`taper week ${weeks[i].n} (${weeks[i].start}): ${km(weeks[i].total)} km is not lower than week ${weeks[i - 1].n}'s ${km(weeks[i - 1].total)} km`);
      }
    }
    const shown = weeks.slice(Math.max(0, weeks.length - n - 1)).map((w) => km(w.total)).join(' -> ');
    add(`${numberRules[6]} (last ${n})`, errors, `${shown} km`);
  }

  // Last run before race
  {
    const errors = [];
    const all = plan.weeks.flatMap((w) => w.days).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = all[all.length - 1];
    if (!last) errors.push('the plan has no runs');
    else if (last.distance_km > L.lastRunMaxKm) errors.push(`last run (${last.date}) is ${km(last.distance_km)} km, max ${km(L.lastRunMaxKm)} km`);
    add(numberRules[7], errors, last ? `${last.date}: ${km(last.distance_km)} km, max ${km(L.lastRunMaxKm)} km` : '');
  }

  return { ok: results.every((r) => r.status === 'PASS'), results, weeks };
}

// Every failure as one line, used for printing and for the retry prompt
function failureLines(validation) {
  return validation.results.filter((r) => r.status === 'FAIL').flatMap((r) => r.errors.map((e) => `${r.rule}: ${e}`));
}

module.exports = {
  validatePlan,
  weekRows,
  failureLines,
  limits,
  WEEK1_TOLERANCE,
  MAX_WEEKLY_GROWTH,
  MAX_LONG_RUN_SHARE,
  SHORT_LAST_RUN_KM,
};
