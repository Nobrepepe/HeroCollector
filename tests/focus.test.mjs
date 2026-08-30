// Development Focus: deterministic, allocation-driven shard generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, newGame } from './helpers.mjs';
import { clearNode } from '../src/core/state.js';
import { makeRng } from '../src/core/rng.js';
import {
  FOCUS_SLOTS, assignFocus, clearFocusSlot, focusStatus, applyFocusEnergy,
  revealCharacter, isRevealed
} from '../src/core/focus.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');

function readyState() {
  const state = newGame(content, T0);
  return state;
}

test('120 Energy across the three slots yields exactly 12 shards', () => {
  const state = readyState();
  const heroes = ['char_suzume', 'char_hoshi', 'char_ayame'];
  FOCUS_SLOTS.forEach((slot, i) => assert.equal(assignFocus(content, state, slot, heroes[i]).ok, true));
  const grants = applyFocusEnergy(content, state, 120);
  assert.deepEqual(grants, [
    { slot: 'primary', characterId: 'char_suzume', shards: 5 },
    { slot: 'secondary', characterId: 'char_hoshi', shards: 4 },
    { slot: 'longTerm', characterId: 'char_ayame', shards: 3 }
  ]);
  assert.equal(state.characters.char_suzume.shards, 5);
  // remainders carry: 120 = 5×24 exactly, 4×30 exactly, 3×40 exactly
  for (const slot of FOCUS_SLOTS) assert.equal(state.focus.slots[slot].progress, 0);
});

test('progress carries across grants and days without resetting', () => {
  const state = readyState();
  assignFocus(content, state, 'primary', 'char_suzume');
  applyFocusEnergy(content, state, 20);
  assert.equal(state.characters.char_suzume.shards, 0);
  assert.equal(state.focus.slots.primary.progress, 20);
  applyFocusEnergy(content, state, 10);
  assert.equal(state.characters.char_suzume.shards, 1);
  assert.equal(state.focus.slots.primary.progress, 6);
});

test('the same hero cannot occupy two slots; assignment moves them', () => {
  const state = readyState();
  assignFocus(content, state, 'primary', 'char_suzume');
  assignFocus(content, state, 'secondary', 'char_suzume');
  assert.equal(state.focus.slots.primary.characterId, null);
  assert.equal(state.focus.slots.secondary.characterId, 'char_suzume');
});

test('progress belongs to the slot: reassignment keeps the meter', () => {
  const state = readyState();
  assignFocus(content, state, 'primary', 'char_suzume');
  applyFocusEnergy(content, state, 20);
  assignFocus(content, state, 'primary', 'char_hoshi');
  assert.equal(state.focus.slots.primary.progress, 20);
  applyFocusEnergy(content, state, 4);
  assert.equal(state.characters.char_hoshi.shards, 1);
});

test('only revealed heroes are eligible; unowned revealed heroes bank shards', () => {
  const state = readyState();
  assert.equal(assignFocus(content, state, 'primary', 'char_elian').ok, false);
  revealCharacter(content, state, 'char_elian');
  assert.ok(isRevealed(state, 'char_elian'));
  assert.equal(assignFocus(content, state, 'primary', 'char_elian').ok, true);
  applyFocusEnergy(content, state, 48);
  assert.equal(state.characters.char_elian.shards, 2);
  assert.equal(state.characters.char_elian.owned, false);
});

test('a maxed hero halts the slot; the meter holds until someone new is assigned', () => {
  const state = readyState();
  assignFocus(content, state, 'primary', 'char_suzume');
  applyFocusEnergy(content, state, 20);
  state.characters.char_suzume.stars = 7;
  applyFocusEnergy(content, state, 100);
  assert.equal(state.characters.char_suzume.shards, 0);
  assert.equal(state.focus.slots.primary.progress, 20); // held, not lost
  assert.equal(focusStatus(content, state).find(s => s.slot === 'primary').halted, true);
  // a maxed hero cannot be newly assigned either
  assert.equal(assignFocus(content, state, 'secondary', 'char_suzume').ok, false);
  assignFocus(content, state, 'primary', 'char_hoshi');
  applyFocusEnergy(content, state, 4);
  assert.equal(state.characters.char_hoshi.shards, 1);
});

test('clearing campaign nodes feeds all three meters with the Energy actually paid', () => {
  const state = readyState();
  const party = state.parties[0].members.filter(Boolean);
  const heroes = ['char_suzume', 'char_hoshi', 'char_ayame'];
  FOCUS_SLOTS.forEach((slot, i) => assignFocus(content, state, slot, heroes[i]));
  const r = clearNode(content, state, 'main_1', party, 1, makeRng(2), T0);
  assert.equal(r.ok, true);
  for (const slot of FOCUS_SLOTS) assert.equal(state.focus.slots[slot].progress, 6);
  // clearing a slot only detaches the hero; it never grants partial shards
  clearFocusSlot(state, 'primary');
  assert.equal(state.focus.slots.primary.characterId, null);
  assert.equal(state.focus.slots.primary.progress, 6);
});
