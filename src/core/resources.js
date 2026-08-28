export const INTELLIGENCE_ID = 'intelligence';
export const FIELD_SUPPLY_ID = 'field_supply';
// A material reward that names a grade instead of a family: the family is drawn
// when the reward is rolled, so a cache is not always the same material.
export const RANDOM_MATERIAL = '@random_material';

// The materials a @random_material entry may draw from, in authored order.
export function randomMaterialPool(content, grade = 'basic') {
  return content.materials.filter(material => material.grade === grade);
}

export function resourceQty(state, id) {
  return state.inventory.resources?.[id] ?? 0;
}

export function addResource(state, id, qty) {
  state.inventory.resources ??= {};
  const next = resourceQty(state, id) + qty;
  if (!Number.isFinite(next) || next < 0) return false;
  if (next === 0) delete state.inventory.resources[id];
  else state.inventory.resources[id] = next;
  return true;
}

export function grantRewardEntries(content, state, entries) {
  const granted = [];
  for (const entry of entries ?? []) {
    const qty = Math.max(0, Math.floor(entry.qty ?? 0));
    if (!qty) continue;
    if (entry.kind === 'material') {
      state.inventory.materials[entry.id] = (state.inventory.materials[entry.id] ?? 0) + qty;
      granted.push({ ...entry, qty });
    } else if (entry.kind === 'resource') {
      if (!entry.id || !addResource(state, entry.id, qty)) continue;
      granted.push({ ...entry, qty });
    } else if (entry.kind === 'shards' && state.characters[entry.characterId]) {
      state.characters[entry.characterId].shards += qty;
      granted.push({ ...entry, qty });
    }
  }
  return granted;
}

export function canAffordEntries(content, state, entries) {
  const reasons = [];
  for (const entry of entries ?? []) {
    const have = entry.kind === 'material'
      ? state.inventory.materials[entry.id] ?? 0
      : resourceQty(state, entry.id);
    if (!entry.id || have < entry.qty) reasons.push(`Need ${entry.qty} ${content.resourceById[entry.id]?.displayName ?? content.materialById[entry.id]?.displayName ?? entry.id} (have ${have}).`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function spendEntries(content, state, entries) {
  const check = canAffordEntries(content, state, entries);
  if (!check.ok) return check;
  for (const entry of entries ?? []) {
    if (entry.kind === 'material') {
      state.inventory.materials[entry.id] -= entry.qty;
      if (!state.inventory.materials[entry.id]) delete state.inventory.materials[entry.id];
    } else addResource(state, entry.id, -entry.qty);
  }
  return { ok: true };
}

export function scaledRewards(entries, multiplierBp) {
  return (entries ?? []).map(entry => ({
    ...entry, qty: Math.max(1, Math.floor(entry.qty * multiplierBp / 10000))
  }));
}
