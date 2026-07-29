import { h, fmt, pct } from './dom.js';
import {
  nodeState, nodeUnlocked, nodeEnergyCost, shardAttemptsLeft, checkClear,
  clearNode, maxSweepCount, preferredPartyIndex, selectPartyPreset
} from '../core/state.js';
import { evaluateParty, objectiveSatisfied } from '../core/synergy.js';
import { nodeTypeMeta, nodeRepeatText, campaignLabel } from './shared.js';
import { portrait } from './shared.js';
import { characterPower } from '../core/power.js';
import { showResults } from './results.js';
import { render } from '../app.js';
import { sceneImage } from './presentation.js';

export function renderNode(store, root, nodeId) {
  const { content, state } = store;
  const node = content.nodeById[nodeId];
  if (!node) { root.appendChild(h('p.bad', 'Unknown node.')); return; }
  const ns = nodeState(state, nodeId);
  const meta = nodeTypeMeta(node.type);
  const unlock = nodeUnlocked(content, state, node);
  const cost = nodeEnergyCost(content, node);
  const scene = sceneImage(store, node);
  const returnContext = store.ui.returnContext;

  const page = h('div.node-page');
  page.appendChild(h('div.node-scene' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}
  }));
  page.appendChild(h('button.link.node-back', {
    onclick: () => {
      if (returnContext) {
        store.ui.pendingReopen = returnContext; store.ui.returnContext = null; store.go(returnContext.route);
      } else store.go(`#/campaign/${node.campaign}/${node.chapter}`);
    }
  }, returnContext?.archive ? '← Archive' : '← Journey'));

  const head = h('header.node-head',
    h('div.eyebrow', `${campaignLabel(store, node)} ${node.number} · chapter ${node.chapter} · ${meta.label}`),
    h('h1.display-m', node.displayName),
    h('p', nodeFlavor(node, meta)));
  if (!unlock.unlocked) head.appendChild(h('p.warn', `Locked · ${unlock.reason}`));
  page.appendChild(head);

  const partyPanel = h('section.node-party');
  const select = h('select', { 'aria-label': 'Party preset' });
  let selectedIndex = preferredPartyIndex(state, node.id);
  state.parties.forEach((party, index) => select.appendChild(h('option', {
    value: String(index), selected: index === selectedIndex
  }, party.name)));
  select.addEventListener('change', async () => {
    selectedIndex = Number(select.value);
    await store.tx(() => selectPartyPreset(state, selectedIndex, node.id), { rerender: false });
    paint();
  });
  partyPanel.append(h('div.party-heading', h('div.eyebrow', 'Your party'), select,
    h('button.link', { onclick: () => store.go('#/party') }, 'edit')));
  const dynamic = h('div');
  partyPanel.appendChild(dynamic);
  page.appendChild(partyPanel);

  const rewards = h('section.node-rewards', h('div.eyebrow', 'What waits here'), h('p', rewardSentence(store, node, ns)));
  if (node.shardCharacter) {
    const cs = state.characters[node.shardCharacter];
    const def = content.characterById[node.shardCharacter];
    rewards.appendChild(h('p.caption', cs.stars >= 7
      ? `${def.displayName} is at 7★; shard rolls become guaranteed material.`
      : `${def.displayName} · ${shardAttemptsLeft(content, state, node)} attempts today · ${cs.pity ? 'next shard guaranteed' : `${content.balance.shardChanceBp / 100}% chance, miss then guarantee`}`));
  }
  page.appendChild(rewards);
  root.appendChild(page);

  function paint() {
    dynamic.replaceChildren();
    const party = state.parties[selectedIndex];
    const members = party.members.filter(Boolean);
    const check = checkClear(content, state, node.id, members, 1);
    const evaluation = members.length === 5 ? evaluateParty(content, state, members) : null;
    const comparison = h('div.node-comparison');
    if (evaluation) {
      const clears = evaluation.effectivePower >= node.threshold;
      comparison.append(
        h('div.power-reading',
          h('div.eyebrow', 'Your Vanguard reads'),
          h(`div.display-l.${clears ? 'good' : 'bad'}`, fmt(evaluation.effectivePower)),
          h('div.power-gate', 'against a gate of ', h('span.numeral', fmt(node.threshold))),
          h(`p.${clears ? 'good' : 'bad'}`, clears
            ? `${fmt(evaluation.effectivePower - node.threshold)} to spare — this clears. No dice, no surprises.`
            : `Short by ${fmt(node.threshold - evaluation.effectivePower)}. The attempt cannot start, so no Energy can be lost.`)),
        h('div.powerbar', h('i', { class: clears ? 'good-fill' : 'bad-fill',
          style: { width: `${Math.min(100, evaluation.effectivePower / Math.max(node.threshold, evaluation.effectivePower) * 100)}%` } })));
    } else comparison.appendChild(h('div.power-reading',
      h('div.eyebrow', 'Your Vanguard reads'), h('div.display-l.bad', '—'),
      h('p.bad', `Add ${5 - members.length} more character${members.length === 4 ? '' : 's'}. The attempt cannot start.`)));

    const faces = h('div.node-faces');
    party.members.forEach(id => faces.appendChild(id
      ? h('div.node-member', portrait(store, id, 'md'), h('span', content.characterById[id].displayName),
        h('span.caption', fmt(characterPower(content, state.characters[id]))))
      : h('div.node-member.empty', h('span.portrait.md', '+'), h('span', 'empty'))));
    const synergy = h('div.node-synergy', h('div.eyebrow', 'Synergy'));
    if (evaluation) {
      evaluation.active.forEach(item => synergy.appendChild(h('div', item.tag.displayName, ' ', h('span.good', `+${pct(item.bonusBp)}`))));
      evaluation.inactive.slice(0, 3).forEach(item => synergy.appendChild(h('div.caption', `${item.tag.displayName} — ${item.missing}`)));
      synergy.appendChild(h('div.caption', `+${pct(evaluation.cappedBp)} of a possible ${pct(content.balance.synergyCapBp)}`));
      if (node.objective && !ns.objectiveClaimed) {
        const met = objectiveSatisfied(content, node.objective, members);
        synergy.appendChild(h(`div.${met ? 'good' : 'warn'}`, met ? 'Optional objective is ready.' : node.objective.text));
      }
    }
    const partyRow = h('div.node-party-row', faces, synergy);
    const actions = actionRow(store, node, ns, members, check, cost);
    dynamic.append(comparison, partyRow, actions);
  }
  paint();
}

function actionRow(store, node, ns, members, check, cost) {
  const { content, state } = store;
  const wrap = h('div.node-actions');
  const run = async count => {
    const pre = checkClear(content, state, node.id, members, count);
    if (!pre.ok) { await store.tx(() => pre, { rerender: false }); render(); return; }
    const result = await store.tx(() => clearNode(content, state, node.id, members, count, store.rng, store.now()), { rerender: false });
    render();
    if (result.ok) showResults(store, result, { members, count });
  };
  wrap.append(h('div', h('button.btn.primary', { disabled: !check.ok, onclick: () => run(1) }, 'Enter →'),
    h('div.caption', `⚡ ${cost} of your ${state.energy}`)));
  const max = Math.max(1, maxSweepCount(content, state, node.id));
  const qty = h('input.sweep-inline', { type: 'number', min: 1, max, value: Math.min(6, max), 'aria-label': 'Sweep count' });
  wrap.appendChild(h('div.node-sweep', 'or run it ', qty, ' times at once · ',
    h('button.link', {
      disabled: !ns.cleared || !check.ok,
      title: ns.cleared ? 'Resolve several runs instantly' : 'Sweep unlocks after the first clear',
      onclick: () => run(Math.max(1, Math.min(max, Number(qty.value) || 1)))
    }, `sweep · ⚡ ${cost} each`)));
  if (!check.ok) wrap.appendChild(h('div.reasons-inline', check.reasons.join(' ')));
  return wrap;
}

function rewardSentence(store, node, ns) {
  let sentence = `Every run, ${nodeRepeatText(store, node).replace(' (+1 with ', ' — a bonus turns up with ').replace(' chance)', ' chance')}.`;
  if (node.firstClear) {
    const bits = (node.firstClear.materials ?? []).map(item => `${item.qty} ${store.content.materialById[item.materialId].displayName}`);
    if (node.firstClear.shards) bits.push(`${node.firstClear.shards.qty} ${store.content.characterById[node.firstClear.shards.characterId].displayName} shards`);
    if (node.firstClear.archiveFragment) bits.push('an Archive fragment');
    sentence += ` The first clear ${ns.firstClearClaimed ? 'paid' : 'also pays'} ${joinNatural(bits)}.`;
  }
  if (node.objective) sentence += ` ${ns.objectiveClaimed ? 'Objective complete:' : 'Optional:'} ${node.objective.text}.`;
  return sentence;
}

function joinNatural(items) {
  if (items.length < 2) return items[0] ?? 'its authored reward';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function nodeFlavor(node, meta) {
  return `${meta.label}. Threshold ${fmt(node.threshold)} marks the exact point where the gate opens.`;
}
