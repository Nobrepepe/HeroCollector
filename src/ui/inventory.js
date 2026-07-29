// Inventory / Crafting (GDD 11.2): materials by family/grade, components,
// upcrafting, pinned recipes with reservations, bulk crafting, source links.
import { h, fmt } from './dom.js';
import {
  matQty, compQty, craftComponent, checkCraftComponent, maxCraftableComponents,
  upcraft, checkUpcraft
} from '../core/state.js';
import { analyzePinnedGoals } from '../core/progression.js';
import { openFindSources } from './find-sources.js';
import { openGearDialog } from './gear.js';
import { openModal, toast } from '../app.js';

export function renderInventory(store, root) {
  const { content, state } = store;
  const goalAnalysis = analyzePinnedGoals(content, state);
  const reserved = goalAnalysis.reservations;
  root.appendChild(h('header.utility-head', h('div.eyebrow', 'Inventory and crafting'),
    h('h1.display-s', 'The Workshop.'), h('p.muted', 'Materials become components; components become a hero’s next piece of power.')));

  // ---------- materials
  const matPanel = h('div.panel');
  matPanel.appendChild(h('h2', 'Materials'));
  matPanel.appendChild(h('p.small.muted', `Upcraft: ${content.balance.upcraftRatio} of one family and grade → 1 of the next unlocked grade. Current campaigns support Gear Tier ${content.maxGearTier}; higher grades unlock when matching freely repeatable nodes are published. 📌 amounts are reserved by pinned recipes.`));
  const table = h('table.data.mat-table');
  const header = h('tr', h('th', 'Family'));
  for (const g of content.materialMeta.gradeOrder) header.appendChild(h('th.mat-qty', content.materialMeta.grades[g].name));
  table.appendChild(header);
  for (const family of content.materialMeta.familyOrder) {
    const fm = content.materialMeta.families[family];
    const row = h('tr', h('td', `${fm.icon} ${fm.name}`, h('div.small.muted', fm.blurb)));
    for (const grade of content.materialMeta.gradeOrder) {
      const id = `mat_${family}_${grade}`;
      const qty = matQty(state, id);
      const res = reserved.materials[id] ?? 0;
      const cell = h('td.mat-qty');
      cell.appendChild(h('button.link', {
        title: 'Sources & upcrafting',
        onclick: () => openMaterialActions(store, id)
      }, fmt(qty)));
      if (res > 0) {
        cell.appendChild(h('div.small.pin-color', { title: 'Reserved by goals' }, `Reserved ${fmt(res)}`));
        cell.appendChild(h('div.small.muted', `Uncommitted ${fmt(Math.max(0, qty - res))}`));
      }
      row.appendChild(cell);
    }
    table.appendChild(row);
  }
  matPanel.appendChild(table);
  root.appendChild(matPanel);

  // ---------- components
  const compPanel = h('div.panel');
  compPanel.appendChild(h('h2', 'Components'));
  compPanel.appendChild(h('p.small.muted', 'Materials craft generic components; components assemble character equipment.'));
  const ctable = h('table.data');
  ctable.appendChild(h('tr', h('th', 'Component'), h('th', 'Recipe'), h('th', 'Owned'), h('th', 'Craft')));
  for (const comp of content.components) {
    const have = compQty(state, comp.id);
    const maxN = maxCraftableComponents(content, state, comp.id);
    const resC = reserved.components[comp.id] ?? 0;
    if (have === 0 && maxN === 0 && resC === 0) continue; // keep the table scannable
    const recipeText = comp.inputs.map(i => `${i.qty} × ${content.materialById[i.materialId].displayName}`).join(' + ');
    ctable.appendChild(h('tr',
      h('td', `${comp.icon} ${comp.displayName}`,
        resC > 0 ? h('div.small.pin-color', `Reserved ${fmt(resC)} · Uncommitted ${fmt(Math.max(0, have - resC))}`) : null),
      h('td.small', recipeText, ' ', h('button.link.small', { onclick: () => openFindSources(store, { type: 'component', id: comp.id }) }, 'find')),
      h('td', fmt(have)),
      h('td', craftControls(store, comp.id, maxN))
    ));
  }
  if (ctable.children.length === 1) ctable.appendChild(h('tr', h('td', { colspan: 4 }, h('span.muted', 'No components yet — farm materials from campaign nodes.'))));
  compPanel.appendChild(ctable);
  root.appendChild(compPanel);

  // ---------- pinned recipes
  const pinPanel = h('div.panel');
  pinPanel.appendChild(h('h2', '📌 Pinned recipes'));
  const eqPins = state.pins.filter(p => p.type === 'equipment');
  if (eqPins.length === 0) pinPanel.appendChild(h('p.muted.small', 'Pin recipes from a character’s gear screen to reserve their materials and track them from Home.'));
  const grouped = new Map();
  for (const pin of eqPins) {
    const list = grouped.get(pin.characterId) ?? [];
    list.push(pin);
    grouped.set(pin.characterId, list);
  }
  for (const [characterId, pins] of grouped) {
    const def = content.characterById[characterId];
    pinPanel.appendChild(h('h3', def.displayName));
    for (const pin of pins) {
      pinPanel.appendChild(h('div.kv',
        h('span', content.characterMeta.slots[pin.slot].name),
        h('button.btn.tiny', { onclick: () => openGearDialog(store, pin.characterId, pin.slot) }, 'Open gear')));
    }
  }
  root.appendChild(pinPanel);
}

function craftControls(store, componentId, maxN) {
  const { content, state } = store;
  const wrap = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } });
  const qty = h('input', { type: 'number', min: 1, max: Math.max(1, maxN), value: 1, 'aria-label': 'Craft quantity' });
  const doCraft = (n) => {
    const check = checkCraftComponent(content, state, componentId, n);
    if (!check.ok) { toast(check.reasons.join(' '), 'error'); return; }
    const preview = check.def.inputs.map(i => `${i.qty * n} × ${content.materialById[i.materialId].displayName}`).join(' + ');
    const run = () => store.tx(() => craftComponent(content, state, componentId, n));
    if (state.settings.confirmBulk && n > 1) {
      openModal((modal, close) => {
        modal.appendChild(h('h2', 'Bulk craft preview'));
        modal.appendChild(h('p', `Craft ${n} × ${check.def.displayName}?`));
        modal.appendChild(h('p.small.muted', `Consumes ${preview}.`));
        modal.appendChild(h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn.primary', { onclick: () => { close(); run(); } }, 'Craft'),
          h('button.btn', { onclick: close }, 'Cancel')));
      });
    } else run();
  };
  wrap.appendChild(h('button.btn.tiny', { disabled: maxN < 1, onclick: () => doCraft(Math.max(1, Math.min(maxN, Number(qty.value) || 1))) }, 'Craft'));
  wrap.appendChild(qty);
  wrap.appendChild(h('button.btn.tiny', { disabled: maxN < 1, title: `Craft the maximum (${maxN})`, onclick: () => doCraft(maxN) }, `Max ${maxN}`));
  return wrap;
}

function openMaterialActions(store, materialId) {
  const { content, state } = store;
  const m = content.materialById[materialId];
  openModal((modal, close) => {
    modal.appendChild(h('h2', `${m.icon} ${m.displayName}`));
    modal.appendChild(h('p', `In inventory: ${fmt(matQty(state, materialId))}`));
    const reserved = analyzePinnedGoals(content, state).reservations.materials[materialId] ?? 0;
    if (reserved > 0) modal.appendChild(h('p.small.pin-color', `📌 ${reserved} reserved by pinned recipes.`));

    if (m.conversionTarget) {
      const target = content.materialById[m.conversionTarget];
      modal.appendChild(h('h3', 'Upcraft'));
      const maxTimes = Math.floor(matQty(state, materialId) / m.conversionCost);
      const availability = checkUpcraft(content, { ...state, inventory: { ...state.inventory, materials: { ...state.inventory.materials, [materialId]: Math.max(m.conversionCost, matQty(state, materialId)) } } }, materialId, 1);
      const qty = h('input', { type: 'number', min: 1, max: Math.max(1, maxTimes), value: 1, 'aria-label': 'Upcraft count' });
      const info = h('p.small.muted', `${m.conversionCost} × ${m.displayName} → 1 × ${target.displayName}. You can do this ${maxTimes} time${maxTimes === 1 ? '' : 's'}.`);
      modal.appendChild(info);
      if (!availability.ok) modal.appendChild(h('p.small.warn', availability.reasons[0]));
      modal.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        qty,
        h('button.btn.primary', {
          disabled: maxTimes < 1 || !availability.ok,
          onclick: () => {
            const n = Math.max(1, Math.min(maxTimes, Number(qty.value) || 1));
            const check = checkUpcraft(content, state, materialId, n);
            if (!check.ok) { toast(check.reasons.join(' '), 'error'); return; }
            const commit = () => { close(); store.tx(() => {
              const r = upcraft(content, state, materialId, n);
              if (r.ok) toast(`⚗️ Upcrafted ${n} × ${target.displayName}.`);
              return r;
            }); };
            if (check.warning) {
              openModal((m2, close2) => {
                m2.appendChild(h('h2', 'Reserved materials'));
                m2.appendChild(h('p.warn', check.warning));
                m2.appendChild(h('div', { style: { display: 'flex', gap: '8px' } },
                  h('button.btn.primary', { onclick: () => { close2(); commit(); } }, 'Upcraft anyway'),
                  h('button.btn', { onclick: close2 }, 'Cancel')));
              });
            } else commit();
          }
        }, 'Upcraft')));
    } else {
      modal.appendChild(h('p.small.muted', 'Masterwork is the highest grade — no further conversion.'));
    }
    modal.appendChild(h('div', { style: { marginTop: '14px', display: 'flex', gap: '8px' } },
      h('button.btn', { onclick: () => { close(); openFindSources(store, { type: 'material', id: materialId }); } }, 'Find Sources'),
      h('button.btn', { onclick: close }, 'Close')));
  });
}
