// 案例浏览
(function () {
'use strict';
const h = App.h, C = App.C;

App.register('cases', async function ({ view, query }) {
  view.innerHTML = '';
  const [cases, rules] = await Promise.all([App.Store.get('cases'), App.Store.get('rules')]);
  const state = { skill: query.skill || 'all', type: query.type || 'all', q: query.q || '' };

  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '校准案例'),
      h('div', { class: 'sub' }, '共 ' + cases.length + ' 条规则边界与校准案例（semantic / deterministic / manual）。')
    )
  ));

  const skillPills = h('div', { class: 'pill-group' },
    ['all', 'j1', 'j2', 'j3', 'j4', 'j5'].map(s => {
      const cnt = s === 'all' ? cases.length : cases.filter(c => c.skill === s).length;
      return h('span', { class: 'pill ' + (s === 'all' ? '' : s) + (state.skill === s ? ' active' : ''),
        onClick: () => { state.skill = s; render(); } }, (s === 'all' ? '全部' : s.toUpperCase()) + ' · ' + cnt);
    })
  );
  const typePills = h('div', { class: 'pill-group' },
    ['all', 'semantic', 'deterministic', 'manual'].map(t => {
      const cnt = t === 'all' ? cases.length : cases.filter(c => (c.case_type || 'semantic') === t).length;
      return h('span', { class: 'pill' + (state.type === t ? ' active' : ''),
        onClick: () => { state.type = t; render(); } }, (t === 'all' ? '全部类型' : t) + ' · ' + cnt);
    })
  );
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'body', style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' } },
    h('div', { class: 'field', style: { flex: '1', minWidth: '260px' } },
      h('label', {}, '搜索'),
      h('input', { placeholder: '按 case_id / rule_id / summary 搜索', value: state.q, onInput: e => { state.q = e.target.value; render(); } })
    ),
    skillPills, typePills
  )));

  const listCard = h('div', { class: 'card' });
  view.appendChild(listCard);

  function render() {
    const filtered = cases.filter(c =>
      (state.skill === 'all' || c.skill === state.skill) &&
      (state.type === 'all' || (c.case_type || 'semantic') === state.type) &&
      (!state.q || JSON.stringify(c).toLowerCase().includes(state.q.toLowerCase()))
    );
    listCard.innerHTML = '';
    listCard.appendChild(C.table({
      head: [{ label: 'Case ID' }, { label: 'Skill' }, { label: 'Rule' }, { label: 'Type' }, { label: 'Expected' }, { label: 'Summary' }],
      rows: filtered.map(c => {
        const tr = h('tr', { 'data-clickable': '1' });
        tr.addEventListener('click', () => openCase(c, rules));
        tr.appendChild(h('td', { class: 'mono small' }, c.case_id || '—'));
        tr.appendChild(h('td', {}, C.tag(c.skill.toUpperCase(), c.skill)));
        tr.appendChild(h('td', { class: 'mono small' }, c.rule_id || '—'));
        tr.appendChild(h('td', {}, C.tag(c.case_type || 'semantic', c.case_type === 'deterministic' ? 'info' : c.case_type === 'manual' ? 'warn' : '')));
        tr.appendChild(h('td', {}, C.tag(c.expected || '—', c.expected === 'pass' ? 'pass' : c.expected === 'fail' ? 'fail' : c.expected === 'partial' ? 'warn' : '')));
        tr.appendChild(h('td', { class: 'small' }, App.fmt.clip(c.input_summary || c.reason || '', 120)));
        return tr;
      }),
      empty: '无匹配案例'
    }));
  }
  render();
});

function openCase(c, rules) {
  const h = App.h;
  const r = rules.find(x => x.id === c.rule_id);
  const body = h('div', { class: 'stack' },
    r ? h('div', { class: 'hint' },
      h('div', { class: 'i' }, 'i'),
      h('div', {}, '关联规则 ',
        h('a', { href: '#/rules?skill=' + r.skill + '&q=' + encodeURIComponent(r.id), onClick: () => App.modal.close() }, r.id + ' · ' + r.title)
      )
    ) : null,
    App.C.jsonView(c)
  );
  App.modal.open('案例 · ' + (c.case_id || ''), body,
    [h('button', { class: 'btn solid', onClick: () => App.modal.close() }, '关闭')]);
}

})();
