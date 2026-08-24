#!/usr/bin/env node
'use strict';

const { requireArray, requireObject, requireString, round, runCli } = require('../shared/lib');

const KINDS = new Set(['required', 'conditional', 'optional']);
const STATUSES = new Set(['covered', 'partial', 'missing', 'not_triggered', 'insufficient_evidence']);
const VALUE = { covered: 1, partial: 0.5, missing: 0, insufficient_evidence: 0 };
const WEIGHT = { required: 3, conditional: 2 };
const REQUIREMENT_FIELDS = new Set([
  'id', 'text', 'kind', 'triggered', 'status', 'evidence_refs',
  'quoted_evidence', 'reason', 'trigger_evidence_refs'
]);

function ratio(items) {
  const judged = items.filter(item => Object.hasOwn(VALUE, item.status));
  return judged.length ? round(judged.reduce((sum, item) => sum + VALUE[item.status], 0) / judged.length) : null;
}

function evaluate(input) {
  requireObject(input);
  requireString(input.task_id, 'task_id');
  requireString(input.model_id, 'model_id');
  const contract = requireArray(input.task_contract, 'task_contract');
  if (!contract.length) throw new Error('task_contract 不得为空');
  const ids = new Set();

  contract.forEach((item, index) => {
    requireObject(item, `task_contract[${index}]`);
    requireString(item.id, `task_contract[${index}].id`);
    requireString(item.text, `${item.id}.text`);
    requireString(item.reason, `${item.id}.reason`);
    requireArray(item.evidence_refs, `${item.id}.evidence_refs`);
    item.evidence_refs.forEach((ref, refIndex) => requireString(ref, `${item.id}.evidence_refs[${refIndex}]`));
    if (item.trigger_evidence_refs !== undefined) {
      requireArray(item.trigger_evidence_refs, `${item.id}.trigger_evidence_refs`);
      item.trigger_evidence_refs.forEach((ref, refIndex) =>
        requireString(ref, `${item.id}.trigger_evidence_refs[${refIndex}]`));
    }
    const unknownFields = Object.keys(item).filter(field => !REQUIREMENT_FIELDS.has(field));
    if (unknownFields.length) throw new Error(`${item.id} has unsupported fields: ${unknownFields.join(', ')}`);
    if (ids.has(item.id)) throw new Error(`重复 requirement id：${item.id}`);
    if (!KINDS.has(item.kind) || !STATUSES.has(item.status)) throw new Error(`非法 requirement：${item.id}`);
    if (item.kind === 'conditional') {
      if (typeof item.triggered !== 'boolean') throw new Error(`${item.id}.triggered 必须为布尔值`);
      if (!item.triggered && item.status !== 'not_triggered') {
        throw new Error(`${item.id} 未触发时必须为 not_triggered`);
      }
      if (!item.triggered && Object.hasOwn(item, 'trigger_evidence_refs')) {
        throw new Error(`${item.id} untriggered conditional must not include trigger_evidence_refs`);
      }
      if (!item.triggered && item.evidence_refs.length) {
        throw new Error(`${item.id} untriggered conditional must not include coverage evidence_refs`);
      }
      if (item.triggered && item.status === 'not_triggered') {
        throw new Error(`${item.id} 已触发时不得为 not_triggered`);
      }
      if (item.triggered && (!item.trigger_evidence_refs || !item.trigger_evidence_refs.length)) {
        throw new Error(`${item.id} 已触发时必须提供非空 trigger_evidence_refs`);
      }
    } else {
      if (item.status === 'not_triggered') throw new Error(`${item.id} 非 conditional 不得为 not_triggered`);
      if (Object.hasOwn(item, 'triggered')) throw new Error(`${item.id} 非 conditional 不得携带 triggered`);
      if (Object.hasOwn(item, 'trigger_evidence_refs')) {
        throw new Error(`${item.id} 非 conditional 不得携带 trigger_evidence_refs`);
      }
    }
    if (['covered', 'partial'].includes(item.status) && !item.evidence_refs.length) {
      throw new Error(`${item.id} status ${item.status} requires final-delivery evidence_refs`);
    }
    ids.add(item.id);
  });

  const required = contract.filter(item => item.kind === 'required');
  const conditional = contract.filter(item => item.kind === 'conditional' && item.triggered);
  let numerator = 0;
  let denominator = 0;
  for (const item of contract) {
    if (item.kind === 'optional' || !Object.hasOwn(VALUE, item.status)) continue;
    const weight = WEIGHT[item.kind];
    numerator += VALUE[item.status] * weight;
    denominator += weight;
  }

  return {
    ...input,
    missing_inputs: input.missing_inputs || [],
    irrelevant_extensions: input.irrelevant_extensions || [],
    required_coverage: ratio(required) ?? 1,
    conditional_coverage: ratio(conditional),
    overall_score: denominator ? round(numerator / denominator * 100, 2) : 0,
    missing_required: required
      .filter(item => ['missing', 'insufficient_evidence'].includes(item.status))
      .map(item => item.id)
  };
}

if (require.main === module) runCli(evaluate, 'j3.json');
module.exports = { evaluate };
