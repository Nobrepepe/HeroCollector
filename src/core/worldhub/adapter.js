// Package-to-manifest adapter: turns a validated World Hub package into a
// Creative Manifest — the facts a publication states, and nothing it decides.
//
// Mechanical fields the contract still carries are deliberately *not* read
// here. Thresholds, material families and grades, encounter placement, display
// order, acquisition tiers and the starting flag are all compiled from
// content/balance.json now, so a publication cannot move them by accident.
// The contract sheds those fields in its next revision; dropping them here
// first means the change is already proven before the authoring screen loses
// them.
import { MANIFEST_VERSION } from '../manifest.js';

const SLOT_ORDER = ['attire', 'tool', 'accessory', 'keepsake', 'emblem', 'signature'];

/**
 * @param pkg      a validated package from the World Hub kit's reader
 * @param mediaUrl (assetId, preferredRecipes) -> displayable URL or null
 *
 * Recipe names come from the contract embedded in the package, never from
 * this file: World Hub renames them, and it has done so once already.
 */
export function adaptPackageToManifest(pkg, mediaUrl) {
  const { content } = pkg;
  /* The kit hands back a Map keyed by id, not a plain object. Reading it the
     wrong way resolves every record to `{}` and the defaults below turn that
     into a package that adapts "successfully" into nothing at all. */
  const entitiesById = pkg.entitiesById();
  const values = content.values ?? {};
  const selections = content.selections ?? {};
  const entityValues = content.entityValues ?? {};
  const assetSets = content.assetSets ?? {};
  const worldProfiles = Object.fromEntries(pkg.worlds.map((world) => [world.id, world]));
  const characterProfiles = Object.fromEntries(pkg.characters.map((character) => [character.id, character]));

  const setAsset = (slot, entityId) => {
    const items = assetSets[`${slot}:${entityId}`] ?? [];
    return items.length ? items[0].assetId : null;
  };
  const setAssets = (slot, entityId) => (assetSets[`${slot}:${entityId}`] ?? []).map((item) => item.assetId);

  /* ---- faction membership: canonical, not a value typed into a production ----
     Who belongs to a faction is a fact about the fiction, so it lives in World
     Hub as a connection between a character and a group. It used to be stored
     twice: once as that group being selected under Factions, and again as a
     per-character reference — two places that could disagree, and did.

     The kind to read is named by the contract rather than by this file, so a
     rename over there needs no change over here. The one-faction rule is the
     game's and stays the game's: canon allows several memberships, and the
     first that names a selected faction wins. */
  const factionIds = new Set(selections.hc_factions ?? []);
  const membershipKinds = (pkg.contract.connectionSelections ?? [])
    .filter((selection) => selection.targetSelection === 'hc_factions')
    .flatMap((selection) => selection.kinds ?? []);
  const factionOf = (characterId) => {
    for (const kindId of membershipKinds) {
      const held = pkg.connectionsFrom(characterId, kindId).find((connection) => factionIds.has(connection.targetId));
      if (held) return held.targetId;
    }
    return null;
  };

  /* ---- characters: selection order is roster order ---- */
  const characterIds = selections.hc_characters ?? [];
  const characters = characterIds.map((hubId) => {
    const entity = entitiesById.get(hubId) ?? {};
    const profile = characterProfiles[hubId] ?? {};
    const own = entityValues[hubId] ?? {};
    const equipment = {};
    for (const slot of SLOT_ORDER) {
      const authored = (own.hc_equipment ?? []).find((line) => line.equip_slot === slot);
      equipment[slot] = {
        name: authored?.equip_name || `${entity.name ?? 'Hero'}’s ${slot}`,
        image: authored?.equip_art ? mediaUrl(authored.equip_art, pkg.recipesFor('equip_art')) : null,
      };
    }
    return {
      id: hubId,
      worldId: entity.worldId,
      displayName: entity.name ?? 'Unknown',
      description: entity.summary ?? '',
      lore: profile.biography ?? '',
      archetype: own.hc_archetype,
      faction: factionOf(hubId),
      portrait: mediaUrl(setAsset('hc_portrait', hubId), pkg.recipesFor('hc_portrait')),
      fullBody: mediaUrl(setAsset('hc_full_body', hubId), pkg.recipesFor('hc_full_body')),
      equipment,
    };
  });

  /* ---- worlds: selection order is progression order ---- */
  const worlds = (selections.hc_worlds ?? []).map((hubId) => {
    const entity = entitiesById.get(hubId) ?? {};
    const profile = worldProfiles[hubId] ?? {};
    const own = entityValues[hubId] ?? {};
    const chapterImages = setAssets('hc_chapter_art', hubId)
      .map((assetId) => mediaUrl(assetId, pkg.recipesFor('hc_chapter_art')));
    while (chapterImages.length < 3) chapterImages.push(null);

    /* Authored order is the whole of it: the game decides which Mastery
       milestone each position pays out at, and generates the skin ids. */
    const masteryCosmetics = (own.hc_mastery_cosmetics ?? []).map((entry) => ({
      characterId: entry.mc_character,
      name: entry.mc_name,
      portrait: entry.mc_art ? mediaUrl(entry.mc_art, pkg.recipesFor('mc_art')) : null,
      fullBody: null,
    }));

    return {
      id: hubId,
      displayName: entity.name ?? 'Unknown world',
      tagline: profile.tagline ?? '',
      description: entity.summary ?? '',
      icon: own.hc_world_icon || '🌍',
      palette: {
        primary: own.hc_palette_primary || '#5a7a9e',
        accent: own.hc_palette_accent || '#9ec3e8',
        dark: own.hc_palette_dark || '#1c2733',
      },
      image: mediaUrl(setAsset('hc_world_cover', hubId), pkg.recipesFor('hc_world_cover')),
      chapterTitles: own.hc_chapter_titles
        ?? [1, 2, 3].map((n) => `${entity.name} · Chapter ${n}`),
      chapterImages: chapterImages.slice(0, 3),
      nodeNames: [...(own.hc_campaign_nodes ?? [])],
      relic: {
        name: own.hc_relic_name || `The ${entity.name ?? 'World'} Relic`,
        lore: own.hc_relic_lore || '',
        // One plate for the whole object; the Mastery track shows a quarter of
        // it per recovered piece, so the pieces carry names and lore only.
        image: mediaUrl(setAsset('hc_relic_art', hubId), pkg.recipesFor('hc_relic_art')),
        pieces: (own.hc_relic_pieces ?? []).map((piece) => ({
          name: piece.piece_name,
          lore: piece.piece_lore || '',
        })),
      },
      masteryCosmetics,
    };
  });

  /* ---- Main Campaign: chapter titles and node names ---- */
  const mainChapters = (values.hc_main_chapters ?? []).map((chapter, index) => ({
    title: chapter.chapter_title || `Chapter ${index + 1}`,
    image: chapter.chapter_art ? mediaUrl(chapter.chapter_art, pkg.recipesFor('chapter_art')) : null,
    nodeNames: [...(chapter.chapter_nodes ?? [])],
  }));

  /* ---- factions: canonical groups, identity only ----
     Name and description come from the group's own profile, so a faction can
     no longer be a free-typed id that a character reference fails to match. */
  const factions = (selections.hc_factions ?? []).map((hubId) => {
    const entity = entitiesById.get(hubId) ?? {};
    const own = entityValues[hubId] ?? {};
    const displayName = entity.name ?? 'Faction';
    return {
      id: hubId,
      displayName,
      explanation: own.hc_faction_explanation || entity.summary || `${displayName} members work well together.`,
    };
  });

  /* ---- expedition board art ----
     The routes are the game's; only the picture is a publication's. */
  const productionSets = assetSets.hc_expedition_art ?? [];
  const expeditionArt = {
    global: productionSets.length
      ? mediaUrl(productionSets[0].assetId, pkg.recipesFor('hc_expedition_art')) : null,
    worlds: {},
  };

  return {
    manifestVersion: MANIFEST_VERSION,
    // Stable across revisions of the same production, so republishing never
    // resets shared-campaign progress — only switching productions does.
    lineage: `production:${pkg.manifest.production.id}`,
    worlds,
    characters,
    factions,
    mainChapters,
    expeditionArt,
  };
}
