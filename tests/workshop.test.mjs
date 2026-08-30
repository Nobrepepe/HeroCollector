import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, newGame } from './helpers.mjs';
import { buildWorkshopModel } from '../src/ui/workshop-model.js';

const content = loadContent();
const NOW = Date.parse('2026-07-28T12:00:00Z');

test('workshop: shelf always presents six families and five grades without inventing stock', () => {
  const state = newGame(content, NOW);
  const model = buildWorkshopModel(content, state);

  assert.equal(model.families.length, 6);
  assert.ok(model.families.every(family => family.grades.length === 5));
  assert.equal(model.totals.held, 0);
  assert.ok(model.bench);
  assert.equal(model.ready.length, 0);
  assert.ok(model.blocking.qty > 0);
});

test('workshop: stocking the nearest recipe moves it onto the ready bench', () => {
  const state = newGame(content, NOW);
  const cold = buildWorkshopModel(content, state);

  for (const [id, qty] of Object.entries(cold.bench.analysis.totalMaterialDemand)) {
    state.inventory.materials[id] = qty;
  }

  const ready = buildWorkshopModel(content, state);
  assert.ok(ready.ready.length > 0);
  assert.equal(ready.bench.analysis.craftable, true);
  assert.equal(ready.blocking, null);
});

test('workshop: the closest pinned gear goal outranks unpinned ready gear', () => {
  const state = newGame(content, NOW);
  const initial = buildWorkshopModel(content, state);
  const unpinned = initial.candidates[0];
  const pinned = initial.candidates.find(candidate => candidate !== unpinned);
  for (const [id, qty] of Object.entries(unpinned.analysis.totalMaterialDemand)) {
    state.inventory.materials[id] = qty;
  }
  state.pins.push({ type: 'equipment', characterId: pinned.characterId, slot: pinned.slot });

  const model = buildWorkshopModel(content, state);
  assert.ok(model.ready.some(candidate => !candidate.pinned));
  assert.equal(model.bench.characterId, pinned.characterId);
  assert.equal(model.bench.slot, pinned.slot);
  assert.equal(model.bench.pinned, true);
});
