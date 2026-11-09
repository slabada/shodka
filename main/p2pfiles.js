'use strict';
// Прямая передача файлов: файл читается прямо с диска отправителя (по кусочкам) и пишется прямо
// в «Загрузки» получателя. Сеть (WebRTC) — в окне программы, здесь — только диск.
// Отправитель «раздаёт» файл, пока он лежит на месте и не изменился; список раздач переживает перезапуск.
const fs = require('fs');
const path = require('path');

function setupP2PFiles({ ipcMain, app, dialog, getWin, uniquePath, reservePath = () => {}, releasePath = () => {} }) {
  const sharesFile = () => path.join(app.getPath('userData'), 'p2p-shares.json');
  let shares = {};
  try { shares = JSON.parse(fs.readFileSync(sharesFile(), 'utf8')) || {}; } catch (_) { shares = {}; }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { fs.writeFileSync(sharesFile(), JSON.stringify(shares)); } catch (_) { /* ignore */ } }, 300);
  };
  const ID = /^[0-9a-f]{32}$/;

  // ---------- отправитель ----------
  ipcMain.handle('p2p:share', (_e, { id, path: p }) => {
    if (!ID.test(String(id)) || !p) return { ok: false, error: 'нет пути к файлу' };
    try {
      const st = fs.statSync(String(p));
      if (!st.isFile()) return { ok: false, error: 'это не файл' };
      shares[id] = { path: String(p), size: st.size, mtime: st.mtimeMs, ts: Date.now() };
      const ids = Object.keys(shares);
      if (ids.length > 500) for (const k of ids.sort((a, b) => shares[a].ts - shares[b].ts).slice(0, ids.length - 500)) delete shares[k];
      save();
      return { ok: true, size: st.size };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('p2p:unshare', (_e, id) => { delete shares[id]; save(); return true; });
  // можно ли сейчас отдать файл: на месте и не изменился
  const check = (id) => {
    const s = shares[id];
    if (!s) return { ok: false, code: 'nofile' };
    try {
      const st = fs.statSync(s.path);
      if (st.size !== s.size || Math.abs(st.mtimeMs - s.mtime) > 2) return { ok: false, code: 'changed' };
      return { ok: true, size: s.size, path: s.path };
    } catch (_) { return { ok: false, code: 'gone' }; }
  };
  ipcMain.handle('p2p:check', (_e, id) => { const r = check(id); return { ok: r.ok, code: r.code, size: r.size, path: r.ok ? r.path : undefined }; });

  const readers = new Map(); let nextReader = 1;
  ipcMain.handle('p2p:openRead', async (e, id) => {
    const r = check(id);
    if (!r.ok) return r;
    let fh;
    try { fh = await fs.promises.open(r.path, 'r'); } catch (_) { return { ok: false, code: 'gone' }; } // занят другой программой, облачный файл и т. п.
    const hid = nextReader++;
    readers.set(hid, { fh, owner: e.sender.id });
    return { ok: true, hid, size: r.size };
  });
  ipcMain.handle('p2p:read', async (_e, { hid, pos, len }) => {
    const rd = readers.get(hid);
    if (!rd) return null;
    const buf = Buffer.allocUnsafe(Math.min(Number(len) || 0, 4 * 1024 * 1024));
    try {
      const { bytesRead } = await rd.fh.read(buf, 0, buf.length, Number(pos) || 0);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } catch (_) { return null; }
  });
  ipcMain.handle('p2p:closeRead', async (_e, hid) => { const rd = readers.get(hid); readers.delete(hid); if (rd) await rd.fh.close().catch(() => {}); return true; });

  // ---------- получатель ----------
  // Пишем в «имя.skhpart» рядом с итоговым файлом; при обрыве докачиваем с того же места.
  const writers = new Map(); let nextWriter = 1;
  // Докачиваем только в тот «.skhpart», который программа сама выдала для этого файла (part);
  // новый файл всегда пишется в новый, ещё не существующий «.skhpart» — чужие обрывки не трогаем.
  const busyParts = new Set();
  ipcMain.handle('p2p:openWrite', async (e, { name, part, saveAs }) => {
    try {
      let target; let partPath = null; let resume = false;
      if (part && String(part).endsWith('.skhpart') && fs.existsSync(String(part)) && !busyParts.has(String(part))) {
        partPath = String(part); target = partPath.slice(0, -'.skhpart'.length); resume = true;
      } else if (saveAs) {
        const r = await dialog.showSaveDialog(getWin(), { defaultPath: path.join(app.getPath('downloads'), path.basename(String(name || 'файл'))) });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        target = r.filePath; partPath = target + '.skhpart';
        if (fs.existsSync(partPath)) await fs.promises.unlink(partPath).catch(() => {}); // сам выбрал это имя — старый обрывок не нужен
      } else { target = uniquePath(app.getPath('downloads'), name); partPath = target + '.skhpart'; }
      const fh = await fs.promises.open(partPath, resume ? 'r+' : 'wx');
      const offset = resume ? (await fh.stat()).size : 0;
      const wid = nextWriter++;
      busyParts.add(partPath); reservePath(target);
      writers.set(wid, { fh, pos: offset, part: partPath, target, owner: e.sender.id });
      return { ok: true, wid, offset, part: partPath, target };
    } catch (err) { return { ok: false, error: err.code === 'ENOSPC' ? 'на диске закончилось место' : err.message }; }
  });
  ipcMain.handle('p2p:write', async (_e, { wid, bytes }) => {
    const w = writers.get(wid);
    if (!w) return { ok: false, error: 'запись закрыта' };
    try {
      const b = Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
      await w.fh.write(b, 0, b.length, w.pos);
      w.pos += b.length;
      return { ok: true, pos: w.pos };
    } catch (e) { return { ok: false, error: e.code === 'ENOSPC' ? 'на диске закончилось место' : e.message }; }
  });
  // done — переименовать в итоговое имя; cancel — удалить недокачанное; иначе оставить для докачки
  // size — сколько байт должно быть в готовом файле: недописанный файл «готовым» не становится
  ipcMain.handle('p2p:closeWrite', async (_e, { wid, done, cancel, size }) => {
    const w = writers.get(wid); writers.delete(wid);
    if (!w) return { ok: false, error: 'запись уже закрыта' };
    busyParts.delete(w.part); releasePath(w.target);
    await w.fh.close().catch(() => {});
    if (cancel) { fs.promises.unlink(w.part).catch(() => {}); return { ok: true }; }
    if (!done) return { ok: true, part: w.part, pos: w.pos };
    let real = -1; try { real = fs.statSync(w.part).size; } catch (_) { /* ignore */ }
    if (size != null && real !== Number(size)) return { ok: false, part: w.part, pos: real, error: `файл записался не целиком (${real} из ${size} байт)` };
    let final = w.target;
    if (fs.existsSync(final)) final = uniquePath(path.dirname(final), path.basename(final));
    try { await fs.promises.rename(w.part, final); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, path: final };
  });
  ipcMain.handle('p2p:dropPart', (_e, part) => { if (String(part).endsWith('.skhpart') && !busyParts.has(String(part))) fs.promises.unlink(String(part)).catch(() => {}); return true; });

  // окно перезагрузилось или упало — закрываем всё, что оно держало открытым (обрывки остаются для докачки)
  const dropOwner = (id) => {
    for (const [k, rd] of readers) if (rd.owner === id) { readers.delete(k); rd.fh.close().catch(() => {}); }
    for (const [k, w] of writers) if (w.owner === id) { writers.delete(k); busyParts.delete(w.part); releasePath(w.target); w.fh.close().catch(() => {}); }
  };
  return { dropOwner };
}

module.exports = { setupP2PFiles };
