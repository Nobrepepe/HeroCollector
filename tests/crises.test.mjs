import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut } from './helpers.mjs';
import { newPlayerState } from '../src/core/state.js';
import { crisisGrade, generateCrisisForDay, previewCrisisFront, setCrisisAssignment, resolveCrisis, claimCrisisCache } from '../src/core/crises.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const fixedRng = values => { let i = 0; return { next: () => values[i++ % values.length] }; };

test('Crisis generation suppresses day one, uses eligibility, and snapshots distinct Fronts', () => {
  const state = newPlayerState(content, T0);
  assert.equal(generateCrisisForDay(content, state, fixedRng([0])), null);
  state.dayNumber = 2;
  content.characters.filter(def => def.world === content.worlds[0].id).slice(0, 5)
    .forEach(def => { state.characters[def.id].owned = true; });
  const active = generateCrisisForDay(content, state, fixedRng([0, 0, .1, .2, .3, .4]));
  assert.ok(active);
  assert.equal(active.fronts.length, 2);
  assert.equal(new Set(active.frontIds).size, active.frontIds.length);
  assert.equal(generateCrisisForDay(content, state, fixedRng([0])), null);
});

test('Crisis grades use roster breadth and the affected world Mastery rank', () => {
  const state = newPlayerState(content, T0);
  const world = content.worlds[0];
  assert.equal(crisisGrade(content, state, world.id).id, 'local');
  // Breadth alone is not enough for the top grade…
  content.characters.slice(0, 12).forEach(def => { state.characters[def.id].owned = true; });
  assert.notEqual(crisisGrade(content, state, world.id).id, 'world');
  // …the world itself must be Established: campaign clears + a broad roster.
  content.characters.filter(def => def.world === world.id)
    .forEach(def => { state.characters[def.id].owned = true; });
  for (const node of content.nodesByCampaign[world.campaignId]) {
    state.nodes[node.id] = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  }
  assert.equal(crisisGrade(content, state, world.id).id, 'world');
});

test('Front preview counts distinct favored tags and Crisis resolves and pays once', () => {
  const state = newPlayerState(content, T0);
  state.dayNumber = 2;
  content.characters.slice(0, 12).forEach(def => { state.characters[def.id].owned = true; });
  const world = content.worlds[0];
  content.characters.filter(def => def.world === world.id)
    .forEach(def => { state.characters[def.id].owned = true; });
  for (const node of content.nodesByCampaign[world.campaignId]) {
    state.nodes[node.id] = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  }
  const active = generateCrisisForDay(content, state, fixedRng([0, 0, .1, .2, .3, .4]));
  const ids = content.characters.slice(0, active.fronts.length * active.teamSize).map(def => def.id);
  maxOut(content, state, ids);
  let cursor = 0;
  for (const front of active.fronts) for (let slot = 0; slot < active.teamSize; slot++) {
    assert.equal(setCrisisAssignment(content, state, front.id, slot, ids[cursor++]).ok, true);
  }
  const reading = previewCrisisFront(content, state, active.fronts[0], active.assignments[active.fronts[0].id]);
  assert.ok(reading.matchedFavoredTagCount <= 2);
  assert.ok(reading.effectivePower >= reading.basePower);
  const result = resolveCrisis(content, state);
  assert.equal(result.result.outcome, 'mastered');
  assert.equal(resolveCrisis(content, state).ok, false);
  const choice = active.cacheChoices.find(item => item.id.endsWith('_intel'));
  assert.equal(claimCrisisCache(content, state, choice.id).ok, true);
  assert.equal(claimCrisisCache(content, state, choice.id).ok, false);
});
