// World Mastery: a derived 0..1000 track whose milestones grant only visible,
// finite rewards — never passive percentage modifiers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut, newGame } from './helpers.mjs';
import { clearNode } from '../src/core/state.js';
import { makeRng } from '../src/core/rng.js';
import {
  worldMasteryBreakdown, masteryRank, masteryRankAtLeast,
  applyMasteryMilestones, resolveMasteryChoice, pendingMasteryChoices,
  worldMaterialGrade
} from '../src/core/mastery.js';
import { grantRelicPiece } from '../src/core/relics.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const WORLD = 'world_hidden_village';
const WEIGHTS = content.balance.mastery.weights;

function clearWorldCampaign(state, worldId) {
  for (const node of content.nodesByCampaign[`wc_${worldId}`]) {
    state.nodes[node.id] = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  }
}

function maxWorld(state, worldId) {
  const roster = content.characters.filter(d => d.world === worldId).map(d => d.id);
  maxOut(content, state, roster);
  for (const id of roster) {
    state.characters[id].revealed = true;
    state.characters[id].gearTier = content.maxGearTier;
  }
  clearWorldCampaign(state, worldId);
  for (const piece of content.relicByWorld[worldId].pieces) grantRelicPiece(state, piece.id);
}

test('the four parts weigh 350/350/200/100 and land exactly on 1000 when complete', () => {
  const state = newGame(content, T0);
  const start = worldMasteryBreakdown(content, state, WORLD);
  assert.ok(start.score > 0 && start.score < 100); // the starters alone
  maxWorld(state, WORLD);
  const full = worldMasteryBreakdown(content, state, WORLD);
  assert.equal(full.campaign, WEIGHTS.campaign);
  assert.equal(full.heroes, WEIGHTS.heroes);
  assert.equal(full.gear, WEIGHTS.gear);
  assert.equal(full.relic, WEIGHTS.relic);
  assert.equal(full.score, 1000);
  assert.equal(masteryRank(content, state, WORLD).id, 'mastered');
});

test('the score is derived, never stored — reverting state reverts the score', () => {
  const state = newGame(content, T0);
  const before = worldMasteryBreakdown(content, state, WORLD).score;
  state.characters.char_mei.owned = true;
  const owned = worldMasteryBreakdown(content, state, WORLD).score;
  assert.ok(owned > before);
  state.characters.char_mei.owned = false;
  assert.equal(worldMasteryBreakdown(content, state, WORLD).score, before);
});

test('rank gates compare against the rank thresholds', () => {
  const state = newGame(content, T0);
  assert.equal(masteryRankAtLeast(content, state, WORLD, 'unfamiliar'), true);
  assert.equal(masteryRankAtLeast(content, state, WORLD, 'known'), false);
  clearWorldCampaign(state, WORLD);
  assert.equal(masteryRankAtLeast(content, state, WORLD, 'known'), true);
  assert.equal(masteryRankAtLeast(content, state, WORLD, 'established'), false);
});

test('crossing a rank grants its milestone exactly once, choices queue for the player', () => {
  const state = newGame(content, T0);
  clearWorldCampaign(state, WORLD); // 350: crosses Known (200)
  const events = applyMasteryMilestones(content, state, WORLD, T0);
  assert.equal(events.length, 1);
  assert.equal(events[0].rankId, 'known');
  // Known: one Field Supply plus a material-cache choice
  assert.equal(state.inventory.resources.field_supply, 1);
  assert.equal(pendingMasteryChoices(content, state).length, 1);
  // idempotent: the same rank never pays twice
  assert.deepEqual(applyMasteryMilestones(content, state, WORLD, T0), []);
  // the Known skin is attached to the rank
  assert.equal(events[0].skins.length, 1);
});

test('a material cache pays the chosen family at the world opened grade', () => {
  const state = newGame(content, T0);
  clearWorldCampaign(state, WORLD);
  applyMasteryMilestones(content, state, WORLD, T0);
  // the cleared World Campaign includes advanced-grade nodes
  assert.equal(worldMaterialGrade(content, state, WORLD), 'advanced');
  const bad = resolveMasteryChoice(content, state, WORLD, 'known', {});
  assert.equal(bad.ok, false);
  const result = resolveMasteryChoice(content, state, WORLD, 'known', { family: 'essence' });
  assert.equal(result.ok, true);
  assert.equal(state.inventory.materials.mat_essence_advanced, content.balance.mastery.milestones.known.materialCache);
  assert.equal(pendingMasteryChoices(content, state).length, 0);
});

test('a shard choice takes only a revealed hero of that world', () => {
  const state = newGame(content, T0);
  maxWorld(state, WORLD);
  // un-max one hero so a target exists, then claim Established (shard choice)
  state.characters.char_mei.stars = 3;
  applyMasteryMilestones(content, state, WORLD, T0);
  const shardChoice = pendingMasteryChoices(content, state).find(choice => choice.kind === 'shards');
  assert.ok(shardChoice);
  assert.equal(resolveMasteryChoice(content, state, WORLD, shardChoice.rankId, { characterId: 'char_ashley' }).ok, false);
  const ok = resolveMasteryChoice(content, state, WORLD, shardChoice.rankId, { characterId: 'char_mei' });
  assert.equal(ok.ok, true);
  assert.equal(state.characters.char_mei.shards, shardChoice.qty);
});

test('clearing world nodes applies milestones inside the same transaction', () => {
  const state = newGame(content, T0);
  const roster = content.characters.filter(d => d.world === WORLD).map(d => d.id);
  maxOut(content, state, roster.slice(0, 5));
  state.energy = 10000;
  const party = roster.slice(0, 5);
  let crossed = null;
  for (const node of content.nodesByCampaign[`wc_${WORLD}`]) {
    const r = clearNode(content, state, node.id, party, 1, makeRng(4), T0);
    assert.ok(r.ok, r.reasons?.join('; '));
    if (r.rewards.masteryEvents.length) { crossed = r.rewards.masteryEvents[0]; break; }
  }
  assert.ok(crossed, 'a Mastery rank was crossed during campaign play');
  assert.ok(state.mastery[WORLD].claimedRanks.includes(crossed.rankId));
});
