// Campaign Map (GDD 11.2): world/chapter selector, sequential nodes, reward
// icons, thresholds, objective and first-clear state, sweep availability.
import { h, fmt } from './dom.js';
import { nodeState, nodeUnlocked, worldCampaignUnlocked } from '../core/state.js';
import { evaluateParty } from '../core/synergy.js';
import { nodeTypeMeta } from './shared.js';

let currentTab = 'main';

export function renderCampaign(store, root, arg) {
  const { content, state } = store;
  if (arg) currentTab = arg;

  const tabs = h('div.tab-bar');
  const tabDefs = [
    ['main', '🗺️ Main Campaign'],
    ['shadow', '🌑 Shadow Campaign'],
    ...content.worlds.map(w => [w.campaignId, `${w.icon} ${w.displayName}`])
  ];
  if (!tabDefs.some(([id]) => id === currentTab)) currentTab = 'main';
  for (const [id, label] of tabDefs) {
    tabs.appendChild(h('button.tab-btn' + (currentTab === id ? '.active' : ''), {
      onclick: () => { currentTab = id; root.replaceChildren(); renderCampaign(store, root, null); }
    }, label));
  }
  root.appendChild(tabs);

  const nodes = content.nodesByCampaign[currentTab] ?? [];
  if (currentTab === 'shadow') {
    root.appendChild(h('div.panel',
      h('p.small', 'Shadow nodes unlock when their matching Main Campaign node is cleared. Each shard source allows five total clears or sweeps per daily reset.')));
  }
  if (currentTab.startsWith('wc_') && nodes.length > 0) {
    const worldId = nodes[0].world;
    const wc = worldCampaignUnlocked(content, state, worldId);
    const w = content.worldById[worldId];
    const banner = content.images.world[worldId];
    root.appendChild(h('div.panel',
      banner ? h('div.world-banner', h('img', { src: banner, alt: `${w.displayName} banner` })) : null,
      h('p.small', w.tagline),
      wc.unlocked
        ? h('p.small.good', `Unlocked — every node requires five ${w.displayName} characters. First clears award Archive fragments.`)
        : h('p.small.warn', `Locked: own ${wc.needed} ${w.displayName} characters to unlock (currently ${wc.owned}). World campaigns are optional and never gate ordinary progression.`)));
  }

  // Party effective power for the at-a-glance threshold comparison.
  const party = state.parties[state.activePartyIndex].members.filter(Boolean);
  const ev = party.length === 5 ? evaluateParty(content, state, party) : null;

  const byChapter = {};
  for (const n of nodes) (byChapter[n.chapter] ??= []).push(n);

  for (const [chapter, chNodes] of Object.entries(byChapter)) {
    const cleared = chNodes.filter(n => nodeState(state, n.id).cleared).length;
    const panel = h('div.panel');
    panel.appendChild(h('h2', `Chapter ${chapter} `, h('span.small.muted', `— ${cleared}/${chNodes.length} cleared`)));
    for (const node of chNodes) {
      panel.appendChild(nodeRow(store, node, ev));
    }
    root.appendChild(panel);
  }
}

function nodeRow(store, node, ev) {
  const { content, state } = store;
  const ns = nodeState(state, node.id);
  const unlock = nodeUnlocked(content, state, node);
  const meta = nodeTypeMeta(node.type);

  const row = h('button.node-row' + (unlock.unlocked ? '' : '.locked'), {
    onclick: () => { if (unlock.unlocked) store.go(`#/node/${node.id}`); },
    title: unlock.unlocked ? meta.label : unlock.reason,
    'aria-disabled': !unlock.unlocked
  });
  row.appendChild(h('span.num', String(node.number)));
  row.appendChild(h('span', { title: meta.label }, meta.icon));
  const nameWrap = h('span.nname', node.displayName);
  if (node.checkpoint) nameWrap.appendChild(h('span.small.muted', ' · checkpoint'));
  if (node.shardCharacter) {
    nameWrap.appendChild(h('span.small.muted', ` · ${content.characterById[node.shardCharacter].displayName} shards`));
  }
  if (node.objective && !ns.objectiveClaimed) nameWrap.appendChild(h('span.small.warn', ' · objective'));
  row.appendChild(nameWrap);

  const flags = [];
  if (ns.cleared) flags.push(h('span.good', { title: 'Cleared — sweep available' }, '✓'));
  if (!ns.firstClearClaimed && unlock.unlocked) flags.push(h('span.warn', { title: 'First-clear rewards waiting' }, '✦'));
  row.appendChild(h('span', flags));

  if (unlock.unlocked) {
    const ok = ev && ev.effectivePower >= node.threshold;
    row.appendChild(h('span.thr' + (ev ? (ok ? '.ok' : '.no') : ''), {
      title: ev ? `Active party: ${fmt(ev.effectivePower)} effective Power` : 'Set a full active party to compare'
    }, fmt(node.threshold)));
  } else {
    row.appendChild(h('span.small.muted', '🔒'));
  }
  return row;
}
