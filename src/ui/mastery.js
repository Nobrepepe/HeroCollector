// World Mastery: the visible 0–1,000 track, its milestone rewards, and the
// four-piece relic. Cosmetics and finite caches live here; nothing on this
// screen is a passive percentage.
import { h, fmt } from './dom.js';
import { openModal, render, toast } from '../app.js';
import { dressModal, modalHead, modalAction, modalActions, modalDismiss, artPlaceholder } from './modal.js';
import {
  worldMasteryBreakdown, masteryRank, masteryRankById,
  applyMasteryMilestones, resolveMasteryChoice
} from '../core/mastery.js';
import { relicStatus } from '../core/relics.js';
import { isRevealed } from '../core/focus.js';
import { portrait, selectorWorldName } from './shared.js';

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
    h('div.eyebrow', `${world.displayName} · Mastery`),
    h('h1.mastery-title', rank.displayName),
    h('p.muted', rank.next
      ? `${fmt(breakdown.score)} of ${fmt(breakdown.max)} — ${fmt(rank.next.at - breakdown.score)} points from ${rank.next.displayName}.`
      : `${fmt(breakdown.score)} of ${fmt(breakdown.max)} — everything this world can teach has been learned.`)));

  page.appendChild(trackBar(content, breakdown));
  page.appendChild(breakdownPanel(breakdown));
  page.appendChild(milestonesPanel(store, world, breakdown));
  page.appendChild(relicPanel(store, world));
  root.appendChild(page);
}

function trackBar(content, breakdown) {
  const bar = h('div.mastery-track', { 'aria-label': `${breakdown.score} of ${breakdown.max} Mastery` });
  bar.appendChild(h('i.mastery-track-fill', { style: { width: `${Math.min(100, breakdown.score / breakdown.max * 100)}%` } }));
  for (const rank of content.balance.mastery.ranks) {
    if (rank.at <= 0) continue;
    bar.appendChild(h('span.mastery-marker' + (breakdown.score >= rank.at ? '.is-passed' : ''), {
      style: { left: `${rank.at / breakdown.max * 100}%` }, title: `${rank.displayName} · ${rank.at}`
    }));
  }
  return bar;
}

function breakdownPanel(breakdown) {
  const line = (label, earned, of, detail) => h('div.mastery-part',
    h('div.mastery-part-top', h('span', label), h('span.mastery-part-score', `${fmt(earned)} / ${fmt(of)}`)),
    h('div.small.muted', detail));
  return h('section.panel.mastery-breakdown',
    h('div.eyebrow', 'Where the points come from'),
    line('Campaign first clears', breakdown.campaign, breakdown.parts.campaign.of,
      `${breakdown.parts.campaign.cleared} of ${breakdown.parts.campaign.poolSize} nodes cleared`),
    line('Heroes — discovery, recruitment, Stars', breakdown.heroes, breakdown.parts.heroes.of,
      `${breakdown.parts.heroes.rosterSize} heroes belong to this world`),
    line('Gear development across the roster', breakdown.gear, breakdown.parts.gear.of,
      'every Gear Tier completed by this world’s heroes counts'),
    line('Relic pieces', breakdown.relic, breakdown.parts.relic.of,
      `${breakdown.parts.relic.pieces} of 4 recovered`));
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

function relicPanel(store, world) {
  const { content, state } = store;
  const status = relicStatus(content, state, world.id);
  const panel = h('section.panel.mastery-relic');
  panel.appendChild(h('div.eyebrow', 'The relic'));
  if (!status) {
    panel.appendChild(h('p.muted', 'No relic has been written for this world.'));
    return panel;
  }
  panel.appendChild(h('h2.mastery-relic-name', status.relic.displayName));
  if (status.relic.lore) panel.appendChild(h('p.muted', status.relic.lore));
  const row = h('div.relic-pieces');
  for (const entry of status.pieces) {
    const image = content.images.relic[entry.piece.id] ?? null;
    row.appendChild(h('div.relic-piece' + (entry.owned ? '.is-owned' : ''),
      image
        ? h('img.relic-piece-art', { src: image, alt: '' })
        : artPlaceholder('relic piece — 1024², transparent', { className: 'relic-piece-art' }),
      h('div.relic-piece-name', entry.piece.displayName),
      entry.piece.lore ? h('div.small.muted', entry.piece.lore) : null,
      h('div.small' + (entry.owned ? '.good' : '.muted'),
        entry.owned
          ? 'recovered'
          : entry.sourceNode
            ? ['buried at ', h('button.link', {
              onclick: () => store.go(`#/node/${entry.sourceNode.id}`)
            }, `${entry.sourceNode.displayName} →`)]
            : 'its source is not live')));
  }
  panel.appendChild(row);
  panel.appendChild(h('p.small.muted',
    status.complete
      ? ['The relic is whole. ', h('button.link', { onclick: () => store.go(`#/programs/${world.id}`) }, 'Install it into a Program →')]
      : 'Individual pieces add Mastery; the reconstructed relic installs into one Program.'));
  return panel;
}
