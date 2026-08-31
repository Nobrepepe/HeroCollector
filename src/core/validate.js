// Content validation (GDD 12.4): every referenced ID exists, campaigns chain
// correctly, thresholds never decrease, recipes are obtainable, relic pieces
// map 1:1 onto their World Campaign first clears, and synergy definitions
// stay inside the global cap. Produces a human-readable error list.
import { equipmentRecipe } from './content.js';
import { fieldSupplyLimits, FIELD_SUPPLY_ID } from './energy.js';
import { RANDOM_MATERIAL, randomMaterialPool } from './resources.js';
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
  for (const m of content.materials) uniq(m.id, 'material');
  for (const k of content.components) uniq(k.id, 'component');
  for (const c of content.characters) uniq(c.id, 'character');
  for (const t of content.tags) uniq(t.id, 'tag');
  for (const n of content.nodes) uniq(n.id, 'node');
  for (const n of content.nodes) {
    if (n.world && !content.worldById[n.world]) err(`${n.id}: unknown world ${n.world}`);
    for (const reward of [...(n.repeatRewards ?? []), ...(n.firstClearRewards ?? [])]) {
      if (reward.kind === 'resource' && !content.resourceById[reward.id]) {
        err(`${n.id}: unknown resource reward ${reward.id}`);
      }
      if (reward.kind === 'material' && !content.materialById[reward.id]) {
        err(`${n.id}: unknown material reward ${reward.id}`);
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
      if (reward.kind === 'resource' && !content.resourceById[reward.id]) {
        err(`${pack.id}: unknown resource ${reward.id}`);
      }
      if (reward.kind === 'material' && reward.id === RANDOM_MATERIAL) {
        if (!randomMaterialPool(content, reward.grade ?? 'basic').length) {
          err(`${pack.id}: no ${reward.grade ?? 'basic'} material exists for the random draw`);
        }
      } else if (reward.kind === 'material' && !content.materialById[reward.id]) {
        err(`${pack.id}: unknown material ${reward.id}`);
      }
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
    if (!template.optionalIds?.length) err(`${template.id}: a route with no possible bonus cannot reach an exceptional return`);
    if (template.requirementCount > (template.requirementIds?.length ?? 0)) err(`${template.id}: asks for more requirements than it defines`);
    for (const reward of template.fixedRewards ?? []) {
      if (reward.kind !== 'resource' || reward.id !== FIELD_SUPPLY_ID || reward.qty !== 1) err(`${template.id}: invalid fixed reward`);
      if (!template.supply) err(`${template.id}: only the Field Supply route may promise a Field Supply`);
    }
  }
  // The guaranteed Supply route is an engine rule, so exactly one template
  // may carry it — a second would crowd the board, none would starve it.
  const supplyTemplates = (content.expeditions.templates ?? []).filter(template => template.supply);
  if (supplyTemplates.length > 1) err(`Only one Expedition route may be the guaranteed Field Supply (found ${supplyTemplates.length})`);
  for (const template of supplyTemplates) {
    if (template.enabled === false) err(`${template.id}: the guaranteed Field Supply route is disabled`);
    if (template.fixedRewards?.length !== 1 || template.fixedRewards[0]?.id !== FIELD_SUPPLY_ID || template.fixedRewards[0]?.qty !== 1) {
      err(`${template.id}: the guaranteed Supply route needs exactly one fixed Field Supply`);
    }
  }

  const crisisIds = new Set();
  const favoredIds = new Set([...content.worlds.map(world => world.id), ...Object.keys(content.archetypes), ...content.tags.map(tag => tag.id)]);
  const gradeIds = new Set();
  const masteryRankIds = new Set((content.balance.mastery?.ranks ?? []).map(rank => rank.id));
  for (const grade of content.crises?.settings?.grades ?? []) {
    if (gradeIds.has(grade.id)) err(`Duplicate Crisis grade ${grade.id}`);
    gradeIds.add(grade.id);
    if (!Number.isInteger(grade.minOwned) || grade.minOwned < 1
      || !Number.isInteger(grade.frontCount) || grade.frontCount < 2 || !Number.isInteger(grade.teamSize) || grade.teamSize < 1) err(`${grade.id}: invalid Crisis grade settings`);
    // A grade must be reachable with a roster it will actually accept, or its
    // benchmark would be computed from heroes the player cannot have.
    if (grade.frontCount * grade.teamSize > grade.minOwned) {
      err(`${grade.id}: needs ${grade.frontCount * grade.teamSize} heroes but unlocks at ${grade.minOwned} owned`);
    }
    if (masteryRankIds.size && !masteryRankIds.has(grade.minMasteryRank)) err(`${grade.id}: unknown Mastery rank gate ${grade.minMasteryRank}`);
  }
  // A Crisis is generated per world, so the grades decide how many Fronts a
  // spawn draws; the definition must be able to supply the largest of them.
  const widestGrade = Math.max(0, ...(content.crises?.settings?.grades ?? []).map(grade => grade.frontCount ?? 0));
  for (const definition of content.crises?.definitions ?? []) {
    if (crisisIds.has(definition.id)) err(`Duplicate Crisis ID: ${definition.id}`);
    crisisIds.add(definition.id);
    if (!content.worldById[definition.worldId]) err(`${definition.id}: unknown Crisis world ${definition.worldId}`);
    if ((definition.fronts?.length ?? 0) < widestGrade) err(`${definition.id}: needs at least ${widestGrade} Fronts for its widest grade`);
    const frontIds = new Set();
    for (const front of definition.fronts ?? []) {
      if (frontIds.has(front.id)) err(`${definition.id}: duplicate Front ${front.id}`);
      frontIds.add(front.id);
      if (!front.name || !front.description) err(`${front.id}: missing Front prose`);
      if (!front.favoredTagIds?.length || front.favoredTagIds.length > 2) err(`${front.id}: needs one or two favored tags`);
      for (const id of front.favoredTagIds ?? []) if (!favoredIds.has(id)) err(`${front.id}: unknown favored tag ${id}`);
      // Recommended Power is computed when the Crisis spawns, from the roster
      // the player could field, so a Front carries no authored number to check.
    }
    if (![3, 4].includes(definition.cacheChoices?.length)) err(`${definition.id}: needs three or four Emergency Cache choices`);
    if (!definition.fronts?.every(front => front.struggleText && front.successText && front.excelText)) err(`${definition.id}: a Front is missing its outcome prose`);
    if (!CRISIS_BOON_TYPES.has(definition.boon?.type)) err(`${definition.id}: unknown boon type ${definition.boon?.type}`);
    for (const choice of definition.cacheChoices ?? []) for (const reward of choice.rewards ?? []) {
      if (reward.kind === 'resource' && !content.resourceById[reward.id]) err(`${choice.id}: unknown Cache resource ${reward.id}`);
      // A material Cache names a family; the grade is resolved at spawn from
      // whatever this world has opened, so the family is what must be real.
      if (reward.kind === 'material' && !content.materialMeta.familyOrder.includes(reward.family)) {
        err(`${choice.id}: unknown Cache material family ${reward.family}`);
      }
      if (!Number.isInteger(reward.qty) || reward.qty < 1) err(`${choice.id}: invalid Cache quantity`);
    }
    const boon = definition.boon;
    if (['free_world_node_runs', 'bonus_world_material_runs'].includes(boon?.type) && (!Number.isInteger(boon.runs) || boon.runs < 1)) err(`${definition.id}: boon needs a positive run count`);
    if (['bonus_world_material_runs', 'instant_intelligence'].includes(boon?.type) && (!Number.isInteger(boon.qty) || boon.qty < 1)) err(`${definition.id}: boon needs a positive quantity`);
  }

  // --- characters: exactly one world and one archetype; valid references
  for (const c of content.characters) {
    if (!content.worldById[c.world]) err(`${c.id}: unknown world ${c.world}`);
    if (!content.archetypes[c.archetype]) err(`${c.id}: unknown archetype ${c.archetype}`);
    if (c.faction && !content.tagById[c.faction]) err(`${c.id}: unknown faction ${c.faction}`);
    for (const slot of content.characterMeta.slotOrder) {
      if (!c.equipmentLines[slot]) err(`${c.id}: missing equipment line for slot ${slot}`);
    }
    // The starting five are drawn per save from the whole roster, so no hero
    // can rely on being one: every hero needs exactly one encounter that
    // reveals them. Two would stake the reveal shards twice for one hero and
    // never for another, which is a compiler fault rather than an authoring one.
    const reveals = (content.encounterNodesByCharacter[c.id] ?? []).length;
    if (reveals === 0) err(`${c.id}: no encounter node reveals this character`);
    else if (reveals > 1) err(`${c.id}: revealed by ${reveals} nodes; each hero enters the game once`);
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

  // --- campaigns are generated, so their shape is an invariant, not a
  // preference: a world campaign is exactly `nodes` long and the Main
  // Campaign is a whole number of chapters.
  const campaignConfig = content.balance.campaigns;
  for (const world of content.worlds) {
    const length = (content.nodesByCampaign[world.campaignId] ?? []).length;
    if (length !== campaignConfig.world.nodes) {
      err(`${world.id}: compiled ${length} campaign nodes, expected ${campaignConfig.world.nodes}`);
    }
  }
  const mainLength = (content.nodesByCampaign.main ?? []).length;
  if (mainLength % campaignConfig.main.chapterSize !== 0) {
    err(`Main Campaign compiled ${mainLength} nodes, which is not a whole number of ${campaignConfig.main.chapterSize}-node chapters`);
  }
  // It also has to be long enough to introduce every world's opening party,
  // because a World Campaign is locked until five of its heroes are owned and
  // nothing else can unlock it.
  const openingNeeded = content.worlds.length * content.balance.partySize;
  if (content.worlds.length && mainLength < openingNeeded) {
    err(`Main Campaign has ${mainLength} nodes but ${content.worlds.length} worlds need ${openingNeeded} opening reveals`);
  }

  // --- campaigns: continuous previous chains, nondecreasing thresholds
  for (const nodes of Object.values(content.nodesByCampaign)) {
    const sorted = [...nodes].sort((a, b) => a.number - b.number);
    let prevThreshold = 0, prevId = null;
    for (const n of sorted) {
      if (n.previous !== prevId) err(`${n.id}: previous should be ${prevId}, is ${n.previous}`);
      if (n.threshold < prevThreshold) err(`${n.id}: threshold ${n.threshold} decreases (prev ${prevThreshold})`);
      if (!content.materialById[n.material]) err(`${n.id}: unknown material ${n.material}`);
      if (n.encounterCharacter && !content.characterById[n.encounterCharacter]) err(`${n.id}: unknown encounter character`);
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
      prevThreshold = n.threshold;
      prevId = n.id;
    }
  }

  // --- every material every recipe needs must be reachable from a repeatable
  // node: either dropped directly, or upcraftable from a lower grade of the
  // same family that drops. Skipped while the game has no nodes (setup mode).
  if (content.nodes.length > 0) {
    const freeMinRankByFamily = {};
    for (const n of content.nodes) {
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
        err(`Material ${matId} is required by recipes but no repeatable node drops ${m.family} at that grade or below`);
      }
    }
  }

  // --- relics: one piece per configured position, each awarded by the first
  // clear of the World Campaign node the compiler put it on.
  const RELIC_PIECE_NODES = content.balance.campaigns.world.relicPieceNodes;
  for (const w of content.worlds) {
    if (!content.relicByWorld[w.id]) err(`${w.id}: world has no relic`);
  }
  const pieceIds = new Set();
  for (const relic of content.relics) {
    if (!content.worldById[relic.world]) err(`${relic.id}: unknown world ${relic.world}`);
    if (relic.pieces?.length !== RELIC_PIECE_NODES.length) err(`${relic.id}: needs exactly ${RELIC_PIECE_NODES.length} pieces`);
    for (const [index, piece] of (relic.pieces ?? []).entries()) {
      if (pieceIds.has(piece.id)) err(`${relic.id}: duplicate piece ${piece.id}`);
      pieceIds.add(piece.id);
      const node = content.nodeById[piece.sourceNode];
      if (!node) { err(`${piece.id}: unknown source node ${piece.sourceNode}`); continue; }
      if (node.type !== 'world' || node.world !== relic.world) err(`${piece.id}: source ${node.id} is not a World Campaign node of ${relic.world}`);
      if (node.number !== RELIC_PIECE_NODES[index]) err(`${piece.id}: source ${node.id} is not node ${RELIC_PIECE_NODES[index]}`);
      if (node.firstClear?.relicPiece !== piece.id) err(`${piece.id}: source node ${node.id} does not award this piece`);
    }
  }
  for (const n of content.nodes) {
    if (n.firstClear?.relicPiece && !content.relicPieceById[n.firstClear.relicPiece]) {
      err(`${n.id}: awards unknown relic piece ${n.firstClear.relicPiece}`);
    }
  }

  // --- skins and Mastery skin milestones
  const skinIds = new Set();
  for (const skin of content.skins) {
    if (skinIds.has(skin.id)) err(`Duplicate skin ID: ${skin.id}`);
    skinIds.add(skin.id);
    const skinChar = content.characterById[skin.characterId];
    if (!skinChar) err(`${skin.id}: skin references unknown character`);
    else if (skinChar.world !== skin.world) err(`${skin.id}: skin character is from another world`);
  }
  const cosmeticRanks = content.balance.mastery.cosmeticRanks ?? [];
  for (const w of content.worlds) {
    for (const entry of w.masterySkins ?? []) {
      if (!cosmeticRanks.includes(entry.rank)) err(`${w.id}: unknown Mastery cosmetic rank ${entry.rank}`);
      const skin = content.skinById[entry.skinId];
      if (!skin) err(`${w.id}: Mastery skin references unknown skin ${entry.skinId}`);
      else if (skin.characterId !== entry.characterId || skin.world !== w.id) err(`${w.id}: Mastery skin ${entry.skinId} does not belong to that character and world`);
    }
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
// Dormant progress (nodes, relic pieces, Mastery entries, character state for
// content that left the game) is deliberately tolerated — it returns when the
// content does.
export function validateSave(content, state) {
  const errors = [];
  if (state.schemaVersion !== 7) errors.push(`Unsupported save schema ${state.schemaVersion}`);
  if (!state.characters || !state.inventory || !state.nodes || !Array.isArray(state.parties)
    || !state.focus?.slots || typeof state.programs !== 'object' || !state.relics?.pieces || typeof state.mastery !== 'object') {
    return { ok: false, errors: ['Save is missing required gameplay state.'] };
  }
  // The drawn starting five. `syncSaveWithContent` prunes entries whose
  // content left the game and tops the list back up, so by the time a save is
  // validated every name here is live — and owned, because the draw granted
  // them. (Their ownership itself survives dormancy in `state.characters`.)
  if (!Array.isArray(state.starters)) errors.push('Save is missing its starting roster.');
  else {
    if (new Set(state.starters).size !== state.starters.length) errors.push('The starting roster names the same character twice.');
    for (const id of state.starters) {
      if (!state.characters[id]?.owned) errors.push(`Starting character ${id} is not owned`);
    }
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
  if (!Number.isInteger(state.dayNumber) || state.dayNumber < 1) errors.push('Invalid logical day number');

  // --- Energy systems and Field Supplies
  const daily = state.energySystems?.daily;
  if (!daily || !Number.isInteger(daily.day)
    || !Number.isInteger(daily.momentumRefunded) || daily.momentumRefunded < 0 || daily.momentumRefunded > 30) {
    errors.push('Invalid daily Energy-system counters');
  }
  if (daily?.day !== state.dayNumber) errors.push('Daily Energy-system counters are for the wrong game day');
  const supply = state.inventory.resources?.[FIELD_SUPPLY_ID] ?? 0;
  const supplyLimits = fieldSupplyLimits(content, state);
  if (!Number.isInteger(supply) || supply < 0 || supply > supplyLimits.storageCap) errors.push('Invalid Field Supply quantity');
  if (supplyLimits.held + supplyLimits.reserved > supplyLimits.storageCap) errors.push('Field Supply promises exceed available storage');
  if (state.surge !== null && (!Number.isInteger(state.surge?.bp) || state.surge.bp < 1)) errors.push('Invalid armed Surge');

  // --- Development Focus
  const focusIds = [];
  for (const slot of ['primary', 'secondary', 'longTerm']) {
    const entry = state.focus.slots[slot];
    if (!entry) { errors.push(`Missing Focus slot ${slot}`); continue; }
    const rate = content.balance.focus?.rates?.[slot];
    if (!Number.isInteger(entry.progress) || entry.progress < 0 || (rate && entry.progress >= rate)) {
      errors.push(`Invalid Focus progress in ${slot}`);
    }
    if (entry.characterId !== null) {
      if (!state.characters[entry.characterId]) errors.push(`Focus slot ${slot} references unknown character ${entry.characterId}`);
      focusIds.push(entry.characterId);
    }
  }
  if (new Set(focusIds).size !== focusIds.length) errors.push('The same hero occupies two Focus slots');

  // --- World Programs
  for (const [worldId, ps] of Object.entries(state.programs)) {
    for (const program of ['procurement', 'development', 'operations']) {
      if (!Number.isInteger(ps[program]?.meter) || ps[program].meter < 0) errors.push(`Invalid ${program} meter for ${worldId}`);
      if (!Number.isInteger(ps[program]?.delivered) || ps[program].delivered < 0) errors.push(`Invalid ${program} delivery count for ${worldId}`);
    }
    if (ps.relicSlot !== null && !['procurement', 'development', 'operations'].includes(ps.relicSlot)) {
      errors.push(`Invalid relic slot for ${worldId}`);
    }
    if (!content.worldById[worldId]) continue; // dormant world: structure only
    if (ps.procurement.family !== null && !content.materialMeta.familyOrder.includes(ps.procurement.family)) {
      errors.push(`Unknown Procurement family for ${worldId}`);
    }
    if (ps.development.heroId !== null && content.characterById[ps.development.heroId]?.world !== worldId) {
      errors.push(`Invalid Development hero for ${worldId}`);
    }
  }

  // --- relic pieces, bindings, and Mastery
  for (const [pieceId, value] of Object.entries(state.relics.pieces)) {
    if (value !== true) errors.push(`Invalid relic piece state: ${pieceId}`);
  }
  // A binding for a world whose content left the game is dormant progress like
  // any other, so only the shape is checked here.
  for (const [worldId, value] of Object.entries(state.relics.restored ?? {})) {
    if (value !== true) errors.push(`Invalid relic binding state: ${worldId}`);
  }
  const rankIds = new Set((content.balance.mastery?.ranks ?? []).map(rank => rank.id));
  for (const [worldId, entry] of Object.entries(state.mastery)) {
    if (!Array.isArray(entry.claimedRanks) || !Array.isArray(entry.pendingChoices)) {
      errors.push(`Invalid Mastery state for ${worldId}`);
      continue;
    }
    for (const rankId of entry.claimedRanks) {
      if (rankIds.size && !rankIds.has(rankId)) errors.push(`Unknown claimed Mastery rank ${rankId} for ${worldId}`);
    }
    for (const choice of entry.pendingChoices) {
      if (!['materialCache', 'shards'].includes(choice.kind) || !Number.isInteger(choice.qty) || choice.qty < 1) {
        errors.push(`Invalid pending Mastery choice for ${worldId}`);
      }
    }
  }

  // --- Expedition cycle
  const expeditions = state.expeditions;
  if (!expeditions || !Number.isInteger(expeditions.cycle) || expeditions.cycle < 1
    || !Array.isArray(expeditions.reports)) {
    errors.push('Missing Expedition state');
  } else {
    const allowances = expeditions.allowances;
    if (!allowances || !Number.isInteger(allowances.freeRerollsUsed) || !Number.isInteger(allowances.freePinsUsed)) {
      errors.push('Invalid Expedition allowances');
    }
    if (expeditions.board !== null && !Array.isArray(expeditions.board?.offers)) errors.push('Invalid route board');
    const active = expeditions.active;
    if (active !== null) {
      if (!Array.isArray(active.routes) || !Number.isInteger(active.launchDay)
        || !Number.isInteger(active.returnDay) || active.returnDay <= active.launchDay) {
        errors.push('Invalid launched cycle');
      } else {
        const away = active.routes.flatMap(route => route.party);
        if (new Set(away).size !== away.length) errors.push('A character is on two routes of the launched cycle');
      }
    }
  }

  // --- Crises
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
  for (const [id, ns] of Object.entries(state.nodes)) {
    if (typeof ns.cleared !== 'boolean') errors.push(`Invalid node state: ${id}`);
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
    if (pin.type === 'character') {
      if (!['unlock', 'promotion'].includes(pin.objective)) errors.push(`Shard pin ${pin.characterId} has an invalid objective`);
      if (!Number.isInteger(pin.targetStars) || pin.targetStars < 1 || pin.targetStars > 7) {
        errors.push(`Shard pin ${pin.characterId} has an invalid target`);
      }
    }
  }
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
    const campaigns = new Set(['main', ...content.worlds.map(w => w.campaignId)]);
    if (!campaigns.has(ui.campaignId)) errors.push(`Unknown campaign preference ${ui.campaignId}`);
    for (const [nodeId, index] of Object.entries(ui.nodePartyById ?? {})) {
      if (!content.nodeById[nodeId]) errors.push(`Party preference references unknown node ${nodeId}`);
      if (!Number.isInteger(index) || index < 0 || index >= state.parties.length) {
        errors.push(`Invalid party preference index for ${nodeId}`);
      }
    }
    for (const [nodeId, members] of Object.entries(ui.nodePartyMembersById ?? {})) {
      if (!content.nodeById[nodeId]) errors.push(`Node party references unknown node ${nodeId}`);
      if (!Array.isArray(members) || members.length !== content.balance.partySize) {
        errors.push(`Invalid node party for ${nodeId}`);
        continue;
      }
      const filled = members.filter(Boolean);
      if (new Set(filled).size !== filled.length) errors.push(`Node party for ${nodeId} repeats a character`);
      for (const id of filled) {
        if (!state.characters[id]?.owned) errors.push(`Node party for ${nodeId} holds unowned ${id}`);
      }
    }
  }
  if (!['automatic', 'full', 'compact'].includes(state.settings?.farmingResults)) {
    errors.push('Invalid farming result preference');
  }
  if (state.energy < 0) errors.push('Negative Energy');
  return { ok: errors.length === 0, errors };
}
