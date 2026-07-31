import { characterPowerForState } from './power.js';
import { hqRank } from './hq.js';
import { grantRewardEntries } from './resources.js';
import { fieldSupplyLimits, FIELD_SUPPLY_ID } from './energy.js';
import { makeRng } from './rng.js';

export const CRISIS_BOON_TYPES = new Set([
  'free_world_node_runs', 'bonus_world_material_runs', 'world_expedition_renown_bp',
  'next_hq_production_bp', 'instant_intelligence'
]);

const shuffle = (rng, list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function crisisDayRng(state, day = state.dayNumber) {
  let hash = 2166136261;
  const text = `crisis:${state.createdAt}:${day}`;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return makeRng(hash >>> 0);
}

export function crisisGrade(content, state, worldId) {
  const owned = content.characters.filter(def => state.characters[def.id]?.owned).length;
  const world = content.worldById[worldId];
  const rank = world?.hq?.enabled ? hqRank(content, state, worldId) : 0;
  const grades = content.crises?.settings?.grades ?? [];
  return [...grades].reverse().find(grade => owned >= grade.minOwned
    && (rank >= grade.minHqRank || (grade.allowNoHq && !world?.hq?.enabled))) ?? null;
}

export function eligibleCrisisDefinitions(content, state) {
  return (content.crises?.definitions ?? []).filter(definition => definition.enabled !== false
    && content.worldById[definition.worldId]
    && content.characters.filter(character => character.world === definition.worldId && state.characters[character.id]?.owned).length >= content.balance.partySize
    && crisisGrade(content, state, definition.worldId)
    && (definition.minimumClearedNodes ?? 0) <= (content.nodesByCampaign[`wc_${definition.worldId}`] ?? [])
      .filter(node => state.nodes[node.id]?.cleared).length);
}

function compactHistory(active, note = null) {
  return {
    definitionId: active.definitionId, worldId: active.worldId, name: active.name,
    gradeId: active.gradeId, day: active.day, outcome: active.result?.outcome ?? 'expired',
    cacheChoiceId: active.result?.cacheChoiceId ?? null, note
  };
}

export function expireActiveCrisis(state, note = null) {
  const active = state.crises?.active;
  if (!active) return null;
  state.crises.history.unshift(compactHistory(active, note));
  state.crises.history = state.crises.history.slice(0, 30);
  state.crises.active = null;
  return active;
}

export function generateCrisisForDay(content, state, rng = crisisDayRng(state)) {
  if (!state.crises || state.crises.active || state.dayNumber <= 1) return null;
  if (state.crises.lastSpawnDay === state.dayNumber - 1) return null;
  const eligible = eligibleCrisisDefinitions(content, state);
  if (!eligible.length || rng.next() >= (content.crises.settings.spawnChanceBp ?? 2500) / 10000) return null;
  const eligibleIds = new Set(eligible.map(definition => definition.id));
  let unseen = eligible.filter(definition => !state.crises.cycleSeen.includes(definition.id));
  if (!unseen.length) {
    state.crises.cycleSeen = state.crises.cycleSeen.filter(id => !eligibleIds.has(id));
    unseen = eligible;
  }
  const weighted = unseen.flatMap(definition => Array(Math.max(1, definition.weight ?? 1)).fill(definition));
  const definition = weighted[Math.floor(rng.next() * weighted.length)];
  const grade = crisisGrade(content, state, definition.worldId);
  const fronts = shuffle(rng, definition.fronts).slice(0, grade.frontCount).map(front => ({
    id: front.id, name: front.name, description: front.description,
    favoredTagIds: [...front.favoredTagIds], recommendedPower: front.recommendedPowerByGrade[grade.id],
    successText: front.successText, excelText: front.excelText, struggleText: front.struggleText
  }));
  const active = {
    definitionId: definition.id, worldId: definition.worldId, name: definition.name,
    openingDescription: definition.openingDescription, artworkId: definition.artwork ? definition.id : null,
    gradeId: grade.id, gradeName: grade.displayName, day: state.dayNumber,
    teamSize: grade.teamSize, frontIds: fronts.map(front => front.id), fronts,
    assignments: Object.fromEntries(fronts.map(front => [front.id, Array(grade.teamSize).fill(null)])),
    status: 'planning', result: null, cacheClaimed: false,
    consolationReward: structuredClone(definition.consolationReward ?? []),
    cacheChoices: structuredClone(definition.cacheChoices ?? []),
    boon: structuredClone(definition.boon ?? null)
  };
  state.crises.active = active;
  state.crises.lastSpawnDay = state.dayNumber;
  state.crises.cycleSeen.push(definition.id);
  return active;
}

export function characterCrisisTags(content, characterId) {
  const definition = content.characterById[characterId];
  return new Set([definition?.world, definition?.archetype, definition?.faction, ...(definition?.extraTags ?? [])].filter(Boolean));
}

export function previewCrisisFront(content, state, front, assignments) {
  const ids = (assignments ?? []).filter(Boolean);
  const basePower = ids.reduce((sum, id) => sum + characterPowerForState(content, state, id), 0);
  const represented = front.favoredTagIds.filter(tagId => ids.some(id => characterCrisisTags(content, id).has(tagId)));
  const matchedFavoredTagCount = Math.min(2, new Set(represented).size);
  const effectivePower = Math.floor(basePower * (10000 + matchedFavoredTagCount * 2000) / 10000);
  const excelAt = Math.ceil(front.recommendedPower * 12000 / 10000);
  const projection = effectivePower < front.recommendedPower ? 'struggle' : effectivePower < excelAt ? 'succeed' : 'excel';
  return { basePower, matchedTagIds: represented, matchedFavoredTagCount, effectivePower,
    recommendedPower: front.recommendedPower, projection, completed: projection !== 'struggle' };
}

export function previewCrisis(content, state) {
  const active = state.crises?.active;
  if (!active) return null;
  const fronts = active.fronts.map(front => ({ front, ...previewCrisisFront(content, state, front, active.assignments[front.id]) }));
  const completed = fronts.filter(front => front.completed).length;
  const outcome = active.fronts.length === 2
    ? completed === 2 ? 'mastered' : completed === 1 ? 'resolved' : 'endured'
    : completed === 3 ? 'mastered' : completed === 2 ? 'resolved' : 'endured';
  return { fronts, completed, outcome };
}

export function setCrisisAssignment(content, state, frontId, slotIndex, characterId) {
  const active = state.crises?.active;
  const reasons = [];
  if (!active || active.status !== 'planning') reasons.push('There is no unresolved Crisis to revise.');
  if (!active?.assignments[frontId]) reasons.push('That Crisis Front is not active.');
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= (active?.teamSize ?? 0)) reasons.push('That team slot does not exist.');
  if (characterId && (!content.characterById[characterId] || !state.characters[characterId]?.owned)) reasons.push('Only an owned character can answer a Crisis.');
  if (characterId && Object.entries(active?.assignments ?? {}).some(([id, slots]) => id !== frontId && slots.includes(characterId))) {
    reasons.push(`${content.characterById[characterId]?.displayName ?? characterId} is already assigned to another Front.`);
  }
  if (reasons.length) return { ok: false, reasons };
  const duplicate = active.assignments[frontId].findIndex((id, index) => id === characterId && index !== slotIndex);
  if (characterId && duplicate >= 0) return { ok: false, reasons: ['A character may occupy only one slot.'] };
  active.assignments[frontId][slotIndex] = characterId;
  return { ok: true };
}

function activateBoon(content, state, active) {
  if (!active.boon) return null;
  const boon = active.boon;
  boon.active = true;
  boon.activatedDay = state.dayNumber;
  if ('runs' in boon) boon.remainingRuns = boon.runs;
  if (boon.type === 'instant_intelligence') {
    boon.rewards = grantRewardEntries(content, state, [{ kind: 'resource', id: 'intelligence', qty: boon.qty }], active.worldId);
    boon.consumed = true;
  }
  return boon;
}

export function resolveCrisis(content, state) {
  const active = state.crises?.active;
  if (!active || active.status !== 'planning') return { ok: false, reasons: ['This Crisis has already been resolved or is no longer active.'] };
  const ids = Object.values(active.assignments).flat();
  if (ids.some(id => !id)) return { ok: false, reasons: ['Every Front needs its full response team before commitment.'] };
  if (new Set(ids).size !== ids.length) return { ok: false, reasons: ['A character cannot answer two Fronts in the same Crisis.'] };
  if (ids.some(id => !state.characters[id]?.owned || !content.characterById[id])) return { ok: false, reasons: ['Every assigned character must still be owned and active.'] };
  const projection = previewCrisis(content, state);
  const rewards = projection.outcome === 'endured'
    ? grantRewardEntries(content, state, active.consolationReward, active.worldId) : [];
  active.status = 'resolved';
  active.result = { outcome: projection.outcome, completed: projection.completed,
    fronts: projection.fronts.map(item => ({ frontId: item.front.id, projection: item.projection,
      basePower: item.basePower, effectivePower: item.effectivePower, matchedTagIds: item.matchedTagIds })),
    rewards, cacheChoiceId: null };
  if (projection.outcome === 'mastered') activateBoon(content, state, active);
  return { ok: true, active, result: active.result };
}

export function crisisCacheChoiceStatus(content, state, choice) {
  if (!choice) return { available: false, reason: 'That Cache choice does not exist.' };
  const supplies = (choice.rewards ?? []).filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID)
    .reduce((sum, entry) => sum + entry.qty, 0);
  if (supplies && fieldSupplyLimits(content, state).unreservedCapacity < supplies) {
    return { available: false, reason: 'Held and promised Field Supplies already fill the available storage.' };
  }
  return { available: true, reason: '' };
}

export function claimCrisisCache(content, state, choiceId) {
  const active = state.crises?.active;
  if (!active || active.status !== 'resolved' || active.result?.outcome === 'endured') return { ok: false, reasons: ['No Emergency Cache is waiting.'] };
  if (active.cacheClaimed) return { ok: false, reasons: ['This Emergency Cache has already been claimed.'] };
  const choice = active.cacheChoices.find(item => item.id === choiceId);
  const status = crisisCacheChoiceStatus(content, state, choice);
  if (!status.available) return { ok: false, reasons: [status.reason] };
  const rewards = grantRewardEntries(content, state, choice.rewards, active.worldId);
  active.cacheClaimed = true;
  active.result.cacheChoiceId = choice.id;
  active.result.cacheRewards = rewards;
  return { ok: true, choice, rewards };
}

export function activeCrisisBoon(state, type, worldId = null) {
  const active = state.crises?.active;
  const boon = active?.status === 'resolved' && active.result?.outcome === 'mastered' ? active.boon : null;
  if (!boon?.active || boon.consumed || boon.type !== type || (worldId && active.worldId !== worldId)) return null;
  return boon;
}

export function crisisNodeRunModifiers(state, node, count) {
  if (!node.world) return { freeRuns: 0, bonusMaterialRuns: 0, bonusMaterialQty: 0 };
  const free = activeCrisisBoon(state, 'free_world_node_runs', node.world);
  const material = activeCrisisBoon(state, 'bonus_world_material_runs', node.world);
  return {
    freeRuns: Math.min(count, free?.remainingRuns ?? 0),
    bonusMaterialRuns: Math.min(count, material?.remainingRuns ?? 0),
    bonusMaterialQty: material?.qty ?? 0
  };
}

export function consumeCrisisNodeBoons(state, node, modifiers) {
  const free = activeCrisisBoon(state, 'free_world_node_runs', node.world);
  const material = activeCrisisBoon(state, 'bonus_world_material_runs', node.world);
  if (free) { free.remainingRuns -= modifiers.freeRuns; if (free.remainingRuns <= 0) free.consumed = true; }
  if (material) { material.remainingRuns -= modifiers.bonusMaterialRuns; if (material.remainingRuns <= 0) material.consumed = true; }
}
