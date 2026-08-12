import { h, fmt } from './dom.js';
import { openModal, toast, render } from '../app.js';
import { checkClear, clearNode, maxSweepCount } from '../core/state.js';
import { rankMaterialSources } from '../core/sources.js';
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
      `${material.icon} ${row.guaranteed} × ${material.displayName} guaranteed · ⚡ ${row.energy} per run`,
      node.shardCharacter ? ` · ${content.characterById[node.shardCharacter].displayName} shards · ${row.attemptsLeft} attempts left` : ''),
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
        const nodes = store.content.shardNodesByCharacter[target.id] ?? [];
        const rows = nodes.flatMap(node => rankMaterialSources(store.content, store.state, node.material)
          .filter(r => r.node.id === node.id));
        rows.forEach(row => { row.recommended = false; });
        rows.sort((a, b) => a.bucket - b.bucket || b.efficiency - a.efficiency || a.node.number - b.node.number);
        const recommended = rows.find(row => row.sweepable || row.available);
        if (recommended) recommended.recommended = true;
        rows.forEach(row => modal.appendChild(sourceRow(store, row, {
          onUpdate: result => { options.onUpdate?.(result); render(); renderRows(); },
          onNavigate: close,
          returnContext: options.returnContext
        })));
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
