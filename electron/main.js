// Electron main process: window + save-file IPC. Static content and player
// save state are separated (GDD 12.1); saves live in the OS user-data folder
// with one rolling backup and manual export/import.
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const savePath = () => join(app.getPath('userData'), 'save.json');
const backupPath = () => join(app.getPath('userData'), 'save.backup.json');
const customPath = () => join(app.getPath('userData'), 'custom-content.json');
const customBackupPath = () => join(app.getPath('userData'), 'custom-content.backup.json');
const activeCustomPath = () => join(app.getPath('userData'), 'active-custom-content.json');

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

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
