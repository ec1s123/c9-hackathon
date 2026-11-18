// Icons: team logos, agent portraits, ability and weapon silhouettes.
// All of them come from data/assets.json (etl/fetch_assets.py). Anything that
// is missing falls back to a monogram or plain text, so the app never breaks.
const DATA = '../data/';
let A = { agents: {}, roles: {}, abilities: {}, weapons: {}, teams: {} };

export function setAssets(a) { if (a) A = { ...A, ...a }; }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const img = (cls, src, label) => `<img class="ico ${cls}" src="${DATA}${esc(src)}" alt="" title="${esc(label)}" loading="lazy" decoding="async">`;

export const agentName = (key) => (A.agents[key] ? A.agents[key].name : cap(key));
export const agentRole = (key) => (A.agents[key] ? A.agents[key].role : '');
export const abilityName = (id) => (A.abilities[id] ? A.abilities[id].name : cap(String(id).replace(/-/g, ' ')));
export const hasTeamLogo = (id) => Boolean(A.teams[id]);

function initials(name) {
  const words = String(name).replace(/\(\d+\)/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function hue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

/** Team logo, or a monogram tile in a colour derived from the name. size: sm | md | lg | xl */
export function teamLogo(id, name, size = 'sm') {
  if (A.teams[id]) return `<span class="logo ${size}">${img('', A.teams[id], name)}</span>`;
  return `<span class="logo mono ${size}" style="--h:${hue(name)}" title="${esc(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

/** Agent portrait. size: sm | md | lg */
export function agentIcon(key, size = 'sm') {
  if (!key) return '';
  const a = A.agents[key];
  if (a) return img(`agent ${size}`, a.img, a.role ? `${a.name} · ${a.role}` : a.name);
  return `<span class="ico agent mono ${size}" title="${esc(cap(key))}" aria-hidden="true">${esc(cap(key).slice(0, 2))}</span>`;
}
/** Portrait followed by the agent's name. */
export const agentTag = (key, size = 'sm') => (key ? `<span class="tag">${agentIcon(key, size)}${esc(agentName(key))}</span>` : '–');

export function abilityIcon(id) {
  const a = A.abilities[id];
  return a ? img('glyph', a.img, a.name) : '';
}
export function weaponIcon(key) {
  return A.weapons[key] ? img('weapon', A.weapons[key], cap(key)) : '';
}

// Fallback reticle for when the weapon art has not been downloaded.
const RETICLE = '<svg class="ico op-fallback" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>';
/** The Operator itself. size: sm | md | lg */
export function opIcon(size = 'sm') {
  return A.weapons.operator ? img(`op ${size}`, A.weapons.operator, 'Operator') : RETICLE;
}
