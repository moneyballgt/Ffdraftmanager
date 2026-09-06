#!/usr/bin/env node
/* ===========================================================================
   Draft Room local server.

   Serves the existing static app AND the Yahoo proxy endpoints from the SAME
   ORIGIN (http://localhost:8000). Same origin is the whole point: Yahoo sends
   no CORS headers and needs a client secret, so the browser cannot call it
   directly — but it can call us, and we call Yahoo.

     http://localhost:8000/                 the app (repo-root index.html)
     http://localhost:8000/auth             start Yahoo sign-in
     http://localhost:8000/callback         OAuth redirect target
     http://localhost:8000/api/status       are we connected? is the map built?
     http://localhost:8000/api/leagues      [{league_id, name, total_rosters}]
     http://localhost:8000/api/draft/<key>  {teams, rounds, slot, scoring}
     http://localhost:8000/api/picks/<key>  [{pick_no, draft_slot, player_id,
                                              name, position, team}]
     http://localhost:8000/api/players/<key> key -> {team, rank, adp, injury}

   Run:  node server.js            live Yahoo
         node server.js --mock     canned draft, no Yahoo account needed
   =========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { Yahoo, YahooError } from './yahoo.js';
import { MockDraft } from './mock.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');          // repo root: index.html lives here
const DATA = path.join(HERE, 'data');

/* ---------------------------------------------------------------------------
   Arguments and .env
   --------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

/* Minimal .env reader — no dotenv dependency. KEY=value, # comments, optional
   surrounding quotes. */
function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('#')) v = '';
    v = v.replace(/\s+#.*$/, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnv(path.join(HERE, '.env')), ...process.env };

const MOCK = flag('mock');
const PORT = Number(opt('port', env.PORT || 8000));
/* Loopback by default. This process holds a Yahoo client secret and a live
   access token, and binding every interface hands anyone else on the network
   — a shared office, hotel or coffee-shop wifi — your league data and your
   /auth route. Nothing here echoes the secret or the token, so the exposure
   is modest, but a default that is only safe on a network you happen to
   trust is the wrong default. Phone access is one flag away: --lan. */
const LAN = flag('lan');
const HOST = opt('host', env.HOST || (LAN ? '0.0.0.0' : '127.0.0.1'));
const REDIRECT_URI = env.YAHOO_REDIRECT_URI || `http://localhost:${PORT}/callback`;

const yahoo = new Yahoo({
  clientId: env.YAHOO_CLIENT_ID || '',
  clientSecret: env.YAHOO_CLIENT_SECRET || '',
  redirectUri: REDIRECT_URI,
  dataDir: DATA,
});

const mock = MOCK ? new MockDraft({
  teams: Number(opt('teams', 12)),
  rounds: Number(opt('rounds', 16)),
  slot: Number(opt('slot', 7)),
  scoring: Number(opt('scoring', 1)),
  secondsPerPick: Number(opt('pick-seconds', 8)),
  startingPicks: Number(opt('picks', 0)),
}) : null;

/* ---------------------------------------------------------------------------
   Static files

   sw.js is served straight from disk like every other asset. It handles the
   /api/ bypass itself — live proxy data must never be cached, and that rule
   lives in the service worker, not in a server-side rewrite.
   --------------------------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* The static root is the repo root, and server/.env lives underneath it. Never
   serve our own directory, dotfiles, or git internals. */
function staticPathFor(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const segs = rel.split('/');
  if (segs.some(s => s === '..' || s.startsWith('.'))) return null;
  if (segs[0] === 'server' || segs[0] === '.git' || segs[0] === 'node_modules') return null;
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;   // traversal guard
  if (!MIME[path.extname(abs).toLowerCase()]) return null;             // extension allowlist
  return abs;
}

/* ---------------------------------------------------------------------------
   Responses
   --------------------------------------------------------------------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // Independent of the service worker: this stops the browser's own HTTP
    // cache (and any proxy in between) from holding on to a pick list.
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;
font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{max-width:34rem;background:#161b22;border:1px solid #30363d;border-radius:14px;padding:28px}
h1{margin:0 0 10px;font-size:20px}p{margin:0 0 12px;color:#9da7b3}code{background:#0d1117;padding:2px 6px;border-radius:5px;color:#e6edf3}
a{color:#58a6ff}</style><div class="card">${body}</div>`;
}

/* ---------------------------------------------------------------------------
   API
   --------------------------------------------------------------------------- */

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
            : process.platform === 'darwin' ? ['open', [url]]
            : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* headless box: the printed URL is enough */ }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);   // ['api','draft','461.l.1']
  const route = parts[1] || '';
  const leagueKey = parts.slice(2).join('/') ? decodeURIComponent(parts.slice(2).join('/')) : null;

  if (route === 'status') {
    return sendJson(res, 200, {
      mode: MOCK ? 'mock' : 'yahoo',
      connected: MOCK ? true : yahoo.connected,
      configured: MOCK ? true : !!(env.YAHOO_CLIENT_ID && env.YAHOO_CLIENT_SECRET),
      auth_url: MOCK ? null : '/auth',
      redirect_uri: REDIRECT_URI,
      players: MOCK ? { building: false, done: 0, total: 0, message: 'mock' } : yahoo.progress,
      // What the `rank` field in /api/players actually means for this build.
      rank_source: MOCK ? 'yahoo_overall_rank' : yahoo.rankSource,
      adp_available: MOCK ? true : yahoo.adpAvailable,
      server_time: Date.now(),
    });
  }

  if (MOCK) {
    switch (route) {
      case 'leagues': return sendJson(res, 200, mock.leagues());
      case 'draft':   return sendJson(res, 200, mock.draftInfo());
      case 'picks':   return sendJson(res, 200, mock.picks());
      case 'players': return sendJson(res, 200, mock.playersByKey());
      case 'reset':
        mock.reset(Number(url.searchParams.get('picks') || 0));
        return sendJson(res, 200, { ok: true, picks: mock.made() });
      default: return sendJson(res, 404, { error: 'unknown endpoint' });
    }
  }

  if (!yahoo.connected) {
    return sendJson(res, 401, {
      error: 'not_connected',
      message: 'Not signed in to Yahoo yet.',
      auth_url: '/auth',
    });
  }

  switch (route) {
    case 'leagues':
      return sendJson(res, 200, await yahoo.leagues());

    case 'draft': {
      if (!leagueKey) return sendJson(res, 400, { error: 'league key required' });
      const info = await yahoo.draftInfo(leagueKey);
      // Warm the player map NOW, in the background. Building it costs ~25
      // sequential Yahoo calls and must never happen mid-draft on a poll.
      yahoo.playerMap(leagueKey).catch(e => console.warn('[players] prefetch failed:', e.message));
      return sendJson(res, 200, info);
    }

    case 'picks':
      if (!leagueKey) return sendJson(res, 400, { error: 'league key required' });
      return sendJson(res, 200, await yahoo.picks(leagueKey));

    case 'players': {
      if (!leagueKey) return sendJson(res, 400, { error: 'league key required' });
      const force = url.searchParams.get('refresh') === '1';
      return sendJson(res, 200, await yahoo.playersByKey(leagueKey, { force }));
    }

    default:
      return sendJson(res, 404, { error: 'unknown endpoint' });
  }
}

/* ---------------------------------------------------------------------------
   Request router
   --------------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    /* ---- OAuth: kick off ---- */
    if (url.pathname === '/auth') {
      if (MOCK) return sendHtml(res, 200, page('Mock mode', '<h1>Mock mode</h1><p>No Yahoo sign-in needed. <a href="/">Open the app</a>.</p>'));
      if (!env.YAHOO_CLIENT_ID || !env.YAHOO_CLIENT_SECRET) {
        return sendHtml(res, 500, page('Not configured',
          `<h1>Yahoo app not configured</h1><p>Create <code>server/.env</code> with <code>YAHOO_CLIENT_ID</code> and
           <code>YAHOO_CLIENT_SECRET</code>, then restart. See <code>server/README.md</code>.</p>`));
      }
      res.writeHead(302, { Location: yahoo.authUrl(), 'Cache-Control': 'no-store' });
      return res.end();
    }

    /* ---- OAuth: Yahoo redirects back here with ?code= ---- */
    if (url.pathname === '/callback') {
      const err = url.searchParams.get('error');
      if (err) {
        return sendHtml(res, 400, page('Sign-in failed',
          `<h1>Yahoo said no</h1><p><code>${escapeHtml(err)}</code> — ${escapeHtml(url.searchParams.get('error_description') || '')}</p>
           <p><a href="/auth">Try again</a></p>`));
      }
      const code = url.searchParams.get('code');
      if (!code) return sendHtml(res, 400, page('Sign-in failed', '<h1>No code returned</h1><p><a href="/auth">Try again</a></p>'));

      await yahoo.exchangeCode(code);
      console.log('[auth] connected to Yahoo; refresh token saved to server/data/tokens.json');

      // Build the player map immediately if the user has exactly one league —
      // "at connect time, not at first pick".
      yahoo.leagues().then(lgs => {
        console.log(`[auth] ${lgs.length} league(s): ${lgs.map(l => `${l.name} (${l.league_key})`).join(', ')}`);
        if (lgs.length === 1) {
          console.log('[players] pre-building the player map for', lgs[0].league_key);
          return yahoo.playerMap(lgs[0].league_key);
        }
      }).catch(e => console.warn('[auth] post-connect prefetch failed:', e.message));

      return sendHtml(res, 200, page('Connected',
        `<h1>Connected to Yahoo</h1>
         <p>You can close this tab. The player list is loading in the background — watch the terminal.</p>
         <p><a href="/">Open Draft Room</a></p>`));
    }

    /* ---- API ---- */
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    /* ---- Static ---- */
    const file = staticPathFor(url.pathname);
    if (!file) { res.writeHead(404); return res.end('Not found'); }

    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()],
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  } catch (e) {
    const status = e instanceof YahooError ? (e.status && e.status >= 400 ? e.status : 502) : 500;
    console.error('[error]', e.message);
    if (!res.headersSent) sendJson(res, status, { error: 'server_error', message: e.message });
    else res.end();
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------------------------------------------------------------------
   Boot
   --------------------------------------------------------------------------- */

fs.mkdirSync(DATA, { recursive: true });

server.listen(PORT, HOST, () => {
  const bar = '─'.repeat(58);
  console.log('\n' + bar);
  console.log(`  Draft Room server  ·  ${MOCK ? 'MOCK MODE (no Yahoo needed)' : 'live Yahoo'}`);
  console.log(bar);
  console.log(`  App:        http://localhost:${PORT}/`);
  if (HOST === '127.0.0.1' || HOST === 'localhost') {
    console.log(`  On phone:   add --lan to allow other devices on this wifi`);
  } else {
    for (const ip of lanIps()) console.log(`  On phone:   http://${ip}:${PORT}/   (same wifi)`);
    console.log(`  Note:       reachable by anything on this network (--lan is on)`);
  }

  if (MOCK) {
    console.log(`\n  Mock draft: ${mock.teams} teams · ${mock.rounds} rounds · you are slot ${mock.slot}`);
    console.log(`  A new pick lands every ${mock.secondsPerPick}s. Reset: /api/reset?picks=20`);
    console.log(bar + '\n');
    openBrowser(`http://localhost:${PORT}/`);
    return;
  }

  if (!env.YAHOO_CLIENT_ID || !env.YAHOO_CLIENT_SECRET) {
    console.log('\n  !! No Yahoo credentials found.');
    console.log('     Create server/.env from server/.env.example, then restart.');
    console.log('     Or run offline right now:  node server.js --mock');
    console.log(bar + '\n');
    return;
  }

  if (!yahoo.connected) {
    console.log(`\n  Not signed in to Yahoo yet — opening the consent screen…`);
    console.log(`  If it does not open, visit: http://localhost:${PORT}/auth`);
    console.log(bar + '\n');
    openBrowser(`http://localhost:${PORT}/auth`);
  } else {
    console.log(`\n  Yahoo: connected (refresh token on disk).`);
    console.log(`  Re-authorise any time at http://localhost:${PORT}/auth`);
    console.log(bar + '\n');
    openBrowser(`http://localhost:${PORT}/`);
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Close the other server, or run:\n  node server.js --port=8001\n`);
    process.exit(1);
  }
  throw e;
});
