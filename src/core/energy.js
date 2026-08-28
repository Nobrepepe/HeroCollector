// Energy-adjacent systems: Field Supplies and Frontier Momentum.
//
// Field Supplies are stored strategic consumables with three targeted modes —
// there is no daily use requirement and no plain Energy conversion, because
// each mode skips straight to what the Energy would have been spent on:
//   Requisition — the guaranteed material yield of ~30 Energy of sweeps of a
//                 chosen material's best cleared source.
//   Tutoring    — a fixed shard grant for any chosen revealed hero.
//   Surge       — arm a one-attempt +5% effective-Power push, spent only when
//                 it actually carries a node attempt past its gate.
import { resourceQty, addResource, FIELD_SUPPLY_ID } from './resources.js';
import { isRevealed } from './focus.js';

export { FIELD_SUPPLY_ID };
export const MOMENTUM_DAILY_CAP = 30;

export function fieldSupplyReservations(state) {
  const routes = state.expeditions?.active?.routes ?? [];
  return routes.reduce((total, route) => total + [...(route.fixedRewards ?? []), ...(route.rewards ?? [])]
    .filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID)
    .reduce((sum, entry) => sum + (entry.qty ?? 0), 0), 0);
}

export function fieldSupplyLimits(content, state) {
  const storageCap = content.balance.fieldSupply.storageCap;
  const held = resourceQty(state, FIELD_SUPPLY_ID);
  const reserved = fieldSupplyReservations(state);
  return {
    storageCap, held, reserved,
    unreservedCapacity: Math.max(0, storageCap - held - reserved)
  };
}

function spendSupply(state) {
  return addResource(state, FIELD_SUPPLY_ID, -1);
}

// --- Requisition: targeted materials -----------------------------------------
export function previewSupplyRequisition(content, state, materialId) {
  const reasons = [];
  if (resourceQty(state, FIELD_SUPPLY_ID) < 1) reasons.push('No Field Supply is held. Expedition cycles and Mastery milestones are the sources.');
  const material = content.materialById[materialId];
  if (!material) return { ok: false, reasons: ['Unknown material.'] };
  let best = null;
  for (const node of content.nodesByMaterial[materialId] ?? []) {
    if (!state.nodes[node.id]?.cleared) continue;
    const energy = content.balance.nodeDefaults[node.type].energy;
    const guaranteed = content.balance.nodeDefaults[node.type].repeat.count;
    if (!best || guaranteed / energy > best.guaranteed / best.energy) best = { node, energy, guaranteed };
  }
  if (!best) reasons.push(`No cleared node drops ${material.displayName} yet. Clear one of its sources first.`);
  const runs = best ? Math.floor(content.balance.fieldSupply.cacheEnergyValue / best.energy) : 0;
  const qty = best ? runs * best.guaranteed : 0;
  if (best && qty < 1) reasons.push('The best source is too expensive for one requisition.');
  return { ok: reasons.length === 0, reasons, material, qty, runs, source: best?.node ?? null };
}

export function useSupplyRequisition(content, state, materialId) {
  const preview = previewSupplyRequisition(content, state, materialId);
  if (!preview.ok) return { ok: false, reasons: preview.reasons };
  spendSupply(state);
  state.inventory.materials[materialId] = (state.inventory.materials[materialId] ?? 0) + preview.qty;
  return { ok: true, materialId, qty: preview.qty, source: preview.source };
}

// --- Tutoring: targeted shards -----------------------------------------------
export function previewSupplyTutoring(content, state, characterId) {
  const reasons = [];
  if (resourceQty(state, FIELD_SUPPLY_ID) < 1) reasons.push('No Field Supply is held. Expedition cycles and Mastery milestones are the sources.');
  const def = content.characterById[characterId];
  const cs = state.characters[characterId];
  if (!def || !cs) return { ok: false, reasons: ['Unknown character.'] };
  if (!isRevealed(state, characterId)) reasons.push('Only a revealed hero can be tutored. Encounter them in a campaign first.');
  if (cs.owned && cs.stars >= 7) reasons.push('This hero is already at the 7-Star maximum.');
  return { ok: reasons.length === 0, reasons, qty: content.balance.fieldSupply.shardGrant };
}

export function useSupplyTutoring(content, state, characterId) {
  const preview = previewSupplyTutoring(content, state, characterId);
  if (!preview.ok) return { ok: false, reasons: preview.reasons };
  spendSupply(state);
  state.characters[characterId].shards += preview.qty;
  return { ok: true, characterId, qty: preview.qty };
}

// --- Surge: a one-attempt Power push -----------------------------------------
export function previewSupplySurge(content, state) {
  const reasons = [];
  if (resourceQty(state, FIELD_SUPPLY_ID) < 1) reasons.push('No Field Supply is held. Expedition cycles and Mastery milestones are the sources.');
  if (state.surge) reasons.push('A Surge is already armed. It is spent when it carries a node attempt.');
  return { ok: reasons.length === 0, reasons, surgeBp: content.balance.fieldSupply.surgeBp };
}

export function useSupplySurge(content, state) {
  const preview = previewSupplySurge(content, state);
  if (!preview.ok) return { ok: false, reasons: preview.reasons };
  spendSupply(state);
  state.surge = { bp: content.balance.fieldSupply.surgeBp, armedDay: state.dayNumber };
  return { ok: true, surgeBp: state.surge.bp };
}

export function surgedPower(state, effectivePower) {
  if (!state.surge) return effectivePower;
  return Math.floor(effectivePower * (10000 + state.surge.bp) / 10000);
}

// --- Frontier Momentum -------------------------------------------------------
export function frontierMomentumPreview(state, { firstClear, energySpent }) {
  const used = state.energySystems?.daily?.momentumRefunded ?? 0;
  const remaining = Math.max(0, MOMENTUM_DAILY_CAP - used);
  const energyRefunded = firstClear ? Math.min(Math.max(0, energySpent), remaining) : 0;
  return { energyRefunded, remaining, dailyCap: MOMENTUM_DAILY_CAP };
}

export function resetDailyEnergySystems(state) {
  state.energySystems = { daily: { day: state.dayNumber, momentumRefunded: 0 } };
}
