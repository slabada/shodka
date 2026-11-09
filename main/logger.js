'use strict';
// Общий лог приложения: пишет в файл (папка logs рядом с данными) и пересылает записи в окно.
const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const KEEP_DAYS = 14;

class Logger {
  constructor(dir) {
    this.dir = dir;
    this.listeners = new Set();
    this.recent = []; // последние записи — показываем окну при открытии
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    this.cleanup();
  }

  fileFor(date = new Date()) {
    const d = date.toISOString().slice(0, 10);
    return path.join(this.dir, `skhodka-${d}.log`);
  }

  cleanup() {
    try {
      const cutoff = Date.now() - KEEP_DAYS * 864e5;
      for (const f of fs.readdirSync(this.dir)) {
        const p = path.join(this.dir, f);
        if (f.endsWith('.log') && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      }
    } catch (_) { /* ignore */ }
  }

  write(entry) {
    const e = {
      ts: entry.ts || Date.now(),
      level: LEVELS[entry.level] !== undefined ? entry.level : 'info',
      cat: entry.cat || 'app',
      msg: String(entry.msg ?? ''),
      hint: entry.hint || undefined,
      details: entry.details || undefined,
      src: entry.src || 'main',
    };
    const time = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 23);
    let line = `${time} [${e.level.toUpperCase().padEnd(5)}] [${e.src}/${e.cat}] ${e.msg}`;
    if (e.hint) line += `\n    → Что сделать: ${e.hint}`;
    if (e.details) line += `\n    ${String(e.details).split('\n').join('\n    ')}`;
    try { fs.appendFileSync(this.fileFor(new Date(e.ts)), line + '\n'); } catch (_) { /* диск недоступен — не падаем */ }
    if (e.src === 'main') {
      this.recent.push(e);
      if (this.recent.length > 500) this.recent.shift();
      for (const l of this.listeners) { try { l(e); } catch (_) { /* ignore */ } }
    }
    if (process.env.SKHODKA_CONSOLE) console.log(line);
  }

  log(level, cat, msg, extra = {}) { this.write({ level, cat, msg, ...extra }); }
}

module.exports = { Logger };
