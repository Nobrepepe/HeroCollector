// Custom-content database and merge engine.
//
// ALL playable content — worlds, characters, the Main Campaign, archives —
// lives in the creator database. The shipped files provide only system data
// (balance, archetypes, materials, components, recipes, universal tag rules).
// At load time the database is merged into one content set; anything
// incomplete or unsafe is *held back* with a human-readable health note
// instead of producing invalid content. The game itself stays in setup mode
// until the content meets the minimum prerequisites to start a game.

export const CUSTOM_DB_VERSION = 9;

export function emptyCustomDB() {
  return {
    version: CUSTOM_DB_VERSION,
    worlds: [],
    characters: [],
    factions: [],
    mainChapters: [],
    shadowChapters: [],
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
    worlds: (db.worlds ?? []).map(w => ({
      ...w,
      campaignChapterImages: Array.from({ length: 3 }, (_, i) => w.campaignChapterImages?.[i] ?? null),
      campaignChapterTitles: Array.from({ length: 3 }, (_, i) =>
        w.campaignChapterTitles?.[i] ?? `${w.displayName || 'World'} · Chapter ${i + 1}`),
      campaignNodes: (w.campaignNodes ?? []).map(nd => ({ ...nd })),
      archive: w.archive ? {
        ...w.archive,
        collections: (w.archive.collections ?? []).map(col => ({
          ...col,
          rewardSkin: col.rewardSkin ? { ...col.rewardSkin } : null,
          relics: (col.relics ?? []).map(relic => ({ ...relic }))
        })),
        skin: w.archive.skin ? { ...w.archive.skin } : undefined,
        fullSkin: w.archive.fullSkin ? { ...w.archive.fullSkin } : undefined
      } : undefined
    })),
    characters: [...(db.characters ?? [])],
    factions: [...(db.factions ?? [])],
    mainChapters: (db.mainChapters ?? []).map(ch => ({
      ...ch, nodes: (ch.nodes ?? []).map(nd => ({ ...nd }))
    })),
    shadowChapters: (db.shadowChapters ?? []).map(ch => ({
      ...ch, nodes: (ch.nodes ?? []).map(nd => ({ ...nd }))
    })),
    expeditions: structuredClone(db.expeditions ?? emptyExpeditionLibrary()),
    crises: structuredClone(db.crises ?? emptyCrisisLibrary())
  };
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
      rewardSkin: { characterId: null, name: '', portrait: null, fullBody: null },
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
    archive: { collections, fullSkin: { characterId: null, name: '', portrait: null, fullBody: null } }
  };
}

export function emptyExpeditionLibrary() {
  return {
    settings: {
      offerCount: 5, slotCount: 3, freeRerolls: 1, minimumFeasible: 2,
      maxLongOffers: 1, generationAttempts: 40,
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
        { id: 'local', displayName: 'Local Disturbance', minOwned: 5, minHqRank: 1, allowNoHq: true, frontCount: 2, teamSize: 2 },
        { id: 'major', displayName: 'Major Crisis', minOwned: 8, minHqRank: 2, allowNoHq: false, frontCount: 3, teamSize: 2 },
        { id: 'world', displayName: 'World Crisis', minOwned: 12, minHqRank: 3, allowNoHq: false, frontCount: 3, teamSize: 3 }
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
    consolationReward: [{ kind: 'resource', id: 'renown', qty: 12 }],
    cacheChoices: [
      { id: `${id}_supply`, name: 'Field Supply', description: 'One more measured extension to the day.', rewards: [{ kind: 'resource', id: 'field_supply', qty: 1 }] },
      { id: `${id}_intel`, name: 'Intelligence Brief', description: 'The response leaves useful knowledge behind.', rewards: [{ kind: 'resource', id: 'intelligence', qty: 2 }] },
      { id: `${id}_assets`, name: `${world.worldAsset.displayName}`, description: 'The affected world keeps the recovered reserve.', rewards: [{ kind: 'resource', id: '@associated_world_asset', qty: 8 }] },
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
    pkg('development', [{ kind: 'resource', id: 'renown', min: 40, max: 60 }, { kind: 'resource', id: '@associated_world_asset', min: 4, max: 6 }]),
    pkg('world_supply', [{ kind: 'resource', id: '@associated_world_asset', min: 10, max: 16 }, { kind: 'resource', id: 'renown', min: 10, max: 15 }]),
    pkg('equipment_cache', [{ kind: 'material', id: 'mat_metal_basic', min: 4, max: 8 }, { kind: 'resource', id: 'intelligence', min: 1, max: 1 }]),
    pkg('intelligence_brief', [{ kind: 'resource', id: 'intelligence', min: 1, max: 2 }, { kind: 'resource', id: 'renown', min: 8, max: 12 }]),
    { ...pkg('character_lead', [{ kind: 'resource', id: 'renown', min: 18, max: 28 }], [{ kind: 'resource', id: 'intelligence', qty: 1, chanceBp: 7000 }]), shardPool: 'associated_or_any', shardRange: [2, 4] },
    pkg('long_venture', [{ kind: 'resource', id: 'renown', min: 70, max: 95 }, { kind: 'resource', id: '@associated_world_asset', min: 14, max: 20 }], [{ kind: 'resource', id: 'intelligence', qty: 2, chanceBp: 8000 }])
  ];
  const reqs = lib.requirements.map(r => r.id), opts = lib.optionalObjectives.map(r => r.id);
  const titles = ['Quiet Roads, Useful Rumours', 'A Map Left Unfinished', 'Work Beyond the Gate'];
  const descriptions = ['A measured route with a useful answer waiting at its end.', 'The work asks for breadth rather than battle.'];
  const scopes = [null, ...worlds.slice(0, 2).map(w => w.id)];
  for (let i = 0; i < 15; i++) {
    lib.templates.push({
      id: `exp_template_${i + 1}`, enabled: true, world: scopes[i % scopes.length], weight: 1,
      durations: i % 5 === 4 ? [2] : [1], partySize: [2, 3, 4][i % 3],
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
    durations: [1], partySize: 2, requirementIds: ['req_two_arch'], requirementCount: 1,
    optionalIds: ['opt_two_worlds'], rewardPackageId: 'development', powerRatioBp: [9000, 10000],
    titles: ['A Field Cache Beyond the Gate'],
    descriptions: ['A reliable route to the provisions that can carry one day a little further.'],
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
    equipment
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
  return { title: `Main Chapter ${idx + 1}`, image: null, nodes };
}

export function newShadowChapter(mainChapter, chapterIndex) {
  return {
    title: `Shadow Chapter ${chapterIndex + 1}`,
    image: null,
    nodes: mainChapter.nodes.map((nd, i) => ({
      name: `Shadow — ${nd.name || `Chapter ${chapterIndex + 1} — Node ${i + 1}`}`,
      threshold: nd.threshold,
      family: nd.family,
      grade: nd.grade,
      shardCharacterId: null
    }))
  };
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
  const shadowLen = (content.nodesByCampaign?.shadow ?? []).length;
  const starting = content.characters.filter(d => d.starting);
  const checks = [
    { ok: content.worlds.length >= 1, text: `At least one published world in the game (currently ${content.worlds.length}).` },
    { ok: starting.length >= 5, text: `At least 5 starting characters to form the first party (currently ${starting.length}). Mark Minor characters as “starting” in the Content Creator.` },
    { ok: mainLen >= 10, text: `At least one live Main Campaign chapter (currently ${mainLen} nodes).` },
    { ok: shadowLen >= 10, text: `At least one complete Shadow Campaign chapter (currently ${shadowLen} nodes).` }
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
      if (nd.shardCharacterId) {
        const shardChar = db.characters.find(c => c.id === nd.shardCharacterId);
        if (!shardChar) problems.push(`campaign shard source references unknown character ${nd.shardCharacterId}`);
        else if (shardChar.worldId !== w.id) problems.push(`campaign shard source ${shardChar.displayName} belongs to another world`);
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

  // --- character candidates (existence); they also need a live shard source
  const slotOrder = systemRaw.characters.slotOrder;
  const candidates = db.characters.filter(c => liveWorldIds.has(c.worldId));
  for (const c of db.characters) {
    if (!liveWorldIds.has(c.worldId)) {
      const w = db.worlds.find(x => x.id === c.worldId);
      note('info', `Character “${c.displayName}” is waiting for world “${w?.displayName ?? c.worldId}” to be in the game.`);
    }
  }
  const candidateIds = new Set(candidates.map(c => c.id));

  // --- Main Campaign: material-only chapters 1..N, contiguous and monotonic
  const sourced = new Set();
  const mainNodes = [];
  let chainAlive = true;
  let prevId = null;
  let lastThreshold = 0;
  db.mainChapters.forEach((ch, ci) => {
    const chapterNum = ci + 1;
    let reason = null;
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
      if (nd.objective) node.objective = nd.objective;
      mainNodes.push(node);
      prevId = node.id;
    });
    lastThreshold = ch.nodes[9].threshold;
  });

  // --- Shadow Campaign: every node is a shard source. Chapters are validated
  // independently because Shadow nodes mirror Main unlocks rather than forming
  // their own progression chain.
  const shadowNodes = [];
  const liveMainIds = new Set(mainNodes.map(n => n.id));
  (db.shadowChapters ?? []).forEach((ch, ci) => {
    const chapterNum = ci + 1;
    let reason = null;
    if (!db.mainChapters[ci] || !liveMainIds.has(`main_${ci * 10 + 1}`)) reason = 'matching Main Campaign chapter is not live';
    else if (ch.nodes.length !== 10) reason = 'chapter must have exactly 10 nodes';
    let t = 0;
    for (const [i, nd] of ch.nodes.entries()) {
      if (reason) break;
      if (!Number.isFinite(nd.threshold) || nd.threshold < t) reason = 'thresholds must never decrease within the chapter';
      else if (!nd.shardCharacterId) reason = `node ${i + 1} needs a shard character`;
      else if (!candidateIds.has(nd.shardCharacterId)) {
        const c = db.characters.find(x => x.id === nd.shardCharacterId);
        reason = `node ${i + 1} shard character “${c?.displayName ?? nd.shardCharacterId}” is not in the game (draft world?)`;
      }
      t = nd.threshold;
    }
    if (reason) {
      note('warn', `Shadow Campaign Chapter ${chapterNum} is held back: ${reason}.`);
      return;
    }
    ch.nodes.forEach((nd, i) => {
      const num = ci * 10 + i + 1;
      const material = matId(nd.family, nd.grade);
      shadowNodes.push({
        id: `shadow_${num}`, campaign: 'shadow', chapter: chapterNum, position: i + 1, number: num,
        chapterTitle: ch.title || `Shadow Chapter ${chapterNum}`,
        displayName: nd.name || `Shadow Node ${num}`,
        type: 'shard',
        threshold: nd.threshold,
        material,
        previous: null,
        mirrorNode: `main_${num}`,
        shardCharacter: nd.shardCharacterId, world: nd.worldId ?? null,
        repeatRewards: structuredClone(nd.repeatRewards ?? []),
        firstClearRewards: structuredClone(nd.firstClearRewards ?? []),
        firstClear: { materials: [{ materialId: material, qty: 1 }], shards: { characterId: nd.shardCharacterId, qty: 2 } }
      });
      sourced.add(nd.shardCharacterId);
    });
  });

  // Valid World Campaign assignments are also live acquisition sources.
  for (const w of acceptedWorlds) {
    for (const nd of w.campaignNodes) if (nd.shardCharacterId) sourced.add(nd.shardCharacterId);
  }

  // --- characters: included only when acquirable (live shard source)
  const included = [];
  for (const c of candidates) {
    if (sourced.has(c.id)) included.push(c);
    else note('warn', `Character “${c.displayName}” is held back: no live shard source. Assign one in a complete Shadow chapter or their World Campaign.`);
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

  // --- world campaigns and archives (drop worlds with no live characters)
  const finalWorlds = [];
  const wcNodes = [];
  const archives = [];
  const liveCharsByWorld = {};
  for (const d of characterDefs) (liveCharsByWorld[d.world] ??= []).push(d);
  for (const w of acceptedWorlds) {
    const liveChars = liveCharsByWorld[w.id] ?? [];
    if (liveChars.length < 5) {
      note('warn', `World “${w.displayName}” is held back: only ${liveChars.length} of its characters have live shard sources; five are required.`);
      continue;
    }
    finalWorlds.push({
      id: w.id, displayName: w.displayName, tagline: w.tagline,
      description: w.description ?? '', displayOrder: w.displayOrder ?? 0,
      worldAsset: structuredClone(w.worldAsset), hq: structuredClone(w.hq),
      palette: w.palette, icon: w.icon,
      campaignId: `wc_${w.id}`, archiveId: `archive_${w.id}`
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
        firstClear: { materials: [{ materialId: material, qty: 3 }], archiveFragment: `frag_${w.id}_${num}` }
      };
      if (nd.shardCharacterId) {
        node.shardCharacter = nd.shardCharacterId;
        node.firstClear.shards = { characterId: nd.shardCharacterId, qty: 2 };
      }
      wcNodes.push(node);
    });
    const rewardDef = (authored, id, { fallback = false } = {}) => {
      if (!authored && !fallback) return null;
      const skinChar = liveChars.find(d => d.id === authored?.characterId) ?? (fallback ? liveChars[0] : null);
      if (!skinChar || (!fallback && !authored?.name)) return null;
      return {
        type: 'skin',
        id,
        characterId: skinChar.id,
        skinName: authored?.name || `${skinChar.displayName} — Alternate Attire`
      };
    };
    archives.push({
      id: `archive_${w.id}`, world: w.id,
      displayName: `${w.displayName} Archive`,
      collections: w.archive.collections.map((col, c) => ({
        id: `${w.id}_col_${c + 1}`,
        displayName: col.name,
        rewardSkin: rewardDef(col.rewardSkin, `skin_${w.id}_collection_${c + 1}`),
        legacyMilestoneText: col.milestoneReward || undefined,
        relics: col.relics.map((relic, r) => {
          const relicIndex = c * 5 + r;
          const nodeA = relicIndex * 2 + 1, nodeB = relicIndex * 2 + 2;
          return {
            id: `${w.id}_relic_${relicIndex + 1}`,
            displayName: relic.name,
            position: r + 1,
            lore: relic.lore || `${relic.name} — item ${r + 1} of the “${col.name}” collection.`,
            fragments: [
              { id: `frag_${w.id}_${nodeA}`, sourceNode: `wc_${w.id}_${nodeA}` },
              { id: `frag_${w.id}_${nodeB}`, sourceNode: `wc_${w.id}_${nodeB}` }
            ]
          };
        })
      })),
      fullReward: rewardDef(w.archive.fullSkin, `skin_${w.id}_full`, { fallback: true })
    });
  }
  const finalWorldIds = new Set(finalWorlds.map(w => w.id));
  const characters = characterDefs.filter(d => finalWorldIds.has(d.world));

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
    world: {}, headquarters: {}, expedition: {}, crisis: {}, chapter: {}, portrait: {},
    fullBody: {}, equipment: {}, relic: {}, skin: {}, hq: {}, facility: {}
  };
  db.mainChapters.forEach((chapter, index) => {
    if (chapter.image) images.chapter[`main:${index + 1}`] = chapter.image;
  });
  db.shadowChapters.forEach((chapter, index) => {
    if (chapter.image) images.chapter[`shadow:${index + 1}`] = chapter.image;
  });
  for (const w of db.worlds) {
    if (w.image) images.world[w.id] = w.image;
    if (w.hqImage) images.headquarters[w.id] = w.hqImage;
    (w.hq?.backgrounds ?? []).forEach((image, index) => {
      if (image) images.hq[`${w.id}:${index + 1}`] = image;
    });
    for (const facility of w.hq?.facilities ?? []) {
      if (facility.image) images.facility[facility.id] = facility.image;
    }
    (w.campaignChapterImages ?? []).forEach((image, index) => {
      if (image) images.chapter[`wc_${w.id}:${index + 1}`] = image;
    });
    w.archive.collections.forEach((col, c) => col.relics.forEach((relic, r) => {
      if (relic.image) images.relic[`${w.id}_relic_${c * 5 + r + 1}`] = relic.image;
    }));
    w.archive.collections.forEach((col, c) => {
      if (col.rewardSkin?.portrait || col.rewardSkin?.fullBody) {
        images.skin[`skin_${w.id}_collection_${c + 1}`] = { portrait: col.rewardSkin.portrait, fullBody: col.rewardSkin.fullBody };
      }
    });
    if (w.archive.fullSkin?.portrait || w.archive.fullSkin?.fullBody) {
      images.skin[`skin_${w.id}_full`] = { portrait: w.archive.fullSkin.portrait, fullBody: w.archive.fullSkin.fullBody };
    }
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
    nodes: [...mainNodes, ...shadowNodes, ...wcNodes],
    archives,
    expeditions: normalizeExpeditionLibrary(db.expeditions),
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

function normalizeExpeditionLibrary(value) {
  const lib = structuredClone(value ?? emptyExpeditionLibrary());
  lib.fallbackTemplate = lib.templates.find(t => t.partySize === 2 && t.durations?.includes(1))
    ?? {
      id: 'fallback_simple', enabled: true, world: null, weight: 1, durations: [1], partySize: 2,
      requirementIds: [], requirementCount: 0,
      optionalIds: [lib.optionalObjectives[0]?.id].filter(Boolean),
      rewardPackageId: lib.rewardPackages[0]?.id,
      powerRatioBp: [8000, 9000], titles: ['A Quiet Errand'],
      descriptions: ['Straightforward work with a useful return.']
    };
  return lib;
}
