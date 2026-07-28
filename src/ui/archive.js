import { h } from './dom.js';
import { archiveStatus, selectSkin } from '../core/state.js';
import { openModal, toast } from '../app.js';
import { campaignLabel } from './shared.js';

export function renderArchive(store, root) {
  const { content, state } = store;
  root.appendChild(h('p.muted.small',
    'Archive rewards are cosmetic and lore-only. They never affect combat Power.'));
  for (const world of content.worlds) {
    const status = archiveStatus(content, state, world.id);
    const collapsed = state.ui.archiveCollapsed.worlds[world.id] ?? false;
    const worldDetails = h('details.panel.archive-world', { open: !collapsed });
    const percent = Math.round(status.fragmentsOwned / status.fragmentsTotal * 100);
    worldDetails.appendChild(h('summary.archive-summary',
      h('span', `${world.icon} ${status.archive.displayName}`),
      h('span.small.muted', `${status.relicsDone}/${status.relicsTotal} relics · ${percent}%`)));
    worldDetails.addEventListener('toggle', () => {
      state.ui.archiveCollapsed.worlds[world.id] = !worldDetails.open;
      store.save();
    });
    const bar = h('div.progressbar' + (status.complete ? '.full' : ''));
    bar.appendChild(h('div', { style: { width: `${percent}%` } }));
    worldDetails.appendChild(bar);
    status.collections.forEach((collection, index) => {
      const collectionCollapsed = state.ui.archiveCollapsed.collections[collection.collection.id] ?? false;
      const details = h('details.archive-collection', { open: !collectionCollapsed });
      details.appendChild(h('summary',
        `Collection ${index + 1}: ${collection.collection.displayName}`,
        collection.complete ? h('span.good', ' ✓') : null));
      details.addEventListener('toggle', () => {
        state.ui.archiveCollapsed.collections[collection.collection.id] = !details.open;
        store.save();
      });
      const shelf = h('div.archive-shelf');
      for (const relicStatus of collection.relics) {
        shelf.appendChild(relicCard(store, relicStatus));
      }
      details.appendChild(shelf);
      const reward = collection.collection.rewardSkin;
      if (reward) details.appendChild(skinReward(store, reward, collection.complete));
      else if (collection.collection.legacyMilestoneText) {
        details.appendChild(h('p.small.muted', collection.collection.legacyMilestoneText));
      }
      worldDetails.appendChild(details);
    });
    worldDetails.appendChild(h('h3', 'Full Archive reward'));
    worldDetails.appendChild(skinReward(store, status.archive.fullReward, status.complete,
      `Complete all ${status.relicsTotal} relics.`));
    root.appendChild(worldDetails);
  }
}

function relicCard(store, { relic, owned, total, complete }) {
  const card = h('div.relic-card' + (complete ? '.complete' : ''));
  const image = store.content.images.relic[relic.id];
  if (complete && image) card.appendChild(h('div.relic-art',
    h('img', { src: image, alt: relic.displayName })));
  else card.appendChild(h('div.r-ico', complete ? relicIcon(relic.id) : '▢'));
  card.appendChild(h('div.small', { style: { fontWeight: 600 } }, complete ? relic.displayName : '— Undiscovered —'));
  const pips = h('div.frag-pips');
  relic.fragments.forEach(fragment => pips.appendChild(h('span' + (store.state.archive.fragments[fragment.id] ? '.owned' : ''), {
    title: fragmentTitle(store, fragment)
  })));
  card.append(pips, h('div.small.muted', `${owned}/${total} fragments`));
  if (complete) {
    card.appendChild(h('button.btn.tiny', { onclick: () => inspectRelic(store, relic) }, 'Inspect'));
  } else {
    const missing = relic.fragments.filter(fragment => !store.state.archive.fragments[fragment.id]);
    for (const fragment of missing) {
      card.appendChild(h('button.link.small', {
        onclick: () => {
          const node = store.content.nodeById[fragment.sourceNode];
          store.go(`#/node/${node.id}`, {
            returnContext: { route: '#/archive', archive: { worldId: node.world, fragmentId: fragment.id } }
          });
        }
      }, `Find missing fragment — ${fragmentTitle(store, fragment)}`));
    }
  }
  return card;
}

function skinReward(store, reward, unlocked, lockedText = '') {
  if (!reward) return h('p.small.muted', 'No cosmetic reward.');
  const def = store.content.characterById[reward.characterId];
  const selected = store.state.characters[reward.characterId]?.selectedSkinId === reward.id;
  const wrap = h('div.skin-reward');
  wrap.appendChild(h('p.small' + (unlocked ? '.good' : '.muted'),
    `${unlocked ? '🎭 Unlocked: ' : '🎭 Reward: '}${reward.skinName}${def ? ` for ${def.displayName}` : ''}`,
    unlocked ? '' : ` — ${lockedText}`));
  const images = store.content.images.skin[reward.id];
  if (unlocked && images) wrap.appendChild(h('div.skin-previews',
    images.portrait ? h('img.skin-preview-sq', { src: images.portrait, alt: reward.skinName }) : null,
    images.fullBody ? h('img.skin-preview-tall', { src: images.fullBody, alt: reward.skinName }) : null));
  if (unlocked && def) wrap.appendChild(h('button.btn.tiny' + (selected ? '.primary' : ''), {
    disabled: selected,
    onclick: () => store.tx(() => {
      const result = selectSkin(store.content, store.state, reward.characterId, reward.id);
      if (result.ok) toast(`${reward.skinName} equipped for ${def.displayName}.`);
      return result;
    })
  }, selected ? 'Skin in use' : 'Use Skin'));
  return wrap;
}

function relicIcon(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const icons = ['🏺', '📜', '🕯️', '🗝️', '🔔', '🪞', '🧭', '🎖️', '💠', '🎐'];
  return icons[hash % icons.length];
}

function fragmentTitle(store, fragment) {
  const node = store.content.nodeById[fragment.sourceNode];
  return `First clear: ${campaignLabel(store, node)} ${node.number} — ${node.displayName}`;
}

function inspectRelic(store, relic) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', `${relicIcon(relic.id)} ${relic.displayName}`));
    modal.appendChild(h('p', relic.lore));
    modal.appendChild(h('p.small.muted',
      `Recovered from: ${relic.fragments.map(fragment => fragmentTitle(store, fragment)).join(' · ')}`));
    modal.appendChild(h('div.modal-actions', h('button.btn', { onclick: close }, 'Close')));
  });
}
