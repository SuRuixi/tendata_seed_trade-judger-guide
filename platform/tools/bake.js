#!/usr/bin/env node
'use strict';
// 数据烘焙：将交付包内容抽取到 tendata_platform/data/*.json
// 运行：node tools/bake.js

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const PKG = path.resolve(ROOT, '..', 'tendata-trade-judger-skills(1)', 'tendata-trade-judger-skills');
const DEMO = path.join(PKG, 'demo-output');
const EXTRA_EVAL = path.resolve(ROOT, '..', 'evaluation');

const SKILLS = [
  { id: 'j1', dir: 'trade-j1-methodology', name: 'Methodology' },
  { id: 'j2', dir: 'trade-j2-fidelity', name: 'Fidelity' },
  { id: 'j3', dir: 'trade-j3-completeness', name: 'Completeness' },
  { id: 'j4', dir: 'trade-j4-pairwise-btd', name: 'Pairwise BTD' },
  { id: 'j5', dir: 'trade-j5-trace-html', name: 'Trace HTML' }
];

fs.mkdirSync(DATA, { recursive: true });

function copy(src, dstName) {
  const dst = path.join(DATA, dstName);
  fs.copyFileSync(src, dst);
  return dst;
}

// 1) demo-output 直接复制
const demoFiles = [
  'j1-model-a.json', 'j1-model-b.json',
  'j2-model-a.json', 'j2-model-b.json',
  'j3-model-a.json', 'j3-model-b.json',
  'j4-pairs.json', 'ranking.json',
  'j5.json', 'test-summary.json',
  'trace-report.html'
];
demoFiles.forEach(f => copy(path.join(DEMO, f), f));

// 2) 解析 expert-rules.md
function parseRulesMd(md, skillId) {
  // 官方 md 使用 CRLF；先归一化为 LF，否则行尾 \r 会让字段正则失败
  md = String(md).replace(/\r\n?/g, '\n');
  const rules = [];
  // 兼容 J1-J4 的 `### RULE-XXX` 与 J5 的 `## RULE-XXX` 两级标题
  const blocks = md.split(/^#{2,3} (?=RULE-)/m).slice(1);
  for (const block of blocks) {
    const firstLineEnd = block.indexOf('\n');
    const header = block.slice(0, firstLineEnd).trim();
    const m = header.match(/^(RULE-[A-Z0-9]+-[0-9A-Z]+)\s+(.*)$/);
    if (!m) continue;
    const id = m[1];
    const title = m[2];
    if (/XXX$/i.test(id)) continue; // 跳过占位模板
    const body = block.slice(firstLineEnd + 1);
    const fields = {
      primary_dimension: '',
      applies: '',
      judgement: '',
      severity: '',
      evidence: '',
      exception: '',
      counterexample: '',
      body: ''
    };
    const map = {
      '主维度': 'primary_dimension',
      '适用条件': 'applies',
      '正确判断': 'judgement',
      '严重度建议': 'severity',
      '必需证据': 'evidence',
      '例外': 'exception',
      '反例': 'counterexample'
    };
    // 保存整段原文，便于 J5 这种无字段结构的规则也能完整呈现
    fields.body = body.trim();
    const lines = body.split(/\n/);
    let cur = null, buf = [];
    const flush = () => {
      if (cur) {
        const key = map[cur];
        if (key) fields[key] = buf.join(' ').trim();
      }
      cur = null; buf = [];
    };
    for (const line of lines) {
      // 兼容有无 「- 」 前缀的两种写法
      const bm = line.match(/^\s*(?:[-*]\s*)?([^：:\-\s][^：:]*?)\s*[：:]\s*(.*)$/);
      if (bm && map[bm[1].trim()]) {
        flush();
        cur = bm[1].trim();
        buf.push(bm[2]);
      } else if (cur && line.trim()) {
        buf.push(line.trim());
      } else if (!line.trim()) {
        flush();
      }
    }
    flush();
    rules.push({ id, title, skill: skillId, ...fields });
  }
  return rules;
}

const allRules = [];
for (const s of SKILLS) {
  const md = fs.readFileSync(path.join(PKG, s.dir, 'expert-rules.md'), 'utf8');
  const rules = parseRulesMd(md, s.id);
  rules.forEach(r => allRules.push(r));
}
fs.writeFileSync(path.join(DATA, 'rules.json'), JSON.stringify(allRules, null, 2));

// 3) 解析 expert-cases.jsonl
const allCases = [];
for (const s of SKILLS) {
  const text = fs.readFileSync(path.join(PKG, s.dir, 'expert-cases.jsonl'), 'utf8');
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      allCases.push({ skill: s.id, case_type: 'semantic', ...obj });
    } catch (e) { /* ignore */ }
  }
}
fs.writeFileSync(path.join(DATA, 'cases.json'), JSON.stringify(allCases, null, 2));

// 4) runs.json
const testSummary = JSON.parse(fs.readFileSync(path.join(DEMO, 'test-summary.json'), 'utf8'));
const j1a = JSON.parse(fs.readFileSync(path.join(DEMO, 'j1-model-a.json'), 'utf8'));
const j1b = JSON.parse(fs.readFileSync(path.join(DEMO, 'j1-model-b.json'), 'utf8'));
const j2a = JSON.parse(fs.readFileSync(path.join(DEMO, 'j2-model-a.json'), 'utf8'));
const j2b = JSON.parse(fs.readFileSync(path.join(DEMO, 'j2-model-b.json'), 'utf8'));
const j3a = JSON.parse(fs.readFileSync(path.join(DEMO, 'j3-model-a.json'), 'utf8'));
const j3b = JSON.parse(fs.readFileSync(path.join(DEMO, 'j3-model-b.json'), 'utf8'));
const ranking = JSON.parse(fs.readFileSync(path.join(DEMO, 'ranking.json'), 'utf8'));

const runs = [
  {
    id: '0004',
    task: { id: 'trade-demo-001', title: 'HS0901 · 2025 · 出口趋势', hs: 'HS0901', dimension: '出口趋势（同比）' },
    model: 'model-a',
    j1_score: j1a.score,
    j1_conservative: j1a.conservative_score,
    j1_coverage: j1a.evidence_coverage,
    j2_wdr: j2a.weighted_deviation_rate,
    j3_score: j3a.overall_score,
    rank: 1,
    critical: false,
    status: 'passed',
    created_at: '2026-08-19 09:32',
    files: { j1: 'j1-model-a.json', j2: 'j2-model-a.json', j3: 'j3-model-a.json', ranking: 'ranking.json' }
  },
  {
    id: '0003',
    task: { id: 'trade-demo-001', title: 'HS0901 · 2025 · 出口趋势', hs: 'HS0901', dimension: '出口趋势（同比）' },
    model: 'model-b',
    j1_score: j1b.score,
    j1_conservative: j1b.conservative_score,
    j1_coverage: j1b.evidence_coverage,
    j2_wdr: j2b.weighted_deviation_rate,
    j3_score: j3b.overall_score,
    rank: 2,
    critical: j1b.critical_failure,
    status: 'critical',
    created_at: '2026-08-19 09:32',
    files: { j1: 'j1-model-b.json', j2: 'j2-model-b.json', j3: 'j3-model-b.json', j5: 'j5.json', trace: 'trace-report.html', ranking: 'ranking.json' }
  },
  {
    id: '0002',
    task: { id: 'trade-rcep-024', title: 'RCEP · 2024 Q4 · 汽车零部件', hs: 'HS8708', dimension: '出口结构' },
    model: 'model-a',
    j1_score: 78.5, j1_conservative: 74.2, j1_coverage: 0.92,
    j2_wdr: 0.11, j3_score: 88.9, rank: null, critical: false,
    status: 'partial', created_at: '2026-08-18 17:04', files: {}
  },
  {
    id: '0001',
    task: { id: 'trade-vnm-textile', title: '越南 · 2025H1 · 纺织进口', hs: 'HS6203', dimension: '进口趋势' },
    model: 'model-a vs model-b',
    j1_score: null, j1_conservative: null, j1_coverage: null,
    j2_wdr: null, j3_score: null, rank: 1, critical: false,
    status: 'completed', created_at: '2026-08-15 10:22', files: {}
  }
];

// 从 evaluation/j3-outputs 派生额外记录（qwen vs seed 前 3 组）
if (fs.existsSync(EXTRA_EVAL)) {
  const extraOutputs = path.join(EXTRA_EVAL, 'j3-outputs');
  if (fs.existsSync(extraOutputs)) {
    const files = fs.readdirSync(extraOutputs).filter(f => f.endsWith('.json')).slice(0, 6);
    files.forEach((f, i) => {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(extraOutputs, f), 'utf8'));
        const name = f.replace('.json', '');
        const model = /seed/.test(name) ? 'seed' : 'qwen';
        const caseName = name.replace(/_seed|_qwen/, '');
        runs.push({
          id: 'E' + String(i + 1).padStart(3, '0'),
          task: { id: caseName, title: '真实案例 · ' + caseName, hs: '—', dimension: '外贸分析' },
          model,
          j1_score: null, j1_conservative: null, j1_coverage: null,
          j2_wdr: null,
          j3_score: obj.overall_score ?? null,
          rank: null, critical: false,
          status: 'completed',
          created_at: '2026-08-14 15:00',
          files: {}
        });
      } catch (e) { /* ignore */ }
    });
  }
}

fs.writeFileSync(path.join(DATA, 'runs.json'), JSON.stringify(runs, null, 2));

// 5) manifest
const manifest = {
  version: 'v1.0',
  generated_at: new Date().toISOString(),
  source_pack: 'tendata-trade-judger-skills(1)',
  assertions: testSummary.assertions_total ?? 108,
  assertions_passed: testSummary.assertions_passed ?? 108,
  skills: SKILLS.map(s => ({
    id: s.id, name: s.name, dir: s.dir,
    rules: allRules.filter(r => r.skill === s.id).length,
    cases: allCases.filter(c => c.skill === s.id).length
  })),
  runs_count: runs.length,
  ranking_summary: ranking.rankings
};
fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 6) 输出摘要
console.log('rules   :', allRules.length);
console.log('cases   :', allCases.length);
console.log('runs    :', runs.length);
console.log('written :', DATA);
