// Small HTML/SVG chart helpers. Marks carry colour; text stays in text tokens.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tipAttr = (html) => (html ? ` data-tip="${esc(html)}"` : '');

export function tile(label, value, sub = '', cmp = '') {
  return `<div class="card tile"><div class="label">${label}</div><div class="value">${value}</div>` +
    `<div class="cmp">${sub}</div>${cmp ? `<div class="cmp">${cmp}</div>` : ''}</div>`;
}

// items: [label, color, shape?]  shape: 'dot' | 'ring' | 'x' | 'sq'
export function legend(items) {
  return `<div class="legend">${items.map(([label, color, shape]) => {
    let key;
    if (shape === 'x') key = `<i class="x" style="color:${color}">✕</i>`;
    else if (shape === 'sq') key = '<i class="sq"></i>';
    else if (shape === 'ring') key = `<i class="dot" style="background:none;border:2px solid ${color}"></i>`;
    else key = `<i class="${shape === 'dot' ? 'dot' : ''}" style="background:${color}"></i>`;
    return `<span>${key}${esc(label)}</span>`;
  }).join('')}</div>`;
}

// Horizontal share bars. items: {label, n, d, icon?, attr?, on?}. opts.mark = reference rate (0..1).
// icon is trusted HTML shown before the label; attr makes the row clickable (e.g. data-map="haven").
export function barList(items, opts = {}) {
  const color = opts.color || 'var(--def)';
  const rates = items.map((it) => (it.d ? it.n / it.d : 0));
  const max = Math.max(0.05, ...rates, opts.mark || 0) * 1.08;
  return `<div class="bars">${items.map((it, i) => {
    const r = rates[i];
    const thin = it.d < 8;
    const tip = `<b>${esc(it.label)}</b><span class="muted">${it.n} of ${it.d}${it.d ? ` (${(100 * r).toFixed(1)}%)` : ''}${thin && it.d ? ' · small sample' : ''}</span>`;
    const at = it.attr ? ` ${it.attr}` : '';
    const cls = `${it.attr ? ' click' : ''}${it.on ? ' on' : ''}`;
    return `<span class="lab${cls}"${at}${tipAttr(tip)}>${it.icon || ''}${esc(it.label)}</span>` +
      `<span class="track${cls}"${at}${tipAttr(tip)}><span class="fill" style="width:${(100 * r / max).toFixed(1)}%;background:${color};${thin ? 'opacity:.45' : ''}"></span>` +
      (opts.mark != null ? `<span class="mark" style="left:${(100 * opts.mark / max).toFixed(1)}%"></span>` : '') + '</span>' +
      `<span class="val${cls}"${at}>${it.d ? Math.round(100 * r) + '%' : '–'} <small>${it.n.toLocaleString()}/${it.d.toLocaleString()}</small></span>`;
  }).join('')}</div>`;
}

// Clean axis: the smallest "nice" step that needs at most five intervals.
function axis(max) {
  for (let p = 1; ; p *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * p;
      if (max / step <= 5) return { step, top: Math.max(step, Math.ceil(max / step) * step) };
    }
  }
}

// Vertical grouped bars. series: [{name, color, vals}], tip(series, catIndex, value) -> html
export function barChart({ cats, series, height = 210, unit = '', tip, wide = false }) {
  const W = wide ? 1180 : 560, H = height, m = { l: 34, r: 8, t: 14, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const { step, top } = axis(Math.max(1, ...series.flatMap((s) => s.vals)));
  const y = (v) => m.t + ph - (v / top) * ph;
  const band = pw / cats.length;
  const bw = Math.max(3, Math.min(24, (band - 8) / series.length - 2));
  const groupW = series.length * bw + (series.length - 1) * 2;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    const yy = y(v);
    g += `<line class="${v ? 'gl' : 'ax'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>` +
      `<text x="${m.l - 6}" y="${yy + 3.5}" text-anchor="end">${v}${unit}</text>`;
  }
  const every = Math.ceil(cats.length / Math.floor(pw / 44));
  cats.forEach((c, i) => {
    const cx = m.l + band * i + band / 2;
    if (i % every === 0) g += `<text x="${cx}" y="${H - 7}" text-anchor="middle">${esc(c)}</text>`;
    series.forEach((s, si) => {
      const v = s.vals[i];
      const x = cx - groupW / 2 + si * (bw + 2);
      const hgt = Math.max(v > 0 ? 1.5 : 0, m.t + ph - y(v));
      const r = Math.min(4, bw / 2, hgt);
      const y0 = m.t + ph, y1 = y0 - hgt;
      const d = `M${x},${y0}V${y1 + r}q0,${-r} ${r},${-r}h${bw - 2 * r}q${r},0 ${r},${r}V${y0}Z`;
      // generous invisible hit area so thin or empty bars still give a tooltip
      g += `<g${tipAttr(tip ? tip(s, i, v) : `<b>${esc(c)}</b> ${v}${unit}`)}><rect x="${x - 1}" y="${m.t}" width="${bw + 2}" height="${ph}" fill="transparent"/>` +
        (hgt > 0 ? `<path class="bar" d="${d}" fill="${s.color}"/>` : '') + '</g>';
    });
  });
  // label only the tallest bar of each series
  series.forEach((s, si) => {
    const mx = Math.max(...s.vals);
    if (mx <= 0) return;
    const i = s.vals.indexOf(mx);
    const cx = m.l + band * i + band / 2 - groupW / 2 + si * (bw + 2) + bw / 2;
    g += `<text x="${cx}" y="${y(mx) - 4}" text-anchor="middle" style="fill:var(--text-2)">${mx}${unit}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} by ${esc(cats[0])} to ${esc(cats[cats.length - 1])}">${g}</svg>`;
}
