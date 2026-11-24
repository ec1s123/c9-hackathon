// What each ability is, and how much the data can say about where it ends up.
//
// k: type, for the filter chips.
// m: what is known about the landing spot.
//   self   happens on the caster                          -> exact
//   near   placed within r metres in front of the caster  -> good to about r metres
//   throw  thrown; distance read from the aim pitch using a table fitted to
//          this dataset's own damage events (data/util/index.json)  -> rough, 5 to 10 m
//   aim    thrown or fired along the aim, distance not in the data  -> caster position + direction
//   ray    travels out from the caster along the aim (walls, drones) -> caster position + direction
//   remote placed through the map or from another form    -> caster position only
// Abilities not listed here (new agents) are shown as 'aim' under "Other".

export const KINDS = [
  ['trap', 'Traps & setups'],
  ['smoke', 'Smokes & walls'],
  ['molly', 'Mollies & damage'],
  ['flash', 'Flashes'],
  ['recon', 'Recon'],
  ['cc', 'Stuns & slows'],
  ['self', 'Movement & self'],
];
export const KIND_NAME = Object.fromEntries([...KINDS, ['other', 'Other']]);

const A = (k, m, r) => ({ k, m, r });
export const ABILITY = {
  // Astra
  'stars': A('smoke', 'remote'), 'nebula-dissipate': A('smoke', 'remote'), 'nova-pulse': A('cc', 'remote'), 'gravity-well': A('cc', 'remote'),
  // Breach
  'fault-line': A('cc', 'ray'), 'flashpoint': A('flash', 'aim'), 'aftershock': A('molly', 'aim'), 'rolling-thunder': A('cc', 'ray'),
  // Brimstone
  'sky-smoke': A('smoke', 'remote'), 'stim-beacon': A('self', 'near', 3), 'incendiary': A('molly', 'throw'), 'orbital-strike': A('molly', 'remote'),
  // Chamber
  'trademark': A('trap', 'near', 5), 'rendezvous': A('trap', 'self'),
  // Clove
  'ruse': A('smoke', 'remote'), 'meddle': A('cc', 'aim'), 'pick-me-up': A('self', 'self'), 'not-dead-yet': A('self', 'self'),
  // Cypher
  'trapwire': A('trap', 'near', 3), 'cyber-cage': A('smoke', 'aim'), 'spycam': A('recon', 'aim'), 'neural-theft': A('recon', 'self'),
  // Deadlock
  'sonic-sensor': A('trap', 'aim'), 'gravnet': A('cc', 'aim'), 'barrier-mesh': A('smoke', 'aim'), 'annihilation': A('cc', 'ray'),
  // Fade
  'prowler': A('recon', 'ray'), 'haunt': A('recon', 'aim'), 'seize': A('cc', 'aim'), 'nightfall': A('recon', 'ray'),
  // Gekko
  'dizzy': A('flash', 'ray'), 'wingman': A('cc', 'ray'), 'mosh-pit': A('molly', 'throw'), 'thrash': A('cc', 'ray'),
  // Harbor
  'cascade': A('smoke', 'ray'), 'high-tide': A('smoke', 'ray'), 'cove': A('smoke', 'aim'), 'reckoning': A('cc', 'ray'), 'storm-surge': A('cc', 'aim'),
  // Iso
  'undercut': A('cc', 'ray'), 'contingency': A('smoke', 'ray'), 'kill-contract': A('self', 'ray'),
  // Jett
  'tailwind': A('self', 'self'), 'cloudburst': A('smoke', 'aim'), 'updraft': A('self', 'self'),
  // KAY/O
  'zero-point': A('recon', 'aim'), 'flash-drive': A('flash', 'aim'), 'frag-ment': A('molly', 'throw'), 'null-cmd': A('cc', 'self'),
  // Killjoy
  'nanoswarm': A('molly', 'throw'), 'turret': A('trap', 'near', 2), 'alarmbot': A('trap', 'near', 4), 'lockdown': A('cc', 'near', 2),
  // Neon
  'relay-bolt': A('cc', 'aim'), 'fast-lane': A('smoke', 'ray'),
  // Omen
  'dark-cover': A('smoke', 'aim'), 'paranoia': A('flash', 'ray'), 'shrouded-step': A('self', 'aim'), 'from-the-shadows': A('self', 'remote'),
  // Phoenix
  'curveball': A('flash', 'self'), 'hot-hands': A('molly', 'throw'), 'blaze': A('smoke', 'ray'),
  // Raze
  'blast-pack': A('self', 'aim'), 'paint-shells': A('molly', 'throw'), 'boom-bot': A('recon', 'ray'), 'showstopper': A('molly', 'aim'),
  // Reyna
  'leer': A('flash', 'aim'), 'devour': A('self', 'self'),
  // Sage
  'slow-orb': A('cc', 'aim'), 'barrier-orb': A('smoke', 'near', 5), 'healing-orb': A('self', 'self'), 'resurrection': A('self', 'self'),
  // Skye
  'guiding-light': A('flash', 'ray'), 'trailblazer': A('recon', 'ray'), 'regrowth': A('self', 'self'), 'seekers': A('recon', 'self'),
  // Sova
  'recon-bolt': A('recon', 'aim'), 'shock-bolt': A('molly', 'aim'), 'owl-drone': A('recon', 'ray'), "hunter's-fury": A('molly', 'ray'),
  // Tejo
  'guided-salvo': A('molly', 'remote'), 'stealth-drone': A('recon', 'ray'), 'special-delivery': A('cc', 'aim'), 'armageddon': A('molly', 'remote'),
  // Veto
  'crosscut': A('trap', 'self'), 'chokehold': A('trap', 'aim'), 'interceptor': A('trap', 'near', 3),
  // Viper
  'toxic-screen': A('smoke', 'ray'), 'poison-cloud': A('smoke', 'aim'), 'snake-bite': A('molly', 'throw'), "viper's-pit": A('smoke', 'self'),
  // Vyse
  'razorvine': A('trap', 'throw'), 'arc-rose': A('flash', 'aim'), 'shear': A('trap', 'near', 5), 'steel-garden': A('cc', 'self'),
  // Waylay
  'refract': A('self', 'self'), 'saturate': A('cc', 'aim'), 'light-speed': A('self', 'self'), 'convergent-paths': A('cc', 'ray'),
  // Yoru
  'gatecrash': A('self', 'aim'), 'blindside': A('flash', 'aim'), 'fakeout': A('flash', 'ray'), 'dimensional-drift': A('self', 'self'),
};
// Types that can earn an assist without dealing damage: they blind, stun, slow or reveal.
// A kill names who assisted but not how, so the build marks every ability the assister used
// shortly before it; the mark only counts for these. Smokes and movement are left out because
// nothing they do earns an assist (smokes of agents with no flash or stun show almost none),
// and traps because one can trigger long after it was placed.
export const SETS_UP = new Set(['flash', 'cc', 'recon']);
const UNKNOWN = A('other', 'aim');
export const abilityMeta = (id) => ABILITY[id] || UNKNOWN;

// How the landing column is described to the reader, per model.
export const MODEL_NOTE = {
  self: 'Happens on the player, so the spot is exact.',
  near: 'Placed within a few metres in front of the player. Shown just ahead of where they stood.',
  throw: 'Thrown. Where it hurt someone the landing spot is known; identical throws inherit it; the rest are read off the throw angle.',
  aim: 'Thrown or fired along the aim. How far it travels is not in the data, so unless it hurt someone this is where the player stood and which way they aimed.',
  ray: 'Travels out from the player along the aim. Shown as where they stood and which way they aimed.',
  remote: 'Placed through the map or from another form. Only where the player stood is known.',
};
export const MODEL_SHORT = { self: 'exact', near: 'within a few metres', throw: 'estimated landing', aim: 'thrown from', ray: 'cast from', remote: 'cast from' };

// Sova's bow. How hard it was drawn and how many bounces were set are not recorded, and the
// arrow's speed cannot be recovered from the data either (tried: no speed fits the shock bolts
// that hit someone). What does hold up is the simplest rule: a flat shot sticks in the first
// wall on its line. Tested on 2,431 flat shock bolts that hit someone: median 8 m from the
// victim, 80% within 14 m. For lobbed arrows nothing tested came closer than 16 m, so they
// get no landing at all.
export const WALL_SHOT = { abilities: ['recon-bolt', 'shock-bolt'], maxPitch: 15, err: 8 };
/** First mapped wall along the aim, or the floor for a downward shot. null if there is none in range. */
export function firstWall(x, y, yaw, pitch, walkable) {
  const r = yaw * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
  const floor = pitch < -3 ? EYE_CM / Math.tan(-pitch * Math.PI / 180) : Infinity;
  let s = 0, out = false;                         // out: has left the spot the archer stands on
  while (s < 12000) {
    s += 50;
    if (s >= floor) return { x: x + ca * floor, y: y + sa * floor };
    const open = walkable(x + ca * s, y + sa * s);
    if (open) out = true;
    else if (out || s > 400) return { x: x + ca * (s - 50), y: y + sa * (s - 50) };   // a ledge or box under the archer is not a wall
  }
  return null;
}

const EYE_CM = 150;
/** Landing distance in cm along the aim. fit = { bins: [[pitch, cm, ...]] } for thrown abilities. */
export function reach(meta, pitch, fit) {
  if (pitch == null) return 0;
  if (meta.m === 'near') {
    const r = meta.r * 100;
    return pitch < -3 ? Math.min(r, EYE_CM / Math.tan(-pitch * Math.PI / 180)) : r;
  }
  if (meta.m === 'throw' && fit) {
    const b = fit.bins;
    if (pitch <= b[0][0]) {
      // Steeper than anything in the table (dropped at the feet): shrink with the angle.
      const k = b[0][0] < 0 && pitch < b[0][0] ? Math.tan(-b[0][0] * Math.PI / 180) / Math.tan(Math.min(89, -pitch) * Math.PI / 180) : 1;
      return Math.max(0, b[0][1] * k);
    }
    for (let i = 1; i < b.length; i++) {
      if (pitch <= b[i][0]) {
        // Do not interpolate across a hole in the table (no throws at those angles).
        if (b[i][0] - b[i - 1][0] > 20) return Math.max(0, pitch - b[i - 1][0] < b[i][0] - pitch ? b[i - 1][1] : b[i][1]);
        const w = (pitch - b[i - 1][0]) / (b[i][0] - b[i - 1][0]);
        return Math.max(0, b[i - 1][1] + (b[i][1] - b[i - 1][1]) * w);
      }
    }
    return Math.max(0, b[b.length - 1][1]);
  }
  return 0;
}
