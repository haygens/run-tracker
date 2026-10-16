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

// Short description used in messages and the delete confirmation
function describeRun(run) {
  return `${run.date} · ${run.run_type} · ${formatDistance(run.distance_km)} km · ${formatDuration(run.duration_sec)}`;
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

// ---- Edit mode ----

function startEdit(run) {
  editingId = run.id;
  message.hidden = true;

  form.elements.date.value = run.date;
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
  if (event.key === 'Escape' && editingId !== null) {
    message.hidden = true;
    stopEdit();
  }
});

// ---- Delete ----

async function deleteRun(run) {
  const ok = window.confirm(`Delete this run?\n\n${describeRun(run)}\n\nThis can't be undone.`);
  if (!ok) return;

  message.hidden = true;
  try {
    const res = await fetch(`/api/runs/${run.id}`, { method: 'DELETE' });
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
    await loadRuns();
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
    distance_km: data.get('distance_km') === '' ? null : Number(data.get('distance_km')),
    elevation_m: data.get('elevation_m') === '' ? null : Number(data.get('elevation_m')),
    duration_sec: duration.seconds,
    run_type: data.get('run_type'),
  };

  const isEdit = editingId !== null;
  const url = isEdit ? `/api/runs/${editingId}` : '/api/runs';

  submitButton.disabled = true;
  try {
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    const body = await res.json();

    if (!res.ok) {
      showErrors(body.error || 'Could not save run', body.details);
      // The run being edited no longer exists, so go back to adding
      if (isEdit && res.status === 404) {
        stopEdit();
        await loadRuns();
      }
      return;
    }

    if (isEdit) {
      showSuccess(`Updated: ${describeRun(body)}`);
      stopEdit();
    } else {
      showSuccess(`Saved: ${formatDistance(body.distance_km)} km on ${body.date}`);
      // Keep date and type (handy for adding several runs), clear the rest
      form.elements.distance_km.value = '';
      form.elements.elevation_m.value = '0';
      form.elements.duration.value = '';
    }
    await loadRuns();
  } catch (err) {
    showErrors(`Could not reach the server: ${err.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

form.elements.date.value = todayLocal();
loadRuns();
