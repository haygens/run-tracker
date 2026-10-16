const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

// .env next to the code (gitignored). ENV_FILE can point somewhere else, e.g. for testing.
const ENV_PATH = process.env.ENV_FILE || path.join(__dirname, '.env');
const PLACEHOLDER = 'change-me'; // the value in .env.example

function refuseToStart(lines) {
  console.error(['', 'Run Tracker cannot start:', ...lines.map((line) => `  ${line}`), ''].join('\n'));
  process.exit(1);
}

function loadWritePassword() {
  let text;
  try {
    text = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    refuseToStart([
      `No .env file found at ${ENV_PATH}`,
      'Create it with a line like:  WRITE_PASSWORD=\'your-password\'',
      'See .env.example for the format.',
    ]);
  }

  // Strip a byte-order mark: some Windows editors and PowerShell 5.1 add one,
  // and it would hide the first key from the parser
  const env = parseEnv(text.replace(/^﻿/, ''));
  const password = env.WRITE_PASSWORD;

  if (!password) {
    refuseToStart([
      `WRITE_PASSWORD is missing or empty in ${ENV_PATH}`,
      'Add a line like:  WRITE_PASSWORD=\'your-password\'',
    ]);
  }
  if (password === PLACEHOLDER) {
    refuseToStart([
      `WRITE_PASSWORD in ${ENV_PATH} is still the placeholder from .env.example`,
      'Change it to your own password.',
    ]);
  }
  return password;
}

module.exports = { WRITE_PASSWORD: loadWritePassword() };
