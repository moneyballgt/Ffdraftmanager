# Draft Room

A free replacement for the FantasyPros Draft Assistant. Built for a **12-team, full-PPR,
snake** league on Sleeper with a **QB / RB / RB / WR / WR / TE / FLEX / FLEX / K / DEF** lineup.

No accounts, no server, no cost. One HTML file.

---

## Hosting it (recommended)

Serve the folder over http(s) — GitHub Pages, Netlify, Vercel, anything static. `index.html`,
`sw.js`, `manifest.webmanifest` and the two icons must sit together. Hosting is not cosmetic;
three things only work from a real origin:

- **Live Sleeper sync.** A browser can only call the Sleeper API from an http(s) page. This is
  the whole "never type a pick" feature, plus Sleeper's stock ranking, which is what the
  survival maths runs on.
- **Install to your home screen.** Opens full screen with no browser chrome, which is a
  materially bigger board on a phone.
- **Works offline.** A service worker precaches the app, so it opens and runs with no signal —
  draft halls have bad wifi. Live picks are deliberately never cached: they always hit the
  network and say so if they can't, rather than quietly showing you a stale board.

Also hosted-only: **Keep screen awake** in Setup, so the phone doesn't lock while you wait,
and a **sync freshness line** in the header — "live · updated 3s ago", turning amber and then
red as it ages, and saying plainly when you're offline and the board is frozen.

## Use it tonight

**Open `index.html` in your phone or laptop browser.** That's it. Everything runs locally
and the draft is saved as you go, so a refresh or a dead screen loses nothing.

### Turn on auto-sync (do this first)

You said you can't sit there typing every pick. You don't have to.

1. Go to **Setup**
2. Type your **Sleeper username** → tap **Find my draft**
3. Tap your league

From then on picks load themselves every 4 seconds straight from Sleeper. It also reads
your team count, round count, scoring, and **your draft slot** off the league automatically.
You never touch it again — just watch the **Pick** tab.

If username lookup misbehaves, paste the draft URL (`sleeper.com/draft/nfl/123456…`) into
the second box instead.

### If sync isn't working

Manual mode is two taps per pick: tap the player, then **Someone else took him** or
**I drafted him**. Search finds anyone in three letters. The advice engine works
identically either way.

---

## The four tabs

| Tab | What it's for |
|---|---|
| **Pick** | The one screen that matters. Big "take him" card, three alternates, and the list of players who won't survive until your next turn. |
| **Board** | Everyone left, ranked by value over replacement, split into tiers. Filter by position, or search. |
| **Roster** | Your starting lineup as it fills in, what you still need, and how thin each position is getting. |
| **Setup** | Sync, league settings, undo, reset. |

---

## How it decides

Not a static cheat sheet — it reacts to what has already happened.

- **Format first.** Best ball and redraft are genuinely different engines, not a cosmetic
  toggle. Set it in Setup; best ball is the default.
- **Value over replacement**, with baselines set per format. Best ball rosters more WRs and
  a real QB2, so its replacement levels sit deeper (QB14 / RB30 / WR48 / TE15) than
  redraft's (QB13 / RB31 / WR42 / TE13).
- **Spike-week value.** In best ball your auto-lineup banks a player's best weeks, so
  variance is an asset. Boom rate (share of weeks finishing top-12 at the position),
  ceiling and PPG are blended 45/25/30 and applied *within position*.
- **Roster need.** A player who cannot crack your lineup scores zero and is never suggested.
- **Pick timing.** It knows your slot, so it knows the gap to your next turn and how likely
  each player is to survive it.
- **Tier cliffs and positional runs**, flagged as they happen.
- **It will not strand you.** Urgency escalates as picks run down, and once the startable
  players at a spot you still need are nearly gone it stops saying wait. K and DEF are
  suppressed until the last two rounds, then forced.

### Will he come back to you?

The most valuable question in a snake draft is not who is best, it is who will still be
there next time. So a pick is scored as **value now minus what he was still worth to you
later**.

Taking a player also removes him from the pool you draw on at your next turn. His marginal
contribution to that pool is exactly what you forfeit by spending this pick on him. Someone
the room takes before you pick again contributes almost nothing to that pool, so he costs
nothing to take — you get his full value. Someone who would have slid back to you is largely
a wasted pick, because you could have had him anyway.

That means a player one spot lower on your board can and should outrank one above him, if
the room is going to take him first. The **You can wait on** panel names the best player the
maths expects to survive, with the odds and the pick number.

**It runs off Sleeper's stock ranking, not expert consensus**, because that is the board
your league is actually drafting from. Where the two disagree the row shows both — `ADP 8 ·
SL 21` — and that gap is where the value is. Sleeper's rankings arrive with the live player
sync; without it, survival falls back to consensus and gets coarser.

### The best-ball layer, and where to distrust it

Boom rates come from nflverse weekly stats for 2024-25, blended 70/30 toward 2025, and
weighted with ceiling and PPG at 45/25/30.

**The experts already price most of this in.** Measured on this board, consensus rank
explains 48% of the boom composite at QB, 57% at TE, 66% at WR and 71% at RB. Adding the raw
score on top of consensus would count most of it twice and systematically overrate the
players the rankers had already promoted for exactly that reason. So the composite is
regressed on consensus rank within each position and **only the residual is used** — what
the spike-week record knows that the rankers did not.

The adjustment then moves a player in **rank space**, reordering him within his position and
reassigning that position's points curve. Scaling his projection instead would be worth ±35%
of 300 to an elite back and ±35% of 100 to a bench one, which inflates the top of every
position and destroys the cross-position comparability that value over replacement needs.

Limits worth keeping in mind:

- **Boom rate is backward-looking.** It says nothing about a player whose situation changed.
  Treat a big riser skeptically.
- **2026 rookies have no history.** 22 of the top 250 have blank boom columns. They score
  **neutral, never penalized**, and ride on consensus alone.
- **Never normalize boom across positions.** A weekly top-12 finish is a far easier bar at QB
  (32 starters) than at WR; a cross-position score ranks backup quarterbacks above real
  players. Everything here is computed within position.
- Short 2025 samples are regressed toward neutral (min 8 games).
- **No boom data for K or DEF** — nflverse weekly stats carry neither.

**Boom influence** is a slider in Setup, default 35%, applied to the residual. Set it to 0
for pure consensus.

Injuries: 47 players expected to miss 1+ week are flagged and drop 7 spots within position.
Only 3 are inside the top 250 — serious injuries are already priced into consensus, so this
matters more as a waiver filter than a draft filter.

Simulated across all 12 draft slots in both formats against roster-aware opponents: every
slot finishes with a legal, complete 16-man roster and no empty starting spots. Best ball
lands 2 QBs every time at a 35-44% average boom rate; redraft takes one at 27-34%.

## The rankings

**The board ships seeded with FantasyPros consensus PPR top-250 (2026).** Nothing to paste,
nothing to configure — open it and the board is already right. That list supplies every
player's NFL team, consensus rank and bye week; consensus rank is used directly as ADP, so
the pick-timing and survival math run on the real market rather than an estimate.

Projected points come from a positional curve assigned in consensus order: their ranking
decides who sits where, a realistic full-PPR points curve supplies the scale that value over
replacement, replacement level and tier breaks depend on. When Sleeper sync is on, live NFL
teams and injury tags override the static ones, so a late trade or a Saturday injury tag
still shows up.

### Replacing or updating the rankings

**Setup → Seed with consensus rankings** takes a pasted list and rebuilds the board the same
way. Use it if you want a different source, or a fresher pull on draft morning.

Almost any format parses — tab-separated table copy, `1. Ja'Marr Chase (CIN - WR)`,
`1 Chase CIN WR`, or CSV. Bye and tier columns are ignored, and `Ravens D/ST` resolves to
the Baltimore defense. Players not already on the board get added with their team, position
and a projection slotted into the curve at their consensus rank, so a list containing
rookies the app has never seen still works. Paste 150+ names for a full board; with a
shorter list it says so and leaves everyone you omitted on the built-in ranking.

## Files

| File | |
|---|---|
| `index.html` | **The app.** Standalone, open it directly. |
| `src/app.html` | Source (markup + styles + logic + player data). |
| `artifact.html` | Same app, wrapped for hosting as a Claude Artifact. |
| `build.sh` | Regenerates the two outputs from `src/`. |

Edit projections in the `RAW` block near the top of the script in `src/app.html`
(`Name|TEAM|POS|points`), then run `./build.sh`.
