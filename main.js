'use strict';
// Главный процесс Electron: окно, встроенный сервер хоста, захват экрана,
// глобальная клавиша рации, запись лога в файл.
const { app, BrowserWindow, ipcMain, session, desktopCapturer, protocol, dialog, shell, Notification, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { Logger } = require('./main/logger');
const setupProcAudio = require('./main/procaudio');
const setupVideoCap = require('./main/videocap');
const { createFootprint } = require('./main/footprint');
const { makeZip } = require('./main/zip');

// ---------- профиль (для теста двух копий на одном ПК: --profile=2) ----------
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) {
  const name = profileArg.split('=')[1].replace(/[^\w-]/g, '') || 'alt';
  app.setPath('userData', path.join(app.getPath('appData'), 'Skhodka-' + name));
}

// ---------- одна копия программы: повторный запуск открывает уже работающее окно (оно могло быть в трее) ----------
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => showWindow());

// ---------- флаги Chromium ----------
// Показывать настоящие IP (в т.ч. Radmin 26.x.x.x) в WebRTC, а не скрывать их за mDNS-именами,
// иначе прямое соединение внутри VPN-сети может не установиться.
// AllowWgcScreenCapturer (1.16.1): экран на любой Windows снимаем через DirectX (DXGI) — так же, как на Windows 10.
// Chromium 150 сам переходит на Windows.Graphics.Capture (WGC) в режиме «0 Гц» (кадры только при изменении картинки)
// на Windows 11 24H2 и новее (сборка ≥ 26100; desktop_capture_device.cc, IsWgcEnabledForScreenCapture). У друга
// на сборке 26300 так захват не отдал ни одного кадра — у зрителей была чёрная демка (21.10). Флаг, заданный явно,
// Chromium оставляет как есть. Окна по-прежнему снимаются способом Windows для окон — так было всегда и везде.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion,AllowWgcScreenCapturer');
// Не «усыплять» окно в фоне — иначе в свёрнутом виде заикается звук и демонстрация.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// 1.17.0: пробных настроек WebRTC (force-fieldtrials: FlexFEC, KeyframeFlushing, FastRetransmissions, encoder_thread_limit)
// больше нет — демка работает на обычных настройках Chromium.
// 1.18.2: кроме одной — для кодека «H.264 — сжатие на нескольких ядрах»: тот же H.264 процессором (OpenH264),
// но кадр сжимают до 8 ядер, а не одно (encoder_thread_limit; у vertigo 23.10 одно ядро не успевало 1080p60 — картинка мельчала).
// 1.20.1: включена всегда. Chromium читает её только при запуске — раньше ради этого кодека «Сходку» перезапускали
// (выбор писался в multicore.json). Другим кодекам она не мешает: предел читает только сжатие H.264 процессором,
// а обычный «H.264 — процессор» шлёт кадр одним куском и сжимает его одним ядром и с ней (замер 1.18.2: 21,5 мс и так, и так).
app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-VideoEncoderSettings/encoder_thread_limit:8/');
const multiCore = true;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const logger = new Logger(path.join(app.getPath('userData'), 'logs'));
const log = (level, cat, msg, extra) => logger.log(level, cat, msg, extra);
// файлы в папке журналов — от старых к новым (для архива и «последнего журнала»)
function logFiles() {
  let names = [];
  try { names = fs.readdirSync(logger.dir); } catch (_) { return []; }
  return names.map((name) => {
    const p = path.join(logger.dir, name);
    try { const st = fs.statSync(p); return st.isFile() ? { name, path: p, mtime: st.mtime } : null; } catch (_) { return null; }
  }).filter(Boolean).sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
}
const procAudio = setupProcAudio({ ipcMain, app, log });
require('./main/musicapps')({ ipcMain, app, log }); // «Музыка для всех» → окна программ, включая свёрнутые
const videoCap = setupVideoCap({ ipcMain, app, log, screenRect: (id) => screenRectOf(id) });
require('./main/updater')({ ipcMain, app, log, getWin: () => win }); // 1.20.5: обновления из GitHub Releases
require('./main/soundboard')({ ipcMain, app, log }); // 1.21: «Звуки для всех» — свои файлы звуков

let win = null;
let server = null;
let quitting = false;

// ---------- глобальные ловушки ошибок главного процесса ----------
process.on('uncaughtException', (e) => log('error', 'main', `Необработанная ошибка: ${e.message}`, { details: e.stack }));
process.on('unhandledRejection', (e) => log('error', 'main', `Необработанный отказ промиса: ${e && e.message ? e.message : e}`, { details: e && e.stack }));

// ---------- подсказки по сетевым ошибкам ----------
function netHint(code, host, port) {
  // адрес Radmin VPN / домашней сети — советы про Radmin; адрес в интернете (сервер на VPS) — про интернет и сервер
  const vpn = /^(26\.|25\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(host));
  switch (code) {
    case 'ECONNREFUSED': return {
      msg: `Компьютер ${host} доступен, но на порту ${port} никто не отвечает`,
      hint: 'Хост ещё не нажал «Запустить сервер», указан не тот порт, или брандмауэр Windows у хоста блокирует программу (Панель управления → Брандмауэр → Разрешить приложение → отметить «Сходка» для частной и общественной сети).',
    };
    case 'ETIMEDOUT': return {
      msg: `Нет ответа от ${host}:${port} (таймаут)`,
      hint: vpn ? 'Проверьте, что вы и хост в ОДНОЙ сети Radmin VPN и хост «зелёный» (онлайн). Брандмауэр хоста может молча отбрасывать подключения — разрешите «Сходку» в брандмауэре. Попробуйте в Radmin VPN: правый клик по хосту → «Проверить доступность (Ping)».'
        : 'Проверьте интернет. Если с ним всё в порядке — сервер выключен или перезагружается, либо порт закрыт брандмауэром в панели хостинга. Хозяину сервера: меню Skhodka-server → «Состояние».',
    };
    case 'EHOSTUNREACH': case 'ENETUNREACH': return {
      msg: `Адрес ${host} недостижим`,
      hint: vpn ? 'Radmin VPN выключен или вы не в сети с хостом. Запустите Radmin VPN и убедитесь, что у адаптера есть адрес 26.x.x.x.' : 'Нет интернета или адрес введён с ошибкой.',
    };
    case 'ENOTFOUND': case 'EAI_AGAIN': return { msg: `Не удалось распознать адрес «${host}»`, hint: 'Введите адрес цифрами, например 79.133.181.137 или 26.123.45.67' };
    case 'EADDRINUSE': return { msg: `Порт ${port} уже занят`, hint: 'Сервер уже запущен (в другом окне «Сходки»?) или порт занят другой программой. Укажите другой порт, например 41235, и сообщите его друзьям.' };
    case 'EACCES': return { msg: `Нет прав открыть порт ${port}`, hint: 'Выберите порт выше 1024 (по умолчанию 41234).' };
    case 'EADDRNOTAVAIL': return { msg: 'Адрес недоступен на этом компьютере', hint: 'Проверьте сетевые адаптеры и Radmin VPN, если пользуетесь им.' };
    default: return { msg: `Сетевая ошибка ${code || ''}`.trim(), hint: vpn ? 'Проверьте подключение к сети и Radmin VPN.' : 'Проверьте подключение к интернету.' };
  }
}

// ---------- сетевые интерфейсы ----------
function classify(name, address) {
  const n = name.toLowerCase();
  if (address.startsWith('26.') || n.includes('radmin')) return 'Radmin VPN';
  if (n.includes('zerotier') || n.startsWith('zt')) return 'ZeroTier';
  if (address.startsWith('25.') || n.includes('hamachi')) return 'Hamachi';
  if (address.startsWith('100.') && n.includes('tailscale')) return 'Tailscale';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) return 'Локальная сеть';
  return 'Интернет / другое';
}
function interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, address: a.address, kind: classify(name, a.address) });
    }
  }
  const order = ['Radmin VPN', 'ZeroTier', 'Hamachi', 'Tailscale', 'Локальная сеть', 'Интернет / другое'];
  return out.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
}

// ---------- окно ----------
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// ---------- трей: закрытие окна сворачивает программу к часам, она продолжает работать ----------
let tray = null;
let trayPrefs = { closeToTray: true };
let trayMuted = false;
const trayStateFile = () => path.join(app.getPath('userData'), 'tray.json');
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Открыть Сходку', click: showWindow },
    { label: trayMuted ? 'Включить микрофон' : 'Выключить микрофон', click: () => win && win.webContents.send('tray:action', 'mute') },
    { type: 'separator' },
    { label: 'Выйти', click: () => quitFromTray() },
  ]);
}
function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'main', 'assets', 'tray.png'));
    tray = new Tray(img);
    tray.setToolTip('Сходка');
    tray.setContextMenu(trayMenu());
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch (e) { log('warn', 'main', `Значок в трее не создан: ${e.message}`); tray = null; }
}
async function quitFromTray() {
  if (server) {
    const { response } = await dialog.showMessageBox({ type: 'warning', buttons: ['Выйти и остановить сервер', 'Отмена'], defaultId: 1, cancelId: 1, title: 'Вы — хост', message: 'Вы хост сервера. Если выйти, сервер отключится у всех друзей.' });
    if (response !== 0) return;
  }
  quitting = true; app.quit();
}
function hintTrayOnce() {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(trayStateFile(), 'utf8')); } catch (_) { /* первый раз */ }
  if (st.hinted) return;
  try { fs.writeFileSync(trayStateFile(), JSON.stringify({ hinted: true })); } catch (_) { /* ignore */ }
  const content = 'Сходка продолжает работать у часов. Открыть — щелчок по значку, выйти — правый щелчок → «Выйти».';
  if (process.platform === 'win32' && tray) tray.displayBalloon({ title: 'Сходка свёрнута в трей', content, iconType: 'info' });
  else if (Notification.isSupported()) new Notification({ title: 'Сходка свёрнута в трей', body: content, silent: true }).show();
}
// полный экран для демонстрации — управляет программа сама (а не браузерный Fullscreen API),
// чтобы Esc и конец трансляции всегда возвращали обычное окно
ipcMain.handle('win:fullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); return true; });
// 1.20: кнопки свернуть/развернуть/закрыть рисует Windows — перекрашиваем их под фон выбранного дизайна
ipcMain.handle('win:titlebar', (_e, c) => {
  const ok = (x) => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
  if (!win || !c || !ok(c.color) || !ok(c.symbol)) return false;
  try { win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbol, height: 40 }); win.setBackgroundColor(c.color); return true; } catch (_) { return false; }
});
ipcMain.handle('tray:prefs', (_e, p) => { trayPrefs = { ...trayPrefs, ...(p || {}) }; return true; });
ipcMain.on('tray:muted', (_e, m) => { trayMuted = !!m; if (tray) tray.setContextMenu(trayMenu()); });

// ---------- скачивание файлов из чата (любого размера, с докачкой при обрыве) ----------
const downloads = new Map();   // ключ → { item, path }
const pendingDl = [];          // ждут события will-download: { key, url, path, sender }
// Имя для нового файла в «Загрузках»: безопасное для Windows и не занятое — ни готовым файлом, ни
// недокачанным «.skhpart», ни скачиванием, которое идёт прямо сейчас (оно создаст файл позже).
const reservedPaths = new Set();
function safeFileName(name) {
  let base = path.basename(String(name || 'файл').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/[. ]+$/, '');
  let ext = path.extname(base); let stem = base.slice(0, base.length - ext.length);
  if (Array.from(ext).length > 16) { stem = base; ext = ''; }
  // Windows ограничивает имя 255 знаками UTF-16 (эмодзи — два знака): режем по целым символам до 180
  let cut = ''; for (const ch of stem) { if (cut.length + ch.length > 180) break; cut += ch; }
  stem = (ext ? cut : cut.replace(/[. ]+$/, '')) || 'файл'; // Windows отбрасывает точки и пробелы в конце имени
  // имена устройств Windows: проверяется часть до первой точки («con.tar.gz» — тоже устройство)
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(stem.split('.')[0].trim())) stem = '_' + stem;
  return { stem, ext };
}
function uniquePath(dir, name) {
  const { stem, ext } = safeFileName(name);
  const busy = (p) => fs.existsSync(p) || fs.existsSync(p + '.skhpart') || reservedPaths.has(p.toLowerCase());
  let p = path.join(dir, stem + ext); let i = 1;
  while (busy(p)) p = path.join(dir, `${stem} (${i++})${ext}`);
  return p;
}
const reservePath = (p) => reservedPaths.add(String(p).toLowerCase());
const releasePath = (p) => reservedPaths.delete(String(p).toLowerCase());
// адрес сравниваем в одном виде: Chromium убирает порт по умолчанию (https://x:443/ → https://x/)
const normUrl = (u) => { try { return new URL(u).href; } catch (_) { return String(u); } };
ipcMain.handle('dl:start', async (e, { key, url, name, saveAs }) => {
  let target;
  if (saveAs) {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), path.basename(String(name || 'файл'))) });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    target = r.filePath;
  } else target = uniquePath(app.getPath('downloads'), name);
  reservePath(target);
  pendingDl.push({ key, url: normUrl(url), path: target, sender: e.sender, t: Date.now() });
  e.sender.downloadURL(url);
  return { ok: true, path: target };
});
const p2pFiles = require('./main/p2pfiles').setupP2PFiles({ ipcMain, app, dialog, getWin: () => win, uniquePath, reservePath, releasePath });
ipcMain.handle('dl:cancel', (_e, key) => { const d = downloads.get(key); if (d) d.item.cancel(); return !!d; });
ipcMain.handle('dl:open', async (_e, p) => { const err = await shell.openPath(String(p)); return err || ''; });
ipcMain.handle('dl:show', (_e, p) => { shell.showItemInFolder(String(p)); return true; });
ipcMain.handle('dl:exists', (_e, p) => { try { return fs.statSync(String(p)).isFile(); } catch (_) { return false; } });
function setupDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    const i = pendingDl.findIndex((d) => d.url === normUrl(item.getURL()));
    if (i < 0) return; // не наше — пусть Electron спросит, куда сохранить
    const d = pendingDl.splice(i, 1)[0];
    item.setSavePath(d.path);
    downloads.set(d.key, { item, path: d.path });
    const send = (m) => { if (!d.sender.isDestroyed()) d.sender.send('dl:event', { key: d.key, path: d.path, ...m }); };
    let last = 0; let resumes = 0;
    item.on('updated', (_ev, state) => {
      if (state === 'interrupted') {
        if (item.canResume() && resumes < 10) { resumes++; log('warn', 'chat', `Скачивание «${path.basename(d.path)}» прервалось — продолжаю (попытка ${resumes})`); setTimeout(() => { try { item.resume(); } catch (_) { /* ignore */ } }, 2000); }
        return send({ type: 'progress', received: item.getReceivedBytes(), total: item.getTotalBytes(), stalled: true });
      }
      const now = Date.now();
      if (now - last < 250) return; last = now;
      send({ type: 'progress', received: item.getReceivedBytes(), total: item.getTotalBytes() });
    });
    item.once('done', (_ev, state) => {
      downloads.delete(d.key); releasePath(d.path);
      if (state === 'completed') log('info', 'chat', `Файл скачан: ${d.path}`);
      else if (state !== 'cancelled') log('warn', 'chat', `Не удалось скачать «${path.basename(d.path)}» (${state})`, { hint: 'Проверьте связь с хостом и место на диске, затем нажмите «Скачать» ещё раз.' });
      send({ type: 'done', state });
    });
  });
}

// ---------- сохранить файл (картинка из чата) ----------
// «Вставить» из меню правой кнопки: буфер обмена читаем здесь (у окна нет разрешения на чтение буфера).
// Есть текст — вставляем текст (из Word вместе с текстом в буфер кладётся и его картинка); нет — картинку
// (скопированная картинка, скриншот «Ножниц» Win+Shift+S).
ipcMain.handle('clip:read', (_e, { image } = {}) => {
  const text = clipboard.readText();
  if (text) return { text };
  if (image) { const img = clipboard.readImage(); if (!img.isEmpty()) return { image: new Uint8Array(img.toPNG()) }; }
  return {};
});
ipcMain.handle('file:save', async (_e, { name, bytes }) => {
  const ext = (path.extname(String(name || '')) || '.png').slice(1).toLowerCase();
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), path.basename(String(name || 'картинка.png'))), filters: [{ name: 'Картинка', extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, Buffer.from(bytes)); return { ok: true, path: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- аватарка: копия в папке программы (на новый сервер загрузится сама) ----------
// Своя копия у каждого ника: если на этом компьютере входит друг, его аватарка не смешивается с вашей.
const AVATAR_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const avatarDir = () => path.join(app.getPath('userData'), 'profile');
const ownerKey = (o) => require('crypto').createHash('sha256').update(String(o || '').trim().toLowerCase()).digest('hex').slice(0, 24);
function readAvatar(dir, base) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, base + '.json'), 'utf8'));
    if (!AVATAR_EXT[meta.type]) return null;
    return { type: meta.type, bytes: new Uint8Array(fs.readFileSync(path.join(dir, base + '.' + AVATAR_EXT[meta.type]))) };
  } catch (_) { return null; }
}
function writeAvatar(dir, base, a) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '.')) fs.unlinkSync(path.join(dir, f));
  if (a && AVATAR_EXT[a.type] && a.bytes && a.bytes.length <= 1024 * 1024) {
    fs.writeFileSync(path.join(dir, base + '.' + AVATAR_EXT[a.type]), Buffer.from(a.bytes));
    fs.writeFileSync(path.join(dir, base + '.json'), JSON.stringify({ type: a.type }));
  }
}
ipcMain.handle('avatar:get', (_e, { owner, adoptLegacy } = {}) => {
  const dir = path.join(avatarDir(), 'avatars'); const base = ownerKey(owner);
  let a = readAvatar(dir, base);
  // копия из версии 1.10 (одна на компьютер) достаётся тому нику, под которым тогда входили
  if (!a && adoptLegacy) {
    const legacy = readAvatar(avatarDir(), 'avatar');
    if (legacy) { try { writeAvatar(dir, base, legacy); writeAvatar(avatarDir(), 'avatar', null); } catch (_) { /* ignore */ } a = legacy; }
  }
  return a;
});
ipcMain.handle('avatar:set', (_e, { owner, avatar } = {}) => {
  try { writeAvatar(path.join(avatarDir(), 'avatars'), ownerKey(owner), avatar); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 940, minHeight: 600,
    backgroundColor: '#0A0B12',
    // своя тёмная рамка: заголовок рисует окно, а кнопки свернуть/развернуть/закрыть — Windows, в тон программе
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0A0B12', symbolColor: '#9A9DB2', height: 40 },
    title: 'Сходка',
    icon: path.join(__dirname, 'main', 'assets', 'app.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadURL('app://local/index.html');

  // окно перезагружается или упало — закрываем то, что оно держало: помощники записи звука, открытые файлы
  const wcId = win.webContents.id;
  const dropWindowResources = () => { procAudio.dropOwner(wcId); videoCap.dropOwner(wcId); p2pFiles.dropOwner(wcId); };
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) dropWindowResources(); });
  win.webContents.on('destroyed', dropWindowResources);
  // переходить окно может только по своим страницам; ссылки — во внешний браузер
  win.webContents.on('will-navigate', (e, url) => { if (!String(url).startsWith('app://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // выключение компьютера или выход из Windows, пока «Сходка» в трее: сервер хоста сохраняет базу сразу
  win.on('session-end', () => { if (server) { const s0 = server; server = null; s0.close(); } });
  win.webContents.on('render-process-gone', (_e, d) => {
    dropWindowResources();
    log('error', 'main', `Окно приложения упало (${d.reason}, код ${d.exitCode})`, { hint: 'Окно будет перезагружено. Если повторяется — пришлите файл лога.' });
    if (!quitting) setTimeout(() => win && !win.isDestroyed() && win.reload(), 1000);
  });
  win.webContents.on('unresponsive', () => log('warn', 'main', 'Окно не отвечает (зависло)'));
  win.webContents.on('responsive', () => log('info', 'main', 'Окно снова отвечает'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('error', 'main', `Не удалось загрузить интерфейс: ${desc} (${code}) ${url}`));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (!quitting && trayPrefs.closeToTray && tray) { e.preventDefault(); win.hide(); hintTrayOnce(); return; }
    if (quitting || !server) return;
    e.preventDefault();
    dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Закрыть и остановить сервер', 'Отмена'], defaultId: 1, cancelId: 1,
      title: 'Вы — хост', message: 'Вы хост сервера. Если закрыть программу, сервер отключится у всех друзей.',
    }).then(({ response }) => { if (response === 0) { quitting = true; app.quit(); } });
  });
  // Состояние окна — для окна (footprint.js): пока идёт показ экрана, а окно свёрнуто, в трее или не в фокусе
  // (человек в игре), оно не тратит процессор и видеокарту на анимации и превью. Фоновый режим Chromium
  // для этого не годится: он выключен нарочно (флаги выше), иначе в свёрнутом окне заикается звук.
  const sendWinState = () => { if (win && !win.isDestroyed()) win.webContents.send('win:state', { focused: win.isFocused(), minimized: win.isMinimized(), visible: win.isVisible() }); };
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) win.on(ev, sendWinState);
  win.webContents.on('did-finish-load', sendWinState);
  win.on('enter-full-screen', () => win.webContents.send('win:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('win:fullscreen', false));
  win.on('closed', () => { win = null; });
}

logger.listeners.add((e) => { if (win && !win.isDestroyed()) win.webContents.send('log:entry', e); });

// ---------- доверие к сертификатам серверов (как в SSH: доверяем при первом входе) ----------
// Сервер на VPS шифрует соединение собственным сертификатом. При первом подключении
// показываем его отпечаток и запоминаем; если позже он изменится — соединение блокируется.
const pinsFile = () => path.join(app.getPath('userData'), 'trusted-servers.json');
let pins = null;
const certStatus = {};
const pendingTrust = {};
function loadPins() { if (!pins) { try { pins = JSON.parse(fs.readFileSync(pinsFile(), 'utf8')); } catch (_) { pins = {}; } } return pins; }
function savePins() { try { fs.writeFileSync(pinsFile(), JSON.stringify(pins, null, 2)); } catch (e) { log('warn', 'net', `Не удалось сохранить доверенные серверы: ${e.message}`); } }
function shortFp(fp) {
  const hex = Buffer.from(String(fp).replace(/^sha256\//, ''), 'base64').toString('hex').toUpperCase().slice(0, 16);
  return hex.match(/.{4}/g).join('-');
}
async function askTrust(host, fp) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Доверять', 'Отмена'], defaultId: 0, cancelId: 1, noLink: true,
    title: 'Новый сервер',
    message: `Первое подключение к серверу ${host}`,
    detail: `Соединение будет зашифровано. Сверьте отпечаток сервера с тем, что показал установщик (команда «skhodka info» на сервере):\n\n${shortFp(fp)}\n\nЕсли совпадает — нажмите «Доверять». Программа запомнит этот сервер.`,
  });
  return response === 0;
}
function setupCertTrust() {
  session.defaultSession.setCertificateVerifyProc((req, callback) => {
    if (req.verificationResult === 'net::OK') return callback(-3);
    const host = req.hostname;
    log('debug', 'net', `Проверка сертификата ${host}: ${req.verificationResult} (${req.errorCode})`);
    const fp = req.certificate && req.certificate.fingerprint;
    const p = loadPins();
    if (!fp) return callback(-2);
    if (p[host] === fp) { certStatus[host] = 'ok'; return callback(0); }
    if (p[host] && p[host] !== fp) {
      certStatus[host] = 'mismatch';
      log('error', 'net', `Сертификат сервера ${host} изменился — соединение заблокировано`, {
        hint: `Если сервер переустанавливали — это нормально: нажмите «Забыть сервер» на экране подключения и подключитесь заново, сверив отпечаток (${shortFp(fp)}) с командой «skhodka info» на сервере. Если нет — возможна подмена, не подключайтесь.`,
      });
      return callback(-2);
    }
    if (!win || win.isDestroyed()) return callback(-2);
    if (!pendingTrust[host]) {
      certStatus[host] = 'pending';
      pendingTrust[host] = askTrust(host, fp).then((yes) => {
        if (yes) { p[host] = fp; savePins(); certStatus[host] = 'ok'; log('info', 'net', `Сервер ${host} добавлен в доверенные (отпечаток ${shortFp(fp)})`); }
        else { certStatus[host] = 'rejected'; log('warn', 'net', `Вы не подтвердили сертификат сервера ${host}`); }
        setTimeout(() => { delete pendingTrust[host]; }, 2000);
        return yes;
      });
    }
    pendingTrust[host].then((yes) => callback(yes ? 0 : -2));
  });
}

// ---------- захват экрана ----------
let lastSources = [];
let pendingScreen = null;

// 1.20.1: где выбранный монитор на рабочем столе — в настоящих пикселях, как его видит видеокарта. По этому месту
// помощник «Видеокартой» находит свой экран: номера экранов у Chromium и у видеокарты могут не совпасть
// (у irritat 25.10 при двух мониторах снимался не тот). null — не знаем (экран выбран не через окно выбора)
function screenRectOf(sourceId) {
  try {
    const { screen: scr } = require('electron');
    const s = lastSources.find((x) => x.id === sourceId);
    const d = s && s.display_id ? scr.getAllDisplays().find((x) => String(x.id) === String(s.display_id)) : null;
    if (!d) return null;
    const p = process.platform === 'win32' ? scr.dipToScreenRect(null, d.bounds) : d.bounds;
    return { x: p.x, y: p.y, w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) };
  } catch (_) { return null; }
}

// Для журнала: какая Windows и каким способом снимаем — экран через DirectX (флаг AllowWgcScreenCapturer выше),
// окно способом Windows для окон. По этой строке видно, если у кого-то демка чёрная из-за Windows.
function captureHow(id) {
  if (process.platform !== 'win32') return '';
  const build = Number((os.release().split('.')[2]) || 0);
  const win = `Windows ${build >= 22000 ? 11 : 10}, сборка ${build}`;
  return /^screen:/.test(String(id)) ? ` · ${win} · экран снимается через DirectX (как на Windows 10)` : ` · ${win} · окно снимается способом Windows для окон`;
}

function setupMedia() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'].includes(permission));
  });
  ses.setPermissionCheckHandler(() => true);

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const sel = pendingScreen;
    pendingScreen = null;
    try {
      if (!sel) {
        log('warn', 'screen', 'Запрос демонстрации без выбранного экрана');
        return callback({});
      }
      let src = lastSources.find((s) => s.id === sel.id);
      if (!src) {
        const all = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        src = all.find((s) => s.id === sel.id);
      }
      if (!src) {
        log('error', 'screen', 'Выбранное окно больше не существует', { hint: 'Окно закрыли или свернули. Выберите источник заново.' });
        return callback({});
      }
      const result = { video: src };
      if (sel.audio && request.audioRequested) {
        if (process.platform === 'win32') result.audio = 'loopback';
        else log('warn', 'screen', 'Захват звука системы поддерживается только в Windows — демонстрация пойдёт без звука');
      }
      log('info', 'screen', `Захват: «${src.name}»${result.audio ? ' + звук системы' : ''}${captureHow(src.id)}`);
      callback(result);
    } catch (e) {
      log('error', 'screen', `Ошибка выбора источника: ${e.message}`, { details: e.stack });
      callback({});
    }
  }, { useSystemPicker: false });
}

// ---------- глобальная клавиша рации (необязательный модуль) ----------
let hook = null;
let hookStarted = false;
let pttBinding = null;
let captureResolve = null;
// 1.21: клавиши «Звуков для всех» — [{ id, code, ctrl, alt, shift }] (коды uiohook)
let sfxBinds = [];
let sfxCaptureResolve = null;
const keysDown = new Set();
const SFX_MODIFIERS = new Set([29, 3613, 42, 54, 56, 3640, 3675, 3676]); // Ctrl, Shift, Alt, Win (левые и правые)
function loadHook() {
  if (hook !== null) return hook;
  try {
    hook = require('uiohook-napi').uIOhook;
  } catch (e) {
    hook = false;
    log('warn', 'ptt', 'Глобальная клавиша рации недоступна — «рация» будет работать, только когда окно «Сходки» активно', { details: e.message });
  }
  return hook;
}
function startHook() {
  const h = loadHook();
  if (!h || hookStarted) return !!h;
  const match = (type, code) => pttBinding && pttBinding.type === type && pttBinding.code === code;
  const emit = (down) => win && !win.isDestroyed() && win.webContents.send('ptt', down);
  h.on('keydown', (e) => {
    const repeat = keysDown.has(e.keycode); keysDown.add(e.keycode); // зажатая клавиша шлёт keydown много раз
    if (sfxCaptureResolve) {
      if (SFX_MODIFIERS.has(e.keycode)) return; // ждём основную клавишу сочетания
      const r = sfxCaptureResolve; sfxCaptureResolve = null;
      return r(e.keycode === 1 || e.keycode === 14 ? { clear: true } : { code: e.keycode, ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey });
    }
    if (captureResolve) { const r = captureResolve; captureResolve = null; return r({ type: 'key', code: e.keycode }); }
    if (match('key', e.keycode)) emit(true);
    if (!repeat && sfxBinds.length) {
      const b = sfxBinds.find((x) => x.code === e.keycode && !!x.ctrl === !!e.ctrlKey && !!x.alt === !!e.altKey && !!x.shift === !!e.shiftKey);
      if (b && win && !win.isDestroyed()) win.webContents.send('sfx:fire', b.id);
    }
  });
  h.on('keyup', (e) => { keysDown.delete(e.keycode); if (match('key', e.keycode)) emit(false); });
  h.on('mousedown', (e) => {
    if (captureResolve && e.button > 2) { const r = captureResolve; captureResolve = null; return r({ type: 'mouse', code: e.button }); }
    if (match('mouse', e.button)) emit(true);
  });
  h.on('mouseup', (e) => { if (match('mouse', e.button)) emit(false); });
  try { h.start(); hookStarted = true; log('info', 'ptt', 'Глобальная клавиша рации включена'); } catch (e) {
    log('warn', 'ptt', `Не удалось включить глобальную клавишу: ${e.message}`);
    hook = false;
  }
  return hookStarted;
}

let hostKey = '';
// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('host:start', async (_e, { port }) => {
    if (server) return { ok: true, port: server.port, already: true, interfaces: interfaces(), hostKey };
    const { createServer } = require('./server/server');
    try {
      // секрет хоста: права хоста (удалить ник, чужой файл) даёт только он, а не адрес 127.0.0.1 —
      // через туннель или прокси все подключения тоже приходят с 127.0.0.1
      hostKey = require('crypto').randomBytes(24).toString('hex');
      server = await createServer({ port, dataDir: path.join(app.getPath('userData'), 'server'), log: (l, c, m) => log(l, c, m), hostKey });
      return { ok: true, port, interfaces: interfaces(), hostKey };
    } catch (e) {
      const h = netHint(e.code, '0.0.0.0', port);
      log('error', 'host', `Не удалось запустить сервер: ${h.msg}`, { hint: h.hint, details: e.message });
      server = null;
      return { ok: false, code: e.code, message: h.msg, hint: h.hint };
    }
  });
  ipcMain.handle('host:stop', async () => { if (server) { await server.close(); server = null; } return { ok: true }; });
  ipcMain.handle('host:status', () => (server ? { running: true, port: server.port, ...server.stats() } : { running: false }));

  ipcMain.handle('net:interfaces', () => interfaces());
  ipcMain.handle('cert:status', (_e, host) => certStatus[host] || null);
  ipcMain.handle('cert:forget', (_e, host) => { const p = loadPins(); delete p[host]; savePins(); delete certStatus[host]; log('info', 'net', `Сервер ${host} удалён из доверенных`); return true; });
  ipcMain.handle('net:test', (_e, { host, port }) => new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host, port, timeout: 5000 });
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.once('connect', () => done({ ok: true, ms: Date.now() - started }));
    sock.once('timeout', () => done({ ok: false, code: 'ETIMEDOUT', ...netHint('ETIMEDOUT', host, port) }));
    sock.once('error', (e) => done({ ok: false, code: e.code, ...netHint(e.code, host, port) }));
  }));

  ipcMain.handle('screen:sources', async () => {
    try {
      const race = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      try {
        lastSources = await race(desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true }), 10000);
      } catch (e) {
        // список окон иногда «зависает» (зависшая программа, драйвер) — показываем хотя бы экраны
        log('warn', 'screen', 'Список окон не загрузился за 10 секунд — показываю только экраны', { hint: 'Возможно, какое-то окно зависло. Можно показать весь экран.' });
        lastSources = await race(desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } }), 10000);
      }
      // 1.19.3: какой это монитор — размер, основной ли и открыто ли на нём окно «Сходки». У irritat 24.10 «Экран 1»
      // оказался монитором со «Сходкой», а игра шла на другом: друзья видели окно программы на весь экран
      const { screen: scr } = require('electron');
      let disps = []; let primary = null; let here = null;
      try {
        disps = scr.getAllDisplays(); primary = scr.getPrimaryDisplay().id;
        if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) here = scr.getDisplayMatching(win.getBounds()).id;
      } catch (_) { /* без сведений о мониторах — подписи как раньше */ }
      const dispOf = (s) => {
        const d = s.display_id ? disps.find((x) => String(x.id) === String(s.display_id)) : null;
        return d ? { w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor), primary: d.id === primary, here: d.id === here } : null;
      };
      return lastSources.map((s) => ({
        id: s.id, name: s.name, isScreen: s.id.startsWith('screen:'),
        thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        disp: s.id.startsWith('screen:') ? dispOf(s) : null,
      }));
    } catch (e) {
      log('error', 'screen', `Не удалось получить список экранов: ${e.message}`, { hint: process.platform === 'darwin' ? 'macOS: Системные настройки → Конфиденциальность → Запись экрана → разрешить «Сходке».' : 'Перезапустите программу; обновите видеодрайвер.' });
      return [];
    }
  });
  ipcMain.handle('screen:select', (_e, sel) => { pendingScreen = sel; return true; });

  ipcMain.on('log:write', (_e, entry) => logger.write({ ...entry, src: 'ui' }));
  ipcMain.handle('log:recent', () => logger.recent);
  ipcMain.handle('log:openFolder', () => shell.openPath(logger.dir));
  // «Журнал» → «На рабочий стол» (1.16.2): все файлы журналов одним архивом на рабочий стол — и показать его в папке
  ipcMain.handle('log:zipToDesktop', () => {
    try {
      const files = logFiles();
      if (!files.length) return { ok: false, error: 'журналов пока нет' };
      const zip = makeZip(files.map((f) => ({ name: f.name, data: fs.readFileSync(f.path), mtime: f.mtime })));
      const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
      const name = `Skhodka-zhurnaly-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}.zip`;
      const out = path.join(app.getPath('desktop'), name);
      fs.writeFileSync(out, zip);
      shell.showItemInFolder(out);
      log('info', 'main', `Архив журналов на рабочем столе: ${out} (файлов: ${files.length}, ${Math.round(zip.length / 1024)} КБ)`);
      return { ok: true, path: out, name, files: files.length, bytes: zip.length };
    } catch (e) {
      log('warn', 'main', `Архив журналов не сохранён: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });
  // «Журнал» → «В чат» (1.16.2): последний файл журнала (за сегодня) — окно само отправит его в открытый чат
  ipcMain.handle('log:latest', () => {
    const last = logFiles().filter((f) => f.name.endsWith('.log')).pop();
    return last ? { name: last.name, data: fs.readFileSync(last.path) } : null;
  });
  // журнал по просьбе админа (1.18): два последних файла — вечер часто переходит через полночь — одним архивом
  ipcMain.handle('log:forAdmin', (_e, who) => {
    const files = logFiles().filter((f) => f.name.endsWith('.log')).slice(-2);
    if (!files.length) return null;
    const zip = makeZip(files.map((f) => ({ name: f.name, data: fs.readFileSync(f.path), mtime: f.mtime })));
    const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
    const nick = String(who || '').replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 24) || 'drug';
    return { name: `Skhodka-zhurnal-${nick}-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}.zip`, data: zip, files: files.length };
  });
  ipcMain.handle('log:save', async (_e, text) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Сохранить лог', defaultPath: path.join(app.getPath('desktop'), `skhodka-log-${Date.now()}.txt`),
      filters: [{ name: 'Текст', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, text, 'utf8');
    return filePath;
  });

  ipcMain.handle('ptt:set', (_e, { binding, global }) => {
    pttBinding = binding || null;
    if (global && binding) return { global: startHook() };
    return { global: false };
  });
  ipcMain.handle('ptt:capture', () => {
    if (!startHook()) return null;
    return new Promise((resolve) => {
      captureResolve = resolve;
      setTimeout(() => { if (captureResolve === resolve) { captureResolve = null; resolve(null); } }, 10000);
    });
  });
  // 1.21: «Звуки для всех» — клавиши работают и в свёрнутом окне (в игре), если глобальный перехват доступен
  ipcMain.handle('sfx:binds', (_e, list) => {
    sfxBinds = (Array.isArray(list) ? list : []).filter((b) => b && b.id && Number.isInteger(b.code))
      .map((b) => ({ id: String(b.id), code: b.code, ctrl: !!b.ctrl, alt: !!b.alt, shift: !!b.shift }));
    return { global: sfxBinds.length ? startHook() : false };
  });
  ipcMain.handle('sfx:capture', () => {
    if (!startHook()) return null;
    if (sfxCaptureResolve) sfxCaptureResolve(null);
    return new Promise((resolve) => {
      sfxCaptureResolve = resolve;
      setTimeout(() => { if (sfxCaptureResolve === resolve) { sfxCaptureResolve = null; resolve(null); } }, 10000);
    });
  });
  ipcMain.handle('sfx:captureCancel', () => { if (sfxCaptureResolve) { const r = sfxCaptureResolve; sfxCaptureResolve = null; r(null); } return true; });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    os: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0] && os.cpus()[0].model,
    memGb: Math.round(os.totalmem() / 1073741824), userData: app.getPath('userData'), logDir: logger.dir,
    multiCore, // 1.18.2: включено ли сжатие процессором на нескольких ядрах (с 1.20.1 — всегда)
  }));
  // «Отчёт о демке»: система этого ПК — ОС, процессор, память, видеокарты с драйвером, экраны, ускорение видео
  ipcMain.handle('app:sysinfo', async () => {
    const { screen: scr, powerMonitor } = require('electron');
    const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
    const gpu = (await within(app.getGPUInfo('complete'), 5000)) || (await within(app.getGPUInfo('basic'), 3000)) || {};
    const hex = (n) => (typeof n === 'number' ? n.toString(16).padStart(4, '0') : '?');
    const gl = (gpu.auxAttributes && gpu.auxAttributes.glRenderer) || '';
    const gpus = (gpu.gpuDevice || []).map((d) => ({ name: d.deviceString || (d.active && gl) || `${hex(d.vendorId)}:${hex(d.deviceId)}`, vendor: hex(d.vendorId), device: hex(d.deviceId), driver: d.driverVersion || '', active: !!d.active }));
    let features = null; try { features = app.getGPUFeatureStatus(); } catch (_) { /* ignore */ }
    const primary = scr.getPrimaryDisplay().id;
    const build = Number((os.release().split('.')[2]) || 0);
    const cpus = os.cpus();
    return {
      app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      osName: process.platform === 'win32' ? `Windows ${build >= 22000 ? 11 : 10} (сборка ${build}, ${os.version ? os.version() : ''})` : `${os.version ? os.version() : os.type()} ${os.release()}`,
      cpu: cpus[0] ? cpus[0].model.trim() : '', threads: cpus.length, ramGb: Math.round(os.totalmem() / 1073741824 * 10) / 10, freeGb: Math.round(os.freemem() / 1073741824 * 10) / 10,
      gpus, gl, gpuFeatures: features && { video_encode: features.video_encode, video_decode: features.video_decode, gpu_compositing: features.gpu_compositing },
      displays: scr.getAllDisplays().map((d) => ({ w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor), hz: d.displayFrequency ? Math.round(d.displayFrequency) : null, scale: d.scaleFactor, primary: d.id === primary })),
      battery: !!(powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower()),
    };
  });
  // «Отчёт о демке»: ЦП самой «Сходки» по видам процессов (% одного ядра) и всего компьютера — раз в секунду
  const footprint = createFootprint({ app, os });
  ipcMain.handle('app:footprint', () => { try { return footprint.sample(); } catch (_) { return null; } });
  ipcMain.handle('app:notify', (_e, { title, body }) => {
    if (win && win.isFocused()) return;
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
    if (win) win.flashFrame(true);
  });
  ipcMain.handle('app:relaunch', async () => {
    quitting = true;
    if (server) { const s0 = server; server = null; await s0.close(); } // app.exit не вызывает before-quit — сохраняем базу сами
    app.relaunch(); app.exit(0);
  });
}

// ---------- запуск ----------
app.whenReady().then(async () => {
  const nsxDir = path.dirname(require.resolve('@sapphi-red/web-noise-suppressor'));
  const rendererDir = path.join(__dirname, 'renderer');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  protocol.handle('app', async (req) => {
    try {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const [base, rel] = p.startsWith('/vendor/nsx/') ? [nsxDir, p.slice(12)] : [rendererDir, p.slice(1)];
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base)) return new Response('forbidden', { status: 403 });
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
    } catch (e) {
      log('error', 'main', `Не найден файл интерфейса: ${req.url}`, { details: e.message });
      return new Response('not found', { status: 404 });
    }
  });

  setupMedia();
  setupCertTrust();
  setupIpc();
  setupDownloads();
  createWindow();
  createTray();
  log('info', 'main', `Сходка ${app.getVersion()} запущена · Electron ${process.versions.electron} · ${os.type()} ${os.release()} · данные: ${app.getPath('userData')}`);
  const ifs = interfaces();
  const vpn = ifs.filter((i) => ['Radmin VPN', 'ZeroTier', 'Hamachi', 'Tailscale'].includes(i.kind));
  if (vpn.length) log('info', 'net', `Найдена VPN-сеть: ${vpn.map((i) => `${i.kind} ${i.address}`).join(', ')}`);
  else log('info', 'net', 'VPN-сети (Radmin VPN и т. п.) нет — для сервера в интернете она и не нужна; для своего сервера дома друзьям нужен общий Radmin VPN или «белый» адрес');
});

app.on('child-process-gone', (_e, d) => {
  if (d.reason === 'clean-exit') return;
  const hint = d.type === 'GPU' ? 'Упал процесс видеокарты. Обновите видеодрайвер; если повторяется при демонстрации — выберите кодек «H.264 — процессор» в Настройки → Показ экрана.' : undefined;
  log(d.reason === 'killed' ? 'warn' : 'error', 'main', `Вспомогательный процесс ${d.type}${d.name ? ' (' + d.name + ')' : ''} завершился: ${d.reason}, код ${d.exitCode}`, { hint });
});

app.on('before-quit', async (e) => {
  quitting = true;
  if (server) {
    e.preventDefault();
    const s = server; server = null;
    await s.close();
    app.quit();
  }
});
app.on('will-quit', () => { if (hookStarted && hook) { try { hook.stop(); } catch (_) { /* ignore */ } } });
app.on('window-all-closed', () => app.quit());
