// Character Detail (GDD 11.2): artwork, tags, Power breakdown, Stars/shards,
// six equipment slots with recipes, Find Sources, skins, and lore.
import { h, fmt } from './dom.js';
import { characterPowerBreakdown, activeTier, slotPower } from '../core/power.js';
import { equipmentRecipe, equipmentName } from '../core/content.js';
import {
  compQty, craftEquipment, checkCraftEquipment, completeGearTier, checkCompleteTier,
  promoteStar, checkPromoteStar, unlockCharacter, checkUnlockCharacter,
  togglePin, isPinned, unlockedSkins, selectSkin
} from '../core/state.js';
import { portrait, starline, tagChips, openFindSources, activeSkin } from './shared.js';
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
  if (cs.owned) idBody.appendChild(gearPanel(store, characterId, true));
  head.appendChild(idBody);
  root.appendChild(head);

  // ---------- acquisition / stars
  const starPanel = h('div.panel');
  starPanel.appendChild(h('h2', cs.owned ? 'Stars & shards' : 'Acquisition'));
  const pinBtn = (label = 'Pin shard goal') => h('button.btn.tiny' + (isPinned(state, { type: 'character', characterId }) ? '.pin-color' : ''), {
    onclick: () => store.tx(() => togglePin(state, { type: 'character', characterId }))
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

function gearPanel(store, characterId, compact = false) {
  const { content, state } = store;
  const cs = state.characters[characterId];
  const b = content.balance;
  const panel = h('div.panel' + (compact ? '.character-gear' : ''));
  const tier = activeTier(b, cs, content.maxGearTier);

  if (!tier) {
    panel.appendChild(h('h2', `Gear — Current cap reached (Tier ${content.maxGearTier})`));
    panel.appendChild(h('p.good', content.maxGearTier >= b.gearTierPower.length
      ? 'All ten Gear Tiers are finished. This character is Gear Complete.'
      : `The current campaigns support Gear Tier ${content.maxGearTier}. Publishing freely repeatable ${content.materialMeta.gradeOrder[content.maxMaterialGradeRank + 1] ?? 'higher-grade'} material nodes will raise the cap.`));
    return panel;
  }

  const tierPower = b.gearTierPower[tier - 1];
  const profile = content.tierProfileByTier[tier];
  panel.appendChild(h('h2', `Gear Tier ${tier} of ${content.maxGearTier} currently available`));
  panel.appendChild(h('p.small.muted',
    `${profile.stage}. Each equipped piece grants ${slotPower(b, tier)} Power (10% of this tier's ${tierPower}). Completing the tier consumes all six pieces and locks in the full ${tierPower} permanently.`));

  const grid = h('div.slot-grid' + (compact ? '.compact' : ''));
  for (const slot of content.characterMeta.slotOrder) {
    grid.appendChild(slotCard(store, characterId, slot, tier));
  }
  panel.appendChild(grid);

  const done = checkCompleteTier(content, state, characterId);
  panel.appendChild(h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center' } },
    h('button.btn.primary', {
      disabled: !done.ok,
      onclick: () => store.tx(() => {
        const r = completeGearTier(content, state, characterId);
        if (r.ok) toast(`🛡️ Gear Tier ${r.tier} complete: ${fmt(r.powerBefore)} → ${fmt(r.powerAfter)} Power (+${fmt(r.powerAfter - r.powerBefore)})`);
        return r;
      })
    }, `Complete Tier ${tier}`),
    done.ok ? h('span.good.small', 'All six pieces equipped — ready!') : h('span.muted.small', done.reasons[0])
  ));
  return panel;
}

function slotCard(store, characterId, slot, tier) {
  const { content, state } = store;
  const cs = state.characters[characterId];
  const slotMeta = content.characterMeta.slots[slot];
  const name = equipmentName(content, characterId, slot, tier);
  const donePiece = cs.slots[slot];
  const card = h('div.slot-card' + (donePiece ? '.done' : ''));
  const pin = { type: 'equipment', characterId, slot };

  const eqImg = content.images.equipment[`${characterId}:${slot}`];
  card.appendChild(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
    h('span.slot-name', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      eqImg ? h('img.equip-thumb', { src: eqImg, alt: '' }) : h('span', slotMeta.icon), ` ${name}`),
    h('button.pin-btn' + (isPinned(state, pin) ? '.pinned' : ''), {
      title: isPinned(state, pin) ? 'Unpin recipe' : 'Pin recipe (reserves its materials)',
      onclick: () => store.tx(() => togglePin(state, pin))
    }, '📌')));
  card.appendChild(h('div.flavor', `${slotMeta.name} · ${content.characterById[characterId].equipmentLines[slot]} line`));

  if (donePiece) {
    card.appendChild(h('div.good.small', `Equipped (+${slotPower(content.balance, tier)} Power)`));
    return card;
  }

  const recipe = equipmentRecipe(content, characterId, slot, tier);
  for (const input of recipe.inputs) {
    const have = compQty(state, input.componentId);
    const k = content.componentById[input.componentId];
    card.appendChild(h('div.ing',
      h('span', `${k.icon} ${k.displayName}`),
      h('span' + (have >= input.qty ? '.enough' : '.short'), `${have}/${input.qty} `,
        have < input.qty ? h('button.link.small', { onclick: () => openFindSources(store, { type: 'component', id: input.componentId }) }, 'find') : null)));
  }
  const chk = checkCraftEquipment(content, state, characterId, slot);
  card.appendChild(h('button.btn.tiny' + (chk.ok ? '.primary' : ''), {
    disabled: !chk.ok,
    style: { marginTop: '6px' },
    title: chk.ok ? '' : chk.reasons.join(' '),
    onclick: () => store.tx(() => {
      const r = craftEquipment(content, state, characterId, slot);
      if (r.ok) toast(`✨ ${r.name} equipped: ${fmt(r.powerBefore)} → ${fmt(r.powerAfter)} Power`);
      return r;
    })
  }, 'Craft & equip'));
  return card;
}
