/* ===========================================================================
   Offline / mock mode.

   The live Yahoo path cannot be verified until the draft actually starts, so
   this exists to de-risk it: `node server.js --mock` serves the exact same four
   endpoints with canned data, no Yahoo account, no network. The frontend can be
   built and tested against it tonight.

   The mock runs a *live* snake draft: a new pick lands every few seconds, so
   polling, pick ordering, slot assignment and "player went off the board"
   behaviour all get exercised for real.

   Player names come from mock-players.json, which was extracted from the app's
   own baseline board — so every mock pick joins cleanly against the frontend's
   built-in player list.
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardKey } from './yahoo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const POOL = JSON.parse(fs.readFileSync(path.join(HERE, 'mock-players.json'), 'utf8'));

const LEAGUE_KEY = '461.l.999999';

/* Deterministic PRNG so a restart replays the same draft — much easier to
   debug against than a different random board every time. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class MockDraft {
  constructor({ teams = 12, rounds = 16, slot = 7, scoring = 1, secondsPerPick = 8, startingPicks = 0 } = {}) {
    this.teams = teams;
    this.rounds = rounds;
    this.slot = slot;
    this.scoring = scoring;
    this.secondsPerPick = secondsPerPick;
    this.startedAt = Date.now() - startingPicks * secondsPerPick * 1000;
    this.order = this._buildOrder();
  }

  /* Draft the board roughly in rank order, but with real-draft noise: some
     players are reached for, some slide. Positional runs happen naturally
     because we pull from a shifting window near the top of the board. */
  _buildOrder() {
    const rand = rng(20260906);
    const pool = POOL.slice();
    const total = Math.min(this.teams * this.rounds, pool.length);
    const out = [];

    for (let i = 0; i < total; i++) {
      // Window of the next few available players; occasionally reach deeper.
      const reach = rand() < 0.12 ? 12 : 4;
      const idx = Math.min(pool.length - 1, Math.floor(rand() * reach));
      const p = pool.splice(idx, 1)[0];

      const pickNo = i + 1;
      const round = Math.floor(i / this.teams) + 1;
      // Snake: odd rounds left-to-right, even rounds right-to-left.
      const inRound = i % this.teams;
      const draftSlot = round % 2 === 1 ? inRound + 1 : this.teams - inRound;

      out.push({
        pick_no: pickNo,
        round,
        draft_slot: draftSlot,
        player_id: `nfl.p.${900000 + i}`,
        name: p.name,
        position: p.pos,
        team: p.team,
      });
    }
    return out;
  }

  /* How many picks have "happened" so far. */
  made() {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    return Math.max(0, Math.min(this.order.length, Math.floor(elapsed / this.secondsPerPick)));
  }

  leagues() {
    return [{
      league_id: LEAGUE_KEY,
      league_key: LEAGUE_KEY,
      name: 'MOCK — Sunday Night Sicko League',
      total_rosters: this.teams,
      season: String(new Date().getFullYear()),
      draft_status: 'drafting',
      url: null,
    }];
  }

  draftInfo() {
    return {
      league_key: LEAGUE_KEY,
      name: 'MOCK — Sunday Night Sicko League',
      teams: this.teams,
      rounds: this.rounds,
      slot: this.slot,
      scoring: this.scoring,
      draft_status: 'drafting',
      mock: true,
    };
  }

  picks() {
    return this.order.slice(0, this.made());
  }

  /* key -> {team, rank, adp, injury}, same shape as the live endpoint. `rank`
     is a 1..N overall scale, exactly like Yahoo's O-Rank. `adp` is deliberately
     offset from rank by a few spots so the frontend has two genuinely different
     signals to blend, rather than two copies of the same number. A handful of
     fake injuries so the injury rendering has something to show. */
  playersByKey() {
    const injuries = ['Questionable', 'Doubtful', 'Out', 'IR'];
    const rand = rng(77777);
    const map = {};
    POOL.forEach((p, i) => {
      const k = boardKey(p.name, p.pos, p.team);
      const drift = Math.round((rand() - 0.5) * Math.max(4, p.rank * 0.18));
      map[k] = {
        team: p.team,
        rank: p.rank,
        adp: Math.max(1, p.rank + drift),
        injury: i % 37 === 5 ? injuries[i % injuries.length] : null,
      };
    });
    return map;
  }

  reset(startingPicks = 0) {
    this.startedAt = Date.now() - startingPicks * this.secondsPerPick * 1000;
  }
}
