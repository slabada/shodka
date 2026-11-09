'use strict';
// Мост между окном и главным процессом. Окно не имеет доступа к Node — только к этим функциям.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  // только для автотестов: подставной «звук компьютера» в трансляции на Linux
  testFlags: { fakeScreenAudio: process.env.SKHODKA_FAKE_SCREEN_AUDIO || '', fakeProcAudio: !!process.env.SKHODKA_FAKE_PROCAUDIO },
  hostStart: (port) => ipcRenderer.invoke('host:start', { port }),
  hostStop: () => ipcRenderer.invoke('host:stop'),
  hostStatus: () => ipcRenderer.invoke('host:status'),
  interfaces: () => ipcRenderer.invoke('net:interfaces'),
  netTest: (host, port) => ipcRenderer.invoke('net:test', { host, port }),
  certStatus: (host) => ipcRenderer.invoke('cert:status', host),
  certForget: (host) => ipcRenderer.invoke('cert:forget', host),
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  screenSelect: (sel) => ipcRenderer.invoke('screen:select', sel),
  musicApps: () => ipcRenderer.invoke('music:apps'),
  logWrite: (entry) => ipcRenderer.send('log:write', entry),
  logRecent: () => ipcRenderer.invoke('log:recent'),
  logOpenFolder: () => ipcRenderer.invoke('log:openFolder'),
  logSave: (text) => ipcRenderer.invoke('log:save', text),
  logZipToDesktop: () => ipcRenderer.invoke('log:zipToDesktop'), // все журналы одним архивом на рабочий стол (1.16.2)
  logLatest: () => ipcRenderer.invoke('log:latest'),              // последний файл журнала — для отправки в чат (1.16.2)
  logForAdmin: (who) => ipcRenderer.invoke('log:forAdmin', who),  // два последних журнала архивом — по просьбе админа (1.18)
  pttSet: (binding, global) => ipcRenderer.invoke('ptt:set', { binding, global }),
  pttCapture: () => ipcRenderer.invoke('ptt:capture'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  sysInfo: () => ipcRenderer.invoke('app:sysinfo'), // «Отчёт о демке»
  footprint: () => ipcRenderer.invoke('app:footprint'), // «Отчёт о демке»: ЦП «Сходки» по процессам и всего ПК
  notify: (title, body) => ipcRenderer.invoke('app:notify', { title, body }),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  // 1.20.5: обновления из GitHub Releases — { status: idle|checking|none|downloading|ready|error|unsupported, version, percent, ... }
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: on('update:state'),
  },
  // 1.21: «Звуки для всех» — свои файлы звуков и клавиши (в т. ч. в свёрнутом окне)
  sfx: {
    list: () => ipcRenderer.invoke('sfx:list'),
    savePrefs: (prefs) => ipcRenderer.invoke('sfx:prefs', prefs),
    add: (name, ext, bytes) => ipcRenderer.invoke('sfx:add', { name, ext, bytes }),
    rename: (id, name) => ipcRenderer.invoke('sfx:rename', { id, name }),
    remove: (id) => ipcRenderer.invoke('sfx:remove', id),
    read: (id) => ipcRenderer.invoke('sfx:read', id),
    setBinds: (list) => ipcRenderer.invoke('sfx:binds', list),
    capture: () => ipcRenderer.invoke('sfx:capture'),
    captureCancel: () => ipcRenderer.invoke('sfx:captureCancel'),
    onFire: on('sfx:fire'),
  },
  // звук компьютера без звука «Сходки» (помощник skh-audiocap.exe)
  procAudio: {
    available: process.platform === 'win32' || !!process.env.SKHODKA_FAKE_PROCAUDIO,
    start: (opts) => ipcRenderer.invoke('procaudio:start', opts || {}),
    windowPid: (sourceId) => ipcRenderer.invoke('procaudio:windowPid', sourceId),
    stop: (id) => ipcRenderer.invoke('procaudio:stop', id),
    onData: (cb) => { const h = (_e, id, buf) => cb(id, buf); ipcRenderer.on('procaudio:data', h); return () => ipcRenderer.removeListener('procaudio:data', h); },
    onMsg: on('procaudio:msg'),
  },
  // 1.19.0: захват и сжатие видеокартой (помощник skh-videocap.exe): кадры H.264 и сообщения
  videoCap: {
    available: () => ipcRenderer.invoke('videocap:available'),
    missing: () => ipcRenderer.invoke('videocap:missing'), // 1.19.2: чего не хватает в папке помощника ('' — всё на месте)
    start: (opts) => ipcRenderer.invoke('videocap:start', opts || {}),
    cmd: (id, line) => ipcRenderer.invoke('videocap:cmd', id, line),
    stop: (id) => ipcRenderer.invoke('videocap:stop', id),
    onAu: (cb) => { const h = (_e, id, buf) => cb(id, buf); ipcRenderer.on('videocap:au', h); return () => ipcRenderer.removeListener('videocap:au', h); },
    onMsg: (cb) => { const h = (_e, m) => cb(m); ipcRenderer.on('videocap:msg', h); return () => ipcRenderer.removeListener('videocap:msg', h); },
  },
  setFullscreen: (on) => ipcRenderer.invoke('win:fullscreen', !!on),
  setTitleBar: (c) => ipcRenderer.invoke('win:titlebar', c), // 1.20: кнопки окна — в тон дизайну { color, symbol }
  onFullscreen: on('win:fullscreen'),
  onWinState: on('win:state'), // { focused, minimized, visible } — окно в фоне во время показа не рисует лишнего
  trayPrefs: (p) => ipcRenderer.invoke('tray:prefs', p),
  trayMuted: (m) => ipcRenderer.send('tray:muted', !!m),
  onTrayAction: on('tray:action'),
  saveFile: (name, bytes) => ipcRenderer.invoke('file:save', { name, bytes }),
  clipRead: (image) => ipcRenderer.invoke('clip:read', { image: !!image }),
  avatarGet: (owner, adoptLegacy) => ipcRenderer.invoke('avatar:get', { owner, adoptLegacy }),
  // прямая передача файлов: путь выбранного файла, раздача с диска, запись в «Загрузки»
  filePath: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; } },
  p2p: {
    share: (id, p) => ipcRenderer.invoke('p2p:share', { id, path: p }),
    unshare: (id) => ipcRenderer.invoke('p2p:unshare', id),
    check: (id) => ipcRenderer.invoke('p2p:check', id),
    openRead: (id) => ipcRenderer.invoke('p2p:openRead', id),
    read: (hid, pos, len) => ipcRenderer.invoke('p2p:read', { hid, pos, len }),
    closeRead: (hid) => ipcRenderer.invoke('p2p:closeRead', hid),
    openWrite: (o) => ipcRenderer.invoke('p2p:openWrite', o),
    write: (wid, bytes) => ipcRenderer.invoke('p2p:write', { wid, bytes }),
    closeWrite: (o) => ipcRenderer.invoke('p2p:closeWrite', o),
    dropPart: (part) => ipcRenderer.invoke('p2p:dropPart', part),
  },
  avatarSet: (owner, avatar) => ipcRenderer.invoke('avatar:set', { owner, avatar }),
  download: (key, url, name, saveAs) => ipcRenderer.invoke('dl:start', { key, url, name, saveAs }),
  downloadCancel: (key) => ipcRenderer.invoke('dl:cancel', key),
  openPath: (p) => ipcRenderer.invoke('dl:open', p),
  showInFolder: (p) => ipcRenderer.invoke('dl:show', p),
  fileExists: (p) => ipcRenderer.invoke('dl:exists', p),
  onDownload: on('dl:event'),
  onLog: on('log:entry'),
  onPtt: on('ptt'),
});
