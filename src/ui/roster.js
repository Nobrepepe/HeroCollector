// Roster (GDD 11.2): character cards with filters for world, archetype,
// faction, ownership, and ready-to-upgrade state.
import { h, fmt } from './dom.js';
import { characterPower } from '../core/power.js';
import { readyUpgrades, checkUnlockCharacter } from '../core/state.js';
import { portrait, starline, charSub } from './shared.js';

const filters = { world: 'all', archetype: 'all', owned: 'all' };

export function renderRoster(store, root) {
  const { content, state } = store;
  const ready = new Set(readyUpgrades(content, state).map(u => u.characterId));

  const bar = h('div.tab-bar');
  bar.appendChild(select('World', [['all', 'All worlds'], ...content.worlds.map(w => [w.id, w.displayName])], filters.world, v => { filters.world = v; rerender(); }));
  bar.appendChild(select('Archetype', [['all', 'All archetypes'], ...Object.entries(content.archetypes).map(([id, a]) => [id, a.name])], filters.archetype, v => { filters.archetype = v; rerender(); }));
  bar.appendChild(select('Ownership', [['all', 'Owned & unlockable'], ['owned', 'Owned'], ['unowned', 'Not yet owned'], ['ready', 'Ready to upgrade']], filters.owned, v => { filters.owned = v; rerender(); }));
  root.appendChild(bar);

  const grid = h('div.card-grid');
  root.appendChild(grid);

  function rerender() {
    grid.replaceChildren();
    for (const def of content.characters) {
      const cs = state.characters[def.id];
      if (filters.world !== 'all' && def.world !== filters.world) continue;
      if (filters.archetype !== 'all' && def.archetype !== filters.archetype) continue;
      if (filters.owned === 'owned' && !cs.owned) continue;
      if (filters.owned === 'unowned' && cs.owned) continue;
      if (filters.owned === 'ready' && !ready.has(def.id)) continue;

      const card = h('button.char-card' + (cs.owned ? '' : '.unowned'), {
        onclick: () => store.go(`#/character/${def.id}`)
      });
      card.appendChild(portrait(store, def.id, 'md'));
      const body = h('div');
      body.appendChild(h('div.name', def.displayName, ready.has(def.id) ? h('span.ready-dot', { title: 'Upgrade ready' }) : null));
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
  }
  rerender();
}

function select(label, options, value, onchange) {
  const sel = h('select', { 'aria-label': label, onchange: ev => onchange(ev.target.value) });
  for (const [v, text] of options) {
    sel.appendChild(h('option', { value: v, selected: v === value }, text));
  }
  return sel;
}
