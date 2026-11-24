#!/usr/bin/env python3
"""Build the Operator-tendency and utility datasets the web app reads.

    python3 etl/build.py                 # all VALORANT series
    python3 etl/build.py --limit 20      # quick smoke run
    python3 etl/build.py --force         # ignore the per-series cache

Reads the hackathon data repo (never copies it), writes everything to
``data/`` which is git-ignored because it is derived from licensed data.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import AFTER_S, EXTRACT_VERSION, OP_COST, extract_series  # noqa: E402
from utility import UtilBuilder  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"
REPO_NAME = "stl-hackathon-2026-grid-starter"


def find_data_dir(arg: str | None) -> Path:
    cands = [arg, os.environ.get("STL_DATA_DIR")]
    cands += [p / REPO_NAME for p in [ROOT, *ROOT.parents][:4]]
    for c in cands:
        if c and (Path(c) / "val" / "series.csv").exists():
            return Path(c).resolve()
    sys.exit(f"Could not find {REPO_NAME}. Pass --data-dir or set STL_DATA_DIR.")


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _work(job):
    sid, path, valid, cache, supplement = job
    out = extract_series(path, set(valid), supplement)
    tmp = cache + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, cache)
    return sid, len(out["games"])


def run_extract(data: Path, series: list[dict], games_by_series: dict, jobs: int, force: bool):
    cache_dir = OUT / "cache" / f"v{EXTRACT_VERSION}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    todo = []
    for s in series:
        cache = cache_dir / f"{s['series_id']}.json"
        valid = [g["game_id"] for g in games_by_series.get(s["series_id"], [])]
        if not valid or (cache.exists() and not force):
            continue
        supplement = str(data / s["ability_supplement"]) if s.get("ability_supplement") else None
        todo.append((s["series_id"], str(data / s["file"]), valid, str(cache), supplement))
    if not todo:
        print("extract: cache is up to date")
        return cache_dir
    # Biggest files first so the pool stays evenly loaded.
    todo.sort(key=lambda j: -os.path.getsize(j[1]))
    print(f"extract: {len(todo)} series on {jobs} workers")
    t0, done, failed = time.time(), 0, []
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futs = {pool.submit(_work, j): j[0] for j in todo}
        for fut in as_completed(futs):
            done += 1
            try:
                fut.result()
            except Exception as ex:  # keep going, report at the end
                failed.append((futs[fut], repr(ex)))
            if done % 25 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)}  {time.time() - t0:.0f}s", flush=True)
    for sid, err in failed:
        print(f"  FAILED series {sid}: {err}")
    return cache_dir


def new_base():
    return {"pr": 0, "opr": 0, "opp": 0, "buy": 0, "tr": 0, "trOp": 0, "winOp": 0,
            "winNoOp": 0, "opKills": 0, "opDeaths": 0, "opFk": 0, "opFd": 0, "opSaved": 0}


def assemble(data: Path, series: list[dict], games_by_series: dict, cache_dir: Path):
    team_names = {t["team_id"]: t["name"] for t in read_csv(data / "meta" / "teams.csv")
                  if t["title"] == "val"}
    player_names = {p["player_id"]: p["name"] for p in read_csv(data / "meta" / "players.csv")
                    if p["title"] == "val"}
    teams: dict[str, dict] = {}
    base = defaultdict(lambda: {"a": new_base(), "d": new_base()})
    # League-wide roll-ups for the search box and the "who is using it" view.
    # (player, team, agent, map, side, event) -> [player-rounds, Op rounds,
    #   Op kills, could afford, bought, died holding it, opening Op kills]
    lg_rows = defaultdict(lambda: [0] * 7)
    # (team, map, side, event) -> [rounds, rounds with an Op, won with, won without]
    lg_team = defaultdict(lambda: [0] * 4)
    lg_names: dict[str, str] = {}
    lg_games = defaultdict(int)      # (team, event) -> maps played
    util = UtilBuilder(AFTER_S)
    n_games = n_rounds = n_ops = 0
    missing = []

    for s in series:
        sid = s["series_id"]
        cache = cache_dir / f"{sid}.json"
        if not cache.exists():
            if games_by_series.get(sid):
                missing.append(sid)
            continue
        meta_games = {g["game_id"]: g for g in games_by_series.get(sid, [])}
        with open(cache, encoding="utf-8") as f:
            ext = json.load(f)
        for g in ext["games"]:
            mg = meta_games.get(g["id"])
            if not mg or not g["rounds"]:
                continue
            n_games += 1
            n_rounds += len(g["rounds"])
            names = {pid: player_names.get(pid, p["name"]) for pid, p in g["players"].items()}
            agents = {pid: p["agent"] for pid, p in g["players"].items()}
            tids = list(g["teams"].keys())
            if len(tids) != 2:
                continue
            score = {mg["team1_id"]: int(mg["team1_score"] or 0),
                     mg["team2_id"]: int(mg["team2_score"] or 0)}
            util.add_game(s, mg, g, names, team_names)

            # League-wide baseline, both teams.
            for r in g["rounds"]:
                for tid in tids:
                    side = r["sides"].get(tid)
                    if side not in ("a", "d"):
                        continue
                    mine = [(pid, p) for pid, p in r["pl"].items()
                            if g["players"][pid]["team"] == tid]
                    has_op = any(p["op1"] for _, p in mine)
                    won = r["winner"] == tid
                    tr = lg_team[(tid, g["map"], side, s["event"])]
                    tr[0] += 1
                    tr[1] += has_op
                    tr[2 if has_op else 3] += won
                    for pid, p in mine:
                        lg_names[pid] = names[pid]
                        row = lg_rows[(pid, tid, agents[pid], g["map"], side, s["event"])]
                        row[0] += 1
                        row[1] += p["op1"]
                        if not p["op0"] and p["m0"] >= OP_COST:
                            row[3] += 1
                            row[4] += p["src"] == "bought"
                        if p["op1"]:
                            o = r["ops"].get(pid) or {}
                            row[2] += p["ok"]
                            row[5] += p["d"]
                            row[6] += any(k[7] and k[1] == "operator" for k in o.get("kills", []))
                    for key in ("all", g["map"]):
                        b = base[key][side]
                        b["tr"] += 1
                        b["trOp"] += has_op
                        b["winOp" if has_op else "winNoOp"] += r["winner"] == tid
                        for pid, p in mine:
                            b["pr"] += 1
                            b["opr"] += p["op1"]
                            if not p["op0"] and p["m0"] >= OP_COST:
                                b["opp"] += 1
                                b["buy"] += p["src"] == "bought"
                            if p["op1"]:
                                o = r["ops"].get(pid) or {}
                                b["opKills"] += p["ok"]
                                b["opDeaths"] += p["d"]
                                b["opSaved"] += p["ope"]
                                b["opFk"] += any(k[7] and k[1] == "operator"
                                                 for k in o.get("kills", []))
                                b["opFd"] += bool(o.get("death") and o["death"][7])

            for tid in tids:
                opp = tids[1] if tid == tids[0] else tids[0]
                lg_games[(tid, s["event"])] += 1
                T = teams.setdefault(tid, {
                    "team": {"id": tid, "name": team_names.get(tid, g["teams"][tid])},
                    "players": [], "_pidx": {}, "games": [], "ops": [],
                })

                def pidx(pid):
                    if pid not in T["_pidx"]:
                        T["_pidx"][pid] = len(T["players"])
                        T["players"].append({"id": pid, "name": names[pid]})
                    return T["_pidx"][pid]

                gi = len(T["games"])
                rounds = []
                for r in g["rounds"]:
                    side = r["sides"].get(tid, "")
                    rows = []
                    for pid, p in r["pl"].items():
                        if g["players"][pid]["team"] != tid:
                            continue
                        rows.append([pidx(pid), p["m0"], p["m1"], p["lv"], p["op0"], p["op1"],
                                     p["w"], p["k"], p["ok"], p["d"], p["ope"], p["src"]])
                    eop = sum(p["op1"] for pid, p in r["pl"].items()
                              if g["players"][pid]["team"] == opp)
                    rounds.append({"n": r["n"], "side": side, "won": int(r["winner"] == tid),
                                   "wt": r["wt"], "plant": r["plant"], "dur": r["dur"],
                                   "eop": eop, "p": rows})
                    for pid, o in r["ops"].items():
                        if g["players"][pid]["team"] != tid:
                            continue
                        n_ops += 1
                        d = o["death"]
                        T["ops"].append({
                            "g": gi, "r": r["n"], "p": pidx(pid), "src": o["src"],
                            "track": o["track"],
                            "hits": [h[:8] + [names.get(h[8], "?"), agents.get(h[8], "")]
                                     for h in o["hits"]],
                            "kills": [k[:6] + [names.get(k[6], "?"), k[7], agents.get(k[6], "")]
                                      for k in o["kills"]],
                            "death": (d[:5] + [names.get(d[5], "?"), d[6], d[7],
                                               agents.get(d[5], "")]) if d else None,
                            "abil": o["abil"], "ft": o["ft"],
                        })
                T["games"].append({
                    "id": g["id"], "sid": sid, "n": int(mg["game_number"] or 0),
                    "date": (mg["started_at"] or s["scheduled_start"])[:10],
                    "event": s["event"], "stage": s["stage"], "map": g["map"],
                    "opp": team_names.get(opp, g["teams"][opp]), "oppId": opp,
                    "score": [score.get(tid, 0), score.get(opp, 0)],
                    "won": int(mg["winner_team_id"] == tid),
                    "agents": {str(pidx(pid)): a for pid, a in agents.items()
                               if g["players"][pid]["team"] == tid},
                    "rounds": rounds,
                })

    tdir = OUT / "teams"
    tdir.mkdir(parents=True, exist_ok=True)
    for old in tdir.glob("*.json"):
        old.unlink()
    index_teams = []
    for tid, T in teams.items():
        T.pop("_pidx")
        order = sorted(range(len(T["games"])), key=lambda i: (T["games"][i]["date"], T["games"][i]["sid"], T["games"][i]["n"]))
        remap = {old: new for new, old in enumerate(order)}
        T["games"] = [T["games"][i] for i in order]
        for o in T["ops"]:
            o["g"] = remap[o["g"]]
        with open(tdir / f"{tid}.json", "w", encoding="utf-8") as f:
            json.dump(T, f, separators=(",", ":"))
        op_rounds = sum(1 for o in T["ops"])
        index_teams.append({
            "id": tid, "name": T["team"]["name"], "games": len(T["games"]),
            "opRounds": op_rounds,
            "opKills": sum(1 for o in T["ops"] for k in o["kills"] if k[1] == "operator"),
            "first": T["games"][0]["date"], "last": T["games"][-1]["date"],
            "events": sorted({g["event"].split(" - ")[0] for g in T["games"]}),
        })
    index_teams.sort(key=lambda t: t["name"].lower())
    index = {
        "generated": time.strftime("%Y-%m-%d %H:%M"), "version": EXTRACT_VERSION,
        "opCost": OP_COST, "games": n_games, "rounds": n_rounds, "opRounds": n_ops,
        "teams": index_teams, "baseline": base,
    }
    with open(OUT / "index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"))

    # league.json: dictionary-encoded so 30k+ rows stay around a megabyte.
    def table(values):
        vals = sorted(set(values))
        return vals, {v: i for i, v in enumerate(vals)}

    ev, ev_i = table(k[5] for k in lg_rows)
    mp, mp_i = table(k[3] for k in lg_rows)
    ag, ag_i = table(k[2] for k in lg_rows)
    tm, tm_i = table(k[1] for k in lg_rows)
    pl, pl_i = table(k[0] for k in lg_rows)
    league = {
        "events": ev, "maps": mp, "agents": ag, "teams": tm,
        "players": [{"id": pid, "name": lg_names[pid]} for pid in pl],
        "rows": [[pl_i[k[0]], tm_i[k[1]], ag_i[k[2]], mp_i[k[3]], int(k[4] == "d"), ev_i[k[5]], *v]
                 for k, v in lg_rows.items()],
        "trows": [[tm_i[k[0]], mp_i[k[1]], int(k[2] == "d"), ev_i[k[3]], *v]
                  for k, v in lg_team.items()],
        "tgames": [[tm_i[t], ev_i[e], n] for (t, e), n in lg_games.items()
                   if t in tm_i and e in ev_i],
    }
    with open(OUT / "league.json", "w", encoding="utf-8") as f:
        json.dump(league, f, separators=(",", ":"))

    size = sum(p.stat().st_size for p in tdir.glob("*.json")) / 1e6
    print(f"assemble: {len(teams)} teams, {n_games} games, {n_rounds} rounds, "
          f"{n_ops} Operator player-rounds, {size:.0f} MB of team files")
    print("utility: " + util.write(OUT / "util"))
    if missing:
        print(f"  {len(missing)} series had no cache (failed or skipped): {missing[:10]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", help=f"path to {REPO_NAME}")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--limit", type=int, help="only the first N series")
    ap.add_argument("--force", action="store_true", help="re-extract even if cached")
    args = ap.parse_args()

    data = find_data_dir(args.data_dir)
    print(f"data: {data}")
    series = read_csv(data / "val" / "series.csv")
    if args.limit:
        series = series[: args.limit]
    games_by_series = defaultdict(list)
    for g in read_csv(data / "meta" / "games.csv"):
        if g["title"] == "val":
            games_by_series[g["series_id"]].append(g)
    cache_dir = run_extract(data, series, games_by_series, args.jobs, args.force)
    assemble(data, series, games_by_series, cache_dir)


if __name__ == "__main__":
    main()
