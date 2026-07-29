import { h, fmt } from './dom.js';
import { archiveStatus, selectSkin } from '../core/state.js';
import { openModal, toast } from '../app.js';
import { campaignLabel } from './shared.js';
import { relicPieceModel, collectionSummary } from './presentation.js';

export function renderArchive(store, root) {
  const { content, state } = store;
  for (const world of content.worlds) {
    const status = archiveStatus(content, state, world.id);
    const collapsed = state.ui.archiveCollapsed.worlds[world.id] ?? false;
    const worldDetails = h('details.archive-world', { open: !collapsed });
    worldDetails.addEventListener('toggle', () => {
      state.ui.archiveCollapsed.worlds[world.id] = !worldDetails.open; store.save();
    });
    const percent = status.fragmentsTotal ? Math.round(status.fragmentsOwned / status.fragmentsTotal * 100) : 0;
    worldDetails.appendChild(h('summary.archive-hero',
      h('div', h('div.eyebrow', 'Archive · lore and cosmetics only, never power'),
        h('h1.display-s', `${world.icon} ${status.archive.displayName}`),
        h('p', `${status.relicsDone} of ${status.relicsTotal} relics whole · ${status.fragmentsOwned} of ${status.fragmentsTotal} fragments recovered`),
        h('div.progressbar.archive-progress', h('div', { style: { width: `${percent}%` } }))),
      h('div.archive-counts',
        ...status.collections.map((collection, index) => h('div', `Collection ${index + 1} · ${collection.relics.filter(relic => relic.complete).length}/${collection.relics.length}`)))));

    status.collections.forEach((collection, index) => {
      const collectionCollapsed = state.ui.archiveCollapsed.collections[collection.collection.id] ?? false;
      const details = h('details.archive-collection', { open: !collectionCollapsed });
      details.addEventListener('toggle', () => {
        state.ui.archiveCollapsed.collections[collection.collection.id] = !details.open; store.save();
      });
      details.appendChild(h('summary.collection-heading',
        h('span.title', `Collection ${numberWord(index + 1)} · ${collection.collection.displayName}`),
        h('span.caption', collectionSummary(collection))));
      const shelf = h('div.archive-shelf');
      collection.relics.forEach(relic => shelf.appendChild(relicCard(store, relic)));
      details.appendChild(shelf);
      if (collection.collection.rewardSkin) details.appendChild(skinReward(store, collection.collection.rewardSkin, collection.complete));
      else if (collection.collection.legacyMilestoneText) details.appendChild(h('p.caption', collection.collection.legacyMilestoneText));
      worldDetails.appendChild(details);
    });
    worldDetails.appendChild(h('section.full-archive-reward',
      h('div.eyebrow', 'Full Archive reward'),
      skinReward(store, status.archive.fullReward, status.complete, `Complete all ${status.relicsTotal} relics.`),
      !status.complete ? h('div.missing-relic-slots',
        ...Array(Math.min(4, status.relicsTotal - status.relicsDone)).fill(0).map(() => h('i'))) : null));
    root.appendChild(worldDetails);
  }
  if (!content.worlds.length) root.appendChild(h('p.muted', 'No published Archive exists yet.'));
}

function relicCard(store, status) {
  const { relic, owned, total, complete } = status;
  const image = store.content.images.relic[relic.id];
  const card = h('article.relic-entry');
  const puzzle = h('div.relic', {
    'aria-label': `${relic.displayName}, ${owned} of ${total} fragments`
  });
  if (complete) puzzle.appendChild(h('div.relic-glow'));
  for (const piece of relicPieceModel(store, relic)) {
    const classes = `relic-piece ${piece.side}${piece.owned && image ? '' : ' relic-piece--empty'}`;
    const attrs = {
      style: piece.owned && image ? { backgroundImage: `url("${image}")` } : {},
      title: piece.owned ? `${piece.side} half recovered` : fragmentTitle(store, piece.fragment)
    };
    if (!piece.owned) {
      puzzle.appendChild(h(`button.${classes.replaceAll(' ', '.')}`, {
        ...attrs,
        'aria-label': `Find ${piece.side} half — ${fragmentTitle(store, piece.fragment)}`,
        onclick: () => store.go(`#/node/${piece.node.id}`, {
          returnContext: { route: '#/archive', archive: { worldId: piece.node.world, fragmentId: piece.fragment.id } }
        })
      }, !image ? h('span', relicIcon(relic.id)) : null));
    } else {
      puzzle.appendChild(h(`div.${classes.replaceAll(' ', '.')}`, attrs,
        !image ? h('span', relicIcon(relic.id)) : null));
    }
  }
  if (complete) puzzle.appendChild(h('div.relic-seam'));
  card.appendChild(puzzle);
  card.appendChild(h('button.relic-name', {
    disabled: !complete, onclick: () => inspectRelic(store, relic)
  }, owned ? relic.displayName : '— undiscovered —'));
  card.appendChild(h(`div.relic-count.${complete ? 'good' : owned ? 'warn' : ''}`, `${owned} of ${total} fragments`));
  relicPieceModel(store, relic).filter(piece => !piece.owned).forEach(piece => card.appendChild(h('button.relic-hint', {
    onclick: () => store.go(`#/node/${piece.node.id}`, {
      returnContext: { route: '#/archive', archive: { worldId: piece.node.world, fragmentId: piece.fragment.id } }
    })
  }, `${piece.side} half — ${campaignLabel(store, piece.node)} ${piece.node.chapter}-${piece.node.position} · ${piece.node.displayName}`)));
  return card;
}

function skinReward(store, reward, unlocked, lockedText = '') {
  if (!reward) return h('p.caption', 'No cosmetic reward.');
  const def = store.content.characterById[reward.characterId];
  const selected = store.state.characters[reward.characterId]?.selectedSkinId === reward.id;
  const images = store.content.images.skin[reward.id];
  const wrap = h('div.skin-reward' + (unlocked ? '.unlocked' : '.locked'));
  if (images) wrap.appendChild(h('div.skin-previews',
    images.portrait ? h('img.skin-preview-sq.bleed-portrait', { src: images.portrait, alt: reward.skinName }) : null,
    images.fullBody ? h('img.skin-preview-tall.bleed-tall', { src: images.fullBody, alt: reward.skinName }) : null));
  wrap.append(
    h('div.title', reward.skinName),
    h('p', unlocked ? `${def?.displayName ?? 'This hero'} can wear this recovered appearance.` : lockedText || 'Complete this collection to bring the appearance into focus.'),
    h('div.caption', 'Cosmetic. They fight exactly as hard either way.'));
  if (unlocked && def) wrap.appendChild(h('button.btn' + (selected ? '.primary' : ''), {
    disabled: selected,
    onclick: () => store.tx(() => {
      const result = selectSkin(store.content, store.state, reward.characterId, reward.id);
      if (result.ok) toast(`${reward.skinName} equipped for ${def.displayName}.`);
      return result;
    })
  }, selected ? 'Skin in use' : 'Use Skin'));
  return wrap;
}

export function relicIcon(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ['🏺', '📜', '🕯️', '🗝️', '🔔', '🪞', '🧭', '🎖️', '💠', '🎐'][hash % 10];
}

function fragmentTitle(store, fragment) {
  const node = store.content.nodeById[fragment.sourceNode];
  return `${campaignLabel(store, node)} ${node.number} · ${node.displayName}`;
}

function inspectRelic(store, relic) {
  openModal((modal, close) => {
    modal.append(h('h2.title', relic.displayName), h('p', relic.lore),
      h('p.caption', `Recovered from ${relic.fragments.map(fragment => fragmentTitle(store, fragment)).join(' · ')}`),
      h('div.modal-actions', h('button.btn', { onclick: close }, 'Close')));
  });
}

function numberWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five'][n] ?? fmt(n);
}
