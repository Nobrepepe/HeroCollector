// The v13 content-pack upgrade: the Shadow Campaign folds into Main Campaign
// encounters, the Headquarters economy disappears, the fifteen-relic Archive
// becomes one four-piece world relic plus Mastery skins, and Expeditions lose
// per-template durations. Legacy packs (the v4 sample pack and the author's
// v12 export) must climb the whole ladder without producing held-back content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upgradeCustomDB, mergeContent, CUSTOM_DB_VERSION, RELIC_PIECE_NODES } from '../src/core/custom.js';
import { buildContent } from '../src/core/content.js';
import { validateContent } from '../src/core/validate.js';
import { loadSystemRaw } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const legacyPack = () => JSON.parse(readFileSync(join(here, 'fixtures', 'pack-v4.json'), 'utf8'));

const REMOVED_RESOURCE_IDS = new Set(['renown', '@associated_world_asset']);
function scanForRemovedEntries(value, path = '', hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForRemovedEntries(item, `${path}[${i}]`, hits));
  } else if (value && typeof value === 'object') {
    if (value.kind === 'resource' && REMOVED_RESOURCE_IDS.has(value.id)) hits.push(path);
    for (const [key, item] of Object.entries(value)) scanForRemovedEntries(item, `${path}.${key}`, hits);
  }
  return hits;
}
// Only the fields the runtime actually consumes: packs may carry unknown
// author-side keys, and the upgrade deliberately leaves those untouched.
function findRemovedEntries(db) {
  return scanForRemovedEntries({
    worlds: db.worlds.map(world => ({ campaignNodes: world.campaignNodes })),
    mainChapters: db.mainChapters,
    expeditions: db.expeditions,
    crises: db.crises
  });
}

test('a legacy pack climbs the ladder to v13', () => {
  const legacy = legacyPack();
  const db = upgradeCustomDB(legacy);
  assert.equal(db.version, CUSTOM_DB_VERSION);
  assert.equal(db.shadowChapters, undefined);

  // Shadow shard assignments became Main Campaign encounters, node for node.
  legacy.shadowChapters.forEach((shadow, ci) => {
    shadow.nodes.forEach((nd, i) => {
      assert.equal(db.mainChapters[ci].nodes[i].encounterCharacterId, nd.shardCharacterId);
    });
  });

  for (const world of db.worlds) {
    assert.equal(world.archive, undefined);
    assert.equal(world.hq, undefined);
    assert.equal(world.hqImage, undefined);
    assert.equal(world.worldAsset, undefined);
    assert.equal(world.relic.pieces.length, 4);
    assert.ok(world.relic.name.length > 0);
    assert.ok(world.masterySkins.length >= 1);
    for (const nd of world.campaignNodes) assert.equal(nd.shardCharacterId, undefined);
  }

  // Renown and World Assets are gone from every reward list.
  assert.deepEqual(findRemovedEntries(db), []);

  for (const template of db.expeditions.templates) assert.equal(template.durations, undefined);
  assert.equal(db.expeditions.settings.cycleLengthDays, 4);
  for (const grade of db.crises.settings.grades) {
    assert.equal(grade.minHqRank, undefined);
    assert.ok(typeof grade.minMasteryRank === 'string');
  }
});

test('upgrading is idempotent at v13', () => {
  const once = upgradeCustomDB(legacyPack());
  const twice = upgradeCustomDB(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('the upgraded pack merges with nothing held back and validates', async () => {
  const systemRaw = await loadSystemRaw();
  const db = upgradeCustomDB(legacyPack());
  const { raw, health } = mergeContent(systemRaw, db);
  assert.deepEqual(health.filter(note => note.level !== 'info'), []);
  const content = buildContent(raw);
  const result = validateContent(content);
  assert.deepEqual(result.errors, []);

  // No Shadow Campaign remains; every character is revealed by an encounter.
  assert.equal(content.nodesByCampaign.shadow, undefined);
  for (const def of content.characters) {
    if (!def.starting) assert.ok((content.encounterNodesByCharacter[def.id] ?? []).length > 0, `${def.id} has an encounter`);
  }

  // Encounter first clears stake two shards; relic pieces sit at 4/9/15/21.
  for (const node of content.nodes) {
    if (node.encounterCharacter) {
      assert.deepEqual(node.firstClear.shards, { characterId: node.encounterCharacter, qty: 2 });
    }
  }
  for (const world of content.worlds) {
    const relic = content.relicByWorld[world.id];
    assert.equal(relic.pieces.length, RELIC_PIECE_NODES.length);
    relic.pieces.forEach((piece, index) => {
      const node = content.nodeById[piece.sourceNode];
      assert.equal(node.number, RELIC_PIECE_NODES[index]);
      assert.equal(node.firstClear.relicPiece, piece.id);
    });
  }
});

test('the author pack (v12 export) reaches v13 clean', async () => {
  const systemRaw = await loadSystemRaw();
  const authored = JSON.parse(readFileSync(join(here, '..', 'default_content.json'), 'utf8'));
  const db = upgradeCustomDB(authored);
  assert.equal(db.version, CUSTOM_DB_VERSION);
  assert.deepEqual(findRemovedEntries(db), []);
  const { raw, health } = mergeContent(systemRaw, db);
  assert.deepEqual(health.filter(note => note.level !== 'info'), []);
  const content = buildContent(raw);
  assert.deepEqual(validateContent(content).errors, []);
  assert.equal(content.worlds.length, 6);
  assert.equal(content.relics.length, 6);
});
