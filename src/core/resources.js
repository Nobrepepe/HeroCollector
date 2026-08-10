export const RENOWN_ID = 'renown';
export const INTELLIGENCE_ID = 'intelligence';
export const ASSOCIATED_WORLD_ASSET = '@associated_world_asset';
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

export function resolveRewardId(content, worldId, entry) {
  if (entry.kind !== 'resource') return entry.id;
  if (entry.id !== ASSOCIATED_WORLD_ASSET) return entry.id;
  return content.worldById[worldId]?.worldAsset?.id ?? null;
}

export function grantRewardEntries(content, state, entries, worldId = null) {
  const granted = [];
  for (const entry of entries ?? []) {
    const qty = Math.max(0, Math.floor(entry.qty ?? 0));
    if (!qty) continue;
    if (entry.kind === 'material') {
      state.inventory.materials[entry.id] = (state.inventory.materials[entry.id] ?? 0) + qty;
      granted.push({ ...entry, qty });
    } else if (entry.kind === 'resource') {
      const id = resolveRewardId(content, worldId, entry);
      if (!id || !addResource(state, id, qty)) continue;
      granted.push({ ...entry, id, qty });
    } else if (entry.kind === 'shards' && state.characters[entry.characterId]) {
      state.characters[entry.characterId].shards += qty;
      granted.push({ ...entry, qty });
    }
  }
  return granted;
}

export function canAffordEntries(content, state, entries, worldId = null) {
  const reasons = [];
  for (const entry of entries ?? []) {
    const id = resolveRewardId(content, worldId, entry);
    const have = entry.kind === 'material'
      ? state.inventory.materials[id] ?? 0
      : resourceQty(state, id);
    if (!id || have < entry.qty) reasons.push(`Need ${entry.qty} ${content.resourceById[id]?.displayName ?? content.materialById[id]?.displayName ?? id} (have ${have}).`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function spendEntries(content, state, entries, worldId = null) {
  const check = canAffordEntries(content, state, entries, worldId);
  if (!check.ok) return check;
  for (const entry of entries ?? []) {
    const id = resolveRewardId(content, worldId, entry);
    if (entry.kind === 'material') {
      state.inventory.materials[id] -= entry.qty;
      if (!state.inventory.materials[id]) delete state.inventory.materials[id];
    } else addResource(state, id, -entry.qty);
  }
  return { ok: true };
}

export function scaledRewards(entries, multiplierBp, modifiers = {}) {
  return (entries ?? []).map(entry => {
    let bp = multiplierBp;
    if (entry.kind === 'resource' && entry.id === RENOWN_ID) bp += modifiers.renownBp ?? 0;
    if (entry.kind === 'resource' && entry.id === ASSOCIATED_WORLD_ASSET) bp += modifiers.worldAssetBp ?? 0;
    return { ...entry, qty: Math.max(1, Math.floor(entry.qty * bp / 10000)) };
  });
}
