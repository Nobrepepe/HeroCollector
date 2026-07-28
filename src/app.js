// App bootstrap: load content, load/create the save, apply the daily reset,
// then route between screens. All rules live in src/core; screens only call
// transactions and re-render.
import { buildContent } from './core/content.js';
import { validateContent, validateSave } from './core/validate.js';
import { newPlayerState, applyDailyReset, syncSaveWithContent, SCHEMA_VERSION } from './core/state.js';
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

const store = {
  content: null,
  state: null,
  rng: null,
  baseRaw: null,
  customDB: null,
  contentHealth: [],
  gameReady: { ready: false, checks: [] },
  // Dev-only time offset so the developer panel can advance the reset day.
  now() { return Date.now() + (this.state?.devTimeOffsetMs ?? 0); },
  async save() {
    if (this.state.rng) this.state.rng.state = this.rng.getState();
    await writeSave(this.state);
  },
  // Run a core transaction, autosave on success, toast errors, re-render.
  async tx(fn, { rerender = true, quiet = false } = {}) {
    const result = fn();
    if (result && result.ok === false) {
      if (!quiet) toast((result.reasons ?? ['Action failed.']).join(' '), 'error');
    } else {
      await this.save();
    }
    if (rerender) render();
    return result;
  },
  go(hash) { location.hash = hash; },

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
  clear(root);
  root.className = 'open';
  const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true' });
  const close = () => { root.className = ''; clear(root); };
  root.appendChild(h('div.backdrop', { onclick: close }));
  root.appendChild(modal);
  build(modal, close);
  return close;
}

// ------------------------------------------------------------- routing
const routes = {
  home: { title: 'Home', icon: '🏠', render: renderHome, nav: true },
  roster: { title: 'Roster', icon: '👥', render: renderRoster, nav: true },
  party: { title: 'Party Builder', icon: '⚔️', render: renderParty, nav: true },
  campaign: { title: 'Campaign', icon: '🗺️', render: renderCampaign, nav: true },
  inventory: { title: 'Inventory & Crafting', icon: '🎒', render: renderInventory, nav: true },
  archive: { title: 'World Archive', icon: '🏛️', render: renderArchive, nav: true },
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

const GAME_ROUTES = new Set(['home', 'roster', 'party', 'campaign', 'inventory', 'archive', 'character', 'node']);

export function render() {
  const { name, arg } = parseRoute();
  const route = routes[name];
  // Route changes dismiss any open dialog.
  const modalRoot = document.getElementById('modal-root');
  modalRoot.className = '';
  clear(modalRoot);
  document.documentElement.className = store.state.settings.reducedMotion ? 'reduced-motion' : '';
  document.documentElement.style.setProperty('--scale', store.state.settings.textScale);
  renderSidebar(name);
  const screen = document.getElementById('screen');
  clear(screen);
  // Setup mode: until the content meets the minimum prerequisites for a
  // playable game, game screens show the readiness checklist instead.
  if (!store.gameReady.ready && GAME_ROUTES.has(name)) {
    renderTopbar('Game setup');
    renderSetup(screen);
    return;
  }
  renderTopbar(route.title);
  route.render(store, screen, arg);
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
    if (!r.nav) continue;
    nav.appendChild(h('button.nav-btn' + (name === active ? '.active' : ''), {
      onclick: () => store.go(`#/${name}`)
    }, h('span.ico', r.icon), r.title));
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
  nav.appendChild(h('div.small.muted', { style: { padding: '8px 12px' } }, 'MVP 1.0'));
}

function renderTopbar(title) {
  const bar = document.getElementById('topbar');
  clear(bar);
  const b = store.content.balance;
  const e = store.state.energy;
  bar.appendChild(h('h1', title));
  bar.appendChild(h('div.energy-pill', { title: `+${b.energy.dailyGrant} Energy daily at ${String(store.state.settings.resetHour).padStart(2, '0')}:00; stores up to ${b.energy.storageCap}` },
    '⚡', `${fmt(e)} / ${b.energy.storageCap}`,
    h('div.bar', h('div', { style: { width: `${Math.min(100, e / b.energy.storageCap * 100)}%` } }))
  ));
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

  let state = await loadSave();
  if (state && state.schemaVersion !== SCHEMA_VERSION) {
    // Single-schema MVP: future migrations chain here.
    toast(`Save schema ${state.schemaVersion} unsupported; starting fresh. The old file was backed up.`, 'error');
    state = null;
  }
  store.state = state ?? newPlayerState(store.content, Date.now());
  if (state) {
    const scrubbed = syncSaveWithContent(store.content, store.state);
    if (scrubbed.length > 0) {
      toast(`Save updated for changed content (${scrubbed.length} stale reference${scrubbed.length > 1 ? 's' : ''} cleaned).`);
    }
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
  if (summary) {
    toast(`Daily reset: +${summary.energyGained} Energy (${summary.days} day${summary.days > 1 ? 's' : ''} applied), shard attempts refreshed.`);
  }

  // Re-check the reset every minute while the app stays open.
  setInterval(async () => {
    const s = applyDailyReset(store.content, store.state, store.now());
    if (s) {
      await store.save();
      toast(`Daily reset: +${s.energyGained} Energy, shard attempts refreshed.`);
      render();
    }
  }, 60000);

  window.heroStore = store; // debugging convenience for the dev workflow
  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyD') {
      store.state.settings.devPanel = !store.state.settings.devPanel;
      store.save().then(render);
    }
  });
  render();
}

boot();
