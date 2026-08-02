import { enableMouseDragScroll, h, fmt } from './dom.js';
import { readyUpgrades } from '../core/state.js';
import { characterPower } from '../core/power.js';
import { portrait, starline } from './shared.js';
import { characterFilterBar, filterCharacters } from './character-picker.js';

export function renderRoster(store, root) {
  const { content, state } = store;
  const preferences = state.ui.roster;
  preferences.collectionDensity = preferences.collectionDensity === 'compact' ? 'compact' : 'gallery';
  const readyItems = readyUpgrades(content, state);
  const ready = new Set(readyItems.map(item => item.characterId));
  const readyByCharacter = new Map();
  for (const item of readyItems) {
    const items = readyByCharacter.get(item.characterId) ?? [];
    items.push(item);
    readyByCharacter.set(item.characterId, items);
  }
  let search = '';
  const ownedCount = content.characters.filter(def => state.characters[def.id].owned).length;
  root.classList.add('collection-screen', `collection-density-${preferences.collectionDensity}`);
  root.appendChild(h('header.collection-head',
    h('div', h('div.eyebrow', 'Your people'), h('h1.display-s', `${ownedCount} of ${content.characters.length} met.`),
      h('p.muted', worldSentence(content))),
    h('div.collection-controls',
      h('div.collection-primary',
        primaryFilter(store, preferences, 'Everyone', preferences.ownership === 'all', () => {
          preferences.ownership = 'all';
        }),
        primaryFilter(store, preferences, 'Ready to grow', preferences.ownership === 'ready', () => {
          preferences.ownership = 'ready';
        }),
        primaryFilter(store, preferences, 'Not yet met', preferences.ownership === 'unowned', () => {
          preferences.ownership = 'unowned';
        }),
        primaryFilter(store, preferences, 'By power ↓', preferences.sort === 'power' && preferences.direction === 'desc', () => {
          preferences.sort = 'power'; preferences.direction = 'desc';
        }),
        h('span.collection-view-separator', '·'),
        densityControl(store, preferences, 'Gallery', 'gallery'),
        densityControl(store, preferences, 'Compact', 'compact')),
      h('input.character-search', {
        type: 'search', placeholder: 'Search by name…', 'aria-label': 'Search characters',
        oninput: event => { search = event.target.value; paint(); }
      }))));
  store.registerSearchInput(root.querySelector('.character-search'));

  const more = h('details.collection-more', h('summary', 'More filters'));
  more.appendChild(characterFilterBar(store, preferences, () => { store.save(); paint(); }, { ownership: false }));
  root.appendChild(more);
  const gallery = h('div.collection-gallery');
  enableMouseDragScroll(gallery);
  const compact = h('div.collection-compact-grid');
  const footer = h('footer.collection-compact-footer');
  root.append(gallery, compact, footer);

  function paint() {
    gallery.replaceChildren();
    compact.replaceChildren();
    footer.replaceChildren();
    const rows = filterCharacters(content, state, preferences, ready, search);
    const owned = rows.filter(def => state.characters[def.id].owned);
    if (preferences.collectionDensity === 'gallery') {
      owned.forEach((def, index) => gallery.appendChild(characterCard(store, def, ready.has(def.id), index)));
      if (!owned.length) gallery.appendChild(h('p.muted', 'No met characters match these filters.'));
    } else {
      let pulseUsed = false;
      rows.forEach(def => {
        const isReady = ready.has(def.id);
        compact.appendChild(compactCharacter(store, def, readyByCharacter.get(def.id) ?? [], isReady && !pulseUsed));
        if (isReady) pulseUsed = true;
      });
      if (!rows.length) compact.appendChild(h('p.muted', 'No characters match these filters.'));
      const globalOwned = content.characters.filter(def => state.characters[def.id].owned).length;
      const oneRun = content.characters.filter(def => !state.characters[def.id].owned && oneShardRunAway(content, state, def)).length;
      footer.append(
        h('div.fade-rule'),
        h('div.collection-footer-line',
          h('span', `${numberWord(oneRun)} ${oneRun === 1 ? 'is' : 'are'} one shard-run from joining you.`),
          h('span', h('b.numeral', fmt(globalOwned)), ` met · ${fmt(content.characters.length - globalOwned)} still out there`)));
    }
    gallery.hidden = preferences.collectionDensity !== 'gallery';
    compact.hidden = preferences.collectionDensity !== 'compact';
    footer.hidden = preferences.collectionDensity !== 'compact';
  }
  paint();
}

function densityControl(store, preferences, label, density) {
  return h('button.collection-density' + (preferences.collectionDensity === density ? '.active' : ''), {
    onclick: () => {
      preferences.collectionDensity = density;
      store.save().then(() => rerenderRoster(store));
    },
    'aria-pressed': preferences.collectionDensity === density
  }, label);
}

function primaryFilter(store, preferences, label, active, mutate) {
  return h('button.collection-filter' + (active ? '.active' : ''), {
    onclick: () => {
      mutate();
      store.save().then(() => rerenderRoster(store));
    }
  }, label);
}

function rerenderRoster(store) {
  const root = document.getElementById('screen');
  root.replaceChildren();
  root.classList.remove('collection-density-gallery', 'collection-density-compact');
  renderRoster(store, root);
}

function characterCard(store, def, isReady, index) {
  const cs = store.state.characters[def.id];
  const need = cs.stars < 7 ? store.content.balance.starShards[cs.stars] : 1;
  const image = store.content.images.fullBody[def.id];
  const card = h('button.gallery-card' + (isReady ? '.ready' : ''), {
    onclick: () => store.go(`#/character/${def.id}`),
    'aria-label': `${def.displayName}, ${cs.stars} stars, ${fmt(characterPower(store.content, cs))} Power${isReady ? ', upgrade ready' : ''}`,
    style: { '--character-color': def.color, '--gallery-offset': index % 2 ? '26px' : '0px' }
  });
  const art = h('div.gallery-art.bleed-tall' + (image ? '' : '.art-fallback'));
  if (image) art.appendChild(h('img', { src: image, alt: '', draggable: 'false' }));
  else art.appendChild(h('span.gallery-glyph', def.glyph));
  const arch = store.content.archetypes[def.archetype];
  card.append(art, h('div.gallery-scrim'), h('div.gallery-meta',
    h('div.eyebrow', arch.name),
    h('div.title', def.displayName),
    starline(cs.stars),
    h('div.gallery-power', h('span.numeral', fmt(characterPower(store.content, cs))), h('span.caption', ' power')),
    h('div.progressbar', h('div', { style: { width: `${Math.min(100, cs.shards / need * 100)}%` } })),
    isReady ? h('div.gallery-ready', 'ready to grow') : null));
  return card;
}

function worldSentence(content) {
  if (!content.worlds.length) return 'Your worlds are still being authored.';
  return content.worlds.map(world => world.displayName).join(' · ');
}

function compactCharacter(store, def, readyItems, pulses) {
  const cs = store.state.characters[def.id];
  const owned = cs.owned;
  const isReady = readyItems.length > 0;
  const need = owned
    ? (cs.stars < 7 ? store.content.balance.starShards[cs.stars] : null)
    : store.content.balance.acquisitionTiers[def.tier].cumulativeShards;
  const card = h('button.compact-character' + (owned ? '.owned' : '.unmet') + (isReady ? '.ready' : '') + (pulses ? '.pulses' : ''), {
    onclick: () => store.go(`#/character/${def.id}`),
    style: { '--character-color': def.color },
    'aria-label': owned
      ? `${def.displayName}, ${cs.stars} stars, ${fmt(characterPower(store.content, cs))} Power${isReady ? ', upgrade ready' : ''}`
      : `${def.displayName}, not yet met, ${fmt(cs.shards)} of ${fmt(need)} shards`
  });
  const well = h('div.compact-character-well');
  well.appendChild(portrait(store, def.id, 'compact', {
    state: owned ? 'met' : 'unmet',
    pulse: pulses
  }));
  card.append(well, h('span.compact-character-name', def.displayName));
  if (owned) card.appendChild(starline(cs.stars));
  card.appendChild(owned
    ? h('span.compact-power', fmt(characterPower(store.content, cs)), h('small', ' power'))
    : h('span.caption', cs.shards ? `${fmt(cs.shards)} / ${fmt(need)} shards` : 'not yet found'));
  if (isReady) card.appendChild(h('span.compact-ready', compactReadyLabel(readyItems, owned)));
  return card;
}

function compactReadyLabel(items, owned) {
  if (!owned || items.some(item => item.type === 'unlock')) return 'ready to join';
  if (items.some(item => item.type === 'promoteStar')) return 'a star is ready';
  if (items.some(item => item.type === 'completeTier')) return 'gear tier ready';
  if (items.some(item => item.type === 'craftEquipment')) return 'equipment ready to craft';
  return 'upgrade ready';
}

function oneShardRunAway(content, state, def) {
  const cs = state.characters[def.id];
  const need = content.balance.acquisitionTiers[def.tier].cumulativeShards;
  const bestRun = Math.max(0, ...(content.shardNodesByCharacter[def.id] ?? [])
    .map(node => content.balance.nodeDefaults[node.type]?.repeat?.count ?? 0));
  return cs.shards < need && need - cs.shards <= bestRun;
}

function numberWord(number) {
  return ({ 0: 'None', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' })[number] ?? fmt(number);
}
