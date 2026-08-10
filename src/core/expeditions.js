import { characterPowerForState } from './power.js';
import { hqExpeditionModifiers } from './hq.js';
import {
  addResource, grantRewardEntries, INTELLIGENCE_ID, RANDOM_MATERIAL, randomMaterialPool, scaledRewards
} from './resources.js';
import { fieldSupplyLimits, FIELD_SUPPLY_ID } from './energy.js';
import { activeCrisisBoon } from './crises.js';

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
  return new Set((state.expeditions?.active ?? []).flatMap(item => item.party));
}

export function characterExpedition(state, characterId) {
  return (state.expeditions?.active ?? []).find(item => item.party.includes(characterId)) ?? null;
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
// offer is built, so the board already shows which material the cache holds.
function rollRewardMaterial(content, entry, rng) {
  if (entry.kind !== 'material' || entry.id !== RANDOM_MATERIAL) return entry.id;
  const pool = randomMaterialPool(content, entry.grade ?? 'basic');
  return pool.length ? pick(rng, pool).id : entry.id;
}

function instantiateOffer(content, state, template, rng, day, position) {
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
  const owned = content.characters.filter(d => state.characters[d.id]?.owned);
  const average = owned.length ? owned.reduce((n, d) => n + characterPowerForState(content, state, d.id), 0) / owned.length : 1150;
  const ratio = template.powerRatioBp?.[0] ?? 10000;
  const ratioMax = template.powerRatioBp?.[1] ?? ratio;
  const sampledRatio = ratio + Math.floor(rng.next() * (ratioMax - ratio + 1));
  const packageDef = content.expeditions.rewardById[template.rewardPackageId];
  const rewards = (packageDef?.entries ?? []).map(entry => ({
    ...entry, id: rollRewardMaterial(content, entry, rng),
    qty: entry.min + Math.floor(rng.next() * (entry.max - entry.min + 1))
  }));
  const rare = packageDef?.rare?.length ? structuredClone(pick(rng, packageDef.rare)) : null;
  const duration = template.durations.length === 1 ? template.durations[0] : pick(rng, template.durations);
  if (packageDef?.shardPool) {
    const candidates = content.characters.filter(def => !world || def.world === world);
    if (candidates.length) {
      const range = packageDef.shardRange ?? [2, 4];
      rewards.push({ kind: 'shards', characterId: pick(rng, candidates).id,
        qty: range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1)) });
    }
  }
  return {
    id: `offer_${day}_${position}_${Math.floor(rng.next() * 0xffffffff).toString(36)}`,
    templateId: template.id, name: pick(rng, template.titles), description: pick(rng, template.descriptions),
    world, duration, partySize: template.partySize, requirements, optional,
    recommendedPower: Math.max(1, Math.round(average * template.partySize * sampledRatio / 10000)),
    offerKind: template.id === content.expeditions.settings.guaranteedSupplyTemplateId ? 'supply' : 'standard',
    baseRewards: rewards, fixedRewards: (template.fixedRewards ?? []).map(entry => ({ ...structuredClone(entry), fixed: true })), rareReward: rare, rareRevealed: false,
    rareRoll: Math.floor(rng.next() * 10000), pinned: false
  };
}

export function generateExpeditionBoard(content, state, rng, { seed = null, pinned = null } = {}) {
  const settings = content.expeditions.settings;
  const offers = pinned ? [{ ...structuredClone(pinned), pinned: false }] : [];
  const guaranteed = content.expeditions.templateById?.[settings.guaranteedSupplyTemplateId]
    ?? content.expeditions.templates.find(template => template.id === settings.guaranteedSupplyTemplateId);
  if (guaranteed && guaranteed.enabled !== false && !offers.some(offer => offer.offerKind === 'supply')) {
    offers.push(instantiateOffer(content, state, guaranteed, rng, state.dayNumber, offers.length));
  }
  let longCount = offers.filter(o => o.duration === 2).length;
  const templates = content.expeditions.templates.filter(t => t.enabled !== false && t.id !== settings.guaranteedSupplyTemplateId);
  for (let position = offers.length; position < settings.offerCount; position++) {
    if (!templates.length) break;
    let chosen = null;
    for (let attempt = 0; attempt < settings.generationAttempts; attempt++) {
      const weighted = templates.flatMap(t => Array(Math.max(1, t.weight ?? 1)).fill(t));
      const template = pick(rng, weighted);
      const candidate = instantiateOffer(content, state, template, rng, state.dayNumber, position);
      if (candidate.duration === 2 && longCount >= settings.maxLongOffers) continue;
      if (offers.some(o => o.templateId === candidate.templateId && o.requirements[1]?.type === candidate.requirements[1]?.type)) continue;
      chosen = candidate; break;
    }
    chosen ??= instantiateOffer(content, state, content.expeditions.fallbackTemplate, rng, state.dayNumber, position);
    if (chosen.duration === 2) longCount++;
    offers.push(chosen);
  }
  // Replace hard offers until the configured minimum is met where possible.
  let feasible = offers.filter(o => offerFeasibility(content, state, o).feasible).length;
  for (let i = offers.length - 1; i >= 0 && feasible < settings.minimumFeasible; i--) {
    if (offers[i].id === pinned?.id || offers[i].offerKind === 'supply' || offerFeasibility(content, state, offers[i]).feasible) continue;
    const replacement = instantiateOffer(content, state, content.expeditions.fallbackTemplate, rng, state.dayNumber, i);
    offers[i] = replacement;
    if (offerFeasibility(content, state, replacement).feasible) feasible++;
  }
  state.expeditions.board = { day: state.dayNumber, seed, offers };
  return state.expeditions.board;
}

export function launchExpedition(content, state, offerId, ids) {
  const offer = state.expeditions.board.offers.find(o => o.id === offerId);
  const reasons = [];
  if (!offer) reasons.push('That offer is no longer available.');
  if (state.expeditions.active.length >= content.expeditions.settings.slotCount) reasons.push('All Expedition slots are occupied.');
  const busy = expeditionCharacterIds(state);
  for (const id of ids) {
    if (!state.characters[id]?.owned) reasons.push('Every Expedition member must be owned.');
    if (busy.has(id)) reasons.push(`${content.characterById[id]?.displayName ?? id} is already on an Expedition.`);
  }
  const preview = offer ? previewExpedition(content, state, offer, ids) : null;
  if (preview && !preview.valid) reasons.push('The selected party does not satisfy every mandatory requirement.');
  const promisedSupplies = (offer?.fixedRewards ?? []).filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID)
    .reduce((sum, entry) => sum + entry.qty, 0);
  if (promisedSupplies > fieldSupplyLimits(content, state).unreservedCapacity) {
    reasons.push('Held and promised Field Supplies already fill the available storage. Cancel a launch-day Supply Expedition or use a Supply first.');
  }
  if (reasons.length) return { ok: false, reasons };
  const modifiers = offer.world ? hqExpeditionModifiers(content, state, offer.world) : { renownBp: 0, worldAssetBp: 0, rareChanceBp: 0 };
  const crisisRenown = offer.world ? activeCrisisBoon(state, 'world_expedition_renown_bp', offer.world) : null;
  if (crisisRenown) modifiers.renownBp += crisisRenown.bonusBp ?? 0;
  const rewards = scaledRewards(offer.baseRewards, preview.multiplierBp, modifiers);
  const rareChance = Math.min(10000, (offer.rareReward?.chanceBp ?? 0) + (modifiers.rareChanceBp ?? 0));
  if (preview.tier === 'exceptional' && offer.rareReward && offer.rareRoll < rareChance) {
    rewards.push({ ...offer.rareReward, qty: offer.rareReward.qty ?? 1 });
  }
  const active = {
    id: `exp_${offer.id}`, offerId: offer.id, templateId: offer.templateId,
    name: offer.name, description: offer.description, world: offer.world,
    launchDay: state.dayNumber, returnDay: state.dayNumber + offer.duration,
    duration: offer.duration, party: [...ids], snapshot: preview.party,
    tier: preview.tier, optionalMet: preview.optional.met, rewards,
    fixedRewards: structuredClone(offer.fixedRewards ?? []), offerKind: offer.offerKind ?? 'standard',
    rareReward: offer.rareReward, rareRevealed: offer.rareRevealed,
    sourceOffer: structuredClone(offer)
  };
  state.expeditions.active.push(active);
  state.expeditions.board.offers = state.expeditions.board.offers.filter(o => o.id !== offerId);
  return { ok: true, active };
}

export function cancelExpedition(state, expeditionId) {
  const index = state.expeditions.active.findIndex(e => e.id === expeditionId);
  if (index < 0) return { ok: false, reasons: ['Unknown Expedition.'] };
  if (state.expeditions.active[index].launchDay !== state.dayNumber) {
    return { ok: false, reasons: ['An Expedition cannot be cancelled after its launch day has advanced.'] };
  }
  const [active] = state.expeditions.active.splice(index, 1);
  if (active.sourceOffer && state.expeditions.board?.day === state.dayNumber) {
    state.expeditions.board.offers.push(active.sourceOffer);
  }
  return { ok: true, active };
}

export function rerollOffer(content, state, offerId, rng) {
  const index = state.expeditions.board.offers.findIndex(o => o.id === offerId);
  const offer = state.expeditions.board.offers[index];
  if (!offer || offer.pinned || offer.offerKind === 'supply') return { ok: false, reasons: [offer?.offerKind === 'supply'
    ? 'The guaranteed Field Supply route cannot be rerolled.' : 'Only an unpinned available offer can be rerolled.'] };
  const free = state.expeditions.daily.freeRerollsUsed < state.expeditions.daily.freeRerolls;
  if (!free && !addResource(state, INTELLIGENCE_ID, -content.expeditions.settings.intelligenceCosts.reroll)) {
    return { ok: false, reasons: ['Not enough Intelligence.'] };
  }
  const pool = content.expeditions.templates.filter(template => template.enabled !== false
    && template.id !== content.expeditions.settings.guaranteedSupplyTemplateId);
  if (!pool.length) return { ok: false, reasons: ['No other enabled Expedition template can replace this offer.'] };
  const replacement = instantiateOffer(content, state, pick(rng, pool), rng, state.dayNumber, index);
  state.expeditions.board.offers[index] = replacement;
  if (free) state.expeditions.daily.freeRerollsUsed++;
  return { ok: true, offer: replacement, free };
}

export function togglePinOffer(content, state, offerId) {
  const offer = state.expeditions.board.offers.find(o => o.id === offerId);
  if (!offer) return { ok: false, reasons: ['Unknown offer.'] };
  if (offer.pinned) { offer.pinned = false; return { ok: true, pinned: false }; }
  if (state.expeditions.board.offers.some(o => o.pinned)) return { ok: false, reasons: ['Only one offer may be pinned.'] };
  const free = state.expeditions.daily.freePinsUsed < state.expeditions.daily.freePins;
  if (!free && !addResource(state, INTELLIGENCE_ID, -content.expeditions.settings.intelligenceCosts.pin)) {
    return { ok: false, reasons: ['Not enough Intelligence.'] };
  }
  offer.pinned = true;
  if (free) state.expeditions.daily.freePinsUsed++;
  return { ok: true, pinned: true, free };
}

export function revealRareReward(content, state, offerId) {
  const offer = state.expeditions.board.offers.find(o => o.id === offerId);
  if (!offer || !offer.rareReward) return { ok: false, reasons: ['This offer has no rare reward to reveal.'] };
  if (offer.rareRevealed) return { ok: true };
  if (!addResource(state, INTELLIGENCE_ID, -content.expeditions.settings.intelligenceCosts.reveal)) {
    return { ok: false, reasons: ['Not enough Intelligence.'] };
  }
  offer.rareRevealed = true;
  return { ok: true };
}

export function resolveDueExpeditions(content, state) {
  const returned = [], remaining = [];
  for (const active of state.expeditions.active) {
    if (active.returnDay > state.dayNumber) { remaining.push(active); continue; }
    const rewards = grantRewardEntries(content, state, [...(active.fixedRewards ?? []), ...(active.rewards ?? [])], active.world);
    const pool = content.expeditions.reports[active.tier] ?? ['The party returned with the promised rewards.'];
    const report = { ...active, report: pool[(active.offerId.length + active.returnDay) % pool.length], rewards, acknowledged: false };
    state.expeditions.reports.unshift(report);
    returned.push(report);
  }
  state.expeditions.active = remaining;
  state.expeditions.reports = state.expeditions.reports.slice(0, 30);
  return returned;
}
