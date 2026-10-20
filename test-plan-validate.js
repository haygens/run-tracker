// Tests plan-validate.js with hand-made plans. No model is called.
// Run: node test-plan-validate.js

const { validatePlan } = require('./plan-validate');
const { addDays } = require('./summary');

// Same situation as the backup-database test: marathon on Sun 2027-05-02, 4 runs a week
const ctx = {
  today: '2026-10-20',
  raceDate: '2027-05-02',
  runsPerWeek: 4,
  baselineKmPerWeek: 14.45,
  taperWeeks: 3,
  goalKm: 42.195,
};

// A plan that follows every rule: 27 weeks from Mon 2026-10-26, +8% a week with a
// cutback every 4th week, then a 3-week taper. Runs on Tue, Thu, Sat and Sun.
// After a cutback the next week can only be 10% above the cutback week, not the old peak.
function goodPlan() {
  const weeks = [];
  let total = 14.5;
  let peak = total;
  for (let i = 0; i < 27; i++) {
    const weekStart = addDays('2026-11-02', 7 * (i - 1));
    if (i >= 24) total = peak * [0.75, 0.55, 0.3][i - 24];
    else if (i > 0 && i % 4 === 3) total = peak * 0.85;
    else if (i > 0) total = total * (i % 4 === 0 ? 1.09 : 1.08);
    if (i < 24) peak = Math.max(peak, total);

    const r = (n) => Math.round(n * 10) / 10;
    let days;
    if (i === 26) {
      // Race week: no Sunday run (race day), short run on Saturday
      days = [
        { date: addDays(weekStart, 1), run_type: 'easy', distance_km: r(total * 0.34), note: 'Easy' },
        { date: addDays(weekStart, 3), run_type: 'easy', distance_km: r(total * 0.34), note: 'Easy with strides' },
        { date: addDays(weekStart, 5), run_type: 'easy', distance_km: r(total * 0.32), note: 'Shakeout' },
      ];
    } else {
      days = [
        { date: addDays(weekStart, 1), run_type: 'easy', distance_km: r(total * 0.22), note: 'Easy' },
        { date: addDays(weekStart, 3), run_type: 'tempo', distance_km: r(total * 0.22), note: 'Tempo' },
        { date: addDays(weekStart, 5), run_type: 'easy', distance_km: r(total * 0.23), note: 'Easy' },
        { date: addDays(weekStart, 6), run_type: 'long', distance_km: r(total * 0.33), note: 'Long run' },
      ];
    }
    weeks.push({ week_start: weekStart, days });
  }
  return { weeks };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

const cases = [
  ['good plan', (p) => p, []],
  ['too big a jump (week 6 doubled)', (p) => { p.weeks[5].days.forEach((d) => (d.distance_km *= 2)); }, ['Each week ≤ 110%']],
  ['long run too long (week 3)', (p) => { p.weeks[2].days[3].distance_km = 20; }, ['Long run ≤ 35%', 'Each week ≤ 110%']],
  ['no taper (last 3 weeks same as week 24)', (p) => {
    for (const i of [24, 25, 26]) p.weeks[i] = { week_start: p.weeks[i].week_start, days: clone(p.weeks[23].days).map((d) => ({ ...d, date: addDays(d.date, 7 * (i - 23)) })) };
    p.weeks[26].days.pop(); // keep race day out of the plan
  }, ['Taper']],
  ['date on race day', (p) => { p.weeks[26].days.push({ date: '2027-05-02', run_type: 'easy', distance_km: 3, note: 'x' }); }, ['Dates']],
  ['date after race day (and outside its week)', (p) => { p.weeks[26].days[2].date = '2027-05-04'; }, ['Weeks', 'Dates']],
  ['wrong run types ("rest", "jog")', (p) => { p.weeks[0].days[0].run_type = 'rest'; p.weeks[4].days[1].run_type = 'jog'; }, ['Format']],
  ['week 1 too big', (p) => { p.weeks[0].days[3].distance_km = 5.5; p.weeks[0].days.forEach((d) => (d.distance_km += 1)); }, ['Week 1 total']],
  ['5 runs in a week', (p) => { p.weeks[10].days.push({ date: addDays(p.weeks[10].week_start, 0), run_type: 'easy', distance_km: 1, note: 'x' }); }, ['Runs per week', 'Each week ≤ 110%']], // the extra km also breaks +10%
  ['missing week', (p) => { p.weeks.splice(12, 1); }, ['Weeks', 'Each week ≤ 110%']], // week 14 now follows week 12
  ['last run too long', (p) => { p.weeks[26].days[2].distance_km = 10; p.weeks[26].days[0].distance_km = 0.5; p.weeks[26].days[1].distance_km = 0.5; }, ['Last run before race', 'Long run ≤ 35%']],
  ['not a plan object', () => [1, 2, 3], ['Format']],
  ['distance zero, missing note', (p) => { p.weeks[1].days[0].distance_km = 0; delete p.weeks[1].days[1].note; }, ['Format']],
];

let failures = 0;
for (const [name, mutate, expectFail] of cases) {
  let plan = goodPlan();
  const replaced = mutate(plan);
  if (replaced !== undefined) plan = replaced;
  const v = validatePlan(plan, ctx);
  const failed = v.results.filter((r) => r.status === 'FAIL').map((r) => r.rule);
  const expected = expectFail.every((e) => failed.some((f) => f.startsWith(e))) && failed.length === expectFail.length;
  if (!expected) failures++;
  console.log(`${expected ? 'ok  ' : 'BAD '} ${name}`);
  for (const r of v.results.filter((x) => x.status === 'FAIL')) {
    for (const e of r.errors) console.log(`       FAIL ${r.rule}: ${e}`);
  }
  if (!expected) console.log(`       expected to fail: ${expectFail.join(', ') || 'nothing'}; failed: ${failed.join(', ') || 'nothing'}`);
}
console.log(failures ? `\n${failures} case(s) did not behave as expected` : `\nAll ${cases.length} cases behaved as expected`);
process.exitCode = failures ? 1 : 0;
