// «Видеокартой, как OBS» (1.19.0): экран снимает и сжимает видеокарта в помощнике skh-videocap.exe (FFmpeg:
// ddagrab + NVENC/AMF), а Chromium только отправляет. Как это сделано (отчёт 14, лаборатория):
//  - в демку вместо захвата экрана идёт дорожка-пустышка 16×16 — одна и та же картинка, её сжатие почти бесплатно;
//    на каждый кадр помощника — один кадр пустышки (MediaStreamTrackGenerator);
//  - на отправке (каждому зрителю напрямую и на сервер) RTCRtpScriptTransform подменяет сжатую пустышку готовым
//    кадром H.264 от помощника (gpucap-worker.js);
//  - зритель просит целый кадр → пустышка выходит ключевой → просим помощника «idr»;
//  - скорость: Chromium свою оценку канала на подменённые кадры не накладывает, поэтому её ведём мы — по оценке
//    канала (availableOutgoingBitrate) с запасом 15 %, не выше выбранной в настройках (то, что Chromium делает
//    со своим сжатием сам). Разрешение и кадры — как выбраны, их программа сама не меняет.
//  - 1.20.1: сжатие одно на всех, поэтому: новый зритель первые 15 с скорость не роняет (его оценка канала ещё
//    разгоняется), скорость возвращается быстрее, а целые кадры — не чаще раза в секунду на всех
//    (у vertigo 25.10 при двух зрителях — «шакал и квадраты»).
import { log } from './log.js';

const api = window.api;
const PX = new Uint8Array(16 * 16 * 4); // кадр пустышки: всегда один и тот же
// 1.19.2: ниже этого помощник не опускается — это только его технический предел (main/videocap.js), а не «пол» скорости:
// «пол» 1,5 Мбит/с пересиливал выбранную скорость, долю отдачи на зрителя и оценку канала (в обычном показе его убрали в 1.17.0)
const MIN_KBPS = 300;
const NEW_VIEWER_MS = 15000; // 1.20.1: столько оценка канала нового зрителя не учитывается
const UP_MS = 5000;          // 1.20.1: вверх не чаще (было 10 с и ×1,5 — после просадки качество возвращалось с минуту)
const IDR_GAP_MS = 1000;     // 1.20.1: целые кадры — не чаще (просьбы нескольких зрителей склеиваются)

export function gpuCaptureAvailable() {
  return api.videoCap ? Promise.resolve(api.videoCap.available()).catch(() => false) : Promise.resolve(false);
}
// 1.19.2: чего не хватает помощнику ('' — всё на месте) — для понятного сообщения, почему показ не начался
export function gpuCaptureMissing() {
  if (!api.videoCap) return Promise.resolve('нет в этой сборке');
  if (!api.videoCap.missing) return gpuCaptureAvailable().then((ok) => (ok ? '' : 'resources\\bin\\videocap'));
  return Promise.resolve(api.videoCap.missing()).catch(() => '');
}
export const GPU_MISSING_HINT = 'Выключите «Видеокартой, как OBS» стрелкой у кнопки показа (или в Настройки → Показ экрана) и показывайте как обычно. Чтобы вернуть захват видеокартой — поставьте обновление 1.19.x целиком: папка videocap из архива должна лечь в resources\\bin. Если её убирает антивирус — добавьте папку «Сходки» в исключения.';
// 1.19.3: Windows забрала экран у помощника (887a0026) — у irritat 24.10 так трижды обрывался показ
const LOST_HINT = 'Так бывает, когда игра переключает полноэкранный режим или разрешение, или всплывает окно Windows «Разрешить изменения?». Помощник сам запускает захват заново. Если повторяется часто — включите в игре режим «Оконный без рамки» (Borderless).';
export const GPU_LOST_HINT = 'Windows 30 секунд не возвращала экран помощнику — так бывает, когда игра идёт в режиме «Полноэкранный». Включите в игре «Оконный без рамки» (Borderless) и начните показ заново. Или выключите «Видеокартой, как OBS» стрелкой у кнопки показа — обычный захват такое переживает.';

export class GpuCapture {
  // fps, kbps — старт; output — номер экрана у Chromium (запасной); source — id экрана из окна выбора (по нему помощник
  // находит монитор, 1.20.1); capKbps() — потолок скорости; onExit(why, { lost }) — помощник остановился сам;
  // onResume({ resized }) — захват восстановился после потери экрана; onMany(n) — напрямую смотрят n ≥ 2 (1.20.1)
  constructor({ fps, kbps, output, source, capKbps, onExit, onResume, onMany }) {
    this.fps = fps; this.kbps = kbps; this.output = output; this.source = source; this.capKbps = capKbps;
    this.onExit = onExit; this.onResume = onResume; this.onMany = onMany;
    this.outs = new Map(); // sender → { id, label, at, server }
    this.nextOut = 1; this.lastTs = 0; this.info = null; this.st = null; this.stopped = false;
    this.lastRate = 0; this.lastUp = 0; this.idrs = 0; this.lostAt = 0; this.losses = 0;
    this.lastIdr = 0; this.idrTimer = 0;
  }

  async start() {
    this.worker = new Worker('js/gpucap-worker.js');
    this.worker.onmessage = (e) => {
      if (e.data.idr) this.idr(e.data.idr);
      if (e.data.stats) this.workerStats = e.data.stats;
    };
    this.gen = new MediaStreamTrackGenerator({ kind: 'video' });
    this.writer = this.gen.writable.getWriter();
    this.offAu = api.videoCap.onAu((id, buf) => this.onAu(id, buf));
    this.offMsg = api.videoCap.onMsg((m) => this.onMsg(m));
    try { await this.launch(); } catch (e) { this.stop(); throw e; }
    this.rateTimer = setInterval(() => this.rate().catch(() => {}), 2000);
    return this.gen;
  }

  // запуск помощника; ждём, пока он скажет, чем сжимает (или почему не может)
  async launch() {
    const r = await api.videoCap.start({ fps: this.fps, kbps: this.kbps, output: this.output, source: this.source });
    if (!r || !r.ok) throw new Error((r && r.reason) || 'помощник захвата видеокартой не запустился');
    this.id = r.id;
    this.info = await new Promise((resolve, reject) => {
      this.waitReady = { resolve, reject };
      setTimeout(() => reject(new Error('помощник захвата видеокартой не ответил за 10 секунд')), 10000);
    }).finally(() => { this.waitReady = null; });
    this.kbps = this.info.kbps || this.kbps;
    log.info('screen', `Захват и сжатие видеокартой: ${encName(this.info.enc)}, ${this.info.w}×${this.info.h}, ${this.info.fps} кадров/с, старт ${Math.round(this.kbps / 100) / 10} Мбит/с`);
    // 1.20.1: какие мониторы видит видеокарта и какой взят — если друзья видят не тот экран, причина будет здесь
    if (this.info.pick) log.info('screen', `Мониторы у видеокарты: ${this.info.outs || 'не перечислились'} · снимаю выход ${this.info.out} — ${this.info.pick}`);
  }

  // новый экран или другие кадры/с — тот же показ, помощник заново (зрители получат ключевой кадр и смотрят дальше)
  async restart({ fps, output, source }) {
    const old = this.id;
    this.id = null; this.lostAt = 0;
    await api.videoCap.stop(old);
    if (fps) this.fps = fps;
    if (output != null) this.output = output;
    if (source) this.source = source;
    await this.launch();
  }

  onMsg(m) {
    if (!m || m.id !== this.id) return;
    if (m.type === 'json') {
      const d = m.data || {};
      if (d.ready && d.re) this.resumed(d);
      else if (d.ready && this.waitReady) this.waitReady.resolve(d);
      if (d.lost) this.lost(d);
      if (d.st) this.st = d;
    } else if (m.type === 'exit') {
      const why = m.error || (m.code == null || m.code > 255 ? 'помощник неожиданно закрылся' : `помощник закрылся (код ${m.code})`);
      if (this.waitReady) { this.waitReady.reject(new Error(why)); return; }
      if (!this.stopped) this.onExit && this.onExit(why, { lost: !!this.lostAt });
    }
  }

  // 1.19.3: Windows забрала экран — помощник сам запускает захват и сжатие заново (сдаётся через 30 с);
  // зрители это время видят последний кадр
  lost(d) {
    this.lostAt = Date.now(); this.losses++; this.st = null;
    log.warn('screen', 'Захват видеокартой прервался: Windows забрала экран — запускаю захват заново, зрители пока видят последний кадр', { hint: LOST_HINT, details: d.why });
  }
  resumed(d) {
    const sec = (this.lostAt ? Date.now() - this.lostAt : d.ms || 0) / 1000;
    const resized = !!this.info && (this.info.w !== d.w || this.info.h !== d.h);
    this.lostAt = 0; this.info = d; this.kbps = d.kbps || this.kbps;
    log.info('screen', `Захват видеокартой восстановлен через ${sec.toFixed(1).replace('.', ',')} с — показ продолжается (${d.w}×${d.h}${resized ? ', размер экрана изменился' : ''})`);
    if (this.onResume) this.onResume({ resized });
  }

  onAu(id, buf) {
    if (id !== this.id || this.stopped) return;
    const key = (buf[0] & 1) === 1;
    const au = buf.slice(9).buffer; // своя копия кадра (без флагов и времени)
    this.worker.postMessage({ au, key }, [au]); // сначала кадр — потом пустышка, чтобы он уже ждал в очереди
    let ts = Math.round(performance.now() * 1000);
    if (ts <= this.lastTs) ts = this.lastTs + 1; // время кадров только растёт (WebRTC выкидывает «старые»)
    this.lastTs = ts;
    try { this.writer.write(new VideoFrame(PX, { format: 'RGBA', codedWidth: 16, codedHeight: 16, timestamp: ts })).catch(() => {}); } catch (_) { /* дорожка уже закрыта */ }
  }

  // 1.20.1: целый кадр уходит всем зрителям сразу (сжатие одно), поэтому не чаще раза в секунду: просьбы, пришедшие
  // в эту секунду, склеиваются в один целый кадр в её конце (при малой скорости каждый целый кадр — волна квадратов у всех)
  idr(why) {
    if (!this.id || this.stopped) return;
    const wait = this.lastIdr + IDR_GAP_MS - Date.now();
    if (wait > 0) {
      if (!this.idrTimer) this.idrTimer = setTimeout(() => { this.idrTimer = 0; this.idr(`${why}, отложен`); }, wait);
      return;
    }
    this.lastIdr = Date.now(); this.idrs++;
    log.debug('screen', `Захват видеокартой: целый кадр (${why})`);
    api.videoCap.cmd(this.id, 'idr');
  }

  // отправка демки (зрителю напрямую или на сервер): её сжатые пустышки подменяются кадрами помощника
  attach(sender, label) {
    if (!sender || this.stopped) return;
    if (this.outs.has(sender)) return;
    const id = this.nextOut++;
    this.outs.set(sender, { id, label, at: Date.now(), server: label === 'сервер' });
    sender.transform = new RTCRtpScriptTransform(this.worker, { side: 'send', id });
    // 1.20.1: напрямую смотрят двое и больше — сжатие одно, и скорость у всех равняется на самого медленного
    const direct = [...this.outs.values()].filter((o) => !o.server).length;
    if (direct >= 2 && this.onMany) this.onMany(direct);
    // первый целый кадр уходит ещё до того, как соединение со зрителем договорилось, — и теряется, а сам зритель
    // его не просит (проверено: без этого картинка появлялась только через 10 с, с очередным ключевым кадром).
    // Поэтому в первые секунды — ещё три целых кадра
    for (const ms of [1000, 2500, 5000]) setTimeout(() => { if (this.outs.has(sender)) this.idr(`новый зритель (${label})`); }, ms);
  }
  detach(sender) {
    const o = sender && this.outs.get(sender);
    if (!o) return;
    this.outs.delete(sender);
    try { sender.transform = null; } catch (_) { /* отправка уже закрыта */ }
    this.worker.postMessage({ drop: o.id });
  }

  // скорость под сеть: самая медленная отправка задаёт скорость всем (один поток на всех, как в Discord)
  async rate() {
    if (!this.id || this.stopped) return;
    let est = Infinity;
    for (const [sender, o] of [...this.outs]) {
      // отправку закрыли (1.20.3: и соединение со зрителем закрыто — дорожка у отправки при этом остаётся)
      if (!sender.track || (sender.transport && sender.transport.state === 'closed')) { this.outs.delete(sender); this.worker.postMessage({ drop: o.id }); continue; }
      // 1.20.1: у только что пришедшего зрителя оценка канала ещё разгоняется с ~4 Мбит/с — не роняем по ней скорость всем
      if (Date.now() - o.at < NEW_VIEWER_MS) continue;
      const r = await sender.getStats().catch(() => null);
      if (!r) continue;
      let pair = null;
      r.forEach((x) => { if (x.type === 'transport' && x.selectedCandidatePairId) pair = r.get(x.selectedCandidatePairId) || pair; });
      if (!pair) r.forEach((x) => { if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded') pair = x; });
      if (pair && pair.availableOutgoingBitrate > 0) est = Math.min(est, pair.availableOutgoingBitrate / 1000);
    }
    const cap = Math.max(MIN_KBPS, Math.round(this.capKbps()));
    if (!Number.isFinite(est)) { if (this.kbps > cap) this.setKbps(cap, 'потолок'); return; } // зрителей нет — только потолок
    const want = Math.max(MIN_KBPS, Math.min(cap, Math.round(est * 0.85)));
    const now = Date.now();
    // вниз — сразу, как сеть не тянет; вверх — не чаще раза в 5 с и не больше чем вдвое за раз
    // (1.20.1; было 10 с и ×1,5). У NVIDIA скорость меняется на ходу, у AMD — новое сжатие с целого кадра
    if (want < this.kbps * 0.85 && now - this.lastRate > 2000) this.setKbps(want, `оценка канала ${Math.round(est / 100) / 10} Мбит/с`);
    else if (want > this.kbps * 1.25 && now - this.lastUp > UP_MS && now - this.lastRate > 4000) { this.setKbps(Math.min(want, Math.round(this.kbps * 2)), `оценка канала ${Math.round(est / 100) / 10} Мбит/с`); this.lastUp = now; }
  }
  setKbps(k, why) {
    if (k === this.kbps) return;
    log.debug('screen', `Захват видеокартой: скорость ${Math.round(this.kbps / 100) / 10} → ${Math.round(k / 100) / 10} Мбит/с (${why})`);
    this.kbps = k; this.lastRate = Date.now();
    api.videoCap.cmd(this.id, `kbps ${k}`);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.rateTimer); clearTimeout(this.idrTimer);
    for (const s of [...this.outs.keys()]) this.detach(s);
    if (this.id) api.videoCap.stop(this.id);
    this.id = null;
    if (this.offAu) this.offAu();
    if (this.offMsg) this.offMsg();
    try { this.writer.close().catch(() => {}); } catch (_) { /* ignore */ }
    try { this.gen.stop(); } catch (_) { /* ignore */ }
    if (this.worker) this.worker.terminate();
  }
}

export function encName(enc) {
  return enc === 'h264_nvenc' ? 'NVIDIA (NVENC, H.264)' : enc === 'h264_amf' ? 'AMD (AMF, H.264)' : enc || '?';
}
