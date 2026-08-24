#!/usr/bin/env node
'use strict';

const { clamp, requireArray, requireObject, requireString, round, runCli } = require('../shared/lib');

const OUTCOMES = new Set(['A', 'B', 'Same']);
const SAME_REASONS = new Set(['equivalent', 'incomparable', 'insufficient_evidence']);
const GATE_RESULTS = new Set(['clear', 'a_blocked', 'b_blocked', 'both_blocked', 'not_assessed']);
const ROLES = new Set(['primary', 'swap_check']);

function finiteRange(value, name, min, max, defaultValue) {
  const actual = value == null ? defaultValue : value;
  if (!Number.isFinite(actual) || actual < min || actual > max) throw new Error(`${name} 必须在 ${min}..${max}`);
  return actual;
}

function strings(value, name, nonEmpty = false) {
  const rows = requireArray(value, name);
  if (nonEmpty && !rows.length) throw new Error(`${name} 不得为空`);
  for (let i = 0; i < rows.length; i++) requireString(rows[i], `${name}[${i}]`);
  if (new Set(rows).size !== rows.length) throw new Error(`${name} 不得重复`);
  return rows;
}

function mirror(outcome) { return outcome === 'A' ? 'B' : outcome === 'B' ? 'A' : 'Same'; }
function pairKey(taskId, a, b) { return `${taskId}\u0000${[a, b].sort().join('\u0000')}`; }
function directedKey(taskId, a, b) { return `${taskId}\u0000${a}\u0000${b}`; }
function sorted(values) { return [...values].sort((a, b) => a.localeCompare(b)); }
function semanticSignature(row) {
  return JSON.stringify({
    outcome: row.outcome,
    same_reason: row.same_reason ?? null,
    confidence: row.confidence,
    weight: row.weight,
    critical_gate: {
      result: row.critical_gate.result,
      a_refs: sorted(row.critical_gate.a_refs),
      b_refs: sorted(row.critical_gate.b_refs)
    },
    decisive_dimensions: sorted(row.decisive_dimensions),
    judgement_refs: sorted(row.judgement_refs),
    root_issue_keys: sorted(row.root_issue_keys),
    evidence: {
      a_refs: sorted(row.evidence.a_refs),
      b_refs: sorted(row.evidence.b_refs)
    }
  });
}

function davidsonTerms(betaI, betaJ, eta) {
  const pi = Math.exp(betaI), pj = Math.exp(betaJ);
  const tie = Math.exp(eta) * Math.sqrt(pi * pj);
  return { pi, pj, tie, den: pi + pj + tie };
}

function davidsonLogProbability(betaI, betaJ, eta, outcome) {
  if (!OUTCOMES.has(outcome)) throw new Error(`非法 outcome：${outcome}`);
  const { pi, pj, tie, den } = davidsonTerms(betaI, betaJ, eta);
  const numerator = outcome === 'A' ? pi : outcome === 'B' ? pj : tie;
  return Math.log(numerator / den);
}

function davidsonObservationGradient(betaI, betaJ, eta, outcome) {
  if (!OUTCOMES.has(outcome)) throw new Error(`非法 outcome：${outcome}`);
  const { pi, pj, tie, den } = davidsonTerms(betaI, betaJ, eta);
  const targetI = outcome === 'A' ? 1 : outcome === 'Same' ? 0.5 : 0;
  const targetJ = outcome === 'B' ? 1 : outcome === 'Same' ? 0.5 : 0;
  const targetTie = outcome === 'Same' ? 1 : 0;
  return {
    betaI: targetI - (pi + 0.5 * tie) / den,
    betaJ: targetJ - (pj + 0.5 * tie) / den,
    eta: targetTie - tie / den
  };
}

function validateRow(row, i, index) {
  requireObject(row, `comparisons[${i}]`);
  const taskId = requireString(row.task_id, `comparisons[${i}].task_id`);
  const a = requireString(row.a, `comparisons[${i}].a`);
  const b = requireString(row.b, `comparisons[${i}].b`);
  if (!index.has(a) || !index.has(b) || a === b) throw new Error(`非法 pair：${a}/${b}`);
  if (!OUTCOMES.has(row.outcome)) throw new Error(`非法 outcome：${row.outcome}`);
  const role = row.role ?? 'primary';
  if (!ROLES.has(role)) throw new Error(`comparisons[${i}].role 非法`);
  const confidence = finiteRange(row.confidence, `comparisons[${i}].confidence`, 0.05, 1);
  const weight = finiteRange(row.weight, `comparisons[${i}].weight`, 0.1, 5, 1);
  requireString(row.reason, `comparisons[${i}].reason`);
  strings(row.decisive_dimensions, `comparisons[${i}].decisive_dimensions`);
  const judgementRefs = strings(row.judgement_refs, `comparisons[${i}].judgement_refs`, row.outcome !== 'Same');
  const rootKeys = strings(row.root_issue_keys, `comparisons[${i}].root_issue_keys`, row.outcome !== 'Same');
  const evidence = requireObject(row.evidence, `comparisons[${i}].evidence`);
  const aRefs = strings(evidence.a_refs, `comparisons[${i}].evidence.a_refs`, row.outcome !== 'Same');
  const bRefs = strings(evidence.b_refs, `comparisons[${i}].evidence.b_refs`, row.outcome !== 'Same');
  const gate = requireObject(row.critical_gate, `comparisons[${i}].critical_gate`);
  if (!GATE_RESULTS.has(gate.result)) throw new Error(`comparisons[${i}].critical_gate.result 非法`);
  const gateA = strings(gate.a_refs, `comparisons[${i}].critical_gate.a_refs`);
  const gateB = strings(gate.b_refs, `comparisons[${i}].critical_gate.b_refs`);
  if (gate.result === 'a_blocked' && (!gateA.length || gateB.length)) throw new Error('a_blocked 必须仅有 A 方 critical refs');
  if (gate.result === 'b_blocked' && (!gateB.length || gateA.length)) throw new Error('b_blocked 必须仅有 B 方 critical refs');
  if (gate.result === 'both_blocked' && (!gateA.length || !gateB.length)) throw new Error('both_blocked 必须双方都有 critical refs');
  if (gate.result === 'clear' && (gateA.length || gateB.length)) throw new Error('clear 不得携带 critical refs');
  if (gate.result === 'not_assessed' && (gateA.length || gateB.length)) throw new Error('not_assessed 不得携带 critical refs');
  if (gate.result === 'a_blocked' && row.outcome === 'A') throw new Error('单侧核心 critical 方 A 不得获胜');
  if (gate.result === 'b_blocked' && row.outcome === 'B') throw new Error('单侧核心 critical 方 B 不得获胜');
  if (row.outcome === 'Same') {
    if (!SAME_REASONS.has(row.same_reason)) throw new Error('Same 必须声明 equivalent/incomparable/insufficient_evidence');
  } else if (row.same_reason != null) throw new Error('非 Same 不得声明 same_reason');
  if (role === 'swap_check') requireString(row.swap_of, `comparisons[${i}].swap_of`);
  else if (row.swap_of != null) throw new Error('primary 不得声明 swap_of');
  return { ...row, task_id: taskId, a, b, role, confidence, weight, judgementRefs, rootKeys, aRefs, bRefs };
}

function evaluate(input) {
  requireObject(input);
  const suppliedModels = strings(input.models, 'models', true);
  if (suppliedModels.length < 2) throw new Error('models 至少含两个唯一模型');
  const models = [...suppliedModels].sort((a, b) => a.localeCompare(b));
  const index = new Map(models.map((model, i) => [model, i]));
  const comparisons = requireArray(input.comparisons, 'comparisons');
  if (!comparisons.length) throw new Error('comparisons 不得为空');
  const iterations = finiteRange(input.iterations, 'iterations', 100, 20000, 2500);
  if (!Number.isInteger(iterations)) throw new Error('iterations 必须是整数');
  const lr = finiteRange(input.learning_rate, 'learning_rate', 0.001, 0.2, 0.03);
  const threshold = finiteRange(input.group_threshold, 'group_threshold', 0, 50, 8);

  const counts = { submitted: comparisons.length, accepted: 0, deduplicated: 0, swap: 0, rejected: 0, btd_votes: 0 };
  const rejection_reasons = [];
  const primaryById = new Map();
  const rows = [];
  const pendingSwaps = [];
  const primaryGroups = new Map();
  const validated = [];

  comparisons.forEach((raw, i) => {
    let row;
    try { row = validateRow(raw, i, index); }
    catch (error) { counts.rejected++; rejection_reasons.push({ index: i, reason: error.message }); return; }
    validated.push({ row, i });
  });

  const globalIds = new Map();
  for (const item of validated) {
    if (item.row.comparison_id == null) continue;
    if (!globalIds.has(item.row.comparison_id)) globalIds.set(item.row.comparison_id, []);
    globalIds.get(item.row.comparison_id).push(item);
  }
  const blockedByGlobalId = new Set();
  for (const [comparisonId, items] of globalIds) {
    if (items.length < 2) continue;
    for (const { i } of items) {
      blockedByGlobalId.add(i);
      counts.rejected++;
      rejection_reasons.push({ index: i, reason: `comparison_id 全局冲突，整组拒绝：${comparisonId}` });
    }
  }

  for (const { row, i } of validated) {
    if (blockedByGlobalId.has(i)) continue;
    if (row.role === 'swap_check') { pendingSwaps.push({ row, i }); continue; }
    const key = pairKey(row.task_id, row.a, row.b);
    if (!primaryGroups.has(key)) primaryGroups.set(key, []);
    primaryGroups.get(key).push({ row, i });
  }

  for (const group of primaryGroups.values()) {
    const directions = new Map();
    for (const item of group) {
      const key = directedKey(item.row.task_id, item.row.a, item.row.b);
      if (!directions.has(key)) directions.set(key, []);
      directions.get(key).push(item);
    }
    const canonicalDirection = sorted(directions.keys())[0];
    for (const [direction, items] of directions) {
      if (direction === canonicalDirection) continue;
      for (const { i } of items) {
        counts.rejected++;
        rejection_reasons.push({ index: i, reason: '方向相反的 primary 副本被拒绝' });
      }
    }
    const candidates = directions.get(canonicalDirection);
    const signatures = new Set(candidates.map(({ row }) => semanticSignature(row)));
    if (signatures.size > 1) {
      for (const { i } of candidates) {
        counts.rejected++;
        rejection_reasons.push({ index: i, reason: '同向 primary 核心内容冲突，整组拒绝' });
      }
      continue;
    }
    candidates.sort((left, right) => {
      const leftId = left.row.comparison_id ?? directedKey(left.row.task_id, left.row.a, left.row.b);
      const rightId = right.row.comparison_id ?? directedKey(right.row.task_id, right.row.a, right.row.b);
      return leftId.localeCompare(rightId) || left.i - right.i;
    });
    const primary = candidates[0].row;
    primary.comparison_id ??= directedKey(primary.task_id, primary.a, primary.b);
    const aliases = candidates.map(({ row }) => row.comparison_id ?? primary.comparison_id);
    if (aliases.some(id => primaryById.has(id))) {
      for (const { i } of candidates) {
        counts.rejected++;
        rejection_reasons.push({ index: i, reason: 'comparison_id 重复' });
      }
      continue;
    }
    aliases.forEach(id => primaryById.set(id, primary));
    rows.push({ i: index.get(primary.a), j: index.get(primary.b), outcome: primary.outcome, weight: primary.weight * primary.confidence });
    counts.accepted++;
    counts.btd_votes++;
    counts.deduplicated += candidates.length - 1;
  }

  pendingSwaps.sort((left, right) => left.i - right.i);
  for (const { row, i } of pendingSwaps) {
    const primary = primaryById.get(row.swap_of);
    const valid = primary && row.task_id === primary.task_id && row.a === primary.b && row.b === primary.a &&
      row.outcome === mirror(primary.outcome) && row.same_reason === primary.same_reason;
    if (!valid) { counts.rejected++; rejection_reasons.push({ index: i, reason: 'swap_check 未与所引用 primary 对称' }); continue; }
    counts.accepted++; counts.swap++;
  }

  const n = models.length;
  const beta = Array(n).fill(0), m = Array(n + 1).fill(0), v = Array(n + 1).fill(0);
  let eta = 0;
  for (let step = 1; step <= iterations && rows.length; step++) {
    const gradient = Array(n + 1).fill(0);
    for (const row of rows) {
      const observation = davidsonObservationGradient(beta[row.i], beta[row.j], eta, row.outcome);
      gradient[row.i] += row.weight * observation.betaI;
      gradient[row.j] += row.weight * observation.betaJ;
      gradient[n] += row.weight * observation.eta;
    }
    for (let k = 0; k <= n; k++) {
      gradient[k] -= 0.001 * (k === n ? eta : beta[k]);
      m[k] = 0.9 * m[k] + 0.1 * gradient[k]; v[k] = 0.999 * v[k] + 0.001 * gradient[k] ** 2;
      const delta = lr * (m[k] / (1 - 0.9 ** step)) / (Math.sqrt(v[k] / (1 - 0.999 ** step)) + 1e-8);
      if (k === n) eta = clamp(eta + delta, -4, 4); else beta[k] = clamp(beta[k] + delta, -8, 8);
    }
    const mean = beta.reduce((sum, value) => sum + value, 0) / n;
    for (let k = 0; k < n; k++) beta[k] -= mean;
  }

  const degree = Array(n).fill(0), adjacency = Array.from({ length: n }, () => new Set());
  for (const row of rows) { degree[row.i]++; degree[row.j]++; adjacency[row.i].add(row.j); adjacency[row.j].add(row.i); }
  const seen = new Set(); if (rows.length) { const stack = [rows[0].i]; while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); stack.push(...adjacency[x]); } }
  const allSame = rows.length > 0 && rows.every(row => row.outcome === 'Same');
  const connected = seen.size === n;
  const status = !rows.length ? 'insufficient_comparisons' : !connected ? 'disconnected' : allSame ? 'all_same' : degree.some(x => x < 2) ? 'insufficient_comparisons' : 'ranked';
  const strengths = beta.map(Math.exp), min = Math.min(...strengths), max = Math.max(...strengths);
  const scores = strengths.map(value => max === min ? 50 : 100 * (value - min) / (max - min));
  const order = models.map((model, i) => ({ model_id: model, i })).sort((a, b) => scores[b.i] - scores[a.i] || a.model_id.localeCompare(b.model_id));
  let group = 1; const groups = [[]];
  const rankings = order.map((row, rank) => {
    if (rank > 0 && status === 'ranked' && scores[order[rank - 1].i] - scores[row.i] > threshold) { group++; groups.push([]); }
    groups[group - 1].push(row.model_id);
    return { model_id: row.model_id, rank: status === 'all_same' ? 1 : rank + 1, rank_group: group, strength: round(strengths[row.i]), score: round(scores[row.i], 2), comparisons: degree[row.i] };
  });
  const nu = Math.exp(eta);
  let logLikelihood = 0;
  for (const row of rows) {
    const pi = strengths[row.i], pj = strengths[row.j], tie = nu * Math.sqrt(pi * pj), den = pi + pj + tie;
    const p = row.outcome === 'A' ? pi / den : row.outcome === 'B' ? pj / den : tie / den;
    logLikelihood += row.weight * Math.log(Math.max(p, 1e-15));
  }
  return { method: 'Bradley-Terry-Davidson MLE', status, counts, rejection_reasons, tie_parameter: round(nu), log_likelihood: round(logLikelihood), rankings, rank_groups: groups };
}

if (require.main === module) runCli(evaluate, 'ranking.json');
module.exports = { evaluate, davidsonLogProbability, davidsonObservationGradient };
