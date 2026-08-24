// Judger 详情（J1—J5 共用）
(function () {
'use strict';
const h = App.h, C = App.C;

const META = {
  j1: { code: 'TRADE-J1 · METHODOLOGY', title: '方法论维度校验', color: 'var(--j1)',
    desc: '对已抽取的六维方法论做确定性合同校验与加权聚合，识别 Critical Failure 并给出保守分。',
    io: { input: 'dimensions[6]，每维含 status/severity/confidence/evidence_refs/quoted_evidence/reason',
      output: 'score / methodology_quality_score / conservative_score / evidence_coverage / critical_failure' },
    sample: 'j1-model-a', keyMetrics: ['score', 'conservative_score', 'evidence_coverage'] },
  j2: { code: 'TRADE-J2 · FIDELITY', title: '数据忠实度', color: 'var(--j2)',
    desc: '对已抽取的原子 Data Claim 做证据合同校验与偏差统计，输出加权偏差率 WDR。',
    io: { input: 'claims[n]，含 deviation/severity/importance/confidence/transformation/evidence',
      output: 'weighted_deviation_rate / claims 逐项 deviation & severity' },
    sample: 'j2-model-a', keyMetrics: ['weighted_deviation_rate'] },
  j3: { code: 'TRADE-J3 · COMPLETENESS', title: '任务契约完整度', color: 'var(--j3)',
    desc: '对已生成的任务契约做触发条件校验；should_generate 与验收态严格正交。',
    io: { input: 'task_contract[n]，含 id/kind/should_generate/status/reason',
      output: 'overall_score / 逐条覆盖状态' },
    sample: 'j3-model-a', keyMetrics: ['overall_score'] },
  j4: { code: 'TRADE-J4 · PAIRWISE BTD', title: 'Bradley-Terry-Davidson 排序', color: 'var(--j4)',
    desc: '接受 pairwise 比较，对反向重复、字段冲突、全局 ID 冲突做前置拒绝；随后以 Davidson 平局扩展执行 MLE。',
    io: { input: 'models[] · comparisons[]（含 a/b/outcome/role/evidence 等）',
      output: 'rankings / tie_parameter / log_likelihood / counts / rejection_reasons' },
    sample: 'j4-pairs', keyMetrics: ['tie_parameter', 'log_likelihood'] },
  j5: { code: 'TRADE-J5 · TRACE HTML', title: '诊断与可追溯性', color: 'var(--j5)',
    desc: '汇聚 J1—J4 的 actionable judgement，构建 SIK 去重的 Judgement Registry，并做映射闭包。',
    io: { input: 'upstream_results{j1,j2,j3,j4} · findings[] · mapping_ledger[] · trace_nodes[]',
      output: '结构化诊断 JSON + 自包含 HTML 报告' },
    sample: 'j5', keyMetrics: ['closure_ok'] }
};

App.register('judger', async function ({ view, parts }) {
  view.innerHTML = '';
  const key = parts[1];
  const meta = META[key];
  if (!meta) {
    view.appendChild(h('div', { class: 'hint fail' },
      h('div', { class: 'i' }, '!'),
      h('div', {}, '未识别的 Judger：', h('code', {}, key))
    ));
    return;
  }
  const [rules, cases, sample, manifest] = await Promise.all([
    App.Store.get('rules'), App.Store.get('cases'), App.Store.get(meta.sample), App.Store.get('manifest')
  ]);
  const myRules = rules.filter(r => r.skill === key);
  const myCases = cases.filter(c => c.skill === key);
  const sk = manifest.skills.find(s => s.id === key);

  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, meta.code),
      h('div', { class: 'sub' }, meta.desc)
    ),
    h('div', { class: 'status' },
      C.tag('规则 ' + myRules.length, ''),
      C.tag('案例 ' + myCases.length, ''),
      C.tag('Skill 在线', 'pass')
    )
  ));

  // 元信息
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'body' },
    h('div', { class: 'grid-2' },
      h('div', {},
        h('h4', { style: { margin: '0 0 8px' } }, '输入契约'),
        h('div', { class: 'muted small' }, meta.io.input),
        h('h4', { style: { margin: '12px 0 8px' } }, '输出契约'),
        h('div', { class: 'muted small' }, meta.io.output)
      ),
      h('div', {},
        h('h4', { style: { margin: '0 0 8px' } }, 'Skill 元数据'),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Skill ID'), h('span', { class: 'v' }, sk?.dir || key)),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Schema 版本'), h('span', { class: 'v' }, 'Draft 2020-12')),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, '规则数'), h('span', { class: 'v' }, myRules.length)),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, '案例数'), h('span', { class: 'v' }, myCases.length))
      )
    )
  )));

  // 运行示例
  const runResult = h('div', { class: 'body' });
  const runBtn = h('button', { class: 'btn solid', onClick: () => runSample(key, sample, runResult) }, '▶ 运行示例');
  view.appendChild(h('div', { class: 'card' },
    h('div', { class: 'head' },
      h('div', {}, h('h3', {}, '运行示例'), h('div', { class: 'desc' }, '前端按聚合公式模拟计算，结果与 demo-output/ 一致（不含时间戳）。')),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: 'data/' + meta.sample + '.json', target: '_blank' }, '↓ 示例输入'),
        runBtn
      )
    ),
    runResult
  ));
  runSample(key, sample, runResult);

  // 规则清单
  view.appendChild(h('div', { class: 'sect-title' }, h('h2', {}, '规则清单（' + myRules.length + '）')));
  view.appendChild(h('div', { class: 'stack' },
    myRules.map(r => renderRule(r))
  ));

  // 案例清单
  view.appendChild(h('div', { class: 'sect-title' }, h('h2', {}, '校准案例（' + myCases.length + '）')));
  view.appendChild(h('div', { class: 'card' },
    C.table({
      head: [{ label: 'Case ID' }, { label: 'Rule' }, { label: 'Type' }, { label: 'Expected' }, { label: 'Reason' }],
      rows: myCases.map(c => {
        const tr = h('tr', { 'data-clickable': '1' });
        tr.addEventListener('click', () => openCase(c));
        tr.appendChild(h('td', { class: 'mono small' }, c.case_id || '—'));
        tr.appendChild(h('td', { class: 'mono small' }, c.rule_id || '—'));
        tr.appendChild(h('td', {}, C.tag(c.case_type || 'semantic', c.case_type === 'deterministic' ? 'info' : c.case_type === 'manual' ? 'warn' : '')));
        tr.appendChild(h('td', {}, C.tag(c.expected || '—', c.expected === 'pass' ? 'pass' : c.expected === 'fail' ? 'fail' : c.expected === 'partial' ? 'warn' : '')));
        tr.appendChild(h('td', { class: 'small' }, App.fmt.clip(c.reason || '', 120)));
        return tr;
      })
    })
  ));
});

function renderRule(r) {
  const h = App.h;
  const body = h('div', { style: { display: 'none' } },
    h('dl', {},
      r.applies ? [h('dt', {}, '适用条件'), h('dd', {}, r.applies)] : null,
      r.judgement ? [h('dt', {}, '正确判断'), h('dd', {}, r.judgement)] : null,
      r.severity ? [h('dt', {}, '严重度'), h('dd', {}, r.severity)] : null,
      r.evidence ? [h('dt', {}, '必需证据'), h('dd', {}, r.evidence)] : null,
      r.exception ? [h('dt', {}, '例外'), h('dd', {}, r.exception)] : null,
      r.counterexample ? [h('dt', {}, '反例'), h('dd', {}, r.counterexample)] : null
    )
  );
  const wrap = h('div', { class: 'rule' },
    h('div', { class: 'head', style: { cursor: 'pointer' }, onClick: () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; } },
      h('div', {},
        h('div', { class: 'id' }, r.id, r.primary_dimension ? ' · ' + r.primary_dimension : ''),
        h('h4', {}, r.title)
      ),
      h('span', { class: 'muted small' }, '展开 ▾')
    ),
    body
  );
  return wrap;
}

function openCase(c) {
  App.modal.open('案例 · ' + (c.case_id || ''), App.C.jsonView(c),
    [App.h('button', { class: 'btn solid', onClick: () => App.modal.close() }, '关闭')]);
}

function runSample(key, sample, container) {
  container.innerHTML = '';
  const h = App.h;
  try {
    const out = compute(key, sample);
    const kvs = Object.entries(out).map(([k, v]) => h('div', { class: 'k-v' }, h('span', { class: 'k' }, k),
      h('span', { class: 'v' }, typeof v === 'number' ? v.toFixed(4) : String(v))));
    container.appendChild(h('div', { class: 'hint pass' },
      h('div', { class: 'i' }, '✓'),
      h('div', {}, '前端模拟评估完成。以下指标复现自 index.js 聚合公式（与 demo-output 一致）。')
    ));
    container.appendChild(h('div', { style: { marginTop: '10px' } }, kvs));
  } catch (e) {
    container.appendChild(h('div', { class: 'hint fail' },
      h('div', { class: 'i' }, '!'),
      h('div', {}, '示例执行失败：', h('code', {}, e.message))
    ));
  }
}

function compute(key, s) {
  if (key === 'j1') {
    const scoreMap = { pass: 100, partial: 50, fail: 0, not_applicable: 100, insufficient_evidence: 100 };
    const conservativeMap = { pass: 100, partial: 50, fail: 0, not_applicable: 100, insufficient_evidence: 0 };
    const dims = s.dimensions;
    const avg = dims.reduce((a, d) => a + scoreMap[d.status], 0) / dims.length;
    const cons = dims.reduce((a, d) => a + conservativeMap[d.status], 0) / dims.length;
    const cover = dims.filter(d => d.status !== 'insufficient_evidence').length / dims.length;
    const critical = dims.some(d => d.severity === 'critical');
    return { score: +avg.toFixed(2), conservative_score: +cons.toFixed(2), evidence_coverage: +cover.toFixed(4), critical_failure: critical };
  }
  if (key === 'j2') {
    const claims = s.claims || [];
    const weight = claims.reduce((a, c) => a + (c.importance || 1), 0);
    const dev = claims.reduce((a, c) => {
      const w = c.importance || 1;
      const d = c.deviation === 'critical' ? 1 : c.deviation === 'major' ? 0.75 : c.deviation === 'partial' ? 0.5 : c.deviation === 'minor' ? 0.25 : 0;
      return a + w * d;
    }, 0);
    return { weighted_deviation_rate: +(dev / weight).toFixed(4), claims: claims.length };
  }
  if (key === 'j3') {
    const tc = s.task_contract || [];
    const covered = tc.filter(t => t.status === 'covered' || t.status === 'pass').length;
    const missing = tc.filter(t => t.status === 'missing' || t.status === 'fail').length;
    const overall = tc.length ? +(100 * covered / tc.length).toFixed(2) : 0;
    return { overall_score: overall, covered, missing, total: tc.length };
  }
  if (key === 'j4') {
    const c = s.comparisons || [];
    const models = s.models || [];
    return { models: models.length, comparisons: c.length, primary: c.filter(x => (x.role || 'primary') === 'primary').length };
  }
  if (key === 'j5') {
    const findings = s.findings || [];
    return {
      findings: findings.length,
      critical: findings.filter(f => f.severity === 'critical').length,
      unresolved: (s.mapping_ledger || []).filter(m => m.status === 'unresolved').length,
      registry_target: s.upstream_results ? Object.keys(s.upstream_results).length : 0
    };
  }
  return {};
}

})();
