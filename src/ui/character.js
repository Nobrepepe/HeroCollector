import { h, fmt } from './dom.js';
import { characterPowerBreakdown } from '../core/power.js';
import {
  promoteStar, checkPromoteStar, unlockCharacter, checkUnlockCharacter,
  togglePin, isPinned, unlockedSkins, selectSkin
} from '../core/state.js';
import { starline, activeSkin } from './shared.js';
import { openFindSources } from './find-sources.js';
import { gearPanel, openGearDialog } from './gear.js';
import { toast } from '../app.js';
import { characterExpedition } from '../core/expeditions.js';
import { hqState } from '../core/hq.js';

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
  const staffed = content.worlds.flatMap(w => Object.entries(hqState(state, w.id).staff ?? {})
    .flatMap(([facilityId, ids]) => ids.includes(characterId) ? [{ world: w, facilityId }] : []))[0];
  if (away || staffed) body.appendChild(h('p.caption.character-assignments',
    away ? `Expedition · ${away.name}, returns day ${away.returnDay}. ` : '',
    staffed ? `HQ staff · ${staffed.world.hq?.facilities.find(f => f.id === staffed.facilityId)?.displayName}.` : ''));

  if (cs.owned) body.appendChild(ownedProgress(store, def, cs, power));
  else body.appendChild(unownedProgress(store, def, cs));
  if (cs.owned) body.appendChild(gearPanel(store, characterId));

  const disclosures = h('div.character-disclosures');
  disclosures.appendChild(h('section.character-story',
    h('div.eyebrow', 'Their Story'),
    h('p', def.lore || 'Their story has not been written yet.')));
  disclosures.appendChild(skinDisclosure(store, def, cs));
  if (cs.owned) disclosures.appendChild(h('button.link.add-party', { onclick: () => store.go('#/party') }, 'Add to party →'));
  body.appendChild(disclosures);
  page.appendChild(body);
  root.appendChild(page);

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
      h('div.caption', `power · ${powerRank(store, def.id)} in your collection`))));
  if (cs.stars < 7) {
    const need = store.content.balance.starShards[cs.stars];
    const gain = store.content.balance.starPowerCumulative[cs.stars] - store.content.balance.starPowerCumulative[cs.stars - 1];
    wrap.append(
      h('div.progressbar.character-progress', h('div', { style: { width: `${Math.min(100, cs.shards / need * 100)}%` } })),
      h('p', `${fmt(Math.max(0, need - cs.shards))} more shards and the ${ordinal(cs.stars + 1)} star adds ${fmt(gain)}. `,
        h('button.link', { onclick: () => openFindSources(store, { type: 'shards', id: def.id }) }, 'Where they drop →')));
    const check = checkPromoteStar(store.content, store.state, def.id);
    wrap.appendChild(h('div.character-actions',
      h('button.btn.primary', { disabled: !check.ok, onclick: () => promoteWithFeedback(store, def.id) }, `Promote to ${cs.stars + 1}★`),
      pinButton(store, def.id)));
  } else wrap.appendChild(h('p.good', 'Seven stars — every shard milestone is complete.'));
  return wrap;
}

function unownedProgress(store, def, cs) {
  const tier = store.content.balance.acquisitionTiers[def.tier];
  const check = checkUnlockCharacter(store.content, store.state, def.id);
  return h('section.character-power',
    h('div.eyebrow', 'Not yet met'),
    h('div.power-line', h('div.display-l', fmt(cs.shards)), h('div.caption', `of ${fmt(tier.cumulativeShards)} shards`)),
    h('div.progressbar', h('div', { style: { width: `${Math.min(100, cs.shards / tier.cumulativeShards * 100)}%` } })),
    h('p', `${def.tier} acquisition · joins at ${tier.unlockStar}★.`),
    h('div.character-actions',
      h('button.btn.primary', { disabled: !check.ok, onclick: () => store.tx(() => unlockCharacter(store.content, store.state, def.id)) }, 'Meet them →'),
      h('button.link', { onclick: () => openFindSources(store, { type: 'shards', id: def.id }) }, 'Find shards'),
      pinButton(store, def.id)));
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

function promoteWithFeedback(store, characterId) {
  store.tx(() => {
    const result = promoteStar(store.content, store.state, characterId);
    if (result.ok) toast(`⭐ ${store.content.characterById[characterId].displayName}: ${fmt(result.powerBefore)} → ${fmt(result.powerAfter)} Power`);
    return result;
  });
}
