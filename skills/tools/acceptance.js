#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const checks = [
  ['data lint', path.join(__dirname, 'data-lint.js')],
  ['demo refresh', path.join(root, 'demo.js')],
  ['clean install', path.join(__dirname, 'clean-install.js')]
];

for (const [name, script] of checks) {
  process.stdout.write(`\n== ${name} ==\n`);
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) {
    process.stderr.write(`FAIL acceptance stopped at ${name}\n`);
    process.exit(result.status || 1);
  }
}
process.stdout.write('\nPASS acceptance: data lint, demo refresh, clean install\n');
