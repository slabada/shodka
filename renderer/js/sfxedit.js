// Редактор фрагмента для «Звуков для всех» (1.21.4): волна звука, ручки «начало» и «конец», точные поля,
// прослушивание выделенного куска и приближение колёсиком (для длинных видео). Плюс запись куска в WAV —
// так видео любой длины превращается в короткий звук: хранится только выбранный фрагмент.

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
  t = Math.max(0, t);
  const m = Math.floor(t / 60); const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`.replace('.', ',');
};
const parseTime = (str) => {
  const p = String(str).trim().replace(',', '.').split(':');
  const n = p.length === 2 ? (+p[0]) * 60 + (+p[1]) : +p[0];
  return Number.isFinite(n) ? n : NaN;
};

// моно-сведение (для волны и для WAV)
function mono(buf, from = 0, to = buf.length) {
  const out = new Float32Array(Math.max(0, to - from));
  const n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const d = buf.getChannelData(c);
    for (let i = from; i < to; i++) out[i - from] += d[i] / n;
  }
  return out;
}

// Кусок звука → WAV (моно, 16 бит, частота как у буфера). 30 с при 48 кГц ≈ 2,8 МБ.
export function encodeWav(buf, start, end) {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(start * sr)); const b = Math.min(buf.length, Math.ceil(end * sr));
  const pcm = mono(buf, a, b);
  // мягкие края, чтобы не щёлкало на срезе
  const fade = Math.min(Math.floor(sr * 0.006), pcm.length >> 1);
  for (let i = 0; i < fade; i++) { const k = i / fade; pcm[i] *= k; pcm[pcm.length - 1 - i] *= k; }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return bytes;
}

// Открыть редактор. Возвращает Promise<{ name, start, end } | null>.
// play(start, end) — проиграть кусок у себя, возвращает функцию «стоп»; maxLen — предел длины фрагмента, с.
export function openSfxEditor({ buffer, name, start = 0, end = buffer.duration, maxLen = 30, canRename = true, title = 'Фрагмент звука', play }) {
  return new Promise((resolve) => {
    const dur = buffer.duration;
    const S = { a: Math.max(0, Math.min(start, dur)), b: Math.max(0, Math.min(end, dur)), v0: 0, v1: dur, playing: null, playStart: 0, raf: 0 };
    if (S.b - S.a > maxLen) S.b = S.a + maxLen;
    if (S.b <= S.a) S.b = Math.min(dur, S.a + Math.min(maxLen, dur));
    // длинная запись — сразу приближаем к выделению
    if (dur > 90) { const pad = Math.max(2, (S.b - S.a) * 0.6); S.v0 = Math.max(0, S.a - pad); S.v1 = Math.min(dur, S.b + pad); }

    const data = mono(buffer);
    const sr = buffer.sampleRate;

    const canvas = h('canvas', { class: 'sfxe-wave' });
    const sel = h('div', { class: 'sfxe-sel' });
    const hA = h('div', { class: 'sfxe-handle a', title: 'Начало' });
    const hB = h('div', { class: 'sfxe-handle b', title: 'Конец' });
    const head = h('div', { class: 'sfxe-head', hidden: true });
    const stage = h('div', { class: 'sfxe-stage' }, canvas, sel, hA, hB, head);
    const inA = h('input', { type: 'text', class: 'sfxe-time', spellcheck: 'false' });
    const inB = h('input', { type: 'text', class: 'sfxe-time', spellcheck: 'false' });
    const lenEl = h('b');
    const viewEl = h('small', { class: 'sfxe-view' });
    const nameIn = h('input', { type: 'text', maxlength: 60, value: name || '' });
    const playBtn = h('button', { class: 'btn small', type: 'button' }, ico('play'), 'Прослушать');
    const fitBtn = h('button', { class: 'btn small ghost', type: 'button', 'data-tip': 'Показать всю запись' }, 'Вся запись');
    const zoomBtn = h('button', { class: 'btn small ghost', type: 'button', 'data-tip': 'Приблизить к выделенному куску' }, 'К выделению');
    const okBtn = h('button', { class: 'btn primary', type: 'button' }, 'Сохранить');
    const cancelBtn = h('button', { class: 'btn', type: 'button' }, 'Отмена');

    const card = h('div', { class: 'sfxe-card', role: 'dialog' },
      h('div', { class: 'sfxe-top' }, h('b', { text: title }), h('small', { text: `Вся запись — ${fmt(dur)}. Звук не длиннее ${maxLen} с` })),
      canRename ? h('label', { class: 'field' }, h('span', { text: 'Название' }), nameIn) : null,
      stage,
      h('div', { class: 'sfxe-bar' }, viewEl, h('span', { class: 'grow' }), fitBtn, zoomBtn),
      h('div', { class: 'sfxe-row' },
        h('label', {}, h('span', { text: 'Начало' }), inA),
        h('label', {}, h('span', { text: 'Конец' }), inB),
        h('div', { class: 'sfxe-len' }, h('span', { text: 'Длина' }), lenEl),
        h('span', { class: 'grow' }),
        playBtn),
      h('small', { class: 'sfxe-hint', text: 'Тяните ручки или кликните по волне. Колёсико — приблизить, Shift+колёсико — сдвинуть' }),
      h('div', { class: 'sfxe-foot' }, cancelBtn, okBtn));
    const overlay = h('div', { class: 'sfxe-overlay' }, card);
    document.body.append(overlay);

    // ---------- рисование ----------
    const x2t = (x) => S.v0 + (x / stage.clientWidth) * (S.v1 - S.v0);
    const t2x = (t) => ((t - S.v0) / (S.v1 - S.v0)) * stage.clientWidth;
    function drawWave() {
      const w = stage.clientWidth; const hgt = stage.clientHeight; const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = hgt + 'px';
      const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hgt);
      const css = getComputedStyle(card);
      const col = css.getPropertyValue('--text3').trim() || '#888';
      const colSel = css.getPropertyValue('--acc1').trim() || '#9af';
      const i0 = Math.floor(S.v0 * sr); const i1 = Math.ceil(S.v1 * sr);
      const per = Math.max(1, (i1 - i0) / w);
      let peak = 0.0001;
      for (let x = 0; x < w; x++) {
        const a = Math.floor(i0 + x * per); const b = Math.min(data.length, Math.floor(i0 + (x + 1) * per));
        let m = 0; const step = Math.max(1, Math.floor((b - a) / 400));
        for (let i = a; i < b; i += step) { const v = Math.abs(data[i]); if (v > m) m = v; }
        if (m > peak) peak = m;
      }
      for (let x = 0; x < w; x++) {
        const a = Math.floor(i0 + x * per); const b = Math.min(data.length, Math.max(a + 1, Math.floor(i0 + (x + 1) * per)));
        let m = 0; const step = Math.max(1, Math.floor((b - a) / 400));
        for (let i = a; i < b; i += step) { const v = Math.abs(data[i]); if (v > m) m = v; }
        const t = S.v0 + (x / w) * (S.v1 - S.v0);
        const y = Math.max(1, (m / peak) * (hgt / 2 - 4));
        g.fillStyle = t >= S.a && t <= S.b ? colSel : col;
        g.fillRect(x, hgt / 2 - y, 1, y * 2);
      }
    }
    function layout() {
      const xa = t2x(S.a); const xb = t2x(S.b);
      sel.style.left = xa + 'px'; sel.style.width = Math.max(0, xb - xa) + 'px';
      hA.style.left = xa + 'px'; hB.style.left = xb + 'px';
      hA.hidden = xa < -6 || xa > stage.clientWidth + 6; hB.hidden = xb < -6 || xb > stage.clientWidth + 6;
      if (document.activeElement !== inA) inA.value = fmt(S.a);
      if (document.activeElement !== inB) inB.value = fmt(S.b);
      lenEl.textContent = (S.b - S.a).toFixed(2).replace('.', ',') + ' с';
      viewEl.textContent = S.v1 - S.v0 < dur - 0.01 ? `Видно ${fmt(S.v0)} — ${fmt(S.v1)}` : 'Видна вся запись';
    }
    const redraw = () => { drawWave(); layout(); };

    // ---------- правка выделения ----------
    function setA(t) { S.a = Math.max(0, Math.min(t, S.b - 0.05)); if (S.b - S.a > maxLen) S.b = S.a + maxLen; stopPlay(); redraw(); }
    function setB(t) { S.b = Math.min(dur, Math.max(t, S.a + 0.05)); if (S.b - S.a > maxLen) S.a = S.b - maxLen; stopPlay(); redraw(); }
    function drag(which, e) {
      e.preventDefault();
      const move = (ev) => { const r = stage.getBoundingClientRect(); const t = x2t(Math.max(0, Math.min(r.width, ev.clientX - r.left))); if (which === 'a') setA(t); else setB(t); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
      move(e);
    }
    hA.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag('a', e); });
    hB.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag('b', e); });
    stage.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect(); const t = x2t(e.clientX - r.left);
      drag(Math.abs(t - S.a) <= Math.abs(t - S.b) ? 'a' : 'b', e);
    });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const span = S.v1 - S.v0;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = ((e.shiftKey ? e.deltaY : e.deltaX) / stage.clientWidth) * span;
        let v0 = Math.max(0, Math.min(dur - span, S.v0 + d)); S.v0 = v0; S.v1 = v0 + span;
      } else {
        const r = stage.getBoundingClientRect(); const t = x2t(e.clientX - r.left);
        const k = e.deltaY > 0 ? 1.25 : 0.8;
        const ns = Math.max(0.2, Math.min(dur, span * k));
        let v0 = t - ((t - S.v0) / span) * ns; v0 = Math.max(0, Math.min(dur - ns, v0));
        S.v0 = v0; S.v1 = v0 + ns;
      }
      redraw();
    }, { passive: false });
    fitBtn.onclick = () => { S.v0 = 0; S.v1 = dur; redraw(); };
    zoomBtn.onclick = () => { const pad = Math.max(0.3, (S.b - S.a) * 0.25); S.v0 = Math.max(0, S.a - pad); S.v1 = Math.min(dur, S.b + pad); redraw(); };
    const commitTime = (inp, set) => { const t = parseTime(inp.value); if (Number.isFinite(t)) set(t); else layout(); };
    inA.addEventListener('change', () => commitTime(inA, setA));
    inB.addEventListener('change', () => commitTime(inB, setB));
    for (const inp of [inA, inB]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });

    // ---------- прослушивание ----------
    function stopPlay() {
      if (S.playing) { try { S.playing(); } catch (_) { /* ignore */ } S.playing = null; }
      cancelAnimationFrame(S.raf); head.hidden = true;
      playBtn.replaceChildren(ico('play'), 'Прослушать');
    }
    playBtn.onclick = () => {
      if (S.playing) { stopPlay(); return; }
      S.playing = play(S.a, S.b, () => stopPlay());
      S.playStart = performance.now();
      playBtn.replaceChildren(ico('pause'), 'Стоп');
      const tick = () => {
        const t = S.a + (performance.now() - S.playStart) / 1000;
        if (t > S.b || !S.playing) { head.hidden = true; return; }
        head.hidden = false; head.style.left = t2x(t) + 'px';
        S.raf = requestAnimationFrame(tick);
      };
      S.raf = requestAnimationFrame(tick);
    };

    // ---------- закрытие ----------
    const ro = new ResizeObserver(() => redraw()); ro.observe(stage);
    function close(result) {
      stopPlay(); ro.disconnect();
      removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    }
    addEventListener('keydown', onKey, true);
    cancelBtn.onclick = () => close(null); // клик мимо карточки не закрывает — выбранный кусок не потеряется
    okBtn.onclick = () => close({ name: (nameIn.value || name || 'Звук').trim().slice(0, 60), start: +S.a.toFixed(3), end: +S.b.toFixed(3) });
    requestAnimationFrame(redraw);
    (canRename ? nameIn : playBtn).focus();
  });
}
