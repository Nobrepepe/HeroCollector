// Full-content playthrough bot for HeroCollector — the balance harness for
// the goal-driven overhaul. Loads the author's default_content.json and plays
// a greedy-but-sensible player: campaign frontier → gear materials, while
// Development Focus converts the same Energy into shards, Programs deliver,
// Mastery milestones pay, Field Supplies push targets, and one Expedition
// cycle runs every four days.
//
// Usage: node scripts/playtest.mjs [maxDays] [seed] [--quiet] [--no-supply]
//        [--no-expeditions] [--no-crises]

import { readFileSync } from 'node:fs';
import { buildContent, equipmentRecipe } from '../src/core/content.js';
import { compileManifest } from '../src/core/compile/index.js';
import { normalizeManifest } from '../src/core/manifest.js';
import { loadSystemRaw } from '../tests/helpers.mjs';
import { makeRng } from '../src/core/rng.js';
import { evaluateParty } from '../src/core/synergy.js';
import { activeTier, characterPowerForState } from '../src/core/power.js';
import {
  newPlayerState, applyDailyReset, clearNode, checkClear, nodeState,
  craftComponent, upcraft, craftEquipment, completeGearTier,
  promoteStar, unlockCharacter, checkCompleteTier, checkPromoteStar,
  checkUnlockCharacter, maxCraftableComponents,
  nodeUnlocked, matQty, compQty, maxSweepCount
} from '../src/core/state.js';
import {
  previewExpedition, launchCycle, offerFeasibility, expeditionCharacterIds
} from '../src/core/expeditions.js';
import { FOCUS_SLOTS, assignFocus, isRevealed } from '../src/core/focus.js';
import { relicStatus, restoreRelic } from '../src/core/relics.js';
import {
  worldMasteryBreakdown, masteryRank, resolveMasteryChoice, pendingMasteryChoices
} from '../src/core/mastery.js';
import { setProcurementFamily, setDevelopmentHero, installRelic } from '../src/core/programs.js';
import { previewSupplyTutoring, useSupplyTutoring } from '../src/core/energy.js';
import {
  previewCrisis, setCrisisAssignment, resolveCrisis, claimCrisisCache, crisisCacheChoiceStatus
} from '../src/core/crises.js';

// ---------------------------------------------------------------- content
const dbRaw = JSON.parse(readFileSync(new URL('../default_content.json', import.meta.url), 'utf8'));
const systemRaw = loadSystemRaw();
const merged = compileManifest(systemRaw, normalizeManifest(dbRaw, systemRaw.characters.slotOrder));
export const health = merged.health;
const content = buildContent(merged.raw);
content.images = merged.images;

const maxDays = Number(process.argv[2] ?? 3000);
const seed = Number(process.argv[3] ?? 20260806);
const QUIET = process.argv.includes('--quiet');
const NO_SUPPLY = process.argv.includes('--no-supply');
const NO_EXPEDITIONS = process.argv.includes('--no-expeditions');
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
  energyGranted: 0, energySpentNodes: 0, energyRefundedMomentum: 0, energyWastedAtCap: 0,
  runsByType: { ordinary: 0, advanced: 0, world: 0 },
  shardsFromFocus: 0, shardsFromEncounters: 0, shardsFromExpeditions: 0,
  shardsFromPrograms: 0, shardsFromMastery: 0, shardsFromTutoring: 0,
  fullEnergyDays: 0, focusShardsOnFullDays: 0,
  cyclesLaunched: 0, cyclesCompleted: 0, routesLaunched: 0, routesByTier: { completed: 0, successful: 0, exceptional: 0 },
  shipmentsDelivered: 0, developmentGrants: 0, operationsBoosts: 0,
  relicInstalledDays: {}, suppliesUsed: 0,
  crisesSpawned: 0, crisisOutcomes: {},
  daysNoEnergyLeftUnspent: 0, energyUnspentTotal: 0,
  daysBothAdvanced: 0, daysPlayed: 0
};
const daily = []; // per-25-day snapshot

// ---------------------------------------------------------------- helpers
const owned = () => content.characters.filter(d => s.characters[d.id].owned).map(d => d.id);
const cs = id => s.characters[id];
const isMaxed = id => cs(id).owned && cs(id).stars === 7 && cs(id).gearTier >= content.maxGearTier;

function shardRemaining(id) {
  const c = cs(id);
  const def = content.characterById[id];
  const starCosts = content.balance.starShards;
  let rest = 0;
  if (!c.owned) {
    const { recruitShards, recruitStar } = content.balance.rosterProgression;
    rest = recruitShards;
    for (let star = recruitStar; star < 7; star++) rest += starCosts[star];
  } else {
    for (let star = c.stars; star < 7; star++) rest += starCosts[star];
  }
  return Math.max(0, rest - c.shards);
}

// The six characters we drive to the endgame: the save's drawn starters plus
// one more from a world those starters already sit in, so world nodes stay
// reachable. Every hero costs the same now, so the tie-break is purely how
// early the campaign reveals them.
const SQUAD = (() => {
  const starters = [...s.starters];
  const startSet = new Set(starters);
  const extra = content.characters
    .filter(d => !startSet.has(d.id))
    .sort((a, b) => {
      const wa = starters.filter(id => content.characterById[id].world === a.world).length;
      const wb = starters.filter(id => content.characterById[id].world === b.world).length;
      if (wa !== wb) return wb - wa;
      const na = content.encounterNodesByCharacter[a.id]?.[0]?.number ?? 99;
      const nb = content.encounterNodesByCharacter[b.id]?.[0]?.number ?? 99;
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

let shardsToday = 0, materialsToday = 0;

function runNode(nodeId, count) {
  const node = content.nodeById[nodeId];
  const party = bestParty(node);
  if (!party) return false;
  const check = checkClear(content, s, nodeId, party, count);
  if (!check.ok) return false;
  const res = clearNode(content, s, nodeId, party, count, rng, now);
  if (!res.ok) { bug('clear_mismatch', `checkClear passed but clearNode failed on ${nodeId}: ${res.reasons.join('; ')}`); return false; }
  stats.energySpentNodes += res.rewards.energySpent;
  stats.energyRefundedMomentum += res.rewards.energyRefunded ?? 0;
  stats.runsByType[node.type] += count;
  for (const grant of res.rewards.focusShards) { stats.shardsFromFocus += grant.shards; shardsToday += grant.shards; }
  for (const q of Object.values(res.rewards.shards)) { stats.shardsFromEncounters += q; shardsToday += q; }
  materialsToday += Object.values(res.rewards.materials).reduce((a, b) => a + b, 0);
  for (const event of res.rewards.masteryEvents) recordMasteryEvent(event);
  if (s.energy < 0) bug('negative_energy', `Energy went negative (${s.energy}) after ${nodeId}`);
  return true;
}

function recordMasteryEvent(event) {
  mark(`mastery_${event.worldId}_${event.rankId}`,
    `${content.worldById[event.worldId]?.displayName ?? event.worldId} reached ${event.rankName} Mastery`);
}

// ---------------------------------------------------------------- allocation
// Focus, Programs, milestone choices, and Supplies: pointed at the squad
// first, then at whoever gates a world campaign, then everyone else.
function shardTargets() {
  const targets = [];
  // Opening a world campaign (five owned of that world) unlocks materials,
  // the relic, and most of the Mastery track — the cheap gate unlocks come
  // before the long squad journey.
  for (const w of content.worlds) {
    const cnt = content.characters.filter(d => d.world === w.id && cs(d.id).owned).length;
    if (cnt >= content.balance.partySize) continue;
    const gates = content.characters
      .filter(d => d.world === w.id && !cs(d.id).owned && isRevealed(s, d.id))
      .sort((a, b) => shardRemaining(a.id) - shardRemaining(b.id))
      .slice(0, content.balance.partySize - cnt);
    for (const d of gates) targets.push(d.id);
  }
  for (const id of SQUAD) if (isRevealed(s, id) && shardRemaining(id) > 0) targets.push(id);
  for (const d of content.characters) {
    if (isRevealed(s, d.id) && shardRemaining(d.id) > 0) targets.push(d.id);
  }
  return [...new Set(targets)];
}

function manageAllocation() {
  const targets = shardTargets();
  FOCUS_SLOTS.forEach((slot, index) => {
    const target = targets[index];
    if (target && s.focus.slots[slot].characterId !== target) assignFocus(content, s, slot, target);
  });
  const shortages = Object.entries(squadGearDemand()).sort((a, b) => b[1] - a[1]);
  const family = shortages.length
    ? content.materialById[shortages[0][0]].family
    : content.materialMeta.familyOrder[s.dayNumber % content.materialMeta.familyOrder.length];
  for (const w of content.worlds) {
    setProcurementFamily(content, s, w.id, family);
    const worldTarget = targets.find(id => content.characterById[id].world === w.id);
    if (worldTarget) setDevelopmentHero(content, s, w.id, worldTarget);
    const relic = relicStatus(content, s, w.id);
    // The simulated player goes and binds it the day the fourth piece lands;
    // an unbound relic cannot be installed, so this is the whole sequence.
    if (relic?.complete && !relic.restored) {
      const bound = restoreRelic(content, s, w.id);
      if (!bound.ok) bug('relic_bind', `binding failed: ${bound.reasons.join('; ')}`);
      else mark(`relic_bound_${w.id}`, `${w.displayName} relic bound whole`);
    }
    if (relicStatus(content, s, w.id)?.restored && !s.programs[w.id]?.relicSlot) {
      installRelic(content, s, w.id, 'procurement');
      stats.relicInstalledDays[w.id] = s.dayNumber;
      mark(`relic_installed_${w.id}`, `${w.displayName} relic installed into Procurement`);
    }
  }
  for (const choice of pendingMasteryChoices(content, s)) {
    if (choice.kind === 'materialCache') {
      const r = resolveMasteryChoice(content, s, choice.worldId, choice.rankId, { family });
      if (!r.ok) bug('mastery_cache', `cache choice failed: ${r.reasons.join('; ')}`);
    } else {
      const hero = targets.find(id => content.characterById[id].world === choice.worldId);
      if (!hero) continue;
      const r = resolveMasteryChoice(content, s, choice.worldId, choice.rankId, { characterId: hero });
      if (r.ok) { stats.shardsFromMastery += choice.qty; shardsToday += choice.qty; }
    }
  }
  if (!NO_SUPPLY) {
    for (const id of targets) {
      const pv = previewSupplyTutoring(content, s, id);
      if (!pv.ok) continue;
      const r = useSupplyTutoring(content, s, id);
      if (r.ok) { stats.suppliesUsed++; stats.shardsFromTutoring += r.qty; shardsToday += r.qty; }
    }
  }
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
          mark(`unlock_${id}`, `unlocked ${def.displayName}`);
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
      const squadDoneNow = SQUAD.every(x => isMaxed(x));
      if (!squadDoneNow && !SQUAD_SET.has(id)) continue;
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
function pickCycleParty(offer, busy) {
  const pool = owned().filter(id => !busy.has(id))
    .sort((a, b) => characterPowerForState(content, s, b) - characterPowerForState(content, s, a));
  if (pool.length < offer.partySize) return null;
  let best = null, bestScore = -1, tried = 0;
  const chosen = [];
  const walk = start => {
    if (tried > 3000) return;
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
      if (tried > 3000) return;
    }
  };
  walk(0);
  return best;
}

function runExpeditions() {
  if (NO_EXPEDITIONS) return;
  if (s.expeditions.active || !s.expeditions.board) return;
  const targets = shardTargets();
  const score = offer => {
    let v = 0;
    for (const e of [...(offer.fixedRewards ?? []), ...(offer.baseRewards ?? [])]) {
      if (e.kind === 'resource' && e.id === 'field_supply') v += 1000 * e.qty;
      if (e.kind === 'shards') v += 100 * e.qty;
      if (e.kind === 'resource') v += 5 * e.qty;
      if (e.kind === 'material') v += 3 * e.qty * Math.pow(2, rank(e.id));
    }
    return v;
  };
  const ordered = [...s.expeditions.board.offers].sort((a, b) => score(b) - score(a));
  const busy = new Set(expeditionCharacterIds(s));
  const selections = [];
  for (const offer of ordered) {
    if (selections.length >= content.expeditions.settings.slotCount) break;
    const party = pickCycleParty(offer, busy);
    if (!party) continue;
    const selection = { offerId: offer.id, party };
    const lead = offer.baseRewards.find(e => e.kind === 'shards' && e.choice);
    if (lead) {
      const chosen = targets.find(id => !lead.choice.world || content.characterById[id].world === lead.choice.world)
        ?? content.characters.find(d => (!lead.choice.world || d.world === lead.choice.world) && isRevealed(s, d.id))?.id;
      if (!chosen) continue;
      selection.shardChoiceCharacterId = chosen;
    }
    selections.push(selection);
    for (const id of party) busy.add(id);
  }
  if (!selections.length) return;
  const res = launchCycle(content, s, selections);
  if (!res.ok) {
    if (!res.reasons.some(r => /Field Supplies already fill/.test(r))) {
      bug('cycle_launch', `launchCycle rejected previewed-valid selections: ${res.reasons.join('; ')}`);
    }
    return;
  }
  stats.cyclesLaunched++;
  stats.routesLaunched += res.active.routes.length;
  for (const route of res.active.routes) stats.routesByTier[route.tier]++;
}

function collectDailySummary(summary) {
  for (const report of summary?.cycleReports ?? []) {
    stats.cyclesCompleted++;
    for (const route of report.routes) {
      for (const r of route.rewards ?? []) {
        if (r.kind === 'shards') { stats.shardsFromExpeditions += r.qty; shardsToday += r.qty; }
      }
    }
  }
  for (const event of summary?.shipments ?? []) {
    if (event.program === 'procurement') stats.shipmentsDelivered++;
    if (event.program === 'development') {
      stats.developmentGrants++;
      const qty = event.granted?.[0]?.qty ?? 0;
      stats.shardsFromPrograms += qty;
      shardsToday += qty;
    }
    if (event.program === 'operations') stats.operationsBoosts++;
  }
}

// ---------------------------------------------------------------- crises
function runCrisis() {
  if (NO_CRISES) return;
  const active = s.crises?.active;
  if (!active || active.status !== 'planning') return;
  stats.crisesSpawned++;
  const pool = owned();
  const used = new Set();
  const bonusBp = content.crises.settings.power?.favoredTagBonusBp ?? 2000;
  for (const front of active.fronts) {
    const favored = new Set(front.favoredTagIds);
    // A Front's bonus is per *team*: distinct favoured tags the team covers,
    // capped at two. So the value of a hero is their Power plus whatever new
    // tag they bring — never the tag alone. Ranking tags above Power trades a
    // maxed hero for an uninvested one to gain twenty percent, which loses.
    const covered = new Set();
    for (let i = 0; i < active.teamSize; i++) {
      let best = null, bestScore = -1;
      for (const id of pool) {
        if (used.has(id)) continue;
        const tags = tagsOf(id);
        const fresh = [...favored].filter(t => tags.has(t) && !covered.has(t));
        const gain = Math.min(2 - covered.size, fresh.length);
        const score = characterPowerForState(content, s, id) * (10000 + Math.max(0, gain) * bonusBp) / 10000;
        if (score > bestScore) { bestScore = score; best = { id, fresh }; }
      }
      if (!best) break;
      used.add(best.id);
      for (const tag of best.fresh) if (covered.size < 2) covered.add(tag);
      const r = setCrisisAssignment(content, s, front.id, i, best.id);
      if (!r.ok) bug('crisis_assign', `setCrisisAssignment failed: ${r.reasons.join('; ')}`);
    }
  }
  void previewCrisis(content, s);
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
  return (tagCache[id] = new Set([d.world, d.archetype, d.faction].filter(Boolean)));
}

// ---------------------------------------------------------------- energy day
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

function materialBatch() {
  const pool = unlockedNodes().filter(n => nodeState(s, n.id).cleared);
  if (!pool.length) return false;
  const shortages = Object.entries(squadGearDemand()).sort((a, b) => rank(b[0]) - rank(a[0]) || b[1] - a[1]);
  for (const [matId] of shortages) {
    const sources = farmNodesFor(matId, pool);
    if (!sources.length) continue;
    const node = sources[0];
    const count = Math.min(8, maxSweepCount(content, s, node.id));
    if (count < 1) continue;
    if (runNode(node.id, count)) {
      if (node.material !== matId) upcraftToward(matId);
      improve();
      return true;
    }
  }
  // Nothing specific outstanding: bank the highest grade available. The
  // Energy still feeds Focus and Procurement either way.
  const best = [...pool].sort((a, b) => rank(b.material) - rank(a.material) || energyPerUnit(a) - energyPerUnit(b))[0];
  const count = Math.min(8, maxSweepCount(content, s, best.id));
  if (count < 1) return false;
  if (runNode(best.id, count)) { improve(); return true; }
  return false;
}

function spendEnergy() {
  let guard = 0;
  while (s.energy > 0 && guard++ < 600) {
    if (pushFrontiers()) continue;
    if (materialBatch()) continue;
    break;
  }
  if (guard >= 600) bug('spend_loop', 'spendEnergy() hit its iteration guard');
}

// ---------------------------------------------------------------- goals
const squadDone = () => SQUAD.every(isMaxed);
const allDone = () => content.characters.every(d => isMaxed(d.id));
const campaignDone = () => content.nodes.every(n => nodeState(s, n.id).cleared);
const relicsDone = () => content.worlds.every(w => relicStatus(content, s, w.id)?.complete);

let squadDay = null, allDay = null, campaignDay = null, relicDay = null;
const masteryRankDays = {};

// ---------------------------------------------------------------- main loop
if (!QUIET) {
  console.log(`squad: ${SQUAD.map(id => content.characterById[id].displayName).join(', ')}`);
  console.log(`maxGearTier: ${content.maxGearTier} / ${content.balance.gearTierPower.length}, partySize: ${content.balance.partySize}\n`);
}

improve();
manageAllocation();
runExpeditions();

while (s.dayNumber < maxDays) {
  now += DAY;
  const before = s.energy;
  const summary = applyDailyReset(content, s, now);
  stats.energyGranted += content.balance.energy.dailyGrant;
  const capped = before + content.balance.energy.dailyGrant - content.balance.energy.storageCap;
  if (capped > 0) stats.energyWastedAtCap += capped;
  shardsToday = 0; materialsToday = 0;
  collectDailySummary(summary);
  const fullDay = before === 0 || s.energy >= content.balance.energy.dailyGrant;

  improve();
  manageAllocation();
  runCrisis();
  runExpeditions();
  spendEnergy();
  improve();

  stats.daysPlayed++;
  stats.energyUnspentTotal += s.energy;
  if (s.energy > 0) stats.daysNoEnergyLeftUnspent++;
  if (shardsToday > 0 && materialsToday > 0) stats.daysBothAdvanced++;
  if (fullDay && stats.energySpentNodes >= 120) { stats.fullEnergyDays++; stats.focusShardsOnFullDays += shardsToday; }

  for (const w of content.worlds) {
    const rankNow = masteryRank(content, s, w.id);
    const key = `${w.id}:${rankNow.id}`;
    if (rankNow.at > 0 && !masteryRankDays[key]) masteryRankDays[key] = s.dayNumber;
  }
  // Invariant: no removed currency may ever reappear.
  for (const id of Object.keys(s.inventory.resources ?? {})) {
    if (!content.resourceById[id]) bug('removed_currency', `unknown resource "${id}" appeared in the inventory`);
  }

  if (s.dayNumber % 25 === 0 || s.dayNumber < 15) {
    daily.push({
      day: s.dayNumber,
      owned: owned().length,
      maxed: content.characters.filter(d => isMaxed(d.id)).length,
      squadStars: SQUAD.reduce((n, id) => n + cs(id).stars, 0),
      squadGear: SQUAD.reduce((n, id) => n + cs(id).gearTier, 0),
      mainCleared: (content.nodesByCampaign.main ?? []).filter(n => nodeState(s, n.id).cleared).length,
      mastery: Object.fromEntries(content.worlds.map(w => [w.id, worldMasteryBreakdown(content, s, w.id).score])),
      power: (() => { const p = bestParty(null); return p ? evaluateParty(content, s, p).effectivePower : 0; })(),
      energyLeft: s.energy,
      shardsToday
    });
  }

  if (!squadDay && squadDone()) { squadDay = s.dayNumber; mark('SQUAD', `*** ENDGAME SQUAD COMPLETE: 6 maxed characters ***`); }
  if (!campaignDay && campaignDone()) { campaignDay = s.dayNumber; mark('CAMPAIGN', '*** every campaign node cleared ***'); }
  if (!relicDay && relicsDone()) { relicDay = s.dayNumber; mark('RELICS', '*** every world relic reassembled ***'); }
  if (!allDay && allDone()) { allDay = s.dayNumber; mark('ALL', '*** all characters maxed ***'); break; }
}

// ---------------------------------------------------------------- report
const totalShards = stats.shardsFromFocus + stats.shardsFromEncounters + stats.shardsFromExpeditions
  + stats.shardsFromPrograms + stats.shardsFromMastery + stats.shardsFromTutoring;
const result = {
  seed, maxDays,
  squad: SQUAD.map(id => content.characterById[id].displayName),
  squadDay, allDay, campaignDay, relicDay,
  daysRun: s.dayNumber,
  maxGearTier: content.maxGearTier,
  partySize: content.balance.partySize,
  // The headline playtest target: ~12 deterministic shards per 120 Energy.
  focusShardsPer120Energy: stats.energySpentNodes ? +(stats.shardsFromFocus / stats.energySpentNodes * 120).toFixed(2) : 0,
  shardsPerDay: stats.daysPlayed ? +(totalShards / stats.daysPlayed).toFixed(2) : 0,
  bothAdvancedShare: stats.daysPlayed ? +(stats.daysBothAdvanced / stats.daysPlayed).toFixed(3) : 0,
  cyclesPerFourDays: stats.daysPlayed ? +((stats.cyclesCompleted * 4) / stats.daysPlayed).toFixed(2) : 0,
  masteryRankDays,
  stats, bugs, milestones, daily,
  final: content.characters.map(d => ({
    id: d.id, name: d.displayName, world: d.world, starter: s.starters.includes(d.id),
    owned: cs(d.id).owned, stars: cs(d.id).stars, gear: cs(d.id).gearTier, shards: cs(d.id).shards,
    revealed: !!cs(d.id).revealed
  })),
  campaignProgress: Object.fromEntries(Object.entries(content.nodesByCampaign).map(([k, v]) =>
    [k, `${v.filter(n => nodeState(s, n.id).cleared).length}/${v.length}`])),
  relics: content.worlds.map(w => {
    const r = relicStatus(content, s, w.id);
    return { world: w.displayName, pieces: `${r?.ownedCount ?? 0}/${r?.total ?? 4}`, complete: !!r?.complete, bound: !!r?.restored, installed: s.programs[w.id]?.relicSlot ?? null };
  }),
  mastery: content.worlds.map(w => ({ world: w.displayName, ...worldMasteryBreakdown(content, s, w.id) })),
  inventoryTail: Object.fromEntries(Object.entries(s.inventory.materials).filter(([, q]) => q > 0)),
  resources: s.inventory.resources,
  health: merged.health
};
console.log('\n===JSON===');
console.log(JSON.stringify(result));
