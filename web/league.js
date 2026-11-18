// League view: who is using the Operator, and on what, across every team.
// Reads data/league.json, a dictionary-encoded roll-up written by etl/build.py.
import { tile, barList } from './charts.js';
import { teamLogo, agentIcon, agentName, agentRole, opIcon } from './icons.js';

// rows:  [player, team, agent, map, side(0 atk / 1 def), event, player-rounds, Op rounds,
//         Op kills, could afford, bought, died holding it, opening Op kills]
// trows: [team, map, side, event, rounds, rounds with an Op, won with, won without]
const P = 0, T = 1, A = 2, M = 3, SD = 4, E = 5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const pct = (n, d, dp = 0) => (d ? (100 * n / d).toFixed(dp) + '%' : '–');
const num = (v, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '–');
const int = (n) => n.toLocaleString();
export const circuitOf = (event) => event.split(' - ')[0];

export function prepLeague(L, index) {
  const byId = new Map(index.teams.map((t) => [t.id, t]));
  L.teamInfo = L.teams.map((id) => byId.get(id) || { id, name: id, events: [] });
  L.circuits = [...new Set(L.events.map(circuitOf))].sort();
  // One search entry per player per team they appeared for.
  const m = new Map();
  for (const r of L.rows) {
    const k = r[P] * 1000 + r[T];
    let e = m.get(k);
    if (!e) m.set(k, e = { pid: L.players[r[P]].id, name: L.players[r[P]].name, team: L.teamInfo[r[T]], pr: 0, opr: 0, ok: 0, ag: new Map() });
    e.pr += r[6]; e.opr += r[7]; e.ok += r[8];
    const a = e.ag.get(r[A]) || [0, 0];
    a[0] += r[7]; a[1] += r[6];
    e.ag.set(r[A], a);
  }
  // Operator rounds per team, same definition as everywhere else (held when the buy phase ends).
  L.teamOpr = new Map();
  for (const e of m.values()) L.teamOpr.set(e.team.id, (L.teamOpr.get(e.team.id) || 0) + e.opr);
  L.people = [...m.values()].map((e) => ({
    ...e, agents: [...e.ag].sort((x, y) => y[1][0] - x[1][0] || y[1][1] - x[1][1]).map(([a]) => L.agents[a]).filter(Boolean),
  })).sort((a, b) => b.opr - a.opr);
}

/** Drop filter values that do not exist in the data (stale deep links). */
export function cleanLeagueFilters(L, f) {
  if (f.map !== 'all' && !L.maps.includes(f.map)) f.map = 'all';
  if (f.agent !== 'all' && !L.agents.includes(f.agent)) f.agent = 'all';
  if (!['all', 'a', 'd'].includes(f.side)) f.side = 'all';
  if (f.comp !== 'all') {
    const [kind, name] = [f.comp.slice(0, 2), f.comp.slice(2)];
    if (!(kind === 'c:' && L.circuits.includes(name)) && !(kind === 'e:' && L.events.includes(name))) f.comp = 'all';
  }
}

function aggregate(L, f) {
  const evOK = f.comp === 'all' ? null : new Set(L.events.map((e, i) => [e, i]).filter(([e]) => (f.comp.startsWith('c:') ? circuitOf(e) === f.comp.slice(2) : e === f.comp.slice(2))).map(([, i]) => i));
  const side = f.side === 'all' ? -1 : (f.side === 'd' ? 1 : 0);
  const mi = f.map === 'all' ? -1 : L.maps.indexOf(f.map);
  const ai = f.agent === 'all' ? -1 : L.agents.indexOf(f.agent);
  const blank = () => ({ pr: 0, opr: 0, ok: 0, aff: 0, buy: 0, d: 0, fk: 0 });
  const add = (o, r) => { o.pr += r[6]; o.opr += r[7]; o.ok += r[8]; o.aff += r[9]; o.buy += r[10]; o.d += r[11]; o.fk += r[12]; };
  const tot = blank(), players = new Map(), teams = new Map(), agents = new Map(), maps = new Map();
  const bucket = (m, k, extra) => { let o = m.get(k); if (!o) m.set(k, o = { ...blank(), ...extra() }); return o; };
  for (const r of L.rows) {
    if ((evOK && !evOK.has(r[E])) || (side >= 0 && r[SD] !== side)) continue;
    const mOK = mi < 0 || r[M] === mi, aOK = ai < 0 || r[A] === ai;
    // Facets ignore their own filter, so the other options stay comparable.
    if (mOK) { const o = bucket(agents, r[A], () => ({ a: r[A], who: new Set() })); add(o, r); if (r[7]) o.who.add(r[P]); }
    if (aOK) add(bucket(maps, r[M], () => ({ m: r[M], tr: 0, trOp: 0 })), r);
    if (!mOK || !aOK) continue;
    add(tot, r);
    const p = bucket(players, r[P] * 1000 + r[T], () => ({ p: r[P], t: r[T], ag: new Map() }));
    add(p, r);
    if (r[7]) p.ag.set(r[A], (p.ag.get(r[A]) || 0) + r[7]);
    add(bucket(teams, r[T], () => ({ t: r[T], tr: 0, trOp: 0, winOp: 0, winNo: 0 })), r);
  }
  const tt = { tr: 0, trOp: 0, winOp: 0, winNo: 0 };
  for (const r of L.trows) {
    if ((evOK && !evOK.has(r[3])) || (side >= 0 && r[2] !== side)) continue;
    const mp = maps.get(r[1]);
    if (mp) { mp.tr += r[4]; mp.trOp += r[5]; }
    if (mi >= 0 && r[1] !== mi) continue;
    tt.tr += r[4]; tt.trOp += r[5]; tt.winOp += r[6]; tt.winNo += r[7];
    const t = teams.get(r[0]);
    if (t) { t.tr += r[4]; t.trOp += r[5]; t.winOp += r[6]; t.winNo += r[7]; }
  }
  return { tot, tt, players: [...players.values()], teams: [...teams.values()], agents: [...agents.values()], maps: [...maps.values()], agentOn: ai >= 0 };
}

const PLAYER_SORTS = {
  opr: { label: 'Op rounds', val: (p) => p.opr, ok: () => true },
  rate: { label: 'Op %', val: (p) => p.opr / p.pr, ok: (p) => p.pr >= 60, note: 'players with 60+ rounds' },
  buy: { label: 'Buys when affordable', val: (p) => p.buy / p.aff, ok: (p) => p.aff >= 20, note: 'players with 20+ affordable rounds' },
  ok: { label: 'Op kills', val: (p) => p.ok, ok: () => true },
  kpr: { label: 'Kills / Op round', val: (p) => p.ok / p.opr, ok: (p) => p.opr >= 10, note: 'players with 10+ Op rounds' },
  fk: { label: 'Opening kill', val: (p) => p.fk / p.opr, ok: (p) => p.opr >= 10, note: 'players with 10+ Op rounds' },
};

export function describeLeague(L, f) {
  const parts = [];
  if (f.comp !== 'all') parts.push(['comp', f.comp.slice(2)]);
  if (f.map !== 'all') parts.push(['map', cap(f.map)]);
  if (f.side !== 'all') parts.push(['side', f.side === 'a' ? 'Attack' : 'Defense']);
  if (f.agent !== 'all') parts.push(['agent', `${agentIcon(f.agent)}${esc(agentName(f.agent))}`, true]);
  return parts;
}

export function leagueFilters(L, f) {
  const sel = (v, cur) => (v === cur ? ' selected' : '');
  const comps = L.circuits.map((c) => `<optgroup label="${esc(c)}"><option value="c:${esc(c)}"${sel('c:' + c, f.comp)}>${esc(c)} · everything</option>${L.events.filter((e) => circuitOf(e) === c).map((e) => `<option value="e:${esc(e)}"${sel('e:' + e, f.comp)}>${esc(e.slice(c.length + 3) || e)}</option>`).join('')}</optgroup>`).join('');
  const side = [['all', 'Both'], ['a', 'Attack'], ['d', 'Defense']].map(([v, l]) => `<button data-f="side" data-v="${v}" class="${f.side === v ? 'on' : ''}">${l}</button>`).join('');
  return `<label class="field"><span>Competition</span><select data-f="comp"><option value="all">All competitions</option>${comps}</select></label>
    <label class="field"><span>Map</span><select data-f="map"><option value="all">All maps</option>${L.maps.map((m) => `<option value="${esc(m)}"${sel(m, f.map)}>${cap(m)}</option>`).join('')}</select></label>
    <div class="field"><span>Side</span><div class="seg" role="group" aria-label="Side">${side}</div></div>
    <label class="field"><span>Agent</span><select data-f="agent"><option value="all">All agents</option>${L.agents.filter(Boolean).map((a) => `<option value="${esc(a)}"${sel(a, f.agent)}>${esc(agentName(a))}</option>`).join('')}</select></label>
    <button data-reset class="ghost">Reset</button>`;
}

export function viewLeague(L, st) {
  const f = st.f;
  const g = aggregate(L, f);
  const { tot, tt } = g;
  if (!tot.pr) return '<div class="card empty">No rounds match these filters.</div>';
  const agLabel = f.agent === 'all' ? '' : agentName(f.agent);
  const users = g.players.filter((p) => p.opr > 0);
  const uniq = (list) => new Set(list.map((p) => p.p)).size;   // a player can appear for two teams

  const tiles = (g.agentOn ? [
    tile(`Op rounds on ${esc(agLabel)}`, int(tot.opr), `${pct(tot.opr, tot.pr, 1)} of ${int(tot.pr)} ${esc(agLabel)} rounds`),
  ] : [
    tile('Rounds with an Operator', pct(tt.trOp, tt.tr), `${int(tt.trOp)} of ${int(tt.tr)} team rounds`),
    tile('Round win rate with an Op', pct(tt.winOp, tt.trOp), `${pct(tt.winNo, tt.tr - tt.trOp)} without one`),
  ]).concat([
    tile('Buys it when affordable', pct(tot.buy, tot.aff, 1), `${int(tot.buy)} of ${int(tot.aff)} player-rounds with $4,700+`),
    tile('Operator kills per Op round', num(tot.ok / tot.opr), `${int(tot.ok)} kills in ${int(tot.opr)} Op rounds`),
    tile('Opening kill with the Op', pct(tot.fk, tot.opr), `holder dies in ${pct(tot.d, tot.opr)} of Op rounds`),
    tile('Players who have used it', int(uniq(users)), `of ${int(uniq(g.players))} players · ${g.teams.filter((t) => t.opr).length} of ${g.teams.length} teams`),
  ]).join('');

  // ---- what it is played on: agents
  const agTotal = g.agents.reduce((s, a) => s + a.opr, 0);
  const ags = g.agents.filter((a) => a.opr > 0 && L.agents[a.a]).sort((a, b) => b.opr - a.opr);
  const agMax = Math.max(1, ...ags.map((a) => a.opr));
  const idle = g.agents.filter((a) => !a.opr && L.agents[a.a]).length;
  const shownA = st.allA ? ags : ags.filter((a, i) => i < 9 || L.agents[a.a] === f.agent);
  const agentCards = shownA.map((a) => {
    const key = L.agents[a.a];
    const tip = `<b>${esc(agentName(key))}</b><span class="muted">Has the Operator in ${pct(a.opr, a.pr, 1)} of ${int(a.pr)} ${esc(agentName(key))} rounds</span><span class="muted">${num(a.ok / a.opr)} Operator kills a round · opening kill in ${pct(a.fk, a.opr)} · dies in ${pct(a.d, a.opr)}</span>`;
    return `<button class="pick acard ${f.agent === key ? 'on' : ''}" data-agent="${esc(key)}" aria-pressed="${f.agent === key}" data-tip="${esc(tip)}">
      ${agentIcon(key, 'lg')}
      <span class="pk-main"><b>${esc(agentName(key))}</b><small>${esc(agentRole(key)) || '&nbsp;'}</small></span>
      <span class="pk-stat"><b>${pct(a.opr, agTotal)}</b><small>of Op rounds</small></span>
      <span class="meter"><i style="width:${(100 * a.opr / agMax).toFixed(1)}%"></i></span>
      <span class="pk-foot">${int(a.opr)} Op rounds · ${a.who.size} player${a.who.size === 1 ? '' : 's'}</span>
    </button>`;
  }).join('');
  const aMore = ags.length > shownA.length ? `<button class="ghost more" data-more="allA">Show all ${ags.length} agents</button>` : '';

  // ---- where it comes out: maps
  const mapItems = g.maps.map((m) => (g.agentOn
    ? { key: L.maps[m.m], n: m.opr, d: m.pr }
    : { key: L.maps[m.m], n: m.trOp, d: m.tr })).filter((m) => m.d).sort((a, b) => b.n / b.d - a.n / a.d)
    .map((m) => ({ label: cap(m.key), n: m.n, d: m.d, attr: `data-map="${esc(m.key)}"`, on: f.map === m.key }));

  // ---- who: players
  const sort = PLAYER_SORTS[st.sortP] ? st.sortP : 'opr';
  const S = PLAYER_SORTS[sort];
  const ranked = users.filter(S.ok).sort((a, b) => S.val(b) - S.val(a) || b.opr - a.opr);
  const shownP = st.allP ? ranked : ranked.slice(0, 25);
  const th = (k, extra = '') => `<th class="num sort ${sort === k ? 'on' : ''}" data-sortp="${k}" title="Sort by ${esc(PLAYER_SORTS[k].label)}"${extra}>${PLAYER_SORTS[k].label}${sort === k ? ' ▾' : ''}</th>`;
  const prow = shownP.map((p, i) => {
    const t = L.teamInfo[p.t], pl = L.players[p.p];
    const ag = [...p.ag].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, c]) => `<span class="tag">${agentIcon(L.agents[a])}<span class="low">${c}</span></span>`).join('');
    return `<tr class="click" data-team="${esc(t.id)}" data-pid="${esc(pl.id)}"><td class="num low">${i + 1}</td>
      <td><span class="who">${teamLogo(t.id, t.name)}<b>${esc(pl.name)}</b><span class="low">${esc(t.name)}</span></span></td>
      <td><span class="tags">${ag}</span></td>
      <td class="num">${int(p.pr)}</td><td class="num">${int(p.opr)}</td><td class="num">${pct(p.opr, p.pr)}</td>
      <td class="num">${pct(p.buy, p.aff)} <span class="low">${p.buy}/${p.aff}</span></td>
      <td class="num">${int(p.ok)}</td><td class="num">${num(p.ok / p.opr)}</td><td class="num">${pct(p.fk, p.opr)}</td><td class="num">${pct(p.d, p.opr)}</td></tr>`;
  }).join('');
  const ptable = `<table><thead><tr><th class="num">#</th><th>Player</th><th>On the Op as</th><th class="num">Rounds</th>${th('opr')}${th('rate')}${th('buy')}${th('ok')}${th('kpr')}${th('fk')}<th class="num">Dies with it</th></tr></thead><tbody>${prow}</tbody></table>`;
  const pMore = ranked.length > shownP.length ? `<button class="ghost more" data-more="allP">Show all ${int(ranked.length)} players</button>` : '';

  // ---- teams
  const tsort = st.sortT === 'share' && !g.agentOn ? 'share' : 'opr';
  const tlist = g.teams.filter((t) => t.pr && (tsort === 'opr' ? t.opr > 0 : t.tr >= 60))
    .sort((a, b) => (tsort === 'share' ? b.trOp / b.tr - a.trOp / a.tr : b.opr - a.opr));
  const tMax = Math.max(0.0001, ...tlist.map((t) => (g.agentOn ? t.opr : t.trOp / t.tr)));
  const shownT = st.allT ? tlist : tlist.slice(0, 24);
  const teamCards = shownT.map((t) => {
    const info = L.teamInfo[t.t];
    const stat = g.agentOn
      ? `<b>${int(t.opr)}</b><small>Op rounds</small>`
      : `<b>${pct(t.trOp, t.tr)}</b><small>of rounds</small>`;
    const w = g.agentOn ? t.opr / tMax : (t.trOp / t.tr) / tMax;
    const tip = `<b>${esc(info.name)}</b><span class="muted">${g.agentOn ? '' : `An Operator out in ${int(t.trOp)} of ${int(t.tr)} rounds · `}${t.opr ? `${num(t.ok / t.opr)} Operator kills a round` : 'no Operator rounds'}</span>${g.agentOn || !t.trOp ? '' : `<span class="muted">Wins ${pct(t.winOp, t.trOp)} of rounds with one, ${pct(t.winNo, t.tr - t.trOp)} without</span>`}`;
    return `<button class="pick tcard" data-team="${esc(info.id)}" data-tip="${esc(tip)}">
      ${teamLogo(info.id, info.name, 'md')}
      <span class="pk-main"><b>${esc(info.name)}</b><small>${esc(info.events.join(', '))}</small></span>
      <span class="pk-stat">${stat}</span>
      <span class="meter"><i style="width:${(100 * w).toFixed(1)}%"></i></span>
      <span class="pk-foot">${int(t.opr)} Op rounds · ${int(t.ok)} Op kills</span>
    </button>`;
  }).join('');
  const tMore = tlist.length > shownT.length ? `<button class="ghost more" data-more="allT">Show all ${tlist.length} teams</button>` : '';
  const seg = g.agentOn ? '' : `<div class="seg small"><button data-sortt="opr" class="${tsort === 'opr' ? 'on' : ''}">Most Op rounds</button><button data-sortt="share" class="${tsort === 'share' ? 'on' : ''}">Highest share of rounds</button></div>`;

  const scopeBits = [f.comp !== 'all' ? f.comp.slice(2) : '', f.map !== 'all' ? cap(f.map) : '', f.side !== 'all' ? (f.side === 'a' ? 'attack' : 'defense') : ''].filter(Boolean).join(' · ');
  return `<div class="grid tiles">${tiles}</div>
  <div class="grid g-wide">
    <div class="card"><h2>What it is played on</h2><p class="sub">Agents holding the Operator when the buy phase ends${scopeBits ? `, ${esc(scopeBits)}` : ''}. Click an agent to see who plays it that way.</p>
      <div class="picks agents">${agentCards || '<p class="muted">No Operator rounds in this selection.</p>'}</div>
      ${aMore}${idle && !aMore ? `<p class="note">${idle} more agent${idle === 1 ? ' has' : 's have'} been played here without ever taking one.</p>` : ''}</div>
    <div class="card"><h2>Where it comes out</h2><p class="sub">${g.agentOn ? `Share of ${esc(agLabel)} rounds played with the Operator, by map.` : 'Share of team rounds with at least one Operator, by map.'} Click a map to filter.</p>${mapItems.length ? barList(mapItems) : '<p class="muted">–</p>'}</div>
  </div>
  <div class="card" style="margin-top:14px"><h2>${opIcon()} Who is using it</h2><p class="sub">${int(uniq(users))} players with at least one Operator round${g.agentOn ? ` on ${esc(agLabel)}` : ''}. Sorted by ${esc(S.label.replace(/^(?!Op)./, (c) => c.toLowerCase()))}${S.note ? ` (${S.note})` : ''}; click a column to re-sort, a player to open their team filtered to them.</p>
    <div class="scroll tall">${prow ? ptable : '<p class="muted">Nobody in this selection meets the minimum sample for that column.</p>'}</div>${pMore}</div>
  <div class="card" style="margin-top:14px"><div class="card-head"><div><h2>Teams</h2><p class="sub">${g.agentOn ? `Operator rounds on ${esc(agLabel)}.` : 'How often each team has an Operator out.'} Click a team to scout it.</p></div>${seg}</div>
    <div class="picks teams">${teamCards || '<p class="muted">No teams in this selection.</p>'}</div>${tMore}</div>`;
}
