// Музыка для всех: свой плеер в голосовой комнате. Файлы с этого ПК играют у вас и подмешиваются в вашу
// голосовую дорожку (audio.js → Mic.setMusic) — их слышат все в комнате, даже у кого «Сходка» старой версии.
// Отдельный бот на сервере не нужен. Пока музыка играет, голос уходит с битрейтом для музыки (rtc.js).
import { log } from './log.js';
import { startProcessAudio, processAudioAvailable } from './procaudio.js';

const api = window.api;

const MUSIC_KBPS = 96;     // моно Opus 96 кбит/с — для музыки почти без потерь; голос без музыки — как раньше
const PREFS_KEY = 'skhodka.music';
// видео тоже можно: в комнату идёт его звук
const AUDIO_RE = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm|weba|mp4|m4v|mkv|mov)$/i;
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
const fmt = (t) => {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  t = Math.floor(t); const m = Math.floor(t / 60); const s = t % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const trackName = (f) => f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
}

// Папку, брошенную в плеер, обходим целиком (с вложенными)
async function filesFromEntry(entry, out) {
  if (!entry) return;
  if (entry.isFile) { const f = await new Promise((res) => entry.file(res, () => res(null))); if (f) out.push(f); return; }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
    if (!batch.length) break;
    for (const e of batch) await filesFromEntry(e, out);
  }
}

export class MusicPlayer {
  // voice() — текущая голосовая комната (S.voice) или null; toast(text, opts) — всплывашка программы
  constructor({ mic, output, voice, toast }) {
    this.mic = mic; this.output = output; this.voice = voice; this.toast = toast || (() => {});
    this.queue = []; this.idx = -1;
    const p = loadPrefs();
    this.sendVol = Number.isFinite(p.sendVol) ? p.sendVol : 35;
    this.localVol = Number.isFinite(p.localVol) ? p.localVol : 35;
    this.duck = p.duck !== false;
    this.shuffle = !!p.shuffle;
    this.repeat = p.repeat !== false;
    this.deafened = false;
    this.el = null; this.ctx = null; this.panel = null; this.seeking = false;
  }

  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sendVol: this.sendVol, localVol: this.localVol, duck: this.duck, shuffle: this.shuffle, repeat: this.repeat })); } catch (_) { /* ignore */ }
  }

  get current() { return this.queue[this.idx] || null; }
  get playing() { return !!(this.el && !this.el.paused && this.current); }
  // что-то идёт в комнату: файл из очереди или звук программы
  get live() { return this.playing || !!this.app; }

  // Звуковая цепочка создаётся при первом нажатии (браузер не даёт звуку стартовать без действия человека)
  ensure() {
    if (this.ctx) return;
    const el = this.el = new Audio(); el.preload = 'auto';
    const ctx = this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    const src = ctx.createMediaElementSource(el);
    this.sendGain = ctx.createGain(); this.localGain = ctx.createGain();
    this.dest = ctx.createMediaStreamDestination();
    src.connect(this.sendGain); this.sendGain.connect(this.dest);
    src.connect(this.localGain); this.localGain.connect(ctx.destination);
    this.applyVolumes();
    this.mic.setMusic(this.dest.stream, { duck: this.duck });
    el.addEventListener('play', () => this.changed());
    el.addEventListener('pause', () => this.changed());
    el.addEventListener('loadedmetadata', () => this.renderProgress());
    el.addEventListener('timeupdate', () => { this.syncBitrate(); this.renderProgress(); });
    el.addEventListener('ended', () => this.next(true));
    el.addEventListener('error', () => {
      const t = this.current;
      if (!t || !el.getAttribute('src')) return;
      log.warn('music', `Не удалось проиграть «${t.name}» — формат не поддерживается или файл повреждён`);
      this.toast(`Не играет «${t.name}»`, { kind: 'warn', hint: 'Формат не поддерживается или файл повреждён. Подходят MP3, M4A/AAC, FLAC, OGG/Opus, WAV' });
      t.bad = true;
      if (this.queue.some((x) => !x.bad)) this.next(true); else this.stop();
    });
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sendGain.gain.setTargetAtTime(this.sendVol / 100, t, 0.03);
    this.localGain.gain.setTargetAtTime(this.deafened ? 0 : this.localVol / 100, t, 0.03);
  }

  setDeafened(d) { d = !!d; if (d === this.deafened) return; this.deafened = d; this.applyVolumes(); }

  // Пока играет — голосовая дорожка с битрейтом для музыки; пауза и стоп — обычный голос
  syncBitrate() {
    const v = this.voice();
    if (v && v.setMusicBitrate) v.setMusicBitrate(this.live ? MUSIC_KBPS : 0);
  }

  async outputDevice() {
    const id = (this.output && this.output.sinkId) || '';
    if (this.ctx.setSinkId && this.ctx.sinkId !== id) await this.ctx.setSinkId(id).catch(() => {});
  }

  addFiles(list) {
    const files = [...list].filter((f) => f && (AUDIO_RE.test(f.name) || /^(audio|video)\//.test(f.type)));
    if (!files.length) { this.toast('Здесь нет музыки', { hint: 'Подходят MP3, M4A/AAC, FLAC, OGG/Opus, WAV и видео MP4, WebM, MKV — из видео идёт звук' }); return; }
    files.sort((a, b) => collator.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
    const wasEmpty = !this.queue.length;
    for (const f of files) this.queue.push({ file: f, name: trackName(f), url: '' });
    log.info('music', `Добавлено в очередь: ${files.length}`);
    if (wasEmpty || this.idx < 0) this.play(this.queue.length - files.length);
    else this.render();
  }

  remove(i) {
    const t = this.queue[i];
    if (!t) return;
    if (t.url) URL.revokeObjectURL(t.url);
    this.queue.splice(i, 1);
    if (i < this.idx) this.idx--;
    else if (i === this.idx) {
      if (this.queue.length) { this.play(Math.min(i, this.queue.length - 1), { keepPaused: !this.playing }); return; }
      this.stop(); return;
    }
    this.render();
  }

  clear() {
    this.stop();
    for (const t of this.queue) if (t.url) URL.revokeObjectURL(t.url);
    this.queue = []; this.idx = -1;
    this.render();
  }

  async play(i, { keepPaused = false } = {}) {
    this.ensure();
    const t = this.queue[i];
    if (!t) return;
    if (this.current && this.current !== t && this.current.url) { URL.revokeObjectURL(this.current.url); this.current.url = ''; }
    this.idx = i;
    if (this.app && !keepPaused) this.stopApp();
    if (!t.url) t.url = URL.createObjectURL(t.file);
    this.el.src = t.url;
    await this.ctx.resume().catch(() => {});
    await this.outputDevice();
    if (!keepPaused) {
      await this.el.play().catch((e) => { if (e.name !== 'AbortError') log.warn('music', `Не удалось включить «${t.name}»: ${e.message}`); });
      this.checkHeard();
    }
    this.changed();
  }

  // Микрофон не запущен — подмешивать музыку некуда, друзья её не услышат
  checkHeard() {
    if (this.mic.musicLive || this.warnedNoMic) return;
    this.warnedNoMic = true;
    this.toast('Музыку пока слышите только вы', { kind: 'warn', hint: 'Музыка идёт друзьям вместе с голосом, а микрофон не запущен. Проверьте микрофон в настройках', timeout: 9000 });
  }

  toggle() {
    if (!this.queue.length) { this.pickFiles(); return; }
    if (this.idx < 0 || !this.el || !this.el.getAttribute('src')) { this.play(Math.max(0, this.idx)); return; }
    if (this.el.paused) { if (this.app) this.stopApp(); this.ctx.resume().catch(() => {}); this.outputDevice().then(() => this.el.play()).catch(() => {}); this.checkHeard(); } else this.el.pause();
  }

  stop() {
    if (this.el) { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
    if (this.current && this.current.url) { URL.revokeObjectURL(this.current.url); this.current.url = ''; }
    this.changed();
  }

  pickIndex(step) {
    const n = this.queue.length;
    if (!n) return -1;
    const ok = (i) => this.queue[i] && !this.queue[i].bad;
    if (this.shuffle && n > 1) {
      const pool = this.queue.map((_, i) => i).filter((i) => i !== this.idx && ok(i));
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
    }
    for (let k = 1; k <= n; k++) {
      let i = this.idx + step * k;
      if (i >= n || i < 0) { if (!this.repeat) return -1; i = ((i % n) + n) % n; }
      if (ok(i)) return i;
    }
    return -1;
  }

  next(auto = false) {
    const i = this.pickIndex(1);
    if (i < 0) { if (auto) { this.stop(); log.info('music', 'Очередь закончилась'); } return; }
    this.play(i);
  }

  prev() {
    if (this.el && this.el.currentTime > 3) { this.el.currentTime = 0; return; }
    const i = this.pickIndex(-1);
    if (i >= 0) this.play(i);
  }

  // Вышли из комнаты — музыку останавливаем, очередь оставляем
  leave() { if (this.playing) this.el.pause(); if (this.app) this.stopApp(); this.syncBitrate(); }

  // ---------- звук из программы (Яндекс Музыка, ВК, YouTube, Spotify…) ----------
  // Помощник skh-audiocap.exe пишет звук только выбранной программы (Windows 10 2004+/11) — тот же, что в
  // демонстрации «звук только этого окна». Голоса друзей туда не попадают: они звучат из «Сходки».
  async openApps() {
    this.view = 'apps'; this.apps = null; this.render();
    try {
      // свой список окон (с PID и свёрнутыми окнами); у старой сборки — список демонстрации
      const r = api.musicApps ? await api.musicApps() : null;
      if (r && r.ok) this.apps = r.apps;
      else {
        if (r && r.reason) log.warn('music', `Свой список окон не получен (${r.reason}) — беру список демонстрации, свёрнутых окон в нём нет`);
        const list = await api.screenSources();
        this.apps = (list || []).filter((s) => !s.isScreen && s.name && !/^Сходка$/.test(s.name));
      }
    } catch (e) {
      log.warn('music', `Не удалось получить список окон: ${e.message}`);
      this.apps = [];
    }
    if (this.view === 'apps') this.render();
  }

  async startApp(src) {
    if (this.appStarting) return;
    this.appStarting = true; this.render();
    try {
      if (!processAudioAvailable()) throw new Error('эта версия Windows не умеет записывать звук одной программы (нужна Windows 10 2004 или новее)');
      const r = src.pid ? { ok: true, pid: src.pid } : await api.procAudio.windowPid(src.id);
      if (!r || !r.ok) throw new Error((r && r.reason) || 'не удалось узнать, чья это программа');
      const track = await startProcessAudio({ include: r.pid });
      this.ensure();
      if (this.app) this.stopApp(true);
      if (this.playing) this.el.pause();
      const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
      node.connect(this.sendGain); // себе не выводим — программу вы и так слышите
      await this.ctx.resume().catch(() => {});
      this.app = { name: src.name, icon: src.icon, pid: r.pid, track, node };
      this.view = 'main';
      log.info('music', `Звук для всех — из программы «${src.name}» (процесс ${r.pid})`);
      this.checkHeard();
    } catch (e) {
      log.warn('music', `Звук программы «${src.name}» записать не получилось: ${e.message}`);
      this.toast('Не получилось взять звук этой программы', { kind: 'warn', hint: e.message, timeout: 9000 });
    } finally { this.appStarting = false; this.changed(); }
  }

  stopApp(quiet) {
    const a = this.app; if (!a) return;
    this.app = null;
    try { a.node.disconnect(); } catch (_) { /* ignore */ }
    try { if (a.track._skhStop) a.track._skhStop(); else a.track.stop(); } catch (_) { /* ignore */ }
    if (!quiet) { log.info('music', `Звук программы «${a.name}» больше не идёт в комнату`); this.changed(); }
  }

  changed() {
    this.syncBitrate();
    if (this.onchange) this.onchange();
    this.render();
  }

  pickFiles(dir = false) {
    const inp = h('input', { type: 'file', multiple: true, accept: dir ? null : 'audio/*,video/*,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.wav,.webm,.mp4,.m4v,.mkv,.mov' });
    if (dir) inp.webkitdirectory = true;
    inp.onchange = () => { if (inp.files && inp.files.length) this.addFiles(inp.files); };
    inp.click();
  }

  // ---------- панель ----------
  build(host) {
    const p = this.panel = h('div', { class: 'quick-menu music-panel', id: 'music-panel', hidden: true });
    const range = (cls, val, oninput) => { const r = h('input', { type: 'range', min: 0, max: 100, step: 1, class: cls }); r.value = val; r.oninput = oninput; return r; };
    this.ui = {};
    const u = this.ui;
    u.status = h('small', { class: 'mp-status' });
    u.title = h('div', { class: 'mp-title' });
    u.seek = h('input', { type: 'range', min: 0, max: 1000, step: 1, class: 'mp-seek' }); u.seek.value = 0;
    u.seek.oninput = () => { this.seeking = true; u.cur.textContent = fmt((u.seek.value / 1000) * (this.el ? this.el.duration : 0)); };
    u.seek.onchange = () => { this.seeking = false; if (this.el && Number.isFinite(this.el.duration)) this.el.currentTime = (u.seek.value / 1000) * this.el.duration; };
    u.cur = h('span', { text: '0:00' }); u.dur = h('span', { text: '0:00' });
    const btn = (name, tip, fn, cls = '') => { const b = h('button', { class: 'mp-btn ' + cls, 'data-tip': tip, onclick: fn }, ico(name)); return b; };
    u.shuffle = btn('shuffle', 'Вперемешку', () => { this.shuffle = !this.shuffle; this.savePrefs(); this.render(); });
    u.repeat = btn('repeat', 'По кругу', () => { this.repeat = !this.repeat; this.savePrefs(); this.render(); });
    u.play = btn('play', 'Играть', () => this.toggle(), 'mp-main');
    u.sendPct = h('small'); u.localPct = h('small');
    u.send = range('', this.sendVol, () => { this.sendVol = +u.send.value; this.applyVolumes(); this.savePrefs(); this.renderVol(); });
    u.local = range('', this.localVol, () => { this.localVol = +u.local.value; this.applyVolumes(); this.savePrefs(); this.renderVol(); });
    u.duck = h('span', { class: 'switch' });
    u.count = h('span');
    u.list = h('div', { class: 'mp-list' });
    u.appCard = h('div', { class: 'mp-app' });
    u.apps = h('div', { class: 'mp-apps', hidden: true });
    u.main = h('div', { class: 'mp-main-view' });
    p.append(
      h('div', { class: 'mp-head' }, ico('music'), h('b', { text: 'Музыка для всех' }), h('button', { class: 'mp-btn mp-close', 'data-tip': 'Свернуть (музыка продолжит играть)', onclick: () => this.hide() }, ico('x'))),
      u.status,
      u.apps,
      u.main,
    );
    u.main.append(
      u.appCard,
      u.now = h('div', { class: 'mp-now' }, u.title, u.seek, h('div', { class: 'mp-times' }, u.cur, u.dur)),
      u.ctl = h('div', { class: 'mp-ctl' }, u.shuffle, btn('prev', 'Назад', () => this.prev()), u.play, btn('next', 'Дальше', () => this.next()), u.repeat),
      h('label', { class: 'mp-vol' }, h('span', { text: 'Для всех' }), u.send, u.sendPct),
      u.localRow = h('label', { class: 'mp-vol' }, h('span', { text: 'У себя' }), u.local, u.localPct),
      h('button', { class: 'qm-toggle', onclick: () => { this.duck = !this.duck; this.mic.setMusicDuck(this.duck); this.savePrefs(); this.render(); } },
        h('span', { class: 'tt' }, h('span', { text: 'Тише, когда я говорю' }), h('small', { text: 'Пока вы говорите, музыка у всех приглушается' })), u.duck),
      h('div', { class: 'qm-sep' }),
      h('div', { class: 'mp-add' },
        h('button', { class: 'mp-link', 'data-tip': 'Музыка или видео с компьютера', onclick: () => this.pickFiles(false) }, ico('plus'), 'Файлы'),
        h('button', { class: 'mp-link', onclick: () => this.pickFiles(true) }, ico('folder'), 'Папка'),
        h('button', { class: 'mp-link', 'data-tip': 'Звук Яндекс Музыки, ВК, YouTube, Spotify — любой программы', onclick: () => this.openApps() }, ico('screen'), 'Из программы')),
      h('div', { class: 'mp-qhead' }, u.count,
        u.clear = h('button', { class: 'mp-link', 'data-tip': 'Очистить очередь', onclick: () => this.clear() }, ico('trash'))),
      u.list,
    );
    // перетаскивание файлов и папок прямо в панель (не в чат)
    p.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); p.classList.add('drop'); } });
    p.addEventListener('dragleave', (e) => { if (!p.contains(e.relatedTarget)) p.classList.remove('drop'); });
    p.addEventListener('drop', async (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); e.stopPropagation(); p.classList.remove('drop');
      const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
      if (entries.length) { const out = []; for (const en of entries) await filesFromEntry(en, out); this.addFiles(out); } else this.addFiles(e.dataTransfer.files);
    });
    host.append(p);
    this.render();
    return p;
  }

  get open() { return !!(this.panel && !this.panel.hidden); }

  show(anchor, bar) {
    if (!this.panel) return;
    this.anchor = anchor; this.bar = bar;
    this.panel.hidden = false;
    this.place();
    this.render();
    if (this.onchange) this.onchange();
  }

  hide() { if (this.panel) this.panel.hidden = true; if (this.onchange) this.onchange(); }

  place() {
    const p = this.panel; const host = p.parentElement;
    if (!host || !this.anchor || !this.bar) return;
    const view = host.getBoundingClientRect(); const btn = this.anchor.getBoundingClientRect(); const bar = this.bar.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(view.width - p.offsetWidth - 8, btn.left - view.left + btn.width / 2 - p.offsetWidth / 2)) + 'px';
    p.style.bottom = (view.bottom - bar.top + 8) + 'px';
  }

  status() {
    if (this.app) {
      if (!this.voice()) return { text: 'Вы не в комнате — звук программы никуда не идёт', cls: 'warn' };
      if (!this.mic.musicLive) return { text: 'Микрофон не запущен — друзья звук программы не слышат', cls: 'warn' };
      return { text: 'Звук программы идёт всем в комнате', cls: 'ok' };
    }
    if (!this.current) return { text: 'Добавьте свою музыку — её услышат все в комнате', cls: '' };
    if (!this.voice()) return { text: 'Вы не в комнате — музыку слышите только вы', cls: 'warn' };
    if (!this.mic.musicLive) return { text: 'Микрофон не запущен — музыку слышите только вы', cls: 'warn' };
    if (!this.playing) return { text: 'Пауза', cls: '' };
    return { text: 'Играет для всех в комнате', cls: 'ok' };
  }

  renderVol() {
    if (!this.ui) return;
    this.ui.sendPct.textContent = this.sendVol + '%';
    this.ui.localPct.textContent = this.deafened ? 'звук выкл' : this.localVol + '%';
  }

  renderProgress() {
    const u = this.ui; if (!u || !this.open) return;
    const d = this.el ? this.el.duration : NaN; const c = this.el ? this.el.currentTime : 0;
    u.dur.textContent = fmt(d);
    if (!this.seeking) { u.cur.textContent = fmt(c); u.seek.value = Number.isFinite(d) && d > 0 ? Math.round((c / d) * 1000) : 0; }
    u.seek.disabled = !(Number.isFinite(d) && d > 0);
  }

  render() {
    const u = this.ui; if (!u) return;
    const st = this.status();
    const apps = this.view === 'apps';
    u.apps.hidden = !apps; u.main.hidden = apps;
    if (apps) this.renderApps();
    u.appCard.hidden = !this.app; u.appCard.textContent = '';
    // звук программы идёт — файловый плеер прячем, пока в очереди ничего не выбрано
    const filesIdle = !!this.app && !this.current;
    u.now.hidden = filesIdle; u.ctl.hidden = filesIdle; u.localRow.hidden = !!this.app;
    u.clear.hidden = !this.queue.length;
    if (this.app) {
      u.appCard.append(this.app.icon ? h('img', { src: this.app.icon, alt: '' }) : ico('screen'),
        h('div', { class: 'tt' }, h('small', { text: 'Звук для всех из программы' }), h('b', { text: this.app.name, title: this.app.name })),
        h('button', { class: 'btn small danger', onclick: () => this.stopApp() }, 'Стоп'));
    }
    u.status.textContent = st.text; u.status.className = 'mp-status ' + st.cls;
    u.title.textContent = this.current ? this.current.name : 'Ничего не играет';
    u.title.title = this.current ? this.current.file.name : '';
    const pl = u.play.querySelector('use'); pl.setAttribute('href', this.playing ? '#i-pause' : '#i-play');
    u.play.dataset.tip = this.playing ? 'Пауза' : 'Играть';
    u.shuffle.classList.toggle('on', this.shuffle);
    u.repeat.classList.toggle('on', this.repeat);
    u.duck.classList.toggle('on', this.duck);
    u.count.textContent = this.queue.length ? `Очередь · ${this.queue.length}` : 'Очередь';
    this.renderVol();
    this.renderProgress();
    u.list.textContent = '';
    if (!this.queue.length) {
      u.list.append(h('div', { class: 'mp-empty', text: 'Перетащите сюда файлы или папку с музыкой, или нажмите «Файлы»' }));
    } else {
      this.queue.forEach((t, i) => {
        u.list.append(h('div', { class: 'mp-item' + (i === this.idx ? ' cur' : '') + (t.bad ? ' bad' : ''), ondblclick: () => this.play(i) },
          h('button', { class: 'mp-name', title: t.file.name, onclick: () => this.play(i) }, h('span', { class: 'mp-n', text: i === this.idx && this.playing ? '♪' : String(i + 1) }), h('span', { text: t.name })),
          h('button', { class: 'mp-btn mp-del', 'data-tip': 'Убрать из очереди', onclick: () => this.remove(i) }, ico('x'))));
      });
    }
    if (this.open) this.place();
  }

  renderApps() {
    const u = this.ui; u.apps.textContent = '';
    u.apps.append(h('div', { class: 'mp-qhead' }, h('span', { text: 'Чей звук включить для всех?' }),
      h('button', { class: 'mp-link', onclick: () => { this.view = 'main'; this.render(); } }, ico('back'), 'Назад')));
    u.apps.append(h('small', { class: 'mp-hint', text: 'Откройте Яндекс Музыку, ВК, YouTube или Spotify и выберите окно — можно свёрнутое. Идёт весь звук этой программы — у браузера это все его вкладки.' }));
    const box = h('div', { class: 'mp-list' });
    if (this.apps === null || this.appStarting) box.append(h('div', { class: 'mp-empty', text: this.appStarting ? 'Подключаю звук…' : 'Ищу окна…' }));
    else if (!this.apps.length) box.append(h('div', { class: 'mp-empty', text: 'Открытых окон не нашлось' }));
    else for (const s of this.apps) {
      box.append(h('div', { class: 'mp-item' }, h('button', { class: 'mp-name', title: s.proc ? `${s.name}\n${s.proc}.exe` : s.name, onclick: () => this.startApp(s) },
        s.icon ? h('img', { class: 'mp-ico', src: s.icon, alt: '' }) : h('span', { class: 'mp-n', text: '•' }), h('span', { text: s.name }),
        s.min ? h('small', { class: 'mp-min', text: 'свёрнуто' }) : null)));
    }
    u.apps.append(box, h('button', { class: 'mp-link mp-refresh', onclick: () => this.openApps() }, ico('swap'), 'Обновить список'));
  }
}
