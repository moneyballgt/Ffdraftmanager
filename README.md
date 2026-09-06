# Draft Room

A draft assistant for one specific league: **9 teams · 1.0 PPR · guillotine**, starting
**QB / RB / RB / WR / WR / TE / FLEX** with **7 bench**, **no kicker, no defense**, 14 rounds,
drafted on **Yahoo**.

Guillotine means the lowest-scoring team every week is eliminated and its entire roster goes
into FAAB. That changes what a good pick is, so the app drafts for **floor, not ceiling** —
it is not a general-purpose cheat sheet with a mode switch bolted on.

The board itself is one HTML file. Yahoo sync needs a small Node server that runs on your own
PC, because Yahoo's API sends no CORS headers and its token exchange needs a client secret —
a page served from anywhere can never call it directly. That server also serves the app, so
both live at `http://localhost:8000` and there is nothing to deploy.

**Test it tonight with the mock draft** (next section but one). The live Yahoo path cannot be
verified until your draft actually opens; mock mode is the only rehearsal available.

---

## Draft-day quickstart

If you have never run this before, do the one-time Yahoo registration first —
[`server/README.md`](server/README.md), *Step 2* (register a free Yahoo app, 3 minutes) and
*Step 3* (paste the two keys into `server/.env`). You need Node 18 or newer; `node --version`
tells you. Everything below assumes that is already done.

**1. Start the server.** Open a terminal in this folder:

```
cd server
node server.js
```

Windows: double-click **`server/start.bat`** instead.

**Leave that terminal window open for the whole draft.** Closing it stops the server and the
board stops updating.

**2. Sign in.** Your browser opens Yahoo's consent screen by itself; click **Agree**. If it
doesn't open, go to <http://localhost:8000/auth>. You will land on a "Connected to Yahoo"
page. After the first time your login is remembered and this step is silent.

**3. Open the app** at <http://localhost:8000>.

**4. Setup → Yahoo auto-sync → Find my draft**, then tap your league. That reads team count,
rounds, scoring and — once Yahoo publishes it — your draft slot. The card should end up
reading `Live from Yahoo · 9 teams · 14 rounds`.

Yahoo does not publish the draft order until the draft starts, so it will probably say
**"Yahoo has not published the draft order yet"**. Type your slot into **Your slot** in the
League card if you know it; if you don't, leave it — the app keeps asking every 20 seconds
and adopts the real one the moment round 1 begins. Every timing number in the app depends on
that slot, so it is the one field worth getting right.

Behind the scenes it also starts building Yahoo's player list — about 25 round trips, 15-30
seconds, cached to `server/data/` afterwards. Picks flow immediately and do not wait for it.
Until it lands, market ranks come from the built-in consensus board.

**5. Check the League card** reads: Teams 9 · lineup QB 1, RB 2, WR 2, TE 1, FLEX 1, K 0,
DEF 0 · Bench 7 · Rounds 14 · Format **Guillotine**. That is what it ships with, so this is a
glance, not a task — but connecting to a league can overwrite teams and rounds, so look.

**6. Setup → Keep screen awake**, so the machine does not lock while you wait.

**7. Watch the Pick tab.** The header line should read **`live · updated Ns ago`** in green.
That is the one thing worth glancing at during the draft: it means the board is genuinely
current, not that polling is merely scheduled. Amber past 12 seconds, red past 25.

Picks load themselves; you never type one. When your turn comes the banner turns green and
the recommendation carries a full-width **Draft him** button.

### If sync drops mid-draft

Enter picks by hand: **Board** tab → tap the player → **I drafted him** or **Someone else
took him**. Two taps. Hand-entered picks are re-applied on top of every sync, so they survive
the connection coming back and are not wiped four seconds later.

Undo and full reset are at the bottom of Setup.

### Using your phone as the board

The server binds to your PC only, because it holds your Yahoo client secret and a live access
token. To let your phone reach it, start with `--lan` and use the address it prints:

```
node server.js --lan
```

That opens it to everything on that network with no password — fine at home, a bad idea on
shared wifi. It is plain `http`, so the phone gets a normal browser tab; "Add to Home Screen"
and offline mode need `https` or `localhost`, so those only work on the PC.

### When it goes wrong

`server/README.md` has the full list. The short version: port in use → `node server.js
--port=8001` (and change the redirect URI in your Yahoo app to match); repeated Yahoo 401 →
delete `server/data/tokens.json` and restart; Yahoo 999 → rate limiting, it backs off on its
own, don't restart in a loop; blank names in the pick list → the player map is still
building, picks are fine meanwhile.

**Nothing works and the draft starts in five minutes:** `node server.js --mock`. You lose
live sync, but the board, the maths and manual entry all work.

---

## Test it tonight

Mock mode runs a fake draft against real player names, with no Yahoo account and no network.
This is the only way to rehearse before draft morning.

```
cd server
node server.js --mock --teams=9 --rounds=14 --slot=4
```

Windows: **`server/start-mock.bat`** (but see the warning below about its defaults).

Then open <http://localhost:8000>, go to **Setup → Yahoo auto-sync → Find my draft**, and tap
the mock league. A pick lands every 8 seconds. Watch the Pick tab fill in, check the header
goes green, tap **Draft him** when your turn comes, and try a manual entry from the Board tab.

Knobs:

```
node server.js --mock --picks=40         start with 40 picks already made
node server.js --mock --pick-seconds=2   run it fast
```

Rewind or jump while it runs: <http://localhost:8000/api/reset?picks=60>

**Set `--teams=9 --rounds=14`.** The mock defaults to a 12-team, 16-round draft, and
connecting to any league — mock included — adopts its team count and round count. Testing
against the defaults leaves your settings at 12 teams and 16 rounds, which changes every
replacement level on the board. If it happens: set Teams back to 9 in Setup, and press
**"Rounds are set by hand — follow the roster instead"** to un-pin the rounds.

To check the Yahoo client itself rather than the app:

```
node server/selftest.js
```

46 checks against fixtures that reproduce Yahoo's real JSON shapes. No network, no account.
If something breaks on draft night, paste the real Yahoo response into `selftest.js` as a
fixture and it will point at the broken helper.

---

## The five tabs

| Tab | What it's for |
|---|---|
| **Pick** | The one screen that matters. Big "take him" card, three alternates, who will not survive until your next turn, and the recent-picks feed. |
| **Board** | Everyone left, ranked by value over replacement, split into tiers. Filter by position, or search. Tap a row to enter a pick by hand. |
| **Roster** | Your starting lineup as it fills in, your bench, what you still need, bye clashes, and how thin each position is getting. |
| **Room** | Who picks before your next turn and what each of them needs, plus what the model has learned about how this room reaches. |
| **Setup** | Sync, league shape, format sliders, rankings import, undo, reset. |

---

## How it decides

Not a static cheat sheet — it reacts to what has already happened.

- **Format first.** Guillotine, best ball and redraft are genuinely different engines, not a
  cosmetic toggle. Guillotine is the default and the one this league uses.
- **Value over replacement**, with replacement level **derived from your league** rather than
  typed in: `teams x starters + teams x flex x that position's share of the flex`. For 9
  teams with one flex that is **QB 9, RB 22, WR 23, TE 9**. The old build carried hardcoded
  12-team tables (RB 33, WR 42) which at this size handed elite backs and receivers about 40
  points of value that does not exist. The A/B/C baseline switch in Setup survives as a
  multiplier on the derived numbers, so each label still means what it says at any size.
- **Guillotine takes the redraft replacement path, not best ball's.** Best-ball depth exists
  because the auto-lineup banks every player's best week. Here you set one lineup a week and
  the week it goes wrong is the week you are eliminated, so depth you cannot start is worth
  nothing and replacement is the weekly-starter count.
- **Roster need.** A player who cannot crack your lineup scores zero and is never suggested.
- **Pick timing.** It knows your slot, so it knows the gap to your next turn and how likely
  each player is to survive it.
- **Tier cliffs and positional runs**, flagged as they happen.
- **It will not strand you.** Urgency escalates as picks run down, and once the startable
  players at a spot you still need are nearly gone it stops saying wait.
- **Positions you don't roster do not exist.** With K and DEF set to 0 they are dropped as
  the player pool is built, so they cannot leak into the board, tiers, roster needs, the room
  model or a recommendation. A pasted cheat sheet cannot add them back through the side door.

### Drafting for floor

One bad Sunday ends your season, so the objective is not maximum expected points, it is never
finishing last in any single week. Three things follow, and all three are sliders in Setup.

**Floor influence — 25%.** Floor is scored in its own right, not as the negation of a boom
score: rewarding a low ceiling and a low boom rate describes a bad player as readily as a safe
one. It is built from week-to-week volatility (`sd/ppg`, weight 0.40), **games played** (0.35)
and points per game (0.25, small, and only to stop a low-variance non-scorer from grading out
above a real producer). Availability is weighted nearly as hard as volatility on purpose: a
player who misses a week hands you a zero at that spot, and here a zero is not a lost week, it
is the season.

Small samples are regressed toward neutral — except games played, which is deliberately
exempt. Seven games is not a thin sample of a man's weekly *rate*, it is the observed fact
that he missed ten. Regressing it too would have handed the softest floor grades to the most
injury-prone players on the board, which is backwards in the one format where that matters
most.

**Early-bye penalty — 20%.** The penalty is not about the missing week; every bye costs one
week. It is about what you can do about it. In week 5 your roster is as thin as it will ever
be, almost nobody has been guillotined, and the FAAB pool is bare — you cover the hole off
your own bench or you start a hole. By late season several whole rosters, studs included, are
sitting in FAAB with fewer rivals left to outbid you, and a bye is nearly free. So the penalty
tracks replacement difficulty, and replacement difficulty decays as the season eats teams.

Both endpoints are read off the data, not typed in: it starts at the earliest bye the board
actually contains (week 5) and reaches zero when all but one rival has been eliminated —
`teams - 2` weeks later, which for 9 teams lands on week 12. A 12-team guillotine thins out
more slowly and would get a later zero, which is also right. A player with no bye on file gets
**no opinion**, never a week-0 maximum penalty.

**Top-QB premium — 35%.** QB is the steadiest weekly score on the board and every team starts
exactly one. This is the one adjustment that cannot be made in rank space: shuffling
quarterbacks against each other hands the same points curve back out and leaves the
cross-position comparison — which is the entire point — untouched. So it is applied in
**points**, to the starters only, tapering to exactly zero at the replacement quarterback.
QB1 gains a share of the top-to-replacement span; QB10 and everyone behind him gain nothing.
Because the man defining replacement level is the man whose bonus is zero, no VORP baseline in
the app moves.

Both rank-space shifts fade out past replacement level. Nobody in a 9-team, 14-round league
rosters the 2x-replacement player, his week-5 bye is a hole he will not be on the roster to
leave, and his floor grade is where the data is worst — volatility measured as `sd/ppg`
inflates on arithmetic alone once the scoring rate is low.

Set all three sliders to 0 and you get plain consensus-driven VORP.

### The room, not a curve

Survival is not a curve fitted to rank. It walks the actual teams picking before your next
turn and asks what each still needs. A team with no quarterback and two rounds left takes a
quarterback, and every receiver slides past them to you.

Each intervening team gets a positional appetite from its real roster; each player gets a
share within his own position. Probability is then consumed **sequentially** — without that,
two teams can both "take" the same player and the model loses count. Renormalising by who is
still likely available makes each pick consume exactly one player, so the expected number of
players gone over N intervening picks is exactly N.

This works in manual entry too. Ownership of a pick comes from the platform's own draft slot
where there is one, and falls back to the pick number otherwise — identical in a snake,
correct in a linear draft.

**It also learns how your room drafts.** The starting assumption in Setup is that this league
reaches for quarterbacks and tight ends earlier than value over replacement says it should.
That is then corrected against the picks as they land: for every pick, how far ahead of his
market rank did that player go? The observed figure is shrunk toward the prior by sample size,
so early picks nudge rather than swing it, and by the middle rounds the app is using what your
league actually did rather than what you told it. The Room tab shows the current multipliers.

### Will he come back to you?

The most valuable question in a snake draft is not who is best, it is who will still be there
next time. So a pick is scored as **value now minus what he was still worth to you later**.

Taking a player also removes him from the pool you draw on at your next turn. His marginal
contribution to that pool is exactly what you forfeit by spending this pick on him. Someone
the room takes before you pick again contributes almost nothing to that pool, so he costs
nothing to take — you get his full value. Someone who would have slid back to you is largely a
wasted pick, because you could have had him anyway.

That means a player one spot lower on your board can and should outrank one above him, if the
room is going to take him first. The **You can wait on** panel names the best player the maths
expects to survive, with the odds and the pick number.

**In a Yahoo league the market signal is Yahoo's own.** Survival has to be modelled on the
board your league is actually drafting from. When the server is connected, that is Yahoo's own
average draft pick per player, falling back to Yahoo's overall preseason rank (O-Rank) for
anyone Yahoo published no draft analysis for. Sleeper's stock ranking describes how Sleeper
users draft, and there is not one of them in your room, so it is never used as the market
here — only players Yahoo has no number for fall through to the built-in consensus, never to
the other platform's ranking, which would silently mix two markets on one board.

Where the room's number and the board's consensus disagree by 10 or more, the row shows both —
`ADP 8 · YH 21` — and that gap is where the value is. The tag says which room the number came
from (`YH` Yahoo, `SL` Sleeper), because the two mean different things.

Sleeper is still loaded, whatever room you draft in, as a free keyless source of NFL team and
injury designations — those are platform-neutral facts. It never blocks or delays the Yahoo
path, and if it fails the built-in board carries on.

### The best-ball layer (other modes only)

None of this runs in guillotine — the Boom influence slider is hidden there rather than shown
as a knob you have failed to turn. It applies if you switch Format to Best ball.

Boom rates come from nflverse weekly stats for 2024-25, blended 70/30 toward 2025, and
weighted with ceiling and PPG at 45/25/30.

**The experts already price most of this in.** Measured on this board, consensus rank explains
48% of the boom composite at QB, 57% at TE, 66% at WR and 71% at RB. Adding the raw score on
top of consensus would count most of it twice and systematically overrate the players the
rankers had already promoted for exactly that reason. So the composite is regressed on
consensus rank within each position and **only the residual is used** — what the spike-week
record knows that the rankers did not. The floor score in guillotine is regressed the same way
and for the same reason.

Boom influence defaults to **20%**. Best ball also pushes replacement level deeper (the
auto-lineup makes a bench receiver a live scoring asset) and makes a second quarterback a real
pick. Neither is true here.

**Never normalize either score across positions.** A weekly top-12 finish is a far easier bar
at QB (32 starters) than at WR; a cross-position score ranks backup quarterbacks above real
players. Everything is computed within position.

### Injuries

The board carries three players with a preseason injury tag, and those discount projected
points after the position's curve is assigned, scaled by severity — a reconstructed ACL is not
a one-week hamstring (IR/PUP/NFI/SUS 0.45, Out 0.72, Doubtful 0.88, otherwise 0.94).

Live injury designations pulled from Yahoo and Sleeper are **displayed on the player row but
do not move any number**. Serious injuries are already priced into the market rank, so treat
the live tag as something to read, not something the model has accounted for.

## The rankings

**The board ships seeded with FantasyPros consensus PPR top-250 (2026)** — 220 of them once K
and DEF are dropped. Nothing to paste, nothing to configure. That list supplies every player's
NFL team, consensus rank and bye week.

Projected points come from a positional curve assigned in consensus order: the ranking decides
who sits where, and a realistic full-PPR points curve supplies the scale that VORP,
replacement level and tier breaks depend on. It is not a points model, which is why there is
no scoring multiplier to turn — a different scoring format needs different rankings pasted in,
not a slider. If your Yahoo league does not score 1.0 per reception, the app says so and tells
you that.

### Replacing or updating the rankings

**Setup → Seed with consensus rankings** takes a pasted list and rebuilds the board the same
way. Use it for a different source — a guillotine-specific cheat sheet, say — or a fresher
pull on draft morning.

Almost any format parses: tab-separated table copy, `1. Ja'Marr Chase (CIN - WR)`,
`1 Chase CIN WR`, or CSV. Players not already on the board are added with their team, position
and a projection slotted into the curve at their consensus rank, so a list containing rookies
the app has never seen still works. Paste 150+ names for a full board; with a shorter list it
says so and leaves everyone you omitted on the built-in ranking.

The format layer runs on top of a pasted list exactly as it does on the built-in one: the
pasted order becomes the consensus that floor, bye and QB weighting are measured against.
(This was a real bug until recently — a pasted list used to skip straight to VORP and silently
switch guillotine's whole model off.)

---

## Known limits

**The live Yahoo path has never been run against Yahoo.** It was built and tested where
outbound network access to Yahoo was blocked, so every part of it has been exercised only
against fixtures that reproduce Yahoo's documented response shapes (`server/selftest.js`, 46
checks) and against the mock draft server. OAuth consent, token refresh, the real player
collection paging, and the live pick feed have all been *reasoned about* carefully and not one
of them has been *observed* working. Rehearse in mock mode, start the server early on draft
morning rather than at the last minute, and know that manual entry is the fallback.

**The floor score is backward-looking.** It is built from 2025 game logs and says nothing
about a player whose situation changed — new team, new offense, new role. Treat a big riser
skeptically.

**It says nothing at all about rookies.** 22 of the 220 players on the board have no NFL game
log, plus 3 whose only history is 2024. They score **neutral, never penalised**, and ride on
consensus alone. A blank column is never read as "never played" — that would hand the maximum
availability penalty to exactly the players we know least about.

**The guillotine weighting is a considered model, not a backtested one.** The mechanisms are
argued from the format and the sliders are set where they seemed right; no historical
simulation has been run showing that a floor-weighted board wins more guillotine leagues. The
sliders are there so you can disagree — 0 on all three gives you plain consensus VORP.

**Yahoo's rank can degrade quietly, and the app says so when it does.** Ranks are requested as
overall preseason rank explicitly, because Yahoo's default sort is season-to-date and means
nothing in preseason. If Yahoo refuses that sort, the server falls back to the default listing
order and prints a warning, and the Setup card tells you the ranks are an ordering only.

**Yahoo does not publish your draft slot before the draft starts.** Until it does, the app
either uses the slot you typed or has none — and with no slot, every timing, survival and
"will he come back" number is unavailable.

**`node tools/check.mjs`** is a browser smoke harness that verifies the league shape and board
against a real Chromium. It needs Playwright installed and currently resolves it from a
hardcoded sandbox path, so it will probably not run on your PC as-is. `node server/selftest.js`
has no such dependency and does run anywhere.

---

## Running it without the server

The app is still one static HTML file and works opened directly or hosted anywhere. What you
lose is exactly the Yahoo half: no auto-sync, no Yahoo market ranks. The Yahoo card is hidden
rather than broken — the app detects whether the local server is there instead of asking, so a
static copy shows no failed request and nothing that looks broken.

What still works: the full board, all the guillotine maths, manual pick entry, Sleeper's
team/injury data, and — if it is served over `https` — home-screen install and offline use.
Survival then runs on the built-in consensus rank instead of your room's actual market, which
is coarser but not wrong.

To host it: GitHub → Settings → Pages → Deploy from a branch → branch `yahoo-fantasy-access`,
folder `/ (root)`. It serves at `https://moneyballgt.github.io/Ffdraftmanager/`. Worth doing
as a phone-shaped backup if the PC dies mid-draft; it is not the primary path and it cannot
see your Yahoo draft.

## Files

| File | |
|---|---|
| `index.html` | **The app.** Generated. This is what the server serves. |
| `src/app.html` | Source — markup, styles, logic and the 250-player board. |
| `artifact.html` | Same app, wrapped for hosting as a Claude Artifact. Generated. |
| `build.sh` | Regenerates both outputs from `src/`. Run it after any edit to `src/app.html`. |
| `server/` | The local Yahoo server. Its own README covers setup and troubleshooting. |
| `tools/check.mjs` | Browser smoke harness (needs Playwright). |

Edit the player data in the `RAW` block near the top of the script in `src/app.html`
(`Name|TEAM|POS|proj|ECR|Bye|...`), then run `./build.sh` — `index.html` is stale the moment
`src/app.html` changes.
