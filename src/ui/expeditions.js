import { enableMouseDragScroll, h, fmt } from './dom.js';
import { characterPowerForState } from '../core/power.js';
import {
  cancelExpedition, launchExpedition, previewExpedition,
  revealRareReward, rerollOffer, togglePinOffer
} from '../core/expeditions.js';
import { resourceQty } from '../core/resources.js';
import { FIELD_SUPPLY_ID } from '../core/energy.js';
import { portrait, starline, rewardNodes } from './shared.js';
import { countWord } from './presentation.js';
import { openExpeditionCharacterPicker } from './character-picker.js';

export function renderExpeditions(store, root, offerId) {
  if (offerId) return renderOffer(store, root, offerId);
  const { content, state } = store;
  const board = state.expeditions.board;
  const offers = board?.offers ?? [];
  const settings = content.expeditions.settings;
  const openSlots = settings.slotCount - state.expeditions.active.length;

  root.appendChild(h('header.expedition-head',
    h('div.eyebrow', `Day ${state.dayNumber} · ${fmt(resourceQty(state, 'intelligence'))} Intelligence`),
    h('h1.display-s', offers.length
      ? `${countWord(offers.length, { capitalize: true })} route${offers.length === 1 ? ' is' : 's are'} waiting.`
      : 'The board is quiet until tomorrow.'),
    h('p.muted', slotSentence(openSlots, settings.slotCount))));
  root.appendChild(boardCosts(store));

  const shelf = h('section.expedition-shelf', h('div.eyebrow', 'Available offers'));
  const row = h('div.expedition-offers');
  enableMouseDragScroll(row);
  for (const offer of offers) row.appendChild(offerCard(store, offer));
  if (!offers.length) row.appendChild(h('p.muted', 'Every available route has been taken. The board refills at the next reset.'));
  if (offers.length) row.appendChild(h('div.expedition-shelf-fade', { 'aria-hidden': 'true' }));
  shelf.appendChild(row);
  if (offers.length) shelf.appendChild(h('p.caption.expedition-shelf-note', 'drag sideways · every offer opens its own party builder'));
  root.appendChild(shelf);

  root.appendChild(h('div.fade-rule'));
  root.appendChild(h('div.expedition-lower', awayThread(store), reportsThread(store)));
}

function slotSentence(openSlots, total) {
  const held = openSlots === total
    ? `Every one of ${countWord(total)} Expedition slots is open.`
    : openSlots === 0
      ? `All ${countWord(total)} Expedition slots are occupied.`
      : `${countWord(openSlots, { capitalize: true })} of ${countWord(total)} Expedition slots remain${openSlots === 1 ? 's' : ''}.`;
  return `${held} Plans made today return on a later game day — the party stays usable everywhere else while they are gone.`;
}

// The two costs that shape the board, stated before they are needed rather
// than discovered when an action is refused.
function boardCosts(store) {
  const { content, state } = store;
  const costs = content.expeditions.settings.intelligenceCosts;
  const daily = state.expeditions.daily ?? { freeRerolls: 0, freeRerollsUsed: 0, freePins: 0, freePinsUsed: 0 };
  const rerollsLeft = Math.max(0, (daily.freeRerolls ?? 0) - (daily.freeRerollsUsed ?? 0));
  const pinsLeft = Math.max(0, (daily.freePins ?? 0) - (daily.freePinsUsed ?? 0));
  const pinned = state.expeditions.board?.offers.some(offer => offer.pinned);
  return h('div.expedition-costs',
    h('div', rerollsLeft
      ? `${countWord(rerollsLeft, { capitalize: true })} free reroll${rerollsLeft === 1 ? '' : 's'} left · then ${costs.reroll} Intelligence`
      : `No free reroll today · each costs ${costs.reroll} Intelligence`),
    h('div', pinned
      ? `Pin used today · reveal costs ${costs.reveal}`
      : pinsLeft
        ? `${countWord(pinsLeft, { capitalize: true })} free pin left · reveal costs ${costs.reveal}`
        : `Pinning costs ${costs.pin} · reveal costs ${costs.reveal}`));
}

function offerCard(store, offer) {
  const world = offer.world ? store.content.worldById[offer.world] : null;
  const image = store.content.images.expedition[world?.id ?? 'global'] ?? null;
  const supply = offer.offerKind === 'supply';
  const classes = ['expedition-offer'];
  if (supply) classes.push('is-supply');
  if (offer.pinned) classes.push('is-pinned');
  if (!image) classes.push('is-unarted');
  const card = h(`button.${classes.join('.')}`, {
    onclick: () => store.go(`#/expeditions/${offer.id}`),
    style: image ? { backgroundImage: `url("${image}")` } : {},
    'aria-label': `${offer.name}, ${offer.partySize} characters, recommends ${fmt(offer.recommendedPower)} Power${offer.pinned ? ', pinned' : ''}`
  });
  if (image) card.appendChild(h('span.expedition-offer-scrim', { 'aria-hidden': 'true' }));
  else card.appendChild(h('span.expedition-offer-slot', { 'aria-hidden': 'true' }, 'offer art\n660 × 860'));
  if (offer.pinned) card.appendChild(h('span.expedition-offer-pin', 'pinned'));
  card.appendChild(h('span.expedition-offer-copy',
    h('span.eyebrow' + (supply ? '.good' : ''), supply
      ? 'Guaranteed Field Supply'
      : `${world?.displayName ?? 'Across worlds'} · ${offer.duration === 1 ? 'standard' : 'long'}`),
    h('span.title', offer.name),
    h('span.caption', image
      ? `${offer.partySize} characters · recommends ${fmt(offer.recommendedPower)} Power`
      : 'awaiting art')));
  return card;
}

function awayThread(store) {
  const { state } = store;
  const active = h('section.expedition-thread', h('div.eyebrow', 'Away today'));
  if (!state.expeditions.active.length) {
    active.appendChild(h('p.muted', 'No one is away. Characters sent on an Expedition remain usable everywhere else while they travel.'));
    return active;
  }
  state.expeditions.active.forEach((item, index) => {
    if (index > 0) active.appendChild(h('div.expedition-away-rule', { 'aria-hidden': 'true' }));
    const supplies = (item.fixedRewards ?? []).filter(entry => entry.kind === 'resource' && entry.id === FIELD_SUPPLY_ID)
      .reduce((sum, entry) => sum + entry.qty, 0);
    const today = item.launchDay === state.dayNumber;
    active.appendChild(h('div.expedition-active',
      h('div.grow',
        h('div.expedition-away-name', item.name),
        h('div.caption', `Returns on day ${item.returnDay} · ${item.tier}`,
          supplies ? h('span.good', ` · ${supplies} Field Suppl${supplies === 1 ? 'y' : 'ies'} held for it`) : null)),
      h('div.expedition-faces', item.party.map(id => portrait(store, id, 'sm', { decorative: true }))),
      today
        ? h('button.link.expedition-away-action', {
          onclick: () => store.tx(() => cancelExpedition(state, item.id))
        }, 'Cancel before tomorrow')
        : h('span.expedition-away-action.is-past', 'Launched yesterday')));
  });
  return active;
}

function reportsThread(store) {
  const { content, state } = store;
  const reports = state.expeditions.reports;
  const unread = reports.filter(report => !report.acknowledged);
  const section = h('section.expedition-reports-thread', h('div.eyebrow', 'Return reports'));
  if (!reports.length) {
    section.appendChild(h('p.muted', 'The first report will wait here when an Expedition returns.'));
    return section;
  }
  section.appendChild(h('div.expedition-report-count',
    h('span.numeral.expedition-report-numeral', String(unread.length)),
    h('div', unread.length
      ? `unread since yesterday · thirty are kept`
      : `all read · thirty are kept`)));
  const details = h('details.expedition-reports', h('summary', 'Open reports ⌄'));
  for (const report of reports) details.appendChild(h('article.return-report',
    h('div.eyebrow', `${report.tier} · day ${report.returnDay}`),
    h('div.expedition-away-name', report.name),
    h('p.caption', report.report),
    h('p.caption', ...rewardNodes(content, report.rewards, { worldId: report.world }))));
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
    root.appendChild(h('p.bad', 'That Expedition offer is no longer on the board.'));
    return;
  }
  const world = offer.world ? content.worldById[offer.world] : null;
  let selected = Array(offer.partySize).fill(null);
  const page = h('div.expedition-detail');
  const scene = content.images.expedition[world?.id ?? 'global']
    ?? (world ? content.images.world[world.id] : null);
  page.appendChild(h('div.expedition-scene' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}, 'aria-hidden': 'true'
  }));
  if (!scene) page.appendChild(h('div.expedition-scene-slot', { 'aria-hidden': 'true' }, 'offer art — 660 × 860'));
  page.appendChild(h('button.link.expedition-back', { onclick: () => store.go('#/expeditions') }, '← Expeditions'));
  page.appendChild(h('header.expedition-detail-head',
    h('div.eyebrow', `${offer.offerKind === 'supply' ? 'Guaranteed Supply' : world?.displayName ?? 'Across worlds'} · returns in ${offer.duration} day${offer.duration > 1 ? 's' : ''}`),
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
        ? h('p.expedition-reward-line', h('span.good', rewardText(content, offer.fixedRewards, world?.id)),
          ' is guaranteed and never multiplied by the tier.')
        : null,
      h('p.expedition-reward-line', ...rewardNodes(content, rolled, { worldId: world?.id })),
      offer.rareReward
        ? offer.rareRevealed
          ? h('p.caption', `Rare lead: ${rewardText(content, [offer.rareReward], world?.id)}`)
          : h('p.caption', 'The rare lead stays concealed. ',
            h('button.link', {
              onclick: () => store.tx(() => revealRareReward(content, state, offer.id), { rerender: false })
                .then(result => { if (result.ok) paint(); })
            }, `Reveal for ${content.expeditions.settings.intelligenceCosts.reveal} Intelligence →`))
        : h('p.caption', 'This route carries no rare lead.')));

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
    selected.forEach((characterId, slotIndex) => {
      const def = characterId ? content.characterById[characterId] : null;
      const button = h('button.expedition-slot' + (characterId ? '.filled' : '.empty'), {
        onclick: () => openExpeditionCharacterPicker(store, {
          currentId: characterId, selectedIds: selected, slotIndex,
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
    const blocked = !preview.valid;
    const reason = party.length < offer.partySize
      ? `${countWord(offer.partySize - party.length, { capitalize: true })} place${offer.partySize - party.length === 1 ? ' is' : 's are'} still open`
      : unmet.length
        ? `${countWord(unmet.length)} requirement${unmet.length === 1 ? ' is' : 's are'} still unmet`
        : null;
    right.appendChild(h('div.expedition-actions',
      h('div.expedition-commit' + (blocked ? '.is-unavailable' : ''),
        h('button.expedition-commit-link', {
          disabled: blocked,
          onclick: () => store.tx(() => launchExpedition(content, state, offer.id, party))
            .then(result => result.ok && store.go('#/expeditions'))
        }, 'Send them →'),
        h('div.expedition-commit-rule', { 'aria-hidden': 'true' }),
        blocked ? h('div.expedition-commit-reason', reason) : null),
      h('div.expedition-side-actions',
        h('button.link', {
          onclick: () => store.tx(() => togglePinOffer(content, state, offer.id), { rerender: false })
            .then(result => { if (result.ok) paint(); })
        }, offer.pinned ? 'Unpin offer' : 'Pin for tomorrow'),
        h('div.expedition-reroll',
          h('button.link', {
            disabled: offer.pinned || offer.offerKind === 'supply',
            onclick: () => store.tx(() => rerollOffer(content, state, offer.id, store.rng), { rerender: false })
              .then(result => result.ok && store.go(`#/expeditions/${result.offer.id}`))
          }, 'Reroll this offer'),
          offer.pinned ? h('span.expedition-reroll-why', ' — pinned offers cannot reroll') : null,
          offer.offerKind === 'supply' ? h('span.expedition-reroll-why', ' — the guaranteed Supply route never rerolls') : null))));

    dynamic.append(left, right);
  }
  paint();
}

// Requirement text is authored as a full sentence; the reading appends a
// count, so the trailing stop is dropped rather than doubled up.
function sentenceStem(text) {
  return String(text ?? '').replace(/\s*[.!]$/, '');
}

// Names, in the empty slot, what would satisfy the requirement that is still
// short — so an open place says what belongs in it.
function slotHint(store, offer, source = {}) {
  const world = source.world === '@associated' ? offer.world : source.world;
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

function rewardText(content, entries, worldId = null) {
  const node = h('span', ...rewardNodes(content, entries, { worldId }));
  return node.textContent;
}
