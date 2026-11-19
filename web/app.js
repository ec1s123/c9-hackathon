// Operator Tracker - no-build front end. Reads ../data/ produced by etl/build.py.
import { barChart, barList, legend, tile } from './charts.js';
import { MapView, zoneOf } from './map.js';
import { setAssets, teamLogo, agentIcon, agentTag, agentName, abilityIcon, abilityName, weaponIcon, opIcon } from './icons.js';
import { prepLeague, cleanLeagueFilters, describeLeague, leagueFilters, viewLeague, circuitOf } from './league.js';
import { homeHero, homeGrid } from './home.js';
import { initSearch } from './search.js';

const DATA = '../data/';
const C = { atk: '#d95926', def: '#3987e5', kill: '#199e70', neutral: '#6f6e68' };
const SRC = { bought: 'Bought', carried: 'Carried over', received: 'Given by a teammate', pickup: 'Picked up mid-round' };
const SIDE = { a: 'Attack', d: 'Defense' };

const S = {
  index: null, maps: {}, T: null, tab: 'overview',
  mode: 'home',              // 'home' = team picker, 'team' = one team's tabs, 'league' = league-wide stats
  hf: { comp: 'all' },       // picker: competition
  hv: { q: '', sort: 'az' },
  L: null, hasAssets: false, push: false,
  f: { player: 'all', map: 'all', side: 'all', agent: 'all', event: 'all', opp: 'all', src: 'all' },
  lf: { comp: 'all', map: 'all', side: 'all', agent: 'all' },
  lv: { sortP: 'opr', sortT: 'opr', allP: false, allT: false, allA: false },
  mapPick: null, sel: null,
  layers: { heat: true, setup: false, kills: true, hits: false, deaths: true },
  win: [0, 120],
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const pct = (n, d, dp = 0) => (d ? (100 * n / d).toFixed(dp) + '%' : '–');
const frac = (n, d) => `${pct(n, d)} <small>${n}/${d}</small>`;
const num = (v, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '–');
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (a, fn) => a.reduce((t, x) => t + (fn ? fn(x) : x), 0);
const dist = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2) / 100; // cm -> m
const secs = (t) => `${t.toFixed(1)}s`;

// ---------------------------------------------------------------- loading
async function getJSON(path, optional = false) {
  const r = await fetch(DATA + path);
  if (!r.ok) { if (optional) return null; throw new Error(`${path}: ${r.status}`); }
  return r.json();
}

function prep(T) {
  T.rows = [];
  T.games.forEach((g) => {
    let own = 0, opp = 0, prev = null;
    g.rmap = {};
    g.rounds.forEach((r) => {
      const newHalf = r.n === 1 || r.n === 13 || r.n > 24;
      r.g = g; r.scoreOwn = own; r.scoreOpp = opp;
      r.prev = newHalf ? null : prev;
      r.rows = r.p.map((a) => ({ g, r, pi: a[0], m0: a[1], m1: a[2], lv: a[3], op0: a[4], op1: a[5], w: a[6], k: a[7], ok: a[8], d: a[9], ope: a[10], src: a[11], agent: g.agents[a[0]] || '' }));
      T.rows.push(...r.rows);
      g.rmap[r.n] = r;
      if (r.won) own++; else opp++;
      prev = r;
    });
  });
  T.ops.forEach((o, i) => {
    o.i = i; o.game = T.games[o.g]; o.round = o.game.rmap[o.r];
    o.row = o.round.rows.find((x) => x.pi === o.p);
    o.pts = [];
    for (let k = 0; k < o.track.length; k += 3) o.pts.push({ t: o.track[k], x: o.track[k + 1], y: o.track[k + 2] });
  });
  T.ops = T.ops.filter((o) => o.row);
}

async function loadTeam(id) {
  S.loading = id;
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  const T = await getJSON(`teams/${id}.json`);
  if (S.loading !== id) return false;   // a newer pick won the race
  prep(T);
  S.T = T; S.sel = null; S.mapPick = null;
  Object.keys(S.f).forEach((k) => (S.f[k] = 'all'));
  return true;
}

// ---------------------------------------------------------------- filters
// event filter: 'all', one event, or 'c:<circuit>' for everything in a competition
const eventOK = (g) => S.f.event === 'all' || g.event === S.f.event || (S.f.event.startsWith('c:') && circuitOf(g.event) === S.f.event.slice(2));
const eventLabel = (v) => (v.startsWith('c:') ? `${v.slice(2)} · all events` : v);
const gameOK = (g) => (S.f.map === 'all' || g.map === S.f.map) && eventOK(g) && (S.f.opp === 'all' || g.oppId === S.f.opp);
const roundOK = (r) => gameOK(r.g) && (S.f.side === 'all' || r.side === S.f.side);
const rowOK = (x) => roundOK(x.r) && (S.f.player === 'all' || x.pi === +S.f.player) && (S.f.agent === 'all' || x.agent === S.f.agent);
const isOp = (x) => (S.f.src === 'all' ? x.op1 === 1 : x.src === S.f.src);
const opOK = (o) => rowOK(o.row) && (S.f.src === 'all' || o.src === S.f.src);

function ctx() {
  const T = S.T;
  const rows = T.rows.filter(rowOK);
  const rounds = T.games.flatMap((g) => g.rounds).filter(roundOK);
  const ops = T.ops.filter(opOK);
  return { T, rows, rounds, ops, opRows: rows.filter(isOp), held: ops.filter((o) => o.row.op1) };
}

function baseline() {
  const b = S.index.baseline[S.f.map] || S.index.baseline.all;
  const sides = S.f.side === 'all' ? ['a', 'd'] : [S.f.side];
  const out = {};
  for (const s of sides) for (const [k, v] of Object.entries(b[s])) out[k] = (out[k] || 0) + v;
  return out;
}
const whole = () => S.f.player === 'all' && S.f.agent === 'all' && S.f.src === 'all';

/** Drop filter values this team does not have (stale deep links, carried-over league filters). */
function cleanTeamFilters() {
  const T = S.T, f = S.f;
  if (f.player !== 'all' && !T.players[+f.player]) f.player = 'all';
  if (f.map !== 'all' && !T.games.some((g) => g.map === f.map)) f.map = 'all';
  if (!['all', 'a', 'd'].includes(f.side)) f.side = 'all';
  if (f.agent !== 'all' && !T.rows.some((x) => x.agent === f.agent)) f.agent = 'all';
  if (f.event !== 'all' && !T.games.some((g) => g.event === f.event || (f.event.startsWith('c:') && circuitOf(g.event) === f.event.slice(2)))) f.event = 'all';
  if (f.opp !== 'all' && !T.games.some((g) => g.oppId === f.opp)) f.opp = 'all';
  if (f.src !== 'all' && !SRC[f.src]) f.src = 'all';
}

function teamFilters() {
  const T = S.T, f = S.f;
  const sel = (v, cur) => (String(v) === String(cur) ? ' selected' : '');
  const opts = (key, all, items) => `<select data-f="${key}"><option value="all">${all}</option>${items.map(([v, l]) => `<option value="${esc(v)}"${sel(v, f[key])}>${esc(l)}</option>`).join('')}</select>`;
  const circuits = [...new Set(T.games.map((g) => circuitOf(g.event)))];
  const events = [...(circuits.length > 1 ? circuits.map((c) => ['c:' + c, eventLabel('c:' + c)]) : []), ...[...new Set(T.games.map((g) => g.event))].map((e) => [e, e])];
  const opps = [...new Map(T.games.map((g) => [g.oppId, g.opp]))].sort((a, b) => a[1].localeCompare(b[1]));
  // Agents this team (or the chosen player) has actually held the Operator on.
  const byA = new Map();
  T.ops.forEach((o) => { if (o.row.agent && (f.player === 'all' || o.p === +f.player) && (f.src === 'pickup' ? o.src === 'pickup' : o.row.op1)) byA.set(o.row.agent, (byA.get(o.row.agent) || 0) + 1); });
  if (f.agent !== 'all' && !byA.has(f.agent)) byA.set(f.agent, 0);
  const agents = [...byA].sort((a, b) => b[1] - a[1]);
  const agentBtns = agents.length
    ? `<button data-f="agent" data-v="all" class="txt ${f.agent === 'all' ? 'on' : ''}">All</button>` + agents.map(([a, c]) => `<button data-f="agent" data-v="${esc(a)}" class="${f.agent === a ? 'on' : ''}" aria-label="${esc(agentName(a))}" aria-pressed="${f.agent === a}" data-tip="${esc(`<b>${esc(agentName(a))}</b><span class="muted">${c} Operator round${c === 1 ? '' : 's'}</span>`)}">${agentIcon(a, 'md')}</button>`).join('')
    : '<span class="muted none">No Operator rounds</span>';
  const side = [['all', 'Both'], ['a', 'Attack'], ['d', 'Defense']].map(([v, l]) => `<button data-f="side" data-v="${v}" class="${f.side === v ? 'on' : ''}">${l}</button>`).join('');
  return `<div class="field"><span>Side</span><div class="seg" role="group" aria-label="Side">${side}</div></div>
    <div class="field"><span>Agent on the Op</span><div class="icoseg" role="group" aria-label="Agent">${agentBtns}</div></div>
    <label class="field"><span>Event</span>${opts('event', 'All events', events)}</label>
    <label class="field"><span>Opponent</span>${opts('opp', 'All opponents', opps)}</label>
    <label class="field"><span>Operator came from</span>${opts('src', 'Any source', Object.entries(SRC).map(([k, v]) => [k, k === 'bought' ? 'Bought it' : v]))}</label>
    <button data-reset class="ghost">Reset</button>`;
}

// ---------------------------------------------------------------- hero (what am I looking at)
const chip = (key, html) => `<button class="fchip" data-clear="${key}" title="Remove this filter">${html}<span class="x" aria-hidden="true">×</span></button>`;
const monthYear = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en', { month: 'short', year: 'numeric' }) : '');
const assetHint = () => (S.hasAssets ? '' : '<p class="note">Logos and agent icons are not downloaded yet. Run <code>python3 etl/fetch_assets.py</code> once, then reload.</p>');

function leagueHero() {
  const L = S.L, parts = describeLeague(L, S.lf);
  const chips = parts.map(([k, html, trusted]) => chip(k, trusted ? html : esc(html))).join('');
  return `<div class="hero-id"><span class="hero-op">${opIcon('lg')}</span><div><h2>League stats: who is using the Operator</h2>
      <p class="muted">Every team together: ${L.teams.length} teams · ${L.players.length} players · ${S.index.games.toLocaleString()} maps. Narrow it down below and click any player or team to open it.</p></div></div>
    <p class="scope">${chips ? `<span class="muted">Showing</span> ${chips}` : '<span><span class="muted">Showing</span> <b>every team</b><span class="muted">, all competitions, maps and agents</span></span>'}</p>${assetHint()}`;
}

/** Operator rows under every active filter except one, for the counts on that filter's own buttons. */
function opRowsWithout(key) {
  const keep = S.f[key];
  S.f[key] = 'all';
  const r = S.T.rows.filter((x) => rowOK(x) && isOp(x));
  S.f[key] = keep;
  return r;
}
const tally = (xs, fn) => { const m = new Map(); xs.forEach((x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }); return m; };
const topKey = (m) => ([...m].sort((a, b) => b[1] - a[1])[0] || [''])[0];
const mapThumb = (m) => (S.maps[m] ? `<img class="ico mapthumb" src="${DATA}${esc(S.maps[m].img)}" alt="">` : '');

function teamHero() {
  const T = S.T, f = S.f;
  const info = S.index.teams.find((t) => t.id === T.team.id) || { events: [] };
  const wins = sum(T.games, (g) => g.won);
  const heldRows = T.rows.filter((x) => x.op1);

  // WHO: one chip per player, counted under the other filters (so on Haven it shows Haven numbers)
  const total = tally(heldRows, (x) => x.pi);                       // overall, keeps the order stable
  const now = opRowsWithout('player');
  const nowN = tally(now, (x) => x.pi);
  const order = T.players.map((p, i) => i).sort((a, b) => (total.get(b) || 0) - (total.get(a) || 0));
  const agentOf = (i) => topKey(tally(now.filter((x) => x.pi === i), (x) => x.agent)) || topKey(tally(heldRows.filter((x) => x.pi === i), (x) => x.agent))
    || topKey(tally(T.games.filter((g) => g.agents[i]), (g) => g.agents[i]));
  const roster = `<button class="pchip txt ${f.player === 'all' ? 'on' : ''}" data-player="all" aria-pressed="${f.player === 'all'}">Whole team<span class="ct">${now.length} Op</span></button>` + order.map((i) => {
    const n = nowN.get(i) || 0, on = String(f.player) === String(i);
    return `<button class="pchip ${on ? 'on' : ''} ${n ? '' : 'idle'}" data-player="${i}" aria-pressed="${on}">${agentIcon(agentOf(i), 'md')}<span class="nm">${esc(T.players[i].name)}</span><span class="ct">${n} Op</span></button>`;
  }).join('');

  // WHERE: one tile per map the team has played
  const totalM = tally(heldRows, (x) => x.g.map);
  const nowM = opRowsWithout('map');
  const nowMN = tally(nowM, (x) => x.g.map);
  const games = tally(T.games, (g) => g.map);
  const maps = [...games.keys()].sort((a, b) => (totalM.get(b) || 0) - (totalM.get(a) || 0) || a.localeCompare(b));
  const tiles = `<button class="mtile txt ${f.map === 'all' ? 'on' : ''}" data-map="all" aria-pressed="${f.map === 'all'}"><span class="st"><span class="nm">All maps</span><span class="ct">${nowM.length} Op</span></span></button>` + maps.map((m) => {
    const n = nowMN.get(m) || 0, on = f.map === m, shown = f.map === 'all' && S.shownMap === m;
    const tip = `<b>${cap(m)}</b><span class="muted">${games.get(m)} game${games.get(m) === 1 ? '' : 's'} played · ${n} Operator round${n === 1 ? '' : 's'}${f.player === 'all' ? '' : ` for ${esc(T.players[+f.player].name)}`}</span>`;
    return `<button class="mtile ${on ? 'on' : ''} ${shown ? 'shown' : ''} ${n ? '' : 'idle'}" data-map="${esc(m)}" aria-pressed="${on}" data-tip="${esc(tip)}">${mapThumb(m)}<span class="st"><span class="nm">${cap(m)}</span><span class="ct">${shown ? 'shown below' : `${n} Op`}</span></span></button>`;
  }).join('');

  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb">${S.L ? '<button data-go="home">All teams</button><span>›</span>' : ''}${f.player === 'all' ? `<b>${esc(T.team.name)}</b>` : `<button data-go="team">${esc(T.team.name)}</button><span>›</span><b>${esc(T.players[+f.player].name)}</b>`}</nav>`;
  return `${crumbs}
    <div class="hero-id">${teamLogo(T.team.id, T.team.name, 'lg')}<div><h2>${esc(T.team.name)}</h2>
      <p class="muted">${esc(info.events.join(', '))} · ${T.games.length} maps, ${wins} won · ${monthYear(info.first)} to ${monthYear(info.last)}</p></div>
      <div class="hero-stats"><span class="pill">${opIcon()}<b>${heldRows.length}</b> Operator rounds</span><span class="pill"><b>${sum(heldRows, (x) => x.ok)}</b> Operator kills</span></div></div>
    <div class="pickrow" role="group" aria-label="Player"><span class="lbl">Who</span><div class="roster">${roster}</div></div>
    <div class="pickrow" role="group" aria-label="Map"><span class="lbl">Where</span><div class="roster">${tiles}</div></div>${assetHint()}`;
}

// The headline on every tab: who you are looking at, and where.
const TAB_NAMES = { map: 'Positions', timing: 'Timing', rotations: 'Rotations', economy: 'Economy', rounds: 'Rounds' };
function ctxTitle(kicker, ops, mk) {
  const T = S.T, f = S.f, solo = f.player !== 'all';
  const map = mk || (f.map !== 'all' ? f.map : null);
  const ranked = (fn) => [...tally(ops, fn)].sort((a, b) => b[1] - a[1]);
  const byP = ranked((o) => o.p), byA = ranked((o) => o.row.agent);
  const name = solo ? T.players[+f.player].name : T.team.name;
  const whoHtml = solo ? `${agentIcon((byA[0] || [''])[0], 'lg')}<span>${esc(name)}</span>` : `${teamLogo(T.team.id, T.team.name, 'lg')}<span>${esc(name)}</span>`;
  const whereHtml = map ? `${mapThumb(map)}<span>${cap(map)}</span>` : '<span>all maps</span>';
  const extra = [f.side !== 'all' ? `${SIDE[f.side].toLowerCase()} only` : '', f.agent !== 'all' ? `on ${esc(agentName(f.agent))}` : '', f.src !== 'all' ? esc(SRC[f.src].toLowerCase()) : '',
    f.event !== 'all' ? esc(eventLabel(f.event)) : '', f.opp !== 'all' ? `vs ${esc((T.games.find((g) => g.oppId === f.opp) || {}).opp || '')}` : ''].filter(Boolean).join(' · ');
  const n = ops.length, s = (k) => (k === 1 ? '' : 's');
  // The header counts rounds that left the buy phase with an Operator; the map also draws mid-round pickups.
  const split = (list) => { const held = list.filter((o) => o.row.op1).length; return [f.src === 'all' ? held : list.length, f.src === 'all' ? list.length - held : 0]; };
  const [held, picked] = split(ops);
  const plus = (k) => (k ? ` <span class="low" title="Operator picked up mid-round">+${k} picked up</span>` : '');
  let sub;
  if (!n) sub = `No Operator rounds ${map ? `on ${cap(map)}` : 'in this selection'}${solo ? ` for ${esc(name)}` : ''}. Pick another ${solo ? 'player or ' : ''}map above.`;
  else if (solo) {
    const sides = f.side === 'all' ? `<span>${ops.filter((o) => o.round.side === 'd').length} on defense · ${ops.filter((o) => o.round.side === 'a').length} on attack</span>` : '';
    sub = `<span><b>${held}</b> Operator round${s(held)}${plus(picked)}</span>${sides}${byA.map(([a, c]) => `<span class="tag">${agentIcon(a)}${esc(agentName(a))} ${c}</span>`).join('')}`;
  } else {
    const btn = ([p, c]) => `<button class="who-btn" data-player="${p}">${agentIcon(topKey(tally(ops.filter((o) => o.p === p), (o) => o.row.agent)))}<b>${esc(T.players[p].name)}</b><span class="ct">${split(ops.filter((o) => o.p === p))[0]}${plus(split(ops.filter((o) => o.p === p))[1])}</span></button>`;
    sub = `<span><b>${held}</b> Operator round${s(held)}${plus(picked)} from ${byP.length} player${s(byP.length)}:</span>${byP.map(btn).join('')}<span class="muted">${byP.length > 1 ? 'Everyone is on the map together. Click a player to see only theirs.' : 'Click to filter to this player.'}</span>`;
  }
  const auto = mk && f.map === 'all' ? `<p class="ctx-note">Showing ${cap(mk)} because it has the most Operator rounds here. Pick another map under “Where” above.</p>` : '';
  return `<div class="ctx" aria-label="${kicker}">
    <h2 class="ctx-h">${whoHtml}<em>on</em>${whereHtml}${extra ? `<small>${extra}</small>` : ''}</h2>
    <p class="ctx-sub">${sub}</p>${auto}</div>`;
}
function teamView() {
  const body = VIEWS[S.tab]();
  if (S.tab === 'overview') return body;
  const { ops } = ctx();
  const mk = S.tab === 'map' ? pickMap(ops) : null;
  return ctxTitle(TAB_NAMES[S.tab], mk ? ops.filter((o) => o.game.map === mk) : ops, mk) + body;
}

// ---------------------------------------------------------------- shared bits
function pickMap(ops) {
  if (S.f.map !== 'all') return S.f.map;
  const n = new Map();
  ops.forEach((o) => n.set(o.game.map, (n.get(o.game.map) || 0) + 1));
  const ranked = [...n].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  S.mapPick = ranked[0][0];
  S.shownMap = S.mapPick;      // lets the header mark which map tile is on screen
  return S.mapPick;
}
const who = (o) => `${agentIcon(o.row.agent)}${esc(S.T.players[o.p].name)} · ${esc(agentName(o.row.agent))}`;
const where = (o) => `${o.game.date} vs ${esc(o.game.opp)} · ${cap(o.game.map)} R${o.r} ${SIDE[o.round.side] || ''}`;
const zone = (o, x, y) => zoneOf(S.maps[o.game.map], x, y);
function posAt(o, t) {
  const p = o.pts;
  if (!p.length || t < p[0].t || t > p[p.length - 1].t) return null;
  for (let i = 1; i < p.length; i++) if (p[i].t >= t) { const a = p[i - 1], b = p[i]; const w = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t); return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }; }
  return p[p.length - 1];
}
const empty = (msg) => `<div class="card empty">${msg}</div>`;

// ---------------------------------------------------------------- overview
const miniBar = (f) => `<span class="mini"><i style="width:${(100 * Math.max(0, Math.min(1, f || 0))).toFixed(0)}%"></i></span>`;
const groupBy = (xs, fn) => { const m = new Map(); xs.forEach((x) => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };

/** Areas ranked by what happens there. Counts match the markers on the Positions map. */
function spotCards(ops) {
  const lists = { setup: new Map(), kills: new Map(), hits: new Map(), deaths: new Map() };
  const add = (m, o, x, y) => { const z = zone(o, x, y); if (!z) return; const k = `${o.game.map}|${z}`; m.set(k, (m.get(k) || 0) + 1); };
  ops.forEach((o) => {
    if (o.pts.length) add(lists.setup, o, o.pts[0].x, o.pts[0].y);
    o.kills.forEach((k) => { if (k[1] === 'operator') add(lists.kills, o, k[2], k[3]); });
    o.hits.forEach((h) => { if (!h[7]) add(lists.hits, o, h[1], h[2]); });
    if (o.death) add(lists.deaths, o, o.death[1], o.death[2]);
  });
  if (!Object.values(lists).some((m) => m.size)) return '';
  const card = (key, title, sub) => {
    const all = [...lists[key]].sort((a, b) => b[1] - a[1]);
    const total = sum(all, (e) => e[1]);
    const rows = all.slice(0, 6).map(([k, n]) => { const [m, z] = k.split('|'); return `<tr class="click" data-spot="${esc(m)}" data-layer="${key}"><td>${esc(z)}</td><td class="low">${cap(m)}</td><td class="num">${n} <span class="low">${pct(n, total)}</span></td></tr>`; }).join('');
    return `<div class="card"><h2>${title}</h2><p class="sub">${sub}</p>${rows ? `<table><tbody>${rows}</tbody></table>` : '<p class="muted">None in this selection.</p>'}</div>`;
  };
  return `<div><div class="grid-head"><h2>Common spots</h2><span class="muted">Most frequent areas${S.f.map === 'all' ? ' across all maps' : ` on ${cap(S.f.map)}`}. Click one to open it on the map.</span></div>
    <div class="grid g4">
      ${card('setup', 'Sets up at', 'Position when the barriers drop.')}
      ${card('kills', 'Gets Operator kills from', 'Where the shooter was standing.')}
      ${card('hits', 'Hits without the kill from', 'Shots that connected but did not kill. Clean misses are not in the data.')}
      ${card('deaths', 'Dies holding it at', 'Where the Operator holder was killed.')}
    </div></div>`;
}

function viewOverview() {
  const { T, rows, rounds, opRows, ops } = ctx();
  if (!rows.length) return empty('No rounds match these filters.');
  const b = baseline();
  const cost = S.index.opCost;
  const opRecs = ops.filter((o) => isOp(o.row));
  const opRoundIds = new Set(opRows.map((x) => x.r));
  const withOp = rounds.filter((r) => opRoundIds.has(r));
  const without = rounds.filter((r) => !opRoundIds.has(r));
  const canBuy = (xs) => xs.filter((x) => !x.op0 && x.m0 >= cost);
  const afford = canBuy(rows);
  const bought = afford.filter((x) => x.src === 'bought');
  const opKills = sum(opRows, (x) => x.ok);
  const fk = opRecs.filter((o) => o.kills.some((k) => k[7] && k[1] === 'operator')).length;
  const fd = opRecs.filter((o) => o.death && o.death[7]).length;
  const cmp = (txt) => (whole() ? `League avg ${txt}` : '');
  const tiles = `<div class="grid tiles">${[
    tile('Rounds with an Operator', pct(withOp.length, rounds.length), `${withOp.length} of ${rounds.length} rounds`, cmp(pct(b.trOp, b.tr))),
    tile('Buys it when affordable', pct(bought.length, afford.length), `${bought.length} of ${afford.length} player-rounds with $4,700+`, cmp(pct(b.buy, b.opp, 1) + ' per player-round')),
    tile('Operator kills per Op round', num(opKills / opRows.length), `${opKills} kills in ${opRows.length} Op rounds`, cmp(num(b.opKills / b.opr))),
    tile('Opening kill with the Op', pct(fk, opRows.length), `${fk} first bloods · dies first in ${pct(fd, opRows.length)}`, cmp(`${pct(b.opFk, b.opr)} · dies first ${pct(b.opFd, b.opr)}`)),
    tile('Op holder dies', pct(sum(opRows, (x) => x.d), opRows.length), `keeps the Op to round end in ${pct(sum(opRows, (x) => x.ope), opRows.length)}`, cmp(`${pct(b.opDeaths, b.opr)} die · ${pct(b.opSaved, b.opr)} keep`)),
    tile('Round win rate with an Op', pct(sum(withOp, (r) => r.won), withOp.length), `${pct(sum(without, (r) => r.won), without.length)} without one`, cmp(`${pct(b.winOp, b.trOp)} with · ${pct(b.winNoOp, b.tr - b.trOp)} without`)),
  ].join('')}</div>`;
  const ranked = (m) => [...m].sort((a, c) => c[1].length - a[1].length);

  // ------------------------------------------------ one player: their Operator profile
  if (S.f.player !== 'all') {
    const me = T.players[+S.f.player].name;
    const teamOp = T.rows.filter((x) => roundOK(x.r) && isOp(x)).length;   // same maps, side and events, any player
    const topAgent = (ranked(groupBy(opRows, (x) => x.agent))[0] || ranked(groupBy(rows, (x) => x.agent))[0] || [''])[0];
    const line = opRows.length
      ? `<b>${opRows.length}</b> of ${esc(T.team.name)}'s ${teamOp} Operator rounds (${pct(opRows.length, teamOp)}) · has one in <b>${pct(opRows.length, rows.length)}</b> of ${rows.length.toLocaleString()} rounds played · buys it <b>${pct(bought.length, afford.length)}</b> of the time it is affordable (${bought.length}/${afford.length}) · <b>${num(opKills / opRows.length)}</b> Operator kills a round`
      : `No Operator rounds in this selection (${rows.length.toLocaleString()} rounds played).`;
    const jump = [['map', 'Positions and kill spots'], ['timing', 'When the shots land'], ['rotations', 'Where they go after a kill'], ['economy', 'When they buy it'], ['rounds', 'Round-by-round replays']]
      .map(([t, l]) => `<button class="jump" data-jump="${t}">${l}<span aria-hidden="true">→</span></button>`).join('');
    const profile = `<div class="card profile"><div class="hero-id">${agentIcon(topAgent, 'lg')}<div><h2>${esc(me)} on the Operator</h2><p class="lede">${line}</p></div></div>
      ${opRows.length ? `<div class="jumps"><span class="muted">Dig into</span>${jump}</div>` : ''}</div>`;

    const agents = ranked(groupBy(rows, (x) => x.agent)).map(([a, xs]) => { const o = xs.filter(isOp); return { a, n: xs.length, op: o.length, ok: sum(o, (x) => x.ok) }; }).sort((x, y) => y.op - x.op || y.n - x.n);
    const maxA = Math.max(1, ...agents.map((e) => e.op));
    const atable = `<table><thead><tr><th>Agent</th><th class="num">Rounds</th><th class="num">Op rounds</th><th class="num">Has it in</th><th class="num">Op kills</th><th class="num">Kills / rd</th></tr></thead><tbody>${agents.map((e) => `<tr class="click ${S.f.agent === e.a ? 'sel' : ''}" data-agent="${esc(e.a)}"><td>${agentTag(e.a)}</td><td class="num">${e.n}</td><td class="num">${e.op} ${miniBar(e.op / maxA)}</td><td class="num">${pct(e.op, e.n)}</td><td class="num">${e.ok}</td><td class="num">${e.op ? num(e.ok / e.op) : '–'}</td></tr>`).join('')}</tbody></table>`;

    const maps = ranked(groupBy(rows, (x) => x.g.map)).map(([m, xs]) => {
      const o = xs.filter(isOp), side = (s) => { const all = xs.filter((x) => x.r.side === s); return `${all.filter(isOp).length}<span class="low">/${all.length}</span>`; };
      return { m, n: xs.length, op: o.length, ok: sum(o, (x) => x.ok), a: side('a'), d: side('d') };
    }).sort((x, y) => y.op - x.op || y.n - x.n);
    const maxM = Math.max(1, ...maps.map((e) => e.op));
    const mtable = `<table><thead><tr><th>Map</th><th class="num">Rounds</th><th class="num">Op rounds</th><th class="num">Has it in</th><th class="num">Attack</th><th class="num">Defense</th><th class="num">Op kills</th><th class="num">Kills / rd</th></tr></thead><tbody>${maps.map((e) => `<tr class="click ${S.f.map === e.m ? 'sel' : ''}" data-map="${esc(e.m)}"><td>${cap(e.m)}</td><td class="num">${e.n}</td><td class="num">${e.op} ${miniBar(e.op / maxM)}</td><td class="num">${pct(e.op, e.n)}</td><td class="num">${e.a}</td><td class="num">${e.d}</td><td class="num">${e.ok}</td><td class="num">${e.op ? num(e.ok / e.op) : '–'}</td></tr>`).join('')}</tbody></table>`;

    return `<div class="grid">${profile}${tiles}
      <div class="grid g2">
        <div class="card"><h2>Which agents</h2><p class="sub">Agents ${esc(me)} has played, and how often the Operator comes out on each. Click an agent to filter.</p><div class="scroll">${atable}</div></div>
        <div class="card"><h2>Which maps</h2><p class="sub">Operator rounds per map. Attack and Defense are Op rounds out of rounds played on that side; Kills / rd is Operator kills per Op round. Click a map to filter.</p><div class="scroll">${mtable}</div></div>
      </div>
      ${spotCards(ops)}</div>`;
  }

  // ------------------------------------------------ whole team: who has it
  const ppl = ranked(groupBy(rows, (x) => x.pi)).map(([pi, xs]) => {
    const o = xs.filter(isOp), a = canBuy(xs);
    return { pi, n: xs.length, o, aff: a.length, buy: a.filter((x) => x.src === 'bought').length, ok: sum(o, (x) => x.ok), d: sum(o, (x) => x.d), ope: sum(o, (x) => x.ope) };
  }).sort((a, c) => c.o.length - a.o.length);
  const users = ppl.filter((p) => p.o.length), idle = ppl.filter((p) => !p.o.length);
  const cards = users.map((p) => {
    const name = T.players[p.pi].name, n = p.o.length;
    const ag = ranked(groupBy(p.o, (x) => x.agent));
    const mp = ranked(groupBy(p.o, (x) => x.g.map)).slice(0, 3).map(([m, xs]) => `${cap(m)} ${xs.length}`).join(' · ');
    const tip = `<b>${esc(name)}</b><span class="muted">${n} Operator rounds in ${p.n} rounds played (${pct(n, p.n)})</span><span class="muted">Dies holding it in ${pct(p.d, n)} · still has it at round end in ${pct(p.ope, n)}</span>`;
    return `<button class="pick pcard" data-player="${p.pi}" data-tip="${esc(tip)}">
      ${agentIcon(ag[0][0], 'lg')}
      <span class="pk-main"><b>${esc(name)}</b><small>${n} Op round${n === 1 ? '' : 's'}</small></span>
      <span class="pk-stat"><b>${pct(n, opRows.length)}</b><small>of the team's Op rounds</small></span>
      <span class="meter"><i style="width:${(100 * n / opRows.length).toFixed(1)}%"></i></span>
      <span class="pk-foot">
        <span class="kvs"><span><b>${num(p.ok / n)}</b> kills a round</span><span><b>${pct(p.buy, p.aff)}</b> buys when affordable <span class="low">${p.buy}/${p.aff}</span></span></span>
        <span class="tags">${ag.slice(0, 4).map(([a, xs]) => `<span class="tag">${agentIcon(a)}<span class="low">${xs.length}</span></span>`).join('')}</span>
        <span class="low">${mp}</span>
      </span>
    </button>`;
  }).join('');
  const lead = users[0];
  const headline = lead
    ? `<b>${esc(T.players[lead.pi].name)}</b> has had ${pct(lead.o.length, opRows.length)} of the team's Operator rounds${users.length > 1 ? `; ${users.length - 1} other player${users.length === 2 ? ' has' : 's have'} had one at least once` : ''}. Click a player to see only their Operator play.`
    : 'Nobody had an Operator in this selection.';
  const whoCard = `<div class="card"><h2>${opIcon()}Who has the Operator</h2><p class="sub">${headline}</p>
    ${cards ? `<div class="picks players">${cards}</div>` : ''}
    ${idle.length && users.length ? `<p class="note">Never had one here: ${idle.map((p) => esc(T.players[p.pi].name)).join(', ')}.</p>` : ''}</div>`;

  // map x side
  const ms = new Map();
  rounds.forEach((r) => { const k = `${r.g.map}|${r.side}`; if (!ms.has(k)) ms.set(k, { map: r.g.map, side: r.side, n: 0, op: 0, wOp: 0, wNo: 0, ok: 0 }); const m = ms.get(k); m.n++; if (opRoundIds.has(r)) { m.op++; m.wOp += r.won; } else m.wNo += r.won; });
  opRows.forEach((x) => { ms.get(`${x.g.map}|${x.r.side}`).ok += x.ok; });
  const mtable = `<table><thead><tr><th>Map</th><th>Side</th><th class="num">Rounds</th><th class="num">With an Op</th><th class="num">League</th><th class="num">Op kills</th><th class="num">Win % with</th><th class="num">Win % without</th></tr></thead><tbody>` +
    [...ms.values()].sort((a, c) => a.map.localeCompare(c.map) || a.side.localeCompare(c.side)).map((m) => {
      const lb = (S.index.baseline[m.map] || {})[m.side];
      return `<tr class="click" data-map="${m.map}"><td>${cap(m.map)}</td><td>${SIDE[m.side] || ''}</td><td class="num">${m.n}</td><td class="num">${pct(m.op, m.n)} <span class="low">${m.op}</span></td><td class="num low">${lb ? pct(lb.trOp, lb.tr) : '–'}</td><td class="num">${m.ok}</td><td class="num">${pct(m.wOp, m.op)}</td><td class="num">${pct(m.wNo, m.n - m.op)}</td></tr>`;
    }).join('') + '</tbody></table>';

  // player+agent x map
  const maps = [...new Set(opRows.map((x) => x.g.map))].sort();
  const pa = new Map();
  opRows.forEach((x) => { const k = `${x.pi}|${x.agent}`; if (!pa.has(k)) pa.set(k, { pi: x.pi, agent: x.agent, tot: 0, m: {} }); const e = pa.get(k); e.tot++; const c = (e.m[x.g.map] ||= { n: 0, k: 0 }); c.n++; c.k += x.ok; });
  const atable = maps.length ? `<table><thead><tr><th>Player</th><th>Agent</th><th class="num">Op rounds</th>${maps.map((m) => `<th class="num">${cap(m)}</th>`).join('')}</tr></thead><tbody>` +
    [...pa.values()].sort((a, c) => c.tot - a.tot).slice(0, 30).map((e) => `<tr class="click" data-player="${e.pi}"><td>${esc(T.players[e.pi].name)}</td><td>${agentTag(e.agent)}</td><td class="num">${e.tot}</td>${maps.map((m) => `<td class="num">${e.m[m] ? `${e.m[m].n} <span class="low">(${e.m[m].k})</span>` : '<span class="low">·</span>'}</td>`).join('')}</tr>`).join('') + '</tbody></table>' : '<p class="muted">No Operator rounds in this selection.</p>';

  return `<div class="grid">${whoCard}${tiles}${spotCards(ops)}
  <div class="grid g2">
    <div class="card"><h2>By map and side</h2><p class="sub">Share of the team's rounds with at least one Operator, against the league average for that map and side. Click a map to filter.</p><div class="scroll">${mtable}</div></div>
    <div class="card"><h2>Agent on the Operator, by map</h2><p class="sub">Op rounds per map, with Operator kills in brackets.</p><div class="scroll">${atable}</div></div>
  </div></div>`;
}

// ---------------------------------------------------------------- positions
function viewMap() {
  const { ops } = ctx();
  const mk = pickMap(ops);
  if (!mk) return empty('No Operator rounds match these filters.');
  const L = S.layers;
  const box = (k, label) => `<label><input type="checkbox" data-layer="${k}" ${L[k] ? 'checked' : ''}> ${label}</label>`;
  return `<div class="grid map-layout">
    <div class="card">
      <div class="controls">${box('heat', 'Time spent')}${box('setup', 'Setup spot')}${box('kills', 'Op kills')}${box('hits', 'Op hits, no kill')}${box('deaths', 'Deaths holding it')}</div>
      <div class="controls"><label>Round time from <input type="range" id="w0" min="0" max="120" step="5" value="${S.win[0]}"> <span id="w0v">${S.win[0]}s</span></label><label>to <input type="range" id="w1" min="5" max="120" step="5" value="${S.win[1]}"> <span id="w1v">${S.win[1] >= 120 ? 'end' : S.win[1] + 's'}</span></label></div>
      <div class="mapwrap"><canvas id="mapc"></canvas></div>
      ${legend([['Time spent holding the Op (brighter = longer)', C.def], ['Op kill: shooter, line to victim', C.kill, 'dot'], ['Op hit, no kill', C.kill, 'ring'], ['Died holding the Op', C.atk, 'x'], ['Position when barriers drop', null, 'sq']])}
      <p class="note">Hover a marker for the round; click it to open the round replay.</p>
    </div>
    <div class="card"><h2>Where the Op is played from</h2><p class="sub" id="zoneSub"></p><div id="zones" class="scroll"></div></div>
  </div>`;
}

function drawMapTab() {
  const { ops } = ctx();
  const mk = pickMap(ops);
  const cv = $('#mapc');
  if (!mk || !cv) return;
  const mine = ops.filter((o) => o.game.map === mk);
  const [w0, w1] = [S.win[0], S.win[1] >= 120 ? Infinity : S.win[1]];
  const inWin = (t) => t >= w0 && t <= w1;
  const mv = new MapView(cv, S.maps[mk], mine);
  mv.ready.then(() => {
    mv.base();
    const L = S.layers;
    if (L.heat) mv.heat(mine, w0, w1);
    if (L.setup) mine.forEach((o) => { if (o.pts.length) mv.square(o.pts[0].x, o.pts[0].y, `<b>Setup</b> ${who(o)}<span class="muted">${where(o)}</span>`, () => openRound(o)); });
    mine.forEach((o) => {
      if (L.hits) o.hits.filter((h) => !h[7] && inWin(h[0])).forEach((h) => mv.ring(h[1], h[2], C.kill, `<b>Op hit ${h[5]} dmg</b> on ${esc(h[8])} at ${secs(h[0])}<span class="muted">${who(o)} · ${where(o)}</span>`, () => openRound(o)));
      if (L.kills) o.kills.filter((k) => k[1] === 'operator' && inWin(k[0])).forEach((k) => { mv.line(k[2], k[3], k[4], k[5], C.kill); mv.dot(k[2], k[3], C.kill, `<b>Op kill</b> on ${agentIcon(k[8])}${esc(k[6])} at ${secs(k[0])}${k[7] ? ' · opening kill' : ''}<span class="muted">${who(o)} · from ${esc(zone(o, k[2], k[3]))}</span><span class="muted">${where(o)}</span>`, () => openRound(o)); });
      if (L.deaths && o.death && inWin(o.death[0])) mv.cross(o.death[1], o.death[2], C.atk, `<b>Died</b> to ${esc(o.death[5])} (${esc(o.death[6]) || '?'}) at ${secs(o.death[0])}${o.death[7] ? ' · first death' : ''}<span class="muted">${who(o)} · ${where(o)}</span>`, () => openRound(o));
    });
    mv.flush();
  });

  // zone table
  const z = new Map();
  const get = (name) => { if (!z.has(name)) z.set(name, { name, t: 0, k: 0, h: 0, d: 0, s: 0 }); return z.get(name); };
  let total = 0;
  mine.forEach((o) => {
    const p = o.pts;
    if (p.length) get(zone(o, p[0].x, p[0].y)).s++;
    for (let i = 0; i < p.length; i++) {
      const t1 = i + 1 < p.length ? p[i + 1].t : p[i].t + 1;
      const dt = Math.max(0, Math.min(t1, w1) - Math.max(p[i].t, w0));
      if (dt > 0) { const d = Math.min(dt, 8); get(zone(o, p[i].x, p[i].y)).t += d; total += d; }
    }
    o.kills.filter((k) => k[1] === 'operator' && inWin(k[0])).forEach((k) => get(zone(o, k[2], k[3])).k++);
    o.hits.filter((h) => !h[7] && inWin(h[0])).forEach((h) => get(zone(o, h[1], h[2])).h++);
    if (o.death && inWin(o.death[0])) get(zone(o, o.death[1], o.death[2])).d++;
  });
  const zs = [...z.values()].filter((e) => e.name).sort((a, b) => b.t - a.t).slice(0, 18);
  $('#zoneSub').textContent = `${cap(mk)} · ${mine.length} Operator rounds${S.f.side === 'all' ? ' · both sides, filter a side for a cleaner read' : ' · ' + SIDE[S.f.side]}`;
  $('#zones').innerHTML = zs.length ? `<table><thead><tr><th>Area</th><th class="num">Time share</th><th class="num">Setups</th><th class="num">Op kills</th><th class="num" title="Operator shots that hit but did not kill">Hit, no kill</th><th class="num">Deaths</th></tr></thead><tbody>${zs.map((e) => `<tr><td>${esc(e.name)}</td><td class="num">${pct(e.t, total)}</td><td class="num">${e.s || ''}</td><td class="num">${e.k || ''}</td><td class="num">${e.h || ''}</td><td class="num">${e.d || ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Callout names unavailable (run etl/fetch_maps.py).</p>';
}

// ---------------------------------------------------------------- timing
function viewTiming() {
  const { ops, held, rounds, opRows } = ctx();
  if (!ops.length) return empty('No Operator rounds match these filters.');
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const cats = bins.map((b, i) => (i === bins.length - 1 ? '90s+' : `${b}–${b + 10}s`));
  const bi = (t) => Math.min(bins.length - 1, Math.max(0, Math.floor(t / 10)));
  const sides = S.f.side === 'all' ? ['a', 'd'] : [S.f.side];
  const col = { a: C.atk, d: C.def };
  const hist = (get) => sides.map((s) => { const v = bins.map(() => 0); let n = 0; ops.filter((o) => o.round.side === s).forEach((o) => get(o).forEach((t) => { v[bi(t)]++; n++; })); return { name: SIDE[s], color: col[s], vals: v, total: n }; });
  const firstShot = hist((o) => (o.hits.length ? [o.hits[0][0]] : []));
  const allShots = hist((o) => [...new Set(o.hits.map((h) => h[0]))]);
  const deaths = hist((o) => (o.death ? [o.death[0]] : []));
  const tipFor = (label) => (s, i, v) => `<b>${cats[i]}</b> · ${s.name}<span class="muted">${v} ${label} (${pct(v, s.total)} of this side's)</span>`;

  const firstTimes = held.filter((o) => o.hits.length).map((o) => o.hits[0][0]);
  const shotsPer = [0, 0, 0, 0];
  held.forEach((o) => shotsPer[Math.min(3, new Set(o.hits.map((h) => h[0])).size)]++);
  const contact = held.map((o) => Math.min(o.hits.length ? o.hits[0][0] : Infinity, o.ft ?? Infinity)).filter(Number.isFinite);
  const tiles = [
    tile('Lands an Op shot', pct(held.length - shotsPer[0], held.length), `of ${held.length} rounds starting with the Op`),
    tile('First Op hit, median', firstTimes.length ? secs(median(firstTimes)) : '–', 'after barriers drop'),
    tile('First contact, median', contact.length ? secs(median(contact)) : '–', 'first Op hit or first damage taken'),
    tile('Shots landed per Op round', num(sum(held, (o) => new Set(o.hits.map((h) => h[0])).size) / held.length), `two or more in ${pct(shotsPer[2] + shotsPer[3], held.length)}`),
  ].join('');

  // by round number
  const maxN = 24, tot = Array(maxN).fill(0), has = Array(maxN).fill(0);
  const opR = new Set(opRows.map((x) => x.r));
  rounds.forEach((r) => { if (r.n <= maxN) { tot[r.n - 1]++; if (opR.has(r)) has[r.n - 1]++; } });
  const byRound = barChart({ cats: tot.map((_, i) => String(i + 1)), series: [{ name: 'Rounds with an Op', color: C.def, vals: has.map((h, i) => (tot[i] ? Math.round(100 * h / tot[i]) : 0)) }], unit: '%', height: 230, wide: true, tip: (s, i, v) => `<b>Round ${i + 1}</b><span class="muted">Op in ${has[i]} of ${tot[i]} rounds (${v}%)</span>` });

  const lg = sides.length > 1 ? legend([['Attack', C.atk], ['Defense', C.def]]) : '';
  return `<div class="grid tiles">${tiles}</div>
  <div class="grid g2">
    <div class="card"><h2>When the first Operator shot lands</h2><p class="sub">First hit of each Op round, by time since barriers dropped. The closest thing the data has to “when do they peek”.</p>${lg}${barChart({ cats, series: firstShot, tip: tipFor('first hits') })}</div>
    <div class="card"><h2>All Operator shots that hit</h2><p class="sub">Every hit, kill or not. Misses are not in the feed.</p>${lg}${barChart({ cats, series: allShots, tip: tipFor('hits') })}</div>
    <div class="card"><h2>When the Op holder dies</h2><p class="sub">Time of death in rounds they were holding it.</p>${lg}${barChart({ cats, series: deaths, tip: tipFor('deaths') })}</div>
    <div class="card"><h2>Shots landed in a round</h2><p class="sub">How many separate Operator shots connect in a round that starts with the Op.</p>${barChart({ cats: ['None', '1', '2', '3+'], series: [{ name: 'Op rounds', color: C.def, vals: shotsPer, total: held.length }], tip: (s, i, v) => `<b>${['No hits', '1 hit', '2 hits', '3+ hits'][i]}</b><span class="muted">${v} rounds (${pct(v, held.length)})</span>` })}</div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Operator rounds by round number</h2><p class="sub">Share of rounds with an Operator out, by round of the map (13 is the first round after the side swap).</p>${byRound}</div>`;
}

// ---------------------------------------------------------------- rotations
function pairsOf(ops) {
  const out = [];
  ops.forEach((o) => { if (o.kills.length >= 2) { const [a, b] = o.kills; out.push({ o, a, b, gap: b[0] - a[0], d: dist(a[2], a[3], b[2], b[3]) }); } });
  return out;
}
function viewRotations() {
  const { ops } = ctx();
  if (!ops.length) return empty('No Operator rounds match these filters.');
  const withKill = ops.filter((o) => o.kills.length >= 1);
  const pairs = pairsOf(ops);
  const gaps = pairs.map((p) => p.gap), ds = pairs.map((p) => p.d);
  const held = pairs.filter((p) => p.d < 5).length;
  const tiles = [
    tile('Gets a kill', pct(withKill.length, ops.length), `${withKill.length} of ${ops.length} Op rounds`),
    tile('Follows with a second', pct(pairs.length, withKill.length), `${pairs.length} rounds with 2+ kills`),
    tile('Time between kills 1 and 2', gaps.length ? secs(median(gaps)) : '–', gaps.length ? `median · quickest ${secs(Math.min(...gaps))}` : ''),
    tile('Distance moved between them', ds.length ? `${median(ds).toFixed(1)} m` : '–', `same spot (under 5 m) in ${pct(held, pairs.length)}`),
  ].join('');

  const gb = [[0, 2], [2, 5], [5, 10], [10, 20], [20, 40], [40, 1e9]];
  const gcat = ['0–2s', '2–5s', '5–10s', '10–20s', '20–40s', '40s+'];
  const gv = gb.map(([a, b]) => pairs.filter((p) => p.gap >= a && p.gap < b).length);
  const db = [[0, 5], [5, 15], [15, 30], [30, 1e9]];
  const dcat = ['Held (<5 m)', 'Shifted (5–15 m)', 'Relocated (15–30 m)', 'Rotated (30 m+)'];
  const dv = db.map(([a, b]) => pairs.filter((p) => p.d >= a && p.d < b).length);

  // after the first kill: where are they 5s / 10s later?
  const after = (dt) => { const v = [0, 0, 0, 0]; let n = 0; withKill.forEach((o) => { const k = o.kills[0]; const p = posAt(o, k[0] + dt); if (!p) return; n++; const d = dist(k[2], k[3], p.x, p.y); v[d < 3 ? 0 : d < 10 ? 1 : d < 25 ? 2 : 3]++; }); return { v, n }; };
  const a5 = after(5), a10 = after(10);
  const acat = ['Stayed (<3 m)', 'Shifted (3–10 m)', 'Moved (10–25 m)', 'Gone (25 m+)'];

  // escape abilities after an Op hit
  const ab = new Map(); let hitN = 0;
  ops.forEach((o) => [...new Set(o.hits.map((h) => h[0]))].forEach((t) => { hitN++; const used = new Set(o.abil.filter((a) => a[0] >= t && a[0] <= t + 3).map((a) => a[1])); used.forEach((a) => ab.set(a, (ab.get(a) || 0) + 1)); }));
  const abl = [...ab].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, c]) => ({ label: abilityName(a), icon: abilityIcon(a), n: c, d: hitN }));

  // zone transitions
  const tr = new Map();
  pairs.forEach((p) => { const k = `${p.o.game.map}|${zone(p.o, p.a[2], p.a[3])}|${zone(p.o, p.b[2], p.b[3])}`; if (!tr.has(k)) tr.set(k, []); tr.get(k).push(p); });
  const trows = [...tr].sort((a, b) => b[1].length - a[1].length).slice(0, 40).map(([k, ps]) => { const [m, z1, z2] = k.split('|'); return `<tr><td>${cap(m)}</td><td>${esc(z1) || '–'}</td><td>${z1 === z2 ? '<span class="low">same area</span>' : esc(z2) || '–'}</td><td class="num">${ps.length}</td><td class="num">${secs(median(ps.map((p) => p.gap)))}</td><td class="num">${median(ps.map((p) => p.d)).toFixed(1)} m</td></tr>`; }).join('');

  const mk = pickMap(ops);
  return `<div class="grid tiles">${tiles}</div>
  <div class="grid map-layout">
    <div class="card">
      <h2>${mapThumb(mk)}Paths on ${cap(mk || '')}</h2><p class="sub">From first kill (1) to second kill (2), any weapon, in rounds holding the Op.${S.f.map === 'all' ? ' The numbers on this tab cover all maps; pick a map under “Where” to match them to this picture.' : ''}</p>
      <div class="mapwrap"><canvas id="rotc"></canvas></div>
      ${legend([['First kill position', C.kill, 'dot'], ['Second kill position', C.def, 'dot'], ['Path between them', '#c3c2b7']])}
      <p class="note">${cap(mk || '')}: hover a marker for the round, click to open its replay.</p>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h2>Gap between first and second kill</h2><p class="sub">${pairs.length} rounds with two or more kills.</p>${barChart({ cats: gcat, series: [{ name: 'Rounds', color: C.def, vals: gv }], height: 170, tip: (s, i, v) => `<b>${gcat[i]}</b><span class="muted">${v} rounds (${pct(v, pairs.length)})</span>` })}</div>
      <div class="card"><h2>How far they moved for the second kill</h2><p class="sub">Straight-line distance between the two shooting positions.</p>${barList(dcat.map((l, i) => ({ label: l, n: dv[i], d: pairs.length })))}</div>
      <div class="card"><h2>After the first kill</h2><p class="sub">Distance from the kill spot 5 and 10 seconds later (rounds where they were still alive and tracked).</p><h3>5 seconds later · ${a5.n} rounds</h3>${barList(acat.map((l, i) => ({ label: l, n: a5.v[i], d: a5.n })))}<h3 style="margin-top:12px">10 seconds later · ${a10.n} rounds</h3>${barList(acat.map((l, i) => ({ label: l, n: a10.v[i], d: a10.n })))}</div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>First kill area to second kill area</h2><p class="sub">Most common pairs, with the median gap and distance.</p><div class="scroll">${trows ? `<table><thead><tr><th>Map</th><th>Kill 1 from</th><th>Kill 2 from</th><th class="num">Rounds</th><th class="num">Gap</th><th class="num">Moved</th></tr></thead><tbody>${trows}</tbody></table>` : '<p class="muted">No multi-kill Operator rounds in this selection.</p>'}</div></div>
    <div class="card"><h2>Ability used within 3s of an Op hit</h2><p class="sub">Share of ${hitN} Operator shots that hit followed by each ability. High numbers on a dash or teleport mean shoot-and-leave.</p>${abl.length ? barList(abl) : '<p class="muted">None recorded.</p>'}</div>
  </div>`;
}
function drawRotations() {
  const { ops } = ctx();
  const mk = pickMap(ops);
  const cv = $('#rotc');
  if (!mk || !cv) return;
  const mine = ops.filter((o) => o.game.map === mk);
  const mv = new MapView(cv, S.maps[mk], mine);
  mv.ready.then(() => {
    mv.base();
    pairsOf(mine).forEach((p) => {
      const seg = p.o.pts.filter((q) => q.t >= p.a[0] && q.t <= p.b[0]);
      mv.path([{ x: p.a[2], y: p.a[3] }, ...seg, { x: p.b[2], y: p.b[3] }], 'rgba(195,194,183,.55)', 1.25);
      const tip = (n, k) => `<b>Kill ${n}</b> on ${esc(k[6])} with ${esc(k[1]) || '?'} at ${secs(k[0])}<span class="muted">${who(p.o)} · gap ${secs(p.gap)} · moved ${p.d.toFixed(1)} m</span><span class="muted">${where(p.o)}</span>`;
      mv.dot(p.a[2], p.a[3], C.kill, tip(1, p.a), () => openRound(p.o), '1');
      mv.dot(p.b[2], p.b[3], C.def, tip(2, p.b), () => openRound(p.o), '2');
    });
    mv.flush();
  });
}

// ---------------------------------------------------------------- economy
function viewEconomy() {
  const { T, rows, rounds } = ctx();
  if (!rows.length) return empty('No rounds match these filters.');
  const cost = S.index.opCost;
  const b = baseline();
  const aff = rows.filter((x) => !x.op0 && x.m0 >= cost);
  const isBuy = (x) => x.src === 'bought';
  const buys = aff.filter(isBuy);
  const got = rows.filter((x) => x.src);
  const mix = Object.keys(SRC).map((k) => ({ label: SRC[k], n: got.filter((x) => x.src === k).length, d: got.length }));
  const rate = (label, xs) => ({ label, n: xs.filter(isBuy).length, d: xs.length });
  const leagueRate = b.opp ? b.buy / b.opp : null;
  const teamChance = rounds.filter((r) => !r.rows.some((x) => x.op0) && r.rows.some((x) => x.m0 >= cost));
  const teamAdds = teamChance.filter((r) => r.rows.some((x) => x.op1));
  const tiles = [
    tile('Team brings one out', pct(teamAdds.length, teamChance.length), `${teamAdds.length} of ${teamChance.length} rounds where someone had $${cost.toLocaleString()}+ and none was carried over`),
    tile('Could afford one', String(aff.length), `player-rounds with $${cost.toLocaleString()}+ and no Op carried over`),
    tile('Bought it', pct(buys.length, aff.length), `${buys.length} buys`, whole() ? `League avg ${pct(b.buy, b.opp, 1)} per player-round` : ''),
    tile('Typical money when buying', buys.length ? '$' + Math.round(median(buys.map((x) => x.m0))).toLocaleString() : '–', buys.length ? `lowest $${Math.min(...buys.map((x) => x.m0)).toLocaleString()}` : ''),
    tile('Got one without buying', String(got.filter((x) => x.src !== 'bought').length), `${mix[1].n} carried over · ${mix[2].n} from a teammate · ${mix[3].n} picked up`),
  ].join('');

  const money = [[cost, 5700, '$4,700–5,699'], [5700, 7000, '$5,700–6,999'], [7000, 9000, '$7,000–8,999'], [9000, 1e9, '$9,000 (cap)']].map(([a, c, l]) => rate(l, aff.filter((x) => x.m0 >= a && x.m0 < c)));
  const sit = [
    rate('On attack', aff.filter((x) => x.r.side === 'a')),
    rate('On defense', aff.filter((x) => x.r.side === 'd')),
    rate('After winning the round', aff.filter((x) => x.r.prev && x.r.prev.won)),
    rate('After losing the round', aff.filter((x) => x.r.prev && !x.r.prev.won)),
    rate('Leading on the map', aff.filter((x) => x.r.scoreOwn > x.r.scoreOpp)),
    rate('Trailing on the map', aff.filter((x) => x.r.scoreOwn < x.r.scoreOpp)),
    rate('Enemy had an Op last round', aff.filter((x) => x.r.prev && x.r.prev.eop > 0)),
    rate('Enemy had none last round', aff.filter((x) => x.r.prev && x.r.prev.eop === 0)),
    rate('Lost their own Op last round', aff.filter((x) => { const p = x.r.prev && x.r.prev.rows.find((y) => y.pi === x.pi); return p && p.op1 && !p.ope; })),
  ];
  const mark = leagueRate;

  const inst = new Map();
  aff.filter((x) => !isBuy(x) && !x.op1).forEach((x) => inst.set(x.w || 'nothing', (inst.get(x.w || 'nothing') || 0) + 1));
  const notBuy = aff.length - buys.length;
  const instead = [...inst].sort((a, c) => c[1] - a[1]).slice(0, 7).map(([w, c]) => ({ label: cap(w), icon: weaponIcon(w), n: c, d: notBuy }));

  const per = [0, 0, 0];
  rounds.forEach((r) => per[Math.min(2, r.rows.filter((x) => x.op1).length)]++);

  const byP = new Map();
  rows.forEach((x) => { if (!byP.has(x.pi)) byP.set(x.pi, []); byP.get(x.pi).push(x); });
  const prow = [...byP].map(([pi, xs]) => { const a = xs.filter((x) => !x.op0 && x.m0 >= cost), bu = a.filter(isBuy); return { pi, a: a.length, b: bu.length, med: bu.length ? median(bu.map((x) => x.m0)) : NaN, min: bu.length ? Math.min(...bu.map((x) => x.m0)) : NaN, car: xs.filter((x) => x.src === 'carried').length, rec: xs.filter((x) => x.src === 'received').length, pk: xs.filter((x) => x.src === 'pickup').length }; }).sort((a, c) => c.b - a.b);
  const money$ = (v) => (Number.isFinite(v) ? '$' + Math.round(v).toLocaleString() : '–');
  const ptable = `<table><thead><tr><th>Player</th><th class="num">Could afford</th><th class="num">Bought</th><th class="num">Buy rate</th><th class="num">Median money at buy</th><th class="num">Lowest</th><th class="num">Carried over</th><th class="num">Given to them</th><th class="num">Picked up</th></tr></thead><tbody>${prow.map((p) => `<tr class="click" data-player="${p.pi}"><td>${esc(T.players[p.pi].name)}</td><td class="num">${p.a}</td><td class="num">${p.b}</td><td class="num">${pct(p.b, p.a)}</td><td class="num">${money$(p.med)}</td><td class="num">${money$(p.min)}</td><td class="num">${p.car}</td><td class="num">${p.rec}</td><td class="num">${p.pk}</td></tr>`).join('')}</tbody></table>`;

  return `<div class="grid tiles">${tiles}</div>
  <div class="grid g2">
    <div class="card"><h2>Buy rate by money in hand</h2><p class="sub">Player-rounds that started with enough for an Operator ($${cost.toLocaleString()}) and none carried over. ${mark != null ? 'The tick is the league average.' : ''}</p>${barList(money, { mark })}</div>
    <div class="card"><h2>Buy rate by situation</h2><p class="sub">Same rounds, split by what was going on. Counts on the right are buys out of chances.</p>${barList(sit, { mark })}</div>
    <div class="card"><h2>Had the money, did not buy</h2><p class="sub">Main weapon taken instead in ${notBuy} affordable rounds without an Operator purchase.</p>${instead.length ? barList(instead, { color: C.neutral }) : '<p class="muted">–</p>'}</div>
    <div class="card"><h2>How they got it</h2><p class="sub">Every round someone on the team had an Operator. “Given by a teammate” means they left the buy phase with one having spent under $${cost.toLocaleString()} themselves: a teammate bought it for them or handed over a saved one.</p>${barList(mix, { color: C.neutral })}
      <h3 style="margin-top:14px">Operators on the team per round</h3>${barList(['None', 'One', 'Two or more'].map((l, i) => ({ label: l, n: per[i], d: rounds.length })), { color: C.neutral })}</div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Buying by player</h2><p class="sub">Click a player to filter.</p><div class="scroll">${ptable}</div></div>`;
}

// ---------------------------------------------------------------- rounds
function viewRounds() {
  const { ops } = ctx();
  if (!ops.length) return empty('No Operator rounds match these filters.');
  const list = [...ops].sort((a, b) => b.game.date.localeCompare(a.game.date) || b.g - a.g || a.r - b.r);
  if (!S.sel || !list.includes(S.sel)) S.sel = list.find((o) => o.kills.length) || list[0];
  const shown = list.slice(0, 400);
  const rowsHtml = shown.map((o) => `<tr class="click ${o === S.sel ? 'sel' : ''}" data-op="${o.i}"><td>${o.game.date}</td><td><span class="who">${teamLogo(o.game.oppId, o.game.opp)}${esc(o.game.opp)}</span></td><td>${cap(o.game.map)}</td><td class="num">${o.r}</td><td>${SIDE[o.round.side] || ''}</td><td>${esc(S.T.players[o.p].name)}</td><td>${agentTag(o.row.agent)}</td><td>${SRC[o.src]}</td><td class="num">$${o.row.m0.toLocaleString()}</td><td class="num">${o.kills.filter((k) => k[1] === 'operator').length}</td><td class="num">${o.kills.length}</td><td>${o.death ? 'Died ' + secs(o.death[0]) : 'Survived'}</td><td>${o.round.won ? 'Won' : 'Lost'}</td></tr>`).join('');
  const o = S.sel;
  const ev = [];
  if (o.pts.length) ev.push([0, `Barriers drop · set up at <b>${esc(zone(o, o.pts[0].x, o.pts[0].y)) || 'unknown'}</b>`]);
  o.abil.forEach((a) => ev.push([a[0], `${abilityIcon(a[1])}Uses ${esc(abilityName(a[1]))} <span class="muted">${esc(zone(o, a[2], a[3]))}</span>`]));
  const killT = new Set(o.kills.map((k) => k[0]));
  o.hits.filter((h) => !h[7] && !killT.has(h[0])).forEach((h) => ev.push([h[0], `Op hit on ${esc(h[8])} for ${h[5]} (${esc(h[6])})`]));
  o.kills.forEach((k, i) => ev.push([k[0], `<b>Kill ${i + 1}</b> on ${agentIcon(k[8])}${esc(k[6])} with ${weaponIcon(k[1])}${esc(k[1]) || '?'} from <b>${esc(zone(o, k[2], k[3])) || '?'}</b>${k[7] ? ' <span class="chip">opening kill</span>' : ''}`]));
  if (o.round.plant != null) ev.push([o.round.plant, 'Spike planted']);
  if (o.death) ev.push([o.death[0], `<b>Dies</b> to ${agentIcon(o.death[8])}${esc(o.death[5])} (${esc(o.death[6]) || '?'}) at ${esc(zone(o, o.death[1], o.death[2])) || '?'}${o.death[7] ? ' <span class="chip">first death</span>' : ''}`]);
  ev.push([o.round.dur, `Round ${o.round.won ? 'won' : 'lost'} <span class="muted">${esc(o.round.wt)}</span>`]);
  ev.sort((a, b) => a[0] - b[0]);
  return `<div class="grid map-layout">
    <div class="card">
      <h2>${who(o)} · ${SRC[o.src]}</h2><p class="sub">${teamLogo(o.game.oppId, o.game.opp)} ${where(o)} · score ${o.round.scoreOwn}–${o.round.scoreOpp} · started the round with $${o.row.m0.toLocaleString()}</p>
      <div class="mapwrap"><canvas id="repc"></canvas></div>
      ${legend([['Path (dark = early, bright = late)', C.def], ['Kill, numbered in order', C.kill, 'dot'], ['Death', C.atk, 'x'], ['Setup', null, 'sq'], ['Ability used', '#c3c2b7', 'dot']])}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h2>Round timeline</h2><p class="sub">Seconds since barriers dropped.</p><div class="timeline">${ev.map(([t, h]) => `<span class="t">${secs(t)}</span><span>${h}</span>`).join('')}</div></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Operator rounds</h2><p class="sub">${list.length} rounds${list.length > shown.length ? `, newest ${shown.length} shown` : ''}. Click one to replay it.</p>
    <div class="scroll"><table><thead><tr><th>Date</th><th>Opponent</th><th>Map</th><th class="num">Rd</th><th>Side</th><th>Player</th><th>Agent</th><th>Operator</th><th class="num">Money</th><th class="num">Op kills</th><th class="num">Kills</th><th>Fate</th><th>Round</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`;
}
function drawReplay() {
  const o = S.sel, cv = $('#repc');
  if (!o || !cv) return;
  const mv = new MapView(cv, S.maps[o.game.map], [o]);
  mv.ready.then(() => {
    mv.base();
    mv.timedPath(o.pts);
    if (o.pts.length) mv.square(o.pts[0].x, o.pts[0].y, '<b>Setup</b> when barriers drop');
    o.abil.forEach((a) => mv.small(a[2], a[3], '#c3c2b7', `${abilityIcon(a[1])}<b>${esc(abilityName(a[1]))}</b> at ${secs(a[0])}`));
    o.kills.forEach((k, i) => { mv.line(k[2], k[3], k[4], k[5], C.kill); mv.dot(k[2], k[3], C.kill, `<b>Kill ${i + 1}</b> on ${esc(k[6])} with ${esc(k[1]) || '?'} at ${secs(k[0])}`, null, String(i + 1)); });
    if (o.death) { mv.line(o.death[3], o.death[4], o.death[1], o.death[2], C.atk); mv.cross(o.death[1], o.death[2], C.atk, `<b>Died</b> to ${esc(o.death[5])} at ${secs(o.death[0])}`); }
    mv.flush();
  });
}
function openRound(o) { S.sel = o; setTab('rounds'); }

// ---------------------------------------------------------------- shell
const VIEWS = { overview: viewOverview, map: viewMap, timing: viewTiming, rotations: viewRotations, economy: viewEconomy, rounds: viewRounds };
const league = () => S.mode === 'league';
const home = () => S.mode === 'home';
const homeState = () => ({ comp: S.hf.comp, ...S.hv });

function urlFor() {
  const q = new URLSearchParams();
  if (home()) { if (S.hf.comp !== 'all') q.set('comp', S.hf.comp); }
  else if (league()) { q.set('view', 'league'); Object.entries(S.lf).forEach(([k, v]) => { if (v !== 'all') q.set(k, v); }); }
  else {
    q.set('team', S.T.team.id);
    if (S.tab !== 'overview') q.set('tab', S.tab);
    Object.entries(S.f).forEach(([k, v]) => { if (v !== 'all') q.set(k, v); });
  }
  const s = q.toString();
  return location.pathname + (s ? '?' + s : '');
}

function render() {
  if (S.mode === 'team' ? !S.T : !S.L) return;
  // The filter bar is rebuilt each time; put keyboard focus back where it was.
  const act = document.activeElement;
  const focusKey = act && act.closest && act.closest('#filters') && act.dataset.f ? [act.dataset.f, act.dataset.v] : null;
  document.body.dataset.mode = S.mode;
  $('#tabs').hidden = S.mode !== 'team';
  $('#filters').hidden = home();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === S.mode));
  document.title = S.mode === 'team' ? `${S.T.team.name} · Operator Tracker` : league() ? 'League stats · Operator Tracker' : 'Operator Tracker';
  S.shownMap = null;
  const viewHtml = home() ? homeGrid(S.L, homeState()) : league() ? viewLeague(S.L, { f: S.lf, ...S.lv }) : teamView();   // before the header: it reads shownMap
  $('#hero').innerHTML = home() ? homeHero(S.L, homeState()) + assetHint() : league() ? leagueHero() : teamHero();
  $('#filters').innerHTML = home() ? '' : league() ? leagueFilters(S.L, S.lf) : teamFilters();
  $('#view').innerHTML = viewHtml;
  if (focusKey) { const el = [...document.querySelectorAll('#filters [data-f]')].find((x) => x.dataset.f === focusKey[0] && x.dataset.v === focusKey[1]); if (el) el.focus(); }
  if (S.mode === 'team') {
    if (S.tab === 'map') drawMapTab();
    if (S.tab === 'rotations') drawRotations();
    if (S.tab === 'rounds') drawReplay();
  }
  const u = urlFor();
  if (u !== location.pathname + location.search) history[S.push ? 'pushState' : 'replaceState'](null, '', u);
  S.push = false;
}
function setTab(t) {
  if (t !== S.tab) S.push = true;       // tabs and players are steps Back should undo; other filters are not
  S.tab = t;
  render();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- navigation
/** The team picker. */
function goHome() {
  if (!S.L) return;
  S.mode = 'home'; S.push = true; S.hv.q = '';
  render();
  window.scrollTo({ top: 0 });
  const q = $('#homeQ');
  if (q) q.focus({ preventScroll: true });
}
function goLeague(filters) {
  if (!S.L) return;
  S.mode = 'league'; S.push = true;
  if (filters) Object.assign(S.lf, { comp: 'all', map: 'all', side: 'all', agent: 'all' }, filters);
  S.lv.allP = S.lv.allT = S.lv.allA = false;
  cleanLeagueFilters(S.L, S.lf);
  render();
  window.scrollTo({ top: 0 });
}
/** Open a team. pid = GRID player id to filter to; carry = bring the current page's filters along. */
async function goTeam(id, { pid, carry = false } = {}) {
  const from = S.mode, lf = { ...S.lf }, comp = S.hf.comp;
  if (!(await loadTeam(id))) return;
  S.mode = 'team'; S.tab = 'overview'; S.push = true;
  if (carry && from === 'league') {
    S.f.map = lf.map; S.f.side = lf.side; S.f.agent = lf.agent;
    if (lf.comp.startsWith('e:')) S.f.event = lf.comp.slice(2);
  } else if (carry && from === 'home') {
    // "Cloud9 in that competition": only worth a filter if they also played elsewhere
    if (comp.startsWith('e:')) S.f.event = comp.slice(2);
    else if (comp.startsWith('c:') && S.T.games.some((g) => circuitOf(g.event) !== comp.slice(2))) S.f.event = comp;
  }
  if (pid) { const i = S.T.players.findIndex((p) => p.id === pid); if (i >= 0) S.f.player = String(i); }
  cleanTeamFilters();
  render();
  window.scrollTo({ top: 0 });
}
/** Set the page from the address bar (first load, back/forward). */
async function route() {
  const q = new URLSearchParams(location.search);
  let team = q.get('team');
  if (!S.index.teams.some((t) => t.id === team)) team = null;
  if (!team && !S.L) team = (S.index.teams.find((t) => t.name === 'Cloud9') || S.index.teams[0]).id;
  if (team) {
    if (!S.T || S.T.team.id !== team) { if (!(await loadTeam(team))) return; }
    S.mode = 'team';
    Object.keys(S.f).forEach((k) => (S.f[k] = q.get(k) || 'all'));
    cleanTeamFilters();
    S.tab = VIEWS[q.get('tab')] ? q.get('tab') : 'overview';
  } else if (q.get('view') === 'league') {
    S.mode = 'league';
    Object.keys(S.lf).forEach((k) => (S.lf[k] = q.get(k) || 'all'));
    cleanLeagueFilters(S.L, S.lf);
  } else {
    S.mode = 'home';
    const f = { comp: q.get('comp') || 'all', map: 'all', side: 'all', agent: 'all' };
    cleanLeagueFilters(S.L, f);
    S.hf.comp = f.comp;
  }
  render();
}

function setFilter(key, v, toggle = false) {
  const f = league() ? S.lf : S.f;
  if (!(key in f)) return;
  const next = toggle && String(f[key]) === String(v) ? 'all' : v;
  if (key === 'player' && String(next) !== String(f[key])) S.push = true;
  f[key] = next;
  if (league()) S.lv.allP = S.lv.allT = false;
  // an agent the newly chosen player never held the Operator on would leave every tab empty
  else if (key === 'player' && f.agent !== 'all' && f.player !== 'all' && !S.T.ops.some((o) => o.p === +f.player && o.row.agent === f.agent)) f.agent = 'all';
  render();
}

// ---------------------------------------------------------------- search
function searchResults(query) {
  const n = query.toLowerCase();
  const rank = (name) => { const s = name.toLowerCase(); return s === n ? 0 : s.startsWith(n) ? 1 : s.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(n)) ? 2 : s.includes(n) ? 3 : -1; };
  const best = (list, name, weight, max) => list.map((x) => [rank(name(x)), x]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0] || weight(b[1]) - weight(a[1])).slice(0, max).map(([, x]) => x);
  const L = S.L, people = L ? L.people : [];
  const teamOpr = (t) => (L ? L.teamOpr.get(t.id) || 0 : t.opRounds);
  let teams, players, agents = [], maps = [];
  if (!n) {
    const byOp = [...S.index.teams].sort((a, b) => teamOpr(b) - teamOpr(a));
    const c9 = S.index.teams.find((t) => t.name === 'Cloud9');
    teams = [...new Set([c9, ...byOp].filter(Boolean))].slice(0, 5);
    players = people.slice(0, 6);
  } else {
    teams = best(S.index.teams, (t) => t.name, teamOpr, 6);
    players = best(people, (p) => p.name, (p) => p.opr, 8);
    if (L) {
      agents = best(L.agents.filter(Boolean), (a) => agentName(a), () => 0, 3);
      maps = best(L.maps, (m) => m, () => 0, 3);
    }
  }
  const stat = (v, label) => `<span class="pi-stat">${opIcon()}<b>${v.toLocaleString()}</b><small>${label}</small></span>`;
  return [
    ...teams.map((t) => ({ group: n ? 'Teams' : 'Jump to a team', pick: () => goTeam(t.id),
      html: `${teamLogo(t.id, t.name, 'md')}<span class="pi-main"><b>${esc(t.name)}</b><small>${esc(t.events.join(', '))} · ${t.games} maps</small></span>${stat(teamOpr(t), 'Op rounds')}` })),
    ...players.map((p) => ({ group: n ? 'Players' : 'Players with the most Operator rounds', pick: () => goTeam(p.team.id, { pid: p.pid }),
      html: `${teamLogo(p.team.id, p.team.name, 'md')}<span class="pi-main"><b>${esc(p.name)}</b><small>${esc(p.team.name)}</small></span><span class="tags">${p.agents.slice(0, 3).map((a) => agentIcon(a)).join('')}</span>${stat(p.opr, 'Op rounds')}` })),
    ...agents.map((a) => ({ group: 'Agents', pick: () => goLeague({ agent: a }),
      html: `${agentIcon(a, 'md')}<span class="pi-main"><b>${esc(agentName(a))}</b><small>Everyone who plays the Operator on ${esc(agentName(a))}</small></span>` })),
    ...maps.map((m) => ({ group: 'Maps', pick: () => goLeague({ map: m }),
      html: `${S.maps[m] ? `<img class="ico mapthumb" src="${DATA}${esc(S.maps[m].img)}" alt="">` : ''}<span class="pi-main"><b>${cap(m)}</b><small>Who takes the Operator on ${cap(m)}</small></span>` })),
  ];
}

function wire() {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('#home').addEventListener('click', (e) => { if (!S.L || e.metaKey || e.ctrlKey) return; e.preventDefault(); goHome(); });
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.nav === 'home') goHome(); else goLeague(); });

  const filters = $('#filters');
  filters.addEventListener('change', (e) => { if (e.target.dataset.f) setFilter(e.target.dataset.f, e.target.value); });
  filters.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.f) setFilter(b.dataset.f, b.dataset.v);
    else if ('reset' in b.dataset) { const f = league() ? S.lf : S.f; Object.keys(f).forEach((k) => (f[k] = 'all')); render(); }
  });

  $('#hero').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.go === 'home') goHome();
    else if (b.dataset.comp) { S.hf.comp = b.dataset.comp; render(); const again = [...document.querySelectorAll('#hero [data-comp]')].find((x) => x.dataset.comp === S.hf.comp); if (again) again.focus(); }
    else if (b.dataset.go === 'team') setFilter('player', 'all');
    else if (b.dataset.player != null) setFilter('player', b.dataset.player);
    else if (b.dataset.map) setFilter('map', b.dataset.map);
    else if (b.dataset.clear) setFilter(b.dataset.clear, 'all');
  });

  // picker search: typing only redraws the grid, so the box keeps focus
  $('#hero').addEventListener('input', (e) => { if (e.target.id !== 'homeQ') return; S.hv.q = e.target.value; $('#view').innerHTML = homeGrid(S.L, homeState()); });
  $('#hero').addEventListener('keydown', (e) => { if (e.target.id === 'homeQ' && e.key === 'Enter') { const first = $('#view .team-card'); if (first) first.click(); } });

  const view = $('#view');
  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-team],[data-player],[data-map],[data-agent],[data-op],[data-sortp],[data-sortt],[data-more],[data-spot],[data-jump],[data-hsort]');
    if (!el || e.target.closest('select,input,label')) return;
    const d = el.dataset;
    if (d.team) goTeam(d.team, { pid: d.pid, carry: true });
    else if (d.hsort) { S.hv.sort = d.hsort; render(); }
    else if (d.spot) { S.f.map = d.spot; S.layers[d.layer] = true; S.push = true; setTab('map'); }
    else if (d.jump) { S.push = true; setTab(d.jump); }
    else if (d.sortp) { S.lv.sortP = d.sortp; S.lv.allP = false; render(); }
    else if (d.sortt) { S.lv.sortT = d.sortt; render(); }
    else if (d.more) { S.lv[d.more] = true; render(); }
    else if (d.player != null) setFilter('player', d.player);
    else if (d.map) setFilter('map', d.map, true);
    else if (d.agent) setFilter('agent', d.agent, true);
    else if (d.op != null) { S.sel = S.T.ops.find((o) => o.i === +d.op); render(); }
  });
  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.layer) { S.layers[t.dataset.layer] = t.checked; drawMapTab(); }
  });
  view.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id !== 'w0' && t.id !== 'w1') return;
    let a = +$('#w0').value, b = +$('#w1').value;
    if (a >= b) { if (t.id === 'w0') a = b - 5; else b = a + 5; $('#w0').value = a; $('#w1').value = b; }
    S.win = [a, b];
    $('#w0v').textContent = a + 's'; $('#w1v').textContent = b >= 120 ? 'end' : b + 's';
    drawMapTab();
  });

  // one tooltip for every [data-tip] mark; canvases call showTip directly
  const tip = $('#tip');
  window.showTip = (html, x, y) => {
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px';
    tip.style.top = Math.min(window.innerHeight - r.height - 8, y + 14) + 'px';
  };
  document.addEventListener('mousemove', (e) => {
    if (e.target.tagName === 'CANVAS') return;
    const m = e.target.closest && e.target.closest('[data-tip]');
    window.showTip(m ? m.dataset.tip : null, e.clientX, e.clientY);
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
  window.addEventListener('popstate', () => { if (S.index) route(); });
}

async function main() {
  wire();
  try {
    S.index = await getJSON('index.json');
  } catch (err) {
    $('#view').innerHTML = empty('No data yet. Run <code>python3 etl/build.py</code> from the project folder, then reload.');
    return;
  }
  const [maps, assets, L] = await Promise.all([getJSON('maps.json', true), getJSON('assets.json', true), getJSON('league.json', true)]);
  S.maps = maps || {};
  S.hasAssets = Boolean(assets);
  setAssets(assets);
  if (L) { prepLeague(L, S.index); S.L = L; }
  $('#brandIcon').innerHTML = opIcon('lg');
  $('#corpus').textContent = `${S.index.games.toLocaleString()} maps · ${S.index.rounds.toLocaleString()} rounds · ${S.index.opRounds.toLocaleString()} Operator rounds · built ${S.index.generated}`;
  initSearch($('#q'), $('#qPop'), searchResults);
  await route();
  if (home() && $('#homeQ')) $('#homeQ').focus({ preventScroll: true });
}
main();
