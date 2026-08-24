#!/usr/bin/env node
'use strict';

const { requireArray, requireObject, requireString, round, runCli } = require('../shared/lib');

const DIMENSION_WEIGHTS = Object.freeze({
  problem_definition: 1, source_strategy: 1, missing_data: 1,
  transformation: 1, calculation: 1, validation: 1
});
const IDS = Object.freeze(Object.keys(DIMENSION_WEIGHTS));
const ID_SET = new Set(IDS);
const STATUSES = new Set(['pass', 'partial', 'fail', 'not_applicable', 'insufficient_evidence']);
const SEVERITIES = new Set(['info', 'minor', 'major', 'critical']);
const LEGAL_SEVERITIES = Object.freeze({
  pass: new Set(['info']), partial: new Set(['minor', 'major']),
  fail: new Set(['minor', 'major', 'critical']), not_applicable: new Set(['info']),
  insufficient_evidence: new Set(['info'])
});
const VALUE = Object.freeze({ pass: 1, partial: 0.5, fail: 0 });

function evaluate(input) {
  requireObject(input);
  requireString(input.task_id, 'task_id');
  requireString(input.model_id, 'model_id');
  const dimensions = requireArray(input.dimensions, 'dimensions');
  if (dimensions.length !== IDS.length) throw new Error(`dimensions 必须且只能包含固定六维，当前 ${dimensions.length} 项`);

  const seen = new Set();
  const summary = Object.fromEntries([...STATUSES].map(status => [status, 0]));
  let qualityWeighted = 0, qualityDenominator = 0;
  let conservativeWeighted = 0, conservativeDenominator = 0;
  let evidenceCoveredWeight = 0, evidenceRequiredWeight = 0;
  let criticalFailure = false;

  for (const [index, item] of dimensions.entries()) {
    requireObject(item, `dimensions[${index}]`);
    if (!ID_SET.has(item.id)) throw new Error(`非法维度：${item.id}`);
    if (seen.has(item.id)) throw new Error(`重复维度：${item.id}`);
    if (Object.hasOwn(item, 'weight')) throw new Error(`${item.id}.weight 不允许输入；维度权重由执行器固定`);
    if (!STATUSES.has(item.status)) throw new Error(`非法状态：${item.status}`);
    if (!SEVERITIES.has(item.severity)) throw new Error(`非法严重度：${item.severity}`);
    if (!LEGAL_SEVERITIES[item.status].has(item.severity)) throw new Error(`${item.id} 的 status=${item.status} 与 severity=${item.severity} 组合非法`);
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error(`${item.id}.confidence 必须在 0..1`);
    const refs = requireArray(item.evidence_refs, `${item.id}.evidence_refs`);
    if (refs.some(ref => typeof ref !== 'string' || !ref.trim())) throw new Error(`${item.id}.evidence_refs 必须是非空字符串引用`);
    if (typeof item.quoted_evidence !== 'string') throw new Error(`${item.id}.quoted_evidence 必须是字符串`);
    requireString(item.reason, `${item.id}.reason`);
    if (Object.hasOwn(VALUE, item.status) && (refs.length === 0 || !item.quoted_evidence.trim())) throw new Error(`${item.id} 的 ${item.status} 判断必须有 evidence_refs 和非空 quoted_evidence`);
    if (item.status === 'not_applicable' && (refs.length || item.quoted_evidence.trim())) throw new Error(`${item.id} 为 not_applicable 时不得伪造 evidence_refs 或 quoted_evidence`);

    seen.add(item.id);
    summary[item.status]++;
    const weight = DIMENSION_WEIGHTS[item.id];
    if (Object.hasOwn(VALUE, item.status)) {
      qualityWeighted += VALUE[item.status] * weight;
      qualityDenominator += weight;
      conservativeWeighted += VALUE[item.status] * weight;
      conservativeDenominator += weight;
      evidenceCoveredWeight += weight;
      evidenceRequiredWeight += weight;
    } else if (item.status === 'insufficient_evidence') {
      conservativeDenominator += weight;
      evidenceRequiredWeight += weight;
    }
    criticalFailure ||= item.status === 'fail' && item.severity === 'critical';
  }

  const missing = IDS.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`缺少固定维度：${missing.join(', ')}`);
  const methodologyQualityScore = qualityDenominator ? round(qualityWeighted / qualityDenominator * 100, 2) : 0;
  const evidenceCoverage = evidenceRequiredWeight ? round(evidenceCoveredWeight / evidenceRequiredWeight, 4) : 1;
  const conservativeScore = conservativeDenominator ? round(conservativeWeighted / conservativeDenominator * 100, 2) : 0;

  return {
    ...input, missing_inputs: input.missing_inputs || [], score: methodologyQualityScore,
    methodology_quality_score: methodologyQualityScore, evidence_coverage: evidenceCoverage,
    conservative_score: conservativeScore, dimension_weights: { ...DIMENSION_WEIGHTS },
    critical_failure: criticalFailure, summary
  };
}

if (require.main === module) runCli(evaluate, 'j1.json');
module.exports = { evaluate, DIMENSION_WEIGHTS };
