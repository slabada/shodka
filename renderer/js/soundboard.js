// Звуки для всех (1.21): короткие звуки по кнопке или сочетанию клавиш — закадровый смех, «ба-дум-тсс» и т. п.
// Подмешиваются в голосовую дорожку так же, как «Музыка для всех» (audio.js → Mic.setSfx), — их слышат все
// в комнате, даже у кого «Сходка» старой версии. Клавиши работают и в свёрнутом окне (в игре) — через тот же
// глобальный перехват, что и «рация» (main.js, uiohook). Встроенные звуки не файлы: они синтезируются кодом ниже.
import { log } from './log.js';

const api = window.api;

const SR = 48000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SEC = 30;          // длиннее — это уже музыка, для неё есть «Музыка для всех»
const MAX_AT_ONCE = 4;       // больше разом — каша; самый старый звук уступает место
const AUDIO_RE = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm|weba)$/i;
const MOD_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
function ico(name) {
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('class', 'i');
  const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u);
  return s;
}
const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------- название клавиши для подписи ----------
const KEY_NAMES = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', Space: 'Пробел', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumpadAdd: 'Num +', NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter', Pause: 'Pause', ScrollLock: 'ScrLk', PrintScreen: 'PrtSc',
};
function keyLabel(e) {
  const k = KEY_NAMES[e.code] || e.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'Num $1');
  return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k;
}
// сочетание, которое легко нажать случайно, пока пишешь в чат или играешь
const risky = (b) => !b.ctrl && !b.alt && /^(Key|Digit|Space|Backquote|Minus|Equal|Bracket|Semicolon|Quote|Comma|Period|Slash|Backslash|Enter|Tab)/.test(b.code);

// ===================== встроенные звуки (синтез) =====================
function noiseBuf(c, sec) {
  const b = c.createBuffer(1, Math.max(1, Math.ceil(sec * c.sampleRate)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// огибающая: удар (a → peak, затухание d) или нота (a → peak, держим hold, отпускаем за rel)
function envelope(g, t, { a = 0.005, peak = 0.5, d = 0.3, hold = null, rel = 0.1 }) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (hold == null) { g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return t + a + d; }
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  return t + a + hold + rel;
}
function tone(c, out, t, o) {
  const { type = 'sine', f0, f1 = f0, glide = 0.15, lp = 0, vib = 0, vibRate = 5.5 } = o;
  const osc = c.createOscillator(); osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + glide);
  const g = c.createGain();
  const end = envelope(g, t, o);
  if (vib) {
    const l = c.createOscillator(); l.frequency.value = vibRate;
    const lg = c.createGain(); lg.gain.value = vib;
    l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end + 0.05);
  }
  let node = osc;
  if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; osc.connect(f); node = f; }
  node.connect(g); g.connect(out);
  osc.start(t); osc.stop(end + 0.05);
}
function noise(c, out, t, { type = 'highpass', freq = 7000, q = 0.7, ...env }) {
  const s = c.createBufferSource();
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  const end = envelope(g, t, env);
  s.buffer = noiseBuf(c, end - t + 0.1);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t); s.stop(end + 0.05);
}
const drum = (c, o, t, f, peak = 0.9) => tone(c, o, t, { f0: f, f1: f * 0.5, glide: 0.14, peak, a: 0.002, d: 0.28 });
const snare = (c, o, t, peak) => {
  noise(c, o, t, { type: 'bandpass', freq: 1900, q: 0.7, peak, a: 0.001, d: 0.07 });
  tone(c, o, t, { type: 'triangle', f0: 210, f1: 170, glide: 0.05, peak: peak * 0.5, a: 0.001, d: 0.05 });
};
const cymbal = (c, o, t, d, peak) => {
  noise(c, o, t, { type: 'highpass', freq: 6000, peak, a: 0.002, d });
  noise(c, o, t, { type: 'bandpass', freq: 9500, q: 1.5, peak: peak * 0.5, a: 0.002, d: d * 0.6 });
};
// медь: пила через фильтр, который «раскрывается» в начале ноты
function brass(c, o, t, dur, freqs, { vib = 0, peak = 0.35, bright = 2200 } = {}) {
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(300, t);
  f.frequency.linearRampToValueAtTime(bright, t + 0.08);
  f.frequency.linearRampToValueAtTime(bright * 0.6, t + Math.min(dur, 0.4));
  const g = c.createGain();
  const end = envelope(g, t, { a: 0.04, peak, hold: dur, rel: 0.15 });
  f.connect(g); g.connect(o);
  for (const fr of freqs) {
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = fr;
    if (vib) {
      const l = c.createOscillator(); l.frequency.value = 5;
      const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(vib, t + dur);
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end + 0.05);
    }
    osc.connect(f); osc.start(t); osc.stop(end + 0.05);
  }
}
function horn(c, o, t, dur) {
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200; f.Q.value = 1;
  const g = c.createGain();
  const end = envelope(g, t, { a: 0.015, peak: 0.3, hold: dur, rel: 0.08 });
  f.connect(g); g.connect(o);
  for (const fr of [466, 470, 475, 235]) {
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(fr * 0.93, t); osc.frequency.exponentialRampToValueAtTime(fr, t + 0.05);
    osc.connect(f); osc.start(t); osc.stop(end + 0.05);
  }
}
const chirp = (c, o, t, f, peak) => { for (let p = 0; p < 3; p++) tone(c, o, t + p * 0.05, { f0: f, peak, a: 0.006, d: 0.035 }); };
const bell = (c, o, t, f) => {
  tone(c, o, t, { f0: f, peak: 0.5, a: 0.002, d: 1.2 });
  tone(c, o, t, { f0: f * 2.76, peak: 0.12, a: 0.002, d: 0.3 });
};

// level — громкость пика после нормализации (сверчки и гудок тише, иначе режут уши)
const BUILTIN = [
  { id: 'b:rimshot', name: 'Ба-дум-тсс', len: 2.0, level: 0.85, gen(c, o) {
    drum(c, o, 0, 200); snare(c, o, 0, 0.3);
    drum(c, o, 0.2, 150, 1);
    cymbal(c, o, 0.45, 1.4, 0.55);
  } },
  { id: 'b:trombone', name: 'Грустный тромбон', len: 3.4, level: 0.55, gen(c, o) {
    [196, 185, 174.61].forEach((f, i) => brass(c, o, i * 0.48, 0.36, [f]));
    brass(c, o, 1.44, 1.5, [164.81], { vib: 6 });
  } },
  { id: 'b:fanfare', name: 'Та-дам!', len: 2.0, level: 0.8, gen(c, o) {
    brass(c, o, 0, 0.1, [392, 523.25], { bright: 3200, peak: 0.3 });
    brass(c, o, 0.16, 1.3, [523.25, 659.25, 783.99, 1046.5], { bright: 3600, peak: 0.25 });
  } },
  { id: 'b:horn', name: 'Горн', len: 1.9, level: 0.7, gen(c, o) {
    for (const [t, d] of [[0, 0.14], [0.2, 0.14], [0.4, 1.1]]) horn(c, o, t, d);
  } },
  { id: 'b:drumroll', name: 'Барабанная дробь', len: 4.0, level: 0.85, gen(c, o) {
    const end = 1.9;
    for (let t = 0; t < end; t += 0.042) { const k = t / end; snare(c, o, t, 0.12 + 0.5 * k * k); }
    drum(c, o, end + 0.05, 110, 1); cymbal(c, o, end + 0.05, 1.9, 0.8);
  } },
  { id: 'b:crickets', name: 'Сверчки', len: 3.6, level: 0.35, gen(c, o) {
    for (let k = 0; k < 5; k++) chirp(c, o, 0.1 + k * 0.68, 4400, 0.3);
    for (let k = 0; k < 4; k++) chirp(c, o, 0.45 + k * 0.72, 4750, 0.16);
  } },
  { id: 'b:correct', name: 'Правильно', len: 1.6, level: 0.7, gen(c, o) { bell(c, o, 0, 1318.5); bell(c, o, 0.13, 1760); } },
  { id: 'b:wrong', name: 'Неправильно', len: 1.1, level: 0.42, gen(c, o) {
    for (const f of [98, 104]) tone(c, o, 0, { type: 'square', f0: f, a: 0.01, peak: 0.3, hold: 0.75, rel: 0.1, lp: 1800 });
  } },
];

export async function renderBuiltin(b) {
  const c = new OfflineAudioContext(1, Math.ceil(b.len * SR), SR);
  const bus = c.createGain(); bus.connect(c.destination);
  b.gen(c, bus);
  const buf = await c.startRendering();
  const d = buf.getChannelData(0);
  let pk = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
  if (pk > 0) { const k = (b.level || 0.85) / pk; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}
export const BUILTIN_SOUNDS = BUILTIN;

// ===================== панель и проигрывание =====================
export class Soundboard {
  // voice() — текущая голосовая комната (S.voice) или null; toast(text, opts) — всплывашка программы
  constructor({ mic, output, voice, toast }) {
    this.mic = mic; this.output = output; this.voice = voice; this.toast = toast || (() => {});
    this.user = [];
    this.prefs = { sendVol: 50, localVol: 50, binds: {} };
    this.buffers = new Map();   // id → Promise<AudioBuffer>
    this.playing = new Map();   // id → { src, local }
    this.deafened = false; this.globalKeys = false; this.capturing = null;
    this.ctx = null; this.panel = null; this.ui = null;
    this.warned = {};
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  async init() {
    try {
      const r = await api.sfx.list();
      this.user = r.sounds || [];
      const p = r.prefs || {};
      if (Number.isFinite(p.sendVol)) this.prefs.sendVol = p.sendVol;
      if (Number.isFinite(p.localVol)) this.prefs.localVol = p.localVol;
      if (p.binds && typeof p.binds === 'object') this.prefs.binds = p.binds;
    } catch (e) { log.warn('sfx', `Не загрузился список звуков: ${cleanErr(e)}`); }
    api.sfx.onFire((id) => this.fire(id));
    await this.syncBinds();
    this.render();
  }

  get all() { return [...BUILTIN.map((b) => ({ id: b.id, name: b.name, builtin: true })), ...this.user]; }
  get(id) { return this.all.find((s) => s.id === id) || null; }
  get live() { return [...this.playing.values()].some((r) => !r.local); }

  savePrefs() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => api.sfx.savePrefs(this.prefs).catch(() => {}), 300);
  }

  // Звуковая цепочка: «для всех» → в голос (Mic.setSfx), «у себя» → в наушники
  ensure() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' });
    this.sendGain = ctx.createGain(); this.localGain = ctx.createGain();
    this.dest = ctx.createMediaStreamDestination();
    this.sendGain.connect(this.dest);
    this.localGain.connect(ctx.destination);
    this.applyVolumes();
    this.mic.setSfx(this.dest.stream);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sendGain.gain.setTargetAtTime(this.prefs.sendVol / 100, t, 0.02);
    this.localGain.gain.setTargetAtTime(this.deafened ? 0 : this.prefs.localVol / 100, t, 0.02);
  }

  setDeafened(d) { d = !!d; if (d === this.deafened) return; this.deafened = d; this.applyVolumes(); this.renderVol(); }

  async outputDevice() {
    const id = (this.output && this.output.sinkId) || '';
    if (this.ctx.setSinkId && this.ctx.sinkId !== id) await this.ctx.setSinkId(id).catch(() => {});
  }

  buffer(id) {
    if (!this.buffers.has(id)) {
      const p = (async () => {
        const bi = BUILTIN.find((b) => b.id === id);
        if (bi) return renderBuiltin(bi);
        const bytes = await api.sfx.read(id);
        if (!bytes) throw new Error('файл звука не найден');
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return this.ctx.decodeAudioData(ab);
      })();
      p.catch(() => this.buffers.delete(id));
      this.buffers.set(id, p);
    }
    return this.buffers.get(id);
  }

  // Повторное нажатие того же звука — стоп (длинный смех можно оборвать той же клавишей)
  async fire(id, { local = false } = {}) {
    const s = this.get(id);
    if (!s) return;
    this.ensure();
    if (this.playing.has(id)) { this.stopOne(id); return; }
    await this.ctx.resume().catch(() => {});
    await this.outputDevice();
    let buf;
    try { buf = await this.buffer(id); } catch (e) {
      log.warn('sfx', `Звук «${s.name}» не проигрывается: ${cleanErr(e)}`);
      this.toast(`Звук «${s.name}» не проигрывается`, { kind: 'error', hint: 'Файл повреждён или удалён. Удалите звук и добавьте заново.' });
      return;
    }
    if (this.playing.has(id)) return; // пока грузился — нажали ещё раз
    while (this.playing.size >= MAX_AT_ONCE) this.stopOne(this.playing.keys().next().value);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.connect(this.localGain);
    if (!local) src.connect(this.sendGain);
    const rec = { src, local };
    this.playing.set(id, rec);
    src.onended = () => { if (this.playing.get(id) === rec) { this.playing.delete(id); this.renderPlaying(); } };
    src.start();
    this.renderPlaying();
    if (!local) { log.info('sfx', `Звук для всех: «${s.name}»`); this.warnUnheard(); }
  }

  stopOne(id) {
    const r = this.playing.get(id);
    if (!r) return;
    this.playing.delete(id);
    r.src.onended = null;
    try { r.src.stop(); } catch (_) { /* уже остановлен */ }
    this.renderPlaying();
  }
  stopAll() { for (const id of [...this.playing.keys()]) this.stopOne(id); }
  leave() { this.stopAll(); }

  warnUnheard() {
    const once = (key, text, hint) => {
      if (this.warned[key] && Date.now() - this.warned[key] < 60000) return;
      this.warned[key] = Date.now();
      this.toast(text, { kind: 'warn', hint, timeout: 7000 });
    };
    if (!this.voice()) once('room', 'Звук слышите только вы', 'Вы не в голосовой комнате. Зайдите в комнату — тогда его услышат все.');
    else if (!this.mic.sfxLive) once('mic', 'Звук слышите только вы', 'Звуки идут друзьям вместе с голосом, а микрофон не запущен. Проверьте микрофон в настройках.');
  }

  // ---------- клавиши ----------
  exists(id) { return !!this.get(id); }

  async syncBinds() {
    const list = Object.entries(this.prefs.binds)
      .filter(([id, b]) => b && b.ui && this.exists(id))
      .map(([id, b]) => ({ id, ...b.ui }));
    const r = await api.sfx.setBinds(list).catch(() => null);
    this.globalKeys = !!(r && r.global);
  }

  // клавиши в активном окне — когда глобального перехвата нет (или у звука его код не записался)
  onKey(e) {
    if (this.capturing || e.repeat) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, [contenteditable], [contenteditable] *')) return;
    for (const [id, b] of Object.entries(this.prefs.binds)) {
      if (!b || !b.dom || (this.globalKeys && b.ui)) continue;
      const d = b.dom;
      if (d.code === e.code && !!d.ctrl === e.ctrlKey && !!d.alt === e.altKey && !!d.shift === e.shiftKey) { e.preventDefault(); this.fire(id); return; }
    }
  }

  async bind(id) {
    if (this.capturing) { this.cancelCapture(); return; }
    this.capturing = id; this.cancelled = false; this.render();
    const dom = new Promise((resolve) => {
      const onKey = (e) => {
        if (MOD_CODES.has(e.code)) return; // ждём основную клавишу сочетания
        e.preventDefault(); e.stopPropagation();
        cleanup();
        if (e.code === 'Escape' || e.code === 'Backspace') return resolve({ clear: true });
        resolve({ code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, label: keyLabel(e) });
      };
      const cleanup = () => document.removeEventListener('keydown', onKey, true);
      this.cancelDom = () => { cleanup(); resolve(null); };
      setTimeout(() => document.addEventListener('keydown', onKey, true), 120);
      setTimeout(() => { cleanup(); resolve(null); }, 10000);
    });
    const [d, u] = await Promise.all([dom, api.sfx.capture().catch(() => null)]);
    this.capturing = null; this.cancelDom = null;
    const binds = this.prefs.binds;
    if ((d && d.clear) || (u && u.clear)) delete binds[id];
    else if (d || u) {
      const b = { label: d ? d.label : `Код ${u.code}`, dom: d ? { code: d.code, ctrl: d.ctrl, alt: d.alt, shift: d.shift } : null, ui: u ? { code: u.code, ctrl: u.ctrl, alt: u.alt, shift: u.shift } : null };
      for (const [k, v] of Object.entries(binds)) if (k !== id && v && v.label === b.label) delete binds[k]; // одно сочетание — один звук
      binds[id] = b;
      const s = this.get(id);
      log.info('sfx', `Клавиша для «${s ? s.name : id}»: ${b.label}`);
      if (d && risky(d)) this.toast(`«${b.label}» сработает и когда пишете или играете`, { kind: 'warn', hint: 'Лучше сочетание с Ctrl или Alt (например Ctrl+1) или клавиши Num на цифровом блоке.', timeout: 9000 });
    } else if (this.cancelled) this.cancelled = false;
    else this.toast('Клавиша не назначена — ничего не нажали за 10 секунд');
    this.savePrefs();
    await this.syncBinds();
    this.render();
  }
  cancelCapture() {
    this.cancelled = true;
    if (this.cancelDom) this.cancelDom();
    api.sfx.captureCancel().catch(() => {});
  }

  // ---------- свои звуки ----------
  pickFiles() {
    const inp = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm' });
    inp.onchange = () => this.addFiles(inp.files);
    inp.click();
  }

  async addFiles(list) {
    const files = [...list].filter((f) => f && AUDIO_RE.test(f.name));
    if (!files.length) { this.toast('Здесь нет звуков', { hint: `Подходят MP3, WAV, OGG/Opus, M4A, FLAC — до ${MAX_SEC} секунд` }); return; }
    this.ensure();
    let added = 0;
    for (const f of files) {
      try {
        if (f.size > MAX_BYTES) throw new Error('файл больше 8 МБ');
        const ab = await f.arrayBuffer();
        let buf;
        try { buf = await this.ctx.decodeAudioData(ab.slice(0)); } catch (_) { throw new Error('формат не поддерживается или файл повреждён'); }
        if (buf.duration > MAX_SEC) throw new Error(`длиннее ${MAX_SEC} секунд (${Math.round(buf.duration)} с). Для длинного есть «Музыка для всех»`);
        const name = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        const s = await api.sfx.add(name, f.name.split('.').pop().toLowerCase(), new Uint8Array(ab));
        this.user.push(s);
        this.buffers.set(s.id, Promise.resolve(buf));
        added++;
      } catch (e) {
        this.toast(`«${f.name}» не добавлен`, { kind: 'error', hint: cleanErr(e) });
      }
    }
    if (added) this.toast(added === 1 ? 'Звук добавлен' : `Добавлено звуков: ${added}`, { kind: 'ok', hint: 'Нажмите «+ клавиша», чтобы включать его сочетанием клавиш' });
    this.render();
  }

  async remove(id) {
    const s = this.get(id);
    if (!s || s.builtin) return;
    if (!confirm(`Удалить звук «${s.name}»?`)) return;
    this.stopOne(id);
    await api.sfx.remove(id).catch(() => {});
    this.user = this.user.filter((x) => x.id !== id);
    this.buffers.delete(id);
    if (this.prefs.binds[id]) { delete this.prefs.binds[id]; this.savePrefs(); await this.syncBinds(); }
    this.render();
  }

  // ---------- панель ----------
  build(host) {
    const p = this.panel = h('div', { class: 'quick-menu music-panel sfx-panel', id: 'sfx-panel', hidden: true });
    const range = (val, oninput) => { const r = h('input', { type: 'range', min: 0, max: 100, step: 1 }); r.value = val; r.oninput = oninput; return r; };
    const u = this.ui = {};
    u.status = h('small', { class: 'mp-status' });
    u.keys = h('small', { class: 'sfx-keys' });
    u.grid = h('div', { class: 'sfx-grid' });
    u.sendPct = h('small'); u.localPct = h('small');
    u.send = range(this.prefs.sendVol, () => { this.prefs.sendVol = +u.send.value; this.applyVolumes(); this.savePrefs(); this.renderVol(); });
    u.local = range(this.prefs.localVol, () => { this.prefs.localVol = +u.local.value; this.applyVolumes(); this.savePrefs(); this.renderVol(); });
    p.append(
      h('div', { class: 'mp-head' }, ico('sfx'), h('b', { text: 'Звуки для всех' }),
        h('button', { class: 'mp-btn mp-close', 'data-tip': 'Свернуть', onclick: () => this.hide() }, ico('x'))),
      u.status,
      u.grid,
      u.keys,
      h('label', { class: 'mp-vol' }, h('span', { text: 'Для всех' }), u.send, u.sendPct),
      h('label', { class: 'mp-vol' }, h('span', { text: 'У себя' }), u.local, u.localPct),
      h('div', { class: 'qm-sep' }),
      h('div', { class: 'mp-add' },
        h('button', { class: 'mp-link', 'data-tip': `Свой звук с компьютера: MP3, WAV, OGG — до ${MAX_SEC} секунд`, onclick: () => this.pickFiles() }, ico('plus'), 'Добавить звук'),
        u.stop = h('button', { class: 'mp-link', 'data-tip': 'Остановить все звуки', onclick: () => this.stopAll() }, ico('x'), 'Стоп')),
    );
    p.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); p.classList.add('drop'); } });
    p.addEventListener('dragleave', (e) => { if (!p.contains(e.relatedTarget)) p.classList.remove('drop'); });
    p.addEventListener('drop', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); e.stopPropagation(); p.classList.remove('drop');
      this.addFiles(e.dataTransfer.files);
    });
    host.append(p);
    this.render();
    return p;
  }

  get open() { return !!(this.panel && !this.panel.hidden); }

  show(anchor, bar) {
    if (!this.panel) return;
    this.anchor = anchor; this.bar = bar;
    this.ensure(); // открытие панели — действие человека: звуковой цепочке можно стартовать
    this.ctx.resume().catch(() => {});
    this.panel.hidden = false;
    this.render();
    this.place();
    if (this.onchange) this.onchange();
  }

  hide() {
    if (this.capturing) this.cancelCapture();
    if (this.panel) this.panel.hidden = true;
    if (this.onchange) this.onchange();
  }

  place() {
    const p = this.panel; const host = p.parentElement;
    if (!host || !this.anchor || !this.bar) return;
    const view = host.getBoundingClientRect(); const btn = this.anchor.getBoundingClientRect(); const bar = this.bar.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(view.width - p.offsetWidth - 8, btn.left - view.left + btn.width / 2 - p.offsetWidth / 2)) + 'px';
    p.style.bottom = (view.bottom - bar.top + 8) + 'px';
  }

  status() {
    if (!this.voice()) return { text: 'Вы не в комнате — звуки слышите только вы', cls: 'warn' };
    if (!this.mic.running) return { text: 'Микрофон не запущен — друзья звуки не услышат', cls: 'warn' };
    return { text: 'Нажмите звук — его услышат все в комнате', cls: 'ok' };
  }

  renderVol() {
    if (!this.ui) return;
    this.ui.sendPct.textContent = this.prefs.sendVol + '%';
    this.ui.localPct.textContent = this.deafened ? 'звук выкл' : this.prefs.localVol + '%';
  }

  renderPlaying() {
    if (this.ui) {
      for (const t of this.ui.grid.children) t.classList.toggle('playing', this.playing.has(t.dataset.id));
      this.ui.stop.hidden = !this.playing.size;
    }
    if (this.onchange) this.onchange();
  }

  render() {
    const u = this.ui; if (!u) return;
    const st = this.status();
    u.status.textContent = st.text; u.status.className = 'mp-status ' + st.cls;
    const anyBind = Object.keys(this.prefs.binds).some((id) => this.exists(id));
    u.keys.textContent = this.capturing ? 'Нажмите сочетание клавиш. Esc или Backspace — убрать клавишу'
      : !anyBind ? 'Назначьте звуку клавишу — его можно будет включать даже из игры'
        : this.globalKeys ? 'Клавиши работают везде, даже в игре. Повторное нажатие — стоп'
          : 'Клавиши работают, только когда окно «Сходки» активно';
    u.grid.textContent = '';
    for (const s of this.all) {
      const b = this.prefs.binds[s.id];
      const waiting = this.capturing === s.id;
      u.grid.append(h('div', { class: 'sfx-tile' + (this.playing.has(s.id) ? ' playing' : ''), 'data-id': s.id },
        h('button', { class: 'sfx-play', title: s.name, onclick: () => this.fire(s.id) }, h('span', { class: 'sfx-name', text: s.name })),
        h('div', { class: 'sfx-tools' },
          h('button', { class: 'sfx-key' + (b ? ' set' : '') + (waiting ? ' wait' : ''), 'data-tip': b ? 'Сменить клавишу (Esc — убрать)' : 'Назначить клавишу или сочетание', onclick: () => this.bind(s.id) },
            waiting ? 'Нажмите…' : b ? b.label : '+ клавиша'),
          h('button', { class: 'sfx-mini', 'data-tip': 'Послушать самому — друзья не услышат', onclick: () => this.fire(s.id, { local: true }) }, ico('head')),
          s.builtin ? null : h('button', { class: 'sfx-mini', 'data-tip': 'Удалить звук', onclick: () => this.remove(s.id) }, ico('trash')))));
    }
    this.renderVol();
    this.renderPlaying();
    if (this.open) this.place();
  }
}
