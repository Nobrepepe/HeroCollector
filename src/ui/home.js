import { h, fmt } from './dom.js';
import {
  readyUpgrades, nodeState, nodeUnlocked,
  completeGearTier, promoteStar, unlockCharacter, movePin, removePin,
  cleanupCompletedPins
} from '../core/state.js';
import { analyzePinnedGoals } from '../core/progression.js';
import { portrait, campaignLabel } from './shared.js';
import { openFindSources } from './find-sources.js';
import { craftEquipmentWithConfirmation, openGearDialog } from './gear.js';

export function renderHome(store, root) {
  const { content, state } = store;
  const today = h('div.panel', h('h2', 'Today'));
  const resetHour = String(state.settings.resetHour).padStart(2, '0');
  today.appendChild(h('p.muted.small',
    `Daily reset at ${resetHour}:00 · +${content.balance.energy.dailyGrant} Energy · storage cap ${content.balance.energy.storageCap}.`));
  if (state.lastResetSummary) today.appendChild(h('p.small.good',
    `Last reset: +${state.lastResetSummary.energyGained} Energy; attempts refreshed.`));
  root.appendChild(today);

  const campaigns = h('div.panel', h('h2', 'Campaign'));
  for (const campaign of ['main', ...content.worlds.map(w => w.campaignId)]) {
    const nodes = content.nodesByCampaign[campaign] ?? [];
    if (!nodes.length) continue;
    const frontier = nodes.find(n => !nodeState(state, n.id).cleared);
    const cleared = nodes.filter(n => nodeState(state, n.id).cleared).length;
    const label = campaign === 'main' ? 'Main Campaign' : `${content.worldById[nodes[0].world].displayName} Campaign`;
    const row = h('div.kv', h('span', `${label} — ${cleared}/${nodes.length}`));
    if (!frontier) row.appendChild(h('b.good', 'Complete!'));
    else {
      const unlock = nodeUnlocked(content, state, frontier);
      row.appendChild(unlock.unlocked
        ? h('button.btn.tiny.primary', { onclick: () => store.go(`#/node/${frontier.id}`) },
          `Continue: ${frontier.displayName} (${fmt(frontier.threshold)})`)
        : h('span.small.muted', unlock.reason));
    }
    campaigns.appendChild(row);
  }
  root.appendChild(campaigns);
  root.appendChild(goalCenter(store));
  root.appendChild(readyPanel(store));

  const log = h('div.panel', h('h2', 'Recent progress'));
  if (!state.progressLog.length) log.appendChild(h('p.muted.small', 'Your progress will be summarized here.'));
  for (const entry of state.progressLog.slice(0, 8)) {
    log.appendChild(h('div.small', h('span.muted', `${new Date(entry.at).toLocaleDateString()} — `), entry.text));
  }
  root.appendChild(log);
}

function goalCenter(store) {
  const { content, state } = store;
  const analysis = analyzePinnedGoals(content, state);
  const panel = h('div.panel.goal-center', h('h2', '📌 Goal center'));
  if (!state.pins.length) {
    panel.appendChild(h('p.muted.small', 'Pin equipment or a character’s current shard objective to track it here.'));
    return panel;
  }
  const shortage = h('div.goal-shortages', h('h3', 'Combined shortages'));
  const comp = Object.entries(analysis.totalComponentMissing);
  const mats = Object.entries(analysis.totalMaterialMissing);
  shortage.appendChild(h('p.small', h('b', 'Components: '),
    comp.length ? comp.map(([id, n]) => `${n} ${content.componentById[id].displayName}`).join(' · ') : h('span.good', 'None')));
  shortage.appendChild(h('p.small', h('b', 'Farmable materials: '),
    mats.length ? mats.map(([id, n]) => `${n} ${content.materialById[id].displayName}`).join(' · ') : h('span.good', 'None')));
  for (const warning of analysis.warnings) shortage.appendChild(h('p.warn.small', `⚠ ${warning}`));
  panel.appendChild(shortage);

  const byCharacter = new Map();
  state.pins.forEach((pin, index) => {
    const list = byCharacter.get(pin.characterId) ?? [];
    list.push({ pin, index });
    byCharacter.set(pin.characterId, list);
  });
  for (const [characterId, entries] of byCharacter) {
    const def = content.characterById[characterId];
    if (!def) continue;
    const details = h('details.goal-character', { open: true });
    details.appendChild(h('summary',
      portrait(store, characterId, 'sm'),
      h('span', h('b', def.displayName), h('span.small.muted', ` · ${entries.length} goal${entries.length === 1 ? '' : 's'}`))));
    for (const entry of entries) details.appendChild(goalRow(store, entry.pin, entry.index));
    panel.appendChild(details);
  }
  if (analysis.stale.length) {
    panel.appendChild(h('button.btn.tiny', {
      onclick: () => store.tx(() => cleanupCompletedPins(content, state))
    }, 'Unpin completed/stale'));
  }
  return panel;
}

function goalRow(store, pin, index) {
  const { content, state } = store;
  const def = content.characterById[pin.characterId];
  const row = h('div.goal-row');
  const body = h('div.grow');
  if (pin.type === 'equipment') {
    const analysis = analyzePinnedGoals(content, state).goals.find(g =>
      g.pin.characterId === pin.characterId && g.pin.slot === pin.slot)?.analysis;
    body.appendChild(h('div', analysis?.equipmentName ?? content.characterMeta.slots[pin.slot].name));
    body.appendChild(h('div.small' + (analysis?.craftable ? '.good' : '.muted'),
      analysis?.state === 'components-ready' ? 'Components ready'
        : analysis?.state === 'chain-ready' ? 'Crafting chain ready'
          : 'Materials still missing'));
  } else {
    const cs = state.characters[pin.characterId];
    const need = pin.objective === 'unlock'
      ? content.balance.acquisitionTiers[def.tier].cumulativeShards
      : content.balance.starShards[pin.targetStars - 1];
    body.appendChild(h('div', pin.objective === 'unlock' ? 'Character unlock' : `${pin.targetStars}★ promotion`));
    body.appendChild(h('div.small.muted', `${cs.shards}/${need} shards`));
  }
  row.appendChild(body);
  const controls = h('div.goal-controls',
    h('button.btn.tiny', {
      disabled: index === 0, 'aria-label': `Move ${def.displayName} goal up`,
      onclick: () => store.tx(() => movePin(state, index, -1))
    }, '↑'),
    h('button.btn.tiny', {
      disabled: index === state.pins.length - 1, 'aria-label': `Move ${def.displayName} goal down`,
      onclick: () => store.tx(() => movePin(state, index, 1))
    }, '↓'));
  if (pin.type === 'equipment') {
    controls.append(
      h('button.btn.tiny', { onclick: () => openGearDialog(store, pin.characterId, pin.slot) }, 'View'),
      h('button.btn.tiny', {
        onclick: () => {
          const goal = analyzePinnedGoals(content, state).goals.find(g =>
            g.pin.characterId === pin.characterId && g.pin.slot === pin.slot)?.analysis;
          const first = Object.keys(goal?.totalMaterialMissing ?? {})[0]
            ?? Object.keys(goal?.totalMaterialDemand ?? {})[0];
          if (first) openFindSources(store, { type: 'material', id: first });
        }
      }, 'Find'));
  } else {
    controls.append(
      h('button.btn.tiny', { onclick: () => store.go(`#/character/${pin.characterId}`) }, 'View'),
      h('button.btn.tiny', { onclick: () => openFindSources(store, { type: 'shards', id: pin.characterId }) }, 'Find'));
  }
  controls.appendChild(h('button.btn.tiny', {
    onclick: () => store.tx(() => removePin(state, pin))
  }, 'Unpin'));
  row.appendChild(controls);
  return row;
}

function readyPanel(store) {
  const { content, state } = store;
  const ready = readyUpgrades(content, state);
  const panel = h('div.panel', h('h2', 'Ready now'));
  if (!ready.length) {
    panel.appendChild(h('p.muted.small', 'Nothing is waiting — farm materials or shards to open the next upgrade.'));
    return panel;
  }
  const grouped = new Map();
  for (const item of ready) {
    const list = grouped.get(item.characterId) ?? [];
    list.push(item);
    grouped.set(item.characterId, list);
  }
  for (const [characterId, items] of grouped) {
    const details = h('details.ready-character', { open: true },
      h('summary', `${content.characterById[characterId].displayName} · ${items.length} ready`));
    for (const item of items) {
      const action = {
        completeTier: () => completeGearTier(content, state, item.characterId),
        promoteStar: () => promoteStar(content, state, item.characterId),
        craftEquipment: () => craftEquipmentWithConfirmation(store, item.characterId, item.slot),
        unlock: () => unlockCharacter(content, state, item.characterId)
      }[item.type];
      details.appendChild(h('div.kv', h('span', item.text),
        h('div.goal-controls',
          h('button.btn.tiny.primary', {
            onclick: () => item.type === 'craftEquipment' ? action() : store.tx(action)
          }, 'Do it'),
          h('button.btn.tiny', {
            onclick: () => item.type === 'craftEquipment'
              ? openGearDialog(store, item.characterId, item.slot)
              : store.go(`#/character/${item.characterId}`)
          }, 'View'))));
    }
    panel.appendChild(details);
  }
  return panel;
}
