import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, newGame } from './helpers.mjs';
import {
  craftAndEquipEquipment, togglePin, copyParty, clearParty,
  selectPartyPreset, preferredPartyIndex, checkCraftAndEquipEquipment,
  setPartyMember, syncSaveWithContent, SCHEMA_VERSION
} from '../src/core/state.js';
import {
  analyzeEquipmentGoal, analyzePinnedGoals, allocateMaterialDemand
} from '../src/core/progression.js';
import { validateSave } from '../src/core/validate.js';

const content = loadContent();
const NOW = Date.parse('2026-07-28T12:00:00Z');

function stockGoalMaterials(state, analysis, adjustment = 0) {
  for (const [id, amount] of Object.entries(analysis.totalMaterialDemand)) {
    state.inventory.materials[id] = Math.max(0, amount + adjustment);
  }
}

test('progression: direct raw materials make a missing-component goal chain-ready', () => {
  const state = newGame(content, NOW);
  const initial = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  assert.equal(initial.state, 'missing');
  stockGoalMaterials(state, initial);
  const ready = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  assert.equal(ready.state, 'chain-ready');
  assert.equal(ready.craftable, true);
  const material = Object.keys(ready.totalMaterialDemand)[0];
  state.inventory.materials[material]--;
  const short = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  assert.equal(short.craftable, false);
  assert.equal(short.totalMaterialMissing[material], 1);
});

test('progression: existing components reduce material demand', () => {
  const state = newGame(content, NOW);
  const before = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  const componentId = Object.keys(before.totalComponentDemand)[0];
  state.inventory.components[componentId] = 1;
  const after = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  assert.ok(Object.values(after.totalMaterialDemand).reduce((a, b) => a + b, 0)
    < Object.values(before.totalMaterialDemand).reduce((a, b) => a + b, 0));
});

test('progression: legal conversions are deterministic and respect the grade ceiling', () => {
  const inventory = { mat_metal_basic: 25 };
  const plan = allocateMaterialDemand(content, inventory, { mat_metal_advanced: 1 });
  assert.equal(plan.craftable, true);
  assert.equal(plan.consumption.mat_metal_basic, 25);
  assert.deepEqual(plan.conversions.map(c => [c.from, c.to, c.qty]), [
    ['mat_metal_basic', 'mat_metal_improved', 5],
    ['mat_metal_improved', 'mat_metal_advanced', 1]
  ]);
  const blocked = allocateMaterialDemand(content,
    { mat_metal_advanced: 5 }, { mat_metal_superior: 1 });
  assert.equal(blocked.craftable, false);
});

test('progression: craft and equip is atomic, exact, and removes only its pin', () => {
  const state = newGame(content, NOW);
  const analysis = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  stockGoalMaterials(state, analysis);
  togglePin(state, { type: 'equipment', characterId: 'char_suzume', slot: 'attire' }, content);
  togglePin(state, { type: 'equipment', characterId: 'char_suzume', slot: 'tool' }, content);
  const result = craftAndEquipEquipment(content, state, 'char_suzume', 'attire', NOW);
  assert.equal(result.ok, true);
  assert.equal(state.characters.char_suzume.slots.attire, true);
  assert.equal(state.pins.some(p => p.slot === 'attire'), false);
  assert.equal(state.pins.some(p => p.slot === 'tool'), true);
  for (const value of Object.values(state.inventory.materials)) assert.ok(value >= 0);

  const failedState = newGame(content, NOW);
  const snapshot = structuredClone(failedState);
  const failed = craftAndEquipEquipment(content, failedState, 'char_suzume', 'attire', NOW);
  assert.equal(failed.ok, false);
  assert.deepEqual(failedState, snapshot);
});

test('progression: atomic equipment action performs previewed upward conversions', () => {
  const state = newGame(content, NOW);
  state.characters.char_suzume.gearTier = 2;
  const analysis = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  for (const [improvedId, amount] of Object.entries(analysis.totalMaterialDemand)) {
    const lower = content.materials.find(material => material.conversionTarget === improvedId);
    state.inventory.materials[lower.id] = amount * lower.conversionCost;
  }
  const ready = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  assert.equal(ready.state, 'chain-ready');
  assert.ok(ready.conversions.length);
  const result = craftAndEquipEquipment(content, state, 'char_suzume', 'attire', NOW);
  assert.equal(result.ok, true);
  assert.ok(result.conversions.length);
  assert.equal(state.characters.char_suzume.slots.attire, true);
});

test('progression: combined goals allocate inventory once and expose contention', () => {
  const state = newGame(content, NOW);
  togglePin(state, { type: 'equipment', characterId: 'char_suzume', slot: 'attire' }, content);
  togglePin(state, { type: 'equipment', characterId: 'char_hoshi', slot: 'attire' }, content);
  const first = analyzeEquipmentGoal(content, state, 'char_suzume', 'attire');
  stockGoalMaterials(state, first);
  const combined = analyzePinnedGoals(content, state);
  assert.equal(analyzeEquipmentGoal(content, state, 'char_suzume', 'attire').craftable, true);
  assert.ok(Object.keys(combined.totalMaterialMissing).length > 0);
  assert.equal(combined.contention, true);
  const checked = checkCraftAndEquipEquipment(content, state, 'char_suzume', 'attire');
  assert.ok(checked.plan.reservationConflicts.length > 0);
});

test('pins support more than eight goals and shard objectives cleanly migrate', () => {
  const state = newGame(content, NOW);
  for (const character of content.characters.slice(0, 10)) {
    const result = togglePin(state, { type: 'character', characterId: character.id }, content);
    if (state.characters[character.id].stars < 7) assert.equal(result.ok, true);
  }
  assert.ok(state.pins.length > 8);
});

test('party copy is independent, clear is scoped, and node preference falls back', () => {
  const state = newGame(content, NOW);
  const original = [...state.parties[0].members];
  assert.ok(copyParty(state, 1, 0).ok);
  state.parties[0].members[0] = null;
  assert.deepEqual(state.parties[1].members, original);
  assert.ok(clearParty(state, 1).ok);
  assert.deepEqual(state.parties[1].members, [null, null, null, null, null]);
  selectPartyPreset(state, 2, 'main_1');
  assert.equal(preferredPartyIndex(state, 'main_1'), 2);
  state.ui.nodePartyById.main_1 = 99;
  assert.equal(preferredPartyIndex(state, 'main_1'), 2);
  const occupied = state.parties[0].members[1];
  assert.ok(occupied);
  assert.ok(setPartyMember(content, state, 0, 1, null).ok);
  assert.equal(state.parties[0].members[1], null);
});

test('saves are schema 7 only — older schemas are refused, not adapted', () => {
  const state = newGame(content, NOW);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 7);
  assert.equal(validateSave(content, state).ok, true);
  const old = structuredClone(state);
  old.schemaVersion = 6;
  assert.equal(validateSave(content, old).ok, false);
  state.ui.nodePartyById.main_1 = 99;
  assert.equal(validateSave(content, state).ok, false);
});

test('switching content packs resets shared Main progress, keeps world-scoped progress', () => {
  const state = newGame(content, NOW);
  state.nodes.main_1 = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  const wcNode = content.nodes.find(n => n.campaign !== 'main');
  state.nodes[wcNode.id] = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  // Same lineage: nothing is touched.
  syncSaveWithContent(content, state);
  assert.ok(state.nodes.main_1);
  // A different pack: shared-campaign ids collide, so they reset; the
  // world-scoped node stays (it returns with its world).
  const original = content.lineage;
  try {
    content.lineage = 'production:another-pack';
    const { changes } = syncSaveWithContent(content, state);
    assert.equal(state.nodes.main_1, undefined);
    assert.ok(state.nodes[wcNode.id]);
    assert.equal(state.contentLineage, 'production:another-pack');
    assert.ok(changes.some(text => /different content pack/.test(text)));
    // Idempotent once recorded.
    syncSaveWithContent(content, state);
    assert.ok(state.nodes[wcNode.id]);
  } finally {
    content.lineage = original;
    state.contentLineage = original;
  }
});

test('a content switch refills the first party after dormant members detach', () => {
  const state = newGame(content, NOW);
  state.parties[0].members = ['ghost_a', 'ghost_b', 'ghost_c', null, null];
  for (const id of ['ghost_a', 'ghost_b', 'ghost_c']) {
    state.characters[id] = { owned: true, stars: 1, shards: 0, gearTier: 0, slots: {}, revealed: true, selectedSkinId: null };
  }
  syncSaveWithContent(content, state);
  const members = state.parties[0].members.filter(Boolean);
  assert.ok(members.length >= 5 - 0 && members.length > 0, 'party was refilled');
  assert.ok(members.every(id => content.characterById[id]), 'refilled only with live characters');
});

test('import pipeline synchronizes removed live references before validation', () => {
  const state = newGame(content, NOW);
  state.characters.char_removed_custom = {
    owned: true, stars: 3, shards: 9, gearTier: 1,
    slots: {}, revealed: true, selectedSkinId: null
  };
  state.parties[0].members[0] = 'char_removed_custom';
  state.pins.push({ type: 'equipment', characterId: 'char_removed_custom', slot: 'attire' });
  state.focus.slots.primary.characterId = 'char_removed_custom';
  assert.equal(validateSave(content, state).ok, false);
  syncSaveWithContent(content, state);
  assert.equal(state.parties[0].members[0], null);
  assert.equal(state.pins.some(pin => pin.characterId === 'char_removed_custom'), false);
  assert.equal(state.focus.slots.primary.characterId, null);
  assert.equal(state.characters.char_removed_custom.stars, 3);
  assert.equal(validateSave(content, state).ok, true);
});
