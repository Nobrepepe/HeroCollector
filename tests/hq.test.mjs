import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from './helpers.mjs';
import { newPlayerState, applyDailyReset } from '../src/core/state.js';
import { addResource, resourceQty } from '../src/core/resources.js';
import {
  assignHqStaff, cancelConstruction, facilityLevel, hqRank, setProduction,
  startConstruction, staffingCapacity
} from '../src/core/hq.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const DAY = 86400000;
const world = content.worldById.world_hidden_village;
const operations = world.hq.facilities.find(f => f.category === 'operations');
const production = world.hq.facilities.find(f => f.category === 'production');
const community = world.hq.facilities.find(f => f.category === 'community');

function funded() {
  const state = newPlayerState(content, T0);
  addResource(state, 'renown', 5000);
  addResource(state, world.worldAsset.id, 500);
  return state;
}

test('construction pays, globally locks, refunds on start day, and completes next day', () => {
  const state = funded();
  const before = resourceQty(state, 'renown');
  assert.equal(startConstruction(content, state, world.id, operations.id).ok, true);
  assert.equal(startConstruction(content, state, world.id, community.id).ok, false);
  assert.equal(cancelConstruction(content, state).ok, true);
  assert.equal(resourceQty(state, 'renown'), before);
  startConstruction(content, state, world.id, operations.id);
  applyDailyReset(content, state, T0 + DAY);
  assert.equal(facilityLevel(state, world.id, operations.id), 1);
  assert.equal(state.headquarters.construction, null);
});

test('rank is derived, production persists, and applies once per reset', () => {
  const state = funded();
  for (const facility of world.hq.facilities) state.headquarters.worlds[world.id] ??= { facilities: {}, production: {}, staff: {}, claimedRanks: [] };
  for (const facility of world.hq.facilities) state.headquarters.worlds[world.id].facilities[facility.id] = 1;
  assert.equal(hqRank(content, state, world.id), 2);
  assert.equal(setProduction(content, state, world.id, production.id, 'world_asset').ok, true);
  const before = resourceQty(state, world.worldAsset.id);
  applyDailyReset(content, state, T0 + DAY);
  assert.equal(resourceQty(state, world.worldAsset.id), before + 1);
  applyDailyReset(content, state, T0 + DAY);
  assert.equal(resourceQty(state, world.worldAsset.id), before + 1);
});

test('staffing requires world ownership and unlocked Community capacity', () => {
  const state = funded();
  state.headquarters.worlds[world.id] = { facilities: { [community.id]: 1 }, production: {}, staff: {}, claimedRanks: [] };
  assert.equal(staffingCapacity(content, state, world.id), 1);
  const member = content.characters.find(d => d.world === world.id && state.characters[d.id].owned);
  assert.equal(assignHqStaff(content, state, world.id, operations.id, member.id).ok, true);
  const otherWorld = content.characters.find(d => d.world !== world.id && state.characters[d.id].owned);
  assert.equal(assignHqStaff(content, state, world.id, operations.id, otherWorld.id).ok, false);
});
