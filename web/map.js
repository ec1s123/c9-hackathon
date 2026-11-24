// Canvas minimap: projection from game coordinates, heat layer, markers, hover.
const SURFACE = '#1a1a19';
const RAMP = [[24, 79, 149], [57, 135, 229], [134, 182, 239], [205, 226, 251]]; // one hue, dark -> bright
// Second magnitude layer on the same map takes the next hue, again as a one-hue ramp.
export const RAMP_WARM = [[122, 44, 14], [217, 89, 38], [238, 150, 112], [252, 222, 208]];
const imgs = new Map(), loaded = new Map();

function loadImg(src) {
  if (!imgs.has(src)) {
    imgs.set(src, new Promise((res) => {
      const i = new Image();
      i.onload = () => { loaded.set(src, i); res(i); };
      i.onerror = () => res(null);
      i.src = src;
    }));
  }
  return imgs.get(src);
}

function ramp(f, R = RAMP) {
  const x = Math.max(0, Math.min(1, f)) * (R.length - 1);
  const i = Math.min(R.length - 2, Math.floor(x)), w = x - i;
  return R[i].map((c, k) => Math.round(c + (R[i + 1][k] - c) * w));
}

/** Resolves to fn(x, y) -> is this spot (game units) open floor on the minimap. Always true with no image. */
export async function walkableFor(meta) {
  const img = meta ? await loadImg('../data/' + meta.img) : null;
  if (!img) return () => true;
  if (!meta._mask) {
    const w = img.naturalWidth, cv = document.createElement('canvas');
    cv.width = cv.height = w;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, w).data, m = new Uint8Array(w * w);
    for (let i = 0; i < w * w; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    meta._mask = { w, m };
  }
  const { w, m } = meta._mask;
  return (x, y) => { const i = Math.floor((y * meta.xm + meta.xa) * w), j = Math.floor((x * meta.ym + meta.ya) * w); return i >= 0 && j >= 0 && i < w && j < w && m[j * w + i] === 1; };
}

/** Nearest callout label, e.g. "A Main". Approximate by construction. */
export function zoneOf(meta, x, y) {
  if (!meta || !meta.callouts || !meta.callouts.length) return '';
  let best = '', bd = Infinity;
  for (const c of meta.callouts) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) { bd = d; best = c.name; }
  }
  return best;
}

export class MapView {
  constructor(canvas, meta, ops) {
    this.cv = canvas; this.meta = meta; this.hot = []; this.lines = []; this.marks = [];
    const css = Math.max(320, Math.round(canvas.clientWidth || 700));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = css * dpr; canvas.height = css * dpr;
    this.size = css;
    this.ctx = canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // game coords -> image fraction (0..1)
    if (meta) this.uv = (x, y) => [y * meta.xm + meta.xa, x * meta.ym + meta.ya];
    else this.uv = (x, y) => [x, y];
    // crop to where the map (and the data) actually is, kept square
    const pts = [];
    if (meta) meta.callouts.forEach((c) => pts.push(this.uv(c.x, c.y)));
    ops.forEach((o) => o.pts.forEach((p) => pts.push(this.uv(p.x, p.y))));
    let u0 = 0, v0 = 0, span = 1;
    if (pts.length) {
      const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
      const [a, b, c, d] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      span = Math.max(b - a, d - c) * 1.16 || 1;
      u0 = (a + b) / 2 - span / 2; v0 = (c + d) / 2 - span / 2;
      if (meta) { span = Math.min(1, span); u0 = Math.max(0, Math.min(1 - span, u0)); v0 = Math.max(0, Math.min(1 - span, v0)); }
    }
    this.crop = { u0, v0, span };
    this.P = (x, y) => { const [u, v] = this.uv(x, y); return [((u - u0) / span) * css, ((v - v0) / span) * css]; };
    this.ready = meta ? loadImg('../data/' + meta.img).then((i) => { this.img = i; }) : Promise.resolve();

    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect();
      const k = this.size / r.width;
      const h = this.hit((e.clientX - r.left) * k, (e.clientY - r.top) * k);
      canvas.style.cursor = h && h.click ? 'pointer' : 'default';
      window.showTip(h ? h.tip : null, e.clientX, e.clientY);
    };
    canvas.onmouseleave = () => window.showTip(null);
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const k = this.size / r.width;
      const h = this.hit((e.clientX - r.left) * k, (e.clientY - r.top) * k);
      if (h && h.click) { window.showTip(null); h.click(); }
    };
  }

  hit(x, y) {
    let best = null, bd = 11 ** 2;
    for (const h of this.hot) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  }

  base() {
    const { ctx, size, crop } = this;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#111110';
    ctx.fillRect(0, 0, size, size);
    if (this.img) {
      const w = this.img.naturalWidth;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.img, crop.u0 * w, crop.v0 * w, crop.span * w, crop.span * w, 0, 0, size, size);
      ctx.globalAlpha = 1;
    }
    if (this.meta) {
      ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(240,239,236,.42)';
      this.meta.callouts.forEach((c) => { const [x, y] = this.P(c.x, c.y); ctx.fillText(c.name, x, y); });
    }
  }

  /** Time-weighted position density of the Op holder within [w0, w1] seconds. */
  heat(ops, w0, w1) {
    const N = 132, g = new Float32Array(N * N), k = N / this.size;
    const put = (x, y, w) => {
      const [px, py] = this.P(x, y);
      const i = Math.floor(px * k), j = Math.floor(py * k);
      if (i >= 0 && j >= 0 && i < N && j < N) g[j * N + i] += w;
    };
    for (const o of ops) {
      const p = o.pts;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[i + 1] || { t: a.t + 1, x: a.x, y: a.y };
        const t0 = Math.max(a.t, w0), t1 = Math.min(b.t, w1);
        if (t1 <= t0) continue;
        const dt = Math.min(t1 - t0, 8), steps = Math.max(1, Math.ceil(dt / 0.5));
        for (let s = 0; s < steps; s++) {
          const f = (t0 - a.t + ((s + 0.5) / steps) * (t1 - t0)) / Math.max(0.001, b.t - a.t);
          put(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, dt / steps);
        }
      }
    }
    this._paint(g, N);
  }

  /** Density of plain points. each(put) calls put(x, y, weight) once per point. */
  heatPoints(each, colors = RAMP, alpha = 1) {
    const N = 132, g = new Float32Array(N * N), k = N / this.size;
    each((x, y, w = 1) => {
      const [px, py] = this.P(x, y);
      const i = Math.floor(px * k), j = Math.floor(py * k);
      if (i >= 0 && j >= 0 && i < N && j < N) g[j * N + i] += w;
    });
    this._paint(g, N, colors, alpha);
  }

  _paint(g, N, colors = RAMP, alpha = 1) {
    const blur = (src) => {
      const tmp = new Float32Array(N * N), out = new Float32Array(N * N), R = 2;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let s = 0; for (let d = -R; d <= R; d++) { const q = i + d; if (q >= 0 && q < N) s += src[j * N + q]; } tmp[j * N + i] = s / (2 * R + 1); }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let s = 0; for (let d = -R; d <= R; d++) { const q = j + d; if (q >= 0 && q < N) s += tmp[q * N + i]; } out[j * N + i] = s / (2 * R + 1); }
      return out;
    };
    const b = blur(blur(g));
    const nz = Array.from(b).filter((v) => v > 0).sort((x, y) => x - y);
    if (!nz.length) return;
    const top = nz[Math.floor(nz.length * 0.99)] || nz[nz.length - 1];
    const off = document.createElement('canvas');
    off.width = off.height = N;
    const octx = off.getContext('2d'), im = octx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const f = Math.min(1, b[i] / top) ** 0.55;
      if (f < 0.04) continue;
      const [r, gg, bb] = ramp(f, colors);
      im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = bb; im.data[i * 4 + 3] = Math.round(255 * Math.min(0.9, 0.15 + f * 0.8));
    }
    octx.putImageData(im, 0, 0);
    this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(off, 0, 0, this.size, this.size);
    this.ctx.globalAlpha = 1;
  }

  _hot(x, y, tip, click) { if (tip) this.hot.push({ x, y, tip, click }); }
  line(x1, y1, x2, y2, color) { this.lines.push({ a: this.P(x1, y1), b: this.P(x2, y2), color }); }
  /** A plain segment with no end marker, e.g. from where a player stood to where the ability went. */
  tick(x1, y1, x2, y2, color, alpha = 0.5) { this.lines.push({ a: this.P(x1, y1), b: this.P(x2, y2), color, alpha, bare: true }); }
  /** Faint mark with no tooltip: context behind the highlighted ones. */
  speck(x, y, color) { const [px, py] = this.P(x, y); this.marks.unshift({ k: 'speck', px, py, color }); }
  dot(x, y, color, tip, click, label) { const [px, py] = this.P(x, y); this.marks.push({ k: 'dot', px, py, color, label }); this._hot(px, py, tip, click); }
  small(x, y, color, tip) { const [px, py] = this.P(x, y); this.marks.unshift({ k: 'small', px, py, color }); this._hot(px, py, tip); }
  ring(x, y, color, tip, click) { const [px, py] = this.P(x, y); this.marks.unshift({ k: 'ring', px, py, color }); this._hot(px, py, tip, click); }
  /** Load images that portrait() will draw. Resolves when they are ready (or failed). */
  preload(srcs) { return Promise.all(srcs.filter(Boolean).map(loadImg)); }
  /** A round picture (an agent's face) with a surface ring. Falls back to a plain dot. */
  portrait(x, y, src, tip, click) { const [px, py] = this.P(x, y); this.marks.push({ k: 'img', px, py, src }); this._hot(px, py, tip, click); }
  /** Dashed circle of a real-world radius (cm): "somewhere about here". */
  target(x, y, radiusCm, color, tip) { const [px, py] = this.P(x, y); const [qx, qy] = this.P(x + radiusCm, y); this.marks.push({ k: 'target', px, py, color, r: Math.max(8, Math.hypot(qx - px, qy - py)) }); this._hot(px, py, tip); }
  cross(x, y, color, tip, click) { const [px, py] = this.P(x, y); this.marks.push({ k: 'x', px, py, color }); this._hot(px, py, tip, click); }
  square(x, y, tip, click) { const [px, py] = this.P(x, y); this.marks.unshift({ k: 'sq', px, py }); this._hot(px, py, tip, click); }

  path(pts, color, width = 1.5) {
    const { ctx } = this;
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = this.P(p.x, p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke();
  }

  /** One round's path, shaded from dark (early) to bright (late). */
  timedPath(pts) {
    const { ctx } = this;
    if (pts.length < 2) return;
    const t0 = pts[0].t, span = Math.max(1, pts[pts.length - 1].t - t0);
    ctx.lineWidth = 2.5; ctx.lineJoin = ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = this.P(pts[i - 1].x, pts[i - 1].y), [x2, y2] = this.P(pts[i].x, pts[i].y);
      const [r, g, b] = ramp((pts[i].t - t0) / span);
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  flush() {
    const { ctx } = this;
    for (const l of this.lines) {
      ctx.strokeStyle = l.color; ctx.globalAlpha = l.alpha ?? 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l.a[0], l.a[1]); ctx.lineTo(l.b[0], l.b[1]); ctx.stroke();
      if (l.bare) continue;
      ctx.globalAlpha = 0.9; ctx.fillStyle = l.color;
      ctx.beginPath(); ctx.arc(l.b[0], l.b[1], 1.8, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const m of this.marks) {
      const { px: x, py: y } = m;
      if (m.k === 'dot') {
        const r = m.label ? 7 : 5;
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 7); ctx.fillStyle = SURFACE; ctx.fill();   // surface ring
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = m.color; ctx.fill();
        if (m.label) { ctx.fillStyle = '#fff'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(m.label, x, y + 0.5); ctx.textBaseline = 'alphabetic'; }
      } else if (m.k === 'speck') {
        ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fillStyle = m.color; ctx.fill(); ctx.globalAlpha = 1;
      } else if (m.k === 'small') {
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = SURFACE; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fillStyle = m.color; ctx.fill();
      } else if (m.k === 'img') {
        const im = loaded.get(m.src), r = 11;
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 7); ctx.fillStyle = SURFACE; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#383835'; ctx.fill();
        if (im) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip(); ctx.drawImage(im, x - r, y - r, 2 * r, 2 * r); ctx.restore(); }
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.lineWidth = 1.5; ctx.strokeStyle = '#d95926'; ctx.stroke();
      } else if (m.k === 'target') {
        for (const [w, c2] of [[5, SURFACE], [2, m.color]]) {
          ctx.lineWidth = w; ctx.strokeStyle = c2; ctx.setLineDash(w === 2 ? [4, 3] : []);
          ctx.beginPath(); ctx.arc(x, y, m.r, 0, 7); ctx.stroke();
        }
        ctx.setLineDash([]);
      } else if (m.k === 'ring') {
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.lineWidth = 4; ctx.strokeStyle = SURFACE; ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = m.color; ctx.stroke();
      } else if (m.k === 'x') {
        const s = 5;
        for (const [w, c] of [[5.5, SURFACE], [2.5, m.color]]) {
          ctx.lineWidth = w; ctx.strokeStyle = c; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
        }
      } else if (m.k === 'sq') {
        ctx.lineWidth = 3.5; ctx.strokeStyle = SURFACE; ctx.strokeRect(x - 4, y - 4, 8, 8);
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#c3c2b7'; ctx.strokeRect(x - 4, y - 4, 8, 8);
      }
    }
  }
}
