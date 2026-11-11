import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell } from 'electron';
import path from 'node:path';
import { parseIntent } from './intent';
import { searchFiles } from './search';
import { SearchResponse } from './types';

type Mode = 'compact' | 'expanded';
type Point = { x: number; y: number };

/**
 * Window layouts. `avatarTop` is where the 64x80 avatar sits inside the window,
 * so we can keep the avatar still on screen while the window grows or shrinks.
 */
const SIZES: Record<Mode, { w: number; h: number; avatarTop: number }> = {
  compact: { w: 120, h: 160, avatarTop: 60 },
  expanded: { w: 320, h: 470, avatarTop: 100 },
};

let win: BrowserWindow | null = null;
let mode: Mode = 'compact';
let anchor: Point = { x: 0, y: 0 }; // screen position of the avatar's top-centre
let home: Point | null = null;      // where to return after searching
let lastResults = new Set<string>();

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function workArea(p: Point) {
  return screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea;
}

function clampAnchor(p: Point, m: Mode): Point {
  const s = SIZES[m];
  const wa = workArea(p);
  return {
    x: clamp(p.x, wa.x + s.w / 2, wa.x + wa.width - s.w / 2),
    y: clamp(p.y, wa.y + s.avatarTop, wa.y + wa.height - (s.h - s.avatarTop)),
  };
}

function boundsFor(p: Point, m: Mode) {
  const s = SIZES[m];
  return { x: Math.round(p.x - s.w / 2), y: Math.round(p.y - s.avatarTop), width: s.w, height: s.h };
}

function place(m: Mode, p: Point) {
  mode = m;
  anchor = clampAnchor(p, m);
  win?.setBounds(boundsFor(anchor, m));
}

function cornerAnchor(): Point {
  const s = SIZES.compact;
  const wa = workArea(anchor);
  return { x: wa.x + wa.width - s.w / 2 - 12, y: wa.y + wa.height - (s.h - s.avatarTop) - 12 };
}

function glide(target: Point, ms = 500): Promise<void> {
  return new Promise((resolve) => {
    const from = { ...anchor };
    const t0 = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      anchor = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      win?.setBounds(boundsFor(anchor, mode));
      if (t < 1) setTimeout(step, 16);
      else resolve();
    };
    step();
  });
}

function focusWindow() {
  app.focus({ steal: true });
  win?.focus();
}

async function thumbnail(p: string): Promise<string | undefined> {
  try {
    const img = await nativeImage.createThumbnailFromPath(p, { width: 96, height: 96 });
    if (!img.isEmpty()) return img.toDataURL();
  } catch {
    /* fall back to the Finder icon */
  }
  try {
    return (await app.getFileIcon(p, { size: 'normal' })).toDataURL();
  } catch {
    return undefined;
  }
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const s = SIZES.compact;
  anchor = { x: wa.x + wa.width - s.w / 2 - 24, y: wa.y + wa.height - (s.h - s.avatarTop) - 24 };

  win = new BrowserWindow({
    ...boundsFor(anchor, 'compact'),
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '../../static/index.html'));
  win.on('closed', () => (win = null));
}

ipcMain.on('click-through', (_e, through: unknown) => {
  win?.setIgnoreMouseEvents(through === true, { forward: true });
});

ipcMain.on('drag-by', (_e, dx: unknown, dy: unknown) => {
  if (typeof dx !== 'number' || typeof dy !== 'number') return;
  place(mode, { x: anchor.x + dx, y: anchor.y + dy });
});

ipcMain.handle('set-mode', (_e, m: unknown) => {
  if (m !== 'compact' && m !== 'expanded') return;
  place(m, anchor);
  if (m === 'expanded') focusWindow();
});

ipcMain.handle('go-corner', async () => {
  home = { ...anchor };
  place('compact', anchor);
  await glide(cornerAnchor());
});

ipcMain.handle('go-home', async () => {
  if (home) await glide(clampAnchor(home, 'compact'));
  place('expanded', anchor);
  focusWindow();
});

ipcMain.handle('search', async (_e, text: unknown): Promise<SearchResponse> => {
  if (typeof text !== 'string' || !text.trim()) {
    return { results: [], source: '', relaxed: false, error: 'Type what you are looking for.' };
  }
  try {
    const { intent, source } = await parseIntent(text.trim().slice(0, 500));
    console.log('[search]', JSON.stringify(intent), 'via', source);
    const { results, relaxed } = await searchFiles(intent);
    await Promise.all(results.map(async (r) => (r.thumb = await thumbnail(r.path))));
    lastResults = new Set(results.map((r) => r.path));
    return { results, source, relaxed };
  } catch (err) {
    console.error('[search] failed', err);
    return { results: [], source: '', relaxed: false, error: (err as Error).message };
  }
});

// Only act on paths we just returned, never arbitrary paths from the page.
ipcMain.on('open-file', (_e, p: unknown) => {
  if (typeof p === 'string' && lastResults.has(p)) void shell.openPath(p);
});
ipcMain.on('reveal-file', (_e, p: unknown) => {
  if (typeof p === 'string' && lastResults.has(p)) shell.showItemInFolder(p);
});

ipcMain.on('show-menu', () => {
  if (!win) return;
  Menu.buildFromTemplate([{ label: 'Quit AI Avatar', click: () => app.quit() }]).popup({ window: win });
});

app.whenReady().then(() => {
  app.dock?.hide();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

