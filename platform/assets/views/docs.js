// 接入文档
(function () {
'use strict';
const h = App.h;

App.register('docs', async function ({ view }) {
  view.innerHTML = '';
  const manifest = await App.Store.get('manifest');

  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '接入文档'),
      h('div', { class: 'sub' }, 'Tendata Trade Judger 评测平台 · ' + manifest.version + ' · ' + manifest.generated_at.slice(0, 10))
    ),
    h('div', { class: 'status' }, App.C.tag('离线运行 · Node 18+', 'info'))
  ));

  view.appendChild(section('1. 平台架构',
    h('p', { class: 'muted' }, '本平台是一个纯静态站点，运行时由浏览器读取本地 data/*.json 完成所有渲染，无后端服务。评测计算真源仍由腾道交付的 tendata-trade-judger-skills（Node.js CLI）负责，平台前端仅完成可视化与流程编排。'),
    h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['分层', '职责', '实现'].map(t => h('th', {}, t)))),
      h('tbody', {}, [
        ['交互层', '侧栏 · 顶栏 · 视图路由', 'index.html + assets/app.js'],
        ['视图层', 'Dashboard / Runs / Judger 等 9 页', 'assets/views/*.js'],
        ['数据层', 'JSON 快照 + 元清单', 'data/*.json（由 tools/bake.js 生成）'],
        ['计算内核', 'J1—J5 五 Skill', 'tendata-trade-judger-skills（外部）']
      ].map(row => h('tr', {}, row.map(c => h('td', {}, c)))))
    )
  ));

  view.appendChild(section('2. 快速开始',
    ol([
      '将本站点目录（tendata_platform/）复制到任意位置。',
      '双击 index.html，或在目录内运行 python3 -m http.server 8080。',
      '侧栏进入「＋ 新建评测」，选择「载入演示任务 trade-demo-001」即可跳过上传，体验完整流水线。',
      '如需真实评测，先运行 node tools/acceptance.js 生成产物，再运行 node tools/bake.js 刷新平台数据。'
    ])
  ));

  view.appendChild(section('3. 数据契约',
    h('div', { class: 'stack' },
      contract('J1 输入 · j1-model-*.json', 'task_id, model_id, dimensions[6]{id,status,severity,confidence,evidence_refs,quoted_evidence,reason}'),
      contract('J2 输入 · j2-model-*.json', 'task_id, model_id, claims[]{id,dedupe_key,importance,confidence,deviation,severity,transformation,evidence_refs,reason}'),
      contract('J3 输入 · j3-model-*.json', 'task_id, model_id, task_contract[]{id,kind,should_generate,status,reason}'),
      contract('J4 输入 · j4-pairs.json', 'models[], comparisons[]{comparison_id,task_id,a,b,outcome,role,confidence,evidence,reason}'),
      contract('J5 输入 · j5.json', 'task_id, model_id, upstream_results{j1,j2,j3,j4}, findings[], mapping_ledger[], trace_nodes[]')
    )
  ));

  view.appendChild(section('4. CLI 命令速查',
    codeBlock([
      '# 一键完整验收',
      'node tools/acceptance.js',
      '',
      '# 单独运行任一层',
      'node trade-j1-methodology/index.js shared/examples/j1.json j1.json',
      'node trade-j2-fidelity/index.js shared/examples/j2.json j2.json',
      'node trade-j3-completeness/index.js shared/examples/j3.json j3.json',
      'node trade-j4-pairwise-btd/index.js shared/examples/j4.json ranking.json',
      'node trade-j5-trace-html/index.js shared/examples/j5.json trace-report.html',
      '',
      '# 刷新平台数据快照',
      'node tools/bake.js'
    ].join('\n'))
  ));

  view.appendChild(section('5. 专家共建流程',
    h('div', { class: 'stack' },
      h('p', { class: 'muted' }, '业务判定真源位于各模块 expert-rules.md；expert-cases.jsonl 仅覆盖与校准规则边界，两者语义冲突时以规则文本为准。'),
      h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['文件', '维护方', '可否直接修改'].map(t => h('th', {}, t)))),
        h('tbody', {}, [
          ['expert-rules.md', '业务专家', '是'],
          ['expert-cases.jsonl', '业务专家', '是'],
          ['prompt.md', '专家 & 工程', '协作'],
          ['schema.json', '工程', '否'],
          ['index.js', '工程', '否'],
          ['shared/lib.js · tools/', '工程', '否']
        ].map(row => h('tr', {}, row.map(c => h('td', {}, c)))))
      )
    )
  ));

  view.appendChild(section('6. 硬性约束',
    ul([
      '模板占位规则（如 RULE-JX-XXX）仅供占位、不产生逻辑效力，且不得被案例引用。',
      'JSON 输出与 HTML 报告必须基于同一 Report Model，确保同源。',
      'J5 仅融合与归因，不修改 J1—J4 的原始结论。',
      'Critical Failure 不得被平均分抵消；负面判断必须携带 evidence_refs。',
      '缺证时使用 insufficient_evidence，不得以常识补写。'
    ])
  ));

  view.appendChild(section('7. 版本与快照',
    h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['字段', '值'].map(t => h('th', {}, t)))),
      h('tbody', {}, [
        ['平台版本', manifest.version],
        ['数据生成时间', manifest.generated_at],
        ['来源交付包', manifest.source_pack],
        ['断言总数', manifest.assertions + ' 全通过 ' + manifest.assertions_passed],
        ['评测记录数', manifest.runs_count]
      ].map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'mono' }, String(v)))))
    )
  ));
});

function section(title, ...children) {
  return App.h('div', { class: 'card' },
    App.h('div', { class: 'head' }, App.h('h3', {}, title)),
    App.h('div', { class: 'body' }, children)
  );
}
function ol(items) { return App.h('ol', { style: { paddingLeft: '20px', lineHeight: '1.85' } }, items.map(i => App.h('li', {}, i))); }
function ul(items) { return App.h('ul', { style: { paddingLeft: '20px', lineHeight: '1.85' } }, items.map(i => App.h('li', {}, i))); }
function contract(title, spec) {
  return App.h('div', { class: 'k-v', style: { flexDirection: 'column', alignItems: 'flex-start', borderBottom: '1px dashed var(--line)', padding: '10px 0' } },
    App.h('div', { class: 'k', style: { marginBottom: '4px' } }, title),
    App.h('div', { class: 'v mono', style: { textAlign: 'left', color: 'var(--ink-2)' } }, spec)
  );
}
function codeBlock(text) {
  return App.h('pre', { class: 'console', style: { whiteSpace: 'pre' } }, text);
}

})();
