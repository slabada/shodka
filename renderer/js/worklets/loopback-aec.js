// Аудио-ворклет «без своих голосов»: вычитает из звука компьютера (loopback) то, что проиграла сама «Сходка»
// (голоса друзей, их трансляции, звуки интерфейса). Нужен там, где Windows не умеет исключать звук программы
// из захвата (Windows 10). Путь «программа → микшер Windows → loopback» цифровой и почти линейный:
// задержка + громкость + пересэмплирование. Поэтому хватает короткого КИХ-фильтра вокруг найденной задержки,
// посчитанного методом наименьших квадратов. Учится только пока звучит опорный сигнал, поэтому постоянная
// игра или музыка (не похожая на голоса друзей) ему не мешает и не искажается.
// Задержка может медленно «плыть» (часы захвата и вывода чуть расходятся) — основной поток оценивает её как
// D(t) = a + b·t, а ворклет выравнивает опору с дробной точностью, так что фильтр видит неподвижное эхо.
// Вход 0 — захват (стерео), вход 1 — опорный сигнал (моно).

const TAPS_DEF = 192; // длина фильтра, отсчётов (4 мс)
const PRE_DEF = 72;   // сколько отсчётов фильтр видит «до» найденной задержки (1.5 мс)
const TAU_DEF = 4;    // память, секунд звучания голосов
const DEC = 4;        // прореживание для оценки задержки (48 → 12 кГц)
const POST = 4096;    // отправлять в основной поток каждые 4096 прореженных отсчётов (~0.34 с)

class LoopbackAec extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const L = o.taps || TAPS_DEF;
    this.L = L; this.PRE = o.pre ?? PRE_DEF; this.lambda = Math.exp(-1 / ((o.tau || TAU_DEF) * sampleRate));
    this.M = (1 << 16) - 1;
    this.hist = new Float32Array(this.M + 1);   // опора как есть
    this.al = new Float32Array(this.M + 1);     // опора, выровненная под эхо
    this.cap = [new Float32Array(this.M + 1), new Float32Array(this.M + 1)]; // линия задержки захвата
    this.fr = 0;                                 // номер отсчёта с начала
    this.a = 0; this.b = 0; this.capPre = 0;    // D(fr) = a + b·fr (a может быть и отрицательным: это значение при fr = 0)
    this.locked = false;                         // задержка уже найдена
    this.h = [new Float64Array(L), new Float64Array(L)];
    this.p = [new Float64Array(L), new Float64Array(L)];
    this.r = new Float64Array(L);
    this.po = new Float64Array(L); // что от голосов осталось на выходе (для честной оценки, сколько убрано)
    this.learned = 0; this.since = 0; this.enabled = true;
    this.dx = new Float32Array(POST); this.dy = new Float32Array(POST); this.dn = 0; this.acc = 0; this.ax = 0; this.ay = 0;
    this.statIn = 0; this.statOut = 0; this.statT = 0;
    this.yd = [new Float32Array(128), new Float32Array(128)];
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'delay') this.setDelay(m);
      else if (m.type === 'enabled') this.enabled = !!m.enabled;
    };
  }

  setDelay({ a, b, capPre, reset, jump }) {
    if (jump && this.locked && capPre === this.capPre) { this.a = a; this.b = b; return; } // скачок: фильтр тот же, сдвигаем только выравнивание
    if (reset || !this.locked || capPre !== this.capPre) {
      for (const x of this.p) x.fill(0);
      for (const x of this.h) x.fill(0);
      this.r.fill(0); this.po.fill(0); this.learned = 0;
      this.a = a; this.b = b; this.capPre = capPre; this.locked = true;
      return;
    }
    // Уточнение: наклон (уход часов) берём новый, а текущую задержку не дёргаем — небольшую
    // постоянную ошибку фильтр (128 отсчётов вокруг задержки) поглощает сам. Если ошибка выросла,
    // сдвигаем выравнивание на целое число отсчётов и так же сдвигаем фильтр — без переобучения.
    const cur = this.a + this.b * this.fr;
    // наклон заметно поменялся (впервые узнали про уход часов) — накопленное снято при другом выравнивании,
    // начинаем копить заново, а текущий фильтр оставляем работать, пока не посчитается новый
    if (Math.abs(b - this.b) > 2e-5) { for (const x of this.p) x.fill(0); this.r.fill(0); this.po.fill(0); this.learned = 0; }
    this.b = b; this.a = cur - b * this.fr;
    const err = (a + b * this.fr) - cur;
    if (Math.abs(err) > 12) {
      const shift = Math.round(err);
      this.a += shift;
      if (Math.abs(shift) <= this.L / 4) {
        for (const x of [...this.h, ...this.p, this.po]) {
          const c = Float64Array.from(x);
          for (let k = 0; k < x.length; k++) { const j = k + shift; x[k] = j >= 0 && j < x.length ? c[j] : 0; }
        }
      } else { for (const x of [...this.h, ...this.p]) x.fill(0); this.r.fill(0); this.po.fill(0); this.learned = 0; }
    }
  }

  solve() {
    const r = this.r;
    if (r[0] <= 0) return;
    for (let c = 0; c < 2; c++) {
      const h = levinson(r, this.p[c], r[0] * 1e-3);
      if (!h) continue;
      let s = 0; for (let k = 0; k < h.length; k++) s += Math.abs(h[k]);
      if (s < 8) this.h[c].set(h); // эхо не бывает громче оригинала в разы — такое решение выбрасываем
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const capIn = inputs[0];
    const n = out[0].length;
    const refIn = inputs[1] && inputs[1][0];
    const M = this.M, hist = this.hist, al = this.al, L = this.L, fr = this.fr;
    const y0 = capIn[0] || new Float32Array(n);
    const y1 = capIn[1] || y0;
    // опора и прореживание для оценки задержки
    for (let i = 0; i < n; i++) {
      const x = refIn ? refIn[i] : 0;
      hist[(fr + i) & M] = x;
      this.ax += x; this.ay += (y0[i] + y1[i]) * 0.5;
      if (++this.acc === DEC) {
        this.dx[this.dn] = this.ax / DEC; this.dy[this.dn] = this.ay / DEC; this.acc = 0; this.ax = 0; this.ay = 0;
        if (++this.dn === POST) {
          if (this.enabled) { // на паузе данные для поиска задержки не нужны
            this.port.postMessage({ type: 'data', x: this.dx, y: this.dy, t: fr + i + 1 }, [this.dx.buffer, this.dy.buffer]);
            this.dx = new Float32Array(POST); this.dy = new Float32Array(POST);
          }
          this.dn = 0;
        }
      }
    }
    // захват (с задержкой, если эхо приходит раньше опоры)
    const cp = this.capPre;
    if (this.yd[0].length !== n) this.yd = [new Float32Array(n), new Float32Array(n)];
    const yd = this.yd; const ys = [y0, y1];
    for (let c = 0; c < 2; c++) {
      const line = this.cap[c];
      for (let i = 0; i < n; i++) { line[(fr + i) & M] = ys[c][i]; yd[c][i] = line[(fr + i - cp) & M]; }
    }
    if (!this.locked || !this.enabled) {
      for (let c = 0; c < out.length; c++) out[c].set(yd[Math.min(c, 1)]);
      this.fr += n;
      return true;
    }
    // выровненная опора: al[t] = x(t − D(t) + PRE), кубическая интерполяция
    const PRE = this.PRE;
    let be = 0;
    for (let i = 0; i < n; i++) {
      const t = fr + i; const pos = t - (this.a + this.b * t) + PRE;
      const k = Math.floor(pos), f = pos - k;
      const xm = hist[(k - 1) & M], x0 = hist[k & M], x1 = hist[(k + 1) & M], x2 = hist[(k + 2) & M];
      const v = x0 + 0.5 * f * (x1 - xm + f * (2 * xm - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm)));
      al[t & M] = v; be += v * v;
    }
    const learn = be / n > 1e-7;
    const lam = this.lambda, r = this.r;
    for (let i = 0; i < n; i++) {
      const t = fr + i;
      if (learn) { const x0 = al[t & M]; for (let k = 0; k < L; k++) r[k] = lam * r[k] + x0 * al[(t - k) & M]; }
      for (let c = 0; c < 2; c++) {
        const yc = yd[c][i]; const h = this.h[c]; const p = this.p[c];
        let e = 0;
        if (learn) for (let k = 0; k < L; k++) { const xv = al[(t - k) & M]; e += h[k] * xv; p[k] = lam * p[k] + yc * xv; }
        else for (let k = 0; k < L; k++) e += h[k] * al[(t - k) & M];
        const o = yc - e;
        if (c < out.length) out[c][i] = o;
        if (learn && c === 0) { const po = this.po; for (let k = 0; k < L; k++) po[k] = lam * po[k] + o * al[(t - k) & M]; }
        if (learn) { this.statIn += yc * yc; this.statOut += o * o; }
      }
    }
    if (out.length > 2) for (let c = 2; c < out.length; c++) out[c].set(out[1]);
    this.fr += n;
    if (learn) this.learned += n;
    this.since += n;
    const every = this.learned < sampleRate * 3 ? sampleRate / 10 : sampleRate / 4; // поначалу пересчитываем чаще
    if (this.since >= every) { this.since = 0; if (this.learned > sampleRate / 4) this.solve(); }
    this.statT += n;
    if (this.statT >= sampleRate * 2) {
      // эхо до и после: hᵀRh и то же для остатка (фильтр по выходу) — не зависит от игры и музыки
      let echo = 0, rest = 0;
      if (this.learned > sampleRate && this.r[0] > 0) {
        const hr = levinson(this.r, this.po, this.r[0] * 1e-3);
        echo = quad(this.h[0], this.r); rest = hr ? quad(hr, this.r) : 0;
      }
      this.port.postMessage({ type: 'stats', learned: this.learned / sampleRate, inE: this.statIn, outE: this.statOut, echo, rest, r0: this.r[0] });
      // предохранитель: вычитание сделало звук громче — фильтр сбился, учимся заново
      if (this.statIn > 0 && this.statOut > this.statIn * 1.25) { for (const x of [...this.h, ...this.p]) x.fill(0); this.r.fill(0); this.po.fill(0); this.learned = 0; }
      this.statT = 0; this.statIn = 0; this.statOut = 0;
    }
    return true;
  }
}

function quad(h, r) {
  const n = h.length; let s = 0;
  for (let i = 0; i < n; i++) { let a = r[0] * h[i]; for (let j = i + 1; j < n; j++) a += 2 * r[j - i] * h[j]; s += h[i] * a; }
  return s;
}

// Тёплицева система R·h = p (Левинсон)
function levinson(r, b, reg) {
  const n = b.length; const R = Float64Array.from(r); R[0] += reg;
  const f = new Float64Array(n), x = new Float64Array(n), bf = new Float64Array(n), nf = new Float64Array(n);
  f[0] = 1 / R[0]; x[0] = b[0] / R[0];
  for (let k = 1; k < n; k++) {
    let ef = 0; for (let i = 0; i < k; i++) ef += R[k - i] * f[i];
    const den = 1 - ef * ef; if (den <= 1e-12) return null;
    for (let i = 0; i <= k; i++) nf[i] = (f[i] - ef * (i === 0 ? 0 : f[k - i])) / den;
    for (let i = 0; i <= k; i++) { f[i] = nf[i]; bf[i] = nf[k - i]; }
    let ex = 0; for (let i = 0; i < k; i++) ex += R[k - i] * x[i];
    const a = b[k] - ex;
    for (let i = 0; i <= k; i++) x[i] += a * bf[i];
  }
  return x;
}

registerProcessor('skh-loopback-aec', LoopbackAec);
