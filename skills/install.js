#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const skillNames = [
  'trade-j1-methodology',
  'trade-j2-fidelity',
  'trade-j3-completeness',
  'trade-j4-pairwise-btd',
  'trade-j5-trace-html'
];

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function install(destination) {
  const resolved = path.resolve(destination);
  copyDirectory(path.join(__dirname, 'shared'), path.join(resolved, 'shared'));
  process.stdout.write(`installed shared -> ${path.join(resolved, 'shared')}\n`);
  for (const skillName of skillNames) {
    const source = path.join(__dirname, skillName);
    const target = path.join(resolved, skillName);
    copyDirectory(source, target);
    process.stdout.write(`installed ${skillName} -> ${target}\n`);
  }
  return resolved;
}

function verify(destination) {
  for (const skillName of skillNames) {
    const entry = path.join(destination, skillName, 'index.js');
    const loaded = require(entry);
    if (!loaded || typeof loaded !== 'object') throw new Error(`${skillName} 无法加载`);
    process.stdout.write(`verified require ${skillName}\n`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const shouldVerify = args.includes('--verify');
  const positional = args.filter(arg => arg !== '--verify');
  if (positional.length > 1) throw new Error('用法：node install.js [skills-directory] [--verify]');
  const destination = positional[0]
    ? path.resolve(positional[0])
    : path.resolve(process.cwd(), '.trae', 'skills');
  install(destination);
  if (shouldVerify) verify(destination);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { copyDirectory, install, skillNames, verify };
