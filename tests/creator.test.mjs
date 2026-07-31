// Custom-content (Content Creator) rules under the "everything is authored"
// model: merge correctness, publish gates, held-back content, game readiness,
// save reconciliation, and an end-to-end fully-custom game played through real
// transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContent } from '../src/core/content.js';
import { validateContent } from '../src/core/validate.js';
import {
  emptyCustomDB, upgradeCustomDB, newCustomWorld, newCustomCharacter,
  addCampaignChapter, canPublishWorld, mergeContent, gameReadiness
} from '../src/core/custom.js';
import {
  newPlayerState, syncSaveWithContent, clearNode, nodeState,
  checkUnlockCharacter, unlockCharacter, worldCampaignUnlocked
} from '../src/core/state.js';
import { makeRng } from '../src/core/rng.js';
import { loadSystemRaw, loadSamplePack, loadContent, maxOut } from './helpers.mjs';

const systemRaw = loadSystemRaw();
const SLOTS = systemRaw.characters.slotOrder;
const SLOT_META = systemRaw.characters.slots;

// A complete, publishable custom game: one world, 5 starting minors, 2 chapters.
function makeFullDB() {
  const db = emptyCustomDB();
  const w = newCustomWorld('Ember Reach');
  w.tagline = 'A volcanic frontier.';
  w.icon = '🌋';
  db.worlds.push(w);
  const archetypes = ['leader', 'caretaker', 'achiever', 'rebel', 'dreamer'];
  for (let i = 0; i < 5; i++) {
    const c = newCustomCharacter(w.id, `Hero ${i + 1}`, SLOTS, SLOT_META);
    c.archetype = archetypes[i];
    c.starting = true;
    c.portrait = 'data:image/webp;base64,AAA';
    db.characters.push(c);
  }
  w.campaignNodes[0].shardCharacterId = db.characters[0].id;
  addCampaignChapter(db);
  db.shadowChapters[0].nodes.forEach((nd, i) => { nd.shardCharacterId = db.characters[i % 5].id; });
  addCampaignChapter(db);
  db.shadowChapters[1].nodes.forEach((nd, i) => { nd.shardCharacterId = db.characters[(i + 3) % 5].id; });
  return db;
}

test('empty creator DB merges to an empty, not-ready game', () => {
  const merged = mergeContent(systemRaw, emptyCustomDB());
  const content = buildContent(merged.raw);
  assert.ok(validateContent(content).ok);
  assert.equal(content.worlds.length, 0);
  assert.equal(content.characters.length, 0);
  assert.equal(content.nodes.length, 0);
  const ready = gameReadiness(content);
  assert.ok(!ready.ready);
  assert.equal(ready.checks.filter(c => c.ok).length, 0);
  // an empty game still boots into a valid (setup-mode) save
  const s = newPlayerState(content, Date.parse('2026-07-24T12:00:00'));
  assert.equal(s.parties[0].members.length, 5);
});

test('v2 migration moves legacy Main shards into incomplete paired Shadow chapters', () => {
  const legacy = makeFullDB();
  legacy.version = 2;
  delete legacy.shadowChapters;
  legacy.mainChapters[0].nodes[2].shardCharacterId = legacy.characters[0].id;
  legacy.mainChapters[0].nodes[5].shardCharacterId = legacy.characters[1].id;
  legacy.mainChapters[0].nodes[8].shardCharacterId = legacy.characters[2].id;
  const upgraded = upgradeCustomDB(legacy);
  assert.equal(upgraded.version, 9);
  assert.equal(upgraded.shadowChapters.length, upgraded.mainChapters.length);
  assert.equal(upgraded.shadowChapters[0].nodes[2].shardCharacterId, legacy.characters[0].id);
  assert.equal(upgraded.shadowChapters[0].nodes[0].shardCharacterId, null);
  assert.ok(upgraded.mainChapters.every(ch => ch.nodes.every(nd => !('shardCharacterId' in nd))));
  assert.ok(upgraded.mainChapters.every(ch => ch.image === null));
  assert.ok(upgraded.shadowChapters.every(ch => ch.image === null));
  assert.deepEqual(upgraded.worlds[0].campaignChapterImages, [null, null, null]);
  assert.deepEqual(upgraded.worlds[0].campaignChapterTitles, [
    'Ember Reach · Chapter 1', 'Ember Reach · Chapter 2', 'Ember Reach · Chapter 3'
  ]);
  assert.equal(upgraded.mainChapters[0].title, 'Main Chapter 1');
  assert.equal(upgraded.shadowChapters[0].title, 'Shadow Chapter 1');
  assert.equal(upgraded.worlds[0].hqImage, null);
  assert.deepEqual(upgraded.expeditions.images, { global: null, worlds: {} });
});

test('Expedition and Headquarters artwork survives creator merge under stable world IDs', () => {
  const db = loadSamplePack();
  const world = db.worlds[0];
  db.expeditions.images.global = 'data:image/webp;base64,GLOBAL';
  db.expeditions.images.worlds[world.id] = 'data:image/webp;base64,OFFER';
  world.hqImage = 'data:image/webp;base64,HQ';
  world.hq.facilities[0].image = 'data:image/webp;base64,BUILDING';
  const merged = mergeContent(systemRaw, db);
  assert.equal(merged.images.expedition.global, 'data:image/webp;base64,GLOBAL');
  assert.equal(merged.images.expedition[world.id], 'data:image/webp;base64,OFFER');
  assert.equal(merged.images.headquarters[world.id], 'data:image/webp;base64,HQ');
  assert.equal(merged.images.facility[world.hq.facilities[0].id], 'data:image/webp;base64,BUILDING');
});

test('sample pack merges cleanly into the full shipped game, all editable data', () => {
  const merged = mergeContent(systemRaw, loadSamplePack());
  const content = buildContent(merged.raw);
  assert.deepEqual(validateContent(content).errors, []);
  assert.equal(content.worlds.length, 2);
  assert.equal(content.characters.length, 20);
  assert.equal(content.nodes.length, 100);
  assert.equal(content.characters.filter(d => d.starting).length, 5);
  assert.ok(gameReadiness(content).ready);
  // main campaign chain intact; objectives carried through
  assert.equal(content.nodeById.main_1.previous, null);
  assert.equal(content.nodeById.main_3.type, 'ordinary');
  assert.equal(content.nodeById.shadow_3.type, 'shard');
  assert.ok(content.nodeById.main_5.objective);
  // world campaigns + archives present under the new ids
  assert.equal(content.nodesByCampaign.wc_world_hidden_village.length, 30);
  assert.equal(content.archiveByWorld.world_hidden_village.collections.length, 3);
  assert.equal(content.maxGearTier, 6);
  assert.equal(new Set(content.nodesByCampaign.shadow.map(n => n.shardCharacter)).size, 20);
  assert.ok(content.nodesByCampaign.main.every(n => !n.shardCharacter));
  assert.ok(content.worlds.every(w => content.archiveByWorld[w.id].collections.every(c => c.rewardSkin)));
  assert.ok(content.worlds.every(w => content.archiveByWorld[w.id].fullReward));
});

test('publish gate: 5-character minimum and shard sources required', () => {
  const db = emptyCustomDB();
  const w = newCustomWorld('Tiny World');
  db.worlds.push(w);
  for (let i = 0; i < 4; i++) db.characters.push(newCustomCharacter(w.id, `C${i}`, SLOTS, SLOT_META));
  let gate = canPublishWorld(db, w.id);
  assert.ok(!gate.ok);
  assert.match(gate.reasons[0], /at least 5 characters/);
  db.characters.push(newCustomCharacter(w.id, 'C5', SLOTS, SLOT_META));
  gate = canPublishWorld(db, w.id);
  assert.ok(!gate.ok);
  assert.match(gate.reasons[0], /shard source/);
  addCampaignChapter(db);
  db.shadowChapters[0].nodes.forEach((nd, i) => { nd.shardCharacterId = db.characters[i % 5].id; });
  gate = canPublishWorld(db, w.id);
  assert.ok(gate.ok, gate.reasons.join('; '));
});

test('draft world: its characters and dependent chapters are held back', () => {
  const db = makeFullDB(); // world left as draft
  const merged = mergeContent(systemRaw, db);
  const content = buildContent(merged.raw);
  assert.ok(validateContent(content).ok);
  assert.equal(content.worlds.length, 0);
  assert.equal(content.characters.length, 0);
  assert.equal((content.nodesByCampaign.shadow ?? []).length, 0);
  assert.ok(merged.health.some(x => /held back/.test(x.text)));
  assert.ok(!gameReadiness(content).ready);
});

test('published custom game merges completely, validates, and is ready', () => {
  const db = makeFullDB();
  db.worlds[0].status = 'published';
  db.mainChapters[0].image = 'data:image/webp;base64,MAIN';
  db.mainChapters[0].title = 'Embers at the Gate';
  db.shadowChapters[0].image = 'data:image/webp;base64,SHADOW';
  db.shadowChapters[0].title = 'Ashes After Dark';
  db.worlds[0].campaignChapterImages[1] = 'data:image/webp;base64,WORLD';
  db.worlds[0].campaignChapterTitles[1] = 'The Caldera Road';
  const merged = mergeContent(systemRaw, db);
  const content = buildContent(merged.raw);
  assert.deepEqual(validateContent(content).errors, []);
  const w = db.worlds[0];
  assert.equal(content.worlds.length, 1);
  assert.equal(content.characters.length, 5);
  assert.ok(gameReadiness(content).ready);
  // chapters 1–2 -> nodes 1–20; chain starts at null
  assert.equal(content.nodeById.main_1.previous, null);
  assert.equal(content.nodeById.main_3.type, 'ordinary');
  assert.equal(content.nodeById.shadow_3.type, 'shard');
  assert.equal(content.nodeById.shadow_3.shardCharacter, db.characters[2].id);
  assert.equal(content.nodeById.main_5.checkpoint, true);
  assert.equal(content.nodeById.main_20.chapter, 2);
  assert.equal(content.nodeById.main_1.chapterTitle, 'Embers at the Gate');
  assert.equal(content.nodeById.shadow_1.chapterTitle, 'Ashes After Dark');
  // world campaign + archive
  assert.equal(content.nodesByCampaign[`wc_${w.id}`].length, 30);
  assert.equal(content.nodeById[`wc_${w.id}_1`].shardCharacter, db.characters[0].id);
  assert.equal(content.nodeById[`wc_${w.id}_11`].chapterTitle, 'The Caldera Road');
  assert.ok(content.shardNodesByCharacter[db.characters[0].id].some(n => n.id === `wc_${w.id}_1`));
  assert.equal(content.archiveByWorld[w.id].collections.reduce((s, c) => s + c.relics.length, 0), 15);
  // imported art flows through
  assert.equal(merged.images.portrait[db.characters[0].id], 'data:image/webp;base64,AAA');
  assert.equal(merged.images.chapter['main:1'], 'data:image/webp;base64,MAIN');
  assert.equal(merged.images.chapter['shadow:1'], 'data:image/webp;base64,SHADOW');
  assert.equal(merged.images.chapter[`wc_${w.id}:2`], 'data:image/webp;base64,WORLD');
  // starting flags survive
  assert.equal(content.characters.filter(d => d.starting).length, 5);
});

test('non-monotonic thresholds hold a chapter (and the chapters after it) back', () => {
  const db = makeFullDB();
  db.worlds[0].status = 'published';
  db.mainChapters[0].nodes[4].threshold = 1; // decreases mid-chapter
  const merged = mergeContent(systemRaw, db);
  const content = buildContent(merged.raw);
  assert.ok(validateContent(content).ok);
  assert.equal((content.nodesByCampaign.main ?? []).length, 0); // ch1 held, ch2 chained off it
  assert.ok(merged.health.some(x => /never decrease/.test(x.text)));
});

test('starting flag only counts for Minor characters', () => {
  const db = makeFullDB();
  db.worlds[0].status = 'published';
  db.characters[0].tier = 'major';       // still flagged starting
  db.characters[0].starting = true;
  const merged = mergeContent(systemRaw, db);
  const content = buildContent(merged.raw);
  assert.equal(content.characters.filter(d => d.starting).length, 4);
  assert.ok(!gameReadiness(content).ready);
});

test('save reconciliation: starting characters granted, missing ones dormant', () => {
  const content0 = loadContent();
  const s = newPlayerState(buildContent(mergeContent(systemRaw, emptyCustomDB()).raw), Date.parse('2026-07-24T12:00:00'));
  assert.equal(Object.keys(s.characters).length, 0); // created in setup mode
  // content becomes the sample game: characters appear, starters granted
  const report = syncSaveWithContent(content0, s);
  assert.equal(content0.characters.filter(d => s.characters[d.id]?.owned).length, 5);
  assert.ok(report.some(r => /starting character/i.test(r)));
  assert.ok(s.parties[0].members.filter(Boolean).length === 5); // first preset filled
  // content shrinks again: owned progress dormant, parties detached
  s.characters.char_suzume.stars = 4;
  const empty = buildContent(mergeContent(systemRaw, emptyCustomDB()).raw);
  const report2 = syncSaveWithContent(empty, s);
  assert.equal(s.parties[0].members.filter(Boolean).length, 0);
  assert.equal(s.characters.char_suzume.stars, 4); // kept dormant
  assert.ok(report2.some(r => /dormant/.test(r)));
});

test('end-to-end: a fully custom game plays through real transactions', () => {
  const db = makeFullDB();
  db.worlds[0].status = 'published';
  const merged = mergeContent(systemRaw, db);
  const content = buildContent(merged.raw);
  assert.ok(validateContent(content).ok);

  const now = Date.parse('2026-07-24T12:00:00');
  const s = newPlayerState(content, now);
  const rng = makeRng(7);
  // the five custom starters are owned at 1★ from the start
  const party = db.characters.map(c => c.id);
  assert.ok(party.every(id => s.characters[id].owned && s.characters[id].stars === 1));

  // the first node is clearable by the fresh starting party
  const r1 = clearNode(content, s, 'main_1', party, 1, rng, now);
  assert.ok(r1.ok, (r1.reasons ?? []).join('; '));

  // march to the world campaign with dev-style grants, then play it for real
  maxOut(content, s, party);
  s.energy = 100000;
  for (let n = 2; n <= 20; n++) {
    const r = clearNode(content, s, `main_${n}`, party, 1, rng, now);
    assert.ok(r.ok, `main_${n}: ${(r.reasons ?? []).join('; ')}`);
  }
  assert.ok(worldCampaignUnlocked(content, s, db.worlds[0].id).unlocked);
  const wr = clearNode(content, s, `wc_${db.worlds[0].id}_1`, party, 1, rng, now);
  assert.ok(wr.ok, (wr.reasons ?? []).join('; '));
  assert.deepEqual(wr.rewards.fragments, [`frag_${db.worlds[0].id}_1`]);
});
