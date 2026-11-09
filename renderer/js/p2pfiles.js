// Прямая передача файлов: получатель соединяется с компьютером отправителя (WebRTC, канал данных)
// и забирает файл напрямую — без сервера, на скорости вашей сети. Сервер только передаёт служебные
// сигналы (кто кого вызывает). Файл читается прямо с диска отправителя и пишется прямо в «Загрузки»,
// поэтому размер не ограничен памятью. Оборвалось — докачивается с того же места.
import { log } from './log.js';
import { settings, parseIceServers } from './settings.js';

const api = window.api;
const CHUNK = 64 * 1024;            // кусок в канале данных
const READ = 1024 * 1024;           // столько читаем с диска за раз
const HIGH = 8 * 1024 * 1024;       // буфер канала: больше — ждём, пока уйдёт
const LOW = 2 * 1024 * 1024;
const FLUSH = 2 * 1024 * 1024;      // на диск пишем кусками по 2 МБ
const RETRIES = 5;

export const p2pAvailable = () => !!(api.p2p && api.filePath && typeof RTCPeerConnection !== 'undefined');
export function newFileId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''); }
const rid = () => Math.random().toString(36).slice(2, 10);

function gathered(pc, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}

const WHY = {
  nofile: 'отправитель больше не раздаёт этот файл',
  gone: 'у отправителя этого файла больше нет (удалён или перемещён)',
  changed: 'файл у отправителя изменился после отправки — попросите отправить заново',
  offline: 'отправитель не в сети — скачается, когда он зайдёт',
  noconnect: 'не получилось соединиться с компьютером отправителя напрямую',
};

export class P2PFiles {
  // send(to, toConn, data) — отправить сигнал через сервер; onState(id, st) — состояние скачивания
  constructor({ send, getIce, getRelayOnly, onState, onSendInfo }) {
    this.send = send; this.getIce = getIce; this.getRelayOnly = getRelayOnly || (() => false); this.onState = onState; this.onSendInfo = onSendInfo || (() => {});
    this.sessions = new Map(); // sid → сессия (и отдача, и приём)
    this.jobs = new Map();     // id файла → текущее скачивание
  }

  iceServers() { return [...(this.getIce() || []), ...parseIceServers(settings.iceServers)]; }
  // настройки соединения: если сервер велит — файл идёт через его ретранслятор
  rtcConfig() {
    const iceServers = this.iceServers();
    const relay = (this.getRelayOnly() || settings.forceRelay) && iceServers.some((x) => x.username);
    return { iceServers, iceTransportPolicy: relay ? 'relay' : 'all' };
  }

  // ---------- отправитель ----------
  async share(file, id) {
    const p = api.filePath(file);
    if (!p) throw new Error('Не удалось определить, где лежит файл');
    const r = await api.p2p.share(id, p);
    if (!r.ok) throw new Error(`Файл не раздаётся: ${r.error}`);
    return p;
  }

  handle(from, fromConn, d) {
    if (!d || !d.kind) return;
    if (d.kind === 'offer') return this.onOffer(from, fromConn, d);
    const s = this.sessions.get(d.sid);
    if (!s) return;
    if (d.kind === 'answer' && s.role === 'recv' && !s.answered) {
      // ответил компьютер, где файл есть: «нет файла» от другой копии программы больше не в счёт, ждём соединения как обычно
      s.answered = true; s.peerConn = fromConn; s.why = null;
      clearTimeout(s.timer); s.timer = setTimeout(() => s.fail('timeout'), 15000);
      s.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).catch((e) => s.fail('noconnect', e.message));
    }
    else if (d.kind === 'nofile' && s.role === 'recv' && !s.answered) { // ответ уже есть — «нет файла» от второй копии не в счёт
      // ответили «нет файла» — ждём ещё чуть-чуть (у человека может быть открыта Сходка на двух компьютерах)
      s.why = d.code || 'nofile';
      if (!s.answered) { clearTimeout(s.timer); s.timer = setTimeout(() => s.fail('timeout'), 2500); }
    }
    else if (d.kind === 'offline' && s.role === 'recv') s.fail('offline');
  }

  async onOffer(from, fromConn, d) {
    const r = await api.p2p.openRead(d.id);
    if (!r.ok) return this.send(from, fromConn, { kind: 'nofile', sid: d.sid, code: r.code });
    const pc = new RTCPeerConnection(this.rtcConfig());
    const s = { role: 'send', pc, sid: d.sid, from, closed: false, active: false };
    this.sessions.set(d.sid, s);
    const close = () => {
      if (s.closed) return; s.closed = true;
      clearTimeout(s.timer); this.sessions.delete(d.sid);
      api.p2p.closeRead(r.hid); try { pc.close(); } catch (_) { /* ignore */ }
      if (s.active) { s.active = false; this.onSendInfo(d.id, { to: from, active: false }); }
    };
    s.timer = setTimeout(close, 30000); // канал не открылся — бросаем
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) close(); };
    // после успешной отдачи даём каналу дослать буфер; при сбое закрываем сразу — получатель тут же повторит
    pc.ondatachannel = (e) => { clearTimeout(s.timer); this.stream(e.channel, r, d, from, pc, s).then((okk) => setTimeout(close, okk ? 15000 : 0)); };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      this.send(from, fromConn, { kind: 'answer', sid: d.sid, sdp: pc.localDescription.sdp });
    } catch (e) { log.warn('chat', `Прямая передача для ${from} не началась: ${e.message}`); close(); }
  }

  async stream(dc, r, d, to, pc, s) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW;
    await new Promise((res) => { if (dc.readyState === 'open') res(); else dc.onopen = res; });
    let pos = Math.max(0, Math.min(Number(d.offset) || 0, r.size));
    const t0 = performance.now(); const start = pos;
    s.active = true; this.onSendInfo(d.id, { to, active: true });
    log.info('chat', `Отдаю файл ${to} напрямую${pos ? ` (докачка с ${Math.round(pos / 1048576)} МБ)` : ''}`);
    // ждём, пока буфер канала разгрузится; если канал закрылся — событие не придёт, поэтому ждём и закрытия
    const waitLow = () => new Promise((res) => {
      const done = () => { clearInterval(t); dc.removeEventListener('bufferedamountlow', done); dc.removeEventListener('close', done); res(); };
      const t = setInterval(() => { if (dc.readyState !== 'open' || dc.bufferedAmount <= LOW) done(); }, 1000);
      dc.addEventListener('bufferedamountlow', done); dc.addEventListener('close', done);
    });
    try {
      dc.send(JSON.stringify({ t: 'hdr', size: r.size, offset: pos }));
      // следующий кусок читаем с диска, пока отправляется текущий
      let next = pos < r.size ? api.p2p.read(r.hid, pos, READ) : null;
      while (pos < r.size) {
        if (dc.readyState !== 'open') throw new Error(`получатель закрыл соединение (${dc.readyState}, ${pc.connectionState})`);
        const bytes = await next;
        if (!bytes || !bytes.length) throw new Error('файл не читается');
        next = pos + bytes.length < r.size ? api.p2p.read(r.hid, pos + bytes.length, READ) : null;
        for (let k = 0; k < bytes.length; k += CHUNK) {
          if (dc.bufferedAmount > HIGH) await waitLow();
          if (dc.readyState !== 'open') throw new Error(`получатель закрыл соединение (${dc.readyState}, ${pc.connectionState})`);
          dc.send(bytes.subarray(k, k + CHUNK));
        }
        pos += bytes.length;
      }
      dc.send(JSON.stringify({ t: 'end' }));
      const sec = (performance.now() - t0) / 1000;
      log.info('chat', `Файл отдан ${to} напрямую: ${Math.round((pos - start) / 1048576)} МБ за ${sec.toFixed(1)} с (${((pos - start) / 1048576 / Math.max(sec, 0.1)).toFixed(1)} МБ/с)`);
      s.active = false; this.onSendInfo(d.id, { to, active: false, done: true });
      return true;
    } catch (e) {
      log.info('chat', `Отдача файла ${to} прервалась: ${e.message}`);
      s.active = false; this.onSendInfo(d.id, { to, active: false });
      return false;
    }
  }

  // ---------- получатель ----------
  // f: { id, name, size }, author — ник отправителя. Состояние приходит в onState.
  download(f, author, { saveAs = false, part = null, received = 0 } = {}) {
    const old = this.jobs.get(f.id);
    if (old && !old.finished) return old;
    const job = { f, author, part, saveAs, attempt: 0, received: received || 0, finished: false, canceled: false };
    this.jobs.set(f.id, job);
    job.cancel = () => {
      if (job.canceled || job.finished) return;
      job.canceled = true;
      if (job.s && !job.s.closed) return job.s.fail('canceled');
      // между попытками (пауза «продолжаю…») или пока открывается файл — завершаем сами
      if (job.part) api.p2p.dropPart(job.part);
      job.part = null;
      this.finish(job, { status: 'idle' });
    };
    this.attempt(job);
    return job;
  }

  cancel(id) { const j = this.jobs.get(id); if (j && !j.finished) j.cancel(); }

  finish(job, st) {
    job.finished = true;
    this.onState(job.f.id, st);
  }

  async attempt(job) {
    const { f } = job;
    this.onState(f.id, { status: 'loading', received: job.received, total: f.size, connecting: true, p2p: true, part: job.part });
    if (job.canceled) return;
    const w = await api.p2p.openWrite({ name: f.name, part: job.part, saveAs: job.saveAs && !job.part });
    if (job.canceled) { if (w.ok) await api.p2p.closeWrite({ wid: w.wid, cancel: true }); return; }
    if (!w.ok) return this.finish(job, w.canceled ? { status: 'idle' } : { status: 'error', error: w.error, part: job.part, p2p: true });
    job.part = w.part; job.saveAs = false; job.received = w.offset;
    if (w.offset >= f.size) {
      const c = await api.p2p.closeWrite({ wid: w.wid, done: true, size: f.size });
      return this.finish(job, c.ok ? { status: 'done', path: c.path, p2p: true } : { status: 'error', error: c.error, part: c.part, p2p: true });
    }
    const sid = rid() + rid();
    const pc = new RTCPeerConnection(this.rtcConfig());
    const dc = pc.createDataChannel('file', { ordered: true });
    dc.binaryType = 'arraybuffer';
    const s = { role: 'recv', sid, pc, dc, answered: false, ended: false, closed: false };
    job.s = s;
    this.sessions.set(sid, s);
    let pending = []; let pendingBytes = 0; let chain = Promise.resolve(); let writeErr = null;
    const t0 = performance.now(); const start = w.offset; let lastUi = 0;
    const flush = () => {
      if (!pendingBytes) return chain;
      const merged = new Uint8Array(pendingBytes); let o = 0;
      for (const c of pending) { merged.set(c, o); o += c.length; }
      pending = []; pendingBytes = 0;
      chain = chain.then(async () => { if (writeErr) return; const r = await api.p2p.write(w.wid, merged); if (!r.ok) { writeErr = r.error; s.fail('write', r.error); } });
      return chain;
    };
    const ui = (force) => {
      const now = performance.now(); if (!force && now - lastUi < 250) return; lastUi = now;
      const sec = (now - t0) / 1000; const speed = (job.received - start) / Math.max(sec, 0.3);
      this.onState(f.id, { status: 'loading', received: job.received, total: f.size, speed, p2p: true, part: job.part });
    };
    s.fail = async (code0, detail0) => {
      let code = code0; let detail = detail0;
      if (s.closed) return; s.closed = true;
      clearTimeout(s.timer);
      this.sessions.delete(sid);
      try { pc.close(); } catch (_) { /* ignore */ }
      await flush(); await chain;
      // пока дописывали, нажали «Отменить» — удаляем обрывок и больше ничего не делаем
      if (job.canceled && code !== 'canceled') code = 'canceled';
      // запись на диск упала (например, кончилось место) — даже если передача «закончилась», файл не готов
      if (writeErr && code !== 'canceled') { code = 'write'; detail = writeErr; }
      if (code === 'end') {
        const c = await api.p2p.closeWrite({ wid: w.wid, done: true, size: f.size });
        const sec = (performance.now() - t0) / 1000;
        if (c.ok) log.info('chat', `Файл «${f.name}» получен напрямую от ${job.author}: ${Math.round((f.size - start) / 1048576)} МБ за ${sec.toFixed(1)} с (${((f.size - start) / 1048576 / Math.max(sec, 0.1)).toFixed(1)} МБ/с)`);
        if (!c.ok) log.warn('chat', `Файл «${f.name}» не сохранился: ${c.error}`);
        return this.finish(job, c.ok ? { status: 'done', path: c.path, p2p: true } : { status: 'error', error: c.error, code: 'write', part: c.part || job.part, received: job.received, total: f.size, p2p: true });
      }
      if (code === 'canceled') { await api.p2p.closeWrite({ wid: w.wid, cancel: true }); job.part = null; return this.finish(job, { status: 'idle' }); }
      await api.p2p.closeWrite({ wid: w.wid });
      const reason = code === 'timeout' ? (s.why || (s.answered ? 'noconnect' : 'offline')) : code;
      // обрыв посреди передачи — докачиваем с того же места
      const progressed = job.received > start;
      if (!['nofile', 'gone', 'changed', 'offline', 'write'].includes(reason) && job.attempt < RETRIES && (progressed || job.attempt < 2)) {
        job.attempt = progressed ? 0 : job.attempt + 1;
        log.info('chat', `Прямая передача «${f.name}» прервалась (${detail || reason}) — продолжаю с ${Math.round(job.received / 1048576)} МБ`);
        this.onState(f.id, { status: 'loading', received: job.received, total: f.size, stalled: true, p2p: true, part: job.part });
        setTimeout(() => { if (!job.canceled) this.attempt(job); }, 2000);
        return;
      }
      const text = code === 'write' ? `не удалось записать файл: ${detail}` : WHY[reason] || detail || reason;
      log.warn('chat', `Файл «${f.name}» не скачался напрямую: ${text}`);
      this.finish(job, { status: 'error', error: text, code: reason, part: job.part, received: job.received, total: f.size, p2p: true });
    };
    dc.onopen = () => { clearTimeout(s.timer); ui(true); };
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m = {}; try { m = JSON.parse(e.data); } catch (_) { /* ignore */ }
        if (m.t === 'hdr' && (m.size !== f.size || m.offset !== job.received)) s.fail('changed');
        else if (m.t === 'end') { if (job.received === f.size) s.fail('end'); else s.fail('noconnect', 'передача оборвалась'); }
        return;
      }
      const u = new Uint8Array(e.data);
      pending.push(u); pendingBytes += u.length; job.received += u.length;
      if (pendingBytes >= FLUSH) flush();
      ui();
    };
    dc.onclose = () => { if (!s.closed) s.fail('noconnect', 'соединение закрылось'); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') s.fail('noconnect', 'соединение не установилось'); };
    s.timer = setTimeout(() => s.fail('timeout'), 15000);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      this.send(job.author, null, { kind: 'offer', sid, id: f.id, offset: job.received, sdp: pc.localDescription.sdp });
    } catch (e) { s.fail('noconnect', e.message); }
  }
}
