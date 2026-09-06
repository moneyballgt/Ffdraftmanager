/* ===========================================================================
   Self-test:  node selftest.js

   The live Yahoo path cannot be exercised without a real account and a real
   draft, so this drives the whole live code path against fixtures that
   reproduce Yahoo's actual JSON shapes — the numeric-string containers, the
   arrays-of-single-key-objects, the metadata-and-subresource-at-sibling-indexes.

   If Yahoo behaves the way these fixtures say it does, the parsing is correct.
   If something is wrong on draft night, add the real response as a fixture here
   and this will tell you exactly which helper broke.
   =========================================================================== */

import { Yahoo, collect, merge, entities, norm, boardKey, shapePlayer } from './yahoo.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '\n         got: ' + JSON.stringify(extra) : '')); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), a);

/* --------------------------------------------------------------------------
   Fixtures — shaped like real Yahoo responses.
   -------------------------------------------------------------------------- */

const FX = {};

FX['game/nfl'] = {
  fantasy_content: {
    game: [{ game_key: '461', game_id: '461', name: 'Football', code: 'nfl', season: '2026' }],
  },
};

FX['users;use_login=1/games;game_keys=nfl/leagues'] = {
  fantasy_content: {
    users: {
      0: {
        user: [
          { guid: 'ABCDEF' },
          {
            games: {
              0: {
                game: [
                  { game_key: '461', code: 'nfl', season: '2026' },
                  {
                    leagues: {
                      0: { league: [{ league_key: '461.l.123456', league_id: '123456', name: 'Sunday Sickos', num_teams: '12', draft_status: 'predraft', season: '2026', url: 'https://x' }] },
                      1: { league: [{ league_key: '461.l.777', league_id: '777', name: 'Work League', num_teams: '10', draft_status: 'postdraft', season: '2026', url: 'https://y' }] },
                      count: 2,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

FX['league/461.l.123456/settings'] = {
  fantasy_content: {
    league: [
      { league_key: '461.l.123456', league_id: '123456', name: 'Sunday Sickos', num_teams: '12', draft_status: 'drafting' },
      {
        settings: [{
          draft_type: 'live',
          scoring_type: 'head',
          roster_positions: [
            { roster_position: { position: 'QB', count: 1 } },
            { roster_position: { position: 'WR', count: 3 } },
            { roster_position: { position: 'RB', count: 2 } },
            { roster_position: { position: 'TE', count: 1 } },
            { roster_position: { position: 'W/R/T', count: 1 } },
            { roster_position: { position: 'K', count: 1 } },
            { roster_position: { position: 'DEF', count: 1 } },
            { roster_position: { position: 'BN', count: 6 } },
            { roster_position: { position: 'IR', count: 2 } },   // must NOT count
          ],
          stat_categories: { stats: [{ stat: { stat_id: 11, name: 'Receptions', display_name: 'Rec' } }] },
          stat_modifiers: {
            stats: [
              { stat: { stat_id: 5, value: '4' } },
              { stat: { stat_id: 11, value: '0.5' } },   // half PPR
            ],
          },
        }],
      },
    ],
  },
};

FX['league/461.l.123456/teams'] = {
  fantasy_content: {
    league: [
      { league_key: '461.l.123456' },
      {
        teams: {
          0: { team: [[{ team_key: '461.l.123456.t.1' }, { name: 'Team One' }, { is_owned_by_current_login: 0 }]] },
          1: { team: [[{ team_key: '461.l.123456.t.5' }, { name: 'My Squad' }, { is_owned_by_current_login: 1 }]] },
          count: 2,
        },
      },
    ],
  },
};

FX['league/461.l.123456/draft_results'] = {
  fantasy_content: {
    league: [
      { league_key: '461.l.123456' },
      {
        draft_results: {
          0: { draft_result: { pick: 1, round: 1, team_key: '461.l.123456.t.3', player_key: 'nfl.p.1' } },
          1: { draft_result: { pick: 2, round: 1, team_key: '461.l.123456.t.5', player_key: 'nfl.p.2' } },
          2: { draft_result: { pick: 3, round: 1, team_key: '461.l.123456.t.1', player_key: 'nfl.p.3' } },
          3: { draft_result: { pick: 4, round: 2, team_key: '461.l.123456.t.1', player_key: 'nfl.p.4' } },
          count: 4,
        },
      },
    ],
  },
};

/* The player collection. Note the double-nested array under "player" and the
   split-across-single-key-objects metadata — this is what Yahoo really sends. */
function playerNode(o) {
  return {
    player: [[
      { player_key: o.key },
      { player_id: String(o.key).split('.').pop() },
      { name: { full: o.name, first: o.name.split(' ')[0], last: o.name.split(' ').slice(1).join(' ') } },
      { editorial_team_abbr: o.team },
      { bye_weeks: { week: '6' } },
      ...(o.status ? [{ status: o.status }, { status_full: o.statusFull }] : []),
      { display_position: o.pos },
      { position_type: o.posType || 'O' },
      { eligible_positions: [{ position: o.pos }] },
    ],
    // The draft_analysis subresource, as Yahoo nests it. Absent entirely when
    // the ;out=draft_analysis filter was not accepted.
    ...(o.adp === undefined ? [] : [{ draft_analysis: [{ average_pick: o.adp }, { average_round: '1.0' }] }]),
    ],
  };
}

const ROSTER = [
  { key: 'nfl.p.1', name: "Ja'Marr Chase", team: 'Cin', pos: 'WR', adp: '1.4' },
  { key: 'nfl.p.2', name: 'Kenneth Walker III', team: 'Sea', pos: 'RB', adp: '18.9' },
  { key: 'nfl.p.3', name: 'Amon-Ra St. Brown', team: 'Det', pos: 'WR', status: 'Q', statusFull: 'Questionable', adp: '9.2' },
  { key: 'nfl.p.4', name: 'San Francisco', team: 'SF', pos: 'DEF', posType: 'DT', adp: '140.0' },
  { key: 'nfl.p.5', name: 'Marvin Harrison Jr.', team: 'Ari', pos: 'WR', adp: '22.5' },
  { key: 'nfl.p.6', name: 'Deebo Samuel', team: 'Wsh', pos: 'RB,WR', adp: '77.1' },   // multi-position
];

/* Serve the roster 25-at-a-time exactly as Yahoo does. */
function playersPage(start, count, withAdp = true) {
  const slice = ROSTER.slice(start, start + count);
  const players = { count: slice.length };
  slice.forEach((p, i) => { players[i] = playerNode(withAdp ? p : { ...p, adp: undefined }); });
  return { fantasy_content: { league: [{ league_key: '461.l.123456' }, { players }] } };
}

/* --------------------------------------------------------------------------
   Wire the fixtures in place of the network.
   -------------------------------------------------------------------------- */

const yf = new Yahoo({ clientId: 'x', clientSecret: 'y', redirectUri: 'http://localhost:8000/callback', dataDir: '/tmp/__selftest_nowhere' });
yf.tok = { access_token: 'fake', refresh_token: 'fake', expires_at: Date.now() + 3600e3 };
yf._saveTokens = () => {};          // never touch disk in a test
yf.playerMap = async (lk, o) => Yahoo.prototype.playerMap.call(yf, lk, { ...o, maxAgeMs: 0, force: true });

const calls = [];
/* Flip these to simulate Yahoo rejecting the optional filters. */
const reject = { draft_analysis: false, sort: false };
yf.api = async p => {
  calls.push(p);
  if (reject.draft_analysis && /out=draft_analysis/.test(p)) throw new Error('400 invalid out');
  if (reject.sort && /sort=OR/.test(p)) throw new Error('400 invalid sort');
  const m = p.match(/players.*;start=(\d+);count=(\d+)/);
  if (m) return playersPage(Number(m[1]), Number(m[2]), /out=draft_analysis/.test(p));
  if (/players;player_keys=/.test(p)) return playersPage(0, ROSTER.length, true);
  if (FX[p]) return FX[p];
  if (p.startsWith('game/461/stat_categories')) {
    return { fantasy_content: { game: [{ game_key: '461' }, { stat_categories: { stats: [
      { stat: { stat_id: 5, name: 'Passing Touchdowns', display_name: 'Pass TD' } },
      { stat: { stat_id: 11, name: 'Receptions', display_name: 'Rec' } },
    ] } }] } };
  }
  throw new Error('no fixture for: ' + p);
};
// The disk cache would defeat the point of the test.
yf._cacheFile = () => '/tmp/__selftest_nowhere/nope.json';

/* --------------------------------------------------------------------------
   Tests
   -------------------------------------------------------------------------- */

console.log('\nparsing helpers');
eq('collect finds nested keys', collect(FX['users;use_login=1/games;game_keys=nfl/leagues'], 'league').length, 2);
eq('merge flattens array-of-single-key-objects',
   merge(playerNode(ROSTER[0]).player).player_key, 'nfl.p.1');
eq('merge drops count', merge({ 0: { a: 1 }, count: 9 }).count, undefined);
eq('entities on a bare game', entities(FX['game/nfl'], 'game')[0].game_key, '461');

console.log('\nname normalisation (must match src/app.html)');
eq('suffix dropped as a token', norm('Kenneth Walker III'), 'kennethwalker');
eq('punctuation stripped', norm("Ja'Marr Chase"), 'jamarrchase');
eq('period + hyphen', norm('Amon-Ra St. Brown'), 'amonrastbrown');
eq('Jr. dropped', norm('Marvin Harrison Jr.'), 'marvinharrison');
eq('board key for a skill player', boardKey("Ja'Marr Chase", 'WR', 'CIN'), 'jamarrchase_WR');
eq('board key for a defense', boardKey('San Francisco', 'DEF', 'SF'), 'def_SF');

console.log('\nplayer shaping');
const sfDef = shapePlayer(merge(playerNode(ROSTER[3]).player));
eq('defense position', sfDef.position, 'DEF');
eq('defense key', sfDef.key, 'def_SF');
const deebo = shapePlayer(merge(playerNode(ROSTER[5]).player));
eq('multi-position takes the first known', deebo.position, 'RB');
eq('team abbreviation normalised Wsh -> WAS', deebo.team, 'WAS');
const arsb = shapePlayer(merge(playerNode(ROSTER[2]).player));
eq('injury uses the long form', arsb.injury, 'Questionable');

const run = async () => {
  console.log('\nendpoints');

  const lgs = await yf.leagues();
  eq('two leagues found', lgs.length, 2);
  eq('league_id carries the full league key', lgs[0].league_id, '461.l.123456');
  eq('total_rosters is a number', lgs[0].total_rosters, 12);
  eq('name', lgs[0].name, 'Sunday Sickos');

  const d = await yf.draftInfo('461.l.123456');
  eq('teams', d.teams, 12);
  eq('rounds = roster slots excluding IR', d.rounds, 16);
  eq('scoring reads the reception modifier', d.scoring, 0.5);
  eq('slot = my team\'s round-1 pick', d.slot, 2);

  const map = await yf.playersByKey('461.l.123456');
  eq('player map keyed the way the board is', map['jamarrchase_WR'], { team: 'CIN', rank: 1, adp: 1.4, injury: null });
  eq('rank follows Yahoo listing order', map['kennethwalker_RB'].rank, 2);
  eq('defense in the map', map['def_SF'], { team: 'SF', rank: 4, adp: 140, injury: null });
  eq('injury carried through', map['amonrastbrown_WR'].injury, 'Questionable');
  eq('Yahoo ADP carried through', map['jamarrchase_WR'].adp, 1.4);
  ok('every entry has a populated rank',
     Object.values(map).every(v => typeof v.rank === 'number' && v.rank >= 1),
     Object.entries(map).filter(([, v]) => typeof v.rank !== 'number'));
  ok('rank is a dense 1..N overall scale',
     JSON.stringify(Object.values(map).map(v => v.rank).sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5, 6]),
     Object.values(map).map(v => v.rank));
  ok('players are listed with sort=OR (overall rank), not Yahoo default',
     calls.some(c => /players;sort=OR/.test(c)), calls.filter(c => c.includes('players')));
  ok('draft analysis requested in the same round trips',
     calls.some(c => /out=draft_analysis/.test(c)), calls.filter(c => c.includes('players')));

  const picks = await yf.picks('461.l.123456');
  eq('four picks', picks.length, 4);
  eq('sorted by pick_no', picks.map(p => p.pick_no), [1, 2, 3, 4]);
  eq('player_key resolved to a name', picks[0].name, "Ja'Marr Chase");
  eq('position resolved', picks[0].position, 'WR');
  eq('team normalised', picks[0].team, 'CIN');
  eq('draft_slot learned from round 1', picks[3].draft_slot, 3);
  eq('defense pick shaped for the board', picks[3].name, 'San Francisco');

  console.log('\npagination');
  const pageCalls = calls.filter(c => /players;start=/.test(c));
  ok('paged the player collection 25 at a time', pageCalls.every(c => /count=25/.test(c)), pageCalls);

  console.log('\ngraceful degradation when Yahoo rejects the optional filters');
  reject.draft_analysis = true;
  calls.length = 0;
  const noAdp = await yf.playersByKey('461.l.123456');
  ok('falls back to sort=OR alone', calls.some(c => /players;sort=OR;start=/.test(c)), calls.slice(0, 3));
  eq('rank still populated without draft_analysis', noAdp['jamarrchase_WR'].rank, 1);
  eq('adp is null rather than missing', noAdp['jamarrchase_WR'].adp, null);

  reject.sort = true;
  calls.length = 0;
  const plain = await yf.playersByKey('461.l.123456');
  ok('falls back to a plain listing', calls.some(c => /players;start=0/.test(c)), calls.slice(0, 4));
  eq('rank still populated with no filters at all', plain['jamarrchase_WR'].rank, 1);
  reject.draft_analysis = false; reject.sort = false;

  console.log('\npolling is cheap');
  calls.length = 0;
  // Restore the real caching behaviour for this check.
  yf.playerMap = Yahoo.prototype.playerMap.bind(yf);
  yf.playerCache.set('461.l.123456', { builtAt: Date.now(), count: 6, byKey: {}, players: Object.fromEntries(ROSTER.map(r => [r.key, shapePlayer(merge(playerNode(r).player))])) });
  await yf.picks('461.l.123456');
  eq('a poll costs exactly one Yahoo call', calls, ['league/461.l.123456/draft_results']);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error('\nselftest crashed:', e); process.exit(1); });
