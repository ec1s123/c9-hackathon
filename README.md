# Operator Tracker

Scouting tool for how a VALORANT team uses the Operator: who buys it and when,
where they play it from, when their shots land, and where they go after a kill.
Built on the Sky's The Limit 2026 hackathon GRID data.

## Run it

Needs Python 3.14+ (zstd is in the standard library) and nothing else.

```bash
python3 etl/build.py        # ~2 min: reads all 857 series, writes data/
python3 etl/fetch_maps.py   # once: minimap images + callout names
python3 etl/fetch_assets.py # once: team logos, agent, ability and weapon icons
python3 serve.py            # opens http://localhost:8000/web/
```

The data repo is expected next to this one (`../stl-hackathon-2026-grid-starter`,
or one level further up). Otherwise pass `--data-dir` or set `STL_DATA_DIR`.

`data/` is git-ignored and must stay that way: it is derived from licensed data.
The server binds to localhost only for the same reason.

## Finding what you are after

The page opens on the league view: who is using the Operator across all 160
teams, on which agents, on which maps, and which teams have one out most. Filter
it by competition, map, side and agent, re-sort the player table by clicking a
column, and click any player, agent, map or team to drill in.

The search box (press `/`) finds a team, a player, an agent or a map. Picking a
player opens their team already filtered to them; picking an agent or map
filters the league view.

On a team page the header always says what you are looking at: the team's logo,
a roster strip (click a player to filter to them), and a "Showing ..." line with
one removable chip per active filter.

## What each team tab answers

| Tab | Question |
|---|---|
| Overview | How often do they have an Op out, who takes it, on which agent and map, and does it win rounds? Each headline number sits next to the league average. |
| Positions | Heatmap of where the Op holder spends time, where they set up at barrier drop, where Op kills come from and where they die. Filter by round-time window. |
| Timing | When the first Op shot lands, when all Op shots land, when the holder dies, shots per round, and which round numbers they Op on. |
| Rotations | First kill to second kill: time gap, distance moved, area to area, the path on the map. Also where they are 5s and 10s after a kill, and which ability they use right after a shot. |
| Economy | Buy rate when they have $4,700+, by money, side, score, previous round and whether they just lost one. What they buy instead. Bought vs carried over vs given by a teammate. |
| Rounds | Every Operator round, with a replay of the path and a timeline. |

Filters (player, map, side, agent, event, opponent, how the Op was acquired)
apply to every tab. The address bar always reflects the current view, so any
page can be bookmarked or shared and back/forward work:
`/web/?team=79&tab=map&map=haven&side=d`, `/web/?agent=chamber&side=d`.

## How the numbers are derived

The feed has no purchase events and no weapon-pickup events, so:

- **Op rounds**: the player has an Operator in their inventory when the buy
  phase ends.
- **Bought / carried over / given**: no Op at round start and spent $4,700+ in
  the buy phase is *bought*; an Op already there at round start is *carried
  over*; ending the buy phase with one having spent less is *given by a
  teammate* (bought for them, or a saved one handed over).
- **Picked up mid-round**: dealt Operator damage in a round they did not start
  with one. Pickups that never hit anything are invisible.
- **Could afford**: $4,700+ at round start (after the round reward) and no Op
  carried over.
- **Positions**: every in-round event carries all ten players' positions, so a
  player is sampled whenever anyone uses an ability, deals damage or gets a
  kill. Roughly one sample every 1 to 3 seconds, uneven. Paths between samples
  are straight lines and can cut through walls.
- **Shots**: only shots that hit are recorded. There is no way to see a missed
  shot or a peek that found nobody, so "when they peek" is approximated by when
  their shots land and when they take damage.
- **Areas**: nearest callout label to the position. Approximate near borders.
- Kills after the round is already decided are left out.

Checked against the feeds' own final box scores on 40 random series: round
counts match exactly, Operator kills 368 of 369.

## Layout

```
etl/extract.py     one series feed -> per-round records
etl/build.py       runs extract over every series in parallel, writes data/
etl/fetch_maps.py  minimaps and callouts from valorant-api.com
etl/fetch_assets.py  agent, ability and weapon icons from valorant-api.com,
                   team logos from vlr.gg (exact name matches only)
web/               no-build front end (ES modules, canvas, SVG)
  app.js           team tabs, header, filters, routing
  league.js        league view (reads data/league.json)
  search.js        search box behaviour
  icons.js         logos and icons, with monogram fallbacks
serve.py           local static server
```

The icons are third-party artwork (Riot Games, the teams). They are downloaded
into the git-ignored `data/img/` for local display and are not part of this
repo. About 120 of the 160 teams have a logo on vlr.gg under the same name; the
rest get a monogram. To fix one by hand, add its vlr.gg name to `TEAM_ALIAS` in
`etl/fetch_assets.py` or drop a PNG at `data/img/teams/<team id>.png`, then run
the script again.

Not used yet: the ability supplement (precise cast position and aim direction),
which could add facing direction at the moment an escape ability is used.
