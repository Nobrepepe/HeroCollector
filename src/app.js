// App bootstrap: load content, load/create the save, apply the daily reset,
// then route between screens. All rules live in src/core; screens only call
// transactions and re-render.
import { buildContent } from './core/content.js';
import { validateContent, validateSave } from './core/validate.js';
import { newPlayerState, applyDailyReset, syncSaveWithContent, ensureExpeditionBoard } from './core/state.js';
import { migratePlayerState } from './core/migrate.js';
import { characterPower } from './core/power.js';
import { makeRng, entropySeed } from './core/rng.js';
import { upgradeCustomDB, mergeContent, gameReadiness } from './core/custom.js';
import { loadRawContent, loadSave, writeSave, loadCustomContent, writeCustomContent, loadActiveCustomContent, writeActiveCustomContent, importSave, exportJson } from './platform.js';
import { h, clear, fmt } from './ui/dom.js';
import {
  dressModal, modalHead, modalRule, modalAction, modalActions, modalDismiss, noticeLine
} from './ui/modal.js';
import { portrait, rewardNodes } from './ui/shared.js';
import { countWord, nameList } from './ui/presentation.js';

import { renderHome } from './ui/home.js';
import { renderRoster } from './ui/roster.js';
import { renderCharacter } from './ui/character.js';
import { renderParty } from './ui/party.js';
import { renderCampaign } from './ui/campaign.js';
import { renderNode } from './ui/node.js';
import { renderInventory } from './ui/inventory.js';
import { renderArchive } from './ui/archive.js';
import { renderSettings } from './ui/settings.js';
import { renderDev } from './ui/dev.js';
import { renderCreator } from './ui/creator.js';
import { renderExpeditions } from './ui/expeditions.js';
import { renderWorldHub } from './ui/worldhub.js';
import { worldhub } from './platform.js';
import { renderHeadquarters } from './ui/headquarters.js';
import { renderCrisis } from './ui/crisis.js';
import { renderWorlds } from './ui/worlds.js';
import { renderSplash } from './ui/splash.js';
import { fieldSupplyLimits, previewFieldSupplyUse, useFieldSupply } from './core/energy.js';

const store = {
  content: null,
  state: null,
  rng: null,
  baseRaw: null,
  customDB: null,
  contentHealth: [],
  gameReady: { ready: false, checks: [] },
  ui: {
    modalStack: [],
    scrollPositions: {},
    routeHistory: [],
    returnContext: null,
    activeSearchInput: null,
    pickerPreferences: {
      world: 'all', archetype: 'all', faction: 'all', ownership: 'owned',
      sort: 'power', direction: 'desc'
    },
    compactResult: null,
    // The star promotion waiting to be played on the character screen (13).
    promotion: null
  },
  async beginDay() {
    if (this.ui.dayStarted) return;
    this.ui.dayStarted = true;
    const summary = applyDailyReset(this.content, this.state, this.now());
    await this.save();
    location.hash = '#/home';
    render();
    showDaySummary(summary ?? this.state.lastResetSummary);
    startDayPolling();
  },
  // Dev-only time offset so the developer panel can advance the reset day.
  now() { return Date.now() + (this.state?.devTimeOffsetMs ?? 0); },
  async save() {
    if (this.state.rng) this.state.rng.state = this.rng.getState();
    await writeSave(this.state);
  },
  // Run a core transaction, autosave on success, toast errors, re-render.
  async tx(fn, { rerender = true, quiet = false } = {}) {
    this.ui.transactionBefore = {
      energy: this.state.energy,
      materials: { ...this.state.inventory.materials },
      shards: Object.fromEntries(Object.entries(this.state.characters).map(([id, cs]) => [id, cs.shards])),
      fragments: { ...this.state.archive.fragments },
      power: Object.fromEntries(this.content.characters.map(def => [
        def.id, characterPower(this.content, this.state.characters[def.id])
      ]))
    };
    const result = fn();
    if (result && result.ok === false) {
      if (!quiet) toast((result.reasons ?? ['Action failed.']).join(' '), 'error');
    } else {
      await this.save();
      this.ui.lastPowerByCharacter = this.ui.transactionBefore.power;
      this.ui.lastTransactionResult = result;
    }
    if (rerender) render();
    return result;
  },
  go(hash, options = {}) {
    rememberScroll();
    if (options.returnContext) this.ui.returnContext = options.returnContext;
    else if (!options.preserveReturnContext) this.ui.returnContext = null;
    location.hash = hash;
  },
  registerSearchInput(input) { this.ui.activeSearchInput = input; },
  clearSearchInput(input = null) {
    if (!input || this.ui.activeSearchInput === input) this.ui.activeSearchInput = null;
  },
  clearReturnContext() { this.ui.returnContext = null; },

  async saveCustom() { await writeCustomContent(this.customDB); },

  // Re-merge base + custom content and swap it in live. Never applies an
  // invalid content set: on validation failure the previous content stays.
  async applyCustom({ rerender = false } = {}) {
    const merged = mergeContent(this.baseRaw, this.customDB);
    const content = buildContent(merged.raw);
    const check = validateContent(content);
    if (!check.ok) {
      this.contentHealth = [
        { level: 'error', text: 'Latest changes could not be applied (previous content is still active):' },
        ...check.errors.slice(0, 10).map(e => ({ level: 'error', text: e })),
        ...merged.health
      ];
      return { ok: false, errors: check.errors, health: merged.health };
    }
    content.images = merged.images;
    this.content = content;
    this.contentHealth = merged.health;
    this.gameReady = gameReadiness(content);
    await writeActiveCustomContent(this.customDB);
    if (this.state) {
      syncSaveWithContent(content, this.state);
      await this.save();
    }
    if (rerender) render();
    return { ok: true, errors: [], health: merged.health };
  }
};

// ------------------------------------------------------------- toasts/modals
export function toast(text, kind = 'info') {
  const root = document.getElementById('toast-root');
  const el = h('div.toast' + (kind === 'error' ? '.error' : ''), text);
  root.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

// Every dialog in the game wears the shell established by design turn 10b, so
// a Find-sources sheet and the day-open summary are recognisably the same
// object. `size` only widens it; the grammar inside is the same everywhere.
export function openModal(build, { size = 'sheet', tone = null } = {}) {
  const root = document.getElementById('modal-root');
  root.className = 'open';
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const layer = h('div.modal-layer');
  const titleId = `modal-title-${Date.now()}-${store.ui.modalStack.length}`;
  const modal = h('div.modal', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1'
  });
  dressModal(modal, { size, tone });
  const descriptor = { layer, modal, opener, titleId, build };
  descriptor.openerAria = opener?.getAttribute?.('aria-label') ?? null;
  const close = () => closeModal(descriptor);
  descriptor.close = close;
  const previous = store.ui.modalStack.at(-1);
  if (previous) {
    previous.layer.setAttribute('aria-hidden', 'true');
    previous.modal.inert = true;
  }
  layer.appendChild(h('div.backdrop', { onclick: close }));
  layer.appendChild(modal);
  root.appendChild(layer);
  store.ui.modalStack.push(descriptor);
  build(modal, close);
  const associateTitle = () => {
    const heading = modal.querySelector('h1,h2,h3');
    if (heading) {
      heading.id = titleId;
      modal.removeAttribute('aria-label');
    } else modal.setAttribute('aria-label', 'Dialog');
  };
  associateTitle();
  descriptor.observer = new MutationObserver(associateTitle);
  descriptor.observer.observe(modal, { childList: true });
  modal.addEventListener('keydown', trapModalFocus);
  queueMicrotask(() => {
    const focusable = modal.querySelector(focusableSelector());
    (focusable ?? modal).focus();
  });
  return close;
}

function focusableSelector() {
  return 'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
}

function trapModalFocus(event) {
  if (event.key !== 'Tab') return;
  const modal = event.currentTarget;
  const items = [...modal.querySelectorAll(focusableSelector())].filter(el => !el.hidden);
  if (!items.length) { event.preventDefault(); modal.focus(); return; }
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

function closeModal(descriptor) {
  const index = store.ui.modalStack.indexOf(descriptor);
  if (index < 0) return;
  // Closing a lower descriptor also closes any layers above it.
  const removed = store.ui.modalStack.splice(index);
  for (const item of removed) {
    item.observer?.disconnect();
    item.layer.remove();
  }
  const top = store.ui.modalStack.at(-1);
  if (top) {
    top.layer.removeAttribute('aria-hidden');
    top.modal.inert = false;
    const opener = descriptor.opener?.isConnected
      ? descriptor.opener
      : descriptor.openerAria
        ? [...top.modal.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label') === descriptor.openerAria)
        : null;
    (opener ?? top.modal).focus();
  } else {
    document.getElementById('modal-root').className = '';
    const fallback = descriptor.openerAria
      ? [...document.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label') === descriptor.openerAria)
      : null;
    (descriptor.opener?.isConnected ? descriptor.opener : fallback)?.focus();
  }
}

export function closeTopModal() {
  store.ui.modalStack.at(-1)?.close();
}

export function clearModals({ restoreFocus = false } = {}) {
  const descriptors = store.ui.modalStack.splice(0);
  const opener = descriptors[0]?.opener;
  descriptors.forEach(descriptor => descriptor.observer?.disconnect());
  clear(document.getElementById('modal-root'));
  document.getElementById('modal-root').className = '';
  if (restoreFocus && opener?.isConnected) opener.focus();
}

// ------------------------------------------------------------- routing
const routes = {
  splash: { title: 'Eden', render: renderSplash },
  home: { title: 'Today', icon: '🏠', render: renderHome, nav: true },
  roster: { title: 'Collection', icon: '👥', render: renderRoster, nav: true },
  party: { title: 'Party', icon: '⚔️', render: renderParty, nav: true },
  // Worlds holds everything that belongs to one world — its chapters, its
  // Headquarters, its Archive — so those three are reached through a world
  // rather than sitting beside it in the navigation.
  worlds: { title: 'Worlds', icon: '🌍', render: renderWorlds, nav: true },
  campaign: { title: 'Journey', icon: '🗺️', render: renderCampaign, nav: true },
  expeditions: { title: 'Expeditions', icon: '🧭', render: renderExpeditions, nav: true },
  inventory: { title: 'Workshop', icon: '🎒', render: renderInventory, nav: true },
  settings: { title: 'Settings', icon: '⚙️', render: renderSettings, nav: true },
  headquarters: { title: 'Headquarters', render: renderHeadquarters },
  archive: { title: 'Archive', render: renderArchive },
  character: { title: 'Character', render: renderCharacter },
  node: { title: 'Node', render: renderNode },
  dev: { title: 'Developer Panel', icon: '🧪', render: renderDev },
  worldhub: { title: 'World Hub', render: renderWorldHub },
  // In Hub mode the Creator is retired; a direct #/creator hash lands on the Hub screen.
  creator: { title: 'Content Creator', icon: '🛠️', render: (s) => s.hubMode ? renderWorldHub(s) : renderCreator(s) },
  crisis: { title: 'Crisis Response', render: renderCrisis }
};

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  return { name: routes[parts[0]] ? parts[0] : 'home', arg: parts.slice(1).join('/') || null };
}

const GAME_ROUTES = new Set(['home', 'roster', 'party', 'worlds', 'campaign', 'expeditions', 'headquarters', 'inventory', 'archive', 'character', 'node', 'crisis']);

export function render() {
  const { name, arg } = parseRoute();
  const route = routes[name];
  const routeKey = `${name}:${arg ?? ''}`;
  const entering = store.ui.currentRouteKey !== routeKey;
  if (!entering) {
    // Transactions can rebuild the current screen without a route change.
    // Capture its live position before clearing so the rerender stays put.
    rememberScroll();
  } else if (store.ui.currentRouteKey) {
    store.ui.routeHistory.push(store.ui.currentRouteKey);
    if (store.ui.routeHistory.length > 50) store.ui.routeHistory.shift();
    clearModals();
  }
  store.ui.currentRouteKey = routeKey;
  store.ui.activeSearchInput = null;
  document.documentElement.className = store.state.settings.reducedMotion ? 'reduced-motion' : '';
  document.documentElement.style.setProperty('--scale', store.state.settings.textScale);
  document.body.classList.toggle('splash-active', name === 'splash');
  renderSidebar(name);
  const screen = document.getElementById('screen');
  clear(screen);
  screen.className = entering ? 'screen-entering' : '';
  if (name === 'splash') screen.classList.add('splash-screen-root');
  // Setup mode: until the content meets the minimum prerequisites for a
  // playable game, game screens show the readiness checklist instead.
  if (!store.gameReady.ready && GAME_ROUTES.has(name)) {
    renderTopbar('Game setup');
    renderSetup(screen);
    return;
  }
  renderTopbar(route.title);
  route.render(store, screen, arg);
  restoreScroll(routeKey);
}

function rememberScroll() {
  if (!store.ui.currentRouteKey) return;
  const main = document.getElementById('main');
  store.ui.scrollPositions[store.ui.currentRouteKey] = main.scrollTop;
}

function restoreScroll(routeKey) {
  const main = document.getElementById('main');
  const saved = store.ui.scrollPositions[routeKey];
  requestAnimationFrame(() => { main.scrollTop = Number.isFinite(saved) ? saved : 0; });
}

function goBack() {
  const context = store.ui.returnContext;
  const route = parseRoute();
  if (context && route.name === 'node') {
    const saved = context;
    store.ui.returnContext = null;
    store.ui.pendingReopen = saved;
    store.go(saved.route);
    return;
  }
  history.back();
}

function renderSetup(screen) {
  const panel = h('div.panel');
  panel.appendChild(h('h2', '🛠️ Your game is not ready to play yet'));
  panel.appendChild(h('p.muted', 'All playable content — worlds, characters, and the Main Campaign — is authored in the Content Creator. The game starts once these prerequisites are met:'));
  for (const c of store.gameReady.checks) {
    panel.appendChild(h('div.health-item' + (c.ok ? '.good' : '.warn'), `${c.ok ? '✅' : '◻️'} ${c.text}`));
  }
  panel.appendChild(h('div', { style: { marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' } },
    h('button.btn.primary', { onclick: () => store.go('#/creator') }, 'Open the Content Creator'),
    h('span.small.muted', 'Tip: the Creator can import the sample worlds as a fully editable starting point.')));
  screen.appendChild(panel);
}

function renderSidebar(active) {
  const nav = document.getElementById('sidebar');
  clear(nav);
  nav.appendChild(h('div.logo', 'Hero ', h('span', 'Collector')));
  const away = store.state?.expeditions?.active?.length ?? 0;
  for (const [name, r] of Object.entries(routes)) {
    if (!r.nav || name === 'settings') continue;
    // Expeditions is the only destination that carries a count: parties that
    // are out are the one thing happening while you are somewhere else.
    const count = name === 'expeditions' && away > 0 ? `${away} out` : null;
    nav.appendChild(h('button.nav-btn' + (name === active ? '.active' : ''), {
      onclick: () => store.go(`#/${name}`),
      'aria-label': count ? `${r.title}, ${away} parties out` : null
    }, h('span.nav-dot', { 'aria-hidden': 'true' }), r.title,
    count ? h('span.nav-count', { 'aria-hidden': 'true' }, count) : null));
  }
  nav.appendChild(h('div.spacer'));
  // The Content Creator is always reachable while the game is in setup mode;
  // once playable, it lives behind the dev-tools toggle.
  if (store.hubMode) {
    nav.appendChild(h('button.nav-btn' + (active === 'worldhub' ? '.active' : ''), {
      onclick: () => store.go('#/worldhub')
    }, h('span.ico', '📦'), 'World Hub'));
  } else if (!store.gameReady.ready || store.state.settings.devPanel) {
    nav.appendChild(h('button.nav-btn' + (active === 'creator' ? '.active' : ''), {
      onclick: () => store.go('#/creator')
    }, h('span.ico', '🛠️'), 'Content Creator'));
    nav.appendChild(h('button.nav-btn' + (active === 'worldhub' ? '.active' : ''), {
      onclick: () => store.go('#/worldhub')
    }, h('span.ico', '📦'), 'World Hub'));
  }
  if (store.state.settings.devPanel) {
    nav.appendChild(h('button.nav-btn' + (active === 'dev' ? '.active' : ''), {
      onclick: () => store.go('#/dev')
    }, h('span.ico', '🧪'), 'Dev Panel'));
  }
  const b = store.content?.balance;
  const e = store.state?.energy ?? 0;
  if (b) {
    const reset = store.state.settings.resetHour;
    const supplies = fieldSupplyLimits(store.content, store.state);
    // The well holds two currencies. Energy is the numeral; Field Supply is a
    // sentence, because what matters about it is how many uses are left today.
    nav.appendChild(h('button.sidebar-energy', {
      onclick: openRechargeDialog,
      'aria-label': `${e} of ${b.energy.storageCap} Energy. ${supplies.held} of ${supplies.storageCap} Field Supplies held; ${supplies.usesRemaining} uses remain today.`
    },
    h('div.eyebrow', 'Energy'),
    h('div.energy-number', fmt(e), h('span', ` / ${fmt(b.energy.storageCap)}`)),
    h('div.energy-line', h('i', { style: { width: `${Math.min(100, e / b.energy.storageCap * 100)}%` } })),
    h('div.caption', `+${fmt(b.energy.dailyGrant)} more at ${reset}:00`),
    h('div.supply-well',
      h('span.supply-glyph', { 'aria-hidden': 'true' }, store.content.resourceById.field_supply?.icon ?? '◈'),
      h('div',
        h('div.supply-held', `${supplies.held} Field Supply `, h('span', `of ${supplies.storageCap} held`)),
        h('div.caption', `${countWord(supplies.usesRemaining)} use${supplies.usesRemaining === 1 ? '' : 's'} left today · +${supplies.restore} each`)))));
  }
  nav.appendChild(h('button.nav-btn.settings-link' + (active === 'settings' ? '.active' : ''), {
    onclick: () => store.go('#/settings')
  }, h('span.nav-dot', { 'aria-hidden': 'true' }), 'Settings'));
}

function openRechargeDialog() {
  const preview = previewFieldSupplyUse(store.content, store.state);
  openModal((modal, close) => {
    dressModal(modal, { size: 'sheet' });
    modal.appendChild(modalHead('Field Supplies',
      preview.ok ? `${preview.restored} Energy can return now.` : 'The reserve cannot be opened now.',
      {
        lead: preview.ok
          ? preview.wasted > 0
            ? `This Supply restores ${preview.restored} Energy; the remaining ${preview.wasted} cannot fit under the ${store.content.balance.energy.storageCap} cap.`
            : `This Supply restores ${preview.restored} Energy. It is consumed only when you confirm.`
          : preview.reasons.join(' ')
      }));
    modal.appendChild(h('p.hc-modal-fine',
      `${preview.held} held of ${preview.storageCap} storage · ${preview.reserved} promised by routes already out · ${preview.usesRemaining} use${preview.usesRemaining === 1 ? '' : 's'} remain today`));
    modal.appendChild(modalActions(
      modalAction(preview.ok ? `Restore ${preview.restored} Energy →` : 'Nothing can be restored',
        {
          disabled: !preview.ok,
          reason: preview.ok ? null : preview.reasons[0],
          onclick: async () => {
            const result = await store.tx(() => useFieldSupply(store.content, store.state), { rerender: false });
            if (result.ok) { close(); render(); }
          }
        }),
      modalDismiss('Leave it stored', close)));
  });
}

function renderTopbar(title) {
  const bar = document.getElementById('topbar');
  clear(bar);
  bar.setAttribute('aria-label', title);
}

// ------------------------------------------------------------- boot
// A save that cannot be loaded must never be a dead end: the screen that
// reports the failure also carries the tools to recover from it, because the
// normal Settings screen is unreachable before a save loads.
function renderRecoveryScreen({ title, message, details = [], brokenSave = null }) {
  const screen = document.getElementById('screen');
  clear(screen);
  const panel = h('div.panel', h('h2', title), h('p.bad', message));
  if (details.length) panel.appendChild(h('ul.reasons', details.slice(0, 20).map(e => h('li', e))));
  panel.appendChild(h('p.muted',
    'The existing save and its rolling backup were left untouched. Import a working save, rescue a copy of the unreadable one, or start over.'));

  const actions = h('div.modal-actions');
  actions.appendChild(h('button.btn.primary', {
    onclick: async () => {
      const imported = await importSave();
      if (!imported) { toast('Import canceled or unreadable.', 'error'); return; }
      let migrated;
      try {
        migrated = migratePlayerState(store.content, imported);
      } catch (error) {
        toast(`Import migration failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
      }
      syncSaveWithContent(store.content, migrated);
      const check = validateSave(store.content, migrated);
      if (!check.ok) {
        toast(`Imported save is malformed: ${check.errors[0]}`, 'error');
        return;
      }
      await writeSave(migrated);
      toast('Save imported. Restarting…');
      setTimeout(() => location.reload(), 700);
    }
  }, 'Import save…'));

  if (brokenSave) {
    actions.appendChild(h('button.btn', {
      onclick: () => exportJson(brokenSave, 'hero-collector-unreadable-save.json')
        .then(ok => ok && toast('Unreadable save exported.'))
    }, 'Export the unreadable save…'));
  }

  // Two-step, since the modal system is not running this early in boot.
  const reset = h('button.btn.danger', 'Start a new game');
  reset.onclick = () => {
    if (reset.dataset.armed !== 'yes') {
      reset.dataset.armed = 'yes';
      reset.textContent = 'Confirm: erase this save and start over';
      return;
    }
    writeSave(newPlayerState(store.content, Date.now())).then(() => {
      toast('New game started. Restarting…');
      setTimeout(() => location.reload(), 700);
    });
  };
  actions.appendChild(reset);

  panel.appendChild(actions);
  screen.appendChild(panel);
}

async function boot() {
  store.baseRaw = await loadRawContent();

  // World Hub mode: the installed immutable publication is the content
  // source; the Creator database stays on disk untouched as the legacy
  // fallback for when no publication is active.
  store.hubStatus = null;
  let hubDb = null;
  if (worldhub.available()) {
    try {
      const active = await worldhub.activeDb();
      if (active && !active.error) {
        hubDb = active.db;
        store.hubStatus = active.status;
      } else if (active?.error) {
        store.hubLoadError = active.error;
      }
    } catch { /* fall back to legacy */ }
  }
  store.hubMode = !!hubDb;
  store.customDB = upgradeCustomDB(hubDb ?? await loadCustomContent());

  // Merge base + custom content; if the merge is somehow invalid, fall back
  // to the shipped base content so the game always starts.
  const merged = mergeContent(store.baseRaw, store.customDB);
  let content = buildContent(merged.raw);
  let check = validateContent(content);
  if (check.ok) {
    content.images = merged.images;
    store.contentHealth = merged.health;
  } else {
    const activeDB = upgradeCustomDB(await loadActiveCustomContent());
    const activeMerged = mergeContent(store.baseRaw, activeDB);
    const activeContent = buildContent(activeMerged.raw);
    const activeCheck = validateContent(activeContent);
    content = activeCheck.ok ? activeContent : buildContent(store.baseRaw);
    if (activeCheck.ok) content.images = activeMerged.images;
    const baseCheck = validateContent(content);
    if (!baseCheck.ok) {
      document.getElementById('screen').appendChild(
        h('div.panel', h('h2', 'Content validation failed'),
          h('ul.reasons', baseCheck.errors.map(e => h('li', e))))
      );
      return;
    }
    store.contentHealth = [
      { level: 'error', text: 'Custom content could not be merged and was disabled for this session:' },
      ...check.errors.slice(0, 10).map(e => ({ level: 'error', text: e }))
    ];
    setTimeout(() => toast('Creator content could not be loaded — see the Content Creator health panel.', 'error'), 300);
  }
  if (check.ok && !store.hubMode) await writeActiveCustomContent(store.customDB);
  store.content = content;
  store.gameReady = gameReadiness(content);

  const loadedState = await loadSave();
  store.ui.isFreshSave = !loadedState;
  let state = null;
  if (loadedState) {
    try {
      state = migratePlayerState(store.content, loadedState);
    } catch (error) {
      renderRecoveryScreen({
        title: 'Save migration failed',
        message: error instanceof Error ? error.message : String(error),
        brokenSave: loadedState
      });
      return;
    }
  }
  store.state = state ?? newPlayerState(store.content, Date.now());
  if (loadedState) {
    // Only real edits to the save are worth a toast, and they say what they
    // were: a bare count of "stale references" told the player nothing.
    const { changes } = syncSaveWithContent(store.content, store.state);
    if (changes.length > 0) {
      toast(changes.length === 1 ? changes[0] : `${changes[0]} (+${changes.length - 1} more save update${changes.length > 2 ? 's' : ''}.)`);
    }
  }
  ensureExpeditionBoard(store.content, store.state);
  const saveCheck = validateSave(store.content, store.state);
  if (!saveCheck.ok) {
    renderRecoveryScreen({
      title: 'Save validation failed',
      message: 'The migrated save was not written. Resolve these problems or recover below:',
      details: saveCheck.errors,
      brokenSave: loadedState
    });
    return;
  }

  // RNG: persisted deterministic stream when a dev seed is set, else entropy.
  if (store.state.rng) {
    store.rng = makeRng(store.state.rng.seed);
    store.rng.setState(store.state.rng.state);
  } else {
    store.rng = makeRng(entropySeed());
  }

  window.heroStore = store; // debugging convenience for the dev workflow
  window.addEventListener('hashchange', () => {
    rememberScroll();
    const context = store.ui.returnContext;
    if (context && location.hash === context.route) {
      store.ui.pendingReopen = context;
      store.ui.returnContext = null;
    }
    render();
  });
  window.addEventListener('keydown', ev => {
    if (parseRoute().name === 'splash') {
      document.querySelector('.eden-splash')?.classList.add('is-resting');
    }
    if (ev.key === 'Escape' && store.ui.modalStack.length) {
      ev.preventDefault();
      closeTopModal();
      return;
    }
    if (ev.altKey && ev.key === 'ArrowLeft') {
      ev.preventDefault();
      goBack();
      return;
    }
    if (ev.ctrlKey && !ev.shiftKey && ev.code === 'KeyF' && store.ui.activeSearchInput?.isConnected) {
      ev.preventDefault();
      store.ui.activeSearchInput.focus();
      store.ui.activeSearchInput.select?.();
      return;
    }
    if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyD') {
      store.state.settings.devPanel = !store.state.settings.devPanel;
      store.save().then(render);
    }
  });
  const launchRoute = location.hash === '#/splash/rest' ? '#/splash/rest' : '#/splash';
  history.replaceState(null, '', launchRoute);
  render();
}

let dayPollingStarted = false;
function startDayPolling() {
  if (dayPollingStarted) return;
  dayPollingStarted = true;
  setInterval(async () => {
    const summary = applyDailyReset(store.content, store.state, store.now());
    if (!summary) return;
    await store.save();
    showDaySummary(summary);
    render();
  }, 60000);
}

// 10b — the day opens. Rewards were already granted at the reset; this modal
// reports what came back and never claims anything.
function showDaySummary(summary) {
  if (!summary || summary.acknowledged) return;
  openModal((modal, close) => {
    dressModal(modal, { size: 'day' });
    const reset = store.state.settings.resetHour;
    const returned = summary.expeditions ?? [];
    modal.appendChild(modalHead(
      `Day ${store.state.dayNumber} · ${reset}:00 · +${fmt(summary.energyGained)} Energy`,
      dayHeadline(summary, returned),
      { size: 'l' }));

    if (returned.length) {
      const rows = h('div.day-returns');
      returned.forEach((report, index) => {
        if (index > 0) rows.appendChild(h('div.day-return-divider'));
        rows.appendChild(dayReturnRow(report));
      });
      modal.appendChild(rows);
    }

    const notes = dayOtherEvents(summary);
    if (notes.length) {
      if (returned.length) modal.appendChild(modalRule());
      modal.append(...notes.map(text => h('p.hc-modal-lead', text)));
    }

    const finish = async destination => {
      summary.acknowledged = true;
      await store.save();
      close();
      if (destination) store.go(destination);
    };

    if (summary.crisis) {
      const world = store.content.worldById[summary.crisis.worldId]?.displayName ?? 'this world';
      modal.appendChild(modalRule());
      modal.appendChild(noticeLine(
        `${summary.crisis.name} is active in ${world}. It costs no Energy, and leaving it alone causes no penalty.`));
      modal.appendChild(modalActions(
        modalAction('Review the Crisis →', { onclick: () => finish('#/crisis') }),
        modalDismiss('Leave it for later', () => finish('#/home'))));
    } else {
      modal.appendChild(modalActions(
        modalAction('Begin the day →', { onclick: () => finish() })));
    }
  });
}

function dayHeadline(summary, returned) {
  if (returned.length) {
    return `${countWord(returned.length, { capitalize: true })} Expedition${returned.length === 1 ? ' has' : 's have'} returned.`;
  }
  if (summary.crisis) return `${summary.crisis.name} is asking for an answer.`;
  if (summary.construction?.length) return `${summary.construction[0].facilityName} is finished.`;
  return 'A new day has opened.';
}

function dayReturnRow(report) {
  const names = (report.party ?? []).map(id => store.content.characterById[id]?.displayName).filter(Boolean);
  const tierTone = report.tier === 'exceptional' ? 'good' : report.tier === 'successful' ? 'text-dim' : 'muted';
  return h('div.day-return',
    report.party?.[0] ? portrait(store, report.party[0], 'day-return', { decorative: true }) : null,
    h('div.grow',
      h('div.day-return-top',
        h('div.day-return-name', report.name),
        h('div.day-return-tier.is-' + tierTone, report.tier)),
      h('p.day-return-sentence', partySentence(names, report)),
      h('p.day-return-rewards', ...rewardNodes(store.content, report.rewards))));
}

function partySentence(names, report) {
  if (!names.length) return report.report;
  const who = nameList(names);
  if (report.tier === 'exceptional') return `${who} came back over the recommendation.`;
  if (report.tier === 'successful') return `${who} met the recommendation.`;
  return `${who} met the requirement, not the stretch.`;
}

function dayOtherEvents(summary) {
  const notes = [];
  for (const build of summary.construction ?? []) {
    notes.push(`${build.facilityName} reached Level ${build.targetLevel}, and the account-wide construction slot is open again.`);
  }
  if (summary.production?.length) {
    notes.push(`${countWord(summary.production.length, { capitalize: true })} automatic production entr${summary.production.length === 1 ? 'y is' : 'ies are'} already in the Workshop.`);
  }
  return notes;
}

boot();
