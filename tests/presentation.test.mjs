import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankTodayHook, todayHookText, sceneImage,
  partyHeadline, bestPartySwap
} from '../src/ui/presentation.js';
import { loadContent, maxOut, newGame } from './helpers.mjs';
import { evaluateParty } from '../src/core/synergy.js';

test('Today chooses the smallest remaining shard gap with stable content-order ties', () => {
  const content = {
    characters: [
      { id: 'a', displayName: 'Ashley' },
      { id: 'b', displayName: 'Bridget' }
    ],
    balance: {
      starShards: [10, 25, 50, 75, 110, 150, 200],
      rosterProgression: { recruitShards: 10 }
    }
  };
  const state = {
    characters: {
      a: { owned: true, stars: 4, shards: 65 },
      b: { owned: true, stars: 4, shards: 65 }
    }
  };
  const hook = rankTodayHook(content, state, [], []);
  assert.equal(hook.def.id, 'a');
  assert.equal(hook.gap, 45);
  assert.match(todayHookText(hook).headline, /Ashley/);
});

test('an unrecruited hero is ranked by the one recruitment cost everyone shares', () => {
  const content = {
    characters: [{ id: 'a', displayName: 'Ashley' }, { id: 'b', displayName: 'Bridget' }],
    balance: { starShards: [10, 25], rosterProgression: { recruitShards: 40 } }
  };
  const state = {
    characters: {
      a: { owned: false, stars: 0, shards: 33 },   // 7 short
      b: { owned: false, stars: 0, shards: 12 }    // 28 short
    }
  };
  const hook = rankTodayHook(content, state, [], []);
  assert.equal(hook.def.id, 'a', 'the smallest remaining gap wins');
  assert.equal(hook.need, 40, 'every hero costs the same to recruit');
  assert.equal(hook.gap, 7);
});

test('Today falls through to gear, campaign, then quiet', () => {
  const content = {
    characters: [{ id: 'a', displayName: 'Ashley' }],
    characterById: { a: { id: 'a', displayName: 'Ashley' } },
    balance: {
      starShards: [10, 25, 50, 75, 110, 150, 200],
      rosterProgression: { recruitShards: 10 }
    }
  };
  const maxed = { characters: { a: { owned: true, stars: 7, shards: 0 } } };
  assert.equal(rankTodayHook(content, maxed, [{ type: 'completeTier', characterId: 'a' }], []).kind, 'gear');
  assert.equal(rankTodayHook(content, maxed, [], [{ id: 'n', displayName: 'Gate', threshold: 100 }]).kind, 'campaign');
  assert.equal(rankTodayHook(content, maxed, [], []).kind, 'quiet');
});

test('an unresolved Crisis outranks every ordinary Today hook', () => {
  const content = {
    characters: [{ id: 'a', displayName: 'Ashley' }],
    characterById: { a: { id: 'a', displayName: 'Ashley' } }, crisisById: { c: { id: 'c' } },
    balance: { starShards: [10], rosterProgression: { recruitShards: 10 } }
  };
  const state = { characters: { a: { owned: true, stars: 1, shards: 0 } },
    crises: { active: { definitionId: 'c', status: 'planning', name: 'A Crisis' } } };
  const hook = rankTodayHook(content, state, [{ type: 'completeTier', characterId: 'a' }], [{ id: 'n', threshold: 1 }]);
  assert.equal(hook.kind, 'crisis');
  assert.equal(todayHookText(hook).route, '#/crisis');
});

test('scene presentation helpers cover partial and missing art', () => {
  const store = {
    content: {
      worlds: [{ id: 'w' }],
      images: { world: { w: 'data:image/webp;base64,abc' }, chapter: { 'wc_w:2': 'data:image/webp;base64,chapter' } }
    }
  };
  assert.equal(sceneImage(store, { world: 'w', campaign: 'wc_w', chapter: 2 }), 'data:image/webp;base64,chapter');
  assert.equal(sceneImage(store, { world: 'w' }), 'data:image/webp;base64,abc');
  assert.equal(sceneImage({ content: { worlds: [], images: { world: {} } } }), null);
});

test('party presentation covers empty, incomplete, and complete headlines', () => {
  const evaluation = { capped: false, cappedBp: 800 };
  assert.equal(partyHeadline(evaluation, 0), 'No one is standing with you yet.');
  assert.equal(partyHeadline(evaluation, 3), '3 of five are standing together.');
  assert.equal(partyHeadline(evaluation, 5), 'They are pulling +8% together.');
  assert.match(partyHeadline({ capped: true, cappedBp: 2500 }, 5), /cap is holding/);
});

test('best party swap fills empty slots and chooses a legal positive improvement', () => {
  const content = loadContent();
  const state = newGame(content, Date.parse('2026-07-24T12:00:00Z'));
  const slots = [...state.parties[0].members];
  slots[4] = null;
  assert.deepEqual(bestPartySwap(content, state, slots), { kind: 'empty', slotIndex: 4 });

  const incoming = content.characters.find(def => !slots.includes(def.id) && !state.characters[def.id].owned);
  state.characters[incoming.id].owned = true;
  maxOut(content, state, [incoming.id]);
  const full = [...state.parties[0].members];
  const recommendation = bestPartySwap(content, state, full);
  assert.equal(recommendation.kind, 'swap');
  assert.equal(recommendation.incomingId, incoming.id);
  assert.ok(recommendation.effectiveGain > 0);
  const next = [...full];
  next[recommendation.slotIndex] = recommendation.incomingId;
  assert.equal(new Set(next).size, next.length);
  assert.ok(evaluateParty(content, state, next).effectivePower > evaluateParty(content, state, full).effectivePower);
});
