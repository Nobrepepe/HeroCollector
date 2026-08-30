// Expedition generation. The route library is the game's; a publication
// contributes only the worlds the routes are about, and (optionally) the board
// artwork.
//
// A world-scoped archetype becomes one template per live world, with the
// world's name written into its titles. Requirements, optional objectives and
// reward packages are deduplicated by their own content, so two archetypes
// asking the same thing share one definition and one generated ID.
import { requirementProse } from '../expeditions.js';

/** A predicate's identity is its content, so equal predicates collapse. */
function predicateId(prefix, predicate) {
  const parts = [prefix, predicate.type];
  if (predicate.world) parts.push(predicate.world);
  if (predicate.archetype) parts.push(predicate.archetype);
  if (predicate.stars) parts.push(`s${predicate.stars}`);
  if (predicate.percentBp) parts.push(`p${predicate.percentBp}`);
  if (predicate.count !== undefined) parts.push(String(predicate.count));
  return parts.join('_');
}

const fill = (text, world) => text.replaceAll('{world}', world?.displayName ?? '');

export function compileExpeditions(library, worlds, { images = { global: null, worlds: {} } } = {}) {
  const requirementById = new Map();
  const optionalById = new Map();
  const rewardById = new Map();
  const templates = [];

  const define = (map, prefix, predicate, world) => {
    // `@associated` never survives compilation: a world-scoped route knows
    // its own world, so the requirement names it outright and can no longer
    // land on an across-world route where it would be unsatisfiable.
    const resolved = { ...predicate };
    if (resolved.type === 'world_count' || resolved.type === 'same_world_of') {
      if (world) resolved.world = world.id;
      else return null;
    }
    const id = predicateId(prefix, resolved);
    if (!map.has(id)) map.set(id, { id, ...resolved, text: requirementProse(resolved, { worlds }) });
    return id;
  };

  const worldScale = Math.max(1, worlds.length);
  const addTemplate = (archetype, world) => {
    const suffix = world ? `_${world.id}` : '';
    const requirementIds = archetype.requirements
      .map(predicate => define(requirementById, 'req', predicate, world))
      .filter(Boolean);
    const optionalIds = archetype.optionals
      .map(predicate => define(optionalById, 'opt', predicate, world))
      .filter(Boolean);
    if (!optionalIds.length) return; // a route with no possible bonus is not a route

    const rewardId = `pkg_${archetype.id}${archetype.reward.shardPool ? '_lead' : ''}`;
    if (!rewardById.has(rewardId)) {
      rewardById.set(rewardId, {
        id: rewardId,
        displayName: archetype.id.replaceAll('_', ' '),
        entries: structuredClone(archetype.reward.entries),
        rare: structuredClone(archetype.reward.rare ?? []),
        ...(archetype.reward.shardPool
          ? { shardPool: archetype.reward.shardPool, shardRange: [...archetype.reward.shardRange] }
          : {})
      });
    }

    templates.push({
      id: `exp_${archetype.id}${suffix}`,
      enabled: true,
      world: world?.id ?? null,
      // A world-scoped archetype becomes one template per world, so its
      // declared weight would be multiplied by the world count and crowd the
      // global routes off the board as a library grows. Scaling the global
      // ones instead keeps the intended mix stable at any number of worlds.
      weight: archetype.scope === 'world' ? archetype.weight : archetype.weight * worldScale,
      partySize: archetype.partySize,
      requirementIds,
      requirementCount: Math.min(archetype.requirementCount, requirementIds.length),
      optionalIds,
      rewardPackageId: rewardId,
      powerRatioBp: [...archetype.powerRatioBp],
      titles: archetype.titles.map(title => fill(title, world)),
      descriptions: archetype.descriptions.map(text => fill(text, world)),
      ...(archetype.supply
        ? { supply: true, fixedRewards: [{ kind: 'resource', id: 'field_supply', qty: 1 }] }
        : {})
    });
  };

  for (const archetype of library.archetypes) {
    if (archetype.scope === 'world') for (const world of worlds) addTemplate(archetype, world);
    else addTemplate(archetype, null);
  }

  // The fallback keeps a board full when no weighted template fits: the
  // smallest non-supply route, which is the easiest to staff.
  const fallback = [...templates]
    .filter(template => !template.supply)
    .sort((a, b) => a.partySize - b.partySize || a.requirementCount - b.requirementCount)[0] ?? null;

  return {
    settings: structuredClone(library.settings),
    images: { global: images.global ?? null, worlds: { ...(images.worlds ?? {}) } },
    requirements: [...requirementById.values()],
    optionalObjectives: [...optionalById.values()],
    rewardPackages: [...rewardById.values()],
    templates,
    reports: structuredClone(library.reports),
    fallbackTemplate: fallback
  };
}
