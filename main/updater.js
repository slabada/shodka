'use strict';
// Автообновление (1.20.5): новые версии берутся из GitHub Releases (electron-updater).
// Работает только в программе, поставленной установщиком (Skhodka-Setup-*.exe): рядом с ней лежит app-update.yml.
// Обновление качается в фоне само; ставится по кнопке «Перезапустить» или при выходе из «Сходки».
const path = require('path');
const fs = require('fs');

const FIRST_CHECK_MS = 15 * 1000;        // первая проверка — после запуска, когда окно уже открыто
const EVERY_MS = 4 * 60 * 60 * 1000;     // дальше — раз в 4 часа

module.exports = function setupUpdater({ ipcMain, app, log, getWin }) {
  let state = { status: 'idle', current: app.getVersion() };
  const set = (s) => {
    state = { current: app.getVersion(), ...s };
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('update:state', state);
  };

  let updater = null;
  if (!app.isPackaged) state = { ...state, status: 'unsupported', reason: 'Программа запущена из исходников — обновлять нечего' };
  else if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    state = { ...state, status: 'unsupported', reason: 'Эта копия не из установщика — обновления ставятся только в программу, установленную через Skhodka-Setup.exe' };
  } else {
    try {
      ({ autoUpdater: updater } = require('electron-updater'));
    } catch (e) {
      state = { ...state, status: 'unsupported', reason: `Модуль обновлений не загрузился: ${e.message}` };
      log('error', 'update', state.reason);
    }
  }

  if (updater) {
    updater.autoDownload = true;          // качаем в фоне — пользователь только жмёт «Перезапустить»
    updater.autoInstallOnAppQuit = true;  // не перезапустили — поставится при выходе из программы
    updater.allowPrerelease = false;
    updater.logger = {
      info: (m) => log('info', 'update', String(m)),
      warn: (m) => log('warn', 'update', String(m)),
      error: (m) => log('error', 'update', String(m)),
      debug: () => {},
    };
    updater.on('checking-for-update', () => set({ status: 'checking' }));
    updater.on('update-not-available', () => set({ status: 'none', checkedAt: Date.now() }));
    updater.on('update-available', (info) => {
      log('info', 'update', `Найдена новая версия ${info.version} — скачиваю`);
      set({ status: 'downloading', version: info.version, percent: 0 });
    });
    updater.on('download-progress', (p) => set({
      status: 'downloading', version: state.version, percent: Math.round(p.percent || 0),
      transferred: p.transferred, total: p.total, bps: p.bytesPerSecond,
    }));
    updater.on('update-downloaded', (info) => {
      log('info', 'update', `Версия ${info.version} скачана — поставится при перезапуске`);
      set({ status: 'ready', version: info.version });
    });
    updater.on('error', (e) => set({ status: 'error', error: (e && e.message ? e.message : String(e)).split('\n')[0] }));
  }

  let checking = null;
  async function check() {
    if (!updater) return state;
    if (state.status === 'ready' || state.status === 'downloading') return state;
    if (!checking) checking = updater.checkForUpdates().catch(() => null).finally(() => { checking = null; });
    await checking;
    return state;
  }

  if (updater) {
    setTimeout(check, FIRST_CHECK_MS);
    setInterval(check, EVERY_MS).unref();
  }

  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => {
    if (!updater || state.status !== 'ready') return false;
    log('info', 'update', `Перезапуск для установки версии ${state.version}`);
    // тихая установка и сразу запуск новой версии; сервер хоста закроется в before-quit (main.js)
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  });
};
