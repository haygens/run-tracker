const RUN_TYPES = ['easy', 'long', 'tempo', 'intervals', 'race', 'trail', 'hike'];
const NAME_MAX_LENGTH = 60;

// True only for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30)
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Checks a run from a request body. Returns { errors } or { run } with only the known fields.
function validateRun(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Request body must be a JSON object'] };
  }

  const { date, distance_km, elevation_m, duration_sec, run_type, name } = body;
  const errors = [];

  if (!isValidDate(date)) {
    errors.push('date must be a real date in YYYY-MM-DD format');
  }
  if (typeof distance_km !== 'number' || !Number.isFinite(distance_km) || distance_km <= 0) {
    errors.push('distance_km must be a number greater than 0');
  }
  if (!Number.isInteger(elevation_m) || elevation_m < 0) {
    errors.push('elevation_m must be a whole number, 0 or more');
  }
  if (!Number.isInteger(duration_sec) || duration_sec <= 0) {
    errors.push('duration_sec must be a whole number of seconds greater than 0');
  }
  if (!RUN_TYPES.includes(run_type)) {
    errors.push(`run_type must be one of: ${RUN_TYPES.join(', ')}`);
  }

  // Name is optional: missing, null or blank is stored as null (the page shows the run type instead)
  let cleanName = null;
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') {
      errors.push('name must be text');
    } else if (name.trim().length > NAME_MAX_LENGTH) {
      errors.push(`name must be ${NAME_MAX_LENGTH} characters or fewer`);
    } else {
      cleanName = name.trim() || null;
    }
  }

  if (errors.length) return { errors };
  return { run: { date, distance_km, elevation_m, duration_sec, run_type, name: cleanName } };
}

module.exports = { validateRun, RUN_TYPES };
