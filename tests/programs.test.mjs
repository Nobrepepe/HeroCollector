// World Programs: automatic meters, concrete payouts, and the single movable
// relic slot whose effect applies only to payouts earned after placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut, newGame } from './helpers.mjs';
import { clearNode, applyDailyReset, syncSaveWithContent } from '../src/core/state.js';
import { makeRng } from '../src/core/rng.js';
import {
  programState, addProcurementEnergy, addDevelopmentShards, addOperationsCompletion,
  setProcurementFamily, setDevelopmentHero, installRelic, deliverProgramPayouts,
  programOverview
} from '../src/core/programs.js';
import { grantRelicPiece, restoreRelic, relicStatus } from '../src/core/relics.js';

const content = loadContent();
const T0 = Date.parse('2026-07-25T12:00:00');
const WORLD = 'world_hidden_village';
const CONFIG = content.balance.programs;

function completeRelic(state, worldId) {
  for (const piece of content.relicByWorld[worldId].pieces) grantRelicPiece(state, piece.id);
}

// Four pieces in hand and then bound on the Mastery track — the second half is
// the player's own act, and nothing installs without it.
function bindRelic(state, worldId) {
  completeRelic(state, worldId);
  assert.equal(restoreRelic(content, state, worldId).ok, true);
}

test('clearing a world node feeds that world Procurement with the Energy paid', () => {
  const state = newGame(content, T0);
  const party = state.parties[0].members.filter(Boolean);
  // main_1 has no world tag in the sample pack: no Procurement feed
  assert.ok(clearNode(content, state, 'main_1', party, 1, makeRng(2), T0).ok);
  assert.equal(state.programs[WORLD]?.procurement.meter ?? 0, 0);
  // an owned village party can enter the World Campaign after five are owned
  const villageParty = content.characters.filter(d => d.world === WORLD).slice(0, 5).map(d => d.id);
  maxOut(content, state, villageParty);
  assert.ok(clearNode(content, state, 'wc_world_hidden_village_1', villageParty, 1, makeRng(2), T0).ok);
  assert.equal(state.programs[WORLD].procurement.meter, 10);
});

test('Procurement ships the chosen family at the world opened grade; no family, it banks', () => {
  const state = newGame(content, T0);
  addProcurementEnergy(content, state, WORLD, CONFIG.procurement.threshold * 2 + 5);
  // no family chosen: the meter banks in full, nothing is lost silently
  deliverProgramPayouts(content, state);
  assert.equal(state.programs[WORLD].procurement.meter, CONFIG.procurement.threshold * 2 + 5);
  setProcurementFamily(content, state, WORLD, 'fiber');
  // an improved-grade node cleared raises the shipment grade
  state.nodes.wc_world_hidden_village_1 = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  const events = deliverProgramPayouts(content, state);
  assert.equal(events.length, 2); // both banked thresholds pay out now
  assert.equal(events[0].program, 'procurement');
  const grade = content.materialById[events[0].granted[0].id].grade;
  assert.equal(events[0].granted[0].id, `mat_fiber_${grade}`);
  assert.equal(events[0].granted[0].qty, CONFIG.procurement.shipmentQty);
  assert.equal(state.programs[WORLD].procurement.delivered, 2);
  assert.equal(state.programs[WORLD].procurement.meter, 5);
});

test('Development converts applied shards into bonus shards for the chosen hero', () => {
  const state = newGame(content, T0);
  setDevelopmentHero(content, state, WORLD, 'char_suzume');
  addDevelopmentShards(content, state, WORLD, CONFIG.development.threshold);
  const events = deliverProgramPayouts(content, state);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].granted, [{ kind: 'shards', characterId: 'char_suzume', qty: CONFIG.development.bonusShards }]);
  assert.equal(state.characters.char_suzume.shards, CONFIG.development.bonusShards);
  // heroes of other worlds are refused as Development targets
  assert.equal(setDevelopmentHero(content, state, WORLD, 'char_ashley').ok, false);
});

test('Operations banks route boosts per completed-route threshold', () => {
  const state = newGame(content, T0);
  addOperationsCompletion(content, state, WORLD, CONFIG.operations.threshold);
  deliverProgramPayouts(content, state);
  assert.equal(state.programs[WORLD].operations.boostCycles, 1);
});

test('the relic installs into exactly one Program and only once bound', () => {
  const state = newGame(content, T0);
  assert.equal(installRelic(content, state, WORLD, 'procurement').ok, false);
  // All four pieces held is not yet a relic: it installs only after binding.
  completeRelic(state, WORLD);
  assert.equal(relicStatus(content, state, WORLD).complete, true);
  assert.equal(relicStatus(content, state, WORLD).restored, false);
  assert.equal(installRelic(content, state, WORLD, 'procurement').ok, false);
  assert.equal(restoreRelic(content, state, WORLD).ok, true);
  assert.equal(installRelic(content, state, WORLD, 'procurement').ok, true);
  assert.equal(state.programs[WORLD].relicSlot, 'procurement');
  // moving it is free
  assert.equal(installRelic(content, state, WORLD, 'development').ok, true);
  assert.equal(state.programs[WORLD].relicSlot, 'development');
  const overview = programOverview(content, state, WORLD);
  assert.equal(overview.development.threshold, CONFIG.development.relicThreshold);
  assert.equal(overview.procurement.shipmentQty, CONFIG.procurement.shipmentQty);
});

test('relic effects are read at payout time — placement affects only the future', () => {
  const state = newGame(content, T0);
  setProcurementFamily(content, state, WORLD, 'metal');
  addProcurementEnergy(content, state, WORLD, CONFIG.procurement.threshold);
  // deliver once without the relic
  let events = deliverProgramPayouts(content, state);
  assert.equal(events[0].granted[0].qty, CONFIG.procurement.shipmentQty);
  // bind and install, then the next shipment is larger
  bindRelic(state, WORLD);
  installRelic(content, state, WORLD, 'procurement');
  addProcurementEnergy(content, state, WORLD, CONFIG.procurement.threshold);
  events = deliverProgramPayouts(content, state);
  assert.equal(events[0].granted[0].qty, CONFIG.procurement.shipmentQty + CONFIG.procurement.relicBonusQty);
});

test('binding grants nothing, cannot be repeated, and is what an install reads', () => {
  const state = newGame(content, T0);
  // It cannot be forced early, and it says how much is still buried.
  const early = restoreRelic(content, state, WORLD);
  assert.equal(early.ok, false);
  assert.match(early.reasons[0], /buried/);

  completeRelic(state, WORLD);
  const before = JSON.stringify(state.inventory);
  assert.equal(restoreRelic(content, state, WORLD).ok, true);
  assert.equal(JSON.stringify(state.inventory), before, 'binding pays out nothing');
  assert.equal(state.relics.restored[WORLD], true);
  assert.equal(restoreRelic(content, state, WORLD).ok, false, 'it binds once');

  // A relic that loses a piece stops reading as whole, and stops paying.
  installRelic(content, state, WORLD, 'development');
  addDevelopmentShards(content, state, WORLD, CONFIG.development.relicThreshold);
  assert.equal(programOverview(content, state, WORLD).development.threshold, CONFIG.development.relicThreshold);
  delete state.relics.pieces[content.relicByWorld[WORLD].pieces[0].id];
  assert.equal(relicStatus(content, state, WORLD).restored, false);
  assert.equal(programOverview(content, state, WORLD).development.threshold, CONFIG.development.threshold);
});

test('a save that installed a relic before binding existed keeps its bonus', () => {
  const state = newGame(content, T0);
  completeRelic(state, WORLD);
  restoreRelic(content, state, WORLD);
  installRelic(content, state, WORLD, 'procurement');
  // Exactly the shape of a save written before the bit was added.
  delete state.relics.restored;

  syncSaveWithContent(content, state);
  assert.equal(state.relics.restored[WORLD], true, 'an installed relic was bound under the old rules');
  assert.equal(programOverview(content, state, WORLD).procurement.shipmentQty,
    CONFIG.procurement.shipmentQty + CONFIG.procurement.relicBonusQty);

  // A complete relic that was never installed is left unbound: the player is
  // owed the sequence rather than robbed of it.
  const untouched = newGame(content, T0);
  completeRelic(untouched, WORLD);
  delete untouched.relics.restored;
  syncSaveWithContent(content, untouched);
  assert.equal(untouched.relics.restored[WORLD], undefined);
  assert.equal(relicStatus(content, untouched, WORLD).restored, false);
});

test('payouts run inside the daily reset with no interaction required', () => {
  const state = newGame(content, T0);
  setProcurementFamily(content, state, WORLD, 'metal');
  addProcurementEnergy(content, state, WORLD, CONFIG.procurement.threshold);
  const summary = applyDailyReset(content, state, T0 + 86400000);
  assert.equal(summary.shipments.length, 1);
  assert.equal(state.programs[WORLD].procurement.delivered, 1);
});
