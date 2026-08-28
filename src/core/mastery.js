// World Mastery: a visible, fully derived 0..1000 track per world. The score
// is never stored — it is recomputed from campaign clears, the world roster's
// reveal/ownership/Stars, gear development, and relic pieces — so it can never
// drift. Milestone rewards are granted once per rank (recorded in
// `state.mastery[worldId].claimedRanks`); rewards that require a player
// decision are queued as pending choices instead of being rolled.
import { grantRewardEntries, resourceQty, FIELD_SUPPLY_ID } from './resources.js';
import { relicStatus } from './relics.js';
import { isRevealed } from './focus.js';

export function masteryState(state, worldId) {
  return state.mastery[worldId] ??= { claimedRanks: [], pendingChoices: [] };
}

export function worldMasteryBreakdown(content, state, worldId) {
  const config = content.balance.mastery;
  const weights = config.weights;
  const heroBp = config.heroWeightsBp;

  const pool = content.nodes.filter(node => node.world === worldId);
  const cleared = pool.filter(node => state.nodes[node.id]?.cleared).length;
  const campaign = pool.length ? Math.floor(weights.campaign * cleared / pool.length) : 0;

  const roster = content.characters.filter(def => def.world === worldId);
  let heroShareBp = 0;
  for (const def of roster) {
    const cs = state.characters[def.id];
    if (!cs) continue;
    if (cs.revealed || cs.owned) heroShareBp += heroBp.revealed;
    if (cs.owned) heroShareBp += heroBp.owned;
    heroShareBp += Math.floor(heroBp.stars * cs.stars / 7);
  }
  const heroes = roster.length ? Math.floor(weights.heroes * heroShareBp / (roster.length * 10000)) : 0;

  let gearSum = 0;
  for (const def of roster) gearSum += Math.min(state.characters[def.id]?.gearTier ?? 0, content.maxGearTier);
  const gear = roster.length && content.maxGearTier > 0
    ? Math.floor(weights.gear * gearSum / (roster.length * content.maxGearTier)) : 0;

  const relicState = relicStatus(content, state, worldId);
  const relic = relicState ? Math.floor(weights.relic * relicState.ownedCount / relicState.total) : 0;

  const max = config.ranks[config.ranks.length - 1]?.at ?? 1000;
  return {
    campaign, heroes, gear, relic,
    score: campaign + heroes + gear + relic, max,
    parts: {
      campaign: { earned: campaign, of: weights.campaign, cleared, poolSize: pool.length },
      heroes: { earned: heroes, of: weights.heroes, rosterSize: roster.length },
      gear: { earned: gear, of: weights.gear },
      relic: { earned: relic, of: weights.relic, pieces: relicState?.ownedCount ?? 0 }
    }
  };
}

export function masteryRankById(content, rankId) {
  return content.balance.mastery.ranks.find(rank => rank.id === rankId) ?? null;
}

export function masteryRank(content, state, worldId) {
  const { score, max } = worldMasteryBreakdown(content, state, worldId);
  const ranks = content.balance.mastery.ranks;
  let current = ranks[0];
  for (const rank of ranks) if (score >= rank.at) current = rank;
  const next = ranks[ranks.indexOf(current) + 1] ?? null;
  return { ...current, score, max, next };
}

export function masteryRankAtLeast(content, state, worldId, rankId) {
  const gate = masteryRankById(content, rankId);
  if (!gate) return false;
  return worldMasteryBreakdown(content, state, worldId).score >= gate.at;
}

// The best material grade this world has actually opened: the highest grade
// among its cleared nodes. Used by material-cache choices and Procurement
// shipments so a cache is always worth the world's current frontier.
export function worldMaterialGrade(content, state, worldId) {
  let best = 'basic', bestRank = -1;
  for (const node of content.nodes) {
    if (node.world !== worldId || !state.nodes[node.id]?.cleared) continue;
    const material = content.materialById[node.material];
    if (!material) continue;
    const rank = content.materialMeta.grades[material.grade]?.rank ?? -1;
    if (rank > bestRank) { bestRank = rank; best = material.grade; }
  }
  return best;
}

// Grant every newly crossed rank's milestone. Direct rewards (Field Supplies,
// skins) apply immediately; material caches and shard grants queue a pending
// choice. Returns one event per rank crossed, for presentation.
export function applyMasteryMilestones(content, state, worldId, now = Date.now()) {
  if (!content.worldById[worldId]) return [];
  const events = [];
  const config = content.balance.mastery;
  const { score } = worldMasteryBreakdown(content, state, worldId);
  const ms = masteryState(state, worldId);
  for (const rank of config.ranks) {
    if (rank.at <= 0 || score < rank.at || ms.claimedRanks.includes(rank.id)) continue;
    ms.claimedRanks.push(rank.id);
    const milestone = config.milestones?.[rank.id] ?? {};
    const event = { worldId, rankId: rank.id, rankName: rank.displayName, granted: [], choices: [], skins: [] };
    if (milestone.supplies) {
      // Automatic grants respect the flat storage cap rather than overflowing.
      const cap = content.balance.fieldSupply.storageCap;
      const qty = Math.min(milestone.supplies, Math.max(0, cap - resourceQty(state, FIELD_SUPPLY_ID)));
      if (qty > 0) event.granted.push(...grantRewardEntries(content, state, [{ kind: 'resource', id: FIELD_SUPPLY_ID, qty }]));
    }
    if (milestone.materialCache) {
      const choice = { rankId: rank.id, kind: 'materialCache', qty: milestone.materialCache };
      ms.pendingChoices.push(choice);
      event.choices.push(choice);
    }
    if (milestone.shardChoice) {
      const choice = { rankId: rank.id, kind: 'shards', qty: milestone.shardChoice };
      ms.pendingChoices.push(choice);
      event.choices.push(choice);
    }
    const world = content.worldById[worldId];
    for (const skin of world.masterySkins ?? []) {
      if (skin.rank === rank.id) event.skins.push(skin);
    }
    events.push(event);
  }
  return events;
}

// Resolve one queued milestone choice. Material caches take a family and pay
// at the world's opened grade; shard choices take a revealed hero of the world.
export function resolveMasteryChoice(content, state, worldId, rankId, payload = {}) {
  const ms = state.mastery[worldId];
  const index = (ms?.pendingChoices ?? []).findIndex(choice => choice.rankId === rankId);
  if (index === -1) return { ok: false, reasons: ['No milestone choice is waiting for that rank.'] };
  const choice = ms.pendingChoices[index];
  if (choice.kind === 'materialCache') {
    if (!content.materialMeta.familyOrder.includes(payload.family)) {
      return { ok: false, reasons: ['Choose a material family for the cache.'] };
    }
    const grade = worldMaterialGrade(content, state, worldId);
    const materialId = `mat_${payload.family}_${grade}`;
    if (!content.materialById[materialId]) return { ok: false, reasons: ['That material does not exist.'] };
    const granted = grantRewardEntries(content, state, [{ kind: 'material', id: materialId, qty: choice.qty }]);
    ms.pendingChoices.splice(index, 1);
    return { ok: true, choice, granted };
  }
  if (choice.kind === 'shards') {
    const def = content.characterById[payload.characterId];
    if (!def || def.world !== worldId) return { ok: false, reasons: ['Choose a hero from this world.'] };
    if (!isRevealed(state, payload.characterId)) return { ok: false, reasons: ['Only a revealed hero can receive targeted shards.'] };
    const cs = state.characters[payload.characterId];
    if (cs.owned && cs.stars >= 7) return { ok: false, reasons: ['This hero is already at the 7-Star maximum.'] };
    cs.shards += choice.qty;
    ms.pendingChoices.splice(index, 1);
    return { ok: true, choice, granted: [{ kind: 'shards', characterId: payload.characterId, qty: choice.qty }] };
  }
  return { ok: false, reasons: ['Unknown milestone choice.'] };
}

export function pendingMasteryChoices(content, state) {
  const pending = [];
  for (const world of content.worlds) {
    for (const choice of state.mastery[world.id]?.pendingChoices ?? []) {
      pending.push({ worldId: world.id, ...choice });
    }
  }
  return pending;
}

// Skins unlock through Mastery rank milestones of the character's home world.
export function unlockedSkins(content, state, characterId) {
  const def = content.characterById[characterId];
  if (!def) return [];
  const world = content.worldById[def.world];
  if (!world?.masterySkins?.length) return [];
  const { score } = worldMasteryBreakdown(content, state, def.world);
  return world.masterySkins
    .filter(entry => entry.characterId === characterId
      && (masteryRankById(content, entry.rank)?.at ?? Infinity) <= score)
    .map(entry => content.skinById[entry.skinId])
    .filter(Boolean);
}
