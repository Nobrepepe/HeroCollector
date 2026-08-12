import { h, fmt } from './dom.js';
import {
  readyUpgrades, nodeState, nodeUnlocked, completeGearTier, promoteStar,
  unlockCharacter, movePin, removePin
} from '../core/state.js';
import { analyzePinnedGoals } from '../core/progression.js';
import { portrait, campaignLabel } from './shared.js';
import { openFindSources } from './find-sources.js';
import { craftEquipmentWithConfirmation, openGearDialog } from './gear.js';
import {
  campaignFrontiers, rankTodayHook, todayHookText, sceneImage, selectedPartyPower
} from './presentation.js';
import { previewFieldSupplyUse } from '../core/energy.js';

export function renderHome(store, root) {
  const { content, state } = store;
  const ready = readyUpgrades(content, state);
  const frontiers = campaignFrontiers(content, state, nodeState, nodeUnlocked);
  const frontier = frontiers[0] ?? null;
  const hook = rankTodayHook(content, state, ready, frontiers);
  const hookText = todayHookText(hook);
  const scene = sceneImage(store, frontier);

  const page = h('div.today-page');
  page.appendChild(h('div.today-backdrop' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}
  }));
  const featuredId = hook.def?.id ?? ready[0]?.characterId ?? content.characters.find(def => state.characters[def.id].owned)?.id;
  const fullBody = featuredId ? content.images.fullBody[featuredId] : null;
  if (fullBody) page.appendChild(h('img.today-hero.bleed-tall', {
    src: fullBody,
    alt: `Open ${content.characterById[featuredId].displayName}`,
    role: 'link', tabindex: 0,
    onclick: () => store.go(`#/character/${featuredId}`),
    onkeydown: event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        store.go(`#/character/${featuredId}`);
      }
    }
  }));

  const recent = h('div.today-recent', h('div.eyebrow', 'Recent progress'));
  const entries = state.progressLog.slice(0, 3);
  recent.append(...(entries.length
    ? entries.map(entry => h('div.caption', entry.text))
    : [h('div.caption', 'Your next milestone will appear here.')]));
  page.appendChild(recent);

  const contentCol = h('div.today-content',
    h('div.eyebrow', new Intl.DateTimeFormat('en', { weekday: 'long' }).format(store.now())),
    h('h1.display-m', hookText.headline),
    h('p.today-route', routeSentence(store, hook), ' ',
      h('button.link', { onclick: () => store.go(hookText.route) }, 'Show me →')));

  contentCol.appendChild(h('div.fade-rule'));
  contentCol.appendChild(continueThread(store, frontier));
  contentCol.appendChild(h('div.fade-rule'));
  contentCol.appendChild(readyThread(store, ready));
  contentCol.appendChild(h('div.fade-rule'));
  contentCol.appendChild(trackingThread(store));
  page.appendChild(contentCol);
  root.appendChild(page);
}

function routeSentence(store, hook) {
  if (hook.kind === 'crisis') return hook.crisis.status === 'planning'
    ? `The response in ${store.content.worldById[hook.crisis.worldId].displayName} costs no Energy and closes at the next reset.`
    : 'One deterministic reward choice remains before the day closes.';
  if (hook.kind === 'shards') {
    const sources = store.content.shardNodesByCharacter[hook.def.id] ?? [];
    return sources.length ? `The quickest route is ${sources[0].displayName}.` : 'Their next shard source is still waiting to be authored.';
  }
  if (hook.kind === 'gear') return 'Every required component is already in your Workshop.';
  if (hook.kind === 'campaign') return `Your journey continues at ${hook.node.displayName}.`;
  return 'Explore the Journey or choose a goal to begin another thread.';
}

function continueThread(store, node) {
  const wrap = h('section.today-thread', h('div.eyebrow', 'Continue'));
  if (!node) {
    wrap.appendChild(h('p.muted', 'Every currently available campaign is complete.'));
    return wrap;
  }
  const supply = previewFieldSupplyUse(store.content, store.state);
  const scene = sceneImage(store, node);
  const selected = selectedPartyPower(store, node);
  const thresholdClass = selected.effective >= node.threshold ? 'good' : 'bad';
  wrap.appendChild(h('div.continue-row',
    h('div.continue-thumb.bleed-wide' + (scene ? '' : '.art-fallback'), {
      style: scene ? { backgroundImage: `url("${scene}")` } : {}
    }),
    h('div.grow',
      h('div.title', node.displayName),
      h('div.caption', `${campaignLabel(store, node)} ${node.number} · needs `,
        h('span', fmt(node.threshold)), ' Power · your ', selected.party?.name ?? 'party', ' reads ',
        h(`span.${thresholdClass}`, fmt(selected.effective)))),
    h('div.continue-action',
      h('button.btn.primary', { onclick: () => store.go(`#/node/${node.id}`) }, 'Enter →'),
      h('div.caption', `⚡ ${store.content.balance.nodeDefaults[node.type].energy}`))));
  if (store.state.energy < store.content.balance.nodeDefaults[node.type].energy && supply.ok) {
    wrap.appendChild(h('p.today-supply',
      h('span.today-supply-dot', { 'aria-hidden': 'true' }),
      h('span', 'The day is spent, but one Field Supply is waiting. ',
        h('button.link', { onclick: () => document.querySelector('.sidebar-energy')?.click() },
          `Restore ${supply.restored} Energy →`))));
  }
  return wrap;
}

function readyThread(store, ready) {
  const wrap = h('section.today-thread', h('div.eyebrow', 'Ready when you are'));
  if (!ready.length) {
    wrap.appendChild(h('p.muted', 'Nothing is waiting — farm materials or shards to open the next upgrade.'));
    return wrap;
  }
  const shown = ready.length > 3 ? ready.slice(0, 2) : ready.slice(0, 3);
  const row = h('div.ready-thread-row');
  shown.forEach((item, index) => {
    const def = store.content.characterById[item.characterId];
    row.appendChild(h('div.ready-thread-item',
      h('button.ready-character-link', {
        onclick: () => store.go(`#/character/${item.characterId}`),
        'aria-label': `Open ${def.displayName}`
      }, portrait(store, item.characterId, 'ready', { pulse: index === 0, decorative: true })),
      h('div', h('div', def.displayName), h('div.caption', item.text.replace(`${def.displayName}: `, '')),
        readyAction(store, item))));
  });
  if (ready.length > 3) row.appendChild(h('button.ready-more', {
    onclick: () => {
      Object.assign(store.state.ui.roster, { ownership: 'ready', sort: 'ready', direction: 'desc' });
      store.save().then(() => store.go('#/roster'));
    }
  }, h('span.numeral', `+${ready.length - 2}`), h('span', 'more are ready →')));
  wrap.appendChild(row);
  return wrap;
}

function readyAction(store, item) {
  const click = {
    completeTier: () => store.tx(() => completeGearTier(store.content, store.state, item.characterId)),
    promoteStar: () => store.tx(() => promoteStar(store.content, store.state, item.characterId)),
    craftEquipment: () => craftEquipmentWithConfirmation(store, item.characterId, item.slot),
    unlock: () => store.tx(() => unlockCharacter(store.content, store.state, item.characterId))
  }[item.type];
  const verb = item.type === 'completeTier' ? 'Finish it →'
    : item.type === 'promoteStar' || item.type === 'unlock' ? 'Promote →' : 'Craft →';
  return h('button.link.ready-verb', { onclick: click }, verb);
}

function trackingThread(store) {
  const { content, state } = store;
  const analysis = analyzePinnedGoals(content, state);
  const wrap = h('section.today-thread', h('div.eyebrow', 'Tracking'));
  if (!state.pins.length) {
    wrap.appendChild(h('p.muted', 'Pin a shard goal or equipment recipe to keep it in sight.'));
    return wrap;
  }
  state.pins.forEach((pin, index) => {
    const def = content.characterById[pin.characterId];
    let label;
    let current = 0;
    let total = 1;
    let action;
    if (pin.type === 'character') {
      const cs = state.characters[pin.characterId];
      total = pin.objective === 'unlock'
        ? content.balance.acquisitionTiers[def.tier].cumulativeShards
        : content.balance.starShards[pin.targetStars - 1];
      current = cs.shards;
      label = `${def.displayName} · ${pin.objective === 'unlock' ? 'unlock' : `${pin.targetStars}★`}`;
      action = () => openFindSources(store, { type: 'shards', id: pin.characterId });
    } else {
      const goal = analysis.goals.find(entry => entry.pin.characterId === pin.characterId && entry.pin.slot === pin.slot)?.analysis;
      const missing = Object.values(goal?.totalMaterialMissing ?? {}).reduce((sum, n) => sum + n, 0);
      const demand = Object.values(goal?.totalMaterialDemand ?? {}).reduce((sum, n) => sum + n, 0);
      current = Math.max(0, demand - missing); total = Math.max(1, demand);
      label = `${def.displayName} · ${goal?.equipmentName ?? content.characterMeta.slots[pin.slot].name}`;
      action = () => openGearDialog(store, pin.characterId, pin.slot);
    }
    const controls = h('div.tracking-controls',
      h('button', { disabled: index === 0, 'aria-label': `Move ${label} up`, onclick: () => store.tx(() => movePin(state, index, -1)) }, '↑'),
      h('button', { disabled: index === state.pins.length - 1, 'aria-label': `Move ${label} down`, onclick: () => store.tx(() => movePin(state, index, 1)) }, '↓'),
      h('button', { onclick: action }, 'open'),
      h('button', { onclick: () => store.tx(() => removePin(state, pin)) }, 'unpin'));
    wrap.appendChild(h('div.tracking-row',
      h('div.tracking-top', h('span', label), h('span', h('b.numeral', fmt(current)), ` / ${fmt(total)}`)),
      h('div.progressbar', h('div', { style: { width: `${Math.min(100, current / total * 100)}%` } })),
      controls));
  });
  return wrap;
}
