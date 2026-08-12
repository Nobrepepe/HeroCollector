import { h, fmt } from './dom.js';
import { portrait, rewardNodes } from './shared.js';
import { countWord, ordinalWord } from './presentation.js';
import { openCrisisCharacterPicker } from './character-picker.js';
import {
  characterCrisisTags, claimCrisisCache, crisisCacheChoiceStatus,
  previewCrisisFront, resolveCrisis, setCrisisAssignment
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
  if (!image) page.appendChild(h('div.crisis-art-slot', { 'aria-hidden': 'true' }, 'crisis key art — 1280 × 720'));
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
  const last = index === active.fronts.length - 1;

  root.appendChild(h('header.crisis-head',
    h('div.eyebrow.crisis-eyebrow', `${active.gradeName} · ${world.displayName}`),
    h('h1.crisis-headline', `${active.name} needs ${countWord(active.fronts.length)} answers.`),
    h('p.crisis-flavour', active.openingDescription,
      ' Nothing is lost by refusing — nothing is spent by answering.')));

  root.appendChild(h('div.fade-rule.crisis-rule'));
  root.appendChild(frontPath(store, active, front.id));

  root.appendChild(h('section.crisis-front',
    h('div.crisis-front-copy',
      h('div.eyebrow', `Front ${index + 1} · ${front.name}`),
      h('h2.crisis-situation', front.description),
      h('p.crisis-favored', 'Favored here: ',
        ...favoredNames(store, front.favoredTagIds))),
    h('div.crisis-reading', h('div.eyebrow', 'Effective Power'),
      h(`div.display-reading.${reading.projection === 'struggle' ? 'bad' : 'good'}`, fmt(reading.effectivePower)),
      h('p.crisis-verdict', verdict(reading)),
      h('p.caption.crisis-arithmetic',
        `${fmt(reading.basePower)} base · ${reading.matchedFavoredTagCount
          ? `+${reading.matchedFavoredTagCount * 20}% for ${countWord(reading.matchedFavoredTagCount)} favored tag${reading.matchedFavoredTagCount === 1 ? '' : 's'}`
          : 'no favored tag yet'} · ${fmt(reading.recommendedPower)} recommended`))));

  root.appendChild(h('div.fade-rule.crisis-rule'));
  const excluded = new Set(Object.entries(active.assignments)
    .filter(([id]) => id !== front.id).flatMap(([, ids]) => ids).filter(Boolean));
  const slots = h('section.crisis-team',
    h('div.eyebrow', `Choose exactly ${countWord(active.teamSize)} · no one may answer two Fronts`));
  const row = h('div.crisis-team-row');
  active.assignments[front.id].forEach((id, slotIndex) => {
    const button = h('button.crisis-slot' + (id ? '.filled' : '.empty'), {
      'aria-label': id
        ? `Replace ${store.content.characterById[id].displayName} on ${front.name}`
        : `Fill slot ${slotIndex + 1} on ${front.name}`,
      onclick: () => openCrisisCharacterPicker(store, {
        currentId: id, excludedIds: excluded, favoredTagIds: front.favoredTagIds,
        onSelect: selected => store.tx(() => setCrisisAssignment(store.content, store.state, front.id, slotIndex, selected))
      })
    });
    if (id) {
      const matched = front.favoredTagIds.filter(tagId => characterCrisisTags(store.content, id).has(tagId));
      button.append(portrait(store, id, 'crisis', { decorative: true }),
        h('span.crisis-slot-name', store.content.characterById[id].displayName));
      button.appendChild(matched.length
        ? h('span.crisis-slot-note.is-favored', `favored · ${tagName(store, matched[0])}`)
        : h('span.crisis-slot-note', `${store.state.characters[id].stars}★ · no favored tag`));
    } else {
      button.append(h('span.crisis-slot-empty', '+'), h('span.crisis-slot-name.is-open', 'Open place'));
      const hint = emptyHint(store, front, active.assignments[front.id]);
      if (hint) button.appendChild(h('span.crisis-slot-note.is-hint', hint));
    }
    row.appendChild(button);
  });
  slots.appendChild(row);
  root.appendChild(slots);

  const allFull = Object.values(active.assignments).every(ids => ids.every(Boolean));
  const actions = h('div.crisis-actions');
  const commit = h('div.crisis-commit' + (last && !allFull ? '.is-unavailable' : ''));
  commit.appendChild(h('button.crisis-commit-link', {
    disabled: last && !allFull,
    onclick: () => {
      if (!last) {
        store.ui.crisisFrontId = active.frontIds[index + 1];
        renderCrisisRoute(store);
        return;
      }
      store.tx(() => resolveCrisis(store.content, store.state));
    }
  }, last ? 'Commit the response →' : 'Next Front →'));
  commit.appendChild(h('div.crisis-commit-rule', { 'aria-hidden': 'true' }));
  commit.appendChild(h('div.crisis-commit-note', last
    ? allFull
      ? 'Every Front has its team · committing costs nothing and removes nothing'
      : 'Every Front needs its exact team before the response can be committed'
    : index > 0
      ? `Previous Front · the response commits on the ${ordinalWord(active.fronts.length)}`
      : `The response commits on the ${ordinalWord(active.fronts.length)} Front`));
  actions.appendChild(commit);
  if (index > 0) actions.appendChild(h('button.link.crisis-previous', {
    onclick: () => { store.ui.crisisFrontId = active.frontIds[index - 1]; renderCrisisRoute(store); }
  }, '← Previous Front'));
  root.appendChild(actions);
}

// What would lift this Front: a favored tag not yet represented.
function emptyHint(store, front, assigned) {
  const present = new Set(assigned.filter(Boolean)
    .flatMap(id => [...characterCrisisTags(store.content, id)]));
  const missing = front.favoredTagIds.find(tagId => !present.has(tagId));
  if (!missing) return null;
  const name = tagName(store, missing);
  return store.content.worldById[missing]
    ? `someone from ${name} lifts this Front`
    : `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} lifts this Front`;
}

function favoredNames(store, tagIds) {
  const nodes = [];
  tagIds.forEach((id, index) => {
    if (index > 0) nodes.push(index === tagIds.length - 1 ? ' and ' : ', ');
    nodes.push(h('span.crisis-tag', tagName(store, id)));
  });
  nodes.push('.');
  return nodes;
}

function renderCrisisRoute(store) {
  const root = document.getElementById('screen');
  root.replaceChildren();
  renderCrisis(store, root);
}

function frontPath(store, active, selectedId) {
  return h('nav.crisis-path', { 'aria-label': 'Crisis Fronts' }, active.fronts.map(front => {
    const assigned = active.assignments[front.id].filter(Boolean).length;
    const state = front.id === selectedId ? 'current' : assigned === active.teamSize ? 'done' : 'open';
    return h(`button.crisis-station.is-${state}`, {
      onclick: () => { store.ui.crisisFrontId = front.id; renderCrisisRoute(store); },
      'aria-current': front.id === selectedId ? 'step' : null
    },
    h('span.crisis-station-line', h('i'), h('span.crisis-station-connector')),
    h('span.crisis-station-name', front.name),
    h('small.crisis-station-count', `${assigned} of ${active.teamSize} assigned`));
  }));
}

function renderResolution(store, root, active, world) {
  const outcome = active.result.outcome;
  const headline = outcome === 'mastered' ? `${world.displayName} has room to breathe.`
    : outcome === 'resolved' ? 'The worst of it has passed.' : 'The response endured, and nothing was lost.';
  root.appendChild(h('header.crisis-head',
    h('div.eyebrow.crisis-eyebrow', `${active.gradeName} · ${active.name}`),
    h('h1.crisis-headline', headline),
    h('p.crisis-flavour', outcome === 'endured'
      ? 'The stronger opportunity passed, but the Crisis took no Energy, resources, buildings, or progress with it.'
      : `${countWord(active.result.completed, { capitalize: true })} Front${active.result.completed === 1 ? ' was' : 's were'} secured. The Emergency Cache is waiting for one choice.`)));

  const lower = h('div.crisis-result-layout');
  const path = h('div.crisis-result-path');
  active.result.fronts.forEach(result => {
    const front = active.fronts.find(item => item.id === result.frontId);
    const text = result.projection === 'excel' ? front.excelText
      : result.projection === 'succeed' ? front.successText : front.struggleText;
    const word = result.projection === 'excel' ? 'excelled'
      : result.projection === 'succeed' ? 'succeeded' : 'held on';
    path.appendChild(h(`div.crisis-result.${result.projection}`,
      h('i', { 'aria-hidden': 'true' }),
      h('div.grow',
        h('div.crisis-result-top',
          h('div.crisis-result-name', front.name),
          h('div.crisis-result-word', word)),
        h('p.crisis-result-copy', text),
        h('p.caption', `${fmt(result.effectivePower)} effective Power`))));
  });
  if (outcome === 'mastered' && active.boon?.prose) {
    path.appendChild(h('p.crisis-boon',
      h('span.crisis-boon-dot', { 'aria-hidden': 'true' }),
      h('span', active.boon.prose)));
  }
  lower.appendChild(path);

  if (outcome !== 'endured' && !active.cacheClaimed) {
    const recommended = active.cacheChoices.find(choice =>
      crisisCacheChoiceStatus(store.content, store.state, choice).available);
    const choices = h('section.crisis-cache', h('div.eyebrow', 'Emergency Cache · choose one'));
    active.cacheChoices.forEach(choice => {
      const status = crisisCacheChoiceStatus(store.content, store.state, choice);
      const classes = ['crisis-cache-choice'];
      if (!status.available) classes.push('is-unavailable');
      else if (choice.id === recommended?.id) classes.push('is-recommended');
      const block = h(`button.${classes.join('.')}`, {
        disabled: !status.available,
        onclick: () => store.tx(() => claimCrisisCache(store.content, store.state, choice.id))
      },
      h('span.crisis-cache-name', choice.name),
      h('span.crisis-cache-copy', choice.description));
      block.appendChild(status.available
        ? h('span.crisis-cache-rewards', ...rewardNodes(store.content, choice.rewards, { worldId: active.worldId }))
        : h('span.crisis-cache-why', status.reason));
      choices.appendChild(block);
    });
    choices.appendChild(h('p.caption.crisis-cache-note', 'The Cache waits until it is claimed. Nothing here expires at the reset.'));
    lower.appendChild(choices);
  } else {
    lower.appendChild(h('section.crisis-complete',
      h('div.eyebrow', active.cacheClaimed ? 'Cache claimed' : 'Response complete'),
      h('p', active.cacheClaimed
        ? `You chose ${active.cacheChoices.find(choice => choice.id === active.result.cacheChoiceId)?.name}.`
        : 'The consolation return has been added. Nothing else was asked for and nothing was taken.'),
      h('button.btn.primary', { onclick: () => store.go('#/home') }, 'Return to today →')));
  }
  root.appendChild(lower);
}

function verdict(reading) {
  if (reading.projection === 'struggle') {
    return `Short by ${fmt(reading.recommendedPower - reading.effectivePower)}. This Front will struggle, and committing still costs nothing and removes nothing.`;
  }
  const spare = fmt(reading.effectivePower - reading.recommendedPower);
  if (reading.projection === 'excel') return `${spare} to spare — this Front will excel.`;
  return `${spare} to spare — this Front will succeed.${reading.matchedFavoredTagCount < 2 ? ' One more favored tag would carry it to excel.' : ''}`;
}

function tagName(store, id) {
  return store.content.worldById[id]?.displayName ?? store.content.archetypes[id]?.name ?? store.content.tagById[id]?.displayName ?? id;
}
