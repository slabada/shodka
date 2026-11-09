'use strict';
// Звуки для всех (1.21): свои звуковые файлы хранятся в папке данных программы (userData/sounds),
// список, громкости и клавиши — в sounds.json рядом. Играет и подмешивает в голос окно (renderer/js/soundboard.js).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAX_BYTES = 8 * 1024 * 1024;
const EXTS = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'weba'];

module.exports = function setupSoundboard({ ipcMain, app, log }) {
  const dir = () => path.join(app.getPath('userData'), 'sounds');
  const cfgFile = () => path.join(dir(), 'sounds.json');
  let cfg = null;

  function load() {
    if (cfg) return cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) || {}; } catch (_) { cfg = {}; }
    if (!Array.isArray(cfg.sounds)) cfg.sounds = [];
    if (!cfg.prefs || typeof cfg.prefs !== 'object') cfg.prefs = {};
    return cfg;
  }
  function save() {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = cfgFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 1));
    fs.renameSync(tmp, cfgFile());
  }
  const find = (id) => load().sounds.find((s) => s.id === id);
  const cleanName = (n) => String(n || 'Звук').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'Звук';

  ipcMain.handle('sfx:list', () => {
    const c = load();
    return { sounds: c.sounds.map(({ id, name }) => ({ id, name })), prefs: c.prefs };
  });

  ipcMain.handle('sfx:prefs', (_e, prefs) => {
    load().prefs = prefs && typeof prefs === 'object' ? prefs : {};
    save();
    return true;
  });

  ipcMain.handle('sfx:add', (_e, { name, ext, bytes } = {}) => {
    ext = String(ext || '').toLowerCase();
    if (!EXTS.includes(ext)) throw new Error('Такой формат не подходит — нужен MP3, WAV, OGG, M4A, FLAC или Opus');
    if (!bytes || !bytes.length) throw new Error('Файл пустой');
    if (bytes.length > MAX_BYTES) throw new Error('Файл больше 8 МБ — для звука это слишком много');
    const id = 'u:' + crypto.randomBytes(6).toString('hex');
    const file = id.slice(2) + '.' + ext;
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), file), Buffer.from(bytes));
    const s = { id, name: cleanName(name), file };
    load().sounds.push(s);
    save();
    log('info', 'sfx', `Добавлен звук «${s.name}» (${Math.round(bytes.length / 1024)} КБ)`);
    return { id: s.id, name: s.name };
  });

  ipcMain.handle('sfx:rename', (_e, { id, name } = {}) => {
    const s = find(id);
    if (!s) return false;
    s.name = cleanName(name);
    save();
    return true;
  });

  ipcMain.handle('sfx:remove', (_e, id) => {
    const c = load();
    const s = find(id);
    if (!s) return false;
    try { fs.unlinkSync(path.join(dir(), s.file)); } catch (_) { /* уже нет */ }
    c.sounds = c.sounds.filter((x) => x !== s);
    save();
    log('info', 'sfx', `Удалён звук «${s.name}»`);
    return true;
  });

  ipcMain.handle('sfx:read', (_e, id) => {
    const s = find(id);
    if (!s) return null;
    try { return fs.readFileSync(path.join(dir(), s.file)); } catch (e) {
      log('warn', 'sfx', `Не читается файл звука «${s.name}»: ${e.message}`);
      return null;
    }
  });
};
