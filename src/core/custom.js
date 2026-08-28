// Custom-content database and merge engine.
//
// ALL playable content — worlds, characters, the Main Campaign, archives —
// lives in the creator database. The shipped files provide only system data
// (balance, archetypes, materials, components, recipes, universal tag rules).
// At load time the database is merged into one content set; anything
// incomplete or unsafe is *held back* with a human-readable health note
// instead of producing invalid content. The game itself stays in setup mode
// until the content meets the minimum prerequisites to start a game.
import { RANDOM_MATERIAL, INTELLIGENCE_ID } from './resources.js';

export const CUSTOM_DB_VERSION = 13;

// The four relic pieces of every world are found at these World Campaign
// node numbers (of 30), so the completed relic matters during the campaign's
// final third rather than only after completion.
export const RELIC_PIECE_NODES = [4, 9, 15, 21];
export const MASTERY_SKIN_RANKS = ['known', 'established', 'rooted', 'mastered'];

export function emptyCustomDB() {
  return {
    version: CUSTOM_DB_VERSION,
    worlds: [],
    characters: [],
    factions: [],
    mainChapters: [],
    expeditions: emptyExpeditionLibrary(),
    crises: emptyCrisisLibrary()
  };
}

export function upgradeCustomDB(db) {
  if (!db || typeof db !== 'object') return emptyCustomDB();
  const oldVersion = Number(db.version) || 1;
  const out = {
    ...emptyCustomDB(),
    ...db,
    worlds: (db.worlds ?? []).map(w => {
      const world = {
        ...w,
        campaignChapterImages: Array.from({ length: 3 }, (_, i) => w.campaignChapterImages?.[i] ?? null),
        campaignChapterTitles: Array.from({ length: 3 }, (_, i) =>
          w.campaignChapterTitles?.[i] ?? `${w.displayName || 'World'} · Chapter ${i + 1}`),
        campaignNodes: (w.campaignNodes ?? []).map(nd => ({ ...nd }))
      };
      if (w.archive) world.archive = {
        ...w.archive,
        collections: (w.archive.collections ?? []).map(col => ({
          ...col,
          rewardSkin: col.rewardSkin ? { ...col.rewardSkin } : null,
          relics: (col.relics ?? []).map(relic => ({ ...relic }))
        })),
        skin: w.archive.skin ? { ...w.archive.skin } : undefined,
        fullSkin: w.archive.fullSkin ? { ...w.archive.fullSkin } : undefined
      };
      if (w.relic) world.relic = { ...w.relic, pieces: (w.relic.pieces ?? []).map(piece => ({ ...piece })) };
      if (w.masterySkins) world.masterySkins = w.masterySkins.map(entry => ({ ...entry }));
      return world;
    }),
    characters: (db.characters ?? []).map(character => ({
      ...character,
      skins: (character.skins ?? []).map(skin => ({ ...skin }))
    })),
    factions: [...(db.factions ?? [])],
    mainChapters: (db.mainChapters ?? []).map(ch => ({
      ...ch, nodes: (ch.nodes ?? []).map(nd => ({ ...nd }))
    })),
    expeditions: structuredClone(db.expeditions ?? emptyExpeditionLibrary()),
    crises: structuredClone(db.crises ?? emptyCrisisLibrary())
  };
  // Pre-v13 packs still carry a Shadow Campaign; keep it normalized so the
  // older ladder steps can read it. The v13 step folds and removes it.
  if (oldVersion < 13) {
    out.shadowChapters = (db.shadowChapters ?? []).map(ch => ({
      ...ch, nodes: (ch.nodes ?? []).map(nd => ({ ...nd }))
    }));
  } else {
    delete out.shadowChapters;
  }
  // v1 -> v2: base-content overrides and removals no longer exist; chapters
  // now form the whole Main Campaign starting at Chapter 1.
  delete out.removedWorlds;
  delete out.overrides;
  for (const c of out.characters) if (c.starting === undefined) c.starting = false;
  // v2 -> v3: Main becomes material-only. A paired Shadow chapter inherits
  // the authored node settings and receives the three legacy shard
  // assignments. The other positions intentionally remain unassigned so the
  // author can choose their expanded roster rather than receiving guesses.
  if (oldVersion < 3) {
    out.shadowChapters = out.mainChapters.map((ch, ci) => ({
      nodes: ch.nodes.map((nd, i) => ({
        name: `Shadow — ${nd.name || `Chapter ${ci + 1} — Node ${i + 1}`}`,
        threshold: nd.threshold,
        family: nd.family,
        grade: nd.grade,
        shardCharacterId: nd.shardCharacterId ?? null
      }))
    }));
    for (const ch of out.mainChapters) {
      for (const nd of ch.nodes) delete nd.shardCharacterId;
    }
  }
  // v3 -> v4: Archive collection milestones can award skins, and the prior
  // single full-Archive skin moves to the same reward shape. Legacy milestone
  // text is retained for display but is not mistaken for a skin.
  if (oldVersion < 4) {
    for (const w of out.worlds) {
      if (!w.archive) continue;
      for (const col of w.archive.collections) {
        col.rewardSkin ??= { characterId: null, name: '', portrait: null, fullBody: null };
      }
      w.archive.fullSkin = w.archive.fullSkin ?? w.archive.skin ?? { characterId: null, name: '', portrait: null, fullBody: null };
      delete w.archive.skin;
    }
  }
  // v4 -> v5: each authored campaign chapter may carry its own 16:9 key art.
  // Null defaults keep existing content packs valid and compact.
  if (oldVersion < 5) {
    for (const chapter of out.mainChapters) chapter.image ??= null;
    for (const chapter of out.shadowChapters) chapter.image ??= null;
    for (const world of out.worlds) {
      world.campaignChapterImages = Array.from({ length: 3 }, (_, i) => world.campaignChapterImages?.[i] ?? null);
    }
  }
  if (oldVersion < 6) {
    for (const world of out.worlds) {
      world.description ??= world.tagline ?? '';
      world.displayOrder ??= out.worlds.indexOf(world);
      world.worldAsset ??= {
        id: `asset_${world.id}`, displayName: `${world.displayName} Asset`,
        description: `Development resources belonging to ${world.displayName}.`, icon: '◆'
      };
      world.hq ??= null;
      for (const node of world.campaignNodes) {
        node.repeatRewards ??= [];
        node.firstClearRewards ??= [];
      }
    }
    for (const chapter of [...out.mainChapters, ...out.shadowChapters]) {
      for (const node of chapter.nodes) {
        node.worldId ??= null;
        node.repeatRewards ??= [];
        node.firstClearRewards ??= [];
      }
    }
    // The shipped Eden pack receives the playable seed; unrelated creator
    // databases remain opt-in and untouched beyond safe schema defaults.
    const village = out.worlds.find(w => w.id === 'world_hidden_village');
    const academy = out.worlds.find(w => w.id === 'world_magic_academy');
    if (village && academy) {
      village.worldAsset = { id: 'clan_seals', displayName: 'Clan Seals', description: 'Marks of trust and authority among the hidden clans.', icon: '印' };
      academy.worldAsset = { id: 'arcane_sigils', displayName: 'Arcane Sigils', description: 'Inscribed proofs of research and magical service.', icon: '✦' };
      village.hq = defaultHq(village, 'daily_free_pin');
      academy.hq = defaultHq(academy, 'daily_free_reroll');
      out.expeditions = sampleExpeditionLibrary(out.worlds);
      for (const world of [village, academy]) {
        world.campaignNodes.forEach((node, i) => {
          node.firstClearRewards = [{ kind: 'resource', id: '@associated_world_asset', qty: 1 }];
          if ((i + 1) % 5 === 0) {
            node.repeatRewards = [{ kind: 'resource', id: '@associated_world_asset', qty: 1 }];
            node.firstClearRewards.push({ kind: 'resource', id: 'renown', qty: 5 });
          }
        });
      }
      out.mainChapters.forEach(ch => ch.nodes.forEach((node, i) => {
        if ((i + 1) % 5 === 0) node.firstClearRewards = [{ kind: 'resource', id: 'renown', qty: 10 }];
      }));
    }
  }
  if (oldVersion < 7) {
    for (const world of out.worlds) world.hqImage ??= null;
    out.expeditions.images ??= { global: null, worlds: {} };
    out.expeditions.images.worlds ??= {};
  }
  if (oldVersion < 8) {
    for (const chapter of out.mainChapters) chapter.title ??= `Main Chapter ${out.mainChapters.indexOf(chapter) + 1}`;
    for (const chapter of out.shadowChapters) chapter.title ??= `Shadow Chapter ${out.shadowChapters.indexOf(chapter) + 1}`;
    for (const world of out.worlds) {
      world.campaignChapterTitles = Array.from({ length: 3 }, (_, i) =>
        world.campaignChapterTitles?.[i] ?? `${world.displayName} · Chapter ${i + 1}`);
    }
  }
  if (oldVersion < 9) {
    out.crises = structuredClone(db.crises ?? emptyCrisisLibrary());
    const village = out.worlds.find(world => world.id === 'world_hidden_village');
    const academy = out.worlds.find(world => world.id === 'world_magic_academy');
    if (!out.crises.definitions.length && village && academy) {
      out.crises = sampleCrisisLibrary([village, academy]);
    }
    out.expeditions.settings.guaranteedSupplyTemplateId ??= null;
  }
  if (oldVersion < 10) {
    for (const character of out.characters) character.skins ??= [];
    const moveSkin = (world, authored, stableId) => {
      if (!authored?.characterId || !authored.name) return { characterId: null, skinId: null };
      const character = out.characters.find(item => item.id === authored.characterId && item.worldId === world.id);
      if (!character) return { characterId: null, skinId: null };
      character.skins ??= [];
      if (!character.skins.some(skin => skin.id === stableId)) character.skins.push({
        id: stableId, name: authored.name, portrait: authored.portrait ?? null, fullBody: authored.fullBody ?? null
      });
      return { characterId: character.id, skinId: stableId };
    };
    for (const world of out.worlds) {
      for (const [index, collection] of (world.archive?.collections ?? []).entries()) {
        collection.rewardSkin = moveSkin(world, collection.rewardSkin, `skin_${world.id}_collection_${index + 1}`);
      }
      if (world.archive) world.archive.fullSkin = moveSkin(world, world.archive.fullSkin, `skin_${world.id}_full`);
    }
  }
  // v10 -> v11: campaign pairs now have an explicit publication boundary.
  // Complete legacy pairs stay live; incomplete work is preserved as a draft.
  if (oldVersion < 11) {
    out.mainChapters.forEach((main, index) => {
      const shadow = out.shadowChapters[index];
      const complete = main.nodes?.length === 10 && shadow?.nodes?.length === 10
        && shadow.nodes.every(node => node.shardCharacterId
          && out.characters.some(character => character.id === node.shardCharacterId));
      main.status = complete ? 'published' : 'draft';
      if (shadow) shadow.status = main.status;
    });
  }
  // v11 -> v12: an Expedition reward package that promised one fixed basic
  // material always returned the same one. It now draws a family at roll time.
  if (oldVersion < 12) {
    for (const pack of out.expeditions.rewardPackages ?? []) {
      for (const entry of pack.entries ?? []) {
        if (entry.kind !== 'material' || !/_basic$/.test(entry.id ?? '')) continue;
        entry.id = RANDOM_MATERIAL;
        entry.grade = 'basic';
      }
    }
  }
  // v12 -> v13: the goal-driven overhaul. The Shadow Campaign folds into Main
  // Campaign encounters; the Headquarters economy (facilities, renown, World
  // Assets) is removed; the fifteen-relic Archive becomes one four-piece world
  // relic plus Mastery skins; Expeditions run on a shared cycle without
  // per-template durations; Crisis grades gate on World Mastery rank.
  if (oldVersion < 13) {
    out.mainChapters.forEach((ch, ci) => {
      ch.nodes.forEach((nd, i) => {
        nd.encounterCharacterId ??= out.shadowChapters?.[ci]?.nodes?.[i]?.shardCharacterId ?? null;
      });
    });
    delete out.shadowChapters;
    // Renown and World Assets no longer exist. Where a reward list promised
    // them, keep the promise meaningful: influence becomes Intelligence at
    // roughly 20:1 and world reserves become material caches. Node rewards
    // simply drop them (they only ever fed the removed Headquarters economy).
    // `materialId` is what a former World Asset entry becomes: Expedition
    // packages may use the roll-time RANDOM_MATERIAL sentinel, but rewards
    // granted directly (Crisis caches, consolations) need a concrete material.
    const mapEntry = (materialId) => (entry) => {
      if (entry.kind !== 'resource') return entry;
      if (entry.id === 'renown') {
        const scale = (n) => Math.max(1, Math.floor((n ?? 0) / 20));
        return entry.min !== undefined
          ? { ...entry, id: INTELLIGENCE_ID, min: scale(entry.min), max: Math.max(scale(entry.min), scale(entry.max)) }
          : { ...entry, id: INTELLIGENCE_ID, qty: scale(entry.qty) };
      }
      if (entry.id === '@associated_world_asset') {
        const { id, ...rest } = entry;
        return materialId === RANDOM_MATERIAL
          ? { ...rest, kind: 'material', id: RANDOM_MATERIAL, grade: 'basic' }
          : { ...rest, kind: 'material', id: materialId };
      }
      return entry;
    };
    const mapPackEntry = mapEntry(RANDOM_MATERIAL);
    const mapDirectEntry = mapEntry('mat_metal_basic');
    const dropHqEntries = (entries) => (entries ?? []).filter(entry =>
      !(entry.kind === 'resource' && ['renown', '@associated_world_asset'].includes(entry.id)));
    for (const world of out.worlds) {
      for (const nd of world.campaignNodes) {
        nd.encounterCharacterId ??= nd.shardCharacterId ?? null;
        delete nd.shardCharacterId;
        nd.repeatRewards = dropHqEntries(nd.repeatRewards);
        nd.firstClearRewards = dropHqEntries(nd.firstClearRewards);
      }
      const collections = world.archive?.collections ?? [];
      const allRelics = collections.flatMap(col => col.relics ?? []);
      world.relic ??= {
        name: `The ${world.displayName} Relic`,
        lore: collections[0]?.name ? `Reassembled from the ${collections[0].name}.` : '',
        image: null,
        pieces: [0, 1, 2, 3].map(index => ({
          name: allRelics[index]?.name ?? `Piece ${['I', 'II', 'III', 'IV'][index]}`,
          lore: allRelics[index]?.lore ?? '',
          image: allRelics[index]?.image ?? null
        }))
      };
      if (!world.masterySkins?.length) {
        world.masterySkins = [];
        collections.slice(0, 3).forEach((col, index) => {
          if (col.rewardSkin?.characterId && col.rewardSkin?.skinId) {
            world.masterySkins.push({
              rank: MASTERY_SKIN_RANKS[index],
              characterId: col.rewardSkin.characterId,
              skinId: col.rewardSkin.skinId
            });
          }
        });
        const full = world.archive?.fullSkin;
        if (full?.characterId && full?.skinId) {
          world.masterySkins.push({ rank: 'mastered', characterId: full.characterId, skinId: full.skinId });
        }
      }
      delete world.archive;
      delete world.hq;
      delete world.hqImage;
      delete world.worldAsset;
    }
    for (const chapter of out.mainChapters) {
      for (const nd of chapter.nodes) {
        nd.repeatRewards = dropHqEntries(nd.repeatRewards);
        nd.firstClearRewards = dropHqEntries(nd.firstClearRewards);
      }
    }
    for (const pack of out.expeditions.rewardPackages ?? []) {
      pack.entries = (pack.entries ?? []).map(mapPackEntry);
      if (Array.isArray(pack.rare)) pack.rare = pack.rare.map(mapPackEntry);
    }
    for (const template of out.expeditions.templates ?? []) delete template.durations;
    if (out.expeditions.fallbackTemplate) delete out.expeditions.fallbackTemplate.durations;
    const settings = out.expeditions.settings ??= {};
    delete settings.maxLongOffers;
    settings.cycleLengthDays ??= 4;
    settings.cycleScaleBp ??= 40000;
    settings.freePins ??= 1;
    const rankByHq = { 1: 'unfamiliar', 2: 'known', 3: 'established' };
    for (const grade of out.crises?.settings?.grades ?? []) {
      grade.minMasteryRank ??= rankByHq[grade.minHqRank] ?? 'unfamiliar';
      delete grade.minHqRank;
      delete grade.allowNoHq;
    }
    for (const definition of out.crises?.definitions ?? []) {
      definition.consolationReward = (definition.consolationReward ?? []).map(mapDirectEntry);
      for (const choice of definition.cacheChoices ?? []) {
        choice.rewards = (choice.rewards ?? []).map(mapDirectEntry);
      }
      if (definition.boon?.type === 'next_hq_production_bp') {
        definition.boon = { type: 'bonus_world_material_runs', runs: 3, qty: 1,
          prose: 'The next three successful runs here return one additional normal material.' };
      } else if (definition.boon?.type === 'world_expedition_renown_bp') {
        definition.boon = { type: 'instant_intelligence', qty: 2,
          prose: 'The response yields two Intelligence immediately.' };
      }
    }
  }
  out.version = CUSTOM_DB_VERSION;
  return out;
}

let idCounter = 0;
export function newId(prefix) {
  idCounter = (idCounter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------- factories
const WC_RANGES = [[9500, 12500], [12800, 15800], [16100, 19500]];
const WC_GRADES = ['improved', 'improved', 'advanced'];
const FAMILIES = ['metal', 'fiber', 'mineral', 'compound', 'mechanism', 'essence'];
// Suggested Main Campaign pacing (GDD 8.1); later chapters continue upward.
const MAIN_RANGES = [[5500, 7500], [7800, 10500], [10800, 14000], [14300, 18000], [18400, 22500], [23000, 27500]];
const MAIN_GRADES = ['basic', 'improved', 'advanced', 'superior', 'superior', 'masterwork'];

export function newCustomWorld(name) {
  const id = newId('cw');
  const campaignNodes = [];
  for (let ch = 0; ch < 3; ch++) {
    const [lo, hi] = WC_RANGES[ch];
    for (let i = 0; i < 10; i++) {
      campaignNodes.push({
        name: `Chapter ${ch + 1} — Node ${i + 1}`,
        threshold: Math.round((lo + ((hi - lo) * i) / 9) / 50) * 50,
        family: FAMILIES[(ch * 10 + i) % 6],
        grade: WC_GRADES[ch]
      });
    }
  }
  const collections = [];
  for (let c = 0; c < 3; c++) {
    collections.push({
      name: `Collection ${c + 1}`,
      rewardSkin: { characterId: null, skinId: null },
      relics: Array.from({ length: 5 }, (_, r) => ({ name: `Relic ${c * 5 + r + 1}`, lore: '', image: null }))
    });
  }
  return {
    id, status: 'draft',
    displayName: name || 'New World',
    tagline: '',
    icon: '🌍',
    palette: { primary: '#5a7a9e', accent: '#9ec3e8', dark: '#1c2733' },
    image: null,
    hqImage: null,
    campaignChapterImages: [null, null, null],
    campaignChapterTitles: Array.from({ length: 3 }, (_, i) => `${name || 'New World'} · Chapter ${i + 1}`),
    campaignNodes,
    description: '', displayOrder: 0,
    worldAsset: { id: `asset_${id}`, displayName: `${name || 'New World'} Asset`, description: '', icon: '◆' },
    hq: null,
    archive: { collections, fullSkin: { characterId: null, skinId: null } }
  };
}

export function emptyExpeditionLibrary() {
  return {
    settings: {
      offerCount: 5, slotCount: 3, freeRerolls: 1, freePins: 1, minimumFeasible: 2,
      generationAttempts: 40, cycleLengthDays: 4, cycleScaleBp: 40000,
      intelligenceCosts: { reroll: 1, pin: 1, reveal: 1 },
      resultMultipliersBp: { completed: 10000, successful: 12500, exceptional: 15000 }
    },
    images: { global: null, worlds: {} },
    requirements: [], optionalObjectives: [], rewardPackages: [], templates: [],
    reports: {
      completed: [
        'The party returned with everything promised, even if the road asked more of them.',
        'The route proved demanding, but the agreed supplies came home intact.',
        'Careful work carried the party through. Nothing promised was lost.'
      ],
      successful: [
        'The plan held. The party returned ahead of the expected margin.',
        'The recommendation proved sound, and the return was clean.',
        'Good preparation left room to gather more along the road.'
      ],
      exceptional: [
        'The party found more than the route promised and brought the rare lead home.',
        'An optional trail opened along the way, and the party followed it well.',
        'Breadth and preparation turned ordinary work into an uncommon return.'
      ]
    }
  };
}

export function emptyCrisisLibrary() {
  return {
    settings: {
      spawnChanceBp: 2500,
      grades: [
        { id: 'local', displayName: 'Local Disturbance', minOwned: 5, minMasteryRank: 'unfamiliar', frontCount: 2, teamSize: 2 },
        { id: 'major', displayName: 'Major Crisis', minOwned: 8, minMasteryRank: 'known', frontCount: 3, teamSize: 2 },
        { id: 'world', displayName: 'World Crisis', minOwned: 12, minMasteryRank: 'established', frontCount: 3, teamSize: 3 }
      ]
    },
    definitions: []
  };
}

function sampleFront(id, name, favoredTagIds, powers, description) {
  return {
    id, name, description, favoredTagIds,
    recommendedPowerByGrade: { local: powers[0], major: powers[1], world: powers[2] },
    struggleText: `${name} held longer than the response could safely reach. Nothing was lost.`,
    successText: `${name} steadied under a measured response.`,
    excelText: `${name} was secured before the danger could spread.`
  };
}

export function sampleCrisisLibrary(worlds) {
  const lib = emptyCrisisLibrary();
  const village = worlds.find(world => world.id === 'world_hidden_village');
  const academy = worlds.find(world => world.id === 'world_magic_academy');
  const definition = (world, id, name, openingDescription, fronts, boon) => ({
    id, enabled: true, worldId: world.id, name, openingDescription, artwork: null,
    weight: 1, minimumClearedNodes: 0, fronts,
    consolationReward: [{ kind: 'resource', id: 'intelligence', qty: 1 }],
    cacheChoices: [
      { id: `${id}_supply`, name: 'Field Supply', description: 'One stored provision for a targeted push.', rewards: [{ kind: 'resource', id: 'field_supply', qty: 1 }] },
      { id: `${id}_intel`, name: 'Intelligence Brief', description: 'The response leaves useful knowledge behind.', rewards: [{ kind: 'resource', id: 'intelligence', qty: 2 }] },
      { id: `${id}_materials`, name: 'Material Bundle', description: 'Practical salvage returns to the Workshop.', rewards: [{ kind: 'material', id: 'mat_metal_basic', qty: 8 }] }
    ],
    boon
  });
  if (village) lib.definitions.push(definition(village, 'crisis_invasion_dawn', 'Invasion at Dawn',
    'Signals move along the ridge before sunrise. Three approaches need quiet, decisive hands.', [
      sampleFront('dawn_north_gate', 'The north gate', [village.id, 'leader'], [2600, 4300, 6800], 'Hold the narrow approach without drawing the village into open ground.'),
      sampleFront('dawn_rooftops', 'The eastern rooftops', ['rebel', 'freespirit'], [2500, 4200, 6600], 'Cross the roofline and break the signal chain.'),
      sampleFront('dawn_courtyard', 'The lantern courtyard', ['caretaker', village.id], [2700, 4500, 7000], 'Move the families below the courtyards before the first clash.'),
      sampleFront('dawn_river', 'The river crossing', ['achiever', 'leader'], [2800, 4600, 7200], 'Secure the shallow crossing before reinforcements arrive.'),
      sampleFront('dawn_watch', 'The old watchtower', ['dreamer', village.id], [2600, 4400, 6900], 'Restore the watchtower signal and keep the routes joined.')
    ], { type: 'free_world_node_runs', runs: 3, prose: 'The next three successful runs here cost no Energy.' }));
  if (academy) lib.definitions.push(definition(academy, 'crisis_wild_magic', 'Wild Magic Surge',
    'A current of unbound magic crosses the Academy grounds. Each break in the pattern needs a different answer.', [
      sampleFront('surge_library', 'The moving library', [academy.id, 'dreamer'], [2600, 4300, 6800], 'Anchor the stacks before the corridors fold again.'),
      sampleFront('surge_laboratory', 'The lower laboratory', ['achiever', 'caretaker'], [2700, 4500, 7000], 'Contain the volatile reagents without losing the research.'),
      sampleFront('surge_courtyard', 'The glass courtyard', ['leader', academy.id], [2800, 4600, 7200], 'Give the scattered students one clear route home.'),
      sampleFront('surge_observatory', 'The observatory', ['dreamer', 'freespirit'], [2500, 4200, 6700], 'Realign the instruments before the surge reaches the dome.'),
      sampleFront('surge_archive', 'The sealed archive', ['caretaker', academy.id], [2700, 4400, 7000], 'Keep the oldest wards from answering the wrong call.')
    ], { type: 'bonus_world_material_runs', runs: 3, qty: 1, prose: 'The next three successful runs here return one additional normal material.' }));
  return lib;
}

export function newCrisisDefinition(world) {
  const id = newId('crisis');
  return {
    id, enabled: true, worldId: world.id, name: 'New Crisis', openingDescription: '', artwork: null,
    weight: 1, minimumClearedNodes: 0,
    fronts: Array.from({ length: 3 }, (_, index) => ({
      id: `${id}_front_${index + 1}`, name: `Front ${index + 1}`, description: '',
      favoredTagIds: [world.id], recommendedPowerByGrade: { local: 3000, major: 5000, world: 7500 },
      struggleText: 'The Front held beyond the response. Nothing was lost.',
      successText: 'The Front was secured.', excelText: 'The Front was secured with room to spare.'
    })),
    consolationReward: [{ kind: 'resource', id: 'renown', qty: 10 }],
    cacheChoices: [
      { id: `${id}_supply`, name: 'Field Supply', description: 'One stored extension to the day.', rewards: [{ kind: 'resource', id: 'field_supply', qty: 1 }] },
      { id: `${id}_intel`, name: 'Intelligence', description: 'Useful knowledge from the response.', rewards: [{ kind: 'resource', id: 'intelligence', qty: 2 }] },
      { id: `${id}_asset`, name: world.worldAsset.displayName, description: 'Resources recovered for this world.', rewards: [{ kind: 'resource', id: '@associated_world_asset', qty: 8 }] }
    ],
    boon: { type: 'instant_intelligence', qty: 2, prose: 'The response yields two Intelligence immediately.' }
  };
}

const level = (renown, asset, extras = {}) => ({
  cost: [{ kind: 'resource', id: 'renown', qty: renown }, { kind: 'resource', id: '@associated_world_asset', qty: asset }],
  buildDays: 1, ...extras
});

export function defaultHq(world, signature = 'daily_free_reroll') {
  const names = world.id === 'world_hidden_village'
    ? ['Mission Hall', 'Training Grounds', 'Supply Depot', 'Clan Quarters']
    : world.id === 'world_magic_academy'
      ? ['Expeditionary Studies', 'Practical Arts Hall', 'Alchemy Laboratory', 'Student Commons']
      : ['Operations Hall', 'Training Court', 'Supply House', 'Community Hall'];
  const categories = ['operations', 'training', 'production', 'community'];
  return {
    enabled: true, backgrounds: [null, null, null],
    ranks: [
      { rank: 1, totalLevels: 0, reward: [] },
      { rank: 2, totalLevels: 4, reward: [{ kind: 'resource', id: 'renown', qty: 25 }] },
      { rank: 3, totalLevels: 8, reward: [{ kind: 'resource', id: 'intelligence', qty: 1 }] }
    ],
    signatureEffect: { type: signature, amount: 1 },
    facilities: categories.map((category, i) => ({
      id: `${world.id}_${category}`, category, displayName: names[i],
      description: `${names[i]} develops ${category} across ${world.displayName}.`,
      image: null,
      levels: [
        level(100, 10, category === 'community' ? { staffingSlots: 1 } : {}),
        level(250, 25, category === 'community' ? { staffingSlots: 2 } : {}),
        level(500, 50, category === 'community' ? { staffingSlots: 2, staffEffectBp: 15000 } : {})
      ],
      productionOptions: category === 'production' ? [
        { id: 'world_asset', displayName: world.worldAsset.displayName, kind: 'resource', resourceId: '@associated_world_asset', quantities: [1, 1, 2] },
        { id: 'basic_metal', displayName: 'Basic Metal', kind: 'material', resourceId: 'mat_metal_basic', quantities: [1, 2, 3] }
      ] : []
    }))
  };
}

export function scaffoldWorldHq(world) {
  world.hq ??= defaultHq(world);
  return world.hq;
}

export function sampleExpeditionLibrary(worlds) {
  const lib = emptyExpeditionLibrary();
  lib.requirements = [
    { id: 'req_associated', type: 'world_count', world: '@associated', count: 1, text: 'Include someone who knows this world.' },
    { id: 'req_same_world', type: 'same_world', count: 2, text: 'Send two characters from the same world.' },
    { id: 'req_two_worlds', type: 'distinct_worlds', count: 2, text: 'Bring knowledge from two worlds.' },
    { id: 'req_two_arch', type: 'distinct_archetypes', count: 2, text: 'Bring two different archetypes.' },
    { id: 'req_stars', type: 'combined_stars', count: 4, text: 'Bring at least four combined stars.' }
  ];
  lib.optionalObjectives = [
    { id: 'opt_two_worlds', type: 'distinct_worlds', count: 2, text: 'Bring two different worlds.' },
    { id: 'opt_two_arch', type: 'distinct_archetypes', count: 2, text: 'Bring two different archetypes.' },
    { id: 'opt_star', type: 'star_character', stars: 3, count: 1, text: 'Include someone at three stars or above.' },
    { id: 'opt_power', type: 'power_over_recommended', percentBp: 1000, count: 1, text: 'Exceed the recommendation by ten percent.' }
  ];
  const pkg = (id, entries, rare = []) => ({ id, displayName: id.replaceAll('_', ' '), entries, rare });
  lib.rewardPackages = [
    pkg('development', [{ kind: 'material', id: RANDOM_MATERIAL, grade: 'basic', min: 3, max: 5 }, { kind: 'resource', id: 'intelligence', min: 1, max: 1 }]),
    pkg('world_supply', [{ kind: 'material', id: RANDOM_MATERIAL, grade: 'improved', min: 3, max: 5 }]),
    pkg('equipment_cache', [{ kind: 'material', id: RANDOM_MATERIAL, grade: 'basic', min: 4, max: 8 }, { kind: 'resource', id: 'intelligence', min: 1, max: 1 }]),
    pkg('intelligence_brief', [{ kind: 'resource', id: 'intelligence', min: 1, max: 2 }, { kind: 'material', id: RANDOM_MATERIAL, grade: 'basic', min: 2, max: 3 }]),
    { ...pkg('character_lead', [{ kind: 'material', id: RANDOM_MATERIAL, grade: 'basic', min: 2, max: 4 }], [{ kind: 'resource', id: 'intelligence', qty: 1, chanceBp: 7000 }]), shardPool: 'associated_or_any', shardRange: [2, 4] },
    pkg('long_venture', [{ kind: 'material', id: RANDOM_MATERIAL, grade: 'advanced', min: 3, max: 5 }], [{ kind: 'resource', id: 'intelligence', qty: 2, chanceBp: 8000 }])
  ];
  const reqs = lib.requirements.map(r => r.id), opts = lib.optionalObjectives.map(r => r.id);
  const titles = ['Quiet Roads, Useful Rumours', 'A Map Left Unfinished', 'Work Beyond the Gate'];
  const descriptions = ['A measured route with a useful answer waiting at its end.', 'The work asks for breadth rather than battle.'];
  const scopes = [null, ...worlds.slice(0, 2).map(w => w.id)];
  for (let i = 0; i < 15; i++) {
    lib.templates.push({
      id: `exp_template_${i + 1}`, enabled: true, world: scopes[i % scopes.length], weight: 1,
      partySize: [2, 3, 4][i % 3],
      requirementIds: [reqs[i % reqs.length], reqs[(i + 2) % reqs.length]], requirementCount: i % 4 === 0 ? 2 : 1,
      optionalIds: [opts[i % opts.length], opts[(i + 1) % opts.length]],
      rewardPackageId: (scopes[i % scopes.length] === null
        ? lib.rewardPackages[[2, 3, 4][i % 3]]
        : lib.rewardPackages[i % lib.rewardPackages.length]).id,
      powerRatioBp: i % 3 === 0 ? [8500, 10000] : [10000, 11500],
      titles: titles.map(t => `${t}${i ? ` ${i + 1}` : ''}`), descriptions
    });
  }
  const supply = {
    id: 'exp_template_field_supply', enabled: true, world: null, weight: 1,
    partySize: 2, requirementIds: ['req_two_arch'], requirementCount: 1,
    optionalIds: ['opt_two_worlds'], rewardPackageId: 'development', powerRatioBp: [9000, 10000],
    titles: ['A Field Cache Beyond the Gate'],
    descriptions: ['A reliable route to the provisions that can carry a goal a little further.'],
    fixedRewards: [{ kind: 'resource', id: 'field_supply', qty: 1 }]
  };
  lib.templates.push(supply);
  lib.settings.guaranteedSupplyTemplateId = supply.id;
  return lib;
}

export function newCustomCharacter(worldId, name, slotOrder, slotMeta) {
  const display = name || 'New Character';
  const equipment = {};
  for (const slot of slotOrder) {
    equipment[slot] = { name: `${display}’s ${slotMeta[slot].name}`, image: null };
  }
  return {
    id: newId('cc'), worldId,
    displayName: display,
    glyph: display[0].toUpperCase(),
    color: '#7a8aa0',
    archetype: 'leader',
    tier: 'minor',
    starting: false,
    faction: null,
    extraTags: [],
    description: '',
    lore: '',
    portrait: null,
    fullBody: null,
    equipment,
    skins: []
  };
}

export function newCustomFaction(name) {
  return {
    id: newId('cf'),
    displayName: name,
    explanation: `${name} members work well together.`,
    thresholds: [{ count: 2, bonusBp: 200 }, { count: 3, bonusBp: 400 }]
  };
}

export function lastMainThreshold(db) {
  let max = 0;
  for (const ch of db.mainChapters) for (const nd of ch.nodes) if (nd.threshold > max) max = nd.threshold;
  return max;
}

export function newMainChapter(db) {
  const idx = db.mainChapters.length; // 0-based; this becomes Chapter idx+1
  const grade = MAIN_GRADES[Math.min(idx, MAIN_GRADES.length - 1)];
  let prev = lastMainThreshold(db);
  let familyIdx = idx;
  const nodes = Array.from({ length: 10 }, (_, i) => {
    let t;
    if (idx < MAIN_RANGES.length) {
      const [lo, hi] = MAIN_RANGES[idx];
      t = Math.round((lo + ((hi - lo) * i) / 9) / 50) * 50;
    } else {
      t = prev + 500;
    }
    t = Math.max(t, prev);
    prev = t;
    const family = FAMILIES[familyIdx++ % 6];
    return {
      name: `Chapter ${idx + 1} — Node ${i + 1}`,
      threshold: t,
      family,
      grade
    };
  });
  return { title: `Main Chapter ${idx + 1}`, image: null, status: 'draft', nodes };
}

export function newShadowChapter(mainChapter, chapterIndex) {
  return {
    title: `Shadow Chapter ${chapterIndex + 1}`,
    image: null, status: 'draft',
    nodes: mainChapter.nodes.map((nd, i) => ({
      name: `Shadow — ${nd.name || `Chapter ${chapterIndex + 1} — Node ${i + 1}`}`,
      threshold: nd.threshold,
      family: nd.family,
      grade: nd.grade,
      shardCharacterId: null
    }))
  };
}

export function canPublishChapterPair(db, index) {
  const reasons = [];
  const main = db.mainChapters[index];
  const shadow = db.shadowChapters[index];
  if (!main || main.nodes?.length !== 10) reasons.push('Main chapter needs exactly 10 nodes.');
  if (!shadow || shadow.nodes?.length !== 10) reasons.push('Shadow chapter needs exactly 10 nodes.');
  let previous = index > 0 ? Math.max(...(db.mainChapters[index - 1]?.nodes ?? []).map(node => Number(node.threshold) || 0), 0) : 0;
  for (const node of main?.nodes ?? []) {
    if (!Number.isFinite(node.threshold) || node.threshold < previous) reasons.push('Main thresholds must never decrease.');
    previous = node.threshold;
  }
  for (const [nodeIndex, node] of (shadow?.nodes ?? []).entries()) {
    if (!node.shardCharacterId) reasons.push(`Shadow node ${nodeIndex + 1} needs a character.`);
    else {
      const character = db.characters.find(item => item.id === node.shardCharacterId);
      if (!character) reasons.push(`Shadow node ${nodeIndex + 1} references a missing character.`);
      else if (db.worlds.find(world => world.id === character.worldId)?.status !== 'published') reasons.push(`Shadow node ${nodeIndex + 1} uses a character from a draft world.`);
    }
    if (node.worldId && db.worlds.find(world => world.id === node.worldId)?.status !== 'published') reasons.push(`Shadow node ${nodeIndex + 1} references a draft or missing world.`);
  }
  for (const [nodeIndex, node] of (main?.nodes ?? []).entries()) {
    if (node.worldId && db.worlds.find(world => world.id === node.worldId)?.status !== 'published') reasons.push(`Main node ${nodeIndex + 1} references a draft or missing world.`);
  }
  if (index > 0 && db.mainChapters[index - 1]?.status !== 'published') reasons.push('The previous chapter pair must be published first.');
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function addCampaignChapter(db) {
  const main = newMainChapter(db);
  db.mainChapters.push(main);
  db.shadowChapters.push(newShadowChapter(main, db.mainChapters.length - 1));
  return db.mainChapters.length - 1;
}

// ---------------------------------------------------------------- gates
// A world may be published only when it can actually be played (GDD: a World
// Campaign needs a full five-character party).
export function canPublishWorld(db, worldId) {
  const reasons = [];
  const chars = db.characters.filter(c => c.worldId === worldId);
  if (chars.length < 5) {
    reasons.push(`A world needs at least 5 characters to be playable (has ${chars.length}). Keep it as a draft until then.`);
  }
  const assigned = new Set();
  for (const ch of db.shadowChapters ?? []) {
    if (ch.nodes.length === 10 && ch.nodes.every(nd => nd.shardCharacterId)) {
      for (const nd of ch.nodes) assigned.add(nd.shardCharacterId);
    }
  }
  const world = db.worlds.find(w => w.id === worldId);
  for (const nd of world?.campaignNodes ?? []) if (nd.shardCharacterId) assigned.add(nd.shardCharacterId);
  const unsourced = chars.filter(c => !assigned.has(c.id));
  if (chars.length >= 5 && unsourced.length > 0) {
    reasons.push(`Every character needs a live shard source. Assign complete Shadow Campaign chapters or nodes in this World Campaign for: ${unsourced.map(c => c.displayName).join(', ')}.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function characterShardAssignments(db, characterId) {
  const spots = [];
  (db.shadowChapters ?? []).forEach((ch, ci) => {
    ch.nodes.forEach((nd, i) => {
      if (nd.shardCharacterId === characterId) spots.push({ campaign: 'shadow', chapter: ci + 1, position: i + 1 });
    });
  });
  for (const w of db.worlds) {
    w.campaignNodes.forEach((nd, i) => {
      if (nd.shardCharacterId === characterId) {
        spots.push({ campaign: 'world', worldId: w.id, worldName: w.displayName, chapter: Math.floor(i / 10) + 1, position: (i % 10) + 1 });
      }
    });
  }
  return spots;
}

// ---------------------------------------------------------------- readiness
// The game stays in setup mode until the merged content meets the minimum
// prerequisites for a playable new save.
export function gameReadiness(content) {
  const mainLen = (content.nodesByCampaign?.main ?? []).length;
  const starting = content.characters.filter(d => d.starting);
  const checks = [
    { ok: content.worlds.length >= 1, text: `At least one published world in the game (currently ${content.worlds.length}).` },
    { ok: starting.length >= 5, text: `At least 5 starting characters to form the first party (currently ${starting.length}). Mark Minor characters as “starting” in the World Hub production.` },
    { ok: mainLen >= 10, text: `At least one live Main Campaign chapter (currently ${mainLen} nodes).` }
  ];
  return { ready: checks.every(c => c.ok), checks };
}

// ---------------------------------------------------------------- merge
const matId = (family, grade) => `mat_${family}_${grade}`;

export function mergeContent(systemRaw, db) {
  const health = [];
  const note = (level, text) => health.push({ level, text });

  // --- world pre-pass: which published worlds are structurally sound?
  const acceptedWorlds = [];
  for (const w of db.worlds) {
    if (w.status !== 'published') {
      note('info', `World “${w.displayName}” is a draft — not in the game yet.`);
      continue;
    }
    const problems = [];
    let t = 0;
    for (const nd of w.campaignNodes) {
      if (nd.threshold < t) { problems.push('campaign thresholds must never decrease'); break; }
      t = nd.threshold;
      if (nd.encounterCharacterId) {
        const encounterChar = db.characters.find(c => c.id === nd.encounterCharacterId);
        if (!encounterChar) problems.push(`campaign encounter references unknown character ${nd.encounterCharacterId}`);
        else if (encounterChar.worldId !== w.id) problems.push(`campaign encounter ${encounterChar.displayName} belongs to another world`);
      }
    }
    if (w.campaignNodes.length !== 30) problems.push('campaign must have exactly 30 nodes');
    if (db.characters.filter(c => c.worldId === w.id).length < 5) problems.push('fewer than 5 characters');
    if (problems.length) {
      note('warn', `World “${w.displayName}” is published but held back: ${problems.join('; ')}.`);
    } else {
      acceptedWorlds.push(w);
    }
  }
  const liveWorldIds = new Set(acceptedWorlds.map(w => w.id));

  // --- character candidates (existence); they also need a live encounter
  const slotOrder = systemRaw.characters.slotOrder;
  const candidates = db.characters.filter(c => liveWorldIds.has(c.worldId));
  for (const c of db.characters) {
    if (!liveWorldIds.has(c.worldId)) {
      const w = db.worlds.find(x => x.id === c.worldId);
      note('info', `Character “${c.displayName}” is waiting for world “${w?.displayName ?? c.worldId}” to be in the game.`);
    }
  }
  const candidateIds = new Set(candidates.map(c => c.id));

  // --- Main Campaign: chapters 1..N, contiguous and monotonic; nodes may
  // carry encounters that reveal heroes.
  const sourced = new Set();
  const mainNodes = [];
  let chainAlive = true;
  let prevId = null;
  let lastThreshold = 0;
  db.mainChapters.forEach((ch, ci) => {
    const chapterNum = ci + 1;
    let reason = null;
    if (ch.status !== 'published') {
      chainAlive = false;
      note('info', `Campaign Chapter Pair ${chapterNum} is a draft — its edits are saved but not live.`);
      return;
    }
    if (!chainAlive) reason = 'a previous chapter is held back';
    if (!reason) {
      let t = lastThreshold;
      for (const nd of ch.nodes) {
        if (!Number.isFinite(nd.threshold) || nd.threshold < t) { reason = 'thresholds must never decrease along the campaign'; break; }
        t = nd.threshold;
      }
    }
    if (!reason && ch.nodes.length !== 10) reason = 'chapter must have exactly 10 nodes';
    if (reason) {
      chainAlive = false;
      note('warn', `Main Campaign Chapter ${chapterNum} is held back: ${reason}.`);
      return;
    }
    ch.nodes.forEach((nd, i) => {
      const num = ci * 10 + i + 1;
      const isCheckpoint = (i + 1) % 5 === 0;
      const material = matId(nd.family, nd.grade);
      const node = {
        id: `main_${num}`, campaign: 'main', chapter: chapterNum, position: i + 1, number: num,
        chapterTitle: ch.title || `Main Chapter ${chapterNum}`,
        displayName: nd.name || `Node ${num}`,
        type: i >= 6 ? 'advanced' : 'ordinary',
        threshold: nd.threshold,
        checkpoint: isCheckpoint,
        material,
        previous: prevId, world: nd.worldId ?? null,
        repeatRewards: structuredClone(nd.repeatRewards ?? []),
        firstClearRewards: structuredClone(nd.firstClearRewards ?? [])
      };
      if (isCheckpoint) {
        node.firstClear = { materials: [{ materialId: material, qty: 5 }], milestone: `Chapter ${chapterNum} checkpoint` };
      } else {
        node.firstClear = { materials: [{ materialId: material, qty: 3 }] };
      }
      // An encounter: the first clear reveals this hero as a Development Focus
      // target and grants a small deterministic shard stake.
      if (nd.encounterCharacterId) {
        if (candidateIds.has(nd.encounterCharacterId)) {
          node.encounterCharacter = nd.encounterCharacterId;
          node.firstClear.shards = { characterId: nd.encounterCharacterId, qty: 2 };
          sourced.add(nd.encounterCharacterId);
        } else {
          const c = db.characters.find(x => x.id === nd.encounterCharacterId);
          note('warn', `Main node ${num} encounter “${c?.displayName ?? nd.encounterCharacterId}” is not in the game (draft world?); the encounter was held back.`);
        }
      }
      if (nd.objective) node.objective = nd.objective;
      mainNodes.push(node);
      prevId = node.id;
    });
    lastThreshold = ch.nodes[9].threshold;
  });

  // Valid World Campaign encounters are also live acquisition sources.
  for (const w of acceptedWorlds) {
    for (const nd of w.campaignNodes) if (nd.encounterCharacterId) sourced.add(nd.encounterCharacterId);
  }

  // --- characters: included only when reachable (starting or a live encounter)
  const included = [];
  for (const c of candidates) {
    if (c.starting || sourced.has(c.id)) included.push(c);
    else note('warn', `Character “${c.displayName}” is held back: no live encounter reveals them. Assign them to a Main Campaign or World Campaign node.`);
  }
  const characterDefs = included.map(c => ({
    id: c.id,
    displayName: c.displayName,
    world: c.worldId,
    archetype: c.archetype,
    faction: c.faction || undefined,
    extraTags: c.extraTags ?? [],
    tier: c.tier,
    starting: !!c.starting && c.tier === 'minor',
    color: c.color,
    glyph: c.glyph || c.displayName[0].toUpperCase(),
    description: c.description || '',
    lore: c.lore || '',
    equipmentLines: Object.fromEntries(slotOrder.map(s => [s, c.equipment[s]?.name || `${c.displayName}’s ${s}`]))
  }));

  // --- world campaigns, relics, and Mastery skins (drop worlds with no live characters)
  const finalWorlds = [];
  const wcNodes = [];
  const relics = [];
  const liveCharsByWorld = {};
  for (const d of characterDefs) (liveCharsByWorld[d.world] ??= []).push(d);
  for (const w of acceptedWorlds) {
    const liveChars = liveCharsByWorld[w.id] ?? [];
    if (liveChars.length < 5) {
      note('warn', `World “${w.displayName}” is held back: only ${liveChars.length} of its characters are reachable through live encounters; five are required.`);
      continue;
    }
    const masterySkins = [];
    for (const entry of w.masterySkins ?? []) {
      const skinChar = liveChars.find(d => d.id === entry.characterId);
      const sourceCharacter = included.find(character => character.id === skinChar?.id);
      const skin = sourceCharacter?.skins?.find(item => item.id === entry.skinId);
      if (!MASTERY_SKIN_RANKS.includes(entry.rank) || !skinChar || !skin) {
        note('warn', `World “${w.displayName}” Mastery skin at rank “${entry.rank}” references missing content and was held back.`);
        continue;
      }
      masterySkins.push({ rank: entry.rank, characterId: skinChar.id, skinId: skin.id, skinName: skin.name });
    }
    finalWorlds.push({
      id: w.id, displayName: w.displayName, tagline: w.tagline,
      description: w.description ?? '', displayOrder: w.displayOrder ?? 0,
      palette: w.palette, icon: w.icon,
      campaignId: `wc_${w.id}`, relicId: `relic_${w.id}`,
      masterySkins
    });
    w.campaignNodes.forEach((nd, idx) => {
      const num = idx + 1;
      const material = matId(nd.family, nd.grade);
      const node = {
        id: `wc_${w.id}_${num}`,
        campaign: `wc_${w.id}`, world: w.id,
        chapter: Math.floor(idx / 10) + 1, position: (idx % 10) + 1, number: num,
        chapterTitle: w.campaignChapterTitles?.[Math.floor(idx / 10)]
          || `${w.displayName} · Chapter ${Math.floor(idx / 10) + 1}`,
        displayName: nd.name || `Node ${num}`,
        type: 'world',
        threshold: nd.threshold,
        material,
        previous: num === 1 ? null : `wc_${w.id}_${num - 1}`,
        repeatRewards: structuredClone(nd.repeatRewards ?? []),
        firstClearRewards: structuredClone(nd.firstClearRewards ?? []),
        firstClear: { materials: [{ materialId: material, qty: 3 }] }
      };
      const pieceIndex = RELIC_PIECE_NODES.indexOf(num);
      if (pieceIndex !== -1) node.firstClear.relicPiece = `relic_${w.id}_p${pieceIndex + 1}`;
      if (nd.encounterCharacterId && candidateIds.has(nd.encounterCharacterId)) {
        node.encounterCharacter = nd.encounterCharacterId;
        node.firstClear.shards = { characterId: nd.encounterCharacterId, qty: 2 };
      }
      wcNodes.push(node);
    });
    const roman = ['I', 'II', 'III', 'IV'];
    relics.push({
      id: `relic_${w.id}`, world: w.id,
      displayName: w.relic?.name || `The ${w.displayName} Relic`,
      lore: w.relic?.lore || '',
      pieces: RELIC_PIECE_NODES.map((nodeNum, index) => ({
        id: `relic_${w.id}_p${index + 1}`,
        position: index + 1,
        displayName: w.relic?.pieces?.[index]?.name || `Piece ${roman[index]}`,
        lore: w.relic?.pieces?.[index]?.lore || '',
        sourceNode: `wc_${w.id}_${nodeNum}`
      }))
    });
  }
  const finalWorldIds = new Set(finalWorlds.map(w => w.id));
  const characters = characterDefs.filter(d => finalWorldIds.has(d.world));
  // Skins are authored on characters; Mastery milestones unlock them.
  const skins = included
    .filter(c => finalWorldIds.has(c.worldId))
    .flatMap(c => (c.skins ?? []).map(skin => ({
      id: skin.id, characterId: c.id, world: c.worldId, skinName: skin.name
    })));

  // Authoring references may temporarily point at a world that is held back.
  // Keep the authored value in the DB, but never emit a dangling live reference.
  for (const node of mainNodes) {
    if (!node.world || finalWorldIds.has(node.world)) continue;
    const missingWorld = node.world;
    node.world = null;
    note('warn', `${node.id} is live without its draft/held-back world ${missingWorld}.`);
  }

  // --- pacing sanity: the starting five must be able to clear the first node
  const startingCount = characters.filter(d => d.starting).length;
  if (mainNodes.length > 0 && startingCount >= 5) {
    const b = systemRaw.balance;
    const starterRawPower = 5 * (b.basePower + b.starPowerCumulative[0]);
    if (mainNodes[0].threshold > starterRawPower) {
      note('warn', `The first Main Campaign node needs ${mainNodes[0].threshold} Power, but five fresh starting characters only have ${starterRawPower} before synergy. New games may be stuck immediately.`);
    }
  }

  // --- tags: universal system rules + the database's factions
  const tags = [
    ...systemRaw.tags,
    ...db.factions.map(f => ({
      id: f.id, displayName: f.displayName, category: 'faction',
      activationRule: 'tag_count', stackingGroup: f.id,
      thresholds: f.thresholds, explanation: f.explanation
    }))
  ];

  // --- images from the database
  const images = {
    world: {}, expedition: {}, crisis: {}, chapter: {}, portrait: {},
    fullBody: {}, equipment: {}, relic: {}, skin: {}
  };
  db.mainChapters.forEach((chapter, index) => {
    if (chapter.image) images.chapter[`main:${index + 1}`] = chapter.image;
  });
  for (const w of db.worlds) {
    if (w.image) images.world[w.id] = w.image;
    (w.campaignChapterImages ?? []).forEach((image, index) => {
      if (image) images.chapter[`wc_${w.id}:${index + 1}`] = image;
    });
    if (w.relic?.image) images.relic[`relic_${w.id}`] = w.relic.image;
    (w.relic?.pieces ?? []).forEach((piece, index) => {
      if (piece.image) images.relic[`relic_${w.id}_p${index + 1}`] = piece.image;
    });
  }
  if (db.expeditions?.images?.global) images.expedition.global = db.expeditions.images.global;
  for (const [worldId, image] of Object.entries(db.expeditions?.images?.worlds ?? {})) {
    if (image) images.expedition[worldId] = image;
  }
  for (const definition of db.crises?.definitions ?? []) {
    if (definition.artwork) images.crisis[definition.id] = definition.artwork;
  }
  for (const c of db.characters) {
    if (c.portrait) images.portrait[c.id] = c.portrait;
    if (c.fullBody) images.fullBody[c.id] = c.fullBody;
    for (const skin of c.skins ?? []) {
      if (skin.portrait || skin.fullBody) images.skin[skin.id] = { portrait: skin.portrait, fullBody: skin.fullBody };
    }
    for (const slot of slotOrder) {
      if (c.equipment[slot]?.image) images.equipment[`${c.id}:${slot}`] = c.equipment[slot].image;
    }
  }

  const raw = {
    balance: systemRaw.balance,
    worlds: finalWorlds,
    archetypes: systemRaw.archetypes,
    materials: systemRaw.materials,
    components: systemRaw.components,
    characters: { ...systemRaw.characters, characters },
    tags,
    recipes: systemRaw.recipes,
    nodes: [...mainNodes, ...wcNodes],
    relics,
    skins,
    expeditions: normalizeExpeditionLibrary(db.expeditions, finalWorldIds, health),
    crises: normalizeCrisisLibrary(db.crises, new Set(finalWorlds.map(world => world.id)), health)
  };
  return { raw, images, health };
}

function normalizeCrisisLibrary(value, liveWorldIds, health) {
  const lib = structuredClone(value ?? emptyCrisisLibrary());
  lib.definitions = (lib.definitions ?? []).filter(definition => {
    if (!liveWorldIds.has(definition.worldId)) return false;
    if ((definition.fronts?.length ?? 0) < 3) {
      health.push({ level: 'warn', text: `Crisis “${definition.name || definition.id}” is held back until it has at least three Fronts.` });
      return false;
    }
    return true;
  });
  return lib;
}

function normalizeExpeditionLibrary(value, liveWorldIds, health) {
  const lib = structuredClone(value ?? emptyExpeditionLibrary());
  lib.templates = (lib.templates ?? []).filter(template => {
    if (!template.world || template.world === '@any' || liveWorldIds.has(template.world)) return true;
    health.push({ level: 'warn', text: `Expedition template “${template.id}” is held back with world ${template.world}.` });
    return false;
  });
  lib.fallbackTemplate = lib.templates.find(t => t.partySize === 2)
    ?? {
      id: 'fallback_simple', enabled: true, world: null, weight: 1, partySize: 2,
      requirementIds: [], requirementCount: 0,
      optionalIds: [lib.optionalObjectives[0]?.id].filter(Boolean),
      rewardPackageId: lib.rewardPackages[0]?.id,
      powerRatioBp: [8000, 9000], titles: ['A Quiet Errand'],
      descriptions: ['Straightforward work with a useful return.']
    };
  return lib;
}
