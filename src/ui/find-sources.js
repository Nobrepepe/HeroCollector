import { h, fmt } from './dom.js';
import { openModal, toast, render } from '../app.js';
import { checkClear, clearNode, maxSweepCount } from '../core/state.js';
import { rankMaterialSources, rankShardSources } from '../core/sources.js';
import { campaignLabel } from './shared.js';
import { modalActions, modalDismiss, modalHead } from './modal.js';
import { compactResult, showFullResults, resultPresentationMode } from './results.js';

function blockedReason(row) {
  if (!row.unlock.unlocked) return row.unlock.reason;
  return row.check.reasons[0] ?? (row.status.cleared ? 'Quick sweep is currently unavailable.' : '');
}

export function sourceRow(store, row, { onUpdate, onNavigate, returnContext } = {}) {
  const { content, state } = store;
  const node = row.node;
  const material = content.materialById[node.material];
  const wrapper = h('div.source-row');
  const openNode = () => {
    onNavigate?.();
    store.go(`#/node/${node.id}`, {
      returnContext: returnContext ?? { route: location.hash || '#/home' }
    });
  };
  const info = h('button.source-info', { onclick: openNode,
    'aria-label': `Open ${campaignLabel(store, node)} ${node.number}, ${node.displayName}` },
    h('div', h('b', `${campaignLabel(store, node)} ${node.number} — ${node.displayName}`),
      row.recommended ? h('span.badge.recommended', 'Recommended') : null),
    h('div.small.muted',
      `${material.icon} ${row.guaranteed} × ${material.displayName} guaranteed · ⚡ ${row.energy} per run`),
    h('div.small.muted',
      `Required Power ${fmt(node.threshold)} · selected party ${
        row.check.evalResult ? fmt(row.check.evalResult.effectivePower) : 'incomplete'
      }`),
    h('div.small' + ((row.sweepable || row.available) ? '.good' : '.warn'),
      row.sweepable ? `Cleared · max ${row.maxSweeps} sweeps · selected party can clear`
        : row.available ? 'Available · selected party can clear'
          : blockedReason(row)));
  wrapper.appendChild(info);
  const actions = h('div.source-actions');
  if (row.sweepable) {
    const max = Math.max(0, maxSweepCount(content, state, node.id));
    const input = h('input', {
      type: 'number', min: 1, max: Math.max(1, max), value: Math.min(5, Math.max(1, max)),
      'aria-label': `Sweep count for ${node.displayName}`
    });
    const summary = h('div.source-result');
    const run = async n => {
      const count = Math.max(1, Math.min(max, Number(n) || 1));
      const check = checkClear(content, state, node.id, row.members, count);
      if (!check.ok) { toast(check.reasons.join(' '), 'error'); return; }
      const result = await store.tx(
        () => clearNode(content, state, node.id, row.members, count, store.rng, store.now()),
        { rerender: false }
      );
      if (!result.ok) return;
      if (resultPresentationMode(store, result) === 'full') {
        store.ui.lastSourceResult = null;
        showFullResults(store, result);
      } else {
        store.ui.lastSourceResult = result;
        summary.replaceChildren(compactResult(store, result));
      }
      onUpdate?.(result);
    };
    actions.append(input,
      h('button.btn.tiny.primary', { onclick: () => run(input.value) }, 'Sweep'),
      h('button.btn.tiny', { onclick: () => run(max) }, `Max ${max}`));
    wrapper.append(actions, summary);
  }
  return wrapper;
}

function targetMaterials(store, target) {
  if (target.type === 'material') return [target.id];
  if (target.type === 'component') {
    return store.content.componentById[target.id]?.inputs.map(i => i.materialId) ?? [];
  }
  return [];
}

export function openFindSources(store, target, options = {}) {
  return openModal((modal, close) => {
    const renderRows = () => {
      modal.replaceChildren();
      const materials = targetMaterials(store, target);
      // Eyebrow names what is being looked for; the headline names where it
      // comes from, in the same grammar as the day-open summary.
      const subject = target.type === 'material' ? store.content.materialById[target.id]?.displayName
        : target.type === 'component' ? store.content.componentById[target.id]?.displayName
          : store.content.characterById[target.id]?.displayName;
      modal.appendChild(modalHead(
        target.type === 'shards' ? 'Shard sources' : 'Sources',
        `Where ${subject} comes from.`,
        { size: 'm' }));
      if (target.type === 'component') {
        const component = store.content.componentById[target.id];
        modal.appendChild(h('p.caption',
          `Crafted from ${component.inputs.map(i => `${i.qty} × ${store.content.materialById[i.materialId].displayName}`).join(' + ')}.`));
      }
      if (target.type === 'material') {
        const lower = store.content.materials.find(material => material.conversionTarget === target.id);
        if (lower) modal.appendChild(h('p.caption',
          `Alternative: upcraft ${lower.conversionCost} × ${lower.displayName} into 1 × ${store.content.materialById[target.id].displayName}. Supported conversions are previewed by Craft Components & Equip.`));
      }
      if (store.ui.lastSourceResult) modal.appendChild(compactResult(store, store.ui.lastSourceResult));
      if (target.type === 'shards') {
        const reading = rankShardSources(store.content, store.state, target.id);
        // Shards are deterministic now: Focus converts Energy, encounters
        // stake a first-clear grant, and targeted pushes fill the gaps.
        modal.appendChild(h('p.caption', reading.focusSlot
          ? `${subject} holds your ${reading.focusSlot.name} Focus — every ⚡ spent on campaign nodes brings the next shard ${reading.focusSlot.energyToNext} closer.`
          : reading.revealed
            ? `${subject} is revealed: assign them to a Development Focus slot and every campaign run pays toward them. Tutoring (Field Supply), Mastery milestones, and Expedition leads can all be pointed at them too.`
            : `${subject} has not been encountered yet. First-clear their encounter node below to reveal them.`));
        const unclaimed = reading.encounters.filter(entry => !entry.claimed);
        if (!reading.encounters.length) {
          modal.appendChild(h('p.muted', 'No live encounter names this character.'));
        }
        for (const entry of unclaimed) {
          const rows = rankMaterialSources(store.content, store.state, entry.node.material)
            .filter(r => r.node.id === entry.node.id);
          rows.forEach(row => modal.appendChild(sourceRow(store, row, {
            onUpdate: result => { options.onUpdate?.(result); render(); renderRows(); },
            onNavigate: close,
            returnContext: options.returnContext
          })));
        }
        if (reading.encounters.length && !unclaimed.length) {
          modal.appendChild(h('p.caption.good', 'Every encounter stake for this hero has been claimed — Focus, Tutoring, milestones, and route leads carry the rest.'));
        }
      } else {
        for (const materialId of materials) {
          if (materials.length > 1) modal.appendChild(h('h3', store.content.materialById[materialId].displayName));
          const rows = rankMaterialSources(store.content, store.state, materialId);
          if (!rows.length) modal.appendChild(h('p.muted', 'No published node drops this material.'));
          rows.forEach(row => modal.appendChild(sourceRow(store, row, {
            onUpdate: result => { options.onUpdate?.(result); render(); renderRows(); },
            onNavigate: close,
            returnContext: options.returnContext
          })));
        }
      }
      modal.appendChild(modalActions(modalDismiss('Close', close)));
    };
    renderRows();
  }, { size: 'wide' });
}
