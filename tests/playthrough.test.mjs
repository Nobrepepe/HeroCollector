// Acceptance 14.1: a new save can progress from the first Main node through
// both launch chapters, unlock all twenty characters to 7 Stars and the
// content-derived Gear Tier cap,
// and complete both World Campaigns and Archives — using only in-game
// transactions (daily resets, clears, sweeps, crafting, promotions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from './helpers.mjs';
import { makeRng } from '../src/core/rng.js';
import { evaluateParty } from '../src/core/synergy.js';
import { activeTier } from '../src/core/power.js';
import { equipmentRecipe } from '../src/core/content.js';
import { validateSave } from '../src/core/validate.js';
import {
  newPlayerState, applyDailyReset, clearNode, checkClear, nodeState,
  craftComponent, upcraft, craftEquipment, completeGearTier, promoteStar,
  unlockCharacter, checkCompleteTier, checkPromoteStar, checkUnlockCharacter,
  checkCraftEquipment, maxCraftableComponents, nodeUnlocked, matQty, compQty,
  maxSweepCount, shardAttemptsLeft, archiveStatus, worldCampaignUnlocked
} from '../src/core/state.js';

const content = loadContent();
const DAY = 86400000;
const GRADES = content.materialMeta.gradeOrder;

function ownedIds(s) {
  return content.characters.filter(d => s.characters[d.id].owned).map(d => d.id);
}

// Best legal party for a node: candidates are top-power mixed and same-world picks.
function bestParty(s, node) {
  const pool = ownedIds(s).filter(id => !node || node.type !== 'world' || content.characterById[id].world === node.world);
  if (pool.length < 5) return null;
  const byPower = [...pool].sort((a, b) => {
    const pa = evaluateParty(content, s, [a]).rawPower, pb = evaluateParty(content, s, [b]).rawPower;
    return pb - pa;
  });
  const candidates = [byPower.slice(0, 5)];
  for (const w of content.worlds) {
    const wpool = byPower.filter(id => content.characterById[id].world === w.id);
    if (wpool.length >= 5 && (!node || node.type !== 'world')) candidates.push(wpool.slice(0, 5));
  }
  let best = null, bestPower = -1;
  for (const cand of candidates) {
    const ev = evaluateParty(content, s, cand);
    if (ev.effectivePower > bestPower) { best = cand; bestPower = ev.effectivePower; }
  }
  return best;
}

// Perform every free (zero-energy) improvement until none applies.
function improve(s) {
  let acted = true;
  while (acted) {
    acted = false;
    for (const def of content.characters) {
      const id = def.id, cs = s.characters[id];
      if (!cs.owned) {
        if (checkUnlockCharacter(content, s, id).ok) { unlockCharacter(content, s, id); acted = true; }
        continue;
      }
      if (checkPromoteStar(content, s, id).ok) { promoteStar(content, s, id); acted = true; }
      if (checkCompleteTier(content, s, id).ok) { completeGearTier(content, s, id); acted = true; }
      const tier = activeTier(content.balance, cs, content.maxGearTier);
      if (!tier) continue;
      for (const slot of content.characterMeta.slotOrder) {
        if (cs.slots[slot]) continue;
        // craft missing components (from materials, upcrafting when short)
        const recipe = equipmentRecipe(content, id, slot, tier);
        for (const input of recipe.inputs) {
          let missing = input.qty - compQty(s, input.componentId);
          if (missing <= 0) continue;
          const can = Math.min(missing, maxCraftableComponents(content, s, input.componentId));
          if (can > 0 && craftComponent(content, s, input.componentId, can).ok) acted = true;
        }
        if (checkCraftEquipment(content, s, id, slot).ok) {
          craftEquipment(content, s, id, slot); acted = true;
        }
      }
    }
  }
}

// Aggregate material shortages for every owned character's active-tier recipes.
function materialShortages(s) {
  const need = {};
  for (const id of ownedIds(s)) {
    const cs = s.characters[id];
    const tier = activeTier(content.balance, cs, content.maxGearTier);
    if (!tier) continue;
    for (const slot of content.characterMeta.slotOrder) {
      if (cs.slots[slot]) continue;
      for (const input of equipmentRecipe(content, id, slot, tier).inputs) {
        const compMissing = Math.max(0, input.qty - compQty(s, input.componentId));
        if (compMissing === 0) continue;
        for (const mi of content.componentById[input.componentId].inputs) {
          need[mi.materialId] = (need[mi.materialId] ?? 0) + mi.qty * compMissing;
        }
      }
    }
  }
  for (const [id, qty] of Object.entries(need)) {
    const have = matQty(s, id);
    if (have >= qty) delete need[id]; else need[id] = qty - have;
  }
  return need;
}

function unlockedNodes(s) {
  return content.nodes.filter(n => nodeUnlocked(content, s, n).unlocked);
}

// Try upcrafting toward a needed material when no unlocked node drops it.
function upcraftToward(s, materialId) {
  const target = content.materialById[materialId];
  const chain = [];
  let cur = target;
  while (cur) {
    chain.unshift(cur);
    cur = content.materials.find(m => m.conversionTarget === cur.id);
  }
  let acted = false;
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const times = Math.floor(matQty(s, from.id) / from.conversionCost);
    if (times > 0 && upcraft(content, s, from.id, times).ok) acted = true;
  }
  return acted;
}

test('full playthrough: campaign, roster, gear, and archives complete', { timeout: 300000 }, () => {
  const rng = makeRng(20260724);
  let now = Date.parse('2026-07-24T12:00:00');
  const s = newPlayerState(content, now);
  const maxDays = 4000;
  let day = 0;

  const done = () => {
    const allMaxed = content.characters.every(d => {
      const cs = s.characters[d.id];
      return cs.owned && cs.stars === 7 && cs.gearTier === content.maxGearTier;
    });
    const mainDone = nodeState(s, 'main_20').cleared;
    const archivesDone = content.worlds.every(w => archiveStatus(content, s, w.id).complete);
    return allMaxed && mainDone && archivesDone;
  };

  while (!done() && day < maxDays) {
    day++;
    now += DAY;
    applyDailyReset(content, s, now);
    improve(s);

    let spent = true;
    while (spent && s.energy > 0) {
      spent = false;

      // 1. push campaign frontiers (main + both world campaigns)
      for (const campaign of ['main', ...content.worlds.map(w => w.campaignId)]) {
        const frontier = (content.nodesByCampaign[campaign] ?? [])
          .find(n => !nodeState(s, n.id).cleared);
        if (!frontier) continue;
        if (!nodeUnlocked(content, s, frontier).unlocked) continue;
        const party = bestParty(s, frontier);
        if (!party) continue;
        if (checkClear(content, s, frontier.id, party, 1).ok) {
          assert.ok(clearNode(content, s, frontier.id, party, 1, rng, now).ok);
          improve(s);
          spent = true;
        }
      }
      if (spent) continue;

      // 2. shard farming: sweep unlocked shard nodes for characters below 7★
      for (const node of unlockedNodes(s).filter(n => n.shardCharacter)) {
        if (s.characters[node.shardCharacter].stars >= 7) continue;
        const left = shardAttemptsLeft(content, s, node);
        if (left <= 0) continue;
        const party = bestParty(s, node);
        if (!party) continue;
        const count = nodeState(s, node.id).cleared
          ? Math.min(left, maxSweepCount(content, s, node.id))
          : 1;
        if (count < 1) continue;
        if (checkClear(content, s, node.id, party, count).ok) {
          clearNode(content, s, node.id, party, count, rng, now);
          spent = true;
        }
      }
      if (spent) { improve(s); continue; }

      // 3. material farming: spread energy across every current shortage
      const shortages = Object.entries(materialShortages(s))
        .sort((a, b) => b[1] - a[1]);
      const nodesNow = unlockedNodes(s);
      for (const [matId] of shortages) {
        const mat = content.materialById[matId];
        // prefer a freely repeatable node that drops it directly; else farm the
        // family's best lower grade and upcraft
        let source = nodesNow.filter(n => n.material === matId && !n.shardCharacter);
        if (source.length === 0) {
          const rank = content.materialMeta.grades[mat.grade].rank;
          source = nodesNow.filter(n => {
            if (n.shardCharacter) return false;
            const m = content.materialById[n.material];
            return m.family === mat.family && content.materialMeta.grades[m.grade].rank < rank;
          }).sort((a, b) => content.materialMeta.grades[content.materialById[b.material].grade].rank
                          - content.materialMeta.grades[content.materialById[a.material].grade].rank);
        }
        if (source.length === 0) continue;
        const node = source[0];
        const party = bestParty(s, node);
        if (!party) continue;
        const count = Math.min(6, maxSweepCount(content, s, node.id));
        if (count < 1) continue;
        if (checkClear(content, s, node.id, party, count).ok) {
          clearNode(content, s, node.id, party, count, rng, now);
          if (node.material !== matId) upcraftToward(s, matId);
          improve(s);
          spent = true;
          // no break: keep spreading energy across the remaining shortages
        }
      }
      if (spent) continue;

      // 4. fallback: sweep the best cleared node to make some progress
      const cleared = nodesNow.filter(n => nodeState(s, n.id).cleared)
        .sort((a, b) => b.number - a.number);
      for (const node of cleared) {
        const party = bestParty(s, node);
        if (!party) continue;
        const count = Math.min(4, maxSweepCount(content, s, node.id));
        if (count < 1) continue;
        if (checkClear(content, s, node.id, party, count).ok) {
          clearNode(content, s, node.id, party, count, rng, now);
          improve(s);
          spent = true;
          break;
        }
      }
    }

    // invariants hold every simulated day
    assert.ok(s.energy >= 0, 'energy never negative');
    for (const q of Object.values(s.inventory.materials)) assert.ok(q >= 0);
    for (const q of Object.values(s.inventory.components)) assert.ok(q >= 0);
  }

  // --- final assertions
  assert.ok(nodeState(s, 'main_20').cleared, `main campaign incomplete after ${day} days`);
  for (const d of content.characters) {
    const cs = s.characters[d.id];
    assert.ok(cs.owned, `${d.id} never unlocked`);
    assert.equal(cs.stars, 7, `${d.id} stars ${cs.stars}`);
    assert.equal(cs.gearTier, content.maxGearTier, `${d.id} gear tier ${cs.gearTier}`);
  }
  for (const w of content.worlds) {
    const st = archiveStatus(content, s, w.id);
    assert.ok(st.complete, `${w.id} archive ${st.relicsDone}/${st.relicsTotal}`);
    assert.ok(s.characters[st.archive.fullReward.characterId].owned);
  }
  assert.ok(worldCampaignUnlocked(content, s, 'world_hidden_village').unlocked);
  assert.ok(worldCampaignUnlocked(content, s, 'world_magic_academy').unlocked);
  assert.ok(validateSave(content, s).ok, 'save remains valid');
  console.log(`      playthrough completed in ${day} simulated days`);
  assert.ok(day < maxDays, 'completed before the day cap');
});
