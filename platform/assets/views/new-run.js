// 新建评测：表单 + 上传 + 控制台动画
(function () {
'use strict';
const h = App.h;

App.register('new-run', async function ({ view }) {
  view.innerHTML = '';
  const form = { task_id: 'trade-demo-001', hs: 'HS0901', dimension: '出口趋势（同比）', layer: 'full', model: 'model-a' };

  view.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, '＋ 新建评测'),
      h('div', { class: 'sub' }, '配置外贸分析任务、上传模型输出，运行 J1—J5 流水线。')
    ),
    h('div', { class: 'status' },
      h('button', { class: 'btn', onClick: loadDemo }, '↻ 载入演示任务')
    )
  ));

  const formCard = h('div', { class: 'card' }, h('div', { class: 'body' },
    h('h4', { style: { margin: '0 0 10px' } }, '任务定义'),
    h('div', { class: 'form-row' },
      field('任务 ID', h('input', { value: form.task_id, onInput: e => form.task_id = e.target.value })),
      field('HS 编码', h('input', { value: form.hs, onInput: e => form.hs = e.target.value }))
    ),
    h('div', { class: 'form-row' },
      field('分析口径', selectField(['出口趋势（同比）', '进口趋势', '规模排序', '市场结构', '客户识别', '风险评估'], form.dimension, v => form.dimension = v)),
      field('评测层', selectField([
        ['full', '全流水线 J1 → J5'],
        ['single', '只跑 J1—J3（单模型）'],
        ['pairwise', '只跑 J4（pairwise 排序）'],
        ['trace', '只跑 J5（trace 归因）']
      ], form.layer, v => form.layer = v))
    ),
    h('div', { class: 'form-row' },
      field('主模型 ID', h('input', { value: form.model, onInput: e => form.model = e.target.value })),
      field('参评模型 (可选)', h('input', { placeholder: '例如 model-b（留空则只评本模型）' }))
    )
  ));
  view.appendChild(formCard);

  const uploadCard = h('div', { class: 'card' }, h('div', { class: 'body' },
    h('h4', { style: { margin: '0 0 10px' } }, '模型输出'),
    h('div', { class: 'drop', onClick: pickFile },
      h('div', { class: 'big' }, '↑ 点击选择或拖入 j1/j2/j3/j4/j5 输入 JSON'),
      h('div', { class: 'small' }, '亦可粘贴报告文本，由 prompt.md 自动抽取。')
    ),
    h('div', { id: 'upload-info', class: 'muted small', style: { marginTop: '8px' } }, '未选择文件')
  ));
  view.appendChild(uploadCard);

  const consoleCard = h('div', { class: 'card', style: { display: 'none' } }, h('div', { class: 'body' },
    h('h4', { style: { margin: '0 0 10px' } }, '流水线控制台'),
    h('div', { class: 'console', id: 'run-console' })
  ));
  view.appendChild(consoleCard);

  view.appendChild(h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px' } },
    h('a', { class: 'btn', href: '#/dashboard' }, '取消'),
    h('button', { class: 'btn solid', onClick: runPipeline }, '▶ 运行流水线')
  ));

  function loadDemo() {
    form.task_id = 'trade-demo-001'; form.hs = 'HS0901'; form.dimension = '出口趋势（同比）';
    form.model = 'model-a'; form.layer = 'full';
    App.toast('已载入演示任务 trade-demo-001');
    location.hash = '#/new-run'; // re-render
    App.route();
  }
  function pickFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.md,.txt';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        document.getElementById('upload-info').innerHTML = '已选择 <strong>' + App.escape(f.name) + '</strong> · ' + f.size + ' 字节';
        try { JSON.parse(reader.result); App.toast(f.name + ' JSON 格式合法'); }
        catch (e) { App.toast('提示：非 JSON 文本，将走 prompt.md 抽取'); }
      };
      reader.readAsText(f);
    };
    inp.click();
  }

  async function runPipeline() {
    consoleCard.style.display = 'block';
    const con = document.getElementById('run-console'); con.innerHTML = '';
    const lines = [
      ['# 启动 Tendata Trade Judger 流水线', 'comment'],
      ['$ node tools/acceptance.js --task=' + form.task_id, 'prompt'],
      ['[data-lint] parsing 5 skill jsonl ...', 'ok'],
      ['[data-lint] 45 rules · 105 cases · no orphan reference', 'ok'],
      ['[j1] loading ' + form.model + ' methodology ...', 'ok'],
      ['[j1] score 83.33 · coverage 1.00 · critical=false', 'ok'],
      ['[j2] loading claims ...', 'ok'],
      ['[j2] WDR = 0.0208', 'ok'],
      ['[j3] task_contract analysis · overall=96.15', 'ok'],
      ['[j4] Bradley-Terry-Davidson MLE · η=7.80 · loglik=-1.531', 'ok'],
      ['[j4] ranking: ' + form.model + ' > baseline', 'ok'],
      ['[j5] mapping closure OK · 0 conflicts · 1 unresolved', 'ok'],
      ['[clean-install] CLI boot OK  (5 skills)', 'ok'],
      ['✔ 108/108 assertions passed', 'ok'],
      ['➜ 记录已保存为 #E' + Date.now().toString().slice(-3), 'comment']
    ];
    for (const [txt, cls] of lines) {
      await sleep(220);
      const div = document.createElement('div');
      const prefix = cls === 'ok' ? '<span class="ok">✔</span> ' : '';
      div.innerHTML = prefix + '<span class="' + cls + '">' + App.escape(txt) + '</span>';
      con.appendChild(div);
      con.scrollTop = con.scrollHeight;
    }
    App.toast('评测已完成，正在跳转到 #0004 详情...');
    await sleep(1200);
    location.hash = '#/runs/0004';
  }
});

function field(label, control) {
  return App.h('div', { class: 'field' }, App.h('label', {}, label), control);
}
function selectField(options, value, onChange) {
  const s = App.h('select', { onChange: e => onChange(e.target.value) });
  options.forEach(o => {
    const [val, lbl] = Array.isArray(o) ? o : [o, o];
    const opt = App.h('option', { value: val }, lbl);
    if (val === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();
