// Utility page: where every ability gets used, on one map and one side at a time.
// Reads data/util/<map>.json and data/util/index.json, written by etl/utility.py.
import { barChart, barList, legend, tile } from './charts.js';
import { MapView, RAMP_WARM, zoneOf } from './map.js';
import { teamLogo, agentIcon, agentImg, agentName, agentRole, abilityIcon, abilityName } from './icons.js';
import { KINDS, KIND_NAME, MODEL_NOTE, MODEL_SHORT, WALL_SHOT, abilityMeta, firstWall, reach } from './utilmeta.js';
import { circuitOf } from './league.js';

const DATA = '../data/';
const C = { heat: '#3987e5', after: '#d95926', focus: '#199e70', mark: '#c3c2b7' };
const SIDE = { a: 'Attack', d: 'Defense' };
const ROLES = [['all', 'All'], ['Sentinel', 'Sentinels'], ['Controller', 'Controllers'], ['Initiator', 'Initiators'], ['Duelist', 'Duelists']];
const OPEN_DS = 30;   // "as the barriers drop": the first 3 seconds
const WHEN = [['buy', 'Pre-round'], ['first3', 'First 3 s'], ['early', '3–30 s'], ['late', '30 s+'], ['post', 'After the plant'], ['all', 'Whole round']];
const WHEN_NAME = Object.fromEntries(WHEN);
const PRESETS = [
  ['Pre-round', { when: 'buy' }],
  ['First 3 seconds', { when: 'first3' }],
  ['Sentinel setups', { role: 'Sentinel', when: 'buy' }],
  ['After the plant', { when: 'post' }],
  ['Whole round', {}],
  ['Smokes & walls', { kind: 'smoke' }],
  ['Mollies', { kind: 'molly' }],
  ['Flashes', { kind: 'flash' }],
];
const FACETS = { role: 'all', kind: 'all', agent: 'all', ability: 'all', when: 'all' };
export const UTIL_DEFAULT = { map: '', side: 'd', team: 'all', comp: 'all', ...FACETS, when: 'buy' };   // opens on pre-round
const TOGETHER_CM = 500, TOGETHER_DS = 100;   // "used together": within 5 m and 10 s
const LINE_CM = 150, LINE_DEG = 5, LINE_MIN = 3;   // "lineup": same spot, same crosshair, 3+ rounds
// How a cast's landing spot is known (U.lq), best last.
const LQ = { NONE: 0, WALL: 1, FIT: 2, MATCH: 3, SEEN: 4, PLACED: 5 };
const LQ_TIP = ['', 'flat shot: shown at the first mapped wall on its line', 'landing estimated from the throw angle', 'landing taken from identical throws that hit someone', 'landing seen: it hit someone here', 'placed here'];
const MAX_MARKS = 3500, AUTO_MARKS = 800, SPOTS_ON_MAP = 12;
const MAX_FACES = 7;       // portraits on the map only while there are few enough to read
const FOCUS_LINES = 150;   // above this, lines to the later position would bury the map
/** Dots for each use: the reader's choice, or on by default once the selection is small enough to read. */
const showMarks = (v, n) => (v.pts == null ? n <= AUTO_MARKS : v.pts);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const pct = (n, d) => (!d ? '–' : n > 0 && n / d < 0.005 ? '<1%' : Math.round(100 * n / d) + '%');
const int = (n) => n.toLocaleString();
const plural = (n, w) => `${int(n)} ${w}${n === 1 ? '' : 's'}`;
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const when = (t) => (t < 0 ? `${Math.round(-t / 10)} s before barriers` : `${(t / 10).toFixed(1)} s in`);
const thumb = (maps, m) => (maps[m] ? `<img class="ico mapthumb" src="${DATA}${esc(maps[m].img)}" alt="">` : '');
const aimText = (p) => (Math.abs(p) < 2 ? 'crosshair level' : `crosshair ${Math.abs(p)}° ${p > 0 ? 'above' : 'below'} level`);
/** Enough to find one cast in a VOD: date, opponent, round, time. */
const castRef = (U, i) => { const g = U.games[U.c.g[i]]; return `${g.date} vs ${esc(U.teams[g.t[1 - U.slot[i]]].name)}, round ${U.c.rn[i]}, ${when(U.c.t[i])}`; };
const abTag = (a) => `<span class="tag">${agentIcon(a.agent)}${abilityIcon(a.id)}${esc(abilityName(a.id))}</span>`;

// ---------------------------------------------------------------- loading
/** Typed columns plus everything that only depends on the cast itself. */
export function prepUtil(U, UI, meta, walkable) {
  const c = U.c, n = c.x.length;
  U.n = n;
  U.after = UI.after;
  U.callouts = (meta && meta.callouts) || [];
  U.ab = U.abilities.map(([id, agent]) => {
    const m = abilityMeta(id), fit = UI.fit[id] || null;
    return { id, agent, meta: m, fit, role: agentRole(agent) };
  });
  U.teamIdx = new Map(U.teams.map((t, i) => [t.id, i]));
  U.circuits = [...new Set(U.events.map(circuitOf))];
  const plant = U.games.map((g) => new Map(g.pl));
  const lx = new Float32Array(n), ly = new Float32Array(n);
  const side = new Uint8Array(n), slot = new Uint8Array(n), post = new Uint8Array(n);
  const rk = new Int32Array(n), zone = new Int16Array(n), lq = new Uint8Array(n);
  const nearest = (x, y) => { let best = -1, bd = Infinity; for (let k = 0; k < U.callouts.length; k++) { const q = U.callouts[k], d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = k; } } return best; };
  for (let i = 0; i < n; i++) {
    const k = c.k[i], g = c.g[i], a = U.ab[c.ab[i]];
    side[i] = k & 1; slot[i] = (k >> 1) & 1;
    rk[i] = ((g * 128 + c.rn[i]) << 1) | slot[i];            // one team's round
    const pt = plant[g].get(c.rn[i]);
    post[i] = pt != null && c.t[i] >= pt * 10 ? 1 : 0;
    lx[i] = c.x[i]; ly[i] = c.y[i];
    if (a.meta.m === 'self' || a.meta.m === 'near') lq[i] = LQ.PLACED;
    if (c.yaw[i] != null) {
      const d = reach(a.meta, c.pit[i], a.fit), r = c.yaw[i] * Math.PI / 180;
      lx[i] += Math.cos(r) * d; ly[i] += Math.sin(r) * d;
      if (a.meta.m === 'throw' && a.fit) lq[i] = LQ.FIT;
      else if (walkable && c.pit[i] < WALL_SHOT.maxPitch && WALL_SHOT.abilities.includes(a.id)) {
        const hit = firstWall(c.x[i], c.y[i], c.yaw[i], c.pit[i], walkable);
        if (hit) { lx[i] = hit.x; ly[i] = hit.y; lq[i] = LQ.WALL; }
      }
    }
  }
  // Landings the build worked out from damage beat anything read off an angle.
  const o = U.o || { i: [] };
  for (let k = 0; k < o.i.length; k++) { const i = o.i[k]; lx[i] = o.x[k]; ly[i] = o.y[k]; lq[i] = o.q[k] === 2 ? LQ.SEEN : LQ.MATCH; }
  for (let i = 0; i < n; i++) zone[i] = nearest(lx[i], ly[i]);
  Object.assign(U, { lx, ly, lq, side, slot, post, rk, zone });
  return U;
}
const zoneName = (U, k) => (k >= 0 ? U.callouts[k].name : '');

/** Keep the filters consistent with each other and with what this map has. */
export function cleanUtil(f, U) {
  if (!['a', 'd'].includes(f.side)) f.side = 'd';
  if (f.when === 'first5') f.when = 'first3';     // older links
  if (!WHEN_NAME[f.when]) f.when = UTIL_DEFAULT.when;
  if (!ROLES.some(([v]) => v === f.role)) f.role = 'all';
  if (f.kind !== 'all' && !KIND_NAME[f.kind]) f.kind = 'all';
  if (!U) return;
  if (f.ability !== 'all') {
    const a = U.ab.find((x) => x.id === f.ability);
    if (!a) f.ability = 'all'; else { f.agent = a.agent; f.kind = 'all'; f.role = 'all'; }
  }
  if (f.agent !== 'all') {
    if (!U.ab.some((x) => x.agent === f.agent)) f.agent = 'all';
    else if (f.role !== 'all' && agentRole(f.agent) !== f.role) f.role = 'all';
  }
  if (f.comp !== 'all') {
    const name = f.comp.slice(2);
    if (!(f.comp.startsWith('c:') && U.circuits.includes(name)) && !(f.comp.startsWith('e:') && U.events.includes(name))) f.comp = 'all';
  }
}

// ---------------------------------------------------------------- the selection
function compute(U, f, src) {
  const key = JSON.stringify(f) + src;
  if (U._key === key) return U._res;
  const c = U.c, n = U.n, sd = f.side === 'd' ? 1 : 0;
  const evOK = f.comp === 'all' ? null : new Set(U.events.map((e, i) => [e, i]).filter(([e]) => (f.comp.startsWith('c:') ? circuitOf(e) === f.comp.slice(2) : e === f.comp.slice(2))).map(([, i]) => i));
  const ti = f.team === 'all' ? -1 : (U.teamIdx.has(f.team) ? U.teamIdx.get(f.team) : -2);
  // which (game, team) pairs are in scope
  const inScope = U.games.map((g) => [0, 1].map((s) => (!evOK || evOK.has(g.ev)) && (ti === -1 || g.t[s] === ti)));
  const memo = new Map();
  /** Rounds played on this side by in-scope teams that had all of these agents. */
  const roundsWith = (agents) => {
    const k = agents.join('+');
    if (!memo.has(k)) {
      let r = 0;
      U.games.forEach((g, gi) => [0, 1].forEach((s) => { if (inScope[gi][s] && agents.every((a) => g.ag[s].includes(a))) r += g.sr[s][sd]; }));
      memo.set(k, r);
    }
    return memo.get(k);
  };
  const whenOK = {
    all: () => true, buy: (i) => c.t[i] < 0, first3: (i) => c.t[i] >= 0 && c.t[i] <= OPEN_DS,
    early: (i) => c.t[i] > OPEN_DS && c.t[i] <= 300, late: (i) => c.t[i] > 300, post: (i) => U.post[i] === 1,
  }[f.when];
  const base = [], idx = [];
  const abN = new Int32Array(U.ab.length), agN = new Map();
  for (let i = 0; i < n; i++) {
    if (U.side[i] !== sd || !inScope[c.g[i]][U.slot[i]] || !whenOK(i)) continue;
    const a = U.ab[c.ab[i]];
    base.push(i);
    const roleOK = f.role === 'all' || a.role === f.role;
    const kindOK = f.kind === 'all' ? a.meta.k !== 'self' : a.meta.k === f.kind;
    const agentOK = f.agent === 'all' || a.agent === f.agent;
    if (roleOK && kindOK) agN.set(a.agent, (agN.get(a.agent) || 0) + 1);
    if (roleOK && agentOK && (kindOK || f.ability === a.id)) abN[c.ab[i]]++;
    if (f.ability !== 'all' ? a.id === f.ability : roleOK && kindOK && agentOK) idx.push(i);
  }
  const X = src === 'from' ? c.x : U.lx, Y = src === 'from' ? c.y : U.ly;
  U._key = key;
  U._res = { f, src, sd, ti, inScope, roundsWith, rounds: roundsWith([]), base, idx, abN, agN, X, Y };
  return U._res;
}

/** Places one ability keeps being used: grid cells grown into small clusters. */
function spots(U, R) {
  if (R.spots) return R.spots;
  const c = U.c, CELL = 200, key = (cx, cy) => (cx + 2000) * 4096 + (cy + 2000);
  const byAb = new Map();
  for (const i of R.idx) {
    let m = byAb.get(c.ab[i]);
    if (!m) byAb.set(c.ab[i], m = new Map());
    const k = key(Math.floor(R.X[i] / CELL), Math.floor(R.Y[i] / CELL));
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  const out = [];
  for (const [ab, cells] of byAb) {
    const a = U.ab[ab];
    const reachCells = a.meta.m === 'throw' && R.src !== 'from' ? 2 : 1;   // estimated landings scatter more
    const total = [...cells.values()].reduce((s, v) => s + v.length, 0);
    const min = Math.max(3, Math.ceil(total * 0.01));
    const used = new Set();
    for (const [k] of [...cells].sort((p, q) => q[1].length - p[1].length)) {
      if (used.has(k)) continue;
      const cx = Math.floor(k / 4096), cy = k % 4096, ids = [];
      for (let dx = -reachCells; dx <= reachCells; dx++) for (let dy = -reachCells; dy <= reachCells; dy++) {
        const q = (cx + dx) * 4096 + (cy + dy);
        if (cells.has(q) && !used.has(q)) { used.add(q); ids.push(...cells.get(q)); }
      }
      if (ids.length < min) continue;
      let sx = 0, sy = 0;
      const rounds = new Set(), zones = new Map(), afterZ = new Map(), ts = [];
      let afterN = 0, stay = 0;
      for (const i of ids) {
        sx += R.X[i]; sy += R.Y[i]; rounds.add(U.rk[i]); ts.push(c.t[i]);
        if (c.px[i] != null) {
          afterN++;
          const z = zoneOf({ callouts: U.callouts }, c.px[i], c.py[i]);
          afterZ.set(z, (afterZ.get(z) || 0) + 1);
          if (Math.hypot(c.px[i] - c.x[i], c.py[i] - c.y[i]) <= 500) stay++;
        }
      }
      const x = sx / ids.length, y = sy / ids.length;
      const top = [...afterZ].sort((p, q) => q[1] - p[1])[0];
      const known = ids.filter((i) => U.lq[i] !== LQ.NONE).length;
      out.push({
        key: `${a.id}@${Math.round(x / 100)},${Math.round(y / 100)}`, a, ids, n: ids.length, rounds: rounds.size, x, y,
        zone: zoneOf({ callouts: U.callouts }, x, y), t: median(ts), early: ts.filter((t) => t < 0).length,
        from: known < ids.length / 2,       // mostly "where the player stood", not where it went
        afterN, stay, afterZone: top ? top[0] : '', afterShare: top ? top[1] / afterN : 0,
        of: R.roundsWith([a.agent]),
      });
    }
  }
  out.sort((p, q) => q.rounds - p.rounds || q.n - p.n);
  R.spots = out.slice(0, 40);
  return R.spots;
}

/** Pairs of abilities used within 5 m and 10 s of each other by one team in one round. */
function together(U, R) {
  if (R.together) return R.together;
  const c = U.c, inIdx = new Uint8Array(U.n), groups = new Map();
  for (const i of R.idx) inIdx[i] = 1;
  for (const i of R.base) {
    if (!inIdx[i] && U.ab[c.ab[i]].meta.k === 'self') continue;
    if (!groups.has(U.rk[i])) groups.set(U.rk[i], []);
    groups.get(U.rk[i]).push(i);
  }
  const m = new Map(), lim = TOGETHER_CM ** 2;
  for (const i of R.idx) {
    const ti = Math.max(0, c.t[i]);
    for (const j of groups.get(U.rk[i])) {
      if (j === i || (inIdx[j] && j < i)) continue;
      if ((R.X[i] - R.X[j]) ** 2 + (R.Y[i] - R.Y[j]) ** 2 > lim || Math.abs(ti - Math.max(0, c.t[j])) > TOGETHER_DS) continue;
      const lo = Math.min(c.ab[i], c.ab[j]), hi = Math.max(c.ab[i], c.ab[j]);
      const k = `${U.ab[lo].id}+${U.ab[hi].id}@${U.zone[i]}`;
      let e = m.get(k);
      if (!e) m.set(k, e = { key: k, a: U.ab[lo], b: U.ab[hi], zone: zoneName(U, U.zone[i]), rounds: new Set(), ids: new Set() });
      e.rounds.add(U.rk[i]); e.ids.add(i); e.ids.add(j);
    }
  }
  R.together = [...m.values()].filter((e) => e.rounds.size >= 2).map((e) => ({
    ...e, rounds: e.rounds.size, ids: [...e.ids], of: R.roundsWith(e.a.agent === e.b.agent ? [e.a.agent] : [e.a.agent, e.b.agent]),
  })).sort((p, q) => q.rounds - p.rounds).slice(0, 30);
  return R.together;
}

/** The same ability from the same spot with the same crosshair, round after round. */
function lineups(U, R) {
  if (R.lineups) return R.lineups;
  const c = U.c, YB = 360 / LINE_DEG, cells = new Map();
  const key = (ab, cx, cy, yb, pb) => (((ab * 4096 + cx + 2000) * 4096 + cy + 2000) * YB + yb) * 64 + pb + 32;
  for (const i of R.idx) {
    const m = U.ab[c.ab[i]].meta.m;
    if (c.yaw[i] == null || (m !== 'throw' && m !== 'aim' && m !== 'ray')) continue;
    const cell = [c.ab[i], Math.floor(c.x[i] / LINE_CM), Math.floor(c.y[i] / LINE_CM), Math.floor(c.yaw[i] / LINE_DEG) % YB, Math.floor(c.pit[i] / LINE_DEG)];
    const k = key(...cell);
    if (!cells.has(k)) cells.set(k, { cell, ids: [] });
    cells.get(k).ids.push(i);
  }
  const used = new Set(), out = [];
  for (const [k, seed] of [...cells].sort((p, q) => q[1].ids.length - p[1].ids.length)) {
    if (used.has(k)) continue;
    const [ab, cx, cy, yb, pb] = seed.cell, ids = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let da = -1; da <= 1; da++) for (let dp = -1; dp <= 1; dp++) {
      const q = key(ab, cx + dx, cy + dy, (yb + da + YB) % YB, pb + dp);
      if (cells.has(q) && !used.has(q)) { used.add(q); ids.push(...cells.get(q).ids); }
    }
    const rounds = new Set(ids.map((i) => U.rk[i]));
    if (rounds.size < LINE_MIN) continue;
    const a = U.ab[ab], mean = (fn, list = ids) => list.reduce((t, i) => t + fn(i), 0) / list.length;
    const x = mean((i) => c.x[i]), y = mean((i) => c.y[i]);
    const best = Math.max(...ids.map((i) => U.lq[i]));
    const known = ids.filter((i) => U.lq[i] === best && best !== LQ.NONE);
    const ts = ids.map((i) => c.t[i]);
    out.push({
      key: `L:${a.id}@${Math.round(x / 100)},${Math.round(y / 100)},${yb},${pb}`, a, ids, n: ids.length, rounds: rounds.size, x, y,
      zone: zoneOf({ callouts: U.callouts }, x, y), best,
      to: known.length ? zoneOf({ callouts: U.callouts }, mean((i) => U.lx[i], known), mean((i) => U.ly[i], known)) : '',
      teams: new Set(ids.map((i) => U.games[c.g[i]].t[U.slot[i]])).size,
      t: median(ts), early: ts.filter((t) => t < 0).length, of: R.roundsWith([a.agent]), lineup: true,
      pitch: Math.round(median(ids.map((i) => c.pit[i]))),
      yaw: Math.atan2(mean((i) => Math.sin(c.yaw[i] * Math.PI / 180)), mean((i) => Math.cos(c.yaw[i] * Math.PI / 180))) * 180 / Math.PI,
      latest: ids.reduce((p, i) => (U.games[c.g[i]].date > U.games[c.g[p]].date ? i : p), ids[0]),   // to find it in a VOD
    });
  }
  R.lineups = out.sort((p, q) => q.rounds - p.rounds || q.n - p.n).slice(0, 40);
  return R.lineups;
}

function focusOf(U, R, v) {
  if (!v.focus) return null;
  const find = (list) => list.find((s) => s.key === v.focus);
  return (v.focus.startsWith('L:') ? find(lineups(U, R)) : find(spots(U, R)) || find(together(U, R))) || null;
}

/** Where players stand as the barriers drop: per player for one team, per agent otherwise. */
function starts(U, R) {
  if (R.starts) return R.starts;
  const s = U.s, f = R.f, ids = [], CELL = 300, byTeam = R.ti !== -1, groups = new Map();
  for (let i = 0; i < s.x.length; i++) {
    const k = s.k[i];
    if ((k & 1) !== R.sd || !R.inScope[s.g[i]][(k >> 1) & 1]) continue;
    const ag = U.agents[s.a[i]];
    if (f.agent !== 'all' ? ag !== f.agent : f.role !== 'all' && agentRole(ag) !== f.role) continue;
    ids.push(i);
    const key = byTeam ? s.p[i] : s.a[i];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const list = [...groups].map(([key, gi]) => {
    const ags = new Map(), cells = new Map();
    for (const i of gi) {
      ags.set(s.a[i], (ags.get(s.a[i]) || 0) + 1);
      const k = (Math.floor(s.x[i] / CELL) + 2000) * 4096 + Math.floor(s.y[i] / CELL) + 2000;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    }
    const used = new Set(), places = [];
    for (const [k] of [...cells].sort((p, q) => q[1].length - p[1].length)) {
      if (used.has(k)) continue;
      const got = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const q = k + dx * 4096 + dy; if (cells.has(q) && !used.has(q)) { used.add(q); got.push(...cells.get(q)); } }
      const x = got.reduce((t, i) => t + s.x[i], 0) / got.length, y = got.reduce((t, i) => t + s.y[i], 0) / got.length;
      places.push({ x, y, n: got.length, share: got.length / gi.length });
    }
    // neighbouring patches with the same callout name are one place to a reader
    const byZone = new Map();
    for (const p of places) {
      const z = zoneOf({ callouts: U.callouts }, p.x, p.y);
      const e = byZone.get(z);
      if (!e) byZone.set(z, { ...p, zone: z });
      else { e.x = (e.x * e.n + p.x * p.n) / (e.n + p.n); e.y = (e.y * e.n + p.y * p.n) / (e.n + p.n); e.n += p.n; e.share = e.n / gi.length; }
    }
    const agent = U.agents[[...ags].sort((p, q) => q[1] - p[1])[0][0]];
    return { key, agent, name: byTeam ? U.players[key].name : agentName(agent), n: gi.length, places: [...byZone.values()].sort((p, q) => q.n - p.n) };
  }).sort((p, q) => q.n - p.n);
  R.starts = { ids, groups: list, byTeam };
  return R.starts;
}
function startCard(U, R, f) {
  const ST = starts(U, R);
  if (!ST.groups.length) return '';
  const cell = (p) => (p ? `${esc(p.zone) || '–'} <span class="low">${pct(p.n, p.of)}</span>` : '<span class="low">–</span>');
  const rows = ST.groups.slice(0, 24).map((g) => `<tr class="click ${f.agent === g.agent ? 'sel' : ''}" data-agent="${esc(g.agent)}"><td><span class="tag">${agentIcon(g.agent)}${esc(g.name)}</span></td><td class="num">${int(g.n)}</td>${[0, 1, 2].map((k) => `<td>${cell(g.places[k] && { ...g.places[k], of: g.n })}</td>`).join('')}</tr>`).join('');
  return `<div class="card"><h2>Where they start</h2><p class="sub">Where each ${ST.byTeam ? 'player' : 'agent'} is standing the moment the barriers drop, as a share of ${ST.byTeam ? 'their' : 'its'} ${SIDE[f.side].toLowerCase()} rounds on this map. An average would land between the sites, so these are the areas they start in most. Set “Players” to “As the barriers drop” above the map to see it${ST.groups.length <= MAX_FACES ? ', with a face on each usual spot' : '; pick a team or a role to get faces on the map'}. Click a row to filter to that agent.</p>
    <div class="scroll"><table><thead><tr><th>${ST.byTeam ? 'Player' : 'Agent'}</th><th class="num">Rounds</th><th>Most often</th><th>Second</th><th>Third</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** The things done most often: exact lineups for anything thrown, spots for anything placed. */
function habits(U, R) {
  const placed = spots(U, R).filter((s) => s.a.meta.m === 'near' || s.a.meta.m === 'self');
  return [...lineups(U, R), ...placed].filter((s) => s.rounds >= 3 && s.of >= 5)
    .sort((p, q) => q.rounds / q.of - p.rounds / p.of || q.rounds - p.rounds).slice(0, 8);
}
function habitCards(U, R, f, fo) {
  const c = U.c, H = habits(U, R);
  if (!H.length) return '';
  const max = Math.max(...H.map((s) => s.rounds / s.of));
  const cards = H.map((s) => {
    const byP = new Map();
    for (const i of s.ids) byP.set(c.p[i], (byP.get(c.p[i]) || 0) + 1);
    const top = [...byP].sort((p, q) => q[1] - p[1]);
    const who = R.ti === -1 ? plural(s.teams ?? new Set(s.ids.map((i) => U.games[c.g[i]].t[U.slot[i]])).size, 'team') : `${esc(U.players[top[0][0]].name)}${top.length > 1 ? ` +${top.length - 1}` : ''}`;
    const moment = s.early > s.n / 2 ? 'before barriers' : when(s.t);
    return `<button class="pick ${fo === s ? 'on' : ''}" data-ufocus="${esc(s.key)}">
      ${agentIcon(s.a.agent, 'lg')}
      <span class="pk-main"><b>${abilityIcon(s.a.id)}${esc(abilityName(s.a.id))} from ${esc(s.zone) || 'one spot'}</b><small>${who} · ${moment}${s.lineup ? ` · ${aimText(s.pitch)}` : ''}</small></span>
      <span class="pk-stat"><b>${pct(s.rounds, s.of)}</b><small>${int(s.rounds)} of ${int(s.of)} rounds</small></span>
      <span class="meter"><i style="width:${(100 * s.rounds / s.of / max).toFixed(1)}%"></i></span>
    </button>`;
  }).join('');
  const team = R.ti === -1 ? null : U.teams[R.ti];
  return `<div class="card" style="margin-bottom:14px"><h2>${team ? `${esc(team.name)}'s habits` : 'What teams do most'} on ${SIDE[f.side].toLowerCase()}</h2>
    <p class="sub">The same ability from the same spot, round after round${team ? '' : ', all teams pooled'}: thrown abilities need the same crosshair too. The share is of rounds that agent was played. These positions are exact. Click one to see it on the map with the rounds to look up in a VOD.</p>
    <div class="picks habits">${cards}</div></div>`;
}
/** Every round behind the isolated spot, newest first: what to open in the VOD. */
function vodList(U, fo) {
  const c = U.c;
  const ids = [...fo.ids].sort((p, q) => U.games[c.g[q]].date.localeCompare(U.games[c.g[p]].date) || c.g[q] - c.g[p] || c.rn[p] - c.rn[q] || c.t[p] - c.t[q]);
  const rows = ids.slice(0, 80).map((i) => {
    const g = U.games[c.g[i]], s = U.slot[i], a = U.ab[c.ab[i]];
    return `<tr><td>${g.date}</td><td><span class="who">${teamLogo(U.teams[g.t[s]].id, U.teams[g.t[s]].name)}${esc(U.teams[g.t[s]].name)}</span></td><td class="low">vs ${esc(U.teams[g.t[1 - s]].name)}</td><td class="num">${c.rn[i]}</td><td>${when(c.t[i])}</td><td>${agentIcon(a.agent)}${esc(U.players[c.p[i]].name)}</td><td>${abilityIcon(a.id)}${esc(abilityName(a.id))}</td></tr>`;
  }).join('');
  return `<h3 style="margin-top:14px">Rounds to check in the VOD</h3><p class="sub">${ids.length > 80 ? `Newest 80 of ${int(ids.length)}. ` : ''}Time is counted from the barriers dropping. ${esc(U.events.length > 1 ? '' : U.events[0] || '')}</p>
    <div class="scroll" style="max-height:300px"><table><thead><tr><th>Date</th><th>Team</th><th>Opponent</th><th class="num">Round</th><th>When</th><th>Player</th><th>Ability</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------- header and filters
export function utilHero(UI, f, maps, index) {
  const team = f.team === 'all' ? null : index.teams.find((t) => t.id === f.team);
  const total = Object.values(UI.maps).reduce((s, m) => s + m.casts, 0);
  const tiles = Object.entries(UI.maps).sort((a, b) => b[1].games - a[1].games).map(([m, info]) => {
    const n = team ? (info.teams[team.id] || 0) : info.games, on = f.map === m;
    return `<button class="mtile ${on ? 'on' : ''} ${n ? '' : 'idle'}" data-map="${esc(m)}" aria-pressed="${on}">${thumb(maps, m)}<span class="st"><span class="nm">${cap(m)}</span><span class="ct">${plural(n, 'game')}</span></span></button>`;
  }).join('');
  const isOn = (p) => Object.keys(FACETS).every((k) => f[k] === (p[k] || 'all'));
  const presets = PRESETS.map(([label, p], i) => `<button class="cchip sm ${isOn(p) ? 'on' : ''}" data-upreset="${i}" aria-pressed="${isOn(p)}">${label}</button>`).join('');
  const crumbs = team ? `<nav class="crumbs" aria-label="Breadcrumb"><button data-go="uteam">${esc(team.name)}</button><span>›</span><b>Utility</b></nav>` : '';
  return `${crumbs}<div class="hero-id">${team ? teamLogo(team.id, team.name, 'lg') : ''}<div><h2>${team ? `${esc(team.name)}: where their utility goes` : 'Utility: where it gets used'}</h2>
      <p class="muted">${int(total)} ability uses across ${Object.keys(UI.maps).length} maps, each with the player's exact position, aim and time. Pick a map and a side to see where utility is used from before the barriers drop and in the first seconds after, where each player starts, and the rounds to look up in a VOD.</p></div></div>
    <div class="pickrow" role="group" aria-label="Map"><span class="lbl">Where</span><div class="roster">${tiles}</div></div>
    <div class="pickrow" role="group" aria-label="Shortcuts"><span class="lbl">Show</span><div class="roster">${presets}</div></div>`;
}
export const utilPreset = (i) => ({ ...FACETS, ...(PRESETS[i] ? PRESETS[i][1] : {}) });

export function utilFilters(U, f, index) {
  const R = U ? compute(U, f, 'land') : null;
  const sel = (v, cur) => (v === cur ? ' selected' : '');
  const seg = (key, items, small = '') => `<div class="seg ${small}" role="group">${items.map(([v, l]) => `<button data-f="${key}" data-v="${esc(v)}" class="${f[key] === v ? 'on' : ''}" aria-pressed="${f[key] === v}">${l}</button>`).join('')}</div>`;
  const here = U ? [...U.teams].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const missing = f.team !== 'all' && !here.some((t) => t.id === f.team) ? index.teams.find((t) => t.id === f.team) : null;
  const teams = `<select data-f="team"><option value="all">All teams</option>${missing ? `<option value="${esc(missing.id)}" selected>${esc(missing.name)} (no games here)</option>` : ''}${here.map((t) => `<option value="${esc(t.id)}"${sel(t.id, f.team)}>${esc(t.name)}</option>`).join('')}</select>`;
  const comps = U ? U.circuits.map((cc) => `<optgroup label="${esc(cc)}"><option value="c:${esc(cc)}"${sel('c:' + cc, f.comp)}>${esc(cc)} · everything</option>${U.events.filter((e) => circuitOf(e) === cc).map((e) => `<option value="e:${esc(e)}"${sel('e:' + e, f.comp)}>${esc(e.slice(cc.length + 3) || e)}</option>`).join('')}</optgroup>`).join('') : '';
  let agents = '', abilities = '';
  if (R) {
    const list = [...R.agN].sort((a, b) => b[1] - a[1]);
    if (f.agent !== 'all' && !R.agN.has(f.agent)) list.push([f.agent, 0]);
    agents = `<button data-f="agent" data-v="all" class="txt ${f.agent === 'all' ? 'on' : ''}">All</button>` + list.map(([a, n]) => `<button data-f="agent" data-v="${esc(a)}" class="${f.agent === a ? 'on' : ''}" aria-label="${esc(agentName(a))}" aria-pressed="${f.agent === a}" data-tip="${esc(`<b>${esc(agentName(a))}</b><span class="muted">${plural(n, 'use')} in this selection</span>`)}">${agentIcon(a, 'md')}</button>`).join('');
    const byAgent = new Map();
    U.ab.forEach((a, i) => { if (R.abN[i] || a.id === f.ability) { if (!byAgent.has(a.agent)) byAgent.set(a.agent, []); byAgent.get(a.agent).push([a, R.abN[i]]); } });
    abilities = [...byAgent].sort((a, b) => agentName(a[0]).localeCompare(agentName(b[0]))).map(([ag, list2]) => `<optgroup label="${esc(agentName(ag))}">${list2.sort((a, b) => b[1] - a[1]).map(([a, n]) => `<option value="${esc(a.id)}"${sel(a.id, f.ability)}>${esc(abilityName(a.id))} · ${int(n)}</option>`).join('')}</optgroup>`).join('');
  }
  return `<label class="field"><span>Team</span>${teams}</label>
    <label class="field"><span>Competition</span><select data-f="comp"><option value="all">All competitions</option>${comps}</select></label>
    <div class="field"><span>Side</span>${seg('side', [['a', 'Attack'], ['d', 'Defense']])}</div>
    <div class="field"><span>When in the round</span>${seg('when', WHEN)}</div>
    <div class="field"><span>Agent role</span>${seg('role', ROLES)}</div>
    <div class="field"><span>Type of utility</span>${seg('kind', [['all', 'All'], ...KINDS])}</div>
    <div class="field"><span>Agent</span><div class="icoseg" role="group" aria-label="Agent">${agents || '<span class="muted none">–</span>'}</div></div>
    <label class="field"><span>One ability</span><select data-f="ability"><option value="all">Any ability</option>${abilities}</select></label>
    <button data-reset class="ghost">Reset</button>`;
}

// ---------------------------------------------------------------- page
const empty = (msg) => `<div class="card empty">${msg}</div>`;

export function viewUtil(U, f, v, maps, index) {
  if (!U) return empty('Loading…');
  const R = compute(U, f, v.src), c = U.c, n = R.idx.length;
  const team = f.team === 'all' ? null : (index.teams.find((t) => t.id === f.team) || { id: f.team, name: f.team });
  const scope = [SIDE[f.side].toLowerCase(), f.when !== 'all' ? WHEN_NAME[f.when].toLowerCase() : '', f.role !== 'all' ? f.role.toLowerCase() + 's' : '', f.kind !== 'all' ? KIND_NAME[f.kind].toLowerCase() : '',
    f.agent !== 'all' && f.ability === 'all' ? esc(agentName(f.agent)) : '', f.ability !== 'all' ? esc(abilityName(f.ability)) : '', f.comp !== 'all' ? esc(f.comp.slice(2)) : ''].filter(Boolean).join(' · ');
  const head = `<h2 class="ctx-h">${team ? `${teamLogo(team.id, team.name, 'lg')}<span>${esc(team.name)}</span>` : '<span>All teams</span>'}<em>on</em>${thumb(maps, f.map)}<span>${cap(f.map)}</span><small>${scope}</small></h2>`;
  if (!R.rounds) return `<div class="ctx">${head}<p class="ctx-sub">${team ? `${esc(team.name)} has no ${SIDE[f.side].toLowerCase()} rounds on ${cap(f.map)} in this selection. Maps they have played are the bright tiles under “Where”.` : 'No rounds match these filters.'}</p></div>`;
  const used = new Set(R.idx.map((i) => U.rk[i])).size;
  const sub = n
    ? `<span><b>${int(n)}</b> uses in <b>${int(R.rounds)}</b> ${SIDE[f.side].toLowerCase()} rounds</span><span>${(n / R.rounds).toFixed(1)} a round</span><span>at least one in ${pct(used, R.rounds)} of rounds</span>`
    : `Nothing matches in ${int(R.rounds)} ${SIDE[f.side].toLowerCase()} rounds. Loosen the filters above.`;
  const ctx = `<div class="ctx">${head}<p class="ctx-sub">${sub}</p></div>`;
  if (!n) return ctx;

  // ---- when
  const share = (fn) => R.idx.filter(fn).length;
  const tiles = f.when === 'all' ? `<div class="grid tiles">${[
    tile('Used pre-round', pct(share((i) => c.t[i] < 0), n), 'set up before the barriers drop'),
    tile('Used in the first 3 seconds', pct(share((i) => c.t[i] >= 0 && c.t[i] <= OPEN_DS), n), 'right as the barriers drop'),
    tile('Used after the plant', pct(share((i) => U.post[i]), n), 'post-plant and retake utility'),
    tile('Typical moment', n ? when(median(R.idx.map((i) => c.t[i]))) : '–', 'median, counted from barrier drop'),
  ].join('')}</div>` : '';
  const edges = [-1e9, 0, OPEN_DS, 100, 200, 300, 450, 600, 1e9];
  const cats = ['Pre-round', '0–3s', '3–10s', '10–20s', '20–30s', '30–45s', '45–60s', '60s+'];
  const vals = cats.map(() => 0);
  for (const i of R.idx) { let b = 1; while (c.t[i] >= edges[b]) b++; vals[b - 1]++; }
  const timing = barChart({ cats, series: [{ name: 'Share of uses', color: C.heat, vals: vals.map((x) => Math.round(100 * x / n)) }], unit: '%', height: 200, tip: (s, i) => `<b>${cats[i]}</b><span class="muted">${int(vals[i])} uses (${pct(vals[i], n)})</span>` });

  // ---- what
  const byAb = new Map();
  for (const i of R.idx) { let e = byAb.get(c.ab[i]); if (!e) byAb.set(c.ab[i], e = { a: U.ab[c.ab[i]], n: 0, rounds: new Set() }); e.n++; e.rounds.add(U.rk[i]); }
  const abRows = [...byAb.values()].map((e) => ({ label: abilityName(e.a.id), icon: agentIcon(e.a.agent) + abilityIcon(e.a.id), n: e.rounds.size, d: R.roundsWith([e.a.agent]), attr: `data-uability="${esc(e.a.id)}"`, on: f.ability === e.a.id }))
    .sort((p, q) => q.n - p.n).slice(0, 16);

  // ---- how much of this is a real landing spot
  const q = [0, 0, 0, 0, 0, 0];
  for (const i of R.idx) q[U.lq[i]]++;
  const seen = q[LQ.SEEN] + q[LQ.MATCH];
  const cover = [q[LQ.PLACED] ? `<b>${pct(q[LQ.PLACED], n)}</b> are placed where the player stands, shown to within a few metres` : '',
    seen ? `<b>${pct(seen, n)}</b> have a landing spot known from damage: ${int(q[LQ.SEEN])} hit an enemy there, ${int(q[LQ.MATCH])} are identical throws to ones that did (good to about 3 to 5 m)` : '',
    q[LQ.FIT] ? `<b>${pct(q[LQ.FIT], n)}</b> are thrown with nothing to confirm them, so the landing is read off the throw angle (typically 5 to 10 m off: “roughly here”)` : '',
    q[LQ.WALL] ? `<b>${pct(q[LQ.WALL], n)}</b> are flat bow shots, shown at the first mapped wall on the line of aim (on shock bolts that could be checked this was a median ${WALL_SHOT.err} m off; it ignores bounces)` : '',
    q[LQ.NONE] ? `<b>${pct(q[LQ.NONE], n)}</b> leave no trace of where they ended up (smokes, flashes, lobbed arrows, anything placed through the map): exact position and aim of the player only` : ''].filter(Boolean).join('; ');
  const one = f.ability !== 'all' ? U.ab.find((a) => a.id === f.ability) : null;
  const note = `${one ? `${abilityIcon(one.id)}<b>${esc(abilityName(one.id))}</b>: ${WALL_SHOT.abilities.includes(one.id) ? 'Fired from the bow. A flat shot is shown at the first mapped wall on its line; a lobbed one only as where the player stood and aimed, unless it hurt someone.' : one.meta.m === 'throw' && !one.fit ? MODEL_NOTE.aim : MODEL_NOTE[one.meta.m]} ` : ''}Of these ${int(n)} uses: ${cover}.`;

  // ---- common spots
  const S = spots(U, R), T = together(U, R), fo = focusOf(U, R, v);
  const spotRows = S.map((s, k) => {
    const moment = s.early > s.n / 2 ? 'before barriers' : when(s.t);
    const after = s.afterN >= 3 ? `${esc(s.afterZone) || '–'} <span class="low">${pct(Math.round(s.afterShare * s.afterN), s.afterN)}</span>` : '<span class="low">–</span>';
    const tip = `<b>${esc(abilityName(s.a.id))}</b> at ${esc(s.zone) || 'this spot'}<span class="muted">${plural(s.n, 'use')} in ${plural(s.rounds, 'round')} · ${pct(s.rounds, s.of)} of ${int(s.of)} ${esc(agentName(s.a.agent))} rounds here</span><span class="muted">${s.afterN ? `${U.after} s later the player is still within 5 m in ${pct(s.stay, s.afterN)}` : 'No position 5 s later'}</span>`;
    return `<tr class="click ${fo === s ? 'sel' : ''}" data-ufocus="${esc(s.key)}" data-tip="${esc(tip)}"><td class="num low">${k < SPOTS_ON_MAP ? k + 1 : ''}</td><td>${abTag(s.a)}</td><td>${v.src === 'land' && s.from ? '<span class="low">from</span> ' : ''}${esc(s.zone) || '–'}</td><td class="num">${int(s.rounds)} <span class="low">${pct(s.rounds, s.of)}</span></td><td class="low">${moment}</td><td>${after}</td></tr>`;
  }).join('');
  const spotCard = `<div class="card"><h2>Common spots</h2><p class="sub">Places one ability keeps going${v.src === 'from' ? ' from' : ' (“from” marks abilities where only the player\'s position is known)'}. The share is of rounds that agent was played on this side. “Then plays from” is where the player is ${U.after} s later (for anything placed before the barriers: ${U.after} s into the round). Click a row to isolate it on the map.</p>
    ${spotRows ? `<div class="scroll"><table><thead><tr><th class="num">#</th><th>Ability</th><th>Area</th><th class="num">Rounds</th><th>When</th><th>Then plays from</th></tr></thead><tbody>${spotRows}</tbody></table></div>` : '<p class="muted">Too few uses here to call anything a common spot.</p>'}</div>`;
  const LN = lineups(U, R);
  const lineRows = LN.map((s) => {
    const lands = s.to ? `${esc(s.to)} <span class="low">${s.best >= LQ.MATCH ? 'seen' : s.best === LQ.WALL ? 'first wall' : 'est.'}</span>` : '<span class="low">not in the data</span>';
    const tip = `<b>${esc(abilityName(s.a.id))}</b> from ${esc(s.zone) || 'this spot'}<span class="muted">${plural(s.n, 'throw')} in ${plural(s.rounds, 'round')}${R.ti === -1 ? ` by ${plural(s.teams, 'team')}` : ''}, all within 1.5 m and ${LINE_DEG}° of each other</span><span class="muted">${s.to ? `Lands around ${esc(s.to)}: ${LQ_TIP[s.best]}` : 'Where it lands is not in the data; click to see the line it leaves on'}</span><span class="muted">${aimText(s.pitch)} · latest: ${castRef(U, s.latest)}</span>`;
    return `<tr class="click ${fo === s ? 'sel' : ''}" data-ufocus="${esc(s.key)}" data-tip="${esc(tip)}"><td>${abTag(s.a)}</td><td>${esc(s.zone) || '–'}</td><td>${lands}</td><td class="num">${int(s.rounds)} <span class="low">${pct(s.rounds, s.of)}</span></td>${R.ti === -1 ? `<td class="num">${s.teams}</td>` : ''}<td class="low">${s.early > s.n / 2 ? 'before barriers' : when(s.t)}</td></tr>`;
  }).join('');
  const lineCard = `<div class="card"><h2>Repeated lineups</h2><p class="sub">The same ability from the same spot (within 1.5 m) with the same crosshair (within ${LINE_DEG}°), in ${LINE_MIN} rounds or more. Position and aim are exact for every ability, smokes included. “Lands” is filled in only where damage gives it away. Click a row to see it on the map.</p>
    ${lineRows ? `<div class="scroll"><table><thead><tr><th>Ability</th><th>Thrown from</th><th>Lands</th><th class="num">Rounds</th>${R.ti === -1 ? '<th class="num">Teams</th>' : ''}<th>When</th></tr></thead><tbody>${lineRows}</tbody></table></div>` : '<p class="muted">Nothing is thrown the same way three times in this selection.</p>'}</div>`;
  const togRows = T.map((e) => `<tr class="click ${fo === e ? 'sel' : ''}" data-ufocus="${esc(e.key)}"><td>${abTag(e.a)}</td><td>${e.a === e.b ? '<span class="low">twice</span>' : abTag(e.b)}</td><td>${esc(e.zone) || '–'}</td><td class="num">${int(e.rounds)} <span class="low">${pct(e.rounds, e.of)}</span></td></tr>`).join('');
  const togCard = `<div class="card"><h2>Used together</h2><p class="sub">Two abilities within 5 m and 10 s of each other, same team, same round (anything placed before the barriers counts as time zero). Uses the landing spot where one is known, otherwise where the player stood. The share is of rounds both agents were played.</p>
    ${togRows ? `<div class="scroll"><table><thead><tr><th>Ability</th><th>With</th><th>Area</th><th class="num">Rounds</th></tr></thead><tbody>${togRows}</tbody></table></div>` : '<p class="muted">No pair shows up twice in this selection.</p>'}</div>`;

  // ---- who
  let whoCard;
  if (R.ti === -1) {
    const byT = new Map();
    for (const i of R.idx) { const t = U.games[c.g[i]].t[U.slot[i]]; byT.set(t, (byT.get(t) || 0) + 1); }
    const rounds = new Map();
    U.games.forEach((g, gi) => [0, 1].forEach((s) => { if (R.inScope[gi][s]) rounds.set(g.t[s], (rounds.get(g.t[s]) || 0) + g.sr[s][R.sd]); }));
    const rows = [...byT].map(([t, k]) => ({ t: U.teams[t], k, r: rounds.get(t) || 0 })).filter((e) => e.r >= 12).sort((p, q) => q.k / q.r - p.k / p.r).slice(0, 15);
    whoCard = `<div class="card"><h2>Teams that do this most</h2><p class="sub">Uses per ${SIDE[f.side].toLowerCase()} round on ${cap(f.map)}, teams with 12+ rounds. Click a team to see only theirs.</p>
      <div class="scroll"><table><thead><tr><th>Team</th><th class="num">Uses</th><th class="num">Rounds</th><th class="num">Per round</th></tr></thead><tbody>${rows.map((e) => `<tr class="click" data-uteam="${esc(e.t.id)}"><td><span class="who">${teamLogo(e.t.id, e.t.name)}${esc(e.t.name)}</span></td><td class="num">${int(e.k)}</td><td class="num">${int(e.r)}</td><td class="num">${(e.k / e.r).toFixed(2)}</td></tr>`).join('')}</tbody></table></div></div>`;
  } else {
    const byP = new Map();
    for (const i of R.idx) { let e = byP.get(c.p[i]); if (!e) byP.set(c.p[i], e = { p: U.players[c.p[i]], k: 0, ab: new Map() }); e.k++; e.ab.set(c.ab[i], (e.ab.get(c.ab[i]) || 0) + 1); }
    whoCard = `<div class="card"><h2>Who uses it</h2><p class="sub">Players behind these ${int(n)} uses, with what they use most.</p>
      <div class="scroll"><table><thead><tr><th>Player</th><th class="num">Uses</th><th>Most used</th></tr></thead><tbody>${[...byP.values()].sort((p, q) => q.k - p.k).map((e) => `<tr><td>${esc(e.p.name)}</td><td class="num">${int(e.k)}</td><td><span class="tags">${[...e.ab].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([a, k]) => `<span class="tag">${abTag(U.ab[a])} <span class="low">${k}</span></span>`).join('')}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  const box = (k, label) => `<label><input type="checkbox" data-ulayer="${k}" ${v[k] ? 'checked' : ''}> ${label}</label>`;
  const srcSeg = `<div class="seg small" role="group" aria-label="Position shown"><button data-usrc="from" class="${v.src === 'from' ? 'on' : ''}" aria-pressed="${v.src === 'from'}">Where it is used from</button><button data-usrc="land" class="${v.src === 'land' ? 'on' : ''}" aria-pressed="${v.src === 'land'}">Where it lands, if known</button></div>`;
  const whoSeg = `<span class="ctl-lbl">Players</span><div class="seg small" role="group" aria-label="Player positions">${[['off', 'Hidden'], ['start', 'As the barriers drop'], ['after', `${U.after} s after use`]].map(([k, l]) => `<button data-uwho="${k}" class="${v.who === k ? 'on' : ''}" aria-pressed="${v.who === k}">${l}</button>`).join('')}</div>`;
  const focusBar = fo ? `<p class="ufocus"><span>Showing only <b>${esc(abilityName(fo.a.id))}${fo.b ? (fo.b === fo.a ? ' twice' : ` with ${esc(abilityName(fo.b.id))}`) : ''}</b> ${fo.lineup ? 'thrown from' : 'at'} ${esc(fo.zone) || 'this spot'}: ${plural(fo.ids.length, 'use')}. Orange ${fo.ids.length <= FOCUS_LINES ? 'lines lead to' : 'specks are'} where each player is ${U.after} s later.${fo.lineup ? ` ${cap(aimText(fo.pitch))}${fo.to ? '' : '; the green line is the exact direction it leaves in, but how far it travels is not in the data'}. Latest: ${castRef(U, fo.latest)}.` : ''}</span><button data-ufocus="" class="ghost">Show everything</button></p>` : '';
  return `${ctx}${tiles}${habitCards(U, R, f, fo)}
  <div class="grid map-layout">
    <div class="card">
      <div class="controls">${srcSeg}${box('heat', 'Heat')}<label><input type="checkbox" data-ulayer="pts" ${showMarks(v, n) ? 'checked' : ''}> Each use</label>${box('spots', 'Common spots')}</div>
      <div class="controls">${whoSeg}</div>
      ${focusBar}
      <div class="mapwrap"><canvas id="utilc"></canvas></div>
      ${legend([[v.src === 'land' ? 'Where utility goes (brighter = more often)' : 'Where it is used from (brighter = more often)', C.heat], ['One use, with a line from the player', C.mark, 'dot'], ['Common spot, numbered as in the table', C.heat, 'dot'], [v.who === 'start' ? 'Where players stand as the barriers drop' : `Where the player is ${U.after} s later`, C.after], ['Isolated spot', C.focus, 'dot']])}
      <p class="note">${v.src === 'from' ? 'Every position here is exact: where the player was standing the moment they used it, with a line showing which way they were aiming. Switch to “Where it lands, if known” for landing spots.' : note}</p>
      <p class="note" id="utilNote"></p>
      ${fo ? vodList(U, fo) : ''}
    </div>
    <div class="grid" style="align-content:start">${startCard(U, R, f)}${spotCard}${lineCard}${togCard}</div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>What gets used</h2><p class="sub">Share of rounds with at least one use, out of the rounds that agent was played on this side. Click one to see only that ability.</p>${barList(abRows)}</div>
    <div class="card"><h2>When it is used</h2><p class="sub">Share of these uses by time since the barriers dropped. “Pre-round” is everything used before the barriers drop.</p>${timing}</div>
  </div>
  <div style="margin-top:14px">${whoCard}</div>`;
}

// ---------------------------------------------------------------- map
export function drawUtil(U, f, v, meta, onFocus) {
  const cv = document.querySelector('#utilc');
  if (!U || !cv) return;
  const R = compute(U, f, v.src), c = U.c, idx = R.idx;
  if (!idx.length) return;
  // crop to the callouts plus a sample of the data
  const step = Math.max(1, Math.floor(idx.length / 800));
  const sample = [];
  for (let k = 0; k < idx.length; k += step) sample.push({ x: c.x[idx[k]], y: c.y[idx[k]] }, { x: U.lx[idx[k]], y: U.ly[idx[k]] });
  const mv = new MapView(cv, meta, [{ pts: sample }]);
  const fo = focusOf(U, R, v);
  const tip = (i) => {
    const a = U.ab[c.ab[i]], g = U.games[c.g[i]], s = U.slot[i];
    const how = LQ_TIP[U.lq[i]] && a.meta.m !== 'self' && a.meta.m !== 'near' ? LQ_TIP[U.lq[i]] : c.yaw[i] == null ? 'position only' : a.meta.m === 'throw' ? MODEL_SHORT.aim : MODEL_SHORT[a.meta.m];
    return `${abilityIcon(a.id)}<b>${esc(abilityName(a.id))}</b> · ${when(c.t[i])}<span class="muted">${agentIcon(a.agent)}${esc(U.players[c.p[i]].name)} · ${esc(U.teams[g.t[s]].name)}</span><span class="muted">${g.date} vs ${esc(U.teams[g.t[1 - s]].name)} · round ${c.rn[i]} · ${how}</span>`;
  };
  const mark = (i, color, alpha, far = false) => {
    const a = U.ab[c.ab[i]];
    if (U.lq[i] !== LQ.NONE && a.meta.m !== 'self') mv.tick(c.x[i], c.y[i], U.lx[i], U.ly[i], color, alpha);
    else if (c.yaw[i] != null) {
      if (a.meta.m === 'aim' || a.meta.m === 'ray' || a.meta.m === 'throw') {
        const len = far ? 5000 : a.meta.m === 'ray' ? 1200 : 600, r = c.yaw[i] * Math.PI / 180;
        mv.tick(c.x[i], c.y[i], c.x[i] + Math.cos(r) * len, c.y[i] + Math.sin(r) * len, color, alpha);
      }
    }
    mv.small(R.X[i], R.Y[i], color, tip(i));
  };
  const ST = v.who === 'start' && !fo ? starts(U, R) : null;
  const faces = ST && ST.groups.length <= MAX_FACES ? ST.groups : [];
  Promise.all([mv.ready, mv.preload(faces.map((g) => agentImg(g.agent)))]).then(() => {
    mv.base();
    if (v.heat) mv.heatPoints((put) => { for (const i of idx) put(R.X[i], R.Y[i]); }, undefined, fo || ST ? 0.45 : 1);
    if (ST) {
      mv.heatPoints((put) => { for (const i of ST.ids) put(U.s.x[i], U.s.y[i]); }, RAMP_WARM, 0.75);
      for (const g of faces) for (const pl of g.places.filter((x) => x.share >= 0.15).slice(0, 2)) {
        mv.portrait(pl.x, pl.y, agentImg(g.agent), `${agentIcon(g.agent)}<b>${esc(g.name)}</b> starts around ${esc(pl.zone) || 'here'}<span class="muted">${pct(pl.n, g.n)} of ${int(g.n)} ${SIDE[f.side].toLowerCase()} rounds${ST.byTeam ? ` · mostly ${esc(agentName(g.agent))}` : ''}</span>`);
      }
    }
    if (v.who === 'after' && !fo) mv.heatPoints((put) => { for (const i of idx) if (c.px[i] != null) put(c.px[i], c.py[i]); }, RAMP_WARM, 0.7);
    let shown = 0, noteText = '';
    if (fo) {
      for (const i of fo.ids) {
        if (c.px[i] != null) { if (fo.ids.length <= FOCUS_LINES) mv.tick(c.x[i], c.y[i], c.px[i], c.py[i], C.after, 0.55); mv.speck(c.px[i], c.py[i], C.after); }
        mark(i, C.focus, fo.lineup && fo.ids.length > 40 ? 0.25 : 0.6, Boolean(fo.lineup));
      }
    } else if (showMarks(v, idx.length)) {
      const every = Math.max(1, Math.ceil(idx.length / MAX_MARKS));
      for (let k = 0; k < idx.length; k += every) { mark(idx[k], C.mark, 0.3); shown++; }
      if (every > 1) noteText = `Showing ${int(shown)} of ${int(idx.length)} uses as dots (every ${every}${every === 2 ? 'nd' : every === 3 ? 'rd' : 'th'}). The heat and the tables count all of them; narrow the filters to see each one.`;
    }
    if (fo && fo.lineup && WALL_SHOT.abilities.includes(fo.a.id) && fo.best <= LQ.WALL) {
      const hit = fo.ids.filter((i) => U.lq[i] === LQ.WALL);
      if (hit.length) {
        const x = hit.reduce((t, i) => t + U.lx[i], 0) / hit.length, y = hit.reduce((t, i) => t + U.ly[i], 0) / hit.length;
        mv.target(x, y, WALL_SHOT.err * 100, C.focus, `<b>First wall on its line</b><span class="muted">a flat arrow sticks about here, around ${esc(zoneOf({ callouts: U.callouts }, x, y)) || 'this spot'}</span><span class="muted">An estimate: bounces are not recorded. On shock bolts that could be checked it was a median ${WALL_SHOT.err} m off, which is how wide the circle is.</span>`);
        noteText = `Dashed circle: the first mapped wall on the arrow's line, where a flat shot sticks. It is an estimate (no bounces, and the minimap is the only wall data): on shock bolts that could be checked it was a median ${WALL_SHOT.err} m off. The green line and the standing spot are exact.`;
      } else noteText = `This one is lobbed (${aimText(fo.pitch)}). How far a lobbed arrow carries depends on how hard the bow was drawn and what it clears, and neither is in the data, so only the exact line it leaves on is shown. The rounds below are where to see it land.`;
    }
    if (v.spots && !fo) spots(U, R).slice(0, SPOTS_ON_MAP).forEach((s, k) => {
      mv.dot(s.x, s.y, C.heat, `${abilityIcon(s.a.id)}<b>${esc(abilityName(s.a.id))}</b> at ${esc(s.zone) || 'this spot'}<span class="muted">${plural(s.rounds, 'round')} · ${pct(s.rounds, s.of)} of ${esc(agentName(s.a.agent))} rounds · click to isolate</span>`, () => onFocus(s.key), String(k + 1));
    });
    mv.flush();
    const el = document.querySelector('#utilNote');
    if (el) el.textContent = noteText || (fo || showMarks(v, idx.length) ? 'Hover a dot for the round it comes from.' : 'Tick “Each use” to see every one as a dot, or narrow the filters: dots turn on by themselves under ' + AUTO_MARKS + ' uses.');
  });
}
