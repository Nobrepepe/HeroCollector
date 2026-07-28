import { h, fmt } from './dom.js';
import { characterPower } from '../core/power.js';
import { evaluateParty } from '../core/synergy.js';
import { portrait, starline } from './shared.js';
import { openModal } from '../app.js';

export function filterCharacters(content, state, preferences, readySet, search = '') {
  const query = search.trim().toLocaleLowerCase();
  const rows = content.characters.filter(def => {
    const cs = state.characters[def.id];
    if (query && !def.displayName.toLocaleLowerCase().includes(query)) return false;
    if (preferences.world !== 'all' && def.world !== preferences.world) return false;
    if (preferences.archetype !== 'all' && def.archetype !== preferences.archetype) return false;
    if (preferences.faction !== 'all' && def.faction !== preferences.faction) return false;
    if (preferences.ownership === 'owned' && !cs.owned) return false;
    if (preferences.ownership === 'unowned' && cs.owned) return false;
    if (preferences.ownership === 'ready' && !readySet.has(def.id)) return false;
    return true;
  });
  const direction = preferences.direction === 'desc' ? -1 : 1;
  const compare = (a, b) => {
    const as = state.characters[a.id], bs = state.characters[b.id];
    let value = 0;
    if (preferences.sort === 'name') value = a.displayName.localeCompare(b.displayName);
    if (preferences.sort === 'power') value = characterPower(content, as) - characterPower(content, bs);
    if (preferences.sort === 'stars') value = as.stars - bs.stars;
    if (preferences.sort === 'gearTier') value = as.gearTier - bs.gearTier;
    if (preferences.sort === 'ready') value = Number(readySet.has(a.id)) - Number(readySet.has(b.id));
    return value * direction || a.displayName.localeCompare(b.displayName);
  };
  return rows.sort(compare);
}

function select(label, options, value, onchange) {
  const input = h('select', { 'aria-label': label, onchange: event => onchange(event.target.value) });
  for (const [id, text] of options) input.appendChild(h('option', { value: id, selected: id === value }, text));
  return input;
}

export function characterFilterBar(store, preferences, onChange, {
  search = '', onSearch, ownership = true
} = {}) {
  const { content } = store;
  const bar = h('div.character-filters');
  if (onSearch) {
    const input = h('input.character-search', {
      type: 'search', value: search, placeholder: 'Search by name…', 'aria-label': 'Search characters'
    });
    input.addEventListener('input', () => onSearch(input.value));
    bar.appendChild(input);
    store.registerSearchInput(input);
  }
  const set = key => value => { preferences[key] = value; onChange(); };
  bar.append(
    select('World', [['all', 'All worlds'], ...content.worlds.map(w => [w.id, w.displayName])], preferences.world, set('world')),
    select('Archetype', [['all', 'All archetypes'], ...Object.entries(content.archetypes).map(([id, a]) => [id, a.name])], preferences.archetype, set('archetype')));
  const factions = content.tags.filter(t => t.category === 'faction');
  if (factions.length) bar.appendChild(select('Faction',
    [['all', 'All factions'], ...factions.map(f => [f.id, f.displayName])], preferences.faction, set('faction')));
  if (ownership) bar.appendChild(select('Ownership',
    [['all', 'All ownership'], ['owned', 'Owned'], ['unowned', 'Not owned'], ['ready', 'Upgrade ready']],
    preferences.ownership, set('ownership')));
  bar.append(
    select('Sort', [['name', 'Name'], ['power', 'Power'], ['stars', 'Stars'], ['gearTier', 'Gear Tier'], ['ready', 'Upgrade Ready']],
      preferences.sort, set('sort')),
    select('Direction', [['asc', 'Ascending'], ['desc', 'Descending']], preferences.direction, set('direction')));
  return bar;
}

function synergyChanges(before, after) {
  const b = new Map(before.active.map(item => [item.tag.id, item.bonusBp]));
  const a = new Map(after.active.map(item => [item.tag.id, item.bonusBp]));
  const activated = [], lost = [], changed = [];
  for (const [id, bp] of a) {
    if (!b.has(id)) activated.push({ id, bp });
    else if (b.get(id) !== bp) changed.push({ id, before: b.get(id), after: bp });
  }
  for (const [id, bp] of b) if (!a.has(id)) lost.push({ id, bp });
  return { activated, lost, changed };
}

export function openCharacterPicker(store, { partyIndex, slotIndex, onSelect }) {
  return openModal((modal, close) => {
    let search = '';
    const preferences = store.ui.pickerPreferences;
    const renderPicker = () => {
      modal.replaceChildren();
      modal.appendChild(h('h2', 'Choose a character'));
      modal.appendChild(characterFilterBar(store, preferences, renderPicker, {
        search, onSearch: value => { search = value; renderGrid(); }, ownership: false
      }));
      preferences.ownership = 'owned';
      const grid = h('div.picker-grid');
      modal.appendChild(grid);
      const renderGrid = () => {
        grid.replaceChildren();
        const party = store.state.parties[partyIndex];
        const current = party.members[slotIndex];
        const beforeMembers = party.members.filter(Boolean);
        const before = evaluateParty(store.content, store.state, beforeMembers);
        const candidates = filterCharacters(store.content, store.state, preferences, new Set(), search)
          .filter(def => store.state.characters[def.id].owned);
        for (const def of candidates) {
          const cs = store.state.characters[def.id];
          const otherSlot = party.members.findIndex((id, index) => id === def.id && index !== slotIndex);
          const unavailable = otherSlot >= 0;
          const nextSlots = [...party.members];
          nextSlots[slotIndex] = def.id;
          const after = evaluateParty(store.content, store.state, nextSlots.filter(Boolean));
          const changes = synergyChanges(before, after);
          const card = h('button.picker-card', {
            disabled: unavailable,
            onclick: async () => {
              await onSelect(def.id);
              close();
            },
            'aria-label': unavailable
              ? `${def.displayName}, already in party slot ${otherSlot + 1}`
              : `Choose ${def.displayName}`
          });
          card.appendChild(portrait(store, def.id, 'sm'));
          card.appendChild(h('div.grow',
            h('b', def.displayName),
            h('div.small.muted',
              `${store.content.archetypes[def.archetype].name} · ${store.content.worldById[def.world].displayName}`),
            h('div.small', starline(cs.stars), ` · Tier ${cs.gearTier} · ${fmt(characterPower(store.content, cs))} Power`),
            unavailable ? h('div.small.warn', `Already in slot ${otherSlot + 1}`)
              : h('div.picker-preview.small',
                `Raw ${after.rawPower - before.rawPower >= 0 ? '+' : ''}${fmt(after.rawPower - before.rawPower)} · Effective ${fmt(before.effectivePower)} → ${fmt(after.effectivePower)}`,
                changes.activated.length ? h('div.good',
                  `Activated: ${changes.activated.map(item => store.content.tagById[item.id]?.displayName ?? item.id).join(', ')}`) : null,
                changes.lost.length ? h('div.warn',
                  `Lost: ${changes.lost.map(item => store.content.tagById[item.id]?.displayName ?? item.id).join(', ')}`) : null,
                changes.changed.length ? h('div',
                  `Changed: ${changes.changed.map(item => store.content.tagById[item.id]?.displayName ?? item.id).join(', ')}`) : null)));
          grid.appendChild(card);
        }
      };
      renderGrid();
      modal.appendChild(h('div.modal-actions', h('button.btn', { onclick: close }, 'Cancel')));
    };
    renderPicker();
  });
}
