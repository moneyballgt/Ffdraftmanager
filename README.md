# Draft Room

A free replacement for the FantasyPros Draft Assistant. Built for a **12-team, full-PPR,
snake** league on Sleeper with a **QB / RB / RB / WR / WR / TE / FLEX / FLEX / K / DEF** lineup.

No accounts, no server, no cost. One HTML file.

---

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

It is not a static cheat sheet — it reacts to what has already happened.

- **Value over replacement.** A player is worth what he beats the waiver wire by, not his
  raw points. Baselines for this exact format: QB13, RB33, WR39, TE13 — the RB/WR
  baselines run deep because two FLEX spots mean the league starts ~33 RBs and ~39 WRs.
- **Roster need.** A third TE is worth nothing to you. The engine knows, and will not
  recommend a player who can't crack your lineup.
- **Pick timing.** It knows your slot, so it knows the gap to your next turn. If a guy is
  85% likely to still be there in two rounds, it says wait and take the scarce player now.
- **Tier cliffs.** Being told "only 1 left in RB Tier 3" is the whole game in the middle
  rounds.
- **Positional runs.** Flags when 4+ of the last 8 picks were one position, because that's
  when a tier empties out under you.
- **It will not strand you.** Escalating urgency as your remaining picks run down, plus
  supply awareness — when the startable players at a spot you still need are nearly gone,
  it stops telling you to wait. K and DEF are suppressed entirely until the last two rounds,
  then forced.

Simulated across all 12 draft slots against roster-aware opponents: every slot finishes
with a legal, complete 16-man roster and no empty starting spots.

---

## Seed it with real consensus rankings (do this)

The built-in projections are my own estimates and my knowledge stops in **May 2026** — so
they carry no August camp news, injuries or holdouts. Fix that in about a minute:

1. Get a consensus PPR list — ask a Claude chat with web access for "the top 200 FantasyPros
   consensus PPR rankings as plain text, one player per line with team and position", or copy
   the table straight off their free rankings page.
2. **Setup → Seed with consensus rankings** → paste → **Load rankings**.

Almost any format parses — tab-separated table copy, `1. Ja'Marr Chase (CIN - WR)`,
`1 Chase CIN WR`, or CSV. Bye-week and tier columns are ignored, and `Ravens D/ST`
resolves to the Baltimore defense.

**What it does with the list.** It reassigns each position's existing points curve in
consensus order. Consensus sets *who ranks where*; the points scale that drives value over
replacement, replacement level and tier breaks stays intact — so you get their opinion
without losing the engine. Consensus order also becomes the ADP that powers pick timing.

**It adds players I've never heard of.** Anyone in your list that isn't on the built-in
board gets created with their team, position and a projection slotted into the curve at
their consensus rank. Verified: a 200-line import matched 185 and added 15 unknown players,
who then showed up as legitimate starters in simulated drafts. This is what closes the gap
on rookies and post-cutoff moves.

Paste 150+ names for a full board. With a short list the app says so and leaves everyone you
omitted on the built-in ranking rather than burying them.

Player pool, NFL teams, injury tags and market rank still come **live from Sleeper** when
sync is on, regardless.

## Files

| File | |
|---|---|
| `index.html` | **The app.** Standalone, open it directly. |
| `src/app.html` | Source (markup + styles + logic + player data). |
| `artifact.html` | Same app, wrapped for hosting as a Claude Artifact. |
| `build.sh` | Regenerates the two outputs from `src/`. |

Edit projections in the `RAW` block near the top of the script in `src/app.html`
(`Name|TEAM|POS|points`), then run `./build.sh`.
