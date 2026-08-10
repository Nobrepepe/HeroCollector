import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankTodayHook, todayHookText, relicPieceModel, collectionSummary, sceneImage,
  partyHeadline, bestPartySwap
} from '../src/ui/presentation.js';
import { loadContent, maxOut } from './helpers.mjs';
import { newPlayerState } from '../src/core/state.js';
import { evaluateParty } from '../src/core/synergy.js';
import { IMAGE_KINDS } from '../src/ui/images.js';

test('Today chooses the smallest remaining shard gap with stable content-order ties', () => {
  const content = {
    characters: [
      { id: 'a', displayName: 'Ashley', tier: 'minor' },
      { id: 'b', displayName: 'Bridget', tier: 'minor' }
    ],
    balance: {
      starShards: [10, 25, 50, 75, 110, 150, 200],
      acquisitionTiers: { minor: { cumulativeShards: 10 } }
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

test('Today falls through to gear, campaign, then quiet', () => {
  const content = {
    characters: [{ id: 'a', displayName: 'Ashley', tier: 'minor' }],
    characterById: { a: { id: 'a', displayName: 'Ashley' } },
    balance: {
      starShards: [10, 25, 50, 75, 110, 150, 200],
      acquisitionTiers: { minor: { cumulativeShards: 10 } }
    }
  };
  const maxed = { characters: { a: { owned: true, stars: 7, shards: 0 } } };
  assert.equal(rankTodayHook(content, maxed, [{ type: 'completeTier', characterId: 'a' }], []).kind, 'gear');
  assert.equal(rankTodayHook(content, maxed, [], [{ id: 'n', displayName: 'Gate', threshold: 100 }]).kind, 'campaign');
  assert.equal(rankTodayHook(content, maxed, [], []).kind, 'quiet');
});

test('an unresolved Crisis outranks every ordinary Today hook', () => {
  const content = {
    characters: [{ id: 'a', displayName: 'Ashley', tier: 'minor' }],
    characterById: { a: { id: 'a', displayName: 'Ashley' } }, crisisById: { c: { id: 'c' } },
    balance: { starShards: [10], acquisitionTiers: { minor: { cumulativeShards: 10 } } }
  };
  const state = { characters: { a: { owned: true, stars: 1, shards: 0 } },
    crises: { active: { definitionId: 'c', status: 'planning', name: 'A Crisis' } } };
  const hook = rankTodayHook(content, state, [{ type: 'completeTier', characterId: 'a' }], [{ id: 'n', threshold: 1 }]);
  assert.equal(hook.kind, 'crisis');
  assert.equal(todayHookText(hook).route, '#/crisis');
});

test('relic model keeps authored fragment order as left then right', () => {
  const relic = {
    fragments: [{ id: 'f1', sourceNode: 'n1' }, { id: 'f2', sourceNode: 'n2' }]
  };
  const store = {
    state: { archive: { fragments: { f2: true } } },
    content: { nodeById: { n1: { id: 'n1' }, n2: { id: 'n2' } } }
  };
  assert.deepEqual(relicPieceModel(store, relic).map(piece => [piece.side, piece.owned]), [
    ['left', false], ['right', true]
  ]);
});

test('collection and scene presentation helpers cover partial and missing art', () => {
  assert.equal(collectionSummary({
    relics: [{ complete: true, owned: 2 }, { complete: false, owned: 1 }, { complete: false, owned: 0 }]
  }), '1 whole, 1 half-found, 1 still buried');
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
  const state = newPlayerState(content, Date.parse('2026-07-24T12:00:00Z'));
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

test('portrait imports use a 16:9 alpha-preserving canvas', () => {
  const { w, h, contain, preserveAlpha } = IMAGE_KINDS.portrait;
  assert.equal(w / h, 16 / 9, 'portraits are letterboxed into a 16:9 tile');
  assert.equal(contain, true, 'portraits are contained, never cropped');
  assert.equal(preserveAlpha, true, 'portraits keep their transparency');
  // The tile is never drawn wider than ~250 CSS px, so anything past 1280 is
  // storage spent on pixels no display can show.
  assert.ok(w >= 512 && w <= 1280, `portrait width ${w} is outside the sane range`);
});
