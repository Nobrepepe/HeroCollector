import { h, fmt, pct } from './dom.js';
import {
  nodeState, nodeUnlocked, nodeEnergyCost, shardAttemptsLeft, checkClear,
  clearNode, maxSweepCount, preferredPartyIndex, selectPartyPreset
} from '../core/state.js';
import { evaluateParty, objectiveSatisfied } from '../core/synergy.js';
import { nodeTypeMeta, campaignLabel } from './shared.js';
import { portrait, portraitSlot } from './shared.js';
import { characterPower } from '../core/power.js';
import { showResults } from './results.js';
import { openModal, render } from '../app.js';
import { sceneImage } from './presentation.js';
import { frontierMomentumPreview } from '../core/energy.js';

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
  const layout = h('div.node-layout');
  const main = h('main.node-main');
  const rail = h('aside.node-rail', { 'aria-label': 'Node readiness and actions' });
  main.appendChild(h('button.link.node-back', {
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
  head.appendChild(nodeNavigation(store, node));
  main.appendChild(head);

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
  const partyDynamic = h('div.node-party-dynamic');
  partyPanel.appendChild(partyDynamic);
  main.append(partyPanel, nodeRewards(store, node, ns));
  layout.append(main, rail);
  page.appendChild(layout);

  root.appendChild(page);

  function paint() {
    partyDynamic.replaceChildren();
    rail.replaceChildren();
    const party = state.parties[selectedIndex];
    const members = party.members.filter(Boolean);
    const check = checkClear(content, state, node.id, members, 1);
    const evaluation = members.length === 5 ? evaluateParty(content, state, members) : null;
    const comparison = h('section.node-comparison');
    if (evaluation) {
      const clears = evaluation.effectivePower >= node.threshold;
      const difference = evaluation.effectivePower - node.threshold;
      comparison.append(
        h('div.power-reading',
          h('div.eyebrow', 'Party power'),
          h(`div.node-power.${clears ? 'good' : 'bad'}`, fmt(evaluation.effectivePower)),
          h('div.power-gate', 'Required gate ', h('span.numeral', fmt(node.threshold))),
          h(`p.node-power-difference.${clears ? 'good' : 'bad'}`,
            `${fmt(Math.abs(difference))} ${clears ? 'above' : 'below'} gate`)),
        h('div.powerbar', h('i', { class: clears ? 'good-fill' : 'bad-fill',
          style: { width: `${Math.min(100, evaluation.effectivePower / Math.max(node.threshold, evaluation.effectivePower) * 100)}%` } })));
    } else comparison.appendChild(h('div.power-reading',
      h('div.eyebrow', 'Your Vanguard reads'), h('div.display-l.bad', '—'),
      h('p.bad', `Add ${5 - members.length} more character${members.length === 4 ? '' : 's'}. The attempt cannot start.`)));

    const faces = h('div.node-faces', { 'aria-label': 'Selected party' });
    party.members.forEach(id => faces.appendChild(id
      ? h('div.node-member', portrait(store, id, 'md'),
        h('span.node-member-name', content.characterById[id].displayName),
        h('span.caption', `${fmt(characterPower(content, state.characters[id]))} power`))
      : h('div.node-member.empty',
        portraitSlot({ size: 'md', state: 'empty', glyph: '+' }),
        h('span', 'empty'))));
    const synergy = h('section.node-synergy', h('div.node-rail-heading', 'Active synergies'));
    if (evaluation) {
      evaluation.active.slice(0, 4).forEach(item => synergy.appendChild(h('div.node-synergy-row',
        h('span', { title: item.tag.displayName }, item.tag.displayName), h('span.good', `+${pct(item.bonusBp)}`))));
      if (!evaluation.active.length) synergy.appendChild(h('div.caption', 'No active synergies.'));
      if (node.objective && !ns.objectiveClaimed) {
        const met = objectiveSatisfied(content, node.objective, members);
        synergy.appendChild(h(`div.caption.${met ? 'good' : 'warn'}`, met ? 'Optional objective ready.' : node.objective.text));
      }
      synergy.appendChild(h('button.link.node-synergy-more', { onclick: () => showNodeSynergies(evaluation) },
        evaluation.active.length > 4 ? `See all ${evaluation.active.length} →` : 'See all →'));
    }
    const actions = actionRow(store, node, ns, members, check, cost);
    partyDynamic.appendChild(faces);
    rail.append(comparison, synergy, actions);
  }
  paint();

  function showNodeSynergies(evaluation) {
    openModal((modal, close) => {
      modal.append(h('div.eyebrow', 'Selected party'), h('h2', 'Synergies'));
      const active = h('section.node-synergy-dialog', h('h3', 'Active'));
      if (!evaluation.active.length) active.appendChild(h('p.muted', 'No synergies are active.'));
      evaluation.active.forEach(item => active.appendChild(h('div.node-synergy-dialog-row',
        h('div', h('b', item.tag.displayName), h('div.caption', item.tag.explanation)),
        h('span.good.numeral', `+${pct(item.bonusBp)}`))));
      const possible = h('section.node-synergy-dialog', h('h3', 'Possible'));
      if (!evaluation.inactive.length) possible.appendChild(h('p.muted', 'Every available synergy is active.'));
      evaluation.inactive.forEach(item => possible.appendChild(h('div.node-synergy-dialog-row',
        h('div', h('b', item.tag.displayName), h('div.caption', item.tag.explanation)),
        h('span.caption', item.missing))));
      modal.append(active, possible, h('div.modal-actions', h('button.btn', { onclick: close }, 'Close')));
    });
  }
}

function nodeNavigation(store, node) {
  const nodes = store.content.nodesByCampaign[node.campaign] ?? [];
  const index = nodes.findIndex(candidate => candidate.id === node.id);
  const previous = index > 0 ? nodes[index - 1] : null;
  const next = index >= 0 && index < nodes.length - 1 ? nodes[index + 1] : null;
  return h('nav.node-navigation', { 'aria-label': 'Nodes in this campaign' },
    h('button.node-nav.previous', { disabled: !previous, onclick: () => previous && store.go(`#/node/${previous.id}`) },
      `← ${previous ? `Previous · ${previous.displayName}` : 'Beginning'}`),
    h('button.node-nav.next', { disabled: !next, onclick: () => next && store.go(`#/node/${next.id}`) },
      `${next ? `Next · ${next.displayName}` : 'End of campaign'} →`));
}

function nodeRewards(store, node, ns) {
  const { content, state } = store;
  const material = content.materialById[node.material];
  const repeat = content.balance.nodeDefaults[node.type].repeat;
  const rewards = h('section.node-rewards', h('div.eyebrow', 'Possible rewards'));
  const materialRewards = new Map([[material.id, {
    material, qty: repeat.count,
    title: `${repeat.count} × ${material.displayName} guaranteed every run${repeat.bonusChanceBp ? `; +1 at ${repeat.bonusChanceBp / 100}%` : ''}`
  }]]);
  for (const item of node.firstClear?.materials ?? []) {
    const firstMaterial = content.materialById[item.materialId];
    const existing = materialRewards.get(item.materialId);
    materialRewards.set(item.materialId, {
      material: firstMaterial,
      qty: existing?.qty ?? item.qty,
      title: `${existing ? existing.title + '; ' : ''}${item.qty} × ${firstMaterial.displayName} on first clear`
    });
  }
  const visual = h('div.node-reward-visuals');
  for (const entry of materialRewards.values()) visual.appendChild(h('div.node-material-reward', {
    title: entry.title, 'aria-label': entry.title
  }, h('span.node-material-icon', entry.material.icon), h('div.node-reward-copy',
    h('span.node-reward-name', entry.material.displayName),
    h('span.caption', `${entry.qty}${repeat.bonusChanceBp && entry.material.id === material.id ? `–${entry.qty + 1}` : ''} per run${node.firstClear?.materials?.some(item => item.materialId === entry.material.id) && !ns.firstClearClaimed ? ' · first-clear bonus' : ''}`))));
  if (node.shardCharacter) {
    const def = content.characterById[node.shardCharacter];
    const cs = state.characters[node.shardCharacter];
    const shardTitle = cs.stars >= 7
      ? `${def.displayName} is at 7★; shard rolls become guaranteed material`
      : `${def.displayName} shards; ${shardAttemptsLeft(content, state, node)} attempts today; ${cs.pity ? 'next shard guaranteed' : `${content.balance.shardChanceBp / 100}% chance, miss then guarantee`}`;
    visual.appendChild(h('div.node-shard-reward', { title: shardTitle, 'aria-label': shardTitle },
      portrait(store, def.id, 'compact', { decorative: true }), h('div.node-reward-copy',
        h('span.node-reward-name', def.displayName), h('span.caption', `🧩 shard chance · ${shardAttemptsLeft(content, state, node)} attempts`))));
  }
  rewards.appendChild(visual);
  return rewards;
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
  const momentum = frontierMomentumPreview(state, { firstClear: !ns.cleared, energySpent: check.cost });
  const costLine = check.freeRuns
    ? `This run is free; ${check.freeRuns} Crisis boon run will be used.` : `⚡ ${check.cost} of your ${state.energy}`;
  const attempts = node.shardCharacter ? shardAttemptsLeft(content, state, node) : null;
  const maxAvailable = maxSweepCount(content, state, node.id);
  const max = Math.max(1, maxAvailable);
  wrap.appendChild(h('div.node-run-facts',
    h('div', h('span', 'Run once'), h('span.numeral', check.freeRuns ? 'Free' : `⚡ ${cost}`)),
    h('div', h('span', 'Maximum sweep'), h('span.numeral', maxAvailable ? `${maxAvailable} × ⚡ ${cost}` : 'Unavailable')),
    attempts === null ? null : h('div', h('span', 'Attempts remaining'), h('span.numeral', `${attempts} / ${content.balance.shardAttemptsPerDay}`))));
  wrap.append(h('div.node-run-primary', h('button.btn.primary', { disabled: !check.ok, onclick: () => run(1) }, 'Run Node →'),
    h('div.caption', costLine), !ns.cleared ? h('div.caption.good', momentum.energyRefunded === check.cost && check.cost > 0
      ? `First clear — its ${check.cost} Energy returns.`
      : momentum.energyRefunded > 0 ? `First clear — ${momentum.energyRefunded} of its ${check.cost} Energy returns today.`
        : check.cost === 0 ? 'First clear — no Energy is spent, so Momentum returns none.'
          : 'First clear — today’s Momentum allowance is already spent.') : null));
  const qty = h('input.sweep-inline', { type: 'number', min: 1, max, value: Math.min(6, max), 'aria-label': 'Sweep count' });
  wrap.appendChild(h('div.node-sweep', qty,
    h('button.btn', {
      disabled: !ns.cleared || !check.ok,
      title: ns.cleared ? 'Resolve several runs instantly' : 'Sweep unlocks after the first clear',
      onclick: () => run(Math.max(1, Math.min(max, Number(qty.value) || 1)))
    }, 'Sweep')));
  const visibleReasons = check.reasons.filter(reason => !/energy/i.test(reason));
  if (visibleReasons.length) wrap.appendChild(h('div.reasons-inline', visibleReasons.join(' ')));
  return wrap;
}

function nodeFlavor(node, meta) {
  return `${meta.label}. Threshold ${fmt(node.threshold)} marks the exact point where the gate opens.`;
}
