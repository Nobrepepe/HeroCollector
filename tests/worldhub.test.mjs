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
import { adaptPackageToCustomDb } from '../src/core/worldhub/adapter.js';
import { upgradeCustomDB, mergeContent, gameReadiness } from '../src/core/custom.js';
import { buildContent } from '../src/core/content.js';
import { validateContent, validateSave } from '../src/core/validate.js';
import { newPlayerState, syncSaveWithContent } from '../src/core/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'worldhub');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));

function loadSystemRaw() {
  const out = {};
  for (const file of ['balance', 'worlds', 'archetypes', 'materials', 'components', 'characters', 'tags', 'recipes', 'nodes', 'archives']) {
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
  const db = upgradeCustomDB(adaptPackageToCustomDb(pkg, mediaUrl(pkg), systemRaw.balance.worldHub ?? {}));
  const merged = mergeContent(systemRaw, db);
  const content = buildContent(merged.raw);
  content.images = merged.images;
  return { pkg, db, merged, content, dir };
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
  assert.ok(Object.values(images.relic).some((url) => url?.startsWith('hcpkg://')), 'relic piece art');
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

test('engine defaults come from balance.json, not from literals in the adapter', () => {
  const dir = extractFixture('valid-v1.zip');
  const pkg = loadPackage(dir, APP_TYPE, READER_OPTIONS);

  /* An author who leaves the engine numbers alone — the ordinary case, and the
     one where these values used to be invisible defaults inside the adapter. */
  for (const crisis of pkg.content.values.hc_crises ?? []) {
    delete crisis.crisis_weight;
    delete crisis.crisis_min_cleared;
    for (const front of crisis.crisis_fronts ?? []) {
      delete front.front_power_local;
      delete front.front_power_major;
      delete front.front_power_world;
    }
  }
  for (const template of pkg.content.values.hc_expedition_templates ?? []) {
    delete template.exptpl_power_ratio_bp;
    delete template.exptpl_weight;
  }
  for (const faction of pkg.content.values.hc_factions ?? []) {
    delete faction.faction_bonus_2_bp;
    delete faction.faction_bonus_3_bp;
  }

  const designerTuning = {
    factionBonusBp: { two: 111, three: 222 },
    expedition: { weight: 33, requirementCount: 0, powerRatioBp: 4444 },
    crisis: { weight: 55, minimumClearedNodes: 6, frontPower: { local: 7, major: 8, world: 9 } },
  };
  const db = adaptPackageToCustomDb(pkg, mediaUrl(pkg), designerTuning);

  const crisis = db.crises.definitions[0];
  assert.equal(crisis.weight, 55, 'the crisis weight a designer set is what the game gets');
  assert.equal(crisis.minimumClearedNodes, 6);
  assert.deepEqual(crisis.fronts[0].recommendedPowerByGrade, { local: 7, major: 8, world: 9 });

  const template = db.expeditions.templates[0];
  assert.equal(template.powerRatioBp, 4444);
  assert.equal(template.weight, 33);
  assert.deepEqual(db.factions[0].thresholds.map((t) => t.bonusBp), [111, 222]);

  /* and the file the game actually ships carries that block */
  const balance = loadSystemRaw().balance;
  assert.ok(balance.worldHub, 'content/balance.json declares the World Hub defaults');
  assert.ok(Number.isInteger(balance.worldHub.crisis.frontPower.local));
});
