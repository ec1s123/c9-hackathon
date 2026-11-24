# Operator Tracker

Scouting tool for how a VALORANT team uses the Operator: who buys it and when,
where they play it from, when their shots land, and where they go after a kill.
It also maps every team's utility: where each ability gets used on each map and
side, when in the round, what is stacked together, where the player goes
next, and what it did: damage, kills, assists and how the round went. Built on the Sky's The Limit 2026 hackathon GRID data.

## Run it

Needs Python 3.14+ (zstd is in the standard library) and nothing else.

```bash
python3 etl/build.py        # ~2 min: reads all 857 series and their ability supplements, writes data/
python3 etl/fetch_maps.py   # once: minimap images + callout names
python3 etl/fetch_assets.py # once: team logos, agent, ability and weapon icons
python3 serve.py            # opens http://localhost:8000/web/
```

The data repo is expected next to this one (`../stl-hackathon-2026-grid-starter`,
or one level further up). Otherwise pass `--data-dir` or set `STL_DATA_DIR`.

`data/` is git-ignored and must stay that way: it is derived from licensed data.
The server binds to localhost only for the same reason.

## How you move through it

1. **Pick who you are playing.** The first screen is a team picker: big team
   cards grouped by competition, each showing how often that team has an
   Operator out and who takes it most. Narrow it with the competition and event
   chips, or just type a team or player name and press Enter.
2. **See who has the Operator.** The team page opens on one card per player who
   has held it, with their share of the team's Operator rounds, kills a round,
   how often they buy it when they can afford it, and the agents and maps they
   use it on. Below that are the team's headline numbers and its common spots.
3. **Drill into a player.** Click a player (card, or the roster strip in the
   header) for their profile: which agents, which maps and sides, where they set
   up, where the kills come from, where shots hit without a kill and where they
   die holding it. Clicking a spot opens it on the Positions map; the "Dig into"
   buttons lead to the other tabs. Back steps out one level at a time.

The team header has two labelled rows that apply to every tab: **Who** (the
whole team or one player) and **Where** (all maps or one map, as tiles with the
minimap). The counts on each chip follow the other choice, so picking Haven
shows each player's Haven numbers. Every tab then opens with a headline such as
"OXY on Haven" and how many Operator rounds are behind it; with the whole team
selected it lists each contributing player so you can isolate one. Positions
always draws a single map: if none is picked it shows the one with the most
Operator rounds and marks that tile "shown below". The search box on team pages (press `/`) jumps to another team,
player, agent or map. "League stats" in the top bar is the all-teams view:
which agents carry the Operator, on which maps, and a sortable player table.

## Utility

"Utility" in the top bar (or the Utility tab on a team page, which opens it for
that team) is one map and one side at a time:
`/web/?view=util&map=haven&side=d&team=79&role=Sentinel`.

It opens on **pre-round**: everything used before the barriers drop, drawn
where the player was standing when they used it. That position (and the aim,
and the time) is exact for every ability.

- **Where**: a heatmap of where utility is used from, a dot for each use with
  a line showing the aim, and the common spots numbered as in the table. Dots
  turn on by themselves once the selection is under 800 uses. "Where it lands,
  if known" switches to landing spots for the abilities that have one (below)
  and leaves the rest where the player stood.
- **When**: pre-round, the first 3 seconds after the barriers drop, 3 to 30 s,
  30 s+, after the plant, or the whole round.
- **Where they start**: where each player (one team) or agent (all teams) is
  standing the moment the barriers drop, as their most common areas with
  shares. "Players: As the barriers drop" above the map draws it as an orange
  heat, with the agent's face on each usual spot when there are few enough to
  read.
- **What**: by agent role, type (traps, smokes, mollies, flashes, recon, stuns),
  agent, or one ability. The "Show" chips are shortcuts, e.g. Sentinel setups =
  sentinels, before the barriers.
- **Habits**: the cards above the map. The same ability from the same spot
  round after round (thrown abilities need the same crosshair too), ranked by
  the share of rounds that agent was played: "Recon Bolt from A Garden, 42 of
  204 rounds". With a team picked they name the player. Click one to isolate it.
- **Rounds to check in the VOD**: under the map whenever something is isolated:
  date, opponent, round and seconds since the barriers dropped for every use.
- **Common spots**: places one ability keeps going, with the share of rounds
  that agent was played and where the player is 5 s later. Click a row to
  isolate it: the map then draws a line from each use to that later position.
- **Repeated lineups**: the same ability from the same spot (within 1.5 m)
  with the same crosshair (within 5°) in three rounds or more. Position and aim
  are exact for every ability, smokes included, so this works even where the
  landing spot is unknown.
- **Used together**: pairs of abilities within 5 m and 10 s of each other, same
  team, same round.
- **Players: 5 s after use**: where the player is five seconds after using the
  ability, as the same orange layer.
- **What pays off**: under the map, one row per ability in the selection: how
  many uses led to a kill, the kills and assists behind that, how often it hurt
  someone and for how much, how often the player got a kill of their own right
  after, and how the rounds it was used in went next to the side's usual win
  rate. Click a row to narrow to that ability. The same "Led to a kill" share
  is a column on common spots, repeated lineups, used together and the player
  and team tables, so any of them can be read as "which of this do we have to
  respect".
- **Drilling into one spot**: isolating a spot, lineup or pair adds a summary
  of what it did and two columns to the VOD list (what each use did, and
  whether the round was won). "What worked first" puts the uses tied to a kill
  at the top. On the map those uses are yellow, and "Only what led to a kill"
  hides everything else, heat included.

What the data can and cannot say about where an ability ends up:

| Ability kind | Examples | What is shown |
|---|---|---|
| Placed at the player's feet or just ahead | turret, alarmbot, trapwire, trademark, shear, Sage wall | The spot, good to a few metres |
| Deals damage and hit someone | any molly, shock bolt, Brimstone and Tejo ultimates | Where the enemies it hurt were standing: about 3 m |
| Thrown, hit nobody, but identical to throws that did | snake bite, paint shells, incendiary, nanoswarm, shock bolt | The landing of those identical throws: about 3 to 5 m |
| Thrown, deals damage, nothing to confirm it | the rest of the mollies | A distance read off the throw angle: 5 to 10 m, "roughly here" |
| Sova's bow, flat shot (crosshair under 15° up) | recon bolt, shock bolt | The first mapped wall on the line of aim: about 8 m, ignores bounces |
| Thrown or fired, deals no damage | cyber cage, poison cloud, flashes, lobbed recon bolts, Omen smokes | Where the player stood and which way they aimed |
| Travels out from the player | toxic screen, fault line, drones, Fade prowler | Where the player stood and which way they aimed |
| Placed through the map | Brimstone and Clove smokes, Astra stars, Tejo salvo | Where the player stood, nothing more |

No feed records a landing spot (checked: every event type and every field in
76 series, two per tournament; the only positions anywhere are the players').
The one trace an ability leaves is damage, and the build uses it three ways:

1. **Observed.** If it hurt someone, it landed where they stood. 21,165 casts.
2. **Matched.** Two throws from the same spot (1.5 m) with the same aim (4°)
   land in the same place, so a throw that hit nobody takes the landing of two
   or more observed throws it is identical to, provided those agree with each
   other. 17,012 casts. Tested by hiding each observed throw in turn and
   predicting it from the others: median 3 to 5 m from where the enemy stood,
   which is about the scatter of enemies inside the area itself.
3. **Fitted.** Otherwise the distance from thrower to victim, along the aim, is
   tabulated against the aim's pitch (`fit` in `data/util/index.json`) and read
   off that table: median 5 to 9 m by the same test. No walls are modelled.

What the data can say about what an ability did (`etl/extract.py`):

- **Damage** is recorded: every hit names the ability. It goes to that
  player's latest use of it.
- **Kills**: a kill names a weapon only when it is a gun, so an ability kill is
  a kill whose last hit (within 0.2 s) was the ability.
- **Assists through damage**: each kill lists who assisted. If the assister had
  damaged the victim with an ability that round, each such use gets the assist.
- **Assists without damage**: an assister who never damaged the victim earned
  it some other way, and the feed does not say how (there is no flashed or
  stunned state anywhere in it). Each ability they used in the 10 s before the
  kill is marked, and the mark counts only for flashes, stuns and slows, and
  recon (`SETS_UP` in `web/utilmeta.js`). This is the likeliest cause, not a
  recorded one: two such abilities in the window both get it. Smokes are left
  out because they cannot earn one (smokes of agents with no flash or stun
  show almost none), traps because one can trigger long after it was placed.
- **Led to a kill** = a kill or either kind of assist. Flashes a player uses
  for themselves earn no assist, so they show up only under "own kill within
  5 s", which is a coincidence in time and is kept out of the headline.
- **Rounds won** counts each round once, however many times the spot was used
  in it. It says what happened in those rounds, not that the utility caused it:
  post-plant utility only exists in rounds where the spike went down.

**The bow.** How hard it was drawn and how many bounces were set are not
recorded, and no arrow speed fits the shock bolts that hit someone, so a
"full draw lands here" calculation is not possible from this data. What does
hold up is that a flat shot sticks in the first wall on its line (the minimap
image is the wall data): on 2,431 flat shock bolts that hit someone that is a
median 7.9 m from the victim, 80% within 14 m, where the archer was 22 m away.
Recon and shock bolts aimed less than 15° above level are shown that way (73%
of recon bolts). Lobbed ones get no landing: nothing tested came closer than
16 m. Isolating a bow lineup draws the exact line it leaves on, and a dashed
circle as wide as that error at the wall.

How much of each ability ends up with a known (observed or matched) landing:
snake bite and paint shells about half, incendiary 37%, shock bolt, hot hands
and frag/ment about a quarter, nanoswarm 12%, razorvine 8% (those two mostly
never touch anyone). The note under the map gives the split for whatever is
selected, and each dot's tooltip says which kind it is. "Where it is used from"
switches the whole map to exact player positions. The table of abilities is
`web/utilmeta.js`.

Left out as not utility: Neon's sprint, Chamber's weapons and Iso's Double Tap.
Movement and self-buffs are kept but hidden unless you pick "Movement & self" or
that ability.

## What each team tab answers

| Tab | Question |
|---|---|
| Overview | How often do they have an Op out, who takes it, on which agent and map, and does it win rounds? Each headline number sits next to the league average. |
| Positions | Heatmap of where the Op holder spends time, where they set up at barrier drop, where Op kills come from and where they die. Filter by round-time window. |
| Timing | When the first Op shot lands, when all Op shots land, when the holder dies, shots per round, and which round numbers they Op on. |
| Rotations | First kill to second kill: time gap, distance moved, area to area, the path on the map. Also where they are 5s and 10s after a kill, and which ability they use right after a shot. |
| Economy | Buy rate when they have $4,700+, by money, side, score, previous round and whether they just lost one. What they buy instead. Bought vs carried over vs given by a teammate. |
| Rounds | Every Operator round, with a replay of the path and a timeline. |

Who and Where, plus the filter bar (side, agent, event, opponent, how the Op
was acquired), apply to every tab. The address bar always reflects the current view, so any
page can be bookmarked or shared and back/forward work:
`/web/?team=79&tab=map&map=haven&side=d`, `/web/?comp=c:VCT Americas`,
`/web/?view=league&agent=chamber&side=d`.

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
- **Hits without the kill**: Operator shots that dealt damage but did not
  kill. This is the nearest thing to a "missed kill" the data has.
- **Shots**: only shots that hit are recorded. There is no way to see a missed
  shot or a peek that found nobody, so "when they peek" is approximated by when
  their shots land and when they take damage.
- **Ability position and aim**: from the ability supplement (the player's
  position and view at the moment of the cast, interpolated from 5 Hz movement
  samples; 1 Hz for VCT Americas 2025, so those are looser). The 0.5% of casts
  it has no usable sample for fall back to GRID's own 2D position, with no aim.
  The supplement's extra records that GRID does not report all sit in the
  second between two rounds (charges refilling) and are ignored.
- **Restarted rounds**: the feed takes a restarted round's casts back and
  re-applies them with stale times; those are not counted.
- **Round time for utility**: seconds from the barriers dropping; anything in
  the buy phase is negative and shown as "before barriers". Casts after the
  round is decided are left out.
- **Starting positions**: every player's position in the feed's own snapshot at
  the event that ends the buy phase. GRID positions are 2D and can lag by a few
  metres.
- **5 s later**: the caster's position five seconds after the cast (for
  buy-phase casts, five seconds into the round), from the same irregular
  position samples as the Operator tracks. Blank if they died first.
- **Areas**: nearest callout label to the position. Approximate near borders.
- Kills after the round is already decided are left out, and so earn no
  ability a kill or an assist.

Checked against the feeds' own final box scores on 40 random series: round
counts match exactly, Operator kills 368 of 369.

## Layout

```
etl/extract.py     one series feed (+ its ability supplement) -> per-round records
etl/build.py       runs extract over every series in parallel, writes data/
etl/utility.py     every ability cast -> data/util/<map>.json, with what each
                   cast did and who won each round, plus the throw-distance
                   tables fitted from damage events
etl/fetch_maps.py  minimaps and callouts from valorant-api.com
etl/fetch_assets.py  agent, ability and weapon icons from valorant-api.com,
                   team logos from vlr.gg (exact name matches only)
web/               no-build front end (ES modules, canvas, SVG)
  app.js           team tabs, header, filters, routing
  home.js          team picker (first screen)
  league.js        league stats view and the roll-ups behind the picker
                   (both read data/league.json)
  utility.js       utility map: filters, heat, common spots, used together,
                   what pays off
  utilmeta.js      what each ability is, how its landing spot is known and
                   whether it can earn an assist without damage
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
