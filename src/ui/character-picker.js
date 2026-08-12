import { h, fmt } from './dom.js';
import { characterPower, characterPowerForState } from '../core/power.js';
import { evaluateParty } from '../core/synergy.js';
import { portrait, starline } from './shared.js';
import { modalActions, modalDismiss, modalHead } from './modal.js';
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

export function openCharacterPicker(store, { partyIndex, slotIndex, onSelect, recommendedId = null }) {
  return openModal((modal, close) => {
    let search = '';
    const preferences = store.ui.pickerPreferences;
    const renderPicker = () => {
      modal.replaceChildren();
      const current = store.state.parties[partyIndex].members[slotIndex];
      modal.appendChild(modalHead(
        `${store.state.parties[partyIndex].name} · place ${slotIndex + 1} of ${store.content.balance.partySize}`,
        current ? 'Who stands here instead?' : 'Who stands here?',
        { size: 'm' }));
      modal.appendChild(characterFilterBar(store, preferences, renderPicker, {
        search, onSearch: value => { search = value; renderGrid(); }, ownership: false
      }));
      preferences.ownership = 'owned';
      const grid = h('div.picker-grid');
      if (current) {
        modal.appendChild(h('button.link.picker-clear', {
          onclick: async () => {
            await onSelect(null);
            close();
          }
        }, 'Leave this place open'));
      }
      modal.appendChild(grid);
      const renderGrid = () => {
        grid.replaceChildren();
        const party = store.state.parties[partyIndex];
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
          const recommended = def.id === recommendedId;
          const card = h('button.picker-card' + (recommended ? '.recommended' : ''), {
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
                  `Changed: ${changes.changed.map(item => store.content.tagById[item.id]?.displayName ?? item.id).join(', ')}`) : null,
                recommended ? h('div.good', 'Best one-swap improvement') : null)));
          grid.appendChild(card);
        }
      };
      renderGrid();
      modal.appendChild(modalActions(modalDismiss('Keep the party as it is', close)));
    };
    renderPicker();
  }, { size: 'wide' });
}

export function openCrisisCharacterPicker(store, { currentId = null, excludedIds = new Set(), favoredTagIds = [], onSelect }) {
  return openModal((modal, close) => {
    let search = '';
    const preferences = store.ui.pickerPreferences;
    preferences.ownership = 'owned';
    const paint = () => {
      modal.replaceChildren();
      const favored = favoredTagIds.map(id => tagLabel(store, id)).join(' and ');
      modal.appendChild(modalHead('Crisis Front', 'Who answers this Front?', {
        size: 'm',
        lead: favored
          ? `${favored} is favored here — a favored tag lifts the whole Front by 20%. No one may answer two Fronts.`
          : 'No tag is favored here. No one may answer two Fronts.'
      }));
      modal.appendChild(characterFilterBar(store, preferences, paint, {
        search, onSearch: value => { search = value; paint(); }, ownership: false
      }));
      if (currentId) modal.appendChild(h('button.link.picker-clear', { onclick: async () => { await onSelect(null); close(); } }, 'Leave this place open'));
      const grid = h('div.picker-grid');
      const candidates = filterCharacters(store.content, store.state, preferences, new Set(), search)
        .filter(def => store.state.characters[def.id].owned);
      for (const def of candidates) {
        const unavailable = excludedIds.has(def.id) && def.id !== currentId;
        const tags = new Set([def.world, def.archetype, def.faction, ...(def.extraTags ?? [])].filter(Boolean));
        const matches = favoredTagIds.filter(id => tags.has(id));
        grid.appendChild(h('button.picker-card', {
          disabled: unavailable,
          'aria-label': unavailable ? `${def.displayName}, already assigned to another Crisis Front` : `Assign ${def.displayName}`,
          onclick: async () => { await onSelect(def.id); close(); }
        }, portrait(store, def.id, 'sm'), h('div.grow', h('b', def.displayName),
          h('div.small.muted', `${store.content.worldById[def.world].displayName} · ${store.content.archetypes[def.archetype].name}`),
          h('div.numeral', `${fmt(characterPowerForState(store.content, store.state, def.id))} Power`),
          unavailable ? h('div.small.bad', 'Already answering another Front.')
            : h('div.small.good', matches.length ? `Favored here: ${matches.map(id => store.content.tagById[id]?.displayName ?? store.content.worldById[id]?.displayName ?? store.content.archetypes[id]?.name ?? id).join(', ')}` : 'No favored tag here.'))));
      }
      modal.append(grid, modalActions(modalDismiss('Return to the Front', close)));
    };
    paint();
  }, { size: 'wide', tone: 'crisis' });
}

function tagLabel(store, id) {
  return store.content.worldById[id]?.displayName
    ?? store.content.archetypes[id]?.name
    ?? store.content.tagById[id]?.displayName ?? id;
}

export function openExpeditionCharacterPicker(store, {
  currentId = null, selectedIds = [], slotIndex, onSelect
}) {
  return openModal((modal, close) => {
    let search = '';
    const preferences = store.ui.pickerPreferences;
    preferences.ownership = 'owned';
    const paint = () => {
      modal.replaceChildren();
      modal.appendChild(modalHead(`Expedition · place ${slotIndex + 1}`,
        currentId ? 'Who travels here instead?' : 'Who travels here?', {
          size: 'm',
          lead: 'Everyone sent stays usable everywhere else while they are gone.'
        }));
      modal.appendChild(characterFilterBar(store, preferences, paint, {
        search, onSearch: value => { search = value; paint(); }, ownership: false
      }));
      if (currentId) modal.appendChild(h('button.link.picker-clear', {
        onclick: async () => { await onSelect(null); close(); }
      }, 'Leave this place open'));
      const grid = h('div.picker-grid');
      const candidates = filterCharacters(store.content, store.state, preferences, new Set(), search)
        .filter(def => store.state.characters[def.id].owned);
      for (const def of candidates) {
        const away = characterExpeditionForPicker(store.state, def.id);
        const otherSlot = selectedIds.findIndex((id, index) => id === def.id && index !== slotIndex);
        const unavailable = !!away || otherSlot >= 0;
        const cs = store.state.characters[def.id];
        const reason = away ? `Away on ${away.name} until day ${away.returnDay}`
          : otherSlot >= 0 ? `Already in slot ${otherSlot + 1}` : null;
        grid.appendChild(h('button.picker-card', {
          disabled: unavailable,
          onclick: async () => { await onSelect(def.id); close(); },
          'aria-label': unavailable ? `${def.displayName}, ${reason}` : `Choose ${def.displayName}`
        }, portrait(store, def.id, 'sm'), h('div.grow',
          h('b', def.displayName),
          h('div.small.muted', `${store.content.worldById[def.world].displayName} · ${store.content.archetypes[def.archetype].name}`),
          h('div.small', starline(cs.stars), ` · Tier ${cs.gearTier}`),
          h('div.numeral', `${fmt(characterPowerForState(store.content, store.state, def.id))} Power`),
          reason ? h('div.small.warn', reason) : null)));
      }
      modal.append(grid, modalActions(modalDismiss('Return to the route', close)));
    };
    paint();
  }, { size: 'wide' });
}

function characterExpeditionForPicker(state, characterId) {
  return (state.expeditions?.active ?? []).find(item => item.party.includes(characterId)) ?? null;
}
