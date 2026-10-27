const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

// Settings come from environment variables first (on Vercel they're set in the project settings),
// then from .env next to the code (gitignored). ENV_FILE can point somewhere else, e.g. for testing.
const ENV_PATH = process.env.ENV_FILE || path.join(__dirname, '.env');
const PLACEHOLDER = 'change-me'; // the value in .env.example

function refuseToStart(lines) {
  console.error(['', 'Run Tracker cannot start:', ...lines.map((line) => `  ${line}`), ''].join('\n'));
  process.exit(1);
}

// The parsed .env file, or null if there isn't one
function readEnvFile() {
  let text;
  try {
    text = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
  // Strip a byte-order mark: some Windows editors and PowerShell 5.1 add one,
  // and it would hide the first key from the parser
  return parseEnv(text.replace(/^﻿/, ''));
}

const fileEnv = readEnvFile();

// An environment variable wins over the same name in .env; empty counts as not set
function setting(name) {
  return process.env[name] || (fileEnv && fileEnv[name]) || null;
}

function loadWritePassword() {
  const fromEnvVar = Boolean(process.env.WRITE_PASSWORD);
  if (!fromEnvVar && !fileEnv) {
    refuseToStart([
      `No .env file found at ${ENV_PATH}`,
      'Create it with a line like:  WRITE_PASSWORD=\'your-password\'',
      'See .env.example for the format.',
    ]);
  }

  const password = setting('WRITE_PASSWORD');

  if (!password) {
    refuseToStart([
      `WRITE_PASSWORD is missing or empty in ${ENV_PATH}`,
      'Add a line like:  WRITE_PASSWORD=\'your-password\'',
    ]);
  }
  if (password === PLACEHOLDER) {
    refuseToStart([
      fromEnvVar
        ? 'The WRITE_PASSWORD environment variable is still the placeholder from .env.example'
        : `WRITE_PASSWORD in ${ENV_PATH} is still the placeholder from .env.example`,
      'Change it to your own password.',
    ]);
  }
  return password;
}

// Turso (hosted SQLite). Same names the Vercel Marketplace integration sets.
// Neither set: the app uses runs.db, as before. Only one set is a mistake, so refuse.
function loadTurso() {
  const url = setting('TURSO_DATABASE_URL');
  const authToken = setting('TURSO_AUTH_TOKEN');
  if (!url && !authToken) return { url: null, authToken: null };

  if (!url || !authToken) {
    refuseToStart([
      `${url ? 'TURSO_AUTH_TOKEN' : 'TURSO_DATABASE_URL'} is missing, but ${url ? 'TURSO_DATABASE_URL' : 'TURSO_AUTH_TOKEN'} is set`,
      'Set both to use Turso, or remove both to use runs.db on this computer.',
    ]);
  }
  // The app talks to Turso over HTTPS; a local file is DB_PATH's job
  if (!/^(libsql|https):\/\//.test(url)) {
    refuseToStart([
      'TURSO_DATABASE_URL must start with libsql:// or https:// (copy it from the Turso dashboard)',
      'For a database file on this computer, leave the Turso settings out and use DB_PATH.',
    ]);
  }
  return { url, authToken };
}

let writePassword = null;

module.exports = {
  // Checked when first used: the server reads it at startup, so it still refuses to start
  // without one. plan.js never reads it, so it can use the Turso settings without a password.
  get WRITE_PASSWORD() {
    writePassword ??= loadWritePassword();
    return writePassword;
  },
  TURSO: loadTurso(),
};
