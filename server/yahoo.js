/* ===========================================================================
   Yahoo Fantasy Sports API client.

   ZERO DEPENDENCIES on purpose. Node 18+ ships global fetch and a full HTTP
   server, so this runs with nothing but `node server.js` — no npm install to
   fail the night before a draft.

   (Researched alternative: the `yahoo-fantasy` npm wrapper. Rejected — see the
   "Why no library" section of README.md. Short version: it does not support the
   paginated league-players listing we need, its auth helpers assume Express,
   and its CJS entry point does not load on modern Node.)

   Two hard things live in here:
     1. OAuth 2.0 authorization-code flow + refresh (access tokens die in ~1h).
     2. Yahoo's JSON, which is genuinely hostile. See the PARSING section.
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';

const API_BASE  = 'https://fantasysports.yahooapis.com/fantasy/v2/';
const AUTH_URL  = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ===========================================================================
   PARSING — Yahoo's JSON, explained

   Yahoo's API is XML underneath. `?format=json` is a mechanical translation of
   that XML, which produces three separate flavours of awkward:

   (a) Repeated elements become an OBJECT WITH NUMERIC STRING KEYS plus a
       sibling `count`, not an array:
         "leagues": { "0": {...}, "1": {...}, "count": 2 }

   (b) A single entity's fields are split across an ARRAY OF SINGLE-KEY
       OBJECTS, sometimes nested one more level for no reason:
         "player": [ [ {"player_key":"nfl.p.1"}, {"player_id":"1"},
                       {"name":{"full":"Ja'Marr Chase"}} ], {...subresource} ]

   (c) Metadata and subresources sit at sibling array indexes:
         "league": [ {...league meta...}, { "settings": [ {...} ] } ]

   Rather than hard-code index paths like
   `fantasy_content.users[0].user[1].games[0].game[1].leagues[0].league[0]`
   (which is what most sample code does, and which breaks the moment Yahoo adds
   a subresource), everything below is INDEX-FREE:

     collect(node, 'league')  -> finds every value stored under a "league" key,
                                 anywhere in the tree, at any depth.
     merge(node)              -> flattens one entity's array-of-objects soup
                                 into a single flat object.

   Both are defensive: they never assume a shape, and they return empty rather
   than throwing on something unexpected.
   =========================================================================== */

const isObj = v => v !== null && typeof v === 'object';

/* Collect every value stored under `key`, at any depth.
   Deliberately does NOT descend into a value it just matched — otherwise a
   nested `league` inside a `league` would be reported twice. */
export function collect(node, key, out = []) {
  if (!isObj(node)) return out;
  if (Array.isArray(node)) {
    for (const v of node) collect(v, key, out);
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === key) out.push(node[k]);
    else collect(node[k], key, out);
  }
  return out;
}

/* Flatten one entity into a flat object.
   Walks arrays and numeric-string container keys (Yahoo's fake arrays), and
   copies every real named field it finds. Breadth-first with first-wins, so
   the entity's own metadata beats anything a subresource repeats later.
   `depth` caps the walk so a big subresource tree can't blow up. */
export function merge(node, depth = 6) {
  const out = {};
  const queue = [[node, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [n, d] = queue[i];
    if (!isObj(n) || d > depth) continue;
    if (Array.isArray(n)) {
      for (const v of n) queue.push([v, d + 1]);
      continue;
    }
    for (const k of Object.keys(n)) {
      if (k === 'count') continue;          // Yahoo's sibling length field
      if (/^\d+$/.test(k)) {                 // numeric-string container key
        queue.push([n[k], d + 1]);
        continue;
      }
      if (!(k in out)) out[k] = n[k];
    }
  }
  return out;
}

/* Collect entities: find every `key` value and flatten each one. */
export function entities(json, key) {
  return collect(json, key).map(v => merge(v)).filter(o => Object.keys(o).length);
}

/* Yahoo scalars arrive as strings ("12", "0.5"). */
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---------------------------------------------------------------------------
   Player name -> board key.

   MUST match the frontend's norm() in src/app.html exactly, or every join
   silently fails. Copied verbatim, including the whole-token suffix strip
   (a naive trailing match turns "Kenneth Walker III" into "kennethwalkeri").
   --------------------------------------------------------------------------- */
export const norm = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z\s]/g, ' ')
  .replace(/\s+(jr|sr|ii|iii|iv|v)\s*$/, '')
  .replace(/\s/g, '');

/* Yahoo's team abbreviations mostly match the app's board, but not always. */
const TEAM_FIX = {
  WSH: 'WAS', WFT: 'WAS', JAC: 'JAX', LA: 'LAR', STL: 'LAR', SD: 'LAC',
  OAK: 'LV', ARZ: 'ARI', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO',
  SFO: 'SF', TAM: 'TB', TAB: 'TB', CLV: 'CLE', BLT: 'BAL', HST: 'HOU',
};
export const fixTeam = t => {
  const u = String(t || '').toUpperCase().trim();
  return TEAM_FIX[u] || u || 'FA';
};

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/* Yahoo gives display_position like "WR" or "RB,WR" for multi-eligible guys,
   and position_type "DT" for a team defense. Reduce to the one position the
   app's board understands. */
export function primaryPosition(p) {
  if (p.position_type === 'DT') return 'DEF';
  const parts = String(p.display_position || '').toUpperCase().split(/[,\s]+/).filter(Boolean);
  for (const x of parts) {
    if (x === 'DEF' || x === 'D/ST' || x === 'DST') return 'DEF';
    if (POSITIONS.includes(x)) return x;
  }
  // Fall back to eligible_positions: [{position:"WR"}, {position:"W/R/T"}]
  const elig = Array.isArray(p.eligible_positions) ? p.eligible_positions : [];
  for (const e of elig) {
    const x = String((isObj(e) ? e.position : e) || '').toUpperCase();
    if (POSITIONS.includes(x)) return x;
  }
  return null;
}

/* The key the frontend joins on. */
export function boardKey(name, pos, team) {
  return pos === 'DEF' ? 'def_' + fixTeam(team) : norm(name) + '_' + pos;
}

/* Turn a merged Yahoo player object into the shape this app cares about. */
export function shapePlayer(raw) {
  const name = isObj(raw.name) ? (raw.name.full || `${raw.name.first || ''} ${raw.name.last || ''}`.trim())
                               : String(raw.name || '');
  const pos  = primaryPosition(raw);
  const team = fixTeam(raw.editorial_team_abbr);
  if (!pos || (!name && pos !== 'DEF')) return null;
  return {
    player_key: raw.player_key || null,
    name: pos === 'DEF' ? (name || team) : name,
    position: pos,
    team,
    // status "Q"/"O"/"IR"; status_full "Questionable". Frontend expects the
    // Sleeper-style long form.
    injury: raw.status_full || raw.status || null,
    bye: isObj(raw.bye_weeks) ? num(raw.bye_weeks.week) : null,
    // Yahoo's own average draft position, when the draft_analysis subresource
    // was returned. merge() stores draft_analysis as an opaque value rather
    // than descending into it, so unwrap it here.
    adp: raw.draft_analysis ? num(merge(raw.draft_analysis).average_pick) : null,
    key: boardKey(name, pos, team),
  };
}

/* =========================================================================== */

export class YahooError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class Yahoo {
  constructor({ clientId, clientSecret, redirectUri, dataDir }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.dataDir = dataDir;
    this.tokenFile = path.join(dataDir, 'tokens.json');
    this.tok = this._loadTokens();
    this._gameKey = null;
    this._statCats = null;
    this._refreshing = null;      // in-flight refresh, so 20 polls share one
    this.playerCache = new Map(); // leagueKey -> {builtAt, byKey, byPlayerKey}
    this.building = new Map();    // leagueKey -> in-flight build promise
    this.progress = { building: false, done: 0, total: 0, message: '' };
    this.rankSource = 'yahoo_overall_rank';   // set for real when the map is built
    this.adpAvailable = true;
  }

  /* ---------------- token persistence ---------------- */

  _loadTokens() {
    try {
      return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
    } catch {
      return {};
    }
  }

  _saveTokens() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(this.tok, null, 2));
    // Best effort: keep the refresh token off other users of this machine.
    try { fs.chmodSync(this.tokenFile, 0o600); } catch {}
  }

  get connected() { return !!(this.tok && this.tok.refresh_token); }

  /* ---------------- OAuth 2.0 ---------------- */

  authUrl(state = '') {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      // Yahoo grants Fantasy read from the app registration itself; asking for
      // the openid scope keeps the consent screen happy on newer app configs.
      language: 'en-us',
    });
    if (state) q.set('state', state);
    return `${AUTH_URL}?${q}`;
  }

  async _token(params) {
    const body = new URLSearchParams({
      redirect_uri: this.redirectUri,
      ...params,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Yahoo accepts client creds either in the body or as HTTP Basic.
        // Basic is the documented path and avoids logging the secret in a body.
        Authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'),
      },
      body,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok || !json || !json.access_token) {
      throw new YahooError(
        `Yahoo token request failed (${res.status}): ${json?.error_description || json?.error || text.slice(0, 300)}`,
        res.status, text);
    }
    this.tok = {
      access_token: json.access_token,
      // A refresh response sometimes omits refresh_token — keep the old one.
      refresh_token: json.refresh_token || this.tok.refresh_token,
      expires_at: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      guid: json.xoauth_yahoo_guid || this.tok.guid || null,
    };
    this._saveTokens();
    return this.tok;
  }

  exchangeCode(code) {
    return this._token({ grant_type: 'authorization_code', code });
  }

  refresh() {
    // Collapse concurrent refreshes: a 4s poll loop must not fire five of them.
    if (this._refreshing) return this._refreshing;
    if (!this.tok.refresh_token) return Promise.reject(new YahooError('Not connected to Yahoo yet.', 401));
    this._refreshing = this._token({ grant_type: 'refresh_token', refresh_token: this.tok.refresh_token })
      .finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async ensureToken() {
    if (!this.connected) throw new YahooError('Not connected to Yahoo yet. Open http://localhost:8000/auth', 401);
    // Refresh a minute early so a request never races the expiry.
    if (!this.tok.access_token || Date.now() > (this.tok.expires_at || 0) - 60_000) {
      await this.refresh();
    }
    return this.tok.access_token;
  }

  /* ---------------- raw request ---------------- */

  /* `p` is a path below /fantasy/v2/, e.g. "league/461.l.1/draft_results".
     ?format=json is ALWAYS appended — Yahoo returns XML without it. */
  async api(p, attempt = 0) {
    const token = await this.ensureToken();
    const url = API_BASE + p + (p.includes('?') ? '&' : '?') + 'format=json';

    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch (e) {
      if (attempt < 2) { await sleep(500 * (attempt + 1)); return this.api(p, attempt + 1); }
      throw new YahooError(`Could not reach Yahoo: ${e.message}`, 0);
    }

    if (res.status === 401 && attempt < 2) {
      await this.refresh();
      return this.api(p, attempt + 1);
    }
    // 999 is Yahoo's "slow down"; 429/5xx are the usual transients.
    if ((res.status === 999 || res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(800 * (attempt + 1));
      return this.api(p, attempt + 1);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new YahooError(`Yahoo ${res.status} on ${p}: ${text.slice(0, 300)}`, res.status, text);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new YahooError(`Yahoo returned non-JSON for ${p} (first 200 chars: ${text.slice(0, 200)})`, res.status, text);
    }
  }

  /* ---------------- high level ---------------- */

  /* Current NFL game key, e.g. "461". Never hardcode this — it changes every
     season and a stale one makes every league key wrong. */
  async gameKey() {
    if (this._gameKey) return this._gameKey;
    const json = await this.api('game/nfl');
    const g = entities(json, 'game')[0] || {};
    this._gameKey = g.game_key ? String(g.game_key) : null;
    if (!this._gameKey) throw new YahooError('Could not resolve the current NFL game key from /game/nfl.', 0);
    return this._gameKey;
  }

  /* The logged-in user's NFL leagues for the current season. */
  async leagues() {
    const json = await this.api('users;use_login=1/games;game_keys=nfl/leagues');
    const out = [];
    for (const lg of entities(json, 'league')) {
      if (!lg.league_key) continue;
      out.push({
        // The frontend passes this straight back to /api/draft/:leagueKey, so
        // it has to be the FULL Yahoo league key, not the bare numeric id.
        league_id: String(lg.league_key),
        league_key: String(lg.league_key),
        name: lg.name || String(lg.league_key),
        total_rosters: num(lg.num_teams) || 0,
        season: lg.season || null,
        draft_status: lg.draft_status || null,
        url: lg.url || null,
      });
    }
    return out;
  }

  async leagueMeta(leagueKey) {
    const json = await this.api(`league/${encodeURIComponent(leagueKey)}/metadata`);
    return entities(json, 'league')[0] || {};
  }

  async leagueSettings(leagueKey) {
    const json = await this.api(`league/${encodeURIComponent(leagueKey)}/settings`);
    const league = entities(json, 'league')[0] || {};
    const settings = merge(collect(json, 'settings')[0] || {});
    return { league, settings, raw: json };
  }

  /* stat_id -> stat name, so we can find "Receptions" without hardcoding an id
     that Yahoo could renumber. Cached for the process lifetime. */
  async statCategories() {
    if (this._statCats) return this._statCats;
    const gk = await this.gameKey();
    const map = new Map();
    try {
      const json = await this.api(`game/${gk}/stat_categories`);
      for (const s of collect(json, 'stat')) {
        const m = merge(s);
        if (m.stat_id != null) {
          map.set(String(m.stat_id), String(m.display_name || m.name || ''));
        }
      }
    } catch {
      /* Non-fatal: we fall back to the well-known reception stat id. */
    }
    this._statCats = map;
    return map;
  }

  /* Points per reception. Sleeper exposes this as scoring_settings.rec and the
     frontend uses it to warn when the board's full-PPR assumption is wrong. */
  async pointsPerReception(json) {
    const cats = await this.statCategories();
    let recId = null;
    for (const [id, name] of cats) {
      if (/^rec(eption)?s?$/i.test(name.trim())) { recId = id; break; }
    }
    if (!recId) recId = '11';   // Yahoo NFL: 11 = Receptions

    for (const s of collect(json, 'stat')) {
      const m = merge(s);
      if (m.stat_id != null && String(m.stat_id) === recId && m.value != null) {
        const v = num(m.value);
        if (v != null) return v;
      }
    }
    return 0;   // no reception modifier == standard scoring
  }

  /* Draft rounds = every roster slot a team drafts into. Bench counts; IR does
     not. Yahoo does not report "rounds" directly, so it has to be derived. */
  rosterRounds(json) {
    let total = 0;
    for (const rp of collect(json, 'roster_position')) {
      // NOTE: do NOT use merge() here. merge() deliberately drops `count`,
      // because on every other Yahoo node `count` is the container-length
      // field — but on a roster_position it is the real number of slots.
      const m = Array.isArray(rp) ? Object.assign({}, ...rp.filter(x => x && typeof x === 'object')) : rp;
      if (!m || typeof m !== 'object') continue;
      const pos = String(m.position || '').toUpperCase();
      if (pos === 'IR' || pos === 'IR+' || pos === 'NA') continue;
      total += num(m.count) || 0;
    }
    return total || null;
  }

  /* The team the logged-in user owns in this league. */
  async myTeamKey(leagueKey) {
    const json = await this.api(`league/${encodeURIComponent(leagueKey)}/teams`);
    for (const t of entities(json, 'team')) {
      if (String(t.is_owned_by_current_login) === '1') return t.team_key || null;
    }
    return null;
  }

  /* Raw draft results: [{pick, round, team_key, player_key}] */
  async draftResults(leagueKey) {
    const json = await this.api(`league/${encodeURIComponent(leagueKey)}/draft_results`);
    return collect(json, 'draft_result')
      .map(d => merge(d))
      .filter(d => d && d.pick != null)
      .map(d => ({
        pick: num(d.pick),
        round: num(d.round),
        team_key: d.team_key || null,
        player_key: d.player_key || null,
      }))
      .filter(d => d.pick != null)
      .sort((a, b) => a.pick - b.pick);
  }

  /* -------------------------------------------------------------------------
     THE EXPENSIVE ONE: the league player map.

     Yahoo's draft results give you `player_key` ("nfl.p.12345") and nothing
     else — no name, no position. So we need player_key -> {name, position,
     team}. The league players collection pages 25 AT A TIME, so ~600 players is
     ~25 sequential round trips. Build it once at connect time, cache to disk,
     and never rebuild during a live draft.

     RANK: we ask for `;sort=OR` explicitly rather than trusting Yahoo's default
     sort. OR is Yahoo's *overall* rank — one ordered list across every
     position, which is what the Yahoo draft room shows as O-Rank and what is
     comparable in scale to the board's overall ADP/ECR. Leaving it to the
     default risks getting AR (actual, season-to-date performance rank), which
     in preseason is meaningless. The 1-based position in that sorted listing IS
     the rank we report.

     ADP: `;out=draft_analysis` adds Yahoo's own average draft pick per player
     at no extra round trips (same 25 pages, slightly bigger). Both extras are
     probed once and dropped if Yahoo rejects them, so an unexpected 400 can
     never cost us the whole map.
     ------------------------------------------------------------------------- */
  async buildPlayerMap(leagueKey, { maxPlayers = 1200, concurrency = 4 } = {}) {
    const PAGE = 25;                          // Yahoo's hard maximum
    const byPlayerKey = new Map();
    const ordered = [];
    let start = 0;
    let stop = false;

    this.progress = { building: true, done: 0, total: maxPlayers, message: 'Loading Yahoo players…' };

    // Probe the optional filters once, most-useful first, then reuse whichever
    // one worked for every page of this build.
    const base = `league/${encodeURIComponent(leagueKey)}/players`;
    let variant = null;
    let firstPage = null;
    for (const v of [';sort=OR;out=draft_analysis', ';sort=OR', '']) {
      try {
        firstPage = await this.api(`${base}${v};start=0;count=${PAGE}`);
        variant = v;
        break;
      } catch (e) {
        console.warn(`[players] Yahoo rejected "${v || 'plain'}" (${e.message.slice(0, 80)}), falling back`);
      }
    }
    if (variant === null) throw new YahooError('Could not list players for ' + leagueKey, 0);
    // Record what `rank` actually means for this build, so /api/status can say
    // so instead of the frontend having to guess.
    this.rankSource = variant.includes('sort=OR') ? 'yahoo_overall_rank' : 'yahoo_default_listing_order';
    this.adpAvailable = variant.includes('draft_analysis');
    if (variant === ';sort=OR') {
      console.warn('[players] draft_analysis unavailable — rank is Yahoo overall rank, adp will be null');
    } else if (variant === '') {
      console.warn("[players] sort=OR unavailable — rank falls back to Yahoo's DEFAULT listing order, " +
                   'which may not be overall preseason rank. Treat rank as ordering only.');
    }

    while (!stop && ordered.length < maxPlayers) {
      // Fetch a few pages at once — 25 sequential round trips is otherwise a
      // very long wait. Keep concurrency low so Yahoo does not throttle (999).
      const starts = [];
      for (let i = 0; i < concurrency && start < maxPlayers; i++, start += PAGE) starts.push(start);

      const pages = await Promise.all(starts.map(async s => {
        try {
          // Page 0 was already fetched by the probe above; don't pay for it twice.
          const json = s === 0 && firstPage
            ? firstPage
            : await this.api(`${base}${variant};start=${s};count=${PAGE}`);
          return { s, players: collect(json, 'player').map(p => merge(p)) };
        } catch (e) {
          // One bad page must not lose the whole map.
          return { s, players: [], error: e };
        }
      }));

      pages.sort((a, b) => a.s - b.s);
      let addedThisRound = 0;
      for (const pg of pages) {
        if (pg.players.length < PAGE) stop = true;   // ran off the end
        for (const raw of pg.players) {
          const p = shapePlayer(raw);
          if (!p || !p.player_key) continue;
          if (byPlayerKey.has(p.player_key)) continue;
          byPlayerKey.set(p.player_key, p);
          ordered.push(p);
          addedThisRound++;
        }
      }
      // Yahoo sometimes repeats the tail instead of returning an empty page.
      if (addedThisRound === 0) stop = true;
      this.progress = {
        building: true, done: ordered.length, total: maxPlayers,
        message: `Loading Yahoo players… ${ordered.length}`,
      };
    }

    // Position in the sort=OR listing == Yahoo's overall rank. 1 = best,
    // one continuous scale across all positions.
    ordered.forEach((p, i) => { p.rank = i + 1; });

    const byKey = {};
    for (const p of ordered) {
      // First occurrence wins: two players can normalise to the same board key
      // (rare), and the better-ranked one is the one the board means.
      if (!(p.key in byKey)) byKey[p.key] = { team: p.team, rank: p.rank, adp: p.adp, injury: p.injury };
    }

    const map = {
      leagueKey,
      builtAt: Date.now(),
      count: ordered.length,
      byKey,
      players: Object.fromEntries([...byPlayerKey].map(([k, p]) => [k, p])),
    };
    this.progress = { building: false, done: ordered.length, total: ordered.length, message: `Loaded ${ordered.length} Yahoo players.` };
    return map;
  }

  _cacheFile(leagueKey) {
    return path.join(this.dataDir, `players.${String(leagueKey).replace(/[^\w.-]/g, '_')}.json`);
  }

  /* Disk-cached player map. `force` rebuilds. Concurrent callers share one
     build — a 4s poll must never kick off a second 25-request crawl. */
  async playerMap(leagueKey, { force = false, maxAgeMs = 24 * 3600e3 } = {}) {
    if (!force) {
      const mem = this.playerCache.get(leagueKey);
      if (mem && Date.now() - mem.builtAt < maxAgeMs) return mem;
      try {
        const disk = JSON.parse(fs.readFileSync(this._cacheFile(leagueKey), 'utf8'));
        if (disk && disk.count && Date.now() - disk.builtAt < maxAgeMs) {
          this.playerCache.set(leagueKey, disk);
          return disk;
        }
      } catch { /* no cache yet */ }
    }
    if (this.building.has(leagueKey)) return this.building.get(leagueKey);

    const job = (async () => {
      const map = await this.buildPlayerMap(leagueKey);
      this.playerCache.set(leagueKey, map);
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
        fs.writeFileSync(this._cacheFile(leagueKey), JSON.stringify(map));
      } catch (e) {
        console.warn('[yahoo] could not write player cache:', e.message);
      }
      return map;
    })().finally(() => this.building.delete(leagueKey));

    this.building.set(leagueKey, job);
    return job;
  }

  /* Look up player keys the cached map does not know about (a player added to
     Yahoo after the map was built). Batched, and normally a no-op. */
  async fetchPlayersByKey(leagueKey, keys) {
    const out = new Map();
    for (let i = 0; i < keys.length; i += 25) {
      const batch = keys.slice(i, i + 25);
      try {
        const json = await this.api(
          `league/${encodeURIComponent(leagueKey)}/players;player_keys=${batch.join(',')}`);
        for (const raw of collect(json, 'player')) {
          const p = shapePlayer(merge(raw));
          if (p && p.player_key) out.set(p.player_key, p);
        }
      } catch (e) {
        console.warn('[yahoo] player_keys lookup failed:', e.message);
      }
    }
    return out;
  }

  /* ---------------- endpoint payloads ---------------- */

  /* { teams, rounds, slot, scoring } — mirrors what the app read from Sleeper's
     draft + league settings. */
  async draftInfo(leagueKey) {
    const { league, raw } = await this.leagueSettings(leagueKey);
    const teams = num(league.num_teams) || null;
    const rounds = this.rosterRounds(raw);
    const scoring = await this.pointsPerReception(raw);

    // Draft slot: your team's position in round 1. Only knowable once round 1
    // has been drafted; before that Yahoo does not publish the order.
    let slot = null;
    try {
      const [myTeam, results] = await Promise.all([
        this.myTeamKey(leagueKey),
        this.draftResults(leagueKey).catch(() => []),
      ]);
      if (myTeam) {
        const r1 = results.find(d => d.round === 1 && d.team_key === myTeam);
        if (r1) slot = r1.pick;
      }
    } catch { /* slot stays null; the user can set it by hand */ }

    return {
      league_key: leagueKey,
      name: league.name || null,
      teams,
      rounds,
      slot,
      scoring,
      draft_status: league.draft_status || null,
    };
  }

  /* [{pick_no, draft_slot, player_id, name, position, team}] sorted by pick_no.
     This is the 4-second poll. It makes ONE Yahoo call and reads the cached
     player map — it must never rebuild that map. */
  async picks(leagueKey) {
    const [results, map] = await Promise.all([
      this.draftResults(leagueKey),
      // Never let a player-map problem blank the pick list mid-draft. Picks
      // with no name still carry pick_no and draft_slot, so the board keeps
      // working; names fill in as soon as the map builds.
      this.playerMap(leagueKey).catch(e => {
        console.warn('[picks] player map unavailable, returning picks without names:', e.message);
        return { players: {} };
      }),
    ]);

    // team_key -> draft slot, learned from round 1.
    const slotOf = new Map();
    for (const d of results) {
      if (d.round === 1 && d.team_key && !slotOf.has(d.team_key)) slotOf.set(d.team_key, d.pick);
    }

    // Anything the cached map has never seen (should be empty).
    const missing = [...new Set(results.map(d => d.player_key)
      .filter(k => k && !map.players[k]))];
    let extra = new Map();
    if (missing.length) {
      extra = await this.fetchPlayersByKey(leagueKey, missing);
      for (const [k, p] of extra) map.players[k] = p;   // keep it for next poll
    }

    return results.map(d => {
      const p = map.players[d.player_key] || extra.get(d.player_key) || null;
      return {
        pick_no: d.pick,
        round: d.round,
        draft_slot: d.team_key ? (slotOf.get(d.team_key) || null) : null,
        player_id: d.player_key,
        name: p ? p.name : '',
        position: p ? p.position : null,
        team: p ? p.team : null,
      };
    });
  }

  /* key -> {team, rank, injury}, exactly the shape the app cached from
     Sleeper's /players/nfl. */
  async playersByKey(leagueKey, opts) {
    const map = await this.playerMap(leagueKey, opts);
    return map.byKey;
  }
}
