// The world Headquarters as a planning surface: three standing Programs that
// advance automatically through relevant play. The screen exists to be
// reconsidered when priorities change — never to be tended daily.
import { h, fmt } from './dom.js';
import { render } from '../app.js';
import { PROGRAM_IDS, PROGRAM_NAMES, programOverview, setProcurementFamily, setDevelopmentHero, installRelic } from '../core/programs.js';
import { isRevealed } from '../core/focus.js';
import { selectorWorldName } from './shared.js';

export function renderPrograms(store, root, arg) {
  const { content, state } = store;
  const world = content.worldById[arg]
    ?? content.worldById[state.ui.selectedWorldId]
    ?? content.worlds[0];
  if (!world) {
    root.appendChild(h('p.muted', 'No world is live in this content set.'));
    return;
  }
  const overview = programOverview(content, state, world.id);
  const page = h('div.programs-page');
  page.appendChild(h('button.link.worlds-back', {
    onclick: () => store.go(`#/worlds/${world.id}`)
  }, `← ${selectorWorldName(world)}`));
  page.appendChild(h('header.programs-head',
    h('div.eyebrow', `${world.displayName} · Headquarters`),
    h('h1.programs-title', 'Programs'),
    h('p.muted', 'All three advance on their own as you play. They only need you when a priority changes.')));

  page.appendChild(procurementCard(store, world, overview));
  page.appendChild(developmentCard(store, world, overview));
  page.appendChild(operationsCard(store, world, overview));
  page.appendChild(relicPanel(store, world, overview));
  page.appendChild(worldSwitcher(store, world));
  root.appendChild(page);
}

function meterBar(meter, threshold) {
  const clamped = Math.min(1, threshold ? (meter % threshold || (meter >= threshold ? threshold : 0)) / threshold : 0);
  return h('div.program-meter', { 'aria-hidden': 'true' },
    h('i', { style: { width: `${Math.round(clamped * 100)}%` } }));
}

function programCard({ name, note, reading, meter, threshold, sentence, control }) {
  return h('section.panel.program-card',
    h('div.program-card-top',
      h('div',
        h('div.program-name', name),
        h('div.small.muted', note)),
      h('div.program-reading', reading)),
    meterBar(meter, threshold),
    h('p.program-sentence', sentence),
    control ?? null);
}

function procurementCard(store, world, overview) {
  const { content } = store;
  const p = overview.procurement;
  const banked = Math.floor(p.meter / p.threshold);
  const material = p.family ? content.materialById[`mat_${p.family}_${p.grade}`] : null;
  const select = h('select.program-select', { 'aria-label': 'Procurement material family' },
    h('option', { value: '' }, 'Choose a material family…'),
    ...content.materialMeta.familyOrder.map(family =>
      h('option', { value: family, selected: p.family === family ? 'selected' : null },
        `${content.materialMeta.families[family].name}`)));
  select.onchange = () => store.tx(() =>
    setProcurementFamily(content, store.state, world.id, select.value || null));
  return programCard({
    name: 'Procurement',
    note: 'fed by Energy spent on this world’s nodes',
    reading: `${p.delivered} shipment${p.delivered === 1 ? '' : 's'} delivered`,
    meter: p.meter, threshold: p.threshold,
    sentence: p.family
      ? banked > 0
        ? `${banked} shipment${banked === 1 ? '' : 's'} of ${p.shipmentQty} × ${material?.displayName ?? p.family} land${banked === 1 ? 's' : ''} at the next daily reset.`
        : `Next shipment: ${p.shipmentQty} × ${material?.displayName ?? p.family} after ${fmt(p.threshold - p.meter)} more Energy of play here.`
      : `The meter banks (${fmt(p.meter)} Energy so far) until a material family is chosen. Nothing is lost.`,
    control: select
  });
}

function developmentCard(store, world, overview) {
  const { content, state } = store;
  const d = overview.development;
  const heroes = content.characters.filter(def => def.world === world.id && isRevealed(state, def.id))
    .filter(def => !(state.characters[def.id].owned && state.characters[def.id].stars >= 7));
  const select = h('select.program-select', { 'aria-label': 'Development hero' },
    h('option', { value: '' }, 'Choose a revealed hero…'),
    ...heroes.map(def =>
      h('option', { value: def.id, selected: d.heroId === def.id ? 'selected' : null }, def.displayName)));
  select.onchange = () => store.tx(() =>
    setDevelopmentHero(content, store.state, world.id, select.value || null));
  const hero = d.heroId ? content.characterById[d.heroId] : null;
  return programCard({
    name: 'Development',
    note: 'fed by shards applied to this world’s heroes',
    reading: `${d.delivered} bonus grant${d.delivered === 1 ? '' : 's'}`,
    meter: d.meter, threshold: d.threshold,
    sentence: hero
      ? `Every ${fmt(d.threshold)} shards this world’s heroes receive, ${hero.displayName} gains ${d.bonusShards} more (${fmt(d.threshold - (d.meter % d.threshold))} to the next).`
      : `The meter banks (${fmt(d.meter)} shard${d.meter === 1 ? '' : 's'} so far) until a hero is chosen. Nothing is lost.`,
    control: heroes.length ? select : h('p.small.muted', 'No revealed hero of this world can grow right now.')
  });
}

function operationsCard(store, world, overview) {
  const o = overview.operations;
  return programCard({
    name: 'Operations',
    note: 'fed by completed Expedition routes from this world',
    reading: `${o.boostCycles} boost${o.boostCycles === 1 ? '' : 's'} banked`,
    meter: o.meter, threshold: o.threshold,
    sentence: o.boostCycles > 0
      ? `The next cycle board’s ${selectorWorldName(world)} routes carry a visible bonus bundle.`
      : `Every ${o.threshold === 1 ? 'completed route' : `${o.threshold} completed routes`} from this world improves its routes on a future cycle board.`,
    control: null
  });
}

function relicPanel(store, world, overview) {
  const { content } = store;
  const relic = overview.relic;
  const panel = h('section.panel.program-relic');
  panel.appendChild(h('div.eyebrow', 'The relic slot'));
  if (!relic) {
    panel.appendChild(h('p.muted', 'No relic has been written for this world.'));
    return panel;
  }
  if (!relic.complete) {
    panel.appendChild(h('p.muted',
      `${relic.relic.displayName} is still in pieces — ${relic.ownedCount} of ${relic.total} recovered. `,
      h('button.link', { onclick: () => store.go(`#/mastery/${world.id}`) }, 'See where the rest are buried →')));
    return panel;
  }
  // Four pieces held is not a relic. The slot stays empty until the binding
  // happens on the Mastery track, so this offers the way there rather than a
  // row of buttons that would each be refused.
  if (!relic.restored) {
    panel.appendChild(h('p.muted',
      `All four pieces of ${relic.relic.displayName} are held, and it is still in pieces. It installs into nothing until it is whole. `,
      h('button.link', { onclick: () => store.go(`#/mastery/${world.id}`) }, 'Restore it whole →')));
    return panel;
  }
  const effects = {
    procurement: `shipments grow to ${overview.procurement.shipmentQty + (overview.relicSlot === 'procurement' ? 0 : content.balance.programs.procurement.relicBonusQty)} materials`,
    development: `bonus shards arrive every ${content.balance.programs.development.relicThreshold} applied instead of ${content.balance.programs.development.threshold}`,
    operations: `route boosts bank every ${content.balance.programs.operations.relicThreshold === 1 ? 'completed route' : `${content.balance.programs.operations.relicThreshold} completed routes`}`
  };
  panel.appendChild(h('p',
    `${relic.relic.displayName} is bound whole. Installed in a Program it visibly improves that Program’s payouts; it can be moved freely, and only future payouts feel the difference.`));
  const row = h('div.program-relic-slots');
  for (const programId of PROGRAM_IDS) {
    const active = overview.relicSlot === programId;
    row.appendChild(h('button.program-relic-slot' + (active ? '.is-active' : ''), {
      onclick: () => store.tx(() => installRelic(content, store.state, world.id, active ? null : programId))
    },
    h('div.program-relic-slot-name', PROGRAM_NAMES[programId]),
    h('div.small' + (active ? '.good' : '.muted'), active ? `installed — ${effects[programId]}` : effects[programId])));
  }
  panel.appendChild(row);
  return panel;
}

function worldSwitcher(store, current) {
  const worlds = [...store.content.worlds].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  if (worlds.length < 2) return h('div');
  return h('div.program-switcher',
    h('div.eyebrow', 'Other worlds'),
    h('div.program-switcher-row',
      ...worlds.filter(world => world.id !== current.id).map(world =>
        h('button.link', {
          onclick: () => { store.go(`#/programs/${world.id}`); render(); }
        }, `${selectorWorldName(world)} →`))));
}
