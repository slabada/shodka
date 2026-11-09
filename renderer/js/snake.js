// Змейка — спрятанная игра: двойной щелчок по значку «С» в левом верхнем углу окна.
// Плавная: между шагами змейка не прыгает по клеткам, а ползёт — кадры дорисовываются между шагами.
// Стрелки или WASD — повернуть, пробел — пауза, Enter — заново, Esc — закрыть.

const COLS = 24, ROWS = 18, CELL = 22;
const W = COLS * CELL, H = ROWS * CELL;
const KEY_BEST = 'skhodka.snake.best';
const START_SPEED = 7.5, MAX_SPEED = 17;   // шагов в секунду
const BONUS_EVERY = 5, BONUS_MS = 6500;    // каждая пятая еда приносит бонус на 6,5 секунды игрового времени
const RESTART_PAUSE = 450;                 // после проигрыша столько мс клавиши не перезапускают игру — чтобы не начать заново случайно

let dlg, canvas, ctx, overlay, scoreEl, bestEl, board, grid;
let opts = {};
let st = null;                 // состояние игры
let raf = 0, lastFrame = 0, acc = 0, dpr = 1;
let ownAudio = null;

const DIRS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const opposite = (a, b) => a[0] === -b[0] && a[1] === -b[1];

function loadBest() { try { return Number(localStorage.getItem(KEY_BEST)) || 0; } catch (_) { return 0; } }
function saveBest(v) { try { localStorage.setItem(KEY_BEST, String(v)); } catch (_) { /* хранилища может не быть — рекорд просто не запомнится */ } }

function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function svgIcon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg'); const u = document.createElementNS(NS, 'use');
  u.setAttribute('href', '#i-' + name); s.append(u); return s;
}

function build() {
  dlg = mk('dialog', 'snake-dlg'); dlg.id = 'snake';
  const wrap = mk('div', 'sn-wrap');
  const head = mk('div', 'sn-head');
  const sc = mk('div', 'sn-score'); sc.append(mk('span', null, 'Счёт'), scoreEl = mk('b', null, '0'));
  const bs = mk('div', 'sn-score'); bs.append(mk('span', null, 'Рекорд'), bestEl = mk('b', null, String(loadBest())));
  const close = mk('button', 'icon-btn sn-close'); close.type = 'button'; close.setAttribute('aria-label', 'Закрыть'); close.append(svgIcon('x'));
  close.onclick = () => dlg.close();
  head.append(mk('div', 'sn-title', 'Змейка'), sc, bs, close);
  board = mk('div', 'sn-board');
  canvas = mk('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Поле змейки');
  ctx = canvas.getContext('2d');
  overlay = mk('div', 'sn-overlay');
  board.append(canvas, overlay);
  const foot = mk('div', 'sn-foot', 'Стрелки или WASD — повернуть · Пробел — пауза · Esc — закрыть');
  wrap.append(head, board, foot);
  dlg.append(wrap);
  document.getElementById('app').append(dlg);

  // клавиши слушаем у всего окна: после щелчка мышью фокус может уйти с поля, а игра должна слушаться
  document.addEventListener('keydown', onKey);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // щелчок мимо окна — закрыть, как у остальных окон
  dlg.addEventListener('close', () => { if (st && st.status === 'run') setStatus('pause'); stopLoop(); });
  board.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (st.status === 'ready' || st.status === 'pause') setStatus('run');
    canvas.focus();
  });
  window.addEventListener('blur', () => { if (dlg.open && st && st.status === 'run') setStatus('pause'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && st && st.status === 'run') setStatus('pause'); });
}

// чёткая картинка на любом мониторе: внутренний размер холста под плотность пикселей экрана
function fitCanvas() {
  const d = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  if (d === dpr && grid) return;
  dpr = d;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // едва заметная сетка точек рисуется один раз и потом просто копируется
  grid = document.createElement('canvas');
  grid.width = canvas.width; grid.height = canvas.height;
  const g = grid.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { g.beginPath(); g.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, 1, 0, Math.PI * 2); g.fill(); }
}

// ---------------- игра ----------------
function newGame() {
  const y0 = Math.floor(ROWS / 2), x0 = Math.floor(COLS / 2) - 4;
  const snake = [{ x: x0 + 2, y: y0 }, { x: x0 + 1, y: y0 }, { x: x0, y: y0 }];
  st = {
    snake, prev: snake.map((p) => ({ ...p })), dir: [1, 0], queue: [], grow: 0,
    food: null, bonus: null, score: 0, eaten: 0, speed: START_SPEED, clock: 0,
    status: 'ready', t: 1, particles: [], deadAt: 0, best: loadBest(), record: false, won: false,
  };
  acc = 0;
  placeFood();
  hud(true);
  setStatus('ready');
}

function freeCell() {
  const busy = new Set(st.snake.map((p) => p.x + ',' + p.y));
  if (st.food) busy.add(st.food.x + ',' + st.food.y);
  if (st.bonus) busy.add(st.bonus.x + ',' + st.bonus.y);
  for (let i = 0; i < 500; i++) {
    const c = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    if (!busy.has(c.x + ',' + c.y)) return c;
  }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!busy.has(x + ',' + y)) return { x, y };
  return null;
}
function placeFood() { st.food = null; st.food = freeCell(); }
function placeBonus() { const c = freeCell(); if (c) st.bonus = { ...c, until: st.clock + BONUS_MS }; }

// поворот в очередь: два быстрых нажатия подряд (например, вверх и сразу влево) выполнятся по одному за шаг
function queueTurn(d) {
  const q = st.queue, last = q.length ? q[q.length - 1] : st.dir;
  if (same(d, last) || opposite(d, last)) return; // туда же или назад в себя — не поворот
  if (q.length < 3) q.push(d.slice());
}

// Отзывчивость: если поворот нажали в самом начале шага (голова только-только покинула клетку),
// шаг переигрывается в новую сторону — змейка поворачивает сразу, а не со следующей клетки.
const GRACE = 0.4; // доля шага, в которую поворот ещё успевает «на эту клетку»
function tryLateTurn(d) {
  const s = st, u = s.undo;
  if (!u || s.queue.length || s.t > GRACE || u.ate || u.turned) return false;
  if (same(d, u.stepDir) || opposite(d, u.stepDir)) return false;
  s.snake = u.snake.map((p) => ({ ...p })); s.grow = u.grow; s.dir = d.slice();
  step();
  if (s.undo) s.undo.turned = true; // второй поворот в этом же шаге — уже в очередь (так работает быстрый разворот)
  return true;
}

function step() {
  const s = st;
  const before = s.dir;
  if (s.queue.length) s.dir = s.queue.shift();
  const head = s.snake[0];
  const nh = { x: head.x + s.dir[0], y: head.y + s.dir[1] };
  s.undo = { snake: s.snake.map((p) => ({ ...p })), grow: s.grow, stepDir: s.dir, turned: !same(before, s.dir), ate: false };
  s.prev = s.snake.map((p) => ({ ...p }));
  if (nh.x < 0 || nh.y < 0 || nh.x >= COLS || nh.y >= ROWS) return die();
  const eatFood = s.food && nh.x === s.food.x && nh.y === s.food.y;
  const eatBonus = s.bonus && nh.x === s.bonus.x && nh.y === s.bonus.y;
  const tailMoves = s.grow === 0 && !eatFood && !eatBonus; // хвост уползёт и освободит свою клетку
  const body = tailMoves ? s.snake.slice(0, -1) : s.snake;
  if (body.some((p) => p.x === nh.x && p.y === nh.y)) return die();
  s.snake.unshift(nh);
  if (eatFood || eatBonus) s.undo.ate = true;
  if (eatFood) {
    s.score += 1; s.eaten += 1; s.grow += 1;
    burst(nh, [198, 173, 255]); sound('eat');
    s.speed = Math.min(MAX_SPEED, START_SPEED + s.eaten * 0.28);
    if (s.eaten % BONUS_EVERY === 0 && !s.bonus) placeBonus();
  } else if (eatBonus) {
    s.score += 5; s.grow += 3; s.bonus = null;
    burst(nh, [255, 142, 154], 18); sound('bonus');
  }
  if (s.grow > 0) s.grow -= 1; else s.snake.pop();
  if (eatFood) { placeFood(); if (!s.food) return die(true); } // всё поле занято — это победа
  hud();
}

function die(won = false) {
  const s = st;
  s.undo = null;
  s.prev = s.snake.map((p) => ({ ...p })); s.t = 1; s.queue = [];
  s.deadAt = performance.now(); s.won = won;
  if (s.score > s.best) { s.best = s.score; s.record = true; saveBest(s.score); }
  hud();
  sound(won ? 'bonus' : 'die');
  if (!won) { board.classList.remove('shake'); void board.offsetWidth; board.classList.add('shake'); }
  setStatus('over');
}

let shownScore = -1;
function hud(reset) {
  if (st.score !== shownScore && !reset && shownScore >= 0) { scoreEl.classList.remove('pop'); void scoreEl.offsetWidth; scoreEl.classList.add('pop'); }
  shownScore = st.score;
  scoreEl.textContent = String(st.score);
  bestEl.textContent = String(Math.max(st.best, st.score));
}

function points(n) {
  const d = n % 10, dd = n % 100;
  return d === 1 && dd !== 11 ? 'очко' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'очка' : 'очков';
}

function restart() { newGame(); setStatus('run'); canvas.focus(); }

function setStatus(status) {
  st.status = status;
  overlay.hidden = status === 'run';
  overlay.replaceChildren();
  dlg.dataset.status = status;
  if (status === 'ready') {
    overlay.append(mk('div', 'sn-big', 'Готовы?'), mk('div', 'sn-sub', 'Нажмите любую стрелку или W A S D'));
    if (st.best > 0) overlay.append(mk('div', 'sn-hint', `Ваш рекорд — ${st.best}`));
  } else if (status === 'pause') {
    overlay.append(mk('div', 'sn-big', 'Пауза'), mk('div', 'sn-sub', 'Пробел или стрелка — продолжить'));
  } else if (status === 'over') {
    overlay.append(mk('div', 'sn-big', st.won ? 'Поле заполнено — победа!' : 'Игра окончена'),
      st.record ? mk('div', 'sn-sub sn-new', `Новый рекорд — ${st.score} ${points(st.score)}!`)
        : mk('div', 'sn-sub', `${st.score} ${points(st.score)} · рекорд ${st.best}`));
    const btns = mk('div', 'sn-btns');
    const again = mk('button', 'btn primary', 'Ещё раз'); again.type = 'button'; again.onclick = restart;
    btns.append(again);
    if (opts.onShare && st.score > 0 && (!opts.canShare || opts.canShare())) {
      const share = mk('button', 'btn sn-share', 'Похвастаться в чате'); share.type = 'button';
      const { score, record, best } = st;
      share.onclick = async () => {
        share.disabled = true; share.textContent = 'Отправляю…';
        const ok = await Promise.resolve().then(() => opts.onShare(score, record, best)).catch(() => false);
        share.textContent = ok === false ? 'Не отправилось' : 'Отправлено в общий чат';
        if (ok === false) setTimeout(() => { if (share.isConnected) { share.disabled = false; share.textContent = 'Похвастаться в чате'; } }, 2500);
      };
      btns.append(share);
    }
    overlay.append(btns, mk('div', 'sn-hint', 'Enter или пробел — ещё раз'));
    // кнопку «Ещё раз» делаем выбранной не сразу — иначе нажатие, начатое ещё в игре, сразу перезапустит её
    setTimeout(() => { if (st.status === 'over' && again.isConnected && dlg.open) again.focus(); }, RESTART_PAUSE);
  }
}

function onKey(e) {
  if (!dlg.open || !st) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const s = st;
  const d = DIRS[e.code];
  if (d) {
    e.preventDefault();
    if (s.status === 'over') return;
    if (s.status === 'ready' || s.status === 'pause') {
      if (s.status === 'ready') {
        if (!opposite(d, s.dir)) s.dir = d.slice();
        acc = (1000 / s.speed) * 0.75; // первый шаг — почти сразу после нажатия
      } else queueTurn(d);
      setStatus('run'); canvas.focus();
      return;
    }
    if (!e.repeat && !tryLateTurn(d)) queueTurn(d);
    return;
  }
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON' && dlg.contains(document.activeElement);
    if (s.status === 'over' && onButton) return; // выбранную кнопку нажмёт сам браузер
    e.preventDefault();
    if (e.repeat) return;
    if (s.status === 'run') { if (e.code === 'Space') setStatus('pause'); }
    else if (s.status === 'over') { if (performance.now() - s.deadAt > RESTART_PAUSE) restart(); }
    else { setStatus('run'); canvas.focus(); }
  }
}

// ---------------- отрисовка ----------------
const lerp = (a, b, t) => a + (b - a) * t;
const px = (p) => p.x * CELL + CELL / 2, py = (p) => p.y * CELL + CELL / 2;

function burst(cell, rgb, n = 10) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
    st.particles.push({ x: px(cell), y: py(cell), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, rgb, r: 1.5 + Math.random() * 2 });
  }
}

function draw(now, dt) {
  const s = st;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(grid, 0, 0, W, H);

  // еда: мягко светится и «дышит»
  if (s.food) glowDot(px(s.food), py(s.food), CELL * 0.27 * (1 + 0.09 * Math.sin(now / 160)), [198, 173, 255]);
  // бонус: коралловый, кольцо вокруг показывает, сколько ему осталось
  if (s.bonus) {
    const left = Math.max(0, Math.min(1, (s.bonus.until - s.clock) / BONUS_MS));
    const bx = px(s.bonus), by = py(s.bonus);
    glowDot(bx, by, CELL * 0.3 * (1 + 0.12 * Math.sin(now / 110)), [255, 142, 154]);
    ctx.strokeStyle = 'rgba(255, 142, 154, 0.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(bx, by, CELL * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
  }

  // змейка: голова и хвост ползут между клетками, изгибы — точно по клеткам
  const t = s.t, cur = s.snake, prev = s.prev;
  const pts = [[lerp(px(prev[0]), px(cur[0]), t), lerp(py(prev[0]), py(cur[0]), t)]];
  for (let i = 1; i < cur.length; i++) pts.push([px(cur[i]), py(cur[i])]);
  const pt = prev[prev.length - 1], ct = cur[cur.length - 1];
  pts.push([lerp(px(pt), px(ct), t), lerp(py(pt), py(ct), t)]);
  const dead = s.status === 'over' && !s.won;
  const [hx, hy] = pts[0], [tx, ty] = pts[pts.length - 1];
  const grad = ctx.createLinearGradient(hx, hy, tx === hx && ty === hy ? tx + 1 : tx, ty);
  if (dead) { grad.addColorStop(0, '#FF9AA8'); grad.addColorStop(1, '#C9677F'); } else { grad.addColorStop(0, '#B3BEFF'); grad.addColorStop(1, '#C6ADFF'); }
  ctx.save();
  ctx.shadowColor = dead ? 'rgba(255, 142, 154, 0.45)' : 'rgba(163, 176, 255, 0.5)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = grad; ctx.lineWidth = CELL * 0.64; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
  // голова и глаза
  ctx.fillStyle = dead ? '#FFB3BE' : '#C2CBFF';
  ctx.beginPath(); ctx.arc(hx, hy, CELL * 0.37, 0, Math.PI * 2); ctx.fill();
  const [dx, dy] = s.dir;
  const ex = -dy, ey = dx; // поперёк движения
  ctx.fillStyle = '#171833';
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(hx + dx * CELL * 0.12 + ex * sgn * CELL * 0.15, hy + dy * CELL * 0.12 + ey * sgn * CELL * 0.15, dead ? 1.2 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // искры от съеденного
  for (const p of s.particles) {
    p.life -= dt / 520; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vx *= 0.96; p.vy *= 0.96;
    if (p.life <= 0) continue;
    ctx.fillStyle = `rgba(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]}, ${p.life})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life + 0.5, 0, Math.PI * 2); ctx.fill();
  }
  s.particles = s.particles.filter((p) => p.life > 0);
}

function glowDot(x, y, r, rgb) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
  g.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`);
  g.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgb(${Math.min(255, rgb[0] + 30)}, ${Math.min(255, rgb[1] + 30)}, ${Math.min(255, rgb[2] + 20)})`;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function advance(dt) {
  const s = st;
  if (s.status !== 'run') return;
  s.clock += dt;
  if (s.bonus && s.clock >= s.bonus.until) s.bonus = null;
  acc += dt;
  while (s.status === 'run' && acc >= 1000 / s.speed) { acc -= 1000 / s.speed; step(); }
  if (s.status === 'run') s.t = Math.min(1, acc * s.speed / 1000);
}
let manual = false; // для автотестов: время идёт только по команде
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(100, lastFrame ? now - lastFrame : 16);
  lastFrame = now;
  if (!manual) advance(dt);
  draw(now, dt);
}
function startLoop() { if (!raf) { lastFrame = 0; raf = requestAnimationFrame(frame); } }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

// ---------------- звук: тихие короткие сигналы ----------------
function audio() {
  let c = null;
  try { c = opts.audio ? opts.audio() : null; } catch (_) { c = null; }
  if (!c) c = ownAudio = ownAudio || new AudioContext();
  if (c.state === 'suspended') c.resume().catch(() => {});
  return c;
}
function sound(kind) {
  if (opts.soundsOn && !opts.soundsOn()) return;
  try {
    const ac = audio();
    const t0 = ac.currentTime;
    const tone = (f1, f2, start, dur, vol = 0.05, type = 'sine') => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f1, t0 + start); o.frequency.exponentialRampToValueAtTime(f2, t0 + start + dur);
      g.gain.setValueAtTime(0.0001, t0 + start); g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g); g.connect(ac.destination); o.start(t0 + start); o.stop(t0 + start + dur + 0.02);
    };
    if (kind === 'eat') tone(660, 990, 0, 0.08);
    else if (kind === 'bonus') { tone(700, 1050, 0, 0.08); tone(1050, 1400, 0.08, 0.1); }
    else if (kind === 'die') tone(320, 110, 0, 0.32, 0.06, 'triangle');
  } catch (_) { /* без звука — не беда */ }
}

// ---------------- снаружи ----------------
// opts: {
//   onShare(score, isRecord, best) → Promise<boolean> — отправить счёт в чат (кнопка видна, только если передано),
//   canShare() → boolean — можно ли сейчас отправить (например, есть ли связь с сервером),
//   soundsOn() → boolean — включены ли звуки,
//   audio() → AudioContext — через какой звуковой выход играть (тот же, что выбран в настройках)
// }
export function openSnake(o = {}) {
  opts = o;
  if (!dlg) build();
  fitCanvas();
  if (!st || st.status === 'over') newGame();
  else if (st.status === 'run') setStatus('pause');
  else setStatus(st.status);
  if (!dlg.open) dlg.showModal();
  startLoop();
  canvas.focus();
}

// для автотестов
export const __snake = {
  state: () => st,
  put: (what, x, y) => { if (what === 'food') st.food = { x, y }; else st.bonus = { x, y, until: st.clock + BONUS_MS }; },
  manual: (on = true) => { manual = on; },
  tick: (ms) => advance(ms),
  stepMs: () => 1000 / st.speed,
};
