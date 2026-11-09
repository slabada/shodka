'use strict';
// Запуск помощника skh-videocap.exe (1.19.0, «Видеокартой, как OBS»): экран снимает и сжимает видеокарта,
// окну отдаём готовые кадры H.264 — оно подставляет их в демку вместо своего сжатия (renderer/js/gpucap.js).
// Окно шлёт помощнику команды: «idr» (зрителю нужен целый кадр) и «kbps N» (скорость под сеть).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = function setupVideoCap({ ipcMain, app, log, screenRect }) {
  const sessions = new Map();
  let nextId = 1;
  let quitting = false;

  // 1.19.2: помощнику нужны и DLL FFmpeg рядом — без них он не запустится, а раньше проверялся только сам exe
  const NEED = ['skh-videocap.exe', 'avutil-60.dll', 'avcodec-62.dll', 'avfilter-11.dll', 'avformat-62.dll', 'swscale-9.dll', 'swresample-6.dll'];
  const dir = () => (app.isPackaged ? path.join(process.resourcesPath, 'bin', 'videocap') : path.join(__dirname, '..', 'native', 'bin', 'videocap'));
  // чего не хватает: '' — всё на месте
  function missing() {
    if (process.platform !== 'win32') return 'только в Windows';
    const d = dir();
    const lost = NEED.filter((f) => !fs.existsSync(path.join(d, f)));
    return lost.length ? `нет ${lost.join(', ')} в resources\\bin\\videocap` : '';
  }
  function exePath() { return missing() ? null : path.join(dir(), 'skh-videocap.exe'); }

  ipcMain.handle('videocap:available', () => !!exePath());
  ipcMain.handle('videocap:missing', () => missing());

  // opts: fps, kbps, output (номер экрана у Chromium), source (id экрана из окна выбора)
  ipcMain.handle('videocap:start', (e, opts = {}) => {
    const exe = exePath();
    if (!exe) return { ok: false, reason: `помощник захвата видеокартой не найден (${missing()})` };
    const num = (v, def, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
    const args = ['--fps', String(num(opts.fps, 60, 1, 240)), '--kbps', String(num(opts.kbps, 4000, 300, 100000)), '--output', String(num(opts.output, 0, 0, 16))];
    // 1.20.1: монитор помощник ищет по месту на рабочем столе — номер экрана у Chromium остаётся запасным
    const r = opts.source && screenRect ? screenRect(String(opts.source)) : null;
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0) args.push('--rect', [r.x, r.y, r.w, r.h].map((v) => String(Math.round(v))).join(','));
    const wc = e.sender;
    const id = nextId++;
    let child;
    try {
      child = spawn(exe, args, { cwd: path.dirname(exe), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return { ok: false, reason: `не запустился: ${err.message}` };
    }
    child.owner = wc.id;
    sessions.set(id, child);
    const send = (ch, ...a) => { if (!wc.isDestroyed()) wc.send(ch, ...a); };
    // stdout: [тип 1 байт][длина 4 байта][данные]; 1 — кадр, 2 — JSON, 3 — текст ошибки
    let buf = Buffer.alloc(0);
    let lastErr = '';
    child.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let off = 0;
      while (buf.length - off >= 5) {
        const type = buf[off]; const len = buf.readUInt32LE(off + 1);
        if (buf.length - off - 5 < len) break;
        const body = buf.subarray(off + 5, off + 5 + len);
        off += 5 + len;
        if (type === 1) send('videocap:au', id, body);
        else if (type === 2) { try { send('videocap:msg', { id, type: 'json', data: JSON.parse(body.toString('utf8')) }); } catch (_) { /* битая строка — пропускаем */ } }
        else if (type === 3) { lastErr = body.toString('utf8'); log('warn', 'screen', `Помощник захвата видеокартой: ${lastErr}`); }
      }
      buf = off < buf.length ? Buffer.from(buf.subarray(off)) : Buffer.alloc(0);
    });
    let errBuf = '';
    child.stderr.on('data', (d) => {
      errBuf += d.toString();
      let i;
      while ((i = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, i).trim(); errBuf = errBuf.slice(i + 1);
        if (line) log(/error|fail|не удал/i.test(line) ? 'warn' : 'debug', 'screen', `FFmpeg (захват видеокартой): ${line}`);
      }
    });
    child.on('error', (err) => { sessions.delete(id); log('warn', 'screen', `Помощник захвата видеокартой: ${err.message}`); send('videocap:msg', { id, type: 'exit', code: -1, error: err.message }); });
    child.on('exit', (code) => { sessions.delete(id); if (!quitting) send('videocap:msg', { id, type: 'exit', code, error: lastErr }); });
    child.stdin.on('error', () => { /* помощник уже вышел */ });
    return { ok: true, id };
  });

  ipcMain.handle('videocap:cmd', (_e, id, line) => {
    const child = sessions.get(id);
    if (!child || !/^(idr|kbps \d+)$/.test(String(line))) return false;
    try { child.stdin.write(line + '\n'); } catch (_) { return false; }
    return true;
  });

  ipcMain.handle('videocap:stop', (_e, id) => {
    const child = sessions.get(id);
    if (!child) return false;
    sessions.delete(id);
    try { child.stdin.write('quit\n'); child.stdin.end(); } catch (_) { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch (_) { /* ignore */ } }, 1500);
    return true;
  });

  const killAll = () => { quitting = true; for (const c of sessions.values()) { try { c.kill(); } catch (_) { /* ignore */ } } sessions.clear(); };
  app.on('before-quit', killAll);
  app.on('will-quit', killAll);
  const dropOwner = (owner) => { for (const [id, c] of sessions) if (c.owner === owner) { sessions.delete(id); try { c.kill(); } catch (_) { /* ignore */ } } };
  return { dropOwner };
};
