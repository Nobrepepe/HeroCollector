import { h, fmt, pct } from './dom.js';
import { archiveStatus, nodeUnlocked, selectSkin } from '../core/state.js';
import { openModal, toast } from '../app.js';
import { campaignLabel, portraitSlot } from './shared.js';
import { relicPieceModel, collectionSummary } from './presentation.js';

export function renderArchive(store, root, arg = null) {
  if (arg === 'synergies') {
    renderSynergyCodex(store, root);
    return;
  }
  const route = parseArchiveRoute(store.content, arg);
  if (!route) {
    root.appendChild(h('p.muted', 'No published Archive exists yet.'));
    return;
  }
  root.classList.add('archive-screen');
  if (route.collectionIndex === null) renderWorldArchive(store, root, route.world);
  else renderArchiveCollection(store, root, route.world, route.collectionIndex);
}

function renderSynergyCodex(store, root) {
  root.classList.add('archive-screen', 'synergy-codex-screen');
  const tags = store.content.tags.filter(tag => tag.thresholds?.length);
  const categories = [...new Set(tags.map(tag => tag.category))];
  let active = categories[0] ?? null;
  root.appendChild(h('header.synergy-codex-head',
    h('div.eyebrow', 'Archive · party codex'),
    h('h1.display-s', 'Every way a party can fit.'),
    h('p', `Bonuses add together until the global ${pct(store.content.balance.synergyCapBp)} cap. Colour never changes the rule.`)));
  const controls = h('nav.synergy-codex-tabs', { 'aria-label': 'Synergy categories' });
  const grid = h('div.synergy-codex-grid');
  const paint = () => {
    controls.replaceChildren();
    categories.forEach(category => controls.appendChild(h(
      'button' + (category === active ? '.active' : ''),
      {
        onclick: () => { active = category; paint(); },
        'aria-pressed': category === active
      },
      categoryName(category))));
    grid.replaceChildren();
    tags.filter(tag => tag.category === active).forEach((tag, index) => {
      grid.appendChild(h('article.synergy-codex-entry',
        h('div.eyebrow', categoryName(tag.category)),
        h('h2', tag.displayName),
        h('p', tag.explanation),
        h('div.synergy-thresholds',
          ...tag.thresholds.map(threshold => h('div',
            h('span', thresholdWords(store, tag, threshold)),
            h('span.numeral.good', `+${pct(threshold.bonusBp)}`)))),
        index < tags.length - 1 ? h('div.fade-rule') : null));
    });
  };
  root.append(controls, grid,
    h('button.link.synergy-codex-back', { onclick: () => store.go('#/party') }, '← Party'));
  paint();
}

function categoryName(category) {
  return ({
    world: 'World bonds',
    archetype: 'Archetype pairs',
    profession: 'Shared callings',
    faction: 'Factions'
  })[category] ?? category;
}

function thresholdWords(store, tag, threshold) {
  if (tag.activationRule === 'same_world_count') return `${threshold.count} from one world`;
  if (tag.activationRule === 'distinct_world_count') return `${threshold.count} different worlds`;
  if (tag.activationRule === 'archetype_pair') {
    return tag.pair.map(id => store.content.archetypes[id]?.name ?? id).join(' + ');
  }
  return `${threshold.count} ${tag.displayName.toLocaleLowerCase()}`;
}

function renderWorldArchive(store, root, world) {
  const status = archiveStatus(store.content, store.state, world.id);
  const remaining = status.fragmentsTotal - status.fragmentsOwned;
  const closest = closestCollection(status.collections);
  root.classList.add('archive-world-screen');
  root.appendChild(archiveBackdrop(store.content.images.world[world.id]));
  root.appendChild(h('header.archive-world-head',
    h('div.eyebrow', 'Archive · lore and cosmetics only, never power'),
    h('h1.display-l', world.displayName),
    h('div.archive-world-tally',
      h('span.display-l', fmt(remaining)),
      h('span', `fragments still out there`, h('small', `${fmt(status.relicsDone)} of ${fmt(status.relicsTotal)} relics whole`)))));
  root.appendChild(h('div.fade-rule.archive-world-rule'));

  const collections = h('div.archive-collections');
  status.collections.forEach((collection, index) => {
    collections.appendChild(collectionPreview(store, world, collection, index, index === closest));
  });
  root.appendChild(collections);
  root.appendChild(h('div.fade-rule.archive-foot-rule'));
  root.appendChild(worldReward(store, status));
  root.appendChild(worldNavigation(store, world));
}

function collectionPreview(store, world, status, index, recommended) {
  const fragments = fragmentCount(status);
  const whole = status.relics.filter(relic => relic.complete).length;
  const opened = collectionOpened(store, status);
  const reward = status.collection.rewardSkin;
  const rewardImage = rewardImageFor(store, reward);
  const remaining = status.relics.length - whole;
  const section = h('section.archive-collection-preview' + (opened ? '' : '.unopened'));
  section.append(
    h('h2.title', status.collection.displayName),
    h('div.caption', opened
      ? `Collection ${numberWord(index + 1)} · ${collectionSummary(status)}`
      : `Collection ${numberWord(index + 1)} · ${fmt(fragments)} of ${fmt(status.relics.length * 2)} fragments · opens in chapter ${numberWord(index + 1)}`),
    h('div.archive-chip-row',
      ...status.relics.map(relic => relicChip(store, relic))),
    h('div.archive-mini-progress', h('i', {
      style: { width: `${fragments / (status.relics.length * 2) * 100}%` }
    })),
    h('div.caption', `${fmt(fragments)} of ${fmt(status.relics.length * 2)} fragments`),
    h('div.archive-collection-reward',
      rewardGhost(store, reward, rewardImage, 64),
      h('div',
        h('div.archive-reward-name', opened && whole > 0 ? reward?.skinName ?? 'A recovered appearance' : 'Still unnamed'),
        h('div.caption', opened ? `${numberWord(remaining)} relic${remaining === 1 ? '' : 's'} away · cosmetic` : 'Waiting beyond the path'))),
    h('button.archive-open-link' + (recommended && opened ? '.recommended' : ''), {
      disabled: !opened,
      onclick: () => store.go(`#/archive/${world.id}/${index + 1}`)
    }, opened ? 'Open the collection →' : `Opens in chapter ${numberWord(index + 1)}`));
  return section;
}

function renderArchiveCollection(store, root, world, collectionIndex) {
  const worldStatus = archiveStatus(store.content, store.state, world.id);
  const status = worldStatus.collections[collectionIndex];
  if (!status) {
    store.go(`#/archive/${world.id}`);
    return;
  }
  const fragments = fragmentCount(status);
  const total = status.relics.length * 2;
  const reward = status.collection.rewardSkin;
  const rewardName = status.relics.some(relic => relic.complete)
    ? (reward?.skinName ?? 'Recovered appearance')
    : 'Still unnamed';
  const background = store.content.images.chapter?.[`${world.campaignId}:${collectionIndex + 1}`]
    ?? store.content.images.world[world.id];
  root.classList.add('archive-collection-screen');
  root.appendChild(archiveBackdrop(background, true));
  const header = h('header.archive-collection-head',
    h('div',
      h('div.eyebrow', `${world.displayName} · collection ${numberWord(collectionIndex + 1)}`),
      h('h1.display-m', status.collection.displayName),
      h('p', sentenceCase(collectionSummary(status)) + '.'),
      h('div.archive-collection-progress', h('i', { style: { width: `${fragments / total * 100}%` } }))),
    h('div.archive-head-reward',
      rewardGhost(store, reward, rewardImageFor(store, reward), 76),
      h('div',
        h('div.archive-reward-name', rewardName),
        h('div.caption', rewardDistance(status)))));
  root.appendChild(header);
  root.appendChild(h('div.fade-rule.archive-collection-rule'));

  const grid = h('div.archive-relic-grid');
  status.relics.forEach(relic => grid.appendChild(relicTile(store, relic, world.id, collectionIndex)));
  root.appendChild(grid);
  root.appendChild(h('footer.archive-collection-footer',
    h('button.link', { onclick: () => store.go(`#/archive/${world.id}`) }, `← ${world.displayName}`),
    h('span.caption', 'Hover a missing half to see the node that holds it.')));
}

function relicTile(store, status, worldId, collectionIndex) {
  const { relic, owned, total, complete } = status;
  const image = store.content.images.relic[relic.id];
  const entry = h('article.archive-relic-tile');
  const puzzle = h('div.relic.archive-relic', {
    'aria-label': `${relic.displayName}, ${owned} of ${total} fragments`
  });
  if (complete) puzzle.appendChild(h('div.relic-glow'));
  for (const piece of relicPieceModel(store, relic)) {
    const classes = `relic-piece ${piece.side}${piece.owned ? ' owned' : ''}${piece.owned && image ? '' : ' relic-piece--empty'}`;
    const title = piece.owned ? `${piece.side} half recovered` : fragmentTitle(store, piece.fragment);
    const content = !image && piece.owned ? h('span', relicIcon(relic.id)) : null;
    if (piece.owned) {
      puzzle.appendChild(h(`div.${classes.replaceAll(' ', '.')}`, {
        title, style: image ? { backgroundImage: `url("${image}")` } : {}
      }, content));
    } else {
      puzzle.appendChild(h(`button.${classes.replaceAll(' ', '.')}`, {
        title,
        'aria-label': `Find ${piece.side} half — ${title}`,
        onclick: () => store.go(`#/node/${piece.node.id}`, {
          returnContext: {
            route: `#/archive/${worldId}/${collectionIndex + 1}`,
            archive: { worldId, fragmentId: piece.fragment.id }
          }
        })
      }));
    }
  }
  if (complete) puzzle.appendChild(h('div.relic-seam'));
  entry.append(
    puzzle,
    h('button.relic-name', { disabled: !complete, onclick: () => inspectRelic(store, relic) },
      owned ? relic.displayName : '— undiscovered —'),
    h(`div.relic-status.${complete ? 'whole' : owned ? 'partial' : 'buried'}`, relicStatus(store, relic, owned, complete)));
  return entry;
}

function relicChip(store, status) {
  const image = store.content.images.relic[status.relic.id];
  const chip = h(`div.archive-relic-chip.${status.complete ? 'whole' : status.owned ? 'partial' : 'buried'}`, {
    title: `${status.relic.displayName}: ${status.owned} of ${status.total} fragments`
  });
  relicPieceModel(store, status.relic).forEach(piece => {
    chip.appendChild(h(`i.relic-piece.${piece.side}${piece.owned ? '.owned' : ''}${piece.owned && image ? '' : '.relic-piece--empty'}`, {
      style: piece.owned && image ? { backgroundImage: `url("${image}")` } : {}
    }));
  });
  if (status.complete) chip.appendChild(h('i.relic-seam'));
  return chip;
}

function worldReward(store, status) {
  const reward = status.archive.fullReward;
  return h('footer.archive-world-reward',
    rewardGhost(store, reward, rewardImageFor(store, reward), 52),
    h('div',
      h('div.eyebrow', `And for all ${fmt(status.relicsTotal)}`),
      h('div.archive-world-reward-name', reward?.skinName ?? 'The full Archive appearance')),
    h('p', 'Cosmetic, every one of them. They fight exactly as hard either way.'));
}

function worldNavigation(store, world) {
  if (store.content.worlds.length < 2) return null;
  const index = store.content.worlds.indexOf(world);
  return h('nav.archive-world-nav', { 'aria-label': 'Archive worlds' },
    ...store.content.worlds.map((item, itemIndex) => h('button' + (itemIndex === index ? '.active' : ''), {
      onclick: () => store.go(`#/archive/${item.id}`),
      'aria-current': itemIndex === index ? 'page' : null
    }, item.displayName)));
}

function archiveBackdrop(image, darker = false) {
  const backdrop = h('div.archive-backdrop' + (image ? '' : '.art-fallback') + (darker ? '.darker' : ''), {
    'aria-hidden': 'true',
    style: image ? { backgroundImage: `url("${image}")` } : {}
  });
  return backdrop;
}

function rewardGhost(store, reward, image, size) {
  const def = reward ? store.content.characterById[reward.characterId] : null;
  return portraitSlot({
    src: image,
    color: def?.color ?? 'var(--muted-2)',
    glyph: def?.glyph ?? '✦',
    alt: '',
    size: 'ghost',
    state: 'ghost',
    decorative: true
  });
}

function rewardImageFor(store, reward) {
  if (!reward) return null;
  return store.content.images.skin[reward.id]?.portrait
    ?? store.content.images.portrait[reward.characterId]
    ?? null;
}

function parseArchiveRoute(content, arg) {
  if (!content.worlds.length) return null;
  const [worldId, collectionValue] = (arg ?? '').split('/');
  const world = content.worldById[worldId] ?? content.worlds[0];
  if (!collectionValue) return { world, collectionIndex: null };
  const index = Number(collectionValue) - 1;
  return { world, collectionIndex: Number.isInteger(index) && index >= 0 ? index : null };
}

function collectionOpened(store, status) {
  if (fragmentCount(status) > 0) return true;
  const firstNode = store.content.nodeById[status.collection.relics[0]?.fragments[0]?.sourceNode];
  return firstNode ? nodeUnlocked(store.content, store.state, firstNode).unlocked : false;
}

function closestCollection(collections) {
  let best = -1;
  let missing = Infinity;
  collections.forEach((collection, index) => {
    const current = collection.relics.reduce((sum, relic) => sum + relic.total - relic.owned, 0);
    if (current < missing) {
      best = index;
      missing = current;
    }
  });
  return best;
}

function fragmentCount(collection) {
  return collection.relics.reduce((sum, relic) => sum + relic.owned, 0);
}

function relicStatus(store, relic, owned, complete) {
  if (complete) return 'Whole';
  const missing = relicPieceModel(store, relic).filter(piece => !piece.owned);
  if (owned) {
    const piece = missing[0];
    return `One of two · ${piece.side} half in ${piece.node.chapter}-${piece.node.position}`;
  }
  const locations = [...new Set(missing.map(piece => `${piece.node.chapter}-${piece.node.position}`))];
  return `Undiscovered · ${locations.length === 1 ? `both halves in ${locations[0]}` : `halves in ${locations.join(' / ')}`}`;
}

function rewardDistance(status) {
  const remaining = status.relics.length - status.relics.filter(relic => relic.complete).length;
  return `${numberWord(remaining)} relic${remaining === 1 ? '' : 's'} away · cosmetic`;
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

export function relicIcon(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ['🏺', '📜', '🕯️', '🗝️', '🔔', '🪞', '🧭', '🎖️', '💠', '🎐'][hash % 10];
}

export function skinReward(store, reward, unlocked, lockedText = '') {
  if (!reward) return h('p.caption', 'No cosmetic reward.');
  const def = store.content.characterById[reward.characterId];
  const selected = store.state.characters[reward.characterId]?.selectedSkinId === reward.id;
  const wrap = h('div.skin-reward' + (unlocked ? '.unlocked' : '.locked'),
    rewardGhost(store, reward, rewardImageFor(store, reward), 76),
    h('div',
      h('div.title', reward.skinName),
      h('p', unlocked ? `${def?.displayName ?? 'This hero'} can wear this recovered appearance.` : lockedText || 'Complete this collection to bring the appearance into focus.'),
      h('div.caption', 'Cosmetic. They fight exactly as hard either way.')));
  if (unlocked && def) wrap.appendChild(h('button.link', {
    disabled: selected,
    onclick: () => store.tx(() => {
      const result = selectSkin(store.content, store.state, reward.characterId, reward.id);
      if (result.ok) toast(`${reward.skinName} equipped for ${def.displayName}.`);
      return result;
    })
  }, selected ? 'Skin in use' : 'Use Skin'));
  return wrap;
}

function numberWord(number) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][number] ?? fmt(number);
}

function sentenceCase(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
