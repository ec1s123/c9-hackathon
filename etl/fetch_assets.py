#!/usr/bin/env python3
"""Download the icons the web app uses: agents, abilities, weapons, team logos.

    python3 etl/fetch_assets.py              # everything that is missing
    python3 etl/fetch_assets.py --no-teams   # skip the team-logo lookup
    python3 etl/fetch_assets.py --refresh    # download again even if present

Sources, both public and keyless:

* valorant-api.com - agent portraits, ability icons, role icons and the
  kill-feed weapon silhouettes (the Operator icon among them).
* vlr.gg team search - team logos. Only the public team name is sent, one
  request per team, and a logo is kept only when the result's name matches
  exactly. Teams without a match get a generated monogram in the app.

Everything lands in ``data/img/`` plus ``data/assets.json``, all git-ignored.
The images are third-party trademarks (Riot Games, the teams): fine to show in
a local tool, not ours to commit or redistribute. The app works without them.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data"
IMG = OUT / "img"
API = "https://valorant-api.com/v1"
VLR = "https://www.vlr.gg/search/?type=teams&q="
UA = {"User-Agent": "hackathon-asset-fetch/1.0"}

# Feed ability ids that differ from the slug of the in-game display name.
ABILITY_ALIAS = {"light-speed": "lightspeed", "nebula-dissipate": "nebula", "stars": "astral-form"}
# GRID team name -> the name the team is listed under on vlr.gg.
TEAM_ALIAS = {
    "Made In Brazil": "MIBR",
    "VISA KRÜ Blaze": "KRÜ BLAZE",
    "Team Liquid Visa": "Team Liquid Brazil",
    "FENNEL HOTELAVA": "FENNEL GC",
    "ZennIT Orange": "ZennIT Orange GC",
}


def get(url: str, tries: int = 3) -> bytes:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise AssertionError("unreachable")


def save(url: str, path: Path, refresh: bool) -> bool:
    if path.exists() and not refresh:
        return True
    try:
        data = get(url)
    except Exception as ex:
        print(f"  could not fetch {url}: {ex}")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return True


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9']+", "-", name.lower()).strip("-")


def fname(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", key.lower())


def game_assets(refresh: bool) -> dict:
    agents, roles, abilities, weapons = {}, {}, {}, {}
    for a in json.loads(get(f"{API}/agents?isPlayableCharacter=true"))["data"]:
        key = a["displayName"].lower()                      # matches the feed's character id
        role = (a.get("role") or {}).get("displayName", "")
        rel = f"img/agents/{fname(key)}.png"
        # The 64px minimap portrait: the full display icon is 1024px and ~400 KB each.
        src = a.get("minimapPortrait") or a.get("displayIcon")
        if src and save(src, OUT / rel, refresh):
            agents[key] = {"name": a["displayName"], "role": role, "img": rel}
        if role and role not in roles and (a["role"] or {}).get("displayIcon"):
            rrel = f"img/roles/{fname(role)}.png"
            if save(a["role"]["displayIcon"], OUT / rrel, refresh):
                roles[role] = rrel
        for ab in a.get("abilities") or []:
            if not ab.get("displayIcon"):
                continue
            s = slug(ab["displayName"])
            arel = f"img/abilities/{fname(key)}-{fname(s)}.png"
            if save(ab["displayIcon"], OUT / arel, refresh):
                abilities[s] = {"name": ab["displayName"], "agent": key, "img": arel}
    for feed_id, s in ABILITY_ALIAS.items():
        if s in abilities:
            abilities[feed_id] = abilities[s]
    for w in json.loads(get(f"{API}/weapons"))["data"]:
        key = w["displayName"].lower()
        rel = f"img/weapons/{fname(key)}.png"
        if w.get("killStreamIcon") and save(w["killStreamIcon"], OUT / rel, refresh):
            weapons[key] = rel
    print(f"  {len(agents)} agents, {len(abilities)} abilities, {len(weapons)} weapons")
    return {"agents": agents, "roles": roles, "abilities": abilities, "weapons": weapons}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).casefold()
    return re.sub(r"[^a-z0-9]+", "", s)


ITEM = re.compile(r'<a href="/search/r/team/(\d+)/[^"]*"[^>]*>(.*?)</a>', re.S)
THUMB = re.compile(r'<img src="([^"]+)"')
TITLE = re.compile(r'search-item-title">\s*(.*?)\s*(?:<span|</div>)', re.S)


def vlr_logo(name: str) -> str | None:
    """Logo URL for the team listed under exactly this name, else None."""
    want = norm(name)
    if not want:
        return None
    page = get(VLR + urllib.parse.quote(name)).decode("utf-8", "replace")
    hits = []
    for m in ITEM.finditer(page):
        body = m.group(2)
        t, i = TITLE.search(body), THUMB.search(body)
        if not t or not i or norm(html.unescape(t.group(1))) != want:
            continue
        src = i.group(1)
        if "/img/vlr/" in src:        # the site's placeholder, not a real logo
            continue
        hits.append((("inactive" in body), "https:" + src if src.startswith("//") else src))
    hits.sort()                      # active teams first, otherwise search order
    return hits[0][1] if hits else None


def team_logos(refresh: bool, lookup: bool = True) -> dict:
    index = OUT / "index.json"
    if not index.exists():
        print("  no data/index.json yet: run etl/build.py first, then this again for team logos")
        return {}
    teams = json.loads(index.read_text(encoding="utf-8"))["teams"]
    out, looked = {}, 0
    for t in teams:
        rel = f"img/teams/{t['id']}.png"
        if (OUT / rel).exists() and not refresh:
            out[t["id"]] = rel
            continue
        if not lookup:
            continue
        base = re.sub(r"\s*\(\d+\)\s*$", "", t["name"]).strip()   # GRID's "(2)" duplicates
        names = [TEAM_ALIAS.get(base, base)]
        short = re.sub(r"\s+e-?sports$", "", names[0], flags=re.I)
        if short != names[0]:
            names.append(short)
        url = None
        for n in names:
            try:
                url = vlr_logo(n)
            except Exception as ex:
                print(f"  {t['name']}: lookup failed ({ex})")
            looked += 1
            time.sleep(0.35)             # be a polite guest
            if url:
                break
        if url and save(url, OUT / rel, True):
            out[t["id"]] = rel
        if looked and looked % 40 == 0:
            print(f"  {looked} lookups, {len(out)} logos so far", flush=True)
    missing = [t["name"] for t in teams if t["id"] not in out]
    print(f"  {len(out)} of {len(teams)} team logos")
    if missing:
        print("  no logo (monogram instead): " + ", ".join(missing))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-teams", action="store_true", help="skip the team-logo lookup")
    ap.add_argument("--refresh", action="store_true", help="download again even if the file exists")
    args = ap.parse_args()
    IMG.mkdir(parents=True, exist_ok=True)
    try:
        assets = game_assets(args.refresh)
    except Exception as ex:
        sys.exit(f"Could not reach {API}: {ex}")
    # Logos already on disk are always listed; --no-teams only skips new lookups.
    assets["teams"] = team_logos(args.refresh and not args.no_teams, lookup=not args.no_teams)
    (OUT / "assets.json").write_text(json.dumps(assets, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT / 'assets.json'}")


if __name__ == "__main__":
    main()
