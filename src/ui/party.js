import { h, fmt, pct } from './dom.js';
import { evaluateParty } from '../core/synergy.js';
import {
  setPartyMember, renameParty, copyParty, clearParty, selectPartyPreset
} from '../core/state.js';
import { characterPower } from '../core/power.js';
import { portrait, starline } from './shared.js';
import { openModal } from '../app.js';
import { openCharacterPicker } from './character-picker.js';
import { bestPartySwap, partyHeadline } from './presentation.js';

export function renderParty(store, root) {
  const { content, state } = store;
  const idx = state.activePartyIndex;
  const party = state.parties[idx];
  const members = party.members.filter(Boolean);
  const evaluation = evaluateParty(content, state, members);
  const recommendation = bestPartySwap(content, state, party.members);

  root.classList.add('party-screen');
  const page = h('div.party-page');
  page.append(
    partyHeader(store, idx, party, evaluation, members.length, root),
    partyReading(store, evaluation, recommendation, idx, root),
    h('div.fade-rule.party-figure-rule'),
    partyFigures(store, party, recommendation, idx, root));
  root.appendChild(page);
}

function partyHeader(store, index, party, evaluation, memberCount, root) {
  const header = h('header.party-head',
    h('div.party-heading-copy',
      h('div.eyebrow', `Party · ${party.name}`),
      partyHeadlineElement(evaluation, memberCount)));
  const controls = h('div.party-preset-controls');
  const tabs = h('div.party-presets', { role: 'tablist', 'aria-label': 'Party presets' });
  store.state.parties.forEach((preset, presetIndex) => tabs.appendChild(h(
    'button.party-preset' + (presetIndex === index ? '.active' : ''),
    {
      role: 'tab',
      'aria-selected': presetIndex === index,
      onclick: () => store.tx(() => selectPartyPreset(store.state, presetIndex), { rerender: false })
        .then(() => rerenderParty(store, root))
    },
    preset.name)));
  controls.append(
    tabs,
    h('div.party-preset-actions',
      h('button', { onclick: () => renamePreset(store, index, root) }, 'Rename'),
      h('span', '·'),
      h('button', { onclick: () => copyPreset(store, index, root) }, 'Copy from…'),
      h('span', '·'),
      h('button.danger', { onclick: () => confirmClearPreset(store, index, root) }, 'Clear these five')));
  header.appendChild(controls);
  return header;
}

function partyHeadlineElement(evaluation, memberCount) {
  if (memberCount < 5) return h('h1.display-s', partyHeadline(evaluation, memberCount));
  return h('h1.display-s',
    'They are pulling ',
    h('span.good', `+${pct(evaluation.cappedBp)}`),
    evaluation.capped ? ' together — the cap is holding.' : ' together.');
}

function partyReading(store, evaluation, recommendation, partyIndex, root) {
  const synergyPower = evaluation.effectivePower - evaluation.rawPower;
  const reading = h('div.party-reading');
  reading.appendChild(h('section.party-power-thread',
    h('div.eyebrow', 'Effective power'),
    h('div.display-l', fmt(evaluation.effectivePower)),
    h('p.caption',
      `${fmt(evaluation.rawPower)} raw — ${fmt(synergyPower)} of it is how they fit.`)));

  const shared = h('section.party-shared', h('div.eyebrow', 'What they share'));
  if (evaluation.active.length) {
    const active = [...evaluation.active].sort(compareSynergies);
    active.slice(0, 3)
      .forEach((item, index) => shared.append(
        h('div.party-synergy', { style: { '--rule-end': `${[78, 61, 72, 84][index % 4]}%` } },
          h('span.numeral.good', `+${pct(item.bonusBp)}`),
          h('div', h('div.party-synergy-name', item.tag.displayName),
            h('div.caption', item.tag.explanation)))));
    shared.appendChild(h('button.party-codex-link', {
      onclick: () => openPartySynergies(active)
    }, 'See all'));
  } else {
    shared.appendChild(h('p.muted', 'No shared rhythm has taken hold yet.'));
  }
  reading.appendChild(shared);
  reading.appendChild(recommendationThread(store, recommendation, partyIndex, root));
  return reading;
}

function compareSynergies(a, b) {
  return b.bonusBp - a.bonusBp || a.tag.displayName.localeCompare(b.tag.displayName);
}

function openPartySynergies(active) {
  openModal((modal, close) => {
    modal.append(h('div.eyebrow', 'Current party'), h('h2', 'All active synergies'));
    const list = h('div.party-synergy-dialog');
    active.forEach((item, index) => list.appendChild(
      h('div.party-synergy', { style: { '--rule-end': `${[78, 61, 72, 84][index % 4]}%` } },
        h('span.numeral.good', `+${pct(item.bonusBp)}`),
        h('div', h('div.party-synergy-name', item.tag.displayName),
          h('div.caption', item.tag.explanation)))));
    modal.append(list, h('div.modal-actions', h('button.btn', { onclick: close }, 'Close')));
  });
}

function recommendationThread(store, recommendation, partyIndex, root) {
  const section = h('section.party-near-miss', h('div.eyebrow', 'One swap away'));
  if (recommendation.kind === 'empty') {
    section.append(
      h('p.party-swap-copy', h('i.party-swap-dot'), 'An empty place is the only thing holding this party back. Fill it and their shared power can be read.'),
      h('button.btn.primary.party-swap-action', {
        onclick: () => pickMember(store, partyIndex, recommendation.slotIndex, root)
      }, 'Choose someone →'));
    return section;
  }
  if (recommendation.kind === 'none') {
    section.appendChild(h('p.party-swap-copy',
      'No single change improves their effective power. These five are already the strongest fit available.'));
    return section;
  }
  const outgoing = store.content.characterById[recommendation.outgoingId];
  const incoming = store.content.characterById[recommendation.incomingId];
  const improved = recommendation.improved[0];
  const synergyText = improved
    ? `${improved.tag.displayName} becomes +${pct(improved.bonusBp)}`
    : `their individual strength raises the total`;
  section.append(
    h('p.party-swap-copy',
      h('i.party-swap-dot'),
      `Swap ${outgoing.displayName} for ${incoming.displayName}. ${synergyText} — about ${fmt(recommendation.effectiveGain)} more effective power.`),
    h('button.btn.primary.party-swap-action', {
      onclick: () => pickMember(store, partyIndex, recommendation.slotIndex, root, recommendation.incomingId)
    }, `Find ${incoming.displayName} →`));
  return section;
}

function partyFigures(store, party, recommendation, partyIndex, root) {
  const row = h('div.party-figures');
  party.members.forEach((memberId, slotIndex) => {
    const isOutgoing = recommendation.kind === 'swap' && recommendation.slotIndex === slotIndex;
    const button = h('button.party-figure' + (memberId ? '.filled' : '.empty'), {
      onclick: () => pickMember(store, partyIndex, slotIndex, root,
        isOutgoing ? recommendation.incomingId : null),
      'aria-label': memberId
        ? `Change ${store.content.characterById[memberId].displayName} in party slot ${slotIndex + 1}`
        : `Choose a character for empty party slot ${slotIndex + 1}`,
      style: { '--character-color': memberId ? store.content.characterById[memberId].color : 'var(--muted-2)' }
    });
    if (!memberId) {
      button.append(
        h('div.party-eye-tile.empty', h('span', '+')),
        h('div.party-figure-label', h('div.party-name', 'An open place'), h('div.caption', 'choose someone')));
      row.appendChild(button);
      return;
    }
    const def = store.content.characterById[memberId];
    const cs = store.state.characters[memberId];
    button.append(
      h('div.party-eye-tile', portrait(store, memberId, 'party', { decorative: true })),
      h('div.party-figure-label',
        h('div.eyebrow', store.content.archetypes[def.archetype].name),
        h('div.party-name', def.displayName),
        starline(cs.stars),
        h('div.party-member-power', `${fmt(characterPower(store.content, cs))} power`),
        isOutgoing ? h('div.caption', swapReason(store, recommendation)) : null));
    row.appendChild(button);
  });
  return row;
}

function swapReason(store, recommendation) {
  const improved = recommendation.improved[0];
  if (!improved) return `${fmt(recommendation.effectiveGain)} power is waiting`;
  const def = store.content.characterById[recommendation.outgoingId];
  if (improved.tag.activationRule === 'same_world_count') {
    const incoming = store.content.characterById[recommendation.incomingId];
    return def.world === incoming.world ? `the weaker ${store.content.worldById[def.world].displayName} fit` : `not from ${store.content.worldById[incoming.world].displayName}`;
  }
  return `the change that opens ${improved.tag.displayName}`;
}

function rerenderParty(store, root) {
  root.replaceChildren();
  root.className = '';
  renderParty(store, root);
}

function pickMember(store, partyIndex, slotIndex, root, recommendedId = null) {
  openCharacterPicker(store, {
    partyIndex,
    slotIndex,
    recommendedId,
    onSelect: async characterId => {
      await store.tx(
        () => setPartyMember(store.content, store.state, partyIndex, slotIndex, characterId),
        { rerender: false });
      rerenderParty(store, root);
    }
  });
}

function renamePreset(store, index, root) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', 'Rename this party'));
    const input = h('input', {
      type: 'text', value: store.state.parties[index].name,
      'aria-label': 'Preset name', maxlength: 30
    });
    modal.append(input, h('div.modal-actions',
      h('button.btn.primary', {
        onclick: async () => {
          const result = await store.tx(() => renameParty(store.state, index, input.value), { rerender: false });
          if (result.ok !== false) { close(); rerenderParty(store, root); }
        }
      }, 'Keep this name →'),
      h('button.btn', { onclick: close }, 'Cancel')));
  });
}

function copyPreset(store, targetIndex, root) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', 'Copy party members from…'));
    const select = h('select', { 'aria-label': 'Source preset' });
    store.state.parties.forEach((party, index) => {
      if (index !== targetIndex) select.appendChild(h('option', { value: String(index) }, party.name));
    });
    modal.append(select, h('div.modal-actions',
      h('button.btn.primary', {
        onclick: async () => {
          await store.tx(() => copyParty(store.state, targetIndex, Number(select.value)), { rerender: false });
          close(); rerenderParty(store, root);
        }
      }, 'Copy members →'),
      h('button.btn', { onclick: close }, 'Cancel')));
  });
}

function confirmClearPreset(store, index, root) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', `Clear ${store.state.parties[index].name}?`));
    modal.appendChild(h('p.warn', 'All five places in this preset will be emptied.'));
    modal.appendChild(h('div.modal-actions',
      h('button.btn.danger', {
        onclick: async () => {
          await store.tx(() => clearParty(store.state, index), { rerender: false });
          close(); rerenderParty(store, root);
        }
      }, 'Clear these five'),
      h('button.btn', { onclick: close }, 'Cancel')));
  });
}
