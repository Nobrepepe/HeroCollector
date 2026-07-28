// Pure goal analysis and craft planning. This module never mutates the save.
import { activeTier } from './power.js';
import { equipmentName, equipmentRecipe } from './content.js';

const qty = (map, id) => map?.[id] ?? 0;
const add = (map, id, n) => {
  if (!n) return;
  map[id] = (map[id] ?? 0) + n;
  if (map[id] === 0) delete map[id];
};

function materialRank(content, id) {
  const material = content.materialById[id];
  return material ? content.materialMeta.grades[material.grade]?.rank ?? -1 : -1;
}

function predecessorMap(content) {
  const out = {};
  for (const material of content.materials) {
    if (material.conversionTarget) out[material.conversionTarget] = material.id;
  }
  return out;
}

// Allocates a set of material demands once. Demand is satisfied from the exact
// grade first, then through deterministic, legal upward conversion.
export function allocateMaterialDemand(content, inventory, demand) {
  const initial = { ...(inventory ?? {}) };
  let available = { ...initial };
  let conversions = [];
  const allocated = {};
  const missing = {};
  const predecessor = predecessorMap(content);

  const ensureUnits = (materialId, needed) => {
    while (qty(available, materialId) < needed) {
      const lowerId = predecessor[materialId];
      const targetRank = materialRank(content, materialId);
      if (!lowerId || targetRank > content.maxMaterialGradeRank) return false;
      const lower = content.materialById[lowerId];
      const cost = lower.conversionCost;
      if (!ensureUnits(lowerId, cost)) return false;
      add(available, lowerId, -cost);
      add(available, materialId, 1);
      conversions.push({ from: lowerId, to: materialId, cost, qty: 1 });
    }
    return true;
  };

  const ordered = Object.entries(demand)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => materialRank(content, b) - materialRank(content, a) || a.localeCompare(b));

  for (const [materialId, required] of ordered) {
    let satisfied = 0;
    while (satisfied < required) {
      const beforeAvailable = available;
      const beforeConversions = conversions;
      available = { ...available };
      conversions = [...conversions];
      if (!ensureUnits(materialId, 1)) {
        available = beforeAvailable;
        conversions = beforeConversions;
        break;
      }
      add(available, materialId, -1);
      satisfied++;
    }
    allocated[materialId] = satisfied;
    if (satisfied < required) missing[materialId] = required - satisfied;
  }

  const consumption = {};
  for (const [id, before] of Object.entries(initial)) {
    const used = before - qty(available, id);
    if (used > 0) consumption[id] = used;
  }
  // Collapse identical conversion steps for a stable preview.
  const collapsed = {};
  for (const c of conversions) {
    const key = `${c.from}:${c.to}:${c.cost}`;
    if (!collapsed[key]) collapsed[key] = { ...c, qty: 0 };
    collapsed[key].qty += c.qty;
  }
  return {
    craftable: Object.keys(missing).length === 0,
    demand: { ...demand },
    allocated,
    missing,
    conversions: Object.values(collapsed),
    consumption,
    remaining: available
  };
}

function baseEquipmentGoal(content, state, characterId, slot) {
  const reasons = [];
  const def = content.characterById[characterId];
  const cs = state.characters[characterId];
  if (!def || !cs) reasons.push('Unknown character.');
  else if (!cs.owned) reasons.push('Character not owned.');
  if (!content.characterMeta.slots[slot]) reasons.push('Unknown equipment slot.');
  const tier = cs ? activeTier(content.balance, cs, content.maxGearTier) : null;
  if (cs?.owned && !tier) {
    reasons.push(`Current campaigns support Gear Tier ${content.maxGearTier}.`);
  }
  const equipped = !!cs?.slots?.[slot];
  if (equipped) reasons.push('This slot is already equipped for the current tier.');
  if (reasons.length) {
    return {
      characterId, slot, tier, equipmentName: def?.equipmentLines?.[slot] ?? 'Equipment',
      state: equipped ? 'equipped' : 'missing', craftable: false, equipped,
      immediateComponents: [], totalComponentDemand: {}, totalComponentMissing: {},
      totalMaterialDemand: {}, totalMaterialMissing: {}, conversions: [],
      consumption: { materials: {}, components: {} }, warnings: [], reasons
    };
  }

  const recipe = equipmentRecipe(content, characterId, slot, tier);
  const componentDemand = {};
  const componentMissing = {};
  const materialDemand = {};
  const componentConsumption = {};
  const remainingComponents = { ...state.inventory.components };
  const immediateComponents = recipe.inputs.map(input => {
    const owned = qty(state.inventory.components, input.componentId);
    const used = Math.min(qty(remainingComponents, input.componentId), input.qty);
    add(remainingComponents, input.componentId, -used);
    add(componentConsumption, input.componentId, used);
    const missing = input.qty - used;
    add(componentDemand, input.componentId, input.qty);
    if (missing) add(componentMissing, input.componentId, missing);
    const component = content.componentById[input.componentId];
    const materials = component.inputs.map(mat => {
      const required = mat.qty * missing;
      add(materialDemand, mat.materialId, required);
      return {
        materialId: mat.materialId,
        required,
        owned: qty(state.inventory.materials, mat.materialId),
        allocated: 0,
        missing: required
      };
    });
    return {
      componentId: input.componentId,
      required: input.qty,
      owned,
      allocated: used,
      missing,
      materials
    };
  });

  const materialPlan = allocateMaterialDemand(content, state.inventory.materials, materialDemand);
  const remainingMaterialAllocation = { ...materialPlan.allocated };
  for (const row of immediateComponents) {
    for (const material of row.materials) {
      material.allocated = Math.min(material.required, remainingMaterialAllocation[material.materialId] ?? 0);
      add(remainingMaterialAllocation, material.materialId, -material.allocated);
      material.missing = Math.max(0, material.required - material.allocated);
    }
  }
  const componentsReady = Object.keys(componentMissing).length === 0;
  const craftable = componentsReady || materialPlan.craftable;
  return {
    characterId,
    slot,
    tier,
    equipmentName: equipmentName(content, characterId, slot, tier),
    state: componentsReady ? 'components-ready' : craftable ? 'chain-ready' : 'missing',
    craftable,
    equipped: false,
    recipe,
    immediateComponents,
    totalComponentDemand: componentDemand,
    totalComponentMissing: componentMissing,
    totalMaterialDemand: materialDemand,
    totalMaterialMissing: materialPlan.missing,
    conversions: materialPlan.conversions,
    consumption: {
      materials: materialPlan.consumption,
      components: componentConsumption
    },
    componentsToCraft: { ...componentMissing },
    warnings: [],
    reasons: craftable ? [] : Object.entries(materialPlan.missing).map(([id, n]) =>
      `Need ${n} more ${content.materialById[id]?.displayName ?? id}.`)
  };
}

export function analyzeEquipmentGoal(content, state, characterId, slot, options = {}) {
  const result = baseEquipmentGoal(content, state, characterId, slot);
  const reserves = options.reservedByOthers;
  if (result.craftable && reserves) {
    const conflicts = [];
    for (const [id, used] of Object.entries(result.consumption.components)) {
      const reserved = reserves.components?.[id] ?? 0;
      const owned = qty(state.inventory.components, id);
      if (used > Math.max(0, owned - reserved)) {
        conflicts.push({ type: 'component', id, qty: used - Math.max(0, owned - reserved), reserved });
      }
    }
    for (const [id, used] of Object.entries(result.consumption.materials)) {
      const reserved = reserves.materials?.[id] ?? 0;
      const owned = qty(state.inventory.materials, id);
      if (used > Math.max(0, owned - reserved)) {
        conflicts.push({ type: 'material', id, qty: used - Math.max(0, owned - reserved), reserved });
      }
    }
    if (conflicts.length) {
      result.reservationConflicts = conflicts;
      result.warnings.push('This plan consumes resources reserved by other pinned goals.');
    }
  }
  return result;
}

export const planEquipmentCraft = analyzeEquipmentGoal;

function validEquipmentPin(content, state, pin) {
  const cs = state.characters[pin.characterId];
  return pin.type === 'equipment'
    && !!content.characterById[pin.characterId]
    && !!content.characterMeta.slots[pin.slot]
    && !!cs?.owned
    && !!activeTier(content.balance, cs, content.maxGearTier)
    && !cs.slots[pin.slot];
}

export function analyzePinnedGoals(content, state, options = {}) {
  const pins = options.pins ?? state.pins;
  const activePins = pins.filter(pin => validEquipmentPin(content, state, pin));
  const stale = pins.filter(pin => {
    if (pin.type === 'equipment') return !validEquipmentPin(content, state, pin);
    if (pin.type !== 'character') return true;
    const cs = state.characters[pin.characterId];
    if (!cs || !content.characterById[pin.characterId]) return true;
    if (pin.objective === 'unlock') return cs.owned;
    if (pin.objective === 'promotion') return cs.stars >= pin.targetStars;
    return cs.stars >= 7;
  });
  const totalComponentDemand = {};
  for (const pin of activePins) {
    const cs = state.characters[pin.characterId];
    const tier = activeTier(content.balance, cs, content.maxGearTier);
    const recipe = equipmentRecipe(content, pin.characterId, pin.slot, tier);
    for (const input of recipe.inputs) add(totalComponentDemand, input.componentId, input.qty);
  }

  const componentAllocated = {};
  const totalComponentMissing = {};
  const totalMaterialDemand = {};
  for (const [componentId, required] of Object.entries(totalComponentDemand)) {
    const allocated = Math.min(qty(state.inventory.components, componentId), required);
    componentAllocated[componentId] = allocated;
    const missing = required - allocated;
    if (missing) {
      totalComponentMissing[componentId] = missing;
      for (const input of content.componentById[componentId].inputs) {
        add(totalMaterialDemand, input.materialId, input.qty * missing);
      }
    }
  }
  const materialPlan = allocateMaterialDemand(content, state.inventory.materials, totalMaterialDemand);

  const byCharacter = {};
  const goals = activePins.map(pin => {
    const analysis = baseEquipmentGoal(content, state, pin.characterId, pin.slot);
    (byCharacter[pin.characterId] ??= []).push({ pin, analysis });
    return { pin, analysis };
  });
  const individuallyCraftable = goals.filter(g => g.analysis.craftable);
  const contention = individuallyCraftable.length > 1 && !materialPlan.craftable;
  const warnings = contention
    ? ['Individually craftable goals compete for the same inventory; not all can be completed together.']
    : [];

  return {
    goals,
    byCharacter,
    stale,
    totalComponentDemand,
    componentAllocated,
    totalComponentMissing,
    totalMaterialDemand,
    materialAllocated: materialPlan.allocated,
    totalMaterialMissing: materialPlan.missing,
    conversions: materialPlan.conversions,
    reservations: {
      components: componentAllocated,
      materials: materialPlan.consumption
    },
    craftableTogether: materialPlan.craftable,
    contention,
    warnings
  };
}
