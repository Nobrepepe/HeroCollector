// World Hub consumer acceptance tests, driven by the shared fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractZipSafely, ZipError } from '../vendor/worldhub-kit/js/zip-reader.mjs';
import { loadPackage, PackageError } from '../vendor/worldhub-kit/js/package-reader.mjs';
import { APP_TYPE, READER_OPTIONS, semanticValidation } from '../src/core/worldhub/semantics.js';
import { adaptPackageToManifest } from '../src/core/worldhub/adapter.js';
import { compileManifest } from '../src/core/compile/index.js';
import { normalizeManifest, gameReadiness } from '../src/core/manifest.js';
import { buildContent } from '../src/core/content.js';
import { validateContent, validateSave } from '../src/core/validate.js';
import { newPlayerState, syncSaveWithContent } from '../src/core/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'worldhub');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));

function loadSystemRaw() {
  const out = {};
  for (const file of ['balance', 'archetypes', 'materials', 'components', 'characters', 'tags', 'recipes', 'expeditions', 'crises']) {
    out[file] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', `${file}.json`), 'utf8'));
  }
  return out;
}

function extractFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-worldhub-'));
  extractZipSafely(path.join(FIXTURES, name), dir);
  return dir;
}

function mediaUrl(pkg) {
  return (assetId, preferred = []) => {
    if (!assetId) return null;
    const entry = pkg.assetFile(assetId, preferred);
    return entry ? `hcpkg://test/${entry.path}` : null;
  };
}

function buildFromFixture(name) {
  const dir = extractFixture(name);
  const pkg = loadPackage(dir, APP_TYPE, READER_OPTIONS);
  semanticValidation(pkg);
  const systemRaw = loadSystemRaw();
  const manifest = normalizeManifest(
    adaptPackageToManifest(pkg, mediaUrl(pkg)),
    systemRaw.characters.slotOrder);
  const merged = compileManifest(systemRaw, manifest);
  const content = buildContent(merged.raw);
  content.images = merged.images;
  return { pkg, manifest, merged, content, dir };
}

test('the page CSP admits packaged media, or no hub art can ever render', () => {
  // Packaged art arrives as hcpkg:// URLs, used both as <img src> and as CSS
  // background-image — CSP governs both with img-src. Without the scheme
  // here every image in Hub mode is refused and the game renders artless.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(csp, 'index.html declares a Content-Security-Policy');
  const imgSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('img-src'));
  assert.ok(imgSrc, 'the policy declares img-src');
  assert.ok(imgSrc.includes('hcpkg:'), `img-src must allow hcpkg: (is "${imgSrc}")`);
});

test('the representative package builds valid, ready runtime content', () => {
  const { pkg, merged, content } = buildFromFixture('valid-v1.zip');

  const check = validateContent(content);
  assert.deepEqual(check.errors ?? [], [], 'semantic validateContent passes');
  assert.ok(check.ok);

  const readiness = gameReadiness(content);
  assert.ok(readiness.ready, JSON.stringify(readiness.checks, null, 2));

  assert.equal(content.worlds.length, 1);
  assert.equal(content.worlds[0].id, EXPECTED.worldId, 'hub uuid is the world identity');
  assert.equal(content.characters.length, EXPECTED.characterIds.length);
  assert.equal((content.nodesByCampaign.main ?? []).length, 10);
  assert.equal(content.nodesByCampaign.shadow, undefined, 'no Shadow Campaign remains');
  assert.equal((content.nodesByCampaign[`wc_${EXPECTED.worldId}`] ?? []).length, 30);
  assert.ok(content.relicByWorld[EXPECTED.worldId], 'world relic present');
  assert.equal(content.relicByWorld[EXPECTED.worldId].pieces.length, 4);
  assert.ok(Object.keys(content.encounterNodesByCharacter).length >= 1, 'encounters reveal heroes');
  assert.ok(content.crises.definitions.length >= 1, 'crisis definitions live');
  assert.ok(content.expeditions.templates.length >= 1, 'expedition templates live');

  const held = (merged.health ?? []).filter((note) => note.level === 'warn' || note.level === 'error');
  assert.deepEqual(held, [], 'nothing is held back');
  void pkg;
});

test('every packaged art class resolves through the media path', () => {
  const { content } = buildFromFixture('valid-v1.zip');
  const images = content.images;
  assert.ok(images.world[EXPECTED.worldId]?.startsWith('hcpkg://'), 'world cover');
  for (const characterId of EXPECTED.characterIds) {
    assert.ok(images.portrait[characterId]?.startsWith('hcpkg://'), `portrait ${characterId}`);
  }
  assert.ok(Object.values(images.equipment).some((url) => url?.startsWith('hcpkg://')), 'equipment art');
  /* Relic art is one square plate per world (hc_relic_art), quartered by the
     Mastery track — it replaced four per-piece assetRefs. These fixtures were
     published by World Hub under the older contract, so they carry no plate at
     all: what is checked here is the keying, which is what the Mastery screen
     reads, and that no piece id survived the move. */
  for (const [key, url] of Object.entries(images.relic)) {
    assert.ok(content.worldById[key], `relic art is keyed by world, not by piece: ${key}`);
    assert.ok(url?.startsWith('hcpkg://'), `relic art ${key}`);
  }
  assert.ok(Object.values(images.crisis).some((url) => url?.startsWith('hcpkg://')), 'crisis art');
  assert.ok(Object.values(images.skin).length > 0, 'skin art');
});

test('a new game starts and a save survives a publication update with stable identities', () => {
  const v1 = buildFromFixture('valid-v1.zip');
  const save = newPlayerState(v1.content);
  const saveCheck = validateSave(v1.content, save);
  assert.ok(saveCheck.ok, JSON.stringify(saveCheck.errors ?? []));

  // Play a little: own the first two characters, clear a node.
  const owned = EXPECTED.characterIds.slice(0, 2);
  for (const id of owned) {
    save.characters[id] = save.characters[id] ?? { owned: true, shards: 0, stars: 1, gear: {} };
    save.characters[id].owned = true;
  }
  save.nodes.main_1 = { cleared: true, firstClearClaimed: true, objectiveClaimed: false, attemptsToday: 0 };

  const v2 = buildFromFixture('valid-v2.zip');
  const { report } = syncSaveWithContent(v2.content, save);
  // The renamed character keeps its uuid; ownership survives.
  for (const id of owned) {
    assert.ok(save.characters[id].owned, `ownership of ${id} survives the update`);
  }
  assert.ok(save.nodes.main_1.cleared, 'campaign progress survives');
  void report;
});

test('a retired character leaves the roster but the save stays loadable', () => {
  const v1 = buildFromFixture('valid-v1.zip');
  const save = newPlayerState(v1.content);
  const retired = EXPECTED.retiredCharacterIds[0];
  save.characters[retired] = { owned: true, shards: 3, stars: 1, gear: {} };

  const v2 = buildFromFixture('valid-v2.zip');
  assert.ok(!v2.content.characterById[retired], 'character absent from v2 content');
  const { report } = syncSaveWithContent(v2.content, save);
  assert.ok(save.characters[retired], 'dormant save data is kept, not deleted');
  const check = validateSave(v2.content, save);
  assert.ok(check.ok, JSON.stringify(check.errors ?? []));
  void report;
});

test('adversarial packages are rejected before any adaptation', () => {
  for (const [fixture, ErrorType, pattern] of [
    ['corrupt-checksum.zip', PackageError, /checksum/i],
    ['unlisted-file.zip', PackageError, /unlisted/i],
    ['missing-asset.zip', PackageError, /missing/i],
    ['wrong-apptype.zip', PackageError, /not for this app/i],
    ['unsupported-protocol.zip', PackageError, /protocol this app does not understand/i],
  ]) {
    const dir = extractFixture(fixture);
    assert.throws(() => { const pkg = loadPackage(dir, APP_TYPE, READER_OPTIONS); semanticValidation(pkg); },
      (error) => error instanceof ErrorType && pattern.test(error.message),
      fixture);
  }
  assert.throws(
    () => extractFixture('traversal.zip'),
    (error) => error instanceof ZipError && /unsafe/i.test(error.message),
    'traversal.zip refused at extraction',
  );
});

test('wrong-app packages from sibling consumers are refused', () => {
  // The TaskStamps fixture is a valid World Hub package for another app.
  const sibling = path.join(__dirname, '..', '..', 'TaskStamps', 'tests', 'fixtures', 'worldhub', 'valid-v1.zip');
  if (!fs.existsSync(sibling)) return; // sibling checkout not present
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-worldhub-'));
  extractZipSafely(sibling, dir);
  assert.throws(() => loadPackage(dir, APP_TYPE, READER_OPTIONS), /not for this app/);
});

test('the adapter carries no engine configuration at all', () => {
  const dir = extractFixture('valid-v1.zip');
  const pkg = loadPackage(dir, APP_TYPE, READER_OPTIONS);

  /* Every number the adapter once defaulted — faction synergy, Expedition
     weights and Power ratios, Crisis weights and Front Power — now lives in
     content/, so the adapter takes no configuration argument and
     balance.worldHub is gone. */
  assert.equal(adaptPackageToManifest.length, 2, 'the adapter takes only a package and a media resolver');
  const balance = loadSystemRaw().balance;
  assert.equal(balance.worldHub, undefined, 'no World Hub defaults block remains');
  assert.ok(balance.campaigns?.world?.thresholdStart, 'campaign curves are game-owned');
  assert.ok(balance.factions?.thresholds?.length, 'faction synergy is game-owned');

  const manifest = adaptPackageToManifest(pkg, mediaUrl(pkg));
  assert.equal(manifest.crises, undefined, 'no Crisis library reaches the manifest');
  assert.equal(manifest.expeditions, undefined, 'no Expedition library reaches the manifest');
  assert.ok(manifest.expeditionArt, 'board artwork still does');
});

test('the contract asks for creative facts only — every field is accounted for', () => {
  // The guard this replaces rewrote the contract's mechanical fields to
  // nonsense and proved the adapter ignored them. Those fields are gone, so
  // the invariant moves up: the contract may not grow one back. Adding a
  // field here means deciding, deliberately, that a publication owns it.
  const contract = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'worldhub', 'application-contract.json'), 'utf8'));

  const ids = [];
  const walk = (field) => {
    ids.push(field.id);
    for (const child of field.fields ?? []) walk(child);
    if (field.item) walk(field.item);
  };
  for (const field of contract.productionFields ?? []) walk(field);
  for (const selection of contract.entitySelections ?? []) {
    for (const field of selection.fields ?? []) walk(field);
  }

  const allowed = new Set([
    // Main Campaign: a title and ten names.
    'hc_main_chapters', 'chapter_title', 'chapter_art', 'chapter_nodes', 'mnode_name',
    // Worlds: look, campaign names, relic fiction, cosmetic order.
    'hc_world_icon', 'hc_palette_primary', 'hc_palette_accent', 'hc_palette_dark',
    'hc_chapter_titles', 'hc_chapter_title', 'hc_campaign_nodes', 'node_name',
    'hc_relic_name', 'hc_relic_lore', 'hc_relic_pieces', 'piece_name', 'piece_lore',
    'hc_mastery_cosmetics', 'mc_character', 'mc_name', 'mc_art',
    // Characters: who they are, and the art that shows them.
    'hc_archetype', 'hc_faction', 'hc_equipment', 'equip_slot', 'equip_name', 'equip_art',
    // Factions: identity only.
    'hc_faction_explanation',
  ]);
  assert.deepEqual(ids.filter((id) => !allowed.has(id)), [],
    'the contract grew a field the game should own');
  assert.equal(ids.length, allowed.size, 'a field disappeared without the allowlist being updated');

  // And nothing in it names a mechanical concept, whatever it is called.
  const forbidden = /threshold|_family|_grade|_tier|_weight|power|reward|encounter|starting|display_order|expedition_(?!art)|crisis|shard/i;
  for (const id of ids) assert.ok(!forbidden.test(id), `${id} names something mechanical`);
});

test('a package from the older contract shape is refused, not quietly emptied', () => {
  const dir = extractFixture('valid-v1.zip');
  const pkg = loadPackage(dir, APP_TYPE, READER_OPTIONS);
  assert.doesNotThrow(() => semanticValidation(pkg));

  /* Node names used to be records carrying a threshold, a family and a grade.
     Such a package passes every structural check and would install and run
     with every authored name replaced by "Node 1" — content that looks correct
     and is not. It must be refused, and the message must say what to do. */
  const stale = structuredClone(pkg);
  stale.content.values.hc_main_chapters[0].chapter_nodes =
    stale.content.values.hc_main_chapters[0].chapter_nodes.map((name, i) => ({
      mnode_name: name, mnode_threshold: 50 + i * 40, mnode_family: 'metal', mnode_grade: 'basic',
    }));
  assert.throws(() => semanticValidation(stale),
    (error) => error instanceof PackageError && /republish/i.test(error.message));

  const staleWorld = structuredClone(pkg);
  const worldId = staleWorld.content.selections.hc_worlds[0];
  staleWorld.content.entityValues[worldId].hc_campaign_nodes =
    staleWorld.content.entityValues[worldId].hc_campaign_nodes.map((name) => ({ node_name: name }));
  assert.throws(() => semanticValidation(staleWorld),
    (error) => error instanceof PackageError && /republish/i.test(error.message));
});

test('every Main Campaign chapter has a backdrop of its own', () => {
  const { manifest, content } = buildFromFixture('valid-v1.zip');
  // Authored art reaches the chapter it was authored on.
  assert.ok(manifest.mainChapters[0].image?.startsWith('hcpkg://'), 'chapter art adapts');
  assert.equal(content.images.chapter['main:1'], manifest.mainChapters[0].image);

  /* Left blank, a chapter borrows the backdrop of the world it introduces
     rather than falling through to "the first world that has a cover" — which
     showed one world's cover behind every chapter of the opening track. */
  const blank = structuredClone(manifest);
  for (const chapter of blank.mainChapters) chapter.image = null;
  const compiled = compileManifest(loadSystemRaw(), blank);
  const world = compiled.raw.worlds[0];
  const borrowed = compiled.images.chapter['main:1'];
  assert.ok(borrowed, 'a chapter with no art still has a backdrop');
  assert.ok(borrowed === manifest.worlds[0].chapterImages.find(Boolean) || borrowed === manifest.worlds[0].image,
    'the backdrop borrowed is the introduced world’s, not an arbitrary one');
  void world;
});

test('world and roster order carry through the manifest into compiled progression', () => {
  const { pkg, manifest, content } = buildFromFixture('valid-v1.zip');
  assert.deepEqual(manifest.worlds.map((w) => w.id), pkg.content.selections.hc_worlds,
    'world selection order is progression order');
  assert.deepEqual(
    manifest.characters.filter((c) => c.worldId === manifest.worlds[0].id).map((c) => c.id),
    pkg.content.selections.hc_characters.filter((id) => manifest.characters.some((c) => c.id === id && c.worldId === manifest.worlds[0].id)),
    'character selection order is roster order');

  /* Every hero is revealed exactly once, because any of them might not be
     among the five a save draws. */
  const revealed = content.nodes.flatMap((node) => node.encounterCharacter ?? []);
  assert.equal(new Set(revealed).size, revealed.length, 'no hero is revealed twice');
  for (const def of content.characters) {
    assert.ok(revealed.includes(def.id), `${def.displayName} has a reveal node`);
  }
});
