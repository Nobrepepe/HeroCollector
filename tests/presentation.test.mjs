import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankTodayHook, todayHookText, relicPieceModel, collectionSummary, sceneImage
} from '../src/ui/presentation.js';

test('Today chooses the smallest remaining shard gap with stable content-order ties', () => {
  const content = {
    characters: [
      { id: 'a', displayName: 'Ashley', tier: 'minor' },
      { id: 'b', displayName: 'Bridget', tier: 'minor' }
    ],
    balance: {
      starShards: [10, 25, 50, 75, 110, 150, 200],
      acquisitionTiers: { minor: { cumulativeShards: 10 } }
    }
  };
  const state = {
    characters: {
      a: { owned: true, stars: 4, shards: 65 },
      b: { owned: true, stars: 4, shards: 65 }
    }
  };
  const hook = rankTodayHook(content, state, [], []);
  assert.equal(hook.def.id, 'a');
  assert.equal(hook.gap, 45);
  assert.match(todayHookText(hook).headline, /Ashley/);
});

test('Today falls through to gear, campaign, then quiet', () => {
  const content = {
    characters: [{ id: 'a', displayName: 'Ashley', tier: 'minor' }],
    characterById: { a: { id: 'a', displayName: 'Ashley' } },
    balance: {
      starShards: [10, 25, 50, 75, 110, 150, 200],
      acquisitionTiers: { minor: { cumulativeShards: 10 } }
    }
  };
  const maxed = { characters: { a: { owned: true, stars: 7, shards: 0 } } };
  assert.equal(rankTodayHook(content, maxed, [{ type: 'completeTier', characterId: 'a' }], []).kind, 'gear');
  assert.equal(rankTodayHook(content, maxed, [], [{ id: 'n', displayName: 'Gate', threshold: 100 }]).kind, 'campaign');
  assert.equal(rankTodayHook(content, maxed, [], []).kind, 'quiet');
});

test('relic model keeps authored fragment order as left then right', () => {
  const relic = {
    fragments: [{ id: 'f1', sourceNode: 'n1' }, { id: 'f2', sourceNode: 'n2' }]
  };
  const store = {
    state: { archive: { fragments: { f2: true } } },
    content: { nodeById: { n1: { id: 'n1' }, n2: { id: 'n2' } } }
  };
  assert.deepEqual(relicPieceModel(store, relic).map(piece => [piece.side, piece.owned]), [
    ['left', false], ['right', true]
  ]);
});

test('collection and scene presentation helpers cover partial and missing art', () => {
  assert.equal(collectionSummary({
    relics: [{ complete: true, owned: 2 }, { complete: false, owned: 1 }, { complete: false, owned: 0 }]
  }), '1 whole, 1 half-found, 1 still buried');
  const store = {
    content: {
      worlds: [{ id: 'w' }],
      images: { world: { w: 'data:image/webp;base64,abc' }, chapter: { 'wc_w:2': 'data:image/webp;base64,chapter' } }
    }
  };
  assert.equal(sceneImage(store, { world: 'w', campaign: 'wc_w', chapter: 2 }), 'data:image/webp;base64,chapter');
  assert.equal(sceneImage(store, { world: 'w' }), 'data:image/webp;base64,abc');
  assert.equal(sceneImage({ content: { worlds: [], images: { world: {} } } }), null);
});
