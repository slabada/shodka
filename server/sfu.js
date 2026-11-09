'use strict';
// Размножитель демки (SFU, 1.16) — только для сервера на VPS (cli.js); в программе хоста не запускается.
// Стример отправляет на сервер ОДИН поток демки, сервер раздаёт его каждому зрителю: отдача стримера не делится
// между зрителями, а сжатие у него одно. Основа — mediasoup (vendor/mediasoup: mediasoup.cjs + mediasoup-worker[.exe],
// собраны scripts/mediasoup/build.ts). Картинка и звук всех участников идут через один порт UDP и TCP (WebRtcServer).
// Если размножитель не поднялся или упал — программы показывают демку «напрямую», как раньше.
const path = require('path');
const fs = require('fs');

// Кодеки, которые сервер умеет раздавать. Порядок — предпочтения: H.264 (его сжимает видеокарта) первым.
const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  // High (1.17.2): сжимает лучше Main при той же скорости; программы 1.17.2 берут его, если видеокарта стримера умеет
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '64001f', 'level-asymmetry-allowed': 1 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '4d001f', 'level-asymmetry-allowed': 1 } },
  // H.264 кусками (1.19.3): «H.264 — сжатие на нескольких ядрах» (программа 1.18.2+) режет кадр на куски, и только так
  // OpenH264 сжимает на нескольких ядрах. Строго после всех packetization-mode=1: старые программы берут первый
  // подходящий H.264 — для них ничего не меняется
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 0, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: {} },
  { kind: 'video', mimeType: 'video/VP9', clockRate: 90000, parameters: { 'profile-id': 0 } },
  { kind: 'video', mimeType: 'video/AV1', clockRate: 90000, parameters: {} },
];
const LIMITS = { transports: 4, producers: 4, consumers: 16, json: 64 * 1024 };
const MAX_IN_BPS = 40e6;          // больше от одного стримера не принимаем (в программе потолок — 25 Мбит/с)
const START_OUT_BPS = 6e6;        // начальная оценка канала до зрителя
const KEYFRAME_DELAY_MS = 1000;   // несколько зрителей просят ключевой кадр разом — стример делает один

const fail = (code, message) => Object.assign(new Error(message), { code });
const small = (x) => { try { return JSON.stringify(x).length <= LIMITS.json; } catch (_) { return false; } };

function vendorDir() { return process.env.SKHODKA_MEDIASOUP_DIR || path.join(__dirname, '..', 'vendor', 'mediasoup'); }

class Sfu {
  constructor(o) {
    this.mediasoup = o.mediasoup; this.bin = o.bin; this.port = o.port; this.ip = o.ip; this.announcedAddress = o.announcedAddress;
    this.log = o.log; this.notify = o.notify || (() => {});
    this.worker = null; this.server = null;
    this.routers = new Map();   // комната → Router
    this.peers = new Map();     // ключ ника → { key, name, room, transports, producers, consumers }
    this.producers = new Map(); // id → { producer, key, name, room }
    this.up = false; this.closed = false; this.restarts = 0; this.restartTimer = null;
    this.listeners = new Set();
  }

  get version() { return this.mediasoup.version; }
  onState(cb) { this.listeners.add(cb); }
  setUp(on) {
    if (this.up === on) return;
    this.up = on;
    for (const cb of this.listeners) { try { cb(on); } catch (_) { /* ignore */ } }
  }

  async start() {
    const worker = await this.mediasoup.createWorker({ logLevel: 'warn', workerBin: this.bin });
    worker.on('died', (e) => this.onDied(worker, e));
    try {
      const listen = { ip: this.ip, port: this.port, ...(this.announcedAddress ? { announcedAddress: this.announcedAddress } : {}) };
      this.server = await worker.createWebRtcServer({ listenInfos: [{ protocol: 'udp', ...listen }, { protocol: 'tcp', ...listen }] });
    } catch (e) {
      worker.close();
      throw e;
    }
    this.worker = worker; this.routers.clear();
    this.log('info', 'sfu', `Размножитель демки запущен: порт ${this.port} UDP и TCP, адрес ${this.announcedAddress || this.ip} (mediasoup ${this.version})`);
    this.setUp(true);
  }

  onDied(worker, e) {
    if (worker !== this.worker) return;
    this.worker = null; this.server = null; this.routers.clear();
    this.peers.clear(); this.producers.clear(); // транспорты, производители и потребители умерли вместе с ним
    this.setUp(false);
    if (this.closed) return;
    const delay = Math.min(60e3, 3000 * 2 ** Math.min(this.restarts, 5));
    this.restarts++;
    this.log('error', 'sfu', `Размножитель демки упал (${e && e.message ? e.message : e}) — демки пока идут напрямую; перезапуск через ${Math.round(delay / 1000)} с`);
    this.restartTimer = setTimeout(() => this.restart(), delay);
    if (this.restartTimer.unref) this.restartTimer.unref();
  }

  async restart() {
    this.restartTimer = null;
    if (this.closed || this.worker) return;
    try {
      await this.start();
      const t = setTimeout(() => { if (this.up) this.restarts = 0; }, 120e3); // две минуты без падений — паузы снова короткие
      if (t.unref) t.unref();
    } catch (e) {
      const delay = Math.min(60e3, 3000 * 2 ** Math.min(this.restarts, 5));
      this.restarts++;
      this.log('error', 'sfu', `Размножитель демки не перезапустился (${e.message}) — ещё раз через ${Math.round(delay / 1000)} с`);
      if (!this.closed) { this.restartTimer = setTimeout(() => this.restart(), delay); if (this.restartTimer.unref) this.restartTimer.unref(); }
    }
  }

  ready() { if (!this.up || !this.worker || !this.server) throw fail('sfu_down', 'Размножитель демки сейчас не работает'); }

  async router(room) {
    let r = this.routers.get(room);
    if (r && !r.closed) return r;
    r = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS, appData: { room } });
    this.routers.set(room, r);
    return r;
  }

  // who: { key, name, room } — кто спрашивает (ключ ника, ник, голосовая комната)
  peer(who) {
    let p = this.peers.get(who.key);
    if (p && p.room !== who.room) { this.closePeer(who.key, 'другая комната'); p = null; }
    if (!p) { p = { key: who.key, name: who.name, room: who.room, transports: new Map(), producers: new Map(), consumers: new Map() }; this.peers.set(who.key, p); }
    p.name = who.name;
    return p;
  }

  async caps(who) {
    this.ready();
    return (await this.router(who.room)).rtpCapabilities;
  }

  async createTransport(who, dir) {
    this.ready();
    if (dir !== 'send' && dir !== 'recv') throw fail('bad_request', 'dir: send | recv');
    const p = this.peer(who);
    if (p.transports.size >= LIMITS.transports) {
      // старые транспорты этого направления (программа перезапустила показ) — закрываем самый старый
      const old = [...p.transports.values()].find((t) => t.appData.dir === dir);
      if (old) old.close(); else throw fail('limit', 'Слишком много соединений с размножителем');
    }
    const router = await this.router(who.room);
    const t = await router.createWebRtcTransport({
      webRtcServer: this.server, enableUdp: true, enableTcp: true, preferUdp: true,
      initialAvailableOutgoingBitrate: START_OUT_BPS, appData: { key: who.key, dir },
    });
    p.transports.set(t.id, t);
    t.observer.on('close', () => p.transports.delete(t.id));
    if (dir === 'send') await t.setMaxIncomingBitrate(MAX_IN_BPS).catch(() => {});
    t.on('dtlsstatechange', (s) => { if (s === 'failed' || s === 'closed') this.log('debug', 'sfu', `${p.name}: соединение с размножителем (${dir}) — ${s}`); });
    return { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters };
  }

  transport(who, tid, dir) {
    const p = this.peers.get(who.key);
    const t = p && p.transports.get(String(tid));
    if (!t || t.closed) throw fail('not_found', 'Нет такого соединения с размножителем');
    if (dir && t.appData.dir !== dir) throw fail('bad_request', 'Не то направление соединения');
    return { p, t };
  }

  async connect(who, tid, dtlsParameters) {
    this.ready();
    if (!dtlsParameters || typeof dtlsParameters !== 'object' || !small(dtlsParameters)) throw fail('bad_request', 'dtlsParameters');
    const { t } = this.transport(who, tid);
    await t.connect({ dtlsParameters });
  }

  // streaming — показывает ли он сейчас экран (сервер знает по voice_state)
  async produce(who, tid, kind, rtpParameters, appData, streaming) {
    this.ready();
    if (!streaming) throw fail('not_streaming', 'Сначала начните показ экрана');
    if (kind !== 'audio' && kind !== 'video') throw fail('bad_request', 'kind: audio | video');
    if (!rtpParameters || typeof rtpParameters !== 'object' || !small(rtpParameters)) throw fail('bad_request', 'rtpParameters');
    const { p, t } = this.transport(who, tid, 'send');
    if (p.producers.size >= LIMITS.producers) {
      const old = [...p.producers.values()].find((x) => x.kind === kind);
      if (old) old.close(); else throw fail('limit', 'Слишком много потоков');
    }
    const producer = await t.produce({ kind, rtpParameters, keyFrameRequestDelay: kind === 'video' ? KEYFRAME_DELAY_MS : undefined, appData: { key: p.key, screen: true } });
    p.producers.set(producer.id, producer);
    this.producers.set(producer.id, { producer, key: p.key, room: p.room });
    producer.observer.on('close', () => { p.producers.delete(producer.id); this.producers.delete(producer.id); });
    this.log('info', 'sfu', `${p.name} отдаёт демку через размножитель: ${kind === 'video' ? 'видео' : 'звук'} ${producer.rtpParameters.codecs[0].mimeType.replace(/^(audio|video)\//, '')}`);
    return producer.id;
  }

  async consume(who, tid, producerId, rtpCapabilities) {
    this.ready();
    if (!rtpCapabilities || typeof rtpCapabilities !== 'object' || !small(rtpCapabilities)) throw fail('bad_request', 'rtpCapabilities');
    const x = this.producers.get(String(producerId));
    if (!x || x.producer.closed) throw fail('not_found', 'Эта демка уже не идёт через размножитель');
    if (x.room !== who.room) throw fail('forbidden', 'Демка из другой комнаты');
    if (x.key === who.key) throw fail('forbidden', 'Свою демку смотреть не нужно');
    const { p, t } = this.transport(who, tid, 'recv');
    const router = await this.router(who.room);
    if (!router.canConsume({ producerId: x.producer.id, rtpCapabilities })) throw fail('codec', 'Программа не умеет показывать этот кодек');
    if (p.consumers.size >= LIMITS.consumers) {
      const old = [...p.consumers.values()].find((c) => c.producerId === x.producer.id) || p.consumers.values().next().value;
      old.close(); p.consumers.delete(old.id);
    }
    const consumer = await t.consume({ producerId: x.producer.id, rtpCapabilities, paused: true, appData: { key: p.key } });
    p.consumers.set(consumer.id, consumer);
    consumer.observer.on('close', () => p.consumers.delete(consumer.id));
    consumer.on('producerclose', () => { p.consumers.delete(consumer.id); this.notify(p.key, { type: 'sfu_closed', id: consumer.id, producerId: x.producer.id }); });
    const owner = this.peers.get(x.key);
    this.log('debug', 'sfu', `${p.name} смотрит демку ${owner ? owner.name : '?'} через размножитель (${consumer.kind})`);
    return { id: consumer.id, producerId: x.producer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters, type: consumer.type, producerPaused: consumer.producerPaused };
  }

  consumer(who, cid) {
    const p = this.peers.get(who.key);
    const c = p && p.consumers.get(String(cid));
    if (!c || c.closed) throw fail('not_found', 'Нет такого потока');
    return c;
  }
  async resume(who, cid) { this.ready(); const c = this.consumer(who, cid); await c.resume(); if (c.kind === 'video') await c.requestKeyFrame().catch(() => {}); }
  async keyframe(who, cid) { this.ready(); const c = this.consumer(who, cid); if (c.kind === 'video') await c.requestKeyFrame(); }
  closeConsumer(who, cid) { const p = this.peers.get(who.key); const c = p && p.consumers.get(String(cid)); if (c) { c.close(); p.consumers.delete(c.id); } }

  ownProducer(who, pid) {
    const p = this.peers.get(who.key);
    const pr = p && p.producers.get(String(pid));
    if (!pr || pr.closed) throw fail('not_found', 'Нет такого потока');
    return pr;
  }
  async pauseProducer(who, pid, paused) { this.ready(); const pr = this.ownProducer(who, pid); if (paused) await pr.pause(); else await pr.resume(); }
  closeProducer(who, pid) { const p = this.peers.get(who.key); const pr = p && p.producers.get(String(pid)); if (pr) pr.close(); }
  closeProducers(key) { const p = this.peers.get(key); if (p) for (const pr of [...p.producers.values()]) pr.close(); }

  // для «Отчёта о демке» у стримера: что сервер отправляет каждому зрителю
  async stats(who) {
    this.ready();
    const own = this.peers.get(who.key);
    if (!own || !own.producers.size) return [];
    const out = [];
    for (const q of this.peers.values()) {
      for (const c of q.consumers.values()) {
        if (!own.producers.has(c.producerId)) continue;
        const s = (await c.getStats().catch(() => [])).find((x) => x.type === 'outbound-rtp') || {};
        out.push({ viewer: q.name, kind: c.kind, score: c.score ? c.score.score : null, bitrate: s.bitrate || 0, packetsLost: s.packetsLost || 0, fractionLost: s.fractionLost || 0, nackCount: s.nackCount || 0, pliCount: s.pliCount || 0, rtt: s.roundTripTime ?? null, paused: c.paused || c.producerPaused });
      }
    }
    return out;
  }

  closePeer(key, why) {
    const p = this.peers.get(key);
    if (!p) return;
    this.peers.delete(key);
    for (const t of [...p.transports.values()]) { try { t.close(); } catch (_) { /* ignore */ } }
    if (p.producers.size || p.consumers.size || why) this.log('debug', 'sfu', `${p.name}: соединения с размножителем закрыты${why ? ` (${why})` : ''}`);
  }

  rename(fromKey, toKey, toName) {
    const p = this.peers.get(fromKey);
    if (!p) return;
    this.peers.delete(fromKey); p.key = toKey; p.name = toName; this.peers.set(toKey, p);
    for (const x of this.producers.values()) if (x.key === fromKey) x.key = toKey;
  }

  summary() { return { up: this.up, peers: this.peers.size, producers: this.producers.size }; }

  close() {
    this.closed = true;
    clearTimeout(this.restartTimer);
    const w = this.worker; this.worker = null; this.server = null;
    if (w) { try { w.close(); } catch (_) { /* ignore */ } }
    this.setUp(false);
  }
}

// Запуск: { port, ip, announcedAddress, log, notify(key, msg) }. Не вышло — бросает ошибку (сервер работает без размножителя).
async function startSfu({ port = 40999, ip = '0.0.0.0', announcedAddress = '', log = () => {}, notify, workerBin } = {}) {
  const dir = vendorDir();
  const bin = workerBin || process.env.MEDIASOUP_WORKER_BIN || path.join(dir, process.platform === 'win32' ? 'mediasoup-worker.exe' : 'mediasoup-worker');
  if (!fs.existsSync(path.join(dir, 'mediasoup.cjs'))) throw new Error(`нет файла ${path.join(dir, 'mediasoup.cjs')}`);
  if (!fs.existsSync(bin)) throw new Error(`нет файла ${bin}`);
  process.env.MEDIASOUP_WORKER_BIN = bin; // до загрузки mediasoup — иначе он ищет свой файл в node_modules и пишет предупреждение
  const mediasoup = require(path.join(dir, 'mediasoup.cjs'));
  const sfu = new Sfu({ mediasoup, bin, port: Number(port) || 40999, ip, announcedAddress, log, notify });
  await sfu.start();
  return sfu;
}

module.exports = { startSfu, MEDIA_CODECS };
