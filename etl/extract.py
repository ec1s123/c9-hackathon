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
"""

from __future__ import annotations

import json
from datetime import datetime

try:  # Python 3.14+
    from compression import zstd
except ImportError:  # pragma: no cover - older Pythons
    import zstandard as zstd  # type: ignore

OP = "operator"
OP_COST = 4700
EXTRACT_VERSION = 3

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


class _Round:
    __slots__ = ("n", "t_start", "t0", "t_end", "sides", "winner", "win_type",
                 "plant", "P", "dmg", "kills", "abil", "ended")

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
        self.ended = False


def extract_series(path: str, valid_games: set[str]) -> dict:
    """Stream one series file and return ``{"v": .., "games": [..]}``."""
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
        games[rnd_game]["rounds"].append({
            "n": r.n, "t0": round(r.t0), "dur": round(t_end - r.t0, 1),
            "sides": r.sides, "winner": r.winner, "wt": r.win_type,
            "plant": r.plant, "pl": out_pl, "ops": out_ops,
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
                                         "x": ap[0], "y": ap[1]})
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
