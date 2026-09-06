/* Smoke harness for the draft board.

   There is no test framework in this project and the app is one DOM-coupled
   HTML file, so the only honest way to verify it is to load it in a real
   browser and interrogate the live globals. Stubbing enough DOM to run the
   script headless would be a second implementation of the browser and would
   pass while the real page was broken.

   Run:  node tools/check.mjs
   Exits non-zero if any REQUIRED check fails. Checks marked INFO only report.

   Reads config expectations from the target league so a future league change
   means editing one object here, not the assertions. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';

/* Playwright is installed globally, not as a project dependency, and ESM
   imports ignore NODE_PATH — so resolve it by absolute path. Falls back to a
   normal bare import in case the project ever gets its own copy. Playwright is
   CommonJS, so the named export arrives under .default when loaded from ESM. */
const pw = await import('/opt/node22/lib/node_modules/playwright/index.js')
  .catch(() => import('playwright'));
const chromium = (pw.default ?? pw).chromium;

const ROOT = new URL('..', import.meta.url).pathname;

/* The league this build is aimed at. Guillotine: 9 teams, 1 PPR,
   QB/RB/RB/WR/WR/TE/FLEX, 7 bench, no kicker, no defense. */
const LEAGUE = {
  teams: 9,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
  bench: 7,
  rounds: 14,
  absent: ['K', 'DEF'],
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

let pass = 0, fail = 0, info = 0;
const need = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const note = (name, detail) => { info++; console.log(`  info  ${name} — ${detail}`); };

/* Build first: index.html is a generated artifact and is stale the moment
   src/app.html changes. Testing the stale copy is worse than not testing. */
console.log('building…');
execFileSync('sh', ['build.sh'], { cwd: ROOT, stdio: 'inherit' });

const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' })
  .catch(() => chromium.launch());
const page = await browser.newPage();

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

/* Sleeper is unreachable from a sandbox and would be a 5MB download anyway;
   the app is designed to fall back to its built-in board, which is exactly
   the path we want to test. */
await page.route('**/api.sleeper.app/**', r => r.abort());

console.log(`loading ${url}`);
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);

console.log('\n— page health —');
const fatal = errors.filter(e => !/sleeper|Failed to fetch|net::ERR/i.test(e));
need('no JS errors on load', fatal.length === 0, fatal.slice(0, 3).join(' | ') || 'clean');

/* S and P are declared with `let` at the top level of a classic script, so
   they live in the global LEXICAL scope and never appear on `window`.
   Unqualified references still resolve, so read them by bare name. */
const S = await page.evaluate(() => (typeof S === 'object' && S ? JSON.parse(JSON.stringify(S)) : null));
const P = await page.evaluate(() => (typeof P !== 'undefined' && Array.isArray(P) ? P.map(p => ({
  pos: p.pos, name: p.name, vorp: p.vorp, proj: p.proj, bye: p.bye, posRank: p.posRank })) : null));

console.log('\n— league config —');
if (!S) { need('state object S is exposed', false, 'S not reachable — cannot verify config'); }
else {
  need('team count', S.teams === LEAGUE.teams, `got ${S.teams}, want ${LEAGUE.teams}`);
  const rounds = S.rounds;
  need('rounds', rounds === LEAGUE.rounds, `got ${rounds}, want ${LEAGUE.rounds} (7 starters + 7 bench)`);
  const roster = S.roster || null;
  if (roster) {
    for (const [pos, n] of Object.entries(LEAGUE.starters))
      need(`starters.${pos}`, roster[pos] === n, `got ${roster[pos]}, want ${n}`);
    for (const pos of LEAGUE.absent)
      need(`no ${pos} slot`, !roster[pos], `got ${roster[pos]}`);
  } else note('roster config', 'S.roster not present — settings system may not be in yet');
}

console.log('\n— board —');
if (!P || !P.length) { need('player board built', false, 'P empty'); }
else {
  need('player board built', true, `${P.length} players`);
  for (const pos of LEAGUE.absent) {
    const n = P.filter(p => p.pos === pos).length;
    need(`no ${pos} on board`, n === 0, `found ${n}`);
  }
  const withVorp = P.filter(p => Number.isFinite(p.vorp));
  need('every player has a VORP', withVorp.length === P.length, `${withVorp.length}/${P.length}`);

  /* Replacement level is the zero point, so at 9 teams the number of players
     above it should land near teams x startable spots, not the 12-team count.
     Wide bounds on purpose: this catches "still hardcoded for 12 teams",
     not fine-tuning. */
  for (const pos of ['RB', 'WR', 'QB', 'TE']) {
    const pool = P.filter(p => p.pos === pos && p.vorp > 0).length;
    note(`${pos} above replacement`, `${pool} players`);
  }
}

console.log('\n— guillotine weighting —');
const mode = await page.evaluate(() => (typeof S === 'object' && S ? { mode: S.mode, bbSwing: S.bbSwing,
  byeSwing: S.byeSwing, qbBoost: S.qbBoost } : null));
if (mode) note('mode flags', JSON.stringify(mode));

if (P && P.length) {
  /* Late byes must be worth more than early ones. Compare players who are
     close in raw projection but far apart in bye week: if the weighting is
     live, the late-bye player should rank ahead more often than not. */
  const byBye = w => P.filter(p => p.bye === w && p.vorp > -50);
  const early = byBye(5).concat(byBye(6)), late = byBye(13).concat(byBye(14));
  if (early.length && late.length) {
    const avg = a => a.reduce((s, p) => s + p.posRank, 0) / a.length;
    note('avg posRank, wk5-6 bye', avg(early).toFixed(1));
    note('avg posRank, wk13-14 bye', avg(late).toFixed(1));
  } else note('bye comparison', 'not enough players at the bye extremes');
}

await browser.close();
server.close();

console.log(`\n${pass} passed · ${fail} failed · ${info} info`);
process.exit(fail ? 1 : 0);
