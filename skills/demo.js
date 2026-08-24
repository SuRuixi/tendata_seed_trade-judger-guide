#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { evaluate: j1 } = require('./trade-j1-methodology');
const { evaluate: j2 } = require('./trade-j2-fidelity');
const { evaluate: j3 } = require('./trade-j3-completeness');
const {
  evaluate: j4,
  davidsonLogProbability,
  davidsonObservationGradient
} = require('./trade-j4-pairwise-btd');
const { buildJudgementRegistry, diagnose, renderHtml } = require('./trade-j5-trace-html');
const { readJson, writeJson, writeText } = require('./shared/lib');

const root = __dirname;
const output = path.join(root, 'demo-output');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const assertions = [];
function test(name, condition, detail) {
  assertions.push({ name, passed: Boolean(condition), detail });
  if (!condition) throw new Error(`断言失败：${name}；${detail}`);
}

function validateSchemas() {
  const skills = [
    'trade-j1-methodology', 'trade-j2-fidelity', 'trade-j3-completeness',
    'trade-j4-pairwise-btd', 'trade-j5-trace-html'
  ];
  for (const skill of skills) {
    const dir = path.join(root, skill);
    for (const file of ['SKILL.md', 'prompt.md', 'schema.json', 'index.js']) {
      test(`${skill}/${file} 存在`, fs.existsSync(path.join(dir, file)), '完整 Skill 文件检查');
    }
    const schema = readJson(path.join(dir, 'schema.json'));
    test(`${skill} Schema 版本`, schema.$schema.includes('2020-12'), schema.$schema);
    test(`${skill} Schema 含输入输出`, Boolean(schema.$defs?.input && schema.$defs?.output), '检查 $defs');
  }
}

function run() {
  validateSchemas();
  const a = readJson(path.join(root, 'shared/examples/model-a.json'));
  const b = readJson(path.join(root, 'shared/examples/model-b.json'));

  const results = {
    a: { j1: j1(a.j1), j2: j2(a.j2), j3: j3(a.j3) },
    b: { j1: j1(b.j1), j2: j2(b.j2), j3: j3(b.j3) }
  };
  writeJson(path.join(output, 'j1-model-a.json'), results.a.j1);
  writeJson(path.join(output, 'j2-model-a.json'), results.a.j2);
  writeJson(path.join(output, 'j3-model-a.json'), results.a.j3);
  writeJson(path.join(output, 'j1-model-b.json'), results.b.j1);
  writeJson(path.join(output, 'j2-model-b.json'), results.b.j2);
  writeJson(path.join(output, 'j3-model-b.json'), results.b.j3);

  test('J1 识别 critical failure', results.b.j1.critical_failure, `score=${results.b.j1.score}`);
  test('J1 A 分数高于 B', results.a.j1.score > results.b.j1.score, `${results.a.j1.score} > ${results.b.j1.score}`);
  test('J1 固定六维各一次', results.a.j1.dimensions.length === 6 &&
    new Set(results.a.j1.dimensions.map(item => item.id)).size === 6,
    results.a.j1.dimensions.map(item => item.id).join(','));
  test('J1 score 兼容方法质量分', results.a.j1.score === 83.33 &&
    results.a.j1.methodology_quality_score === 83.33,
    `score=${results.a.j1.score}, quality=${results.a.j1.methodology_quality_score}`);
  test('J1 evidence coverage 精确', results.b.j1.evidence_coverage === 0.8333,
    `coverage=${results.b.j1.evidence_coverage}`);
  test('J1 保守分将证据不足按零计', results.b.j1.score === 10 && results.b.j1.conservative_score === 8.33,
    `quality=${results.b.j1.score}, conservative=${results.b.j1.conservative_score}`);
  test('J1 B 使用真实方法错误', results.b.j1.dimensions.find(item => item.id === 'calculation')
    .evidence_refs.includes('artifact:b:ranking'), '缺少排序方法证据');

  const j1Base = () => ({
    task_id: 'j1-unit', model_id: 'unit',
    dimensions: ['problem_definition', 'source_strategy', 'missing_data', 'transformation', 'calculation', 'validation']
      .map(id => ({ id, status: 'pass', severity: 'info', confidence: 1,
        evidence_refs: [`trace:unit:${id}`], quoted_evidence: `${id} 方法证据`, reason: '方法成立' }))
  });
  function rejectsJ1(name, mutate, expectedMessage) {
    const input = j1Base(); mutate(input); let message = '';
    try { j1(input); } catch (error) { message = error.message; }
    test(name, message.includes(expectedMessage), message || '未拒绝非法 J1 输入');
  }
  rejectsJ1('J1 拒绝缺维', input => input.dimensions.pop(), '固定六维');
  rejectsJ1('J1 拒绝重复维度', input => { input.dimensions[4].id = 'validation'; }, '重复维度');
  rejectsJ1('J1 拒绝输入 weight', input => { input.dimensions[0].weight = 100; }, 'weight 不允许输入');
  rejectsJ1('J1 拒绝非法状态严重度', input => { input.dimensions[0].severity = 'critical'; }, '组合非法');
  rejectsJ1('J1 拒绝 pass 空证据', input => { input.dimensions[0].quoted_evidence = ''; }, '非空 quoted_evidence');
  rejectsJ1('J1 拒绝 N/A 伪证据', input => {
    Object.assign(input.dimensions[4], { status: 'not_applicable', severity: 'info' });
  }, '不得伪造');
  const j1Boundary = j1Base();
  Object.assign(j1Boundary.dimensions[4], { status: 'not_applicable', severity: 'info',
    evidence_refs: [], quoted_evidence: '', reason: '单点事实任务无排序步骤' });
  Object.assign(j1Boundary.dimensions[5], { status: 'insufficient_evidence', severity: 'info',
    evidence_refs: [], quoted_evidence: '', reason: '验证过程不可观察' });
  const j1BoundaryResult = j1(j1Boundary);
  test('J1 N/A 与 insufficient 边界计分', j1BoundaryResult.score === 100 &&
    j1BoundaryResult.evidence_coverage === 0.8 && j1BoundaryResult.conservative_score === 80,
    JSON.stringify(j1BoundaryResult));
  test('J2 B 偏差率高于 A', results.b.j2.weighted_deviation_rate > results.a.j2.weighted_deviation_rate,
    `${results.b.j2.weighted_deviation_rate} > ${results.a.j2.weighted_deviation_rate}`);
  function rejectsJ2Confidence(name, value, omit = false) {
    const input = structuredClone(a.j2);
    if (omit) delete input.claims[0].confidence;
    else input.claims[0].confidence = value;
    let message = '';
    try {
      j2(input);
    } catch (error) {
      message = error.message;
    }
    test(name, message.includes('confidence 必须是 0 到 1 之间的有限数'), message || '未拒绝非法 J2 confidence');
  }
  rejectsJ2Confidence('J2 拒绝缺失 confidence', undefined, true);
  rejectsJ2Confidence('J2 拒绝字符串 confidence', '0.9');
  rejectsJ2Confidence('J2 拒绝负数 confidence', -0.01);
  rejectsJ2Confidence('J2 拒绝大于 1 的 confidence', 1.01);
  function rejectsJ2Importance(name, value) {
    const input = structuredClone(a.j2);
    input.claims[0].importance = value;
    let message = '';
    try {
      j2(input);
    } catch (error) {
      message = error.message;
    }
    test(name, message.includes('importance 必须是大于 0 的有限数'), message || '未拒绝非法 J2 importance');
  }
  rejectsJ2Importance('J2 拒绝字符串 importance', '2');
  rejectsJ2Importance('J2 拒绝 Infinity importance', Infinity);
  rejectsJ2Importance('J2 拒绝 NaN importance', NaN);
  rejectsJ2Importance('J2 拒绝零 importance', 0);
  rejectsJ2Importance('J2 拒绝负数 importance', -1);
  test('J3 A 完整度高于 B', results.a.j3.overall_score > results.b.j3.overall_score,
    `${results.a.j3.overall_score} > ${results.b.j3.overall_score}`);

  const pairwise = readJson(path.join(root, 'shared/examples/j4.json'));
  writeJson(path.join(output, 'j4-pairs.json'), pairwise);
  const ranking = j4(pairwise);
  writeJson(path.join(output, 'ranking.json'), ranking);
  const modelARanking = ranking.rankings.find(row => row.model_id === 'model-a');
  const primaryCount = pairwise.comparisons.filter(row => (row.role ?? 'primary') === 'primary').length;
  test('J4 uses Davidson BTD', ranking.method === 'Bradley-Terry-Davidson MLE', ranking.method);
  test('J4 status is genuinely ranked', ranking.status === 'ranked', ranking.status);
  test('J4 accepts all primary votes without rejection', ranking.counts.btd_votes === primaryCount && ranking.counts.rejected === 0,
    JSON.stringify(ranking.counts));
  test('J4 accepts swap without BTD vote', ranking.counts.swap === 1 && ranking.counts.accepted === primaryCount + 1,
    JSON.stringify(ranking.counts));
  test('J4 model-a has comparisons and ranks first', modelARanking.comparisons > 0 && ranking.rankings[0].model_id === 'model-a',
    JSON.stringify(ranking.rankings));

  const finiteDifference = (fn, value, epsilon = 1e-6) => (fn(value + epsilon) - fn(value - epsilon)) / (2 * epsilon);
  for (const outcome of ['A', 'B', 'Same']) {
    const betaI = 0.7, betaJ = -0.2, eta = 0.3;
    const analytic = davidsonObservationGradient(betaI, betaJ, eta, outcome);
    const numeric = {
      betaI: finiteDifference(value => davidsonLogProbability(value, betaJ, eta, outcome), betaI),
      betaJ: finiteDifference(value => davidsonLogProbability(betaI, value, eta, outcome), betaJ),
      eta: finiteDifference(value => davidsonLogProbability(betaI, betaJ, value, outcome), eta)
    };
    test(`J4 Davidson ${outcome} gradient matches likelihood`,
      ['betaI', 'betaJ', 'eta'].every(key => Math.abs(analytic[key] - numeric[key]) < 1e-7),
      JSON.stringify({ analytic, numeric }));
  }

  const j4Base = () => ({
    models: ['model-a', 'model-b'], iterations: 300,
    comparisons: [{ comparison_id: 'property-1:a:b', task_id: 'property-1', a: 'model-a', b: 'model-b', role: 'primary', outcome: 'A', confidence: 0.9,
      critical_gate: { result: 'clear', a_refs: [], b_refs: [] }, decisive_dimensions: ['required_coverage'],
      judgement_refs: ['j3:model-a:req-comparison-period', 'j3:model-b:req-comparison-period'], root_issue_keys: ['model-b:missing-comparison-period'],
      evidence: { a_refs: ['report:model-a:comparison-period'], b_refs: ['report:model-b:comparison-period-missing'] }, reason: 'model-a covers required comparison period' }]
  });
  const duplicateInput = j4Base(); duplicateInput.comparisons.push({ ...duplicateInput.comparisons[0], comparison_id: 'duplicate-id' });
  const duplicateResult = j4(duplicateInput);
  test('J4 duplicate primary counts once', duplicateResult.counts.deduplicated === 1 && duplicateResult.counts.btd_votes === 1,
    JSON.stringify(duplicateResult.counts));
  const globalIdConflictInput = j4Base();
  globalIdConflictInput.comparisons.push({
    ...structuredClone(globalIdConflictInput.comparisons[0]),
    task_id: 'property-2',
    outcome: 'B',
    reason: 'model-b wins another task with a conflicting global comparison id'
  });
  const globalIdForward = j4(globalIdConflictInput);
  const globalIdReverse = j4({ ...globalIdConflictInput, comparisons: [...globalIdConflictInput.comparisons].reverse() });
  test('J4 rejects every globally duplicated comparison_id',
    globalIdForward.counts.rejected === 2 && globalIdForward.counts.accepted === 0 &&
      globalIdForward.counts.btd_votes === 0 &&
      globalIdForward.rejection_reasons.every(item => item.reason.includes('comparison_id 全局冲突')),
    JSON.stringify(globalIdForward));
  test('J4 global comparison_id conflict ignores input order',
    JSON.stringify(globalIdForward.counts) === JSON.stringify(globalIdReverse.counts) &&
      JSON.stringify(globalIdForward.rankings) === JSON.stringify(globalIdReverse.rankings) &&
      JSON.stringify(globalIdForward.rejection_reasons) === JSON.stringify(globalIdReverse.rejection_reasons) &&
      globalIdForward.status === globalIdReverse.status,
    JSON.stringify({ forward: globalIdForward, reverse: globalIdReverse }));
  const conflictingDuplicate = j4Base();
  conflictingDuplicate.comparisons.push({
    ...structuredClone(conflictingDuplicate.comparisons[0]),
    comparison_id: 'conflicting-id',
    outcome: 'B'
  });
  const conflictForward = j4(conflictingDuplicate);
  const conflictReverse = j4({ ...conflictingDuplicate, comparisons: [...conflictingDuplicate.comparisons].reverse() });
  test('J4 rejects all conflicting same-direction duplicates',
    conflictForward.counts.rejected === 2 && conflictForward.counts.accepted === 0 &&
      conflictForward.counts.deduplicated === 0 && conflictForward.counts.btd_votes === 0 &&
      conflictForward.rejection_reasons.every(item => item.reason.includes('核心内容冲突')),
    JSON.stringify(conflictForward));
  test('J4 conflicting duplicate result ignores input order',
    JSON.stringify(conflictForward.counts) === JSON.stringify(conflictReverse.counts) &&
      JSON.stringify(conflictForward.rankings) === JSON.stringify(conflictReverse.rankings) &&
      conflictForward.status === conflictReverse.status,
    JSON.stringify({ forward: conflictForward, reverse: conflictReverse }));
  for (const [field, mutate] of [
    ['critical_gate', row => { row.critical_gate = { result: 'b_blocked', a_refs: [], b_refs: ['j2:model-b:b-c1'] }; }],
    ['decisive_dimensions', row => { row.decisive_dimensions = ['sourcing_fidelity']; }]
  ]) {
    const input = j4Base();
    const conflicting = structuredClone(input.comparisons[0]);
    conflicting.comparison_id = `conflicting-${field}`;
    mutate(conflicting);
    input.comparisons.push(conflicting);
    const result = j4(input);
    test(`J4 rejects same-direction ${field} conflict`,
      result.counts.rejected === 2 && result.counts.accepted === 0 && result.counts.btd_votes === 0,
      JSON.stringify(result));
  }
  const reverseInput = j4Base(); reverseInput.comparisons.push({ ...reverseInput.comparisons[0], comparison_id: 'reverse-id', a: 'model-b', b: 'model-a', outcome: 'B' });
  const reverseResult = j4(reverseInput);
  test('J4 rejects reverse primary duplicate', reverseResult.counts.rejected === 1 && reverseResult.counts.btd_votes === 1,
    JSON.stringify(reverseResult.counts));
  const illegalWeightInput = j4Base(); illegalWeightInput.comparisons[0].weight = Infinity;
  const illegalWeightResult = j4(illegalWeightInput);
  test('J4 rejects illegal weight before BTD', illegalWeightResult.counts.rejected === 1 && illegalWeightResult.counts.btd_votes === 0,
    JSON.stringify(illegalWeightResult));
  const swapInput = j4Base(); swapInput.comparisons.push({ ...swapInput.comparisons[0], comparison_id: 'property-1:b:a:swap', role: 'swap_check',
    swap_of: 'property-1:a:b', a: 'model-b', b: 'model-a', outcome: 'B',
    evidence: { a_refs: ['report:model-b:comparison-period-missing'], b_refs: ['report:model-a:comparison-period'] } });
  const swapResult = j4(swapInput);
  test('J4 accepts swap without BTD vote', swapResult.counts.swap === 1 && swapResult.counts.accepted === 2 && swapResult.counts.btd_votes === 1,
    JSON.stringify(swapResult.counts));
  const reversedOrder = j4({ ...pairwise, models: [...pairwise.models].reverse(), comparisons: [...pairwise.comparisons].reverse() });
  test('J4 input order is stable', JSON.stringify(reversedOrder.rankings) === JSON.stringify(ranking.rankings) && reversedOrder.status === ranking.status,
    JSON.stringify(reversedOrder.rankings));
  const allSameInput = () => [{ comparison_id: 'same-1:a:b', task_id: 'same-1',
    a: 'model-a', b: 'model-b', role: 'primary', outcome: 'Same', same_reason: 'equivalent', confidence: 0.8,
    critical_gate: { result: 'clear', a_refs: [], b_refs: [] }, decisive_dimensions: [],
    judgement_refs: ['j3:model-a:req-scale-result', 'j3:model-b:req-scale-result'], root_issue_keys: [],
    evidence: { a_refs: ['report:model-a:scale-result'], b_refs: ['report:model-b:scale-result'] }, reason: 'substantively equivalent' }];
  const allSame = j4({ models: ['model-a', 'model-b'], iterations: 300, comparisons: allSameInput() });
  test('J4 all-Same status is explicit', allSame.status === 'all_same' && allSame.rankings.every(row => row.score === 50 && row.rank === 1),
    JSON.stringify(allSame));
  const sameReasonConflictInput = { models: ['model-a', 'model-b'], iterations: 300, comparisons: allSameInput() };
  sameReasonConflictInput.comparisons.push({
    ...structuredClone(sameReasonConflictInput.comparisons[0]),
    comparison_id: 'same-1:a:b:conflict',
    same_reason: 'incomparable'
  });
  const sameReasonConflict = j4(sameReasonConflictInput);
  test('J4 rejects same-direction same_reason conflict',
    sameReasonConflict.counts.rejected === 2 && sameReasonConflict.counts.accepted === 0 &&
      sameReasonConflict.counts.btd_votes === 0, JSON.stringify(sameReasonConflict));
  const disconnectedSame = j4({ models: ['model-a', 'model-b', 'model-c'], iterations: 300, comparisons: allSameInput() });
  test('J4 disconnected precedes all-Same status', disconnectedSame.status === 'disconnected' &&
    disconnectedSame.rankings.find(row => row.model_id === 'model-c').comparisons === 0, JSON.stringify(disconnectedSame));

  const upstreamJ5 = structuredClone({ j1: results.b.j1, j2: results.b.j2, j3: results.b.j3, j4: ranking });
  upstreamJ5.j1.dimensions.forEach(x => { x.stable_issue_key = `j1:method:${x.id}`; });
  upstreamJ5.j2.claims.forEach(x => { x.stable_issue_key = `j2:fidelity:${x.dedupe_key || x.id}`; });
  upstreamJ5.j3.task_contract.forEach(x => { x.stable_issue_key = `j3:completeness:${x.id}`; });
  const matrix = { correct_evidence_available: 'yes', conflicting_evidence_present: 'no', model_used_correct_evidence: 'no', report_presented_faithfully: 'no' };
  const findings = [
    { id: 'finding:j2:b-c1', stable_issue_key: 'j2:fidelity:b-c1', title: 'currency conversion', severity: 'critical', confidence: 0.98, owner: 'mixed', judgement_refs: ['j2:b-c1'], evidence_refs: ['source:b:1', 'report:b:p1'], quoted_evidence: 'CNY reported as USD', root_cause_id: 'root:report-validation', root_cause: 'missing pre-write fact validation', remediation: 'validate currency and unit', matrix },
    { id: 'finding:j2:b-c2', stable_issue_key: 'j2:fidelity:b-c2', title: 'YoY formula', severity: 'critical', confidence: 0.99, owner: 'model', judgement_refs: ['j2:b-c2'], evidence_refs: ['source:b:1', 'artifact:b:calc'], quoted_evidence: '120/100=120%', root_cause_id: 'root:report-validation', root_cause: 'missing pre-write fact validation', remediation: 'recalculate formula', matrix }
  ];
  const registry = buildJudgementRegistry(upstreamJ5);
  const mappedFindings = new Map(findings.map(finding => [finding.stable_issue_key, finding.id]));
  const mapping_ledger = [...new Set(registry.map(x => x.stable_issue_key))].map(stable_issue_key =>
    mappedFindings.has(stable_issue_key)
      ? { stable_issue_key, status: 'mapped', finding_ids: [mappedFindings.get(stable_issue_key)] }
      : { stable_issue_key, status: 'unresolved', reason: 'unknown: trace is insufficient for a defensible root cause' });
  const j5Input = { task_id: b.task_id, model_id: b.model_id, upstream_results: upstreamJ5, findings, mapping_ledger, trace_nodes: b.trace_nodes, generated_at: '2026-08-07T08:00:00.000Z' };
  writeJson(path.join(root, 'shared/examples/j5.json'), j5Input);
  const report = diagnose(j5Input); writeJson(path.join(output, 'j5.json'), report);
  const html = renderHtml(report); writeText(path.join(output, 'trace-report.html'), html);
  test('J5 accepts direct standard J4 ranking', !Object.hasOwn(upstreamJ5.j4, 'conflicts') &&
    Array.isArray(report.upstream_results.j4.conflicts) && report.upstream_results.j4.conflicts.length === 0,
  JSON.stringify(report.upstream_results.j4));
  test('J5 mapping closure', report.integrity.closure_ok && report.mapping_ledger.length === new Set(report.judgement_registry.map(x => x.stable_issue_key)).size, JSON.stringify(report.integrity));
  test('J5 keeps method and fact issues separate', report.judgement_registry.find(x => x.judgement_ref === 'j1:transformation').stable_issue_key !== report.judgement_registry.find(x => x.judgement_ref === 'j2:b-c1').stable_issue_key &&
    report.judgement_registry.find(x => x.judgement_ref === 'j1:calculation').stable_issue_key !== report.judgement_registry.find(x => x.judgement_ref === 'j2:b-c2').stable_issue_key, JSON.stringify(report.judgement_registry));
  test('J5 shared root cause', report.root_causes.some(x => x.finding_ids.length === 2), JSON.stringify(report.root_causes));
  test('J5 unresolved explicit', report.unresolved.length > 0 && report.unresolved.every(x => x.reason.includes('unknown')), JSON.stringify(report.unresolved));
  test('J5 uses real J4 ranking without rejected issue', report.upstream_summary.j4.status === ranking.status &&
    JSON.stringify(report.upstream_summary.j4.rankings) === JSON.stringify(ranking.rankings) &&
    report.upstream_summary.j4.rejected_count === 0 && !report.judgement_registry.some(x => x.judgement_ref.startsWith('j4:rejected:')),
  JSON.stringify(report.upstream_summary.j4));
  function rejectsJ5(name, base, mutate, expectedMessage) {
    const candidate = structuredClone(base);
    mutate(candidate);
    let message = '';
    try { diagnose(candidate); } catch (error) { message = error.message; }
    test(name, message.includes(expectedMessage), message || 'invalid J5 input accepted');
  }
  rejectsJ5('J5 rejects empty or legacy upstream', j5Input,
    input => { input.upstream_results = { j1: {}, j2: {}, j3: {}, j4: {} }; },
    'upstream_results.j1.');
  rejectsJ5('J5 rejects legacy J4 method', j5Input,
    input => { input.upstream_results.j4.method = 'Elo'; },
    'method 必须为 Bradley-Terry-Davidson MLE');
  rejectsJ5('J5 rejects invalid J4 status', j5Input,
    input => { input.upstream_results.j4.status = 'complete'; },
    'j4.status 非法');
  rejectsJ5('J5 rejects legacy J1 dimension id', j5Input,
    input => { input.upstream_results.j1.dimensions[0].id = 'scope_definition'; },
    'legacy/非法 dimension id');
  rejectsJ5('J5 rejects stale J1 status', j5Input,
    input => { input.upstream_results.j1.dimensions[0].status = 'warning'; },
    '陈旧或非法状态');
  rejectsJ5('J5 rejects stale J2 deviation', j5Input,
    input => { input.upstream_results.j2.claims[0].deviation = 'accuracy_error'; },
    'deviation 为陈旧或非法状态');
  rejectsJ5('J5 rejects invalid J2 severity', j5Input,
    input => { input.upstream_results.j2.claims[0].severity = 'blocker'; },
    'severity 非法');
  rejectsJ5('J5 rejects missing J2 required field', j5Input,
    input => { delete input.upstream_results.j2.claims[0].transformation; },
    'transformation 必须是非空字符串');
  rejectsJ5('J5 rejects legacy J3 kind', j5Input,
    input => { input.upstream_results.j3.task_contract[0].kind = 'mandatory'; },
    'kind 为 legacy/非法类型');
  rejectsJ5('J5 rejects stale J3 status', j5Input,
    input => { input.upstream_results.j3.task_contract[0].status = 'omitted'; },
    'status 为陈旧或非法状态');
  rejectsJ5('J5 rejects unresolved without reason', j5Input,
    input => { delete input.mapping_ledger.find(x => x.status === 'unresolved').reason; },
    'unresolved 必须提供非空 reason');
  rejectsJ5('J5 rejects invalid finding target', j5Input,
    input => { input.mapping_ledger.find(x => x.status === 'mapped').finding_ids = ['finding:missing']; },
    'mapped 必须指向有效 finding');
  rejectsJ5('J5 rejects finding confidence outside range', j5Input,
    input => { input.findings[0].confidence = 1.1; },
    'confidence 必须在 0..1');
  rejectsJ5('J5 rejects finding without quoted evidence', j5Input,
    input => { input.findings[0].quoted_evidence = ''; },
    'quoted_evidence 必须是非空字符串');
  rejectsJ5('J5 rejects finding without refs', j5Input,
    input => { input.findings[0].evidence_refs = []; },
    'evidence_refs 不得为空');
  rejectsJ5('J5 rejects incomplete finding matrix', j5Input,
    input => { delete input.findings[0].matrix.report_presented_faithfully; },
    'matrix 必须且只能包含固定四键');
  const duplicateFixture = structuredClone(j5Input);
  Object.assign(duplicateFixture.upstream_results.j1.dimensions[3], {
    stable_issue_key: 'fixture:same-currency-error',
    quoted_evidence: '1.2 亿元人民币被写为 1.2 亿美元',
    reason: '币种转换事实错误，与 J2 b-c1 指向同一底层问题',
    evidence_refs: ['source:b:1', 'report:b:p1']
  });
  duplicateFixture.upstream_results.j2.claims[0].stable_issue_key = 'fixture:same-currency-error';
  duplicateFixture.findings = [
    { ...findings[0], id: 'fixture:finding:j1', stable_issue_key: 'fixture:same-currency-error', judgement_refs: ['j1:transformation'] },
    { ...findings[0], id: 'fixture:finding:j2', stable_issue_key: 'fixture:same-currency-error', judgement_refs: ['j2:b-c1'] }
  ];
  duplicateFixture.mapping_ledger = duplicateFixture.mapping_ledger
    .filter(x => !['j1:method:transformation', 'j2:fidelity:b-c1'].includes(x.stable_issue_key))
    .map(x => x.stable_issue_key === 'j2:fidelity:b-c2' ? { ...x, status: 'unresolved', finding_ids: [], reason: 'unknown: fixture only tests semantic duplicate merge' } : x);
  duplicateFixture.mapping_ledger.push({ stable_issue_key: 'fixture:same-currency-error', status: 'mapped', finding_ids: ['fixture:finding:j1'] });
  const duplicateReport = diagnose(duplicateFixture);
  const duplicateFinding = duplicateReport.findings.find(x => x.stable_issue_key === 'fixture:same-currency-error');
  test('J5 duplicate merge uses semantic fixture only', duplicateFinding.judgement_refs.includes('j1:transformation') &&
    duplicateFinding.judgement_refs.includes('j2:b-c1') && !report.judgement_registry.some(x => x.stable_issue_key === 'fixture:same-currency-error'),
  JSON.stringify(duplicateFinding));
  const conflictInput = structuredClone(j5Input);
  conflictInput.upstream_results.j4.conflicts = [{ id: 'conflict-1', stable_issue_key: 'issue:conflict', left_judgement_refs: ['j1:calculation'], right_judgement_refs: ['j2:b-c2'], summary: '<img src=x onerror=alert(1)>' }];
  conflictInput.mapping_ledger.push({ stable_issue_key: 'issue:conflict', status: 'conflict', conflict_ids: ['conflict-1'], reason: 'upstream conflict' });
  const conflictReport = diagnose(conflictInput, { generated_at: '2020-01-01T00:00:00.000Z' }); const hostile = renderHtml(conflictReport);
  rejectsJ5('J5 rejects conflict without target ids', conflictInput,
    input => { input.mapping_ledger.find(x => x.status === 'conflict').conflict_ids = []; },
    'conflict 必须指向非空 conflict_ids');
  test('J5 structured conflict', conflictReport.conflicts[0].left_judgement_refs[0] === 'j1:calculation', JSON.stringify(conflictReport.conflicts));
  test('J5 stable generated_at', conflictReport.generated_at === '2020-01-01T00:00:00.000Z', conflictReport.generated_at);
  test('J5 safe injection', hostile.includes('&lt;img src=x onerror=alert(1)&gt;') && !hostile.includes('<img src=x'), 'escaped');
  test('J5 no external or active content', !/<(?:script|link|iframe|object|embed|img)\b/i.test(hostile) &&
    !/<[^>]+\son[a-z]+\s*=/i.test(hostile) && !/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(hostile),
  String(Buffer.byteLength(hostile)));
  test('J5 HTML has all report sections', ['身份与完整性', 'J1—J4 摘要', 'Root causes', 'Findings', 'Unresolved',
    'Conflicts', 'Mapping ledger', 'Judgement registry', 'Trace'].every(title => html.includes(`>${title}<`)), 'section headings');
  test('J5 responsive long text', hostile.includes('overflow-wrap:anywhere') && hostile.includes('overflow-x:auto') && hostile.includes('@media(max-width:500px)') && hostile.includes('@media print'), 'CSS');
  const emptyInput = structuredClone(j5Input); emptyInput.upstream_results.j1.dimensions.forEach(x => { x.status = 'pass'; x.severity = 'info'; }); emptyInput.upstream_results.j2.claims.forEach(x => { x.deviation = 'none'; x.severity = 'info'; }); emptyInput.upstream_results.j3.task_contract.forEach(x => { x.status = 'covered'; }); emptyInput.upstream_results.j4.rejection_reasons = []; emptyInput.findings = []; emptyInput.mapping_ledger = [];
  const emptyHtml = renderHtml(diagnose(emptyInput));
  test('J5 empty states', ['未形成 finding。','无未解决项。','无冲突。','无 actionable judgement。'].every(x => emptyHtml.includes(x)), 'empty states');
  const summary = {
    generated_at: new Date().toISOString(),
    node: process.version,
    assertions_total: assertions.length,
    assertions_passed: assertions.filter(item => item.passed).length,
    assertions_failed: assertions.filter(item => !item.passed).length,
    metrics: {
      model_a: {
        j1_score: results.a.j1.score,
        j2_deviation_rate: results.a.j2.weighted_deviation_rate,
        j3_score: results.a.j3.overall_score
      },
      model_b: {
        j1_score: results.b.j1.score,
        j2_deviation_rate: results.b.j2.weighted_deviation_rate,
        j3_score: results.b.j3.overall_score
      },
      ranking: ranking.rankings
    },
    assertions
  };
  writeJson(path.join(output, 'test-summary.json'), summary);
  process.stdout.write(`PASS ${summary.assertions_passed}/${summary.assertions_total}\n`);
  process.stdout.write(`${path.join(output, 'trace-report.html')}\n`);
}

try {
  run();
} catch (error) {
  writeJson(path.join(output, 'test-summary.json'), {
    generated_at: new Date().toISOString(),
    assertions_total: assertions.length,
    assertions_passed: assertions.filter(item => item.passed).length,
    assertions_failed: assertions.filter(item => !item.passed).length + 1,
    error: error.message,
    assertions
  });
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
}
