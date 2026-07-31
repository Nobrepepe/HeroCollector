import { h, fmt } from './dom.js';
import { portrait } from './shared.js';
import { openCrisisCharacterPicker } from './character-picker.js';
import {
  claimCrisisCache, crisisCacheChoiceStatus, previewCrisis, previewCrisisFront,
  resolveCrisis, setCrisisAssignment
} from '../core/crises.js';

export function renderCrisis(store, root) {
  root.classList.add('crisis-screen');
  const active = store.state.crises?.active;
  if (!active) {
    root.appendChild(h('div.crisis-empty', h('div.eyebrow', 'Crisis Response'),
      h('h1.display-m', 'The grounds are quiet again.'),
      h('p', 'No Crisis is asking for an answer today. Nothing was lost by letting the moment pass.'),
      h('button.btn.primary', { onclick: () => store.go('#/home') }, 'Return to today →')));
    return;
  }
  const world = store.content.worldById[active.worldId];
  const image = store.content.images.crisis?.[active.definitionId] ?? store.content.images.world[active.worldId];
  const page = h('div.crisis-page');
  page.appendChild(h('div.crisis-backdrop' + (image ? '' : '.art-fallback'), {
    style: image ? { backgroundImage: `url("${image}")` } : {}, 'aria-hidden': 'true'
  }));
  page.appendChild(h('button.link.crisis-leave', { onclick: () => store.go('#/home') }, '← Leave it for later'));
  const body = h('div.crisis-body');
  page.appendChild(body); root.appendChild(page);
  if (active.status === 'planning') renderPlanning(store, body, active, world);
  else renderResolution(store, body, active, world);
}

function renderPlanning(store, root, active, world) {
  store.ui.crisisFrontId = active.frontIds.includes(store.ui.crisisFrontId) ? store.ui.crisisFrontId : active.frontIds[0];
  const front = active.fronts.find(item => item.id === store.ui.crisisFrontId);
  const reading = previewCrisisFront(store.content, store.state, front, active.assignments[front.id]);
  const index = active.frontIds.indexOf(front.id);
  root.appendChild(h('header.crisis-head', h('div.eyebrow', `${active.gradeName} · ${world.displayName}`),
    h('h1.display-m', `${active.name} needs ${active.fronts.length} answers.`), h('p', active.openingDescription)));
  root.appendChild(frontPath(store, active, front.id));
  root.appendChild(h('section.crisis-front',
    h('div.crisis-front-copy', h('div.eyebrow', `Front ${index + 1} · ${front.name}`),
      h('h2.title', front.description),
      h('p.caption', `Favored here: ${front.favoredTagIds.map(id => tagName(store, id)).join(' and ')}.`)),
    h('div.crisis-reading', h('div.eyebrow', 'Effective Power'),
      h(`div.display-l.${reading.projection === 'struggle' ? 'bad' : 'good'}`, fmt(reading.effectivePower)),
      h('p', verdict(reading)),
      h('p.caption', `${fmt(reading.basePower)} base Power · ${reading.matchedFavoredTagCount * 20}% favored-tag contribution · ${fmt(reading.recommendedPower)} recommended`))));
  const excluded = new Set(Object.entries(active.assignments).filter(([id]) => id !== front.id).flatMap(([, ids]) => ids).filter(Boolean));
  const slots = h('section.crisis-team', h('div.eyebrow', `Choose exactly ${active.teamSize}`));
  const row = h('div.crisis-team-row');
  active.assignments[front.id].forEach((id, slotIndex) => row.appendChild(h('button.crisis-slot', {
    'aria-label': id ? `Replace ${store.content.characterById[id].displayName} on ${front.name}` : `Fill slot ${slotIndex + 1} on ${front.name}`,
    onclick: () => openCrisisCharacterPicker(store, {
      currentId: id, excludedIds: excluded, favoredTagIds: front.favoredTagIds,
      onSelect: selected => store.tx(() => setCrisisAssignment(store.content, store.state, front.id, slotIndex, selected))
    })
  }, id ? portrait(store, id, 'md') : h('span.portrait-slot.md.empty', h('span', '+')),
  h('span', id ? store.content.characterById[id].displayName : 'Choose someone'),
  id ? h('span.caption', `${fmt(store.state.characters[id].stars)}★`) : h('span.caption', 'Open place'))));
  slots.appendChild(row); root.appendChild(slots);
  const allFull = Object.values(active.assignments).every(ids => ids.every(Boolean));
  const actions = h('div.crisis-actions');
  if (index < active.fronts.length - 1) actions.appendChild(h('button.btn.primary', {
    onclick: () => { store.ui.crisisFrontId = active.frontIds[index + 1]; store.go('#/crisis', { preserveReturnContext: true }); renderCrisisRoute(store); }
  }, 'Next Front →'));
  else actions.appendChild(h('button.btn.primary', { disabled: !allFull,
    onclick: async () => { await store.tx(() => resolveCrisis(store.content, store.state)); }
  }, 'Commit the response →'));
  actions.appendChild(h('button.link', { onclick: () => { store.ui.crisisFrontId = active.frontIds[Math.max(0, index - 1)]; renderCrisisRoute(store); }, disabled: index === 0 }, 'Previous Front'));
  if (!allFull && index === active.fronts.length - 1) actions.appendChild(h('p.bad', 'Every Front needs its exact team before the response can be committed.'));
  root.appendChild(actions);
}

function renderCrisisRoute(store) {
  const root = document.getElementById('screen');
  root.replaceChildren();
  renderCrisis(store, root);
}

function frontPath(store, active, selectedId) {
  return h('nav.crisis-path', { 'aria-label': 'Crisis Fronts' }, active.fronts.map((front, index) => {
    const assigned = active.assignments[front.id].filter(Boolean).length;
    return h('button.crisis-station' + (front.id === selectedId ? '.current' : assigned === active.teamSize ? '.done' : ''), {
      onclick: () => { store.ui.crisisFrontId = front.id; renderCrisisRoute(store); }
    }, h('i'), h('span', front.name), h('small', `${assigned} of ${active.teamSize} assigned`));
  }));
}

function renderResolution(store, root, active, world) {
  const projection = previewCrisis(store.content, store.state);
  const outcome = active.result.outcome;
  const headline = outcome === 'mastered' ? `${world.displayName} has room to breathe.`
    : outcome === 'resolved' ? 'The worst of it has passed.' : 'The response endured, and nothing was lost.';
  root.appendChild(h('header.crisis-head', h('div.eyebrow', `${active.gradeName} · ${active.name}`),
    h('h1.display-m', headline), h('p', outcome === 'endured'
      ? 'The stronger opportunity passed, but the Crisis took no Energy, resources, buildings, or progress with it.'
      : `${active.result.completed} Fronts were secured. The Emergency Cache is waiting for one choice.`)));
  const path = h('div.crisis-result-path');
  active.result.fronts.forEach(result => {
    const front = active.fronts.find(item => item.id === result.frontId);
    const text = result.projection === 'excel' ? front.excelText : result.projection === 'succeed' ? front.successText : front.struggleText;
    path.appendChild(h(`div.crisis-result.${result.projection}`, h('i'), h('div', h('div.title', front.name), h('p', text),
      h('span.caption', `${fmt(result.effectivePower)} effective Power`))));
  });
  root.appendChild(path);
  if (outcome !== 'endured' && !active.cacheClaimed) {
    const choices = h('section.crisis-cache', h('div.eyebrow', 'Emergency Cache · choose one'));
    active.cacheChoices.forEach(choice => {
      const status = crisisCacheChoiceStatus(store.content, store.state, choice);
      choices.appendChild(h('button.crisis-cache-choice', { disabled: !status.available,
        onclick: () => store.tx(() => claimCrisisCache(store.content, store.state, choice.id)) },
      h('span.title', choice.name), h('span', choice.description),
      h('span.caption', status.available ? rewardText(store, choice.rewards) : status.reason)));
    });
    root.appendChild(choices);
  } else {
    const boon = outcome === 'mastered' && active.boon ? active.boon.prose : null;
    root.appendChild(h('section.crisis-complete', h('div.eyebrow', active.cacheClaimed ? 'Cache claimed' : 'Response complete'),
      h('p', active.cacheClaimed ? `You chose ${active.cacheChoices.find(choice => choice.id === active.result.cacheChoiceId)?.name}.` : 'The consolation return has been added.'),
      boon ? h('p.good', boon) : null,
      h('button.btn.primary', { onclick: () => store.go('#/home') }, 'Return to today →')));
  }
}

function verdict(reading) {
  if (reading.projection === 'struggle') return `Short by ${fmt(reading.recommendedPower - reading.effectivePower)}. This Front will struggle, but committing still costs nothing and removes nothing.`;
  if (reading.projection === 'excel') return `${fmt(reading.effectivePower - reading.recommendedPower)} to spare — this Front will excel.`;
  return `${fmt(reading.effectivePower - reading.recommendedPower)} to spare — this Front will succeed.`;
}

function tagName(store, id) {
  return store.content.worldById[id]?.displayName ?? store.content.archetypes[id]?.name ?? store.content.tagById[id]?.displayName ?? id;
}

function rewardText(store, entries) {
  return entries.map(entry => `${entry.qty} ${entry.kind === 'material' ? store.content.materialById[entry.id]?.displayName
    : entry.id === '@associated_world_asset' ? store.content.worldById[store.state.crises.active.worldId].worldAsset.displayName
      : store.content.resourceById[entry.id]?.displayName}`).join(' · ');
}
