// 规则浏览
(function () {
'use strict';
const h = App.h, C = App.C;

App.register('rules', async function ({ view, query }) {
  view.innerHTML = '';
  const [rules, cases] = await Promise.all([App.Store.get('rules'), App.Store.get('cases')]);
  const state = { skill: query.skill || 'all', q: query.q || '' };

  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '专家规则'),
      h('div', { class: 'sub' }, '共 ' + rules.length + ' 条业务判定真源。点击卡片展开条件、判断、证据与例外。')
    ),
    h('div', { class: 'status' }, C.tag('真源：expert-rules.md', 'info'))
  ));

  const skills = ['all', 'j1', 'j2', 'j3', 'j4', 'j5'];
  const pills = h('div', { class: 'pill-group' },
    skills.map(s => {
      const cnt = s === 'all' ? rules.length : rules.filter(r => r.skill === s).length;
      const label = s === 'all' ? '全部 · ' + cnt : s.toUpperCase() + ' · ' + cnt;
      return h('span', { class: 'pill ' + (s === 'all' ? '' : s) + (state.skill === s ? ' active' : ''), onClick: () => { state.skill = s; render(); } }, label);
    })
  );
  const searchInput = h('input', {
    placeholder: '按 ID / 标题 / 判断内容搜索',
    value: state.q,
    onInput: e => { state.q = e.target.value; render(); }
  });
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'body', style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' } },
    h('div', { class: 'field', style: { flex: '1', minWidth: '260px' } }, h('label', {}, '搜索'), searchInput),
    pills
  )));

  const list = h('div', { class: 'stack' });
  view.appendChild(list);

  function render() {
    list.innerHTML = '';
    const filtered = rules.filter(r =>
      (state.skill === 'all' || r.skill === state.skill) &&
      (!state.q || (r.id + r.title + (r.judgement || '') + (r.applies || '')).toLowerCase().includes(state.q.toLowerCase()))
    );
    if (!filtered.length) {
      list.appendChild(h('div', { class: 'muted small', style: { padding: '30px', textAlign: 'center' } }, '无匹配规则'));
      return;
    }
    filtered.forEach(r => list.appendChild(ruleCard(r, cases)));
  }
  render();
});

function ruleCard(r, cases) {
  const h = App.h;
  const related = cases.filter(c => c.rule_id === r.id);
  const body = h('div', { style: { display: 'none' } },
    h('dl', {},
      r.applies ? [h('dt', {}, '适用条件'), h('dd', {}, r.applies)] : null,
      r.judgement ? [h('dt', {}, '正确判断'), h('dd', {}, r.judgement)] : null,
      r.severity ? [h('dt', {}, '严重度'), h('dd', {}, r.severity)] : null,
      r.evidence ? [h('dt', {}, '必需证据'), h('dd', {}, r.evidence)] : null,
      r.exception ? [h('dt', {}, '例外'), h('dd', {}, r.exception)] : null,
      r.counterexample ? [h('dt', {}, '反例'), h('dd', {}, r.counterexample)] : null
    ),
    related.length ? h('div', { style: { marginTop: '10px' } },
      h('div', { class: 'muted small', style: { marginBottom: '6px' } }, '命中案例 ' + related.length + ' 条'),
      h('div', { class: 'pill-group' },
        related.slice(0, 12).map(c => h('span', { class: 'pill', style: { cursor: 'pointer' },
          onClick: () => App.modal.open('案例 · ' + c.case_id, App.C.jsonView(c)) }, c.case_id))
      )
    ) : null
  );
  const skillTag = App.C.tag(r.skill.toUpperCase(), r.skill);
  const head = h('div', { class: 'head', style: { cursor: 'pointer' }, onClick: () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; } },
    h('div', {},
      h('div', { class: 'id' }, r.id, r.primary_dimension ? ' · ' + r.primary_dimension : ''),
      h('h4', {}, r.title)
    ),
    h('div', { class: 'actions' }, skillTag, App.C.tag(related.length + ' 案例', ''))
  );
  return h('div', { class: 'rule' }, head, body);
}

})();
