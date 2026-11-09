'use strict';

// Item Checker: hover an item in Path of Exile 2, press the hotkey (F2), and see what it does to
// your build, worked out by Path of Building.

const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, screen, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { createEngine } = require('./engine');
const { createKeys } = require('./keys');
const { toXml } = require('./core/buildcode');
const { isItemText, header, notGear } = require('./core/itemtext');
const { judgeAll } = require('./core/verdict');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const packaged = app.isPackaged;
const resources = packaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor');
const pobDir = path.join(resources, 'pob');
const serverLua = packaged ? path.join(process.resourcesPath, 'server', 'server.lua') : path.join(__dirname, '..', 'pob', 'server.lua');
const keyExe = path.join(resources, 'bin', 'keyhelper.exe');

// ---------------------------------------------------------------------------------- storage

// The portable .exe keeps everything (settings, build, log) in a "data" folder next to itself,
// so the whole app lives in the one folder the player put it in.
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = portableDir ? path.join(portableDir, 'PoE2 Item Checker data') : app.getPath('userData');
if (portableDir) app.setPath('userData', path.join(dataDir, 'app'));
const settingsFile = path.join(dataDir, 'settings.json');
const buildFile = path.join(dataDir, 'build.xml');
const logFile = path.join(dataDir, 'log.txt');

const DEFAULTS = { hotkey: 'F2', advancedCopy: false, buildSource: '', closeDistance: 160 };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}
function saveSettings() { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); }

let logStream = null;
function log(m) {
  const line = `${new Date().toISOString()} ${m}\n`;
  try { if (!logStream) { fs.mkdirSync(dataDir, { recursive: true }); logStream = fs.createWriteStream(logFile, { flags: 'w' }); } logStream.write(line); } catch {}
  if (!packaged) process.stdout.write(line);
}

// ---------------------------------------------------------------------------------- engine

const engine = createEngine({ pobDir, serverLua, log });
const keys = createKeys({ exe: keyExe, log });
let buildSummary = null;
let buildStatus = { state: 'none', message: 'No build loaded yet.' };

async function loadBuild(xml, source) {
  buildStatus = { state: 'loading', message: 'Path of Building is loading your build…' };
  sendSettingsState();
  try {
    const r = await engine.load(xml);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not load the build');
    buildSummary = r.summary;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(buildFile, xml);
    if (source !== undefined) { settings.buildSource = source; saveSettings(); }
    buildStatus = { state: 'ok', message: 'Build loaded.' };
    log(`build: loaded ${JSON.stringify({ c: buildSummary.className, a: buildSummary.ascendancy, l: buildSummary.level, s: buildSummary.mainSkill })}`);
  } catch (e) {
    buildStatus = { state: 'error', message: e.message };
    log(`build: ${e.message}`);
  }
  sendSettingsState();
  updateTray();
  return buildStatus;
}

// ---------------------------------------------------------------------------------- popup

let popup = null;
let popupAnchor = null; // cursor position when it opened
let watchTimer = null;
let escRegistered = false;
let lastShown = null; // what the popup is showing (sent again after a reload)

function createPopup() {
  popup = new BrowserWindow({
    width: 380, height: 120, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popup.loadFile(path.join(__dirname, 'ui', 'popup.html'));
  popup.webContents.on('did-finish-load', () => { if (lastShown) popup.webContents.send('popup:show', lastShown); });
}

function placePopup(width, height) {
  if (!popup || !popupAnchor) return;
  const d = screen.getDisplayNearestPoint(popupAnchor).workArea;
  // to the right of the cursor, so the game's own tooltip (above/left of the item) stays visible
  let x = popupAnchor.x + 24;
  let y = popupAnchor.y - Math.round(height / 3);
  if (x + width > d.x + d.width) x = popupAnchor.x - width - 24;
  x = Math.max(d.x, Math.min(x, d.x + d.width - width));
  y = Math.max(d.y, Math.min(y, d.y + d.height - height));
  popup.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
}

function showPopup(payload) {
  if (!popup) createPopup();
  lastShown = payload;
  popup.webContents.send('popup:show', payload);
  if (!popup.isVisible()) { placePopup(380, 140); popup.showInactive(); }
  if (!escRegistered) {
    escRegistered = globalShortcut.register('Escape', hidePopup);
  }
  clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (!popupAnchor) return;
    const b = popup.getBounds();
    const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    if (!inside && Math.hypot(p.x - popupAnchor.x, p.y - popupAnchor.y) > settings.closeDistance) hidePopup();
  }, 100);
}

function hidePopup() {
  clearInterval(watchTimer);
  if (escRegistered) { globalShortcut.unregister('Escape'); escRegistered = false; }
  if (popup && popup.isVisible()) popup.hide();
}

ipcMain.on('popup:size', (_e, { width, height }) => { if (popup && popup.isVisible()) placePopup(width, height); });
ipcMain.on('popup:close', hidePopup);
ipcMain.on('popup:settings', () => { hidePopup(); openSettings(); });

// ---------------------------------------------------------------------------------- hotkey

let busy = false;

function readClipboardChange(previous, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const now = clipboard.readText();
      if (now && now !== previous) return resolve(now);
      if (Date.now() - t0 > ms) return resolve(null);
      setTimeout(tick, 15);
    };
    tick();
  });
}

async function onHotkey() {
  if (busy) return;
  busy = true;
  try {
    popupAnchor = screen.getCursorScreenPoint();
    const previous = clipboard.readText();
    const sentinel = `__item_checker_${Date.now()}__`;
    clipboard.writeText(sentinel);
    const r = await keys.copy(settings.advancedCopy);
    let text = null;
    if (r === 'ok') text = await readClipboardChange(sentinel, 700);
    // put back whatever the player had on the clipboard
    clipboard.writeText(previous || '');
    if (r === 'notgame') { log('hotkey: game is not the active window'); return; }
    if (r === 'unavailable') { showPopup({ kind: 'message', title: 'Not available', text: 'The key helper is missing, so the app cannot copy items. Reinstall the app.' }); return; }
    if (!text) { log(`hotkey: nothing copied (${r})`); return; }
    if (!isItemText(text)) { showPopup({ kind: 'message', title: 'No item', text: 'Hover an item in the game, then press the hotkey.' }); return; }
    await checkItem(text);
  } catch (e) {
    log(`hotkey: ${e.stack || e.message}`);
    showPopup({ kind: 'message', title: 'Something went wrong', text: e.message });
  } finally {
    busy = false;
  }
}

async function checkItem(text) {
  const head = header(text);
  const cls = notGear(text);
  if (cls) { showPopup({ kind: 'message', head, title: head.name || cls, text: `${cls} can't be equipped, so there's nothing to compare.` }); return; }
  if (!engine.hasBuild()) {
    showPopup({ kind: 'nobuild', head, title: 'Load your build first', text: 'Open Settings and paste your pobb.in link or Path of Building code.' });
    return;
  }
  showPopup({ kind: 'loading', head });
  const t0 = Date.now();
  const r = await engine.eval(text);
  log(`eval: ${Date.now() - t0} ms, ok=${r.ok}${r.ok ? '' : ' ' + r.error}`);
  if (!r.ok) { showPopup({ kind: 'message', head, title: head.name || 'Item', text: r.error }); return; }
  showPopup({ kind: 'result', head, item: r.item, judged: judgeAll(r.results, r.item), skill: buildSummary && buildSummary.mainSkill });
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  escRegistered = false;
  let ok = false;
  try { ok = globalShortcut.register(settings.hotkey, onHotkey); } catch (e) { log(`hotkey: ${e.message}`); }
  log(`hotkey: ${settings.hotkey} ${ok ? 'registered' : 'NOT registered'}`);
  return ok;
}

// ---------------------------------------------------------------------------------- settings window

let settingsWin = null;

function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 620, title: 'Item Checker', autoHideMenuBar: true, backgroundColor: '#0e0f13',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function stateForUi() {
  return { settings, buildStatus, summary: buildSummary, version: app.getVersion(), engineProblem: engine.available(), dataDir };
}
function sendSettingsState() { if (settingsWin) settingsWin.webContents.send('settings:state', stateForUi()); }

ipcMain.handle('settings:get', () => stateForUi());
ipcMain.handle('settings:loadBuild', async (_e, input) => {
  let xml;
  try {
    xml = await toXml(input, async (url) => {
      const res = await fetch(url, { headers: { 'User-Agent': 'ItemChecker' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
  } catch (e) {
    buildStatus = { state: 'error', message: e.message };
    sendSettingsState();
    return buildStatus;
  }
  return loadBuild(xml, String(input).trim().startsWith('http') ? String(input).trim() : '');
});
ipcMain.handle('settings:set', (_e, patch) => {
  const before = settings.hotkey;
  settings = { ...settings, ...patch };
  saveSettings();
  let hotkeyOk = true;
  if (settings.hotkey !== before) {
    hotkeyOk = registerHotkey();
    if (!hotkeyOk) { settings.hotkey = before; saveSettings(); registerHotkey(); }
  }
  updateTray();
  return { ok: hotkeyOk, state: stateForUi() };
});
ipcMain.handle('settings:checkText', async (_e, text) => {
  // "Check pasted item": the same check as the hotkey, for an item copied by hand
  if (!isItemText(text)) return { ok: false, error: 'Paste an item copied from the game (Ctrl+C on the item).' };
  popupAnchor = screen.getCursorScreenPoint();
  await checkItem(text);
  return { ok: true };
});
ipcMain.handle('settings:openLog', () => shell.openPath(logFile));

// ---------------------------------------------------------------------------------- tray

let tray = null;

function trayIcon() {
  const f = path.join(__dirname, 'ui', 'icon.png');
  return fs.existsSync(f) ? nativeImage.createFromPath(f) : nativeImage.createEmpty();
}

function updateTray() {
  if (!tray) return;
  const b = buildSummary;
  tray.setToolTip(`Item Checker: ${settings.hotkey} on an item${b ? `\n${b.ascendancy || b.className || ''} ${b.mainSkill ? '· ' + b.mainSkill : ''}` : '\nNo build loaded'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Hotkey: ${settings.hotkey}`, enabled: false },
    { label: b ? `Build: ${b.ascendancy || b.className || '?'} lvl ${b.level || '?'}${b.mainSkill ? ' · ' + b.mainSkill : ''}` : 'No build loaded', enabled: false },
    { type: 'separator' },
    { label: 'Settings / build…', click: openSettings },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// ---------------------------------------------------------------------------------- start

app.whenReady().then(async () => {
  log(`start: v${app.getVersion()} packaged=${packaged} pob=${pobDir}`);
  tray = new Tray(trayIcon());
  tray.on('click', openSettings);
  updateTray();
  createPopup();
  registerHotkey();

  const problem = engine.available();
  if (problem) log(`engine: ${problem}`);
  if (fs.existsSync(buildFile)) {
    loadBuild(fs.readFileSync(buildFile, 'utf8'));
  } else {
    openSettings();
  }
});

app.on('window-all-closed', (e) => { /* stay in the tray */ });
app.on('will-quit', () => { globalShortcut.unregisterAll(); engine.stop(); keys.stop(); });
