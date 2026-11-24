"""Turn one GRID VALORANT series feed into per-round Operator records.

What the feed gives us (and what it does not):

* There are no purchase events. Buys are inferred from the full-state
  snapshots: inventory + money at ``game-started-round`` (after the round
  reward, before buying) and at ``round-ended-freezetime`` (after buying).
* Every in-round event carries the 2D position of all ten players, so a
  player's movement is sampled whenever *anyone* uses an ability, deals damage
  or gets a kill. That is irregular (roughly one sample every 1-3 s) but good
  enough for setups, rotations and heatmaps.
* Only shots that hit are recorded. A missed Operator shot leaves no trace.
* Weapon pickups are not events (only the spike is). A mid-round Operator
  pickup is detected when a player who did not start the round with one deals
  Operator damage.
* Ability casts are events, but GRID's position on them is 2D and can lag. The
  ability supplement gives the caster's exact position and aim for each cast.
  Its extra records that GRID does not report all sit in the second between
  two rounds (charges refilling), so they are not casts and are left out. No
  feed says where an ability lands: the only trace is the position of the
  enemies it damaged.
* What an ability did is in the feed in three ways, all kept per cast: the
  damage it dealt (every hit names its source), the kills it finished (a kill
  names only guns, so an ability kill is one whose last hit was the ability),
  and assists. Each kill lists who assisted but not how. An assister who had
  damaged the victim with an ability gives that cast a damage assist. An
  assister who never damaged the victim earned it some other way (a flash, a
  stun, a reveal): every ability they used in the ``SETUP_S`` seconds before
  the kill is marked as a possible cause, and the web app keeps the mark only
  for abilities that can do that (``web/utilmeta.js``).
* When a round is restarted the feed takes its casts back
  (``player-!used-ability``) and re-applies them with new ids and stale
  times. Taken-back casts are removed and re-applied ones are not counted.
"""

from __future__ import annotations

import json
import math
import os
from bisect import bisect_left
from datetime import datetime

try:  # Python 3.14+
    from compression import zstd
except ImportError:  # pragma: no cover - older Pythons
    import zstandard as zstd  # type: ignore

OP = "operator"
OP_COST = 4700
EXTRACT_VERSION = 7
AFTER_S = 5   # "where are they after using it": seconds after the cast
SETUP_S = 10  # an assist without damage is tied to abilities used this long before the kill
FOLLOW_S = 5  # "the caster got a kill right after": seconds after the cast

SHIELDS = ("heavyshield", "lightshield", "regenshield")
# Rough price order, used to pick the "main" weapon out of an inventory.
WEAPON_RANK = {
    "operator": 4700, "odin": 3200, "vandal": 2900, "phantom": 2900,
    "ares": 1600, "outlaw": 2400, "guardian": 2250, "bulldog": 2050,
    "judge": 1850, "spectre": 1600, "stinger": 1100, "marshal": 950,
    "bucky": 850, "sheriff": 800, "bandit": 600, "ghost": 500,
    "frenzy": 450, "shorty": 300, "classic": 0,
}
SIDE = {"attacker": "a", "defender": "d"}


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def _items(player: dict) -> list[str]:
    return [i["id"] for i in (player.get("inventory") or {}).get("items", [])]


def _main_weapon(items: list[str]) -> str:
    best, rank = "", -1
    for i in items:
        r = WEAPON_RANK.get(i)
        if r is not None and r > rank:
            best, rank = i, r
    return best


def _pos(state: dict):
    p = (state.get("game") or {}).get("position")
    if not p:
        return None
    return round(p["x"]), round(p["y"])


def _current_game(games: list[dict]):
    if len(games) == 1:
        return games[0]
    started = [g for g in games if g.get("started")]
    if not started:
        return None
    live = [g for g in started if not g.get("finished")]
    return (live or started)[-1]


def _frame(c: dict):
    """Caster position and aim for one supplement record: (x, y, yaw, pitch) or None."""
    q = c.get("quality")
    fr = c.get("interpolated")
    if q == "gap_exceeded":
        # One of the two samples is from another moment (often the next round).
        near = [f for f in (c.get("frame_before"), c.get("frame_after")) if f]
        fr = min(near, key=lambda f: abs(f["offset_ms"])) if near else None
        if fr and abs(fr["offset_ms"]) > 1500:
            fr = None
    if not fr or not fr.get("position") or not fr.get("view"):
        return None
    p, v = fr["position"], fr["view"]
    flat = math.hypot(v["x"], v["y"])
    return (round(p["x"]), round(p["y"]),
            round(math.degrees(math.atan2(v["y"], v["x"]))) % 360,
            round(math.degrees(math.atan2(v["z"], flat))))


def load_supplement(path: str | None) -> dict[str, tuple]:
    """-> {GRID event id: (x, y, yaw, pitch)} for every cast GRID also reports."""
    by_event: dict[str, tuple] = {}
    if not path or not os.path.exists(path):
        return by_event
    with zstd.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            c = json.loads(line)
            if not c.get("in_grid") or not c.get("grid_event_id"):
                continue
            fr = _frame(c)
            if fr is not None:
                by_event[c["grid_event_id"]] = fr
    return by_event


def _pos_at(track: list, t: float):
    """Position at round time t from (t, x, y) samples, or None if it is not covered."""
    if not track:
        return None
    i = bisect_left(track, (t,))
    a = track[i - 1] if i > 0 else None
    b = track[i] if i < len(track) else None
    if a and b and b[0] - a[0] <= 8:
        w = (t - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0
        return round(a[1] + (b[1] - a[1]) * w), round(a[2] + (b[2] - a[2]) * w)
    near = min((s for s in (a, b) if s), key=lambda s: abs(s[0] - t))
    return (near[1], near[2]) if abs(near[0] - t) <= 3 else None


def _latest(casts: list, pid: str, t: float, within: float) -> list:
    """The player's most recent cast of each ability in the ``within`` seconds before t."""
    seen, out = set(), []
    for c in reversed(casts):
        if c["a"] != pid or c["T"] > t or c["id"] in seen:
            continue
        if t - c["T"] > within:
            break       # casts are in time order
        seen.add(c["id"])
        out.append(c)
    return out


def _credit(rnd: "_Round", t: float, killer: str, victim: str, weapon: str, assists: list):
    """Tie one kill back to the ability casts behind it."""
    for c in reversed(rnd.util):        # finished by an ability: its latest cast
        if c["a"] == killer and c["id"] == weapon:
            c["k"] = c.get("k", 0) + 1
            break
    for c in _latest(rnd.util, killer, t, FOLLOW_S):
        if c["id"] != weapon:
            c["ok"] = c.get("ok", 0) + 1
    for a in assists:
        pid = a.get("playerId")
        if pid == killer:
            continue
        if (pid, victim) in rnd.hurt:
            for c in rnd.util:
                if c["a"] == pid and victim in c.get("vic", ()):
                    c["da"] = c.get("da", 0) + 1
        else:
            for c in _latest(rnd.util, pid, t, SETUP_S):
                c["sa"] = c.get("sa", 0) + 1


class _Round:
    __slots__ = ("n", "t_start", "t0", "t_end", "sides", "winner", "win_type",
                 "plant", "P", "dmg", "kills", "abil", "util", "hurt", "ended")

    def __init__(self, n: int, t_start: float):
        self.n = n
        self.t_start = t_start
        self.t0 = None       # end of buy phase (barriers drop)
        self.t_end = None    # team-won-round
        self.sides = {}
        self.winner = None
        self.win_type = ""
        self.plant = None
        self.P = {}          # pid -> per-player working state
        self.dmg = []
        self.kills = []
        self.abil = []
        self.util = []       # every cast from the start of the buy phase
        self.hurt = set()    # (attacker, victim) pairs with any damage this round
        self.ended = False


def extract_series(path: str, valid_games: set[str], supplement: str | None = None) -> dict:
    """Stream one series file and return ``{"v": .., "games": [..]}``."""
    supp = load_supplement(supplement)
    games: dict[str, dict] = {}
    rnd: _Round | None = None
    rnd_game: str | None = None

    def finalize():
        nonlocal rnd
        r, rnd = rnd, None
        if r is None or r.t0 is None or r.winner is None or rnd_game not in games:
            return
        t_end = r.t_end if r.t_end is not None else r.t0
        out_pl, out_ops = {}, {}
        first_kill = r.kills[0] if r.kills else None
        for pid, st in r.P.items():
            my_kills = [k for k in r.kills if k["a"] == pid]
            death = next((k for k in r.kills if k["v"] == pid), None)
            op_hits = [d for d in r.dmg if d["a"] == pid and d["src"] == OP]
            op0, op1 = st["op0"], st.get("op1", False)
            spent = st["m0"] - st.get("m1", st["m0"])
            if op1:
                src = "carried" if op0 else ("bought" if spent >= OP_COST else "received")
            elif op_hits or any(k["w"] == OP for k in my_kills):
                src = "pickup"
            else:
                src = ""
            out_pl[pid] = {
                "m0": st["m0"], "m1": st.get("m1", st["m0"]), "lv": st.get("lv1", 0),
                "op0": int(op0), "op1": int(op1), "w": st.get("w", ""),
                "ar": st.get("ar", ""), "k": len(my_kills),
                "ok": sum(1 for k in my_kills if k["w"] == OP),
                "d": int(death is not None or not st["alive"]),
                "ope": int(st.get("ope", False)), "src": src,
            }
            if not src:
                continue
            taken = [d for d in r.dmg if d["v"] == pid]
            out_ops[pid] = {
                "src": src,
                "track": [c for s in st["track"] for c in s],
                "hits": [[d["t"], d["ax"], d["ay"], d["vx"], d["vy"], d["dmg"], d["part"],
                          int(d.get("kill", False)), d["v"]] for d in op_hits],
                "kills": [[k["t"], k["w"], k["ax"], k["ay"], k["vx"], k["vy"], k["v"],
                           int(k is first_kill)] for k in my_kills],
                "death": ([death["t"], death["vx"], death["vy"], death["ax"], death["ay"],
                           death["a"], death["w"], int(death is first_kill)] if death else None),
                "abil": [[a["t"], a["id"], a["x"], a["y"]] for a in r.abil if a["a"] == pid],
                "ft": taken[0]["t"] if taken else None,
            }
        # Utility: every cast from the start of the buy phase to the end of the round.
        dur = t_end - r.t0
        died = {}
        for k in r.kills:
            died.setdefault(k["v"], k["t"])
        out_util = []
        for c in r.util:
            rt = round(c["T"] - r.t0, 1)
            x, y, yaw, pit = c["fr"]
            # Where the caster is AFTER_S seconds later (for buy-phase casts:
            # AFTER_S seconds into the round).
            ta = max(rt, 0) + AFTER_S
            after = None
            if ta <= dur and died.get(c["a"], 1e9) >= ta:
                after = _pos_at(r.P[c["a"]]["track"], ta)
            row = [rt, c["a"], c["id"], x, y, yaw, pit,
                   after[0] if after else None, after[1] if after else None, c["src"]]
            if "hits" in c:  # enemies it damaged: where they stood (mean), delay to the first
                hs = list(c["hits"].values())
                row += [round(sum(h[0] for h in hs) / len(hs)), round(sum(h[1] for h in hs) / len(hs)),
                        round(c["ht"] - c["T"], 1)]
            else:
                row += [None, None, None]
            # What it did: enemies damaged, damage, kills it finished, assists through its
            # damage, assists it may have set up, kills by the caster right after.
            row += [len(c.get("vic", ())), c.get("dmg", 0), c.get("k", 0), c.get("da", 0),
                    c.get("sa", 0), c.get("ok", 0)]
            out_util.append(row)
        games[rnd_game]["rounds"].append({
            "n": r.n, "t0": round(r.t0), "dur": round(dur, 1),
            "sides": r.sides, "winner": r.winner, "wt": r.win_type,
            "plant": r.plant, "pl": out_pl, "ops": out_ops, "util": out_util,
            "st": {pid: st["start"] for pid, st in r.P.items() if st.get("start")},
        })

    with zstd.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            env = json.loads(line)
            t = None
            for e in env["events"]:
                ss = e.get("seriesState")
                if not ss:
                    continue
                g = _current_game(ss.get("games") or [])
                if g is None or g.get("id") not in valid_games:
                    continue
                ty = e["type"]
                gid = g["id"]
                if t is None:
                    t = _ts(env["occurredAt"])

                if ty == "game-started-round":
                    finalize()
                    segs = g.get("segments") or []
                    if not segs:
                        continue
                    game = games.setdefault(gid, {
                        "id": gid, "map": (g.get("map") or {}).get("name", ""),
                        "teams": {}, "players": {}, "rounds": [],
                    })
                    n = segs[-1]["sequenceNumber"]
                    # A replayed round (after a rollback) replaces the earlier attempt.
                    game["rounds"] = [x for x in game["rounds"] if x["n"] < n]
                    rnd = _Round(n, t)
                    rnd_game = gid
                    for tm in g["teams"]:
                        game["teams"][tm["id"]] = tm.get("name", "")
                        rnd.sides[tm["id"]] = SIDE.get(tm.get("side"), "")
                        for p in tm["players"]:
                            pid = p["id"]
                            game["players"].setdefault(pid, {
                                "name": p.get("name", ""), "team": tm["id"],
                                "agent": (p.get("character") or {}).get("id", ""),
                            })
                            rnd.P[pid] = {
                                "team": tm["id"], "m0": p.get("money", 0),
                                "op0": OP in _items(p), "alive": True,
                                "track": [], "last": None,
                            }
                    continue

                if ty == "game-!started-round":
                    rnd = None
                    continue
                if rnd is None or gid != rnd_game or rnd.ended:
                    continue

                if ty == "player-!used-ability":
                    gone = e.get("revertedEventId")
                    rnd.util = [c for c in rnd.util if c["eid"] != gone]
                    rnd.abil = [c for c in rnd.abil if c.get("eid") != gone]
                    continue
                if ty == "player-used-ability" and e.get("revertedEventId"):
                    continue    # a taken-back cast being re-applied, not a new one
                if ty == "player-used-ability" and rnd.t_end is None:
                    a = e["actor"]
                    if a["id"] in rnd.P:
                        fr = supp.get(e["id"])
                        ap = None if fr else _pos(a["state"])
                        if fr or ap:
                            rnd.util.append({
                                "T": t, "a": a["id"], "id": e["target"]["id"], "eid": e["id"],
                                "fr": fr or (ap[0], ap[1], None, None),
                                "src": 0 if fr else 1,   # 1 = GRID position only, no aim
                            })

                if ty == "round-ended-freezetime":
                    rnd.t0 = t
                    for tm in g["teams"]:
                        for p in tm["players"]:
                            st = rnd.P.get(p["id"])
                            if st is None:
                                continue
                            items = _items(p)
                            st["m1"] = p.get("money", 0)
                            st["lv1"] = p.get("loadoutValue", 0)
                            st["op1"] = OP in items
                            st["w"] = _main_weapon(items)
                            st["ar"] = next((s for s in SHIELDS if s in items), "")
                            st["alive"] = True
                            st["track"], st["last"] = [], None
                            pos = p.get("position")     # where they stand as the barriers drop
                            st["start"] = (round(pos["x"]), round(pos["y"])) if pos else None
                elif ty == "game-ended-round":
                    for tm in g["teams"]:
                        for p in tm["players"]:
                            st = rnd.P.get(p["id"])
                            if st is not None:
                                st["ope"] = bool(p.get("alive")) and OP in _items(p)
                    rnd.ended = True
                    finalize()
                    continue

                if rnd.t0 is None:
                    continue
                rt = round(t - rnd.t0, 1)
                live = rnd.t_end is None

                if ty == "player-damaged-player" and live:
                    a, v = e["actor"], e["target"]
                    delta = (a.get("stateDelta") or {}).get("game") or {}
                    srcs = delta.get("damageDealtSources") or []
                    parts = delta.get("damageDealtTargets") or []
                    ap, vp = _pos(a["state"]), _pos(v["state"])
                    rnd.hurt.add((a["id"], v["id"]))
                    if srcs:
                        name = (srcs[0].get("source") or {}).get("name", "")
                        for c in reversed(rnd.util):
                            if c["a"] == a["id"] and c["id"] == name:
                                c["dmg"] = c.get("dmg", 0) + srcs[0].get("damageAmount", 0)
                                c.setdefault("vic", set()).add(v["id"])
                                if vp:
                                    # Where an enemy stood when an ability first hurt them
                                    # marks roughly where it landed.
                                    c.setdefault("hits", {}).setdefault(v["id"], vp)
                                    c.setdefault("ht", t)
                                break
                    if srcs and ap and vp:
                        rnd.dmg.append({
                            "t": rt, "a": a["id"], "v": v["id"],
                            "src": (srcs[0].get("source") or {}).get("name", ""),
                            "dmg": srcs[0].get("damageAmount", 0),
                            "part": (parts[0].get("target") or {}).get("name", "") if parts else "",
                            "ax": ap[0], "ay": ap[1], "vx": vp[0], "vy": vp[1],
                        })
                        if a["id"] in rnd.P:
                            rnd.P[a["id"]]["alive"] = True  # e.g. revived
                elif ty in ("player-killed-player", "player-teamkilled-player",
                            "player-selfkilled-player"):
                    a, v = e["actor"], e["target"]
                    if ty == "player-killed-player" and live:
                        delta = (a.get("stateDelta") or {})
                        wk = (delta.get("round") or {}).get("weaponKills") or \
                             (delta.get("game") or {}).get("weaponKills") or {}
                        weapon = next(iter(wk), "")
                        last_hit = next((d for d in reversed(rnd.dmg)
                                         if d["a"] == a["id"] and d["v"] == v["id"]
                                         and rt - d["t"] <= 0.2), None)
                        if last_hit:
                            last_hit["kill"] = True
                            weapon = weapon or last_hit["src"]
                        _credit(rnd, t, a["id"], v["id"], weapon,
                                (delta.get("round") or {}).get("killAssistsReceivedFromPlayer") or [])
                        ap, vp = _pos(a["state"]), _pos(v["state"])
                        if ap and vp:
                            rnd.kills.append({"t": rt, "a": a["id"], "v": v["id"], "w": weapon,
                                              "ax": ap[0], "ay": ap[1], "vx": vp[0], "vy": vp[1]})
                    if v["id"] in rnd.P:
                        rnd.P[v["id"]]["alive"] = False
                elif ty == "player-used-ability" and live:
                    a = e["actor"]
                    ap = _pos(a["state"])
                    if ap:
                        rnd.abil.append({"t": rt, "a": a["id"], "id": e["target"]["id"],
                                         "x": ap[0], "y": ap[1], "eid": e["id"]})
                    if a["id"] in rnd.P:
                        rnd.P[a["id"]]["alive"] = True
                elif ty == "player-completed-plantBomb" and live:
                    rnd.plant = rt
                elif ty == "team-won-round":
                    rnd.winner = e["actor"]["id"]
                    rnd.win_type = (((e["actor"].get("state") or {}).get("round") or {})
                                    .get("winType", ""))
                    rnd.t_end = t

                # Sample everyone's position while the round is live.
                if live and "teams" in g:
                    for tm in g["teams"]:
                        for p in tm["players"]:
                            st = rnd.P.get(p["id"])
                            pos = p.get("position")
                            if st is None or not pos or not st["alive"]:
                                continue
                            x, y = round(pos["x"]), round(pos["y"])
                            last = st["last"]
                            if last is not None:
                                moved = abs(x - last[1]) + abs(y - last[2])
                                if moved < 40 and rt - last[0] < 3:
                                    continue
                            st["last"] = (rt, x, y)
                            st["track"].append((rt, x, y))

    finalize()
    return {"v": EXTRACT_VERSION, "games": list(games.values())}
