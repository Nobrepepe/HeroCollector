import { h, fmt } from './dom.js';
import { characterPowerBreakdown } from '../core/power.js';
import {
  promoteStar, checkPromoteStar, unlockCharacter, checkUnlockCharacter,
  togglePin, isPinned, selectSkin
} from '../core/state.js';
import { unlockedSkins } from '../core/mastery.js';
import { focusStatus, isRevealed } from '../core/focus.js';
import { starline, activeSkin } from './shared.js';
import { openFindSources } from './find-sources.js';
import { openFocusModal } from './home.js';
import { gearPanel, openGearDialog } from './gear.js';
import { playPromotion, settlePromotion } from './promotion.js';
import { promotionSnapshot, promotionConsequences, starName } from '../core/consequences.js';
import { render } from '../app.js';
import { characterExpedition } from '../core/expeditions.js';

export function renderCharacter(store, root, characterId) {
  const { content, state } = store;
  const def = content.characterById[characterId];
  if (!def) { root.appendChild(h('p.bad', 'Unknown character.')); return; }
  const cs = state.characters[characterId];
  const power = characterPowerBreakdown(content, cs);
  const skin = activeSkin(store, characterId);
  const fullBody = skin?.fullBody || content.images.fullBody[characterId];
  const world = content.worldById[def.world];
  const arch = content.archetypes[def.archetype];

  root.appendChild(h('button.link.character-back', { onclick: () => store.go('#/roster') }, '← Collection'));
  const page = h('div.character-page', { style: { '--character-color': def.color } });
  const art = h('div.character-art.bleed-tall' + (fullBody ? '' : '.art-fallback'));
  if (fullBody) art.appendChild(h('img', { src: fullBody, alt: `${def.displayName} full art` }));
  else art.appendChild(h('span.character-glyph', def.glyph));
  page.appendChild(art);

  const body = h('div.character-body',
    h('div.eyebrow', `${arch.icon} ${arch.name} · ${world.icon} ${world.displayName}${def.faction ? ` · ${content.tagById[def.faction]?.displayName}` : ''}`),
    h('h1.display-xl', def.displayName),
    starline(cs.stars));
  const away = characterExpedition(state, characterId);
  const focusSlot = focusStatus(content, state).find(entry => entry.characterId === characterId) ?? null;
  if (away || focusSlot) body.appendChild(h('p.caption.character-assignments',
    away ? `Expedition · ${away.name}, back with the cycle on day ${state.expeditions.active?.returnDay}. ` : '',
    focusSlot ? `${focusSlot.name} Development Focus · ${focusSlot.energyToNext}⚡ to the next shard.` : ''));

  if (cs.owned) body.appendChild(ownedProgress(store, def, cs, power));
  else body.appendChild(unownedProgress(store, def, cs));
  if (cs.owned) body.appendChild(gearPanel(store, characterId));

  const disclosures = h('div.character-disclosures');
  disclosures.appendChild(h('section.character-story',
    h('div.eyebrow', 'Their Story'),
    h('p', def.lore || 'Their story has not been written yet.')));
  disclosures.appendChild(skinDisclosure(store, def, cs));
  body.appendChild(disclosures);
  page.appendChild(body);
  root.appendChild(page);

  // A promotion that just committed plays here, on the settled page, before
  // the browser has painted it (turn 13).
  playPromotion(store, page, characterId);

  if (store.ui.pendingReopen?.gear?.characterId === characterId) {
    const pending = store.ui.pendingReopen;
    store.ui.pendingReopen = null;
    queueMicrotask(() => openGearDialog(store, characterId, pending.gear.slot));
  }
}

function ownedProgress(store, def, cs, power) {
  const wrap = h('section.character-power');
  const before = store.ui.lastPowerByCharacter?.[def.id];
  const delta = Number.isFinite(before) ? power.total - before : 0;
  wrap.appendChild(h('div.power-line',
    h('div.display-l', fmt(power.total)),
    h('div', delta > 0 ? h('div.good', `+${fmt(delta)} from your last upgrade`) : null,
      h('div.caption.power-rank', `power · ${powerRank(store, def.id)} in your collection`))));
  if (cs.stars < 7) {
    const need = store.content.balance.starShards[cs.stars];
    const gain = store.content.balance.starPowerCumulative[cs.stars] - store.content.balance.starPowerCumulative[cs.stars - 1];
    wrap.append(
      h('div.progressbar.character-progress', h('div', { style: { width: `${Math.min(100, cs.shards / need * 100)}%` } })),
      h('p.character-shard-note', `${fmt(Math.max(0, need - cs.shards))} more shards and the ${ordinal(cs.stars + 1)} star adds ${fmt(gain)}. `,
        h('button.link', { onclick: () => openFindSources(store, { type: 'shards', id: def.id }) }, 'Where they drop →')));
    const check = checkPromoteStar(store.content, store.state, def.id);
    wrap.appendChild(h('div.character-actions',
      h('button.btn.primary', { disabled: !check.ok, onclick: () => promoteWithFeedback(store, def.id) }, `Promote to ${cs.stars + 1}★`),
      focusButton(store, def.id),
      pinButton(store, def.id)));
  } else wrap.appendChild(h('p.good', 'Seven stars — every shard milestone is complete.'));
  return wrap;
}

function unownedProgress(store, def, cs) {
  const tier = store.content.balance.acquisitionTiers[def.tier];
  const check = checkUnlockCharacter(store.content, store.state, def.id);
  const revealed = isRevealed(store.state, def.id);
  return h('section.character-power',
    h('div.eyebrow', revealed ? 'Revealed · not yet recruited' : 'Not yet met'),
    h('div.power-line', h('div.display-l', fmt(cs.shards)), h('div.caption', `of ${fmt(tier.cumulativeShards)} shards`)),
    h('div.progressbar', h('div', { style: { width: `${Math.min(100, cs.shards / tier.cumulativeShards * 100)}%` } })),
    h('p', revealed
      ? `${def.tier} acquisition · joins at ${tier.unlockStar}★. Shards can already be pointed at them.`
      : `${def.tier} acquisition · joins at ${tier.unlockStar}★. First-clear their encounter to reveal them.`),
    h('div.character-actions',
      h('button.btn.primary', { disabled: !check.ok, onclick: () => store.tx(() => unlockCharacter(store.content, store.state, def.id)) }, 'Meet them →'),
      h('button.link', { onclick: () => openFindSources(store, { type: 'shards', id: def.id }) }, 'Find shards'),
      revealed ? focusButton(store, def.id) : null,
      pinButton(store, def.id)));
}

// Focus is the shard engine, so a revealed hero's page carries the assignment.
function focusButton(store, characterId) {
  const slot = focusStatus(store.content, store.state).find(entry => entry.characterId === characterId);
  return h('button.link', { onclick: () => openFocusModal(store) },
    slot ? `${slot.name} Focus ✓` : 'Set as Focus target');
}

function pinButton(store, characterId) {
  const pinned = isPinned(store.state, { type: 'character', characterId });
  return h('button.link', {
    onclick: () => store.tx(() => togglePin(store.state, { type: 'character', characterId }, store.content))
  }, pinned ? 'Unpin goal' : 'Track this');
}

function skinDisclosure(store, def, cs) {
  const unlocked = unlockedSkins(store.content, store.state, def.id);
  if (!cs.owned || !unlocked.length) return h('span');
  const select = h('select', { 'aria-label': 'Selected character skin' },
    h('option', { value: '', selected: !cs.selectedSkinId }, 'Default appearance'),
    unlocked.map(skin => h('option', { value: skin.id, selected: cs.selectedSkinId === skin.id }, skin.skinName)));
  select.addEventListener('change', () => store.tx(() => selectSkin(store.content, store.state, def.id, select.value || null)));
  return h('details', h('summary', 'Appearance ⌄'), select);
}

function powerRank(store, characterId) {
  const owned = store.content.characters.filter(def => store.state.characters[def.id].owned)
    .sort((a, b) => characterPowerBreakdown(store.content, store.state.characters[b.id]).total
      - characterPowerBreakdown(store.content, store.state.characters[a.id]).total);
  const rank = owned.findIndex(def => def.id === characterId) + 1;
  return rank > 0 ? `${ordinal(rank)} of ${owned.length}` : 'unranked';
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

// Turn 13: the promotion is the largest single jump a character ever makes,
// so it is played on the character screen rather than announced by a toast.
// The reading of what the star made possible is a diff, which is why the
// before-snapshot is taken outside the transaction that spends the shards.
async function promoteWithFeedback(store, characterId) {
  settlePromotion();
  const before = promotionSnapshot(store.content, store.state, characterId);
  const result = await store.tx(() => promoteStar(store.content, store.state, characterId), { rerender: false });
  // The save is written before the sequence is even described, so a screen
  // left during the await simply renders the settled state.
  if (!result.ok || location.hash !== `#/character/${characterId}`) { render(); return; }
  store.ui.promotion = {
    characterId, before,
    powerBefore: result.powerBefore, powerAfter: result.powerAfter,
    headline: promotionHeadline(store.content.characterById[characterId].displayName, result.stars),
    consequences: promotionConsequences(store.content, store.state, characterId, before)
  };
  render();
}

// Characters carry no pronouns, so the sentence names them: "The fifth star
// is Ashley’s." A name already ending in s takes the bare apostrophe.
function promotionHeadline(name, stars) {
  return `The ${starName(stars)} star is ${/s$/i.test(name) ? `${name}’` : `${name}’s`}.`;
}
