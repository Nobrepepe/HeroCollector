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
import { loadRawContent, loadSave, writeSave, loadCustomContent, writeCustomContent } from './platform.js';
import { h, clear, fmt } from './ui/dom.js';
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
import { renderHeadquarters } from './ui/headquarters.js';

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
    compactResult: null
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

export function openModal(build) {
  const root = document.getElementById('modal-root');
  root.className = 'open';
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const layer = h('div.modal-layer');
  const titleId = `modal-title-${Date.now()}-${store.ui.modalStack.length}`;
  const modal = h('div.modal', {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1'
  });
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
  home: { title: 'Today', icon: '🏠', render: renderHome, nav: true },
  roster: { title: 'Collection', icon: '👥', render: renderRoster, nav: true },
  party: { title: 'Party', icon: '⚔️', render: renderParty, nav: true },
  campaign: { title: 'Journey', icon: '🗺️', render: renderCampaign, nav: true },
  expeditions: { title: 'Expeditions', icon: '🧭', render: renderExpeditions, nav: true },
  headquarters: { title: 'Headquarters', icon: '🏰', render: renderHeadquarters, nav: true },
  inventory: { title: 'Workshop', icon: '🎒', render: renderInventory, nav: true },
  archive: { title: 'Archive', icon: '🏛️', render: renderArchive, nav: true },
  settings: { title: 'Settings', icon: '⚙️', render: renderSettings, nav: true },
  character: { title: 'Character', render: renderCharacter },
  node: { title: 'Node', render: renderNode },
  dev: { title: 'Developer Panel', icon: '🧪', render: renderDev },
  creator: { title: 'Content Creator', icon: '🛠️', render: renderCreator }
};

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  return { name: routes[parts[0]] ? parts[0] : 'home', arg: parts.slice(1).join('/') || null };
}

const GAME_ROUTES = new Set(['home', 'roster', 'party', 'campaign', 'expeditions', 'headquarters', 'inventory', 'archive', 'character', 'node']);

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
  renderSidebar(name);
  const screen = document.getElementById('screen');
  clear(screen);
  screen.className = entering ? 'screen-entering' : '';
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
  for (const [name, r] of Object.entries(routes)) {
    if (!r.nav || name === 'settings') continue;
    nav.appendChild(h('button.nav-btn' + (name === active ? '.active' : ''), {
      onclick: () => store.go(`#/${name}`)
    }, h('span.nav-dot', { 'aria-hidden': 'true' }), r.title));
  }
  nav.appendChild(h('div.spacer'));
  // The Content Creator is always reachable while the game is in setup mode;
  // once playable, it lives behind the dev-tools toggle.
  if (!store.gameReady.ready || store.state.settings.devPanel) {
    nav.appendChild(h('button.nav-btn' + (active === 'creator' ? '.active' : ''), {
      onclick: () => store.go('#/creator')
    }, h('span.ico', '🛠️'), 'Content Creator'));
  }
  if (store.state.settings.devPanel) {
    nav.appendChild(h('button.nav-btn' + (active === 'dev' ? '.active' : ''), {
      onclick: () => store.go('#/dev')
    }, h('span.ico', '🧪'), 'Dev Panel'));
  }
  const b = store.content?.balance;
  const e = store.state?.energy ?? 0;
  if (b) {
    const reset = String(store.state.settings.resetHour).padStart(2, '0');
    nav.appendChild(h('div.sidebar-energy',
      h('div.eyebrow', 'Energy'),
      h('div.energy-number', fmt(e), h('span', ` / ${fmt(b.energy.storageCap)}`)),
      h('div.energy-line', h('i', { style: { width: `${Math.min(100, e / b.energy.storageCap * 100)}%` } })),
      h('div.caption', `+${b.energy.dailyGrant} more at ${reset}:00`)));
  }
  nav.appendChild(h('button.nav-btn.settings-link' + (active === 'settings' ? '.active' : ''), {
    onclick: () => store.go('#/settings')
  }, h('span.nav-dot', { 'aria-hidden': 'true' }), 'Settings'));
}

function renderTopbar(title) {
  const bar = document.getElementById('topbar');
  clear(bar);
  bar.setAttribute('aria-label', title);
}

// ------------------------------------------------------------- boot
async function boot() {
  store.baseRaw = await loadRawContent();
  store.customDB = upgradeCustomDB(await loadCustomContent());

  // Merge base + custom content; if the merge is somehow invalid, fall back
  // to the shipped base content so the game always starts.
  const merged = mergeContent(store.baseRaw, store.customDB);
  let content = buildContent(merged.raw);
  let check = validateContent(content);
  if (check.ok) {
    content.images = merged.images;
    store.contentHealth = merged.health;
  } else {
    content = buildContent(store.baseRaw);
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
  store.content = content;
  store.gameReady = gameReadiness(content);

  const loadedState = await loadSave();
  let state = null;
  if (loadedState) {
    try {
      state = migratePlayerState(store.content, loadedState);
    } catch (error) {
      const screen = document.getElementById('screen');
      clear(screen);
      screen.appendChild(h('div.panel',
        h('h2', 'Save migration failed'),
        h('p.bad', error instanceof Error ? error.message : String(error)),
        h('p.muted', 'The existing save and rolling backup were left unchanged. Export or restore the save before trying again.')));
      return;
    }
  }
  store.state = state ?? newPlayerState(store.content, Date.now());
  if (loadedState) {
    const scrubbed = syncSaveWithContent(store.content, store.state);
    if (scrubbed.length > 0) {
      toast(`Save updated for changed content (${scrubbed.length} stale reference${scrubbed.length > 1 ? 's' : ''} cleaned).`);
    }
  }
  ensureExpeditionBoard(store.content, store.state);
  const saveCheck = validateSave(store.content, store.state);
  if (!saveCheck.ok) {
    const screen = document.getElementById('screen');
    clear(screen);
    screen.appendChild(h('div.panel',
      h('h2', 'Save validation failed'),
      h('p.bad', 'The migrated save was not written. Resolve these problems or restore the rolling backup:'),
      h('ul.reasons', saveCheck.errors.slice(0, 20).map(error => h('li', error)))));
    return;
  }

  // RNG: persisted deterministic stream when a dev seed is set, else entropy.
  if (store.state.rng) {
    store.rng = makeRng(store.state.rng.seed);
    store.rng.setState(store.state.rng.state);
  } else {
    store.rng = makeRng(entropySeed());
  }

  const summary = applyDailyReset(store.content, store.state, store.now());
  await store.save();
  showDaySummary(summary ?? store.state.lastResetSummary);

  // Re-check the reset every minute while the app stays open.
  setInterval(async () => {
    const s = applyDailyReset(store.content, store.state, store.now());
    if (s) {
      await store.save();
      showDaySummary(s);
      render();
    }
  }, 60000);

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
  render();
}

function showDaySummary(summary) {
  if (!summary || summary.acknowledged) return;
  openModal((modal, close) => {
    modal.appendChild(h('div.eyebrow', `${summary.days} game day${summary.days === 1 ? '' : 's'} advanced`));
    modal.appendChild(h('h2', summary.expeditions?.length
      ? `${summary.expeditions.length} Expedition${summary.expeditions.length === 1 ? ' has' : 's have'} returned.`
      : 'A new day has opened.'));
    modal.appendChild(h('p', `${summary.energyGained} Energy restored. Shard attempts are ready again.`));
    for (const build of summary.construction ?? []) modal.appendChild(h('p.good', `${build.facilityName} reached Level ${build.targetLevel}.`));
    if (summary.production?.length) modal.appendChild(h('p', `${summary.production.length} automatic production entr${summary.production.length === 1 ? 'y was' : 'ies were'} added to inventory.`));
    for (const report of summary.expeditions ?? []) modal.appendChild(h('div.return-report',
      h('div.title', report.name), h('p', `${report.tier}. ${report.report}`)));
    modal.appendChild(h('button.btn.primary', {
      onclick: async () => {
        summary.acknowledged = true;
        await store.save();
        close();
      }
    }, 'Begin the day →'));
  });
}

boot();
