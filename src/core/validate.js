// Content validation (GDD 12.4): every referenced ID exists, campaigns chain
// correctly, thresholds never decrease, recipes are obtainable, Archive
// fragments map 1:1 onto World Campaign first clears, and synergy definitions
// stay inside the global cap. Produces a human-readable error list.
import { equipmentRecipe } from './content.js';
import { fieldSupplyLimits, FIELD_SUPPLY_ID } from './energy.js';
import { CRISIS_BOON_TYPES } from './crises.js';

export function validateContent(content) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  // --- unique IDs across all entity groups
  const seen = new Set();
  const uniq = (id, kind) => {
    if (seen.has(id)) err(`Duplicate ID: ${id} (${kind})`);
    seen.add(id);
  };
  for (const w of content.worlds) uniq(w.id, 'world');
  for (const w of content.worlds) {
    if (!w.worldAsset?.id) err(`${w.id}: missing World Asset definition`);
    else uniq(w.worldAsset.id, 'world resource');
    if (w.hq?.enabled) {
      if (w.hq.backgrounds?.length !== 3) err(`${w.id}: HQ needs three background slots`);
      if (w.hq.facilities?.length !== 4) err(`${w.id}: HQ needs four facilities`);
      if (w.hq.ranks?.length < 3) err(`${w.id}: HQ needs three rank thresholds`);
      for (const facility of w.hq.facilities ?? []) {
        uniq(facility.id, 'facility');
        if (facility.levels?.length !== 3) err(`${facility.id}: facility needs three levels`);
      }
    }
  }
  for (const m of content.materials) uniq(m.id, 'material');
  for (const k of content.components) uniq(k.id, 'component');
  for (const c of content.characters) uniq(c.id, 'character');
  for (const t of content.tags) uniq(t.id, 'tag');
  for (const n of content.nodes) uniq(n.id, 'node');
  for (const n of content.nodes) {
    if (n.world && !content.worldById[n.world]) err(`${n.id}: unknown world ${n.world}`);
    for (const reward of [...(n.repeatRewards ?? []), ...(n.firstClearRewards ?? [])]) {
      if (reward.kind === 'resource' && reward.id === '@associated_world_asset' && !n.world) {
        err(`${n.id}: associated World Asset reward requires a world`);
      }
    }
  }
  for (const requirement of content.expeditions.requirements ?? []) uniq(requirement.id, 'Expedition requirement');
  for (const optional of content.expeditions.optionalObjectives ?? []) uniq(optional.id, 'Expedition optional objective');
  for (const pack of content.expeditions.rewardPackages ?? []) {
    uniq(pack.id, 'Expedition reward package');
    for (const reward of pack.entries ?? []) {
      if (!Number.isInteger(reward.min) || !Number.isInteger(reward.max) || reward.min < 0 || reward.max < reward.min) {
        err(`${pack.id}: invalid reward range`);
      }
      if (reward.kind === 'resource' && reward.id !== '@associated_world_asset' && !content.resourceById[reward.id]) {
        err(`${pack.id}: unknown resource ${reward.id}`);
      }
      if (reward.kind === 'material' && !content.materialById[reward.id]) err(`${pack.id}: unknown material ${reward.id}`);
    }
  }
  for (const template of content.expeditions.templates ?? []) {
    uniq(template.id, 'Expedition template');
    if (template.world && !content.worldById[template.world]) err(`${template.id}: unknown world ${template.world}`);
    if (!content.expeditions.rewardById[template.rewardPackageId]) err(`${template.id}: unknown reward package ${template.rewardPackageId}`);
    for (const id of template.requirementIds ?? []) if (!content.expeditions.requirementById[id]) err(`${template.id}: unknown requirement ${id}`);
    for (const id of template.optionalIds ?? []) if (!content.expeditions.optionalById[id]) err(`${template.id}: unknown optional objective ${id}`);
    if (template.partySize < 1 || template.partySize > 4) err(`${template.id}: invalid party size`);
    if (!template.titles?.length || !template.descriptions?.length) err(`${template.id}: missing procedural prose`);
    for (const reward of template.fixedRewards ?? []) {
      if (reward.kind !== 'resource' || reward.id !== FIELD_SUPPLY_ID || reward.qty !== 1) err(`${template.id}: invalid fixed reward`);
      if (template.id !== content.expeditions.settings.guaranteedSupplyTemplateId) err(`${template.id}: only the configured guaranteed template may promise a Field Supply`);
    }
  }
  const guaranteedId = content.expeditions.settings.guaranteedSupplyTemplateId;
  if (guaranteedId) {
    const guaranteed = content.expeditions.templateById[guaranteedId];
    if (!guaranteed || guaranteed.enabled === false) err('Guaranteed Field Supply template is missing or disabled');
    if (guaranteed && (guaranteed.durations?.length !== 1 || guaranteed.durations[0] !== 1)) err(`${guaranteedId}: guaranteed Supply template must last one day`);
    if (guaranteed && (guaranteed.fixedRewards?.length !== 1 || guaranteed.fixedRewards[0]?.id !== FIELD_SUPPLY_ID || guaranteed.fixedRewards[0]?.qty !== 1)) {
      err(`${guaranteedId}: guaranteed Supply template needs exactly one fixed Field Supply`);
    }
  }

  const crisisIds = new Set();
  const favoredIds = new Set([...content.worlds.map(world => world.id), ...Object.keys(content.archetypes), ...content.tags.map(tag => tag.id)]);
  const gradeIds = new Set();
  for (const grade of content.crises?.settings?.grades ?? []) {
    if (gradeIds.has(grade.id)) err(`Duplicate Crisis grade ${grade.id}`);
    gradeIds.add(grade.id);
    if (!Number.isInteger(grade.minOwned) || grade.minOwned < 1 || !Number.isInteger(grade.minHqRank)
      || !Number.isInteger(grade.frontCount) || grade.frontCount < 2 || !Number.isInteger(grade.teamSize) || grade.teamSize < 1) err(`${grade.id}: invalid Crisis grade settings`);
  }
  for (const definition of content.crises?.definitions ?? []) {
    if (crisisIds.has(definition.id)) err(`Duplicate Crisis ID: ${definition.id}`);
    crisisIds.add(definition.id);
    if (!content.worldById[definition.worldId]) err(`${definition.id}: unknown Crisis world ${definition.worldId}`);
    if ((definition.fronts?.length ?? 0) < 3) err(`${definition.id}: a Crisis needs at least three Fronts`);
    const frontIds = new Set();
    for (const front of definition.fronts ?? []) {
      if (frontIds.has(front.id)) err(`${definition.id}: duplicate Front ${front.id}`);
      frontIds.add(front.id);
      if (!front.name || !front.description) err(`${front.id}: missing Front prose`);
      if (!front.favoredTagIds?.length || front.favoredTagIds.length > 2) err(`${front.id}: needs one or two favored tags`);
      for (const id of front.favoredTagIds ?? []) if (!favoredIds.has(id)) err(`${front.id}: unknown favored tag ${id}`);
      for (const grade of content.crises.settings.grades ?? []) {
        if (!Number.isInteger(front.recommendedPowerByGrade?.[grade.id]) || front.recommendedPowerByGrade[grade.id] < 1) err(`${front.id}: invalid ${grade.id} recommendation`);
      }
    }
    if (![3, 4].includes(definition.cacheChoices?.length)) err(`${definition.id}: needs three or four Emergency Cache choices`);
    if (!CRISIS_BOON_TYPES.has(definition.boon?.type)) err(`${definition.id}: unknown boon type ${definition.boon?.type}`);
    for (const choice of definition.cacheChoices ?? []) for (const reward of choice.rewards ?? []) {
      if (reward.kind === 'resource' && reward.id !== '@associated_world_asset' && !content.resourceById[reward.id]) err(`${choice.id}: unknown Cache resource ${reward.id}`);
      if (reward.kind === 'material' && !content.materialById[reward.id]) err(`${choice.id}: unknown Cache material ${reward.id}`);
      if (!Number.isInteger(reward.qty) || reward.qty < 1) err(`${choice.id}: invalid Cache quantity`);
    }
    const boon = definition.boon;
    if (['free_world_node_runs', 'bonus_world_material_runs'].includes(boon?.type) && (!Number.isInteger(boon.runs) || boon.runs < 1)) err(`${definition.id}: boon needs a positive run count`);
    if (['bonus_world_material_runs', 'instant_intelligence'].includes(boon?.type) && (!Number.isInteger(boon.qty) || boon.qty < 1)) err(`${definition.id}: boon needs a positive quantity`);
    if (['world_expedition_renown_bp', 'next_hq_production_bp'].includes(boon?.type) && (!Number.isInteger(boon.bonusBp) || boon.bonusBp < 1)) err(`${definition.id}: boon needs positive basis points`);
  }

  // --- characters: exactly one world and one archetype; valid references
  for (const c of content.characters) {
    if (!content.worldById[c.world]) err(`${c.id}: unknown world ${c.world}`);
    if (!content.archetypes[c.archetype]) err(`${c.id}: unknown archetype ${c.archetype}`);
    if (c.faction && !content.tagById[c.faction]) err(`${c.id}: unknown faction ${c.faction}`);
    for (const t of c.extraTags ?? []) if (!content.tagById[t]) err(`${c.id}: unknown extra tag ${t}`);
    for (const slot of content.characterMeta.slotOrder) {
      if (!c.equipmentLines[slot]) err(`${c.id}: missing equipment line for slot ${slot}`);
    }
    // every unlockable/promotable character needs a reachable shard source
    if ((content.shardNodesByCharacter[c.id] ?? []).length === 0) {
      err(`${c.id}: no shard source node`);
    }
  }

  // --- materials / components
  for (const m of content.materials) {
    if (m.conversionTarget && !content.materialById[m.conversionTarget]) {
      err(`${m.id}: unknown conversion target ${m.conversionTarget}`);
    }
  }
  for (const k of content.components) {
    for (const input of k.inputs) {
      if (!content.materialById[input.materialId]) err(`${k.id}: unknown material ${input.materialId}`);
      if (input.qty < 1) err(`${k.id}: non-positive input quantity`);
    }
  }

  // --- recipe templates: every archetype × slot combination exists
  for (const a of Object.keys(content.archetypes)) {
    for (const slot of content.characterMeta.slotOrder) {
      const tpl = content.templateByKey[`${a}:${slot}`];
      if (!tpl) { err(`Missing recipe template ${a}:${slot}`); continue; }
      for (const compFam of [tpl.primaryComponent, tpl.secondaryComponent]) {
        if (!content.componentMeta.pairs[compFam]) err(`${tpl.id}: unknown component family ${compFam}`);
      }
    }
  }
  for (const p of content.tierProfiles) {
    if (!content.materialMeta.grades[p.grade]) err(`Tier profile ${p.tier}: unknown grade ${p.grade}`);
  }

  // --- every equipment recipe's inputs must resolve to real components
  for (const c of content.characters) {
    for (const slot of content.characterMeta.slotOrder) {
      for (const p of content.tierProfiles) {
        const recipe = equipmentRecipe(content, c.id, slot, p.tier);
        for (const input of recipe.inputs) {
          if (!content.componentById[input.componentId]) {
            err(`${c.id}/${slot}/T${p.tier}: unknown component ${input.componentId}`);
          }
        }
      }
    }
  }

  // --- campaigns: continuous previous chains, nondecreasing thresholds
  for (const [campaign, nodes] of Object.entries(content.nodesByCampaign)) {
    const sorted = [...nodes].sort((a, b) => a.number - b.number);
    let prevThreshold = 0, prevId = null;
    const shadowThresholds = {};
    for (const n of sorted) {
      if (campaign === 'shadow') {
        if (n.previous !== null) err(`${n.id}: Shadow nodes do not have a previous Shadow prerequisite`);
        const mirror = content.nodeById[n.mirrorNode];
        if (!mirror || mirror.campaign !== 'main' || mirror.number !== n.number) {
          err(`${n.id}: invalid matching Main node ${n.mirrorNode}`);
        }
        const prior = shadowThresholds[n.chapter] ?? 0;
        if (n.threshold < prior) err(`${n.id}: threshold ${n.threshold} decreases within Shadow chapter ${n.chapter}`);
        shadowThresholds[n.chapter] = n.threshold;
      } else {
        if (n.previous !== prevId) err(`${n.id}: previous should be ${prevId}, is ${n.previous}`);
        if (n.threshold < prevThreshold) err(`${n.id}: threshold ${n.threshold} decreases (prev ${prevThreshold})`);
      }
      if (!content.materialById[n.material]) err(`${n.id}: unknown material ${n.material}`);
      if (n.shardCharacter && !content.characterById[n.shardCharacter]) err(`${n.id}: unknown shard character`);
      if (n.firstClear?.shards && !content.characterById[n.firstClear.shards.characterId]) {
        err(`${n.id}: unknown first-clear shard character ${n.firstClear.shards.characterId}`);
      }
      for (const m of n.firstClear?.materials ?? []) {
        if (!content.materialById[m.materialId]) err(`${n.id}: unknown first-clear material ${m.materialId}`);
      }
      if (n.objective) {
        if (!content.tagById[n.objective.tagId]) err(`${n.id}: objective references unknown tag ${n.objective.tagId}`);
        for (const m of n.objective.reward?.materials ?? []) {
          if (!content.materialById[m.materialId]) err(`${n.id}: unknown objective material ${m.materialId}`);
        }
      }
      if (campaign !== 'shadow') {
        prevThreshold = n.threshold;
        prevId = n.id;
      }
    }
  }

  // --- every material every recipe needs must be reachable from a freely
  // repeatable node: either dropped directly, or upcraftable from a lower
  // grade of the same family that drops freely. Shard nodes are attempt-
  // limited (5/day) and must never be a family's only source, or progression
  // can soft-stall. Skipped while the game has no nodes at all (setup mode).
  if (content.nodes.length > 0) {
    const freeMinRankByFamily = {};
    for (const n of content.nodes) {
      if (n.shardCharacter) continue;
      const m = content.materialById[n.material];
      if (!m) continue;
      const rank = content.materialMeta.grades[m.grade].rank;
      if (freeMinRankByFamily[m.family] === undefined || rank < freeMinRankByFamily[m.family]) {
        freeMinRankByFamily[m.family] = rank;
      }
    }
    const needed = new Set();
    const gradesUsed = new Set(content.tierProfiles.map(p => p.grade));
    for (const k of content.components) {
      if (gradesUsed.has(k.grade)) for (const i of k.inputs) needed.add(i.materialId);
    }
    for (const matId of needed) {
      const m = content.materialById[matId];
      const best = freeMinRankByFamily[m.family];
      if (best === undefined || best > content.materialMeta.grades[m.grade].rank) {
        err(`Material ${matId} is required by recipes but no freely repeatable (non-shard) node drops ${m.family} at that grade or below`);
      }
    }
  }

  // --- archives: fragments map to world-campaign first clears; totals complete every relic
  const skinIds = new Set();
  for (const a of content.archives) {
    const fragIds = new Set();
    for (const col of a.collections) {
      if (col.rewardSkin) {
        if (skinIds.has(col.rewardSkin.id)) err(`Duplicate skin ID: ${col.rewardSkin.id}`);
        skinIds.add(col.rewardSkin.id);
        const skinChar = content.characterById[col.rewardSkin.characterId];
        if (!skinChar) err(`${col.id}: collection skin references unknown character`);
        else if (skinChar.world !== a.world) err(`${col.id}: collection skin character is from another world`);
      }
      for (const relic of col.relics) {
        if (relic.fragments.length !== 2) err(`${relic.id}: needs exactly 2 fragments`);
        for (const frag of relic.fragments) {
          if (fragIds.has(frag.id)) err(`${a.id}: duplicate fragment ${frag.id}`);
          fragIds.add(frag.id);
          const node = content.nodeById[frag.sourceNode];
          if (!node) { err(`${frag.id}: unknown source node ${frag.sourceNode}`); continue; }
          if (node.type !== 'world') err(`${frag.id}: source ${node.id} is not a world node`);
          if (node.firstClear?.archiveFragment !== frag.id) {
            err(`${frag.id}: source node ${node.id} does not award this fragment`);
          }
        }
      }
    }
    const worldNodes = content.nodes.filter(n => n.world === a.world && n.firstClear?.archiveFragment);
    if (worldNodes.length !== fragIds.size) {
      err(`${a.id}: ${worldNodes.length} fragment-awarding nodes vs ${fragIds.size} required fragments`);
    }
    const skinChar = content.characterById[a.fullReward?.characterId];
    if (a.fullReward?.id) {
      if (skinIds.has(a.fullReward.id)) err(`Duplicate skin ID: ${a.fullReward.id}`);
      skinIds.add(a.fullReward.id);
    }
    if (!skinChar) err(`${a.id}: full-archive skin references unknown character`);
    else if (skinChar.world !== a.world) err(`${a.id}: skin character is from another world`);
  }

  // --- synergy: no single definition exceeds the global cap
  for (const t of content.tags) {
    for (const th of t.thresholds ?? []) {
      if (th.bonusBp > content.balance.synergyCapBp) {
        err(`${t.id}: threshold bonus ${th.bonusBp}bp exceeds the ${content.balance.synergyCapBp}bp cap`);
      }
      if (th.bonusBp < 0) err(`${t.id}: negative synergy is not allowed`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Save-file validation: every ID the save references must exist in content.
export function validateSave(content, state) {
  const errors = [];
  if (![1, 2, 3, 4].includes(state.schemaVersion)) errors.push(`Unsupported save schema ${state.schemaVersion}`);
  if (!state.characters || !state.inventory || !state.nodes || !Array.isArray(state.parties)) {
    return { ok: false, errors: ['Save is missing required gameplay state.'] };
  }
  for (const id of Object.keys(state.characters)) {
    const selectedSkinId = state.characters[id].selectedSkinId;
    if (content.characterById[id] && selectedSkinId && !content.skinById[selectedSkinId]) {
      errors.push(`Save references unknown skin ${selectedSkinId}`);
    }
  }
  for (const id of Object.keys(state.inventory.materials)) {
    if (!content.materialById[id]) errors.push(`Save references unknown material ${id}`);
    if (state.inventory.materials[id] < 0) errors.push(`Negative material quantity: ${id}`);
  }
  for (const id of Object.keys(state.inventory.components)) {
    if (!content.componentById[id]) errors.push(`Save references unknown component ${id}`);
    if (state.inventory.components[id] < 0) errors.push(`Negative component quantity: ${id}`);
  }
  for (const [id, qty] of Object.entries(state.inventory.resources ?? {})) {
    if (!Number.isFinite(qty) || qty < 0) errors.push(`Invalid resource quantity: ${id}`);
  }
  if (state.schemaVersion >= 3) {
    if (!Number.isInteger(state.dayNumber) || state.dayNumber < 1) errors.push('Invalid logical day number');
    if (!state.expeditions || !Array.isArray(state.expeditions.active) || !Array.isArray(state.expeditions.reports)) {
      errors.push('Missing Expedition state');
    }
    if (!state.headquarters || typeof state.headquarters.worlds !== 'object') errors.push('Missing Headquarters state');
  }
  if (state.schemaVersion >= 4) {
    const daily = state.energySystems?.daily;
    if (!daily || !Number.isInteger(daily.day) || !Number.isInteger(daily.suppliesUsed)
      || !Number.isInteger(daily.momentumRefunded) || daily.suppliesUsed < 0 || daily.momentumRefunded < 0 || daily.momentumRefunded > 30) {
      errors.push('Invalid daily Energy-system counters');
    }
    if (daily?.day !== state.dayNumber) errors.push('Daily Energy-system counters are for the wrong game day');
    const supply = state.inventory.resources?.[FIELD_SUPPLY_ID] ?? 0;
    const supplyLimits = fieldSupplyLimits(content, state);
    if (!Number.isInteger(supply) || supply < 0 || supply > supplyLimits.storageCap) errors.push('Invalid Field Supply quantity');
    if (supplyLimits.held + supplyLimits.reserved > supplyLimits.storageCap) errors.push('Field Supply promises exceed available storage');
    if (daily?.suppliesUsed > supplyLimits.dailyUseCap) errors.push('Field Supply uses exceed the daily limit');
    if (!state.crises || !Array.isArray(state.crises.cycleSeen) || !Array.isArray(state.crises.history)) errors.push('Missing Crisis state');
    if (state.crises?.lastSpawnDay !== null && (!Number.isInteger(state.crises.lastSpawnDay) || state.crises.lastSpawnDay < 2)) errors.push('Invalid last Crisis spawn day');
    if (state.crises?.cycleSeen?.some(id => typeof id !== 'string')) errors.push('Invalid Crisis cycle history');
    const active = state.crises?.active;
    if (active) {
      if (!content.crisisById[active.definitionId] || !content.worldById[active.worldId]) errors.push('Active Crisis references stale content');
      if (!['planning', 'resolved'].includes(active.status)) errors.push('Invalid active Crisis status');
      if (!Array.isArray(active.frontIds) || active.frontIds.length !== active.fronts?.length || new Set(active.frontIds).size !== active.frontIds.length) errors.push('Invalid active Crisis Front snapshot');
      for (const frontId of active.frontIds ?? []) {
        if (!Array.isArray(active.assignments?.[frontId]) || active.assignments[frontId].length !== active.teamSize) errors.push(`Invalid Crisis assignment slots for ${frontId}`);
      }
      const assigned = Object.values(active.assignments ?? {}).flat().filter(Boolean);
      if (new Set(assigned).size !== assigned.length) errors.push('Active Crisis contains duplicate character assignments');
      for (const id of assigned) if (!content.characterById[id] || !state.characters[id]?.owned) errors.push(`Active Crisis references unavailable character ${id}`);
      if (active.cacheClaimed && !active.result?.cacheChoiceId) errors.push('Claimed Crisis Cache has no recorded choice');
      if (active.status === 'resolved' && assigned.length !== active.frontIds.length * active.teamSize) errors.push('Resolved Crisis has an incomplete assignment');
      if (active.boon && !CRISIS_BOON_TYPES.has(active.boon.type)) errors.push(`Invalid active Crisis boon ${active.boon.type}`);
    }
  }
  for (const id of Object.keys(state.nodes)) {
    if ((state.nodes[id].attemptsToday ?? 0) < 0) errors.push(`Negative attempt count: ${id}`);
  }
  for (const id of Object.keys(state.archive.fragments)) {
    if (typeof state.archive.fragments[id] !== 'boolean') errors.push(`Invalid fragment state: ${id}`);
  }
  for (const party of state.parties) {
    if (!Array.isArray(party.members) || party.members.length !== content.balance.partySize) {
      errors.push(`Party "${party.name}" must contain ${content.balance.partySize} slots`);
      continue;
    }
    if (new Set(party.members.filter(Boolean)).size !== party.members.filter(Boolean).length) {
      errors.push(`Party "${party.name}" contains duplicate characters`);
    }
    for (const m of party.members) {
      if (m !== null && !content.characterById[m]) errors.push(`Party "${party.name}" references unknown character ${m}`);
    }
  }
  if (!Number.isInteger(state.activePartyIndex)
    || state.activePartyIndex < 0 || state.activePartyIndex >= state.parties.length) {
    errors.push('Active party index is invalid');
  }
  const pinKeys = new Set();
  for (const pin of state.pins ?? []) {
    if (!['equipment', 'character'].includes(pin.type)) {
      errors.push(`Unknown pin type ${pin.type}`);
      continue;
    }
    if (!content.characterById[pin.characterId]) errors.push(`Pin references unknown character ${pin.characterId}`);
    const key = pin.type === 'equipment'
      ? `equipment:${pin.characterId}:${pin.slot}`
      : `character:${pin.characterId}`;
    if (pinKeys.has(key)) errors.push(`Duplicate pin ${key}`);
    pinKeys.add(key);
    if (pin.type === 'equipment' && !content.characterMeta.slots[pin.slot]) {
      errors.push(`Pin references unknown equipment slot ${pin.slot}`);
    }
    if (pin.type === 'character' && state.schemaVersion >= 2) {
      if (!['unlock', 'promotion'].includes(pin.objective)) errors.push(`Shard pin ${pin.characterId} has an invalid objective`);
      if (!Number.isInteger(pin.targetStars) || pin.targetStars < 1 || pin.targetStars > 7) {
        errors.push(`Shard pin ${pin.characterId} has an invalid target`);
      }
    }
  }
  if (state.schemaVersion >= 2) {
    const ui = state.ui;
    if (!ui || typeof ui !== 'object') {
      errors.push('Missing UI preferences');
    } else {
      const roster = ui.roster ?? {};
      const allowed = {
        world: new Set(['all', ...content.worlds.map(w => w.id)]),
        archetype: new Set(['all', ...Object.keys(content.archetypes)]),
        faction: new Set(['all', ...content.tags.filter(t => t.category === 'faction').map(t => t.id)]),
        ownership: new Set(['all', 'owned', 'unowned', 'ready']),
        sort: new Set(['name', 'power', 'stars', 'gearTier', 'ready']),
        direction: new Set(['asc', 'desc'])
      };
      for (const [key, values] of Object.entries(allowed)) {
        if (!values.has(roster[key])) errors.push(`Invalid roster preference ${key}`);
      }
      const campaigns = new Set(['main', 'shadow', ...content.worlds.map(w => w.campaignId)]);
      if (!campaigns.has(ui.campaignId)) errors.push(`Unknown campaign preference ${ui.campaignId}`);
      for (const [nodeId, index] of Object.entries(ui.nodePartyById ?? {})) {
        if (!content.nodeById[nodeId]) errors.push(`Party preference references unknown node ${nodeId}`);
        if (!Number.isInteger(index) || index < 0 || index >= state.parties.length) {
          errors.push(`Invalid party preference index for ${nodeId}`);
        }
      }
      for (const [id, value] of Object.entries(ui.archiveCollapsed?.worlds ?? {})) {
        if (!content.worldById[id] || typeof value !== 'boolean') errors.push(`Invalid Archive world preference ${id}`);
      }
      const collectionIds = new Set(content.archives.flatMap(a => a.collections.map(c => c.id)));
      for (const [id, value] of Object.entries(ui.archiveCollapsed?.collections ?? {})) {
        if (!collectionIds.has(id) || typeof value !== 'boolean') errors.push(`Invalid Archive collection preference ${id}`);
      }
    }
    if (!['automatic', 'full', 'compact'].includes(state.settings?.farmingResults)) {
      errors.push('Invalid farming result preference');
    }
  }
  if (state.energy < 0) errors.push('Negative Energy');
  return { ok: errors.length === 0, errors };
}
