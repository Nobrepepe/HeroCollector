import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut } from './helpers.mjs';
import { newPlayerState, clearNode, applyDailyReset } from '../src/core/state.js';
import { fieldSupplyLimits, previewFieldSupplyUse, useFieldSupply } from '../src/core/energy.js';
import { makeRng } from '../src/core/rng.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const DAY = 86400000;

test('Field Supply limits use only the highest Training facility and restore atomically', () => {
  const state = newPlayerState(content, T0);
  assert.deepEqual({ storage: fieldSupplyLimits(content, state).storageCap, uses: fieldSupplyLimits(content, state).dailyUseCap }, { storage: 2, uses: 1 });
  for (const world of content.worlds) {
    const training = world.hq.facilities.find(f => f.category === 'training');
    state.headquarters.worlds[world.id] = { facilities: { [training.id]: world === content.worlds[0] ? 2 : 1 }, production: {}, staff: {}, claimedRanks: [] };
  }
  assert.deepEqual({ storage: fieldSupplyLimits(content, state).storageCap, uses: fieldSupplyLimits(content, state).dailyUseCap }, { storage: 3, uses: 2 });
  state.inventory.resources.field_supply = 1;
  state.energy = 222;
  assert.deepEqual({ restored: previewFieldSupplyUse(content, state).restored, wasted: previewFieldSupplyUse(content, state).wasted }, { restored: 18, wasted: 12 });
  assert.equal(useFieldSupply(content, state).restored, 18);
  assert.equal(state.energy, 240);
  assert.equal(state.inventory.resources.field_supply ?? 0, 0);
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
