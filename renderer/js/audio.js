// Звук: микрофон (шумоподавление, усиление, голосовая активация / рация) и микшер входящих голосов.
import { log, explain } from './log.js';
import { settings } from './settings.js';
import { RnnoiseWorkletNode, loadRnnoise } from '../vendor/nsx/index.js';
import { VadGate, levelStep } from './vad.js';

const NSX = '/vendor/nsx/';
const DFN = '/vendor/dfn/';
const wasmCache = {};
const NOISE_RU = { off: 'выкл', browser: 'простое', rnnoise: 'лёгкое (RNNoise)', dfn: 'лучшее (DeepFilterNet3)' };
// Сила подавления DeepFilterNet3: сколько дБ можно убрать во время речи и в паузах
export const STRENGTH = {
  soft: { speech: 15, pause: 35 },
  normal: { speech: 25, pause: 45 },
  strong: { speech: 40, pause: 70 },
};

// Ворклет грузим через blob: — addModule() по собственному протоколу app:// в Electron может зависнуть.
const workletUrls = {};
async function addWorklet(ctx, file) {
  if (!workletUrls[file]) {
    const r = await fetch(NSX + file);
    if (!r.ok) throw new Error(`Файл ${file} не найден (${r.status})`);
    workletUrls[file] = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
  }
  await ctx.audioWorklet.addModule(workletUrls[file]);
}

// как withTimeout, но если обещание всё-таки выполнится позже — освобождаем результат (шумодав)
function lateSafe(p, ms, msg) {
  return withTimeout(p, ms, msg).catch((e) => { p.then((d) => { if (d && d.destroy) d.destroy(); }).catch(() => {}); throw e; });
}
function withTimeout(promise, ms, msg) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

let dfnModuleUrl = null;
async function createDenoiser(ctx, kind, s, onOverload) {
  if (kind === 'rnnoise') {
    wasmCache.rnnoise ||= await loadRnnoise({ url: NSX + 'rnnoise.wasm', simdUrl: NSX + 'rnnoise_simd.wasm' });
    await addWorklet(ctx, 'rnnoise/workletProcessor.js');
    const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasmCache.rnnoise });
    return { node, destroy: () => node.destroy() };
  }
  if (kind === 'dfn') {
    const { createDeepFilterNetAudioWorklet } = await import('../vendor/dfn/deepfilternet.js');
    if (!dfnModuleUrl) {
      const r = await fetch(DFN + 'assets/deepfilternet-worklet-processor.js');
      if (!r.ok) throw new Error(`Файл шумоподавления не найден (${r.status})`);
      dfnModuleUrl = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
    }
    const st = STRENGTH[s.noiseStrength] || STRENGTH.normal;
    const h = await createDeepFilterNetAudioWorklet(ctx, {
      moduleUrl: dfnModuleUrl,
      wasmUrl: DFN + 'assets/deepfilternet/df_bg.wasm',
      modelUrl: DFN + 'assets/deepfilternet/DeepFilterNet3_onnx.tar.gz',
      speechAttenuationDb: st.speech,
      pauseAttenuationDb: st.pause,
      minSpeechFrames: s.keyboardFilter ? 2 : 1,
      postGain: false, // громкость выравнивает сама программа (Mic.levelTick) — одинаково при любом шумоподавлении
      bypassUntilReady: true,
      onOverload,
      onLoadReport: (r) => log.info('mic', `Лучшее шумоподавление работает: нагрузка ${Math.round(r.medianLoad * 100)}% одного ядра (пик ${Math.round(r.maxLoad * 100)}%)`),
      loadReportAfterMs: 20000,
    });
    await h.ready;
    return { node: h.node, destroy: () => h.dispose() };
  }
  return null;
}

// AudioContext.resume() может «зависнуть», если звуковое устройство не отвечает — не ждём бесконечно.
async function resumeCtx(ctx, what) {
  if (ctx.state === 'running') return;
  const ok = await Promise.race([ctx.resume().then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 1500))]);
  if (!ok || ctx.state !== 'running') log.warn('audio', `${what}: звуковое устройство не отвечает (состояние ${ctx.state})`, { hint: 'Проверьте, что в Windows выбрано устройство воспроизведения/записи по умолчанию и оно не отключено. Переподключите наушники.' });
}

// голос идёт с задержкой 0,05 с, чтобы микрофон успевал открыться до начала слова (на слух незаметно)
export const PREROLL_S = 0.05;
function peakOf(buf) { let p = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; } return p; }

function rmsDb(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

// ===================== Микрофон =====================
export class Mic {
  constructor() {
    this.ctx = null; this.raw = null; this.stream = null; this.track = null;
    this.level = -100; this.speaking = false; this.open = false;
    this.muted = false; this.pttDown = false; this.pttReleasedAt = 0; this.lastLoud = 0;
    this.listeners = new Set();
    this.timer = null; this.startPromise = null; this.monitorEl = null;
    this.deviceLabel = '';
  }

  on(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit(ev) { for (const l of this.listeners) l(ev); }
  get running() { return !!this.track; }

  // Запуск (или перезапуск) с текущими настройками. Возвращает новую дорожку для отправки.
  // Запуски идут строго по очереди; если пока шёл запуск, его опередил новый запуск или остановка,
  // он сам закрывает всё, что успел открыть (микрофон, звуковой контекст, шумодав), и ничего не включает.
  start() {
    const gen = this.gen = (this.gen || 0) + 1;
    const op = this.op = (this.op || Promise.resolve()).catch(() => {}).then(() => (gen === this.gen ? this.run(gen) : null));
    this.startPromise = op;
    return op.then((t) => {
      if (t || gen === this.gen) return t;
      return this.op !== op ? this.op : null; // нас опередил более новый запуск — отдаём его дорожку
    }, (e) => {
      if (e && e.superseded) return this.op !== op ? this.op : null;
      const x = explain(e, 'mic');
      log.error('mic', x.msg, { err: e, hint: x.hint });
      this.emit({ type: 'error', error: e, ...x });
      throw e;
    });
  }

  async run(gen) {
    let raw = null; let ctx = null; let denoiser = null;
    const dropMine = () => { if (raw) raw.getTracks().forEach((t) => t.stop()); if (denoiser && denoiser.destroy) { try { denoiser.destroy(); } catch (_) { /* ignore */ } } if (ctx) ctx.close().catch(() => {}); raw = null; ctx = null; denoiser = null; };
    const check = () => { if (gen !== this.gen) { dropMine(); const e = new Error('superseded'); e.superseded = true; throw e; } };
    // настоящая ошибка посреди запуска — закрываем то, что успели открыть (иначе микрофон остаётся занят)
    try {
      await this.teardown(true);
      check();
      const s = settings;
      const audio = {
        echoCancellation: s.echoCancellation, noiseSuppression: s.noise === 'browser',
        // громкость выравниваем сами, уже после шумоподавления (иначе вместе с голосом усиливается шум)
        autoGainControl: false, channelCount: 1,
      };
      if (s.inputDevice && s.inputDevice !== 'default') audio.deviceId = { exact: s.inputDevice };
      // микрофон, открывшийся уже после тайм-аута, тоже закрываем — иначе он остался бы занят
      const gum = (a) => { const p = navigator.mediaDevices.getUserMedia({ audio: a }); return withTimeout(p, 12000, 'Микрофон не ответил за 12 секунд').catch((e) => { p.then((st) => st.getTracks().forEach((t) => t.stop())).catch(() => {}); throw e; }); };
      try {
        raw = await gum(audio);
      } catch (e) {
        if (audio.deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
          check();
          const x = explain(e, 'mic');
          log.warn('mic', x.msg, { hint: x.hint });
          delete audio.deviceId;
          raw = await gum(audio);
        } else throw e;
      }
      check();
      const rawTrack = raw.getAudioTracks()[0];
      this.deviceLabel = rawTrack.label;
      rawTrack.addEventListener('ended', () => {
        if (!this.raw || this.raw.getAudioTracks()[0] !== rawTrack) return;
        log.warn('mic', `Микрофон «${rawTrack.label}» отключился`, { hint: 'Проверьте провод/USB. Пробую переключиться на микрофон по умолчанию…' });
        this.emit({ type: 'lost' });
      });

      ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await resumeCtx(ctx, 'Микрофон');
      check();
      const src = ctx.createMediaStreamSource(raw);
      let node = src;
      if (s.highpass) {
        // срезаем гул ниже 80 Гц: стук по столу, вибрацию, гул вентилятора
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = 0.707;
        node.connect(hp); node = hp;
      }
      let noiseUsed = s.noise;
      if (s.noise === 'rnnoise' || s.noise === 'dfn') {
        const t0 = performance.now();
        try {
          const dn = await lateSafe(createDenoiser(ctx, s.noise, s, (load) => this.emit({ type: 'overload', load })), 15000, 'шумоподавление не загрузилось за 15 секунд');
          denoiser = dn; check();
          node.connect(dn.node); node = dn.node;
          log.debug('mic', `Шумоподавление загружено за ${Math.round(performance.now() - t0)} мс`);
        } catch (e) {
          if (e.superseded) throw e; // запуск отменён — это не ошибка шумодава
          if (denoiser && denoiser.destroy) { try { denoiser.destroy(); } catch (_) { /* ignore */ } } denoiser = null;
          if (s.noise === 'dfn') {
            log.warn('mic', 'Лучшее шумоподавление не запустилось — включаю лёгкое', { err: e, hint: 'Если повторяется, выберите «Лёгкое» в настройках микрофона и пришлите журнал.' });
            try {
              const dn = await lateSafe(createDenoiser(ctx, 'rnnoise', s), 8000, 'лёгкое шумоподавление не загрузилось');
              denoiser = dn; check();
              node.connect(dn.node); node = dn.node; noiseUsed = 'rnnoise';
            } catch (e2) {
              if (e2.superseded) throw e2;
              if (denoiser && denoiser.destroy) { try { denoiser.destroy(); } catch (_) { /* ignore */ } } denoiser = null;
              noiseUsed = 'off';
              log.error('mic', 'Шумоподавление не работает — голос идёт без него', { err: e2, hint: 'Выберите «Простое» шумоподавление в настройках микрофона и пришлите журнал.' });
            }
          } else {
            noiseUsed = 'off';
            log.error('mic', `Не удалось включить шумоподавление ${NOISE_RU[s.noise]} — голос идёт без него`, { err: e, hint: 'Выберите «Простое» шумоподавление в настройках микрофона. Если ошибка повторяется — пришлите журнал.' });
          }
        }
      }
      check();
      // дальше ожиданий нет — всё, что открыли, становится «текущим» разом
      this.raw = raw; this.ctx = ctx; this.denoiser = denoiser;
      this.noiseUsed = noiseUsed;
      this.gain = ctx.createGain(); this.gain.gain.value = s.inputGain / 100;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.buf = new Float32Array(this.analyser.fftSize);
      // ровная громкость: мягко подтягиваем голос к одному уровню (только пока говорят — шум не усиливается)
      this.level2 = ctx.createGain(); this.level2.gain.value = 1; this.agcDb = 0; this.speechDb = null;
      // «запись наперёд»: голос идёт с задержкой PREROLL, а решение «говорит / молчит» принимается без неё —
      // микрофон успевает открыться раньше, чем до ворот дойдёт начало слова
      this.preroll = ctx.createDelay(0.5); this.preroll.delayTime.value = PREROLL_S;
      this.gate = ctx.createGain(); this.gate.gain.value = 0;
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 1;
      node.connect(this.gain); this.gain.connect(this.analyser);
      this.gain.connect(this.level2); this.level2.connect(this.preroll); this.preroll.connect(this.gate); this.gate.connect(dest);
      this.dest = dest; this.musicG = 1; this.hookMusic(); // музыка для всех — мимо «ворот» (music.js)
      this.hookSfx(); // звуки для всех — тоже мимо «ворот» (soundboard.js)
      // отвод для проверки «как слышат друзья» (после обработки, без учёта кнопки/порога)
      this.testDest = ctx.createMediaStreamDestination();
      this.level2.connect(this.testDest);
      this.vad = new VadGate();
      this.stream = dest.stream;
      this.track = dest.stream.getAudioTracks()[0];
      this.timer = setInterval(() => this.tick(), 20);
      if (s.autoGain) log.info('mic', 'Ровная громкость включена: голос подтягивается к одному уровню, шум не усиливается');
      const st = rawTrack.getSettings();
      log.info('mic', `Микрофон: «${rawTrack.label || 'по умолчанию'}» · ${st.sampleRate || '?'} Гц · шумоподавление: ${NOISE_RU[noiseUsed]} · эхоподавление: ${st.echoCancellation ? 'вкл' : 'выкл'} · режим: ${s.mode === 'ptt' ? 'рация' : 'голосовая активация'}`);
      if (s.mode === 'ptt' && !s.pttBinding) log.warn('mic', 'Режим «рация» включён, но клавиша не назначена — вас никто не услышит', { hint: 'Настройки → Микрофон → «Назначить клавишу».' });
      this.emit({ type: 'track', track: this.track });
      return this.track;
    } catch (e) {
      if (!e.superseded) dropMine();
      throw e;
    }
  }

  tick() {
    if (!this.analyser) return;
    const s = settings;
    const db = rmsDb(this.analyser, this.buf);
    this.level = db;
    const now = performance.now();
    this.levelTick(db, peakOf(this.buf), s);
    let open;
    if (this.muted) open = false;
    else if (s.mode === 'ptt') open = this.pttDown || now - this.pttReleasedAt < s.pttReleaseMs;
    else open = this.vad.step(db, now, { auto: s.vadAuto, manual: s.vadThreshold, keyboard: s.keyboardFilter });
    if (open !== this.open) {
      this.open = open;
      this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.004 : 0.03);
    }
    if (this.musicGain) {
      // говорю — музыку у всех приглушаем, замолчал — плавно возвращаем
      const g = open && this.musicDuck ? 0.3 : 1;
      if (g !== this.musicG) { this.musicG = g; this.musicGain.gain.setTargetAtTime(g, this.ctx.currentTime, g < 1 ? 0.04 : 0.35); }
    }
    const speaking = open && db > (this.vad ? this.vad.thr : s.vadThreshold) - 6;
    if (speaking !== this.speaking) { this.speaking = speaking; this.emit({ type: 'speaking', speaking }); }
  }

  // Ровная громкость (раз в 20 мс): расчёт — в vad.js (levelStep), здесь только применяем
  levelTick(db, peak, s) {
    if (!this.level2) return;
    const r = levelStep({ agcDb: this.agcDb, speechDb: this.speechDb }, { db, peak, open: this.open, floor: this.vad ? this.vad.floor : -70, enabled: !!s.autoGain });
    this.speechDb = r.speechDb;
    if (Math.abs(r.agcDb - this.agcDb) > 0.01) {
      this.agcDb = r.agcDb;
      this.level2.gain.setTargetAtTime(10 ** (r.agcDb / 20), this.ctx.currentTime, 0.03);
    }
  }

  setGain(pct) { if (this.gain) this.gain.gain.setTargetAtTime(pct / 100, this.ctx.currentTime, 0.02); }

  // Музыка для всех (music.js): поток плеера подмешивается в голосовую дорожку после «ворот» —
  // друзья слышат её, даже когда микрофон выключен. Перезапуск микрофона подключает её заново.
  setMusic(stream, { duck = true } = {}) { this.musicStream = stream || null; this.musicDuck = !!duck; this.hookMusic(); }
  setMusicDuck(on) { this.musicDuck = !!on; }
  get musicLive() { return !!this.musicGain; }
  hookMusic() {
    for (const n of [this.musicSrc, this.musicGain]) if (n) { try { n.disconnect(); } catch (_) { /* ignore */ } }
    this.musicSrc = null; this.musicGain = null;
    if (!this.musicStream || !this.ctx || !this.dest || this.ctx.state === 'closed') return;
    this.musicSrc = this.ctx.createMediaStreamSource(this.musicStream);
    this.musicGain = this.ctx.createGain(); this.musicG = 1; this.musicGain.gain.value = 1;
    this.musicSrc.connect(this.musicGain); this.musicGain.connect(this.dest);
  }
  // Звуки для всех (soundboard.js, 1.21): так же, как музыка, — после «ворот», слышно и с выключенным микрофоном
  setSfx(stream) { this.sfxStream = stream || null; this.hookSfx(); }
  get sfxLive() { return !!this.sfxSrc; }
  hookSfx() {
    if (this.sfxSrc) { try { this.sfxSrc.disconnect(); } catch (_) { /* ignore */ } }
    this.sfxSrc = null;
    if (!this.sfxStream || !this.ctx || !this.dest || this.ctx.state === 'closed') return;
    this.sfxSrc = this.ctx.createMediaStreamSource(this.sfxStream);
    this.sfxSrc.connect(this.dest);
  }
  setMuted(m) { this.muted = !!m; }
  setPtt(down) {
    if (down === this.pttDown) return;
    this.pttDown = down;
    if (!down) this.pttReleasedAt = performance.now();
  }

  get autoThreshold() { return this.vad ? this.vad.thr : null; }

  // Запись N секунд «до» и «после» обработки — чтобы сравнить на слух
  async recordTest(seconds = 5) {
    if (!this.raw || !this.testDest) throw new Error('Микрофон не запущен');
    const rec = (stream) => new Promise((resolve, reject) => {
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
      const parts = [];
      mr.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      mr.onstop = () => resolve(new Blob(parts, { type: 'audio/webm' }));
      mr.onerror = (e) => reject(e.error || new Error('Ошибка записи'));
      mr.start();
      setTimeout(() => mr.state !== 'inactive' && mr.stop(), seconds * 1000);
    });
    const [before, after] = await Promise.all([rec(this.raw), rec(this.testDest.stream)]);
    return { before, after };
  }

  // Прослушка себя (проверка микрофона)
  async monitor(on, sinkId) {
    if (this.monitorEl) { this.monitorEl.pause(); this.monitorEl.srcObject = null; this.monitorEl = null; }
    if (!on || !this.stream) return;
    const el = new Audio();
    el.srcObject = this.stream;
    if (sinkId && sinkId !== 'default' && el.setSinkId) await el.setSinkId(sinkId).catch(() => {});
    await el.play().catch((e) => log.warn('audio', `Не удалось включить прослушку: ${e.message}`));
    this.monitorEl = el;
  }

  // Остановка отменяет и запуск, который ещё идёт
  async stop(silent) {
    this.gen = (this.gen || 0) + 1;
    await this.teardown(silent);
  }

  async teardown(silent) {
    // сначала забираем текущее и обнуляем поля (без ожиданий), потом закрываем забранное:
    // если пока мы закрываем, успеет запуститься новый микрофон, его поля мы уже не тронем
    clearInterval(this.timer); this.timer = null;
    this.monitor(false);
    const den = this.denoiser; const raw = this.raw; const ctx = this.ctx; const wasSpeaking = this.speaking;
    this.denoiser = null; this.raw = null; this.ctx = null; this.track = null; this.stream = null; this.analyser = null; this.testDest = null; this.vad = null;
    this.level2 = null; this.preroll = null; this.agcDb = 0; this.speechDb = null;
    this.dest = null; this.musicSrc = null; this.musicGain = null; this.sfxSrc = null;
    this.level = -100; this.open = false; this.speaking = false;
    if (den && den.destroy) { try { den.destroy(); } catch (_) { /* ignore */ } }
    if (raw) raw.getTracks().forEach((t) => t.stop());
    if (wasSpeaking) this.emit({ type: 'speaking', speaking: false });
    if (!silent) this.emit({ type: 'track', track: null });
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ===================== Выход: голоса друзей и звук демонстраций =====================
export class Output {
  // Голоса воспроизводятся напрямую через аудио-элементы — это родной путь WebRTC со своим буфером
  // против рывков сети. Web Audio используется только для индикатора речи (беззвучно),
  // для усиления громкости выше 100% и для звуков интерфейса.
  constructor() {
    // 48 кГц явно: у некоторых наушников/ЦАП в Windows стоит 384 кГц — обработка на такой частоте
    // грузит процессор в 8 раз сильнее и может давать заикания.
    this.ctx = new AudioContext({ latencyHint: 'playback', sampleRate: 48000 });
    this.meter = this.ctx.createGain(); this.meter.gain.value = 0; this.meter.connect(this.ctx.destination);
    // «Опора» для вычитания эха из звука трансляции: всё, что программа проигрывает, с той же громкостью
    this.refBus = this.ctx.createGain();
    this.refBus.channelCount = 1; this.refBus.channelCountMode = 'explicit'; this.refBus.channelInterpretation = 'speakers';
    this.sources = new Map();
    this.deafened = false;
    this.volume = 1;
    this.sinkId = '';
    this.missingId = ''; // выбранное устройство вывода, которого сейчас нет (1.20.3)
    this.ctx.onstatechange = () => log.debug('audio', `Аудио-вывод: ${this.ctx.state}`);
  }

  async resume() { await resumeCtx(this.ctx, 'Вывод звука'); }

  async setDevice(id) {
    this.sinkId = id && id !== 'default' ? id : '';
    this.missingId = '';
    try {
      if (this.ctx.setSinkId) await this.ctx.setSinkId(this.sinkId);
      for (const s of this.sources.values()) if (s.el.setSinkId) await s.el.setSinkId(this.sinkId);
      log.info('audio', `Устройство вывода: ${this.sinkId ? this.sinkId.slice(0, 12) + '…' : 'по умолчанию'}`);
    } catch (e) {
      // 1.20.3: выбранных наушников сейчас нет (не включены при запуске) — звук идёт в устройство Windows по умолчанию,
      // а когда они появятся, app.js вернёт звук на них (missingId). Раньше возвращать приходилось перезапуском
      if (e && e.name === 'NotFoundError' && this.sinkId) {
        this.missingId = this.sinkId;
        log.warn('audio', 'Выбранное устройство вывода звука не подключено — звук идёт в устройство Windows по умолчанию', { hint: 'Включите наушники или колонки — звук вернётся на них сам. Или выберите другое устройство в Настройки → Звук.' });
      } else {
        const x = explain(e, 'output');
        log.error('audio', x.msg, { err: e, hint: x.hint });
      }
      this.sinkId = '';
      await this.ctx.setSinkId?.('').catch(() => {});
      for (const s of this.sources.values()) await s.el.setSinkId?.('').catch(() => {});
    }
  }

  apply(s) {
    const eff = this.deafened ? 0 : (s.pct / 100) * this.volume * (s.duck ?? 1);
    if (s.ref) s.ref.gain.setTargetAtTime(eff, this.ctx.currentTime, 0.01);
    if (eff <= 1) {
      if (s.boost) { try { s.boost.disconnect(); } catch (_) { /* ignore */ } s.boost = null; }
      s.el.muted = eff === 0;
      s.el.volume = Math.max(0, Math.min(1, eff));
    } else {
      // громче 100% аудио-элемент не умеет — усиливаем через Web Audio
      s.el.muted = true;
      if (!s.boost) { s.boost = this.ctx.createGain(); s.src.connect(s.boost); s.boost.connect(this.ctx.destination); this.resume(); }
      s.boost.gain.setTargetAtTime(eff, this.ctx.currentTime, 0.02);
    }
  }

  setVolume(pct) { this.volume = pct / 100; for (const s of this.sources.values()) this.apply(s); }
  setDeafened(d) { this.deafened = !!d; for (const s of this.sources.values()) this.apply(s); }

  // key: "voice:Ник" или "screen:Ник"
  add(key, track, volumePct = 100) {
    this.remove(key);
    if (!track || track.kind !== 'audio') return;
    const stream = new MediaStream([track]);
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = stream;
    if (this.sinkId && el.setSinkId) el.setSinkId(this.sinkId).catch((e) => log.warn('audio', `Не удалось вывести звук на выбранное устройство: ${e.message}`));
    const src = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser); analyser.connect(this.meter); // беззвучный отвод для индикатора речи
    const ref = this.ctx.createGain(); ref.gain.value = 0; src.connect(ref); ref.connect(this.refBus);
    const s = { el, src, analyser, ref, buf: new Float32Array(512), track, pct: volumePct, boost: null, key };
    this.sources.set(key, s);
    this.apply(s);
    el.play().catch((e) => log.warn('audio', `Не удалось воспроизвести звук (${key.split(':')[1]}): ${e.message}`));
    this.resume();
    if (!this.loggedInfo) {
      this.loggedInfo = true;
      let deviceRate = 0;
      try { const probe = new AudioContext(); deviceRate = probe.sampleRate; probe.close(); } catch (_) { /* ignore */ }
      log.info('audio', `Вывод звука: устройство ${deviceRate || '?'} Гц, обработка 48000 Гц, задержка ${Math.round((this.ctx.baseLatency || 0) * 1000)} мс`);
      if (deviceRate > 96000) log.warn('audio', `У устройства вывода в Windows стоит ${deviceRate / 1000} кГц — это лишняя нагрузка и частая причина заиканий`, { hint: 'Поставьте 48 кГц: Пуск → «Панель управления звуком» → Воспроизведение → ваши наушники → Свойства → Дополнительно → «24 бит, 48000 Гц» → ОК. Звук станет не хуже: голос и игры всё равно идут в 48 кГц.' });
    }
  }

  // временное приглушение (зритель говорит, а его голос возвращается через трансляцию)
  setDuck(key, g) {
    const s = this.sources.get(key);
    if (s) { s.duck = g; this.apply(s); }
  }

  renameSource(from, to) {
    const s = this.sources.get(from);
    if (!s || from === to) return;
    this.sources.delete(from); s.key = to; this.sources.set(to, s);
  }

  setSourceVolume(key, pct) {
    const s = this.sources.get(key);
    if (s) { s.pct = pct; this.apply(s); }
  }

  level(key) {
    const s = this.sources.get(key);
    if (!s || s.track.readyState !== 'live' || s.track.muted) return -100;
    return rmsDb(s.analyser, s.buf);
  }

  remove(key) {
    const s = this.sources.get(key);
    if (!s) return;
    try { s.src.disconnect(); s.analyser.disconnect(); s.ref.disconnect(); if (s.boost) s.boost.disconnect(); } catch (_) { /* ignore */ }
    s.el.pause(); s.el.srcObject = null;
    this.sources.delete(key);
  }

  // для автотеста: «игра» из другой программы — играет в динамики, но НЕ попадает в опору
  playTestGame() {
    if (this.testGame) return;
    const m = this.ctx.createChannelMerger(2); const g = this.ctx.createGain(); g.gain.value = 0.15;
    for (const [ch, f] of [[0, 440], [1, 660]]) { const o = this.ctx.createOscillator(); o.frequency.value = f; o.connect(m, 0, ch); o.start(); }
    m.connect(g); g.connect(this.ctx.destination); this.testGame = g;
  }

  removePrefix(prefix) { for (const k of [...this.sources.keys()]) if (k.startsWith(prefix)) this.remove(k); }

  // короткие звуки интерфейса
  beep(kind) {
    if (!settings.sounds) return;
    // ноты (Гц), шаг между ними и длина каждой (с), форма волны, громкость
    const S = (notes, step = 0.09, dur = 0.12, type = 'sine', vol = 0.12) => ({ notes, step, dur, type, vol });
    const tones = {
      join: S([523, 784]), leave: S([784, 523]), message: S([880]), mute: S([440, 330]), unmute: S([330, 440]), error: S([220, 180]),
      stream: S([660, 990]),
      // демонстрация: начало — светлое восходящее арпеджио, конец — то же вниз
      'stream-on': S([523, 659, 784, 1047], 0.075, 0.2, 'triangle', 0.13),
      'stream-off': S([1047, 784, 659, 523], 0.075, 0.18, 'triangle', 0.11),
      // зритель зашёл на вашу демку / вышел — короткий «дзынь» повыше, чем вход в комнату
      'viewer-in': S([988, 1319], 0.07, 0.16, 'triangle', 0.1),
      'viewer-out': S([1319, 988], 0.07, 0.12, 'triangle', 0.07),
    };
    const tn = tones[kind]; if (!tn) return;
    const ctx = this.ctx; let t = ctx.currentTime;
    for (const f of tn.notes) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = tn.type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(tn.vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + tn.dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + tn.dur + 0.01); // в опору не идёт: звуки интерфейса играют другим путём, чем голоса, и сбивали бы поиск задержки
      t += tn.step;
    }
  }
}
