#!/usr/bin/env node
'use strict';

const { requireArray, requireObject, requireString, round, runCli } = require('../shared/lib');

const DEVIATIONS = [
  'none', 'transcription', 'definition', 'time', 'unit_currency',
  'aggregation', 'calculation', 'source_quality', 'insufficient_evidence'
];
const SEVERITIES = new Set(['info', 'minor', 'major', 'critical']);
const SEVERITY_WEIGHT = { info: 0, minor: 1, major: 3, critical: 8 };
const MISSING_EVIDENCE_TYPES = new Set(['report', 'source', 'trace', 'artifact', 'transformation', 'query_context']);
const LEGAL_SEVERITIES = {
  none: new Set(['info']), insufficient_evidence: new Set(['minor', 'major']),
  source_quality: new Set(['minor', 'major', 'critical']), transcription: new Set(['minor', 'major', 'critical']),
  definition: new Set(['minor', 'major', 'critical']), time: new Set(['minor', 'major', 'critical']),
  unit_currency: new Set(['minor', 'major', 'critical']), aggregation: new Set(['minor', 'major', 'critical']),
  calculation: new Set(['minor', 'major', 'critical'])
};

function normalizedClaimKey(claim) {
  return String(claim.dedupe_key || claim.text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
function hasRef(refs, prefixes) { return refs.some(ref => prefixes.some(prefix => String(ref).startsWith(prefix))); }
function validateClaimGeneration(input, claims) {
  if (input.claim_generation == null) return;
  const generation = requireObject(input.claim_generation, 'claim_generation');
  const fields = ['candidate_count', 'atomic_count', 'deduplicated_count', 'load_bearing_claim_count', 'extracted_load_bearing_claim_count'];
  fields.forEach(field => { if (!Number.isInteger(generation[field]) || generation[field] < 0) throw new Error(`claim_generation.${field} 必须为非负整数`); });
  if (generation.atomic_count > generation.candidate_count) throw new Error('atomic_count 不得大于 candidate_count');
  if (generation.deduplicated_count > generation.atomic_count) throw new Error('deduplicated_count 不得大于 atomic_count');
  if (generation.deduplicated_count !== claims.length) throw new Error('deduplicated_count 必须等于 claims.length');
  if (generation.extracted_load_bearing_claim_count !== generation.load_bearing_claim_count) throw new Error('承重 Claim 不可漏抽');
}

function evaluate(input) {
  requireObject(input); requireString(input.task_id, 'task_id'); requireString(input.model_id, 'model_id');
  const claims = requireArray(input.claims, 'claims');
  if (!claims.length) throw new Error('claims 不得为空');
  validateClaimGeneration(input, claims);
  const ids = new Set(), claimKeys = new Set();
  const counts = Object.fromEntries(DEVIATIONS.map(key => [key, 0]));
  let deviationWeight = 0, totalPotentialWeight = 0, evaluableCount = 0, evidenceCompleteCount = 0, criticalFailure = false;
  claims.forEach((claim, index) => {
    requireObject(claim, `claims[${index}]`); requireString(claim.id, `claims[${index}].id`);
    requireString(claim.text, `${claim.id}.text`); requireString(claim.transformation, `${claim.id}.transformation`); requireString(claim.reason, `${claim.id}.reason`);
    if (claim.atomic === false) throw new Error(`${claim.id} 必须拆成原子 Claim`);
    if (ids.has(claim.id)) throw new Error(`重复 claim id：${claim.id}`);
    const claimKey = normalizedClaimKey(claim); if (claimKeys.has(claimKey)) throw new Error(`重复 Claim：${claim.id}`);
    if (!DEVIATIONS.includes(claim.deviation)) throw new Error(`非法偏差：${claim.deviation}`);
    if (!SEVERITIES.has(claim.severity)) throw new Error(`非法严重度：${claim.severity}`);
    if (!LEGAL_SEVERITIES[claim.deviation].has(claim.severity)) throw new Error(`${claim.id} 的 deviation=${claim.deviation} 与 severity=${claim.severity} 组合非法`);
    if (typeof claim.confidence !== 'number' || !Number.isFinite(claim.confidence) ||
      claim.confidence < 0 || claim.confidence > 1) {
      throw new Error(`${claim.id}.confidence 必须是 0 到 1 之间的有限数`);
    }
    const sourceRefs = requireArray(claim.source_refs, `${claim.id}.source_refs`);
    const evidenceRefs = requireArray(claim.evidence_refs, `${claim.id}.evidence_refs`);
    sourceRefs.forEach((ref, i) => requireString(ref, `${claim.id}.source_refs[${i}]`)); evidenceRefs.forEach((ref, i) => requireString(ref, `${claim.id}.evidence_refs[${i}]`));
    const importance = claim.importance === undefined ? 1 : claim.importance;
    if (typeof importance !== 'number' || !Number.isFinite(importance) || importance <= 0) {
      throw new Error(`${claim.id}.importance 必须是大于 0 的有限数`);
    }
    if (claim.deviation === 'insufficient_evidence') {
      const missing = requireArray(claim.missing_evidence_types, `${claim.id}.missing_evidence_types`);
      if (!missing.length) throw new Error(`${claim.id} 必须结构化说明 missing_evidence_types`);
      missing.forEach(type => { if (!MISSING_EVIDENCE_TYPES.has(type)) throw new Error(`${claim.id} 非法缺失证据类型：${type}`); });
    } else {
      if (!sourceRefs.length) throw new Error(`${claim.id} 的确定判断缺少 source_refs`);
      if (!String(claim.quoted_evidence || '').trim()) throw new Error(`${claim.id} 的确定判断缺少非空 quoted_evidence`);
      if (!hasRef(evidenceRefs, ['report:'])) throw new Error(`${claim.id} 的确定判断缺少报告 evidence_ref`);
      const hasSourceEvidence = sourceRefs.some(ref => evidenceRefs.includes(ref));
      const hasTransformationEvidence = hasRef(evidenceRefs, ['artifact:', 'trace:']);
      if (!hasSourceEvidence && !hasTransformationEvidence) throw new Error(`${claim.id} 的确定判断缺少来源或变换 evidence_ref`);
      evaluableCount++; evidenceCompleteCount++; totalPotentialWeight += importance * SEVERITY_WEIGHT.critical;
      if (claim.deviation !== 'none') deviationWeight += importance * SEVERITY_WEIGHT[claim.severity];
    }
    ids.add(claim.id); claimKeys.add(claimKey); counts[claim.deviation]++;
    criticalFailure ||= !['none', 'insufficient_evidence'].includes(claim.deviation) && claim.severity === 'critical';
  });
  const claimCount = claims.length;
  return { ...input, missing_inputs: input.missing_inputs || [], claim_count: claimCount, evaluable_count: evaluableCount,
    evidence_coverage: round(evidenceCompleteCount / claimCount), unverified_rate: round(counts.insufficient_evidence / claimCount),
    weighted_deviation_rate: evaluableCount ? round(deviationWeight / totalPotentialWeight) : null, critical_failure: criticalFailure, counts };
}
if (require.main === module) runCli(evaluate, 'j2.json');
module.exports = { evaluate };
