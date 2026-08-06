import { enableMouseDragScroll, h, fmt } from './dom.js';
import { characterPowerForState } from '../core/power.js';
import {
  cancelExpedition, launchExpedition, previewExpedition,
  revealRareReward, rerollOffer, togglePinOffer
} from '../core/expeditions.js';
import { resourceQty } from '../core/resources.js';
import { portrait, starline } from './shared.js';
import { openExpeditionCharacterPicker } from './character-picker.js';

export function renderExpeditions(store, root, offerId) {
  if (offerId) return renderOffer(store, root, offerId);
  const { content, state } = store;
  const board = state.expeditions.board;
  const openSlots = content.expeditions.settings.slotCount - state.expeditions.active.length;
  root.appendChild(h('header.expedition-head',
    h('div.eyebrow', `Day ${state.dayNumber} · ${resourceQty(state, 'intelligence')} Intelligence`),
    h('h1.display-s', board?.offers.length
      ? `${board.offers.length} routes are waiting.`
      : 'The board is quiet until tomorrow.'),
    h('p.muted', `${openSlots} of ${content.expeditions.settings.slotCount} Expedition slots remain. Plans made today return on a later game day.`)));

  const shelf = h('section.expedition-shelf', h('div.eyebrow', 'Available offers'));
  const row = h('div.expedition-offers');
  enableMouseDragScroll(row);
  for (const offer of board?.offers ?? []) row.appendChild(offerCard(store, offer));
  if (!board?.offers.length) row.appendChild(h('p.muted', 'Every available route has been taken.'));
  shelf.appendChild(row);
  root.appendChild(shelf);

  root.appendChild(h('div.fade-rule'));
  const active = h('section.expedition-thread', h('div.eyebrow', 'Away today'));
  if (!state.expeditions.active.length) active.appendChild(h('p.muted', 'No one is away. Characters sent on an Expedition remain usable everywhere else.'));
  for (const item of state.expeditions.active) {
    active.appendChild(h('div.expedition-active',
      h('div', h('div.title', item.name), h('div.caption', `Returns on day ${item.returnDay} · ${item.tier}`)),
      h('div.expedition-faces', item.party.map(id => portrait(store, id, 'sm'))),
      h('button.link', { disabled: item.launchDay !== state.dayNumber,
        onclick: () => store.tx(() => cancelExpedition(state, item.id)) }, 'Cancel before tomorrow')));
  }
  root.appendChild(active);

  root.appendChild(h('div.fade-rule'));
  const reports = h('details.expedition-reports', h('summary', 'Return reports ⌄'));
  const unread = state.expeditions.reports.filter(r => !r.acknowledged);
  if (!state.expeditions.reports.length) reports.appendChild(h('p.muted', 'The first report will wait here when an Expedition returns.'));
  for (const report of state.expeditions.reports) reports.appendChild(h('article.return-report',
    h('div.eyebrow', `${report.tier} · day ${report.returnDay}`),
    h('div.title', report.name), h('p', report.report),
    h('p.caption', rewardText(content, report.rewards))));
  if (unread.length) reports.appendChild(h('button.btn.primary', {
    onclick: () => store.tx(() => {
      state.expeditions.reports.forEach(r => { r.acknowledged = true; });
      return { ok: true };
    })
  }, 'Acknowledge all →'));
  root.appendChild(reports);
}

function offerCard(store, offer) {
  const world = offer.world ? store.content.worldById[offer.world] : null;
  const image = store.content.images.expedition[world?.id ?? 'global'] ?? null;
  return h('button.expedition-offer' + (image ? '' : '.art-fallback'), {
    onclick: () => store.go(`#/expeditions/${offer.id}`),
    style: image ? { backgroundImage: `url("${image}")` } : {},
    'aria-label': `${offer.name}, ${offer.duration} day Expedition`
  }, h('span.expedition-offer-scrim'), h('span.expedition-offer-copy',
    h('span.eyebrow', offer.offerKind === 'supply' ? 'Guaranteed Field Supply route' : `${world?.displayName ?? 'Across worlds'} · ${offer.duration === 1 ? 'standard' : 'long'}`),
    h('span.title', offer.name),
    h('span.caption', `${offer.partySize} characters · recommends ${fmt(offer.recommendedPower)} Power${offer.pinned ? ' · pinned' : ''}`)));
}

function renderOffer(store, root, offerId) {
  const { content, state } = store;
  const offer = state.expeditions.board?.offers.find(o => o.id === offerId);
  if (!offer) { root.appendChild(h('p.bad', 'That Expedition offer is no longer on the board.')); return; }
  const world = offer.world ? content.worldById[offer.world] : null;
  let selected = Array(5).fill(null);
  const page = h('div.expedition-detail');
  const scene = content.images.expedition[world?.id ?? 'global']
    ?? (world ? content.images.world[world.id] : null);
  page.appendChild(h('div.expedition-scene' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}
  }));
  page.appendChild(h('button.link.expedition-back', { onclick: () => store.go('#/expeditions') }, '← Expeditions'));
  page.appendChild(h('header.expedition-detail-head',
    h('div.eyebrow', offer.offerKind === 'supply' ? `Guaranteed Supply · returns in one day` : `${world?.displayName ?? 'Across worlds'} · returns in ${offer.duration} day${offer.duration > 1 ? 's' : ''}`),
    h('h1.display-m', offer.name), h('p', offer.description)));
  const dynamic = h('div.expedition-builder');
  page.appendChild(dynamic);
  root.appendChild(page);

  function paint() {
    dynamic.replaceChildren();
    const party = selected.slice(0, offer.partySize).filter(Boolean);
    const preview = previewExpedition(content, state, offer, party);
    const clears = preview.power >= offer.recommendedPower;
    dynamic.appendChild(h('section.expedition-verdict',
      h('div.eyebrow', 'Your party reads'),
      h(`div.display-l.${clears ? 'good' : 'bad'}`, fmt(preview.power)),
      h('p', clears
        ? `${fmt(preview.power - offer.recommendedPower)} to spare — this predicts a ${preview.tier} return.`
        : `Short of the ${fmt(offer.recommendedPower)} recommendation, but a valid party still completes the work.`)));
    dynamic.appendChild(h('section.expedition-reward-preview', h('div.eyebrow', 'Expected return'),
      offer.fixedRewards?.length ? h('p.good', `${rewardText(content, offer.fixedRewards)} is guaranteed and never multiplied by the result tier.`) : null,
      h('p', rewardText(content, preview.rewards.filter(entry => !entry.fixed))),
      h('p.caption', offer.rareRevealed && offer.rareReward
        ? `Rare lead: ${rewardText(content, [offer.rareReward])}`
        : 'The exact rare lead remains concealed.')));
    const requirements = h('section.requirement-reading', h('div.eyebrow', 'What the route asks'));
    preview.mandatory.forEach(item => requirements.appendChild(h(`p.${item.met ? 'good' : 'bad'}`, `${item.met ? 'Ready' : 'Still needed'} · ${item.text} (${item.current}/${item.target})`)));
    requirements.appendChild(h(`p.${preview.optional.met ? 'good' : 'muted'}`,
      `${preview.optional.met ? 'Bonus ready' : 'Optional'} · ${preview.optional.text}`));
    dynamic.appendChild(requirements);
    const roster = h('section.expedition-roster', h('div.eyebrow', `Choose ${offer.partySize} expedition members`));
    const row = h('div.expedition-slots');
    selected.forEach((characterId, slotIndex) => {
      const required = slotIndex < offer.partySize;
      const def = characterId ? content.characterById[characterId] : null;
      const button = h('button.expedition-slot' + (characterId ? '.filled' : '.empty'), {
        disabled: !required,
        onclick: () => openExpeditionCharacterPicker(store, {
          currentId: characterId, selectedIds: selected, slotIndex,
          onSelect: nextId => { selected[slotIndex] = nextId; paint(); }
        }),
        'aria-label': required
          ? characterId ? `Change ${def.displayName} in expedition slot ${slotIndex + 1}` : `Choose expedition member ${slotIndex + 1}`
          : `Expedition slot ${slotIndex + 1} is not required`
      });
      if (characterId) button.append(portrait(store, characterId, 'compact'), h('span.title', def.displayName),
        starline(state.characters[characterId].stars), h('span.caption', `${fmt(characterPowerForState(content, state, characterId))} power`));
      else button.append(h('div.expedition-slot-empty', required ? '+' : '—'),
        h('span.title', required ? 'Open place' : 'Not needed'), h('span.caption', required ? 'choose someone' : `This route needs ${offer.partySize}`));
      row.appendChild(button);
    });
    roster.appendChild(row); dynamic.appendChild(roster);
    dynamic.appendChild(h('div.expedition-actions',
      h('button.btn.primary', { disabled: !preview.valid,
        onclick: () => store.tx(() => launchExpedition(content, state, offer.id, party)).then(r => r.ok && store.go('#/expeditions')) }, 'Send them →'),
      h('button.link', { onclick: () => store.tx(() => togglePinOffer(content, state, offer.id)) }, offer.pinned ? 'Unpin offer' : 'Pin for tomorrow'),
      h('button.link', { onclick: () => store.tx(() => revealRareReward(content, state, offer.id)) }, 'Reveal rare reward'),
      h('button.link', { disabled: offer.pinned || offer.offerKind === 'supply',
        onclick: () => store.tx(() => rerollOffer(content, state, offer.id, store.rng)).then(r => r.ok && store.go('#/expeditions')) }, 'Reroll this offer')));
  }
  paint();
}

function rewardText(content, entries) {
  return (entries ?? []).map(entry => {
    const name = entry.kind === 'material' ? content.materialById[entry.id]?.displayName
      : entry.kind === 'shards' ? `${content.characterById[entry.characterId]?.displayName} shards`
        : entry.id === '@associated_world_asset' ? 'the associated World Asset' : content.resourceById[entry.id]?.displayName;
    return `${entry.qty} × ${name ?? entry.id}`;
  }).join(' · ') || 'No additional resources.';
}
