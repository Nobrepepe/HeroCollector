// The content compiler: World Hub says what something is, Hero Collector
// decides what that fact does. These tests are the boundary itself — if a
// creative edit can move a number, the separation has failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSystemRaw, loadSampleManifest } from './helpers.mjs';
import { compileManifest } from '../src/core/compile/index.js';
import { spreadPositions } from '../src/core/compile/roster.js';
import { compileExpeditions } from '../src/core/compile/expeditions.js';
import { newPlayerState } from '../src/core/state.js';
import { generateCycleBoard, offerFeasibility } from '../src/core/expeditions.js';
import { crisisFrontPowers, characterCrisisTags } from '../src/core/crises.js';
import { makeRng } from '../src/core/rng.js';
import { thresholdAt } from '../src/core/compile/campaigns.js';
import { normalizeManifest, gameReadiness } from '../src/core/manifest.js';
import { buildContent } from '../src/core/content.js';
import { validateContent } from '../src/core/validate.js';

const systemRaw = loadSystemRaw();
const T0 = Date.parse('2026-07-25T12:00:00');
const compile = (manifest) => compileManifest(systemRaw, manifest);
const build = (manifest) => {
  const compiled = compile(manifest);
  const content = buildContent(compiled.raw);
  content.images = compiled.images;
  return { compiled, content };
};

test('compilation is deterministic: the same manifest yields identical content', () => {
  const a = compile(loadSampleManifest());
  const b = compile(loadSampleManifest());
  assert.deepEqual(b.raw, a.raw);
  assert.deepEqual(b.revealPlan, a.revealPlan);
});

test('a creative-only edit leaves every number and every ID untouched', () => {
  const before = compile(loadSampleManifest()).raw;

  // Rename everything a writer could rename, swap the art, retell the lore.
  const edited = loadSampleManifest();
  edited.worlds.forEach((world, index) => {
    world.displayName = `Renamed World ${index}`;
    world.tagline = 'A different tagline entirely.';
    world.icon = '🔶';
    world.image = 'art/somewhere-else.webp';
    world.nodeNames = world.nodeNames.map((_, i) => `Renamed node ${i}`);
    world.chapterTitles = world.chapterTitles.map((_, i) => `Renamed chapter ${i}`);
    world.relic.name = 'The Renamed Relic';
    world.relic.pieces.forEach((piece, i) => { piece.name = `Renamed piece ${i}`; piece.lore = 'New lore.'; });
  });
  edited.characters.forEach((character, index) => {
    character.displayName = `Renamed Hero ${index}`;
    character.lore = 'A wholly different biography.';
    character.portrait = 'art/other.webp';
  });
  edited.mainChapters.forEach((chapter, index) => {
    chapter.title = `Renamed main chapter ${index}`;
    chapter.nodeNames = chapter.nodeNames.map((_, i) => `Renamed main node ${i}`);
  });
  const after = compile(edited).raw;

  const mechanical = (raw) => raw.nodes.map(node => ({
    id: node.id, campaign: node.campaign, number: node.number, type: node.type,
    threshold: node.threshold, material: node.material, previous: node.previous,
    checkpoint: node.checkpoint, encounterCharacter: node.encounterCharacter ?? null,
    firstClear: node.firstClear, objective: node.objective ?? null
  }));
  assert.deepEqual(mechanical(after), mechanical(before),
    'renaming content moved a threshold, a drop, a reward, or an ID');
  assert.deepEqual(
    after.relics.map(r => ({ id: r.id, pieces: r.pieces.map(p => ({ id: p.id, sourceNode: p.sourceNode })) })),
    before.relics.map(r => ({ id: r.id, pieces: r.pieces.map(p => ({ id: p.id, sourceNode: p.sourceNode })) })));
  assert.deepEqual(after.skins.map(s => s.id), before.skins.map(s => s.id),
    'renaming a cosmetic changed its generated id');

  // And the names really did change, or the assertion above proves nothing.
  assert.notDeepEqual(after.nodes.map(n => n.displayName), before.nodes.map(n => n.displayName));
});

test('thresholds never decrease, in either campaign', () => {
  const { content } = build(loadSampleManifest());
  for (const [campaign, nodes] of Object.entries(content.nodesByCampaign)) {
    const sorted = [...nodes].sort((a, b) => a.number - b.number);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].threshold >= sorted[i - 1].threshold,
        `${campaign}: ${sorted[i].id} drops below its predecessor`);
    }
  }
});

test('every hero has exactly one reveal, and every world can be opened', () => {
  const { compiled, content } = build(loadSampleManifest());
  const revealed = content.nodes.flatMap(node => node.encounterCharacter ?? []);
  assert.equal(new Set(revealed).size, revealed.length, 'a hero is revealed twice');
  assert.equal(new Set(revealed).size, content.characters.length, 'a hero has no reveal at all');

  // A World Campaign is locked until five of its heroes are owned, so the
  // Main Campaign must introduce every world's opening party.
  const openers = compiled.revealPlan.filter(entry => entry.campaign === 'main');
  for (const world of content.worlds) {
    const opening = openers.filter(entry => entry.worldId === world.id);
    assert.equal(opening.length, content.balance.partySize,
      `${world.displayName} cannot be opened: the Main Campaign introduces ${opening.length} of its heroes`);
  }
});

test('every material family a campaign drops is reachable at every grade it drops', () => {
  const { content } = build(loadSampleManifest());
  const byGrade = new Map();
  for (const node of content.nodes) {
    const material = content.materialById[node.material];
    if (!byGrade.has(material.grade)) byGrade.set(material.grade, new Set());
    byGrade.get(material.grade).add(material.family);
  }
  for (const [grade, families] of byGrade) {
    assert.equal(families.size, content.materialMeta.familyOrder.length,
      `grade ${grade} only opens ${[...families].join(', ')}`);
  }
});

test('generated IDs are unique across worlds, nodes, relics, pieces and skins', () => {
  const { compiled } = build(loadSampleManifest());
  const ids = [
    ...compiled.raw.nodes.map(n => n.id),
    ...compiled.raw.relics.map(r => r.id),
    ...compiled.raw.relics.flatMap(r => r.pieces.map(p => p.id)),
    ...compiled.raw.skins.map(s => s.id),
    ...compiled.raw.worlds.map(w => w.id)
  ];
  assert.equal(new Set(ids).size, ids.length);
});

// A manifest of `worldCount` worlds with six heroes each, and enough Main
// Campaign chapters to introduce `openWorlds` opening parties.
function syntheticManifest(worldCount, chapters = Math.ceil(worldCount * 5 / 10)) {
  const base = loadSampleManifest();
  const manifest = normalizeManifest({
    manifestVersion: 1,
    lineage: `test:${worldCount}x${chapters}`,
    worlds: Array.from({ length: worldCount }, (_, w) => ({
      ...structuredClone(base.worlds[w % base.worlds.length]),
      id: `w${w}`, displayName: `World ${w}`, masteryCosmetics: []
    })),
    characters: Array.from({ length: worldCount }, (_, w) =>
      Array.from({ length: 6 }, (_, c) => ({
        ...structuredClone(base.characters[c % base.characters.length]),
        id: `w${w}c${c}`, worldId: `w${w}`, displayName: `Hero ${w}-${c}`,
        faction: null   // these synthetic worlds define none
      }))).flat(),
    mainChapters: Array.from({ length: chapters }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      nodeNames: Array.from({ length: 10 }, (_, n) => `Node ${i * 10 + n + 1}`)
    })),
    factions: [],
    expeditions: null,
    crises: null
  }, systemRaw.characters.slotOrder);
  return manifest;
}

test('compiling at 1, 2, 10 and 40 worlds stays valid and playable', () => {
  for (const worldCount of [1, 2, 10, 40]) {
    const compiled = compile(syntheticManifest(worldCount));
    const content = buildContent(compiled.raw);
    assert.deepEqual(compiled.health.filter(n => n.level !== 'info'), [],
      `${worldCount} worlds: nothing should be held back`);
    assert.equal(content.worlds.length, worldCount);
    assert.equal(content.characters.length, worldCount * 6);
    assert.equal(content.nodes.length, worldCount * 30 + Math.ceil(worldCount * 5 / 10) * 10);
    assert.deepEqual(validateContent(content).errors, [], `${worldCount} worlds: content is valid`);
    assert.ok(gameReadiness(content).ready, `${worldCount} worlds: game is playable`);
  }
});

test('a Main Campaign too short to open every world holds those worlds back', () => {
  // Three worlds need fifteen opening reveals; one chapter offers ten.
  const compiled = compile(syntheticManifest(3, 1));
  assert.equal(compiled.raw.worlds.length, 2, 'the third world cannot be introduced');
  assert.match(compiled.health.filter(n => n.level === 'warn').map(n => n.text).join(' '),
    /too few to introduce every world/);
  // What survives is still a valid, playable game rather than a broken one.
  const content = buildContent(compiled.raw);
  assert.deepEqual(validateContent(content).errors, []);
  assert.ok(gameReadiness(content).ready);
});

test('the route mix holds its shape at any number of worlds', () => {
  // World-scoped archetypes become one route per world, so without scaling the
  // global ones they would be crowded off the board as a library grows.
  const share = (worldCount) => {
    const worlds = Array.from({ length: worldCount }, (_, i) => ({ id: `w${i}`, displayName: `World ${i}` }));
    const templates = compileExpeditions(systemRaw.expeditions, worlds).templates.filter(t => !t.supply);
    const total = templates.reduce((sum, t) => sum + t.weight, 0);
    const byArchetype = {};
    for (const template of templates) {
      const key = template.world ? template.id.replace(`_${template.world}`, '') : template.id;
      byArchetype[key] = (byArchetype[key] ?? 0) + template.weight / total;
    }
    return Object.fromEntries(Object.entries(byArchetype).map(([k, v]) => [k, +v.toFixed(4)]));
  };
  const baseline = share(1);
  for (const worldCount of [2, 6, 40]) {
    assert.deepEqual(share(worldCount), baseline, `${worldCount} worlds shifts the route mix`);
  }
});

test('generated routes cover every world and always keep one Supply route', () => {
  for (const worldCount of [1, 3, 12]) {
    const worlds = Array.from({ length: worldCount }, (_, i) => ({ id: `w${i}`, displayName: `World ${i}` }));
    const library = compileExpeditions(systemRaw.expeditions, worlds);
    assert.equal(library.templates.filter(t => t.supply).length, 1);
    for (const world of worlds) {
      assert.ok(library.templates.some(t => t.world === world.id), `${world.displayName} has no route`);
    }
    // Deduplicated definitions, unique ids, and no unfilled placeholders.
    const ids = library.templates.map(t => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const template of library.templates) {
      assert.ok(template.optionalIds.length, `${template.id} offers no bonus`);
      assert.ok(template.requirementCount <= template.requirementIds.length);
      assert.ok(!JSON.stringify(template).includes('{world}'));
      assert.ok(!JSON.stringify(template).includes('@associated'));
    }
  }
});

test('every world gets a Crisis, favoured only for tags its own roster carries', () => {
  const { content } = build(loadSampleManifest());
  assert.equal(content.crises.definitions.length, content.worlds.length);
  for (const world of content.worlds) {
    const definition = content.crisesByWorld[world.id]?.[0];
    assert.ok(definition, `${world.displayName} has no Crisis`);
    assert.ok(definition.name.includes(world.displayName), 'the Crisis is named for its world');

    const roster = content.characters.filter(def => def.world === world.id);
    const available = new Set([
      world.id,
      ...roster.map(def => def.archetype),
      ...roster.map(def => def.faction).filter(Boolean)
    ]);
    for (const front of definition.fronts) {
      assert.ok(front.favoredTagIds.length >= 1 && front.favoredTagIds.length <= 2);
      for (const tag of front.favoredTagIds) {
        // An authored favoured tag could name an archetype nobody in the world
        // has, making the bonus permanently unearnable. A resolved one cannot.
        assert.ok(available.has(tag),
          `${front.id} favours ${tag}, which nobody in ${world.displayName} carries`);
      }
      assert.ok(!JSON.stringify(front).includes('{world}'), 'an unfilled placeholder escaped');
    }
  }
  // Worlds differ from one another rather than repeating one template.
  const boons = content.crises.definitions.map(d => d.boon.type);
  if (content.worlds.length > 1) assert.ok(new Set(boons).size > 1, 'every world drew the same boon');
});

test('a fresh save can always staff the board the generated routes produce', () => {
  // The routes are generated, so "enough of them are doable by the roster the
  // player actually starts with" is a property of the archetype library, not
  // of a particular board. Checked across many boards, because a single lucky
  // draw proves nothing.
  const content = build(loadSampleManifest()).content;
  const minimum = content.expeditions.settings.minimumFeasible;
  for (let seed = 0; seed < 40; seed++) {
    const state = newPlayerState(content, T0 + seed * 86400000);
    const board = generateCycleBoard(content, state, makeRng(seed));
    const feasible = board.offers.filter(offer => offerFeasibility(content, state, offer).feasible);
    assert.ok(feasible.length >= minimum,
      `seed ${seed}: only ${feasible.length} of ${board.offers.length} routes are staffable by five fresh heroes`);
    // And the guaranteed Supply route is one a fresh save can actually run,
    // or the guarantee is decoration.
    const supply = board.offers.find(offer => offer.offerKind === 'supply');
    assert.ok(supply && offerFeasibility(content, state, supply).feasible,
      `seed ${seed}: the guaranteed Supply route cannot be staffed`);
  }
});

test('every Crisis grade can be staffed by the roster that unlocks it', () => {
  // A grade gates on owning `minOwned` heroes and then asks for
  // frontCount x teamSize of them, disjoint. If the second number ever exceeds
  // the first, the Crisis is unresolvable the moment it becomes reachable.
  const content = build(loadSampleManifest()).content;
  for (const grade of content.crises.settings.grades) {
    assert.ok(grade.frontCount * grade.teamSize <= grade.minOwned,
      `${grade.id} asks for ${grade.frontCount * grade.teamSize} heroes but unlocks at ${grade.minOwned} owned`);

    const state = newPlayerState(content, T0);
    const owned = content.characters.slice(0, grade.minOwned);
    for (const def of owned) { state.characters[def.id].owned = true; state.characters[def.id].revealed = true; }
    state.starters = owned.slice(0, content.balance.rosterProgression.starterCount).map(def => def.id);

    const definition = content.crises.definitions[0];
    assert.ok(definition.fronts.length >= grade.frontCount,
      `${definition.id} has too few Fronts for ${grade.id}`);
    const powers = crisisFrontPowers(content, state, grade);
    assert.equal(powers.length, grade.frontCount);
    assert.ok(powers.every(power => power > 0), 'a Front asked for nothing');

    // Every Front's favoured tags are earnable by someone in the roster.
    for (const front of definition.fronts) {
      const earnable = front.favoredTagIds.some(tag =>
        owned.some(def => characterCrisisTags(content, def.id).has(tag)));
      assert.ok(earnable, `${front.id} favours nothing the opening roster carries`);
    }
  }
});

test('threshold and spread helpers are pure functions of position', () => {
  const curve = { thresholdStart: 1000, thresholdGrowthBp: 1000, thresholdRound: 10, perWorldGrowthBp: 0 };
  assert.equal(thresholdAt(curve, 1), 1000);
  assert.equal(thresholdAt(curve, 2), 1100);
  assert.equal(thresholdAt(curve, 3), 1210);
  // A later world is only harder when the designer says so.
  assert.equal(thresholdAt(curve, 1, 3), 1000);
  assert.equal(thresholdAt({ ...curve, perWorldGrowthBp: 1000 }, 1, 1), 1100);

  assert.deepEqual(spreadPositions(0, 30), []);
  assert.deepEqual(spreadPositions(1, 30), [15]);
  assert.deepEqual(spreadPositions(5, 30), [5, 10, 15, 20, 25]);
  const many = spreadPositions(29, 30);
  assert.equal(new Set(many).size, 29, 'crowded reveals never collide');
});
