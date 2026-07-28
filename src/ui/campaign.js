import { h } from './dom.js';
import { nodeState, worldCampaignUnlocked } from '../core/state.js';
import { rankMaterialSources } from '../core/sources.js';
import { sourceRow } from './find-sources.js';
import { compactResult } from './results.js';

export function renderCampaign(store, root, arg) {
  const { content, state } = store;
  const tabs = [
    ['main', '🗺️ Main Campaign'],
    ['shadow', '🌑 Shadow Campaign'],
    ...content.worlds.map(world => [world.campaignId, `${world.icon} ${world.displayName}`])
  ];
  const allowed = new Set(tabs.map(([id]) => id));
  if (arg && allowed.has(arg) && state.ui.campaignId !== arg) {
    state.ui.campaignId = arg;
    store.save();
  }
  if (!allowed.has(state.ui.campaignId)) state.ui.campaignId = 'main';
  const current = state.ui.campaignId;
  const tabBar = h('div.tab-bar');
  for (const [id, label] of tabs) {
    tabBar.appendChild(h('button.tab-btn' + (id === current ? '.active' : ''), {
      onclick: async () => {
        state.ui.campaignId = id;
        await store.save();
        root.replaceChildren();
        renderCampaign(store, root, null);
      }
    }, label));
  }
  root.appendChild(tabBar);
  if (store.ui.lastSourceResult) root.appendChild(compactResult(store, store.ui.lastSourceResult));

  const nodes = content.nodesByCampaign[current] ?? [];
  if (current === 'shadow') root.appendChild(h('div.panel',
    h('p.small', 'Shadow nodes unlock with their matching Main node and have limited daily shard attempts.')));
  if (current.startsWith('wc_') && nodes.length) {
    const worldId = nodes[0].world;
    const world = content.worldById[worldId];
    const availability = worldCampaignUnlocked(content, state, worldId);
    root.appendChild(h('div.panel',
      content.images.world[worldId]
        ? h('div.world-banner', h('img', { src: content.images.world[worldId], alt: `${world.displayName} banner` })) : null,
      h('p.small', world.tagline),
      h('p.small' + (availability.unlocked ? '.good' : '.warn'),
        availability.unlocked
          ? `Unlocked — every node requires five ${world.displayName} characters.`
          : `Locked: own ${availability.needed} ${world.displayName} characters (${availability.owned}/${availability.needed}).`)));
  }

  const byChapter = {};
  for (const node of nodes) (byChapter[node.chapter] ??= []).push(node);
  for (const [chapter, chapterNodes] of Object.entries(byChapter)) {
    const panel = h('div.panel');
    const cleared = chapterNodes.filter(node => nodeState(state, node.id).cleared).length;
    panel.appendChild(h('h2', `Chapter ${chapter} `, h('span.small.muted', `— ${cleared}/${chapterNodes.length} cleared`)));
    for (const node of chapterNodes) {
      const projection = rankMaterialSources(content, state, node.material).find(row => row.node.id === node.id);
      if (!projection) continue;
      const wrap = h('div.campaign-source');
      const flags = [];
      if (projection.status.cleared) flags.push('Cleared');
      if (!projection.status.firstClearClaimed && projection.unlock.unlocked) flags.push('First clear available');
      if (node.objective) flags.push(projection.status.objectiveClaimed ? 'Objective complete' : 'Objective available');
      wrap.appendChild(h('div.campaign-flags.small.muted', flags.join(' · ')));
      wrap.appendChild(sourceRow(store, projection, {
        onUpdate: () => {
          root.replaceChildren();
          renderCampaign(store, root, null);
        }
      }));
      panel.appendChild(wrap);
    }
    root.appendChild(panel);
  }
}
