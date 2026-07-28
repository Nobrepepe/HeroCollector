import { h, fmt } from './dom.js';
import { slotPower, activeTier } from '../core/power.js';
import {
  checkCompleteTier, completeGearTier, togglePin, isPinned,
  checkCraftAndEquipEquipment, craftAndEquipEquipment
} from '../core/state.js';
import { analyzeEquipmentGoal } from '../core/progression.js';
import { openModal, toast } from '../app.js';
import { openFindSources } from './find-sources.js';

function equipmentArt(content, characterId, slot, slotMeta, className = 'gear-art') {
  const src = content.images.equipment[`${characterId}:${slot}`];
  return src ? h(`img.${className}`, { src, alt: '' })
    : h('span.gear-fallback', { 'aria-hidden': 'true' }, slotMeta.icon);
}

export function gearPanel(store, characterId) {
  const { content, state } = store;
  const cs = state.characters[characterId];
  const tier = activeTier(content.balance, cs, content.maxGearTier);
  const panel = h('div.panel.character-gear');
  if (!tier) {
    panel.appendChild(h('h2', `Gear — Current cap reached (Tier ${content.maxGearTier})`));
    panel.appendChild(h('p.good', content.maxGearTier >= content.balance.gearTierPower.length
      ? 'All Gear Tiers are finished. This character is Gear Complete.'
      : `The current campaigns support Gear Tier ${content.maxGearTier}.`));
    return panel;
  }
  panel.appendChild(h('h2', `Gear Tier ${tier}`));
  panel.appendChild(h('p.small.muted',
    `Each piece grants ${slotPower(content.balance, tier)} Power. Complete all six to lock in ${content.balance.gearTierPower[tier - 1]} Power.`));
  const grid = h('div.gear-grid');
  for (const slot of content.characterMeta.slotOrder) grid.appendChild(gearSlot(store, characterId, slot));
  panel.appendChild(grid);
  const done = checkCompleteTier(content, state, characterId);
  panel.appendChild(h('div.gear-tier-actions',
    h('button.btn.primary', {
      disabled: !done.ok,
      onclick: () => store.tx(() => {
        const result = completeGearTier(content, state, characterId);
        if (result.ok) toast(`🛡️ Gear Tier ${result.tier} complete: +${fmt(result.powerAfter - result.powerBefore)} Power`);
        return result;
      })
    }, `Complete Tier ${tier}`),
    h('span.small' + (done.ok ? '.good' : '.muted'), done.ok ? 'All six pieces equipped — ready!' : done.reasons[0])));
  return panel;
}

function gearSlot(store, characterId, slot) {
  const { content, state } = store;
  const meta = content.characterMeta.slots[slot];
  const analysis = analyzeEquipmentGoal(content, state, characterId, slot);
  const pinned = isPinned(state, { type: 'equipment', characterId, slot });
  const classes = ['gear-slot', analysis.equipped ? 'equipped' : analysis.craftable ? 'ready' : 'empty'];
  if (pinned) classes.push('pinned');
  if (store.ui.justEquipped === `${characterId}:${slot}`) classes.push('just-equipped');
  const label = `${meta.name}: ${analysis.equipmentName}. ${analysis.equipped ? 'Equipped' : analysis.craftable ? 'Ready to craft' : 'Not ready'}. ${pinned ? 'Pinned goal' : 'Not pinned'}.`;
  const button = h(`button.${classes.join('.')}`, {
    'aria-label': label, onclick: () => openGearDialog(store, characterId, slot)
  });
  if (analysis.equipped) {
    button.append(equipmentArt(content, characterId, slot, meta));
    button.appendChild(h('span.gear-caption', analysis.equipmentName));
  } else {
    button.appendChild(h('span.gear-plus', { 'aria-hidden': 'true' }, '+'));
    if (analysis.craftable) button.appendChild(h('span.gear-ready-cue', '✓ Ready'));
  }
  if (pinned && !analysis.equipped) button.appendChild(h('span.gear-pin-marker', { 'aria-hidden': 'true' }, '📌'));
  return button;
}

export function openGearDialog(store, characterId, slot) {
  return openModal((modal, close) => {
    const renderDialog = () => {
      const { content, state } = store;
      const def = content.characterById[characterId];
      const cs = state.characters[characterId];
      const meta = content.characterMeta.slots[slot];
      const analysis = analyzeEquipmentGoal(content, state, characterId, slot);
      const pinned = isPinned(state, { type: 'equipment', characterId, slot });
      modal.replaceChildren();
      modal.appendChild(h('div.gear-dialog-header',
        equipmentArt(content, characterId, slot, meta, 'gear-dialog-art'),
        h('div', h('h2', analysis.equipmentName),
          h('p', `${def.displayName} · Gear Tier ${analysis.tier ?? cs.gearTier} · ${meta.name}`),
          h('p.small.muted', `${def.equipmentLines[slot]} · ${meta.name} equipment line`),
          h('p.power-delta', `+${analysis.tier ? slotPower(content.balance, analysis.tier) : 0} Power`))));

      if (analysis.equipped) {
        modal.appendChild(h('p.good', '✓ Equipped for the current tier.'));
      } else {
        modal.appendChild(h('h3', 'Recipe'));
        for (const component of analysis.immediateComponents) {
          const cdef = content.componentById[component.componentId];
          const details = h('details.recipe-component');
          details.appendChild(h('summary',
            h('span', `${cdef.icon} ${cdef.displayName}`),
            h('span' + (component.missing ? '.warn' : '.good'),
              `${component.owned}/${component.required}${component.missing ? ` · ${component.missing} short` : ' · ready'}`)));
          const rows = h('div.recipe-materials');
          for (const material of component.materials) {
            if (!material.required) continue;
            const mdef = content.materialById[material.materialId];
            rows.appendChild(h('div.recipe-material-row',
              h('span', `${mdef.icon} ${mdef.displayName}`),
              h('span', `${fmt(material.owned)} / ${fmt(material.required)}`),
              h('span' + (material.missing ? '.warn' : '.good'), material.missing ? `${material.missing} short` : 'Ready'),
              h('button.link.small', {
                onclick: () => openFindSources(store, { type: 'material', id: material.materialId }, {
                  onUpdate: renderDialog,
                  returnContext: { route: `#/character/${characterId}`, gear: { characterId, slot } }
                })
              }, 'Find')));
          }
          details.appendChild(rows);
          modal.appendChild(details);
        }
        const missing = Object.entries(analysis.totalMaterialMissing);
        modal.appendChild(h('div.total-missing', h('b', 'Total still missing'),
          missing.length ? h('span.warn', missing.map(([id, n]) => `${n} ${content.materialById[id].displayName}`).join(' · '))
            : h('span.good', analysis.state === 'components-ready' ? 'All components owned' : 'Nothing — full chain is ready')));
        if (analysis.conversions.length) modal.appendChild(h('p.small.muted',
          `Planned conversions: ${analysis.conversions.map(c =>
            `${c.cost * c.qty} ${content.materialById[c.from].displayName} → ${c.qty} ${content.materialById[c.to].displayName}`).join(' · ')}`));
      }

      const actions = h('div.modal-actions');
      if (!analysis.equipped) {
        actions.appendChild(h('button.btn' + (pinned ? '.pin-active' : ''), {
          onclick: async () => {
            await store.tx(() => togglePin(state, { type: 'equipment', characterId, slot }, content));
            renderDialog();
          }
        }, pinned ? 'Unpin Goal' : 'Pin Goal'));
        const checked = checkCraftAndEquipEquipment(content, state, characterId, slot);
        const label = analysis.state === 'components-ready' ? 'Craft & Equip'
          : analysis.state === 'chain-ready' ? 'Craft Components & Equip' : 'Missing Materials';
        actions.appendChild(h('button.btn.primary', {
          disabled: !checked.ok,
          onclick: () => commitEquipment(store, characterId, slot, checked, renderDialog)
        }, label));
      }
      actions.appendChild(h('button.btn', { onclick: close }, 'Close'));
      modal.appendChild(actions);
    };
    renderDialog();
  });
}

function commitEquipment(store, characterId, slot, checked, refresh) {
  const run = async () => {
    const result = await store.tx(() =>
      craftAndEquipEquipment(store.content, store.state, characterId, slot, store.now()));
    if (result.ok) {
      store.ui.justEquipped = `${characterId}:${slot}`;
      toast(`✨ ${result.name} equipped: ${fmt(result.powerBefore)} → ${fmt(result.powerAfter)} Power`);
      setTimeout(() => {
        if (store.ui.justEquipped === `${characterId}:${slot}`) store.ui.justEquipped = null;
      }, 900);
      refresh();
    }
  };
  if (checked.plan.reservationConflicts?.length) {
    openModal((modal, close) => {
      modal.appendChild(h('h2', 'Use resources reserved by other goals?'));
      const names = checked.plan.reservationConflicts.map(conflict => {
        const def = conflict.type === 'material'
          ? store.content.materialById[conflict.id] : store.content.componentById[conflict.id];
        return `${conflict.qty} × ${def.displayName}`;
      });
      const goals = store.state.pins.filter(pin => pin.type === 'equipment'
        && !(pin.characterId === characterId && pin.slot === slot)).map(pin => {
        const character = store.content.characterById[pin.characterId];
        const goal = analyzeEquipmentGoal(store.content, store.state, pin.characterId, pin.slot);
        return `${character.displayName} — ${goal.equipmentName}`;
      });
      modal.appendChild(h('p.warn', `This action overlaps reserved resources: ${names.join(', ')}.`));
      if (goals.length) modal.appendChild(h('p.small', `Other active gear goals: ${goals.join(' · ')}`));
      modal.appendChild(h('div.modal-actions',
        h('button.btn.primary', { onclick: () => { close(); run(); } }, 'Craft anyway'),
        h('button.btn', { onclick: close }, 'Cancel')));
    });
  } else run();
}
