// Electron main process: window + save-file IPC. Static content and player
// save state are separated (GDD 12.1); saves live in the OS user-data folder
// with one rolling backup and manual export/import.
import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync, cpSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extractZipSafely } from '../src/core/worldhub/zip-reader.js';
import { loadPackage, semanticValidation, readCurrentPointer } from '../src/core/worldhub/package-reader.js';
import { adaptPackageToCustomDb } from '../src/core/worldhub/adapter.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const savePath = () => join(app.getPath('userData'), 'save.json');
const backupPath = () => join(app.getPath('userData'), 'save.backup.json');
const activeCustomPath = () => join(app.getPath('userData'), 'active-custom-content.json');

const CONTENT_FILES = ['balance', 'worlds', 'archetypes', 'materials', 'components', 'characters', 'tags', 'recipes', 'nodes', 'archives'];

// ---- World Hub consumer: app-owned installed-content cache ---------------
const hubRoot = () => join(app.getPath('userData'), 'worldhub-content');
const hubPublications = () => join(hubRoot(), 'publications');
const hubPointerPath = () => join(hubRoot(), 'current.json');
const hubReceipts = () => join(hubRoot(), 'receipts');
const hubStaging = new Map(); // stagingId -> { dir, sourceType, sourcePath }

function hubPointer() {
  try {
    const pointer = JSON.parse(readFileSync(hubPointerPath(), 'utf8'));
    return pointer?.publicationId ? pointer : null;
  } catch { return null; }
}

function hubMediaUrl(publicationId) {
  return (assetId, preferred = []) => {
    if (!assetId) return null;
    const pkg = hubLoadedPackages.get(publicationId);
    const entry = pkg?.assetFile(assetId, preferred);
    return entry ? `hcpkg://${publicationId}/${entry.path}` : null;
  };
}
const hubLoadedPackages = new Map();

function hubLoadActivePackage() {
  const pointer = hubPointer();
  if (!pointer) return null;
  const dir = join(hubPublications(), pointer.publicationId);
  if (!existsSync(dir)) return null;
  const pkg = loadPackage(dir);
  hubLoadedPackages.set(pointer.publicationId, pkg);
  return pkg;
}

function hubStatus() {
  const pointer = hubPointer();
  let receipt = null;
  if (pointer) {
    try { receipt = JSON.parse(readFileSync(join(hubReceipts(), `${pointer.publicationId}.json`), 'utf8')); } catch {}
  }
  return {
    hubMode: !!pointer,
    publicationId: pointer?.publicationId ?? null,
    previousPublicationId: pointer?.previousPublicationId ?? null,
    linkedFolder: pointer?.linkedFolder ?? null,
    receipt,
  };
}

function hubStage(dir, sourceType, sourcePath) {
  const pkg = loadPackage(dir);
  semanticValidation(pkg);
  const stagingId = createHash('sha256').update(dir + Date.now()).digest('hex').slice(0, 16);
  hubStaging.set(stagingId, { dir, sourceType, sourcePath, pkg });
  const previous = hubLoadActivePackage();
  const oldCast = new Set(previous ? (previous.content.selections?.hc_characters ?? []) : []);
  const newCast = pkg.content.selections?.hc_characters ?? [];
  const names = (p, id) => p.entitiesById[id]?.name ?? id;
  return {
    stagingId,
    publicationId: pkg.manifest.publicationId,
    productionName: pkg.manifest.production.name,
    productionRevision: pkg.manifest.production.revision,
    publishedAt: pkg.manifest.publishedAt,
    alreadyActive: hubPointer()?.publicationId === pkg.manifest.publicationId,
    addedCharacters: newCast.filter(id => !oldCast.has(id)).map(id => names(pkg, id)),
    updatedCharacters: newCast.filter(id => oldCast.has(id)).map(id => names(pkg, id)),
    retiredCharacters: [...oldCast].filter(id => !newCast.includes(id)).map(id => names(previous, id)),
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Hero Collector',
    backgroundColor: '#12100f',
    webPreferences: {
      preload: join(root, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.loadFile(join(root, 'index.html'));
}

// hcpkg:// serves only files inside installed publication directories.
protocol.registerSchemesAsPrivileged([
  { scheme: 'hcpkg', privileges: { standard: true, secure: true, stream: true } },
]);

app.whenReady().then(() => {
  protocol.handle('hcpkg', (request) => {
    try {
      const url = new URL(request.url);
      const publicationId = url.host;
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (!/^[0-9a-f-]{36}$/.test(publicationId) || rel.split('/').includes('..')) {
        return new Response('Not found', { status: 404 });
      }
      const base = resolve(join(hubPublications(), publicationId));
      const target = resolve(join(base, ...rel.split('/')));
      if (target !== base && !target.startsWith(base + sep)) {
        return new Response('Not found', { status: 404 });
      }
      if (!existsSync(target)) return new Response('Not found', { status: 404 });
      const ext = target.split('.').pop().toLowerCase();
      const mime = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' }[ext] ?? 'application/octet-stream';
      return new Response(readFileSync(target), { headers: { 'content-type': mime } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // ---- World Hub IPC ----
  ipcMain.handle('worldhub:status', () => hubStatus());

  ipcMain.handle('worldhub:stage-zip', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Install a World Hub publication ZIP',
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const staging = mkdtempSync(join(tmpdir(), 'hc-worldhub-'));
    try {
      extractZipSafely(readFileSync(filePaths[0]), staging);
      return hubStage(staging, 'zip', filePaths[0]);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      return { error: String(error.message ?? error) };
    }
  });

  ipcMain.handle('worldhub:stage-folder', async (_ev, existingPath) => {
    let folder = existingPath;
    if (!folder) {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Choose the World Hub production folder (contains current.json)',
        properties: ['openDirectory'],
      });
      if (canceled || !filePaths[0]) return null;
      folder = filePaths[0];
    }
    const pointer = readCurrentPointer(folder);
    if (!pointer) return { error: 'That folder is not a World Hub production folder (no current.json).' };
    const source = join(folder, 'publications', pointer.publicationId);
    if (!existsSync(source)) return { error: 'The linked folder’s active publication is missing.' };
    const staging = mkdtempSync(join(tmpdir(), 'hc-worldhub-'));
    try {
      cpSync(source, staging, { recursive: true });
      return hubStage(staging, 'folder', folder);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      return { error: String(error.message ?? error) };
    }
  });

  ipcMain.handle('worldhub:activate', (_ev, stagingId) => {
    const staged = hubStaging.get(stagingId);
    if (!staged) return { error: 'That staged package is no longer available.' };
    hubStaging.delete(stagingId);
    try {
      const publicationId = staged.pkg.manifest.publicationId;
      mkdirSync(hubPublications(), { recursive: true });
      const destination = join(hubPublications(), publicationId);
      if (!existsSync(destination)) renameSync(staged.dir, destination);
      else rmSync(staged.dir, { recursive: true, force: true });
      mkdirSync(hubReceipts(), { recursive: true });
      const manifest = staged.pkg.manifest;
      writeFileSync(join(hubReceipts(), `${publicationId}.json`), JSON.stringify({
        sourceLibraryId: manifest.sourceLibraryId,
        productionId: manifest.production.id,
        productionName: manifest.production.name,
        productionRevision: manifest.production.revision,
        publicationId,
        applicationType: manifest.applicationType,
        contractId: manifest.contract.id,
        contractVersion: manifest.contract.version,
        publishedAt: manifest.publishedAt,
        importedAt: new Date().toISOString(),
        sourceType: staged.sourceType,
        sourcePath: staged.sourcePath,
      }, null, 2));
      const previous = hubPointer();
      const pointer = {
        publicationId,
        previousPublicationId: previous && previous.publicationId !== publicationId
          ? previous.publicationId : previous?.previousPublicationId ?? null,
        linkedFolder: staged.sourceType === 'folder' ? staged.sourcePath : previous?.linkedFolder ?? null,
        activatedAt: new Date().toISOString(),
      };
      const tmpPointer = hubPointerPath() + '.tmp';
      writeFileSync(tmpPointer, JSON.stringify(pointer, null, 2));
      renameSync(tmpPointer, hubPointerPath());
      hubLoadedPackages.clear();
      return hubStatus();
    } catch (error) {
      rmSync(staged.dir, { recursive: true, force: true });
      return { error: String(error.message ?? error) };
    }
  });

  ipcMain.handle('worldhub:discard', (_ev, stagingId) => {
    const staged = hubStaging.get(stagingId);
    if (staged) {
      hubStaging.delete(stagingId);
      rmSync(staged.dir, { recursive: true, force: true });
    }
    return true;
  });

  ipcMain.handle('worldhub:rollback', () => {
    const pointer = hubPointer();
    const previous = pointer?.previousPublicationId;
    if (!previous) return { error: 'There is no previous publication to roll back to.' };
    const source = join(hubPublications(), previous);
    if (!existsSync(source)) return { error: 'The previous publication’s files are no longer available.' };
    try {
      loadPackage(source);
      const next = {
        publicationId: previous,
        previousPublicationId: pointer.publicationId,
        linkedFolder: pointer.linkedFolder ?? null,
        activatedAt: new Date().toISOString(),
      };
      const tmpPointer = hubPointerPath() + '.tmp';
      writeFileSync(tmpPointer, JSON.stringify(next, null, 2));
      renameSync(tmpPointer, hubPointerPath());
      hubLoadedPackages.clear();
      return hubStatus();
    } catch (error) {
      return { error: String(error.message ?? error) };
    }
  });

  // The adapted custom-content database for the active publication, with
  // media resolved through the hcpkg protocol.
  ipcMain.handle('worldhub:active-db', () => {
    try {
      const pkg = hubLoadActivePackage();
      if (!pkg) return null;
      return {
        db: adaptPackageToCustomDb(pkg, hubMediaUrl(pkg.manifest.publicationId)),
        status: hubStatus(),
      };
    } catch (error) {
      return { error: String(error.message ?? error) };
    }
  });

  // Explicit, backed-up one-time save-identity migration. The mapping is
  // provided by the user; ambiguous entries are never guessed.
  ipcMain.handle('worldhub:migrate-save', (_ev, mapping) => {
    if (!mapping || typeof mapping !== 'object') return { error: 'A mapping is required.' };
    if (!existsSync(savePath())) return { error: 'There is no save to migrate.' };
    const backup = savePath().replace(/\.json$/, `.pre-hub-migration-${Date.now()}.json`);
    copyFileSync(savePath(), backup);
    try {
      const save = JSON.parse(readFileSync(savePath(), 'utf8'));
      let moved = 0;
      const remap = (id) => {
        if (Object.prototype.hasOwnProperty.call(mapping, id)) { moved++; return mapping[id]; }
        return id;
      };
      if (save.characters) {
        save.characters = Object.fromEntries(
          Object.entries(save.characters).map(([id, value]) => [remap(id), value]));
      }
      if (Array.isArray(save.parties)) {
        save.parties = save.parties.map(party => Array.isArray(party) ? party.map(id => id ? remap(id) : id) : party);
      }
      writeFileSync(savePath(), JSON.stringify(save));
      return { moved, backup: basename(backup) };
    } catch (error) {
      copyFileSync(backup, savePath());
      return { error: String(error.message ?? error) };
    }
  });

  ipcMain.handle('content:load', () => {
    const out = {};
    for (const f of CONTENT_FILES) {
      out[f] = JSON.parse(readFileSync(join(root, 'content', `${f}.json`), 'utf8'));
    }
    return out;
  });

  ipcMain.handle('save:load', () => {
    if (!existsSync(savePath())) return null;
    try {
      return JSON.parse(readFileSync(savePath(), 'utf8'));
    } catch (e) {
      // Corrupt main save: try the rolling backup.
      if (existsSync(backupPath())) {
        try { return JSON.parse(readFileSync(backupPath(), 'utf8')); } catch {}
      }
      return null;
    }
  });

  ipcMain.handle('save:write', (_ev, data) => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    if (existsSync(savePath())) copyFileSync(savePath(), backupPath());
    writeFileSync(savePath(), JSON.stringify(data));
    return true;
  });

  ipcMain.handle('save:export', async (_ev, data, defaultName) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export',
      defaultPath: defaultName || 'hero-collector-save.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return false;
    // Keep the indent: the exported pack is committed to Git, and one value per
    // line is what lets Git delta-compress an export against its predecessor.
    // Writing it compact would make every export a full-size new blob.
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  });

  ipcMain.handle('save:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) return null;
    return JSON.parse(readFileSync(filePaths[0], 'utf8'));
  });

  // The bundled default content pack: the built-in fallback until a World Hub
  // publication is activated or a pack is imported through the dev panel.
  ipcMain.handle('content:default', () => {
    try { return JSON.parse(readFileSync(join(root, 'default_content.json'), 'utf8')); } catch { return null; }
  });

  ipcMain.handle('custom-active:load', () => {
    if (!existsSync(activeCustomPath())) return null;
    try { return JSON.parse(readFileSync(activeCustomPath(), 'utf8')); } catch { return null; }
  });

  ipcMain.handle('custom-active:save', (_ev, data) => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(activeCustomPath(), JSON.stringify(data));
    return true;
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
