import { h, fmt } from './dom.js';
import {
  readyUpgrades, nodeState, nodeUnlocked, completeGearTier, promoteStar,
  unlockCharacter, movePin, removePin
} from '../core/state.js';
import { analyzePinnedGoals } from '../core/progression.js';
import { portrait, portraitSlot, campaignLabel } from './shared.js';
import { openFindSources } from './find-sources.js';
import { craftEquipmentWithConfirmation, openGearDialog } from './gear.js';
import {
  campaignFrontiers, crisisNotice, sceneImage, selectedPartyPower, countWord
} from './presentation.js';
import {
  focusStatus, focusYield, assignFocus, clearFocusSlot, isRevealed
} from '../core/focus.js';
import { openModal, render } from '../app.js';
import { dressModal, modalHead, modalActions, modalDismiss } from './modal.js';

// Today is a screen about one scarce thing. Energy is the only resource the day
// hands out and takes back, and the Focus is not a panel beside it — it is a
// property of spending it. So the headline states what today's Energy buys, and
// the Focus is one rail underneath showing where the next shards land. Nothing
// here states a distance to a shard total: shards are a rate now, and a rate is
// stated as a rate. Star counts live in Tracking, where the player pinned them.
export function renderHome(store, root) {
  const { content, state } = store;
  const ready = readyUpgrades(content, state);
  const frontiers = campaignFrontiers(content, state, nodeState, nodeUnlocked);
  const frontier = frontiers[0] ?? null;
  const scene = sceneImage(store, frontier);

  const page = h('div.today-page');
  // The scene is the ground now rather than a thumbnail: there is no featured
  // hero, because no one hero is what today is about.
  page.appendChild(h('div.today-backdrop' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}
  }));

  const recent = h('div.today-recent', h('div.eyebrow', 'Recent progress'));
  const entries = state.progressLog.slice(0, 3);
  recent.append(...(entries.length
    ? entries.map(entry => h('div.caption', entry.text))
    : [h('div.caption', 'Your next milestone will appear here.')]));
  const notice = crisisNotice(state);
  if (notice) recent.appendChild(h('p.today-notice',
    h('span', notice.text, ' ',
      h('button.link', { onclick: () => store.go('#/crisis') }, notice.verb)),
    h('span.today-notice-dot', { 'aria-hidden': 'true' })));
  page.appendChild(recent);

  const contentCol = h('div.today-content',
    h('div.eyebrow',
      `${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(store.now())} · day ${state.dayNumber}`),
    h('h1.display-m', energyHeadline(store)),
    energySentence(store));

  contentCol.appendChild(energyRail(store));
  contentCol.appendChild(h('div.fade-rule'));
  contentCol.appendChild(continueThread(store, frontier));
  contentCol.appendChild(h('div.fade-rule'));
  contentCol.appendChild(readyThread(store, ready));
  contentCol.appendChild(h('div.fade-rule'));
  contentCol.appendChild(trackingThread(store));
  page.appendChild(contentCol);
  root.appendChild(page);
}

// The three slots, read once: who is live, who is stalled, and what a figure of
// Energy would return across all of them.
function focusReading(store, energy) {
  const { content, state } = store;
  const paid = new Map(focusYield(content, state, energy).map(entry => [entry.slot, entry]));
  const slots = focusStatus(content, state).map(entry => ({
    ...entry,
    def: entry.characterId ? content.characterById[entry.characterId] : null,
    shards: paid.get(entry.slot).shards
  }));
  return {
    slots,
    live: slots.filter(entry => entry.characterId && !entry.halted),
    stalled: slots.filter(entry => entry.characterId && entry.halted),
    shards: slots.reduce((sum, entry) => sum + entry.shards, 0)
  };
}

function energyHeadline(store) {
  const energy = store.state.energy;
  const { live } = focusReading(store, energy);
  if (energy <= 0) return 'The day’s Energy is spent.';
  const count = countWord(energy, { capitalize: true });
  return live.length
    ? `${count} Energy left, and all of it is promised.`
    : `${count} Energy left, and nothing is claiming it.`;
}

// What the headline promises, itemised. Both halves come out of focusYield(),
// so the sentence and the payout after a run cannot disagree — and a stalled
// slot has to be named here, or the total above it is a lie.
function energySentence(store) {
  const { content, state } = store;
  const energy = state.energy;
  const grant = content.balance.energy.dailyGrant;
  const reading = focusReading(store, energy > 0 ? energy : grant);
  const parts = [];

  if (!reading.live.length) {
    parts.push(reading.stalled.length
      ? 'Every slot is holding — no one set to receive it can still use shards. '
      : 'No one is set to receive it, so every point of it passes through. ');
  } else if (energy <= 0) {
    parts.push(`The ${countWord(grant)} Energy that arrive at ${state.settings.resetHour}:00 return `,
      reading.shards
        ? `${yieldPhrase(reading)}. `
        : 'no shards on their own, but every point of them banks toward the next. ');
  } else if (reading.shards) {
    parts.push(`Spend it today and it returns ${yieldPhrase(reading)}. `);
  } else {
    const nearest = Math.min(...reading.live.map(entry => entry.energyToNext));
    parts.push(`Spend it today and it all banks — the nearest shard is ${nearest}⚡ out. `);
  }

  for (const entry of reading.stalled) {
    parts.push(h('span.today-halted',
      `The ${entry.name} slot is paying nothing — ${entry.def.displayName} is at the seven-star maximum. `));
  }
  parts.push(h('button.link', { onclick: () => openFocusModal(store) },
    reading.live.length || reading.stalled.length ? 'Change who →' : 'Choose who →'));
  return h('p.today-route', ...parts);
}

// One slot paying is a sentence, two or more is a list: "three shards to Pete"
// rather than "three shards — three to Pete".
function yieldPhrase(reading) {
  const paying = reading.slots.filter(entry => entry.shards > 0);
  const total = `${countWord(reading.shards)} shard${reading.shards === 1 ? '' : 's'}`;
  return paying.length === 1
    ? `${total} to ${paying[0].def.displayName}`
    : `${total} — ${paying.map(entry => `${countWord(entry.shards)} to ${entry.def.displayName}`).join(', ')}`;
}

// Roughly the width of one claim's label as a share of the track, so two
// claims falling close together slide apart instead of printing over each
// other. The figure under each pip is the exact one either way.
const LABEL_GAP = 22;

// One rail, three claims. Each slot sits where its next shard falls on an axis
// of the Energy still to be spent, so three meters that only ever move together
// read as one line rather than three progress bars.
function energyRail(store) {
  const reading = focusReading(store, store.state.energy);
  const wrap = h('section.today-thread.energy-rail');
  const furthest = reading.live.length ? Math.max(...reading.live.map(entry => entry.energyToNext)) : 0;
  // The axis runs to the next round ten past the furthest claim, so the rail
  // has somewhere to end and the eyebrow has a number to name.
  const domain = Math.max(10, Math.ceil(furthest / 10) * 10);
  wrap.appendChild(h('div.energy-rail-head',
    h('div.eyebrow', reading.live.length
      ? `The next ${countWord(domain)} Energy you spend`
      : 'The Energy you spend'),
    h('div.caption', reading.live.length === reading.slots.length
      ? `every run pays all ${countWord(reading.slots.length)}`
      : reading.live.length
        ? `every run pays ${countWord(reading.live.length)} of ${countWord(reading.slots.length)}`
        : 'nothing is set to receive it')));

  const track = h('div.energy-rail-track', h('div.energy-rail-line', { 'aria-hidden': 'true' }),
    h('div.energy-rail-now', { 'aria-hidden': 'true' }, 'now'));
  // A stalled or empty slot never arrives, so it parks at the far end of the
  // axis; live claims sit at their true distance, spread just far enough apart
  // that two close claims do not print over each other.
  const marks = reading.slots.map(entry => ({
    entry, at: entry.characterId && !entry.halted ? entry.energyToNext / domain * 100 : 100
  }));
  let previous = -Infinity;
  for (const mark of [...marks].sort((a, b) => a.at - b.at)) {
    mark.at = Math.max(mark.at, previous + LABEL_GAP);
    previous = mark.at;
  }
  const overflow = Math.max(0, previous - 100);
  for (const { entry, at } of marks) {
    const live = !!entry.characterId && !entry.halted;
    track.appendChild(h(`button.energy-rail-slot.is-${entry.slot}` + (live ? '' : '.is-still'), {
      style: { left: `${Math.max(0, at - overflow)}%` },
      onclick: () => openFocusModal(store),
      'aria-label': live
        ? `${entry.name} Focus: ${entry.def.displayName}, next shard in ${entry.energyToNext} Energy`
        : entry.def
          ? `${entry.name} Focus: ${entry.def.displayName} is paying nothing`
          : `${entry.name} Focus is empty`
    },
    h('div.energy-rail-name', entry.def ? entry.def.displayName : 'Empty slot'),
    h('div.caption', `${entry.name} · 1 / ${entry.rate}⚡`),
    h('div.energy-rail-pip', { 'aria-hidden': 'true' }),
    h('div.energy-rail-foot', live
      ? `in ${entry.energyToNext}⚡`
      : entry.def ? 'paying nothing — reassign' : 'empty — assign')));
  }
  wrap.appendChild(track);

  const active = store.state.expeditions.active;
  if (active) wrap.appendChild(h('p.caption', `The Expedition cycle returns on day ${active.returnDay}.`));
  else if (store.state.expeditions.board) wrap.appendChild(h('p.caption', 'A route board is waiting — ',
    h('button.link', { onclick: () => store.go('#/expeditions') }, 'plan the cycle →')));
  return wrap;
}

// Assigning Focus is a modal rather than a screen: three slots, one list.
export function openFocusModal(store) {
  const { content, state } = store;
  openModal((modal, close) => {
    const paint = () => {
      modal.replaceChildren();
      dressModal(modal, { size: 'wide' });
      modal.appendChild(modalHead('Development Focus', 'Who is the Energy for?',
        { lead: 'Every point of Energy spent on campaign nodes advances all three meters. Reassign freely — each slot keeps its own progress.' }));
      for (const entry of focusStatus(content, state)) {
        const def = entry.characterId ? content.characterById[entry.characterId] : null;
        modal.appendChild(h('div.focus-modal-slot',
          h('div.focus-modal-slot-head',
            h('span.strong', `${entry.name} — 1 shard per ${entry.rate}⚡`),
            h('span.caption', def ? `${entry.energyToNext}⚡ to the next shard` : 'empty')),
          h('div.focus-modal-slot-row',
            def ? portrait(store, entry.characterId, 'sm', { decorative: true }) : portraitSlot({ size: 'sm', state: 'empty', glyph: '+', decorative: true }),
            h('div.grow', def ? def.displayName : 'No hero assigned'),
            h('button.link', { onclick: () => openFocusTargetList(store, entry.slot, () => paint()) }, def ? 'Change →' : 'Assign →'),
            def ? h('button.link', {
              onclick: () => store.tx(() => clearFocusSlot(state, entry.slot), { rerender: false }).then(paint)
            }, 'Clear') : null)));
      }
      modal.appendChild(modalActions(modalDismiss('Done', () => { close(); render(); })));
    };
    paint();
  });
}

function openFocusTargetList(store, slot, onDone) {
  const { content, state } = store;
  const targets = content.characters
    .filter(def => isRevealed(state, def.id))
    .filter(def => !(state.characters[def.id].owned && state.characters[def.id].stars >= 7));
  openModal((modal, close) => {
    dressModal(modal, { size: 'wide' });
    modal.appendChild(modalHead('Development Focus', `Who takes the ${slot === 'longTerm' ? 'Long-term' : slot[0].toUpperCase() + slot.slice(1)} slot?`,
      { lead: 'Any revealed hero below the 7-Star maximum — recruited or not.' }));
    const list = h('div.supply-target-list');
    for (const def of targets) {
      const cs = state.characters[def.id];
      list.appendChild(h('button.supply-target-row', {
        onclick: () => store.tx(() => assignFocus(content, state, slot, def.id), { rerender: false })
          .then(result => { if (result.ok) { close(); onDone(); } })
      },
      portrait(store, def.id, 'sm', { decorative: true }),
      h('div.grow',
        h('div', def.displayName, cs.owned ? h('span.small.muted', ` · ${cs.stars}★`) : h('span.small.muted', ' · not yet recruited')),
        h('div.small.muted', `${fmt(cs.shards)} shards banked`))));
    }
    if (!targets.length) list.appendChild(h('p.muted', 'No revealed hero can grow right now. Encounter someone in a campaign first.'));
    modal.appendChild(list);
    modal.appendChild(modalActions(modalDismiss('Back', close)));
  });
}

function continueThread(store, node) {
  const wrap = h('section.today-thread', h('div.eyebrow', 'Continue'));
  const focus = focusReading(store, 0);
  const live = focus.live.length;
  if (!node) {
    wrap.appendChild(h('p.muted', 'Every currently available campaign is complete.'));
    return wrap;
  }
  const scene = sceneImage(store, node);
  const selected = selectedPartyPower(store, node);
  const thresholdClass = selected.effective >= node.threshold ? 'good' : 'bad';
  wrap.appendChild(h('div.continue-row',
    h('div.continue-thumb.bleed-wide' + (scene ? '' : '.art-fallback'), {
      style: scene ? { backgroundImage: `url("${scene}")` } : {}
    }),
    h('div.grow',
      h('div.title', node.displayName),
      h('div.caption', `${campaignLabel(store, node)} ${node.number} · needs `,
        h('span', fmt(node.threshold)), ' Power · your ', selected.name, ' reads ',
        h(`span.${thresholdClass}`, fmt(selected.effective)))),
    h('div.continue-action',
      h('button.btn.primary', { onclick: () => store.go(`#/node/${node.id}`) }, 'Enter →'),
      // The cost line makes the same promise as the headline, at the point of
      // spend: what this run takes, and how many slots it pays.
      h('div.caption', `⚡ ${store.content.balance.nodeDefaults[node.type].energy}`,
        live ? ` · pays ${live === focus.slots.length
          ? `all ${countWord(live)}`
          : `${countWord(live)} of ${countWord(focus.slots.length)}`}` : ''))));
  const held = store.state.inventory.resources?.field_supply ?? 0;
  if (store.state.energy < store.content.balance.nodeDefaults[node.type].energy && held > 0) {
    wrap.appendChild(h('p.today-supply',
      h('span.today-supply-dot', { 'aria-hidden': 'true' }),
      h('span', `The day's Energy is spent, but ${countWord(held)} Field Suppl${held === 1 ? 'y' : 'ies'} wait${held === 1 ? 's' : ''} for a targeted push. `,
        h('button.link', { onclick: () => document.querySelector('.sidebar-energy')?.click() },
          'Open the reserve →'))));
  }
  return wrap;
}

function readyThread(store, ready) {
  const wrap = h('section.today-thread', h('div.eyebrow', 'Ready when you are'));
  if (!ready.length) {
    wrap.appendChild(h('p.muted', 'Nothing is waiting — farm materials or shards to open the next upgrade.'));
    return wrap;
  }
  const shown = ready.length > 3 ? ready.slice(0, 2) : ready.slice(0, 3);
  const row = h('div.ready-thread-row');
  shown.forEach((item, index) => {
    const def = store.content.characterById[item.characterId];
    row.appendChild(h('div.ready-thread-item',
      h('button.ready-character-link', {
        onclick: () => store.go(`#/character/${item.characterId}`),
        'aria-label': `Open ${def.displayName}`
      }, portrait(store, item.characterId, 'ready', { pulse: index === 0, decorative: true })),
      h('div', h('div', def.displayName), h('div.caption', item.text.replace(`${def.displayName}: `, '')),
        readyAction(store, item))));
  });
  if (ready.length > 3) row.appendChild(h('button.ready-more', {
    onclick: () => {
      Object.assign(store.state.ui.roster, { ownership: 'ready', sort: 'ready', direction: 'desc' });
      store.save().then(() => store.go('#/roster'));
    }
  }, h('span.numeral', `+${ready.length - 2}`), h('span', 'more are ready →')));
  wrap.appendChild(row);
  return wrap;
}

function readyAction(store, item) {
  const click = {
    completeTier: () => store.tx(() => completeGearTier(store.content, store.state, item.characterId)),
    promoteStar: () => store.tx(() => promoteStar(store.content, store.state, item.characterId)),
    craftEquipment: () => craftEquipmentWithConfirmation(store, item.characterId, item.slot),
    unlock: () => store.tx(() => unlockCharacter(store.content, store.state, item.characterId))
  }[item.type];
  const verb = item.type === 'completeTier' ? 'Finish it →'
    : item.type === 'promoteStar' || item.type === 'unlock' ? 'Promote →' : 'Craft →';
  return h('button.link.ready-verb', { onclick: click }, verb);
}

function trackingThread(store) {
  const { content, state } = store;
  const analysis = analyzePinnedGoals(content, state);
  const wrap = h('section.today-thread', h('div.eyebrow', 'Tracking'));
  if (!state.pins.length) {
    wrap.appendChild(h('p.muted', 'Pin a shard goal or equipment recipe to keep it in sight.'));
    return wrap;
  }
  state.pins.forEach((pin, index) => {
    const def = content.characterById[pin.characterId];
    let label;
    let current = 0;
    let total = 1;
    let action;
    if (pin.type === 'character') {
      const cs = state.characters[pin.characterId];
      total = pin.objective === 'unlock'
        ? content.balance.rosterProgression.recruitShards
        : content.balance.starShards[pin.targetStars - 1];
      current = cs.shards;
      label = `${def.displayName} · ${pin.objective === 'unlock' ? 'unlock' : `${pin.targetStars}★`}`;
      action = () => openFindSources(store, { type: 'shards', id: pin.characterId });
    } else {
      const goal = analysis.goals.find(entry => entry.pin.characterId === pin.characterId && entry.pin.slot === pin.slot)?.analysis;
      const missing = Object.values(goal?.totalMaterialMissing ?? {}).reduce((sum, n) => sum + n, 0);
      const demand = Object.values(goal?.totalMaterialDemand ?? {}).reduce((sum, n) => sum + n, 0);
      current = Math.max(0, demand - missing); total = Math.max(1, demand);
      label = `${def.displayName} · ${goal?.equipmentName ?? content.characterMeta.slots[pin.slot].name}`;
      action = () => openGearDialog(store, pin.characterId, pin.slot);
    }
    const controls = h('div.tracking-controls',
      h('button', { disabled: index === 0, 'aria-label': `Move ${label} up`, onclick: () => store.tx(() => movePin(state, index, -1)) }, '↑'),
      h('button', { disabled: index === state.pins.length - 1, 'aria-label': `Move ${label} down`, onclick: () => store.tx(() => movePin(state, index, 1)) }, '↓'),
      h('button', { onclick: action }, 'open'),
      h('button', { onclick: () => store.tx(() => removePin(state, pin)) }, 'unpin'));
    wrap.appendChild(h('div.tracking-row',
      h('div.tracking-top', h('span', label), h('span', h('b.numeral', fmt(current)), ` / ${fmt(total)}`)),
      h('div.progressbar', h('div', { style: { width: `${Math.min(100, current / total * 100)}%` } })),
      controls));
  });
  return wrap;
}
