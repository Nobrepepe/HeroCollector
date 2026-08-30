// Expeditions — one cycle board, one commitment. The player stages up to
// `slotCount` routes with disjoint parties, launches them together, and the
// whole cycle returns together four days later. The board waits indefinitely;
// rerolls and pins are per-cycle.
import { h, fmt } from './dom.js';
import { characterPowerForState } from '../core/power.js';
import {
  cancelCycle, launchCycle, previewExpedition,
  revealRareReward, rerollOffer, togglePinOffer
} from '../core/expeditions.js';
import { resourceQty } from '../core/resources.js';
import { FIELD_SUPPLY_ID } from '../core/energy.js';
import { isRevealed } from '../core/focus.js';
import { portrait, starline, rewardNodes } from './shared.js';
import { countWord } from './presentation.js';
import { openExpeditionCharacterPicker } from './character-picker.js';

// The staged plan lives in UI state until the cycle launches: offerId ->
// { party, shardChoiceCharacterId }.
function cyclePlan(store) {
  return store.ui.cyclePlan ??= {};
}

function planEntries(store) {
  const board = store.state.expeditions.board;
  const plan = cyclePlan(store);
  // Entries for offers that left the board (reroll) are dropped silently.
  for (const offerId of Object.keys(plan)) {
    if (!board?.offers.some(offer => offer.id === offerId)) delete plan[offerId];
  }
  return Object.entries(plan);
}

export function renderExpeditions(store, root, offerId) {
  if (offerId) return renderOffer(store, root, offerId);
  const { content, state } = store;
  const active = state.expeditions.active;
  const board = state.expeditions.board;
  const settings = content.expeditions.settings;

  if (active) {
    root.appendChild(h('header.expedition-head',
      h('div.eyebrow', `Cycle ${active.cycle} · Day ${state.dayNumber} · ${fmt(resourceQty(state, 'intelligence'))} Intelligence`),
      h('h1.display-s', `${countWord(active.routes.length, { capitalize: true })} route${active.routes.length === 1 ? ' is' : 's are'} away.`),
      h('p.muted', `Everything launched together and returns together on day ${active.returnDay} — ${active.returnDay - state.dayNumber} day${active.returnDay - state.dayNumber === 1 ? '' : 's'} from now. The travellers stay usable everywhere else meanwhile.`)));
    root.appendChild(activeCyclePanel(store, active));
    root.appendChild(h('div.fade-rule'));
    root.appendChild(reportsThread(store));
    return;
  }

  const offers = board?.offers ?? [];
  const staged = planEntries(store);
  root.appendChild(h('header.expedition-head',
    h('div.eyebrow', `Cycle ${board?.cycle ?? state.expeditions.cycle} · Day ${state.dayNumber} · ${fmt(resourceQty(state, 'intelligence'))} Intelligence`),
    h('h1.display-s', offers.length
      ? `${countWord(offers.length, { capitalize: true })} route${offers.length === 1 ? ' is' : 's are'} on the board.`
      : 'No routes are authored for this content set.'),
    h('p.muted', `Choose up to ${countWord(settings.slotCount)}, assign every party, and launch them together. The board waits — it never expires.`)));
  root.appendChild(boardCosts(store));

  const shelf = h('section.expedition-shelf', h('div.eyebrow', 'Routes this cycle'));
  const list = h('div.expedition-routes');
  offers.forEach((offer, index) => {
    list.appendChild(routeRow(store, offer));
    if (index < offers.length - 1) list.appendChild(h('div.expedition-route-rule', { 'aria-hidden': 'true' }));
  });
  shelf.appendChild(list);
  root.appendChild(shelf);

  root.appendChild(launchPanel(store, staged));
  root.appendChild(h('div.fade-rule'));
  root.appendChild(reportsThread(store));
}

function launchPanel(store, staged) {
  const { content, state } = store;
  const settings = content.expeditions.settings;
  const section = h('section.expedition-launch', h('div.eyebrow', 'This cycle’s commitment'));
  if (!staged.length) {
    section.appendChild(h('p.muted',
      `Nothing is staged yet. Open a route to assign its party; up to ${countWord(settings.slotCount)} launch together.`));
    return section;
  }
  const board = state.expeditions.board;
  for (const [offerId, entry] of staged) {
    const offer = board.offers.find(item => item.id === offerId);
    section.appendChild(h('div.expedition-active',
      h('div.grow',
        h('div.expedition-away-name', offer.name),
        h('div.caption', offer.world ? content.worldById[offer.world]?.displayName : 'Across worlds')),
      h('div.expedition-faces', entry.party.map(id => portrait(store, id, 'sm', { decorative: true }))),
      h('button.link.expedition-away-action', {
        onclick: () => { delete cyclePlan(store)[offerId]; store.go('#/expeditions'); }
      }, 'Release')));
  }
  const selections = staged.map(([offerId, entry]) => ({ offerId, ...entry }));
  section.appendChild(h('div.expedition-commit',
    h('button.expedition-commit-link', {
      onclick: () => store.tx(() => {
        const result = launchCycle(content, state, selections);
        if (result.ok) store.ui.cyclePlan = {};
        return result;
      })
    }, `Launch the cycle — ${countWord(staged.length)} route${staged.length === 1 ? '' : 's'}, back in ${countWord(settings.cycleLengthDays)} days →`),
    h('div.expedition-commit-rule', { 'aria-hidden': 'true' })));
  return section;
}

function activeCyclePanel(store, active) {
  const { content, state } = store;
  const section = h('section.expedition-thread', h('div.eyebrow', 'Away together'));
  active.routes.forEach((route, index) => {
    if (index > 0) section.appendChild(h('div.expedition-away-rule', { 'aria-hidden': 'true' }));
    const supplies = (route.fixedRewards ?? []).filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID)
      .reduce((sum, entry) => sum + entry.qty, 0);
    section.appendChild(h('div.expedition-active',
      h('div.grow',
        h('div.expedition-away-name', route.name),
        h('div.caption', `${route.world ? content.worldById[route.world]?.displayName ?? '' : 'Across worlds'} · predicts ${route.tier}`,
          supplies ? h('span.good', ` · ${supplies} Field Suppl${supplies === 1 ? 'y' : 'ies'} promised`) : null)),
      h('div.expedition-faces', route.party.map(id => portrait(store, id, 'sm', { decorative: true })))));
  });
  if (active.launchDay === state.dayNumber) {
    section.appendChild(h('button.link', {
      onclick: () => store.tx(() => cancelCycle(state))
    }, 'Cancel the launch — today only'));
  }
  return section;
}

// The per-cycle allowances, stated before they are needed rather than
// discovered when an action is refused.
function boardCosts(store) {
  const { content, state } = store;
  const costs = content.expeditions.settings.intelligenceCosts;
  const allowances = state.expeditions.allowances ?? { freeRerolls: 0, freeRerollsUsed: 0, freePins: 0, freePinsUsed: 0 };
  const rerollsLeft = Math.max(0, (allowances.freeRerolls ?? 0) - (allowances.freeRerollsUsed ?? 0));
  const pinsLeft = Math.max(0, (allowances.freePins ?? 0) - (allowances.freePinsUsed ?? 0));
  const pinned = state.expeditions.board?.offers.some(offer => offer.pinned);
  return h('div.expedition-costs',
    h('div', rerollsLeft
      ? `${countWord(rerollsLeft, { capitalize: true })} free reroll${rerollsLeft === 1 ? '' : 's'} this cycle · then ${costs.reroll} Intelligence`
      : `No free reroll left this cycle · each costs ${costs.reroll} Intelligence`),
    h('div', pinned
      ? `Pin placed · a pinned unlaunched route carries to the next cycle · reveal costs ${costs.reveal}`
      : pinsLeft
        ? `${countWord(pinsLeft, { capitalize: true })} free pin this cycle · reveal costs ${costs.reveal}`
        : `Pinning costs ${costs.pin} · reveal costs ${costs.reveal}`));
}

/* One route, one row. The plate is the same 16:9 file the party screen opens
   into, so choosing a route and walking into it are the same picture. A
   world-scoped route uses its world's backdrop; an across-world route uses the
   production's board art. */
function routeRow(store, offer) {
  const world = offer.world ? store.content.worldById[offer.world] : null;
  const image = store.content.images.expedition[world?.id ?? 'global'] ?? null;
  const supply = offer.offerKind === 'supply';
  const stagedEntry = cyclePlan(store)[offer.id];
  const boosted = offer.baseRewards.some(entry => entry.operations);

  const classes = ['expedition-route'];
  if (supply) classes.push('is-supply');
  if (offer.pinned) classes.push('is-pinned');
  if (stagedEntry) classes.push('is-staged');
  if (!image) classes.push('is-unarted');

  const row = h(`button.${classes.join('.')}`, {
    onclick: () => store.go(`#/expeditions/${offer.id}`),
    'aria-label': `${offer.name}, ${offer.partySize} characters, recommends ${fmt(offer.recommendedPower)} Power${offer.pinned ? ', pinned' : ''}${stagedEntry ? ', staged for launch' : ''}`
  });
  row.appendChild(image
    ? h('span.expedition-route-plate', { style: { backgroundImage: `url("${image}")` }, 'aria-hidden': 'true' })
    : h('span.expedition-route-plate.is-empty', { 'aria-hidden': 'true' }, 'route plate · 1920 × 1080'));
  row.appendChild(h('span.expedition-route-scrim', { 'aria-hidden': 'true' }));

  const marks = [];
  if (offer.pinned) marks.push('pinned');
  if (stagedEntry) marks.push('staged');
  row.appendChild(h('span.expedition-route-copy',
    h('span.eyebrow' + (supply ? '.good' : ''), supply
      ? 'Guaranteed Field Supply'
      : `${world?.displayName ?? 'Across worlds'}${boosted ? ' · Operations bonus' : ''}`),
    h('span.title', offer.name),
    marks.length ? h('span.expedition-route-marks', marks.join(' · ')) : null));

  row.appendChild(h('span.expedition-route-meta',
    h('span', `${countWord(offer.partySize)} character${offer.partySize === 1 ? '' : 's'}`),
    h('span.expedition-route-power', `recommends ${fmt(offer.recommendedPower)} Power`)));
  row.appendChild(h('span.expedition-route-action', 'Build party →'));
  return row;
}

function reportsThread(store) {
  const { content, state } = store;
  const reports = state.expeditions.reports;
  const unread = reports.filter(report => !report.acknowledged);
  const section = h('section.expedition-reports-thread', h('div.eyebrow', 'Cycle reports'));
  if (!reports.length) {
    section.appendChild(h('p.muted', 'The first report will wait here when a cycle returns.'));
    return section;
  }
  section.appendChild(h('div.expedition-report-count',
    h('span.numeral.expedition-report-numeral', String(unread.length)),
    h('div', unread.length ? 'unread cycles · twenty are kept' : 'all read · twenty are kept')));
  const details = h('details.expedition-reports', h('summary', 'Open reports ⌄'));
  for (const report of reports) {
    const cycleBlock = h('article.return-report',
      h('div.eyebrow', `Cycle ${report.cycle} · returned day ${report.returnDay}`));
    for (const route of report.routes) {
      cycleBlock.appendChild(h('div.expedition-away-name', route.name));
      cycleBlock.appendChild(h('p.caption', route.report));
      cycleBlock.appendChild(h('p.caption', ...rewardNodes(content, route.rewards)));
    }
    details.appendChild(cycleBlock);
  }
  section.appendChild(details);
  section.appendChild(h('p.caption.expedition-report-note',
    'Acknowledging is one action for all of them — the rewards were already granted at the reset.'));
  if (unread.length) section.appendChild(h('button.link', {
    onclick: () => store.tx(() => {
      state.expeditions.reports.forEach(report => { report.acknowledged = true; });
      return { ok: true };
    })
  }, 'Acknowledge all →'));
  return section;
}

// ------------------------------------------------------------- 11b the builder
function renderOffer(store, root, offerId) {
  const { content, state } = store;
  const offer = state.expeditions.board?.offers.find(item => item.id === offerId);
  if (!offer) {
    root.appendChild(h('button.link.expedition-back', { onclick: () => store.go('#/expeditions') }, '← Expeditions'));
    root.appendChild(h('p.bad', 'That route is no longer on the board.'));
    return;
  }
  const world = offer.world ? content.worldById[offer.world] : null;
  const stagedEntry = cyclePlan(store)[offer.id];
  const leadEntry = offer.baseRewards.find(entry => entry.kind === 'shards' && entry.choice);
  let selected = stagedEntry ? [...stagedEntry.party, ...Array(Math.max(0, offer.partySize - stagedEntry.party.length)).fill(null)].slice(0, offer.partySize) : Array(offer.partySize).fill(null);
  let leadId = stagedEntry?.shardChoiceCharacterId ?? null;
  const page = h('div.expedition-detail');
  const scene = content.images.expedition[world?.id ?? 'global']
    ?? (world ? content.images.world[world.id] : null);
  page.appendChild(h('div.expedition-scene' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}, 'aria-hidden': 'true'
  }));
  if (!scene) page.appendChild(h('div.expedition-scene-slot', { 'aria-hidden': 'true' }, 'route plate — 1920 × 1080'));
  page.appendChild(h('button.link.expedition-back', { onclick: () => store.go('#/expeditions') }, '← Expeditions'));
  page.appendChild(h('header.expedition-detail-head',
    h('div.eyebrow', `${offer.offerKind === 'supply' ? 'Guaranteed Supply' : world?.displayName ?? 'Across worlds'} · returns with the cycle in ${content.expeditions.settings.cycleLengthDays} days`),
    h('h1.display-m', offer.name), h('p', offer.description)));
  const dynamic = h('div.expedition-builder');
  page.appendChild(dynamic);
  root.appendChild(page);

  function paint() {
    dynamic.replaceChildren();
    const party = selected.filter(Boolean);
    const preview = previewExpedition(content, state, offer, party);
    const clears = preview.power >= offer.recommendedPower;
    const unmet = preview.mandatory.filter(item => !item.met);
    // The empty-slot hint names a shape the party is missing. "Send N
    // characters" is already said by the empty slot itself, so it never
    // becomes the hint.
    const hintIndex = preview.mandatory.findIndex((item, index) =>
      !item.met && offer.requirements[index]?.type !== 'party_size');
    const hint = hintIndex >= 0 ? slotHint(store, offer, offer.requirements[hintIndex]) : null;

    const left = h('div.expedition-column-left');
    left.appendChild(h('section.expedition-verdict',
      h('div.eyebrow', 'Your party reads'),
      h(`div.display-reading.${clears ? 'good' : 'bad'}`, fmt(preview.power)),
      h('p.expedition-verdict-copy', clears
        ? [`${fmt(preview.power - offer.recommendedPower)} to spare — this predicts an `,
          h('span.strong', preview.tier), ' return.']
        : [`Short of the ${fmt(offer.recommendedPower)} recommendation by ${fmt(offer.recommendedPower - preview.power)}. A valid party still completes the work and loses nothing.`])));

    left.appendChild(h('div.fade-rule'));
    const rolled = preview.rewards.filter(entry => !entry.fixed);
    left.appendChild(h('section.expedition-reward-preview', h('div.eyebrow', 'Expected return'),
      offer.fixedRewards?.length
        ? h('p.expedition-reward-line', h('span.good', rewardText(content, offer.fixedRewards)),
          ' is guaranteed and never multiplied by the tier.')
        : null,
      h('p.expedition-reward-line', ...rewardNodes(content, rolled)),
      offer.rareReward
        ? offer.rareRevealed
          ? h('p.caption', `Rare lead: ${rewardText(content, [offer.rareReward])}`)
          : h('p.caption', 'The rare lead stays concealed. ',
            h('button.link', {
              onclick: () => store.tx(() => revealRareReward(content, state, offer.id), { rerender: false })
                .then(result => { if (result.ok) paint(); })
            }, `Reveal for ${content.expeditions.settings.intelligenceCosts.reveal} Intelligence →`))
        : h('p.caption', 'This route carries no rare lead.')));

    if (leadEntry) {
      left.appendChild(h('div.fade-rule'));
      left.appendChild(leadPicker(store, offer, leadEntry, leadId, next => { leadId = next; paint(); }));
    }

    left.appendChild(h('div.fade-rule'));
    const requirements = h('section.requirement-reading', h('div.eyebrow', 'What the route asks'));
    preview.mandatory.forEach(item => requirements.appendChild(h(`p.${item.met ? 'good' : 'bad'}`,
      `${item.met ? 'Ready' : 'Still needed'} · ${sentenceStem(item.text)} (${item.current}/${item.target})`)));
    requirements.appendChild(h(`p.${preview.optional.met ? 'good' : 'muted'}`,
      `${preview.optional.met ? 'Bonus ready' : 'Optional'} · ${sentenceStem(preview.optional.text)}`));
    left.appendChild(requirements);

    const right = h('div.expedition-column-right');
    const roster = h('section.expedition-roster',
      h('div.eyebrow', `Choose ${countWord(offer.partySize)} expedition members`));
    const row = h('div.expedition-slots');
    // Heroes already staged on other routes of this cycle are unavailable.
    const stagedElsewhere = new Set(planEntries(store)
      .filter(([id]) => id !== offer.id)
      .flatMap(([, entry]) => entry.party));
    selected.forEach((characterId, slotIndex) => {
      const def = characterId ? content.characterById[characterId] : null;
      const button = h('button.expedition-slot' + (characterId ? '.filled' : '.empty'), {
        onclick: () => openExpeditionCharacterPicker(store, {
          currentId: characterId,
          selectedIds: [...selected, ...stagedElsewhere],
          slotIndex,
          onSelect: nextId => { selected[slotIndex] = nextId; paint(); }
        }),
        'aria-label': characterId
          ? `Change ${def.displayName} in expedition slot ${slotIndex + 1}`
          : `Choose expedition member ${slotIndex + 1}`
      });
      if (characterId) {
        button.append(portrait(store, characterId, 'expedition', { decorative: true }),
          h('span.expedition-slot-name', def.displayName),
          starline(state.characters[characterId].stars),
          h('span.caption', `${fmt(characterPowerForState(content, state, characterId))} power`));
      } else {
        // Element.append stringifies null, so the optional hint is added on
        // its own rather than passed through as a possibly-absent child.
        button.append(h('div.expedition-slot-empty', '+'),
          h('span.expedition-slot-name.is-open', 'Open place'),
          h('span.caption', 'choose someone'));
        if (hint) button.appendChild(h('span.expedition-slot-hint', hint));
      }
      row.appendChild(button);
    });
    roster.appendChild(row);
    right.appendChild(roster);

    right.appendChild(h('div.fade-rule'));
    const plan = cyclePlan(store);
    const slotCount = content.expeditions.settings.slotCount;
    const stagedCount = planEntries(store).filter(([id]) => id !== offer.id).length;
    const needsLead = !!leadEntry && !leadId;
    const blocked = !preview.valid || needsLead || stagedCount >= slotCount;
    const reason = party.length < offer.partySize
      ? `${countWord(offer.partySize - party.length, { capitalize: true })} place${offer.partySize - party.length === 1 ? ' is' : 's are'} still open`
      : unmet.length
        ? `${countWord(unmet.length)} requirement${unmet.length === 1 ? ' is' : 's are'} still unmet`
        : needsLead
          ? 'choose who the lead is for'
          : stagedCount >= slotCount
            ? `${countWord(slotCount)} routes are already staged — release one first`
            : null;
    right.appendChild(h('div.expedition-actions',
      h('div.expedition-commit' + (blocked ? '.is-unavailable' : ''),
        h('button.expedition-commit-link', {
          disabled: blocked,
          onclick: () => {
            plan[offer.id] = { party, ...(leadId ? { shardChoiceCharacterId: leadId } : {}) };
            store.go('#/expeditions');
          }
        }, plan[offer.id] ? 'Update the staged party →' : 'Stage for this cycle →'),
        h('div.expedition-commit-rule', { 'aria-hidden': 'true' }),
        blocked ? h('div.expedition-commit-reason', reason) : null),
      h('div.expedition-side-actions',
        plan[offer.id]
          ? h('button.link', { onclick: () => { delete plan[offer.id]; store.go('#/expeditions'); } }, 'Release this route')
          : null,
        h('button.link', {
          onclick: () => store.tx(() => togglePinOffer(content, state, offer.id), { rerender: false })
            .then(result => { if (result.ok) paint(); })
        }, offer.pinned ? 'Unpin route' : 'Pin for the next cycle'),
        h('div.expedition-reroll',
          h('button.link', {
            disabled: offer.pinned || offer.offerKind === 'supply',
            onclick: () => store.tx(() => rerollOffer(content, state, offer.id, store.rng), { rerender: false })
              .then(result => result.ok && store.go(`#/expeditions/${result.offer.id}`))
          }, 'Reroll this route'),
          offer.pinned ? h('span.expedition-reroll-why', ' — pinned routes cannot reroll') : null,
          offer.offerKind === 'supply' ? h('span.expedition-reroll-why', ' — the guaranteed Supply route never rerolls') : null))));

    dynamic.append(left, right);
  }
  paint();
}

// A character-lead route lets the player choose the revealed hero its shards
// land on — never a random one.
function leadPicker(store, offer, leadEntry, leadId, onChange) {
  const { content, state } = store;
  const pool = content.characters
    .filter(def => (!leadEntry.choice.world || def.world === leadEntry.choice.world) && isRevealed(state, def.id))
    .filter(def => !(state.characters[def.id].owned && state.characters[def.id].stars >= 7));
  const section = h('section.expedition-lead', h('div.eyebrow', `The lead — ${leadEntry.qty} shards for a chosen hero`));
  if (!pool.length) {
    section.appendChild(h('p.muted', 'No revealed hero can take this lead yet. Encounter someone in the campaign first.'));
    return section;
  }
  const row = h('div.expedition-lead-row');
  for (const def of pool) {
    row.appendChild(h('button.expedition-lead-choice' + (leadId === def.id ? '.is-active' : ''), {
      onclick: () => onChange(def.id),
      'aria-pressed': leadId === def.id ? 'true' : 'false',
      title: def.displayName
    }, portrait(store, def.id, 'sm', { decorative: true }),
    h('span.small', def.displayName)));
  }
  section.appendChild(row);
  return section;
}

// Requirement text is authored as a full sentence; the reading appends a
// count, so the trailing stop is dropped rather than doubled up.
function sentenceStem(text) {
  return String(text ?? '').replace(/\s*[.!]$/, '');
}

// Names, in the empty slot, what would satisfy the requirement that is still
// short — so an open place says what belongs in it.
function slotHint(store, offer, source = {}) {
  const world = source.world ?? offer.world;
  const worldName = world ? store.content.worldById[world]?.displayName : null;
  switch (source.type) {
    case 'star_character':
      return `a ${countWord(source.stars ?? 1)}-star fits here`;
    case 'world_count':
    case 'same_world':
      return worldName ? `someone from ${worldName} fits here` : 'someone from one shared world fits here';
    case 'archetype_count':
      return `a ${store.content.archetypes[source.archetype]?.name ?? 'matching archetype'} fits here`;
    case 'distinct_worlds':
      return 'someone from another world fits here';
    case 'distinct_archetypes':
      return 'another archetype fits here';
    case 'combined_stars':
      return 'more stars fit here';
    case 'combined_power':
    case 'power_over_recommended':
      return 'more Power fits here';
    default:
      return 'anyone fits here';
  }
}

function rewardText(content, entries) {
  const node = h('span', ...rewardNodes(content, entries));
  return node.textContent;
}
