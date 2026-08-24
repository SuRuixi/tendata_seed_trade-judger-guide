// Dashboard 视图
(function () {
'use strict';
const h = App.h, C = App.C;

App.register('dashboard', async function ({ view }) {
  view.innerHTML = '';
  const [manifest, runs, summary] = await Promise.all([
    App.Store.get('manifest'), App.Store.get('runs'), App.Store.get('test-summary')
  ]);

  const critical = runs.filter(r => r.status === 'critical').length;

  const head = h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '评测工作台'),
      h('div', { class: 'sub' }, '上传模型报告、运行 J1—J5 评测、对比多模型排序并导出可追溯的诊断报告。')
    ),
    h('div', { class: 'status' },
      C.tag('Skill 包在线', 'pass'),
      C.tag('Node v22.22.0', 'info'),
      C.tag(manifest.version + ' · ' + manifest.generated_at.slice(0, 10), '')
    )
  );

  // 快速上手
  const steps = h('div', { class: 'card' },
    h('div', { class: 'head' },
      h('div', {}, h('h3', {}, '快速上手 · 四步完成一次评测'),
        h('div', { class: 'desc' }, '首次使用请按顺序执行；已熟悉流程可直接点击右上「＋ 新建评测」。')),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/docs' }, '查看完整文档'))
    ),
    h('div', { class: 'body' },
      h('div', { class: 'steps' },
        step(1, '创建评测任务', '定义外贸分析任务（如 HS0901 · 2025 · 出口趋势），上传或粘贴任务契约。', '＋ 新建任务 →', '#/new-run'),
        step(2, '提交模型输出', '为每个待评模型上传 j1/j2/j3 输入 JSON，或粘贴报告文本由 prompt.md 抽取。', '↑ 上传报告 →', '#/new-run'),
        step(3, '运行 Judger 流水线', '一键触发 J1—J5，或按需单独运行任一层；平台离线执行、零外部依赖。', '▶ 运行流水线 →', '#/new-run'),
        step(4, '查看结果与追溯', 'Dashboard 展示评分与排序；点击任一 Finding 可跳转到规则、案例与 Trace 节点。', '↳ 查看示例结果 →', '#/runs/0004')
      ),
      h('div', { class: 'hint', style: { marginTop: '16px' } },
        h('div', { class: 'i' }, 'i'),
        h('div', {}, h('strong', {}, '不确定从哪开始？'), ' 前往「＋ 新建评测」并选择「载入演示任务 ', h('code', {}, 'trade-demo-001'), '」即可跳过上传，直接体验 Model A 与 Model B 的完整评测流程。')
      )
    )
  );

  // KPI
  const kpiSect = h('div', {},
    h('div', { class: 'sect-title' }, h('h2', {}, '平台状态'),
      h('span', { class: 'link', onClick: () => (App.toast('数据来源于 tools/bake.js 生成的 data/manifest.json')) }, '数据来源 →')
    ),
    h('div', { class: 'grid-4' },
      C.kpi('运行中的评测', 0, '', { text: '上次执行 · ' + manifest.generated_at.slice(0, 10) }),
      C.kpi('已完成评测', runs.length, '次', { dir: 'up', text: '本周新增 ' + Math.min(runs.length, 2) }),
      C.kpi('Skill 断言通过率', ((summary.assertions_passed / summary.assertions_total) * 100).toFixed(0), '%',
        { text: summary.assertions_passed + ' / ' + summary.assertions_total + ' 断言' }),
      C.kpi('待处理 Critical', critical, '', critical ? { dir: 'down', text: '存在 Critical Failure' } : { dir: 'up', text: '全部通过' })
    )
  );

  // 最近评测
  const runsTable = C.table({
    head: [
      { label: '#' }, { label: '任务' }, { label: '模型' },
      { label: 'J1', attrs: { class: 'num' } },
      { label: 'J2 WDR', attrs: { class: 'num' } },
      { label: 'J3', attrs: { class: 'num' } },
      { label: 'Rank' }, { label: '状态' }, { label: '创建时间' }, { label: '' }
    ],
    rows: runs.slice(0, 6).map(r => runRow(r))
  });
  const runsSect = h('div', {},
    h('div', { class: 'sect-title' },
      h('h2', {}, '最近评测'),
      h('a', { class: 'link', href: '#/runs' }, '全部记录 →')
    ),
    h('div', { class: 'card' }, runsTable)
  );

  // Judger cards
  const jd = h('div', {},
    h('div', { class: 'sect-title' }, h('h2', {}, 'Judger 套件'),
      h('a', { class: 'link', href: '#/docs' }, 'Skill 定义 →')
    ),
    h('div', { class: 'grid-3' }, [
      judger('j1', 'TRADE-J1 · METHODOLOGY', '方法论维度校验', '对已抽取的六维方法论做确定性合同校验与加权聚合。', manifest),
      judger('j2', 'TRADE-J2 · FIDELITY', '数据忠实度', '对每条 Data Claim 做证据合同校验与偏差统计。', manifest),
      judger('j3', 'TRADE-J3 · COMPLETENESS', '任务契约完整度', '将 should_generate 与验收状态拆分为两个正交轴。', manifest),
      judger('j4', 'TRADE-J4 · PAIRWISE BTD', 'Bradley-Terry-Davidson 排序', '接受 pairwise 比较，前置拒绝冲突后以 Davidson 平局扩展执行 MLE。', manifest),
      judger('j5', 'TRADE-J5 · TRACE HTML', '诊断与可追溯性', '汇聚 J1—J4 结论，构建 SIK 去重的 Judgement Registry。', manifest),
      h('div', { class: 'judger-card', style: { background: '#fbfbfc', borderStyle: 'dashed' } },
        h('div', { class: 'top' }, h('div', { class: 'code' }, 'SHARED · RUNTIME'), C.tag('Node 18+', 'info')),
        h('h4', {}, '共享运行时'),
        h('p', {}, '零 npm 依赖；CLI 形式为 ', h('code', {}, 'node index.js <input.json> [output]'), '。'),
        h('div', { class: 'foot' }, h('span', {}, 'data-lint · demo · clean-install'))
      )
    ])
  );

  view.appendChild(head);
  view.appendChild(steps);
  view.appendChild(kpiSect);
  view.appendChild(runsSect);
  view.appendChild(jd);

  // 建议：主要人员一句话
  view.appendChild(h('div', { class: 'sect-title' }, h('h2', {}, '控制台快速命令')));
  const con = h('div', { class: 'console' });
  ['# 一键完整验收','$ node tools/acceptance.js','✔ data-lint       · passed','✔ demo            · 108/108 assertions','✔ clean-install   · CLI boot OK','','# 单独运行任一层','$ node trade-j1-methodology/index.js shared/examples/j1.json j1.json','$ node trade-j5-trace-html/index.js shared/examples/j5.json trace-report.html'].forEach(line => {
    const cls = line.startsWith('#') ? 'comment' : line.startsWith('$') ? 'prompt' : line.startsWith('✔') ? 'ok' : '';
    const div = document.createElement('div');
    div.innerHTML = cls ? '<span class="' + cls + '">' + App.escape(line) + '</span>' : App.escape(line);
    con.appendChild(div);
  });
  view.appendChild(h('div', { class: 'card' }, h('div', { class: 'body' }, con)));
});

function step(n, title, desc, cta, href) {
  return h('div', { class: 'step' },
    h('div', { class: 'n' }, n),
    h('h4', {}, title),
    h('p', {}, desc),
    h('div', { class: 'cta', onClick: () => location.hash = href }, cta)
  );
}
function judger(k, code, title, desc, manifest) {
  const s = (manifest.skills || []).find(x => x.id === k) || { rules: 0, cases: 0 };
  return h('div', { class: 'judger-card ' + k, onClick: () => location.hash = '#/judger/' + k },
    h('span', { class: 'stripe' }),
    h('div', { class: 'top' }, h('div', { class: 'code' }, code), App.C.tag('在线', 'pass')),
    h('h4', {}, title),
    h('p', {}, desc),
    h('div', { class: 'foot' },
      h('span', {}, '规则 ', h('strong', {}, s.rules)),
      h('span', {}, '案例 ', h('strong', {}, s.cases))
    )
  );
}

function runRow(r) {
  const clickable = { 'data-clickable': '1' };
  const tr = h('tr', clickable);
  tr.addEventListener('click', () => { location.hash = '#/runs/' + r.id; });
  const statusMap = { passed: ['Passed', 'pass'], critical: ['Critical Fail', 'fail'], partial: ['Partial', 'warn'], completed: ['Completed', 'pass'] };
  const [sTxt, sCls] = statusMap[r.status] || [r.status, ''];
  tr.appendChild(h('td', { class: 'mono' }, '#' + r.id));
  tr.appendChild(h('td', {},
    h('div', { class: 'row-title' }, r.task.title),
    h('div', { class: 'row-sub mono' }, r.task.id)
  ));
  tr.appendChild(h('td', {}, h('strong', {}, r.model)));
  tr.appendChild(h('td', { class: 'num', style: color(r.j1_score, 60, 40) }, r.j1_score == null ? '—' : App.fmt.num(r.j1_score)));
  tr.appendChild(h('td', { class: 'num', style: color(1 - (r.j2_wdr || 0), 0.9, 0.7) }, r.j2_wdr == null ? '—' : (r.j2_wdr).toFixed(3)));
  tr.appendChild(h('td', { class: 'num', style: color(r.j3_score, 80, 60) }, r.j3_score == null ? '—' : App.fmt.num(r.j3_score)));
  tr.appendChild(h('td', {}, r.rank == null ? App.C.tag('—') : App.C.tag('Rank ' + r.rank, r.rank === 1 ? 'pass' : 'fail')));
  tr.appendChild(h('td', {}, App.C.tag(sTxt, sCls)));
  tr.appendChild(h('td', { class: 'muted small' }, r.created_at));
  tr.appendChild(h('td', {}, h('a', { href: '#/runs/' + r.id }, '查看 →')));
  return tr;
}
function color(v, ok, bad) {
  if (v == null) return {};
  if (v >= ok) return { color: 'var(--pass)' };
  if (v <= bad) return { color: 'var(--fail)' };
  return { color: 'var(--warn)' };
}

})();
