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
