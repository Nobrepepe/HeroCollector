// Content registry: loads static content definitions and provides indexed lookups.
// Content is immutable at runtime; the save file only references these IDs.

export function buildContent(raw) {
  const c = {
    version: raw.balance.contentVersion,
    lineage: raw.lineage ?? null,
    balance: raw.balance,
    worlds: raw.worlds,
    archetypes: raw.archetypes,
    materials: raw.materials.materials,
    materialMeta: raw.materials,
    components: raw.components.components,
    componentMeta: raw.components,
    characters: raw.characters.characters,
    characterMeta: raw.characters,
    tags: raw.tags,
    tierProfiles: raw.recipes.tierProfiles,
    templates: raw.recipes.templates,
    nodes: raw.nodes,
    relics: raw.relics ?? [],
    skins: raw.skins ?? [],
    expeditions: raw.expeditions ?? {
      settings: { offerCount: 5, slotCount: 3, freeRerolls: 1, freePins: 1, minimumFeasible: 2, generationAttempts: 20,
        cycleLengthDays: 4, cycleScaleBp: 40000,
        intelligenceCosts: { reroll: 1, pin: 1, reveal: 1 },
        resultMultipliersBp: { completed: 10000, successful: 12500, exceptional: 15000 } },
      requirements: [], optionalObjectives: [], rewardPackages: [], templates: [], reports: {}, fallbackTemplate: null
    },
    crises: raw.crises ?? { settings: { spawnChanceBp: 2500, grades: [] }, definitions: [] },

    worldById: {}, resourceById: {}, materialById: {}, componentById: {}, characterById: {},
    tagById: {}, nodeById: {}, templateByKey: {}, tierProfileByTier: {},
    relicByWorld: {}, relicPieceById: {}, skinById: {}, crisisById: {}, crisesByWorld: {},
    nodesByCampaign: {}, encounterNodesByCharacter: {}, nodesByMaterial: {},
    maxMaterialGradeRank: -1,
    maxGearTier: 0,
    // Imported art (data URLs or hcpkg URLs), filled in by the content merge.
    images: {
      world: {}, expedition: {}, crisis: {}, chapter: {}, portrait: {},
      fullBody: {}, equipment: {}, relic: {}, skin: {}
    }
  };
  c.resources = [
    { id: 'intelligence', displayName: 'Intelligence', description: 'Information used to shape Expedition routes.', icon: '◈' },
    { id: 'field_supply', displayName: 'Field Supply', description: 'Stored provisions spent on targeted pushes: a material requisition, hero tutoring, or a one-attempt surge.', icon: '▰' }
  ];
  for (const w of c.worlds) c.worldById[w.id] = w;
  for (const resource of c.resources) c.resourceById[resource.id] = resource;
  for (const m of c.materials) c.materialById[m.id] = m;
  for (const k of c.components) c.componentById[k.id] = k;
  for (const ch of c.characters) c.characterById[ch.id] = ch;
  for (const t of c.tags) c.tagById[t.id] = t;
  for (const p of c.tierProfiles) c.tierProfileByTier[p.tier] = p;
  for (const t of c.templates) c.templateByKey[`${t.archetype}:${t.slot}`] = t;
  for (const n of c.nodes) {
    c.nodeById[n.id] = n;
    (c.nodesByCampaign[n.campaign] ??= []).push(n);
    if (n.encounterCharacter) {
      (c.encounterNodesByCharacter[n.encounterCharacter] ??= []).push(n);
    }
    if (n.material) {
      (c.nodesByMaterial[n.material] ??= []).push(n);
      const material = c.materialById[n.material];
      const rank = material ? c.materialMeta.grades[material.grade]?.rank : undefined;
      if (Number.isFinite(rank)) c.maxMaterialGradeRank = Math.max(c.maxMaterialGradeRank, rank);
    }
  }
  c.maxGearTier = Math.min(c.balance.gearTierPower.length, Math.max(0, (c.maxMaterialGradeRank + 1) * 2));
  for (const relic of c.relics) {
    c.relicByWorld[relic.world] = relic;
    for (const piece of relic.pieces) {
      c.relicPieceById[piece.id] = { ...piece, relicId: relic.id, world: relic.world };
    }
  }
  for (const skin of c.skins) c.skinById[skin.id] = skin;
  c.expeditions.requirementById = Object.fromEntries((c.expeditions.requirements ?? []).map(x => [x.id, x]));
  c.expeditions.optionalById = Object.fromEntries((c.expeditions.optionalObjectives ?? []).map(x => [x.id, x]));
  c.expeditions.rewardById = Object.fromEntries((c.expeditions.rewardPackages ?? []).map(x => [x.id, x]));
  c.expeditions.templateById = Object.fromEntries((c.expeditions.templates ?? []).map(x => [x.id, x]));
  for (const definition of c.crises.definitions ?? []) {
    c.crisisById[definition.id] = definition;
    (c.crisesByWorld[definition.worldId] ??= []).push(definition);
  }
  return c;
}

// The recipe for one equipment piece: character + slot + tier -> component costs.
export function equipmentRecipe(content, characterId, slot, tier) {
  const ch = content.characterById[characterId];
  const tpl = content.templateByKey[`${ch.archetype}:${slot}`];
  const prof = content.tierProfileByTier[tier];
  const inputs = [];
  if (prof.primaryQty > 0) {
    inputs.push({ componentId: `comp_${tpl.primaryComponent}_${prof.grade}`, qty: prof.primaryQty });
  }
  if (prof.secondaryQty > 0) {
    inputs.push({ componentId: `comp_${tpl.secondaryComponent}_${prof.grade}`, qty: prof.secondaryQty });
  }
  return { characterId, slot, tier, grade: prof.grade, inputs };
}

// Display name for an equipment piece at a given tier.
export function equipmentName(content, characterId, slot, tier) {
  const ch = content.characterById[characterId];
  const prefix = content.characterMeta.tierPrefixes[tier - 1] ?? '';
  return `${prefix}${ch.equipmentLines[slot]}`;
}
