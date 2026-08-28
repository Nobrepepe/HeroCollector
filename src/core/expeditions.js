// Expeditions: an infrequent roster puzzle on a shared cycle. Each cycle
// presents one board of routes; the player picks up to `slotCount`, assigns
// every party together, and all selected routes launch and return together
// after `cycleLengthDays`. The board waits for the player — it never expires —
// and rerolls/pins are per-cycle allowances. Route rewards are scaled up by
// `cycleScaleBp` to compensate for replacing daily boards with one allocation.
import { characterPowerForState } from './power.js';
import {
  addResource, grantRewardEntries, INTELLIGENCE_ID, RANDOM_MATERIAL, randomMaterialPool, scaledRewards
} from './resources.js';
import { fieldSupplyLimits, FIELD_SUPPLY_ID } from './energy.js';
import { isRevealed } from './focus.js';
import { addOperationsCompletion } from './programs.js';

const pick = (rng, list) => list[Math.floor(rng.next() * list.length)];
const shuffle = (rng, list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function expeditionCharacterIds(state) {
  return new Set((state.expeditions?.active?.routes ?? []).flatMap(route => route.party));
}

export function characterExpedition(state, characterId) {
  return (state.expeditions?.active?.routes ?? []).find(route => route.party.includes(characterId)) ?? null;
}

export function partySnapshot(content, state, ids) {
  return ids.map(id => {
    const def = content.characterById[id], cs = state.characters[id];
    return {
      id, power: characterPowerForState(content, state, id), stars: cs.stars,
      world: def.world, archetype: def.archetype,
      tags: [def.faction, ...(def.extraTags ?? [])].filter(Boolean)
    };
  });
}

export function evaluateRequirement(requirement, party, offer = {}) {
  const worlds = new Set(party.map(c => c.world));
  const archetypes = new Set(party.map(c => c.archetype));
  const targetWorld = requirement.world === '@associated' ? offer.world : requirement.world;
  let current = 0;
  let contributors = [];
  switch (requirement.type) {
    case 'party_size':
      current = party.length; contributors = party.map(c => c.id); break;
    case 'world_count':
      contributors = party.filter(c => c.world === targetWorld).map(c => c.id); current = contributors.length; break;
    case 'archetype_count':
      contributors = party.filter(c => c.archetype === requirement.archetype).map(c => c.id); current = contributors.length; break;
    case 'same_world':
      for (const world of worlds) {
        const ids = party.filter(c => c.world === world).map(c => c.id);
        if (ids.length > current) { current = ids.length; contributors = ids; }
      }
      break;
    case 'distinct_worlds':
      current = worlds.size; contributors = party.map(c => c.id); break;
    case 'distinct_archetypes':
      current = archetypes.size; contributors = party.map(c => c.id); break;
    case 'combined_stars':
      current = party.reduce((n, c) => n + c.stars, 0); contributors = party.map(c => c.id); break;
    case 'combined_power':
      current = party.reduce((n, c) => n + c.power, 0); contributors = party.map(c => c.id); break;
    case 'power_over_recommended':
      current = party.reduce((n, c) => n + c.power, 0);
      requirement = { ...requirement, count: Math.ceil(offer.recommendedPower * (10000 + requirement.percentBp) / 10000) };
      contributors = party.map(c => c.id); break;
    case 'star_character':
      contributors = party.filter(c => c.stars >= requirement.stars).map(c => c.id); current = contributors.length; break;
    default: return { met: false, current: 0, target: requirement.count ?? 1, contributors: [], text: requirement.text ?? 'Unknown requirement.' };
  }
  const target = requirement.count ?? 1;
  return { met: current >= target, current, target, contributors, text: requirement.text ?? `${current} of ${target}` };
}

export function previewExpedition(content, state, offer, ids) {
  const party = partySnapshot(content, state, ids);
  const mandatory = offer.requirements.map(r => evaluateRequirement(r, party, offer));
  const optional = evaluateRequirement(offer.optional, party, offer);
  const power = party.reduce((n, c) => n + c.power, 0);
  const valid = ids.length === offer.partySize && new Set(ids).size === ids.length && mandatory.every(r => r.met);
  const tier = power < offer.recommendedPower ? 'completed' : optional.met ? 'exceptional' : 'successful';
  const multiplierBp = content.expeditions.settings.resultMultipliersBp[tier];
  return { valid, party, mandatory, optional, power, tier, multiplierBp,
    fixedRewards: structuredClone(offer.fixedRewards ?? []),
    rewards: [...structuredClone(offer.fixedRewards ?? []), ...scaledRewards(offer.baseRewards, multiplierBp)] };
}

function combinations(list, size, visit, start = 0, chosen = []) {
  if (chosen.length === size) return visit(chosen);
  for (let i = start; i <= list.length - (size - chosen.length); i++) {
    if (combinations(list, size, visit, i + 1, [...chosen, list[i]])) return true;
  }
  return false;
}

export function offerFeasibility(content, state, offer) {
  const busy = expeditionCharacterIds(state);
  const ids = content.characters.filter(d => state.characters[d.id]?.owned && !busy.has(d.id)).map(d => d.id);
  let party = null;
  combinations(ids, offer.partySize, candidate => {
    if (previewExpedition(content, state, offer, candidate).valid) { party = candidate; return true; }
    return false;
  });
  return { feasible: !!party, party };
}

// A @random_material entry draws one family at its authored grade when the
// offer is built, so the board already shows which material the route holds.
function rollRewardMaterial(content, entry, rng) {
  if (entry.kind !== 'material' || entry.id !== RANDOM_MATERIAL) return entry.id;
  const pool = randomMaterialPool(content, entry.grade ?? 'basic');
  return pool.length ? pick(rng, pool).id : entry.id;
}

function instantiateOffer(content, state, template, rng, cycle, position) {
  const settings = content.expeditions.settings;
  const requirementDefs = content.expeditions.requirementById;
  const optionalDefs = content.expeditions.optionalById;
  const world = template.world === '@any'
    ? pick(rng, content.worlds).id : template.world ?? null;
  // An across-world route has no associated world, so an @associated
  // requirement would be impossible by construction.
  const eligibleRequirementIds = template.requirementIds.filter(id => {
    const requirement = requirementDefs[id];
    return world || requirement?.world !== '@associated';
  });
  const reqIds = shuffle(rng, eligibleRequirementIds).slice(0, template.requirementCount ?? 1);
  const requirements = [{ type: 'party_size', count: template.partySize, text: `Send ${template.partySize} characters.` },
    ...reqIds.map(id => structuredClone(requirementDefs[id])).filter(Boolean)];
  const optional = structuredClone(optionalDefs[pick(rng, template.optionalIds)]);
  // Recommended Power scales from the player's strongest heroes — the ones who
  // would actually go — so investing in a squad is never punished.
  const topPowers = content.characters.filter(d => state.characters[d.id]?.owned)
    .map(d => characterPowerForState(content, state, d.id))
    .sort((a, b) => b - a)
    .slice(0, template.partySize);
  while (topPowers.length < template.partySize) topPowers.push(1150);
  const ratio = template.powerRatioBp?.[0] ?? 10000;
  const ratioMax = template.powerRatioBp?.[1] ?? ratio;
  const sampledRatio = ratio + Math.floor(rng.next() * (ratioMax - ratio + 1));
  const packageDef = content.expeditions.rewardById[template.rewardPackageId];
  const scale = qty => Math.max(1, Math.floor(qty * (settings.cycleScaleBp ?? 10000) / 10000));
  const rewards = (packageDef?.entries ?? []).map(entry => ({
    ...entry, id: rollRewardMaterial(content, entry, rng),
    qty: scale(entry.min + Math.floor(rng.next() * (entry.max - entry.min + 1)))
  }));
  const rare = packageDef?.rare?.length
    ? { ...structuredClone(pick(rng, packageDef.rare)) } : null;
  if (rare) rare.qty = scale(rare.qty ?? 1);
  if (packageDef?.shardPool) {
    // A character-lead route lets the player CHOOSE a revealed hero from the
    // route's world at launch, rather than receiving a random one.
    const range = packageDef.shardRange ?? [2, 4];
    rewards.push({ kind: 'shards', choice: { world },
      qty: scale(range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1))) });
  }
  return {
    id: `offer_${cycle}_${position}_${Math.floor(rng.next() * 0xffffffff).toString(36)}`,
    templateId: template.id, name: pick(rng, template.titles), description: pick(rng, template.descriptions),
    world, partySize: template.partySize, requirements, optional,
    recommendedPower: Math.max(1, Math.round(topPowers.reduce((n, p) => n + p, 0) * sampledRatio / 10000)),
    offerKind: template.id === settings.guaranteedSupplyTemplateId ? 'supply' : 'standard',
    baseRewards: rewards, fixedRewards: (template.fixedRewards ?? []).map(entry => ({ ...structuredClone(entry), fixed: true })), rareReward: rare, rareRevealed: false,
    rareRoll: Math.floor(rng.next() * 10000), pinned: false
  };
}

export function generateCycleBoard(content, state, rng, { pinned = null } = {}) {
  const settings = content.expeditions.settings;
  const cycle = state.expeditions.cycle;
  const offers = pinned ? [{ ...structuredClone(pinned), pinned: false }] : [];
  const guaranteed = content.expeditions.templateById?.[settings.guaranteedSupplyTemplateId]
    ?? content.expeditions.templates.find(template => template.id === settings.guaranteedSupplyTemplateId);
  if (guaranteed && guaranteed.enabled !== false && !offers.some(offer => offer.offerKind === 'supply')) {
    offers.push(instantiateOffer(content, state, guaranteed, rng, cycle, offers.length));
  }
  const templates = content.expeditions.templates.filter(t => t.enabled !== false && t.id !== settings.guaranteedSupplyTemplateId);
  for (let position = offers.length; position < settings.offerCount; position++) {
    if (!templates.length) break;
    let chosen = null;
    for (let attempt = 0; attempt < settings.generationAttempts; attempt++) {
      const weighted = templates.flatMap(t => Array(Math.max(1, t.weight ?? 1)).fill(t));
      const template = pick(rng, weighted);
      const candidate = instantiateOffer(content, state, template, rng, cycle, position);
      if (offers.some(o => o.templateId === candidate.templateId && o.requirements[1]?.type === candidate.requirements[1]?.type)) continue;
      chosen = candidate; break;
    }
    chosen ??= instantiateOffer(content, state, content.expeditions.fallbackTemplate, rng, cycle, position);
    offers.push(chosen);
  }
  // Replace hard offers until the configured minimum is met where possible.
  let feasible = offers.filter(o => offerFeasibility(content, state, o).feasible).length;
  for (let i = offers.length - 1; i >= 0 && feasible < settings.minimumFeasible; i--) {
    if (offers[i].id === pinned?.id || offers[i].offerKind === 'supply' || offerFeasibility(content, state, offers[i]).feasible) continue;
    const replacement = instantiateOffer(content, state, content.expeditions.fallbackTemplate, rng, cycle, i);
    offers[i] = replacement;
    if (offerFeasibility(content, state, replacement).feasible) feasible++;
  }
  // Operations Programs improve the next cycle's routes from their world:
  // one banked boost adds a visible material bundle to every route from that
  // world on this board.
  const boostQty = content.balance.programs?.operations?.bonusQty ?? 4;
  for (const world of content.worlds) {
    const ops = state.programs?.[world.id]?.operations;
    if (!ops?.boostCycles) continue;
    const boosted = offers.filter(offer => offer.world === world.id);
    if (!boosted.length) continue;
    ops.boostCycles -= 1;
    for (const offer of boosted) {
      offer.baseRewards.push({
        kind: 'material', id: rollRewardMaterial(content, { kind: 'material', id: RANDOM_MATERIAL, grade: 'basic' }, rng),
        qty: boostQty, operations: true
      });
    }
  }
  state.expeditions.board = { cycle, seed: cycle, offers };
  state.expeditions.allowances = {
    freeRerolls: settings.freeRerolls ?? 1, freeRerollsUsed: 0,
    freePins: settings.freePins ?? 1, freePinsUsed: 0
  };
  return state.expeditions.board;
}

// Launch the whole cycle in one commitment: up to `slotCount` routes, all
// parties assigned together, no character on two routes. Unchosen routes are
// released (a pinned one is carried to the next cycle's board).
export function launchCycle(content, state, selections) {
  const settings = content.expeditions.settings;
  const board = state.expeditions.board;
  const reasons = [];
  if (!board) reasons.push('No route board is waiting.');
  if (state.expeditions.active) reasons.push('This cycle has already launched.');
  if (!Array.isArray(selections) || selections.length < 1) reasons.push('Choose at least one route.');
  if ((selections?.length ?? 0) > settings.slotCount) reasons.push(`At most ${settings.slotCount} routes can launch per cycle.`);
  if (reasons.length) return { ok: false, reasons };

  const seen = new Set();
  const assigned = new Set();
  const routes = [];
  let promisedSupplies = 0;
  for (const selection of selections) {
    const offer = board.offers.find(o => o.id === selection.offerId);
    if (!offer) { reasons.push('A selected route is no longer available.'); continue; }
    if (seen.has(offer.id)) { reasons.push(`${offer.name} was selected twice.`); continue; }
    seen.add(offer.id);
    const ids = selection.party ?? [];
    for (const id of ids) {
      if (!state.characters[id]?.owned) reasons.push('Every route member must be owned.');
      if (assigned.has(id)) reasons.push(`${content.characterById[id]?.displayName ?? id} is assigned to two routes.`);
      assigned.add(id);
    }
    const preview = previewExpedition(content, state, offer, ids);
    if (!preview.valid) reasons.push(`${offer.name}: the selected party does not satisfy every mandatory requirement.`);
    // Resolve character-lead shard choices to the player's chosen hero.
    const baseRewards = structuredClone(offer.baseRewards);
    for (const entry of baseRewards) {
      if (entry.kind !== 'shards' || !entry.choice) continue;
      const chosenId = selection.shardChoiceCharacterId;
      const def = chosenId ? content.characterById[chosenId] : null;
      if (!def) reasons.push(`${offer.name}: choose a revealed hero for the lead.`);
      else if (entry.choice.world && def.world !== entry.choice.world) reasons.push(`${offer.name}: the lead must be a hero of ${content.worldById[entry.choice.world]?.displayName ?? 'the route’s world'}.`);
      else if (!isRevealed(state, chosenId)) reasons.push(`${offer.name}: only a revealed hero can be the lead.`);
      else { entry.characterId = chosenId; delete entry.choice; }
    }
    promisedSupplies += (offer.fixedRewards ?? [])
      .filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID)
      .reduce((sum, entry) => sum + entry.qty, 0);
    if (reasons.length) continue;
    const rewards = scaledRewards(baseRewards, preview.multiplierBp);
    const rareChance = offer.rareReward?.chanceBp ?? 0;
    if (preview.tier === 'exceptional' && offer.rareReward && offer.rareRoll < rareChance) {
      rewards.push({ ...offer.rareReward, qty: offer.rareReward.qty ?? 1 });
    }
    routes.push({
      id: `route_${offer.id}`, offerId: offer.id, templateId: offer.templateId,
      name: offer.name, description: offer.description, world: offer.world,
      party: [...ids], snapshot: preview.party,
      tier: preview.tier, optionalMet: preview.optional.met, rewards,
      fixedRewards: structuredClone(offer.fixedRewards ?? []), offerKind: offer.offerKind ?? 'standard',
      rareReward: offer.rareReward, rareRevealed: offer.rareRevealed
    });
  }
  if (promisedSupplies > fieldSupplyLimits(content, state).unreservedCapacity) {
    reasons.push('Held and promised Field Supplies already fill the available storage. Use a Supply first.');
  }
  if (reasons.length) return { ok: false, reasons: [...new Set(reasons)] };

  const pinnedCarry = board.offers.find(offer => offer.pinned && !seen.has(offer.id)) ?? null;
  state.expeditions.active = {
    cycle: board.cycle, launchDay: state.dayNumber,
    returnDay: state.dayNumber + (settings.cycleLengthDays ?? 4),
    routes, pinnedCarry, sourceBoard: structuredClone(board)
  };
  state.expeditions.board = null;
  return { ok: true, active: state.expeditions.active };
}

export function cancelCycle(state) {
  const active = state.expeditions.active;
  if (!active) return { ok: false, reasons: ['No launched cycle to cancel.'] };
  if (active.launchDay !== state.dayNumber) {
    return { ok: false, reasons: ['A cycle cannot be cancelled after its launch day has advanced.'] };
  }
  state.expeditions.board = active.sourceBoard;
  state.expeditions.active = null;
  return { ok: true };
}

// Resolve a due cycle: grant every route's rewards together, feed each world's
// Operations Program, file one cycle report, and put up the next board.
export function resolveDueCycle(content, state, rng) {
  const active = state.expeditions.active;
  if (!active || active.returnDay > state.dayNumber) return null;
  const routeReports = [];
  for (const route of active.routes) {
    const rewards = grantRewardEntries(content, state, [...(route.fixedRewards ?? []), ...(route.rewards ?? [])]);
    if (route.world) addOperationsCompletion(content, state, route.world, 1);
    const pool = content.expeditions.reports[route.tier] ?? ['The party returned with the promised rewards.'];
    routeReports.push({ ...route, report: pool[(route.offerId.length + active.returnDay) % pool.length], rewards });
  }
  const report = {
    cycle: active.cycle, launchDay: active.launchDay, returnDay: active.returnDay,
    routes: routeReports, acknowledged: false
  };
  state.expeditions.reports.unshift(report);
  state.expeditions.reports = state.expeditions.reports.slice(0, 20);
  const pinned = active.pinnedCarry;
  state.expeditions.active = null;
  state.expeditions.cycle += 1;
  if (rng && content.expeditions?.templates?.length) {
    generateCycleBoard(content, state, rng, { pinned });
  }
  return report;
}

export function rerollOffer(content, state, offerId, rng) {
  const board = state.expeditions.board;
  if (!board) return { ok: false, reasons: ['No route board is waiting.'] };
  const index = board.offers.findIndex(o => o.id === offerId);
  const offer = board.offers[index];
  if (!offer || offer.pinned || offer.offerKind === 'supply') return { ok: false, reasons: [offer?.offerKind === 'supply'
    ? 'The guaranteed Field Supply route cannot be rerolled.' : 'Only an unpinned available route can be rerolled.'] };
  const allowances = state.expeditions.allowances;
  const free = allowances.freeRerollsUsed < allowances.freeRerolls;
  if (!free && !addResource(state, INTELLIGENCE_ID, -content.expeditions.settings.intelligenceCosts.reroll)) {
    return { ok: false, reasons: ['Not enough Intelligence.'] };
  }
  const pool = content.expeditions.templates.filter(template => template.enabled !== false
    && template.id !== content.expeditions.settings.guaranteedSupplyTemplateId);
  if (!pool.length) return { ok: false, reasons: ['No other enabled route template can replace this offer.'] };
  const replacement = instantiateOffer(content, state, pick(rng, pool), rng, board.cycle, index);
  board.offers[index] = replacement;
  if (free) allowances.freeRerollsUsed++;
  return { ok: true, offer: replacement, free };
}

export function togglePinOffer(content, state, offerId) {
  const board = state.expeditions.board;
  if (!board) return { ok: false, reasons: ['No route board is waiting.'] };
  const offer = board.offers.find(o => o.id === offerId);
  if (!offer) return { ok: false, reasons: ['Unknown route.'] };
  if (offer.pinned) { offer.pinned = false; return { ok: true, pinned: false }; }
  if (board.offers.some(o => o.pinned)) return { ok: false, reasons: ['Only one route may be pinned.'] };
  const allowances = state.expeditions.allowances;
  const free = allowances.freePinsUsed < allowances.freePins;
  if (!free && !addResource(state, INTELLIGENCE_ID, -content.expeditions.settings.intelligenceCosts.pin)) {
    return { ok: false, reasons: ['Not enough Intelligence.'] };
  }
  offer.pinned = true;
  if (free) allowances.freePinsUsed++;
  return { ok: true, pinned: true, free };
}

export function revealRareReward(content, state, offerId) {
  const offer = state.expeditions.board?.offers.find(o => o.id === offerId);
  if (!offer || !offer.rareReward) return { ok: false, reasons: ['This route has no rare reward to reveal.'] };
  if (offer.rareRevealed) return { ok: true };
  if (!addResource(state, INTELLIGENCE_ID, -content.expeditions.settings.intelligenceCosts.reveal)) {
    return { ok: false, reasons: ['Not enough Intelligence.'] };
  }
  offer.rareRevealed = true;
  return { ok: true };
}
