// Acceptance 14.1: a new save can progress from the first Main node through
// both launch chapters, unlock all twenty characters to 7 Stars and the
// content-derived Gear Tier cap, and reassemble both world relics — using only
// in-game transactions (daily resets, clears, sweeps, crafting, promotions,
// Development Focus, Programs, Field Supplies, and Expedition cycles).
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
  maxSweepCount, worldCampaignUnlocked
} from '../src/core/state.js';
import { FOCUS_SLOTS, assignFocus, isRevealed } from '../src/core/focus.js';
import { relicStatus } from '../src/core/relics.js';
import { worldMasteryBreakdown, resolveMasteryChoice, pendingMasteryChoices } from '../src/core/mastery.js';
import { setProcurementFamily, setDevelopmentHero } from '../src/core/programs.js';
import { launchCycle, offerFeasibility, expeditionCharacterIds } from '../src/core/expeditions.js';
import { useSupplyTutoring, previewSupplyTutoring } from '../src/core/energy.js';

const content = loadContent();
const DAY = 86400000;

function ownedIds(s) {
  return content.characters.filter(d => s.characters[d.id].owned).map(d => d.id);
}

// The whole shard journey for one hero is 450 cumulative; how much is left?
function shardRemaining(s, id) {
  const cs = s.characters[id];
  const def = content.characterById[id];
  const starCosts = content.balance.starShards;
  if (!cs.owned) {
    const tier = content.balance.acquisitionTiers[def.tier];
    let rest = tier.cumulativeShards;
    for (let star = tier.unlockStar; star < 7; star++) rest += starCosts[star];
    return Math.max(0, rest - cs.shards);
  }
  let rest = 0;
  for (let star = cs.stars; star < 7; star++) rest += starCosts[star];
  return Math.max(0, rest - cs.shards);
}

// Point the three Focus slots at the revealed heroes closest to their next
// milestone, the Development Programs at their worlds' neediest heroes, and
// every Procurement at the family the bench is currently short of.
function manageAllocation(s, shortages) {
  const targets = content.characters
    .filter(d => isRevealed(s, d.id) && shardRemaining(s, d.id) > 0)
    .sort((a, b) => shardRemaining(s, a.id) - shardRemaining(s, b.id));
  FOCUS_SLOTS.forEach((slot, index) => {
    const target = targets[index];
    if (target && s.focus.slots[slot].characterId !== target.id) {
      assignFocus(content, s, slot, target.id);
    }
  });
  const family = Object.keys(shortages).length
    ? content.materialById[Object.entries(shortages).sort((a, b) => b[1] - a[1])[0][0]].family
    : content.materialMeta.familyOrder[0];
  for (const w of content.worlds) {
    setProcurementFamily(content, s, w.id, family);
    const worldTarget = targets.find(d => d.world === w.id);
    if (worldTarget) setDevelopmentHero(content, s, w.id, worldTarget.id);
  }
  for (const choice of pendingMasteryChoices(content, s)) {
    if (choice.kind === 'materialCache') {
      resolveMasteryChoice(content, s, choice.worldId, choice.rankId, { family });
    } else {
      const hero = targets.find(d => d.world === choice.worldId);
      if (hero) resolveMasteryChoice(content, s, choice.worldId, choice.rankId, { characterId: hero.id });
    }
  }
  for (const target of targets) {
    if (previewSupplyTutoring(content, s, target.id).ok) useSupplyTutoring(content, s, target.id);
  }
}

// Launch every feasible route of a waiting board with disjoint parties.
function runExpeditions(s) {
  if (!s.expeditions.board || s.expeditions.active) return;
  const busy = new Set(expeditionCharacterIds(s));
  const selections = [];
  for (const offer of s.expeditions.board.offers) {
    if (selections.length >= content.expeditions.settings.slotCount) break;
    const party = offerFeasibilityWithout(s, offer, busy);
    if (!party) continue;
    const selection = { offerId: offer.id, party };
    if (offer.baseRewards.some(e => e.kind === 'shards' && e.choice)) {
      const chosen = content.characters
        .filter(d => (!offer.world || d.world === offer.world) && isRevealed(s, d.id) && shardRemaining(s, d.id) > 0)
        .sort((a, b) => shardRemaining(s, a.id) - shardRemaining(s, b.id))[0]
        ?? content.characters.find(d => !offer.world || d.world === offer.world);
      if (!chosen) continue;
      selection.shardChoiceCharacterId = chosen.id;
    }
    selections.push(selection);
    for (const id of party) busy.add(id);
  }
  if (selections.length) launchCycle(content, s, selections);
}

// offerFeasibility excludes members of active routes; shadow the busy set in
// as a fake route so already-selected heroes are not offered twice.
function offerFeasibilityWithout(s, offer, busy) {
  if (ownedIds(s).filter(id => !busy.has(id)).length < offer.partySize) return null;
  const shadowed = { ...s, expeditions: { ...s.expeditions, active: { routes: [{ party: [...busy] }] } } };
  return offerFeasibility(content, shadowed, offer).party;
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

test('full playthrough: campaign, roster, gear, and relics complete', { timeout: 300000 }, () => {
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
    const relicsDone = content.worlds.every(w => relicStatus(content, s, w.id).complete);
    return allMaxed && mainDone && relicsDone;
  };

  while (!done() && day < maxDays) {
    day++;
    now += DAY;
    applyDailyReset(content, s, now);
    improve(s);
    manageAllocation(s, materialShortages(s));
    runExpeditions(s);

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

      // 2. material farming: spread energy across every current shortage.
      // Every sweep also advances all three Focus meters — the shard economy
      // and the gear economy share the same Energy.
      const shortages = Object.entries(materialShortages(s))
        .sort((a, b) => b[1] - a[1]);
      const nodesNow = unlockedNodes(s);
      for (const [matId] of shortages) {
        const mat = content.materialById[matId];
        let source = nodesNow.filter(n => n.material === matId);
        if (source.length === 0) {
          const rank = content.materialMeta.grades[mat.grade].rank;
          source = nodesNow.filter(n => {
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

      // 3. fallback: sweep the best cleared node — the Energy still feeds the
      // three Focus meters and the world's Procurement Program.
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
    const st = relicStatus(content, s, w.id);
    assert.ok(st.complete, `${w.id} relic ${st.ownedCount}/${st.total}`);
    // with everything complete, the derived Mastery score lands exactly on max
    const breakdown = worldMasteryBreakdown(content, s, w.id);
    assert.equal(breakdown.score, breakdown.max, `${w.id} mastery ${JSON.stringify(breakdown)}`);
  }
  assert.ok(worldCampaignUnlocked(content, s, 'world_hidden_village').unlocked);
  assert.ok(worldCampaignUnlocked(content, s, 'world_magic_academy').unlocked);
  assert.ok(validateSave(content, s).ok, 'save remains valid');
  console.log(`      playthrough completed in ${day} simulated days`);
  assert.ok(day < maxDays, 'completed before the day cap');
});
