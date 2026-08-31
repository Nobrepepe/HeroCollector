import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crisisAsking, crisisNotice, countWord, sceneImage,
  partyHeadline, bestPartySwap
} from '../src/ui/presentation.js';
import { loadContent, maxOut, newGame } from './helpers.mjs';
import { evaluateParty } from '../src/core/synergy.js';

test('Today carries the Crisis and nothing else: it asks while unresolved, and again for its Cache', () => {
  const planning = { crises: { active: { definitionId: 'c', worldId: 'w', status: 'planning', name: 'The Sundering Ward' } } };
  assert.equal(crisisNotice(planning).verb, 'Review it →');
  assert.match(crisisNotice(planning).text, /open until reset/);

  const cache = { crises: { active: { worldId: 'w', status: 'resolved', result: { outcome: 'held' }, cacheClaimed: false, name: 'The Sundering Ward' } } };
  assert.equal(crisisNotice(cache).verb, 'Open the Cache →');

  const settled = { crises: { active: { worldId: 'w', status: 'resolved', result: { outcome: 'held' }, cacheClaimed: true, name: 'The Sundering Ward' } } };
  assert.equal(crisisNotice(settled), null, 'a claimed Cache asks for nothing');
  assert.equal(crisisNotice({}), null, 'no Crisis, no notice');
});

test('crisisAsking scopes to one world so the hub and Today cannot disagree', () => {
  const state = { crises: { active: { worldId: 'w', status: 'planning', name: 'A Crisis' } } };
  assert.ok(crisisAsking(state, 'w'));
  assert.equal(crisisAsking(state, 'other'), null);
  assert.equal(crisisAsking({ crises: { active: { worldId: 'w', status: 'endured' } } }, 'w'), null);
});

test("Today's headline counts Energy in words all the way to the storage cap", () => {
  assert.equal(countWord(96, { capitalize: true }), 'Ninety-six');
  assert.equal(countWord(40), 'forty');
  assert.equal(countWord(240), 'two hundred and forty');
  assert.equal(countWord(0), 'no', 'zero keeps the sentence reading');
  assert.equal(countWord(9), 'nine');
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
