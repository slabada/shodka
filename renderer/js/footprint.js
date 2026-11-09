// Сходка во время показа экрана — как можно легче для компьютера стримера (lab/16-footprint).
// Окно «Сходки» в фоне (свёрнуто, в трее или не в фокусе — человек в игре), а вы показываете экран:
// окно ничего не перерисовывает — стоят анимации, превью своей демки, обновление плиток.
// Звук, WebRTC и подсчёт статистики работают как обычно.
import { log } from './log.js';

const api = window.api;

// Главный процесс сообщает состояние окна (main.js → 'win:state'): в фокусе ли, свёрнуто ли, видно ли.
// Свои события Chromium тут не помогают: фоновый режим окна выключен нарочно (main.js), иначе заикается звук.
const win = { focused: true, minimized: false, visible: true };
let sharing = false;
let bg = false;
const listeners = new Set();

export function isBackground() { return bg; }
export function onBackground(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function setSharing(on) { sharing = !!on; update(); }

function update() {
  const next = sharing && (!win.focused || win.minimized || !win.visible);
  if (next === bg) return;
  bg = next;
  document.body.classList.toggle('fp-bg', bg);
  log.debug('screen', bg ? 'Окно в фоне, идёт показ — окно не перерисовывается (анимации и превью на паузе)' : 'Окно снова на виду — анимации и превью работают');
  for (const cb of listeners) { try { cb(bg); } catch (_) { /* ignore */ } }
}

if (api.onWinState) api.onWinState((s) => { if (s) { Object.assign(win, s); update(); } });
