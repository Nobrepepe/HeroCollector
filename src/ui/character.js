// Character Detail (GDD 11.2): artwork, tags, Power breakdown, Stars/shards,
// six equipment slots with recipes, Find Sources, skins, and lore.
import { h, fmt } from './dom.js';
import { characterPowerBreakdown } from '../core/power.js';
import {
  promoteStar, checkPromoteStar, unlockCharacter, checkUnlockCharacter,
  togglePin, isPinned, unlockedSkins, selectSkin
} from '../core/state.js';
import { portrait, starline, tagChips, activeSkin } from './shared.js';
import { openFindSources } from './find-sources.js';
import { gearPanel, openGearDialog } from './gear.js';
import { openModal, toast } from '../app.js';

export function renderCharacter(store, root, characterId) {
  const { content, state } = store;
  const def = content.characterById[characterId];
  if (!def) { root.appendChild(h('p.bad', 'Unknown character.')); return; }
  const cs = state.characters[characterId];
  const b = content.balance;

  // ---------- identity
  const head = h('div.panel.character-overview');
  const skin = activeSkin(store, characterId);
  const fullBody = skin?.fullBody || content.images.fullBody[characterId];
  if (fullBody) {
    head.appendChild(h('div.fullbody', h('img', { src: fullBody, alt: `${def.displayName} full art` })));
  } else {
    head.appendChild(portrait(store, characterId, 'lg'));
  }
  const idBody = h('div.character-overview-body');
  idBody.appendChild(h('h2', { style: { fontSize: '1.5rem' } }, def.displayName, cs.owned ? '' : ' (not owned)'));
  idBody.appendChild(h('div', starline(cs.stars)));
  idBody.appendChild(tagChips(store, def));
  idBody.appendChild(h('p.muted', def.description));
  if (cs.owned) idBody.appendChild(gearPanel(store, characterId));
  head.appendChild(idBody);
  root.appendChild(head);
  if (store.ui.pendingReopen?.gear?.characterId === characterId) {
    const pending = store.ui.pendingReopen;
    store.ui.pendingReopen = null;
    queueMicrotask(() => openGearDialog(store, characterId, pending.gear.slot));
  }

  // ---------- acquisition / stars
  const starPanel = h('div.panel');
  starPanel.appendChild(h('h2', cs.owned ? 'Stars & shards' : 'Acquisition'));
  const pinBtn = (label = 'Pin shard goal') => h('button.btn.tiny' + (isPinned(state, { type: 'character', characterId }) ? '.pin-color' : ''), {
    onclick: () => store.tx(() => togglePin(state, { type: 'character', characterId }, content))
  }, isPinned(state, { type: 'character', characterId }) ? '📌 Pinned' : `📌 ${label}`);

  if (!cs.owned) {
    const tier = b.acquisitionTiers[def.tier];
    starPanel.appendChild(h('p', `${def.tier[0].toUpperCase() + def.tier.slice(1)} character — unlocks at ${tier.unlockStar} Star${tier.unlockStar > 1 ? 's' : ''} with ${tier.cumulativeShards} shards. Acquisition tier measures commitment, not maximum strength.`));
    starPanel.appendChild(shardBar(cs.shards, tier.cumulativeShards));
    const chk = checkUnlockCharacter(content, state, characterId);
    starPanel.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
      h('button.btn.primary', { disabled: !chk.ok, onclick: () => store.tx(() => unlockCharacter(content, state, characterId)) }, `Unlock at ${tier.unlockStar}★`),
      h('button.btn', { onclick: () => openFindSources(store, { type: 'shards', id: characterId }) }, 'Find Sources'),
      pinBtn('Pin unlock goal')));
    if (!chk.ok) starPanel.appendChild(h('ul.reasons', chk.reasons.map(r => h('li', r))));
  } else if (cs.stars < 7) {
    const need = b.starShards[cs.stars];
    starPanel.appendChild(h('p', `Next: ${cs.stars + 1} Stars — consumes ${need} shards, grants +${b.starPowerCumulative[cs.stars] - b.starPowerCumulative[cs.stars - 1]} Power.`));
    starPanel.appendChild(shardBar(cs.shards, need));
    const chk = checkPromoteStar(content, state, characterId);
    starPanel.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
      h('button.btn.primary', { disabled: !chk.ok, onclick: () => promoteWithFeedback(store, characterId) }, `Promote to ${cs.stars + 1}★`),
      h('button.btn', { onclick: () => openFindSources(store, { type: 'shards', id: characterId }) }, 'Find Sources'),
      pinBtn()));
    if (!chk.ok) starPanel.appendChild(h('ul.reasons', chk.reasons.map(r => h('li', r))));
  } else {
    starPanel.appendChild(h('p.good', '7 Stars — maximum reached. Shard nodes for this character now drop their normal material reward instead.'));
  }
  root.appendChild(starPanel);

  if (cs.owned) {
    // ---------- power breakdown
    const bd = characterPowerBreakdown(content, cs);
    const powerPanel = h('div.panel');
    powerPanel.appendChild(h('h2', 'Power breakdown'));
    powerPanel.appendChild(h('table.data',
      h('tr', h('th', 'Source'), h('th', 'Power')),
      h('tr', h('td', 'Base'), h('td', fmt(bd.base))),
      h('tr', h('td', `Stars (${cs.stars})`), h('td', fmt(bd.stars))),
      h('tr', h('td', `Completed Gear (Tier ${cs.gearTier})`), h('td', fmt(bd.gearPermanent))),
      h('tr', h('td', `Equipped pieces (${bd.equippedCount}/6 of active tier)`), h('td', fmt(bd.gearEquipped))),
      h('tr', h('td', h('b', 'Total')), h('td', h('b.big-num', fmt(bd.total))))
    ));
    powerPanel.appendChild(h('p.small.muted', 'Power is never purchased directly — every point is itemized above.'));
    root.appendChild(powerPanel);
  }

  // ---------- skins & lore
  const lorePanel = h('div.panel');
  lorePanel.appendChild(h('h2', 'Lore'));
  lorePanel.appendChild(h('p', def.lore));
  const arch = content.archiveByWorld[def.world];
  if (arch) {
    const unlocked = unlockedSkins(content, state, characterId);
    const authored = [
      ...arch.collections.map(col => col.rewardSkin).filter(r => r?.characterId === characterId),
      ...(arch.fullReward?.characterId === characterId ? [arch.fullReward] : [])
    ];
    if (authored.length > 0) {
      lorePanel.appendChild(h('h3', 'Alternate skins'));
      const unlockedIds = new Set(unlocked.map(s => s.id));
      for (const reward of authored) {
        lorePanel.appendChild(h('p.small' + (unlockedIds.has(reward.id) ? '.good' : '.muted'),
          `🎭 ${reward.skinName} — ${unlockedIds.has(reward.id) ? 'unlocked' : 'locked in the World Archive'}.`));
      }
      if (unlocked.length > 0) {
        const select = h('select', { 'aria-label': 'Selected character skin' },
          h('option', { value: '', selected: !cs.selectedSkinId }, 'Default appearance'),
          unlocked.map(s => h('option', { value: s.id, selected: cs.selectedSkinId === s.id }, s.skinName)));
        select.addEventListener('change', () => store.tx(() => selectSkin(content, state, characterId, select.value || null)));
        lorePanel.appendChild(h('label.kv', h('span', 'Wear'), select));
      }
    }
  }
  root.appendChild(lorePanel);
}

function shardBar(have, need) {
  const wrap = h('div');
  wrap.appendChild(h('div.kv', h('span', 'Shards'), h('b', `${fmt(have)} / ${fmt(need)}`)));
  const bar = h('div.progressbar' + (have >= need ? '.full' : ''));
  bar.appendChild(h('div', { style: { width: `${Math.min(100, have / need * 100)}%` } }));
  wrap.appendChild(bar);
  return wrap;
}

function promoteWithFeedback(store, characterId) {
  store.tx(() => {
    const r = promoteStar(store.content, store.state, characterId);
    if (r.ok) toast(`⭐ ${store.content.characterById[characterId].displayName}: ${fmt(r.powerBefore)} → ${fmt(r.powerAfter)} Power (+${fmt(r.powerAfter - r.powerBefore)})`);
    return r;
  });
}
