// Full-content playthrough bot for HeroCollector.
// Loads the author's default_content.json (not the sample pack) and plays a
// greedy-but-sensible player: campaign frontier -> squad shards -> gear
// materials, while running Expeditions, Headquarters, Crises and Field Supply.
//
// Usage: node playthrough.mjs [maxDays] [seed] [--quiet]

import { readFileSync } from 'node:fs';
import { buildContent, equipmentRecipe } from '../src/core/content.js';
import { mergeContent, upgradeCustomDB } from '../src/core/custom.js';
import { loadSystemRaw } from '../tests/helpers.mjs';
import { makeRng } from '../src/core/rng.js';
import { evaluateParty } from '../src/core/synergy.js';
import { activeTier, characterPowerForState } from '../src/core/power.js';
import {
  newPlayerState, applyDailyReset, clearNode, checkClear, nodeState,
  craftComponent, upcraft, craftEquipment, completeGearTier,
  promoteStar, unlockCharacter, checkCompleteTier, checkPromoteStar,
  checkUnlockCharacter, maxCraftableComponents,
  nodeUnlocked, matQty, compQty, maxSweepCount, shardAttemptsLeft, archiveStatus,
  ensureExpeditionBoard
} from '../src/core/state.js';
import {
  previewExpedition, launchExpedition, expeditionCharacterIds
} from '../src/core/expeditions.js';
import {
  startConstruction, facilityLevel, hqRank, assignHqStaff, staffingCapacity, setProduction
} from '../src/core/hq.js';
import {
  previewCrisis, setCrisisAssignment, resolveCrisis, claimCrisisCache, crisisCacheChoiceStatus
} from '../src/core/crises.js';
import { previewFieldSupplyUse, useFieldSupply } from '../src/core/energy.js';
import { canAffordEntries } from '../src/core/resources.js';

// ---------------------------------------------------------------- content
const dbRaw = JSON.parse(readFileSync(new URL('../default_content.json', import.meta.url), 'utf8'));
const merged = mergeContent(loadSystemRaw(), upgradeCustomDB(dbRaw));
export const health = merged.health;
const content = buildContent(merged.raw);
content.images = merged.images;

const maxDays = Number(process.argv[2] ?? 3000);
const seed = Number(process.argv[3] ?? 20260806);
const QUIET = process.argv.includes('--quiet');
const NO_SUPPLY = process.argv.includes('--no-supply');
const NO_EXPEDITIONS = process.argv.includes('--no-expeditions');
const NO_HQ = process.argv.includes('--no-hq');
const NO_CRISES = process.argv.includes('--no-crises');

const DAY = 86400000;
const rng = makeRng(seed);
let now = Date.parse('2026-01-01T12:00:00');
const s = newPlayerState(content, now);

// ---------------------------------------------------------------- telemetry
const bugs = [];
const seenBugs = new Set();
function bug(key, text) {
  if (seenBugs.has(key)) return;
  seenBugs.add(key);
  bugs.push({ day: s.dayNumber, key, text });
  if (!QUIET) console.log(`  !! BUG[${key}] day ${s.dayNumber}: ${text}`);
}
const milestones = [];
const seenMs = new Set();
function mark(key, text) {
  if (seenMs.has(key)) return;
  seenMs.add(key);
  milestones.push({ day: s.dayNumber, key, text });
  if (!QUIET) console.log(`day ${String(s.dayNumber).padStart(4)}: ${text}`);
}
const stats = {
  energyGranted: 0, energySpentNodes: 0, energyRefundedMomentum: 0, energyFromSupply: 0,
  energyWastedAtCap: 0,
  runsByType: { ordinary: 0, advanced: 0, shard: 0, world: 0 },
  shardsFromNodes: 0, shardsFromExpeditions: 0, shardsFromFirstClear: 0,
  expeditionsLaunched: 0, expeditionsByTier: { completed: 0, successful: 0, exceptional: 0 },
  crisesSpawned: 0, crisisOutcomes: {}, hqBuilds: 0,
  suppliesUsed: 0, suppliesWasted: 0,
  daysNoEnergyLeftUnspent: 0, energyUnspentTotal: 0,
  expTierByPhase: {}, energySplit: { shards: 0, materials: 0 }
};
const daily = []; // per-day snapshot

// ---------------------------------------------------------------- helpers
const owned = () => content.characters.filter(d => s.characters[d.id].owned).map(d => d.id);
const cs = id => s.characters[id];
const isMaxed = id => cs(id).owned && cs(id).stars === 7 && cs(id).gearTier >= content.maxGearTier;

// The six characters we drive to the endgame. Starters cost the least shards
// (their unlock threshold is already paid), so they anchor the squad; the
// sixth is the cheapest additional Minor with a live shard source.
const SQUAD = (() => {
  const starters = content.characters.filter(d => d.starting).map(d => d.id);
  const extra = content.characters
    .filter(d => !d.starting && d.tier === 'minor')
    // Prefer a world that already has starters, so world nodes stay reachable.
    .sort((a, b) => {
      const wa = starters.filter(id => content.characterById[id].world === a.world).length;
      const wb = starters.filter(id => content.characterById[id].world === b.world).length;
      if (wa !== wb) return wb - wa;
      const na = content.shardNodesByCharacter[a.id]?.[0]?.number ?? 99;
      const nb = content.shardNodesByCharacter[b.id]?.[0]?.number ?? 99;
      return na - nb;
    })[0];
  return [...starters, extra.id];
})();
const SQUAD_SET = new Set(SQUAD);

function partyCandidates(node) {
  const pool = owned();
  const out = [];
  const byPower = [...pool].sort((a, b) => characterPowerForState(content, s, b) - characterPowerForState(content, s, a));
  if (node?.type === 'world') {
    const w = byPower.filter(id => content.characterById[id].world === node.world);
    if (w.length >= 5) out.push(w.slice(0, 5));
    return out;
  }
  if (byPower.length >= 5) out.push(byPower.slice(0, 5));
  for (const w of content.worlds) {
    const wp = byPower.filter(id => content.characterById[id].world === w.id);
    if (wp.length >= 5) out.push(wp.slice(0, 5));
  }
  // Squad-first party (the characters we actually invest in).
  const squadOwned = SQUAD.filter(id => cs(id).owned);
  if (squadOwned.length >= 5) out.push(squadOwned.slice(0, 5));
  return out;
}

function bestParty(node) {
  let best = null, bp = -1;
  for (const cand of partyCandidates(node)) {
    const ev = evaluateParty(content, s, cand);
    if (ev.effectivePower > bp) { best = cand; bp = ev.effectivePower; }
  }
  return best;
}

function runNode(nodeId, count) {
  const node = content.nodeById[nodeId];
  const party = bestParty(node);
  if (!party) return false;
  const check = checkClear(content, s, nodeId, party, count);
  if (!check.ok) return false;
  const before = s.energy;
  const res = clearNode(content, s, nodeId, party, count, rng, now);
  if (!res.ok) { bug('clear_mismatch', `checkClear passed but clearNode failed on ${nodeId}: ${res.reasons.join('; ')}`); return false; }
  const spent = before - s.energy;
  stats.energySpentNodes += res.rewards.energySpent;
  stats.energyRefundedMomentum += res.rewards.energyRefunded ?? 0;
  stats.runsByType[node.type] += count;
  for (const [cid, q] of Object.entries(res.rewards.shards)) {
    if (node.shardCharacter === cid) stats.shardsFromNodes += q; else stats.shardsFromFirstClear += q;
  }
  if (s.energy < 0) bug('negative_energy', `Energy went negative (${s.energy}) after ${nodeId}`);
  return true;
}

// ---------------------------------------------------------------- improve
function improve() {
  let acted = true, guard = 0;
  while (acted && guard++ < 500) {
    acted = false;
    for (const def of content.characters) {
      const id = def.id, c = cs(id);
      if (!c.owned) {
        if (checkUnlockCharacter(content, s, id).ok) {
          unlockCharacter(content, s, id);
          mark(`unlock_${id}`, `unlocked ${def.displayName} (${def.tier})`);
          acted = true;
        }
        continue;
      }
      if (checkPromoteStar(content, s, id).ok) {
        promoteStar(content, s, id);
        if (c.stars === 7) mark(`stars_${id}`, `${def.displayName} reached 7 stars`);
        acted = true;
      }
      if (checkCompleteTier(content, s, id).ok) {
        completeGearTier(content, s, id);
        if (c.gearTier >= content.maxGearTier) mark(`gear_${id}`, `${def.displayName} gear complete (T${c.gearTier})`);
        acted = true;
      }
      // Only spend materials on gear for the squad until they are done; then
      // let everyone else use the surplus.
      const squadDone = SQUAD.every(x => isMaxed(x));
      if (!squadDone && !SQUAD_SET.has(id)) continue;
      const tier = activeTier(content.balance, c, content.maxGearTier);
      if (!tier) continue;
      for (const slot of content.characterMeta.slotOrder) {
        if (c.slots[slot]) continue;
        const recipe = equipmentRecipe(content, id, slot, tier);
        for (const input of recipe.inputs) {
          const missing = input.qty - compQty(s, input.componentId);
          if (missing <= 0) continue;
          const can = Math.min(missing, maxCraftableComponents(content, s, input.componentId));
          if (can > 0 && craftComponent(content, s, input.componentId, can).ok) acted = true;
        }
        const r = craftEquipment(content, s, id, slot);
        if (r.ok) acted = true;
      }
    }
  }
  if (guard >= 500) bug('improve_loop', 'improve() hit its 500-iteration guard — possible non-terminating craft loop');
}

// ---------------------------------------------------------------- shortages
function squadGearDemand() {
  const need = {};
  const targets = SQUAD.every(isMaxed) ? owned() : SQUAD.filter(id => cs(id).owned);
  for (const id of targets) {
    const c = cs(id);
    const tier = activeTier(content.balance, c, content.maxGearTier);
    if (!tier) continue;
    for (const slot of content.characterMeta.slotOrder) {
      if (c.slots[slot]) continue;
      for (const input of equipmentRecipe(content, id, slot, tier).inputs) {
        const missing = Math.max(0, input.qty - compQty(s, input.componentId));
        if (!missing) continue;
        for (const mi of content.componentById[input.componentId].inputs) {
          need[mi.materialId] = (need[mi.materialId] ?? 0) + mi.qty * missing;
        }
      }
    }
  }
  for (const [id, q] of Object.entries(need)) {
    const have = matQty(s, id);
    if (have >= q) delete need[id]; else need[id] = q - have;
  }
  return need;
}

const rank = matId => content.materialMeta.grades[content.materialById[matId].grade].rank;
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

// Best farm node for a material: exact grade first, otherwise the highest
// lower grade of the same family (upcraft feeds it).
function farmNodesFor(materialId, pool) {
  const mat = content.materialById[materialId];
  const exact = pool.filter(n => n.material === materialId);
  if (exact.length) return exact.sort((a, b) => energyPerUnit(a) - energyPerUnit(b));
  const r = rank(materialId);
  return pool
    .filter(n => {
      const m = content.materialById[n.material];
      return m.family === mat.family && content.materialMeta.grades[m.grade].rank < r;
    })
    .sort((a, b) => rank(b.material) - rank(a.material) || energyPerUnit(a) - energyPerUnit(b));
}

function energyPerUnit(node) {
  const d = content.balance.nodeDefaults[node.type];
  const yieldPerRun = d.repeat.count + d.repeat.bonusChanceBp / 10000;
  return d.energy / yieldPerRun;
}

// ---------------------------------------------------------------- expeditions
function pickExpeditionParty(offer) {
  const busy = expeditionCharacterIds(s);
  const pool = owned().filter(id => !busy.has(id))
    .sort((a, b) => characterPowerForState(content, s, b) - characterPowerForState(content, s, a));
  if (pool.length < offer.partySize) return null;
  // Try the strongest legal combination with a bounded search.
  let best = null, bestScore = -1, tried = 0;
  const chosen = [];
  const walk = start => {
    if (tried > 4000) return;
    if (chosen.length === offer.partySize) {
      tried++;
      const pv = previewExpedition(content, s, offer, chosen);
      if (!pv.valid) return;
      const score = (pv.tier === 'exceptional' ? 2e9 : pv.tier === 'successful' ? 1e9 : 0) + pv.power;
      if (score > bestScore) { bestScore = score; best = [...chosen]; }
      return;
    }
    for (let i = start; i <= pool.length - (offer.partySize - chosen.length); i++) {
      chosen.push(pool[i]);
      walk(i + 1);
      chosen.pop();
      if (tried > 4000) return;
    }
  };
  walk(0);
  return best;
}

function runExpeditions() {
  if (NO_EXPEDITIONS) return;
  ensureExpeditionBoard(content, s);
  const board = s.expeditions.board;
  if (!board) return;
  const slots = content.expeditions.settings.slotCount;
  // Prefer offers that promise Field Supply, then shards for the squad.
  const score = offer => {
    let v = 0;
    for (const e of [...(offer.fixedRewards ?? []), ...(offer.baseRewards ?? [])]) {
      if (e.kind === 'resource' && e.id === 'field_supply') v += 1000 * e.qty;
      if (e.kind === 'shards' && SQUAD_SET.has(e.characterId)) v += 200 * e.qty;
      if (e.kind === 'shards') v += 20 * e.qty;
      if (e.kind === 'resource') v += 5 * e.qty;
      if (e.kind === 'material') v += 3 * e.qty * Math.pow(2, rank(e.id));
    }
    return v / Math.max(1, offer.duration);
  };
  const ordered = [...board.offers].sort((a, b) => score(b) - score(a));
  for (const offer of ordered) {
    if (s.expeditions.active.length >= slots) break;
    const party = pickExpeditionParty(offer);
    if (!party) continue;
    const pv = previewExpedition(content, s, offer, party);
    const res = launchExpedition(content, s, offer.id, party);
    if (res.ok) {
      stats.expeditionsLaunched++;
      stats.expeditionsByTier[pv.tier]++;
      const bucket = Math.floor(s.dayNumber / 200) * 200;
      (stats.expTierByPhase[bucket] ??= { completed: 0, successful: 0, exceptional: 0 })[pv.tier]++;
    } else if (!res.reasons.some(r => /Field Supplies already fill/.test(r))) {
      bug('exp_launch', `launchExpedition rejected a previewed-valid party for "${offer.name}": ${res.reasons.join('; ')}`);
    }
  }
}

function collectExpeditionShardStats(summary) {
  for (const rep of summary?.expeditions ?? []) {
    for (const r of rep.rewards ?? []) if (r.kind === 'shards') stats.shardsFromExpeditions += r.qty;
  }
}

// ---------------------------------------------------------------- crises
function runCrisis() {
  if (NO_CRISES) return;
  const active = s.crises?.active;
  if (!active || active.status !== 'planning') return;
  stats.crisesSpawned++;
  const pool = owned().sort((a, b) => characterPowerForState(content, s, b) - characterPowerForState(content, s, a));
  const used = new Set();
  // Greedy: fill each front with the highest-power characters that carry its
  // favored tags, strongest front first.
  for (const front of active.fronts) {
    const favored = new Set(front.favoredTagIds);
    const ranked = pool.filter(id => !used.has(id)).sort((a, b) => {
      const ta = tagsOf(a), tb = tagsOf(b);
      const ma = [...favored].filter(t => ta.has(t)).length;
      const mb = [...favored].filter(t => tb.has(t)).length;
      if (ma !== mb) return mb - ma;
      return characterPowerForState(content, s, b) - characterPowerForState(content, s, a);
    });
    for (let i = 0; i < active.teamSize; i++) {
      const pick = ranked[i];
      if (!pick) break;
      used.add(pick);
      const r = setCrisisAssignment(content, s, front.id, i, pick);
      if (!r.ok) bug('crisis_assign', `setCrisisAssignment failed: ${r.reasons.join('; ')}`);
    }
  }
  const pv = previewCrisis(content, s);
  const res = resolveCrisis(content, s);
  if (!res.ok) {
    if (owned().length >= active.fronts.length * active.teamSize) {
      bug('crisis_resolve', `resolveCrisis failed with a full roster: ${res.reasons.join('; ')}`);
    }
    return;
  }
  stats.crisisOutcomes[res.result.outcome] = (stats.crisisOutcomes[res.result.outcome] ?? 0) + 1;
  mark(`crisis_${res.result.outcome}`, `first Crisis outcome: ${res.result.outcome} (${active.name})`);
  if (res.result.outcome !== 'endured') {
    const choice = (active.cacheChoices ?? []).find(c => crisisCacheChoiceStatus(content, s, c).available);
    if (choice) claimCrisisCache(content, s, choice.id);
  }
}
const tagCache = {};
function tagsOf(id) {
  if (tagCache[id]) return tagCache[id];
  const d = content.characterById[id];
  return (tagCache[id] = new Set([d.world, d.archetype, d.faction, ...(d.extraTags ?? [])].filter(Boolean)));
}

// ---------------------------------------------------------------- HQ
function runHq() {
  if (NO_HQ) return;
  for (const w of content.worlds) {
    if (!w.hq?.enabled) continue;
    // Staff every facility we can, favouring the archetypes that pay off.
    const cap = staffingCapacity(content, s, w.id);
    if (cap > 0) {
      const locals = content.characters.filter(d => d.world === w.id && cs(d.id).owned).map(d => d.id);
      for (const f of w.hq.facilities) {
        if (!facilityLevel(s, w.id, f.id)) continue;
        if (f.category === 'production') setProduction(content, s, w.id, f.id, f.productionOptions?.[0]?.id);
        for (const id of locals) assignHqStaff(content, s, w.id, f.id, id);
      }
    }
  }
  if (s.headquarters.construction) return;
  // Cheapest affordable upgrade, production and training first.
  const order = { production: 0, training: 1, operations: 2, community: 3 };
  const options = [];
  for (const w of content.worlds) {
    if (!w.hq?.enabled) continue;
    for (const f of w.hq.facilities) {
      const lvl = facilityLevel(s, w.id, f.id);
      const next = f.levels[lvl];
      if (!next) continue;
      if (!canAffordEntries(content, s, next.cost, w.id).ok) continue;
      options.push({ w, f, lvl, key: (order[f.category] ?? 9) * 100 + lvl });
    }
  }
  options.sort((a, b) => a.key - b.key);
  if (!options.length) return;
  const o = options[0];
  const r = startConstruction(content, s, o.w.id, o.f.id);
  if (r.ok) {
    stats.hqBuilds++;
    mark(`hq_${o.w.id}_${o.f.id}_${o.lvl + 1}`, `HQ: ${o.w.displayName} ${o.f.displayName} -> L${o.lvl + 1}`);
  }
}

// ---------------------------------------------------------------- energy day
// Energy spent today, split by purpose, so shards and gear both keep moving.
let spentShards = 0, spentMaterials = 0;

function pushFrontiers() {
  let acted = false;
  for (const campaign of ['main', ...content.worlds.map(w => w.campaignId)]) {
    const frontier = (content.nodesByCampaign[campaign] ?? []).find(n => !nodeState(s, n.id).cleared);
    if (!frontier || !nodeUnlocked(content, s, frontier).unlocked) continue;
    if (runNode(frontier.id, 1)) {
      if (frontier.position === 10) mark(frontier.id, `cleared ${frontier.id} — ${frontier.displayName} (thr ${frontier.threshold})`);
      improve();
      acted = true;
    }
  }
  return acted;
}

function shardBatch() {
  const squadLeft = SQUAD.some(id => !isMaxed(id));
  // Priority order: squad members short of 7 stars, then the characters that
  // still gate a world campaign, then everyone else.
  const targets = [];
  for (const id of SQUAD) if (cs(id).owned && cs(id).stars < 7) targets.push(id);
  for (const id of SQUAD) if (!cs(id).owned) targets.push(id);
  for (const w of content.worlds) {
    const cnt = content.characters.filter(d => d.world === w.id && cs(d.id).owned).length;
    if (cnt >= content.balance.partySize) continue;
    for (const d of content.characters.filter(d => d.world === w.id && !cs(d.id).owned)) targets.push(d.id);
  }
  if (!squadLeft) {
    for (const d of content.characters) if (cs(d.id).stars < 7) targets.push(d.id);
  }
  for (const id of [...new Set(targets)]) {
    for (const node of content.shardNodesByCharacter[id] ?? []) {
      if (!nodeUnlocked(content, s, node).unlocked) continue;
      const left = shardAttemptsLeft(content, s, node);
      if (left <= 0) continue;
      const count = nodeState(s, node.id).cleared ? Math.min(left, maxSweepCount(content, s, node.id)) : 1;
      if (count < 1) continue;
      const before = s.energy;
      if (runNode(node.id, count)) { spentShards += before - s.energy; improve(); return true; }
    }
  }
  return false;
}

function materialBatch() {
  const pool = unlockedNodes().filter(n => !n.shardCharacter && nodeState(s, n.id).cleared);
  if (!pool.length) return false;
  const shortages = Object.entries(squadGearDemand()).sort((a, b) => rank(b[0]) - rank(a[0]) || b[1] - a[1]);
  for (const [matId] of shortages) {
    const sources = farmNodesFor(matId, pool);
    if (!sources.length) continue;
    const node = sources[0];
    const count = Math.min(8, maxSweepCount(content, s, node.id));
    if (count < 1) continue;
    const before = s.energy;
    if (runNode(node.id, count)) {
      if (node.material !== matId) upcraftToward(matId);
      spentMaterials += before - s.energy;
      improve();
      return true;
    }
  }
  // Nothing specific outstanding: bank the highest grade available.
  const best = [...pool].sort((a, b) => rank(b.material) - rank(a.material) || energyPerUnit(a) - energyPerUnit(b))[0];
  const count = Math.min(8, maxSweepCount(content, s, best.id));
  if (count < 1) return false;
  const before = s.energy;
  if (runNode(best.id, count)) { spentMaterials += before - s.energy; improve(); return true; }
  return false;
}

function spendEnergy() {
  let guard = 0;
  while (s.energy > 0 && guard++ < 600) {
    if (pushFrontiers()) continue;
    // Gear is what lifts Power past the next threshold, so material farming
    // keeps a majority share until every squad member's gear is finished.
    const gearOutstanding = SQUAD.some(id => cs(id).owned && cs(id).gearTier < content.maxGearTier);
    const shardShare = gearOutstanding ? 0.45 : 0.95;
    const total = spentShards + spentMaterials;
    const preferShards = total === 0 ? true : spentShards / total < shardShare;
    const first = preferShards ? shardBatch : materialBatch;
    const second = preferShards ? materialBatch : shardBatch;
    if (first()) continue;
    if (second()) continue;
    break;
  }
  if (guard >= 600) bug('spend_loop', 'spendEnergy() hit its iteration guard');
}

function useSupplies() {
  if (NO_SUPPLY) return;
  let guard = 0;
  while (guard++ < 5) {
    const pv = previewFieldSupplyUse(content, s);
    if (!pv.ok) return;
    const r = useFieldSupply(content, s);
    if (!r.ok) { bug('supply_mismatch', `previewFieldSupplyUse ok but useFieldSupply failed: ${r.reasons.join('; ')}`); return; }
    stats.energyFromSupply += r.restored;
    stats.suppliesUsed++;
    stats.suppliesWasted += r.wasted;
    spendEnergy();
  }
}

// ---------------------------------------------------------------- goals
const squadDone = () => SQUAD.every(isMaxed);
const allDone = () => content.characters.every(d => isMaxed(d.id));
const campaignDone = () => content.nodes.every(n => nodeState(s, n.id).cleared);
const archivesDone = () => content.worlds.every(w => archiveStatus(content, s, w.id).complete);

let squadDay = null, allDay = null, campaignDay = null, archiveDay = null;

// ---------------------------------------------------------------- main loop
if (!QUIET) {
  console.log(`squad: ${SQUAD.map(id => content.characterById[id].displayName).join(', ')}`);
  console.log(`maxGearTier: ${content.maxGearTier} / ${content.balance.gearTierPower.length}, partySize: ${content.balance.partySize}\n`);
}

improve();
runExpeditions();
runHq();

while (s.dayNumber < maxDays) {
  now += DAY;
  const before = s.energy;
  const summary = applyDailyReset(content, s, now);
  stats.energyGranted += content.balance.energy.dailyGrant;
  const capped = before + content.balance.energy.dailyGrant - content.balance.energy.storageCap;
  if (capped > 0) stats.energyWastedAtCap += capped;
  collectExpeditionShardStats(summary);
  spentShards = 0; spentMaterials = 0;

  improve();
  runCrisis();
  runHq();
  runExpeditions();
  spendEnergy();
  useSupplies();
  improve();

  stats.energySplit.shards += spentShards;
  stats.energySplit.materials += spentMaterials;
  stats.energyUnspentTotal += s.energy;
  if (s.energy > 0) stats.daysNoEnergyLeftUnspent++;

  if (s.dayNumber % 25 === 0 || s.dayNumber < 15) {
    daily.push({
      day: s.dayNumber,
      owned: owned().length,
      maxed: content.characters.filter(d => isMaxed(d.id)).length,
      squadStars: SQUAD.reduce((n, id) => n + cs(id).stars, 0),
      squadGear: SQUAD.reduce((n, id) => n + cs(id).gearTier, 0),
      mainCleared: (content.nodesByCampaign.main ?? []).filter(n => nodeState(s, n.id).cleared).length,
      power: (() => { const p = bestParty(null); return p ? evaluateParty(content, s, p).effectivePower : 0; })(),
      energyLeft: s.energy
    });
  }

  if (!squadDay && squadDone()) { squadDay = s.dayNumber; mark('SQUAD', `*** ENDGAME SQUAD COMPLETE: 6 maxed characters ***`); }
  if (!campaignDay && campaignDone()) { campaignDay = s.dayNumber; mark('CAMPAIGN', '*** every campaign node cleared ***'); }
  if (!archiveDay && archivesDone()) { archiveDay = s.dayNumber; mark('ARCHIVE', '*** every Archive complete ***'); }
  if (!allDay && allDone()) { allDay = s.dayNumber; mark('ALL', '*** all 40 characters maxed ***'); break; }
}

// ---------------------------------------------------------------- report
const result = {
  seed, maxDays,
  squad: SQUAD.map(id => content.characterById[id].displayName),
  squadDay, allDay, campaignDay, archiveDay,
  daysRun: s.dayNumber,
  maxGearTier: content.maxGearTier,
  gearTierTableLength: content.balance.gearTierPower.length,
  partySize: content.balance.partySize,
  stats, bugs, milestones, daily,
  final: content.characters.map(d => ({
    id: d.id, name: d.displayName, world: d.world, tier: d.tier,
    owned: cs(d.id).owned, stars: cs(d.id).stars, gear: cs(d.id).gearTier, shards: cs(d.id).shards
  })),
  campaignProgress: Object.fromEntries(Object.entries(content.nodesByCampaign).map(([k, v]) =>
    [k, `${v.filter(n => nodeState(s, n.id).cleared).length}/${v.length}`])),
  archives: content.worlds.map(w => {
    const a = archiveStatus(content, s, w.id);
    return { world: w.displayName, relics: `${a.relicsDone}/${a.relicsTotal}`, complete: a.complete };
  }),
  inventoryTail: Object.fromEntries(Object.entries(s.inventory.materials).filter(([, q]) => q > 0)),
  resources: s.inventory.resources,
  health: merged.health
};
console.log('\n===JSON===');
console.log(JSON.stringify(result));
