#!/usr/bin/env python3
"""Download minimap images, coordinate transforms and callout names.

    python3 etl/fetch_maps.py

Source is the public community API valorant-api.com (no key, nothing about
this project is sent). Output goes to ``data/maps/`` (git-ignored). The web
app still works without it: maps are then drawn from the position data alone,
with no background image and no callout names.

Game position -> minimap fraction (0..1), per the API's convention:
    u = y * xMultiplier + xScalarToAdd
    v = x * yMultiplier + yScalarToAdd
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "maps"
API = "https://valorant-api.com/v1/maps"
UA = {"User-Agent": "hackathon-map-fetch/1.0"}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        maps = json.loads(get(API))["data"]
    except Exception as ex:
        sys.exit(f"Could not reach {API}: {ex}")
    out = {}
    for m in maps:
        if not m.get("xMultiplier") or not m.get("displayIcon"):
            continue  # ranges, skirmish maps etc.
        key = m["displayName"].lower()
        img = OUT / f"{key}.png"
        if not img.exists():
            img.write_bytes(get(m["displayIcon"]))
        out[key] = {
            "name": m["displayName"], "img": f"maps/{key}.png",
            "xm": m["xMultiplier"], "ym": m["yMultiplier"],
            "xa": m["xScalarToAdd"], "ya": m["yScalarToAdd"],
            "callouts": [
                {"name": f"{c['superRegionName']} {c['regionName']}".strip(),
                 "x": round(c["location"]["x"]), "y": round(c["location"]["y"])}
                for c in (m.get("callouts") or [])
            ],
        }
        print(f"  {key}: {len(out[key]['callouts'])} callouts")
    (OUT.parent / "maps.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(out)} maps to {OUT.parent / 'maps.json'}")


if __name__ == "__main__":
    main()
