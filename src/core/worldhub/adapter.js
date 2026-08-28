// Package-to-runtime adapter: turns a validated World Hub package into
// the content-pack database shape the existing pipeline consumes
// (mergeContent -> buildContent -> validateContent). Nothing here
// bypasses the game's own semantic validation.
import { CUSTOM_DB_VERSION } from '../custom.js';

const DEFAULT_PALETTE = { primary: '#5a7a9e', accent: '#9ec3e8', dark: '#1c2733' };
const SLOT_ORDER = ['attire', 'tool', 'accessory', 'keepsake', 'emblem', 'signature'];

function rewardEntry(kind, id, amount, { range = false } = {}) {
  const mapped = kind === 'energy'
    ? { kind: 'resource', id: 'field_supply' }
    : { kind, id: id || undefined };
  return range
    ? { ...mapped, min: amount, max: amount }
    : { ...mapped, qty: amount };
}

function entriesFrom(list, prefix, { range = false } = {}) {
  return (list ?? []).map((entry) => rewardEntry(
    entry[`${prefix}_kind`], entry[`${prefix}_id`], entry[`${prefix}_amount`], { range }));
}

/**
 * @param pkg      a validated package from package-reader
 * @param mediaUrl (assetId, preferredRecipes) -> displayable URL or null
 */
export function adaptPackageToCustomDb(pkg, mediaUrl) {
  const { content, entitiesById } = pkg;
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

  /* ---- characters ---- */
  const characters = (selections.hc_characters ?? []).map((hubId) => {
    const entity = entitiesById[hubId] ?? {};
    const profile = characterProfiles[hubId] ?? {};
    const own = entityValues[hubId] ?? {};
    const equipment = {};
    for (const slot of SLOT_ORDER) {
      const authored = (own.hc_equipment ?? []).find((line) => line.equip_slot === slot);
      equipment[slot] = {
        name: authored?.equip_name || `${entity.name ?? 'Hero'}’s ${slot}`,
        image: authored?.equip_art ? mediaUrl(authored.equip_art, ['square']) : null,
      };
    }
    return {
      id: hubId,
      worldId: entity.worldId,
      displayName: entity.name ?? 'Unknown',
      glyph: own.hc_glyph || (entity.name ?? 'H')[0].toUpperCase(),
      color: own.hc_color || '#7a8aa0',
      archetype: own.hc_archetype,
      tier: own.hc_tier,
      starting: own.hc_starting === true,
      faction: own.hc_faction || null,
      extraTags: own.hc_extra_tags ?? [],
      description: entity.summary ?? '',
      lore: profile.biography ?? '',
      portrait: mediaUrl(setAsset('hc_portrait', hubId), ['square', 'thumbnail_square']),
      fullBody: mediaUrl(setAsset('hc_full_body', hubId), ['full_body_9x16']),
      equipment,
      skins: (own.hc_skins ?? []).map((skin) => ({
        id: skin.skin_id,
        name: skin.skin_name,
        portrait: skin.skin_art ? mediaUrl(skin.skin_art, ['full_body_9x16', 'square']) : null,
        fullBody: null,
      })),
    };
  });

  /* ---- worlds ---- */
  const worlds = (selections.hc_worlds ?? []).map((hubId) => {
    const entity = entitiesById[hubId] ?? {};
    const profile = worldProfiles[hubId] ?? {};
    const own = entityValues[hubId] ?? {};
    const chapterArt = setAssets('hc_chapter_art', hubId).map((assetId) => mediaUrl(assetId, ['tile_16x9']));
    while (chapterArt.length < 3) chapterArt.push(null);

    return {
      id: hubId,
      status: 'published',
      displayName: entity.name ?? 'Unknown world',
      tagline: profile.tagline ?? '',
      icon: own.hc_world_icon || '🌍',
      palette: {
        primary: own.hc_palette_primary || DEFAULT_PALETTE.primary,
        accent: own.hc_palette_accent || DEFAULT_PALETTE.accent,
        dark: own.hc_palette_dark || DEFAULT_PALETTE.dark,
      },
      image: mediaUrl(setAsset('hc_world_cover', hubId), ['tile_16x9']),
      campaignChapterImages: chapterArt.slice(0, 3),
      campaignChapterTitles: own.hc_chapter_titles
        ?? [1, 2, 3].map((n) => `${entity.name} · Chapter ${n}`),
      campaignNodes: (own.hc_campaign_nodes ?? []).map((node) => ({
        name: node.node_name,
        threshold: node.node_threshold,
        family: node.node_family,
        grade: node.node_grade,
        encounterCharacterId: node.node_encounter_character || null,
      })),
      description: entity.summary ?? '',
      displayOrder: own.hc_world_display_order ?? 0,
      relic: {
        name: own.hc_relic_name || `The ${entity.name ?? 'World'} Relic`,
        lore: own.hc_relic_lore || '',
        image: null,
        pieces: (own.hc_relic_pieces ?? []).map((piece) => ({
          name: piece.piece_name,
          lore: piece.piece_lore || '',
          image: piece.piece_art ? mediaUrl(piece.piece_art, ['square']) : null,
        })),
      },
      masterySkins: (own.hc_mastery_skins ?? []).map((entry) => ({
        rank: entry.ms_rank,
        characterId: entry.ms_character,
        skinId: entry.ms_skin_id,
      })),
    };
  });

  /* ---- campaigns ---- */
  const mainChapters = (values.hc_main_chapters ?? []).map((chapter) => ({
    status: 'published',
    title: chapter.chapter_title || '',
    image: null,
    nodes: (chapter.chapter_nodes ?? []).map((node) => ({
      name: node.mnode_name,
      threshold: node.mnode_threshold,
      family: node.mnode_family,
      grade: node.mnode_grade,
      encounterCharacterId: node.mnode_encounter_character || null,
    })),
  }));

  /* ---- factions ---- */
  const factions = (values.hc_factions ?? []).map((faction) => ({
    id: faction.faction_id,
    displayName: faction.faction_name,
    explanation: faction.faction_explanation || `${faction.faction_name} members work well together.`,
    thresholds: [
      { count: 2, bonusBp: faction.faction_bonus_2_bp ?? 200 },
      { count: 3, bonusBp: faction.faction_bonus_3_bp ?? 400 },
    ],
  }));

  /* ---- expeditions ---- */
  const productionSets = assetSets.hc_expedition_art ?? [];
  const guaranteedSupplyTemplateId = (values.hc_expedition_templates ?? [])
    .find((template) => template.exptpl_supply === true)?.exptpl_id ?? null;
  const expeditions = {
    settings: {
      offerCount: 5, slotCount: 3, freeRerolls: 1, freePins: 1, minimumFeasible: 2,
      generationAttempts: 40, cycleLengthDays: 4, cycleScaleBp: 40000,
      guaranteedSupplyTemplateId,
      intelligenceCosts: { reroll: 1, pin: 1, reveal: 1 },
      resultMultipliersBp: { completed: 10000, successful: 12500, exceptional: 15000 },
    },
    images: {
      global: productionSets.length ? mediaUrl(productionSets[0].assetId, ['tile_16x9']) : null,
      worlds: {},
    },
    requirements: (values.hc_expedition_requirements ?? []).map((req) => ({
      id: req.expreq_id, type: req.expreq_type, world: req.expreq_world || undefined,
      count: req.expreq_count ?? 1, text: req.expreq_text,
    })),
    optionalObjectives: (values.hc_expedition_objectives ?? []).map((objective) => ({
      id: objective.expobj_id, type: objective.expobj_type,
      count: objective.expobj_count ?? 1, text: objective.expobj_text,
    })),
    rewardPackages: (values.hc_expedition_rewards ?? []).map((reward) => ({
      id: reward.expreward_id, displayName: reward.expreward_name,
      rare: reward.expreward_rare === true,
      entries: entriesFrom(reward.expreward_entries, 'rentry', { range: true }),
      // A lead range makes routes with this package character leads: the
      // player chooses a revealed hero of the route's world at launch.
      ...(reward.expreward_lead_max
        ? { shardPool: 'associated_or_any', shardRange: [reward.expreward_lead_min ?? 1, reward.expreward_lead_max] }
        : {}),
    })),
    templates: (values.hc_expedition_templates ?? []).map((template) => ({
      id: template.exptpl_id, enabled: true,
      world: template.exptpl_world || undefined,
      weight: template.exptpl_weight ?? 10,
      partySize: template.exptpl_party_size,
      requirementIds: template.exptpl_requirement_ids ?? [],
      requirementCount: template.exptpl_requirement_count ?? 0,
      optionalIds: template.exptpl_optional_ids ?? [],
      rewardPackageId: template.exptpl_reward_package,
      powerRatioBp: template.exptpl_power_ratio_bp ?? 10000,
      titles: template.exptpl_titles ?? [],
      descriptions: template.exptpl_descriptions ?? [],
      fixedRewards: template.exptpl_supply === true
        ? [{ kind: 'resource', id: 'field_supply', qty: 1 }] : [],
    })),
    reports: {
      completed: ['The party returned with everything promised.'],
      successful: ['The plan held. The party returned ahead of the expected margin.'],
      exceptional: ['The party found more than the route promised.'],
    },
    fallbackTemplate: null,
  };

  /* ---- crises ---- */
  const crises = {
    settings: {
      spawnChanceBp: 2500,
      grades: [
        { id: 'local', displayName: 'Local Disturbance', minOwned: 5, minMasteryRank: 'unfamiliar', frontCount: 2, teamSize: 2 },
        { id: 'major', displayName: 'Major Crisis', minOwned: 8, minMasteryRank: 'known', frontCount: 3, teamSize: 2 },
        { id: 'world', displayName: 'World Crisis', minOwned: 12, minMasteryRank: 'established', frontCount: 3, teamSize: 3 },
      ],
    },
    definitions: (values.hc_crises ?? []).map((crisis) => ({
      id: crisis.crisis_id,
      enabled: true,
      worldId: crisis.crisis_world,
      name: crisis.crisis_name,
      openingDescription: crisis.crisis_opening || '',
      artwork: crisis.crisis_art ? mediaUrl(crisis.crisis_art, ['tile_16x9']) : null,
      weight: crisis.crisis_weight ?? 10,
      minimumClearedNodes: crisis.crisis_min_cleared ?? 0,
      fronts: (crisis.crisis_fronts ?? []).map((front) => ({
        id: front.front_id,
        name: front.front_name,
        description: front.front_description || '',
        favoredTagIds: front.front_favored_tags ?? [],
        recommendedPowerByGrade: {
          local: front.front_power_local ?? 100,
          major: front.front_power_major ?? 300,
          world: front.front_power_world ?? 900,
        },
        struggleText: front.front_struggle_text || `${front.front_name} held, barely.`,
        successText: front.front_success_text || `${front.front_name} steadied.`,
        excelText: front.front_excel_text || `${front.front_name} was secured.`,
      })),
      consolationReward: entriesFrom(crisis.crisis_consolation, 'cons'),
      cacheChoices: (crisis.crisis_cache_choices ?? []).map((cache) => ({
        id: cache.cache_id,
        name: cache.cache_name,
        description: '',
        rewards: entriesFrom(cache.cache_entries, 'centry'),
      })),
      boon: {
        type: crisis.crisis_boon_type,
        runs: crisis.crisis_boon_runs ?? undefined,
        qty: crisis.crisis_boon_qty ?? undefined,
        prose: crisis.crisis_boon_prose || '',
      },
    })),
  };

  return {
    version: CUSTOM_DB_VERSION,
    worlds,
    characters,
    factions,
    mainChapters,
    expeditions,
    crises,
  };
}
