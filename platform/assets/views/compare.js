// 模型对比视图
(function () {
'use strict';
const h = App.h, C = App.C;

App.register('compare', async function ({ view }) {
  view.innerHTML = '';
  const [runs, j1a, j1b, j2a, j2b, j3a, j3b, ranking] = await Promise.all([
    App.Store.get('runs'),
    App.Store.get('j1-model-a'), App.Store.get('j1-model-b'),
    App.Store.get('j2-model-a'), App.Store.get('j2-model-b'),
    App.Store.get('j3-model-a'), App.Store.get('j3-model-b'),
    App.Store.get('ranking')
  ]);

  const state = { left: '0004', right: '0003' };

  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '模型对比'),
      h('div', { class: 'sub' }, '选择两次评测记录，逐层对齐 J1—J5 结论。')
    ),
    h('div', { class: 'status' },
      C.tag('Bradley-Terry-Davidson', 'info'),
      C.tag(ranking.status, 'pass')
    )
  ));

  const selector = h('div', { class: 'card' }, h('div', { class: 'body', style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
    h('div', { class: 'field', style: { flex: '1', minWidth: '200px' } },
      h('label', {}, '左侧模型'),
      selectRun(runs, state.left, v => { state.left = v; }, 'left')
    ),
    h('div', { style: { alignSelf: 'center', color: 'var(--mute)' } }, '↔'),
    h('div', { class: 'field', style: { flex: '1', minWidth: '200px' } },
      h('label', {}, '右侧模型'),
      selectRun(runs, state.right, v => { state.right = v; }, 'right')
    )
  ));
  view.appendChild(selector);

  const isDemoPair = /^(0003|0004)$/.test(state.left) && /^(0003|0004)$/.test(state.right);
  if (!isDemoPair) {
    view.appendChild(h('div', { class: 'hint warn' },
      h('div', { class: 'i' }, 'i'),
      h('div', {}, '目前仅演示记录 #0003 与 #0004 附带完整 J1—J5 产物。已默认选择演示对。')
    ));
    return;
  }

  const left = state.left === '0004' ? { j1: j1a, j2: j2a, j3: j3a, name: 'model-a' } : { j1: j1b, j2: j2b, j3: j3b, name: 'model-b' };
  const right = state.right === '0004' ? { j1: j1a, j2: j2a, j3: j3a, name: 'model-a' } : { j1: j1b, j2: j2b, j3: j3b, name: 'model-b' };

  // J1 双雷达
  const dimsA = left.j1.dimensions.map(d => ({ label: d.id.split('_')[0], value: score(d.status) }));
  const dimsB = right.j1.dimensions.map(d => ({ label: d.id.split('_')[0], value: score(d.status) }));
  const radar = C.radar(dimsA, {
    size: 320,
    series: [
      { values: dimsA, stroke: '#1f4b8f', fill: 'rgba(31,75,143,.20)' },
      { values: dimsB, stroke: '#a1231d', fill: 'rgba(161,35,29,.18)' }
    ]
  });
  const legend = h('div', { class: 'legend' },
    h('span', { class: 'lg' }, h('span', { class: 'sw', style: { background: '#1f4b8f' } }), left.name),
    h('span', { class: 'lg' }, h('span', { class: 'sw', style: { background: '#a1231d' } }), right.name)
  );

  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'head' }, h('h3', {}, 'J1 · 六维方法论叠加')),
    h('div', { class: 'body svg-box', style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, radar, legend)));

  // J2 WDR
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'head' }, h('h3', {}, 'J2 · 加权偏差率差异')),
    h('div', { class: 'body svg-box' }, C.barsChart([
      { label: left.name, value: left.j2.weighted_deviation_rate, color: '#1f4b8f', valueLabel: (left.j2.weighted_deviation_rate).toFixed(4) },
      { label: right.name, value: right.j2.weighted_deviation_rate, color: '#a1231d', valueLabel: (right.j2.weighted_deviation_rate).toFixed(4) }
    ], { height: 220 }))
  ));

  // J3 对齐
  const ids = new Set([...(left.j3.task_contract || []).map(t => t.id), ...(right.j3.task_contract || []).map(t => t.id)]);
  const j3rows = [...ids].map(id => {
    const lt = (left.j3.task_contract || []).find(t => t.id === id) || {};
    const rt = (right.j3.task_contract || []).find(t => t.id === id) || {};
    return h('tr', {},
      h('td', { class: 'mono small' }, id),
      h('td', {}, C.tag(lt.status || '—', statusCls(lt.status))),
      h('td', {}, C.tag(rt.status || '—', statusCls(rt.status))),
      h('td', { class: 'small' }, App.fmt.clip(lt.reason || rt.reason || '', 100))
    );
  });
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'head' }, h('h3', {}, 'J3 · 任务契约对齐')),
    C.table({ head: [{ label: 'Contract ID' }, { label: left.name }, { label: right.name }, { label: 'Reason' }], rows: j3rows })));

  // J4 排序
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'head' }, h('h3', {}, 'J4 · Bradley-Terry-Davidson 排序')),
    h('div', { class: 'body' },
      C.table({
        head: [{ label: 'Rank' }, { label: 'Model' }, { label: 'Strength', attrs: { class: 'num' } }, { label: 'Score', attrs: { class: 'num' } }],
        rows: ranking.rankings.map(r => h('tr', {},
          h('td', {}, C.tag('Rank ' + r.rank, r.rank === 1 ? 'pass' : 'fail')),
          h('td', {}, h('strong', {}, r.model_id)),
          h('td', { class: 'num' }, App.fmt.num(r.strength, 4)),
          h('td', { class: 'num' }, App.fmt.num(r.score))
        ))
      }),
      h('div', { class: 'muted small', style: { marginTop: '8px' } },
        'Tie 参数 η = ' + App.fmt.num(ranking.tie_parameter, 4) + ' · Log-likelihood = ' + App.fmt.num(ranking.log_likelihood, 4))
    )
  ));
});

function selectRun(runs, value, onChange, name) {
  const s = App.h('select', { name, onChange: e => onChange(e.target.value) });
  runs.forEach(r => {
    const opt = App.h('option', { value: r.id }, '#' + r.id + ' · ' + r.model + ' · ' + r.task.title);
    if (r.id === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}
function score(status) {
  return { pass: 100, partial: 60, fail: 15, not_applicable: 100, insufficient_evidence: 40 }[status] ?? 50;
}
function statusCls(s) {
  const m = { pass: 'pass', covered: 'pass', partial: 'warn', fail: 'fail', critical: 'fail', omitted: 'fail', insufficient_evidence: 'warn' };
  return m[s] || '';
}

})();
