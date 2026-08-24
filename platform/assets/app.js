// Tendata Trade Judger 评测平台 · 应用外壳
// 提供：Router / Store / h helper / 共享组件 / 视图注册。
(function () {
'use strict';

const App = window.App = {
  views: {},
  ctx: {}, // 当前视图上下文
  register(name, fn) { this.views[name] = fn; },
  start() {
    window.addEventListener('hashchange', () => App.route());
    App.preload().then(() => App.route());
  }
};

// -------- Store --------
const cache = {};
App.Store = {
  async get(name) {
    if (cache[name]) return cache[name];
    const res = await fetch('data/' + name + '.json');
    if (!res.ok) throw new Error('加载 ' + name + ' 失败');
    cache[name] = await res.json();
    return cache[name];
  },
  set(name, value) { cache[name] = value; }
};

App.preload = async function () {
  try {
    const [manifest, runs, rules, cases] = await Promise.all([
      App.Store.get('manifest'), App.Store.get('runs'),
      App.Store.get('rules'), App.Store.get('cases')
    ]);
    document.getElementById('nav-runs-count').textContent  = runs.length;
    document.getElementById('nav-rules-count').textContent = rules.length;
    document.getElementById('nav-cases-count').textContent = cases.length;
    document.getElementById('foot-version').textContent = 'Skill Pack · ' + manifest.version;
  } catch (e) {
    console.error(e);
  }
};

// -------- Router --------
function parseHash() {
  const raw = (location.hash || '#/dashboard').slice(1);
  const [pathQ] = [raw];
  const [path, q] = pathQ.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = {};
  if (q) for (const kv of q.split('&')) {
    const [k, v] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return { parts, query };
}

App.route = async function () {
  const { parts, query } = parseHash();
  const view = document.getElementById('view');
  view.innerHTML = '<div class="loading">加载中...</div>';

  const name = parts[0] || 'dashboard';
  const activeKey = parts.slice(0, 2).join('/');
  document.querySelectorAll('.nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === activeKey || a.dataset.nav === name);
  });

  const routeMap = {
    'dashboard': 'dashboard',
    'runs':      parts[1] ? 'run-detail' : 'runs',
    'compare':   'compare',
    'judger':    'judger',
    'rules':     'rules',
    'cases':     'cases',
    'new-run':   'new-run',
    'docs':      'docs'
  };
  const handler = App.views[routeMap[name]] || App.views.dashboard;

  App.ctx = { parts, query, view };
  try {
    await handler(App.ctx);
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(h('div', { class: 'hint fail' },
      h('div', { class: 'i' }, '!'),
      h('div', {}, '视图渲染失败：', h('code', {}, String(e.message || e)))
    ));
    console.error(e);
  }

  // Crumbs
  const crumbs = document.getElementById('crumbs');
  const label = {
    dashboard: '概览', runs: '评测记录', compare: '模型对比',
    judger: 'Judger', rules: '专家规则', cases: '校准案例',
    'new-run': '新建评测', docs: '接入文档'
  }[name] || name;
  const extra = parts[1] ? ' / ' + parts[1] : '';
  crumbs.innerHTML = '工作台 / <strong>' + escapeHtml(label + extra) + '</strong>';
};

// -------- h() helper --------
const h = App.h = function (tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v);
    }
  }
  for (let i = 2; i < arguments.length; i++) {
    const child = arguments[i];
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      for (const c of child) if (c != null && c !== false) el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    } else if (child.nodeType) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
  return el;
};

// -------- Utils --------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
App.escape = escapeHtml;
App.fmt = {
  pct(v, digits) { if (v == null) return '—'; return (v * 100).toFixed(digits ?? 1) + '%'; },
  num(v, digits) { if (v == null) return '—'; return Number(v).toFixed(digits ?? 2); },
  clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
};

// -------- Toast --------
const toast = document.getElementById('toast');
App.toast = function (msg) {
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(App._toastT);
  App._toastT = setTimeout(() => toast.classList.remove('on'), 2000);
};

// -------- Modal --------
const modalBg = document.getElementById('modal');
const modalInner = document.getElementById('modal-inner');
App.modal = {
  open(title, bodyNode, footerNode) {
    modalInner.innerHTML = '';
    const head = h('div', { class: 'mhead' },
      h('h3', {}, title || ''),
      h('button', { class: 'close', onClick: () => App.modal.close() }, '×')
    );
    const body = h('div', { class: 'mbody' });
    if (typeof bodyNode === 'string') body.innerHTML = bodyNode; else if (bodyNode) body.appendChild(bodyNode);
    const foot = h('div', { class: 'mfoot' });
    if (footerNode) {
      if (Array.isArray(footerNode)) footerNode.forEach(n => foot.appendChild(n));
      else foot.appendChild(footerNode);
    } else {
      foot.appendChild(h('button', { class: 'btn solid', onClick: () => App.modal.close() }, '关闭'));
    }
    modalInner.appendChild(head);
    modalInner.appendChild(body);
    modalInner.appendChild(foot);
    modalBg.classList.add('open');
  },
  close() { modalBg.classList.remove('open'); }
};
modalBg.addEventListener('click', e => { if (e.target === modalBg) App.modal.close(); });

// -------- Components --------
App.C = {
  kpi(label, value, unit, trend) {
    return h('div', { class: 'kpi' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value' },
        String(value),
        unit ? h('span', { class: 'unit' }, unit) : null
      ),
      trend ? h('div', { class: 'trend ' + (trend.dir || '') }, trend.text) : null
    );
  },
  tag(text, cls) {
    return h('span', { class: 'tag ' + (cls || '') },
      cls ? h('span', { class: 'dot' }) : null, text);
  },
  bar(pct, cls) {
    const p = Math.max(0, Math.min(1, pct || 0));
    return h('div', { class: 'bar ' + (cls || '') }, h('i', { style: { width: (p * 100) + '%' } }));
  },
  tabs(items, active, onChange) {
    const wrap = h('div', { class: 'tabs' });
    items.forEach(it => {
      const btn = h('button', {
        class: 'tab' + (it.key === active ? ' active' : ''),
        onClick: () => onChange(it.key)
      }, it.label);
      wrap.appendChild(btn);
    });
    return wrap;
  },
  table({ head, rows, empty }) {
    const t = h('table', { class: 'tbl' });
    const thead = h('thead', {}, h('tr', {}, head.map(c => h('th', c.attrs || {}, c.label))));
    const tbody = h('tbody', {});
    if (!rows.length) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: head.length, class: 'muted small', style: { textAlign: 'center', padding: '30px' } }, empty || '暂无数据')));
    } else {
      rows.forEach(r => tbody.appendChild(r));
    }
    t.appendChild(thead); t.appendChild(tbody);
    return t;
  },
  // JSON highlight
  jsonView(obj) {
    const json = JSON.stringify(obj, null, 2);
    const html = App.escape(json)
      .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"(\s*:)/g, '<span class="key">"$1"</span>$2')
      .replace(/: "((?:[^"\\]|\\.)*)"/g, ': <span class="str">"$1"</span>')
      .replace(/: (-?\d+(?:\.\d+)?)/g, ': <span class="num">$1</span>')
      .replace(/: (true|false)/g, ': <span class="bool">$1</span>')
      .replace(/: null/g, ': <span class="null">null</span>');
    return h('pre', { class: 'jsonv', html });
  },
  // 六维雷达
  radar(values, options) {
    // values: [{label, value 0..100, color}]
    const opt = Object.assign({ size: 240, ring: 4, stroke: '#1f4b8f', fill: 'rgba(31,75,143,.16)' }, options || {});
    const cx = opt.size / 2, cy = opt.size / 2, r = opt.size / 2 - 34;
    const n = values.length;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', opt.size); svg.setAttribute('height', opt.size);
    svg.setAttribute('viewBox', '0 0 ' + opt.size + ' ' + opt.size);
    // rings
    for (let i = 1; i <= opt.ring; i++) {
      const rr = r * i / opt.ring;
      const poly = document.createElementNS(ns, 'polygon');
      const pts = [];
      for (let j = 0; j < n; j++) {
        const a = -Math.PI / 2 + j * 2 * Math.PI / n;
        pts.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1));
      }
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#e4e7eb');
      poly.setAttribute('stroke-width', '1');
      svg.appendChild(poly);
    }
    // axes + labels
    for (let j = 0; j < n; j++) {
      const a = -Math.PI / 2 + j * 2 * Math.PI / n;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', x); line.setAttribute('y2', y);
      line.setAttribute('stroke', '#e4e7eb');
      svg.appendChild(line);
      const lx = cx + (r + 14) * Math.cos(a), ly = cy + (r + 14) * Math.sin(a);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', lx); t.setAttribute('y', ly);
      t.setAttribute('font-size', '10'); t.setAttribute('fill', '#6b7684');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
      t.textContent = values[j].label;
      svg.appendChild(t);
    }
    // series
    const series = Array.isArray(options && options.series) ? options.series : [{ values, stroke: opt.stroke, fill: opt.fill }];
    series.forEach(s => {
      const poly = document.createElementNS(ns, 'polygon');
      const pts = [];
      for (let j = 0; j < s.values.length; j++) {
        const a = -Math.PI / 2 + j * 2 * Math.PI / s.values.length;
        const v = Math.max(0, Math.min(100, s.values[j].value)) / 100;
        pts.push((cx + r * v * Math.cos(a)).toFixed(1) + ',' + (cy + r * v * Math.sin(a)).toFixed(1));
      }
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('fill', s.fill || opt.fill);
      poly.setAttribute('stroke', s.stroke || opt.stroke);
      poly.setAttribute('stroke-width', '2');
      svg.appendChild(poly);
    });
    return svg;
  },
  donut(pct, label, options) {
    const opt = Object.assign({ size: 130, stroke: 14, color: '#1f4b8f' }, options || {});
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', opt.size); svg.setAttribute('height', opt.size);
    const cx = opt.size / 2, cy = opt.size / 2, r = (opt.size - opt.stroke) / 2;
    const cir = 2 * Math.PI * r;
    const bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
    bg.setAttribute('stroke', '#eef1f4'); bg.setAttribute('stroke-width', opt.stroke); bg.setAttribute('fill', 'none');
    svg.appendChild(bg);
    const fg = document.createElementNS(ns, 'circle');
    fg.setAttribute('cx', cx); fg.setAttribute('cy', cy); fg.setAttribute('r', r);
    fg.setAttribute('stroke', opt.color); fg.setAttribute('stroke-width', opt.stroke);
    fg.setAttribute('fill', 'none'); fg.setAttribute('stroke-linecap', 'round');
    fg.setAttribute('stroke-dasharray', (cir * pct) + ' ' + cir);
    fg.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
    svg.appendChild(fg);
    const t1 = document.createElementNS(ns, 'text');
    t1.setAttribute('x', cx); t1.setAttribute('y', cy - 2);
    t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('font-size', '20'); t1.setAttribute('font-weight', '600');
    t1.setAttribute('fill', '#0f1720');
    t1.textContent = (pct * 100).toFixed(1) + '%';
    svg.appendChild(t1);
    const t2 = document.createElementNS(ns, 'text');
    t2.setAttribute('x', cx); t2.setAttribute('y', cy + 16);
    t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('font-size', '11'); t2.setAttribute('fill', '#6b7684');
    t2.textContent = label || '';
    svg.appendChild(t2);
    return svg;
  },
  barsChart(items, options) {
    // items: [{label, value, color, cap}]
    const opt = Object.assign({ height: 200, maxLabel: 12 }, options || {});
    const ns = 'http://www.w3.org/2000/svg';
    const w = Math.max(items.length * 60 + 40, 320);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', opt.height);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + opt.height);
    const barW = (w - 40) / items.length - 12;
    const max = Math.max(1, ...items.map(x => x.cap || x.value));
    items.forEach((it, i) => {
      const bh = (it.value / max) * (opt.height - 46);
      const x = 20 + i * (barW + 12);
      const y = opt.height - 24 - bh;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', barW); rect.setAttribute('height', bh);
      rect.setAttribute('fill', it.color || '#1f4b8f'); rect.setAttribute('rx', 3);
      svg.appendChild(rect);
      const v = document.createElementNS(ns, 'text');
      v.setAttribute('x', x + barW / 2); v.setAttribute('y', y - 4);
      v.setAttribute('font-size', '11'); v.setAttribute('text-anchor', 'middle'); v.setAttribute('fill', '#3a4552');
      v.textContent = it.valueLabel != null ? it.valueLabel : Number(it.value).toFixed(2);
      svg.appendChild(v);
      const l = document.createElementNS(ns, 'text');
      l.setAttribute('x', x + barW / 2); l.setAttribute('y', opt.height - 8);
      l.setAttribute('font-size', '11'); l.setAttribute('text-anchor', 'middle'); l.setAttribute('fill', '#6b7684');
      l.textContent = App.fmt.clip(it.label, opt.maxLabel);
      svg.appendChild(l);
    });
    return svg;
  }
};

// -------- Global search --------
document.getElementById('global-search').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const [rules, cases] = await Promise.all([App.Store.get('rules'), App.Store.get('cases')]);
  const rMatch = rules.filter(r => (r.id + r.title + (r.judgement || '')).toLowerCase().includes(q));
  const cMatch = cases.filter(c => JSON.stringify(c).toLowerCase().includes(q));
  const body = h('div', { class: 'stack' },
    h('div', { class: 'muted small' }, '规则命中 ' + rMatch.length + ' 条 · 案例命中 ' + cMatch.length + ' 条'),
    h('div', {},
      rMatch.slice(0, 6).map(r =>
        h('div', { class: 'k-v' }, h('span', { class: 'k mono' }, r.id), h('a', { class: 'v', href: '#/rules?skill=' + r.skill + '&q=' + encodeURIComponent(r.id), onClick: () => App.modal.close() }, r.title))
      )
    ),
    h('div', {},
      cMatch.slice(0, 6).map(c =>
        h('div', { class: 'k-v' }, h('span', { class: 'k mono' }, c.case_id || c.rule_id), h('span', { class: 'v', style: { textAlign: 'left' } }, App.fmt.clip(c.input_summary || c.reason || '', 60)))
      )
    )
  );
  App.modal.open('搜索结果 · ' + q, body);
});

})();
