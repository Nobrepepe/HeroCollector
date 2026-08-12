// Workshop: lead with the nearest piece of gear, keep inventory behind disclosure.
import { h, fmt } from './dom.js';
import {
  matQty, compQty, craftComponent, checkCraftComponent, maxCraftableComponents,
  upcraft, checkUpcraft
} from '../core/state.js';
import { openFindSources } from './find-sources.js';
import { openGearDialog, craftEquipmentWithConfirmation } from './gear.js';
import { openModal, toast } from '../app.js';
import { resourceQty } from '../core/resources.js';
import { buildWorkshopModel } from './workshop-model.js';
import { rankMaterialSources } from '../core/sources.js';

export function renderInventory(store, root) {
  const model = buildWorkshopModel(store.content, store.state);
  const cold = !model.bench?.analysis.craftable;
  root.classList.add('workshop-screen', cold ? 'workshop-cold' : 'workshop-ready');
  root.appendChild(h('div.workshop-glow', { 'aria-hidden': 'true' }));
  root.appendChild(h('div.workshop-forge.art-fallback', { 'aria-hidden': 'true' }));

  root.appendChild(workshopHeader(store, model));
  root.appendChild(h('div.fade-rule.workshop-rule'));

  const stage = h('div.workshop-stage');
  stage.appendChild(benchSection(store, model));
  stage.appendChild(cold ? shortestPath(store, model) : nearbySection(store, model));
  root.appendChild(stage);
  root.appendChild(h('div.fade-rule.workshop-rule.second'));

  root.appendChild(materialShelf(store, model));
  root.appendChild(h('div.workshop-bottom',
    itemisedMaterials(store, model),
    developmentResources(store)));
  root.appendChild(componentDisclosure(store, model));
}

function workshopHeader(store, model) {
  const count = model.ready.length;
  let headline;
  let subline;
  if (model.bench?.pinned && !model.bench.analysis.craftable) {
    headline = `${model.bench.analysis.equipmentName} is the closest tracked goal.`;
    subline = count > 0
      ? `${numberWord(count)} unpinned piece${count === 1 ? ' is' : 's are'} ready, but pinned work stays on the bench first.`
      : 'Pinned work stays on the bench until it is complete.';
  } else if (count > 0) {
    headline = `${numberWord(count)} piece${count === 1 ? ' is' : 's are'} ready to forge.`;
    subline = model.bench?.pinned
      ? 'Your tracked piece is ready on the bench. Materials move only when you choose it.'
      : 'The nearest gain is already on the bench. Materials move only when you choose it.';
  } else if (model.bench && model.blocking) {
    const familyName = store.content.materialMeta.families[model.blocking.material.family].name;
    headline = `The bench is cold — ${quantityPhrase(model.blocking.qty, familyName)} short.`;
    const runCount = model.source ? runsNeeded(model.blocking.qty, model.source.guaranteed) : 0;
    subline = model.source
      ? `${numberWord(runCount)} run${runCount === 1 ? '' : 's'} of ${model.source.node.displayName} cover it.`
      : `${model.blocking.material.displayName} has no live source yet.`;
  } else {
    headline = 'The bench is quiet.';
    subline = 'Every available gear line is complete, or the next tier has not opened yet.';
  }
  return h('header.workshop-head',
    h('div.eyebrow', 'Workshop · inventory and crafting'),
    h('h1.display-m', headline),
    h('p', subline));
}

function benchSection(store, model) {
  const section = h('section.workshop-bench', h('div.eyebrow', model.bench?.pinned
    ? model.bench.analysis.craftable ? 'Pinned goal · ready at the bench' : 'Closest pinned goal'
    : model.bench?.analysis.craftable ? 'Ready at the bench' : 'Nearest piece'));
  const candidate = model.bench;
  if (!candidate) {
    section.appendChild(h('p.muted', 'There is nothing left to set on the bench.'));
    return section;
  }
  const { content, state } = store;
  const image = content.images.equipment[`${candidate.characterId}:${candidate.slot}`];
  const art = h('div.workshop-piece-art.bleed-portrait' + (image ? '' : '.art-fallback'), {
    style: { '--character-color': candidate.character.color }
  });
  if (image) art.appendChild(h('img', { src: image, alt: candidate.analysis.equipmentName }));
  else art.appendChild(h('span', candidate.slotMeta.icon));
  section.appendChild(art);
  section.append(
    h('div.workshop-piece-copy',
      h('h2.title', candidate.analysis.equipmentName),
      h('div.caption', `Gear tier ${candidate.tier} · ${candidate.slotMeta.name.toLowerCase()} · ${candidate.character.displayName} is wearing nothing there`),
      h('div.workshop-power',
        h('span.display-l', `+${fmt(candidate.powerGain)}`),
        h('span.good', `power for ${candidate.character.displayName}, the moment it is equipped`)),
      h('div.workshop-powerbar', {
        style: { '--character-color': candidate.character.color }
      }, h('i', { style: { width: `${Math.min(94, candidate.powerBefore / (candidate.powerBefore + candidate.powerGain) * 100)}%` } })),
      h('div.caption', `${fmt(candidate.powerBefore)} now · ${fmt(candidate.powerBefore + candidate.powerGain)} after`),
      h('p.workshop-cost', candidate.analysis.craftable
        ? costSentence(content, state, candidate)
        : shortfallSentence(content, state, model.blocking)),
      h('div.workshop-forge-action',
        h('button.btn.primary', {
          disabled: !candidate.analysis.craftable,
          onclick: () => craftEquipmentWithConfirmation(store, candidate.characterId, candidate.slot)
        }, 'Forge it →'),
        h('div.caption', candidate.analysis.craftable
          ? 'No Energy. Materials only.'
          : 'Nothing is spent.'))));
  return section;
}

function nearbySection(store, model) {
  const section = h('section.workshop-nearby', h('div.eyebrow', 'One upcraft away'));
  if (!model.nearby.length) {
    section.appendChild(h('p.muted', 'Nothing else is close enough to crowd the bench.'));
  }
  model.nearby.forEach((candidate, index) => {
    const missing = primaryMissing(store.content, candidate);
    const source = missing ? rankMaterialSources(store.content, store.state, missing.material.id)[0] : null;
    section.appendChild(h('div.nearby-recipe',
      h('button.nearby-name', {
        onclick: () => openGearDialog(store, candidate.characterId, candidate.slot)
      }, candidate.analysis.equipmentName),
      h('p', missing
        ? `${candidate.character.displayName} is ${quantityPhrase(missing.qty, missing.material.displayName)} short. You hold ${fmt(matQty(store.state, missing.material.id))}; ${source ? source.node.displayName : 'no live node'} is the nearest source.`
        : 'Its components are the next closest work on the bench.'),
      missing ? h('button.link', {
        onclick: () => openFindSources(store, { type: 'material', id: missing.material.id })
      }, 'Where they drop →') : null,
      index < model.nearby.length - 1 ? h('div.fade-rule.nearby-rule') : null));
  });
  if (model.totals.reserved > 0) {
    section.appendChild(h('p.caption', `${fmt(model.totals.reserved)} material${model.totals.reserved === 1 ? ' is' : 's are'} held for pinned work.`));
  }
  return section;
}

function shortestPath(store, model) {
  const section = h('section.workshop-shortest', h('div.eyebrow', 'The shortest way there'));
  if (!model.bench || !model.blocking) {
    section.appendChild(h('p.muted', 'No material path is available.'));
    return section;
  }
  const source = model.source;
  const sourceName = source?.node.displayName ?? 'No source authored';
  const path = h('div.workshop-path',
    h('div.workshop-path-stop.source',
      h('i'), h('span', sourceName),
      h('small', source ? `⚡ ${source.energy} · ~${source.guaranteed} ${model.blocking.material.displayName} a run` : 'not yet available')),
    h('div.workshop-path-stop.material',
      h('i'), h('span', model.blocking.material.displayName),
      h('small', `${fmt(model.blocking.qty)} more`)),
    h('div.workshop-path-stop.piece',
      h('i'), h('span', model.bench.analysis.equipmentName),
      h('small', 'no Energy')));
  section.appendChild(path);
  section.appendChild(source
    ? h('button.link.workshop-way-out', { onclick: () => store.go(`#/node/${source.node.id}`) }, `Go to ${source.node.displayName} →`)
    : h('button.link.workshop-way-out', {
      onclick: () => openFindSources(store, { type: 'material', id: model.blocking.material.id })
    }, 'Find another way →'));
  return section;
}

function materialShelf(store, model) {
  const shelf = h('section.workshop-materials', h('div.eyebrow', 'Materials'));
  const grid = h('div.material-shelf');
  for (const family of model.families) {
    const blocking = model.blocking?.material.family === family.family;
    grid.appendChild(h('div.material-family',
      h('div.material-family-name', family.definition.icon, ' ', family.definition.name),
      h('div.material-family-counts',
        ...family.grades.map(item => h('button.material-count' + (item.qty ? '' : '.empty'), {
          title: `${item.definition.displayName}: ${fmt(item.qty)}`,
          'aria-label': `${item.definition.displayName}: ${fmt(item.qty)}. Open sources and upcrafting.`,
          onclick: () => openMaterialActions(store, item.id)
        }, item.qty ? fmt(item.qty) : '—'))),
      blocking
        ? h('div.caption.bad', `${fmt(model.blocking.qty)} short for ${model.bench.analysis.equipmentName}`)
        : family.note ? h('div.caption', family.note) : null));
  }
  shelf.appendChild(grid);
  return shelf;
}

function itemisedMaterials(store, model) {
  const details = h('details.workshop-itemised');
  details.appendChild(h('summary', 'Materials, itemised ⌄'));
  details.appendChild(h('div.itemised-head',
    h('div', h('div.eyebrow', 'Everything on the shelf'),
      h('h2.display-s', `${fmt(model.totals.held)} held, and ${model.totals.upcrafts ? `${fmt(model.totals.upcrafts)} upcraft${model.totals.upcrafts === 1 ? '' : 's'} in reach` : 'no upcraft in reach'}.`),
      h('p', `Five of one grade becomes one of the next. Current campaigns support gear tier ${store.content.maxGearTier}.`)),
    h('div.itemised-totals',
      h('span', h('b.numeral', fmt(model.totals.held)), ' held'),
      h('span', h('b.numeral', fmt(model.totals.aboveBasic)), ' above basic'),
      h('span', h('b.numeral', fmt(model.totals.reserved)), ' reserved'))));
  const grid = h('div.itemised-grid');
  grid.appendChild(h('div.itemised-row.header',
    h('span', 'Family'),
    ...store.content.materialMeta.gradeOrder.map(grade => h('span', store.content.materialMeta.grades[grade].name)),
    h('span', 'Meaning')));
  for (const family of model.families) {
    grid.appendChild(h('div.itemised-row',
      h('div', h('span.material-family-name', `${family.definition.icon} ${family.definition.name}`),
        h('span.caption', family.definition.blurb)),
      ...family.grades.map(item => h('button.material-count' + (item.qty ? '' : '.empty'), {
        title: 'Sources & upcrafting', onclick: () => openMaterialActions(store, item.id)
      }, item.qty ? fmt(item.qty) : '—')),
      h('span.caption', itemisedMeaning(store, family, model))));
  }
  details.append(grid, h('p.caption', 'Headquarters production is configured at Headquarters.'),
    h('button.link.back-to-bench', {
      onclick: () => {
        details.open = false;
        details.scrollIntoView({
          behavior: document.documentElement.classList.contains('reduced-motion') ? 'auto' : 'smooth'
        });
      }
    }, 'Back to the bench ↑'));
  return details;
}

function developmentResources(store) {
  const held = [];
  const empty = [];
  for (const resource of store.content.resources) {
    const qty = resourceQty(store.state, resource.id);
    if (qty) held.push(h('span', h('b.numeral', fmt(qty)), ` ${resource.displayName}`));
    else empty.push(resource.displayName);
  }
  return h('section.workshop-resources',
    h('div.eyebrow', 'Development resources'),
    h('div.resource-line', held.length ? held : h('span.caption', 'None held')),
    empty.length ? h('p.caption', `${joinNatural(empty)} not yet earned`) : null);
}

function componentDisclosure(store, model) {
  const details = h('details.workshop-components');
  details.appendChild(h('summary', 'Components and pinned work ⌄'));
  const list = h('div.component-list');
  for (const component of store.content.components) {
    const have = compQty(store.state, component.id);
    const max = maxCraftableComponents(store.content, store.state, component.id);
    const reserved = model.reservations.components[component.id] ?? 0;
    if (!have && !max && !reserved) continue;
    list.appendChild(h('div.component-row',
      h('div', h('span.title', component.displayName),
        h('div.caption', component.inputs.map(input => `${input.qty} ${store.content.materialById[input.materialId].displayName}`).join(' · '))),
      h('div.component-owned', h('span.numeral', fmt(have)), reserved ? h('span.caption', `${fmt(reserved)} reserved`) : null),
      craftControls(store, component.id, max)));
  }
  if (!list.firstChild) list.appendChild(h('p.muted', 'No components are held or ready to craft.'));
  const pins = store.state.pins.filter(pin => pin.type === 'equipment');
  if (pins.length) {
    list.appendChild(h('div.fade-rule'));
    pins.forEach(pin => list.appendChild(h('div.pinned-work',
      h('span', `${store.content.characterById[pin.characterId].displayName} · ${store.content.characterMeta.slots[pin.slot].name}`),
      h('button.link', { onclick: () => openGearDialog(store, pin.characterId, pin.slot) }, 'Open gear →'))));
  }
  details.appendChild(list);
  return details;
}

function craftControls(store, componentId, maxN) {
  const { content, state } = store;
  const wrap = h('div.component-craft');
  const qty = h('input', { type: 'number', min: 1, max: Math.max(1, maxN), value: 1, 'aria-label': 'Craft quantity' });
  const doCraft = n => {
    const check = checkCraftComponent(content, state, componentId, n);
    if (!check.ok) { toast(check.reasons.join(' '), 'error'); return; }
    const preview = check.def.inputs.map(input => `${input.qty * n} × ${content.materialById[input.materialId].displayName}`).join(' + ');
    const run = () => store.tx(() => craftComponent(content, state, componentId, n));
    if (state.settings.confirmBulk && n > 1) {
      openModal((modal, close) => {
        modal.append(h('div.eyebrow', 'Bulk craft'),
          h('h2', `Craft ${n} × ${check.def.displayName}?`),
          h('p', `This consumes ${preview}.`),
          h('div.modal-actions',
            h('button.btn.primary', { onclick: () => { close(); run(); } }, `Craft ${n} →`),
            h('button.btn', { onclick: close }, 'Leave the materials alone')));
      });
    } else run();
  };
  wrap.append(h('button.link', {
    disabled: maxN < 1,
    onclick: () => doCraft(Math.max(1, Math.min(maxN, Number(qty.value) || 1)))
  }, 'Craft'), qty, h('button.link', {
    disabled: maxN < 1, title: `Craft the maximum (${maxN})`, onclick: () => doCraft(maxN)
  }, `Max ${fmt(maxN)}`));
  return wrap;
}

function openMaterialActions(store, materialId) {
  const { content, state } = store;
  const material = content.materialById[materialId];
  openModal((modal, close) => {
    modal.append(h('div.eyebrow', `${material.icon} ${material.grade} material`),
      h('h2', material.displayName),
      h('p', `${fmt(matQty(state, materialId))} held in the Workshop.`));
    const reserved = buildWorkshopModel(content, state).reservations.materials[materialId] ?? 0;
    if (reserved) modal.appendChild(h('p.caption', `${fmt(reserved)} of them are reserved by pinned recipes.`));
    if (material.conversionTarget) {
      const target = content.materialById[material.conversionTarget];
      const maxTimes = Math.floor(matQty(state, materialId) / material.conversionCost);
      const availability = checkUpcraft(content, {
        ...state, inventory: { ...state.inventory, materials: { ...state.inventory.materials, [materialId]: Math.max(material.conversionCost, matQty(state, materialId)) } }
      }, materialId, 1);
      const qty = h('input', { type: 'number', min: 1, max: Math.max(1, maxTimes), value: 1, 'aria-label': 'Upcraft count' });
      modal.append(h('h3', 'Upcraft'),
        h('p', `${material.conversionCost} ${material.displayName} becomes one ${target.displayName}. ${fmt(maxTimes)} possible now.`));
      if (!availability.ok) modal.appendChild(h('p.caption', availability.reasons[0]));
      modal.appendChild(h('div.modal-actions', qty, h('button.btn.primary', {
        disabled: maxTimes < 1 || !availability.ok,
        onclick: () => {
          const count = Math.max(1, Math.min(maxTimes, Number(qty.value) || 1));
          const check = checkUpcraft(content, state, materialId, count);
          if (!check.ok) { toast(check.reasons.join(' '), 'error'); return; }
          const commit = () => {
            close();
            store.tx(() => {
              const result = upcraft(content, state, materialId, count);
              if (result.ok) toast(`Upcrafted ${fmt(count)} ${target.displayName}.`);
              return result;
            });
          };
          if (check.warning) openModal((confirm, closeConfirm) => {
            confirm.append(h('div.eyebrow', 'Reserved materials'),
              h('h2', 'A pinned goal is holding some of this.'),
              h('p', check.warning),
              h('div.modal-actions',
                h('button.btn.primary', { onclick: () => { closeConfirm(); commit(); } }, 'Upcraft anyway →'),
                h('button.btn', { onclick: closeConfirm }, 'Leave it reserved')));
          });
          else commit();
        }
      }, 'Upcraft →')));
    } else modal.appendChild(h('p.caption', 'Masterwork is the highest grade — nothing converts upward from here.'));
    modal.appendChild(h('div.modal-actions',
      h('button.btn', { onclick: () => { close(); openFindSources(store, { type: 'material', id: materialId }); } }, 'Where it drops'),
      h('button.btn', { onclick: close }, 'Close')));
  });
}

function costSentence(content, state, candidate) {
  const rows = Object.entries(candidate.analysis.totalMaterialDemand);
  if (!rows.length) return 'The required components are already held.';
  return `${joinNatural(rows.map(([id, required]) => {
    const material = content.materialById[id];
    return `${fmt(required)} ${material.displayName} — you hold ${fmt(matQty(state, id))}`;
  }))}.`;
}

function shortfallSentence(content, state, blocking) {
  if (!blocking) return 'The materials are not yet within reach.';
  const required = (state.inventory.materials[blocking.material.id] ?? 0) + blocking.qty;
  const held = matQty(state, blocking.material.id);
  const familyName = content.materialMeta.families[blocking.material.family].name;
  return `${numberWord(held)} of ${fmt(required)} ${familyName}.`;
}

function primaryMissing(content, candidate) {
  return Object.entries(candidate.analysis.totalMaterialMissing)
    .map(([id, qty]) => ({ material: content.materialById[id], qty }))
    .sort((a, b) => b.qty - a.qty)[0] ?? null;
}

function itemisedMeaning(store, family, model) {
  if (model.blocking?.material.family === family.family) {
    return `${fmt(model.blocking.qty)} short for ${model.bench.analysis.equipmentName}`;
  }
  if (family.note) return family.note;
  if (!family.allHeld) {
    const material = family.grades[0].definition;
    const source = rankMaterialSources(store.content, store.state, material.id)[0];
    return source ? `none yet · drops in ${source.node.displayName}` : 'none yet';
  }
  return `${fmt(family.allHeld)} held`;
}

function runsNeeded(shortfall, guaranteed) {
  return Math.max(1, Math.ceil(shortfall / Math.max(1, guaranteed)));
}

function quantityPhrase(qty, noun) {
  return `${fmt(qty)} ${noun}`;
}

function numberWord(number) {
  return ({ 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' })[number] ?? fmt(number);
}

function joinNatural(items) {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
