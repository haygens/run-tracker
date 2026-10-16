const form = document.getElementById('run-form');
const message = document.getElementById('form-message');
const tbody = document.querySelector('#runs-table tbody');
const emptyNote = document.getElementById('runs-empty');

// ---- Formatting helpers ----

// "1:02:03" or "27:00" -> seconds. Returns null if the text isn't a valid time.
function parseDuration(text) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1] || 0);
  const m = Number(match[2]);
  const s = Number(match[3]);
  if (m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
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

function renderRuns(runs) {
  tbody.replaceChildren();
  emptyNote.hidden = runs.length > 0;

  for (const run of runs) {
    const cells = [
      [run.date, ''],
      [run.run_type, ''],
      [run.distance_km.toFixed(2), 'num'],
      [run.elevation_m, 'num'],
      [formatDuration(run.duration_sec), 'num'],
      [formatPace(run.duration_sec, run.distance_km), 'num'],
    ];
    const row = document.createElement('tr');
    for (const [text, className] of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (className) cell.className = className;
      row.appendChild(cell);
    }
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

// ---- Add-run form ----

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.hidden = true;

  const data = new FormData(form);
  const durationSec = parseDuration(data.get('duration'));
  if (durationSec === null) {
    showErrors('Time must be in hh:mm:ss format, e.g. 00:27:00 or 1:05:30');
    return;
  }

  // Empty number fields are sent as null; the server rejects them with a clear message
  const run = {
    date: data.get('date'),
    distance_km: data.get('distance_km') === '' ? null : Number(data.get('distance_km')),
    elevation_m: data.get('elevation_m') === '' ? null : Number(data.get('elevation_m')),
    duration_sec: durationSec,
    run_type: data.get('run_type'),
  };

  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    const body = await res.json();

    if (!res.ok) {
      showErrors(body.error || 'Could not save run', body.details);
      return;
    }

    showSuccess(`Saved: ${body.distance_km} km on ${body.date}`);
    // Keep date and type (handy for adding several runs), clear the rest
    form.elements.distance_km.value = '';
    form.elements.elevation_m.value = '0';
    form.elements.duration.value = '';
    await loadRuns();
  } catch (err) {
    showErrors(`Could not reach the server: ${err.message}`);
  } finally {
    button.disabled = false;
  }
});

form.elements.date.value = todayLocal();
loadRuns();
