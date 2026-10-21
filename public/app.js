const form = document.getElementById('run-form');
const message = document.getElementById('form-message');
const tbody = document.querySelector('#runs-table tbody');
const emptyNote = document.getElementById('runs-empty');

// ---- Formatting helpers ----

const TIME_FORMAT_HELP = 'Enter time as minutes (75), min:sec (65:30) or h:mm:ss (1:05:30)';

// Minutes-based time input -> { seconds } or { error }.
//   "75"      -> 75 min
//   "65:30"   -> 65 min 30 s (minutes can be any size)
//   "1:05:30" -> same as 65:30 (minutes must be 0-59 here)
// Seconds must always be two digits, 00-59.
function parseDuration(text) {
  const value = text.trim();
  if (value === '') return { error: `Time is required. ${TIME_FORMAT_HELP}.` };

  let h = 0;
  let m;
  let s = 0;
  let match;
  if ((match = /^(\d+)$/.exec(value))) {
    m = Number(match[1]);
  } else if ((match = /^(\d+):(\d{2})$/.exec(value))) {
    m = Number(match[1]);
    s = Number(match[2]);
  } else if ((match = /^(\d+):(\d{2}):(\d{2})$/.exec(value))) {
    h = Number(match[1]);
    m = Number(match[2]);
    s = Number(match[3]);
    if (m > 59) return { error: `In h:mm:ss, minutes must be 00-59 (got "${value}").` };
  } else {
    return { error: `"${value}" is not a valid time. ${TIME_FORMAT_HELP}, with whole numbers only.` };
  }

  if (s > 59) return { error: `Seconds must be 00-59 (got "${value}").` };
  const seconds = h * 3600 + m * 60 + s;
  if (seconds === 0) return { error: 'Time must be more than 0.' };
  return { seconds };
}

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

// Pace in min/km, e.g. 1620 s over 5.2 km -> "5:12"
function formatPace(durationSec, distanceKm) {
  const secPerKm = Math.round(durationSec / distanceKm);
  return formatDuration(secPerKm);
}

// Today's date in local time as YYYY-MM-DD (toISOString would use UTC)
function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---- Messages ----

function showSuccess(text) {
  message.className = 'success';
  message.textContent = text;
  message.hidden = false;
}

function showErrors(title, details = []) {
  message.className = 'error';
  message.textContent = title;
  if (details.length) {
    const list = document.createElement('ul');
    for (const detail of details) {
      const item = document.createElement('li');
      item.textContent = detail;
      list.appendChild(item);
    }
    message.appendChild(list);
  }
  message.hidden = false;
}

// ---- Runs table ----

const formHeading = document.getElementById('form-heading');
const submitButton = document.getElementById('submit-button');
const cancelButton = document.getElementById('cancel-edit');

// Runs currently shown, by id, so Edit/Delete buttons can look up the full run
let runsById = new Map();
// id of the run being edited, or null when the form is adding a new run
let editingId = null;

// A run's name, or its type capitalized if it has none ("long" -> "Long")
function displayName(run) {
  return run.name || run.run_type.charAt(0).toUpperCase() + run.run_type.slice(1);
}

// Short description used in messages and the delete confirmation
function describeRun(run) {
  return `${run.date} · ${displayName(run)} · ${formatDistance(run.distance_km)} km · ${formatDuration(run.duration_sec)}`;
}

function makeButton(text, action, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.className = `row-button ${action}`;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderRuns(runs) {
  runsById = new Map(runs.map((run) => [run.id, run]));
  tbody.replaceChildren();
  emptyNote.hidden = runs.length > 0;

  for (const run of runs) {
    const cells = [
      [run.date, ''],
      [displayName(run), ''],
      [run.run_type, ''],
      [formatDistance(run.distance_km), 'num'],
      [run.elevation_m, 'num'],
      [formatDuration(run.duration_sec), 'num'],
      [formatPace(run.duration_sec, run.distance_km), 'num'],
    ];
    const row = document.createElement('tr');
    if (run.id === editingId) row.className = 'editing';
    for (const [text, className] of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (className) cell.className = className;
      row.appendChild(cell);
    }
    const actions = document.createElement('td');
    actions.className = 'actions';
    actions.append(makeButton('Edit', 'edit', run.id), makeButton('Delete', 'delete', run.id));
    row.appendChild(actions);
    tbody.appendChild(row);
  }
}

async function loadRuns() {
  try {
    const res = await fetch('/api/runs');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    renderRuns(await res.json());
  } catch (err) {
    showErrors(`Could not load runs: ${err.message}`);
  }
}

// One click handler for every Edit/Delete button in the table
tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const run = runsById.get(Number(button.dataset.id));
  if (!run) return;

  if (button.dataset.action === 'edit') startEdit(run);
  if (button.dataset.action === 'delete') deleteRun(run);
});

// ---- Summary ----

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

// "3:45 /km · Seawall Loop" style line for a personal best
function describeBest(value, run) {
  return run ? `${value} · ${displayName(run)}` : 'None yet';
}

function renderSummary(s) {
  setText('all-km', `${formatDistance(s.all_time.distance_km)} km`);
  setText('all-elev', `${s.all_time.elevation_m} m`);
  setText('all-runs', s.all_time.runs);
  setText('all-time', formatDuration(s.all_time.duration_sec));

  setText('week-km', `${formatDistance(s.this_week.distance_km)} km`);
  setText('week-runs', s.this_week.runs);
  setText('week-range', `${s.this_week.start} to ${s.this_week.end}`);

  setText('month-km', `${formatDistance(s.this_month.distance_km)} km`);
  setText('month-runs', s.this_month.runs);
  setText('month-range', `${s.this_month.start} to ${s.this_month.end}`);

  const { days, start, end } = s.streak;
  setText('streak-days', `${days} ${days === 1 ? 'day' : 'days'}`);
  setText('streak-range', days > 0 ? `${start} to ${end}` : 'Run today to start one');

  const pb = s.personal_bests;
  setText('pb-longest', describeBest(pb.longest_run && `${formatDistance(pb.longest_run.distance_km)} km`, pb.longest_run));
  setText('pb-elevation', describeBest(pb.most_elevation && `${pb.most_elevation.elevation_m} m`, pb.most_elevation));
  setText('pb-pace', describeBest(pb.fastest_pace && `${formatDuration(pb.fastest_pace.pace_sec_per_km)} /km`, pb.fastest_pace));
}

async function loadSummary() {
  try {
    const res = await fetch('/api/summary');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    renderSummary(await res.json());
  } catch (err) {
    showErrors(`Could not load summary: ${err.message}`);
  }
}

// ---- Weekly chart (plain SVG) ----

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const chartBox = document.getElementById('weekly-chart');
const chartTooltip = document.getElementById('weekly-tooltip');
let lastWeeks = [];

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// "2026-10-12" -> "12 Oct"
function shortDate(ymd) {
  return `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
}

// A clean axis step giving about 4 gridlines: 1, 2, 2.5, 5, 10, 20, 25, 50...
function niceStep(max) {
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * magnitude >= raw) return m * magnitude;
  }
  return 10 * magnitude;
}

// Bar outline with 4px rounded top corners and a square bottom on the baseline
function barPath(x, y, width, height) {
  const r = Math.min(4, height, width / 2);
  const base = y + height;
  return `M${x},${base} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + width - r} ` +
    `A${r},${r} 0 0 1 ${x + width},${y + r} V${base} Z`;
}

function renderWeekly(weeks) {
  lastWeeks = weeks;
  chartBox.querySelector('svg')?.remove();
  chartTooltip.hidden = true;

  const width = chartBox.clientWidth;
  const height = 240;
  const margin = { top: 24, right: 8, bottom: 28, left: 40 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const baseline = margin.top + plotH;

  const maxKm = Math.max(...weeks.map((w) => w.distance_km));
  const step = maxKm > 0 ? niceStep(maxKm) : 5;
  const top = maxKm > 0 ? Math.ceil(maxKm / step) * step : 4 * step;
  const yFor = (km) => baseline - (km / top) * plotH;

  const root = svg('svg', {
    width,
    height,
    role: 'list',
    'aria-label': 'Kilometres per week for the last 12 weeks',
  });

  // Gridlines and y-axis labels
  for (let value = 0; value <= top + 1e-9; value += step) {
    const y = yFor(value);
    root.append(svg('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: value === 0 ? 'baseline' : 'gridline' }));
    const label = svg('text', { x: margin.left - 8, y: y + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = formatDistance(value);
    root.append(label);
  }

  // Only label the extremes that matter: this week and the best week
  const lastIndex = weeks.length - 1;
  const bestIndex = maxKm > 0 ? weeks.findIndex((w) => w.distance_km === maxKm) : -1;

  const slotW = plotW / weeks.length;
  const barW = Math.min(24, slotW * 0.6);

  weeks.forEach((week, i) => {
    const slotX = margin.left + i * slotW;
    const barX = slotX + (slotW - barW) / 2;
    const isCurrent = i === lastIndex;

    const runsText = `${week.runs} ${week.runs === 1 ? 'run' : 'runs'}`;
    const slot = svg('g', {
      class: 'slot',
      tabindex: 0,
      role: 'listitem',
      'aria-label': `Week ${week.week_start} to ${week.week_end}: ${formatDistance(week.distance_km)} km, ${runsText}`,
    });

    // Faint full-height track, so a week with no runs still shows as an empty bar
    slot.append(svg('path', { d: barPath(barX, margin.top, barW, plotH), class: 'track' }));
    if (week.distance_km > 0) {
      const y = yFor(week.distance_km);
      slot.append(svg('path', { d: barPath(barX, y, barW, baseline - y), class: 'bar' }));
    }
    // Hit target: the whole column, bigger than the bar itself
    slot.append(svg('rect', { x: slotX, y: margin.top, width: slotW, height: plotH, class: 'hit' }));

    if (i === lastIndex || i === bestIndex) {
      const value = svg('text', { x: barX + barW / 2, y: yFor(week.distance_km) - 6, class: 'value', 'text-anchor': 'middle' });
      value.textContent = formatDistance(week.distance_km);
      slot.append(value);
    }

    const dateLabel = svg('text', { x: barX + barW / 2, y: baseline + 18, class: isCurrent ? 'tick current' : 'tick', 'text-anchor': 'middle' });
    dateLabel.textContent = isCurrent ? 'This week' : shortDate(week.week_start);
    slot.append(dateLabel);

    const show = () => showWeekTooltip(week, isCurrent, barX + barW / 2, yFor(week.distance_km), width);
    slot.addEventListener('pointerenter', show);
    slot.addEventListener('focus', show);
    slot.addEventListener('pointerleave', () => (chartTooltip.hidden = true));
    slot.addEventListener('blur', () => (chartTooltip.hidden = true));

    root.append(slot);
  });

  chartBox.prepend(root);
  renderWeeklyTable(weeks);
}

function showWeekTooltip(week, isCurrent, x, y, chartWidth) {
  const value = document.createElement('strong');
  value.textContent = `${formatDistance(week.distance_km)} km`;
  const runs = document.createElement('span');
  runs.textContent = ` · ${week.runs} ${week.runs === 1 ? 'run' : 'runs'}`;
  const dates = document.createElement('div');
  dates.className = 'chart-tooltip-dates';
  dates.textContent = `${week.week_start} to ${week.week_end}${isCurrent ? ' (this week, so far)' : ''}`;
  chartTooltip.replaceChildren(value, runs, dates);

  chartTooltip.hidden = false;
  // Keep the tooltip inside the chart near the left and right edges
  const half = chartTooltip.offsetWidth / 2;
  chartTooltip.style.left = `${Math.min(Math.max(x, half), chartWidth - half)}px`;
  chartTooltip.style.top = `${y - 10}px`;
}

function renderWeeklyTable(weeks) {
  const body = document.getElementById('weekly-table-body');
  body.replaceChildren();
  for (const week of weeks) {
    const row = document.createElement('tr');
    for (const [text, className] of [
      [`${week.week_start} to ${week.week_end}`, ''],
      [week.runs, 'num'],
      [formatDistance(week.distance_km), 'num'],
    ]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (className) cell.className = className;
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
}

async function loadWeekly() {
  try {
    const res = await fetch('/api/weekly');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    renderWeekly(await res.json());
  } catch (err) {
    showErrors(`Could not load weekly chart: ${err.message}`);
  }
}

// Redraw at the new width when the window is resized
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastWeeks.length && renderWeekly(lastWeeks), 150);
});

// Reload everything that depends on the runs (after add, edit or delete)
function refresh() {
  return Promise.all([loadRuns(), loadSummary(), loadWeekly()]);
}

// ---- Edit mode ----

function startEdit(run) {
  editingId = run.id;
  message.hidden = true;

  form.elements.date.value = run.date;
  form.elements.name.value = run.name || ''; // blank stays blank, so the type keeps standing in
  form.elements.distance_km.value = run.distance_km; // full value, not the rounded display
  form.elements.elevation_m.value = run.elevation_m;
  form.elements.duration.value = formatDuration(run.duration_sec); // "1:05:30" / "27:00" both parse back
  form.elements.run_type.value = run.run_type;

  formHeading.textContent = `Edit run (${run.date})`;
  submitButton.textContent = 'Save changes';
  cancelButton.hidden = false;
  form.classList.add('editing');
  renderRuns([...runsById.values()]); // highlight the row being edited

  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  form.elements.distance_km.focus();
}

// Back to adding a new run, with a fresh form
function stopEdit() {
  editingId = null;
  form.reset();
  form.elements.date.value = todayLocal();

  formHeading.textContent = 'Add a run';
  submitButton.textContent = 'Add run';
  cancelButton.hidden = true;
  form.classList.remove('editing');
  renderRuns([...runsById.values()]);
}

cancelButton.addEventListener('click', () => {
  message.hidden = true;
  stopEdit();
});

// Esc also cancels editing
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editingId !== null && !passwordDialog.open) {
    message.hidden = true;
    stopEdit();
  }
});

// ---- Password ----
// Asked for on the first add/edit/delete, then remembered in sessionStorage,
// which belongs to this browser tab only and is cleared when the tab closes.

const PASSWORD_KEY = 'runTrackerPassword';
const passwordDialog = document.getElementById('password-dialog');
const passwordForm = document.getElementById('password-form');
const passwordInput = document.getElementById('password-input');
const passwordMessage = document.getElementById('password-message');
const passwordCancel = document.getElementById('password-cancel');
const passwordStatus = document.getElementById('password-status');
let memoryPassword = null; // fallback if sessionStorage is blocked

function getPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? memoryPassword;
  } catch {
    return memoryPassword;
  }
}

function rememberPassword(password) {
  memoryPassword = password;
  try {
    sessionStorage.setItem(PASSWORD_KEY, password);
  } catch {
    // Storage blocked: the in-memory copy lasts until the page reloads
  }
  passwordStatus.hidden = false;
}

function forgetPassword() {
  memoryPassword = null;
  try {
    sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // nothing stored
  }
  passwordStatus.hidden = true;
}

document.getElementById('forget-password').addEventListener('click', () => {
  forgetPassword();
  showSuccess('Password forgotten. You will be asked again next time you add, edit or delete, or generate a plan.');
});

// Shows the password dialog. Resolves with the password, or null if cancelled.
function askPassword(text, isError = false) {
  return new Promise((resolve) => {
    passwordMessage.textContent = text;
    passwordMessage.className = isError ? 'password-error' : '';
    passwordInput.value = '';

    const finish = (value) => {
      passwordForm.removeEventListener('submit', onSubmit);
      passwordDialog.removeEventListener('cancel', onCancel);
      passwordCancel.removeEventListener('click', onCancel);
      passwordDialog.close();
      resolve(value);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      if (passwordInput.value === '') {
        passwordInput.focus();
        return;
      }
      finish(passwordInput.value);
    };
    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };

    passwordForm.addEventListener('submit', onSubmit);
    passwordDialog.addEventListener('cancel', onCancel); // Esc key
    passwordCancel.addEventListener('click', onCancel);
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

// fetch() for add/edit/delete and generating a plan: sends the password, asks for it
// first if needed, and asks again if the server says it's wrong. Resolves with the
// response, or null if the password dialog was cancelled.
// beforeSend (optional) runs once the password is known, right before each request.
async function writeRequest(url, method, body, beforeSend = () => {}) {
  let password = getPassword();
  if (!password) {
    password = await askPassword('Enter the Run Tracker password to add, edit or delete runs, or to generate a plan.');
    if (password === null) return null;
  }

  for (;;) {
    const headers = { 'X-Password': encodeURIComponent(password) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    beforeSend();
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

    if (res.status !== 401) {
      rememberPassword(password); // the server accepted it
      return res;
    }

    forgetPassword();
    const error = await res.json().catch(() => ({}));
    password = await askPassword(`${error.error || 'Wrong password'}. Please try again.`, true);
    if (password === null) return null;
  }
}

const PASSWORD_CANCELLED = 'Nothing was changed: the password is needed to add, edit or delete runs.';

// ---- Delete ----

async function deleteRun(run) {
  const ok = window.confirm(`Delete this run?\n\n${describeRun(run)}\n\nThis can't be undone.`);
  if (!ok) return;

  message.hidden = true;
  try {
    const res = await writeRequest(`/api/runs/${run.id}`, 'DELETE');
    if (res === null) {
      showErrors(PASSWORD_CANCELLED);
      return;
    }
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      showErrors(body.error || `Could not delete run (server returned ${res.status})`);
      return;
    }

    if (res.status === 404) {
      showErrors('That run was already deleted.');
    } else {
      showSuccess(`Deleted: ${describeRun(run)}`);
    }
    if (editingId === run.id) stopEdit();
    await refresh();
  } catch (err) {
    showErrors(`Could not reach the server: ${err.message}`);
  }
}

// ---- Add / save form ----

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.hidden = true;

  const data = new FormData(form);
  const duration = parseDuration(data.get('duration'));
  if (duration.error) {
    showErrors(duration.error);
    return;
  }

  // Empty number fields are sent as null; the server rejects them with a clear message
  const run = {
    date: data.get('date'),
    name: data.get('name'),
    distance_km: data.get('distance_km') === '' ? null : Number(data.get('distance_km')),
    elevation_m: data.get('elevation_m') === '' ? null : Number(data.get('elevation_m')),
    duration_sec: duration.seconds,
    run_type: data.get('run_type'),
  };

  const isEdit = editingId !== null;
  const url = isEdit ? `/api/runs/${editingId}` : '/api/runs';

  submitButton.disabled = true;
  try {
    const res = await writeRequest(url, isEdit ? 'PUT' : 'POST', run);
    if (res === null) {
      showErrors(PASSWORD_CANCELLED);
      return;
    }
    const body = await res.json();

    if (!res.ok) {
      showErrors(body.error || 'Could not save run', body.details);
      // The run being edited no longer exists, so go back to adding
      if (isEdit && res.status === 404) {
        stopEdit();
        await refresh();
      }
      return;
    }

    if (isEdit) {
      showSuccess(`Updated: ${describeRun(body)}`);
      stopEdit();
    } else {
      showSuccess(`Saved: ${formatDistance(body.distance_km)} km on ${body.date}`);
      // Keep date and type (handy for adding several runs), clear the rest
      form.elements.name.value = '';
      form.elements.distance_km.value = '';
      form.elements.elevation_m.value = '0';
      form.elements.duration.value = '';
    }
    await refresh();
  } catch (err) {
    showErrors(`Could not reach the server: ${err.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

// ---- Training plan ----
// Check is free: plain code on the server, no model. Generate calls the model, needs
// the password and takes a minute or two; the server runs one at a time.

const planForm = document.getElementById('plan-form');
const planMessage = document.getElementById('plan-message');
const planGenerateButton = document.getElementById('plan-generate-button');
const planCheckResult = document.getElementById('plan-check-result');
const planResult = document.getElementById('plan-result');
const planTableBody = document.querySelector('#plan-table tbody');

const GOAL_NAMES = { '5k': '5K', '10k': '10K', half: 'Half marathon', marathon: 'Marathon' };
const GENERATING_TEXT = 'Generating plan… this takes about 2 minutes.';
let generatingPlan = false;
let shownPlan = null; // the plan in the table, so a failed generate can relabel it

// kind: 'success', 'error' or 'info'. raw (optional) is shown in a collapsed box.
function showPlanMessage(kind, title, details = [], raw = '') {
  planMessage.className = kind;
  planMessage.textContent = title;
  if (details.length) {
    const list = document.createElement('ul');
    for (const detail of details) {
      const item = document.createElement('li');
      item.textContent = detail;
      list.appendChild(item);
    }
    planMessage.appendChild(list);
  }
  if (raw) {
    const box = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Show the raw model output';
    const pre = document.createElement('pre');
    pre.textContent = raw;
    box.append(summary, pre);
    planMessage.appendChild(box);
  }
  planMessage.hidden = false;
}

// "2027-05-02" -> "Sun 2 May 2027"
function longDate(ymd) {
  const day = new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${day} ${shortDate(ymd)} ${ymd.slice(0, 4)}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The form as the body the API expects; the server checks every field
function planRequest() {
  const runs = planForm.elements.runs_per_week.value;
  return {
    goal: planForm.elements.goal.value,
    race_date: planForm.elements.race_date.value,
    runs_per_week: runs === '' ? null : Number(runs),
  };
}

// While generating, the whole form is disabled so the inputs can't drift from the request
function setGenerating(on) {
  generatingPlan = on;
  for (const el of planForm.elements) el.disabled = on;
}

function renderCheck(c) {
  const b = c.baseline;
  setText('check-window', `${b.window_start} to ${b.window_end} · ${b.runs} ${b.runs === 1 ? 'run' : 'runs'}, ${formatDistance(b.total_km)} km`);
  setText('check-avg', `${formatDistance(b.avg_km_per_week)} km · ${formatDistance(b.avg_runs_per_week)} runs`);
  setText('check-longest', b.longest_run_km === null ? 'None' : `${formatDistance(b.longest_run_km)} km`);
  setText('check-pace', b.typical_pace === null ? 'None' : `${b.typical_pace} /km`);
  setText(
    'check-weeks',
    c.weeks_needed === null
      ? `No baseline yet · ${c.weeks_available} available`
      : `${c.weeks_needed} (${c.growth_weeks} growth + ${c.cutback_weeks} cutback + ${c.taper_weeks} taper) · ${c.weeks_available} available`,
  );

  const verdict = document.getElementById('check-realistic');
  verdict.textContent = `Realistic: ${c.realistic ? 'yes' : 'no'}.`;
  verdict.className = c.realistic ? 'yes' : 'no';
  setText('check-reason', capitalize(c.reason));

  let earliest;
  if (c.realistic) earliest = `Earliest race date by this rule: ${longDate(c.earliest_race_date)}`;
  else if (c.earliest_race_date) earliest = `Suggested earliest race date: ${longDate(c.earliest_race_date)}`;
  else earliest = 'Suggested earliest race date: none yet. Log a few weeks of running, then try again.';
  setText('check-earliest', earliest);

  planCheckResult.hidden = false;
  planGenerateButton.hidden = !c.realistic;
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

// A week's runs, shown under its row when clicked
function daysRow(week, id) {
  const row = document.createElement('tr');
  row.className = 'plan-days';
  row.id = id;
  row.hidden = true;
  const td = document.createElement('td');
  td.colSpan = 5;
  const table = document.createElement('table');
  const days = [...week.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const day of days) {
    const tr = document.createElement('tr');
    tr.append(
      cell(longDate(day.date).slice(0, -5)), // "Tue 27 Oct"
      cell(capitalize(day.run_type)),
      cell(`${formatDistance(day.distance_km)} km`, 'num'),
      cell(day.note || ''),
    );
    table.appendChild(tr);
  }
  td.appendChild(table);
  row.appendChild(td);
  return row;
}

function renderChecks(checks) {
  const list = document.getElementById('plan-checks');
  list.replaceChildren();
  // Plans saved by plan.js before the web version have no rule results
  document.getElementById('plan-checks-missing').hidden = checks !== null;
  list.hidden = checks === null;
  if (checks === null) return;

  for (const check of checks) {
    const item = document.createElement('li');
    const status = document.createElement('span');
    status.className = `check-status ${check.status.toLowerCase()}`;
    status.textContent = check.status;
    const rule = document.createElement('strong');
    rule.textContent = check.rule;
    item.append(status, rule);
    if (check.detail) item.append(`: ${check.detail}`);
    if (check.errors.length) {
      const errors = document.createElement('ul');
      for (const e of check.errors) {
        const li = document.createElement('li');
        li.textContent = e;
        errors.appendChild(li);
      }
      item.appendChild(errors);
    }
    list.appendChild(item);
  }
}

// data: { plan, rows, checks, retried? } from /api/plan/generate or /api/plan/latest
function renderPlan(data, isLatest) {
  shownPlan = data;
  const { plan, rows } = data;
  const retried = data.retried ?? plan.attempts > 1;
  setText('plan-title', `${isLatest ? 'Latest saved plan' : 'New plan'}: ${GOAL_NAMES[plan.goal] || plan.goal}, race on ${longDate(plan.race_date)}`);
  const saved = new Date(plan.created).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  setText('plan-meta', `${plan.runs_per_week} runs per week · ${rows.length} weeks · saved ${saved} · ${retried ? 'needed one retry' : 'no retry'}`);

  planTableBody.replaceChildren();
  rows.forEach((row, i) => {
    const daysId = `plan-days-${i}`;
    // A real button carries aria-expanded (a <tr> can't); the whole row stays clickable
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'plan-week-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', daysId);
    const prefix = document.createElement('span');
    prefix.className = 'visually-hidden';
    prefix.textContent = 'Week ';
    toggle.append(prefix, String(row.n));
    const weekCell = document.createElement('td');
    weekCell.appendChild(toggle);

    const tr = document.createElement('tr');
    tr.className = 'plan-week';
    tr.append(
      weekCell,
      cell(`${row.start} to ${row.end}`),
      cell(row.runs, 'num'),
      cell(formatDistance(row.total), 'num'),
      cell(formatDistance(row.longest), 'num'),
    );
    planTableBody.append(tr, daysRow(plan.weeks[i], daysId));
  });
  setText('plan-total', formatDistance(rows.reduce((sum, r) => sum + r.total, 0)));

  renderChecks(data.checks ?? null);
  planResult.hidden = false;
}

function toggleWeek(row) {
  const days = row.nextElementSibling;
  days.hidden = !days.hidden;
  row.querySelector('.plan-week-toggle').setAttribute('aria-expanded', String(!days.hidden));
}

// Clicks anywhere on a week row, and Enter/Space on its button (which fire a click)
planTableBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr.plan-week');
  if (row) toggleWeek(row);
});

// A changed input makes the last check out of date: hide it until Check is pressed again
planForm.addEventListener('input', () => {
  if (generatingPlan) return;
  planCheckResult.hidden = true;
  planGenerateButton.hidden = true;
});

planForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (generatingPlan) return;
  planMessage.hidden = true;
  planCheckResult.hidden = true;
  planGenerateButton.hidden = true;
  try {
    const res = await fetch('/api/plan/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequest()),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showPlanMessage('error', body.error || `Could not check the goal (server returned ${res.status})`, body.details || []);
      return;
    }
    renderCheck(body);
  } catch (err) {
    showPlanMessage('error', `Could not reach the server: ${err.message}`);
  }
});

planGenerateButton.addEventListener('click', async () => {
  if (generatingPlan) return;
  const request = planRequest();
  planMessage.hidden = true;
  setGenerating(true);
  try {
    // The "Generating" message appears once the password is known, not behind the dialog
    const res = await writeRequest('/api/plan/generate', 'POST', request, () => showPlanMessage('info', GENERATING_TEXT));
    if (res === null) {
      showPlanMessage('error', 'No plan was generated: the password is needed to generate a plan.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The plan still on screen is the last saved one, not the one that just failed
      if (shownPlan) renderPlan(shownPlan, true);
      showPlanMessage('error', body.error || `Could not generate a plan (server returned ${res.status})`, body.failures || body.details || [], body.raw || '');
      return;
    }
    renderPlan(body, false);
    showPlanMessage('success', `Plan saved. All ${body.checks.length} rules passed${body.retried ? ' after one retry' : ' on the first try'}.`);
  } catch (err) {
    showPlanMessage('error', `Could not reach the server: ${err.message}`);
  } finally {
    setGenerating(false);
  }
});

// On page load: show the latest saved plan, and fill the form with its goal
async function loadLatestPlan() {
  try {
    const res = await fetch('/api/plan/latest');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const body = await res.json();
    if (!body.plan) return;
    renderPlan(body, true);
    planForm.elements.goal.value = body.plan.goal;
    planForm.elements.race_date.value = body.plan.race_date;
    planForm.elements.runs_per_week.value = body.plan.runs_per_week;
  } catch (err) {
    showPlanMessage('error', `Could not load the latest plan: ${err.message}`);
  }
}

form.elements.date.value = todayLocal();
passwordStatus.hidden = !getPassword();
refresh();
loadLatestPlan();
