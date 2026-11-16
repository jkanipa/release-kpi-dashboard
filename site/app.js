(function () {
  'use strict';

  const STATUS = {
    failed_test: { label: 'Test failed', icon: '✕' },
    deviated: { label: 'Deviated', icon: '✕' },
    warn: { label: 'Warning', icon: '!' },
    missing: { label: 'Missing', icon: '?' },
    no_baseline: { label: 'No baseline', icon: '?' },
    improved: { label: 'Improved', icon: '↗' },
    ok: { label: 'Within tolerance', icon: '✓' },
  };
  const RANK = { ok: 0, improved: 0, missing: 1, no_baseline: 1, warn: 2, deviated: 3, failed_test: 3 };
  const DIRECTION = { lower_is_better: 'Lower is better', higher_is_better: 'Higher is better', target: 'Stay on baseline' };
  const TABS = [['release', 'Release'], ['history', 'All releases'], ['kpi', 'KPI detail'], ['compare', 'Compare'], ['details', 'Details']];

  let D = null;
  const index = new Map();
  const collapsed = new Set();

  // ---------- DOM helpers ----------
  function build(el, attrs, kids) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
  const s = (tag, attrs, ...kids) => build(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs, kids);

  // ---------- Data helpers ----------
  const cell = (release, variant, kpi) => index.get(release + '|' + variant + '|' + kpi);
  const kpiById = (id) => D.kpis.find((k) => k.id === id);
  const variantName = (id) => D.variants.find((v) => v.id === id).name;
  const relIdx = (id) => D.releases.findIndex((r) => r.id === id);
  const lastRelease = () => D.releases[D.releases.length - 1].id;
  const unitOf = (kpi) => (kpi.unit ? ' ' + kpi.unit : '');
  const groupOf = (kpi) => kpi.group || 'Other';
  const groups = () => [...new Set(D.kpis.map(groupOf))];
  const isHot = (status) => RANK[status] > 0 || status === 'improved';
  const baselineOf = (variant) => (D.baseline.variants || {})[variant] || D.baseline.default;

  function fmtValue(kpi, v) { return v == null ? '–' : Number(v).toFixed(kpi.decimals ?? 2); }
  function signed(n, digits) {
    const t = Math.abs(n).toFixed(digits);
    return Number(t) === 0 ? '±' + t : (n > 0 ? '+' : '−') + t;
  }
  function tolDelta(kpi, c) { return kpi.tolerance.mode === 'absolute' ? c.delta_abs : c.delta_pct; }
  function fmtDelta(kpi, c, compact) {
    if (c.delta_abs == null) return '';
    if (kpi.tolerance.mode === 'absolute' || c.delta_pct == null) {
      return signed(c.delta_abs, Math.max(kpi.decimals ?? 2, 1)) + (compact ? '' : unitOf(kpi));
    }
    return signed(c.delta_pct, compact ? 1 : 2) + (compact ? '%' : ' %');
  }
  function fmtTolerance(kpi) {
    const u = kpi.tolerance.mode === 'absolute' ? unitOf(kpi) : ' %';
    return '±' + kpi.tolerance.warn + u + ' warning, ±' + kpi.tolerance.fail + u + ' deviated';
  }
  function fmtLimit(kpi) {
    if (!kpi.limit) return null;
    return 'max' in kpi.limit ? '≤ ' + kpi.limit.max + unitOf(kpi) : '≥ ' + kpi.limit.min + unitOf(kpi);
  }
  function describe(kpi, c) {
    let t = kpi.name + ', ' + variantName(c.variant) + ', ' + c.release + ': ' + STATUS[c.status].label;
    if (c.value != null) t += '. ' + fmtValue(kpi, c.value) + unitOf(kpi);
    if (c.baseline != null && c.value != null) t += ' (' + fmtDelta(kpi, c) + ' vs baseline ' + fmtValue(kpi, c.baseline) + ')';
    if (c.limit_violated) t += '. Outside limit ' + fmtLimit(kpi);
    return t;
  }
  function severity(kpi, c) {
    const d = tolDelta(kpi, c);
    return RANK[c.status] * 1000 + (d == null ? 0 : Math.abs(d) / (kpi.tolerance.fail || 1));
  }

  // ---------- Routing: the whole view state lives in the URL ----------
  function route() {
    const [view, qs = ''] = location.hash.slice(1).split('?');
    return { view: VIEWS[view] ? view : 'release', p: new URLSearchParams(qs) };
  }
  function href(view, params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') p.set(k, v);
    const q = p.toString();
    return '#' + view + (q ? '?' + q : '');
  }
  function patch(changes) {
    const { view, p } = route();
    history.replaceState(null, '', href(view, { ...Object.fromEntries(p), ...changes }));
    render();
  }
  function curRelease(p, key) {
    const r = p.get(key || 'r');
    return relIdx(r) >= 0 ? r : lastRelease();
  }

  // ---------- Small components ----------
  function mark(status) {
    return h('span', { class: 'mark st-' + status, role: 'img', 'aria-label': STATUS[status].label, title: STATUS[status].label }, STATUS[status].icon);
  }
  function badge(status) {
    return h('span', { class: 'badge st-' + status }, h('span', { 'aria-hidden': 'true' }, STATUS[status].icon), STATUS[status].label);
  }
  function select(label, options, value, onchange, id) {
    return h('label', {}, label, h('select', { id, onchange: (e) => onchange(e.target.value) },
      options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
  }
  function kpiSelect(value, onchange) {
    return h('label', {}, 'KPI', h('select', { id: 'kpi-select', onchange: (e) => onchange(e.target.value) },
      groups().map((g) => h('optgroup', { label: g },
        D.kpis.filter((k) => groupOf(k) === g).map((k) => h('option', { value: k.id, selected: k.id === value }, k.name))))));
  }
  function releaseStepper(value, key) {
    const i = relIdx(value);
    const step = (d) => () => patch({ [key]: D.releases[i + d].id });
    return h('span', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'Previous release', disabled: i === 0, onclick: step(-1) }, '‹'),
      select('Release', D.releases.map((r) => [r.id, r.id + ' · ' + r.date]), value, (v) => patch({ [key]: v }), 'release-select'),
      h('button', { type: 'button', 'aria-label': 'Next release', disabled: i === D.releases.length - 1, onclick: step(1) }, '›'));
  }
  function search(p) {
    return h('input', { type: 'search', id: 'q', placeholder: 'Filter KPIs', 'aria-label': 'Filter KPIs', value: p.get('q') || '', oninput: (e) => patch({ q: e.target.value }) });
  }
  function matchKpi(kpi, q) {
    return !q || (kpi.name + ' ' + (kpi.regulation || '') + ' ' + groupOf(kpi)).toLowerCase().includes(q.toLowerCase());
  }
  function sparkline(kpi, variant, selIdx) {
    const W = 72, H = 24, pad = 3;
    const ds = D.releases.map((r) => tolDelta(kpi, cell(r.id, variant, kpi.id)));
    const span = Math.max(kpi.tolerance.fail * 1.4, ...ds.map((d) => Math.abs(d || 0)));
    const x = (i) => pad + (W - 2 * pad) * (ds.length === 1 ? 0.5 : i / (ds.length - 1));
    const y = (d) => H / 2 - (d / span) * (H / 2 - pad);
    const segs = [];
    let cur = [];
    ds.forEach((d, i) => { if (d == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(x(i).toFixed(1) + ',' + y(d).toFixed(1)); });
    if (cur.length) segs.push(cur);
    const sel = cell(D.releases[selIdx].id, variant, kpi.id);
    return s('svg', { class: 'spark', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' },
      s('rect', { class: 'band', x: 0, width: W, y: y(kpi.tolerance.warn), height: y(-kpi.tolerance.warn) - y(kpi.tolerance.warn) }),
      s('line', { class: 'zero', x1: 0, x2: W, y1: H / 2, y2: H / 2 }),
      segs.map((pts) => s('polyline', { class: 'path', points: pts.join(' ') })),
      ds[selIdx] == null ? null : s('circle', { class: 'dot st-' + sel.status, cx: x(selIdx), cy: y(ds[selIdx]), r: 3.5 }));
  }

  // ---------- Release view ----------
  function viewRelease(root, p) {
    const rel = curRelease(p), ri = relIdx(rel);
    const prev = ri > 0 ? D.releases[ri - 1].id : null;
    const q = p.get('q') || '', only = p.get('issues') === '1';
    const cells = D.cells.filter((c) => c.release === rel);
    const count = (...names) => cells.filter((c) => names.includes(c.status)).length;
    const nBad = count('deviated', 'failed_test'), nWarn = count('warn'), nGap = count('missing', 'no_baseline');

    let headline = 'All ' + cells.length + ' results are within tolerance';
    if (nBad) headline = nBad + ' of ' + cells.length + ' results deviate from baseline';
    else if (nWarn) headline = 'No deviations, ' + nWarn + (nWarn === 1 ? ' warning' : ' warnings');
    else if (nGap) headline = 'No deviations, ' + nGap + ' missing';

    let since = 'This is the first release.';
    let worse = new Set();
    if (prev) {
      let recovered = 0;
      for (const c of cells) {
        const before = cell(prev, c.variant, c.kpi);
        if (RANK[c.status] > RANK[before.status]) worse.add(c);
        else if (RANK[c.status] === 0 && RANK[before.status] > 0) recovered++;
      }
      since = 'Since ' + prev + ': ' + worse.size + ' got worse, ' + recovered + ' recovered.';
    }
    const segments = [['deviated', nBad, 'Deviated'], ['warn', nWarn, 'Warning'], ['missing', nGap, 'Missing'], ['improved', count('improved'), 'Improved'], ['ok', count('ok'), 'Within tolerance']];

    root.append(
      h('div', { class: 'controls' }, releaseStepper(rel, 'r'), h('span', { class: 'small muted' }, 'Compared with baseline ' + baselineText())),
      h('section', { class: 'card pad summary' },
        h('div', {}, h('p', { class: 'headline' }, headline), h('p', { class: 'muted', style: 'margin:0' }, since)),
        h('div', {},
          h('div', { class: 'dist', role: 'img', 'aria-label': segments.map((x) => x[1] + ' ' + x[2]).join(', ') },
            segments.filter((x) => x[1]).map(([st, n]) => h('span', { class: 'st-' + st, style: 'flex:' + n }))),
          h('ul', { class: 'legend' }, segments.map(([st, n, label]) => h('li', {}, mark(st), label, h('b', {}, n)))))));

    // Needs attention
    const issues = cells.filter((c) => RANK[c.status] > 0).sort((a, b) => severity(kpiById(b.kpi), b) - severity(kpiById(a.kpi), a));
    root.append(h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Needs attention'), h('span', { class: 'small muted' }, issues.length ? issues.length + ' results, worst first' : '')),
      issues.length ? h('div', { class: 'card scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, 'KPI'), h('th', { scope: 'col' }, 'Variant'),
          h('th', { scope: 'col', class: 'r' }, 'Value'), h('th', { scope: 'col', class: 'r' }, 'Baseline'), h('th', { scope: 'col', class: 'r' }, 'Change'), h('th', { scope: 'col' }, 'Trend'))),
        h('tbody', {}, issues.map((c) => {
          const kpi = kpiById(c.kpi);
          return h('tr', {},
            h('td', {}, badge(c.status), worse.has(c) ? [' ', h('span', { class: 'tag' }, 'New')] : null),
            h('td', {}, h('a', { class: 'kpi-name', href: href('kpi', { id: kpi.id, r: rel }) }, kpi.name),
              c.limit_violated ? h('div', { class: 'small muted' }, 'Outside limit ' + fmtLimit(kpi)) : null),
            h('td', {}, variantName(c.variant)),
            h('td', { class: 'r' }, fmtValue(kpi, c.value) + (c.value == null ? '' : unitOf(kpi))),
            h('td', { class: 'r muted' }, fmtValue(kpi, c.baseline)),
            h('td', { class: 'r' }, fmtDelta(kpi, c) || '–'),
            h('td', {}, sparkline(kpi, c.variant, ri)));
        }))))
        : h('p', { class: 'card pad muted', style: 'margin:0' }, 'Nothing needs attention in ' + rel + '.')));

    // Matrix
    const body = [];
    let shown = 0;
    for (const g of groups()) {
      const kpis = D.kpis.filter((k) => groupOf(k) === g && matchKpi(k, q))
        .filter((k) => !only || D.variants.some((v) => RANK[cell(rel, v.id, k.id).status] > 0));
      if (!kpis.length) continue;
      shown += kpis.length;
      const open = !collapsed.has(g);
      const nIssues = kpis.reduce((n, k) => n + D.variants.filter((v) => RANK[cell(rel, v.id, k.id).status] > 0).length, 0);
      body.push(h('tbody', {},
        h('tr', { class: 'group' }, h('th', { colspan: D.variants.length + 1, scope: 'colgroup' },
          h('button', { type: 'button', id: 'group-' + g, 'aria-expanded': String(open), onclick: () => { open ? collapsed.add(g) : collapsed.delete(g); render(); } },
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'), g,
            h('span', { class: 'muted', style: 'font-weight:400' }, kpis.length + (kpis.length === 1 ? ' KPI' : ' KPIs') + (nIssues ? ' · ' + nIssues + ' need attention' : ''))))),
        open ? kpis.map((kpi) => h('tr', {},
          h('th', { scope: 'row', class: 'sticky-col' },
            h('a', { class: 'kpi-name', href: href('kpi', { id: kpi.id, r: rel }) }, kpi.name),
            h('div', { class: 'small muted' }, [kpi.regulation, kpi.unit].filter(Boolean).join(' · '))),
          D.variants.map((v) => {
            const c = cell(rel, v.id, kpi.id), hot = isHot(c.status);
            return h('td', { class: 'cell' }, h('a', { class: 'cellbox st-' + c.status + (hot ? ' hot' : ''), href: href('kpi', { id: kpi.id, r: rel }), title: describe(kpi, c) },
              mark(c.status),
              h('span', { class: 'val' }, fmtValue(kpi, c.value)),
              sparkline(kpi, v.id, ri),
              h('span', { class: 'delta' + (hot ? ' hot' : '') }, c.value == null ? 'No result' : c.status === 'failed_test' ? 'Test failed' : fmtDelta(kpi, c) || 'No baseline')));
          }))) : null));
    }
    root.append(h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', {}, 'All KPIs in ' + rel),
        h('span', { class: 'small muted' }, 'Value, change vs baseline, and trend across releases (shaded band = warning tolerance)'),
        h('span', { class: 'spacer controls no-print', style: 'margin-bottom:0' }, search(p),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'only-issues', checked: only, onchange: (e) => patch({ issues: e.target.checked ? '1' : '' }) }), 'Only issues'))),
      shown ? h('div', { class: 'card scroll tall' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'sticky-col' }, 'KPI'), D.variants.map((v) => h('th', { scope: 'col' }, v.name)))), body))
        : h('p', { class: 'card pad muted', style: 'margin:0' }, 'No KPIs match this filter.')));
  }
  function baselineText() {
    const overrides = Object.entries(D.baseline.variants || {});
    return D.baseline.default + (overrides.length ? ' (' + overrides.map(([v, r]) => variantName(v) + ': ' + r).join(', ') + ')' : '');
  }

  // ---------- All releases (heatmap) ----------
  function viewHistory(root, p) {
    const q = p.get('q') || '';
    const kpis = D.kpis.filter((k) => matchKpi(k, q));
    root.append(
      h('div', { class: 'controls' }, search(p),
        h('ul', { class: 'legend' }, ['deviated', 'warn', 'missing', 'improved', 'ok'].map((st) => h('li', {}, mark(st), STATUS[st].label)))),
      kpis.length ? h('div', { class: 'card scroll tall' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'sticky-col' }, 'KPI'), h('th', { scope: 'col' }, 'Variant'),
          D.releases.map((r) => h('th', { scope: 'col', class: 'r', style: 'text-align:center' }, r.id)))),
        kpis.map((kpi) => h('tbody', {}, D.variants.map((v, vi) => h('tr', {},
          vi === 0 ? h('th', { scope: 'rowgroup', rowspan: D.variants.length, class: 'sticky-col', style: 'vertical-align:top' },
            h('a', { class: 'kpi-name', href: href('kpi', { id: kpi.id }) }, kpi.name),
            h('div', { class: 'small muted' }, groupOf(kpi) + (kpi.unit ? ' · ' + (kpi.tolerance.mode === 'absolute' ? 'Δ in ' + kpi.unit : 'Δ in %') : ' · Δ in %'))) : null,
          h('th', { scope: 'row', class: 'small' }, v.name),
          D.releases.map((r) => {
            const c = cell(r.id, v.id, kpi.id), hot = isHot(c.status);
            const text = c.value == null ? '–' : r.id === baselineOf(v.id) ? 'base' : fmtDelta(kpi, c, true) || '–';
            return h('td', { class: 'heat' }, h('a', { class: 'st-' + c.status + (hot ? ' hot' : ''), href: href('kpi', { id: kpi.id, r: r.id }), title: describe(kpi, c) },
              hot ? h('span', { 'aria-hidden': 'true' }, STATUS[c.status].icon + ' ') : null, text,
              h('span', { style: 'position:absolute;left:-9999px' }, ' ' + STATUS[c.status].label)));
          })))))))
        : h('p', { class: 'card pad muted', style: 'margin:0' }, 'No KPIs match this filter.'));
  }

  // ---------- KPI detail ----------
  function niceTicks(min, max, n) {
    const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const out = [];
    for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) out.push(t);
    return { ticks: out, digits: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
  }
  function chart(kpi, variant, rel) {
    const W = 340, H = 190, m = { l: 46, r: 14, t: 10, b: 24 };
    const cs = D.releases.map((r) => cell(r.id, variant, kpi.id));
    const base = cs[0].baseline;
    const vals = cs.map((c) => c.value).filter((v) => v != null);
    if (!vals.length) return h('p', { class: 'muted small' }, 'No results for this variant.');
    const toAbs = (t) => (kpi.tolerance.mode === 'absolute' ? t : Math.abs(base) * t / 100);
    let lo = Math.min(...vals), hi = Math.max(...vals), warn = null, fail = null;
    if (base != null) {
      warn = toAbs(kpi.tolerance.warn); fail = toAbs(kpi.tolerance.fail);
      lo = Math.min(lo, base - fail * 1.25); hi = Math.max(hi, base + fail * 1.25);
    }
    const limit = kpi.limit ? (kpi.limit.max ?? kpi.limit.min) : null;
    const showLimit = limit != null && (fail == null || Math.abs(limit - base) <= fail * 4);
    if (showLimit) { lo = Math.min(lo, limit); hi = Math.max(hi, limit); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const padY = (hi - lo) * 0.06; lo -= padY; hi += padY;
    const x = (i) => m.l + (W - m.l - m.r) * (cs.length === 1 ? 0.5 : i / (cs.length - 1));
    const y = (v) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
    const { ticks, digits } = niceTicks(lo, hi, 4);
    const every = Math.ceil(cs.length / 7);
    const segs = [];
    let cur = [];
    cs.forEach((c, i) => { if (c.value == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(x(i).toFixed(1) + ',' + y(c.value).toFixed(1)); });
    if (cur.length) segs.push(cur);
    const selI = relIdx(rel);
    return s('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': kpi.name + ' for ' + variantName(variant) + ' across releases. Values are in the table below.' },
      ticks.map((t) => [s('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }), s('text', { x: m.l - 6, y: y(t) + 3, 'text-anchor': 'end' }, t.toFixed(Math.min(digits, 4)))]),
      base == null ? null : [
        s('rect', { class: 'band', x: m.l, width: W - m.l - m.r, y: y(base + warn), height: y(base - warn) - y(base + warn) }),
        s('line', { class: 'fail', x1: m.l, x2: W - m.r, y1: y(base + fail), y2: y(base + fail) }),
        s('line', { class: 'fail', x1: m.l, x2: W - m.r, y1: y(base - fail), y2: y(base - fail) }),
        s('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: y(base), y2: y(base) })],
      showLimit ? s('line', { class: 'limit', x1: m.l, x2: W - m.r, y1: y(limit), y2: y(limit) }) : null,
      D.releases.map((r, i) => (i % every === 0 || i === cs.length - 1) ? s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === cs.length - 1 ? 'end' : 'middle' }, r.id) : null),
      segs.map((pts) => s('polyline', { class: 'line', points: pts.join(' ') })),
      cs.map((c, i) => {
        if (c.value == null) return null;
        const cx = x(i), cy = y(c.value), bad = RANK[c.status] >= 2;
        const shape = bad
          ? s('rect', { class: 'pt st-' + c.status, x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, transform: 'rotate(45 ' + cx + ' ' + cy + ')' })
          : s('circle', { class: 'pt st-' + c.status, cx, cy, r: 4.5 });
        shape.append(s('title', {}, describe(kpi, c)));
        return [i === selI ? s('circle', { class: 'sel', cx, cy, r: 9 }) : null, shape];
      }));
  }
  function viewKpi(root, p) {
    const kpi = kpiById(p.get('id')) || D.kpis[0];
    const rel = curRelease(p);
    const line = (cls, label) => h('li', {}, s('svg', { width: 22, height: 8, class: 'chart', style: 'width:22px;margin:0', 'aria-hidden': 'true' }, s('line', { class: cls, x1: 0, x2: 22, y1: 4, y2: 4 })), label);
    root.append(
      h('div', { class: 'controls' }, kpiSelect(kpi.id, (v) => patch({ id: v })), releaseStepper(rel, 'r')),
      h('section', { class: 'card pad' },
        h('dl', { class: 'facts' },
          [['KPI', kpi.name], ['Group', groupOf(kpi)], ['Regulation', kpi.regulation || '–'], ['Unit', kpi.unit || 'None'], ['Goal', DIRECTION[kpi.direction]],
            ['Tolerance', fmtTolerance(kpi)], ['Limit', fmtLimit(kpi) || 'None'], ['Baseline', baselineText()]]
            .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', {}, 'By variant'), h('span', { class: 'small muted' }, 'Highlighted release: ' + rel)),
        h('ul', { class: 'key' },
          line('line', 'Measured value'), line('baseline', 'Baseline'),
          h('li', {}, h('span', { style: 'width:22px;height:8px;background:var(--band);display:inline-block' }), 'Warning tolerance'),
          line('fail', 'Deviation threshold'), kpi.limit ? line('limit', 'Limit') : null,
          h('li', {}, s('svg', { width: 12, height: 12, class: 'chart st-deviated', style: 'width:12px;margin:0', 'aria-hidden': 'true' }, s('rect', { class: 'pt st-deviated', x: 2, y: 2, width: 8, height: 8, transform: 'rotate(45 6 6)' })), 'Warning or deviated')),
        h('div', { class: 'multiples' }, D.variants.map((v) => {
          const c = cell(rel, v.id, kpi.id);
          return h('article', { class: 'card vcard st-' + c.status },
            h('div', { class: 'vcard-head' }, h('h3', {}, v.name), badge(c.status)),
            h('div', { class: 'big' }, fmtValue(kpi, c.value), kpi.unit && c.value != null ? h('small', {}, ' ' + kpi.unit) : null),
            h('div', { class: 'small muted num' },
              c.value == null ? 'No result in ' + rel : c.baseline == null ? 'No baseline value' : fmtDelta(kpi, c) + ' vs ' + fmtValue(kpi, c.baseline) + ' in ' + c.baseline_release,
              c.limit_margin != null ? ' · ' + (c.limit_violated ? 'outside limit by ' : 'margin to limit ') + Math.abs(c.limit_margin).toFixed(Math.max(kpi.decimals ?? 2, 1)) + unitOf(kpi) : ''),
            chart(kpi, v.id, rel));
        }))),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Values by release' + (kpi.unit ? ' in ' + kpi.unit : ''))),
        h('div', { class: 'card scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'sticky-col' }, 'Variant'), D.releases.map((r) => h('th', { scope: 'col', class: 'r' }, r.id + (r.id === rel ? ' ◂' : ''))))),
          h('tbody', {}, D.variants.map((v) => h('tr', {}, h('th', { scope: 'row', class: 'sticky-col' }, v.name),
            D.releases.map((r) => {
              const c = cell(r.id, v.id, kpi.id);
              return h('td', { class: 'r' }, h('div', { style: 'display:flex;justify-content:flex-end;align-items:center;gap:6px' }, RANK[c.status] > 0 || c.status === 'improved' ? mark(c.status) : null, h('span', { style: 'font-weight:650' }, fmtValue(kpi, c.value))),
                h('div', { class: 'small muted' }, c.report_url && /^https?:\/\//.test(c.report_url) ? h('a', { href: c.report_url, target: '_blank', rel: 'noopener' }, fmtDelta(kpi, c) || 'Report') : fmtDelta(kpi, c) || ' '));
            }))))))));
  }

  // ---------- Compare ----------
  function viewCompare(root, p) {
    const b = curRelease(p, 'b');
    const a = relIdx(p.get('a')) >= 0 ? p.get('a') : D.releases[Math.max(0, relIdx(b) - 1)].id;
    const only = p.get('ch') === '1';
    const opts = D.releases.map((r) => [r.id, r.id]);
    const rows = [];
    for (const kpi of D.kpis) for (const v of D.variants) {
      const ca = cell(a, v.id, kpi.id), cb = cell(b, v.id, kpi.id);
      const both = ca.value != null && cb.value != null, diff = both ? cb.value - ca.value : null;
      const changed = ca.status !== cb.status;
      if (only && !changed) continue;
      let change = '–';
      if (both) change = signed(diff, Math.max(kpi.decimals ?? 2, 1)) + unitOf(kpi) + (ca.value ? ' (' + signed(diff / ca.value * 100, 2) + ' %)' : '');
      const trend = RANK[cb.status] > RANK[ca.status] ? 'Worse' : RANK[cb.status] < RANK[ca.status] ? 'Better' : changed ? 'Changed' : '';
      rows.push(h('tr', {},
        h('th', { scope: 'row' }, h('a', { class: 'kpi-name', href: href('kpi', { id: kpi.id, r: b }) }, kpi.name), h('div', { class: 'small muted' }, v.name)),
        h('td', { class: 'r' }, fmtValue(kpi, ca.value)), h('td', {}, badge(ca.status)),
        h('td', { class: 'r' }, fmtValue(kpi, cb.value)), h('td', {}, badge(cb.status)),
        h('td', { class: 'r' }, change), h('td', {}, trend ? h('span', { class: 'tag' }, trend) : null)));
    }
    root.append(
      h('div', { class: 'controls' },
        select('From', opts, a, (v) => patch({ a: v }), 'cmp-a'), select('To', opts, b, (v) => patch({ b: v }), 'cmp-b'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'only-changed', checked: only, onchange: (e) => patch({ ch: e.target.checked ? '1' : '' }) }), 'Only status changes'),
        h('span', { class: 'small muted' }, rows.length + ' rows')),
      rows.length ? h('div', { class: 'card scroll tall' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'KPI and variant'),
          h('th', { scope: 'col', class: 'r' }, a), h('th', { scope: 'col' }, 'Status in ' + a),
          h('th', { scope: 'col', class: 'r' }, b), h('th', { scope: 'col' }, 'Status in ' + b),
          h('th', { scope: 'col', class: 'r' }, 'Change ' + a + ' → ' + b), h('th', { scope: 'col' }, ''))),
        h('tbody', {}, rows)))
        : h('p', { class: 'card pad muted', style: 'margin:0' }, 'No status changed between ' + a + ' and ' + b + '.'));
  }

  // ---------- Details ----------
  function viewDetails(root, p) {
    const f = { r: p.get('r') || 'all', v: p.get('v') || 'all', k: p.get('k') || 'all', s: p.get('s') || 'all' };
    const rows = D.cells.filter((c) => (f.r === 'all' || c.release === f.r) && (f.v === 'all' || c.variant === f.v) && (f.k === 'all' || c.kpi === f.k) && (f.s === 'all' || c.status === f.s))
      .sort((a, b) => relIdx(b.release) - relIdx(a.release) || severity(kpiById(b.kpi), b) - severity(kpiById(a.kpi), a));
    const set = (key) => (v) => patch({ [key]: v === 'all' ? '' : v });
    root.append(
      h('div', { class: 'controls' },
        select('Release', [['all', 'All releases'], ...D.releases.map((r) => [r.id, r.id])], f.r, set('r'), 'f-r'),
        select('Variant', [['all', 'All variants'], ...D.variants.map((v) => [v.id, v.name])], f.v, set('v'), 'f-v'),
        select('KPI', [['all', 'All KPIs'], ...D.kpis.map((k) => [k.id, k.name])], f.k, set('k'), 'f-k'),
        select('Status', [['all', 'All statuses'], ...Object.entries(STATUS).map(([id, st]) => [id, st.label])], f.s, set('s'), 'f-s'),
        h('button', { type: 'button', onclick: () => downloadCsv(rows) }, 'Download CSV'),
        h('span', { class: 'small muted' }, rows.length + ' rows')),
      h('div', { class: 'card scroll tall' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Release', 'Variant', 'KPI'].map((t) => h('th', { scope: 'col' }, t)),
          ['Value', 'Baseline', 'Change', 'Margin to limit'].map((t) => h('th', { scope: 'col', class: 'r' }, t)),
          ['Status', 'Measured', 'Report'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.length ? rows.map((c) => {
          const kpi = kpiById(c.kpi);
          return h('tr', {},
            h('td', {}, c.release), h('td', {}, variantName(c.variant)),
            h('td', {}, h('a', { class: 'kpi-name', href: href('kpi', { id: kpi.id, r: c.release }) }, kpi.name), kpi.unit ? h('span', { class: 'small muted' }, ' ' + kpi.unit) : null),
            h('td', { class: 'r' }, fmtValue(kpi, c.value)),
            h('td', { class: 'r muted' }, fmtValue(kpi, c.baseline)),
            h('td', { class: 'r' }, fmtDelta(kpi, c) || '–'),
            h('td', { class: 'r' }, c.limit_margin == null ? '–' : signed(c.limit_margin, Math.max(kpi.decimals ?? 2, 1))),
            h('td', {}, badge(c.status)),
            h('td', { class: 'small', style: 'white-space:nowrap' }, c.measured_at ? c.measured_at.slice(0, 10) : '–'),
            h('td', {}, /^https?:\/\//.test(c.report_url || '') ? h('a', { href: c.report_url, target: '_blank', rel: 'noopener' }, 'Open report') : h('span', { class: 'muted' }, '–')));
        }) : h('tr', {}, h('td', { colspan: 10, class: 'muted' }, 'No rows match these filters.'))))));
  }
  function downloadCsv(rows) {
    const head = ['release', 'variant', 'kpi', 'unit', 'value', 'baseline_release', 'baseline', 'delta_abs', 'delta_pct', 'status', 'limit_margin', 'verdict', 'measured_at', 'report_url'];
    const esc = (v) => {
      if (v == null) return '';
      let t = String(v);
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const lines = [head.join(',')].concat(rows.map((c) => {
      const kpi = kpiById(c.kpi);
      return [c.release, variantName(c.variant), kpi.name, kpi.unit, c.value, c.baseline_release, c.baseline, c.delta_abs, c.delta_pct, c.status, c.limit_margin, c.verdict, c.measured_at, c.report_url].map(esc).join(',');
    }));
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const a = h('a', { href: url, download: 'release-kpis.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Shell ----------
  const VIEWS = { release: viewRelease, history: viewHistory, kpi: viewKpi, compare: viewCompare, details: viewDetails };
  function render() {
    if (!D) return;
    const { view, p } = route();
    const active = document.activeElement, focusId = active && active.id;
    const caret = focusId === 'q' ? active.selectionStart : null;
    const r = relIdx(p.get('r')) >= 0 ? p.get('r') : null;
    document.getElementById('tabs').replaceChildren(...TABS.map(([id, label]) => {
      const params = id === 'release' || id === 'kpi' ? { r, id: id === 'kpi' ? p.get('id') : null } : id === 'compare' ? { b: r } : {};
      return h('a', { href: id === view ? location.hash || '#release' : href(id, params), 'aria-current': id === view ? 'page' : null }, label);
    }));
    const root = document.getElementById('view');
    root.replaceChildren();
    VIEWS[view](root, p);
    document.title = (view === 'kpi' ? (kpiById(p.get('id')) || D.kpis[0]).name + ' · ' : view === 'release' ? curRelease(p) + ' · ' : '') + 'Release KPI dashboard';
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (caret != null) el.setSelectionRange(caret, caret); }
    }
  }

  fetch('data/bundle.json', { cache: 'no-store' })
    .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then((bundle) => {
      D = bundle;
      for (const c of D.cells) index.set(c.release + '|' + c.variant + '|' + c.kpi, c);
      const asOf = D.data_as_of ? D.data_as_of.replace('T', ' ').replace('Z', ' UTC') : 'unknown';
      document.getElementById('meta').textContent = 'Data as of ' + asOf + ' · build ' + D.commit;
      document.getElementById('sample-banner').hidden = !D.sample_data;
      window.addEventListener('hashchange', render);
      render();
    })
    .catch((err) => {
      document.getElementById('view').replaceChildren(h('p', { class: 'banner' }, 'Couldn’t load KPI data (' + err.message + '). Run the build step, then reload.'));
    });
})();
