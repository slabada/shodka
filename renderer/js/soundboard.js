// Звуки для всех (1.21): короткие звуки по кнопке или сочетанию клавиш — закадровый смех, «ба-дум-тсс» и т. п.
// Подмешиваются в голосовую дорожку так же, как «Музыка для всех» (audio.js → Mic.setSfx), — их слышат все
// в комнате, даже у кого «Сходка» старой версии. Клавиши работают и в свёрнутом окне (в игре) — через тот же
// глобальный перехват, что и «рация» (main.js, uiohook). Одновременно звучит один звук.
// 1.21.4: видео тоже подходит — берётся только звук; кусок выбирается в редакторе (sfxedit.js).
import { log } from './log.js';
import { openSfxEditor, encodeWav } from './sfxedit.js';

const api = window.api;

const SR = 48000;
const MAX_BYTES = 8 * 1024 * 1024;     // сохраняемый звук (короткий файл как есть или выбранный кусок в WAV)
const MAX_IN_BYTES = 600 * 1024 * 1024; // исходник, из которого вырезаем кусок (видео бывают большими)
const MAX_SEC = 30;          // длиннее — это уже музыка, для неё есть «Музыка для всех»
const AUDIO_RE = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|weba)$/i;
const VIDEO_RE = /\.(mp4|m4v|mov|mkv|webm)$/i;
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

// ===================== встроенные звуки =====================
// Файлы — renderer/sounds/*.mp3, с freesound.org под CC0 / CC BY (авторы — sounds/CREDITS.txt).
// gain — выравнивание громкости (замер: громкое место ≈ −14 дБ, пик не выше 0,97); start — пропуск тишины в начале, с.
// id прежних синтезированных звуков сохранены, чтобы назначенные клавиши не слетели.
const BUILTIN = [
  { id: 'b:laugh2', name: 'Смех зала', file: 'laugh2.mp3', gain: 0.82, start: 0.73 },
  { id: 'b:applause', name: 'Аплодисменты', file: 'applause.mp3', gain: 1.5, start: 0.27 },
  { id: 'b:rimshot', name: 'Ба-дум-тсс', file: 'rimshot.mp3', gain: 1.11 },
  { id: 'b:trombone', name: 'Грустный тромбон', file: 'trombone.mp3', gain: 0.93, start: 0.22 },
  { id: 'b:dundun', name: 'Дун-дун-дуун', file: 'dundun.mp3', gain: 1.03 },
  { id: 'b:drumroll', name: 'Барабанная дробь', file: 'drumroll.mp3', gain: 0.98 },
  { id: 'b:wow', name: 'Ваааау', file: 'wow.mp3', gain: 1.71, start: 0.05 },
  { id: 'b:boo', name: 'Освистывание', file: 'boo.mp3', gain: 1.12, start: 0.12 },
];
export const BUILTIN_SOUNDS = BUILTIN;
const soundUrl = (file) => new URL('../sounds/' + file, import.meta.url).href;

// ===================== панель и проигрывание =====================
export class Soundboard {
  // voice() — текущая голосовая комната (S.voice) или null; toast(text, opts) — всплывашка программы
  constructor({ mic, output, voice, toast }) {
    this.mic = mic; this.output = output; this.voice = voice; this.toast = toast || (() => {});
    this.user = [];
    // hidden — убранные стандартные звуки; trims — выбранный кусок звука { start, end } (с)
    this.prefs = { sendVol: 50, localVol: 50, binds: {}, hidden: [], trims: {} };
    this.buffers = new Map();   // id → Promise<AudioBuffer>
    this.playing = new Map();   // id → { src, local }
    this.deafened = false; this.globalKeys = false; this.capturing = null; this.turn = 0;
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
      if (Array.isArray(p.hidden)) this.prefs.hidden = p.hidden.filter((id) => typeof id === 'string');
      if (p.trims && typeof p.trims === 'object') this.prefs.trims = p.trims;
    } catch (e) { log.warn('sfx', `Не загрузился список звуков: ${cleanErr(e)}`); }
    api.sfx.onFire((id) => this.fire(id));
    await this.syncBinds();
    this.render();
  }

  // стандартные (без убранных) и свои — отдельными списками
  get standard() { return BUILTIN.filter((b) => !this.prefs.hidden.includes(b.id)).map((b) => ({ id: b.id, name: b.name, builtin: true })); }
  get hiddenCount() { return BUILTIN.filter((b) => this.prefs.hidden.includes(b.id)).length; }
  get all() { return [...this.standard, ...this.user]; }
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
        if (bi) {
          const r = await fetch(soundUrl(bi.file));
          if (!r.ok) throw new Error(`нет файла ${bi.file}`);
          return this.ctx.decodeAudioData(await r.arrayBuffer());
        }
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

  // Одновременно звучит только один звук: новый обрывает предыдущий.
  // Повторное нажатие того же звука — стоп (длинный смех можно оборвать той же клавишей).
  async fire(id, { local = false } = {}) {
    const s = this.get(id);
    if (!s) return;
    this.ensure();
    if (this.playing.has(id)) { this.stopOne(id); return; }
    const turn = ++this.turn; // пока звук грузился, могли нажать другой — тогда этот уже не нужен
    this.stopAll();
    await this.ctx.resume().catch(() => {});
    await this.outputDevice();
    let buf;
    try { buf = await this.buffer(id); } catch (e) {
      log.warn('sfx', `Звук «${s.name}» не проигрывается: ${cleanErr(e)}`);
      this.toast(`Звук «${s.name}» не проигрывается`, { kind: 'error', hint: 'Файл повреждён или удалён. Удалите звук и добавьте заново.' });
      return;
    }
    if (turn !== this.turn) return;
    // 1.23: друзьям с новой «Сходкой» звуки идут отдельной дорожкой, а в тишине она выключена — включаем
    // и даём им миг её принять, чтобы начало звука не съелось
    const v = !local && this.voice();
    if (v && v.sfxWake && await v.sfxWake(buf.duration * 1000)) await new Promise((r) => setTimeout(r, 120));
    if (turn !== this.turn) return;
    this.stopAll();
    const bi = BUILTIN.find((b) => b.id === id);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = bi ? bi.gain : 1;
    src.connect(g); g.connect(this.localGain);
    if (!local) g.connect(this.sendGain);
    const rec = { src, local };
    this.playing.set(id, rec);
    src.onended = () => { if (this.playing.get(id) === rec) { this.playing.delete(id); this.renderPlaying(); } };
    const { start, end } = this.range(id, buf);
    src.start(0, start, end - start);
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
    const inp = h('input', { type: 'file', multiple: true, accept: 'audio/*,video/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm,.mp4,.m4v,.mov,.mkv' });
    inp.onchange = () => this.addFiles(inp.files);
    inp.click();
  }

  // Какой кусок звука играет: выбранный в редакторе, иначе — от «start» стандартного звука до конца
  range(id, buf) {
    const t = this.prefs.trims[id];
    const bi = BUILTIN.find((b) => b.id === id);
    let start = t ? t.start : (bi && bi.start) || 0;
    let end = t && t.end ? t.end : buf.duration;
    start = Math.max(0, Math.min(start, buf.duration - 0.05));
    end = Math.max(start + 0.05, Math.min(end, buf.duration));
    return { start, end };
  }

  // Прослушать кусок у себя (для редактора); возвращает «стоп»
  playLocal(buf, start, end, onEnd) {
    this.ensure();
    this.stopAll();
    this.ctx.resume().catch(() => {});
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.connect(this.localGain);
    src.onended = () => onEnd && onEnd();
    this.outputDevice().finally(() => src.start(0, start, end - start));
    return () => { src.onended = null; try { src.stop(); } catch (_) { /* ещё не начался */ } };
  }

  editor(buf, opts) {
    return openSfxEditor({ buffer: buf, maxLen: MAX_SEC, play: (a, b, done) => this.playLocal(buf, a, b, done), ...opts });
  }

  // Короткий звуковой файл добавляется как есть. Видео и длинная запись — через редактор:
  // выбираете кусок до 30 с, сохраняется только он (WAV), исходник не копируется.
  async addFiles(list) {
    const files = [...list].filter((f) => f && (AUDIO_RE.test(f.name) || VIDEO_RE.test(f.name) || /^(audio|video)\//.test(f.type)));
    if (!files.length) { this.toast('Здесь нет звуков', { hint: 'Подходят MP3, WAV, OGG/Opus, M4A, FLAC и видео MP4, MOV, MKV, WebM — из видео берётся звук' }); return; }
    this.ensure();
    let added = 0;
    for (const f of files) {
      const video = VIDEO_RE.test(f.name) || /^video\//.test(f.type);
      try {
        if (f.size > MAX_IN_BYTES) throw new Error('файл больше 600 МБ — вырежьте кусок поменьше');
        let wait = null;
        if (video || f.size > 20 * 1024 * 1024) wait = setTimeout(() => this.toast(video ? `Достаю звук из «${f.name}»…` : `Открываю «${f.name}»…`, { timeout: 4000 }), 400);
        const ab = await f.arrayBuffer();
        let buf;
        try { buf = await this.ctx.decodeAudioData(ab.slice(0)); } catch (_) {
          throw new Error(video ? 'в видео нет звуковой дорожки или такой формат не поддерживается' : 'формат не поддерживается или файл повреждён');
        } finally { clearTimeout(wait); }
        let name = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        let bytes = new Uint8Array(ab); let ext = f.name.split('.').pop().toLowerCase();
        if (video || buf.duration > MAX_SEC || f.size > MAX_BYTES) {
          const r = await this.editor(buf, { name, title: video ? 'Звук из видео: выберите кусок' : 'Выберите кусок звука', start: 0, end: Math.min(buf.duration, video ? 10 : MAX_SEC) });
          if (!r) continue; // отмена
          name = r.name;
          bytes = encodeWav(buf, r.start, r.end); ext = 'wav';
          buf = null; // сохранённый кусок прочитается заново при первом нажатии
        }
        const s = await api.sfx.add(name, ext, bytes);
        this.user.push(s);
        if (buf) this.buffers.set(s.id, Promise.resolve(buf));
        added++;
      } catch (e) {
        this.toast(`«${f.name}» не добавлен`, { kind: 'error', hint: cleanErr(e) });
      }
    }
    if (added) this.toast(added === 1 ? 'Звук добавлен' : `Добавлено звуков: ${added}`, { kind: 'ok', hint: 'Ножницы на плитке — выбрать кусок. «+ клавиша» — включать сочетанием клавиш' });
    this.render();
  }

  // Ножницы на плитке: какой кусок звука играть (исходник не меняется — можно передумать)
  async edit(id) {
    const s = this.get(id);
    if (!s) return;
    this.ensure();
    let buf;
    try { buf = await this.buffer(id); } catch (e) { this.toast(`Звук «${s.name}» не открывается`, { kind: 'error', hint: cleanErr(e) }); return; }
    const cur = this.range(id, buf);
    const r = await this.editor(buf, { name: s.name, canRename: !s.builtin, title: s.builtin ? `«${s.name}»: какой кусок играть` : 'Какой кусок играть', start: cur.start, end: cur.end });
    if (!r) return;
    const bi = BUILTIN.find((b) => b.id === id);
    const whole = r.start <= ((bi && bi.start) || 0) + 0.01 && r.end >= buf.duration - 0.01;
    if (whole) delete this.prefs.trims[id]; else this.prefs.trims[id] = { start: r.start, end: r.end };
    if (!s.builtin && r.name && r.name !== s.name) {
      await api.sfx.rename(id, r.name).catch(() => {});
      s.name = r.name;
      const u = this.user.find((x) => x.id === id); if (u) u.name = r.name;
    }
    this.savePrefs();
    log.info('sfx', `Кусок звука «${s.name}»: ${r.start.toFixed(2)}–${r.end.toFixed(2)} с`);
    this.render();
  }

  // Свой звук удаляется с диска; стандартный только прячется — его можно вернуть
  async remove(id) {
    const s = this.get(id);
    if (!s) return;
    if (s.builtin) {
      if (!confirm(`Убрать стандартный звук «${s.name}»?
Вернуть его можно кнопкой «Вернуть стандартные».`)) return;
      this.stopOne(id);
      this.prefs.hidden = [...new Set([...this.prefs.hidden, id])];
    } else {
      if (!confirm(`Удалить звук «${s.name}»?`)) return;
      this.stopOne(id);
      await api.sfx.remove(id).catch(() => {});
      this.user = this.user.filter((x) => x.id !== id);
      this.buffers.delete(id);
    }
    delete this.prefs.binds[id];
    if (!s.builtin) delete this.prefs.trims[id]; // у стандартного кусок остаётся — вдруг вернут
    this.savePrefs();
    await this.syncBinds();
    this.render();
  }

  async restoreStandard() {
    this.prefs.hidden = [];
    this.savePrefs();
    await this.syncBinds();
    this.render();
  }

  // ---------- панель ----------
  build(host) {
    const p = this.panel = h('div', { class: 'quick-menu music-panel sfx-panel', id: 'sfx-panel', hidden: true });
    const range = (val, oninput) => { const r = h('input', { type: 'range', min: 0, max: 100, step: 1 }); r.value = val; r.oninput = oninput; return r; };
    const u = this.ui = {};
    u.status = h('small', { class: 'mp-status' });
    u.keys = h('small', { class: 'sfx-keys' });
    u.list = h('div', { class: 'sfx-list' });
    u.sendPct = h('small'); u.localPct = h('small');
    u.send = range(this.prefs.sendVol, () => { this.prefs.sendVol = +u.send.value; this.applyVolumes(); this.savePrefs(); this.renderVol(); });
    u.local = range(this.prefs.localVol, () => { this.prefs.localVol = +u.local.value; this.applyVolumes(); this.savePrefs(); this.renderVol(); });
    p.append(
      h('div', { class: 'mp-head' }, ico('sfx'), h('b', { text: 'Звуки для всех' }),
        h('button', { class: 'mp-btn mp-close', 'data-tip': 'Свернуть', onclick: () => this.hide() }, ico('x'))),
      u.status,
      u.list,
      u.keys,
      h('label', { class: 'mp-vol' }, h('span', { text: 'Для всех' }), u.send, u.sendPct),
      h('label', { class: 'mp-vol' }, h('span', { text: 'У себя' }), u.local, u.localPct),
      h('div', { class: 'qm-sep' }),
      h('div', { class: 'mp-add' },
        h('button', { class: 'mp-link', 'data-tip': `Свой звук или видео с компьютера — из видео берётся звук, кусок до ${MAX_SEC} с`, onclick: () => this.pickFiles() }, ico('plus'), 'Добавить звук'),
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
      for (const t of this.ui.list.querySelectorAll('.sfx-tile')) t.classList.toggle('playing', this.playing.has(t.dataset.id));
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
        : this.globalKeys ? 'Клавиши работают везде, даже в игре. Звучит один звук за раз, повторное нажатие — стоп'
          : 'Клавиши работают, только когда окно «Сходки» активно';
    const tile = (s) => {
      const b = this.prefs.binds[s.id];
      const waiting = this.capturing === s.id;
      return h('div', { class: 'sfx-tile' + (this.playing.has(s.id) ? ' playing' : ''), 'data-id': s.id },
        h('button', { class: 'sfx-play', title: s.name, onclick: () => this.fire(s.id) }, h('span', { class: 'sfx-name', text: s.name })),
        h('div', { class: 'sfx-tools' },
          h('button', { class: 'sfx-key' + (b ? ' set' : '') + (waiting ? ' wait' : ''), 'data-tip': b ? 'Сменить клавишу (Esc — убрать)' : 'Назначить клавишу или сочетание', onclick: () => this.bind(s.id) },
            waiting ? 'Нажмите…' : b ? b.label : '+ клавиша'),
          h('button', { class: 'sfx-mini' + (this.prefs.trims[s.id] ? ' on' : ''), 'data-tip': 'Выбрать, какой кусок играть', onclick: () => this.edit(s.id) }, ico('cut')),
          h('button', { class: 'sfx-mini', 'data-tip': 'Послушать самому — друзья не услышат', onclick: () => this.fire(s.id, { local: true }) }, ico('head')),
          h('button', { class: 'sfx-mini', 'data-tip': s.builtin ? 'Убрать стандартный звук (можно вернуть)' : 'Удалить свой звук', onclick: () => this.remove(s.id) }, ico('trash'))));
    };
    const std = this.standard; const hid = this.hiddenCount;
    u.list.textContent = '';
    u.list.append(
      h('div', { class: 'sfx-sec' }, h('span', { text: 'Стандартные' }),
        hid ? h('button', { class: 'sfx-restore', 'data-tip': 'Показать убранные стандартные звуки', onclick: () => this.restoreStandard() }, `Вернуть стандартные (${hid})`) : null),
      std.length ? h('div', { class: 'sfx-grid' }, std.map(tile)) : h('div', { class: 'sfx-empty', text: 'Все стандартные звуки убраны' }),
      h('div', { class: 'sfx-sec' }, h('span', { text: 'Мои звуки' })),
      this.user.length ? h('div', { class: 'sfx-grid' }, this.user.map(tile))
        : h('button', { class: 'sfx-empty', onclick: () => this.pickFiles() }, 'Добавьте свой звук или видео — кнопкой ниже или перетащите файл сюда'),
    );
    this.renderVol();
    this.renderPlaying();
    if (this.open) this.place();
  }
}
