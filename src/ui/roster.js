import { h, fmt } from './dom.js';
import { readyUpgrades, checkUnlockCharacter } from '../core/state.js';
import { characterPower } from '../core/power.js';
import { portrait, starline } from './shared.js';
import { characterFilterBar, filterCharacters } from './character-picker.js';

export function renderRoster(store, root) {
  const { content, state } = store;
  const preferences = state.ui.roster;
  const ready = new Set(readyUpgrades(content, state).map(item => item.characterId));
  let search = '';
  const ownedCount = content.characters.filter(def => state.characters[def.id].owned).length;
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
        })),
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
  const outThere = h('section.still-out-there', h('div.eyebrow', 'Still out there'));
  root.append(gallery, outThere);

  function paint() {
    gallery.replaceChildren();
    outThere.querySelectorAll('.unowned-row').forEach(el => el.remove());
    const rows = filterCharacters(content, state, preferences, ready, search);
    const owned = rows.filter(def => state.characters[def.id].owned);
    const unowned = rows.filter(def => !state.characters[def.id].owned);
    owned.forEach((def, index) => gallery.appendChild(characterCard(store, def, ready.has(def.id), index)));
    if (!owned.length) gallery.appendChild(h('p.muted', 'No met characters match these filters.'));
    for (const def of unowned) {
      const cs = state.characters[def.id];
      const need = content.balance.acquisitionTiers[def.tier].cumulativeShards;
      outThere.appendChild(h('button.unowned-row', { onclick: () => store.go(`#/character/${def.id}`) },
        portrait(store, def.id, 'sm'), h('span', def.displayName),
        h('span.caption', `${fmt(cs.shards)} / ${fmt(need)} shards`),
        checkUnlockCharacter(content, state, def.id).ok ? h('span.good', 'ready') : null));
    }
    outThere.hidden = unowned.length === 0;
  }
  paint();
}

function enableMouseDragScroll(gallery) {
  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let dragged = false;

  gallery.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startScroll = gallery.scrollLeft;
    dragged = false;
  });
  gallery.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) > 6 && !dragged) {
      dragged = true;
      gallery.setPointerCapture(pointerId);
      gallery.classList.add('dragging');
    }
    if (!dragged) return;
    event.preventDefault();
    gallery.scrollLeft = startScroll - distance;
  });
  const finish = event => {
    if (event.pointerId !== pointerId) return;
    if (gallery.hasPointerCapture(pointerId)) gallery.releasePointerCapture(pointerId);
    pointerId = null;
    gallery.classList.remove('dragging');
  };
  gallery.addEventListener('pointerup', finish);
  gallery.addEventListener('pointercancel', finish);
  gallery.addEventListener('click', event => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    dragged = false;
  }, true);
}

function primaryFilter(store, preferences, label, active, mutate) {
  return h('button.collection-filter' + (active ? '.active' : ''), {
    onclick: () => {
      mutate();
      store.save().then(() => {
        const root = document.getElementById('screen');
        root.replaceChildren();
        renderRoster(store, root);
      });
    }
  }, label);
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
