import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut } from './helpers.mjs';
import { newPlayerState, clearNode, checkClear, applyDailyReset } from '../src/core/state.js';
import {
  fieldSupplyLimits,
  previewSupplyRequisition, useSupplyRequisition,
  previewSupplyTutoring, useSupplyTutoring,
  previewSupplySurge, useSupplySurge
} from '../src/core/energy.js';
import { makeRng } from '../src/core/rng.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const DAY = 86400000;

test('Field Supplies use a flat storage cap and no daily use limit', () => {
  const state = newPlayerState(content, T0);
  const limits = fieldSupplyLimits(content, state);
  assert.equal(limits.storageCap, content.balance.fieldSupply.storageCap);
  assert.equal(limits.held, 0);
  assert.equal('dailyUseCap' in limits, false);
});

test('Requisition pays the guaranteed yield of the best cleared source, atomically', () => {
  const state = newPlayerState(content, T0);
  const party = state.parties[0].members;
  state.inventory.resources.field_supply = 1;
  const material = content.nodeById.main_1.material;
  // no cleared source yet
  assert.equal(previewSupplyRequisition(content, state, material).ok, false);
  assert.ok(clearNode(content, state, 'main_1', party.filter(Boolean), 1, makeRng(2), T0).ok);
  const preview = previewSupplyRequisition(content, state, material);
  assert.equal(preview.ok, true);
  // 30 Energy of the ordinary source: 5 runs × 1 guaranteed material
  assert.equal(preview.qty, 5);
  const before = state.inventory.materials[material] ?? 0;
  const used = useSupplyRequisition(content, state, material);
  assert.equal(used.ok, true);
  assert.equal(state.inventory.materials[material], before + 5);
  assert.equal(state.inventory.resources.field_supply ?? 0, 0);
  // no supply left: refused, nothing granted
  assert.equal(useSupplyRequisition(content, state, material).ok, false);
  assert.equal(state.inventory.materials[material], before + 5);
});

test('Tutoring grants targeted shards to revealed, unmaxed heroes only', () => {
  const state = newPlayerState(content, T0);
  state.inventory.resources.field_supply = 2;
  // an unrevealed hero cannot be tutored
  assert.equal(previewSupplyTutoring(content, state, 'char_elian').ok, false);
  const starter = content.characters.find(d => d.starting).id;
  const used = useSupplyTutoring(content, state, starter);
  assert.equal(used.ok, true);
  assert.equal(state.characters[starter].shards, content.balance.fieldSupply.shardGrant);
  // a maxed hero has no use for shards
  state.characters[starter].stars = 7;
  assert.equal(previewSupplyTutoring(content, state, starter).ok, false);
  // a revealed but unowned hero is a legitimate target
  state.characters.char_elian.revealed = true;
  assert.equal(useSupplyTutoring(content, state, 'char_elian').ok, true);
  assert.equal(state.characters.char_elian.shards, content.balance.fieldSupply.shardGrant);
});

test('Surge arms once and is spent only when it carries an attempt', () => {
  const state = newPlayerState(content, T0);
  const party = state.parties[0].members.filter(Boolean);
  state.inventory.resources.field_supply = 2;
  assert.equal(useSupplySurge(content, state).ok, true);
  assert.equal(previewSupplySurge(content, state).ok, false); // one armed at a time
  const node = content.nodeById.main_1;
  const oldThreshold = node.threshold;
  try {
    // a gate just past the party's own power: the Surge carries it
    const base = checkClear(content, state, 'main_1', party, 1);
    node.threshold = base.evalResult.effectivePower + 1;
    const check = checkClear(content, state, 'main_1', party, 1);
    assert.equal(check.ok, true);
    assert.equal(check.surgeApplied, true);
    const r = clearNode(content, state, 'main_1', party, 1, makeRng(2), T0);
    assert.equal(r.ok, true);
    assert.equal(r.rewards.surgeUsed, true);
    assert.equal(state.surge, null);
    // re-arm; an attempt the party passes alone leaves the Surge armed
    node.threshold = oldThreshold;
    assert.equal(useSupplySurge(content, state).ok, true);
    const r2 = clearNode(content, state, 'main_1', party, 1, makeRng(3), T0);
    assert.equal(r2.rewards.surgeUsed, false);
    assert.ok(state.surge);
  } finally {
    node.threshold = oldThreshold;
  }
});

test('Frontier Momentum returns only actual first-clear Energy up to its daily cap', () => {
  const state = newPlayerState(content, T0);
  const party = state.parties[0].members;
  maxOut(content, state, party);
  state.energySystems.daily.momentumRefunded = 28;
  const result = clearNode(content, state, 'main_1', party, 1, makeRng(2), T0);
  assert.equal(result.ok, true);
  assert.equal(result.rewards.energySpent, 6);
  assert.equal(result.rewards.energyRefunded, 2);
  assert.equal(state.energy, 116);
  const repeat = clearNode(content, state, 'main_1', party, 1, makeRng(3), T0);
  assert.equal(repeat.rewards.energyRefunded, 0);
  applyDailyReset(content, state, T0 + DAY);
  assert.equal(state.energySystems.daily.momentumRefunded, 0);
});
