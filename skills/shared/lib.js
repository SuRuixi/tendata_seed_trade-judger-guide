'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  const error = new Error(message);
  error.name = 'InputError';
  throw error;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    fail(`无法读取 JSON：${file}；${error.message}`);
  }
}

function writeJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, 'utf8');
}

function requireObject(value, name = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} 必须是对象`);
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) fail(`${name} 必须是数组`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} 必须是非空字符串`);
  return value;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value)));
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseCli(argv) {
  if (!argv[2]) fail('用法：node index.js <input.json> [output]');
  return { input: path.resolve(argv[2]), output: argv[3] ? path.resolve(argv[3]) : null };
}

function runCli(main, defaultName = 'output.json') {
  try {
    const args = parseCli(process.argv);
    const result = main(readJson(args.input), args);
    const target = args.output || path.resolve(process.cwd(), defaultName);
    if (typeof result === 'string') writeText(target, result);
    else writeJson(target, result);
    process.stdout.write(`${target}\n`);
  } catch (error) {
    process.stderr.write(`${error.name || 'Error'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  clamp, escapeHtml, fail, parseCli, readJson, requireArray, requireObject,
  requireString, round, runCli, writeJson, writeText
};
