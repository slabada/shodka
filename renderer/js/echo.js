// «Без своих голосов» в звуке трансляции.
// В Windows 10 захват звука компьютера (loopback) слышит всё, что играет «Сходка», — в том числе голоса друзей,
// и они слышат сами себя в трансляции. Здесь звук трансляции пропускается через ворклет loopback-aec.js,
// который вычитает то, что проиграла программа. Задержку эха ищем тут (GCC-PHAT), чтобы не грузить аудиопоток.
import { log } from './log.js';

const DEC_SR = 12000;           // частота прореженных данных из ворклета

// win — окно (отсчёты 12 кГц): 16384 ≈ 1.4 с — быстро замечает скачки задержки;
// maxLag / maxLead — сколько эхо может отставать от опоры / опережать её, секунд
export class DelayEstimator {
  constructor({ win = 16384, maxLag = 0.6, maxLead = 0.15, power = 0.85, bands = false } = {}) {
    const WIN = win; this.WIN = win; this.maxLag = maxLag; this.maxLead = maxLead; this.power = power; this.bands = bands;
    if (bands) { this.cr = new Float64Array(WIN * 2); this.ci = new Float64Array(WIN * 2); this.xx = new Float64Array(WIN * 2); this.yy = new Float64Array(WIN * 2); }
    this.x = new Float32Array(WIN); this.y = new Float32Array(WIN); this.pos = 0; this.filled = 0;
    this.N = WIN * 2;
    this.re = new Float64Array(this.N); this.im = new Float64Array(this.N); this.re2 = new Float64Array(this.N); this.im2 = new Float64Array(this.N);
  }

  push(x, y) {
    const WIN = this.WIN;
    for (let i = 0; i < x.length; i++) { this.x[this.pos] = x[i]; this.y[this.pos] = y[i]; this.pos = (this.pos + 1) % WIN; }
    this.filled = Math.min(WIN, this.filled + x.length);
  }

  // во сколько раз «эхо» тише сигнала x на найденной задержке (обычная корреляция, не PHAT)
  gainAt(lag12, span = 6) {
    const W = this.WIN, x = this.x, y = this.y, p = this.pos;
    let ex = 0; for (let i = 0; i < W; i++) { const v = x[i]; ex += v * v; }
    if (ex <= 0) return 0;
    let best = 0;
    for (let l = lag12 - span; l <= lag12 + span; l++) {
      let c = 0;
      for (let i = Math.max(0, -l); i < W && i + l < W; i++) c += x[(p + i) % W] * y[(p + i + l) % W];
      best = Math.max(best, Math.abs(c));
    }
    return best / ex;
  }

  // { lag12 (в отсчётах 12 кГц, >0 — эхо отстаёт), lag (дробный), confidence, back (насколько отсчётов назад от конца окна звучали голоса) } или null
  estimate() {
    const WIN = this.WIN;
    if (this.filled < WIN) return null;
    let ex = 0, ew = 0;
    for (let i = 0; i < WIN; i++) { const v = this.x[(this.pos + i) % WIN]; ex += v * v; ew += i * v * v; }
    if (ex / WIN < 1e-6) return null; // друзья молчали — оценивать не по чему
    const center = ew / ex; // где в окне звучали голоса (отсчёты 12 кГц от начала окна)
    const { re, im, re2, im2, N } = this;
    re.fill(0); im.fill(0); re2.fill(0); im2.fill(0);
    for (let i = 0; i < WIN; i++) { const k = (this.pos + i) % WIN; re[i] = this.x[k]; re2[i] = this.y[k]; }
    fft(re, im, false); fft(re2, im2, false);
    for (let k = 0; k < N; k++) {
      const a = re2[k] * re[k] + im2[k] * im[k]; const b = im2[k] * re[k] - re2[k] * im[k];
      if (this.bands) { this.cr[k] = a; this.ci[k] = b; this.xx[k] = re[k] * re[k] + im[k] * im[k]; this.yy[k] = re2[k] * re2[k] + im2[k] * im2[k]; }
      const m = Math.pow(Math.hypot(a, b) + 1e-12, this.power); re[k] = a / m; im[k] = b / m; // почти PHAT: устойчивее под громкой игрой
    }
    fft(re, im, true);
    const maxLag = Math.floor(this.maxLag * DEC_SR); const maxLead = Math.floor(this.maxLead * DEC_SR);
    let best = -Infinity, bl = 0, sum = 0, cnt = 0;
    for (let l = -maxLead; l <= maxLag; l++) {
      const v = re[(l + N) % N]; sum += Math.abs(v); cnt++;
      if (v > best) { best = v; bl = l; }
    }
    if (bl <= -maxLead + 1 || bl >= maxLag - 1) return null; // пик на краю диапазона — это не эхо
    // дробная часть пика (парабола по соседям)
    const vm = re[(bl - 1 + N) % N], vp = re[(bl + 1) % N]; const den = vm - 2 * best + vp;
    const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (vm - vp) / den)) : 0;
    const out = { lag12: bl, lag: bl + frac, confidence: best / (sum / cnt), back: WIN - center };
    if (this.bands) out.gain = this.bandGain(bl + frac);
    return out;
  }

  // Громкость «эха» относительно x по полосам частот (медиана): одна нота или тон в игре не сбивает оценку.
  // Берём вещественную часть взаимного спектра, повёрнутого на найденную задержку, — случайное совпадение
  // даёт ноль в среднем, а не положительную добавку.
  bandGain(lag) {
    const N = this.N; const edges = [300, 600, 1000, 1500, 2200, 3000, 4000];
    const g = [];
    for (let j = 0; j + 1 < edges.length; j++) {
      const k0 = Math.ceil(edges[j] * N / DEC_SR), k1 = Math.floor(edges[j + 1] * N / DEC_SR);
      let num = 0, den = 0, var_ = 0;
      for (let k = k0; k < k1; k++) { const th = 2 * Math.PI * k * lag / N; num += this.cr[k] * Math.cos(th) - this.ci[k] * Math.sin(th); den += this.xx[k]; var_ += this.xx[k] * this.yy[k]; }
      // полоса в счёт, только если совпадение далеко за пределами случайного (иначе — «нет эха» в ней)
      if (den > 0) g.push(num > 6 * Math.sqrt(var_ / 2) ? num / den : 0);
    }
    if (!g.length) return 0;
    g.sort((a, b) => a - b);
    const mid = g.length >> 1;
    return Math.max(0, g.length % 2 ? g[mid] : (g[mid - 1] + g[mid]) / 2);
  }
}

// Следит за задержкой эха. Часы захвата и вывода могут чуть расходиться, и задержка медленно «плывёт»
// (в тестах ~0.08 мс в секунду) — поэтому по последним оценкам строится прямая D(t) = a + b·t, и ворклет
// выравнивает опору по ней. Резкий скачок (сбой буфера под нагрузкой) — ворклет просто переставляет
// выравнивание, сохраняя выученный фильтр: форма эха от скачка не меняется.
const KEEP = 48000 * 40;       // помним оценки за 40 с
const JUMP = 48;               // ступенька больше 1 мс — скачок (настоящий уход часов — сотые доли мс в секунду)
export class DelayTracker {
  constructor() { this.est = new DelayEstimator(); this.since = 0; this.prev = null; this.pts = []; this.capPre = null; this.odd = null; this.model = null; }

  // t — номер отсчёта (48 кГц) в конце блока; возвращает модель задержки для ворклета или null
  push(x, y, t) {
    this.est.push(x, y);
    this.since += x.length;
    if (this.since < DEC_SR / 4) return null;
    this.since = 0;
    const r = this.est.estimate();
    if (!r || r.confidence < 8) return null;
    const agree = this.prev !== null && Math.abs(this.prev - r.lag12) <= 12; // ±1 мс
    this.prev = r.lag12;
    if (r.confidence < 30 && !agree) return null;
    const lag = r.lag * 4; const tc = t - r.back * 4;
    this.trace = [...(this.trace || []).slice(-200), [Math.round(tc / 480) / 100, +(lag / 48).toFixed(2), Math.round(r.confidence)]];
    let reset = false, jump = false;
    if (this.model && Math.abs(lag - (this.model.a + this.model.b * tc)) > JUMP) {
      // одна-две странные оценки — ещё не повод; три согласные (±0.25 мс) подряд — скачок
      if (!this.odd || Math.abs(this.odd[0].lag - lag) > 12) { this.odd = [{ lag, tc }]; return null; }
      this.odd.push({ lag, tc });
      if (this.odd.length < 3) return null;
      this.pts = this.odd.slice(0, -1); jump = true;
    }
    this.odd = null;
    this.pts.push({ lag, tc });
    while (this.pts.length && tc - this.pts[0].tc > KEEP) this.pts.shift();
    const first = !this.model;
    // пока точек после скачка мало, уход часов считаем прежним
    this.model = fit(this.pts, this.model ? this.model.b : 0);
    const now = this.model.a + this.model.b * t;
    // эхо раньше опоры (или впритык) — задерживаем захват; запас 10 мс на «уплывание»
    if (this.capPre === null || reset || now + this.capPre < 96 || (this.capPre > 0 && now > 960)) { this.capPre = now < 480 ? Math.round(480 - now) : 0; reset = true; }
    return { a: this.model.a + this.capPre, b: this.model.b, capPre: this.capPre, reset, jump: jump && !reset, delayMs: now / 48, big: first || reset || jump, drift: this.model.b * 1e6 };
  }
}

// прямая по точкам; пока точек мало или они близко — прежний наклон b0 через последние точки
function fit(pts, b0) {
  const n = pts.length; const last = pts[n - 1];
  if (n < 6 || last.tc - pts[0].tc < 48000 * 4) {
    const k = pts.slice(-3); return { a: k.reduce((s, p) => s + p.lag - b0 * p.tc, 0) / k.length, b: b0 };
  }
  let st = 0, sl = 0; for (const p of pts) { st += p.tc; sl += p.lag; } st /= n; sl /= n;
  let num = 0, den = 0; for (const p of pts) { num += (p.tc - st) * (p.lag - sl); den += (p.tc - st) ** 2; }
  const b = Math.max(-1.5e-4, Math.min(1.5e-4, num / den));
  return { a: sl - b * st, b };
}

function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len; const wr = Math.cos(ang), wi = Math.sin(ang); const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

let moduleUrl = null;
export async function loadEchoWorklet(ctx) {
  // если ворклет почему-то не грузится — не держим вызывающего, пусть работает без него
  await Promise.race([loadWorklet(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('ворклет не загрузился за 5 с')), 5000))]);
}
async function loadWorklet(ctx) {
  if (!moduleUrl) {
    const r = await fetch('/js/worklets/loopback-aec.js');
    if (!r.ok) throw new Error(`Файл loopback-aec.js не найден (${r.status})`);
    moduleUrl = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
  }
  await ctx.audioWorklet.addModule(moduleUrl);
}

// Возвращает дорожку звука трансляции без голосов, которые проиграла сама программа
export async function createEchoFreeTrack(output, rawTrack, { onStatus } = {}) {
  const ctx = output.ctx;
  await loadEchoWorklet(ctx); // не загрузился за 5 с — трансляция пойдёт без вычитания
  await output.resume();
  const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
  const node = new AudioWorkletNode(ctx, 'skh-loopback-aec', {
    numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
  });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  src.connect(node, 0, 0);
  output.refBus.connect(node, 0, 1);
  node.connect(dest);
  const tracker = new DelayTracker();
  const state = { delayMs: null, locked: false, erle: null, removedDb: null, drift: 0, stopped: false, lastLog: 0, tracker };
  const status = () => { try { onStatus && onStatus(); } catch (_) { /* ignore */ } };
  let active = true;
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'data') {
      if (!active) return; // никто не слушает — задержку не ищем (самая тяжёлая часть, она в основном потоке)
      const d = tracker.push(m.x, m.y, m.t);
      if (!d) return;
      node.port.postMessage({ type: 'delay', a: d.a, b: d.b, capPre: d.capPre, reset: d.reset, jump: d.jump });
      const first = state.delayMs === null;
      state.delayMs = d.delayMs; state.locked = true;
      state.drift = d.drift;
      if (first || d.big) { log.info('screen', `${first ? 'Нашёл' : 'Обновил'} голоса друзей в звуке компьютера: задержка ${state.delayMs.toFixed(0)} мс — вычитаю их из трансляции`); status(); }
    } else if (m.type === 'stats') {
      if (m.inE > 0 && m.outE > 0) state.erle = 10 * Math.log10(m.inE / m.outE);
      // сколько эха голосов убрано: hᵀRh до и после (игра и музыка на эту цифру не влияют)
      if (m.echo > 0 && m.rest >= 0) state.removedDb = Math.min(60, 10 * Math.log10(m.echo / Math.max(m.rest, m.echo * 1e-6)));
      const now = performance.now();
      if (state.locked && m.learned > 8 && state.removedDb != null && now - state.lastLog > (state.lastLog ? 60000 : 8000)) {
        state.lastLog = now;
        const q = state.removedDb >= 20 ? 'не слышно' : state.removedDb >= 10 ? 'тихо, но слышно' : 'почти не убираются';
        log[state.removedDb >= 10 ? 'info' : 'warn']('screen', `Голоса друзей в трансляции: убрано ${state.removedDb.toFixed(0)} дБ (${q}), задержка ${state.delayMs.toFixed(0)} мс`,
          state.removedDb >= 10 ? undefined : { hint: 'Если у вас в Windows включены «улучшения звука» (Nahimic, Sonic Studio, Dolby, «Тонкомпенсация») — выключите их для устройства вывода: они искажают звук, и голоса не получается вычесть.' });
        status();
      }
    }
  };
  const track = dest.stream.getAudioTracks()[0];
  return {
    track,
    state,
    // пауза, пока звук трансляции выключен или её никто не смотрит: выученный фильтр и найденная задержка
    // сохраняются, после паузы окно поиска задержки набирается заново (~1.5 с)
    setEnabled(on) {
      on = !!on; if (on === active) return;
      active = on;
      if (on) { const s = tracker.est; s.filled = 0; s.pos = 0; tracker.since = 0; tracker.prev = null; tracker.odd = null; }
      node.port.postMessage({ type: 'enabled', enabled: on });
    },
    get active() { return active; },
    stop() {
      if (state.stopped) return;
      state.stopped = true;
      try { src.disconnect(); output.refBus.disconnect(node); node.disconnect(); } catch (_) { /* ignore */ }
      node.port.onmessage = null;
      track.stop();
    },
  };
}
