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
  const preferred = store.state.ui.nodePartyById?.[node.id];
  const index = Number.isInteger(preferred) ? preferred : store.state.activePartyIndex;
  const party = store.state.parties[index] ?? store.state.parties[0];
  const members = party?.members.filter(Boolean) ?? [];
  const raw = members.reduce((sum, id) => sum + characterPower(store.content, store.state.characters[id]), 0);
  const evaluation = members.length === 5 ? evaluateParty(store.content, store.state, members) : null;
  return {
    party, members, raw, effective: evaluation?.effectivePower ?? raw
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

export function rankTodayHook(content, state, readyItems, frontiers) {
  const crisis = state.crises?.active;
  if (crisis && (crisis.status === 'planning' || (crisis.status === 'resolved' && crisis.result?.outcome !== 'endured' && !crisis.cacheClaimed))) {
    return { kind: 'crisis', crisis, def: content.crisisById[crisis.definitionId] };
  }
  const shardCandidates = content.characters.flatMap((def, order) => {
    const cs = state.characters[def.id];
    const need = cs.owned
      ? (cs.stars < 7 ? content.balance.starShards[cs.stars] : null)
      : content.balance.acquisitionTiers[def.tier].cumulativeShards;
    return need == null ? [] : [{ kind: 'shards', def, cs, need, gap: Math.max(0, need - cs.shards), order }];
  }).filter(item => item.gap > 0).sort((a, b) => a.gap - b.gap || a.order - b.order);
  if (shardCandidates.length) return shardCandidates[0];

  const complete = readyItems.find(item => item.type === 'completeTier');
  if (complete) return { kind: 'gear', item: complete, def: content.characterById[complete.characterId] };

  if (frontiers.length) return { kind: 'campaign', node: [...frontiers].sort((a, b) => a.threshold - b.threshold)[0] };
  return { kind: 'quiet' };
}

export function todayHookText(hook) {
  if (hook.kind === 'crisis') return {
    headline: hook.crisis.status === 'planning'
      ? `${hook.crisis.name} is asking for an answer.` : 'An Emergency Cache is still waiting.',
    route: '#/crisis'
  };
  if (hook.kind === 'shards') {
    const goal = hook.cs.owned ? `${hook.cs.stars + 1}${ordinal(hook.cs.stars + 1)} star` : 'unlock';
    return {
      headline: `${hook.def.displayName} is ${hook.gap} shard${hook.gap === 1 ? '' : 's'} from ${hook.cs.owned ? `their ${goal}` : 'joining you'}.`,
      route: `#/character/${hook.def.id}`
    };
  }
  if (hook.kind === 'gear') return {
    headline: `${hook.def.displayName}'s next gear tier is ready.`,
    route: `#/character/${hook.def.id}`
  };
  if (hook.kind === 'campaign') return {
    headline: `${hook.node.displayName} is the next ground to take.`,
    route: `#/node/${hook.node.id}`
  };
  return { headline: 'Nothing is waiting — the courtyard is quiet.', route: '#/campaign' };
}

function ordinal(n) {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

export function relicPieceModel(store, relic) {
  return relic.fragments.map((fragment, index) => ({
    side: index === 0 ? 'left' : 'right',
    fragment,
    owned: !!store.state.archive.fragments[fragment.id],
    node: store.content.nodeById[fragment.sourceNode]
  }));
}

export function collectionSummary(collection) {
  const whole = collection.relics.filter(item => item.complete).length;
  const half = collection.relics.filter(item => item.owned === 1).length;
  const buried = collection.relics.filter(item => item.owned === 0).length;
  return `${whole} whole, ${half} half-found, ${buried} still buried`;
}

export function activeGearTier(store, characterId) {
  return activeTier(store.content.balance, store.state.characters[characterId], store.content.maxGearTier);
}
