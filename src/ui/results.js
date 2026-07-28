import { h, fmt } from './dom.js';
import { openModal } from '../app.js';
import { rewardChips } from './shared.js';

export function resultIsMeaningful(result) {
  const rewards = result.rewards;
  return !!(rewards.firstClear || rewards.objective || rewards.fragments?.length
    || rewards.milestones?.length || result.newlyReadyCharacters?.length);
}

export function resultPresentationMode(store, result) {
  const preference = store.state.settings.farmingResults ?? 'automatic';
  if (result.rewards.firstClear || result.rewards.milestones?.length) return 'full';
  if (preference === 'full') return 'full';
  if (preference === 'compact') return 'compact';
  return resultIsMeaningful(result) ? 'full' : 'compact';
}

function resultBody(store, result, { expanded = false } = {}) {
  const wrap = h('div.result-summary');
  wrap.appendChild(h('div.result-heading',
    h('b', `${result.node.displayName} — ${result.rewards.runs > 1 ? `${result.rewards.runs} sweeps` : 'Cleared'}`),
    h('span.small.muted', `⚡ ${result.rewards.energySpent}`)));
  if (result.rewards.firstClear) wrap.appendChild(h('p.good', '✦ First-clear rewards claimed!'));
  if (result.rewards.objective) wrap.appendChild(h('p.good', '✦ Optional objective completed!'));
  if (result.rewards.fragments?.length) wrap.appendChild(h('p.good', '🏛️ Archive fragment recovered!'));
  for (const milestone of result.rewards.milestones ?? []) wrap.appendChild(h('p.good', `✦ ${milestone}`));
  wrap.appendChild(rewardChips(store, result.rewards));
  if (result.rewards.pity) wrap.appendChild(h('p.small', '🧩 ', result.rewards.pity));
  if (expanded) {
    for (const matId of Object.keys(result.rewards.materials)) {
      wrap.appendChild(h('div.small.muted',
        `${store.content.materialById[matId].displayName}: now ${fmt(store.state.inventory.materials[matId] ?? 0)}`));
    }
  }
  return wrap;
}

export function compactResult(store, result, { onExpand } = {}) {
  const panel = h('div.compact-result');
  panel.appendChild(resultBody(store, result));
  panel.appendChild(h('button.link.small', {
    onclick: () => {
      if (onExpand) onExpand();
      else showFullResults(store, result);
    }
  }, 'Expand'));
  return panel;
}

export function showFullResults(store, result, { onClose } = {}) {
  openModal((modal, close) => {
    const finish = () => { close(); onClose?.(); };
    modal.appendChild(resultBody(store, result, { expanded: true }));
    modal.appendChild(h('div.modal-actions',
      h('button.btn.primary', { onclick: finish }, 'Continue'),
      h('button.btn', { onclick: () => { close(); store.go('#/inventory'); } }, 'Go craft'),
      h('button.btn', { onclick: () => { close(); store.go('#/home'); } }, 'Home')));
  });
}

export function showResults(store, result, { onClose, compactRoot } = {}) {
  if (resultPresentationMode(store, result) === 'full') {
    showFullResults(store, result, { onClose });
    return 'full';
  }
  const summary = compactResult(store, result);
  if (compactRoot) compactRoot.replaceChildren(summary);
  else {
    store.ui.compactResult = { result, at: Date.now() };
    const screen = document.getElementById('screen');
    const existing = screen.querySelector('.floating-compact-result');
    const host = existing ?? h('div.floating-compact-result');
    host.replaceChildren(summary);
    if (!existing) screen.prepend(host);
  }
  onClose?.();
  return 'compact';
}
