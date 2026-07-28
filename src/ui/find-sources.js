import { h, fmt } from './dom.js';
import { openModal, toast } from '../app.js';
import { checkClear, clearNode, maxSweepCount } from '../core/state.js';
import { rankMaterialSources } from '../core/sources.js';
import { campaignLabel } from './shared.js';
import { compactResult, showFullResults, resultPresentationMode } from './results.js';

function blockedReason(row) {
  if (!row.unlock.unlocked) return row.unlock.reason;
  return row.check.reasons[0] ?? (row.status.cleared ? 'Quick sweep is currently unavailable.' : '');
}

export function sourceRow(store, row, { onUpdate, returnContext } = {}) {
  const { content, state } = store;
  const node = row.node;
  const material = content.materialById[node.material];
  const wrapper = h('div.source-row');
  const info = h('div.source-info',
    h('div', h('b', `${campaignLabel(store, node)} ${node.number} — ${node.displayName}`),
      row.recommended ? h('span.badge.recommended', 'Recommended') : null),
    h('div.small.muted',
      `${material.icon} ${row.guaranteed} × ${material.displayName} guaranteed · ⚡ ${row.energy} per run`,
      node.shardCharacter ? ` · ${row.attemptsLeft} attempts left` : ''),
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
  } else if (row.available) {
    actions.appendChild(h('button.btn.tiny.primary', {
      onclick: () => store.go(`#/node/${node.id}`, {
        returnContext: returnContext ?? { route: location.hash || '#/home' }
      })
    }, 'Open Node'));
    wrapper.appendChild(actions);
  } else if (row.status.cleared || row.unlock.unlocked) {
    actions.appendChild(h('button.btn.tiny', {
      onclick: () => store.go(`#/node/${node.id}`, {
        returnContext: returnContext ?? { route: location.hash || '#/home' }
      })
    }, 'Open'));
    wrapper.appendChild(actions);
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
      let title = 'Find Sources';
      let materials = targetMaterials(store, target);
      if (target.type === 'material') title = `Sources: ${store.content.materialById[target.id].displayName}`;
      if (target.type === 'component') {
        const component = store.content.componentById[target.id];
        title = `Sources: ${component.displayName}`;
        modal.appendChild(h('p.small.muted',
          `Crafted from ${component.inputs.map(i => `${i.qty} × ${store.content.materialById[i.materialId].displayName}`).join(' + ')}.`));
      }
      modal.prepend(h('h2', title));
      if (target.type === 'material') {
        const lower = store.content.materials.find(material => material.conversionTarget === target.id);
        if (lower) modal.insertBefore(h('p.small.muted',
          `Alternative: upcraft ${lower.conversionCost} × ${lower.displayName} into 1 × ${store.content.materialById[target.id].displayName}. Supported conversions are previewed by Craft Components & Equip.`),
        modal.children[1] ?? null);
      }
      if (store.ui.lastSourceResult) {
        modal.insertBefore(compactResult(store, store.ui.lastSourceResult), modal.children[1] ?? null);
      }
      if (target.type === 'shards') {
        const def = store.content.characterById[target.id];
        modal.querySelector('h2').textContent = `Shard sources: ${def.displayName}`;
        const nodes = store.content.shardNodesByCharacter[target.id] ?? [];
        const rows = nodes.flatMap(node => rankMaterialSources(store.content, store.state, node.material)
          .filter(r => r.node.id === node.id));
        rows.forEach(row => { row.recommended = false; });
        rows.sort((a, b) => a.bucket - b.bucket || b.efficiency - a.efficiency || a.node.number - b.node.number);
        const recommended = rows.find(row => row.sweepable || row.available);
        if (recommended) recommended.recommended = true;
        rows.forEach(row => modal.appendChild(sourceRow(store, row, {
          onUpdate: result => { options.onUpdate?.(result); renderRows(); },
          returnContext: options.returnContext
        })));
      } else {
        for (const materialId of materials) {
          if (materials.length > 1) modal.appendChild(h('h3', store.content.materialById[materialId].displayName));
          const rows = rankMaterialSources(store.content, store.state, materialId);
          if (!rows.length) modal.appendChild(h('p.muted', 'No published node drops this material.'));
          rows.forEach(row => modal.appendChild(sourceRow(store, row, {
            onUpdate: result => { options.onUpdate?.(result); renderRows(); },
            returnContext: options.returnContext
          })));
        }
      }
      modal.appendChild(h('div.modal-actions', h('button.btn', { onclick: close }, 'Close')));
    };
    renderRows();
  });
}
