// «Отчёт о демке»: одна кнопка — 60 секунд подробных замеров демки у стримера и у каждого зрителя.
// Всё складывается в журнал стримера (и того, кто нажал): понятный текст, вывод простыми словами
// и одна строка JSON для разработчика (scripts/lab/report-parse.py).
// Сигналы между участниками (идут через сервер, как остальные сигналы WebRTC; старые версии их пропускают):
//   demo-start {id, secs}  стример → зрители: «записывайте свою сторону»
//   demo-ask   {id}        зритель → стример: «запиши отчёт» (нажали у зрителя)
//   demo-sum   {id, side}  зритель → стример: сводка своей стороны; {id, rep} стример → тот, кто попросил: весь отчёт
import { log } from './log.js';
import { settings } from './settings.js';
import { pathOf, multiCoreActive } from './rtc.js';
import { REPORT_SECS, snapOut, snapIn, stepOut, stepIn, summarize, summarizeCpu, verdict, formatReport, SFU_OUT } from './demostats.js';
import { isBackground } from './footprint.js';

const api = window.api;
const WAIT_SUMS = 15000;   // после записи стример ждёт сводки зрителей не дольше 15 с
const WAIT_REPORT = 35000; // зритель, который попросил отчёт, ждёт его от стримера
const MAX_SIGNAL = 30000;  // сервер пересылает сигналы до 32 КБ

// Сведения о системе (один раз за запуск программы): ОС, процессор, память, видеокарта, экраны, кодеки
let sysP = null;
export function systemInfo() {
  if (!sysP) {
    sysP = (async () => {
      const [m, codecs] = await Promise.all([
        Promise.resolve(api.sysInfo ? api.sysInfo() : null).catch(() => null),
        codecSupport(),
      ]);
      const base = m || (await Promise.resolve(api.appInfo()).catch(() => null)) || {};
      return { ...base, codecs, cores: navigator.hardwareConcurrency, win: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } };
    })();
  }
  return sysP;
}
// Умеет ли видеокарта сжимать (e) и распаковывать (d) 1080p60: hw — видеокарта, sw — процессор, no — не умеет
async function codecSupport() {
  const mc = navigator.mediaCapabilities; const out = {};
  const ask = async (fn, mime) => {
    if (!mc || !mc[fn]) return '?';
    try {
      const r = await mc[fn]({ type: 'webrtc', video: { contentType: mime, width: 1920, height: 1080, framerate: 60, bitrate: 8e6 } });
      return !r.supported ? 'no' : r.powerEfficient ? 'hw' : 'sw';
    } catch (_) { return '?'; }
  };
  for (const [name, mime] of [['H264', 'video/H264'], ['VP9', 'video/VP9'], ['AV1', 'video/AV1'], ['HEVC', 'video/H265']]) {
    out[name] = { e: await ask('encodingInfo', mime), d: await ask('decodingInfo', mime) };
    if (settings.hwSeen && settings.hwSeen[name]) out[name].e = 'hw'; // видели настоящее сжатие видеокартой — оно главнее ответа mediaCapabilities
  }
  return out;
}

// ЦП самой «Сходки» по процессам и всего компьютера за последнюю секунду (main/footprint.js); первый замер — null
async function cpuSample(c, s) {
  if (!api.footprint) return;
  try { const f = await api.footprint(); if (f) c.cpu.push({ s, ...f, bg: isBackground() ? 1 : 0 }); } catch (_) { /* старый main.js */ }
}

const newId = () => Math.random().toString(36).slice(2, 8);
const fit = (obj) => { // сигнал не больше 30 КБ: если не влезает — без таблиц по 5 с
  if (JSON.stringify(obj).length <= MAX_SIGNAL) return obj;
  const strip = (x) => { if (x && typeof x === 'object') { delete x.w5; for (const v of Object.values(x)) strip(v); } return x; };
  return strip(JSON.parse(JSON.stringify(obj)));
};

export class DemoReports {
  // view() — что видно у зрителя (размер окна демки и т. п.), ui: { changed(), done(lines), toast(text) }
  constructor(voice, { view = () => null, ui = {} } = {}) {
    this.voice = voice; this.view = view; this.ui = ui; this.cur = null;
    voice.on('demo', (d) => this.onSignal(d));
  }

  get running() { return !!(this.cur && this.cur.phase === 'rec'); }
  get busy() { return !!this.cur; }
  left() { return this.cur ? Math.max(0, Math.ceil(this.cur.secs - (performance.now() - this.cur.t0) / 1000)) : 0; }
  secs() { return Number(api.testFlags && api.testFlags.demoSecs) || REPORT_SECS; }

  // кнопка: role 'streamer' — из меню показа, 'viewer' — у демки
  start(role) {
    const v = this.voice;
    if (this.cur) { this.toast(`Отчёт о демке уже записывается${this.running ? `: осталось ${this.left()} с` : ' — собираю данные'}`); return false; }
    if (role === 'streamer' && v.screen) return this.startStreamer(newId(), this.secs(), null);
    if (role === 'viewer' && v.watching) {
      const p = v.peers.get(v.watching);
      const id = newId();
      this.startViewer(id, v.watching, this.secs(), true);
      if (p && p.remoteScreenInfo && p.remoteScreenInfo.rep) p.signal({ kind: 'demo-ask', id });
      else log.info('diag', `Отчёт о демке: у ${v.watching} старая версия «Сходки» — записываю только свою сторону`);
      return true;
    }
    this.toast('Отчёт о демке пишется во время показа: начните показ или смотрите чью-то демку');
    return false;
  }

  onSignal(d) {
    const v = this.voice; const c = this.cur;
    if (d.kind === 'demo-ask') {
      if (!v.screen) return;
      const p = v.peers.get(d.from);
      if (c && c.role === 'streamer') { // уже пишем — подключаем и его
        c.askers.add(d.from);
        if (c.phase === 'rec' && p) p.signal({ kind: 'demo-start', id: c.id, secs: this.left() });
        return;
      }
      if (c) return;
      log.info('diag', `${d.from} попросил(а) отчёт о демке — записываю ${this.secs()} с у себя и у зрителей`);
      this.startStreamer(String(d.id || newId()), this.secs(), d.from);
    } else if (d.kind === 'demo-start') {
      if (v.watching !== d.from) return;
      if (c && c.role === 'viewer' && c.streamer === d.from) { c.id = String(d.id); return; } // сами попросили — берём номер стримера
      if (c) return;
      this.toast(`${d.from} записывает отчёт о демке — ваша сторона тоже записывается (${Math.round(d.secs) || this.secs()} с)`);
      this.startViewer(String(d.id), d.from, Math.max(5, Math.min(120, Number(d.secs) || this.secs())), false);
    } else if (d.kind === 'demo-sum') {
      if (!c || String(d.id) !== c.id) return;
      if (c.role === 'streamer' && d.side) {
        c.sums.set(d.from, d.side);
        if (c.phase === 'wait' && [...c.expect].every((n) => c.sums.has(n))) this.finishStreamer();
      } else if (c.role === 'viewer' && c.initiator && d.rep && d.from === c.streamer) {
        this.finishViewer(d.rep);
      }
    }
  }

  // ---------- стример ----------
  async startStreamer(id, secs, asker) {
    const v = this.voice;
    const c = this.cur = { id, role: 'streamer', secs, t0: performance.now(), phase: 'rec', askers: new Set(asker ? [asker] : []),
      prev: new Map(), samples: new Map(), cpu: [], expect: new Set(), old: new Set(), sums: new Map(), stopped: null, startedAt: new Date().toISOString() };
    c.sysP = systemInfo();
    this.invite();
    log.info('diag', `Отчёт о демке: записываю ${secs} с (${this.viewers().length ? 'и у зрителей: ' + this.viewers().map((p) => p.name).join(', ') : 'пока никто не смотрит'})`);
    if (!asker) this.toast(`Записываю отчёт о демке: ${secs} с. Потом он будет в журнале`);
    c.timer = setInterval(() => this.tickStreamer(c), 1000);
    this.tickStreamer(c);
    this.changed();
    return true;
  }
  viewers() { return [...this.voice.peers.values()].filter((p) => p.sentScreen); }
  // зрители, которых ещё не позвали (в том числе подключившиеся во время записи)
  invite() {
    const c = this.cur;
    for (const p of this.viewers()) {
      if (c.expect.has(p.name) || c.old.has(p.name)) continue;
      if (p.demoCaps) { c.expect.add(p.name); p.signal({ kind: 'demo-start', id: c.id, secs: this.left() || c.secs }); } else c.old.add(p.name);
    }
  }
  async tickStreamer(c) {
    if (this.cur !== c || c.phase !== 'rec' || c.busy) return;
    const v = this.voice;
    if (!v.room) return this.abort('вы вышли из комнаты');
    const s = Math.round((performance.now() - c.t0) / 1000);
    if (!v.screen) { c.stopped = s; return this.endRecording(c); }
    if (s >= c.secs) return this.endRecording(c);
    c.busy = true;
    try {
      await cpuSample(c, s);
      this.invite();
      const mode = v.mode();
      // захват видеокартой (1.19.0): Chromium сжимает пустышку 16×16 — размер и время сжатия берём у помощника
      const gpu = v.screen.gpu;
      const gpuFix = (snap) => { if (snap && gpu && gpu.info) { snap.w = gpu.info.w; snap.h = gpu.info.h; snap.enc = `${gpu.info.enc} (видеокарта, помощник)`; snap.pe = true; snap.qp = null; } return snap; }; // QP пустышки — не наш
      const gpuMs = (x) => { if (x && gpu && gpu.st) x.encMs = gpu.st.encMs; return x; };
      for (const p of this.viewers()) {
        if (p.viaSfu) continue; // смотрит через сервер — у них один общий поток (ниже)
        const list = [...(await p.pc.getStats()).values()];
        const snap = gpuFix(snapOut(list, performance.now(), pathOf));
        if (!snap) continue;
        const prev = c.prev.get(p.name); c.prev.set(p.name, snap);
        const x = gpuMs(prev && stepOut(prev, snap));
        if (!x) continue;
        let enc = {}; let dp = null;
        try { const prm = p.vtx.sender.getParameters(); enc = (prm.encodings && prm.encodings[0]) || {}; dp = prm.degradationPreference || null; } catch (_) { /* ignore */ }
        Object.assign(x, { s, maxBr: enc.maxBitrate ? enc.maxBitrate / 1e6 : null, dp, motion: mode === 'motion' ? 1 : 0 });
        if (!c.samples.has(p.name)) c.samples.set(p.name, []);
        c.samples.get(p.name).push(x);
      }
      // через сервер (размножитель, 1.16): один поток на всех, кто смотрит через него
      if (v.sfu && v.sfu.hasProducer() && v.sfuViewers() > 0) {
        const r = await v.sfu.producerStats();
        const snap = gpuFix(r && snapOut([...r.values()], performance.now(), pathOf));
        const prev = c.prev.get(SFU_OUT); if (snap) c.prev.set(SFU_OUT, snap);
        const x = gpuMs(snap && prev && stepOut(prev, snap));
        if (x) {
          let enc = {}; let dp = null;
          try { const prm = v.sfu.prod.video.rtpSender.getParameters(); enc = (prm.encodings && prm.encodings[0]) || {}; dp = prm.degradationPreference || null; } catch (_) { /* ignore */ }
          Object.assign(x, { s, maxBr: enc.maxBitrate ? enc.maxBitrate / 1e6 : null, dp, motion: mode === 'motion' ? 1 : 0 });
          if (!c.samples.has(SFU_OUT)) c.samples.set(SFU_OUT, []);
          c.samples.get(SFU_OUT).push(x);
        }
      }
    } catch (e) { log.debug('diag', `Отчёт о демке: замер не удался: ${e.message}`); } finally { c.busy = false; }
    this.changed();
  }
  appState() {
    const v = this.voice; const sc = v.screen; const tg = v.target();
    const st = sc && sc.gpu && sc.gpu.info ? { width: sc.gpu.info.w, height: sc.gpu.info.h, frameRate: sc.gpu.info.fps } : sc ? sc.video.getSettings() : {};
    const n = settings.screenNet; const share = v.uplinkShare();
    return {
      quality: 'custom', mode: v.mode(), target: tg, codec: v.codec(), multiCore: multiCoreActive(),
      gpu: sc && sc.gpu && sc.gpu.info ? { enc: sc.gpu.info.enc, kbps: sc.gpu.kbps, fps: sc.gpu.st ? sc.gpu.st.fps : null, encMs: sc.gpu.st ? sc.gpu.st.encMs : null, idrs: sc.gpu.idrs } : null,
      uplinkShare: isFinite(share) ? Math.round(share * 100) / 100 : null,
      net: n && n.up ? { up: n.up, mbps: n.mbps, days: n.at ? Math.round((Date.now() - n.at) / 864e5) : null } : null,
      capture: { w: st.width, h: st.height, fps: st.frameRate }, hint: sc ? sc.video.contentHint || '' : '', viewers: this.viewers().map((p) => p.name),
      sfu: v.sfu ? { on: !!v.sfuOn, viewers: this.viewers().filter((p) => p.viaSfu).map((p) => p.name) } : null,
    };
  }
  async endRecording(c) {
    if (c.phase !== 'rec') return;
    clearInterval(c.timer); c.phase = 'wait';
    c.state = this.voice.screen ? this.appState() : null;
    // что сервер (размножитель) отдаёт каждому зрителю: скорость, потери, повторы
    if (c.state && c.state.sfu && c.state.sfu.viewers.length) c.state.sfu.out = await this.voice.sfu.req('sfu_stats', {}, 4000).then((r) => r.list || null).catch(() => null);
    this.changed();
    if (![...c.expect].every((n) => c.sums.has(n))) c.waitTimer = setTimeout(() => this.finishStreamer(), WAIT_SUMS);
    else this.finishStreamer();
  }
  async finishStreamer() {
    const c = this.cur;
    if (!c || c.role !== 'streamer' || c.phase !== 'wait') return;
    c.phase = 'done'; clearTimeout(c.waitTimer);
    const out = {};
    for (const [n, xs] of c.samples) out[n] = summarize(xs, 'out');
    const viewers = {};
    for (const n of new Set([...c.samples.keys(), ...c.expect, ...c.old].filter((x) => x !== SFU_OUT))) {
      viewers[n] = c.sums.get(n) || { missing: c.old.has(n) ? 'old' : 'timeout' };
    }
    const rep = {
      v: 1, id: c.id, at: c.startedAt, secs: c.stopped ?? c.secs, by: c.askers.size ? [...c.askers][0] : this.voice.me,
      streamer: { name: this.voice.me, sys: await c.sysP, state: c.state, out, cpu: summarizeCpu(c.cpu), note: c.stopped != null ? `Показ остановлен на ${c.stopped}-й секунде записи` : undefined },
      viewers,
    };
    rep.verdict = verdict(rep);
    this.write(rep);
    for (const n of c.askers) { const p = this.voice.peers.get(n); if (p) p.signal({ kind: 'demo-sum', id: c.id, rep: fit(rep) }); }
    this.done(rep);
  }

  // ---------- зритель ----------
  startViewer(id, streamer, secs, initiator) {
    const c = this.cur = { id, role: 'viewer', streamer, secs, initiator, t0: performance.now(), phase: 'rec', prev: null, samples: [], cpu: [], startedAt: new Date().toISOString() };
    c.sysP = systemInfo();
    if (initiator) this.toast(`Записываю отчёт о демке ${streamer}: ${secs} с. Не закрывайте демку`);
    c.timer = setInterval(() => this.tickViewer(c), 1000);
    this.tickViewer(c);
    this.changed();
  }
  async tickViewer(c) {
    if (this.cur !== c || c.phase !== 'rec' || c.busy) return;
    const v = this.voice;
    if (!v.room) return this.abort('вы вышли из комнаты');
    const s = Math.round((performance.now() - c.t0) / 1000);
    const p = v.peers.get(c.streamer);
    if (!p || v.watching !== c.streamer || !p.remoteScreen) { c.stopped = s; return this.endViewer(c); }
    if (s >= c.secs) return this.endViewer(c);
    c.busy = true;
    try {
      await cpuSample(c, s);
      const list = [...(await p.screenReport()).values()]; // через сервер — статистика потока от сервера
      const snap = snapIn(list, performance.now(), pathOf, this.view());
      if (snap && p.sfuIn) snap.path = 'sfu';
      if (snap) {
        const x = c.prev && stepIn(c.prev, snap); c.prev = snap;
        if (x) { x.s = s; c.samples.push(x); }
      }
    } catch (e) { log.debug('diag', `Отчёт о демке: замер не удался: ${e.message}`); } finally { c.busy = false; }
    this.changed();
  }
  async endViewer(c) {
    if (c.phase !== 'rec') return;
    clearInterval(c.timer); c.phase = 'wait';
    const { sum, w5 } = summarize(c.samples, 'in');
    c.side = { sys: await c.sysP, sum, w5, cpu: summarizeCpu(c.cpu), latency: settings.screenLatency === 'low' ? 'low' : 'smooth', stopped: c.stopped ?? undefined };
    const p = this.voice.peers.get(c.streamer);
    const can = p && p.remoteScreenInfo && p.remoteScreenInfo.rep;
    if (p && can) p.signal({ kind: 'demo-sum', id: c.id, side: fit(c.side) });
    this.changed();
    // попросили сами и стример умеет — ждём от него весь отчёт; иначе пишем свою сторону сразу
    if (c.initiator && can) c.waitTimer = setTimeout(() => this.finishViewer(null), WAIT_REPORT);
    else this.finishViewer(null);
  }
  finishViewer(full) {
    const c = this.cur;
    if (!c || c.role !== 'viewer' || c.phase === 'done') return;
    if (c.phase === 'rec') { // отчёт пришёл раньше, чем мы закончили (стример остановил показ) — дописываем своё
      clearInterval(c.timer); c.phase = 'wait';
    }
    c.phase = 'done'; clearTimeout(c.waitTimer);
    let rep = full;
    if (!rep) {
      rep = { v: 1, id: c.id, at: c.startedAt, secs: c.stopped ?? c.secs, by: this.voice.me, streamer: null, viewers: { [this.voice.me]: c.side || { missing: 'timeout' } } };
      rep.verdict = verdict(rep);
      if (c.initiator) log.info('diag', `Отчёт о демке: ${c.streamer} не прислал свою часть — в отчёте только ваша сторона`);
    }
    this.write(rep); // зритель, которого позвали, пишет у себя свою сторону (полный отчёт — у стримера)
    this.done(rep, !c.initiator);
  }

  // ---------- общее ----------
  write(rep) {
    for (const e of formatReport(rep)) log[e.level]('diag', e.msg, e.details ? { details: e.details } : undefined);
  }
  done(rep, quiet = false) {
    this.cur = null;
    this.changed();
    if (!quiet && this.ui.done) this.ui.done(rep.verdict || []);
  }
  abort(why) {
    const c = this.cur;
    if (!c) return;
    clearInterval(c.timer); clearTimeout(c.waitTimer);
    this.cur = null;
    log.info('diag', `Отчёт о демке прерван: ${why}`);
    this.changed();
  }
  changed() { if (this.ui.changed) try { this.ui.changed(); } catch (_) { /* ignore */ } }
  toast(t) { if (this.ui.toast) this.ui.toast(t); }
}
