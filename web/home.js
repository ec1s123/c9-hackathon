// Team picker: the first screen. Choose a competition, then who you are playing.
import { teamLogo, agentIcon, opIcon } from './icons.js';
import { pickerTeams, circuitOf } from './league.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, d) => (d ? Math.round(100 * n / d) + '%' : '–');
const int = (n) => n.toLocaleString();
const SEARCH = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** Title, the big search box and the competition chips. st = { comp, q, sort } */
export function homeHero(L, st) {
  const circuit = st.comp === 'all' ? '' : (st.comp.startsWith('c:') ? st.comp.slice(2) : circuitOf(st.comp.slice(2)));
  const count = new Map();
  pickerTeams(L, 'all').forEach((t) => t.circ.forEach((_, c) => count.set(c, (count.get(c) || 0) + 1)));
  const chip = (v, label, n, on, cls = '') => `<button class="cchip ${cls} ${on ? 'on' : ''}" data-comp="${esc(v)}" aria-pressed="${on}">${esc(label)}${n != null ? `<small>${n}</small>` : ''}</button>`;
  const circuits = chip('all', 'All competitions', L.teams.length, st.comp === 'all') + L.circuits.map((c) => chip('c:' + c, c, count.get(c) || 0, circuit === c)).join('');
  const events = circuit ? L.events.filter((e) => circuitOf(e) === circuit) : [];
  const stages = events.length > 1
    ? `<div class="comp-row"><span class="lbl">Event</span>${chip('c:' + circuit, 'All of ' + circuit, null, st.comp.startsWith('c:'), 'sm')}${events.map((e) => chip('e:' + e, e.slice(circuit.length + 3) || e, null, st.comp === 'e:' + e, 'sm')).join('')}</div>`
    : '';
  return `<div class="home-head">
      <h2>Who are you playing?</h2>
      <p class="muted">Pick a team to see who takes the Operator, where they play it from, where the kills come from and when they buy it.</p>
      <div class="search big">${SEARCH}<input id="homeQ" type="search" placeholder="Type a team or a player" autocomplete="off" spellcheck="false" aria-label="Find a team or player" value="${esc(st.q)}"></div>
    </div>
    <div class="comp-row"><span class="lbl">Competition</span>${circuits}</div>${stages}`;
}

function teamCard(t, max) {
  const share = t.tr ? t.trOp / t.tr : 0;
  const who = t.top
    ? `${agentIcon(t.top.agent)}<span><b>${esc(t.top.name)}</b> takes it most · ${int(t.top.opr)} of ${int(t.opr)} Op rounds</span>`
    : '<span class="low">No Operator rounds here</span>';
  return `<button class="team-card" data-team="${esc(t.info.id)}">
    ${teamLogo(t.info.id, t.info.name, 'xl')}
    <span class="tc-name"><b>${esc(t.info.name)}</b><small>${esc([...t.circ.keys()].join(', '))} · ${t.games} map${t.games === 1 ? '' : 's'}</small></span>
    <span class="tc-op">${opIcon()}<span><b>${pct(t.trOp, t.tr)}</b> of rounds with an Operator out</span></span>
    <span class="meter"><i style="width:${(100 * share / max).toFixed(1)}%"></i></span>
    <span class="tc-who">${who}</span>
  </button>`;
}

/** The grid of teams (and matching players while typing). */
export function homeGrid(L, st) {
  const q = st.q.trim().toLowerCase();
  const rank = (name) => { const s = name.toLowerCase(); return s === q ? 0 : s.startsWith(q) ? 1 : s.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q)) ? 2 : s.includes(q) ? 3 : -1; };
  let teams = pickerTeams(L, st.comp);
  const inComp = new Set(teams.map((t) => t.info.id));
  const max = Math.max(0.0001, ...teams.map((t) => (t.tr ? t.trOp / t.tr : 0)));
  const order = st.sort === 'op'
    ? (a, b) => b.trOp / b.tr - a.trOp / a.tr
    : (a, b) => a.info.name.localeCompare(b.info.name, 'en', { sensitivity: 'base' });
  const sortSeg = `<div class="seg small"><button data-hsort="az" class="${st.sort !== 'op' ? 'on' : ''}">A to Z</button><button data-hsort="op" class="${st.sort === 'op' ? 'on' : ''}">Most Operator use</button></div>`;
  const where = st.comp === 'all' ? '' : st.comp.slice(2);
  const grid = (list) => `<div class="team-grid">${list.map((t) => teamCard(t, max)).join('')}</div>`;

  if (q) {
    teams = teams.map((t) => [rank(t.info.name), t]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0] || order(a[1], b[1])).map(([, t]) => t);
    const people = L.people.filter((p) => inComp.has(p.team.id)).map((p) => [rank(p.name), p]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0] || b[1].opr - a[1].opr).slice(0, 12).map(([, p]) => p);
    const players = people.map((p) => `<button class="team-card person" data-team="${esc(p.team.id)}" data-pid="${esc(p.pid)}">
        ${teamLogo(p.team.id, p.team.name, 'lg')}
        <span class="tc-name"><b>${esc(p.name)}</b><small>${esc(p.team.name)}</small></span>
        <span class="tc-who">${p.agents.slice(0, 3).map((a) => agentIcon(a)).join('')}<span><b>${int(p.opr)}</b> Op rounds in ${int(p.pr)} rounds played</span></span>
      </button>`).join('');
    if (!teams.length && !people.length) return `<div class="card empty">No team or player called “${esc(st.q)}”${where ? ` in ${esc(where)}` : ''}.</div>`;
    return (teams.length ? `<div class="grid-head"><h2>Teams</h2><span class="muted">${teams.length} match${teams.length === 1 ? '' : 'es'} · Enter opens the first</span></div>${grid(teams)}` : '')
      + (people.length ? `<div class="grid-head"><h2>Players</h2><span class="muted">opens their team, filtered to them</span></div><div class="team-grid">${players}</div>` : '');
  }

  if (st.comp !== 'all') {
    teams.sort(order);
    return `<div class="grid-head"><h2>${esc(where)}</h2><span class="muted">${teams.length} teams</span>${sortSeg}</div>${grid(teams)}`;
  }
  // Everything: one section per competition, each team under the one it played most.
  return L.circuits.map((c, i) => {
    const list = teams.filter((t) => t.circuit === c).sort(order);
    if (!list.length) return '';
    return `<div class="grid-head"><h2>${esc(c)}</h2><span class="muted">${list.length} team${list.length === 1 ? '' : 's'}</span>${i === 0 ? sortSeg : ''}</div>${grid(list)}`;
  }).join('');
}
