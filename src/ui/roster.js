import { h } from './dom.js';
import { readyUpgrades, checkUnlockCharacter } from '../core/state.js';
import { portrait, starline, charSub } from './shared.js';
import { characterFilterBar, filterCharacters } from './character-picker.js';

export function renderRoster(store, root) {
  const { content, state } = store;
  const preferences = state.ui.roster;
  const ready = new Set(readyUpgrades(content, state).map(item => item.characterId));
  let search = '';
  const grid = h('div.card-grid');
  const rerenderGrid = () => {
    grid.replaceChildren();
    for (const def of filterCharacters(content, state, preferences, ready, search)) {
      const cs = state.characters[def.id];
      const card = h('button.char-card' + (cs.owned ? '' : '.unowned'), {
        onclick: () => store.go(`#/character/${def.id}`)
      });
      card.appendChild(portrait(store, def.id, 'md'));
      const body = h('div');
      body.appendChild(h('div.name', def.displayName,
        ready.has(def.id) ? h('span.ready-dot', { title: 'Upgrade ready', 'aria-label': 'Upgrade ready' }) : null));
      if (cs.owned) {
        body.appendChild(h('div', starline(cs.stars)));
        body.appendChild(h('div.sub', charSub(store, def, cs)));
      } else {
        const need = content.balance.acquisitionTiers[def.tier].cumulativeShards;
        body.appendChild(h('div.sub', `${def.tier[0].toUpperCase() + def.tier.slice(1)} — unlock with ${need} shards`));
        body.appendChild(h('div.sub', `🧩 ${cs.shards}/${need}`,
          checkUnlockCharacter(content, state, def.id).ok ? h('span.good', ' — ready!') : null));
      }
      card.appendChild(body);
      grid.appendChild(card);
    }
    if (!grid.firstChild) grid.appendChild(h('p.muted', 'No characters match these filters.'));
  };
  const changed = () => { store.save(); rerenderGrid(); };
  root.appendChild(characterFilterBar(store, preferences, changed, {
    search,
    onSearch: value => { search = value; rerenderGrid(); }
  }));
  root.appendChild(h('button.btn.tiny.clear-filters', {
    onclick: () => {
      Object.assign(preferences, {
        world: 'all', archetype: 'all', faction: 'all', ownership: 'all',
        sort: 'name', direction: 'asc'
      });
      store.save().then(() => {
        root.replaceChildren();
        renderRoster(store, root);
      });
    }
  }, 'Clear Filters'));
  root.appendChild(grid);
  rerenderGrid();
}
