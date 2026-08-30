import { append, h, fmt } from './dom.js';
import { openModal } from '../app.js';
import { clearNode, checkClear, preferredPartyIndex } from '../core/state.js';

export function resultIsMeaningful(result) {
  const rewards = result.rewards;
  return !!(rewards.firstClear || rewards.objective || rewards.relicPieces?.length
    || rewards.revealed?.length || rewards.masteryEvents?.length
    || rewards.milestones?.length || rewards.energyRefunded || result.newlyReadyCharacters?.length);
}

export function resultPresentationMode(store, result) {
  const preference = store.state.settings.farmingResults ?? 'automatic';
  if (result.rewards.firstClear || result.rewards.milestones?.length
    || result.rewards.revealed?.length || result.rewards.relicPieces?.length
    || result.rewards.masteryEvents?.length) return 'full';
  if (preference === 'full') return 'full';
  if (preference === 'compact') return 'compact';
  return resultIsMeaningful(result) ? 'full' : 'compact';
}

function compactBody(store, result) {
  const focusTotal = (result.rewards.focusShards ?? []).reduce((sum, grant) => sum + grant.shards, 0);
  const primary = Object.entries(result.rewards.shards ?? {})[0];
  const materialCount = Object.values(result.rewards.materials ?? {}).reduce((sum, qty) => sum + qty, 0);
  return h('div.compact-result-line',
    h('span', `${result.node.displayName} · ${result.rewards.runs} run${result.rewards.runs === 1 ? '' : 's'}`),
    h('span.numeral', `+${materialCount} materials${focusTotal ? ` · +${focusTotal} Focus shard${focusTotal === 1 ? '' : 's'}` : ''}${primary ? ` · +${primary[1]} ${store.content.characterById[primary[0]].displayName}` : ''}`),
    h('span.caption', result.rewards.energyRefunded
      ? `⚡${result.rewards.energySpent} spent · ${result.rewards.energyRefunded} returned`
      : `⚡${result.rewards.energySpent} spent`));
}

export function compactResult(store, result, { onExpand } = {}) {
  const panel = h('div.compact-result', compactBody(store, result));
  panel.appendChild(h('button.link.small', { onclick: () => onExpand ? onExpand() : showFullResults(store, result) }, 'Open results'));
  return panel;
}

export function showFullResults(store, result, { onClose, members, count } = {}) {
  openModal((modal, close) => {
    modal.classList.add('results-modal');
    const rewards = result.rewards;
    const finish = () => { close(); onClose?.(); };
    modal.appendChild(h('div.results-burst', h('i')));
    modal.appendChild(h('div.results-content',
      h('div.eyebrow', `${result.node.displayName} · ${rewards.runs} run${rewards.runs === 1 ? '' : 's'} · ⚡${rewards.energySpent} spent`),
      h('h2.display-l', rewards.firstClear ? 'The ground is yours.' : rewards.runs > 1 ? `${numberWord(rewards.runs)} more runs.` : 'Another step forward.')));

    const columns = h('div.reward-columns');
    const materials = Object.entries(rewards.materials ?? {});
    if (materials.length) columns.appendChild(materialColumn(store, materials));
    const shardTotals = { ...(rewards.shards ?? {}) };
    for (const grant of rewards.focusShards ?? []) {
      shardTotals[grant.characterId] = (shardTotals[grant.characterId] ?? 0) + grant.shards;
    }
    for (const [characterId, qty] of Object.entries(shardTotals)) {
      columns.appendChild(shardColumn(store, characterId, qty));
    }
    for (const pieceId of rewards.relicPieces ?? []) columns.appendChild(relicPieceColumn(store, pieceId));
    if (!columns.firstChild) columns.appendChild(h('div.reward-column', h('div.numeral', '—'), h('div', 'No drops this time')));
    modal.querySelector('.results-content').appendChild(columns);

    const unlocks = [
      ...(rewards.revealed ?? []).map(id => `${store.content.characterById[id].displayName} was encountered — a new Development Focus target`),
      ...(result.newlyReadyCharacters ?? []).map(id => `${store.content.characterById[id].displayName} is ready to grow`),
      ...(rewards.milestones ?? []),
      ...(rewards.masteryEvents ?? []).map(event => `${store.content.worldById[event.worldId]?.displayName ?? 'A world'} reached ${event.rankName} Mastery`),
      rewards.objective ? 'The optional objective is complete' : null
    ].filter(Boolean);
    // append() from dom.js, not Element.append: the conditional lines below are
    // null most of the time, and the native call would render them as "null".
    append(modal.querySelector('.results-content'), [
      h('div.fade-rule'),
      rewards.energyRefunded ? h('p.good', `Frontier Momentum returned ${rewards.energyRefunded} Energy after this first clear.`) : null,
      rewards.freeRunsUsed ? h('p.good', `${rewards.freeRunsUsed} run${rewards.freeRunsUsed === 1 ? ' was' : 's were'} carried by the Crisis boon, so no Energy was charged for ${rewards.freeRunsUsed === 1 ? 'it' : 'them'}.`) : null,
      h('p.results-unlocks', unlocks.length ? `${unlocks.join('. ')}.` : 'The materials have been added to your Workshop.'),
      unlocks.length ? h('p.warn', `${unlocks.length} thing${unlocks.length === 1 ? ' is' : 's are'} ready.`) : null]);

    const actions = h('div.modal-actions.results-actions');
    const repeatMembers = members ?? selectedMembers(store, result.node.id);
    const repeatCount = count ?? rewards.runs;
    const repeatCheck = checkClear(store.content, store.state, result.node.id, repeatMembers, repeatCount);
    actions.appendChild(h('div',
      h('button.btn.primary', {
        disabled: !repeatCheck.ok,
        onclick: async () => {
          const next = await store.tx(() => clearNode(store.content, store.state, result.node.id,
            repeatMembers, repeatCount, store.rng, store.now()), { rerender: false });
          close();
          if (next.ok) showResults(store, next, { members: repeatMembers, count: repeatCount });
        }
      }, 'Again →'),
      h('div.caption', `⚡${repeatCheck.cost} now`)));
    actions.append(
      h('button.btn', { onclick: () => { close(); store.go('#/inventory'); } }, 'Go craft'),
      h('button.btn', { onclick: () => { close(); store.go('#/home'); } }, 'Back to today'),
      h('button.btn', { onclick: finish }, 'Close'));
    modal.querySelector('.results-content').appendChild(actions);
  }, { size: 'full' });
}

function materialColumn(store, materials) {
  const total = materials.reduce((sum, [, qty]) => sum + qty, 0);
  return h('div.reward-column.quiet', h('div.eyebrow', 'Materials'), h('div.display-s', `+${fmt(total)}`),
    ...materials.slice(0, 3).map(([id, qty]) => h('div', `${store.content.materialById[id].icon} ${store.content.materialById[id].displayName} × ${qty}`,
      h('span.caption', ` · now ${fmt(store.state.inventory.materials[id] ?? 0)}`))));
}

function shardColumn(store, characterId, qty) {
  const def = store.content.characterById[characterId];
  const cs = store.state.characters[characterId];
  const before = store.ui.transactionBefore?.shards?.[characterId] ?? Math.max(0, cs.shards - qty);
  const need = cs.owned && cs.stars < 7 ? store.content.balance.starShards[cs.stars]
    : store.content.balance.rosterProgression.recruitShards;
  return h('div.reward-column.hero',
    h('div.shard-icon', '🧩'),
    h('div.display-s', `+${qty}`),
    h('div.title', def.displayName),
    h('div.progressbar.animated-progress', {
      style: { '--from': `${Math.min(100, before / need * 100)}%`, '--to': `${Math.min(100, cs.shards / need * 100)}%` }
    }, h('div')),
    h('div.caption', `${fmt(cs.shards)} of ${fmt(need)} — ${fmt(Math.max(0, need - cs.shards))} from the next milestone`));
}

function relicPieceColumn(store, pieceId) {
  const piece = store.content.relicPieceById[pieceId];
  const relic = piece ? store.content.relicByWorld[piece.world] : null;
  const image = store.content.images.relic[pieceId] ?? null;
  const ownedCount = relic ? relic.pieces.filter(entry => store.state.relics.pieces[entry.id]).length : 0;
  const complete = relic && ownedCount === relic.pieces.length;
  return h('div.reward-column.fragment',
    image
      ? h('img.result-relic-piece', { src: image, alt: '' })
      : h('div.shard-icon', '🗿'),
    h('div.title', piece?.displayName ?? 'Relic piece'),
    h('div.caption', complete
      ? `${relic.displayName} is whole — install it into a Program.`
      : relic ? `${ownedCount} of ${relic.pieces.length} pieces of ${relic.displayName} recovered.` : 'A piece has found its place.'));
}

export function showResults(store, result, { onClose, compactRoot, members, count } = {}) {
  if (resultPresentationMode(store, result) === 'full') {
    showFullResults(store, result, { onClose, members, count });
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

function selectedMembers(store, nodeId) {
  const index = preferredPartyIndex(store.state, nodeId);
  return store.state.parties[index].members.filter(Boolean);
}

function numberWord(number) {
  return ({ 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' })[number] ?? fmt(number);
}
