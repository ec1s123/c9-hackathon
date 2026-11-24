"""Roll every ability cast up into one file per map for the Utility page.

``data/util/<map>.json`` holds every cast on that map as parallel columns
(position, aim, time, ability, player, game, round, side) plus the lookup
tables they point into, and ``s``: where every player stood as the barriers
dropped, one row per player per round. ``data/util/index.json`` lists the maps and carries a
throw-distance table per damaging ability, fitted from the feed itself.

Nothing says where an ability lands. The one trace is damage: where the
enemies stood when it first hurt them. That gives three grades of landing spot
for abilities that hurt:

* observed  it damaged someone, so the spot is where they stood (``o.q`` = 2)
* matched   it hit nobody, but at least two observed throws of the same ability
            on this map came from the same spot with the same aim, and they
            agree with each other; it lands where they did (``o.q`` = 1)
* fitted    neither: the web app reads a distance off a table of throw
            distance against aim pitch, built here from the observed ones

Everything that deals no damage (smokes, flashes, recon) has no trace at all,
so only the caster's position and aim are known.
"""

from __future__ import annotations

import json
import math
from array import array
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

# Weapon equips and sprint toggles: logged as casts, but not utility.
DROP = {"high-gear", "headhunter", "tour-de-force", "double-tap"}
# Stay where they land for the whole round, so a late first hit still marks the spot.
STATIC = {"nanoswarm", "razorvine"}
# Damage from these marks a spot on the ground (not a line, not a turret's target).
SPOT = {"nanoswarm", "incendiary", "snake-bite", "hot-hands", "mosh-pit", "frag-ment",
        "paint-shells", "razorvine", "shock-bolt", "aftershock", "special-delivery", "meddle",
        "orbital-strike", "armageddon", "guided-salvo", "showstopper"}
# Thrown along the aim, so the same spot and the same aim give the same landing.
# (Tested leave-one-out: 3 to 5 m from the victim, against 4 to 10 m for the pitch table.
# Map-targeted abilities and Raze's rocket did not pass and are not matched.)
LINEUP = {"nanoswarm", "incendiary", "snake-bite", "hot-hands", "mosh-pit", "frag-ment",
          "paint-shells", "razorvine", "shock-bolt", "aftershock"}
MATCH_CM, MATCH_DEG, MATCH_MIN, MATCH_SPREAD_CM = 150, 4, 2, 400
HIT_WINDOW_S = 12
PITCH_BIN = 10
MIN_BIN = 25
NA = -(2 ** 31)

COLS = ("x", "y", "yaw", "pit", "t", "ab", "p", "g", "rn", "k", "px", "py")
START_COLS = ("x", "y", "p", "g", "k", "a")   # position at barrier drop, player, game, side|slot, agent


class _Map:
    def __init__(self):
        self.teams: dict[str, int] = {}
        self.players: dict[str, int] = {}
        self.abilities: dict[str, int] = {}
        self.events: dict[str, int] = {}
        self.games: list[dict] = []
        self.rounds = 0
        self.team_games: Counter = Counter()    # team id -> games on this map
        self.obs: dict[int, tuple] = {}         # cast index -> where the enemies it hurt stood
        self.agents: dict[str, int] = {}
        self.s = {k: array("i") for k in START_COLS}
        self.c = {k: array("i") for k in COLS}


def _idx(table: dict, key) -> int:
    if key not in table:
        table[key] = len(table)
    return table[key]


class UtilBuilder:
    def __init__(self, after_s: int):
        self.after_s = after_s
        self.maps: dict[str, _Map] = {}
        self.team_names: dict[str, str] = {}
        self.player_names: dict[str, str] = {}
        self.agent_of: dict[str, Counter] = defaultdict(Counter)
        self.fit: dict[str, list] = defaultdict(list)   # ability -> [(pitch, forward cm, sideways cm)]

    def add_game(self, s: dict, mg: dict, g: dict, names: dict, team_names: dict):
        tids = list(g["teams"].keys())
        M = self.maps.setdefault(g["map"], _Map())
        for tid in tids:
            self.team_names[tid] = team_names.get(tid, g["teams"][tid])
        self.player_names.update(names)
        slot = {tid: i for i, tid in enumerate(tids)}
        gi = len(M.games)
        side_rounds = [[0, 0], [0, 0]]      # per team slot: [attack rounds, defense rounds]
        plants = []
        c = M.c
        for r in g["rounds"]:
            for tid in tids:
                sd = r["sides"].get(tid)
                if sd in ("a", "d"):
                    side_rounds[slot[tid]][sd == "d"] += 1
            if r["plant"] is not None:
                plants.append([r["n"], r["plant"]])
            for pid, (sx, sy) in (r.get("st") or {}).items():
                p = g["players"].get(pid)
                sd = r["sides"].get(p["team"]) if p else None
                if sd in ("a", "d"):
                    M.s["x"].append(sx)
                    M.s["y"].append(sy)
                    M.s["p"].append(_idx(M.players, pid))
                    M.s["g"].append(gi)
                    M.s["k"].append((sd == "d") | (slot[p["team"]] << 1))
                    M.s["a"].append(_idx(M.agents, p["agent"]))
            seen = defaultdict(list)        # (player, ability) -> cast times so far this round
            for u in r.get("util") or []:
                rt, pid, ab, x, y, yaw, pit, px, py, src = u[:10]
                p = g["players"].get(pid)
                if p is None:
                    continue
                self.agent_of[ab][p["agent"]] += 1
                seen[(pid, ab)].append(rt)
                # Only an unambiguous hit is used for fitting: one cast of that
                # ability by that player before the damage.
                hit = None
                if len(u) > 10 and len(seen[(pid, ab)]) == 1 and (ab in STATIC or u[12] <= HIT_WINDOW_S):
                    hit = (u[10], u[11])
                    if yaw is not None:
                        a = math.radians(yaw)
                        dx, dy = hit[0] - x, hit[1] - y
                        self.fit[ab].append((pit, dx * math.cos(a) + dy * math.sin(a),
                                             -dx * math.sin(a) + dy * math.cos(a)))
                if ab in DROP:
                    continue
                sd = r["sides"].get(p["team"])
                if sd not in ("a", "d"):
                    continue
                if hit and ab in SPOT:
                    M.obs[len(c["x"])] = hit
                c["x"].append(x)
                c["y"].append(y)
                c["yaw"].append(NA if yaw is None else yaw)
                c["pit"].append(NA if pit is None else pit)
                c["t"].append(round(rt * 10))
                c["ab"].append(_idx(M.abilities, ab))
                c["p"].append(_idx(M.players, pid))
                c["g"].append(gi)
                c["rn"].append(r["n"])
                c["k"].append((sd == "d") | (slot[p["team"]] << 1) | (src << 2))
                c["px"].append(NA if px is None else px)
                c["py"].append(NA if py is None else py)
        M.rounds += len(g["rounds"])
        M.team_games.update(tids)
        M.games.append({
            "sid": s["series_id"], "n": int(mg["game_number"] or 0),
            "date": (mg["started_at"] or s["scheduled_start"])[:10],
            "ev": _idx(M.events, s["event"]),
            "t": [_idx(M.teams, tid) for tid in tids],
            "ag": [sorted({p["agent"] for p in g["players"].values() if p["team"] == tid}) for tid in tids],
            "sr": side_rounds, "pl": plants,
        })

    def _calibration(self) -> dict:
        """ability -> {n, side, bins: [[pitch, median forward cm, p25, p75, n], ..]}"""
        out = {}
        for ab, pts in self.fit.items():
            if len(pts) < 150:
                continue
            bins = defaultdict(list)
            for pit, fwd, _ in pts:
                bins[math.floor(pit / PITCH_BIN) * PITCH_BIN].append(fwd)
            rows = []
            for b in sorted(bins):
                f = sorted(bins[b])
                if len(f) < MIN_BIN:
                    continue
                rows.append([b + PITCH_BIN // 2, round(median(f)), round(f[len(f) // 4]),
                             round(f[(3 * len(f)) // 4]), len(f)])
            if len(rows) >= 2:
                out[ab] = {"n": len(pts), "side": round(median(abs(p[2]) for p in pts)), "bins": rows}
        return out

    @staticmethod
    def _match(M: _Map) -> dict[int, tuple]:
        """Landing spots for throws that hit nobody, from observed throws with the same spot and aim."""
        c = M.c
        ab_id = {i: a for a, i in M.abilities.items()}
        grid = defaultdict(list)            # (ability, cell) -> observed cast indices
        for i in M.obs:
            if ab_id[c["ab"][i]] in LINEUP and c["yaw"][i] != NA:
                grid[(c["ab"][i], c["x"][i] // MATCH_CM, c["y"][i] // MATCH_CM)].append(i)
        out = {}
        for i in range(len(c["x"])):
            ab = c["ab"][i]
            if i in M.obs or c["yaw"][i] == NA or ab_id[ab] not in LINEUP:
                continue
            x, y, yaw, pit = c["x"][i], c["y"][i], c["yaw"][i], c["pit"][i]
            fwd, lat = [], []
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((ab, x // MATCH_CM + dx, y // MATCH_CM + dy), ()):
                        if (math.hypot(c["x"][j] - x, c["y"][j] - y) > MATCH_CM
                                or abs((c["yaw"][j] - yaw + 180) % 360 - 180) > MATCH_DEG
                                or abs(c["pit"][j] - pit) > MATCH_DEG):
                            continue
                        a = math.radians(c["yaw"][j])
                        ox, oy = M.obs[j][0] - c["x"][j], M.obs[j][1] - c["y"][j]
                        fwd.append(ox * math.cos(a) + oy * math.sin(a))
                        lat.append(-ox * math.sin(a) + oy * math.cos(a))
            if len(fwd) < MATCH_MIN:
                continue
            f, l = median(fwd), median(lat)
            # The matches must agree with each other (a bow can be drawn to different strengths).
            if median(abs(v - f) for v in fwd) > MATCH_SPREAD_CM:
                continue
            a = math.radians(yaw)
            out[i] = (round(x + f * math.cos(a) - l * math.sin(a)), round(y + f * math.sin(a) + l * math.cos(a)))
        return out

    def write(self, out_dir: Path) -> str:
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("*.json"):
            old.unlink()
        index_maps = {}
        total = size = n_obs = n_match = 0
        for name, M in sorted(self.maps.items()):
            n = len(M.c["x"])
            if not n:
                continue
            cols = {k: [None if v == NA else v for v in M.c[k]] for k in COLS}
            matched = self._match(M)
            known = sorted([(i, x, y, 2) for i, (x, y) in M.obs.items()]
                           + [(i, x, y, 1) for i, (x, y) in matched.items()])
            n_obs += len(M.obs)
            n_match += len(matched)
            doc = {
                "map": name,
                "teams": [{"id": t, "name": self.team_names.get(t, t)} for t in M.teams],
                "players": [{"id": p, "name": self.player_names.get(p, p)} for p in M.players],
                "abilities": [[a, self.agent_of[a].most_common(1)[0][0]] for a in M.abilities],
                "events": list(M.events),
                "agents": list(M.agents),
                "s": {k: M.s[k].tolist() for k in START_COLS},
                "games": M.games,
                "c": cols,
                # landing spots known from damage: cast index, x, y, 2 = observed / 1 = matched
                "o": {"i": [k[0] for k in known], "x": [k[1] for k in known],
                      "y": [k[2] for k in known], "q": [k[3] for k in known]},
            }
            path = out_dir / f"{name}.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f, separators=(",", ":"))
            size += path.stat().st_size
            total += n
            index_maps[name] = {"casts": n, "games": len(M.games), "rounds": M.rounds,
                                "teams": dict(M.team_games)}
        with open(out_dir / "index.json", "w", encoding="utf-8") as f:
            json.dump({"after": self.after_s, "maps": index_maps, "fit": self._calibration()},
                      f, separators=(",", ":"))
        return (f"{total:,} ability casts on {len(index_maps)} maps, {size / 1e6:.0f} MB of utility files; "
                f"landing observed for {n_obs:,}, matched to an identical throw for {n_match:,}")
