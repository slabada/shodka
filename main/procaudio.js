'use strict';
// Запуск помощника skh-audiocap.exe: звук компьютера без звука «Сходки» (Windows 10 2004+ / 11).
// Хром на Windows 10 исключать звук своей программы из захвата не умеет, хотя сама Windows умеет —
// поэтому пишем звук своим маленьким помощником и отдаём окну сырыми отсчётами.
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = function setupProcAudio({ ipcMain, app, log }) {
  const sessions = new Map();
  let nextId = 1;
  let quitting = false; // программа закрывается — помощников закрываем мы сами

  function command() {
    // для автотестов на Linux: подставной помощник (node-скрипт), запускаем через сам Electron как node
    if (process.env.SKHODKA_FAKE_PROCAUDIO) return { file: process.execPath, args: [process.env.SKHODKA_FAKE_PROCAUDIO], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
    if (process.platform !== 'win32') return null;
    const exe = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'skh-audiocap.exe') : path.join(__dirname, '..', 'native', 'bin', 'skh-audiocap.exe');
    return fs.existsSync(exe) ? { file: exe, args: [], env: process.env } : null;
  }

  // opts.include — PID программы: записывать звук только её (и её дочерних процессов), а не весь компьютер
  ipcMain.handle('procaudio:start', (e, opts = {}) => {
    const cmd = command();
    if (!cmd) return { ok: false, reason: 'помощник записи звука не найден' };
    const include = Number(opts && opts.include) > 0 ? Math.floor(Number(opts.include)) : 0;
    if (include && include === process.pid) return { ok: false, reason: 'это окно самой «Сходки» — его звук не записываем' };
    const label = include ? `Запись звука окна (процесс ${include})` : 'Запись звука без «Сходки»';
    const wc = e.sender;
    const id = nextId++;
    let child;
    try {
      child = spawn(cmd.file, [...cmd.args, String(include || process.pid), ...(include ? ['--include'] : [])], { env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return { ok: false, reason: `не запустился: ${err.message}` };
    }
    child.owner = wc.id;
    sessions.set(id, child);
    const send = (ch, ...a) => { if (!wc.isDestroyed()) wc.send(ch, ...a); };
    child.stdout.on('data', (chunk) => send('procaudio:data', id, chunk));
    let errBuf = '';
    child.stderr.on('data', (d) => {
      errBuf += d.toString();
      let i;
      while ((i = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, i).trim(); errBuf = errBuf.slice(i + 1);
        if (!line) continue;
        log(/^ERR/.test(line) ? 'warn' : 'debug', 'screen', `${label}: ${line}`);
        send('procaudio:msg', { id, type: 'line', line });
      }
    });
    child.on('error', (err) => { log('warn', 'screen', `Помощник записи звука: ${err.message}`); send('procaudio:msg', { id, type: 'exit', code: -1, error: err.message }); sessions.delete(id); });
    // помощника закрыла сама программа (выход) — окну это не «неожиданная остановка» (1.17.3: ложная тревога в журнале)
    child.on('exit', (code) => { sessions.delete(id); if (!quitting) send('procaudio:msg', { id, type: 'exit', code }); });
    child.stdin.on('error', () => { /* помощник уже вышел */ });
    return { ok: true, id };
  });

  // Какой программе принадлежит окно «window:<HWND>:0» из списка источников показа.
  // 1.15: спрашиваем свой помощник (skh-audiocap.exe --pid-of-window — мгновенно); старый помощник этого не умеет —
  // тогда, как раньше, маленькой командой PowerShell (около секунды).
  function pidByHelper(hwnd) {
    const cmd = command();
    if (!cmd || process.env.SKHODKA_FAKE_PROCAUDIO) return Promise.resolve(0);
    return new Promise((resolve) => {
      execFile(cmd.file, [...cmd.args, '--pid-of-window', hwnd], { env: cmd.env, windowsHide: true, timeout: 3000, maxBuffer: 4096, encoding: 'latin1' }, (_err, out) => {
        const pid = /^\d+$/.test(String(out || '').trim()) ? parseInt(String(out).trim(), 10) : 0;
        resolve(pid > 0 ? pid : 0);
      });
    });
  }

  ipcMain.handle('procaudio:windowPid', async (_e, sourceId) => {
    const m = /^window:(\d+):/.exec(String(sourceId || ''));
    if (!m) return { ok: false, reason: 'это не окно' };
    if (process.env.SKHODKA_FAKE_PROCAUDIO) return { ok: true, pid: 4242 };
    if (process.platform !== 'win32') return { ok: false, reason: 'только в Windows' };
    const hp = await pidByHelper(m[1]);
    if (hp) return { ok: true, pid: hp };
    const script = [
      `$h = [IntPtr][long]${m[1]}; $p = 0`,
      "try { Add-Type -Name W -Namespace Skh -MemberDefinition '[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'; $q = [uint32]0; [void][Skh.W]::GetWindowThreadProcessId($h, [ref]$q); $p = $q } catch { }",
      'if (-not $p) { $x = Get-Process | Where-Object { $_.MainWindowHandle -eq $h } | Select-Object -First 1; if ($x) { $p = $x.Id } }',
      '[Console]::Out.Write($p)',
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64'); // так не нужно возиться с кавычками в командной строке
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 10000 }, (err, out) => {
        const pid = parseInt(String(out || '').trim(), 10);
        if (pid > 0) return resolve({ ok: true, pid });
        resolve({ ok: false, reason: err ? `PowerShell: ${err.message.split('\n')[0]}` : 'окно уже закрыто' });
      });
    });
  });

  ipcMain.handle('procaudio:stop', (_e, id) => {
    const child = sessions.get(id);
    if (!child) return false;
    sessions.delete(id);
    try { child.stdin.end(); } catch (_) { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch (_) { /* ignore */ } }, 1000);
    return true;
  });

  const killAll = () => { quitting = true; for (const c of sessions.values()) { try { c.kill(); } catch (_) { /* ignore */ } } sessions.clear(); };
  app.on('before-quit', killAll);
  app.on('will-quit', killAll);
  // окно перезагрузилось или упало — его помощники больше никому не нужны
  const dropOwner = (owner) => { for (const [id, c] of sessions) if (c.owner === owner) { sessions.delete(id); try { c.kill(); } catch (_) { /* ignore */ } } };
  return { dropOwner };
};
