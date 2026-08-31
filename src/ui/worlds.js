// Turn 12 — Worlds. Two decisions carry the whole surface: selection is a
// stage rather than a grid, so one world holds the art at a time and worlds
// read as places; and the hub has no tiles, so every destination is a line
// with its own live reading and an untouched world is visibly emptier than
// one you live in.
import { h, fmt } from './dom.js';
import { nodeState, worldCampaignUnlocked } from '../core/state.js';
import { masteryRank } from '../core/mastery.js';
import { relicStatus } from '../core/relics.js';
import { programOverview, PROGRAM_NAMES } from '../core/programs.js';
import { eligibleCrisisDefinitions } from '../core/crises.js';
import { selectorWorldName } from './shared.js';
import { charactersByWorld, countWord, crisisAsking, ordinalWord } from './presentation.js';

export function renderWorlds(store, root, arg) {
  if (arg) return renderWorldHub(store, root, arg);
  renderSelection(store, root);
}

// ------------------------------------------------------------- readings
// One place computes what a world currently is, so the selection list and the
// hub can never disagree about it.
export function worldReading(store, world) {
  const { content, state } = store;
  const roster = charactersByWorld(content, world.id);
  const owned = roster.filter(def => state.characters[def.id]?.owned);
  const seen = roster.some(def => state.characters[def.id]?.owned
    || state.characters[def.id]?.revealed || state.characters[def.id]?.shards > 0);
  const entry = worldCampaignUnlocked(content, state, world.id);
  const nodes = content.nodesByCampaign[world.campaignId] ?? [];
  const chapters = [...new Set(nodes.map(node => node.chapter))].sort((a, b) => a - b);
  const cleared = nodes.filter(node => nodeState(state, node.id).cleared);
  const frontier = nodes.find(node => !nodeState(state, node.id).cleared) ?? null;
  const chapter = frontier ? chapters.indexOf(frontier.chapter) + 1 : chapters.length;
  const mastery = masteryRank(content, state, world.id);
  const relic = relicStatus(content, state, world.id);
  const programs = programOverview(content, state, world.id);
  const pendingChoices = state.mastery[world.id]?.pendingChoices ?? [];
  const active = state.crises?.active;
  const crisis = active?.worldId === world.id ? active : null;
  // A Crisis still wants an answer while it is unresolved, and again while its
  // Cache is unclaimed. Once both are done it is settled — still today's
  // event, but nothing is asked of you. Today reads the same predicate, so the
  // hub and the notice on Today can never disagree about it.
  const wantsAnswer = !!crisisAsking(state, world.id);
  const away = (state.expeditions?.active?.routes ?? []).filter(route => route.world === world.id);
  return {
    world, roster, owned, seen, entry, nodes, chapters, cleared, frontier,
    chapter: Math.max(1, chapter), mastery, relic, programs, pendingChoices, away,
    unlocked: entry.unlocked,
    crisis, crisisActive: wantsAnswer ? crisis : null,
    crisisSettled: !!crisis && !wantsAnswer,
    crisisEligible: eligibleCrisisDefinitions(content, state).some(def => def.worldId === world.id)
  };
}

function stateWord(reading) {
  if (reading.crisisActive) return { text: 'crisis', tone: 'bad' };
  if (reading.pendingChoices.length) return { text: 'reward waiting', tone: 'good' };
  if (reading.crisisSettled) return { text: 'answered', tone: 'faint' };
  if (reading.away.length) return { text: `${reading.away.length} out`, tone: 'faint' };
  if (reading.unlocked && !reading.cleared.length) return { text: 'new', tone: 'good' };
  return null;
}

function readingLine(reading) {
  return [
    `Chapter ${reading.chapter} of ${reading.chapters.length || 1}`,
    `${reading.mastery.displayName} · ${fmt(reading.mastery.score)} Mastery`,
    `${reading.owned.length} of ${reading.roster.length} characters`
  ].join(' · ');
}

// ------------------------------------------------------------- 12a selection
function renderSelection(store, root) {
  const { content, state } = store;
  const worlds = [...content.worlds].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  // The list degrades downward: open worlds, then locked ones you have seen,
  // then worlds no character has introduced yet.
  const rank = reading => (reading.unlocked ? 0 : reading.seen ? 1 : 2);
  const readings = worlds.map(world => worldReading(store, world))
    .sort((a, b) => rank(a) - rank(b));
  const open = readings.filter(reading => reading.unlocked).length;
  let selectedId = state.ui.selectedWorldId && worlds.some(world => world.id === state.ui.selectedWorldId)
    ? state.ui.selectedWorldId
    : (readings.find(reading => reading.crisisActive) ?? readings.find(reading => reading.unlocked) ?? readings[0])?.world.id;

  const page = h('div.worlds-page');
  const art = h('div.worlds-stage', { 'aria-hidden': 'true' });
  const artSlot = h('div.worlds-stage-slot', { 'aria-hidden': 'true' }, 'world art — 1920 × 1080');
  const list = h('div.worlds-list');
  const stageCopy = h('div.worlds-stage-copy');
  page.append(art, artSlot,
    h('div.eyebrow.worlds-eyebrow', `Worlds · ${countWord(worlds.length)} known, ${open ? countWord(open) : 'none'} open`),
    list, stageCopy,
    h('p.caption.worlds-note', 'A locked world can still be walked into — the campaign previews, nothing can be entered.'));
  root.appendChild(page);

  const paint = () => {
    const selected = readings.find(reading => reading.world.id === selectedId) ?? readings[0];
    const image = content.images.world[selected.world.id] ?? null;
    art.className = 'worlds-stage' + (image ? '' : ' art-fallback');
    art.style.backgroundImage = image ? `url("${image}")` : '';
    artSlot.hidden = !!image;

    list.replaceChildren();
    let dividerPlaced = false;
    readings.forEach(reading => {
      // Locked and unseen worlds sit below a hairline: the list degrades
      // downward rather than hiding what is not reachable yet.
      if (!reading.unlocked && !dividerPlaced) {
        list.appendChild(h('div.worlds-divider', { 'aria-hidden': 'true' }));
        dividerPlaced = true;
      }
      list.appendChild(worldRow(reading, reading.world.id === selectedId, () => {
        selectedId = reading.world.id;
        state.ui.selectedWorldId = selectedId;
        store.save();
        paint();
      }));
    });

    // replaceChildren is native and would stringify a null child.
    stageCopy.replaceChildren(...[
      h('div.eyebrow.worlds-selected-eyebrow', 'Selected'),
      h('h1.worlds-stage-name', selected.world.displayName),
      h('p.worlds-stage-tagline', selected.world.tagline),
      selected.crisisActive
        ? h('p.worlds-stage-crisis',
          h('span.worlds-crisis-dot', { 'aria-hidden': 'true' }),
          h('span', `${selected.crisisActive.name} is active here today.`))
        : null,
      h('div.worlds-enter',
        h('button.worlds-enter-link', {
          onclick: () => store.go(`#/worlds/${selected.world.id}`)
        }, `Enter the ${selectorWorldName(selected.world)} →`),
        h('div.worlds-enter-rule', { 'aria-hidden': 'true' }),
        selected.unlocked ? null : h('div.worlds-enter-note', 'It previews — nothing inside can be entered yet.'))
    ].filter(Boolean));
  };
  paint();
}

function worldRow(reading, selected, onSelect) {
  const seen = reading.seen;
  const classes = ['worlds-row'];
  if (selected) classes.push('is-selected');
  else if (reading.unlocked) classes.push('is-open');
  else if (seen) classes.push('is-locked');
  else classes.push('is-unseen');
  // A locked or unseen world has no state to report beyond its gate.
  const word = selected || reading.unlocked ? stateWord(reading) : null;
  const row = h(`button.${classes.join('.')}`, {
    onclick: onSelect, 'aria-current': selected ? 'true' : null
  },
  h('div.worlds-row-top',
    h('div.worlds-row-name', seen ? reading.world.displayName : 'Unnamed'),
    word ? h(`div.worlds-row-state.is-${word.tone}`, word.text) : null));
  row.appendChild(h('div.worlds-row-reading', seen
    ? reading.unlocked
      ? readingLine(reading)
      : `${reading.entry.owned} of ${reading.entry.needed} characters owned${reading.entry.needed - reading.entry.owned === 1 ? ' · one more opens it' : ''}`
    : 'no characters of this world have been seen'));
  return row;
}

// ------------------------------------------------------------- 12b/12c the hub
// One renderer, two readings. A world with no Headquarters, no relics, no
// crisis eligibility and a thin roster runs through exactly this code and
// states each absence in a sentence.
function renderWorldHub(store, root, worldId) {
  const { content, state } = store;
  const world = content.worldById[worldId];
  if (!world) {
    root.appendChild(h('button.link.worlds-back', { onclick: () => store.go('#/worlds') }, '← Worlds'));
    root.appendChild(h('p.bad', 'That world is no longer part of this content set.'));
    return;
  }
  const reading = worldReading(store, world);
  const image = content.images.world[world.id] ?? null;
  const page = h('div.world-hub');
  page.appendChild(h('div.world-hub-art' + (image ? '' : '.art-fallback'), {
    style: image ? { backgroundImage: `url("${image}")` } : {}, 'aria-hidden': 'true'
  }));
  // The caption sits in the empty middle of the band, below the headline and
  // clear of the "Held here" column.
  if (!image) page.appendChild(h('div.world-hub-art-slot', { 'aria-hidden': 'true' }, 'world art — 1920 × 1080'));
  page.appendChild(h('button.link.worlds-back', { onclick: () => store.go('#/worlds') }, '← Worlds'));
  page.appendChild(h('header.world-hub-head',
    h('div.eyebrow', `Day ${state.dayNumber} · ${relationshipWords(store, reading)}`),
    h('h1.world-hub-name', world.displayName),
    h('p.world-hub-tagline', world.tagline)));

  page.appendChild(h('section.world-held', h('div.eyebrow', 'Held here'),
    h('div.world-held-row',
      h('div',
        h('div.world-held-number' + (reading.mastery.score ? '' : '.is-zero'), fmt(reading.mastery.score),
          h('span.world-held-of', ` / ${fmt(reading.mastery.max)}`)),
        h('div.world-held-label', `${reading.mastery.displayName} · Mastery`)),
      h('div',
        h('div.world-held-number', String(reading.owned.length),
          h('span.world-held-of', ` / ${reading.roster.length}`)),
        h('div.world-held-label', 'characters')))));

  page.appendChild(h('div.fade-rule.world-hub-rule'));
  // The side column is the Programs and nothing else. This world's characters
  // are already counted in Held here above, and the routes leaving from here
  // were a reading of the Expeditions board rather than of this world.
  page.appendChild(h('div.world-hub-body',
    destinations(store, reading),
    h('div.world-hub-side', programsPanel(store, reading))));
  root.appendChild(page);
}

function relationshipWords(store, reading) {
  if (!reading.unlocked) return 'previewing a closed world';
  const opened = [...store.content.worlds]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .filter(world => worldCampaignUnlocked(store.content, store.state, world.id).unlocked);
  const index = opened.findIndex(world => world.id === reading.world.id);
  return index >= 0 ? `your ${ordinalWord(index + 1)} world` : 'open to you';
}

function destinations(store, reading) {
  const list = h('div.world-destinations');
  const rows = [];
  if (reading.crisisActive) rows.push(crisisRow(store, reading));
  rows.push(chaptersRow(store, reading), masteryRow(store, reading));
  if (!reading.crisisActive) rows.push(crisisRow(store, reading));
  rows.forEach((row, index) => {
    if (index > 0) list.appendChild(h('div.world-destination-rule', { 'aria-hidden': 'true' }));
    list.appendChild(row);
  });
  return list;
}

function destinationRow({ name, reading, sentence, dim = false, dot = false }) {
  const row = h('section.world-destination' + (dim ? '.is-dim' : ''));
  const top = h('div.world-destination-top',
    h('div.world-destination-title',
      dot ? h('span.world-destination-dot', { 'aria-hidden': 'true' }) : null,
      h('span.world-destination-name', name)),
    h('div.world-destination-reading' + (dim ? '.is-dim' : ''), reading));
  row.appendChild(top);
  row.appendChild(h('p.world-destination-sentence', sentence));
  return row;
}

// The world hub is the only way into a Crisis, so this row carries every
// state it can be in rather than only the unanswered one.
function crisisRow(store, reading) {
  const active = reading.crisisActive;
  if (active) {
    const waitingOnCache = active.status === 'resolved';
    return destinationRow({
      name: active.name, dot: true,
      reading: h('span.world-crisis-word', waitingOnCache ? 'cache · today only' : 'crisis · today only'),
      sentence: waitingOnCache
        ? ['The response is finished and the Emergency Cache is still waiting for one choice. ',
          h('button.link', { onclick: () => store.go('#/crisis') }, 'Open the Cache →')]
        : [`${countWord(active.fronts.length, { capitalize: true })} Fronts, ${countWord(active.teamSize)} characters each. No Energy, no penalty for refusing. `,
          h('button.link', { onclick: () => store.go('#/crisis') }, 'Answer it →')]
    });
  }
  // Answered and settled: it stays on the hub as today's event, but nothing
  // is asked, so it drops out of the pinned position.
  if (reading.crisisSettled) {
    return destinationRow({
      name: reading.crisis.name, dim: true, reading: 'answered today',
      sentence: ['Nothing else is asked of this world today. ',
        h('button.link', { onclick: () => store.go('#/crisis') }, 'Read the response →')]
    });
  }
  // A world that cannot host a Crisis keeps its row at the bottom and states
  // the gate; it never disappears and never becomes a call to action.
  const needed = store.content.balance.partySize;
  if (reading.owned.length < needed) {
    return destinationRow({
      name: 'Crisis', dim: true,
      reading: 'not while the roster is this thin',
      sentence: `${countWord(needed, { capitalize: true })} owned characters of this world before one can call.`
    });
  }
  return destinationRow({
    name: 'Crisis', dim: true,
    reading: reading.crisisEligible ? 'none today' : 'nothing is authored here',
    sentence: reading.crisisEligible
      ? 'No Crisis is calling here today. One may on another day, and nothing is lost while none does.'
      : 'No Crisis has been written for this world. Nothing about it is missing while that stays true.'
  });
}

function chaptersRow(store, reading) {
  const { content, state } = store;
  const total = reading.nodes.length;
  const clearedCount = reading.cleared.length;
  const chapterNodes = reading.frontier
    ? reading.nodes.filter(node => node.chapter === reading.frontier.chapter) : [];
  const chapterCleared = chapterNodes.filter(node => nodeState(state, node.id).cleared).length;
  const rule = h('div.world-progress', { 'aria-hidden': 'true' },
    h('i.world-progress-cleared', { style: { width: `${total ? clearedCount / total * 100 : 0}%` } }),
    h('i.world-progress-chapter', {
      style: { width: `${total ? (chapterNodes.length - chapterCleared) / total * 100 : 0}%` }
    }));
  // This world's chapters live here rather than in the Journey, so the line
  // opens the campaign at the chapter the frontier sits in.
  const open = () => store.go(`#/campaign/${reading.world.campaignId}/${
    reading.frontier?.chapter ?? reading.chapters[0] ?? 1}`);
  let sentence;
  if (!total) sentence = 'No chapters have been published for this world yet.';
  else if (!reading.frontier) {
    sentence = ['Every published threshold here has been cleared. ',
      h('button.link', { onclick: open }, 'Walk it again →')];
  } else if (!reading.unlocked) {
    sentence = [`${reading.frontier.displayName} is the next threshold. ${reading.entry.owned} of ${reading.entry.needed} of its characters are owned, and the campaign opens at ${reading.entry.needed}. `,
      h('button.link', { onclick: open }, 'Preview the chapters →')];
  } else {
    sentence = [`${reading.frontier.displayName} is the next threshold. `,
      h('button.link', { onclick: open }, 'Continue →')];
  }
  const row = destinationRow({
    name: 'Chapters',
    reading: total ? `Chapter ${reading.chapter} of ${reading.chapters.length} · ${clearedCount} of ${total} cleared` : 'nothing published',
    sentence, dim: !total
  });
  row.insertBefore(rule, row.lastChild);
  return row;
}

// ------------------------------------------------------------- 15c Programs
// The Headquarters row is gone: a world's three Programs are the world's own
// column, read at a glance beside its destinations. Nothing here is a control
// — a Program only needs you when a priority changes, and that is one link.
function programsPanel(store, reading) {
  const world = reading.world;
  const programs = reading.programs;
  const open = () => store.go(`#/programs/${world.id}`);
  const section = h('section.world-programs');
  section.appendChild(h('div.world-programs-top',
    h('div.world-programs-title', 'Programs'),
    h('div.world-programs-reading', 'all three advance on their own')));

  const toShipment = Math.max(0, programs.procurement.threshold
    - programs.procurement.meter % programs.procurement.threshold);
  const material = programs.procurement.family
    ? store.content.materialById[`mat_${programs.procurement.family}_${programs.procurement.grade}`] : null;
  section.appendChild(programRow('Procurement', programs.procurement.meter, programs.procurement.threshold,
    material
      ? `Next shipment: ${programs.procurement.shipmentQty} × ${material.displayName} after ${fmt(toShipment)} more Energy spent here.`
      : programs.procurement.meter > 0
        ? `Banking ${fmt(programs.procurement.meter)} Energy without a chosen material family. Nothing is lost while it waits.`
        : 'Waiting on a material family before it can ship anything. It banks Energy either way.',
    { dim: !material }));

  const hero = programs.development.heroId ? store.content.characterById[programs.development.heroId] : null;
  const toShards = Math.max(0, programs.development.threshold
    - programs.development.meter % programs.development.threshold);
  section.appendChild(programRow('Development', programs.development.meter, programs.development.threshold,
    hero
      ? `Every ${fmt(programs.development.threshold)} shards ${selectorWorldName(world)} heroes receive, ${hero.displayName} gains ${programs.development.bonusShards} more — ${fmt(toShards)} to the next.`
      : programs.development.meter > 0
        ? `Banking ${fmt(programs.development.meter)} shard${programs.development.meter === 1 ? '' : 's'} without a chosen hero. Nothing is lost while it waits.`
        : 'Waiting on a hero to receive its bonus shards. It banks shards either way.',
    { dim: !hero }));

  const toBoost = Math.max(1, programs.operations.threshold
    - programs.operations.meter % programs.operations.threshold);
  section.appendChild(programRow('Operations', programs.operations.meter, programs.operations.threshold,
    programs.operations.boostCycles > 0
      ? `The next cycle board’s ${selectorWorldName(world)} routes carry a visible bonus bundle.`
      : `${countWord(toBoost, { capitalize: true })} more completed ${selectorWorldName(world)} route${toBoost === 1 ? '' : 's'} bank${toBoost === 1 ? 's' : ''} a visible bonus on a future cycle board.`,
    { dim: true }));

  section.appendChild(h('div.fade-rule.world-programs-rule'));
  section.appendChild(h('div.world-program-row.is-slot',
    h('div.world-program-name', 'The relic slot'),
    h('div.world-program-body', h('p.world-program-sentence', relicSlotSentence(store, reading)))));

  section.appendChild(h('p.world-programs-foot',
    'A Program only needs you when a priority changes. ',
    h('button.link', { onclick: open }, 'Change one →')));
  section.appendChild(h('p.world-programs-note',
    'Payouts land at the daily reset. A Program missing its choice banks the meter instead of wasting it — nothing here is ever lost.'));
  return section;
}

function programRow(name, meter, threshold, sentence, { dim = false } = {}) {
  const filled = threshold ? (meter % threshold) / threshold : 0;
  return h('div.world-program-row',
    h('div.world-program-name', name),
    h('div.world-program-body',
      h('div.world-program-meter' + (dim ? '.is-dim' : ''), { 'aria-hidden': 'true' },
        h('i', { style: { width: `${Math.round(Math.min(1, filled) * 100)}%` } })),
      h('p.world-program-sentence' + (dim ? '.is-dim' : ''), sentence)));
}

// The slot states its own gate. A relic held in four pieces is not installable
// — the binding happens on the Mastery track — so this never offers a button
// the Program screen would refuse.
function relicSlotSentence(store, reading) {
  const world = reading.world;
  const relic = reading.relic;
  const slot = reading.programs.relicSlot;
  if (!relic) return 'No relic has been written for this world, so nothing can be installed here.';
  if (!relic.complete) {
    return [`Empty until ${relic.relic.displayName} is whole — ${countWord(relic.ownedCount)} of ${countWord(relic.total)} pieces recovered. `,
      h('button.link', { onclick: () => store.go(`#/mastery/${world.id}`) }, 'See where the rest are buried →')];
  }
  if (!relic.restored) {
    // The Mastery row beside this one is already asking for the binding, so
    // the slot states its own position instead of repeating the sentence.
    return [`Empty until ${relic.relic.displayName} is bound whole — every piece of it is already held. `,
      h('button.link', { onclick: () => store.go(`#/mastery/${world.id}`) }, 'Bind it →')];
  }
  if (!slot) {
    return [`${relic.relic.displayName} is whole and waiting for a Program. `,
      h('button.link', { onclick: () => store.go(`#/programs/${world.id}`) }, 'Install it →')];
  }
  return `${relic.relic.displayName} sits in ${PROGRAM_NAMES[slot]}, and can be moved again any time.`;
}

function masteryRow(store, reading) {
  const world = reading.world;
  const mastery = reading.mastery;
  const relic = reading.relic;
  const open = () => store.go(`#/mastery/${world.id}`);
  let sentence;
  if (reading.pendingChoices.length) {
    sentence = [`${countWord(reading.pendingChoices.length, { capitalize: true })} milestone reward${reading.pendingChoices.length === 1 ? ' is' : 's are'} waiting on a choice. `,
      h('button.link', { onclick: open }, 'Choose →')];
  } else if (relic?.complete && !relic.restored) {
    // The one thing this track ever asks for outright: it is finished, and
    // waiting to be put back together.
    sentence = [`All four pieces of ${relic.relic.displayName} are held, and it is still in pieces. `,
      h('button.link', { onclick: open }, 'Restore it whole →')];
  } else if (relic && !relic.complete) {
    const nextPiece = relic.pieces.find(entry => !entry.owned);
    sentence = [nextPiece?.sourceNode
      ? `${nextPiece.piece.displayName} is still buried at ${nextPiece.sourceNode.displayName}. `
      : 'The relic is still in pieces. ',
    h('button.link', { onclick: open }, 'Open the track →')];
  } else if (mastery.next) {
    sentence = [`${fmt(mastery.next.at - mastery.score)} points from ${mastery.next.displayName}. `,
      h('button.link', { onclick: open }, 'Open the track →')];
  } else {
    sentence = ['This world is Mastered — everything it can teach has been learned. ',
      h('button.link', { onclick: open }, 'Open the track →')];
  }
  return destinationRow({
    name: 'Mastery',
    reading: `${fmt(mastery.score)} of ${fmt(mastery.max)} · ${mastery.displayName}`
      + (relic ? ` · relic ${relic.restored ? 'whole' : `${relic.ownedCount} of ${relic.total}`}` : ''),
    sentence, dim: mastery.score === 0
  });
}
