import { canAffordEntries, grantRewardEntries, spendEntries } from './resources.js';

export function hqState(state, worldId) {
  state.headquarters.worlds[worldId] ??= {
    facilities: {}, production: {}, staff: {}, claimedRanks: []
  };
  return state.headquarters.worlds[worldId];
}

export function facilityLevel(state, worldId, facilityId) {
  return hqState(state, worldId).facilities[facilityId] ?? 0;
}

export function hqRank(content, state, worldId) {
  const world = content.worldById[worldId];
  if (!world?.hq?.enabled) return 0;
  const total = world.hq.facilities.reduce((n, f) => n + facilityLevel(state, worldId, f.id), 0);
  let rank = 1;
  for (const milestone of world.hq.ranks) if (total >= milestone.totalLevels) rank = milestone.rank;
  return rank;
}

export function hqBackground(content, state, worldId) {
  const rank = hqRank(content, state, worldId);
  return content.images.headquarters?.[worldId]
    ?? content.images.hq?.[`${worldId}:${rank}`]
    ?? null;
}

export function communityFacility(world) {
  return world.hq?.facilities.find(f => f.category === 'community');
}

export function staffingCapacity(content, state, worldId) {
  const world = content.worldById[worldId], community = communityFacility(world);
  if (!community) return 0;
  const level = facilityLevel(state, worldId, community.id);
  return community.levels[level - 1]?.staffingSlots ?? 0;
}

export function assignedStaff(state, worldId) {
  return Object.values(hqState(state, worldId).staff).flat().filter(Boolean);
}

function staffScaleBp(content, state, worldId) {
  const world = content.worldById[worldId], community = communityFacility(world);
  const level = community ? facilityLevel(state, worldId, community.id) : 0;
  return community?.levels[level - 1]?.staffEffectBp ?? 10000;
}

export function assignHqStaff(content, state, worldId, facilityId, characterId) {
  const world = content.worldById[worldId], facility = world?.hq?.facilities.find(f => f.id === facilityId);
  const def = content.characterById[characterId];
  const hs = hqState(state, worldId);
  const reasons = [];
  if (!facility) reasons.push('Unknown facility.');
  if (!def || !state.characters[characterId]?.owned) reasons.push('Only owned characters can be assigned.');
  if (def?.world !== worldId) reasons.push('HQ staff must belong to this world.');
  if (!assignedStaff(state, worldId).includes(characterId)
    && assignedStaff(state, worldId).length >= staffingCapacity(content, state, worldId)) reasons.push('No HQ staffing slot is available.');
  if (reasons.length) return { ok: false, reasons };
  hs.staff = Object.fromEntries(Object.entries(hs.staff).map(([id, list]) => [id, list.filter(x => x !== characterId)]));
  (hs.staff[facilityId] ??= []).push(characterId);
  return { ok: true };
}

export function unassignHqStaff(state, worldId, characterId) {
  const hs = hqState(state, worldId);
  for (const [id, list] of Object.entries(hs.staff)) hs.staff[id] = list.filter(x => x !== characterId);
  return { ok: true };
}

export function startConstruction(content, state, worldId, facilityId) {
  if (state.headquarters.construction) return { ok: false, reasons: ['Another HQ facility is already under construction.'] };
  const world = content.worldById[worldId], facility = world?.hq?.facilities.find(f => f.id === facilityId);
  if (!facility) return { ok: false, reasons: ['Unknown HQ facility.'] };
  const current = facilityLevel(state, worldId, facilityId);
  const next = facility.levels[current];
  if (!next) return { ok: false, reasons: ['This facility is already fully developed.'] };
  const check = canAffordEntries(content, state, next.cost, worldId);
  if (!check.ok) return check;
  spendEntries(content, state, next.cost, worldId);
  state.headquarters.construction = {
    worldId, facilityId, targetLevel: current + 1, startDay: state.dayNumber,
    dueDay: state.dayNumber + (next.buildDays ?? 1), paidCost: structuredClone(next.cost),
    facilityName: facility.displayName
  };
  return { ok: true, construction: state.headquarters.construction };
}

export function cancelConstruction(content, state) {
  const build = state.headquarters.construction;
  if (!build) return { ok: false, reasons: ['Nothing is under construction.'] };
  if (build.startDay !== state.dayNumber) return { ok: false, reasons: ['Construction cannot be cancelled after its start day.'] };
  grantRewardEntries(content, state, build.paidCost, build.worldId);
  state.headquarters.construction = null;
  return { ok: true };
}

export function completeDueConstruction(content, state) {
  const build = state.headquarters.construction;
  if (!build || build.dueDay > state.dayNumber) return null;
  hqState(state, build.worldId).facilities[build.facilityId] = build.targetLevel;
  state.headquarters.construction = null;
  const world = content.worldById[build.worldId];
  const rank = world ? hqRank(content, state, build.worldId) : 0;
  const hs = hqState(state, build.worldId);
  const rewards = [];
  for (const milestone of world?.hq?.ranks ?? []) {
    if (milestone.rank <= rank && !hs.claimedRanks.includes(milestone.rank)) {
      hs.claimedRanks.push(milestone.rank);
      rewards.push(...grantRewardEntries(content, state, milestone.reward ?? [], build.worldId));
    }
  }
  return { ...build, rank, rewards };
}

export function setProduction(content, state, worldId, facilityId, optionId) {
  const facility = content.worldById[worldId]?.hq?.facilities.find(f => f.id === facilityId);
  if (!facility?.productionOptions?.some(o => o.id === optionId)) return { ok: false, reasons: ['Unknown production option.'] };
  hqState(state, worldId).production[facilityId] = optionId;
  return { ok: true };
}

export function applyHqProduction(content, state) {
  const produced = [];
  for (const world of content.worlds) {
    if (!world.hq?.enabled) continue;
    const crisis = state.crises?.active;
    const productionBoon = crisis?.worldId === world.id && crisis.status === 'resolved'
      && crisis.result?.outcome === 'mastered' && crisis.boon?.active && !crisis.boon?.consumed
      && crisis.boon?.type === 'next_hq_production_bp' ? crisis.boon : null;
    for (const facility of world.hq.facilities.filter(f => f.category === 'production')) {
      const level = facilityLevel(state, world.id, facility.id);
      if (!level) continue;
      const hs = hqState(state, world.id);
      let option = facility.productionOptions.find(o => o.id === hs.production[facility.id]);
      option ??= facility.productionOptions[0];
      if (!option) continue;
      hs.production[facility.id] = option.id;
      const achievers = (hs.staff[facility.id] ?? []).filter(id => content.characterById[id]?.archetype === 'achiever').length;
      const caretakers = option.resourceId === '@associated_world_asset'
        ? (hs.staff[facility.id] ?? []).filter(id => content.characterById[id]?.archetype === 'caretaker').length : 0;
      const staffBonus = Math.floor((achievers + caretakers) * 2000 * staffScaleBp(content, state, world.id) / 10000);
      const qty = Math.max(1, Math.floor((option.quantities[level - 1] ?? 0)
        * (10000 + staffBonus + (productionBoon?.bonusBp ?? 0)) / 10000));
      produced.push(...grantRewardEntries(content, state, [{ kind: option.kind, id: option.resourceId, qty }], world.id));
    }
    if (productionBoon) productionBoon.consumed = true;
  }
  return produced;
}

// World Asset an Operations path adds to that world's routes, by level.
const OPERATIONS_WORLD_ASSET_BP = [0, 500, 1000, 1500];

export function operationsWorldAssetBp(level) {
  return OPERATIONS_WORLD_ASSET_BP[level] ?? 0;
}

export function hqExpeditionModifiers(content, state, worldId) {
  const world = content.worldById[worldId];
  const operations = world?.hq?.facilities.find(f => f.category === 'operations');
  if (!operations) return { renownBp: 0, worldAssetBp: 0, rareChanceBp: 0 };
  const level = facilityLevel(state, worldId, operations.id);
  const staff = hqState(state, worldId).staff[operations.id] ?? [];
  const scale = staffScaleBp(content, state, worldId);
  return {
    worldAssetBp: operationsWorldAssetBp(level)
      + Math.floor(staff.filter(id => content.characterById[id]?.archetype === 'caretaker').length * 500 * scale / 10000),
    renownBp: Math.floor(staff.filter(id => content.characterById[id]?.archetype === 'leader').length * 500 * scale / 10000),
    rareChanceBp: Math.floor(staff.filter(id => content.characterById[id]?.archetype === 'free_spirit').length * 500 * scale / 10000)
  };
}

export function dailyExpeditionAllowances(content, state) {
  let freeRerolls = content.expeditions.settings.freeRerolls;
  let freePins = 0;
  for (const world of content.worlds) {
    if (hqRank(content, state, world.id) < 3) continue;
    if (world.hq.signatureEffect?.type === 'daily_free_reroll') freeRerolls += world.hq.signatureEffect.amount ?? 1;
    if (world.hq.signatureEffect?.type === 'daily_free_pin') freePins += world.hq.signatureEffect.amount ?? 1;
  }
  return { freeRerolls, freePins };
}
