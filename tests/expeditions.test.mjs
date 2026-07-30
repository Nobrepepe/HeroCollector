import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from './helpers.mjs';
import { newPlayerState, applyDailyReset } from '../src/core/state.js';
import { makeRng } from '../src/core/rng.js';
import {
  cancelExpedition, evaluateRequirement, generateExpeditionBoard, launchExpedition,
  offerFeasibility, previewExpedition, rerollOffer, togglePinOffer
} from '../src/core/expeditions.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const DAY = 86400000;

test('requirements and result tiers are declarative and immediate', () => {
  const state = newPlayerState(content, T0);
  const ids = content.characters.filter(d => state.characters[d.id].owned).slice(0, 2).map(d => d.id);
  const party = ids.map(id => ({ id, world: content.characterById[id].world,
    archetype: content.characterById[id].archetype, stars: 2, power: 2000 }));
  assert.equal(evaluateRequirement({ type: 'party_size', count: 2 }, party).met, true);
  assert.equal(evaluateRequirement({ type: 'combined_stars', count: 4 }, party).met, true);
  const offer = {
    partySize: 2, recommendedPower: 1,
    requirements: [{ type: 'party_size', count: 2, text: 'Send two.' }],
    optional: { type: 'distinct_archetypes', count: 1, text: 'Bring breadth.' },
    baseRewards: [{ kind: 'resource', id: 'renown', qty: 10 }]
  };
  assert.equal(previewExpedition(content, state, offer, ids).tier, 'exceptional');
});

test('board persists, has five offers, and fallback keeps offers feasible', () => {
  const state = newPlayerState(content, T0);
  const board = generateExpeditionBoard(content, state, makeRng(7), { seed: 7 });
  assert.equal(board.offers.length, 5);
  assert.ok(board.offers.filter(o => offerFeasibility(content, state, o).feasible).length >= 2);
  assert.equal(state.expeditions.board, board);
});

test('launch prevents duplicate assignment, snapshots, and cancellation is launch-day only', () => {
  const state = newPlayerState(content, T0);
  const offer = state.expeditions.board.offers.find(o => offerFeasibility(content, state, o).feasible);
  const party = offerFeasibility(content, state, offer).party;
  const launched = launchExpedition(content, state, offer.id, party);
  assert.equal(launched.ok, true);
  const other = state.expeditions.board.offers.find(o => o.partySize === party.length);
  if (other) assert.equal(launchExpedition(content, state, other.id, party).ok, false);
  assert.equal(cancelExpedition(state, launched.active.id).ok, true);
  const relaunchedOffer = state.expeditions.board.offers.find(o => offerFeasibility(content, state, o).feasible);
  const relaunched = launchExpedition(content, state, relaunchedOffer.id, offerFeasibility(content, state, relaunchedOffer).party);
  state.dayNumber++;
  assert.equal(cancelExpedition(state, relaunched.active.id).ok, false);
});

test('reroll usage and pin persistence consume the intended daily actions', () => {
  const state = newPlayerState(content, T0);
  const first = state.expeditions.board.offers[0];
  assert.equal(rerollOffer(content, state, first.id, makeRng(8)).ok, true);
  assert.equal(state.expeditions.daily.freeRerollsUsed, 1);
  const pinned = state.expeditions.board.offers[1];
  state.expeditions.daily.freePins = 1;
  assert.equal(togglePinOffer(content, state, pinned.id).ok, true);
  applyDailyReset(content, state, T0 + DAY);
  assert.ok(state.expeditions.board.offers.some(o => o.id === pinned.id));
});
