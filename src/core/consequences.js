// What a promotion made newly possible (design turn 13).
//
// The star sequence pays in consequences rather than confetti, so it needs a
// reading of the world taken before the star and the same reading taken after
// it. `promotionSnapshot` is that reading; `promotionConsequences` is the diff.
// Everything here is read-only — nothing in this file may touch state.
import { evaluateParty } from './synergy.js';
import { previewCrisisFront } from './crises.js';
import { characterPower } from './power.js';
import { nodeState, nodeUnlocked, pinKey } from './state.js';

const fmt = n => Number(n).toLocaleString('en-US');
const PROJECTIONS = ['struggle', 'succeed', 'excel'];
// Stars are named rather than numbered wherever the payoff speaks in
// sentences — "the sixth star" carries where "the 6th star" reads as data.
export const STAR_NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
export const starName = n => STAR_NAMES[n - 1] ?? ordinal(n);

export function promotionSnapshot(content, state, characterId) {
  return {
    stars: state.characters[characterId]?.stars ?? 0,
    parties: partyReadings(content, state, characterId),
    fronts: frontReadings(content, state, characterId),
    pins: (state.pins ?? []).map(pinKey),
    order: powerOrder(content, state)
  };
}

// Up to three lines, each naming something the star just bought. The order of
// the candidate list is the order the lines appear in: what opened, what the
// character now qualifies for, and what the next star costs.
export function promotionConsequences(content, state, characterId, before) {
  const candidates = [nodeInReach, crisisFront, expeditionBar, trackedGoal, rankGained, nextStar];
  const lines = [];
  for (const candidate of candidates) {
    const line = candidate(content, state, characterId, before);
    if (line) lines.push(line);
    if (lines.length === 3) break;
  }
  return lines;
}

// Where the character stands in the collection once the star is counted, and
// who they passed on the way — the reading that replaces the resting rank line.
export function rankShift(content, state, characterId, before) {
  const order = powerOrder(content, state);
  const rank = order.indexOf(characterId) + 1;
  if (!rank) return null;
  const wasRank = before.order.indexOf(characterId) + 1;
  const passed = wasRank > rank
    ? before.order.slice(rank - 1, wasRank - 1).map(id => content.characterById[id]?.displayName).filter(Boolean)
    : [];
  return { rank, total: order.length, wasRank, passed };
}

// ------------------------------------------------------------- the candidates

// The biggest threshold that moved from out of reach to inside it, read
// through whichever of their parties gained the most.
function nodeInReach(content, state, characterId, before) {
  let best = null;
  for (const party of partyReadings(content, state, characterId)) {
    const was = before.parties.find(p => p.index === party.index);
    if (!was || party.power <= was.power) continue;
    for (const node of content.nodes) {
      if (node.threshold > party.power || node.threshold <= was.power) continue;
      if (nodeState(state, node.id).cleared) continue;
      if (!nodeUnlocked(content, state, node).unlocked) continue;
      if (!best || node.threshold > best.node.threshold) best = { node, party };
    }
  }
  if (!best) return null;
  return {
    tone: 'good',
    text: `${nodeLabel(content, best.node)} comes inside reach — it asks ${fmt(best.node.threshold)} and ${best.party.name} now reads ${fmt(best.party.power)}.`
  };
}

// A Crisis Front they are standing on that reads better than it did.
function crisisFront(content, state, characterId, before) {
  for (const front of frontReadings(content, state, characterId)) {
    const was = before.fronts.find(f => f.id === front.id);
    if (!was || PROJECTIONS.indexOf(front.projection) <= PROJECTIONS.indexOf(was.projection)) continue;
    const reading = front.projection === 'excel'
      ? `now reads as one you excel at`
      : `now reads as one you carry`;
    return { tone: 'good', text: `${front.name} ${reading} — ${fmt(front.effectivePower)} against the ${fmt(front.recommendedPower)} it wants.` };
  }
  return null;
}

// An offer on today's board whose star bar they clear on their own for the
// first time. Mandatory requirements outrank the optional objective.
function expeditionBar(content, state, characterId, before) {
  const stars = state.characters[characterId]?.stars ?? 0;
  const name = content.characterById[characterId]?.displayName ?? 'They';
  for (const offer of state.expeditions?.board?.offers ?? []) {
    const mandatory = (offer.requirements ?? []).find(r => crossedStarBar(r, before.stars, stars));
    if (mandatory) {
      return { tone: 'accent', text: `“${offer.name}” will not sail without a ${mandatory.stars}★ lead. ${name} is one now.` };
    }
    if (crossedStarBar(offer.optional, before.stars, stars)) {
      return { tone: 'accent', text: `“${offer.name}” pays its exceptional tier for a ${offer.optional.stars}★ lead — ${name} clears that bar alone.` };
    }
  }
  return null;
}

function crossedStarBar(requirement, wasStars, stars) {
  return requirement?.type === 'star_character'
    && requirement.stars > wasStars && requirement.stars <= stars;
}

// A goal the player was tracking that this star completed. Promotion pins are
// cleared inside the transaction, so the before-snapshot is what proves it.
function trackedGoal(content, state, characterId, before) {
  const name = content.characterById[characterId]?.displayName ?? 'They';
  const stars = state.characters[characterId]?.stars ?? 0;
  const key = `character:${characterId}`;
  if (!before.pins.some(p => p === key)) return null;
  if ((state.pins ?? []).some(p => pinKey(p) === key)) return null;
  return { tone: 'accent', text: `The goal you were tracking is done — ${name} at ${stars}★. Your list is one line shorter.` };
}

function rankGained(content, state, characterId, before) {
  const shift = rankShift(content, state, characterId, before);
  if (!shift || !shift.passed.length) return null;
  const passed = shift.passed.length === 1 ? shift.passed[0]
    : `${shift.passed.slice(0, -1).join(', ')} and ${shift.passed.at(-1)}`;
  const name = content.characterById[characterId]?.displayName ?? 'They';
  return { tone: 'accent', text: `${ordinal(shift.rank)} of ${shift.total} in your collection — ${name} passes ${passed}.` };
}

// Always last, and always available: what the next star costs and where the
// shards for it still come from.
function nextStar(content, state, characterId) {
  const cs = state.characters[characterId];
  const name = content.characterById[characterId]?.displayName ?? 'They';
  if (cs.stars >= 7) {
    return { tone: 'quiet', text: `Seven stars. There is no shard milestone left for ${name} to reach.` };
  }
  const need = content.balance.starShards[cs.stars];
  const source = (content.shardNodesByCharacter[characterId] ?? [])
    .filter(node => nodeUnlocked(content, state, node).unlocked)
    .sort((a, b) => a.number - b.number)[0];
  const where = source ? ` ${nodeLabel(content, source)} still drops them.` : '';
  return {
    tone: 'quiet',
    text: `The ${starName(cs.stars + 1)} star asks ${fmt(need)} shards.${where}`
  };
}

// ------------------------------------------------------------------- readings

function partyReadings(content, state, characterId) {
  return (state.parties ?? []).flatMap((party, index) => {
    const members = (party.members ?? []).filter(Boolean);
    if (!members.includes(characterId)) return [];
    return [{ index, name: party.name || `Party ${index + 1}`, power: evaluateParty(content, state, members).effectivePower }];
  });
}

function frontReadings(content, state, characterId) {
  const active = state.crises?.active;
  if (!active || active.status !== 'planning') return [];
  return (active.fronts ?? []).flatMap(front => {
    const assignment = active.assignments?.[front.id] ?? [];
    if (!assignment.includes(characterId)) return [];
    const preview = previewCrisisFront(content, state, front, assignment);
    return [{ id: front.id, name: front.displayName, projection: preview.projection,
      effectivePower: preview.effectivePower, recommendedPower: preview.recommendedPower }];
  });
}

function powerOrder(content, state) {
  return content.characters
    .filter(def => state.characters[def.id]?.owned)
    .sort((a, b) => characterPower(content, state.characters[b.id]) - characterPower(content, state.characters[a.id]))
    .map(def => def.id);
}

function nodeLabel(content, node) {
  const campaign = node.campaign === 'main' ? 'Main'
    : node.campaign === 'shadow' ? 'Shadow'
      : content.worldById[node.world]?.displayName ?? 'Journey';
  return `${campaign} ${node.number} — ${node.displayName}`;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}
