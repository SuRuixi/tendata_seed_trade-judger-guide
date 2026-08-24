// 评测记录列表
(function () {
'use strict';
const h = App.h, C = App.C;

App.register('runs', async function ({ view, query }) {
  view.innerHTML = '';
  const runs = await App.Store.get('runs');
  const state = { model: query.model || 'all', status: query.status || 'all', q: query.q || '' };

  const filterBar = h('div', { class: 'card' },
    h('div', { class: 'body', style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
      h('div', { class: 'field', style: { flex: '1', minWidth: '200px' } },
        h('label', {}, '搜索'),
        h('input', { placeholder: '任务 ID / 模型 / 状态', value: state.q, onInput: e => { state.q = e.target.value; render(); } })
      ),
      h('div', { class: 'field' },
        h('label', {}, '模型'),
        selectField(['all', ...unique(runs.map(r => r.model))], state.model, v => { state.model = v; render(); })
      ),
      h('div', { class: 'field' },
        h('label', {}, '状态'),
        selectField(['all', 'passed', 'critical', 'partial', 'completed'], state.status, v => { state.status = v; render(); })
      ),
      h('div', { class: 'actions', style: { marginLeft: 'auto' } },
        h('button', { class: 'btn', onClick: exportCsv }, '↓ 导出 CSV'),
        h('a', { class: 'btn solid', href: '#/new-run' }, '＋ 新建评测')
      )
    )
  );

  const listCard = h('div', { class: 'card' });
  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '评测记录'),
      h('div', { class: 'sub' }, '全量评测任务列表 · 共 ' + runs.length + ' 条 · 点击行进入详情')
    )
  ));
  view.appendChild(filterBar);
  view.appendChild(listCard);

  function render() {
    const filtered = runs.filter(r => {
      if (state.model !== 'all' && r.model !== state.model) return false;
      if (state.status !== 'all' && r.status !== state.status) return false;
      if (state.q && !JSON.stringify(r).toLowerCase().includes(state.q.toLowerCase())) return false;
      return true;
    });
    listCard.innerHTML = '';
    listCard.appendChild(C.table({
      head: [
        { label: '#' }, { label: '任务' }, { label: '模型' },
        { label: 'J1', attrs: { class: 'num' } },
        { label: 'J2 WDR', attrs: { class: 'num' } },
        { label: 'J3', attrs: { class: 'num' } },
        { label: 'Rank' }, { label: '状态' }, { label: '创建时间' }, { label: '' }
      ],
      rows: filtered.map(makeRow),
      empty: '当前过滤条件下无记录'
    }));
  }
  render();

  function exportCsv() {
    const cols = ['id', 'task.id', 'task.title', 'model', 'j1_score', 'j2_wdr', 'j3_score', 'rank', 'status', 'created_at'];
    const rows = [cols.join(',')];
    runs.forEach(r => {
      rows.push(cols.map(c => {
        const parts = c.split('.'); let v = r;
        for (const p of parts) v = v == null ? '' : v[p];
        return JSON.stringify(v == null ? '' : v);
      }).join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'runs.csv'; a.click();
    URL.revokeObjectURL(url);
    App.toast('已导出 runs.csv');
  }
});

function selectField(options, value, onChange) {
  const s = h('select', { onChange: e => onChange(e.target.value) });
  options.forEach(o => {
    const opt = h('option', { value: o }, o === 'all' ? '全部' : o);
    if (o === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}
function unique(arr) { return [...new Set(arr)]; }

function makeRow(r) {
  const h = App.h;
  const tr = h('tr', { 'data-clickable': '1' });
  tr.addEventListener('click', () => location.hash = '#/runs/' + r.id);
  const statusMap = { passed: ['Passed', 'pass'], critical: ['Critical Fail', 'fail'], partial: ['Partial', 'warn'], completed: ['Completed', 'pass'] };
  const [sTxt, sCls] = statusMap[r.status] || [r.status, ''];
  tr.appendChild(h('td', { class: 'mono' }, '#' + r.id));
  tr.appendChild(h('td', {},
    h('div', { class: 'row-title' }, r.task.title),
    h('div', { class: 'row-sub mono' }, r.task.id)
  ));
  tr.appendChild(h('td', {}, h('strong', {}, r.model)));
  tr.appendChild(h('td', { class: 'num' }, r.j1_score == null ? '—' : App.fmt.num(r.j1_score)));
  tr.appendChild(h('td', { class: 'num' }, r.j2_wdr == null ? '—' : Number(r.j2_wdr).toFixed(3)));
  tr.appendChild(h('td', { class: 'num' }, r.j3_score == null ? '—' : App.fmt.num(r.j3_score)));
  tr.appendChild(h('td', {}, r.rank == null ? App.C.tag('—') : App.C.tag('Rank ' + r.rank, r.rank === 1 ? 'pass' : 'fail')));
  tr.appendChild(h('td', {}, App.C.tag(sTxt, sCls)));
  tr.appendChild(h('td', { class: 'muted small' }, r.created_at));
  tr.appendChild(h('td', {}, h('a', { href: '#/runs/' + r.id }, '查看 →')));
  return tr;
}

})();
