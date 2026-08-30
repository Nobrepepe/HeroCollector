// Generates all static content JSON files for the Hero Collector MVP.
// Content is data; game logic never hard-codes any of these definitions.
// Run: npm run generate
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'content');
mkdirSync(out, { recursive: true });

const CONTENT_VERSION = '2.0.0';

// ---------------------------------------------------------------- balance
const balance = {
  contentVersion: CONTENT_VERSION,
  energy: { dailyGrant: 120, storageCap: 240, resetHour: 4 },
  starShards: [10, 20, 30, 50, 75, 110, 155],          // additional shards per star 1..7
  starPowerCumulative: [150, 300, 500, 750, 1000, 1250, 1500],
  basePower: 1000,
  gearTierPower: [100, 120, 150, 180, 220, 260, 310, 360, 390, 410], // per tier 1..10
  gearSlotShareBp: 1000,        // each equipped piece grants 10% of tier power
  gearCompletionShareBp: 4000,  // completion bonus share
  synergyCapBp: 2500,           // global +25% cap
  upcraftRatio: 5,              // 5 same-grade materials -> 1 next grade
  nodeDefaults: {
    ordinary:  { energy: 6,  repeat: { count: 1, bonusChanceBp: 4000 } },
    advanced:  { energy: 8,  repeat: { count: 2, bonusChanceBp: 3500 } },
    world:     { energy: 10, repeat: { count: 2, bonusChanceBp: 0 } }
  },
  // Every hero is worth the same: one recruitment cost, one joining Star, and
  // the same seven-Star ladder afterwards. The starting five are drawn from
  // the whole roster when a save is created, not marked in the content.
  rosterProgression: {
    starterCount: 5,
    recruitShards: 10,   // cumulative shards to recruit any hero
    recruitStar: 1,      // the Star a recruited hero joins at
    revealShardStake: 2  // shards staked by first-clearing a reveal node
  },
  // Campaign generation. World Hub supplies chapter titles and node names;
  // every number below is the game's, so renaming a node can never move a
  // threshold, a drop, or a reward.
  //
  // Thresholds grow by a constant proportion per node rather than along a
  // hand-drawn ladder: power itself grows multiplicatively (Stars, then Gear
  // tiers), so a constant ratio asks the same relative improvement each step.
  campaigns: {
    // The un-gated opening track. It reveals the first party of every world
    // in progression order, so a World Campaign can be opened before it is
    // itself reachable — a world needs five of its own owned to unlock.
    main: {
      chapterSize: 10,
      thresholdStart: 5500,
      thresholdGrowthBp: 277,
      thresholdRound: 50,
      checkpointEvery: 5,
      advancedFromPosition: 7,   // positions 7..10 of a chapter are 'advanced'
      // One material grade per chapter; the last entry repeats if an author
      // publishes more chapters than the ladder names.
      gradeLadder: ['basic', 'improved', 'advanced', 'superior', 'superior', 'masterwork'],
      firstClearMaterials: 3,
      checkpointMaterials: 5,
      // Optional objectives ride on checkpoint nodes, cycling through these
      // party conditions. They never gate progress; they pay once. The
      // compiler skips any whose condition the live content cannot satisfy.
      objectives: [
        { tagId: 'tag_world_diversity', rule: 'distinct_world_count', count: 2,
          text: 'Clear with characters from 2 different worlds', rewardQty: 3 },
        { tagId: 'tag_world_cohesion', rule: 'same_world_count', count: 3,
          text: 'Clear with 3 characters from one world', rewardQty: 3 }
      ]
    },
    world: {
      nodes: 30,
      chapterSize: 10,
      thresholdStart: 9500,
      thresholdGrowthBp: 251,
      thresholdRound: 50,
      // Worlds open in whatever order the drawn roster allows, so they are
      // deliberately equal in difficulty. Raise this to make later worlds in
      // the progression order harder than earlier ones.
      perWorldGrowthBp: 0,
      gradeByChapter: ['improved', 'improved', 'advanced'],
      relicPieceNodes: [4, 9, 15, 21],
      firstClearMaterials: 3
    },
    // Node materials rotate through the family order so a campaign always
    // opens every family at the grades it drops, instead of drawing at random
    // and leaving a recipe unbuildable.
    familyRotation: { mainStep: 1, worldStep: 1, worldOffsetPerWorld: 2 }
  },
  // Faction synergy. World Hub says who belongs to which faction; how much
  // that is worth in a party is the game's to tune, once, for all of them.
  factions: {
    thresholds: [
      { count: 2, bonusBp: 200 },
      { count: 3, bonusBp: 400 }
    ]
  },
  partySize: 5,
  partyPresetCount: 6,
  // Development Focus: deterministic shard generation from Energy spent on any
  // campaign node. Rates are Energy per shard; 120 Energy yields 5 + 4 + 3.
  focus: { rates: { primary: 24, secondary: 30, longTerm: 40 } },
  // Field Supplies are stored strategic consumables with three targeted modes;
  // there is no daily use requirement and no plain Energy conversion.
  fieldSupply: {
    storageCap: 5,
    cacheEnergyValue: 30,  // Requisition: guaranteed yield of this much Energy of sweeps
    shardGrant: 3,         // Tutoring: shards granted to one revealed hero
    surgeBp: 500           // Surge: +5% effective Power for one node attempt
  },
  // World Programs advance automatically through relevant play. Thresholds are
  // meter sizes; an installed relic uses the relic* variants.
  programs: {
    procurement: { threshold: 120, shipmentQty: 6, relicBonusQty: 2 },
    development: { threshold: 25, bonusShards: 1, relicThreshold: 20 },
    operations:  { threshold: 2, relicThreshold: 1, bonusQty: 4 }
  },
  // World Mastery: a derived 0..1000 track per world. Weights must sum to the
  // final rank threshold. Hero weights are basis points of one hero's share.
  mastery: {
    ranks: [
      { id: 'unfamiliar',  displayName: 'Unfamiliar',  at: 0 },
      { id: 'known',       displayName: 'Known',       at: 200 },
      { id: 'established', displayName: 'Established', at: 450 },
      { id: 'rooted',      displayName: 'Rooted',      at: 700 },
      { id: 'mastered',    displayName: 'Mastered',    at: 1000 }
    ],
    weights: { campaign: 350, heroes: 350, gear: 200, relic: 100 },
    heroWeightsBp: { revealed: 1500, owned: 3500, stars: 5000 },
    // Mastery cosmetics are awarded in the world's authored order: the first
    // named cosmetic at the first rank below, the second at the next, and so on.
    cosmeticRanks: ['known', 'established', 'rooted', 'mastered'],
    milestones: {
      known:       { supplies: 1, materialCache: 8 },
      established: { shardChoice: 15 },
      rooted:      { supplies: 2, materialCache: 10 },
      mastered:    { shardChoice: 25 }
    }
  }
};

// ---------------------------------------------------------------- materials
const FAMILIES = ['metal', 'fiber', 'mineral', 'compound', 'mechanism', 'essence'];
const GRADES = ['basic', 'improved', 'advanced', 'superior', 'masterwork'];
const FAMILY_META = {
  metal:     { name: 'Metal',     icon: '⚙️', blurb: 'Frames, fasteners, structural or prestigious hardware' },
  fiber:     { name: 'Fiber',     icon: '🧵', blurb: 'Cloth, paper, leather-like and flexible materials' },
  mineral:   { name: 'Mineral',   icon: '💎', blurb: 'Stone, crystal, glass, gems, ceramics' },
  compound:  { name: 'Compound',  icon: '⚗️', blurb: 'Chemicals, inks, medicines, fuels, prepared mixtures' },
  mechanism: { name: 'Mechanism', icon: '🛠️', blurb: 'Tools, clockwork, electronics, engineered assemblies' },
  essence:   { name: 'Essence',   icon: '✨', blurb: 'Abstract, magical, emotional, artistic, or symbolic energy' }
};
const GRADE_META = {
  basic:      { name: 'Basic',      rank: 0 },
  improved:   { name: 'Improved',   rank: 1 },
  advanced:   { name: 'Advanced',   rank: 2 },
  superior:   { name: 'Superior',   rank: 3 },
  masterwork: { name: 'Masterwork', rank: 4 }
};
const matId = (family, grade) => `mat_${family}_${grade}`;
const materials = [];
for (const family of FAMILIES) {
  for (const grade of GRADES) {
    const rank = GRADE_META[grade].rank;
    materials.push({
      id: matId(family, grade),
      family, grade,
      displayName: `${GRADE_META[grade].name} ${FAMILY_META[family].name}`,
      icon: FAMILY_META[family].icon,
      conversionTarget: rank < 4 ? matId(family, GRADES[rank + 1]) : null,
      conversionCost: rank < 4 ? balance.upcraftRatio : null
    });
  }
}

// ---------------------------------------------------------------- components
// Component family -> underlying material pair (see GDD 6.3)
const COMPONENT_PAIRS = {
  framework: { name: 'Framework', icon: '🏗️', pair: ['metal', 'mineral'],     use: 'Rigid structures, emblems, protective forms' },
  weave:     { name: 'Weave',     icon: '🪡', pair: ['fiber', 'compound'],    use: 'Attire, coverings, documents, soft assemblies' },
  focus:     { name: 'Focus',     icon: '🔮', pair: ['mineral', 'essence'],   use: 'Keepsakes, symbols, magical or intellectual objects' },
  apparatus: { name: 'Apparatus', icon: '🔧', pair: ['mechanism', 'metal'],   use: 'Tools, devices, professional equipment' },
  binding:   { name: 'Binding',   icon: '🎀', pair: ['fiber', 'essence'],     use: 'Personal accessories, seals, social or emotional objects' },
  matrix:    { name: 'Matrix',    icon: '🧬', pair: ['compound', 'mechanism'],use: 'Complex signature items and transformative assemblies' }
};
const compId = (family, grade) => `comp_${family}_${grade}`;
const components = [];
for (const [family, meta] of Object.entries(COMPONENT_PAIRS)) {
  for (const grade of GRADES) {
    components.push({
      id: compId(family, grade),
      family, grade,
      displayName: `${GRADE_META[grade].name} ${meta.name}`,
      icon: meta.icon,
      use: meta.use,
      inputs: [
        { materialId: matId(meta.pair[0], grade), qty: 3 },
        { materialId: matId(meta.pair[1], grade), qty: 2 }
      ]
    });
  }
}

// ---------------------------------------------------------------- worlds
const worlds = [
  {
    id: 'world_hidden_village',
    displayName: 'Eden Hidden Village',
    tagline: 'A waterfall-veiled shinobi enclave waging a secret war against spirits, curses, and the masks of empire.',
    palette: { primary: '#53624b', accent: '#c65b71', dark: '#181621' },
    icon: '🏯',
    campaignId: 'wc_world_hidden_village',
    archiveId: 'archive_world_hidden_village'
  },
  {
    id: 'world_magic_academy',
    displayName: 'Eden Magic Academy',
    tagline: 'A colorful sanctuary where magical opposites, school friendships, and spectacular accidents find harmony.',
    palette: { primary: '#7063c8', accent: '#f0b6e7', dark: '#242049' },
    icon: '🏰',
    campaignId: 'wc_world_magic_academy',
    archiveId: 'archive_world_magic_academy'
  }
];

// ---------------------------------------------------------------- archetypes
const ARCHETYPES = {
  leader:     { name: 'Leader',      icon: '👑', bias: ['mechanism', 'metal'],  space: 'Decisive, responsible, commanding, influential' },
  caretaker:  { name: 'Caretaker',   icon: '🕊️', bias: ['essence', 'fiber'],    space: 'Protective, supportive, diplomatic, nurturing' },
  achiever:   { name: 'Achiever',    icon: '🏅', bias: ['metal', 'mechanism'],  space: 'Ambitious, disciplined, competitive, career-focused' },
  rebel:      { name: 'Rebel',       icon: '🔥', bias: ['compound', 'mechanism'], space: 'Defiant, independent, disruptive, unconventional' },
  dreamer:    { name: 'Dreamer',     icon: '🌙', bias: ['essence', 'mineral'],  space: 'Imaginative, curious, scholarly, spiritual, idealistic' },
  freespirit: { name: 'Free Spirit', icon: '🪁', bias: ['fiber', 'essence'],    space: 'Playful, impulsive, adventurous, relaxed, hedonistic' }
};

// ---------------------------------------------------------------- characters
const SLOTS = ['attire', 'tool', 'accessory', 'keepsake', 'emblem', 'signature'];
const SLOT_META = {
  attire:    { name: 'Attire',         icon: '🧥' },
  tool:      { name: 'Tool',           icon: '🛠️' },
  accessory: { name: 'Accessory',      icon: '📿' },
  keepsake:  { name: 'Keepsake',       icon: '🎁' },
  emblem:    { name: 'Emblem',         icon: '🛡️' },
  signature: { name: 'Signature Item', icon: '🌟' }
};

// Equipment line names: each character has six recurring visual lines.
function lines(a, t, ac, k, e, s) {
  return { attire: a, tool: t, accessory: ac, keepsake: k, emblem: e, signature: s };
}

// `tier`, `starting` and `color` are still accepted positionally so the cast
// below reads unchanged; none of them reaches the manifest.
function hero(id, displayName, world, archetype, faction, tier, starting, color, description, lore, equipmentLines) {
  return { id, displayName, world, archetype, faction, description, lore, equipmentLines };
}

const characters = [
  hero('char_suzume', 'Suzume', 'world_hidden_village', 'achiever', 'faction_village_shadows', 'minor', true, '#8895a8',
    'An aspiring kunoichi who turns relentless practice and silver bells into impossible stealth.',
    'Born without a prodigy’s shortcuts, Suzume measures every movement against the bells woven into her hair and wrists. She longs to be seen by the village while training to become invisible, and studies Kimiko with equal parts jealousy, admiration, and concern.',
    lines('Bell-Woven Shinobi Garb', 'Vibration Kunai', 'Silver Training Bells', 'Kimiko Movement Notes', 'Unseen Aspirant Mark', 'Measure of Absolute Silence')),
  hero('char_hoshi', 'Hoshi', 'world_hidden_village', 'caretaker', 'faction_spiritwardens', 'minor', true, '#c7a85a',
    'A patient exorcist-monk who shares his prayer beads—and occasionally his limbs—with the spirit Ren.',
    'Hoshi crosses corrupted country as a wandering sanctuary. He believes compassion can redeem the arrogant chaos spirit bound to his iron beads; Ren believes he is merely waiting for the monk to crack.',
    lines('Pilgrim Monk Robes', 'Iron Palm Wrappings', 'Ren’s Iron Prayer Beads', 'Vow of Patient Mercy', 'Living Ward Sutra', 'Ren’s Unbound Manifestation')),
  hero('char_ayame', 'Ayame', 'world_hidden_village', 'leader', 'faction_spiritwardens', 'minor', true, '#f0cfda',
    'A luminous noble whose pure soul comforts the cursed—and irresistibly attracts the dark.',
    'Ayame leads through empathy rather than command. She bears crushing guilt for every protector endangered by her Beacon, yet remains the person most capable of calling Genjiro, Mei, and the others back to their humanity.',
    lines('Highborn Beacon Silks', 'Ornate Prayer Mirror', 'Handmade Guard Ribbons', 'Names of the Fallen', 'Luminous Lotus Crest', 'Sanctuary of the Pure Soul')),
  hero('char_mei', 'Mei', 'world_hidden_village', 'rebel', 'faction_hollow_masks', 'minor', false, '#d9697d',
    'A cheerful tea-house server whose harmless mask conceals a predator armed with invisible silver threads.',
    'Mei hunts people she considers pretenders while rationalizing her own perfect false persona. She searches for a genuinely authentic soul, uncertain whether she would protect it or delight in proving it can break.',
    lines('Teahouse Server Kimono', 'Silver Killing Threads', 'Callused Finger Guards', 'Genuine Soul Contract', 'Smiling Server Pin', 'Puppeteer’s Web')),
  hero('char_tsubaki', 'Tsubaki', 'world_hidden_village', 'freespirit', 'faction_village_shadows', 'minor', false, '#a96b73',
    'A sake-loving sensory specialist who becomes terrifyingly precise when clarity pills restore her Open Gates.',
    'Tsubaki drinks to dampen the agonizing supernatural noise she perceives everywhere. The village prizes her as its ultimate radar, but every mission that demands sobriety returns her to a world of unbearable clarity.',
    lines('Sake-Stained Field Garb', 'Open-Gates Sensor Tags', 'Apothecary Clarity Pills', 'Ever-Full Sake Gourd', 'Village Radar Seal', 'One Minute of Perfect Silence')),
  hero('char_genjiro', 'Genjiro', 'world_hidden_village', 'achiever', 'faction_spiritwardens', 'medium', false, '#58606b',
    'A cursed ronin who hunts Yokai through the spiritual seams revealed by his parasitic Jagan.',
    'Genjiro clings to samurai discipline while the Evil Eye whispers away his empathy. He seeks the demon that branded him, hoping revenge can become liberation before the hunter turns into the monster.',
    lines('Weathered Ronin Haori', 'Spirit-Slayer Blade', 'Jagan Eye Patch', 'Broken Clan Token', 'Exorcist’s Knot', 'Demon-Seam Scabbard')),
  hero('char_kaguya', 'Kaguya', 'world_hidden_village', 'dreamer', 'faction_village_shadows', 'medium', false, '#d3ad63',
    'A high-society infiltrator whose gold-threaded kimono is woven from stolen memories and imperial secrets.',
    'Kaguya is the village’s living archive and its most guarded asset. Emotional fragments from a thousand lives bleed into her own until she can barely hear the self buried beneath them.',
    lines('Gilded Memory Kimono', 'Soul-Thread Folding Fan', 'Imperial Secret Hairpin', 'Unstolen Childhood Memory', 'Living Archive Crest', 'Unraveled Golden Thread')),
  hero('char_yuki', 'Yuki', 'world_hidden_village', 'caretaker', 'faction_spiritwardens', 'major', false, '#76519c',
    'The purple synthesis of rival Red and Blue Oni, guarding the forgotten shrine that stabilizes her divided soul.',
    'Yuki balances apocalyptic rage against bottomless sorrow. She trusts animals more easily than humans and protects the forgotten shrine because its ancient anchor is the only thing keeping two warring selves whole.',
    lines('Shrinekeeper’s Living Armor', 'Harmonic Oni Kanabo', 'Red-and-Blue Horn Rings', 'Rescued Bird’s Feather', 'Forgotten Gods Seal', 'Purple Synthesis Core')),
  hero('char_kimiko', 'Kimiko', 'world_hidden_village', 'achiever', 'faction_village_shadows', 'major', false, '#ddd8d2',
    'The village’s perfect kunoichi, carrying centuries of lethal skill inside the identity-devouring Eternal Fox Mask.',
    'Kimiko’s effortless mastery belongs to the ancestral voices consuming her. She envies strugglers like Suzume because their mistakes—and therefore their lives—remain truly their own.',
    lines('Ancestral Kunoichi Garb', 'Thousand-Face Kunai', 'Eternal Fox Mask', 'Forgotten Favorite Sweet', 'Chorus-Bearer Seal', 'Kimiko’s Unwritten Face')),
  hero('char_sakura', 'Sakura', 'world_hidden_village', 'leader', 'faction_hollow_masks', 'major', false, '#eee7df',
    'A false saint who devours spirits, memories, and powers in pursuit of a world-ending Singular Peace.',
    'Behind immaculate Miko robes, Sakura cultivates holiness as bait. She believes individuality is the source of suffering and seeks godhood by absorbing every soul into one consciousness: her own.',
    lines('Immaculate Miko Robes', 'Soul-Harvesting Talismans', 'Vein-Red Ribbons', 'First Devoured Prayer', 'False Saint Halo', 'Divine Archive Seal')),

  hero('char_ashley', 'Ashley', 'world_magic_academy', 'freespirit', 'faction_spark_stone', 'minor', true, '#ee6b4d',
    'A first-year Fire student and human spark plug who turns every idea into an adventure before thinking twice.',
    'Ashley talks at the speed of ignition and singes textbooks whenever excitement outruns control. Bridget complains through every spontaneous escapade and follows anyway.',
    lines('Singe-Hem First-Year Uniform', 'Overcharged Fire Wand', 'Emberproof Hair Ribbon', 'Bridget’s Spare Timetable', 'First-Year Flame Crest', 'Uncontained Spark')),
  hero('char_bridget', 'Bridget', 'world_magic_academy', 'caretaker', 'faction_spark_stone', 'minor', true, '#9b8066',
    'A stoic first-year Ground student whose careful stability anchors Ashley’s fire and their shared misadventures.',
    'Bridget maintains schedules, rules, and a permanently exhausted sigh. Her Ground magic is as dependable as her loyalty, including the loyalty she pretends not to feel for Ashley’s chaos.',
    lines('Immaculate First-Year Uniform', 'Grounding Staff', 'Stone-Set Planner Clasp', 'Ashley’s Burned Apology Note', 'Foundation Magic Crest', 'Unshakable Anchor')),
  hero('char_elian', 'Elian', 'world_magic_academy', 'achiever', 'faction_rulebook_wildcard', 'minor', false, '#a9d8ec',
    'A high-strung second-year Ice student trying to calculate the correct formula for being liked.',
    'Elian applies rules and precision to social life with endearingly disastrous results. Tix treats every failed calculation as an invitation to loosen the rulebook and follow the wind.',
    lines('Regulation Second-Year Robes', 'Precision Ice Focus', 'Perfect Attendance Brooch', 'Annotated Social Rulebook', 'Frost Honors Crest', 'Calculated Perfect Introduction')),
  hero('char_tix', 'Tix', 'world_magic_academy', 'freespirit', 'faction_rulebook_wildcard', 'minor', false, '#6fc77d',
    'A whimsical Nature student followed by a fairy, runaway vines, and almost no awareness of social convention.',
    'Tix talks to plants, wanders into hedges, and follows Pip’s worst ideas with complete confidence. She adores Elian and considers helping her relax a deeply serious magical project.',
    lines('Vine-Tangled Second-Year Uniform', 'Wildgrowth Wand', 'Pip’s Acorn Satchel', 'Elian’s Revised Rulebook', 'Wandering Bloom Crest', 'Greenhouse That Followed Her Home')),
  hero('char_carol', 'Carol', 'world_magic_academy', 'leader', 'faction_spotlight_shadow', 'minor', false, '#e8c34f',
    'A charismatic third-year Lightning student whose confidence makes every corridor feel like a stage.',
    'Carol loves the spotlight without needing its approval. Her constant game of provocation and banter with the unflappable Kin works because neither asks the other to become less themselves.',
    lines('Third-Year Duelling Jacket', 'Lightning Conductor Baton', 'Spotlight Earrings', 'Kin’s Deadpan Review', 'Storm Stage Medal', 'Academy’s Brightest Thunder')),
  hero('char_kin', 'Kin', 'world_magic_academy', 'rebel', 'faction_spotlight_shadow', 'medium', false, '#6b7186',
    'A dry-witted Dark Elf and Mist student who manages the shadows while Carol commands the spotlight.',
    'Kin is a loner by choice, observant enough to notice every room and composed enough to leave it unseen. Carol remains the rare person who can turn his silence into a game.',
    lines('Mistweave Third-Year Coat', 'Vapor-Etching Dagger', 'Dark-Elf Silver Earcuff', 'Carol’s Backstage Pass', 'Quiet Wings Emblem', 'Shadow Behind the Spotlight')),
  hero('char_liadriel', 'Liadriel', 'world_magic_academy', 'caretaker', 'faction_sun_eclipse', 'medium', false, '#f3dc79',
    'The Academy’s radiant fourth-year idol, greeting every supposed enemy as a friend awaiting a hug.',
    'Liadriel’s Light magic and kindness are equally impossible to hide. She interprets Malefia’s lifelong rivalry as affectionate play, to the Dark Queen’s endless theatrical despair.',
    lines('Golden Fourth-Year Vestments', 'Sunbeam Scepter', 'Glittering Halo Ribbon', 'Malefia’s First Challenge Letter', 'Eden Idol Crest', 'Light That Calls Everyone Friend')),
  hero('char_malefia', 'Malefia', 'world_magic_academy', 'achiever', 'faction_sun_eclipse', 'medium', false, '#49365f',
    'A formidable Darkness student and self-proclaimed Dark Queen staging an epic rivalry Liadriel thinks is adorable.',
    'Malefia treats every entrance as theatre and every contest as proof that shadow surpasses light. Liadriel’s compliments and hugs remain the one counterspell her oppressive darkness cannot defeat.',
    lines('Gothic Fourth-Year Regalia', 'Umbral Parasol', 'Obsidian Eclipse Choker', 'Liadriel’s Friendship Bracelet', 'Dark Queen Crest', 'Grand Entrance of Endless Night')),
  hero('char_aurora', 'Aurora', 'world_magic_academy', 'dreamer', 'faction_anchor_balloon', 'medium', false, '#e99abd',
    'The Academy’s whimsical Love-Alchemy teacher, relationship counselor, and champion of creative sparks.',
    'Aurora brews emotional teas, excuses inspired deadlines, and sees possibility in every magical accident. Irina supplies the structure that lets her warmth flourish without taking down the west wing.',
    lines('Rose-Scented Alchemy Coat', 'Heart-Shaped Crucible', 'Matchmaking Tea Vials', 'Irina’s First Detention Slip', 'Love Alchemy Faculty Pin', 'Elixir of the Creative Spark')),
  hero('char_irina', 'Irina', 'world_magic_academy', 'leader', 'faction_anchor_balloon', 'major', false, '#5962a5',
    'The Spatial Summoning teacher whose perfect geometry keeps the Academy’s affectionate chaos operational.',
    'Irina portals away explosions before handing out detention slips. Her precision masks fierce care for every student, while Aurora’s warmth keeps the Chief of Operations from becoming only a machine.',
    lines('Spatial Faculty Uniform', 'Geometric Summoning Compass', 'Master Portal Keys', 'Aurora’s Impossible Lab Inventory', 'Operations Faculty Seal', 'Academy in Perfect Alignment'))
];

// ---------------------------------------------------------------- tags
const tags = [
  // World tag rules (stacking groups: cohesion / diversity)
  {
    id: 'tag_world_cohesion', displayName: 'World Cohesion', category: 'world',
    activationRule: 'same_world_count', stackingGroup: 'world_cohesion',
    thresholds: [ { count: 3, bonusBp: 400 }, { count: 4, bonusBp: 800 }, { count: 5, bonusBp: 1200 } ],
    explanation: 'Characters who share a home world resonate together.'
  },
  {
    id: 'tag_world_diversity', displayName: 'World Diversity', category: 'world',
    activationRule: 'distinct_world_count', stackingGroup: 'world_diversity',
    thresholds: [ { count: 2, bonusBp: 400 }, { count: 3, bonusBp: 600 }, { count: 4, bonusBp: 900 }, { count: 5, bonusBp: 1200 } ],
    explanation: 'A party drawn from many worlds broadens its perspective.'
  },
  // Archetype synergy ring — each pair checks presence, not quantity
  ...[
    ['leader', 'achiever'], ['achiever', 'rebel'], ['rebel', 'freespirit'],
    ['freespirit', 'dreamer'], ['dreamer', 'caretaker'], ['caretaker', 'leader']
  ].map(([a, b]) => ({
    id: `tag_ring_${a}_${b}`,
    displayName: `${ARCHETYPES[a].name} + ${ARCHETYPES[b].name}`,
    category: 'archetype',
    activationRule: 'archetype_pair', pair: [a, b],
    stackingGroup: `ring_${a}_${b}`,
    thresholds: [ { count: 1, bonusBp: 300 } ],
    explanation: `${ARCHETYPES[a].name} and ${ARCHETYPES[b].name} complement one another.`
  })),
  // Faction tags
  ...[
    ['faction_village_shadows', 'Village Shadows', 'Shinobi trained to work inside the Hidden Village’s silence.', true],
    ['faction_spiritwardens', 'Spiritwardens', 'Protectors who stand between vulnerable souls and the supernatural dark.', true],
    ['faction_hollow_masks', 'Hollow Masks', 'Predators whose convincing public faces conceal terrible private hungers.', false],
    ['faction_spark_stone', 'Spark and Stone', 'Ashley supplies momentum; Bridget makes sure it has somewhere safe to land.', false],
    ['faction_rulebook_wildcard', 'Rulebook and Wildcard', 'Elian’s order and Tix’s freedom pull one another toward balance.', false],
    ['faction_spotlight_shadow', 'Spotlight and Shadow', 'Carol commands the stage while Kin quietly manages its edges.', false],
    ['faction_sun_eclipse', 'Sun and Eclipse', 'Liadriel’s warmth and Malefia’s darkness create their own harmony.', false],
    ['faction_anchor_balloon', 'Anchor and Balloon', 'Irina gives Aurora structure; Aurora gives Irina room to breathe.', false]
  ].map(([id, displayName, explanation, large]) => ({
    id, displayName, category: 'faction', activationRule: 'tag_count', stackingGroup: id,
    thresholds: large ? [ { count: 2, bonusBp: 200 }, { count: 3, bonusBp: 400 } ] : [ { count: 2, bonusBp: 200 } ],
    explanation
  }))
];

// ---------------------------------------------------------------- recipes
// Tier profiles (GDD 6.5): grade, component structure, quantity scaling.
const tierProfiles = [
  { tier: 1,  grade: 'basic',      primaryQty: 2, secondaryQty: 0, stage: 'Basic; simple components' },
  { tier: 2,  grade: 'basic',      primaryQty: 3, secondaryQty: 0, stage: 'Basic; increased quantities' },
  { tier: 3,  grade: 'improved',   primaryQty: 2, secondaryQty: 1, stage: 'Improved' },
  { tier: 4,  grade: 'improved',   primaryQty: 3, secondaryQty: 1, stage: 'Improved; multiple components' },
  { tier: 5,  grade: 'advanced',   primaryQty: 2, secondaryQty: 1, stage: 'Advanced' },
  { tier: 6,  grade: 'advanced',   primaryQty: 3, secondaryQty: 2, stage: 'Advanced; increased quantities' },
  { tier: 7,  grade: 'superior',   primaryQty: 2, secondaryQty: 1, stage: 'Superior' },
  { tier: 8,  grade: 'superior',   primaryQty: 3, secondaryQty: 2, stage: 'Superior; complex mixes' },
  { tier: 9,  grade: 'masterwork', primaryQty: 2, secondaryQty: 1, stage: 'Masterwork' },
  { tier: 10, grade: 'masterwork', primaryQty: 3, secondaryQty: 2, stage: 'Masterwork; final recipes' }
];

// Slot -> natural component affinity (GDD 6.3 typical uses)
const SLOT_COMPONENT = {
  attire: 'weave', tool: 'apparatus', accessory: 'binding',
  keepsake: 'focus', emblem: 'framework', signature: 'matrix'
};
// Archetype -> preferred secondary component: pick the component whose material
// pair best overlaps the archetype's material bias.
function archetypeSecondary(archetype, primary) {
  const bias = ARCHETYPES[archetype].bias;
  let best = null, bestScore = -1;
  for (const [family, meta] of Object.entries(COMPONENT_PAIRS)) {
    if (family === primary) continue;
    const score = meta.pair.filter(m => bias.includes(m)).length;
    if (score > bestScore) { best = family; bestScore = score; }
  }
  return best;
}
const recipeTemplates = [];
for (const archetype of Object.keys(ARCHETYPES)) {
  for (const slot of SLOTS) {
    const primary = SLOT_COMPONENT[slot];
    recipeTemplates.push({
      id: `tpl_${archetype}_${slot}`,
      archetype, slot,
      primaryComponent: primary,
      secondaryComponent: archetypeSecondary(archetype, primary)
    });
  }
}

// Tier name prefixes for equipment presentation across the ten tiers.
const TIER_PREFIXES = ['', 'Sturdy ', 'Refined ', 'Tempered ', 'Gleaming ', 'Exquisite ', 'Superior ', 'Ornate ', 'Masterwork ', 'Mythic '];

// ------------------------------------------------------- campaign node names
// Node names are the only campaign content a publication supplies. Their
// thresholds, material families and grades, types, rewards, relic positions
// and reveal placements are compiled from balance.campaigns, so renaming a
// node here can never move any of them.
const MAIN_NODE_NAMES = [
  ['Cliffside Waterfall Path', 'First-Year Arrival Gate', 'Bell-Silent Training Yard', 'A Spark in the Alchemy Wing',
   'Shrine Road Under Lanterns', 'Detention in the Moving Greenhouse', 'Masks at the Moonlit Tea House',
   'Mist-Lost Library', 'Corruption Beneath the Torii', 'Checkpoint: Two Edens, One Omen'],
  ['The Jagan Tracks an Echo', 'Spatial Breach in Lecture Hall Three', 'Gold Threads in the Imperial Quarter',
   'The Sun and Eclipse Duel', 'The Forgotten Shrine Stirs', 'Summons Loose in the Courtyard',
   'Foxfire Through the Waterfalls', 'The Heart-Shaped Crucible', 'The False Saint Opens the Gate',
   'Checkpoint: Shadows Across the Academy']
];
const MAIN_CHAPTER_TITLES = ['Two Edens, One Omen', 'Shadows Across the Academy'];

const WC_CHAPTER_TITLES = {
  world_hidden_village: ['Behind the Waterfall Veil', 'Shrines and Hungry Spirits', 'Masks of the Imperial Night'],
  world_magic_academy: ['First-Year Misadventures', 'Lessons in Complementary Magic', 'The Faculty\u2019s Impossible Semester']
};
const WC_NAMES = {
  world_hidden_village: [
    ['Waterfall Veil Approach', 'Cliff-Carved Gate', 'Apothecary of Clear Sight', 'Bells on the Training Roof',
     'Kunoichi Trial Grounds', 'Rope Bridge in the Mist', 'Shinobi Archive Vault', 'Moonlit Watchtower',
     'Forest Perimeter Breach', 'Lanterns at the Village Seal'],
    ['Forgotten Shrine Road', 'Foxfire Cedar Grove', 'Corrupted Wayside Altar', 'Oni Footprints in Snow',
     'Hoshi\u2019s Living Ward', 'Red Ravine', 'Blue Silence Lake', 'The Purple Guardian',
     'Cavern of Spiritual Seams', 'Shrine That Holds the Mountain'],
    ['Dangerous District Tea House', 'Silver Threads Above the Alley', 'Samurai Gate of Honor',
     'Gilded Geisha House', 'Court of a Thousand Masks', 'Memory Market at Midnight', 'Beacon\u2019s Procession',
     'False Saint\u2019s Sanctuary', 'Palace Roofs Under Foxfire', 'Hidden War Revealed']
  ],
  world_magic_academy: [
    ['Prismatic Arrival Gate', 'First-Year Homeroom', 'Singed Textbook', 'Grounded Practice Hall',
     'Alchemy Lab Tea Break', 'Greenhouse Gone Wild', 'Mist in the Library Stacks',
     'Lightning on the Duelling Lawn', 'Dormitory Curfew Dash', 'Welcome Festival'],
    ['Spatial Geometry Classroom', 'Misplaced Summoning Circle', 'Icebound Rulebook Trial',
     'Fire Safety Detention', 'Love Potion Misdelivery', 'Pip\u2019s Hedge Maze', 'Darkness in the Auditorium',
     'Light Across the Observatory', 'Faculty Operations Office', 'Midterm Practical: Controlled Chaos'],
    ['Moonlit School Ball', 'Spotlight and Shadow Backstage', 'Sun-Eclipse Challenge',
     'Hall of Complementary Elements', 'Walking Tower Staircase', 'Alchemy Fair Catastrophe',
     'Summoned Guests at Dinner', 'Garden Beneath the Academy', 'Heart of Eden\u2019s Leyline',
     'Final Examination: Harmony']
  ]
};

// ------------------------------------------------------------------- relics
const RELICS = {
  world_hidden_village: {
    name: 'The Unbroken Bell',
    lore: 'Cast for a village that had to learn silence, and broken on the night it first needed to be heard.',
    pieces: [
      ['Silent Bell Crown', 'The lip of the bell, filed smooth so it would never ring by accident.'],
      ['Shinobi Code Tablet', 'The clause that made silence a duty rather than a skill.'],
      ['Red-Blue Binding Seal', 'A ward pressed by two hands that did not trust each other.'],
      ['Porcelain Fox Mask Fragment', 'What the empire left behind when the masks came off.']
    ]
  },
  world_magic_academy: {
    name: 'The Harmonic Orrery',
    lore: 'Built by a faculty that could not agree, and therefore proved that opposites hold each other up.',
    pieces: [
      ['Ice Geometry Compass', 'Draws only shapes that can bear weight.'],
      ['Heart-Shaped Crucible', 'Every reaction it holds ends warmer than it began.'],
      ['Spatial Master Key', 'Opens the corridor you needed, not the one you asked for.'],
      ['Final Harmony Diploma', 'Signed by everyone who once refused to sign anything together.']
    ]
  }
};

// -------------------------------------------------------- Mastery cosmetics
// Ordered: the first goes to the first cosmetic milestone, and so on. Which
// Mastery rank that is stays in balance.mastery.cosmeticRanks.
const COSMETICS = {
  world_hidden_village: [
    ['char_suzume', 'Suzume \u2014 Festival of Silent Bells'],
    ['char_yuki', 'Yuki \u2014 Shrine in Bloom'],
    ['char_kaguya', 'Kaguya \u2014 Unwoven Gold'],
    ['char_kimiko', 'Kimiko \u2014 Dawn Without the Mask']
  ],
  world_magic_academy: [
    ['char_ashley', 'Ashley \u2014 Founders\u2019 Festival Fireworks'],
    ['char_malefia', 'Malefia \u2014 Radiant Eclipse Formal'],
    ['char_aurora', 'Aurora \u2014 Hearts-in-Bloom Faculty Dress'],
    ['char_irina', 'Irina \u2014 Midnight Observatory Uniform']
  ]
};

// ---------------------------------------------------------------- write files
// The shipped game is SYSTEM content only (rules-level data: balance,
// archetypes, materials, components, recipes, universal tag rules). Everything
// playable travels as a Creative Manifest: identities, names, lore and art.
// The sample manifest below is what the tests compile against.

const manifestWorlds = worlds.map(world => ({
  id: world.id,
  displayName: world.displayName,
  tagline: world.tagline,
  description: world.tagline,
  icon: world.icon,
  palette: world.palette,
  image: null,
  chapterTitles: WC_CHAPTER_TITLES[world.id],
  chapterImages: [null, null, null],
  nodeNames: WC_NAMES[world.id].flat(),
  relic: {
    name: RELICS[world.id].name,
    lore: RELICS[world.id].lore,
    pieces: RELICS[world.id].pieces.map(([name, lore]) => ({ name, lore, image: null }))
  },
  masteryCosmetics: COSMETICS[world.id].map(([characterId, name]) => ({
    characterId, name, portrait: null, fullBody: null
  }))
}));

// Roster order is meaning: the first five of a world are the ones the Main
// Campaign introduces, which is what makes that world openable at all.
const manifestCharacters = manifestWorlds.flatMap(world =>
  characters.filter(c => c.world === world.id).map(c => ({
    id: c.id,
    worldId: c.world,
    displayName: c.displayName,
    description: c.description,
    lore: c.lore,
    archetype: c.archetype,
    faction: c.faction ?? null,
    portrait: null,
    fullBody: null,
    equipment: Object.fromEntries(SLOTS.map(slot => [slot, { name: c.equipmentLines[slot], image: null }]))
  })));

// ----------------------------------------------------- Expedition archetypes
// The route library is the game's, not a publication's. Each archetype owns
// its party size, predicates, reward curve, Power ratio and frequency; when a
// world arrives, the compiler makes world-scoped variants of the world-scoped
// ones automatically. Requirement prose is rendered from the predicate, so a
// `distinct_worlds: 3` route already knows how to describe itself.
const RANDOM_MATERIAL = '@random_material';
const material = (grade, min, max) => ({ kind: 'material', id: RANDOM_MATERIAL, grade, min, max });
const intel = (min, max = min) => ({ kind: 'resource', id: 'intelligence', min, max });

const expeditionArchetypes = [
  {
    id: 'field_supply', scope: 'global', weight: 0, partySize: 2,
    // The one route that always appears. That guarantee is an engine rule:
    // the board reserves a place for whichever archetype carries `supply`.
    supply: true,
    requirements: [{ type: 'distinct_archetypes', count: 2 }],
    requirementCount: 1,
    optionals: [{ type: 'distinct_worlds', count: 2 }],
    reward: { entries: [material('basic', 3, 5), intel(1)] },
    powerRatioBp: [9000, 10000],
    titles: ['A Field Cache Beyond the Gate'],
    descriptions: ['A reliable route to the provisions that can carry a goal a little further.']
  },
  {
    id: 'procurement', scope: 'world', weight: 10, partySize: 2,
    requirements: [{ type: 'world_count', count: 1 }, { type: 'combined_stars', count: 4 }],
    requirementCount: 1,
    optionals: [{ type: 'distinct_archetypes', count: 2 }, { type: 'combined_stars', count: 6 }],
    reward: { entries: [material('improved', 3, 5)] },
    powerRatioBp: [9000, 10500],
    titles: ['Supply Line: {world}', 'Procurement Run in {world}'],
    descriptions: ['Ordinary work, carefully done, and the stores at {world} come back full.']
  },
  {
    id: 'character_lead', scope: 'world', weight: 4, partySize: 2,
    requirements: [{ type: 'world_count', count: 1 }],
    requirementCount: 1,
    optionals: [{ type: 'star_character', stars: 3, count: 1 }, { type: 'distinct_worlds', count: 2 }],
    // A lead range makes this a character-lead route: the player chooses a
    // revealed hero of the route's world at launch.
    reward: {
      entries: [material('basic', 2, 4)],
      rare: [{ kind: 'resource', id: 'intelligence', qty: 1, chanceBp: 7000 }],
      shardPool: 'associated_or_any', shardRange: [2, 4]
    },
    powerRatioBp: [9500, 10500],
    titles: ['A Promising Lead in {world}', 'Reconnaissance in {world}'],
    descriptions: ['Someone in {world} is worth finding, and worth bringing home.']
  },
  {
    id: 'world_specialist', scope: 'world', weight: 8, partySize: 3,
    requirements: [{ type: 'same_world', count: 2 }, { type: 'world_count', count: 2 }],
    requirementCount: 1,
    optionals: [{ type: 'combined_stars', count: 6 }, { type: 'power_over_recommended', percentBp: 1000 }],
    reward: { entries: [material('improved', 4, 8), intel(1)] },
    powerRatioBp: [10000, 11000],
    titles: ['{world} Specialist Route', 'Work Only {world} Can Finish'],
    descriptions: ['The kind of errand that asks for people who already know {world}.']
  },
  {
    id: 'archetype_specialist', scope: 'global', weight: 6, partySize: 2,
    requirements: [{ type: 'distinct_archetypes', count: 2 }, { type: 'star_character', stars: 3, count: 1 }],
    requirementCount: 1,
    optionals: [{ type: 'distinct_worlds', count: 2 }, { type: 'combined_stars', count: 6 }],
    reward: { entries: [intel(1, 2), material('basic', 2, 3)] },
    powerRatioBp: [9000, 10000],
    titles: ['A Question of Temperament', 'The Right Hands for It'],
    descriptions: ['A brief that asks for a particular turn of mind rather than a particular home.']
  },
  {
    id: 'same_world_squad', scope: 'global', weight: 6, partySize: 3,
    requirements: [{ type: 'same_world', count: 3 }],
    requirementCount: 1,
    optionals: [{ type: 'combined_stars', count: 9 }, { type: 'star_character', stars: 4, count: 1 }],
    reward: { entries: [material('improved', 4, 6), intel(1)] },
    powerRatioBp: [10000, 11000],
    titles: ['People Who Already Trust Each Other', 'One House, One Road'],
    descriptions: ['Work that goes faster when nobody has to be introduced.']
  },
  {
    id: 'diverse_coalition', scope: 'global', weight: 6, partySize: 3,
    requirements: [{ type: 'distinct_worlds', count: 3 }, { type: 'distinct_archetypes', count: 3 }],
    requirementCount: 1,
    optionals: [{ type: 'combined_stars', count: 9 }, { type: 'power_over_recommended', percentBp: 1000 }],
    reward: { entries: [material('advanced', 3, 5), intel(1, 2)] },
    powerRatioBp: [10000, 11500],
    titles: ['A Map Left Unfinished', 'Quiet Roads, Useful Rumours'],
    descriptions: ['The work asks for breadth rather than battle.']
  },
  {
    id: 'high_power', scope: 'global', weight: 4, partySize: 4,
    requirements: [{ type: 'combined_stars', count: 12 }, { type: 'star_character', stars: 5, count: 1 }],
    requirementCount: 1,
    optionals: [{ type: 'power_over_recommended', percentBp: 1500 }, { type: 'distinct_worlds', count: 3 }],
    reward: {
      entries: [material('advanced', 5, 8), intel(2)],
      rare: [{ kind: 'resource', id: 'intelligence', qty: 2, chanceBp: 8000 }]
    },
    powerRatioBp: [11000, 12500],
    titles: ['Work Beyond the Gate', 'The Road That Asks Too Much'],
    descriptions: ['A long venture that pays what it costs, and only to a party that can afford it.']
  }
];

const expeditions = {
  settings: {
    offerCount: 5, slotCount: 3, freeRerolls: 1, freePins: 1, minimumFeasible: 2,
    generationAttempts: 40, cycleLengthDays: 4, cycleScaleBp: 40000,
    intelligenceCosts: { reroll: 1, pin: 1, reveal: 1 },
    resultMultipliersBp: { completed: 10000, successful: 12500, exceptional: 15000 }
  },
  archetypes: expeditionArchetypes,
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

// ---------------------------------------------------------- Crisis templates
// A Crisis is generated from the game's own Front templates, scoped to an
// eligible world. Nothing about it is authored: the fiction is generic, the
// world supplies its name and artwork, and the difficulty is computed at spawn
// time from the roster the player could actually field.
const crises = {
  settings: {
    spawnChanceBp: 2500,
    grades: [
      { id: 'local', displayName: 'Local Disturbance', minOwned: 5, minMasteryRank: 'unfamiliar', frontCount: 2, teamSize: 2, powerRatioBp: 10500 },
      { id: 'major', displayName: 'Major Crisis', minOwned: 8, minMasteryRank: 'known', frontCount: 3, teamSize: 2, powerRatioBp: 11000 },
      { id: 'world', displayName: 'World Crisis', minOwned: 12, minMasteryRank: 'established', frontCount: 3, teamSize: 3, powerRatioBp: 11500 }
    ],
    // Recommended Front Power is the strongest disjoint teams the roster could
    // field, times the grade's ratio. Above 10000 that means raw Power alone
    // falls short and a matched favoured tag is what carries a Front — which is
    // the puzzle. A fixed authored number could not do this: a maxed roster
    // outgrew the hardest authored Front by three to five times.
    power: { favoredTagBonusBp: 2000, excelBp: 12000, minimumRecommended: 500 },
    // Enough distinct openings that a world's Crisis is not always the same
    // three; the grade decides how many are drawn.
    minimumClearedNodes: 3
  },
  // `favored` names the *kind* of tag a Front rewards; the compiler resolves
  // each to a concrete tag actually present in that world's roster.
  fronts: [
    { id: 'containment', name: 'Containment', favored: ['world', 'archetype'],
      description: 'Hold the edge of it before the rest of {world} has to learn the word for what happened.' },
    { id: 'relief', name: 'Relief', favored: ['archetype', 'faction'],
      description: 'People are already displaced. Someone has to reach them before the second night.' },
    { id: 'investigation', name: 'Investigation', favored: ['archetype', 'world'],
      description: 'Nobody yet knows what began this. Until someone does, every other answer is a guess.' },
    { id: 'evacuation', name: 'Evacuation', favored: ['faction', 'archetype'],
      description: 'One clear route out of {world}, held open long enough for everyone slow to use it.' },
    { id: 'intervention', name: 'Intervention', favored: ['world', 'faction'],
      description: 'The thing itself, met directly, by whoever can stand in front of it.' }
  ],
  // Front outcome prose. `{front}` is the Front's own name.
  texts: {
    struggle: '{front} held longer than the response could safely reach. Nothing was lost.',
    success: '{front} steadied under a measured response.',
    excel: '{front} was secured before the danger could spread.'
  },
  naming: {
    name: 'Emergency in {world}',
    opening: 'Something has broken open across {world}. Each front needs a different answer, and nobody can be in two places at once.'
  },
  consolation: [{ kind: 'resource', id: 'intelligence', qty: 1 }],
  // A cache names a material *family*; the grade is resolved when the Crisis
  // spawns, from the best grade that world has actually opened, so a Cache is
  // still worth taking four hundred days in.
  caches: [
    { id: 'supply', name: 'Field Supply', description: 'One stored provision for a targeted push.',
      rewards: [{ kind: 'resource', id: 'field_supply', qty: 1 }] },
    { id: 'intel', name: 'Intelligence Brief', description: 'The response leaves useful knowledge behind.',
      rewards: [{ kind: 'resource', id: 'intelligence', qty: 2 }] },
    { id: 'materials', name: 'Material Bundle', description: 'Practical salvage returns to the Workshop.',
      rewards: [{ kind: 'material', family: 'metal', qty: 8 }] },
    { id: 'components', name: 'Recovered Stock', description: 'What the response could carry back, in bulk.',
      rewards: [{ kind: 'material', family: 'mineral', qty: 6 }, { kind: 'resource', id: 'intelligence', qty: 1 }] }
  ],
  // One per world, by progression position, so worlds differ from each other.
  boons: [
    { type: 'free_world_node_runs', runs: 3, prose: 'The next three successful runs here cost no Energy.' },
    { type: 'bonus_world_material_runs', runs: 3, qty: 1, prose: 'The next three successful runs here return one additional normal material.' },
    { type: 'instant_intelligence', qty: 2, prose: 'The response yields two Intelligence immediately.' }
  ]
};

const usedFactions = new Set(manifestCharacters.map(c => c.faction).filter(Boolean));
const samplePack = {
  manifestVersion: 1,
  lineage: null,
  worlds: manifestWorlds,
  characters: manifestCharacters,
  // Faction identity travels with the manifest; how much a faction is worth in
  // a party is balance.factions, and applies to all of them equally.
  factions: tags.filter(t => t.category === 'faction' && usedFactions.has(t.id))
    .map(t => ({ id: t.id, displayName: t.displayName, explanation: t.explanation })),
  mainChapters: MAIN_NODE_NAMES.map((nodeNames, index) => ({
    title: MAIN_CHAPTER_TITLES[index], image: null, nodeNames
  })),
  // Board artwork is a publication's; the routes are generated from
  // content/expeditions.json.
  expeditionArt: { global: null, worlds: {} }
};
const systemTags = tags.filter(t => t.category !== 'faction');

const files = {
  'balance.json': balance,
  'archetypes.json': ARCHETYPES,
  'materials.json': { families: FAMILY_META, grades: GRADE_META, gradeOrder: GRADES, familyOrder: FAMILIES, materials },
  'components.json': { pairs: COMPONENT_PAIRS, components },
  'characters.json': { slots: SLOT_META, slotOrder: SLOTS, tierPrefixes: TIER_PREFIXES, characters: [] },
  'tags.json': systemTags,
  'recipes.json': { tierProfiles, templates: recipeTemplates },
  'expeditions.json': expeditions,
  'crises.json': crises,
  'sample-pack.json': samplePack
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(out, name), JSON.stringify(data, null, 2));
  console.log(`wrote content/${name}`);
}
console.log(`\nSystem: ${materials.length} materials, ${components.length} components, ${recipeTemplates.length} templates.`);
console.log(`Sample manifest: ${manifestWorlds.length} worlds, ${manifestCharacters.length} characters, ` +
  `${samplePack.mainChapters.length} Main Campaign chapters, ` +
  `${manifestWorlds.reduce((n, w) => n + w.nodeNames.length, 0)} world node names \u2014 and no numbers.`);
