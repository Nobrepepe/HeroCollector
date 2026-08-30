// Appendix B transaction invariants + core rule correctness (GDD 14.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, maxOut, give, newGame } from './helpers.mjs';
import { validateContent, validateSave } from '../src/core/validate.js';
import { characterPowerBreakdown, characterPower, maxCharacterPower } from '../src/core/power.js';
import { evaluateParty, partyLegality } from '../src/core/synergy.js';
import { makeRng } from '../src/core/rng.js';
import {
  applyDailyReset, resetDayKey, clearNode, checkClear,
  craftComponent, upcraft, craftEquipment, completeGearTier, promoteStar,
  unlockCharacter, checkCraftEquipment, nodeState, worldCampaignUnlocked,
  checkCompleteTier, selectSkin, maxSweepCount, newPlayerState
} from '../src/core/state.js';
import { unlockedSkins } from '../src/core/mastery.js';
import { isRevealed } from '../src/core/focus.js';
import { relicStatus } from '../src/core/relics.js';

const content = loadContent();
const DAY = 86400000;
const T0 = Date.parse('2026-07-24T12:00:00');

test('content passes full validation', () => {
  const result = validateContent(content);
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test('new save: starting state matches GDD 2.2', () => {
  const s = newGame(content, T0);
  const owned = content.characters.filter(d => s.characters[d.id].owned);
  assert.equal(owned.length, content.balance.rosterProgression.starterCount);
  assert.deepEqual([...s.starters].sort(), owned.map(d => d.id).sort(),
    'the save records exactly the five it granted');
  for (const d of owned) {
    assert.equal(s.characters[d.id].stars, content.balance.rosterProgression.recruitStar);
    assert.equal(s.characters[d.id].gearTier, 0);
    assert.ok(s.characters[d.id].revealed);
  }
  assert.equal(s.energy, 120);
  assert.deepEqual(s.inventory.materials, {});
  assert.ok(validateSave(content, s).ok);
});

test('power: launch maximum respects the authored Gear Tier 6 cap', () => {
  assert.equal(content.maxGearTier, 6);
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
  const ev = evaluateParty(content, s, ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget']);
  const missing = ev.inactive.map(i => i.missing).join(' | ');
  assert.match(missing, /Rebel/);
});

test('clear: insufficient power cannot start and spends no energy', () => {
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
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

test('Encounters: the first clear reveals the hero, stakes two shards, exactly once', () => {
  const s = newGame(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'];
  const rng = makeRng(7);
  s.energy = 1000;
  // The Main Campaign introduces every world's opening party in order; the
  // first node naming someone the save did not start with is the one to test.
  const node = content.nodesByCampaign.main
    .find(n => n.encounterCharacter && !s.characters[n.encounterCharacter].owned);
  const hero = node.encounterCharacter;
  assert.ok(!isRevealed(s, hero));
  for (let i = 1; i < node.number; i++) assert.ok(clearNode(content, s, `main_${i}`, party, 1, rng, T0).ok);
  const r = clearNode(content, s, node.id, party, 1, rng, T0);
  assert.ok(r.ok);
  assert.deepEqual(r.rewards.revealed, [hero]);
  assert.equal(s.characters[hero].shards, content.balance.rosterProgression.revealShardStake);
  assert.ok(isRevealed(s, hero));
  // repeat clears grant no further encounter shards and reveal nothing new
  const r2 = clearNode(content, s, node.id, party, 1, rng, T0);
  assert.ok(r2.ok);
  assert.deepEqual(r2.rewards.revealed, []);
  assert.equal(s.characters[hero].shards, content.balance.rosterProgression.revealShardStake);
  // sweeps are Energy-bound only: no per-day attempt limit exists anywhere
  assert.equal(maxSweepCount(content, s, node.id), Math.floor(s.energy / content.balance.nodeDefaults[node.type].energy));
});

test('daily reset: adds 120 up to 240 cap, idempotent, backward clock grants nothing', () => {
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
  give(s, 'mat_metal_basic', 12);
  const r = upcraft(content, s, 'mat_metal_basic', 2);
  assert.ok(r.ok);
  assert.equal(s.inventory.materials.mat_metal_basic, 2);
  assert.equal(s.inventory.materials.mat_metal_improved, 2);
  assert.ok(!upcraft(content, s, 'mat_metal_masterwork', 1).ok);
  assert.ok(!upcraft(content, s, 'mat_metal_basic', 1).ok); // only 2 left, need 5
});

test('equipment: equipping a completed slot is impossible; tier completion needs all six', () => {
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
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

test('recruiting: one cost and one joining Star for every hero', () => {
  const s = newGame(content, T0);
  const { recruitShards, recruitStar } = content.balance.rosterProgression;
  const thorn = s.characters.char_genjiro;
  thorn.shards = recruitShards - 1;
  assert.ok(!unlockCharacter(content, s, 'char_genjiro').ok);
  thorn.shards = recruitShards + 5;
  const r = unlockCharacter(content, s, 'char_genjiro');
  assert.ok(r.ok);
  assert.ok(thorn.owned);
  assert.equal(thorn.stars, recruitStar);
  assert.equal(thorn.shards, 5, 'exactly the threshold is consumed');
  // Heroes differ in fiction, not in price: the same cost recruits anyone.
  const sable = s.characters.char_irina;
  sable.shards = recruitShards;
  unlockCharacter(content, s, 'char_irina');
  assert.equal(sable.stars, recruitStar);
  assert.equal(sable.shards, 0);
});

test('the starting five are drawn per save, reproducibly and with spread', () => {
  const a = newPlayerState(content, T0);
  const b = newPlayerState(content, T0);
  assert.deepEqual(a.starters, b.starters, 'the same save reproduces its own five');
  assert.notDeepEqual(a.starters, newPlayerState(content, T0 + 86400000).starters,
    'a different save draws differently');
  assert.equal(new Set(a.starters).size, 5);
  assert.equal(new Set(a.starters.map(id => content.characterById[id].archetype)).size, 5,
    'five distinct archetypes while the roster allows it');
  for (const id of a.starters) assert.ok(a.characters[id].owned && a.characters[id].revealed);
  assert.ok(validateSave(content, a).ok);
});

test('world campaign: locked until five world characters owned; world nodes require matching party', () => {
  const s = newGame(content, T0);
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
});

test('relic pieces: first-clearing nodes 4, 9, 15, 21 reassembles the world relic', () => {
  const s = newGame(content, T0);
  const party = ['char_suzume', 'char_hoshi', 'char_ayame', 'char_mei', 'char_tsubaki'];
  maxOut(content, s, party);
  s.energy = 10000;
  const rng = makeRng(11);
  let pieceClears = 0;
  for (let n = 1; n <= 21; n++) {
    const r = clearNode(content, s, `wc_world_hidden_village_${n}`, party, 1, rng, T0);
    assert.ok(r.ok, `node ${n}: ${r.reasons?.join('; ')}`);
    if (r.rewards.relicPieces.length) {
      pieceClears++;
      assert.deepEqual(r.rewards.relicPieces, [`relic_world_hidden_village_p${pieceClears}`]);
      assert.ok([4, 9, 15, 21].includes(n));
    }
  }
  assert.equal(pieceClears, 4);
  const status = relicStatus(content, s, 'world_hidden_village');
  assert.ok(status.complete);
  // a repeat clear of a piece node never grants the piece again
  const again = clearNode(content, s, 'wc_world_hidden_village_4', party, 1, rng, T0);
  assert.deepEqual(again.rewards.relicPieces, []);
});

test('objective: one-time reward on a qualifying paid clear, never blocks progression', () => {
  const s = newGame(content, T0);
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
  const s = newGame(content, T0);
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

test('Mastery ranks unlock independently selectable skins', () => {
  const s = newGame(content, T0);
  const world = content.worldById.world_hidden_village;
  const knownSkin = world.masterySkins.find(entry => entry.rank === 'known');
  assert.deepEqual(unlockedSkins(content, s, knownSkin.characterId), []);

  // Clearing the whole World Campaign alone is 350 points: Known (200).
  for (const node of content.nodesByCampaign.wc_world_hidden_village) {
    s.nodes[node.id] = { cleared: true, firstClearClaimed: true, objectiveClaimed: false };
  }
  assert.deepEqual(unlockedSkins(content, s, knownSkin.characterId).map(x => x.id), [knownSkin.skinId]);
  s.characters[knownSkin.characterId].owned = true;
  assert.ok(selectSkin(content, s, knownSkin.characterId, knownSkin.skinId).ok);
  assert.equal(s.characters[knownSkin.characterId].selectedSkinId, knownSkin.skinId);

  // Everything maxed reaches Mastered (1000) and unlocks the final skin.
  const roster = content.characters.filter(d => d.world === world.id).map(d => d.id);
  maxOut(content, s, roster);
  for (const id of roster) {
    s.characters[id].revealed = true;
    s.characters[id].gearTier = content.maxGearTier;
  }
  for (const piece of content.relicByWorld[world.id].pieces) s.relics.pieces[piece.id] = true;
  const masteredSkin = world.masterySkins.find(entry => entry.rank === 'mastered');
  assert.ok(unlockedSkins(content, s, masteredSkin.characterId).some(x => x.id === masteredSkin.skinId));
  assert.ok(selectSkin(content, s, masteredSkin.characterId, masteredSkin.skinId).ok);
  assert.ok(!selectSkin(content, s, 'char_suzume', masteredSkin.skinId).ok);
});
