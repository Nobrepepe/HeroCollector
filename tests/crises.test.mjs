import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut, newGame } from './helpers.mjs';
import { crisisGrade, crisisFrontPowers, generateCrisisForDay, previewCrisisFront, setCrisisAssignment, resolveCrisis, claimCrisisCache } from '../src/core/crises.js';
import { characterPowerForState } from '../src/core/power.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const fixedRng = values => { let i = 0; return { next: () => values[i++ % values.length] }; };

test('Crisis generation suppresses day one, uses eligibility, and snapshots distinct Fronts', () => {
  const state = newGame(content, T0);
  assert.equal(generateCrisisForDay(content, state, fixedRng([0])), null);
  state.dayNumber = 2;
  content.characters.filter(def => def.world === content.worlds[0].id).slice(0, 5)
    .forEach(def => { state.characters[def.id].owned = true; });
  // A world must have been set foot in before it can host a Crisis.
  const world = content.worlds[0];
  assert.equal(generateCrisisForDay(content, state, fixedRng([0])), null, 'an untouched world hosts nothing');
  for (const node of content.nodesByCampaign[world.campaignId].slice(0, content.crises.settings.minimumClearedNodes)) {
    state.nodes[node.id] = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  }
  const active = generateCrisisForDay(content, state, fixedRng([0, 0, .1, .2, .3, .4]));
  assert.ok(active);
  assert.equal(active.fronts.length, 2);
  assert.equal(new Set(active.frontIds).size, active.frontIds.length);
  assert.equal(generateCrisisForDay(content, state, fixedRng([0])), null);
});

test('Front Power scales with the roster, so a Crisis can never be outgrown', () => {
  // The failure this replaces: authored Front Power was fixed at 2,600-7,200
  // while a maxed team brought 14,000-21,000, and 783 spawns produced 745
  // mastered against one endured. The benchmark is now the player's own
  // strongest disjoint teams, so the gap cannot open.
  const world = content.worlds[0];
  const roster = content.characters.filter(def => def.world === world.id);

  const fresh = newGame(content, T0);
  roster.slice(0, 5).forEach(def => { fresh.characters[def.id].owned = true; });
  const freshGrade = crisisGrade(content, fresh, world.id);
  const freshPowers = crisisFrontPowers(content, fresh, freshGrade);

  const strong = newGame(content, T0);
  content.characters.forEach(def => { strong.characters[def.id].owned = true; });
  maxOut(content, strong, content.characters.map(def => def.id));
  const strongPowers = crisisFrontPowers(content, strong, freshGrade);

  assert.ok(Math.min(...strongPowers) > Math.max(...freshPowers) * 2,
    'a maxed roster must face a materially harder Crisis than a fresh one');

  // And the ask stays in proportion: a party of the benchmark's own strength
  // falls just short on raw Power, so a matched favoured tag is what carries
  // a Front. That is the puzzle; without it the Front is free.
  for (const state of [fresh, strong]) {
    const grade = crisisGrade(content, state, world.id);
    const powers = crisisFrontPowers(content, state, grade);
    const owned = content.characters.filter(def => state.characters[def.id]?.owned)
      .map(def => characterPowerForState(content, state, def.id)).sort((a, b) => b - a);
    const benchmark = owned.slice(0, grade.teamSize).reduce((sum, p) => sum + p, 0);
    assert.ok(Math.max(...powers) > benchmark * 0.8 && Math.max(...powers) < benchmark * 1.3,
      `recommendation ${Math.max(...powers)} is out of proportion to a team of ${benchmark}`);
  }

  // Teams are dealt serpentine, so no Front is a soft spot.
  const spread = Math.max(...strongPowers) - Math.min(...strongPowers);
  assert.ok(spread <= Math.max(...strongPowers) * 0.15, 'the Fronts of one Crisis are wildly uneven');
});

test('Crisis grades use roster breadth and the affected world Mastery rank', () => {
  const state = newGame(content, T0);
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
  const state = newGame(content, T0);
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
