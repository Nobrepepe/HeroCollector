import { nodePartyIsCustom, nodePartyMembers, preferredPartyIndex } from '../core/state.js';
import { characterPower } from '../core/power.js';
import { activeTier } from '../core/power.js';
import { evaluateParty } from '../core/synergy.js';

export function campaignFrontiers(content, state, nodeState, nodeUnlocked) {
  return ['main', ...content.worlds.map(world => world.campaignId)]
    .map(campaign => {
      const nodes = content.nodesByCampaign[campaign] ?? [];
      const node = nodes.find(item => !nodeState(state, item.id).cleared);
      return node && nodeUnlocked(content, state, node).unlocked ? node : null;
    })
    .filter(Boolean);
}

export function sceneImage(store, node = null) {
  if (node) {
    const chapter = store.content.images.chapter?.[`${node.campaign}:${node.chapter}`];
    if (chapter) return chapter;
  }
  const worldId = node?.world ?? store.content.worlds.find(world => store.content.images.world[world.id])?.id;
  return worldId ? store.content.images.world[worldId] ?? null : null;
}

export function selectedPartyPower(store, node) {
  const party = store.state.parties[preferredPartyIndex(store.state, node.id)] ?? store.state.parties[0];
  // The node may hold five of its own; the reading has to be of those, and it
  // must not go on calling them by the preset's name once it does.
  const custom = nodePartyIsCustom(store.state, node.id);
  const members = nodePartyMembers(store.state, node.id).filter(Boolean);
  const raw = members.reduce((sum, id) => sum + characterPower(store.content, store.state.characters[id]), 0);
  const evaluation = members.length === 5 ? evaluateParty(store.content, store.state, members) : null;
  return {
    party, custom, name: custom ? 'party' : party?.name ?? 'party',
    members, raw, effective: evaluation?.effectivePower ?? raw
  };
}

export function partyHeadline(evaluation, memberCount) {
  if (memberCount === 0) return 'No one is standing with you yet.';
  if (memberCount < 5) return `${memberCount} of five are standing together.`;
  if (evaluation.capped) return `They are pulling +${evaluation.cappedBp / 100}% together — the cap is holding.`;
  return `They are pulling +${evaluation.cappedBp / 100}% together.`;
}

export function bestPartySwap(content, state, slots) {
  const members = slots.filter(Boolean);
  if (members.length < content.balance.partySize) {
    return { kind: 'empty', slotIndex: slots.findIndex(id => !id) };
  }
  const before = evaluateParty(content, state, members);
  const current = new Set(members);
  const candidates = [];
  slots.forEach((outgoingId, slotIndex) => {
    content.characters.forEach((incoming, contentOrder) => {
      if (!state.characters[incoming.id]?.owned || current.has(incoming.id)) return;
      const next = [...slots];
      next[slotIndex] = incoming.id;
      const after = evaluateParty(content, state, next);
      const effectiveGain = after.effectivePower - before.effectivePower;
      if (effectiveGain <= 0) return;
      const beforeActive = new Map(before.active.map(item => [item.tag.id, item.bonusBp]));
      const improved = after.active.filter(item => item.bonusBp > (beforeActive.get(item.tag.id) ?? 0));
      candidates.push({
        kind: 'swap', slotIndex, outgoingId, incomingId: incoming.id,
        before, after, effectiveGain,
        synergyGainBp: after.cappedBp - before.cappedBp,
        improved, contentOrder
      });
    });
  });
  candidates.sort((a, b) =>
    b.effectiveGain - a.effectiveGain
    || b.synergyGainBp - a.synergyGainBp
    || a.slotIndex - b.slotIndex
    || a.contentOrder - b.contentOrder);
  return candidates[0] ?? { kind: 'none', before };
}

// The Crisis is the one thing on Today that can still ask for an answer before
// the reset, so it is the only hook the screen carries. A ready gear tier and
// the next ground to take are already stated a few lines below in Ready when
// you are and Continue; they never needed a second voice at the top.
export function crisisAsking(state, worldId = null) {
  const crisis = state.crises?.active;
  if (!crisis || (worldId && crisis.worldId !== worldId)) return null;
  const asking = crisis.status === 'planning'
    || (crisis.status === 'resolved' && crisis.result?.outcome !== 'endured' && !crisis.cacheClaimed);
  return asking ? crisis : null;
}

export function crisisNotice(state) {
  const crisis = crisisAsking(state);
  if (!crisis) return null;
  return crisis.status === 'planning'
    ? { crisis, text: `${crisis.name} is open until reset.`, verb: 'Review it →' }
    : { crisis, text: `${crisis.name} is answered and its Emergency Cache is still waiting.`, verb: 'Open the Cache →' };
}

function ordinal(n) {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'];

const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety'];

// Headlines count in words; readings and totals stay numerals. "Five routes are
// waiting." reads as a sentence, "5 routes" reads as a table cell. Today's
// headline counts Energy the same way, so this spells the whole storage cap.
export function countWord(n, { capitalize = false } = {}) {
  const word = spellCount(n);
  return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
}

function spellCount(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < COUNT_WORDS.length) return COUNT_WORDS[n];
  if (n < 100) {
    const tens = TENS_WORDS[Math.floor(n / 10)];
    return n % 10 ? `${tens}-${COUNT_WORDS[n % 10]}` : tens;
  }
  const hundreds = `${COUNT_WORDS[Math.floor(n / 100)]} hundred`;
  return n % 100 ? `${hundreds} and ${spellCount(n % 100)}` : hundreds;
}

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

export function ordinalWord(n) {
  return ORDINAL_WORDS[n] ?? `${n}${ordinal(n)}`;
}

// Names a party in prose: "Suzume, Hoshi and Ayame".
export function nameList(names) {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// Characters of a world, memoised on the content object so the world hub can
// read a world's roster total without filtering at render time.
export function charactersByWorld(content, worldId) {
  const cache = content.__charactersByWorld ??= (() => {
    const map = new Map();
    for (const def of content.characters) {
      if (!map.has(def.world)) map.set(def.world, []);
      map.get(def.world).push(def);
    }
    return map;
  })();
  return cache.get(worldId) ?? [];
}

export function activeGearTier(store, characterId) {
  return activeTier(store.content.balance, store.state.characters[characterId], store.content.maxGearTier);
}
