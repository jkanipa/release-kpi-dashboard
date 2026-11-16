(function () {
  'use strict';

  const STATUS = {
    deviated: { label: 'Deviated', icon: '✕' },
    failed_test: { label: 'Test failed', icon: '✕' },
    warn: { label: 'Warning', icon: '!' },
    improved: { label: 'Improved', icon: '↗' },
    ok: { label: 'Within tolerance', icon: '✓' },
    missing: { label: 'Missing', icon: '–' },
    no_baseline: { label: 'No baseline', icon: '–' },
  };
  const SEVERITY = ['deviated', 'failed_test', 'warn', 'missing', 'no_baseline', 'improved', 'ok'];

  let data = null;
  let chart = null;
  const state = { release: null, kpi: null, compareA: null, compareB: null, fStatus: 'all', fVariant: 'all', fKpi: 'all', fRelease: 'all' };
  const index = new Map();

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const cell = (release, variant, kpi) => index.get(release + '|' + variant + '|' + kpi);
  const kpiById = (id) => data.kpis.find((k) => k.id === id);
  const variantName = (id) => data.variants.find((v) => v.id === id).name;
  const unitOf = (kpi) => (kpi.unit ? ' ' + kpi.unit : '');

  function fmtValue(kpi, v) {
    return v == null ? '–' : Number(v).toFixed(kpi.decimals ?? 2);
  }
  function signed(n, digits) {
    const s = Math.abs(n).toFixed(digits);
    if (Number(s) === 0) return '±' + s;
    return (n > 0 ? '+' : '−') + s;
  }
  function tolDelta(kpi, c) {
    return kpi.tolerance.mode === 'absolute' ? c.delta_abs : c.delta_pct;
  }
  function fmtDelta(kpi, c) {
    if (c.delta_abs == null) return '';
    if (kpi.tolerance.mode === 'absolute' || c.delta_pct == null) {
      return signed(c.delta_abs, Math.max(kpi.decimals ?? 2, 1)) + unitOf(kpi);
    }
    return signed(c.delta_pct, 2) + ' %';
  }
  function fmtTolerance(kpi) {
    const u = kpi.tolerance.mode === 'absolute' ? unitOf(kpi) : ' %';
    return 'Tolerance ±' + kpi.tolerance.warn + ' / ±' + kpi.tolerance.fail + u;
  }
  function badge(status) {
    const s = STATUS[status] || { label: status, icon: '?' };
    return h('span', { class: 'badge ' + status }, h('span', { 'aria-hidden': 'true' }, s.icon), s.label);
  }
  function select(label, options, value, onchange) {
    const sel = h('select', { onchange: (e) => onchange(e.target.value) },
      options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
    return h('label', {}, label, sel);
  }
  function releaseOptions() {
    const baselines = new Set([data.baseline.default, ...Object.values(data.baseline.variants || {})]);
    return data.releases.map((r) => [r.id, r.id + (baselines.has(r.id) ? ' (baseline)' : '')]);
  }
  function baselineText() {
    const overrides = Object.entries(data.baseline.variants || {});
    let text = 'Baseline ' + data.baseline.default;
    if (overrides.length) text += ' (' + overrides.map(([v, r]) => variantName(v) + ': ' + r).join(', ') + ')';
    return text;
  }

  // ---------- Overview ----------
  function viewOverview(root) {
    const cells = data.cells.filter((c) => c.release === state.release);
    const count = (...names) => cells.filter((c) => names.includes(c.status)).length;
    const tiles = [
      ['Deviated', count('deviated', 'failed_test')],
      ['Warning', count('warn')],
      ['Within tolerance', count('ok', 'improved')],
      ['Missing', count('missing', 'no_baseline')],
    ];
    root.append(
      h('div', { class: 'controls' },
        select('Release', releaseOptions(), state.release, (v) => { state.release = v; render(); }),
        h('span', { class: 'small muted' }, baselineText())),
      h('div', { class: 'tiles' }, tiles.map(([label, n]) =>
        h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'num' }, n)))),
      h('div', { class: 'card scroll' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'KPI'), data.variants.map((v) => h('th', { scope: 'col' }, v.name)))),
          h('tbody', {}, data.kpis.map((kpi) =>
            h('tr', {},
              h('th', { scope: 'row' },
                h('div', { class: 'kpi-name' }, h('a', { href: '#trend', onclick: () => { state.kpi = kpi.id; } }, kpi.name)),
                h('div', { class: 'small muted' }, [kpi.regulation, kpi.unit].filter(Boolean).join(' · ')),
                h('div', { class: 'small muted' }, fmtTolerance(kpi))),
              data.variants.map((v) => {
                const c = cell(state.release, v.id, kpi.id);
                return h('td', {},
                  h('div', { class: 'val' }, fmtValue(kpi, c.value)),
                  h('div', { class: 'delta' }, c.value == null ? 'No result' :
                    c.baseline == null ? 'No baseline value' : fmtDelta(kpi, c) + ' vs ' + fmtValue(kpi, c.baseline)),
                  badge(c.status),
                  c.limit_violated ? h('div', { class: 'small muted' }, 'Over limit') : null);
              })))))));
  }

  // ---------- Trend ----------
  function viewTrend(root) {
    const kpi = kpiById(state.kpi);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const colors = dark ? ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'] : ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
    const dashes = [[], [6, 4], [2, 3], [10, 3, 2, 3], [1, 4], [8, 2]];
    const shapes = ['circle', 'rect', 'triangle', 'rectRot', 'star', 'crossRot'];
    const red = dark ? '#e66767' : '#d03b3b';
    const unit = kpi.tolerance.mode === 'absolute' ? unitOf(kpi) : ' %';
    const labels = data.releases.map((r) => r.id);

    const canvas = h('canvas', { role: 'img', 'aria-label': kpi.name + ': change from baseline per release and variant. The table below has the same data.' });
    root.append(
      h('div', { class: 'controls' },
        select('KPI', data.kpis.map((k) => [k.id, k.name + ' (' + k.regulation + ')']), state.kpi, (v) => { state.kpi = v; render(); }),
        h('span', { class: 'small muted' }, fmtTolerance(kpi) + ' · ' + baselineText())),
      h('ul', { class: 'legend' },
        data.variants.map((v, i) => h('li', {}, swatch(colors[i % 6], dashes[i % 6], 2), v.name)),
        h('li', {}, swatch(red, [4, 4], 1), 'Fail tolerance')),
      h('div', { class: 'card chart-box' }, canvas));

    const datasets = data.variants.map((v, i) => ({
      label: v.name,
      data: labels.map((r) => { const d = tolDelta(kpi, cell(r, v.id, kpi.id)); return d == null ? null : +d.toFixed(3); }),
      borderColor: colors[i % 6], backgroundColor: colors[i % 6], borderWidth: 2, borderDash: dashes[i % 6],
      pointStyle: shapes[i % 6], pointRadius: 4, pointHoverRadius: 6, tension: 0,
    }));
    for (const y of [kpi.tolerance.fail, -kpi.tolerance.fail]) {
      datasets.push({ label: 'Fail tolerance', data: labels.map(() => y), borderColor: red, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0 });
    }
    const ink = '#898781';
    chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { filter: (item) => item.datasetIndex < data.variants.length, callbacks: { label: (c) => c.dataset.label + ': ' + signed(c.parsed.y, 2) + unit } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: ink } },
          y: { grid: { color: dark ? '#2c2c2a' : '#e1e0d9' }, ticks: { color: ink, callback: (v) => signed(v, 1) + unit }, title: { display: true, text: 'Change vs baseline', color: ink } },
        },
      },
    });

    root.append(
      h('h2', {}, 'Values' + (kpi.unit ? ' in ' + kpi.unit : '')),
      h('div', { class: 'card scroll' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Variant'), labels.map((r) => h('th', { scope: 'col', class: 'num-col' }, r)))),
          h('tbody', {}, data.variants.map((v) =>
            h('tr', {}, h('th', { scope: 'row' }, v.name), labels.map((r) => {
              const c = cell(r, v.id, kpi.id);
              return h('td', { class: 'num-col' }, h('div', {}, fmtValue(kpi, c.value)), h('div', { class: 'small muted' }, fmtDelta(kpi, c) || ' '));
            })))))));
  }
  function swatch(color, dash, width) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '24'); svg.setAttribute('height', '8'); svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(ns, 'line');
    for (const [k, v] of Object.entries({ x1: 0, y1: 4, x2: 24, y2: 4, stroke: color, 'stroke-width': width, 'stroke-dasharray': dash.join(' ') })) line.setAttribute(k, v);
    svg.append(line);
    return svg;
  }

  // ---------- Compare ----------
  function viewCompare(root) {
    const opts = data.releases.map((r) => [r.id, r.id]);
    root.append(h('div', { class: 'controls' },
      select('From', opts, state.compareA, (v) => { state.compareA = v; render(); }),
      select('To', opts, state.compareB, (v) => { state.compareB = v; render(); })));
    const rows = [];
    for (const kpi of data.kpis) {
      for (const v of data.variants) {
        const a = cell(state.compareA, v.id, kpi.id);
        const b = cell(state.compareB, v.id, kpi.id);
        const both = a.value != null && b.value != null;
        const diff = both ? b.value - a.value : null;
        let change = '–';
        if (both) {
          change = signed(diff, Math.max(kpi.decimals ?? 2, 1)) + unitOf(kpi);
          if (a.value) change += ' (' + signed(diff / a.value * 100, 2) + ' %)';
        }
        rows.push(h('tr', {},
          h('th', { scope: 'row' }, h('span', { class: 'kpi-name' }, kpi.name), h('div', { class: 'small muted' }, v.name)),
          h('td', { class: 'num-col' }, fmtValue(kpi, a.value) + (a.value == null ? '' : unitOf(kpi))),
          h('td', {}, badge(a.status)),
          h('td', { class: 'num-col' }, fmtValue(kpi, b.value) + (b.value == null ? '' : unitOf(kpi))),
          h('td', {}, badge(b.status)),
          h('td', { class: 'num-col' }, change)));
      }
    }
    root.append(h('div', { class: 'card scroll' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'KPI and variant'),
        h('th', { scope: 'col', class: 'num-col' }, state.compareA), h('th', { scope: 'col' }, 'Status vs baseline'),
        h('th', { scope: 'col', class: 'num-col' }, state.compareB), h('th', { scope: 'col' }, 'Status vs baseline'),
        h('th', { scope: 'col', class: 'num-col' }, 'Change ' + state.compareA + ' → ' + state.compareB))),
      h('tbody', {}, rows))));
  }

  // ---------- Details ----------
  function detailRows() {
    return data.cells.filter((c) =>
      (state.fRelease === 'all' || c.release === state.fRelease) &&
      (state.fVariant === 'all' || c.variant === state.fVariant) &&
      (state.fKpi === 'all' || c.kpi === state.fKpi) &&
      (state.fStatus === 'all' || c.status === state.fStatus))
      .sort((a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status));
  }
  function viewDetails(root) {
    const rows = detailRows();
    const set = (key) => (v) => { state[key] = v; render(); };
    root.append(
      h('div', { class: 'controls' },
        select('Release', [['all', 'All releases'], ...data.releases.map((r) => [r.id, r.id])], state.fRelease, set('fRelease')),
        select('Variant', [['all', 'All variants'], ...data.variants.map((v) => [v.id, v.name])], state.fVariant, set('fVariant')),
        select('KPI', [['all', 'All KPIs'], ...data.kpis.map((k) => [k.id, k.name])], state.fKpi, set('fKpi')),
        select('Status', [['all', 'All statuses'], ...Object.entries(STATUS).map(([id, s]) => [id, s.label])], state.fStatus, set('fStatus')),
        h('button', { type: 'button', onclick: () => downloadCsv(rows) }, 'Download CSV'),
        h('span', { class: 'small muted' }, rows.length + ' rows')),
      h('div', { class: 'card scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Release', 'Variant', 'KPI'].map((t) => h('th', { scope: 'col' }, t)),
          ['Value', 'Baseline', 'Change'].map((t) => h('th', { scope: 'col', class: 'num-col' }, t)),
          ['Status', 'Measured', 'Report'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.length ? rows.map((c) => {
          const kpi = kpiById(c.kpi);
          return h('tr', {},
            h('td', {}, c.release), h('td', {}, variantName(c.variant)),
            h('td', {}, kpi.name, kpi.unit ? h('span', { class: 'small muted' }, ' ' + kpi.unit) : null),
            h('td', { class: 'num-col' }, fmtValue(kpi, c.value)),
            h('td', { class: 'num-col' }, fmtValue(kpi, c.baseline), h('div', { class: 'small muted' }, c.baseline_release)),
            h('td', { class: 'num-col' }, fmtDelta(kpi, c) || '–'),
            h('td', {}, badge(c.status), c.limit_violated ? h('div', { class: 'small muted' }, 'Over limit') : null),
            h('td', { class: 'small' }, c.measured_at ? c.measured_at.slice(0, 10) : '–'),
            h('td', {}, /^https?:\/\//.test(c.report_url || '') ? h('a', { class: 'report', href: c.report_url, target: '_blank', rel: 'noopener' }, 'Open report') : h('span', { class: 'muted' }, '–')));
        }) : h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'No rows match these filters.'))))));
  }
  function downloadCsv(rows) {
    const head = ['release', 'variant', 'kpi', 'unit', 'value', 'baseline_release', 'baseline', 'delta_abs', 'delta_pct', 'status', 'limit_margin', 'verdict', 'measured_at', 'report_url'];
    const esc = (v) => {
      if (v == null) return '';
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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
  const VIEWS = { overview: viewOverview, trend: viewTrend, compare: viewCompare, details: viewDetails };
  function render() {
    if (!data) return;
    if (chart) { chart.destroy(); chart = null; }
    const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
    for (const a of document.querySelectorAll('#tabs a')) {
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    const root = document.getElementById('view');
    root.replaceChildren();
    VIEWS[name](root);
  }

  fetch('data/bundle.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((bundle) => {
      data = bundle;
      for (const c of data.cells) index.set(c.release + '|' + c.variant + '|' + c.kpi, c);
      const last = data.releases[data.releases.length - 1].id;
      state.release = last;
      state.kpi = data.kpis[0].id;
      state.compareB = last;
      state.compareA = data.releases[Math.max(0, data.releases.length - 2)].id;
      const asOf = data.data_as_of ? data.data_as_of.replace('T', ' ').replace('Z', ' UTC') : 'unknown';
      document.getElementById('meta').textContent = 'Data as of ' + asOf + ' · build ' + data.commit;
      document.getElementById('sample-banner').hidden = !data.sample_data;
      window.addEventListener('hashchange', render);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
      render();
    })
    .catch((err) => {
      document.getElementById('view').replaceChildren(
        h('p', { class: 'banner' }, 'Couldn’t load KPI data (' + err.message + '). Run the build step, then reload.'));
    });
})();
