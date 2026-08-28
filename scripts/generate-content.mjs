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
  acquisitionTiers: {
    minor:  { unlockStar: 1, cumulativeShards: 10 },
    medium: { unlockStar: 4, cumulativeShards: 110 },
    major:  { unlockStar: 7, cumulativeShards: 450 }
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

function hero(id, displayName, world, archetype, faction, tier, starting, color, description, lore, equipmentLines) {
  return { id, displayName, world, archetype, faction, extraTags: [], tier, starting, color, glyph: displayName[0], description, lore, equipmentLines };
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
  })),
  // Optional extra tags (species/profession-style examples)
  {
    id: 'tag_scholar', displayName: 'Scholars', category: 'profession',
    activationRule: 'tag_count', stackingGroup: 'tag_scholar',
    thresholds: [ { count: 2, bonusBp: 200 } ],
    explanation: 'Two scholars in one party never run out of theories.'
  },
  {
    id: 'tag_artisan', displayName: 'Artisans', category: 'profession',
    activationRule: 'tag_count', stackingGroup: 'tag_artisan',
    thresholds: [ { count: 2, bonusBp: 200 } ],
    explanation: 'Makers respect makers, whatever the workshop.'
  },
  {
    id: 'tag_musician', displayName: 'Musicians', category: 'profession',
    activationRule: 'tag_count', stackingGroup: 'tag_musician',
    thresholds: [ { count: 2, bonusBp: 200 } ],
    explanation: 'Two musicians will always find a duet.'
  },
  {
    id: 'tag_pilot', displayName: 'Pilots', category: 'profession',
    activationRule: 'tag_count', stackingGroup: 'tag_pilot',
    thresholds: [ { count: 2, bonusBp: 200 } ],
    explanation: 'Flyers trust flyers with the difficult routes.'
  },
  { id: 'tag_herbalist', displayName: 'Herbalist', category: 'profession', activationRule: 'tag_count', stackingGroup: 'tag_herbalist', thresholds: [], explanation: 'A flavor tag with no party bonus in the MVP.' },
  { id: 'tag_hunter', displayName: 'Hunter', category: 'profession', activationRule: 'tag_count', stackingGroup: 'tag_hunter', thresholds: [], explanation: 'A flavor tag with no party bonus in the MVP.' },
  { id: 'tag_medic', displayName: 'Medic', category: 'profession', activationRule: 'tag_count', stackingGroup: 'tag_medic', thresholds: [], explanation: 'A flavor tag with no party bonus in the MVP.' }
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

// ---------------------------------------------------------------- campaigns
const MAIN_RANGES = [[5500, 7500], [7800, 10500]];
const MAIN_GRADES = ['basic', 'improved'];
const MAIN_NODE_NAMES = [
  ['Cliffside Waterfall Path', 'First-Year Arrival Gate', 'Bell-Silent Training Yard', 'A Spark in the Alchemy Wing',
   'Shrine Road Under Lanterns', 'Detention in the Moving Greenhouse', 'Masks at the Moonlit Tea House',
   'Mist-Lost Library', 'Corruption Beneath the Torii', 'Checkpoint: Two Edens, One Omen'],
  ['The Jagan Tracks an Echo', 'Spatial Breach in Lecture Hall Three', 'Gold Threads in the Imperial Quarter',
   'The Sun and Eclipse Duel', 'The Forgotten Shrine Stirs', 'Summons Loose in the Courtyard',
   'Foxfire Through the Waterfalls', 'The Heart-Shaped Crucible', 'The False Saint Opens the Gate',
   'Checkpoint: Shadows Across the Academy']
];
const MAIN_FAMILIES = [
  ['metal', 'fiber', 'mineral', 'compound', 'mechanism', 'essence', 'metal', 'fiber', 'mineral', 'compound'],
  ['mechanism', 'essence', 'metal', 'fiber', 'mineral', 'compound', 'mechanism', 'essence', 'metal', 'fiber']
];
const SHADOW_ASSIGN = [
  'char_suzume', 'char_ashley', 'char_hoshi', 'char_bridget', 'char_ayame',
  'char_elian', 'char_mei', 'char_tix', 'char_tsubaki', 'char_carol',
  'char_genjiro', 'char_kin', 'char_kaguya', 'char_liadriel', 'char_yuki',
  'char_malefia', 'char_kimiko', 'char_aurora', 'char_sakura', 'char_irina'
];
const SHADOW_NAMES = [
  'Bells Without Sound', 'Spark in the First-Year Hall', 'Beads of the Bound Spirit', 'Stone Beneath the Flame',
  'The Beacon Draws the Dark', 'Rules Written in Ice', 'Silver Threads at the Tea House', 'The Hedge That Walked Away',
  'The Open Gates', 'Lightning Takes the Stage', 'The Jagan’s Whisper', 'Mist Behind the Spotlight',
  'Gilded Memory Threads', 'A Light Without Enemies', 'Red and Blue at the Shrine',
  'The Eclipse Issues a Challenge', 'Thousand Faces, One Mask', 'Love in the Alchemy Lab',
  'The False Saint’s Hunger', 'Every Door in Its Place'
];

function lerpThreshold(lo, hi, i, n) {
  return Math.round((lo + ((hi - lo) * i) / (n - 1)) / 50) * 50;
}

const nodes = [];
for (let ch = 0; ch < 2; ch++) {
  const [lo, hi] = MAIN_RANGES[ch];
  for (let i = 0; i < 10; i++) {
    const num = ch * 10 + i + 1;
    const isCheckpoint = (i + 1) % 5 === 0; // positions 5, 10
    const threshold = lerpThreshold(lo, hi, i, 10);
    const family = MAIN_FAMILIES[ch][i];
    const grade = MAIN_GRADES[ch];
    const node = {
      id: `main_${num}`,
      campaign: 'main', chapter: ch + 1, position: i + 1, number: num,
      displayName: MAIN_NODE_NAMES[ch][i],
      type: i >= 6 ? 'advanced' : 'ordinary',
      threshold,
      checkpoint: isCheckpoint,
      material: matId(family, grade),
      previous: num === 1 ? null : `main_${num - 1}`
    };
    if (isCheckpoint) {
      node.firstClear = { materials: [{ materialId: node.material, qty: 5 }], milestone: `Chapter ${ch + 1} checkpoint` };
    } else {
      node.firstClear = { materials: [{ materialId: node.material, qty: 3 }] };
    }
    nodes.push(node);
  }
}

// Optional objectives on a few main nodes (one-time fixed reward, never gates progress)
const OBJECTIVES = {
  main_5:  { tagId: 'tag_world_diversity', rule: 'distinct_world_count', count: 2, text: 'Clear with characters from 2 different worlds', reward: { materials: [{ materialId: matId('essence', 'basic'), qty: 3 }] } },
  main_15: { tagId: 'faction_spiritwardens', rule: 'tag_count', count: 2, text: 'Clear with 2 Spiritwardens', reward: { materials: [{ materialId: matId('essence', 'improved'), qty: 3 }] } }
};
for (const node of nodes) {
  if (OBJECTIVES[node.id]) node.objective = OBJECTIVES[node.id];
}

// World campaigns: 3 chapters x 10 nodes each, all type 'world'.
const WC_RANGES = [[9500, 12500], [12800, 15800], [16100, 19500]];
const WC_GRADES = ['improved', 'improved', 'advanced'];
const WC_NAMES = {
  world_hidden_village: [
    ['Waterfall Veil Approach', 'Cliff-Carved Gate', 'Apothecary of Clear Sight', 'Bells on the Training Roof',
     'Kunoichi Trial Grounds', 'Rope Bridge in the Mist', 'Shinobi Archive Vault', 'Moonlit Watchtower',
     'Forest Perimeter Breach', 'Lanterns at the Village Seal'],
    ['Forgotten Shrine Road', 'Foxfire Cedar Grove', 'Corrupted Wayside Altar', 'Oni Footprints in Snow',
     'Hoshi’s Living Ward', 'Red Ravine', 'Blue Silence Lake', 'The Purple Guardian',
     'Cavern of Spiritual Seams', 'Shrine That Holds the Mountain'],
    ['Dangerous District Tea House', 'Silver Threads Above the Alley', 'Samurai Gate of Honor',
     'Gilded Geisha House', 'Court of a Thousand Masks', 'Memory Market at Midnight', 'Beacon’s Procession',
     'False Saint’s Sanctuary', 'Palace Roofs Under Foxfire', 'Hidden War Revealed']
  ],
  world_magic_academy: [
    ['Prismatic Arrival Gate', 'First-Year Homeroom', 'Singed Textbook', 'Grounded Practice Hall',
     'Alchemy Lab Tea Break', 'Greenhouse Gone Wild', 'Mist in the Library Stacks',
     'Lightning on the Duelling Lawn', 'Dormitory Curfew Dash', 'Welcome Festival'],
    ['Spatial Geometry Classroom', 'Misplaced Summoning Circle', 'Icebound Rulebook Trial',
     'Fire Safety Detention', 'Love Potion Misdelivery', 'Pip’s Hedge Maze', 'Darkness in the Auditorium',
     'Light Across the Observatory', 'Faculty Operations Office', 'Midterm Practical: Controlled Chaos'],
    ['Moonlit School Ball', 'Spotlight and Shadow Backstage', 'Sun-Eclipse Challenge',
     'Hall of Complementary Elements', 'Walking Tower Staircase', 'Alchemy Fair Catastrophe',
     'Summoned Guests at Dinner', 'Garden Beneath the Academy', 'Heart of Eden’s Leyline',
     'Final Examination: Harmony']
  ]
};
worlds.forEach((world, wi) => {
  const wkey = `wc_${world.id}`;
  for (let ch = 0; ch < 3; ch++) {
    const [lo, hi] = WC_RANGES[ch];
    for (let i = 0; i < 10; i++) {
      const num = ch * 10 + i + 1;
      const family = FAMILIES[(wi * 3 + ch * 2 + i) % 6];
      nodes.push({
        id: `${wkey}_${num}`,
        campaign: wkey, world: world.id, chapter: ch + 1, position: i + 1, number: num,
        displayName: WC_NAMES[world.id][ch][i],
        type: 'world',
        threshold: lerpThreshold(lo, hi, i, 10),
        material: matId(family, WC_GRADES[ch]),
        previous: num === 1 ? null : `${wkey}_${num - 1}`,
        firstClear: {
          materials: [{ materialId: matId(family, WC_GRADES[ch]), qty: 3 }],
          archiveFragment: `frag_${world.id}_${num}`
        }
      });
    }
  }
});

// ---------------------------------------------------------------- archives
const ARCHIVE_META = {
  world_hidden_village: {
    collections: ['Veiled Village Records', 'Shrines and Hungry Spirits', 'Masks of the Imperial Night'],
    relics: [
      ['Silent Bell', 'First Mission Scroll', 'Apothecary Clarity Pill Box', 'Shinobi Code Tablet', 'Waterfall Gate Key'],
      ['Jagan Ward Patch', 'Ren’s Iron Prayer Bead', 'Red-Blue Binding Seal', 'Forgotten Shrine Offering', 'Foxfire Cedar Talisman'],
      ['Silver Thread Spool', 'Gilded Memory Strand', 'Beacon’s Hand Mirror', 'False Saint’s Devouring Seal', 'Porcelain Fox Mask Fragment']
    ],
    collectionSkins: [
      ['char_suzume', 'Suzume — Festival of Silent Bells'],
      ['char_yuki', 'Yuki — Shrine in Bloom'],
      ['char_kaguya', 'Kaguya — Unwoven Gold']
    ],
    fullSkin: ['char_kimiko', 'Kimiko — Dawn Without the Mask'],
    loreIntro: 'Recovered from the Hidden Village’s secret war and catalogued behind the waterfall veil.'
  },
  world_magic_academy: {
    collections: ['First-Year Misadventures', 'Lessons in Complementary Magic', 'The Faculty’s Impossible Semester'],
    relics: [
      ['Singed Fire Primer', 'Bridget’s Perfect Timetable', 'Pip’s Unauthorized Hall Pass', 'Melted Detention Bell', 'Welcome Festival Ribbon'],
      ['Ice Geometry Compass', 'Bottled Corridor Mist', 'Carol’s Lightning Medal', 'Eclipse Challenge Card', 'Liadriel’s Glittering Bookmark'],
      ['Aurora’s Heart-Shaped Crucible', 'Irina’s Spatial Master Key', 'Misplaced Summoning Chalk', 'Midterm Incident Report', 'Final Harmony Diploma']
    ],
    collectionSkins: [
      ['char_ashley', 'Ashley — Founders’ Festival Fireworks'],
      ['char_malefia', 'Malefia — Radiant Eclipse Formal'],
      ['char_aurora', 'Aurora — Hearts-in-Bloom Faculty Dress']
    ],
    fullSkin: ['char_irina', 'Irina — Midnight Observatory Uniform'],
    loreIntro: 'Preserved from an Academy semester where every lesson, friendship, and accident became part of Eden history.'
  }
};

const archives = worlds.map(world => {
  const meta = ARCHIVE_META[world.id];
  const wkey = `wc_${world.id}`;
  const collections = meta.collections.map((cname, c) => ({
    id: `${world.id}_col_${c + 1}`,
    displayName: cname,
    rewardSkin: {
      type: 'skin', id: `skin_${world.id}_collection_${c + 1}`,
      characterId: meta.collectionSkins[c][0], skinName: meta.collectionSkins[c][1]
    },
    relics: meta.relics[c].map((rname, r) => {
      const relicIndex = c * 5 + r; // 0..14
      const nodeA = relicIndex * 2 + 1, nodeB = relicIndex * 2 + 2;
      return {
        id: `${world.id}_relic_${relicIndex + 1}`,
        displayName: rname,
        position: r + 1,
        lore: `${meta.loreIntro} ${rname} is item ${r + 1} of “${cname}”; its two fragments trace the paired campaign incidents that returned it to the Archive.`,
        fragments: [
          { id: `frag_${world.id}_${nodeA}`, sourceNode: `${wkey}_${nodeA}` },
          { id: `frag_${world.id}_${nodeB}`, sourceNode: `${wkey}_${nodeB}` }
        ]
      };
    })
  }));
  return {
    id: `archive_${world.id}`,
    world: world.id,
    displayName: `${world.displayName} Archive`,
    collections,
    fullReward: {
      type: 'skin', id: `skin_${world.id}_full`,
      characterId: meta.fullSkin[0], skinName: meta.fullSkin[1]
    }
  };
});

// ---------------------------------------------------------------- write files
// The shipped game is SYSTEM content only (rules-level data: balance,
// archetypes, materials, components, recipes, universal tag rules). All
// playable content — worlds, characters, campaigns, archives — belongs to the
// player-authored creator database. The worlds defined above are exported as
// an importable, fully editable sample content pack instead.

const parseMat = (id) => { const [, family, grade] = id.split('_'); return { family, grade }; };

// Main and Shadow campaigns -> paired creator chapter rows. Main is
// material-only. Shadow alternates the two Eden worlds and uses every launch
// character exactly once.
const mainChapters = [];
const shadowChapters = [];
for (let ch = 1; ch <= 2; ch++) {
  const authored = nodes.filter(n => n.campaign === 'main' && n.chapter === ch)
    .sort((a, b) => a.position - b.position);
  const chNodes = authored.map(n => {
      const { family, grade } = parseMat(n.material);
      const row = { name: n.displayName, threshold: n.threshold, family, grade };
      if (n.objective) row.objective = n.objective;
      return row;
    });
  mainChapters.push({ nodes: chNodes });
  shadowChapters.push({
    nodes: authored.map((n, i) => {
      const { family, grade } = parseMat(n.material);
      const globalIndex = (ch - 1) * 10 + i;
      return {
        name: SHADOW_NAMES[globalIndex],
        threshold: n.threshold,
        family,
        grade,
        shardCharacterId: SHADOW_ASSIGN[globalIndex]
      };
    })
  });
}

// Worlds -> creator world format (published so an import yields a ready game)
const packWorlds = worlds.map(world => {
  const wkey = `wc_${world.id}`;
  const campaignNodes = nodes.filter(n => n.campaign === wkey)
    .sort((a, b) => a.number - b.number)
    .map(n => {
      const { family, grade } = parseMat(n.material);
      return { name: n.displayName, threshold: n.threshold, family, grade };
    });
  const archive = archives.find(a => a.world === world.id);
  return {
    id: world.id, status: 'published',
    displayName: world.displayName, tagline: world.tagline,
    icon: world.icon, palette: world.palette, image: null,
    campaignNodes,
    archive: {
      collections: archive.collections.map(col => ({
        name: col.displayName,
        rewardSkin: {
          characterId: col.rewardSkin.characterId,
          name: col.rewardSkin.skinName,
          portrait: null,
          fullBody: null
        },
        relics: col.relics.map(r => ({ name: r.displayName, lore: r.lore, image: null }))
      })),
      fullSkin: { characterId: archive.fullReward.characterId, name: archive.fullReward.skinName, portrait: null, fullBody: null }
    }
  };
});

// Characters -> creator character format
const packCharacters = characters.map(c => ({
  id: c.id, worldId: c.world,
  displayName: c.displayName, glyph: c.glyph, color: c.color,
  archetype: c.archetype, tier: c.tier, starting: !!c.starting,
  faction: c.faction ?? null, extraTags: c.extraTags ?? [],
  description: c.description, lore: c.lore,
  portrait: null, fullBody: null,
  equipment: Object.fromEntries(SLOTS.map(s => [s, { name: c.equipmentLines[s], image: null }]))
}));

// Faction tag definitions travel with the pack; universal rules stay system.
const packFactions = tags.filter(t => t.category === 'faction').map(t => ({
  id: t.id, displayName: t.displayName, explanation: t.explanation, thresholds: t.thresholds
}));
const systemTags = tags.filter(t => t.category !== 'faction');

const samplePack = {
  version: 4,
  worlds: packWorlds,
  characters: packCharacters,
  factions: packFactions,
  mainChapters,
  shadowChapters
};

const files = {
  'balance.json': balance,
  'worlds.json': [],
  'archetypes.json': ARCHETYPES,
  'materials.json': { families: FAMILY_META, grades: GRADE_META, gradeOrder: GRADES, familyOrder: FAMILIES, materials },
  'components.json': { pairs: COMPONENT_PAIRS, components },
  'characters.json': { slots: SLOT_META, slotOrder: SLOTS, tierPrefixes: TIER_PREFIXES, characters: [] },
  'tags.json': systemTags,
  'recipes.json': { tierProfiles, templates: recipeTemplates },
  'nodes.json': [],
  'archives.json': [],
  'sample-pack.json': samplePack
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(out, name), JSON.stringify(data, null, 2));
  console.log(`wrote content/${name}`);
}
console.log(`\nSystem: ${materials.length} materials, ${components.length} components, ${recipeTemplates.length} templates.`);
console.log(`Sample pack: ${packWorlds.length} worlds, ${packCharacters.length} characters, ${mainChapters.length} paired Main/Shadow chapters, ${packWorlds.reduce((a, w) => a + w.campaignNodes.length, 0)} world nodes.`);
