#!/usr/bin/env node
'use strict';
// Запуск сервера «Сходки» без интерфейса — для VPS (Ubuntu) или любого всегда включённого ПК.
//   node server/cli.js --config /etc/skhodka/config.json
// Конфиг (JSON):
//   { "port": 443, "dataDir": "/var/lib/skhodka", "password": "…",
//     "tls": { "cert": "/etc/skhodka/cert.pem", "key": "/etc/skhodka/key.pem" },
//     "turn": { "secret": "…", "urls": ["stun:1.2.3.4:3478", "turn:1.2.3.4:3478?transport=udp", "turn:1.2.3.4:3478?transport=tcp"] },
//     "turn": { "builtin": true, "secret": "…", "port": 3478, "relayMin": 49160, "relayMax": 49999 }
//                              — свой ретранслятор вместо coturn (сервер на Windows); адрес берётся из publicAddress
//     "admins": ["worker"]       — админы сервера: могут удалять пользователей и освобождать ники прямо из программы
//     "sfu": { "port": 40999 }   — размножитель демки (1.16): стример отдаёт демку серверу один раз, сервер раздаёт её
//                                  зрителям; порт UDP и TCP, адрес — publicAddress; файлы — vendor/mediasoup
//     "relayOnly": true          — голос, демки и прямые файлы всех — только через ретранслятор (Radmin не нужен)
//     "publicAddress": "1.2.3.4" — внешний адрес сервера,
//     "filesMaxMb": 2048,    — сколько места на диске отдать под картинки чата (старые удаляются)
//     "diskReserveGb": 2 }   — сколько места на диске всегда оставлять свободным (файлы сверх этого не принимаются)
const fs = require('fs');
const path = require('path');
const { createServer } = require('./server');
const { startTurn } = require('./turn');
const { startSfu } = require('./sfu');

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const configPath = arg('--config', process.env.SKHODKA_CONFIG || '/etc/skhodka/config.json');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.SKHODKA_LOG || 'info'];
function log(level, cat, msg) {
  if (LEVELS[level] < minLevel) return;
  // SKHODKA_LOG_TIME=1 — со временем в начале строки (для журнала-файла на Windows; в Linux время ставит journald)
  const line = `${process.env.SKHODKA_LOG_TIME ? new Date().toLocaleString('ru-RU') + ' ' : ''}[${level.toUpperCase()}] ${msg}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

function loadConfig() {
  let cfg = {};
  if (fs.existsSync(configPath)) {
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {
      log('error', 'cli', `Не удалось прочитать конфиг ${configPath}: ${e.message}`);
      process.exit(2);
    }
  } else log('warn', 'cli', `Конфиг ${configPath} не найден — запускаюсь с настройками по умолчанию`);
  const port = Number(arg('--port', cfg.port || 41234));
  const dataDir = arg('--data', cfg.dataDir || path.join(process.cwd(), 'skhodka-data'));
  let tls = null;
  if (cfg.tls && cfg.tls.cert && cfg.tls.key) {
    try { tls = { cert: fs.readFileSync(cfg.tls.cert), key: fs.readFileSync(cfg.tls.key) }; } catch (e) {
      log('error', 'cli', `Не удалось прочитать сертификат: ${e.message}`);
      process.exit(2);
    }
  }
  let turn = cfg.turn || null;
  let builtinTurn = null;
  if (turn && turn.builtin) {
    const ip = cfg.publicAddress;
    const tport = Number(turn.port) || 3478;
    builtinTurn = { port: tport, secret: turn.secret, publicIp: ip, relayMin: Number(turn.relayMin) || 49160, relayMax: Number(turn.relayMax) || 49999 };
    turn = { secret: turn.secret, urls: [`stun:${ip}:${tport}`, `turn:${ip}:${tport}?transport=udp`, `turn:${ip}:${tport}?transport=tcp`] };
  }
  const sfuCfg = cfg.sfu && cfg.sfu.enabled !== false
    ? { port: Number(cfg.sfu.port) || 40999, ip: cfg.sfu.ip || '0.0.0.0', announcedAddress: cfg.sfu.announcedAddress || cfg.publicAddress || '' } : null;
  return { port, dataDir, tls, password: cfg.password || '', turn, builtinTurn, sfuCfg, relayOnly: !!cfg.relayOnly, admins: Array.isArray(cfg.admins) ? cfg.admins.map(String) : [], filesMaxMb: Number(cfg.filesMaxMb) || 2048, diskReserve: (Number(cfg.diskReserveGb) || 2) * 1024 ** 3 };
}

(async () => {
  const cfg = loadConfig();
  let server;
  let relay = null;
  if (cfg.builtinTurn) {
    try {
      relay = await startTurn({ ...cfg.builtinTurn, log });
    } catch (e) {
      const why = e.code === 'EADDRINUSE' ? `порт ${cfg.builtinTurn.port} занят другой программой` : e.message;
      log('error', 'cli', `Ретранслятор не запустился: ${why}. Голос пойдёт напрямую, где получится.`);
      cfg.turn = null; cfg.relayOnly = false;
    }
  }
  let sfu = null;
  if (cfg.sfuCfg) {
    try {
      sfu = await startSfu({ ...cfg.sfuCfg, log });
    } catch (e) {
      const m = String(e && e.message || e);
      const why = /EADDRINUSE|address already in use/i.test(m) ? `порт ${cfg.sfuCfg.port} занят другой программой`
        : process.platform === 'win32' && /3221225781|0xC0000135|failed/i.test(m) ? `${m} — похоже, на сервере нет Microsoft Visual C++ 2015–2022 (x64); установщик ставит его сам — запустите 2-USTANOVIT.bat ещё раз`
          : m;
      log('error', 'cli', `Размножитель демки не запустился: ${why}. Демки пойдут напрямую между компьютерами, как раньше.`);
    }
  }
  try {
    server = await createServer({ ...cfg, sfu, host: '0.0.0.0', log });
  } catch (e) {
    const hint = e.code === 'EADDRINUSE' ? `порт ${cfg.port} занят другой программой` : e.code === 'EACCES' ? `нет прав на порт ${cfg.port}` : e.message;
    log('error', 'cli', `Сервер не запустился: ${hint}`);
    process.exit(1);
  }
  const stop = async (sig) => { log('info', 'cli', `Получен ${sig}, останавливаюсь…`); await server.close(); if (relay) await relay.close(); if (sfu) sfu.close(); process.exit(0); };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('uncaughtException', (e) => log('error', 'cli', `Необработанная ошибка: ${e.stack || e.message}`));
  process.on('unhandledRejection', (e) => log('error', 'cli', `Необработанный отказ: ${e && e.stack ? e.stack : e}`));
  setInterval(() => { const s = server.stats(); log('debug', 'cli', `подключений ${s.connections}, онлайн ${s.online}`); }, 60000).unref();
  if (relay) {
    let last = 0;
    setInterval(() => {
      const t = relay.stats(); const mb = Math.round((t.bytesIn + t.bytesOut) / 1048576);
      if (mb !== last) { last = mb; log('info', 'turn', `Через ретранслятор прошло ${mb} МБ, сейчас каналов: ${t.active}`); }
    }, 10 * 60e3).unref();
  }
})();
