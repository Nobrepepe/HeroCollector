// Electron main process: window + save-file IPC. Static content and player
// save state are separated (GDD 12.1); saves live in the OS user-data folder
// with one rolling backup and manual export/import.
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const savePath = () => join(app.getPath('userData'), 'save.json');
const backupPath = () => join(app.getPath('userData'), 'save.backup.json');
const customPath = () => join(app.getPath('userData'), 'custom-content.json');
const customBackupPath = () => join(app.getPath('userData'), 'custom-content.backup.json');
const activeCustomPath = () => join(app.getPath('userData'), 'active-custom-content.json');

// Creator art lives beside index.html rather than in userData, so the paths
// stored in the database ("art/<hash>.webp") resolve as ordinary relative URLs
// and travel with the repository.
const ART_DIR = join(root, 'art');
const ART_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg']);

const CONTENT_FILES = ['balance', 'worlds', 'archetypes', 'materials', 'components', 'characters', 'tags', 'recipes', 'nodes', 'archives'];

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

app.whenReady().then(() => {
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

  ipcMain.handle('content:sample', () => {
    return JSON.parse(readFileSync(join(root, 'content', 'sample-pack.json'), 'utf8'));
  });

  ipcMain.handle('custom:load', () => {
    if (!existsSync(customPath())) return null;
    try {
      return JSON.parse(readFileSync(customPath(), 'utf8'));
    } catch (e) {
      if (existsSync(customBackupPath())) {
        try { return JSON.parse(readFileSync(customBackupPath(), 'utf8')); } catch {}
      }
      return null;
    }
  });

  ipcMain.handle('custom:save', (_ev, data) => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    if (existsSync(customPath())) copyFileSync(customPath(), customBackupPath());
    writeFileSync(customPath(), JSON.stringify(data));
    return true;
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

  // Art is content-addressed: identical images collapse onto one file, and an
  // unchanged image keeps its path (and its Git blob) across re-imports.
  ipcMain.handle('art:write', (_ev, bytes, extension) => {
    const ext = ART_EXTENSIONS.has(extension) ? extension : 'webp';
    const buffer = Buffer.from(bytes);
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 32);
    const name = `${hash}.${ext}`;
    mkdirSync(ART_DIR, { recursive: true });
    const target = join(ART_DIR, name);
    if (!existsSync(target)) writeFileSync(target, buffer);
    return `art/${name}`;
  });

  ipcMain.handle('art:list', () => {
    if (!existsSync(ART_DIR)) return [];
    return readdirSync(ART_DIR)
      .filter(name => ART_EXTENSIONS.has(name.split('.').pop()?.toLowerCase()));
  });

  // Only ever unlinks a plain file name inside the art directory, so a bad
  // caller cannot reach outside it.
  ipcMain.handle('art:delete', (_ev, names) => {
    let removed = 0;
    for (const raw of names ?? []) {
      const name = basename(String(raw));
      if (!ART_EXTENSIONS.has(name.split('.').pop()?.toLowerCase())) continue;
      const target = join(ART_DIR, name);
      if (!existsSync(target)) continue;
      unlinkSync(target);
      removed++;
    }
    return removed;
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
