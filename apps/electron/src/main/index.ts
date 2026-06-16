import { app, BrowserWindow, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { registerTorrentIpc, startStreamServer, STREAM_BASE_URL } from './torrent';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8080';
const isDev = !!RENDERER_DEV_URL;

// Resolve icon from resources/ next to the project root when in dev,
// or from process.resourcesPath when packaged.
app.setName('Relax');

const iconBase = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources');
const iconPath = process.platform === 'darwin'
  ? join(iconBase, 'icon.icns')
  : process.platform === 'win32'
    ? join(iconBase, 'icon.ico')
    : join(iconBase, 'icon.png');

function createWindow() {
  const win = new BrowserWindow({
    title: 'RELAX',
    icon: iconPath,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  win.setMenuBarVisibility(false);

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[electron] did-fail-load', code, description, url);
    void win.webContents.loadURL(
      `data:text/html,${encodeURIComponent(`<body style="background:#050505;color:#eee;font:14px system-ui;padding:24px"><h1>Load failed</h1><pre>${code} ${description}\n${url}</pre></body>`)}`,
    );
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] render-process-gone', details);
  });
  win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    console.log(`[renderer] ${sourceId}:${line} ${message}`);
  });

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  if (RENDERER_DEV_URL) {
    void win.loadURL(RENDERER_DEV_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function applyContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const directives = [
      "default-src 'self'",
      `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ''}`,
      `connect-src 'self' ${BACKEND_URL} ${STREAM_BASE_URL} ws://localhost:5173 http://localhost:5173`,
      `media-src 'self' ${STREAM_BASE_URL} blob:`,
      "img-src 'self' data: https://image.tmdb.org",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [directives],
      },
    });
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(join(iconBase, 'icon.png'));
  applyContentSecurityPolicy();
  registerTorrentIpc();
  startStreamServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
