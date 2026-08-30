// The content compiler: a Creative Manifest plus the game's own rules become
// one runtime content set.
//
//   World Hub publication → CreativeManifest → compile() → RuntimeContent
//
// Anything incomplete is *held back* with a human-readable health note rather
// than producing invalid content, and the game stays in setup mode until what
// is left meets the prerequisites for a playable save.
import { compileMainCampaign, compileWorldCampaign, compileRelic } from './campaigns.js';
import { planReveals } from './roster.js';
import { compileExpeditions } from './expeditions.js';
import { compileCrises } from './crises.js';

export function compileManifest(systemRaw, manifest) {
  const health = [];
  const note = (level, text) => health.push({ level, text });
  const balance = systemRaw.balance;
  const slotOrder = systemRaw.characters.slotOrder;
  const config = balance.campaigns;

  // --- worlds: structurally sound enough to compile a campaign for?
  const rosterByWorld = new Map();
  for (const character of manifest.characters) {
    if (!rosterByWorld.has(character.worldId)) rosterByWorld.set(character.worldId, []);
    rosterByWorld.get(character.worldId).push(character.id);
  }

  const accepted = [];
  for (const world of manifest.worlds) {
    const roster = rosterByWorld.get(world.id) ?? [];
    const problems = [];
    if (world.nodeNames.length !== config.world.nodes) {
      problems.push(`needs ${config.world.nodes} node names, has ${world.nodeNames.length}`);
    }
    if (roster.length < balance.partySize) {
      problems.push(`fewer than ${balance.partySize} characters (${roster.length})`);
    }
    if (problems.length) note('warn', `World “${world.displayName}” is held back: ${problems.join('; ')}.`);
    else accepted.push(world);
  }

  // --- the Main Campaign has to be long enough to introduce every world's
  // opening party, because nothing else can.
  const mainChapters = manifest.mainChapters.filter((chapter, index) => {
    if (chapter.nodeNames.length === config.main.chapterSize) return true;
    note('warn', `Main Campaign Chapter ${index + 1} is held back: it needs ${config.main.chapterSize} node names, has ${chapter.nodeNames.length}.`);
    return false;
  });
  const mainNodeCount = mainChapters.length * config.main.chapterSize;

  const plan = planReveals(balance, accepted, rosterByWorld, mainNodeCount);
  const heldBack = new Set(plan.shortfall.map(world => world.id));
  for (const world of plan.shortfall) {
    note('warn', `World “${world.displayName}” is held back: the Main Campaign has ${mainNodeCount} nodes, too few to introduce every world's opening party of ${balance.partySize}. Publish another Main Campaign chapter.`);
  }
  const worlds = accepted.filter(world => !heldBack.has(world.id));
  const liveWorldIds = new Set(worlds.map(world => world.id));

  // --- characters: only those of a live world, in manifest order
  const characters = [];
  for (const character of manifest.characters) {
    if (liveWorldIds.has(character.worldId)) { characters.push(character); continue; }
    const world = manifest.worlds.find(w => w.id === character.worldId);
    note('info', `Character “${character.displayName}” is waiting for world “${world?.displayName ?? character.worldId}” to be in the game.`);
  }
  const liveCharacterIds = new Set(characters.map(c => c.id));

  // --- campaigns
  const mainReveals = new Map([...plan.mainReveals].filter(([, id]) => liveCharacterIds.has(id)));
  const mainNodes = compileMainCampaign(balance, systemRaw.materials, mainChapters, mainReveals, { worldCount: worlds.length });
  const wcNodes = [];
  const relics = [];
  worlds.forEach((world, worldIndex) => {
    const reveals = new Map([...(plan.worldReveals.get(world.id) ?? new Map())]
      .filter(([, id]) => liveCharacterIds.has(id)));
    wcNodes.push(...compileWorldCampaign(balance, systemRaw.materials, world, worldIndex, reveals));
    relics.push(compileRelic(balance, world));
  });

  // --- character definitions. A faction the content does not define is
  // dropped rather than emitted: a dangling tag reference reaches synergy, the
  // roster filters and the Crisis favoured-tag check, and fails in all three.
  // The manifest keeps what the author wrote; the game never sees it.
  const definedFactions = new Set(manifest.factions.map(faction => faction.id));
  const characterDefs = characters.map(character => {
    let faction = character.faction || undefined;
    if (faction && !definedFactions.has(faction)) {
      note('warn', `Character “${character.displayName}” belongs to faction “${faction}”, which this publication does not define; the membership was dropped.`);
      faction = undefined;
    }
    return {
      id: character.id,
      displayName: character.displayName,
      world: character.worldId,
      archetype: character.archetype,
      faction,
      description: character.description,
      lore: character.lore,
      equipmentLines: Object.fromEntries(slotOrder.map(slot => [slot, character.equipment[slot].name]))
    };
  });

  const rosterDefsByWorld = new Map();
  for (const def of characterDefs) {
    if (!rosterDefsByWorld.has(def.world)) rosterDefsByWorld.set(def.world, []);
    rosterDefsByWorld.get(def.world).push(def);
  }

  // --- Mastery cosmetics: authored order onto the game's rank ladder. The
  // skin ids are generated, so renaming a cosmetic never orphans a save.
  const cosmeticRanks = balance.mastery.cosmeticRanks;
  const skins = [];
  const finalWorlds = worlds.map((world, worldIndex) => {
    const masterySkins = [];
    world.masteryCosmetics.forEach((cosmetic, index) => {
      if (index >= cosmeticRanks.length) {
        note('info', `World “${world.displayName}” lists more Mastery cosmetics than there are cosmetic ranks; the extra ones are not awarded.`);
        return;
      }
      if (!liveCharacterIds.has(cosmetic.characterId)) {
        note('warn', `World “${world.displayName}” Mastery cosmetic “${cosmetic.name}” names a character who is not in the game, and was held back.`);
        return;
      }
      const skinId = `skin_${world.id}_${index + 1}`;
      skins.push({ id: skinId, characterId: cosmetic.characterId, world: world.id, skinName: cosmetic.name });
      masterySkins.push({ rank: cosmeticRanks[index], characterId: cosmetic.characterId, skinId, skinName: cosmetic.name });
    });
    return {
      id: world.id, displayName: world.displayName, tagline: world.tagline,
      description: world.description, displayOrder: worldIndex,
      palette: world.palette, icon: world.icon,
      campaignId: `wc_${world.id}`, relicId: `relic_${world.id}`,
      masterySkins
    };
  });

  // --- pacing sanity: the drawn five must be able to open the first node.
  if (mainNodes.length > 0 && characterDefs.length >= balance.rosterProgression.starterCount) {
    const starterRawPower = balance.rosterProgression.starterCount
      * (balance.basePower + balance.starPowerCumulative[balance.rosterProgression.recruitStar - 1]);
    if (mainNodes[0].threshold > starterRawPower) {
      note('warn', `The first Main Campaign node needs ${mainNodes[0].threshold} Power, but ${balance.rosterProgression.starterCount} fresh starting characters only have ${starterRawPower} before synergy. New games may be stuck immediately.`);
    }
  }

  // --- tags: universal system rules plus the manifest's factions
  const usedFactions = new Set(characterDefs.map(def => def.faction).filter(Boolean));
  const tags = [
    ...systemRaw.tags,
    ...manifest.factions
      .filter(faction => usedFactions.has(faction.id))
      .map(faction => ({
        id: faction.id, displayName: faction.displayName, category: 'faction',
        activationRule: 'tag_count', stackingGroup: faction.id,
        thresholds: balance.factions.thresholds.map(entry => ({ ...entry })),
        explanation: faction.explanation
      }))
  ];

  // --- art
  const images = {
    world: {}, expedition: {}, crisis: {}, chapter: {}, portrait: {},
    fullBody: {}, equipment: {}, relic: {}, skin: {}
  };
  // A Main Campaign chapter left without art borrows the backdrop of the world
  // it introduces — the Journey then visibly tracks which world is about to
  // open. Without this the screen fell through to "the first world that has a
  // cover", which showed one world's cover behind every chapter of the game's
  // most-seen early screen.
  const chapterOpensWorld = new Map();
  for (const entry of plan.report) {
    if (entry.campaign !== 'main') continue;
    const chapterNumber = Math.floor((entry.node - 1) / config.main.chapterSize) + 1;
    if (!chapterOpensWorld.has(chapterNumber)) chapterOpensWorld.set(chapterNumber, entry.worldId);
  }
  mainChapters.forEach((chapter, index) => {
    const number = index + 1;
    if (chapter.image) { images.chapter[`main:${number}`] = chapter.image; return; }
    const opened = worlds.find(world => world.id === chapterOpensWorld.get(number));
    const borrowed = opened?.chapterImages.find(Boolean) ?? opened?.image;
    if (borrowed) images.chapter[`main:${number}`] = borrowed;
  });
  for (const world of worlds) {
    if (world.image) images.world[world.id] = world.image;
    world.chapterImages.forEach((image, index) => {
      if (image) images.chapter[`wc_${world.id}:${index + 1}`] = image;
    });
    world.relic.pieces.forEach((piece, index) => {
      if (piece.image) images.relic[`relic_${world.id}_p${index + 1}`] = piece.image;
    });
    world.masteryCosmetics.forEach((cosmetic, index) => {
      if (index >= cosmeticRanks.length) return;
      if (cosmetic.portrait || cosmetic.fullBody) {
        images.skin[`skin_${world.id}_${index + 1}`] = { portrait: cosmetic.portrait, fullBody: cosmetic.fullBody };
      }
    });
  }
  for (const character of characters) {
    if (character.portrait) images.portrait[character.id] = character.portrait;
    if (character.fullBody) images.fullBody[character.id] = character.fullBody;
    for (const slot of slotOrder) {
      const image = character.equipment[slot]?.image;
      if (image) images.equipment[`${character.id}:${slot}`] = image;
    }
  }
  const expeditionArt = manifest.expeditionArt ?? { global: null, worlds: {} };
  if (expeditionArt.global) images.expedition.global = expeditionArt.global;
  for (const [worldId, image] of Object.entries(expeditionArt.worlds ?? {})) {
    if (image) images.expedition[worldId] = image;
  }
  // Every route wants a 16:9 plate, and it is the same file its party screen
  // opens into. A world-scoped route already has one: its world's backdrop.
  // Only across-world routes need the production's own board art.
  for (const world of worlds) {
    if (images.expedition[world.id]) continue;
    const plate = world.chapterImages.find(Boolean) ?? world.image;
    if (plate) images.expedition[world.id] = plate;
  }
  // A generated Crisis is presented on its world's own cover; there is no
  // separate Crisis artwork for a publication to supply.
  for (const world of worlds) {
    if (world.image) images.crisis[`crisis_${world.id}`] = world.image;
  }

  const raw = {
    balance,
    // The pack's identity. Main Campaign node ids (main_1…) are shared across
    // packs, so a save records the lineage it was playing; switching to a
    // different pack resets that shared progress rather than silently treating
    // another pack's campaign as already cleared.
    lineage: manifest.lineage ?? `worlds:${manifest.worlds.map(w => w.id).sort().join('|')}`,
    worlds: finalWorlds,
    archetypes: systemRaw.archetypes,
    materials: systemRaw.materials,
    components: systemRaw.components,
    characters: { ...systemRaw.characters, characters: characterDefs },
    tags,
    recipes: systemRaw.recipes,
    nodes: [...mainNodes, ...wcNodes],
    relics,
    skins,
    expeditions: compileExpeditions(systemRaw.expeditions, finalWorlds, { images: manifest.expeditionArt }),
    crises: compileCrises(systemRaw.crises, finalWorlds, rosterDefsByWorld)
  };
  return { raw, images, health, revealPlan: plan.report };
}
