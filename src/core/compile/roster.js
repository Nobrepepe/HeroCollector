// Where every hero enters the game.
//
// World Hub decides the meaningful order of the cast — which world comes
// first, and who within it. This file turns that order into positions, and the
// positions are the game's: a hero moved earlier in a production is revealed
// earlier, but nothing about what a reveal costs or grants changes.
//
// The load-bearing constraint is that a World Campaign is locked until five of
// that world's heroes are owned. A world can therefore never introduce its own
// first party — the Main Campaign has to, which is what makes it the opening
// track rather than a second, parallel one.

/** Spread `count` positions evenly through `span` nodes, 1-based and distinct. */
export function spreadPositions(count, span) {
  return Array.from({ length: count }, (_, i) => Math.round(((i + 1) * span) / (count + 1)));
}

/**
 * @param worlds      manifest worlds, in progression order
 * @param charactersByWorld  roster order within each world
 * @param mainNodeCount      how many Main Campaign nodes exist
 * @returns { mainReveals, worldReveals, report, shortfall }
 *   mainReveals   Map<mainNodeNumber, characterId>
 *   worldReveals  Map<worldId, Map<nodeNumber, characterId>>
 *   report        one readable line per hero, for the dev panel and tests
 *   shortfall     worlds whose opening party the Main Campaign cannot introduce
 */
export function planReveals(balance, worlds, charactersByWorld, mainNodeCount) {
  const openingSize = balance.partySize;
  const worldNodes = balance.campaigns.world.nodes;

  const mainReveals = new Map();
  const worldReveals = new Map();
  const report = [];
  const shortfall = [];

  // Opening reveals fill the Main Campaign from its first node, world by
  // world: world one's party opens first, and each world becomes playable a
  // fixed distance further along.
  let mainNumber = 1;
  for (const world of worlds) {
    const roster = charactersByWorld.get(world.id) ?? [];
    const opening = roster.slice(0, openingSize);
    if (mainNumber + opening.length - 1 > mainNodeCount) {
      shortfall.push(world);
      continue;
    }
    for (const characterId of opening) {
      mainReveals.set(mainNumber, characterId);
      report.push({ characterId, worldId: world.id, campaign: 'main', node: mainNumber });
      mainNumber += 1;
    }
  }

  // The rest of a world's roster is revealed along its own campaign, evenly
  // spread so discovery keeps pace with the campaign instead of front-loading.
  for (const world of worlds) {
    const roster = charactersByWorld.get(world.id) ?? [];
    const rest = roster.slice(openingSize);
    const positions = spreadPositions(rest.length, worldNodes);
    const map = new Map();
    rest.forEach((characterId, index) => {
      map.set(positions[index], characterId);
      report.push({ characterId, worldId: world.id, campaign: `wc_${world.id}`, node: positions[index] });
    });
    worldReveals.set(world.id, map);
  }

  return { mainReveals, worldReveals, report, shortfall };
}

/** "Nao is revealed at Hidden Village node 12" — the mapping made visible. */
export function describeReveals(content, report) {
  return report.map((entry) => {
    const name = content.characterById?.[entry.characterId]?.displayName ?? entry.characterId;
    const campaign = entry.campaign === 'main'
      ? 'Main Campaign'
      : content.worldById?.[entry.worldId]?.displayName ?? entry.worldId;
    return `${name} is revealed at ${campaign} node ${entry.node}.`;
  });
}
