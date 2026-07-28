// Dev pacing trace: runs the same greedy bot as the playthrough test but
// prints milestone days. Usage: node scripts/simulate.mjs [maxDays]
import { loadContent } from '../tests/helpers.mjs';
import { makeRng } from '../src/core/rng.js';
import { evaluateParty } from '../src/core/synergy.js';
import { activeTier } from '../src/core/power.js';
import { equipmentRecipe } from '../src/core/content.js';
import {
  newPlayerState, applyDailyReset, clearNode, checkClear, nodeState,
  craftComponent, upcraft, craftEquipment, completeGearTier,
  promoteStar, unlockCharacter, checkCompleteTier, checkPromoteStar,
  checkUnlockCharacter, checkCraftEquipment, maxCraftableComponents,
  nodeUnlocked, matQty, compQty, maxSweepCount, shardAttemptsLeft, archiveStatus
} from '../src/core/state.js';

const content = loadContent();
const DAY = 86400000;
const maxDays = Number(process.argv[2] ?? 4000);
const rng = makeRng(20260724);
let now = Date.parse('2026-07-24T12:00:00');
const s = newPlayerState(content, now);
const milestones = [];
const seen = new Set();
function mark(key, text, day) {
  if (seen.has(key)) return;
  seen.add(key);
  milestones.push([day, text]);
  console.log(`day ${String(day).padStart(4)}: ${text}`);
}

const ownedIds = () => content.characters.filter(d => s.characters[d.id].owned).map(d => d.id);
function bestParty(node) {
  const pool = ownedIds().filter(id => !node || node.type !== 'world' || content.characterById[id].world === node.world);
  if (pool.length < 5) return null;
  const byPower = [...pool].sort((a, b) => evaluateParty(content, s, [b]).rawPower - evaluateParty(content, s, [a]).rawPower);
  const candidates = [byPower.slice(0, 5)];
  for (const w of content.worlds) {
    const wpool = byPower.filter(id => content.characterById[id].world === w.id);
    if (wpool.length >= 5 && (!node || node.type !== 'world')) candidates.push(wpool.slice(0, 5));
  }
  let best = null, bp = -1;
  for (const cand of candidates) {
    const ev = evaluateParty(content, s, cand);
    if (ev.effectivePower > bp) { best = cand; bp = ev.effectivePower; }
  }
  return best;
}
function improve(day) {
  let acted = true;
  while (acted) {
    acted = false;
    for (const def of content.characters) {
      const id = def.id, cs = s.characters[id];
      if (!cs.owned) {
        if (checkUnlockCharacter(content, s, id).ok) { unlockCharacter(content, s, id); mark(`unlock_${id}`, `unlocked ${id}`, day); acted = true; }
        continue;
      }
      if (checkPromoteStar(content, s, id).ok) { promoteStar(content, s, id); if (cs.stars === 7) mark(`stars_${id}`, `${id} 7 stars`, day); acted = true; }
      if (checkCompleteTier(content, s, id).ok) { completeGearTier(content, s, id); if (cs.gearTier === 10) mark(`gear_${id}`, `${id} gear complete`, day); acted = true; }
      const tier = activeTier(content.balance, cs, content.maxGearTier);
      if (!tier) continue;
      for (const slot of content.characterMeta.slotOrder) {
        if (cs.slots[slot]) continue;
        const recipe = equipmentRecipe(content, id, slot, tier);
        for (const input of recipe.inputs) {
          const missing = input.qty - compQty(s, input.componentId);
          if (missing <= 0) continue;
          const can = Math.min(missing, maxCraftableComponents(content, s, input.componentId));
          if (can > 0 && craftComponent(content, s, input.componentId, can).ok) acted = true;
        }
        if (checkCraftEquipment(content, s, id, slot).ok) { craftEquipment(content, s, id, slot); acted = true; }
      }
    }
  }
}
function materialShortages() {
  const need = {};
  for (const id of ownedIds()) {
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
const unlockedNodes = () => content.nodes.filter(n => nodeUnlocked(content, s, n).unlocked);
function upcraftToward(materialId) {
  const chain = [];
  let cur = content.materialById[materialId];
  while (cur) { chain.unshift(cur); cur = content.materials.find(m => m.conversionTarget === cur.id); }
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const times = Math.floor(matQty(s, from.id) / from.conversionCost);
    if (times > 0) upcraft(content, s, from.id, times);
  }
}

let day = 0;
const done = () => content.characters.every(d => { const cs = s.characters[d.id]; return cs.owned && cs.stars === 7 && cs.gearTier === content.maxGearTier; })
  && nodeState(s, 'main_20').cleared
  && content.worlds.every(w => archiveStatus(content, s, w.id).complete);

while (!done() && day < maxDays) {
  day++; now += DAY;
  applyDailyReset(content, s, now);
  improve(day);
  let spent = true;
  while (spent && s.energy > 0) {
    spent = false;
    for (const campaign of ['main', ...content.worlds.map(w => w.campaignId)]) {
      const frontier = (content.nodesByCampaign[campaign] ?? []).find(n => !nodeState(s, n.id).cleared);
      if (!frontier || !nodeUnlocked(content, s, frontier).unlocked) continue;
      const party = bestParty(frontier);
      if (party && checkClear(content, s, frontier.id, party, 1).ok) {
        clearNode(content, s, frontier.id, party, 1, rng, now);
        if (frontier.position === 10) mark(frontier.id, `cleared ${frontier.id} (${frontier.displayName})`, day);
        improve(day);
        spent = true;
      }
    }
    if (spent) continue;
    for (const node of unlockedNodes().filter(n => n.shardCharacter)) {
      if (s.characters[node.shardCharacter].stars >= 7) continue;
      const left = shardAttemptsLeft(content, s, node);
      if (left <= 0) continue;
      const party = bestParty(node);
      if (!party) continue;
      const count = nodeState(s, node.id).cleared
        ? Math.min(left, maxSweepCount(content, s, node.id))
        : 1;
      if (count >= 1 && checkClear(content, s, node.id, party, count).ok) {
        clearNode(content, s, node.id, party, count, rng, now);
        spent = true;
      }
    }
    if (spent) { improve(day); continue; }
    const shortages = Object.entries(materialShortages()).sort((a, b) => b[1] - a[1]);
    const nodesNow = unlockedNodes().filter(n => !n.shardCharacter);
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
      const party = bestParty(node);
      if (!party) continue;
      const count = Math.min(6, maxSweepCount(content, s, node.id));
      if (count >= 1 && checkClear(content, s, node.id, party, count).ok) {
        clearNode(content, s, node.id, party, count, rng, now);
        if (node.material !== matId) upcraftToward(matId);
        improve(day);
        spent = true;
        // no break: spread energy across all shortages
      }
    }
    if (spent) continue;
    const cleared = nodesNow.filter(n => nodeState(s, n.id).cleared).sort((a, b) => b.number - a.number);
    for (const node of cleared) {
      const party = bestParty(node);
      if (!party) continue;
      const count = Math.min(4, maxSweepCount(content, s, node.id));
      if (count >= 1 && checkClear(content, s, node.id, party, count).ok) {
        clearNode(content, s, node.id, party, count, rng, now);
        improve(day);
        spent = true;
        break;
      }
    }
  }
}
console.log(`\nfinished=${done()} after ${day} days`);
for (const d of content.characters) {
  const cs = s.characters[d.id];
  console.log(`${d.id}: owned=${cs.owned} stars=${cs.stars} gear=${cs.gearTier} shards=${cs.shards}`);
}
