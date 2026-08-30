// Crisis generation. One Crisis template per world, built from the game's own
// Front templates; a publication contributes the world, its name and its
// artwork, and nothing else.
//
// Favoured tags are resolved from the world's actual roster, so a Front never
// rewards an archetype or faction nobody in that world belongs to — the way an
// authored favoured tag could, silently, forever.

const fill = (text, world, front) => text
  .replaceAll('{world}', world.displayName)
  .replaceAll('{front}', front?.name ?? '');

/**
 * The tags a Front rewards, drawn from what this world's roster actually has.
 * `rotation` keeps successive Fronts of the same world asking for different
 * things instead of all naming the most common archetype.
 */
function resolveFavored(kinds, world, roster, rotation) {
  const archetypes = [...new Set(roster.map(c => c.archetype).filter(Boolean))];
  const factions = [...new Set(roster.map(c => c.faction).filter(Boolean))];
  const out = [];
  let step = rotation;
  for (const kind of kinds) {
    let tag = null;
    if (kind === 'world') tag = world.id;
    else if (kind === 'archetype') tag = archetypes[step % archetypes.length] ?? null;
    else if (kind === 'faction') {
      // A world with no factions falls back to an archetype rather than
      // carrying a Front whose bonus can never be earned.
      tag = factions.length ? factions[step % factions.length] : archetypes[step % archetypes.length] ?? null;
    }
    if (tag && !out.includes(tag)) out.push(tag);
    step += 1;
  }
  return out;
}

export function compileCrises(library, worlds, rosterByWorld) {
  const definitions = worlds.map((world, worldIndex) => {
    const roster = rosterByWorld.get(world.id) ?? [];
    const fronts = library.fronts.map((template, index) => {
      const front = { name: fill(template.name, world) };
      return {
        id: `front_${world.id}_${template.id}`,
        name: front.name,
        description: fill(template.description, world),
        favoredTagIds: resolveFavored(template.favored, world, roster, worldIndex + index),
        struggleText: fill(library.texts.struggle, world, front),
        successText: fill(library.texts.success, world, front),
        excelText: fill(library.texts.excel, world, front)
      };
    });

    return {
      id: `crisis_${world.id}`,
      enabled: true,
      worldId: world.id,
      name: fill(library.naming.name, world),
      openingDescription: fill(library.naming.opening, world),
      // The world's own cover carries the Crisis; there is no separate art.
      artwork: world.image ?? null,
      weight: 1,
      minimumClearedNodes: library.settings.minimumClearedNodes ?? 0,
      fronts,
      consolationReward: structuredClone(library.consolation),
      // A cache names a material family; its grade is resolved at spawn from
      // the best grade this world has opened.
      cacheChoices: library.caches.map(cache => ({
        id: `cache_${world.id}_${cache.id}`,
        name: cache.name,
        description: cache.description,
        rewards: structuredClone(cache.rewards)
      })),
      boon: structuredClone(library.boons[worldIndex % library.boons.length])
    };
  });

  return { settings: structuredClone(library.settings), definitions };
}
