// The promotion payoff (design turn 13) is a diff of two readings of the
// world, so these tests care about one thing: that a line is only written
// when the star actually bought something, and that the wording names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from './helpers.mjs';
import { newPlayerState, promoteStar, togglePin } from '../src/core/state.js';
import { evaluateParty } from '../src/core/synergy.js';
import { promotionSnapshot, promotionConsequences, rankShift, starName } from '../src/core/consequences.js';

const T0 = Date.parse('2026-07-25T12:00:00');

// A save with the five starters in party one, and one of them holding exactly
// the shards their next star costs.
function ready(content, { stars = null } = {}) {
  const state = newPlayerState(content, T0);
  const party = content.characters.filter(def => def.starting).slice(0, 5).map(def => def.id);
  state.parties[0].members = [...party];
  const id = party[0];
  const cs = state.characters[id];
  if (stars !== null) cs.stars = stars;
  cs.shards = content.balance.starShards[cs.stars];
  return { state, id, party };
}

test('a threshold that crossed from out of reach to inside it is named first', () => {
  const content = loadContent();
  const { state, id, party } = ready(content);
  const before = promotionSnapshot(content, state, id);
  const node = content.nodesByCampaign.main[0];
  node.threshold = evaluateParty(content, state, party).effectivePower + 1;

  assert.equal(promoteStar(content, state, id).ok, true);
  const lines = promotionConsequences(content, state, id, before);
  assert.match(lines[0].text, /comes inside reach/);
  assert.match(lines[0].text, new RegExp(node.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(lines[0].tone, 'good');
});

test('a threshold already inside reach is not sold as new', () => {
  const content = loadContent();
  const { state, id, party } = ready(content);
  const before = promotionSnapshot(content, state, id);
  content.nodesByCampaign.main[0].threshold = evaluateParty(content, state, party).effectivePower - 1;

  promoteStar(content, state, id);
  const lines = promotionConsequences(content, state, id, before);
  assert.equal(lines.some(line => /comes inside reach/.test(line.text)), false);
});

test('an offer that needs a star lead names it once the lead exists', () => {
  const content = loadContent();
  const { state, id } = ready(content, { stars: 2 });
  state.expeditions.board = {
    day: state.dayNumber,
    offers: [{
      name: 'The Long Way Round',
      requirements: [{ type: 'party_size', count: 2 }],
      optional: { type: 'star_character', stars: 3, count: 1 }
    }]
  };
  const before = promotionSnapshot(content, state, id);

  promoteStar(content, state, id);
  const lines = promotionConsequences(content, state, id, before);
  const line = lines.find(l => /The Long Way Round/.test(l.text));
  assert.ok(line, 'the offer whose star bar was crossed should be named');
  assert.match(line.text, /exceptional tier/);

  // The same offer says nothing on the next promotion — the bar is behind her.
  state.characters[id].shards = content.balance.starShards[state.characters[id].stars];
  const second = promotionSnapshot(content, state, id);
  promoteStar(content, state, id);
  assert.equal(promotionConsequences(content, state, id, second)
    .some(l => /The Long Way Round/.test(l.text)), false);
});

test('a tracked goal that this star completed is reported as done', () => {
  const content = loadContent();
  const { state, id } = ready(content);
  togglePin(state, { type: 'character', characterId: id }, content);
  const before = promotionSnapshot(content, state, id);

  promoteStar(content, state, id);
  const lines = promotionConsequences(content, state, id, before);
  assert.ok(lines.some(line => /goal you were tracking is done/.test(line.text)));
});

test('the last line always prices the next star, and closes at seven', () => {
  const content = loadContent();
  const { state, id } = ready(content);
  const before = promotionSnapshot(content, state, id);
  promoteStar(content, state, id);

  const lines = promotionConsequences(content, state, id, before);
  const stars = state.characters[id].stars;
  assert.match(lines.at(-1).text,
    new RegExp(`The ${starName(stars + 1)} star asks ${content.balance.starShards[stars]} shards`));

  state.characters[id].stars = 7;
  const closing = promotionConsequences(content, state, id, before).at(-1);
  assert.match(closing.text, /Seven stars/);
});

test('never more than three lines, and never zero', () => {
  const content = loadContent();
  const { state, id, party } = ready(content);
  togglePin(state, { type: 'character', characterId: id }, content);
  const before = promotionSnapshot(content, state, id);
  content.nodesByCampaign.main[0].threshold = evaluateParty(content, state, party).effectivePower + 1;
  promoteStar(content, state, id);

  assert.equal(promotionConsequences(content, state, id, before).length, 3);

  const bare = loadContent();
  const solo = newPlayerState(bare, T0);
  const loner = bare.characters.find(def => def.starting).id;
  solo.parties.forEach(p => { p.members = [null, null, null, null, null]; });
  solo.characters[loner].shards = bare.balance.starShards[solo.characters[loner].stars];
  const snapshot = promotionSnapshot(bare, solo, loner);
  promoteStar(bare, solo, loner);
  assert.equal(promotionConsequences(bare, solo, loner, snapshot).length, 1);
});

test('rankShift names who was passed, and stays quiet when nobody was', () => {
  const content = loadContent();
  const { state, id, party } = ready(content);
  // Put someone just far enough ahead that one star is enough to pass them.
  const rival = party[1];
  state.characters[rival].stars = state.characters[id].stars + 1;
  const before = promotionSnapshot(content, state, id);

  promoteStar(content, state, id);
  const shift = rankShift(content, state, id, before);
  assert.ok(shift.wasRank > shift.rank, 'the promotion should have moved her up');
  assert.deepEqual(shift.passed, [content.characterById[rival].displayName]);

  const settled = promotionSnapshot(content, state, id);
  assert.deepEqual(rankShift(content, state, id, settled).passed, []);
});
