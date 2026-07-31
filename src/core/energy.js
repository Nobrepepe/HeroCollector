import { facilityLevel } from './hq.js';
import { resourceQty } from './resources.js';

export const FIELD_SUPPLY_ID = 'field_supply';
export const FIELD_SUPPLY_RESTORE = 30;
export const MOMENTUM_DAILY_CAP = 30;

export function highestTrainingFacilityLevel(content, state) {
  let highest = 0;
  for (const world of content.worlds ?? []) {
    if (!world.hq?.enabled) continue;
    const training = world.hq.facilities?.find(facility => facility.category === 'training');
    if (training) highest = Math.max(highest, facilityLevel(state, world.id, training.id));
  }
  return highest;
}

export function fieldSupplyReservations(state, { excludingExpeditionId = null } = {}) {
  return (state.expeditions?.active ?? []).reduce((total, expedition) => {
    if (expedition.id === excludingExpeditionId) return total;
    return total + [...(expedition.fixedRewards ?? []), ...(expedition.rewards ?? [])]
      .filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID && entry.fixed !== false)
      .reduce((sum, entry) => sum + (entry.qty ?? 0), 0);
  }, 0);
}

export function fieldSupplyLimits(content, state) {
  const trainingLevel = highestTrainingFacilityLevel(content, state);
  const storageCap = trainingLevel >= 3 ? 4 : trainingLevel >= 1 ? 3 : 2;
  const dailyUseCap = trainingLevel >= 2 ? 2 : 1;
  const held = resourceQty(state, FIELD_SUPPLY_ID);
  const daily = state.energySystems?.daily ?? { suppliesUsed: 0 };
  const reserved = fieldSupplyReservations(state);
  return {
    trainingLevel, storageCap, dailyUseCap, restore: FIELD_SUPPLY_RESTORE,
    held, reserved,
    usesRemaining: Math.max(0, dailyUseCap - (daily.suppliesUsed ?? 0)),
    unreservedCapacity: Math.max(0, storageCap - held - reserved)
  };
}

export function previewFieldSupplyUse(content, state) {
  const limits = fieldSupplyLimits(content, state);
  const energyCap = content.balance.energy.storageCap;
  const restored = Math.max(0, Math.min(FIELD_SUPPLY_RESTORE, energyCap - state.energy));
  const reasons = [];
  if (limits.held < 1) reasons.push('No Field Supply is held. Expeditions are the reliable source.');
  if (limits.usesRemaining < 1) reasons.push('Every Field Supply use for this game day has already been spent.');
  if (restored < 1) reasons.push(`Energy is already at the ${energyCap} storage cap.`);
  return { ok: reasons.length === 0, reasons, restored, wasted: FIELD_SUPPLY_RESTORE - restored, ...limits };
}

export function useFieldSupply(content, state) {
  const preview = previewFieldSupplyUse(content, state);
  if (!preview.ok) return { ok: false, reasons: preview.reasons };
  state.inventory.resources[FIELD_SUPPLY_ID] = preview.held - 1;
  if (!state.inventory.resources[FIELD_SUPPLY_ID]) delete state.inventory.resources[FIELD_SUPPLY_ID];
  state.energySystems.daily.suppliesUsed++;
  state.energy += preview.restored;
  return { ok: true, restored: preview.restored, wasted: preview.wasted, energy: state.energy };
}

export function frontierMomentumPreview(state, { firstClear, energySpent }) {
  const used = state.energySystems?.daily?.momentumRefunded ?? 0;
  const remaining = Math.max(0, MOMENTUM_DAILY_CAP - used);
  const energyRefunded = firstClear ? Math.min(Math.max(0, energySpent), remaining) : 0;
  return { energyRefunded, remaining, dailyCap: MOMENTUM_DAILY_CAP };
}

export function resetDailyEnergySystems(state) {
  state.energySystems ??= { daily: { day: state.dayNumber, suppliesUsed: 0, momentumRefunded: 0 } };
  state.energySystems.daily = { day: state.dayNumber, suppliesUsed: 0, momentumRefunded: 0 };
}
