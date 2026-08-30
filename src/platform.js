// Platform abstraction: Electron (preload IPC) or plain browser (fetch +
// localStorage/IndexedDB) for development previews. The rest of the app never
// knows which one it is running on.

const CONTENT_FILES = ['balance', 'archetypes', 'materials', 'components', 'characters', 'tags', 'recipes', 'expeditions', 'crises'];
const LS_KEY = 'hero-collector-save';
const LS_BACKUP = 'hero-collector-save-backup';

export const isElectron = typeof window !== 'undefined' && !!window.heroAPI;

export async function loadRawContent() {
  if (isElectron) return window.heroAPI.loadContent();
  const out = {};
  await Promise.all(CONTENT_FILES.map(async f => {
    const res = await fetch(`content/${f}.json`);
    out[f] = await res.json();
  }));
  return out;
}

export async function loadSave() {
  if (isElectron) return window.heroAPI.loadSave();
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    try {
      const raw = localStorage.getItem(LS_BACKUP);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
}

export async function writeSave(state) {
  if (isElectron) return window.heroAPI.writeSave(state);
  const prev = localStorage.getItem(LS_KEY);
  if (prev) localStorage.setItem(LS_BACKUP, prev);
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  return true;
}

// ---------------------------------------------------------------- content packs
// An imported content pack can be too large for localStorage, so the browser
// fallback uses IndexedDB.
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hero-collector', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    tx.onsuccess = () => resolve(tx.result ?? null);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// The bundled default content pack: the built-in fallback until a World Hub
// publication is activated or a pack is imported through the dev panel.
export async function loadDefaultPack() {
  try {
    if (isElectron) return await window.heroAPI.loadDefaultPack();
    const res = await fetch('default_content.json');
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// ---- World Hub consumer (Electron only; the browser build stays legacy) ----
export const worldhub = {
  available: () => typeof window !== 'undefined' && !!window.heroAPI?.worldhubStatus,
  status: () => window.heroAPI.worldhubStatus(),
  stageZip: () => window.heroAPI.worldhubStageZip(),
  stageFolder: (path) => window.heroAPI.worldhubStageFolder(path ?? null),
  activate: (stagingId) => window.heroAPI.worldhubActivate(stagingId),
  discard: (stagingId) => window.heroAPI.worldhubDiscard(stagingId),
  rollback: () => window.heroAPI.worldhubRollback(),
  activeDb: () => window.heroAPI.worldhubActiveDb(),
  migrateSave: (mapping) => window.heroAPI.worldhubMigrateSave(mapping),
};

// The last content pack explicitly imported through the dev panel. Absent on
// fresh installs; the bundled default pack fills in.
export async function loadActiveCustomContent() {
  if (isElectron) return window.heroAPI.loadActiveCustom();
  try { return await idbGet('active-custom-content'); } catch { return null; }
}

export async function writeActiveCustomContent(db) {
  if (isElectron) return window.heroAPI.writeActiveCustom(db);
  return idbSet('active-custom-content', JSON.parse(JSON.stringify(db)));
}

// ---------------------------------------------------------------- import/export
export async function exportJson(data, name) {
  if (isElectron) return window.heroAPI.exportJson(data, name);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

export async function importJson() {
  if (isElectron) return window.heroAPI.importJson();
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try { resolve(JSON.parse(await file.text())); } catch { resolve(null); }
    };
    input.click();
  });
}

export const exportSave = (state) => exportJson(state, 'hero-collector-save.json');
export const importSave = () => importJson();
