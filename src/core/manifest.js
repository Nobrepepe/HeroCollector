// The Creative Manifest: everything a publication says, and nothing it decides.
//
// World Hub owns identity and fiction — which worlds, which characters, in
// what order, and what they are called. Every mechanical consequence of those
// facts is the game's: thresholds, material families and grades, node rewards,
// relic and reveal positions, acquisition, Mastery ranks, the Expedition routes
// and the Crisis Fronts all come from content/. A manifest that renames a node
// can never move its Power, and it carries no mechanical library at all.
//
// This module only normalizes shape. There is no version ladder: a manifest is
// what an adapter or a bundled pack hands over, and the compiler in
// ./compile/ turns it into runtime content.
export const MANIFEST_VERSION = 1;

export function emptyManifest() {
  return {
    manifestVersion: MANIFEST_VERSION,
    lineage: null,
    worlds: [],
    characters: [],
    factions: [],
    mainChapters: [],
    expeditionArt: { global: null, worlds: {} }
  };
}

const str = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const list = (value) => (Array.isArray(value) ? value : []);

function normalizeWorld(world, index) {
  const displayName = str(world.displayName, `World ${index + 1}`);
  return {
    id: world.id,
    displayName,
    tagline: str(world.tagline),
    description: str(world.description),
    icon: str(world.icon, '🌍'),
    palette: {
      primary: str(world.palette?.primary, '#5a7a9e'),
      accent: str(world.palette?.accent, '#9ec3e8'),
      dark: str(world.palette?.dark, '#1c2733')
    },
    image: world.image ?? null,
    chapterTitles: Array.from({ length: 3 }, (_, i) =>
      str(world.chapterTitles?.[i], `${displayName} · Chapter ${i + 1}`)),
    chapterImages: Array.from({ length: 3 }, (_, i) => world.chapterImages?.[i] ?? null),
    // Names only — how many there must be is the compiler's rule, not a
    // property of the manifest, so a short list is reported rather than padded.
    nodeNames: list(world.nodeNames).map((name, i) => str(name, `Node ${i + 1}`)),
    relic: {
      name: str(world.relic?.name, `The ${displayName} Relic`),
      lore: str(world.relic?.lore),
      pieces: list(world.relic?.pieces).map((piece, i) => ({
        name: str(piece?.name, `Piece ${['I', 'II', 'III', 'IV'][i] ?? i + 1}`),
        lore: str(piece?.lore),
        image: piece?.image ?? null
      }))
    },
    // Ordered: the first cosmetic goes to the first Mastery cosmetic rank, the
    // second to the next. The rank ladder is the game's.
    masteryCosmetics: list(world.masteryCosmetics).map((entry) => ({
      characterId: entry.characterId,
      name: str(entry.name, 'Alternate look'),
      portrait: entry.portrait ?? null,
      fullBody: entry.fullBody ?? null
    }))
  };
}

function normalizeCharacter(character, slotOrder) {
  const displayName = str(character.displayName, 'Unknown');
  const equipment = {};
  for (const slot of slotOrder) {
    equipment[slot] = {
      name: str(character.equipment?.[slot]?.name, `${displayName}’s ${slot}`),
      image: character.equipment?.[slot]?.image ?? null
    };
  }
  return {
    id: character.id,
    worldId: character.worldId,
    displayName,
    description: str(character.description),
    lore: str(character.lore),
    archetype: character.archetype,
    faction: character.faction || null,
    portrait: character.portrait ?? null,
    fullBody: character.fullBody ?? null,
    equipment
  };
}

/** Shape-normalize a manifest. Order is meaning: worlds are in progression
 *  order and characters in roster order, and the compiler reads both. */
export function normalizeManifest(raw, slotOrder) {
  if (!raw || typeof raw !== 'object') return emptyManifest();
  return {
    manifestVersion: MANIFEST_VERSION,
    lineage: raw.lineage ?? null,
    worlds: list(raw.worlds).map(normalizeWorld),
    characters: list(raw.characters).map((character) => normalizeCharacter(character, slotOrder)),
    factions: list(raw.factions).map((faction) => ({
      id: faction.id,
      displayName: str(faction.displayName, faction.id),
      explanation: str(faction.explanation, `${faction.displayName ?? faction.id} members work well together.`)
    })),
    mainChapters: list(raw.mainChapters).map((chapter, index) => ({
      title: str(chapter.title, `Chapter ${index + 1}`),
      image: chapter.image ?? null,
      nodeNames: list(chapter.nodeNames).map((name, i) => str(name, `Node ${i + 1}`))
    })),
    // Board artwork is legitimate World Hub content; the routes themselves are
    // generated from the game's own archetype library.
    expeditionArt: {
      global: raw.expeditionArt?.global ?? null,
      worlds: { ...(raw.expeditionArt?.worlds ?? {}) }
    }
  };
}

// ---------------------------------------------------------------- readiness
// The game stays in setup mode until the compiled content meets the minimum
// prerequisites for a playable new save.
export function gameReadiness(content) {
  const mainLen = (content.nodesByCampaign?.main ?? []).length;
  const starterCount = content.balance.rosterProgression.starterCount;
  const checks = [
    { ok: content.worlds.length >= 1, text: `At least one world in the game (currently ${content.worlds.length}).` },
    { ok: content.characters.length >= starterCount, text: `At least ${starterCount} characters to draw a starting party from (currently ${content.characters.length}).` },
    { ok: mainLen >= 10, text: `At least one live Main Campaign chapter (currently ${mainLen} nodes).` }
  ];
  return { ready: checks.every(c => c.ok), checks };
}
