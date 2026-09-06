# Draft Room — local Yahoo server

This runs on **your own PC**. It does two jobs at once, on one address:

1. serves the Draft Room app (`index.html` from the folder above this one), and
2. talks to Yahoo Fantasy on the app's behalf.

Both live at `http://localhost:8000`, which matters: Yahoo's API sends no CORS
headers and needs a client secret, so a web page can never call it directly. It
can call *this*, and this calls Yahoo.

Nothing to install. No `npm install`. No dependencies. Just Node.

---

## Try it right now, with no Yahoo account (do this first)

```
cd server
node server.js --mock
```

Then open <http://localhost:8000>.

On Windows you can instead double-click **`start-mock.bat`**.

Mock mode runs a fake 12-team, 16-round snake draft where **a new pick lands
every 8 seconds**. It uses real player names taken from the app's own board, so
everything joins up properly. This is how you test the app tonight without
waiting for a live draft.

Useful knobs:

```
node server.js --mock --picks=40         start with 40 picks already made
node server.js --mock --pick-seconds=2   speed the fake draft up
node server.js --mock --teams=10 --rounds=15 --slot=4
```

Rewind or fast-forward while it's running: <http://localhost:8000/api/reset?picks=60>

---

## The real thing: connecting to Yahoo

You need a free Yahoo "app" so Yahoo will hand out a token. It takes about three
minutes and you only ever do it once.

### Step 1 — Check you have Node

```
node --version
```

If that prints `v18` or higher, you're set. If it says "command not found",
install the **LTS** build from <https://nodejs.org> (default options are fine),
close the terminal, and open a new one.

### Step 2 — Register a Yahoo app

1. Go to <https://developer.yahoo.com/apps/create/> and sign in with the **same
   Yahoo account that owns your fantasy team**.
2. Fill in the form:

   | Field | What to enter |
   |---|---|
   | Application Name | `Draft Room` (anything) |
   | Application Type | **Web Application** |
   | Redirect URI(s) | `http://localhost:8000/callback` |
   | API Permissions | tick **Fantasy Sports**, and choose **Read** |

   The Redirect URI has to match **character for character**. No trailing
   slash, `http` not `https`, port `8000`.

   > If Yahoo rejects `localhost` in the Redirect URI, use
   > `http://127.0.0.1:8000/callback` instead, put that same value in
   > `YAHOO_REDIRECT_URI` below, and open the app at
   > <http://127.0.0.1:8000> rather than `localhost`.

3. Click **Create App**. Yahoo shows you a **Client ID** and a **Client Secret**.
   Leave that page open — you need both in the next step.

### Step 3 — Put the keys in a .env file

In this `server` folder, copy `.env.example` to a new file called exactly
`.env`, then paste your two values in:

```
YAHOO_CLIENT_ID=dj0yJmk9...your Client ID...
YAHOO_CLIENT_SECRET=...your Client Secret...
YAHOO_REDIRECT_URI=http://localhost:8000/callback
```

On Windows, `copy .env.example .env` then open `.env` in Notepad.
On Mac/Linux, `cp .env.example .env` then edit it.

`.env` is listed in `server/.gitignore`, so it is never committed. **Don't paste
the client secret anywhere else** — anyone holding it can sign in as your app.

### Step 4 — Start it

```
cd server
node server.js
```

(Windows: double-click **`start.bat`**.)

Your browser opens Yahoo's consent screen. Click **Agree**. Yahoo bounces you
back to `http://localhost:8000/callback`, you'll see "Connected to Yahoo", and
the terminal starts loading your league's player list.

**That first load takes 15–30 seconds.** Yahoo only hands out players 25 at a
time, so ~600 players is ~25 round trips. It's saved to `server/data/` and
reused, so it only happens once — never during your draft.

### Step 5 — Open the app

<http://localhost:8000>

Leave the terminal window open for the whole draft. Closing it stops the server.

---

## After the first time

Just `node server.js` (or `start.bat`). Your Yahoo login is remembered in
`server/data/tokens.json`, and the server quietly renews it — Yahoo's access
tokens expire every hour, and it handles that for you.

To sign in again as a different account, delete `server/data/tokens.json` and
restart. To force a fresh player list, visit
`http://localhost:8000/api/players/<your league key>?refresh=1`.

---

## Using it on your phone

By default the server listens **only on this PC**, because it holds your Yahoo
client secret and a live access token, and anything else on the same network
could otherwise reach your league data and your sign-in route. On your own home
wifi that hardly matters; on office, hotel or coffee-shop wifi it does.

To let your phone reach it, start it with `--lan`:

```
node server.js --lan
```

It then prints something like:

```
On phone:   http://192.168.1.42:8000/   (same wifi)
Note:       reachable by anything on this network (--lan is on)
```

Type that into your phone's browser and you get the same app, driven by the same
live draft, as long as the phone is on the same wifi as the PC.

Three caveats:

- **`--lan` opens it to everyone on that network.** No password. Fine at home,
  a bad idea on shared wifi.

- **It's plain `http`, not `https`.** That's fine on a home network, but phone
  browsers only offer "Add to Home Screen" / offline install over `https` or on
  `localhost`. So on the phone it's a normal browser tab — no install, no
  offline. On the PC at `http://localhost:8000` the install does work.
- Windows may pop up a firewall prompt the first time. Allow it on **private**
  networks.

If the phone can't reach it, the PC's firewall is almost always the reason.

---

## What the endpoints return

The app used to read Sleeper. These return the same shapes, so the frontend
barely changes.

| Endpoint | Returns |
|---|---|
| `GET /api/status` | `{mode, connected, configured, players:{building,done,message}}` |
| `GET /api/leagues` | `[{league_id, league_key, name, total_rosters, draft_status}]` |
| `GET /api/draft/<leagueKey>` | `{teams, rounds, slot, scoring}` |
| `GET /api/picks/<leagueKey>` | `[{pick_no, draft_slot, player_id, name, position, team}]`, sorted |
| `GET /api/players/<leagueKey>` | `{"<key>": {team, rank, adp, injury}}` |

Notes for whoever wires up the frontend:

- **`league_id` is the full Yahoo league key**, e.g. `461.l.123456`, not the
  bare number. Pass it straight back into the other three endpoints. (Yahoo's
  key is `<game_key>.l.<league_id>`; the game key changes every season and is
  looked up from `/game/nfl` at runtime, never hardcoded.)
- **Player map keys match the app's own board keys**: `norm(name)_POS`, e.g.
  `jamarrchase_WR`, and `def_SF` for a defense. `norm()` is copied verbatim from
  `src/app.html` — including the suffix rule that keeps "Kenneth Walker III"
  from becoming `kennethwalkeri`.
- **`rank` is Yahoo's overall rank ("O-Rank"): 1 = best, one continuous scale
  across every position**, the whole player pool ordered as a single list. It is
  the same *kind* of number as the board's overall ADP/ECR, so it is directly
  comparable to them and safe to blend — it is NOT a positional rank (there is
  only one `rank: 1`, not one per position), and it is NOT a points projection.

  It comes from requesting the league players collection with `;sort=OR`
  explicitly, then numbering the result. `OR` is Yahoo's overall/preseason
  ranking — the same order the Yahoo draft room shows. We ask for it by name
  rather than trusting the default sort, because the default can be `AR`
  (actual, season-to-date performance), which in preseason is meaningless.

  Caveat worth knowing: `rank` is *dense over what we fetched*. It numbers the
  players we actually paged through, so it is an ordering, not a Yahoo-published
  integer. If Yahoo ever refuses `sort=OR`, the server falls back to the default
  listing order and **prints a warning naming exactly that** — in which case
  treat `rank` as ordering only. The `/api/status` endpoint and the terminal
  both tell you which happened.

- **`adp` is Yahoo's own average draft pick** (from the `draft_analysis`
  subresource, fetched in the same round trips — no extra cost), e.g. `18.9`.
  This is the closest thing to a like-for-like comparison with the built-in
  board's ADP, since both are "expected draft position" in the same units.
  It is `null` if Yahoo did not return draft analysis for that player, so treat
  it as optional and fall back to `rank`.

- Both `rank` and `adp` describe **your Yahoo league's room**, which is the point
  — Sleeper's `search_rank` reflects how Sleeper users draft, which is the wrong
  room for a Yahoo draft. Sleeper remains a fine source for team and injury
  status; it is not a fine source for market rank here.
- **`scoring` is points per reception**, read from the league's stat modifiers
  by looking up the "Receptions" stat category — so a half-PPR league reports
  `0.5` and the app can warn that its full-PPR board doesn't match.
- **`slot`** is your position in round 1. Yahoo doesn't publish the draft order
  before the draft starts, so this is `null` until round 1 is under way. Set it
  by hand in the app if you need it early.
- `/api/picks` is built for a 4-second poll: **one** Yahoo call, everything else
  from the cached player map.
- Before you've signed in, every `/api/*` call returns HTTP 401 with
  `{"error":"not_connected","auth_url":"/auth"}`. Send the user to `/auth`.

---

## Caching, and why picks never go stale

Two independent guards, because this matters more than anything else here:

1. **`Cache-Control: no-store` on every `/api/*` response** (this server). This
   defends against the browser's own HTTP cache.
2. **`sw.js` skips `/api/`, `/auth` and `/callback` entirely**, identifying live
   data by path rather than by origin. Its cache name is `draftroom-v2` so
   existing home-screen installs drop the old worker instead of resurrecting it.

Both are needed, and it is worth knowing which does what, because it was
measured in a real browser rather than assumed:

- Serving `/api/` **without** `no-store` freezes the app solid: the page reads
  the same 4 picks twelve polls in a row while the draft advances to 15. That is
  the failure this is all about, and guard 1 is what prevents it.
- The service worker's Cache Storage was never observed holding an `/api/`
  response in Chrome, even under a sustained 1-second poll — its background
  `cache.put` is not wrapped in `waitUntil`, so it is unreliable. Guard 2 is
  therefore belt-and-braces rather than the load-bearing fix in Chrome, but it
  is still correct: `caches.match` is cache-first, so on any browser where that
  write does land, the worker would hand the draft a stale pick list.

**If you change one thing here, do not drop the `no-store` header.** That is the
one carrying the weight.

Upgrading from an older install: the stale `draftroom-v1` cache is evicted on the
**second** open, not the first — the outgoing worker still controls the first
reload and repopulates its own cache after the new worker's `activate` has run.
Harmless (the v2 worker is in control and never caches `/api/`), just don't be
surprised to see both cache names briefly.

This server serves `sw.js` byte-for-byte from disk. It does not rewrite it.

## Checking it still works

```
node selftest.js
```

Runs the whole live code path against fixtures that reproduce Yahoo's real JSON
shapes. 46 checks, no network, no account. If something breaks on draft night,
paste the real Yahoo response into `selftest.js` as a fixture and it'll point at
the broken helper.

---

## When it goes wrong

**"Port 8000 is already in use"** — something else has it. `node server.js
--port=8001`, and change the Redirect URI in your Yahoo app to match.

**Yahoo says "redirect_uri mismatch" / "invalid redirect"** — the URI in your
Yahoo app settings and the one in `.env` differ. They must be identical, down to
the trailing slash. Yahoo caches app settings for a minute or two after an edit.

**"Yahoo 401" repeatedly** — your saved token is stale or was revoked. Delete
`server/data/tokens.json` and restart to sign in again.

**"Yahoo 999"** — Yahoo rate-limiting. The server backs off and retries on its
own. If it persists, wait a minute; don't restart in a loop.

**Names are blank in the pick list** — the player map hasn't finished building.
Check the terminal; `/api/status` shows progress. Picks still show with the
right pick numbers and slots while it catches up.

**Empty league list** — you signed in with a Yahoo account that doesn't own the
team, or the league is from a previous season. `/api/leagues` only returns the
current NFL season.

**Nothing works and the draft starts in five minutes** — `node server.js
--mock`. You lose live sync, but the app runs and you can enter picks by hand.

---

## Why there's no library here

The obvious candidate was the `yahoo-fantasy` npm package. It was evaluated and
rejected:

- It **can't page the league players collection** — its `league.players()` only
  fetches by explicit player keys (its own source comment reads *"WIP... not
  sure this is useful"*). Building the `player_key -> name` map is the single
  hardest requirement here, and the library doesn't do it.
- Its OAuth helpers take Express `req`/`res` objects, so using them means adding
  Express too.
- It depends on the deprecated `esm` loader; its CommonJS entry point throws on
  Node 22.
- Its parsers index into fixed array positions and throw on anything unexpected
  — the worst possible failure mode 30 seconds before your pick.

Hand-rolling it costs about 400 lines and buys **zero dependencies**: nothing to
install, nothing to break, and defensive parsers that return empty instead of
throwing. Node 18+ already ships `fetch` and an HTTP server.

---

## Files

```
server/
  server.js           HTTP server: static app + /api + OAuth callback
  yahoo.js            Yahoo client: OAuth, token refresh, defensive JSON parsing
  mock.js             offline fake draft
  mock-players.json   player names lifted from the app's own board
  selftest.js         46 checks against Yahoo-shaped fixtures
  .env.example        template for your keys
  .gitignore          keeps .env and data/ out of git
  start.bat           Windows: double-click to run live
  start-mock.bat      Windows: double-click to run offline
  start.sh            Mac/Linux launcher
  data/               created at runtime: tokens + cached player map (git-ignored)
```
