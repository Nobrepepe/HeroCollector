// World Mastery, led by the relic (design turn 15b/16).
//
// The score here is fully derived — campaign, heroes, gear and the relic
// pieces — so it moves when you play anywhere else, which makes it a
// consequence rather than a goal. The four buried pieces are the goal: the
// only part of this track you go somewhere to get, and the only thing on it
// you finish by hand. Cosmetics and finite caches live here; nothing on this
// screen is a passive percentage.
import { h, fmt } from './dom.js';
import { openModal, render, toast } from '../app.js';
import { dressModal, modalHead, modalAction, modalActions, modalDismiss } from './modal.js';
import {
  worldMasteryBreakdown, masteryRank,
  applyMasteryMilestones, resolveMasteryChoice
} from '../core/mastery.js';
import { relicStatus, restoreRelic } from '../core/relics.js';
import { PROGRAM_NAMES } from '../core/programs.js';
import { isRevealed } from '../core/focus.js';
import { portrait, selectorWorldName } from './shared.js';
import { countWord } from './presentation.js';
import { playRelicRestore, settleRelicRestore } from './relic-restore.js';

export function renderMastery(store, root, arg) {
  const { content, state } = store;
  const world = content.worldById[arg]
    ?? content.worldById[state.ui.selectedWorldId]
    ?? content.worlds[0];
  if (!world) {
    root.appendChild(h('p.muted', 'No world is live in this content set.'));
    return;
  }
  const breakdown = worldMasteryBreakdown(content, state, world.id);
  const rank = masteryRank(content, state, world.id);
  const page = h('div.mastery-page');
  page.appendChild(h('button.link.worlds-back', {
    onclick: () => store.go(`#/worlds/${world.id}`)
  }, `← ${selectorWorldName(world)}`));
  page.appendChild(h('header.mastery-head',
    h('div.eyebrow', `${world.displayName} · Mastery · ${rank.displayName}`)));

  // The relic leads. Mastery's score is fully derived — it moves when you play
  // anywhere else — so it is a consequence, not a goal; the four buried pieces
  // are the only part of this track you go somewhere to get.
  page.appendChild(ledgerBlock(store, world, breakdown, rank));
  page.appendChild(milestonesPanel(store, world, breakdown));
  root.appendChild(page);

  // A binding that just committed plays here, on the settled page, before the
  // browser has painted it.
  playRelicRestore(store, page, world.id);
}

function milestonesPanel(store, world, breakdown) {
  const { content, state } = store;
  const config = content.balance.mastery;
  const ms = state.mastery[world.id] ?? { claimedRanks: [], pendingChoices: [] };
  const panel = h('section.panel.mastery-milestones', h('div.eyebrow', 'Milestones'));
  // Content changes can move a score past a rank outside any transaction;
  // the track then offers the milestone rather than granting it silently.
  const unclaimed = config.ranks.some(rank => rank.at > 0 && breakdown.score >= rank.at && !ms.claimedRanks.includes(rank.id));
  if (unclaimed) {
    panel.appendChild(h('button.btn.primary', {
      onclick: () => store.tx(() => ({ ok: true, events: applyMasteryMilestones(content, state, world.id) }))
    }, 'Claim the crossed milestones'));
  }
  for (const rank of config.ranks) {
    if (rank.at <= 0) continue;
    const claimed = ms.claimedRanks.includes(rank.id);
    const reached = breakdown.score >= rank.at;
    const milestone = config.milestones?.[rank.id] ?? {};
    const skins = (world.masterySkins ?? []).filter(entry => entry.rank === rank.id);
    const parts = [];
    if (milestone.supplies) parts.push(`${milestone.supplies} Field Suppl${milestone.supplies === 1 ? 'y' : 'ies'}`);
    if (milestone.materialCache) parts.push(`a cache of ${milestone.materialCache} materials of a chosen family`);
    if (milestone.shardChoice) parts.push(`${milestone.shardChoice} shards for a chosen revealed hero of this world`);
    for (const skin of skins) {
      parts.push(`${content.characterById[skin.characterId]?.displayName ?? ''} — “${skin.skinName}”`);
    }
    const row = h('div.mastery-milestone' + (claimed ? '.is-claimed' : reached ? '' : '.is-locked'),
      h('div.mastery-milestone-top',
        h('span.mastery-milestone-rank', `${rank.displayName} · ${fmt(rank.at)}`),
        h('span.small' + (claimed ? '.good' : '.muted'), claimed ? 'claimed' : reached ? 'reached' : `${fmt(rank.at - breakdown.score)} away`)),
      h('div.small.muted', parts.join(' · ') || 'nothing attached'));
    const pending = ms.pendingChoices.filter(choice => choice.rankId === rank.id);
    for (const choice of pending) {
      row.appendChild(choice.kind === 'materialCache'
        ? h('button.link', { onclick: () => openCacheChoice(store, world, choice) }, `Choose the cache’s family (${choice.qty} materials) →`)
        : h('button.link', { onclick: () => openShardChoice(store, world, choice) }, `Choose who receives the ${choice.qty} shards →`));
    }
    panel.appendChild(row);
  }
  return panel;
}

function openCacheChoice(store, world, choice) {
  const { content } = store;
  openModal((modal, close) => {
    dressModal(modal, { size: 'sheet' });
    modal.appendChild(modalHead(`${world.displayName} · milestone`, 'Which family should the cache hold?',
      { lead: `${choice.qty} materials at the best grade this world has opened.` }));
    for (const family of content.materialMeta.familyOrder) {
      const meta = content.materialMeta.families[family];
      modal.appendChild(modalAction(`${meta.icon} ${meta.name}`, {
        onclick: async () => {
          const result = await store.tx(() =>
            resolveMasteryChoice(content, store.state, world.id, choice.rankId, { family }), { rerender: false });
          if (result.ok) {
            toast(`The cache delivered ${result.granted[0].qty} × ${content.materialById[result.granted[0].id].displayName}.`);
            close();
            render();
          }
        }
      }));
    }
    modal.appendChild(modalActions(modalDismiss('Decide later', close)));
  });
}

function openShardChoice(store, world, choice) {
  const { content, state } = store;
  const heroes = content.characters.filter(def => def.world === world.id && isRevealed(state, def.id))
    .filter(def => !(state.characters[def.id].owned && state.characters[def.id].stars >= 7));
  openModal((modal, close) => {
    dressModal(modal, { size: 'wide' });
    modal.appendChild(modalHead(`${world.displayName} · milestone`, `Who receives the ${choice.qty} shards?`,
      { lead: 'Any revealed hero of this world — recruited or not.' }));
    const list = h('div.supply-target-list');
    for (const def of heroes) {
      list.appendChild(h('button.supply-target-row', {
        onclick: async () => {
          const result = await store.tx(() =>
            resolveMasteryChoice(content, store.state, world.id, choice.rankId, { characterId: def.id }), { rerender: false });
          if (result.ok) {
            toast(`${def.displayName} received ${choice.qty} shards.`);
            close();
            render();
          }
        }
      },
      portrait(store, def.id, 'sm', { decorative: true }),
      h('div.grow', h('div', def.displayName),
        h('div.small.muted', state.characters[def.id].owned ? `${state.characters[def.id].stars}★` : `${fmt(state.characters[def.id].shards)} shards banked`)),
      h('div.small.good', `+${choice.qty}`)));
    }
    modal.appendChild(list);
    modal.appendChild(modalActions(modalDismiss('Decide later', close)));
  });
}

// ------------------------------------------------------------- the ledger
// One image per world, torn in four. Each cell renders a quarter of the same
// plate at background-size: 200% 200%, so a recovered piece uncovers part of
// the actual relic rather than showing a fourth icon — by the third piece you
// can nearly read the thing. A world with no relic art renders this exact
// layout, empty; the fixed cell is the design either way.
const QUADRANTS = ['0% 0%', '100% 0%', '0% 100%', '100% 100%'];

function ledgerBlock(store, world, breakdown, rank) {
  const { content, state } = store;
  const status = relicStatus(content, state, world.id);
  const block = h('section.mastery-ledger');
  if (!status) {
    // No relic authored here: the track is the whole screen, and says so.
    block.appendChild(h('div.mastery-ledger-side',
      h('h2.mastery-relic-name', 'No relic'),
      h('p.muted', 'No relic has been written for this world. Nothing about the track is missing while that stays true.'),
      trackPanel(store, world, breakdown, rank)));
    return block;
  }
  block.appendChild(h('div.mastery-ledger-board',
    relicBoard(store, status),
    h('p.relic-board-note', boardNote(status))));
  block.appendChild(h('div.mastery-ledger-side',
    h('h2.mastery-relic-name', status.relic.displayName),
    status.relic.lore ? h('p.mastery-relic-lore', status.relic.lore) : null,
    h('div.fade-rule.mastery-ledger-rule'),
    pieceList(store, status),
    bindingLine(store, world, status),
    trackPanel(store, world, breakdown, rank)));
  return block;
}

function relicBoard(store, status) {
  const image = store.content.images.relic[status.relic.world] ?? null;
  const board = h('div.relic-board' + (status.restored ? '.is-bound' : ''), {
    role: 'img',
    'aria-label': `${status.relic.displayName} — ${countWord(status.ownedCount)} of ${countWord(status.total)} pieces recovered${status.restored ? ', bound whole' : ''}`
  });
  // The next unrecovered piece is the next station; everything past it is
  // fainter, because the track never states what lies beyond it.
  const nextIndex = status.pieces.findIndex(entry => !entry.owned);
  status.pieces.forEach((entry, index) => {
    const beyond = !entry.owned && nextIndex !== -1 && index > nextIndex;
    const cell = h('div.relic-cell' + (entry.owned ? '.is-owned' : beyond ? '.is-beyond' : ''), {
      'aria-hidden': 'true'
    });
    if (entry.owned && image) {
      Object.assign(cell.style, {
        backgroundImage: `url("${image}")`,
        backgroundSize: '200% 200%',
        backgroundPosition: QUADRANTS[index % 4]
      });
    }
    board.appendChild(cell);
  });
  // The bound plate: the same asset unquartered. It is rendered whether or not
  // the relic is bound so the restore sequence has something to cross-fade to.
  const plate = h('div.relic-plate', { 'aria-hidden': 'true' });
  if (image) plate.style.backgroundImage = `url("${image}")`;
  else plate.classList.add('is-unarted');
  board.appendChild(plate);
  return board;
}

function boardNote(status) {
  if (status.restored) return 'Whole, and back in one piece.';
  if (status.complete) return 'All four are held, and the gaps are still there.';
  return `${countWord(status.ownedCount, { capitalize: true })} of ${countWord(status.total)} recovered. `
    + 'The relic is the only part of Mastery you go somewhere to get.';
}

function pieceList(store, status) {
  const perPiece = Math.floor((store.content.balance.mastery.weights.relic ?? 0) / status.total);
  const list = h('div.relic-piece-list');
  for (const entry of status.pieces) {
    list.appendChild(h('div.relic-piece-row' + (entry.owned ? '.is-owned' : ''),
      h('span.relic-piece-mark', { 'aria-hidden': 'true' }, entry.owned ? '✓' : '◇'),
      h('span.relic-piece-name', entry.piece.displayName),
      h('span.relic-piece-lore', { title: entry.piece.lore || null }, entry.piece.lore || ''),
      h('span.relic-piece-where', entry.owned
        ? h('span.good', `recovered · +${perPiece}`)
        : entry.sourceNode
          ? h('button.link', { onclick: () => store.go(`#/node/${entry.sourceNode.id}`) },
            `${entry.sourceNode.displayName} →`)
          : h('span.muted', 'its source is not live'))));
  }
  return list;
}

// The one thing on this track the player does rather than earns. Holding four
// pieces is not owning the relic: until this is pressed the Program slot stays
// empty, so the button is the mechanism and not a flourish over it.
function bindingLine(store, world, status) {
  const { state } = store;
  const line = h('div.relic-binding');
  if (!status.complete) {
    line.appendChild(h('p.small.muted',
      'Each piece adds Mastery on its own. The relic installs into one Program only once it is whole.'));
    return line;
  }
  if (!status.restored) {
    line.appendChild(h('p.relic-binding-copy',
      'The gaps are still there. It is not whole until you say so.'));
    line.appendChild(h('button.btn.primary.relic-bind-button', {
      onclick: () => bindWithFeedback(store, world)
    }, 'Restore it whole →'));
    return line;
  }
  const slot = state.programs[world.id]?.relicSlot ?? null;
  line.appendChild(h('p.relic-binding-copy',
    slot
      ? `Whole, and installed in ${PROGRAM_NAMES[slot]}.`
      : 'Whole, and not yet installed. It improves whichever Program it is placed in.'));
  line.appendChild(h('button.link', {
    onclick: () => store.go(`#/programs/${world.id}`)
  }, slot ? 'Move it →' : 'Install it into a Program →'));
  return line;
}

// The binding commits before a single frame plays, exactly as a promotion
// does: the sequence re-dresses a settled screen and walks it forward, so
// leaving mid-way simply leaves a bound relic behind.
async function bindWithFeedback(store, world) {
  settleRelicRestore();
  const result = await store.tx(() => restoreRelic(store.content, store.state, world.id), { rerender: false });
  if (!result.ok || location.hash !== `#/mastery/${world.id}`) { render(); return; }
  store.ui.relicRestore = { worldId: world.id };
  render();
}

// The score is fully derived — campaign, heroes, gear, and the pieces above —
// which is exactly why it sits underneath them rather than leading. The bar is
// segmented by where the points came from, and it names the next station only.
function trackPanel(store, world, breakdown, rank) {
  const { content } = store;
  const parts = [
    { key: 'campaign', label: 'Campaign', earned: breakdown.campaign },
    { key: 'heroes', label: 'Heroes', earned: breakdown.heroes },
    { key: 'gear', label: 'Gear', earned: breakdown.gear },
    { key: 'relic', label: 'Relic', earned: breakdown.relic, of: breakdown.parts.relic.of }
  ];
  const bar = h('div.mastery-track', { 'aria-label': `${breakdown.score} of ${breakdown.max} Mastery` });
  for (const part of parts) {
    bar.appendChild(h(`i.mastery-track-part.is-${part.key}`, {
      style: { width: `${Math.min(100, part.earned / breakdown.max * 100)}%` },
      title: `${part.label} ${fmt(part.earned)}`
    }));
  }
  bar.appendChild(h('i.mastery-track-rest'));
  const legend = h('div.mastery-track-legend');
  for (const part of parts) {
    legend.appendChild(h('span.mastery-track-key' + (part.key === 'relic' ? '.is-relic' : ''),
      part.of ? `${part.label} ${fmt(part.earned)} of ${fmt(part.of)}` : `${part.label} ${fmt(part.earned)}`));
  }
  const panel = h('section.mastery-standing',
    h('div.eyebrow', 'The track, as a consequence'),
    h('div.mastery-standing-reading',
      h('span.mastery-standing-score', fmt(breakdown.score)),
      h('span.muted', rank.next
        ? `of ${fmt(breakdown.max)} · ${rank.next.displayName} opens at ${fmt(rank.next.at)}`
        : `of ${fmt(breakdown.max)} · everything this world can teach has been learned`)),
    bar, legend);
  // The next station, and nothing beyond it.
  if (rank.next) {
    const milestone = content.balance.mastery.milestones?.[rank.next.id] ?? {};
    const promises = [];
    if (milestone.supplies) promises.push(`${countWord(milestone.supplies)} Field Suppl${milestone.supplies === 1 ? 'y' : 'ies'}`);
    if (milestone.materialCache) promises.push(`a cache of ${countWord(milestone.materialCache)} materials in a family you pick`);
    if (milestone.shardChoice) promises.push(`${countWord(milestone.shardChoice)} shards for a hero you pick`);
    for (const skin of (world.masterySkins ?? []).filter(entry => entry.rank === rank.next.id)) {
      promises.push(`${content.characterById[skin.characterId]?.displayName ?? 'a hero'}’s “${skin.skinName}” look`);
    }
    if (promises.length) {
      panel.appendChild(h('p.mastery-standing-next',
        `${rank.next.displayName} brings ${promises.join(', ')}.`));
    }
  }
  return panel;
}
