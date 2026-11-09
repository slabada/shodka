// Размножитель демки (1.16) в программе: показ и просмотр демки через сервер (mediasoup-client).
// Стример отдаёт демку серверу ОДИН раз (один поток картинки и один — звука), сервер раздаёт её каждому зрителю.
// Не вышло (сервер не умеет, размножитель упал, соединение не установилось) — демка идёт напрямую, как раньше (rtc.js).
import { Device } from '../vendor/mediasoup-client.js';
import { log } from './log.js';

const SCREEN_AUDIO_BITRATE = 160000;
// Профиль H.264 для сервера — тот, что сжимает видеокарта. Chromium на Windows отдаёт видеокарте Baseline (42001f — его
// берёт показ напрямую) и Main (4d001f), а Constrained Baseline (42e01f) — только процессору (OpenH264): так было
// в журнале Egor2 22.10 (1.16.3: напрямую NVIDIA, через сервер OpenH264). Сервер 1.16.0 раздаёт 42e01f и 4d001f — берём Main
// (на 1.17.1 у Egor2 подтвердилось: NVIDIA). С сервером 1.17.2 — High (64001f), если Chromium умеет его отправлять:
// процессором (OpenH264) High не сжимается, поэтому в списке отправки он есть только при видеокарте.
const H264_PREF = ['6400', '4d00', '4200', '42e0'];
function h264Rank(c) {
  const i = H264_PREF.indexOf(String((c.parameters && c.parameters['profile-level-id']) || '').toLowerCase().slice(0, 4));
  return i < 0 ? H264_PREF.length : i;
}

export class SfuLink {
  constructor(voice) {
    this.voice = voice;
    this.device = null; this.loading = null;
    this.t = { send: null, recv: null }; this.tMaking = { send: null, recv: null };
    this.prod = { video: null, audio: null, codec: '', paused: false };
    this.cons = new Map(); // ник стримера → { video, audio }
    this.closed = false;
  }

  async req(type, payload = {}, ms = 10000) {
    const r = await this.voice.conn.request({ type, ...payload }, ms);
    return (r && r.data) || {};
  }

  async ready() {
    if (this.device && this.device.loaded) return this.device;
    if (!this.loading) {
      this.loading = (async () => {
        const { caps } = await this.req('sfu_caps');
        const d = new Device({ handlerName: 'Chrome111' }); // Electron 43 = Chromium 150
        await d.load({ routerRtpCapabilities: caps });
        this.device = d;
        return d;
      })().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  canPlay(kind, mime) {
    return !!(this.device && this.device.loaded && this.device.rtpCapabilities.codecs.some((c) => c.kind === kind && c.mimeType.toLowerCase() === mime.toLowerCase()));
  }

  alive(t) { return t && !t.closed && t.connectionState !== 'failed' && t.connectionState !== 'closed'; }

  async transport(dir) {
    if (this.alive(this.t[dir])) return this.t[dir];
    if (!this.tMaking[dir]) {
      this.tMaking[dir] = (async () => {
        await this.ready();
        if (this.t[dir]) { try { this.t[dir].close(); } catch (_) { /* ignore */ } }
        const p = await this.req('sfu_transport', { dir });
        const opts = { id: p.id, iceParameters: p.iceParameters, iceCandidates: p.iceCandidates, dtlsParameters: p.dtlsParameters,
          iceServers: this.voice.iceServers || [], iceTransportPolicy: 'all' };
        const t = dir === 'send' ? this.device.createSendTransport(opts) : this.device.createRecvTransport(opts);
        t.on('connect', ({ dtlsParameters }, cb, eb) => { this.req('sfu_connect', { tid: t.id, dtlsParameters }).then(() => cb(), eb); });
        if (dir === 'send') {
          t.on('produce', ({ kind, rtpParameters, appData }, cb, eb) => { this.req('sfu_produce', { tid: t.id, kind, rtpParameters, appData }).then((r) => cb({ id: r.id }), eb); });
        }
        t.on('connectionstatechange', (s) => this.onTransportState(dir, t, s));
        this.t[dir] = t;
        return t;
      })().finally(() => { this.tMaking[dir] = null; });
    }
    return this.tMaking[dir];
  }

  onTransportState(dir, t, s) {
    if (t !== this.t[dir]) return;
    log.debug('screen', `Размножитель (${dir === 'send' ? 'отдаю' : 'смотрю'}): соединение ${s}`);
    clearTimeout(t.skhDiscTimer);
    if (s === 'connected') {
      if (!t.skhLogged) { t.skhLogged = true; t.getStats().then((r) => { const how = transportHow(r); log.info('screen', `Связь с размножителем (${dir === 'send' ? 'отдаю демку' : 'смотрю демку'}): ${how}`); }).catch(() => {}); }
      return;
    }
    // «disconnected» бывает на секунду-другую при смене сети; «failed» — всё
    if (s === 'disconnected') t.skhDiscTimer = setTimeout(() => { if (t.connectionState === 'disconnected') this.voice.sfuBroken(dir, 'нет связи с сервером 6 секунд'); }, 6000);
    else if (s === 'failed') this.voice.sfuBroken(dir, 'соединение с сервером не установилось');
  }

  // ---------- стример ----------
  // enc: { maxBitrate, maxFramerate }, codec: 'H264' | 'VP8' | ..., startKbps — с какой скорости начинать.
  // Двое зрителей пришли одновременно — поток на сервер создаётся один раз (запросы идут по очереди).
  produce(sc, opts) {
    const run = (this.prodQueue || Promise.resolve()).then(() => this.produceNow(sc, opts));
    this.prodQueue = run.catch(() => {});
    return run;
  }
  // onVideoSender(sender) — 1.19.0, захват видеокартой: подмену кадров Chromium принимает, только если она стоит на отправке
  // до первого согласования; mediasoup создаёт отправку внутри produce() — ловим её там (addTransceiver этого потока)
  async produceNow(sc, { codec, enc, startKbps, onVideoSender }) {
    const t = await this.transport('send');
    const p = this.prod;
    if (p.video && (p.video.closed || p.codec !== codec)) { this.closeProducer('video'); }
    if (!p.video) {
      // что этот ПК умеет ОТПРАВЛЯТЬ (rtpCapabilities — что умеет принимать: High распакует любой, а сожмёт не каждый)
      const video = this.device.sendRtpCapabilities.codecs.filter((c) => c.kind === 'video' && !/\/(rtx|red|ulpfec|flexfec)/i.test(c.mimeType));
      // «H.264 — процессор» (1.17.5) и «… на нескольких ядрах» (1.18.2) — тот же H.264, но Constrained Baseline: его сжимает процессор (OpenH264)
      const sw = codec === 'H264SW' || codec === 'H264MT';
      const want = video.filter((c) => c.mimeType.toLowerCase() === `video/${sw ? 'H264' : codec}`.toLowerCase());
      const isCb = (x) => String((x.parameters && x.parameters['profile-level-id']) || '').toLowerCase().startsWith('42e0');
      const pm0 = (x) => !Number(x.parameters && x.parameters['packetization-mode']);
      // «… на нескольких ядрах» — кадр кусками (packetization-mode=0, rtc.js H264MT); если размножитель такой упаковки
      // не знает (сервер до неё не обновлён), через сервер — как «H.264 — процессор», на одном ядре
      const cb = sw && ((codec === 'H264MT' && want.find((x) => isCb(x) && pm0(x))) || want.find((x) => isCb(x) && !pm0(x)) || want.find(isCb));
      if (codec === 'H264MT' && cb && !pm0(cb)) log.info('screen', 'Через сервер демка сжимается на одном ядре: размножитель на этом сервере не знает H.264 кусками. Напрямую — на нескольких ядрах');
      let c = sw ? cb || want[0] : codec === 'H264' ? want.slice().sort((a, b) => h264Rank(a) - h264Rank(b))[0] : want[0];
      if (!c) {
        c = video[0];
        if (!c) throw new Error('у сервера и программы нет общего видеокодека');
        log.warn('screen', `Кодек ${codec} через сервер недоступен на этом ПК — демка на сервер пойдёт в ${c.mimeType.replace('video/', '')}`);
      }
      const orig = RTCPeerConnection.prototype.addTransceiver;
      if (onVideoSender) {
        RTCPeerConnection.prototype.addTransceiver = function (what, init) {
          const tr = orig.call(this, what, init);
          if (what === sc.video) { try { onVideoSender(tr.sender); } catch (e) { log.warn('screen', `Подмена кадров на сервер: ${e.message}`); } }
          return tr;
        };
      }
      try {
        p.video = await t.produce({ track: sc.video, encodings: [{ ...enc, priority: 'high', networkPriority: 'high' }], codec: c,
          codecOptions: startKbps ? { videoGoogleStartBitrate: startKbps } : undefined, stopTracks: false, zeroRtpOnPause: true, disableTrackOnPause: false, appData: { screen: true } });
      } finally { RTCPeerConnection.prototype.addTransceiver = orig; }
      // 1.19.2: p.paused здесь не сбрасываем — если поток стоял на паузе (кодек сменили, пока через сервер никто не смотрел),
      // звук на сервере всё ещё на паузе, и снимает её setPaused(false) ниже — вместе с картинкой
      p.codec = codec;
      p.video.on('transportclose', () => { if (p.video && p.video.closed) p.video = null; });
    }
    if (sc.audio && !p.audio) {
      p.audio = await t.produce({ track: sc.audio, encodings: [{ maxBitrate: SCREEN_AUDIO_BITRATE, priority: 'high', networkPriority: 'high' }],
        codecOptions: { opusStereo: true, opusDtx: false, opusFec: true, opusMaxAverageBitrate: SCREEN_AUDIO_BITRATE }, stopTracks: false, zeroRtpOnPause: true, disableTrackOnPause: false, appData: { screen: true } });
    }
    if (p.paused) await this.setPaused(false);
    return { video: p.video.id, audio: p.audio ? p.audio.id : null };
  }

  hasProducer() { return !!(this.prod.video && !this.prod.video.closed); }

  // никто не смотрит через сервер — поток на паузе (не тратим отдачу и видеокарту).
  // 1.19.2: пауза останавливает только отправку на сервер (zeroRtpOnPause), а сами дорожки демки не выключает
  // (disableTrackOnPause: false в produce): они общие с теми, кто смотрит напрямую, а sc.audio.enabled — это выбор
  // «Звук компьютера». Раньше mediasoup-client выключал их на паузе — у зрителей напрямую была чёрная демка без звука,
  // а снятая пауза сама включала звук, выключенный стримером.
  async setPaused(paused) {
    const p = this.prod;
    if (!p.video || p.paused === paused) return;
    p.paused = paused;
    for (const pr of [p.video, p.audio]) {
      if (!pr || pr.closed) continue;
      try { if (paused) pr.pause(); else pr.resume(); } catch (_) { /* ignore */ }
      this.req('sfu_pause', { id: pr.id, paused }).catch(() => {});
    }
    log.debug('screen', paused ? 'Через сервер демку никто не смотрит — поток на паузе' : 'Поток демки на сервер снова идёт');
  }

  // новый экран или окно: те же потоки, другие дорожки. Появился звук, которого не было, — новый поток звука
  // (зрителям надо сказать заново — вернём true)
  async replaceTracks(sc) {
    const p = this.prod;
    if (p.video && !p.video.closed) await p.video.replaceTrack({ track: sc.video });
    if (p.audio && !p.audio.closed) { await p.audio.replaceTrack({ track: sc.audio || null }); return false; }
    if (sc.audio && p.video && !p.video.closed) {
      const t = await this.transport('send');
      p.audio = await t.produce({ track: sc.audio, encodings: [{ maxBitrate: SCREEN_AUDIO_BITRATE, priority: 'high', networkPriority: 'high' }], codecOptions: { opusStereo: true, opusDtx: false, opusFec: true, opusMaxAverageBitrate: SCREEN_AUDIO_BITRATE }, stopTracks: false, zeroRtpOnPause: true, disableTrackOnPause: false, appData: { screen: true } });
      if (p.paused) { try { p.audio.pause(); } catch (_) { /* ignore */ } this.req('sfu_pause', { id: p.audio.id, paused: true }).catch(() => {}); }
      return true;
    }
    return false;
  }
  ids() { return { video: this.prod.video ? this.prod.video.id : null, audio: this.prod.audio && !this.prod.audio.closed ? this.prod.audio.id : null }; }

  // скорость, кадры и что важнее при нехватке — на ходу, без пересогласования
  async setEncoding({ maxBitrate, maxFramerate, degradationPreference }) {
    const pr = this.prod.video;
    if (!pr || pr.closed || !pr.rtpSender) return;
    const prm = pr.rtpSender.getParameters();
    if (!prm.encodings || !prm.encodings.length) return;
    prm.encodings[0].maxBitrate = Math.round(maxBitrate);
    prm.encodings[0].maxFramerate = maxFramerate;
    prm.encodings[0].scaleResolutionDownBy = 1;
    if (degradationPreference) prm.degradationPreference = degradationPreference;
    await pr.rtpSender.setParameters(prm);
  }

  closeProducer(kind) {
    const pr = this.prod[kind];
    this.prod[kind] = null;
    if (!pr) return;
    if (!pr.closed) { try { pr.close(); } catch (_) { /* ignore */ } }
    this.req('sfu_close', { producer: pr.id }).catch(() => {});
  }
  closeProducers() { this.closeProducer('video'); this.closeProducer('audio'); this.prod.codec = ''; this.prod.paused = false; }

  async producerStats() { const pr = this.prod.video; return pr && !pr.closed ? pr.getStats() : null; }

  // ---------- зритель ----------
  // ids: { video, audio } — потоки стримера на сервере. Возвращает { video, audio } (consumer) или бросает ошибку.
  async consume(owner, ids) {
    const t = await this.transport('recv');
    this.closeConsumers(owner);
    const caps = this.device.rtpCapabilities;
    const got = { video: null, audio: null };
    this.cons.set(owner, got);
    try {
      for (const kind of ['video', 'audio']) {
        if (!ids[kind]) continue;
        const r = await this.req('sfu_consume', { tid: t.id, producerId: ids[kind], rtpCapabilities: caps });
        if (this.cons.get(owner) !== got) throw Object.assign(new Error('уже не нужно'), { superseded: true }); // пока ждали, попросили заново
        // один streamId у картинки и звука — Chromium держит их в такт
        const c = await t.consume({ id: r.id, producerId: r.producerId, kind: r.kind, rtpParameters: r.rtpParameters, streamId: `skh-screen-${owner}` });
        got[kind] = c;
        await this.req('sfu_resume', { id: c.id });
      }
    } catch (e) { if (this.cons.get(owner) === got) this.closeConsumers(owner); else for (const c of [got.video, got.audio]) if (c && !c.closed) { try { c.close(); } catch (_) { /* ignore */ } this.req('sfu_close', { consumer: c.id }).catch(() => {}); } throw e; }
    if (this.cons.get(owner) !== got) throw Object.assign(new Error('уже не нужно'), { superseded: true });
    return got;
  }

  consumersOf(owner) { return this.cons.get(owner) || null; }

  closeConsumers(owner) {
    const got = this.cons.get(owner);
    if (!got) return;
    this.cons.delete(owner);
    for (const c of [got.video, got.audio]) {
      if (!c) continue;
      if (!c.closed) { try { c.close(); } catch (_) { /* ignore */ } }
      this.req('sfu_close', { consumer: c.id }).catch(() => {});
    }
  }

  // сервер закрыл поток (стример закончил показ, сменил кодек, вышел) — забываем его; что делать дальше, решает rtc.js
  onClosed(cid) {
    for (const [owner, got] of this.cons) {
      for (const k of ['video', 'audio']) {
        const c = got[k];
        if (c && c.id === cid) { try { c.close(); } catch (_) { /* ignore */ } got[k] = null; return owner; }
      }
    }
    return null;
  }

  // размножитель упал / мы ушли из комнаты: всё закрыть (сервер чистит своё сам)
  reset() {
    for (const owner of [...this.cons.keys()]) { const got = this.cons.get(owner); this.cons.delete(owner); for (const c of [got.video, got.audio]) if (c && !c.closed) { try { c.close(); } catch (_) { /* ignore */ } } }
    for (const k of ['video', 'audio']) { const pr = this.prod[k]; this.prod[k] = null; if (pr && !pr.closed) { try { pr.close(); } catch (_) { /* ignore */ } } }
    this.prod.codec = ''; this.prod.paused = false;
    for (const dir of ['send', 'recv']) { const t = this.t[dir]; this.t[dir] = null; if (t && !t.closed) { try { t.close(); } catch (_) { /* ignore */ } } }
    this.device = null;
  }
  close() { this.closed = true; this.reset(); }
}

// как идёт связь с сервером: UDP / TCP / через ретранслятор, пинг
function transportHow(report) {
  const by = new Map(); report.forEach((s) => by.set(s.id, s));
  const tr = [...report.values()].find((x) => x.type === 'transport' && x.selectedCandidatePairId);
  const pair = tr && by.get(tr.selectedCandidatePairId);
  if (!pair) return 'установлена';
  const l = by.get(pair.localCandidateId); const r = by.get(pair.remoteCandidateId);
  const relay = l && l.candidateType === 'relay';
  const proto = ((l && (l.relayProtocol || l.protocol)) || '').toUpperCase();
  const rtt = pair.currentRoundTripTime != null ? `, пинг ${Math.round(pair.currentRoundTripTime * 1000)} мс` : '';
  return `${relay ? 'через ретранслятор сервера' : 'напрямую с сервером'} (${proto || '?'}${r && r.port ? `, порт ${r.port}` : ''})${rtt}`;
}
