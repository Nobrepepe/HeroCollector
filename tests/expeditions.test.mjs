import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, newGame } from './helpers.mjs';
import { applyDailyReset } from '../src/core/state.js';
import { makeRng } from '../src/core/rng.js';
import {
  cancelCycle, evaluateRequirement, generateCycleBoard, launchCycle,
  offerFeasibility, previewExpedition, rerollOffer, togglePinOffer, resolveDueCycle, requirementProse
} from '../src/core/expeditions.js';
import { fieldSupplyLimits } from '../src/core/energy.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const DAY = 86400000;

function advanceDays(localContent, state, days) {
  for (let d = 1; d <= days; d++) applyDailyReset(localContent, state, T0 + d * DAY);
}

test('requirements and result tiers are declarative and immediate', () => {
  const state = newGame(content, T0);
  const ids = content.characters.filter(d => state.characters[d.id].owned).slice(0, 2).map(d => d.id);
  const party = ids.map(id => ({ id, world: content.characterById[id].world,
    archetype: content.characterById[id].archetype, stars: 2, power: 2000 }));
  assert.equal(evaluateRequirement({ type: 'party_size', count: 2 }, party).met, true);
  assert.equal(evaluateRequirement({ type: 'combined_stars', count: 4 }, party).met, true);
  const offer = {
    partySize: 2, recommendedPower: 1,
    requirements: [{ type: 'party_size', count: 2, text: 'Send two.' }],
    optional: { type: 'distinct_archetypes', count: 1, text: 'Bring breadth.' },
    baseRewards: [{ kind: 'material', id: 'mat_metal_basic', qty: 10 }]
  };
  assert.equal(previewExpedition(content, state, offer, ids).tier, 'exceptional');
});

test('the cycle board has five routes, stays feasible, and waits indefinitely', () => {
  const state = newGame(content, T0);
  const board = state.expeditions.board;
  assert.equal(board.offers.length, 5);
  assert.equal(board.cycle, 1);
  assert.ok(board.offers.filter(o => offerFeasibility(content, state, o).feasible).length >= 2);
  // days pass; the unlaunched board never expires or regenerates
  const offerIds = board.offers.map(o => o.id);
  advanceDays(content, state, 6);
  assert.deepEqual(state.expeditions.board.offers.map(o => o.id), offerIds);
  assert.equal(state.expeditions.cycle, 1);
});

test('recommended Power scales from the strongest owned heroes, not the roster average', () => {
  const state = newGame(content, T0);
  // Promote two heroes far above the rest; a 2-person route must price for them.
  state.characters.char_suzume.stars = 7;
  state.characters.char_suzume.gearTier = content.maxGearTier;
  state.characters.char_hoshi.stars = 7;
  state.characters.char_hoshi.gearTier = content.maxGearTier;
  const board = generateCycleBoard(content, state, makeRng(3));
  const twoPerson = board.offers.find(o => o.partySize === 2);
  if (twoPerson) {
    const topSum = 3530 * 2;
    assert.ok(twoPerson.recommendedPower >= Math.round(topSum * 0.85), `${twoPerson.recommendedPower} prices the top pair`);
  }
});

test('a random-material reward draws real materials at the authored grade', () => {
  const state = newGame(content, T0);
  const basicFamilies = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const board = generateCycleBoard(content, state, makeRng(seed));
    for (const offer of board.offers) {
      for (const reward of offer.baseRewards) {
        if (reward.kind !== 'material') continue;
        assert.ok(content.materialById[reward.id], `unresolved material ${reward.id}`);
        if (reward.grade) assert.equal(content.materialById[reward.id].grade, reward.grade);
        if (content.materialById[reward.id].grade === 'basic') basicFamilies.add(content.materialById[reward.id].family);
      }
    }
  }
  assert.equal(basicFamilies.size, content.materialMeta.familyOrder.length);
});

test('cycle rewards are visibly scaled up by cycleScaleBp on the board itself', () => {
  const state = newGame(content, T0);
  const scaleBp = content.expeditions.settings.cycleScaleBp;
  assert.ok(scaleBp > 10000);
  const board = generateCycleBoard(content, state, makeRng(9));
  const packageMax = Math.max(...content.expeditions.rewardPackages.flatMap(p => p.entries.map(e => e.max ?? 0)));
  const anyLarge = board.offers.some(offer => offer.baseRewards.some(entry => (entry.qty ?? 0) > packageMax));
  assert.ok(anyLarge, 'board quantities exceed unscaled authored maxima');
});

test('board generation copes with a library carrying no Supply route', () => {
  const localContent = loadContent();
  for (const template of localContent.expeditions.templates) delete template.supply;
  const state = newGame(localContent, T0);
  assert.equal(state.expeditions.board.offers.length, 5);
  assert.equal(state.expeditions.board.offers.some(offer => offer.offerKind === 'supply'), false);
  assert.doesNotThrow(() => applyDailyReset(localContent, state, T0 + DAY));
});

test('a world requirement only ever lands on a route of that world', () => {
  // `@associated` is gone: a world-scoped route names its world outright at
  // compile time, so a requirement can no longer arrive somewhere it cannot
  // be satisfied. Every board generated here must hold that.
  for (let seed = 0; seed < 30; seed++) {
    const state = newGame(content, T0);
    const board = generateCycleBoard(content, state, makeRng(seed));
    for (const offer of board.offers) {
      for (const requirement of offer.requirements) {
        if (!requirement.world) continue;
        assert.equal(requirement.world, offer.world,
          `${offer.name} asks for ${requirement.world} but belongs to ${offer.world}`);
      }
    }
  }
});

test('requirement prose is rendered from the predicate, never authored', () => {
  for (const requirement of content.expeditions.requirements) {
    assert.equal(requirement.text, requirementProse(requirement, content),
      `${requirement.id} carries prose that has drifted from its rule`);
  }
  // The rendering itself says what the rule says.
  assert.equal(requirementProse({ type: 'distinct_worlds', count: 3 }),
    'Include characters from three different worlds.');
  assert.equal(requirementProse({ type: 'party_size', count: 1 }), 'Send one character.');
  assert.equal(requirementProse({ type: 'star_character', stars: 4, count: 2 }),
    'Include two characters at four stars or above.');
  const world = content.worlds[0];
  assert.equal(requirementProse({ type: 'world_count', count: 2, world: world.id }, content),
    `Include two characters from ${world.displayName}.`);
});

test('world-scoped archetypes become one route per world, named for it', () => {
  const perWorld = content.expeditions.templates.filter(template => template.world);
  assert.ok(perWorld.length >= content.worlds.length, 'every world carries routes of its own');
  for (const template of perWorld) {
    const world = content.worldById[template.world];
    assert.ok(template.titles.some(title => title.includes(world.displayName)),
      `${template.id} never names ${world.displayName}`);
    assert.ok(!template.titles.some(title => title.includes('{world}')), 'an unfilled placeholder escaped');
  }
  // Identical predicates share one definition rather than multiplying.
  const ids = content.expeditions.requirements.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every board has exactly one fixed, unscaled Supply route', () => {
  for (let seed = 0; seed < 40; seed++) {
    const state = newGame(content, T0);
    const board = generateCycleBoard(content, state, makeRng(seed));
    const offers = board.offers.filter(offer => offer.offerKind === 'supply');
    assert.equal(offers.length, 1);
    assert.deepEqual(offers[0].fixedRewards.map(entry => [entry.id, entry.qty]), [['field_supply', 1]]);
  }
});

test('launching the Supply route reserves capacity; cancelling the cycle releases it', () => {
  const state = newGame(content, T0);
  const offer = state.expeditions.board.offers.find(item => item.offerKind === 'supply');
  const party = offerFeasibility(content, state, offer).party;
  assert.ok(party, 'supply route is feasible');
  const launch = launchCycle(content, state, [{ offerId: offer.id, party }]);
  assert.equal(launch.ok, true, launch.reasons?.join('; '));
  assert.equal(fieldSupplyLimits(content, state).reserved, 1);
  assert.equal(cancelCycle(state).ok, true);
  assert.equal(fieldSupplyLimits(content, state).reserved, 0);
  assert.ok(state.expeditions.board);
});

test('a cycle launches together, blocks overlapping parties, and returns together', () => {
  const state = newGame(content, T0);
  const board = state.expeditions.board;
  const feasible = board.offers
    .map(offer => ({ offer, party: offerFeasibility(content, state, offer).party }))
    .filter(entry => entry.party);
  assert.ok(feasible.length >= 2);
  // overlapping parties are rejected as one commitment
  const overlap = launchCycle(content, state, [
    { offerId: feasible[0].offer.id, party: feasible[0].party },
    { offerId: feasible[1].offer.id, party: feasible[0].party.slice(0, feasible[1].offer.partySize) }
  ]);
  assert.equal(overlap.ok, false);
  // disjoint parties launch together
  const used = new Set(feasible[0].party);
  const second = feasible.slice(1).map(entry => ({
    ...entry, party: offerFeasibilityDisjoint(content, state, entry.offer, used)
  })).find(entry => entry.party);
  const selections = [{ offerId: feasible[0].offer.id, party: feasible[0].party }];
  if (second) selections.push({ offerId: second.offer.id, party: second.party });
  const launch = launchCycle(content, state, selections);
  assert.equal(launch.ok, true, launch.reasons?.join('; '));
  assert.equal(state.expeditions.board, null);
  assert.equal(state.expeditions.active.returnDay, state.dayNumber + content.expeditions.settings.cycleLengthDays);
  // nothing resolves early; everything resolves together at the return day
  advanceDays(content, state, content.expeditions.settings.cycleLengthDays - 1);
  assert.ok(state.expeditions.active);
  advanceDays(content, state, content.expeditions.settings.cycleLengthDays);
  assert.equal(state.expeditions.active, null);
  assert.equal(state.expeditions.reports.length, 1);
  assert.equal(state.expeditions.reports[0].routes.length, selections.length);
  assert.equal(state.expeditions.cycle, 2);
  assert.ok(state.expeditions.board); // the next board is already waiting
});

function offerFeasibilityDisjoint(localContent, state, offer, used) {
  const ids = localContent.characters
    .filter(d => state.characters[d.id]?.owned && !used.has(d.id)).map(d => d.id);
  if (ids.length < offer.partySize) return null;
  // greedy: try the first combination that previews valid
  const combo = ids.slice(0, offer.partySize);
  return previewExpedition(localContent, state, offer, combo).valid ? combo : null;
}

test('character-lead routes take a chosen revealed hero of the route world', () => {
  const localContent = loadContent();
  const lead = localContent.expeditions.templates.find(t =>
    t.world && localContent.expeditions.rewardById[t.rewardPackageId]?.shardPool);
  assert.ok(lead, 'sample library has a world-scoped character-lead template');
  localContent.expeditions.templates = [lead];
  localContent.expeditions.templateById = { [lead.id]: lead };
  localContent.expeditions.fallbackTemplate = lead;
  for (const template of localContent.expeditions.templates) delete template.supply;
  const state = newGame(localContent, T0);
  for (const def of localContent.characters) if (state.characters[def.id].owned) state.characters[def.id].stars = 3;
  generateCycleBoard(localContent, state, makeRng(5));
  const offer = state.expeditions.board.offers.find(o => o.baseRewards.some(e => e.kind === 'shards' && e.choice));
  assert.ok(offer);
  const party = offerFeasibility(localContent, state, offer).party;
  assert.ok(party);
  // no choice: refused
  assert.equal(launchCycle(localContent, state, [{ offerId: offer.id, party }]).ok, false);
  // a hero of another world: refused
  const outsider = localContent.characters.find(d => d.world !== offer.world && state.characters[d.id].owned);
  assert.equal(launchCycle(localContent, state, [{ offerId: offer.id, party, shardChoiceCharacterId: outsider.id }]).ok, false);
  // a revealed hero of the route's world: accepted, and the shards land on them
  const chosen = localContent.characters.find(d => d.world === offer.world && state.characters[d.id].owned);
  const launch = launchCycle(localContent, state, [{ offerId: offer.id, party, shardChoiceCharacterId: chosen.id }]);
  assert.equal(launch.ok, true, launch.reasons?.join('; '));
  const shardsBefore = state.characters[chosen.id].shards;
  advanceDays(localContent, state, localContent.expeditions.settings.cycleLengthDays);
  assert.ok(state.characters[chosen.id].shards > shardsBefore);
});

test('rerolls and pins are per-cycle; a pinned unlaunched route carries to the next board', () => {
  const state = newGame(content, T0);
  const first = state.expeditions.board.offers.find(offer => offer.offerKind !== 'supply');
  assert.equal(rerollOffer(content, state, first.id, makeRng(8)).ok, true);
  assert.equal(state.expeditions.allowances.freeRerollsUsed, 1);
  const pinned = state.expeditions.board.offers.find(offer => offer.offerKind !== 'supply');
  assert.equal(togglePinOffer(content, state, pinned.id).ok, true);
  assert.equal(state.expeditions.allowances.freePinsUsed, 1);
  // launch a different route; the pinned one carries into the next cycle
  const other = state.expeditions.board.offers
    .filter(o => o.id !== pinned.id)
    .map(o => ({ o, party: offerFeasibility(content, state, o).party }))
    .find(entry => entry.party);
  assert.ok(other);
  assert.equal(launchCycle(content, state, [{ offerId: other.o.id, party: other.party }]).ok, true);
  advanceDays(content, state, content.expeditions.settings.cycleLengthDays);
  assert.ok(state.expeditions.board.offers.some(o => o.id === pinned.id));
  // fresh board, fresh allowances
  assert.equal(state.expeditions.allowances.freeRerollsUsed, 0);
  assert.equal(state.expeditions.allowances.freePinsUsed, 0);
});

test('an Operations boost visibly improves the next board routes of its world', () => {
  const state = newGame(content, T0);
  const world = content.worlds[0];
  state.programs[world.id] = {
    procurement: { meter: 0, delivered: 0, family: null },
    development: { meter: 0, delivered: 0, heroId: null },
    operations: { meter: 0, delivered: 0, boostCycles: 1 },
    relicSlot: null
  };
  // regenerate boards until one carries a route from that world
  for (let seed = 0; seed < 60 && state.programs[world.id].operations.boostCycles > 0; seed++) {
    generateCycleBoard(content, state, makeRng(seed));
  }
  assert.equal(state.programs[world.id].operations.boostCycles, 0);
  const boosted = state.expeditions.board.offers.filter(o => o.world === world.id);
  assert.ok(boosted.length >= 1);
  for (const offer of boosted) {
    assert.ok(offer.baseRewards.some(entry => entry.operations), 'boosted route shows its bonus bundle');
  }
});
