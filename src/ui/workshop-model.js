import { activeTier, characterPower, slotPower } from '../core/power.js';
import { analyzeEquipmentGoal, analyzePinnedGoals } from '../core/progression.js';
import { rankMaterialSources } from '../core/sources.js';

export function buildWorkshopModel(content, state) {
  const pinAnalysis = analyzePinnedGoals(content, state);
  const activeParty = new Set(state.parties[state.activePartyIndex]?.members.filter(Boolean) ?? []);
  const candidates = [];

  for (const def of content.characters) {
    const cs = state.characters[def.id];
    const tier = cs?.owned ? activeTier(content.balance, cs, content.maxGearTier) : null;
    if (!tier) continue;
    for (const slot of content.characterMeta.slotOrder) {
      if (cs.slots[slot]) continue;
      const analysis = analyzeEquipmentGoal(content, state, def.id, slot);
      candidates.push({
        characterId: def.id,
        character: def,
        characterState: cs,
        slot,
        slotMeta: content.characterMeta.slots[slot],
        tier,
        analysis,
        powerBefore: characterPower(content, cs),
        powerGain: slotPower(content.balance, tier),
        shortfall: Object.values(analysis.totalMaterialMissing).reduce((sum, value) => sum + value, 0),
        activeParty: activeParty.has(def.id)
      });
    }
  }

  const compare = (a, b) =>
    Number(b.analysis.craftable) - Number(a.analysis.craftable)
    || a.shortfall - b.shortfall
    || Number(b.activeParty) - Number(a.activeParty)
    || content.characters.indexOf(a.character) - content.characters.indexOf(b.character)
    || content.characterMeta.slotOrder.indexOf(a.slot) - content.characterMeta.slotOrder.indexOf(b.slot);
  candidates.sort(compare);

  const ready = candidates.filter(candidate => candidate.analysis.craftable);
  const bench = ready[0] ?? candidates[0] ?? null;
  const nearby = candidates.filter(candidate => candidate !== bench && !candidate.analysis.craftable)
    .sort((a, b) => a.shortfall - b.shortfall || Number(b.activeParty) - Number(a.activeParty))
    .slice(0, 2);
  const blocking = bench && !bench.analysis.craftable
    ? primaryShortfall(content, bench.analysis.totalMaterialMissing)
    : null;
  const source = blocking ? rankMaterialSources(content, state, blocking.material.id)[0] ?? null : null;

  return {
    candidates,
    ready,
    bench,
    nearby,
    blocking,
    source,
    reservations: pinAnalysis.reservations,
    pinAnalysis,
    families: content.materialMeta.familyOrder.map(family => familyShelf(content, state, pinAnalysis.reservations, family)),
    totals: materialTotals(content, state, pinAnalysis.reservations)
  };
}

function primaryShortfall(content, missing) {
  return Object.entries(missing)
    .map(([id, qty]) => ({ material: content.materialById[id], qty }))
    .sort((a, b) => b.qty - a.qty
      || content.materialMeta.familyOrder.indexOf(a.material.family) - content.materialMeta.familyOrder.indexOf(b.material.family)
      || content.materialMeta.gradeOrder.indexOf(a.material.grade) - content.materialMeta.gradeOrder.indexOf(b.material.grade))[0] ?? null;
}

function familyShelf(content, state, reservations, family) {
  const definition = content.materialMeta.families[family];
  const grades = content.materialMeta.gradeOrder.map(grade => {
    const id = `mat_${family}_${grade}`;
    return {
      id,
      grade,
      definition: content.materialById[id],
      qty: state.inventory.materials[id] ?? 0,
      reserved: reservations.materials[id] ?? 0
    };
  });
  const allHeld = grades.reduce((sum, item) => sum + item.qty, 0);
  const allReserved = grades.reduce((sum, item) => sum + item.reserved, 0);
  let note = '';
  if (allHeld > 0 && allReserved >= allHeld) note = 'all of it reserved';
  if (!note) {
    const almost = grades.find(item => item.definition?.conversionTarget
      && item.qty > 0 && item.qty % item.definition.conversionCost === item.definition.conversionCost - 1);
    if (almost) note = 'one short of an upcraft';
  }
  return { family, definition, grades, allHeld, allReserved, note };
}

function materialTotals(content, state, reservations) {
  let held = 0;
  let aboveBasic = 0;
  let reserved = 0;
  let upcrafts = 0;
  for (const material of content.materials) {
    const qty = state.inventory.materials[material.id] ?? 0;
    held += qty;
    if (material.grade !== 'basic') aboveBasic += qty;
    reserved += Math.min(qty, reservations.materials[material.id] ?? 0);
    if (material.conversionTarget) upcrafts += Math.floor(qty / material.conversionCost);
  }
  return { held, aboveBasic, reserved, upcrafts };
}
