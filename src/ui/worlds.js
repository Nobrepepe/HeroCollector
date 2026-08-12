// Turn 12 — Worlds. Two decisions carry the whole surface: selection is a
// stage rather than a grid, so one world holds the art at a time and worlds
// read as places; and the hub has no tiles, so every destination is a line
// with its own live reading and an untouched world is visibly emptier than
// one you live in.
import { h, fmt } from './dom.js';
import { archiveStatus, nodeState, worldCampaignUnlocked } from '../core/state.js';
import { facilityLevel, hqRank } from '../core/hq.js';
import { canAffordEntries, resourceQty } from '../core/resources.js';
import { eligibleCrisisDefinitions } from '../core/crises.js';
import { portrait, selectorWorldName } from './shared.js';
import { charactersByWorld, countWord, ordinalWord } from './presentation.js';

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
  const seen = roster.some(def => state.characters[def.id]?.owned || state.characters[def.id]?.shards > 0);
  const entry = worldCampaignUnlocked(content, state, world.id);
  const nodes = content.nodesByCampaign[world.campaignId] ?? [];
  const chapters = [...new Set(nodes.map(node => node.chapter))].sort((a, b) => a - b);
  const cleared = nodes.filter(node => nodeState(state, node.id).cleared);
  const frontier = nodes.find(node => !nodeState(state, node.id).cleared) ?? null;
  const chapter = frontier ? chapters.indexOf(frontier.chapter) + 1 : chapters.length;
  const archive = content.archiveByWorld[world.id] ? archiveStatus(content, state, world.id) : null;
  const active = state.crises?.active;
  const crisis = active?.worldId === world.id ? active : null;
  // A Crisis still wants an answer while it is unresolved, and again while its
  // Cache is unclaimed. Once both are done it is settled — still today's
  // event, but nothing is asked of you.
  const wantsAnswer = !!crisis && (crisis.status === 'planning'
    || (crisis.status === 'resolved' && crisis.result?.outcome !== 'endured' && !crisis.cacheClaimed));
  const away = (state.expeditions?.active ?? []).filter(item => item.world === world.id);
  return {
    world, roster, owned, seen, entry, nodes, chapters, cleared, frontier,
    chapter: Math.max(1, chapter), archive, away,
    unlocked: entry.unlocked,
    hqFounded: !!world.hq?.enabled,
    hqRank: world.hq?.enabled ? hqRank(content, state, world.id) : 0,
    currency: resourceQty(state, world.worldAsset.id),
    crisis, crisisActive: wantsAnswer ? crisis : null,
    crisisSettled: !!crisis && !wantsAnswer,
    crisisEligible: eligibleCrisisDefinitions(content, state).some(def => def.worldId === world.id)
  };
}

function stateWord(reading) {
  if (reading.crisisActive) return { text: 'crisis', tone: 'bad' };
  if (reading.crisisSettled) return { text: 'answered', tone: 'faint' };
  if (reading.away.length) return { text: `${reading.away.length} out`, tone: 'faint' };
  if (reading.unlocked && !reading.cleared.length) return { text: 'new', tone: 'good' };
  return null;
}

function readingLine(reading) {
  return [
    `Chapter ${reading.chapter} of ${reading.chapters.length || 1}`,
    reading.hqFounded ? `HQ Rank ${reading.hqRank}` : 'no Headquarters',
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
        h('div.world-held-number' + (reading.currency ? '' : '.is-zero'), fmt(reading.currency)),
        h('div.world-held-label', world.worldAsset.displayName)),
      h('div',
        h('div.world-held-number', String(reading.owned.length),
          h('span.world-held-of', ` / ${reading.roster.length}`)),
        h('div.world-held-label', 'characters')))));

  page.appendChild(h('div.fade-rule.world-hub-rule'));
  page.appendChild(h('div.world-hub-body',
    destinations(store, reading),
    h('div.world-hub-side', rosterPanel(store, reading), h('div.fade-rule.world-side-rule'), routesPanel(store, reading))));
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
  rows.push(chaptersRow(store, reading), headquartersRow(store, reading), relicsRow(store, reading));
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

function headquartersRow(store, reading) {
  const { content, state } = store;
  const world = reading.world;
  if (!reading.hqFounded) {
    return destinationRow({
      name: 'Headquarters', dim: true, reading: 'not founded',
      sentence: 'No grounds have been broken here. Nothing about this world is missing while it stays that way.'
    });
  }
  // In a preview the destination is inert and states its gate.
  if (!reading.unlocked) {
    return destinationRow({
      name: 'Headquarters', dim: true, reading: `Rank ${reading.hqRank} · closed`,
      sentence: `${world.worldAsset.displayName} pays for everything built here, and it is only earned inside this campaign. The grounds wait until the campaign opens.`
    });
  }
  const build = state.headquarters.construction;
  const here = build?.worldId === world.id ? build : null;
  const next = world.hq.facilities
    .map(facility => ({ facility, next: facility.levels[facilityLevel(state, world.id, facility.id)] }))
    .filter(entry => entry.next)
    .find(entry => canAffordEntries(content, state, entry.next.cost, world.id).ok);
  const clauses = [];
  if (here) clauses.push(`${here.facilityName} reaches Level ${here.targetLevel} on day ${here.dueDay}`);
  clauses.push(next ? `the ${next.facility.displayName} is affordable now` : 'nothing new is affordable yet');
  const prose = `${clauses.join('; ')}. `;
  return destinationRow({
    name: 'Headquarters',
    reading: `Rank ${reading.hqRank}${here ? ` · building until day ${here.dueDay}` : ''}`,
    sentence: [prose[0].toUpperCase() + prose.slice(1),
      h('button.link', { onclick: () => store.go(`#/headquarters/${world.id}`) }, 'Visit →')]
  });
}

function relicsRow(store, reading) {
  const { content, state } = store;
  if (!reading.archive) {
    return destinationRow({
      name: 'Relics', dim: true, reading: 'no Archive here',
      sentence: 'No Archive has been written for this world. Nothing is waiting to be recovered.'
    });
  }
  if (!reading.unlocked) {
    return destinationRow({
      name: 'Relics', dim: true,
      reading: `${reading.archive.relicsDone} of ${reading.archive.relicsTotal} recovered`,
      sentence: 'Every piece is buried in this campaign, so none can be recovered until it opens.'
    });
  }
  const status = reading.archive;
  // The next relic is named by where its first missing fragment is buried.
  const nextRelic = status.collections
    .flatMap(collection => collection.relics)
    .find(entry => !entry.complete);
  const missing = nextRelic?.relic.fragments.find(fragment => !state.archive.fragments[fragment.id]);
  const node = missing ? content.nodeById[missing.sourceNode] : null;
  const sentence = nextRelic
    ? [node ? `${nextRelic.relic.displayName} is still missing a piece, buried at ${node.displayName}. ` : `${nextRelic.relic.displayName} is still missing a piece. `,
      h('button.link', { onclick: () => store.go(`#/archive/${reading.world.id}`) }, 'Open the Archive →')]
    : ['Every relic here is whole. ',
      h('button.link', { onclick: () => store.go(`#/archive/${reading.world.id}`) }, 'Open the Archive →')];
  return destinationRow({
    name: 'Relics',
    reading: `${status.relicsDone} of ${status.relicsTotal} recovered`,
    sentence, dim: status.relicsDone === 0
  });
}

function rosterPanel(store, reading) {
  const { content, state } = store;
  const section = h('section.world-roster',
    h('div.eyebrow', `${selectorWorldName(reading.world)} characters`));
  const tiles = h('div.world-roster-tiles');
  reading.owned.forEach(def => tiles.appendChild(portrait(store, def.id, 'world-tile', { decorative: true })));
  for (let index = reading.owned.length; index < reading.roster.length; index++) {
    tiles.appendChild(h('div.world-roster-empty', { 'aria-hidden': 'true' }));
  }
  section.appendChild(tiles);

  const away = reading.away.flatMap(item => item.party)
    .filter(id => content.characterById[id]?.world === reading.world.id);
  if (reading.owned.length >= content.balance.partySize) {
    section.appendChild(h('p.world-roster-copy',
      away.length
        ? `${countWord(away.length, { capitalize: true })} ${away.length === 1 ? 'is' : 'are'} away on Expeditions and still count everywhere. `
        : 'All of them are here, and none is committed elsewhere. ',
      h('button.link', { onclick: () => openFilteredCollection(store, reading.world.id) }, 'Open the Collection, filtered →')));
    return section;
  }
  // A thin roster is told what would thicken it rather than how empty it is.
  const reachable = reading.roster
    .filter(def => !state.characters[def.id]?.owned && (content.shardNodesByCharacter[def.id] ?? []).length)
    .slice(0, 2);
  section.appendChild(h('p.world-roster-copy',
    reachable.length
      ? `${countWord(reachable.length, { capitalize: true })} more ${reachable.length === 1 ? 'is' : 'are'} reachable — ${reachable
        .map(def => `${def.displayName} from ${(content.shardNodesByCharacter[def.id] ?? [])[0].displayName}`).join(', and ')}. `
      : 'No shard source for this world has been published yet, so the roster cannot grow here today. ',
    reachable.length
      ? h('button.link', { onclick: () => store.go(`#/character/${reachable[0].id}`) }, 'Show me →')
      : h('button.link', { onclick: () => openFilteredCollection(store, reading.world.id) }, 'Open the Collection, filtered →')));
  return section;
}

function openFilteredCollection(store, worldId) {
  Object.assign(store.state.ui.roster, { world: worldId, ownership: 'all' });
  store.save().then(() => store.go('#/roster'));
}

function routesPanel(store, reading) {
  const section = h('section.world-routes', h('div.eyebrow', 'Routes leaving from here'));
  const offers = (store.state.expeditions.board?.offers ?? []).filter(offer => offer.world === reading.world.id);
  if (!offers.length && !reading.away.length) {
    section.appendChild(h('p.world-routes-empty',
      `No ${selectorWorldName(reading.world)} route is on the board today. ${reading.owned.length
        ? `Across-world routes still accept these ${countWord(reading.owned.length)}.`
        : 'Across-world routes accept anyone once someone from here has joined you.'}`));
    return section;
  }
  const row = h('div.world-routes-row');
  row.appendChild(h('div.grow', offers.length
    ? [h('div.world-route-name', offers[0].name),
      h('div.caption', `on the board today · ${offers[0].partySize} characters`)]
    : [h('div.world-route-name', 'Nothing on the board'),
      h('div.caption', 'across-world routes still accept these characters')]));
  row.appendChild(h('div.grow', reading.away.length
    ? [h('div.world-route-name', `${countWord(reading.away.length, { capitalize: true })} away`),
      h('div.caption', reading.away.length === 1
        ? `returns on day ${reading.away[0].returnDay}`
        : `${new Set(reading.away.map(item => item.returnDay)).size === 1 ? 'both return' : 'they return'} on day ${Math.min(...reading.away.map(item => item.returnDay))}`)]
    : [h('div.world-route-name', 'None away'),
      h('div.caption', 'every one of them is here')]));
  row.appendChild(h('button.link.world-routes-link', { onclick: () => store.go('#/expeditions') }, 'Expeditions →'));
  section.appendChild(row);
  return section;
}
