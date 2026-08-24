// 单个评测详情视图 · 7 tabs
(function () {
'use strict';
const h = App.h, C = App.C;

App.register('run-detail', async function ({ view, parts }) {
  view.innerHTML = '';
  const id = parts[1];
  const runs = await App.Store.get('runs');
  const run = runs.find(r => r.id === id);
  if (!run) {
    view.appendChild(h('div', { class: 'hint fail' },
      h('div', { class: 'i' }, '!'),
      h('div', {}, '未找到评测记录 #' + id, ' · ', h('a', { href: '#/runs' }, '返回列表'))
    ));
    return;
  }

  // Load related JSON (only for demo runs)
  const isDemo = /^(0003|0004)$/.test(id);
  const suffix = run.model === 'model-b' ? 'model-b' : 'model-a';
  const bundle = {};
  if (isDemo) {
    const [j1, j2, j3, ranking, j5] = await Promise.all([
      App.Store.get('j1-' + suffix), App.Store.get('j2-' + suffix),
      App.Store.get('j3-' + suffix), App.Store.get('ranking'), App.Store.get('j5')
    ]);
    bundle.j1 = j1; bundle.j2 = j2; bundle.j3 = j3; bundle.ranking = ranking; bundle.j5 = j5;
  }

  view.appendChild(renderHead(run));

  const tabs = ['overview', 'j1', 'j2', 'j3', 'j4', 'j5', 'raw'];
  const labels = { overview: '概览', j1: 'J1 · 方法论', j2: 'J2 · 忠实度', j3: 'J3 · 完整度', j4: 'J4 · 排序', j5: 'J5 · 追溯', raw: '原始 JSON' };
  let active = 'overview';
  const body = h('div', {});
  const tabsEl = C.tabs(tabs.map(k => ({ key: k, label: labels[k] })), active, k => { active = k; renderBody(); });

  const wrap = h('div', { class: 'card' }, h('div', { class: 'body' }, tabsEl, body));
  view.appendChild(wrap);

  function renderBody() {
    tabsEl.replaceWith(C.tabs(tabs.map(k => ({ key: k, label: labels[k] })), active, k => { active = k; renderBody(); }));
    body.innerHTML = '';
    if (!isDemo && active !== 'overview' && active !== 'raw') {
      body.appendChild(h('div', { class: 'hint warn' },
        h('div', { class: 'i' }, 'i'),
        h('div', {}, '本记录来源于外部批处理任务，未附带 J1—J5 详细产物。请查看「概览」或「原始 JSON」。')
      ));
      return;
    }
    switch (active) {
      case 'overview': return body.appendChild(renderOverview(run, bundle));
      case 'j1': return body.appendChild(renderJ1(bundle.j1));
      case 'j2': return body.appendChild(renderJ2(bundle.j2));
      case 'j3': return body.appendChild(renderJ3(bundle.j3));
      case 'j4': {
        const j4View = renderJ4(bundle.ranking);
        body.appendChild(j4View);
        // async matrix
        renderMatrix(bundle.ranking).then(mtx => {
          const placeholder = j4View.querySelector('[data-matrix-slot]');
          if (placeholder) placeholder.replaceWith(mtx);
        });
        return;
      }
      case 'j5': return body.appendChild(renderJ5(bundle.j5));
      case 'raw': return body.appendChild(renderRaw(bundle, run));
    }
  }
  renderBody();
});

function renderHead(run) {
  const statusMap = { passed: ['Passed', 'pass'], critical: ['Critical Fail', 'fail'], partial: ['Partial', 'warn'], completed: ['Completed', 'pass'] };
  const [sTxt, sCls] = statusMap[run.status] || [run.status, ''];
  return App.h('div', { class: 'page-head' },
    App.h('div', {},
      App.h('h1', {}, '#' + run.id + ' · ' + run.task.title),
      App.h('div', { class: 'sub' }, '任务 ', App.h('code', {}, run.task.id), ' · 模型 ', App.h('strong', {}, run.model), ' · ', run.created_at)
    ),
    App.h('div', { class: 'status' },
      App.C.tag(sTxt, sCls),
      run.rank != null ? App.C.tag('Rank ' + run.rank, run.rank === 1 ? 'pass' : 'fail') : null,
      run.critical ? App.C.tag('Critical', 'fail') : null,
      App.h('a', { class: 'btn', href: '#/runs' }, '← 全部记录'),
      App.h('a', { class: 'btn', onClick: () => window.print() }, '↧ 打印'),
      App.h('a', { class: 'btn solid', href: '#/compare' }, '⇄ 加入对比')
    )
  );
}

function renderOverview(run, b) {
  const h = App.h, C = App.C;
  const kpis = h('div', { class: 'grid-4' },
    C.kpi('J1 · Methodology', run.j1_score == null ? '—' : App.fmt.num(run.j1_score), '', run.j1_conservative != null ? { text: 'conservative ' + App.fmt.num(run.j1_conservative) } : null),
    C.kpi('J2 · Weighted Dev.', run.j2_wdr == null ? '—' : (run.j2_wdr).toFixed(3), '', { text: run.j2_wdr > 0.2 ? '偏差偏高' : '偏差可控' }),
    C.kpi('J3 · Completeness', run.j3_score == null ? '—' : App.fmt.num(run.j3_score), '', null),
    C.kpi('J4 · Rank', run.rank == null ? '—' : run.rank, '', null)
  );
  const meta = h('div', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'body' },
      h('div', { class: 'grid-2' },
        h('div', {},
          h('h4', { style: { margin: '0 0 8px' } }, '任务信息'),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '任务 ID'), h('span', { class: 'v' }, run.task.id)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '标题'), h('span', { class: 'v' }, run.task.title)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'HS 编码'), h('span', { class: 'v' }, run.task.hs)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '分析口径'), h('span', { class: 'v' }, run.task.dimension)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '创建时间'), h('span', { class: 'v' }, run.created_at))
        ),
        h('div', {},
          h('h4', { style: { margin: '0 0 8px' } }, '产物文件'),
          Object.entries(run.files || {}).length === 0
            ? h('div', { class: 'muted small' }, '无附带产物文件（外部记录）。')
            : Object.entries(run.files).map(([k, v]) =>
              h('div', { class: 'k-v' }, h('span', { class: 'k' }, k),
                h('a', { class: 'v', href: 'data/' + v, target: '_blank' }, v))
            )
        )
      )
    )
  );
  const wrap = h('div', {}, kpis, meta);
  if (b.j1) {
    const dims = b.j1.dimensions.map(d => ({
      label: d.id.split('_')[0], value: dimScore(d.status)
    }));
    wrap.appendChild(h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'head' }, h('h3', {}, 'J1 六维雷达')),
      h('div', { class: 'body svg-box', style: { display: 'flex', justifyContent: 'center' } }, C.radar(dims))
    ));
  }
  return wrap;
}

function dimScore(status) {
  return { pass: 100, partial: 60, fail: 15, not_applicable: 100, insufficient_evidence: 40 }[status] ?? 50;
}

function renderJ1(j1) {
  const h = App.h, C = App.C;
  const dims = j1.dimensions.map(d => ({ label: d.id.split('_')[0], value: dimScore(d.status) }));
  const table = C.table({
    head: [{ label: '维度' }, { label: '状态' }, { label: '严重度' }, { label: '置信' }, { label: '证据' }, { label: '判断说明' }],
    rows: j1.dimensions.map(d => h('tr', {},
      h('td', { class: 'mono' }, d.id),
      h('td', {}, C.tag(d.status, statusCls(d.status))),
      h('td', {}, C.tag(d.severity, severityCls(d.severity))),
      h('td', { class: 'num' }, App.fmt.num(d.confidence)),
      h('td', { class: 'mono small' }, (d.evidence_refs || []).join(', ') || '—'),
      h('td', { class: 'small' }, d.reason)
    ))
  });
  return h('div', {},
    h('div', { class: 'grid-2' },
      h('div', { class: 'card svg-box', style: { display: 'flex', justifyContent: 'center' } }, C.radar(dims)),
      h('div', { class: 'card' }, h('div', { class: 'body' },
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Score'), h('span', { class: 'v' }, App.fmt.num(j1.score))),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Methodology Quality'), h('span', { class: 'v' }, App.fmt.num(j1.methodology_quality_score))),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Conservative Score'), h('span', { class: 'v' }, App.fmt.num(j1.conservative_score))),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Evidence Coverage'), h('span', { class: 'v' }, App.fmt.pct(j1.evidence_coverage))),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Critical Failure'), h('span', { class: 'v' }, j1.critical_failure ? '是' : '否')),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Summary'), h('span', { class: 'v' }, 'pass ' + j1.summary.pass + ' · partial ' + j1.summary.partial + ' · fail ' + j1.summary.fail))
      ))
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } }, table)
  );
}

function renderJ2(j2) {
  const h = App.h, C = App.C;
  const bars = (j2.claims || []).map(c => ({
    label: c.id || c.dedupe_key || 'claim',
    value: c.deviation_weight != null ? c.deviation_weight : (c.deviation === 'critical' ? 1 : c.deviation === 'partial' ? 0.5 : 0),
    color: c.deviation === 'critical' ? '#a1231d' : c.deviation === 'partial' ? '#8a5a00' : '#166534',
    valueLabel: c.deviation
  }));
  const table = C.table({
    head: [{ label: 'Claim' }, { label: 'Deviation' }, { label: 'Severity' }, { label: 'Importance', attrs: { class: 'num' } }, { label: 'Confidence', attrs: { class: 'num' } }, { label: 'Reason' }],
    rows: (j2.claims || []).map(c => h('tr', {},
      h('td', { class: 'mono small' }, c.id || c.dedupe_key || '—'),
      h('td', {}, C.tag(c.deviation, statusCls(c.deviation))),
      h('td', {}, C.tag(c.severity, severityCls(c.severity))),
      h('td', { class: 'num' }, App.fmt.num(c.importance)),
      h('td', { class: 'num' }, App.fmt.num(c.confidence)),
      h('td', { class: 'small' }, App.fmt.clip(c.reason || '', 100))
    ))
  });
  return h('div', {},
    h('div', { class: 'card' }, h('div', { class: 'body' },
      h('div', { class: 'grid-2' },
        h('div', {},
          h('h4', { style: { margin: '0 0 8px' } }, '加权偏差率（WDR）'),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'WDR'), h('span', { class: 'v' }, (j2.weighted_deviation_rate || 0).toFixed(4))),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Claims 总数'), h('span', { class: 'v' }, (j2.claims || []).length)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Critical 数'), h('span', { class: 'v' }, (j2.claims || []).filter(c => c.severity === 'critical').length))
        ),
        h('div', { class: 'svg-box' }, C.barsChart(bars, { height: 200 }))
      )
    )),
    h('div', { class: 'card', style: { marginTop: '14px' } }, table)
  );
}

function renderJ3(j3) {
  const h = App.h, C = App.C;
  const tc = j3.task_contract || [];
  const covered = tc.filter(t => t.status === 'covered' || t.status === 'pass').length;
  const pct = tc.length ? covered / tc.length : 0;
  const table = C.table({
    head: [{ label: 'ID' }, { label: 'Kind' }, { label: 'Should' }, { label: 'Status' }, { label: 'Reason' }],
    rows: tc.map(t => h('tr', {},
      h('td', { class: 'mono small' }, t.id),
      h('td', {}, C.tag(t.kind || '—')),
      h('td', {}, t.should_generate === false ? '否' : '是'),
      h('td', {}, C.tag(t.status, statusCls(t.status))),
      h('td', { class: 'small' }, App.fmt.clip(t.reason || '', 120))
    ))
  });
  return h('div', {},
    h('div', { class: 'grid-2' },
      h('div', { class: 'card svg-box', style: { display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' } },
        C.donut(pct, '覆盖率', { color: pct >= 0.8 ? '#166534' : pct >= 0.6 ? '#8a5a00' : '#a1231d' }),
        h('div', { class: 'muted small', style: { marginTop: '8px' } }, covered + ' / ' + tc.length + ' 项已覆盖')
      ),
      h('div', { class: 'card' }, h('div', { class: 'body' },
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Overall Score'), h('span', { class: 'v' }, App.fmt.num(j3.overall_score))),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, '契约总数'), h('span', { class: 'v' }, tc.length)),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, '应生成'), h('span', { class: 'v' }, tc.filter(t => t.should_generate !== false).length)),
        h('div', { class: 'k-v' }, h('span', { class: 'k' }, '实际覆盖'), h('span', { class: 'v' }, covered))
      ))
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } }, table)
  );
}

function renderJ4(ranking) {
  const h = App.h, C = App.C;
  const rows = ranking.rankings.map(r => h('tr', {},
    h('td', {}, C.tag('Rank ' + r.rank, r.rank === 1 ? 'pass' : 'fail')),
    h('td', {}, h('strong', {}, r.model_id)),
    h('td', { class: 'num' }, App.fmt.num(r.strength, 4)),
    h('td', { class: 'num' }, App.fmt.num(r.score)),
    h('td', { class: 'num' }, r.comparisons)
  ));
  return h('div', {},
    h('div', { class: 'card' }, h('div', { class: 'body' },
      h('div', { class: 'grid-2' },
        h('div', {},
          h('h4', { style: { margin: '0 0 8px' } }, '排序结果'),
          C.table({ head: [{ label: '排名' }, { label: '模型' }, { label: 'Strength', attrs: { class: 'num' } }, { label: 'Score', attrs: { class: 'num' } }, { label: '对比数', attrs: { class: 'num' } }], rows })
        ),
        h('div', {},
          h('h4', { style: { margin: '0 0 8px' } }, 'BTD 参数'),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '方法'), h('span', { class: 'v' }, ranking.method)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '状态'), h('span', { class: 'v' }, ranking.status)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Tie 参数 η'), h('span', { class: 'v' }, App.fmt.num(ranking.tie_parameter, 4))),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Log-likelihood'), h('span', { class: 'v' }, App.fmt.num(ranking.log_likelihood, 4))),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, '提交 / 接受'), h('span', { class: 'v' }, ranking.counts.submitted + ' / ' + ranking.counts.accepted)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'BTD 有效票'), h('span', { class: 'v' }, ranking.counts.btd_votes)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Swap'), h('span', { class: 'v' }, ranking.counts.swap)),
          h('div', { class: 'k-v' }, h('span', { class: 'k' }, 'Rejected'), h('span', { class: 'v' }, ranking.counts.rejected))
        )
      )
    )),
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'body' },
      h('h4', { style: { margin: '0 0 8px' } }, 'Pairwise 邻接矩阵'),
      h('div', { 'data-matrix-slot': '1', class: 'muted small' }, '加载中...')
    ))
  );
}

async function renderMatrix(ranking) {
  const h = App.h;
  const pairs = await App.Store.get('j4-pairs');
  const models = pairs.models || ranking.rankings.map(r => r.model_id);
  const table = h('table', { class: 'mtx' });
  const head = h('tr', {}, h('th', {}, ''));
  models.forEach(m => head.appendChild(h('th', {}, m)));
  table.appendChild(head);
  models.forEach(row => {
    const tr = h('tr', {}, h('th', {}, row));
    models.forEach(col => {
      if (row === col) { tr.appendChild(h('td', { class: 'self' }, '—')); return; }
      const match = (pairs.comparisons || []).filter(c => c.a === row && c.b === col && (c.role || 'primary') === 'primary');
      if (!match.length) { tr.appendChild(h('td', {}, '·')); return; }
      const w = match.filter(m => m.outcome === 'A').length;
      const l = match.filter(m => m.outcome === 'B').length;
      const cls = w > l ? 'win' : (l > w ? 'lose' : '');
      tr.appendChild(h('td', { class: cls }, w + ' / ' + (w + l)));
    });
    table.appendChild(tr);
  });
  return table;
}

function renderJ5(j5) {
  const h = App.h, C = App.C;
  const findings = j5.findings || [];
  const table = C.table({
    head: [{ label: 'ID' }, { label: 'SIK' }, { label: '严重度' }, { label: '置信', attrs: { class: 'num' } }, { label: 'Owner' }, { label: '根因' }],
    rows: findings.map(f => h('tr', {},
      h('td', { class: 'mono small' }, f.id),
      h('td', { class: 'mono small' }, f.stable_issue_key),
      h('td', {}, C.tag(f.severity, severityCls(f.severity))),
      h('td', { class: 'num' }, App.fmt.num(f.confidence)),
      h('td', {}, f.owner || '—'),
      h('td', { class: 'small' }, App.fmt.clip(f.root_cause || '', 80))
    ))
  });
  return h('div', {},
    h('div', { class: 'grid-4' },
      C.kpi('Findings', findings.length),
      C.kpi('Critical', findings.filter(f => f.severity === 'critical').length),
      C.kpi('Unresolved', (j5.mapping_ledger || []).filter(m => m.status === 'unresolved').length),
      C.kpi('Registry', (j5.judgement_registry || []).length)
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'head' },
      h('div', {}, h('h3', {}, 'Findings')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onClick: openTrace }, '📄 打开 Trace HTML'),
        h('a', { class: 'btn', href: 'data/j5.json', target: '_blank' }, '↓ j5.json')
      )
    ), table)
  );

  function openTrace() {
    const iframe = h('iframe', { src: 'data/trace-report.html', style: { width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: '6px' } });
    App.modal.open('Trace HTML · trace-report.html', iframe,
      [h('a', { class: 'btn', href: 'data/trace-report.html', target: '_blank' }, '在新标签页打开'),
       h('button', { class: 'btn solid', onClick: () => App.modal.close() }, '关闭')]
    );
  }
}

function renderRaw(bundle, run) {
  const h = App.h;
  const parts = [];
  const files = Object.entries(bundle);
  if (!files.length) {
    parts.push(h('div', { class: 'hint warn' },
      h('div', { class: 'i' }, 'i'),
      h('div', {}, '本条记录未附带完整 JSON 产物。以下为记录元数据。')
    ));
    parts.push(App.C.jsonView(run));
    return h('div', {}, parts);
  }
  return h('div', { class: 'stack' },
    files.map(([k, v]) => h('div', { class: 'card' },
      h('div', { class: 'head' },
        h('h3', {}, k + '.json'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onClick: () => { navigator.clipboard.writeText(JSON.stringify(v, null, 2)); App.toast('已复制 ' + k); } }, '复制'),
          h('a', { class: 'btn', href: 'data/' + (k === 'ranking' ? 'ranking' : (k + (run ? '-' + (run.model === 'model-b' ? 'model-b' : 'model-a') : ''))) + '.json', target: '_blank' }, '下载')
        )
      ),
      h('div', { class: 'body' }, App.C.jsonView(v))
    ))
  );
}

function statusCls(s) {
  const m = { pass: 'pass', covered: 'pass', partial: 'warn', fail: 'fail', critical: 'fail', not_applicable: '', insufficient_evidence: 'warn', none: 'pass' };
  return m[s] || '';
}
function severityCls(s) {
  const m = { info: '', minor: '', major: 'warn', critical: 'fail' };
  return m[s] || '';
}

})();
