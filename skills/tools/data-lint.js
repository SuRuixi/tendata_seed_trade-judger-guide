#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const skills = [
  'trade-j1-methodology',
  'trade-j2-fidelity',
  'trade-j3-completeness',
  'trade-j4-pairwise-btd',
  'trade-j5-trace-html'
];
const caseTypes = new Set(['semantic', 'deterministic', 'manual']);
const severities = new Set(['info', 'minor', 'major', 'critical']);
const enumContracts = {
  'trade-j1-methodology': {
    '$defs.dimension.properties.status.enum': ['pass', 'partial', 'fail', 'not_applicable', 'insufficient_evidence']
  },
  'trade-j2-fidelity': {
    '$defs.claim.properties.deviation.enum': ['none', 'transcription', 'definition', 'time', 'unit_currency', 'aggregation', 'calculation', 'source_quality', 'insufficient_evidence']
  },
  'trade-j3-completeness': {
    '$defs.requirement.properties.kind.enum': ['required', 'conditional', 'optional'],
    '$defs.requirement.properties.status.enum': ['covered', 'partial', 'missing', 'not_triggered', 'insufficient_evidence']
  },
  'trade-j4-pairwise-btd': {
    '$defs.comparison.properties.role.enum': ['primary', 'swap_check'],
    '$defs.comparison.properties.outcome.enum': ['A', 'B', 'Same'],
    '$defs.comparison.properties.same_reason.enum': ['equivalent', 'incomparable', 'insufficient_evidence'],
    '$defs.comparison.properties.critical_gate.properties.result.enum': ['clear', 'a_blocked', 'b_blocked', 'both_blocked', 'not_assessed'],
    '$defs.output.properties.status.enum': ['ranked', 'all_same', 'disconnected', 'insufficient_comparisons']
  },
  'trade-j5-trace-html': {
    '$defs.mapping.properties.status.enum': ['mapped', 'unresolved', 'conflict', 'excluded'],
    '$defs.finding.properties.severity.enum': ['info', 'minor', 'major', 'critical'],
    '$defs.finding.properties.owner.enum': ['model', 'source', 'tool', 'system_prompt', 'skill', 'mixed', 'unknown'],
    '$defs.finding.properties.matrix.properties.correct_evidence_available.enum': ['yes', 'no', 'unknown'],
    '$defs.finding.properties.matrix.properties.conflicting_evidence_present.enum': ['yes', 'no', 'unknown'],
    '$defs.finding.properties.matrix.properties.model_used_correct_evidence.enum': ['yes', 'no', 'unknown'],
    '$defs.finding.properties.matrix.properties.report_presented_faithfully.enum': ['yes', 'no', 'unknown']
  }
};

const stats = { schemas: 0, schemaEnums: 0, json: 0, cases: 0, semantic: 0, deterministic: 0, manual: 0, deterministicRun: 0 };
const errors = [];
const caseIds = new Set();

function error(message) { errors.push(message); }
function parseJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    stats.json++;
    return value;
  } catch (cause) {
    error(`${path.relative(root, file)}: JSON 解析失败：${cause.message}`);
    return null;
  }
}
function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function subset(actual, expected, location) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return error(`${location}: expected_output 对应结果不是对象`);
    for (const [key, value] of Object.entries(expected)) subset(actual[key], value, `${location}.${key}`);
  } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    error(`${location}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}
function ruleIds(file) {
  const text = fs.readFileSync(file, 'utf8');
  return new Set([...text.matchAll(/^#{2,3}\s+(RULE-[A-Z0-9-]+)\b/gm)]
    .map(match => match[1]).filter(id => !id.endsWith('-XXX')));
}
function valueAtPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current && current[key], value);
}
function validateSchema(file, skill) {
  const schema = parseJson(file);
  if (!schema) return null;
  stats.schemas++;
  for (const field of ['$schema', '$id', 'title']) if (!nonEmpty(schema[field])) error(`${path.relative(root, file)}: 缺少元信息 ${field}`);
  if (!String(schema.$schema || '').includes('2020-12')) error(`${path.relative(root, file)}: $schema 不是 Draft 2020-12 标识`);
  if (!schema.$defs || !schema.$defs.input || !schema.$defs.output) error(`${path.relative(root, file)}: 缺少 $defs.input/output`);
  for (const [dottedPath, expected] of Object.entries(enumContracts[skill] || {})) {
    const actual = valueAtPath(schema, dottedPath);
    stats.schemaEnums++;
    if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
      error(`${path.relative(root, file)}: ${dottedPath} 应为 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
  }
  return schema;
}
function validateJsonDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) validateJsonDirectory(file);
    else if (entry.name.endsWith('.json')) parseJson(file);
  }
}
function validateExamples() {
  const directory = path.join(root, 'shared', 'examples');
  validateJsonDirectory(directory);
  validateJsonDirectory(path.join(root, 'demo-output'));
  for (const required of ['j1.json', 'j2.json', 'j3.json', 'j4.json', 'j5.json', 'model-a.json', 'model-b.json']) {
    if (!fs.existsSync(path.join(directory, required))) error(`shared/examples/${required}: 文件缺失`);
  }
}
function validateCases(skill, schema) {
  const directory = path.join(root, skill);
  const rules = ruleIds(path.join(directory, 'expert-rules.md'));
  const covered = new Set();
  const contractEnums = Object.fromEntries(Object.keys(enumContracts[skill] || {})
    .map(dottedPath => [dottedPath, new Set(valueAtPath(schema, dottedPath) || [])]));
  const lines = fs.readFileSync(path.join(directory, 'expert-cases.jsonl'), 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const location = `${skill}/expert-cases.jsonl:${index + 1}`;
    let row;
    try { row = JSON.parse(line); } catch (cause) { return error(`${location}: JSONL 解析失败：${cause.message}`); }
    stats.cases++;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return error(`${location}: 每行必须是 JSON 对象`);
    for (const field of ['case_id', 'rule_id', 'reason']) if (!nonEmpty(row[field])) error(`${location}: ${field} 必须是非空字符串`);
    if (nonEmpty(row.case_id)) {
      if (caseIds.has(row.case_id)) error(`${location}: case_id 重复：${row.case_id}`);
      caseIds.add(row.case_id);
    }
    if (!rules.has(row.rule_id)) error(`${location}: rule_id 不存在：${row.rule_id}`); else covered.add(row.rule_id);
    if (!Object.keys(row).some(key => key === 'expected' || key.startsWith('expected_'))) error(`${location}: 缺少 expected 或 expected_*`);
    if (row.severity !== undefined && !severities.has(row.severity)) error(`${location}: severity 枚举非法：${row.severity}`);
    const type = row.case_type || 'semantic';
    if (!caseTypes.has(type)) error(`${location}: case_type 枚举非法：${type}`); else stats[type]++;
    if (skill === 'trade-j1-methodology' && row.expected !== undefined
      && !contractEnums['$defs.dimension.properties.status.enum'].has(row.expected)) {
      error(`${location}: expected/status 枚举非法：${row.expected}`);
    }
    if (skill === 'trade-j2-fidelity' && row.expected !== undefined
      && !contractEnums['$defs.claim.properties.deviation.enum'].has(row.expected)) {
      error(`${location}: expected/deviation 枚举非法：${row.expected}`);
    }
    if (skill === 'trade-j3-completeness') {
      const statusEnum = contractEnums['$defs.requirement.properties.status.enum'];
      const kindEnum = contractEnums['$defs.requirement.properties.kind.enum'];
      if (row.expected_kind !== undefined && !kindEnum.has(row.expected_kind)) error(`${location}: expected_kind 枚举非法：${row.expected_kind}`);
      if (row.expected !== undefined) {
        if (row.should_generate === false && row.expected !== 'not_generated') error(`${location}: should_generate=false 时 expected 必须为 not_generated`);
        if (row.should_generate !== false && !statusEnum.has(row.expected)) error(`${location}: expected/status 枚举非法：${row.expected}`);
      }
    }
    if (skill === 'trade-j4-pairwise-btd') {
      const outcomeEnum = contractEnums['$defs.comparison.properties.outcome.enum'];
      const sameReasonEnum = contractEnums['$defs.comparison.properties.same_reason.enum'];
      const gateEnum = contractEnums['$defs.comparison.properties.critical_gate.properties.result.enum'];
      if (row.expected !== undefined && row.expected !== 'rejected' && !outcomeEnum.has(row.expected)) error(`${location}: expected/outcome 枚举非法：${row.expected}`);
      if (row.submitted !== undefined && !outcomeEnum.has(row.submitted)) error(`${location}: submitted/outcome 枚举非法：${row.submitted}`);
      if (row.same_reason !== undefined && !sameReasonEnum.has(row.same_reason)) error(`${location}: same_reason 枚举非法：${row.same_reason}`);
      if (row.critical_gate?.result !== undefined && !gateEnum.has(row.critical_gate.result)) error(`${location}: critical_gate.result 枚举非法：${row.critical_gate.result}`);
    }
    if (skill === 'trade-j5-trace-html') {
      const ownerEnum = contractEnums['$defs.finding.properties.owner.enum'];
      const mappingStatusEnum = contractEnums['$defs.mapping.properties.status.enum'];
      if (row.expected_owner !== undefined && !ownerEnum.has(row.expected_owner)) error(`${location}: expected_owner 枚举非法：${row.expected_owner}`);
      if (row.expected_mapping_status !== undefined && !mappingStatusEnum.has(row.expected_mapping_status)) error(`${location}: expected_mapping_status 枚举非法：${row.expected_mapping_status}`);
    }
    if (type === 'deterministic' && row.input !== undefined) {
      try {
        const entry = require(path.join(directory, 'index.js'));
        if (typeof entry.evaluate !== 'function') throw new Error('模块未导出 evaluate');
        const result = entry.evaluate(row.input);
        stats.deterministicRun++;
        if (row.expected_output !== undefined) subset(result, row.expected_output, `${location}.expected_output`);
      } catch (cause) { error(`${location}: 确定性案例执行失败：${cause.message}`); }
    }
  });
  for (const rule of rules) if (!covered.has(rule)) error(`${skill}/expert-rules.md: ${rule} 没有案例覆盖`);
}

for (const skill of skills) {
  const directory = path.join(root, skill);
  for (const required of ['SKILL.md', 'prompt.md', 'expert-rules.md', 'expert-cases.jsonl', 'schema.json', 'index.js']) {
    if (!fs.existsSync(path.join(directory, required))) error(`${skill}/${required}: 文件缺失`);
  }
  const schema = validateSchema(path.join(directory, 'schema.json'), skill);
  if (schema) validateCases(skill, schema);
}
validateExamples();

if (errors.length) {
  errors.forEach(message => process.stderr.write(`ERROR ${message}\n`));
  process.stderr.write(`FAIL ${errors.length} error(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS data lint: ${stats.cases} cases (${stats.semantic} semantic, ${stats.deterministic} deterministic, ${stats.manual} manual), ${stats.deterministicRun} deterministic run(s), ${stats.schemas} schemas, ${stats.schemaEnums} schema enum contracts, ${stats.json} JSON files\n`);
  process.stdout.write('NOTE schema checks cover JSON syntax and required metadata only; they are not full Draft schema validation.\n');
}
