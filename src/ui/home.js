// Home (GDD 11.2): Energy, reset status, pinned goals, recent progress,
// Continue Campaign, and shortcuts to ready upgrades.
import { h, fmt } from './dom.js';
import {
  readyUpgrades, nodeState, nodeUnlocked, matQty, compQty,
  craftEquipment, completeGearTier, promoteStar, unlockCharacter, checkPromoteStar
} from '../core/state.js';
import { activeTier } from '../core/power.js';
import { equipmentRecipe, equipmentName } from '../core/content.js';
import { portrait, openFindSources, campaignLabel } from './shared.js';

export function renderHome(store, root) {
  const { content, state } = store;

  // --- reset / energy summary
  const resetPanel = h('div.panel');
  resetPanel.appendChild(h('h2', 'Today'));
  const resetHour = String(state.settings.resetHour).padStart(2, '0');
  resetPanel.appendChild(h('p.muted.small', `Daily reset at ${resetHour}:00 local time adds +${content.balance.energy.dailyGrant} Energy (stored up to ${content.balance.energy.storageCap}) and refreshes shard attempts. Missing a day is fine — Energy banks for one.`));
  if (state.lastResetSummary) {
    const s = state.lastResetSummary;
    resetPanel.appendChild(h('p.small.good', `Last reset applied ${s.days} day${s.days > 1 ? 's' : ''}: +${s.energyGained} Energy, attempts refreshed.`));
  }
  root.appendChild(resetPanel);

  // --- continue campaign
  const frontierPanel = h('div.panel');
  frontierPanel.appendChild(h('h2', 'Campaign'));
  for (const campaign of ['main', ...content.worlds.map(w => w.campaignId)]) {
    const nodes = content.nodesByCampaign[campaign] ?? [];
    if (nodes.length === 0) continue;
    const frontier = nodes.find(n => !nodeState(state, n.id).cleared);
    const clearedCount = nodes.filter(n => nodeState(state, n.id).cleared).length;
    const label = campaign === 'main' ? 'Main Campaign' : `${content.worldById[nodes[0].world].displayName} Campaign`;
    const row = h('div.kv');
    row.appendChild(h('span', `${label} — ${clearedCount}/${nodes.length} nodes cleared`));
    if (!frontier) {
      row.appendChild(h('b.good', 'Complete!'));
    } else {
      const unlock = nodeUnlocked(content, state, frontier);
      row.appendChild(unlock.unlocked
        ? h('button.btn.tiny.primary', { onclick: () => store.go(`#/node/${frontier.id}`) }, `Continue: ${frontier.displayName} (${fmt(frontier.threshold)})`)
        : h('span.small.muted', unlock.reason));
    }
    frontierPanel.appendChild(row);
  }
  root.appendChild(frontierPanel);

  // --- pinned goals
  const pinPanel = h('div.panel');
  pinPanel.appendChild(h('h2', '📌 Pinned goals'));
  if (state.pins.length === 0) {
    pinPanel.appendChild(h('p.muted.small', 'Pin equipment recipes or character shard targets from their screens to track them here.'));
  }
  for (const pin of state.pins) {
    pinPanel.appendChild(renderPin(store, pin));
  }
  root.appendChild(pinPanel);

  // --- ready upgrades
  const ready = readyUpgrades(content, state);
  store._readyCache = ready;
  const upPanel = h('div.panel');
  upPanel.appendChild(h('h2', 'Ready now'));
  if (ready.length === 0) upPanel.appendChild(h('p.muted.small', 'Nothing is waiting — farm materials or shards to open the next upgrade.'));
  for (const u of ready.slice(0, 10)) {
    const row = h('div.kv');
    row.appendChild(h('span', u.text));
    const act = {
      completeTier: () => store.tx(() => completeGearTier(content, state, u.characterId)),
      promoteStar: () => store.tx(() => promoteStar(content, state, u.characterId)),
      craftEquipment: () => store.tx(() => craftEquipment(content, state, u.characterId, u.slot)),
      unlock: () => store.tx(() => unlockCharacter(content, state, u.characterId))
    }[u.type];
    row.appendChild(h('div', { style: { display: 'flex', gap: '6px' } },
      h('button.btn.tiny.primary', { onclick: act }, 'Do it'),
      h('button.btn.tiny', { onclick: () => store.go(`#/character/${u.characterId}`) }, 'View')
    ));
    upPanel.appendChild(row);
  }
  root.appendChild(upPanel);

  // --- recent progress
  const logPanel = h('div.panel');
  logPanel.appendChild(h('h2', 'Recent progress'));
  if (state.progressLog.length === 0) logPanel.appendChild(h('p.muted.small', 'Your progress will be summarized here.'));
  for (const entry of state.progressLog.slice(0, 8)) {
    logPanel.appendChild(h('div.small', h('span.muted', new Date(entry.at).toLocaleDateString(), ' — '), entry.text));
  }
  root.appendChild(logPanel);
}

function renderPin(store, pin) {
  const { content, state } = store;
  const def = content.characterById[pin.characterId];
  if (!def) return h('div');
  const cs = state.characters[pin.characterId];
  const row = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' } });
  row.appendChild(portrait(store, pin.characterId, 'sm'));
  const body = h('div.grow');

  if (pin.type === 'equipment') {
    const tier = activeTier(content.balance, cs, content.maxGearTier);
    if (!tier || cs.slots[pin.slot]) {
      body.appendChild(h('div', `${def.displayName} — ${content.characterMeta.slots[pin.slot].name}: `, h('span.good', tier ? 'crafted — complete the tier!' : 'gear complete')));
    } else {
      const recipe = equipmentRecipe(content, pin.characterId, pin.slot, tier);
      body.appendChild(h('div', `${def.displayName} — ${equipmentName(content, pin.characterId, pin.slot, tier)} (Tier ${tier})`));
      for (const input of recipe.inputs) {
        const have = compQty(state, input.componentId);
        const k = content.componentById[input.componentId];
        const line = h('div.small' + (have >= input.qty ? '.good' : '.muted'),
          `${k.displayName}: ${have}/${input.qty} `,
          have < input.qty ? h('button.link.small', { onclick: () => openFindSources(store, { type: 'component', id: input.componentId }) }, 'Find Sources') : null);
        body.appendChild(line);
      }
    }
  } else {
    const goal = cs.owned
      ? (cs.stars >= 7 ? null : { label: `${cs.stars + 1}★ promotion`, need: content.balance.starShards[cs.stars] })
      : { label: 'unlock', need: content.balance.acquisitionTiers[def.tier].cumulativeShards };
    if (!goal) {
      body.appendChild(h('div', `${def.displayName}: `, h('span.good', 'at maximum Stars')));
    } else {
      body.appendChild(h('div', `${def.displayName} — shards for ${goal.label}: ${cs.shards}/${goal.need} `,
        h('button.link.small', { onclick: () => openFindSources(store, { type: 'shards', id: pin.characterId }) }, 'Find Sources')));
      const bar = h('div.progressbar' + (cs.shards >= goal.need ? '.full' : ''));
      bar.appendChild(h('div', { style: { width: `${Math.min(100, cs.shards / goal.need * 100)}%` } }));
      body.appendChild(bar);
    }
  }
  row.appendChild(body);
  row.appendChild(h('button.btn.tiny', { onclick: () => store.go(`#/character/${pin.characterId}`) }, 'View'));
  return row;
}
