// Appendix B transaction invariants + core rule correctness (GDD 14.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut, give } from './helpers.mjs';
import { validateContent, validateSave } from '../src/core/validate.js';
import { characterPowerBreakdown, characterPower, maxCharacterPower } from '../src/core/power.js';
import { evaluateParty, partyLegality } from '../src/core/synergy.js';
import { makeRng } from '../src/core/rng.js';
import {
  newPlayerState, applyDailyReset, resetDayKey, clearNode, checkClear,
  craftComponent, upcraft, craftEquipment, completeGearTier, promoteStar,
  unlockCharacter, checkCraftEquipment, nodeState, worldCampaignUnlocked,
  checkCompleteTier, unlockedSkins, selectSkin
} from '../src/core/state.js';

const content = loadContent();
const DAY = 86400000;
const T0 = Date.parse('2026-07-24T12:00:00');

test('content passes full validation', () => {
  const result = validateContent(content);
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test('new save: starting state matches GDD 2.2', () => {
  const s = newPlayerState(content, T0);
  const owned = content.characters.filter(d => s.characters[d.id].owned);
  assert.equal(owned.length, 5);
  const byWorld = {};
  for (const d of owned) byWorld[d.world] = (byWorld[d.world] ?? 0) + 1;
  assert.deepEqual(Object.values(byWorld).sort(), [2, 3]);
  for (const d of owned) {
    assert.equal(s.characters[d.id].stars, 1);
    assert.equal(s.characters[d.id].gearTier, 0);
    assert.equal(d.tier, 'minor');
  }
  assert.equal(s.energy, 120);
  assert.deepEqual(s.inventory.materials, {});
  assert.ok(validateSave(content, s).ok);
});

test('power: launch maximum respects the authored Gear Tier 6 cap', () => {
  assert.equal(content.maxGearTier, 6);
  const s = newPlayerState(content, T0);
  const cs = s.characters.char_suzume;
  cs.stars = 7; cs.gearTier = 6;
  const b = characterPowerBreakdown(content, cs);
  assert.equal(b.base, 1000);
  assert.equal(b.stars, 1500);
  assert.equal(b.gearPermanent, 1030);
  assert.equal(b.total, 3530);
  assert.equal(maxCharacterPower(content), 5000); // full-system ceiling remains stable for expansions
});

test('gear: each equipped piece grants 10% of tier power; completion lands exactly on the table', () => {
  const s = newPlayerState(content, T0);
  const cs = s.characters.char_suzume;
  cs.gearTier = 2; // active tier 3 => 150 power, 15 per piece
  const p0 = characterPower(content, cs);
  cs.slots.attire = true;
  assert.equal(characterPower(content, cs) - p0, 15);
  for (const slot of content.characterMeta.slotOrder) cs.slots[slot] = true;
  assert.equal(characterPower(content, cs) - p0, 90); // 60% share while equipped
  const done = completeGearTier(content, s, 'char_suzume');
  assert.ok(done.ok);
  assert.equal(characterPowerBreakdown(content, cs).gearPermanent, 100 + 120 + 150);
  // completion never reduces total power
  assert.ok(done.powerAfter >= done.powerBefore);
  assert.equal(done.powerAfter - p0, 150);
});

test('synergy: mixed 3-2 party gets cohesion + diversity; cap applies at 25%', () => {
  const s = newPlayerState(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'];
  const ev = evaluateParty(content, s, party);
  const groups = Object.fromEntries(ev.active.map(a => [a.tag.stackingGroup, a.bonusBp]));
  assert.equal(groups.world_cohesion, 400);   // 3 share a world
  assert.equal(groups.world_diversity, 400);  // 2 distinct worlds
  assert.equal(groups.ring_leader_achiever, 300);
  assert.equal(groups.ring_caretaker_leader, 300);
  assert.equal(groups.faction_spiritwardens, 200);
  assert.equal(groups.faction_spark_stone, 200);
  assert.equal(ev.effectivePower, Math.floor(ev.rawPower * (10000 + ev.cappedBp) / 10000));

  // a loaded same-world party exceeds the cap and is clamped
  maxOut(content, s, ['char_suzume', 'char_hoshi', 'char_ayame', 'char_mei', 'char_tsubaki']);
  const ev2 = evaluateParty(content, s, ['char_suzume', 'char_hoshi', 'char_ayame', 'char_mei', 'char_tsubaki']);
  assert.ok(ev2.totalBp > 2500);
  assert.equal(ev2.cappedBp, 2500);
  assert.equal(ev2.effectivePower, Math.floor(ev2.rawPower * 1.25));
});

test('synergy: inactive bonuses explain what is missing', () => {
  const s = newPlayerState(content, T0);
  const ev = evaluateParty(content, s, ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget']);
  const missing = ev.inactive.map(i => i.missing).join(' | ');
  assert.match(missing, /Rebel/);
});

test('clear: insufficient power cannot start and spends no energy', () => {
  const s = newPlayerState(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'];
  // main_1 threshold 5500 is passable at start; main_10 is not reachable (locked) —
  // force the check on threshold by testing a later node's power reason via checkClear on main_1 with weakened party
  s.characters.char_suzume.stars = 1;
  const weak = checkClear(content, s, 'main_20', party, 1);
  assert.ok(!weak.ok);
  const before = s.energy;
  const res = clearNode(content, s, 'main_20', party, 1, makeRng(1), T0);
  assert.ok(!res.ok);
  assert.equal(s.energy, before);
});

test('clear: success consumes energy, awards first-clear once, unlocks sweep', () => {
  const s = newPlayerState(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'];
  const rng = makeRng(42);
  // sweep before first clear is rejected
  const pre = checkClear(content, s, 'main_1', party, 2);
  assert.ok(pre.reasons.some(r => /Sweep unlocks/.test(r)));
  const r1 = clearNode(content, s, 'main_1', party, 1, rng, T0);
  assert.ok(r1.ok);
  assert.equal(s.energy, 120);
  assert.equal(r1.rewards.energyRefunded, 6);
  assert.ok(r1.rewards.firstClear);
  const node = content.nodeById.main_1;
  const firstClearQty = node.firstClear.materials[0].qty;
  assert.ok((s.inventory.materials[node.material] ?? 0) >= firstClearQty + 1);
  // second clear: no first-clear again
  const r2 = clearNode(content, s, 'main_1', party, 1, rng, T0);
  assert.ok(r2.ok && !r2.rewards.firstClear);
  // next node unlocked only now
  assert.ok(nodeState(s, 'main_1').cleared);
});

test('Shadow shard node: matching Main unlock, 5 attempts, pity, and 7-star fallback', () => {
  const s = newPlayerState(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'];
  // Clear the matching Main path; Shadow nodes do not unlock one another.
  const rng = makeRng(7);
  clearNode(content, s, 'main_1', party, 1, rng, T0);
  clearNode(content, s, 'main_2', party, 1, rng, T0);
  clearNode(content, s, 'main_3', party, 1, rng, T0);
  const node = content.nodeById.shadow_3;
  assert.equal(node.type, 'shard');
  assert.equal(node.shardCharacter, 'char_hoshi');

  const r = clearNode(content, s, 'shadow_3', party, 1, rng, T0);
  assert.ok(r.ok);
  // attempts cap
  const r5 = checkClear(content, s, 'shadow_3', party, 5);
  assert.ok(!r5.ok && r5.reasons.some(x => /attempt/.test(x)));
  const r4 = clearNode(content, s, 'shadow_3', party, 4, rng, T0);
  assert.ok(r4.ok);
  assert.equal(nodeState(s, 'shadow_3').attemptsToday, 5);

  // pity: force a miss then expect a guaranteed shard
  const s2 = newPlayerState(content, T0);
  clearNode(content, s2, 'main_1', party, 1, makeRng(1), T0);
  clearNode(content, s2, 'main_2', party, 1, makeRng(1), T0);
  clearNode(content, s2, 'main_3', party, 1, makeRng(1), T0);
  s2.characters.char_hoshi.pity = true;
  const shardsBefore = s2.characters.char_hoshi.shards;
  const rr = clearNode(content, s2, 'shadow_3', party, 1, makeRng(999), T0);
  // first-clear grants 2 fixed shards + guaranteed pity shard = 3
  assert.equal(s2.characters.char_hoshi.shards, shardsBefore + 3);
  assert.equal(s2.characters.char_hoshi.pity, false);
  assert.ok(rr.ok);

  // 7-star: shard roll replaced by guaranteed material
  const s3 = newPlayerState(content, T0);
  clearNode(content, s3, 'main_1', party, 1, makeRng(1), T0);
  clearNode(content, s3, 'main_2', party, 1, makeRng(1), T0);
  clearNode(content, s3, 'main_3', party, 1, makeRng(1), T0);
  s3.characters.char_hoshi.stars = 7;
  const matBefore = s3.inventory.materials[node.material] ?? 0;
  const r3 = clearNode(content, s3, 'shadow_3', party, 1, makeRng(999), T0);
  assert.ok(r3.ok);
  assert.equal(Object.keys(r3.rewards.shards).length - (r3.rewards.firstClear ? 1 : 0), 0);
  // repeat 1 mat + 7★ replacement 1 mat + first-clear 1 mat = at least 3
  assert.ok((s3.inventory.materials[node.material] ?? 0) >= matBefore + 3);
});

test('daily reset: adds 120 up to 240 cap, idempotent, backward clock grants nothing', () => {
  const s = newPlayerState(content, T0);
  s.energy = 50;
  assert.equal(applyDailyReset(content, s, T0), null);        // same day: no-op
  const sum1 = applyDailyReset(content, s, T0 + DAY);
  assert.equal(s.energy, 170);
  assert.equal(sum1.days, 1);
  assert.equal(applyDailyReset(content, s, T0 + DAY), null);  // idempotent per key
  applyDailyReset(content, s, T0 + 5 * DAY);                  // multi-day catches up, capped
  assert.equal(s.energy, 240);
  const key = s.lastResetKey;
  assert.equal(applyDailyReset(content, s, T0), null);        // backward clock
  assert.equal(s.lastResetKey, key);
  assert.equal(s.energy, 240);
});

test('daily reset: rolls at the configured local reset hour', () => {
  const before = Date.parse('2026-07-25T03:59:00');
  const after = Date.parse('2026-07-25T04:01:00');
  assert.equal(resetDayKey(before, 4), resetDayKey(Date.parse('2026-07-24T12:00:00'), 4));
  assert.notEqual(resetDayKey(after, 4), resetDayKey(before, 4));
});

test('crafting: atomic, requires all inputs, no negative quantities', () => {
  const s = newPlayerState(content, T0);
  const comp = content.componentById.comp_weave_basic;
  const bad = craftComponent(content, s, 'comp_weave_basic', 1);
  assert.ok(!bad.ok);
  assert.deepEqual(s.inventory.components, {});
  give(s, comp.inputs[0].materialId, 3);
  give(s, comp.inputs[1].materialId, 1); // one short
  const bad2 = craftComponent(content, s, 'comp_weave_basic', 1);
  assert.ok(!bad2.ok);
  assert.equal(s.inventory.materials[comp.inputs[0].materialId], 3); // nothing consumed
  give(s, comp.inputs[1].materialId, 1);
  const good = craftComponent(content, s, 'comp_weave_basic', 1);
  assert.ok(good.ok);
  assert.equal(s.inventory.components.comp_weave_basic, 1);
  assert.equal(s.inventory.materials[comp.inputs[0].materialId] ?? 0, 0);
});

test('upcraft: 5:1 upward only, masterwork cannot convert', () => {
  const s = newPlayerState(content, T0);
  give(s, 'mat_metal_basic', 12);
  const r = upcraft(content, s, 'mat_metal_basic', 2);
  assert.ok(r.ok);
  assert.equal(s.inventory.materials.mat_metal_basic, 2);
  assert.equal(s.inventory.materials.mat_metal_improved, 2);
  assert.ok(!upcraft(content, s, 'mat_metal_masterwork', 1).ok);
  assert.ok(!upcraft(content, s, 'mat_metal_basic', 1).ok); // only 2 left, need 5
});

test('equipment: equipping a completed slot is impossible; tier completion needs all six', () => {
  const s = newPlayerState(content, T0);
  const cs = s.characters.char_suzume;
  // stock enough components for Fern's tier-1 attire (caretaker: weave primary)
  const check = checkCraftEquipment(content, s, 'char_suzume', 'attire');
  assert.ok(!check.ok); // nothing in inventory yet
  const recipe = check.recipe ?? null;
  // build inputs
  const needed = (recipe ?? (checkCraftEquipment(content, s, 'char_suzume', 'attire')).recipe);
  // grant components directly
  for (const slot of content.characterMeta.slotOrder) {
    const c2 = checkCraftEquipment(content, s, 'char_suzume', slot);
    for (const input of c2.recipe.inputs) {
      s.inventory.components[input.componentId] = (s.inventory.components[input.componentId] ?? 0) + input.qty;
    }
  }
  assert.ok(!completeGearTier(content, s, 'char_suzume').ok); // nothing equipped yet
  for (const slot of content.characterMeta.slotOrder) {
    assert.ok(craftEquipment(content, s, 'char_suzume', slot).ok);
  }
  // already equipped slot cannot be re-crafted
  assert.ok(!craftEquipment(content, s, 'char_suzume', 'attire').ok);
  const done = completeGearTier(content, s, 'char_suzume');
  assert.ok(done.ok);
  assert.equal(cs.gearTier, 1);
  assert.deepEqual(Object.values(cs.slots), [false, false, false, false, false, false]);
});

test('stars: promotion needs owned, below 7, exact shard cost consumed', () => {
  const s = newPlayerState(content, T0);
  const cs = s.characters.char_suzume; // 1 star
  assert.ok(!promoteStar(content, s, 'char_suzume').ok);
  cs.shards = 25;
  const r = promoteStar(content, s, 'char_suzume'); // needs 20 for 2★
  assert.ok(r.ok);
  assert.equal(cs.stars, 2);
  assert.equal(cs.shards, 5);
  cs.stars = 7;
  cs.shards = 1000;
  assert.ok(!promoteStar(content, s, 'char_suzume').ok);
  assert.ok(!promoteStar(content, s, 'char_genjiro').ok); // not owned
});

test('unlock: consumes cumulative threshold, creates correct star state', () => {
  const s = newPlayerState(content, T0);
  const thorn = s.characters.char_genjiro; // medium: 110 shards -> 4★
  thorn.shards = 109;
  assert.ok(!unlockCharacter(content, s, 'char_genjiro').ok);
  thorn.shards = 115;
  const r = unlockCharacter(content, s, 'char_genjiro');
  assert.ok(r.ok);
  assert.ok(thorn.owned);
  assert.equal(thorn.stars, 4);
  assert.equal(thorn.shards, 5);
  // majors unlock at 7★
  const sable = s.characters.char_irina;
  sable.shards = 450;
  unlockCharacter(content, s, 'char_irina');
  assert.equal(sable.stars, 7);
});

test('world campaign: locked until five world characters owned; world nodes require matching party', () => {
  const s = newPlayerState(content, T0);
  assert.ok(!worldCampaignUnlocked(content, s, 'world_hidden_village').unlocked); // only 3 owned
  maxOut(content, s, ['char_mei', 'char_tsubaki']);
  assert.ok(worldCampaignUnlocked(content, s, 'world_hidden_village').unlocked);
  const mixed = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_mei', 'char_ashley'];
  const wnode = content.nodeById.wc_world_hidden_village_1;
  assert.ok(!partyLegality(content, s, mixed, wnode).legal);
  const pure = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_mei', 'char_tsubaki'];
  assert.ok(partyLegality(content, s, pure, wnode).legal);
  const r = clearNode(content, s, 'wc_world_hidden_village_1', pure, 1, makeRng(3), T0);
  assert.ok(r.ok);
  assert.deepEqual(r.rewards.fragments, ['frag_world_hidden_village_1']);
  // fragment only once
  const r2 = clearNode(content, s, 'wc_world_hidden_village_1', pure, 1, makeRng(3), T0);
  assert.deepEqual(r2.rewards.fragments, []);
});

test('World shard node keeps its archive reward and enforces the five-run cap', () => {
  const node = content.nodeById.wc_world_hidden_village_1;
  const oldShard = node.shardCharacter;
  const oldFirstClear = node.firstClear;
  node.shardCharacter = 'char_suzume';
  node.firstClear = { ...oldFirstClear, shards: { characterId: 'char_suzume', qty: 2 } };
  try {
    const s = newPlayerState(content, T0);
    const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_mei', 'char_tsubaki'];
    maxOut(content, s, party);
    s.characters.char_suzume.stars = 1;
    s.energy = 1000;
    const first = clearNode(content, s, node.id, party, 1, makeRng(7), T0);
    assert.ok(first.ok);
    assert.deepEqual(first.rewards.fragments, ['frag_world_hidden_village_1']);
    assert.ok(first.rewards.shards.char_suzume >= 2);
    assert.ok(clearNode(content, s, node.id, party, 4, makeRng(8), T0).ok);
    assert.equal(nodeState(s, node.id).attemptsToday, 5);
    assert.ok(!checkClear(content, s, node.id, party, 1).ok);
  } finally {
    node.shardCharacter = oldShard;
    node.firstClear = oldFirstClear;
  }
});

test('objective: one-time reward on a qualifying paid clear, never blocks progression', () => {
  const s = newPlayerState(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'];
  maxOut(content, s, party);
  const rng = makeRng(5);
  for (let i = 1; i <= 4; i++) assert.ok(clearNode(content, s, `main_${i}`, party, 1, rng, T0).ok);
  const node = content.nodeById.main_5; // objective: 2 distinct worlds
  const r = clearNode(content, s, 'main_5', party, 1, rng, T0);
  assert.ok(r.ok && r.rewards.objective);
  const r2 = clearNode(content, s, 'main_5', party, 1, rng, T0);
  assert.ok(!r2.rewards.objective); // claimed once
});

test('launch progression blocks crafting beyond the farmable material ceiling', () => {
  const s = newPlayerState(content, T0);
  const cs = s.characters.char_suzume;
  cs.gearTier = content.maxGearTier;
  for (const slot of content.characterMeta.slotOrder) cs.slots[slot] = true;
  const tier = checkCompleteTier(content, s, 'char_suzume');
  assert.ok(!tier.ok);
  assert.match(tier.reasons.join(' '), /Gear Tier 6/);

  give(s, 'mat_metal_advanced', 5);
  const conversion = upcraft(content, s, 'mat_metal_advanced', 1);
  assert.ok(!conversion.ok);
  assert.match(conversion.reasons.join(' '), /campaign/i);
});

test('Archive collections and completion unlock independently selectable skins', () => {
  const s = newPlayerState(content, T0);
  const archive = content.archiveByWorld.world_hidden_village;
  const collection = archive.collections[0];
  const collectionSkin = collection.rewardSkin;
  assert.deepEqual(unlockedSkins(content, s, collectionSkin.characterId), []);

  for (const relic of collection.relics) {
    for (const fragment of relic.fragments) s.archive.fragments[fragment.id] = true;
  }
  assert.deepEqual(unlockedSkins(content, s, collectionSkin.characterId).map(x => x.id), [collectionSkin.id]);
  assert.ok(selectSkin(content, s, collectionSkin.characterId, collectionSkin.id).ok);
  assert.equal(s.characters[collectionSkin.characterId].selectedSkinId, collectionSkin.id);

  for (const col of archive.collections) {
    for (const relic of col.relics) {
      for (const fragment of relic.fragments) s.archive.fragments[fragment.id] = true;
    }
  }
  const fullSkin = archive.fullReward;
  assert.ok(unlockedSkins(content, s, fullSkin.characterId).some(x => x.id === fullSkin.id));
  s.characters[fullSkin.characterId].owned = true;
  assert.ok(selectSkin(content, s, fullSkin.characterId, fullSkin.id).ok);
  assert.ok(!selectSkin(content, s, 'char_suzume', fullSkin.id).ok);
});
