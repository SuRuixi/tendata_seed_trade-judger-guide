#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skills = [
  ['trade-j1-methodology', 'j1.json', 'j1.json'],
  ['trade-j2-fidelity', 'j2.json', 'j2.json'],
  ['trade-j3-completeness', 'j3.json', 'j3.json'],
  ['trade-j4-pairwise-btd', 'j4.json', 'ranking.json'],
  ['trade-j5-trace-html', 'j5.json', 'trace-report.html']
];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tendata-trade-judger-skills-'));
const destination = path.join(temporary, '.trae', 'skills');

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: temporary, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${label} 失败\n${result.stdout}${result.stderr}`);
}

try {
  run([path.join(root, 'install.js'), destination, '--verify'], '安装/加载验证');
  for (const [skill, example, output] of skills) {
    const entry = path.join(destination, skill, 'index.js');
    const loaded = require(entry);
    if (!loaded || typeof loaded !== 'object') throw new Error(`${skill} require 失败`);
    run([entry, path.join(destination, 'shared', 'examples', example), path.join(temporary, output)], `${skill} CLI`);
  }
  process.stdout.write(`PASS clean install: ${skills.length} modules required and ${skills.length} CLIs started\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
