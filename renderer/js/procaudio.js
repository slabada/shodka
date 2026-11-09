// Звук компьютера без звука «Сходки»: помощник skh-audiocap.exe пишет звук через «loopback по процессам»
// Windows (исключая всё дерево процессов программы) и присылает сырые отсчёты float32. Здесь они
// превращаются в обычную аудиодорожку (MediaStreamTrackGenerator), которая идёт в трансляцию.
// Так голоса друзей не попадают в звук трансляции и на Windows 10, где Хром сам этого не умеет.
import { log } from './log.js';

const api = window.api;

export function processAudioAvailable() {
  return !!(api.procAudio && api.procAudio.available && typeof MediaStreamTrackGenerator !== 'undefined' && typeof AudioData !== 'undefined');
}

// opts.include — PID программы: только её звук (показ одного окна). Без него — весь звук компьютера, кроме «Сходки».
export async function startProcessAudio(opts = {}) {
  if (!processAudioAvailable()) throw new Error('недоступно в этой системе');
  const pa = api.procAudio;
  const r = await pa.start(opts.include ? { include: opts.include } : {});
  if (!r || !r.ok) throw new Error((r && r.reason) || 'помощник не запустился');
  const id = r.id;
  const gen = new MediaStreamTrackGenerator({ kind: 'audio' });
  const writer = gen.writable.getWriter();
  let rate = 0, ch = 2, fmt = '', ready = false, stopped = false, exited = false;
  const lines = [];
  let chunks = []; let have = 0; let ts = 0; let frames = 0;
  let onReady, onFail;
  const readyP = new Promise((res, rej) => { onReady = res; onFail = rej; });

  // 1.19.3: ровно ли идёт звук компьютера (у irritat 24.10 «звук рябит», а в журналах ничего не было). Три признака:
  //  - провалы тишины посреди звука: помощник досылает тишину, когда Windows 30 мс и дольше не даёт звук;
  //  - звука пришло меньше, чем прошло времени (короткие пропуски — помощник их не заполняет);
  //  - звук доходит до окна рывками — не успевает компьютер (окно занято, звук копится).
  // Раз в 30 с — итог; в журнал, только если что-то заметно (не чаще раза в минуту)
  const W = { at: 0, frames: 0, drops: 0, late: 0, maxGap: 0, zr: 0, env: 0, after: null, lastArrive: 0, warnAt: -Infinity };
  const LOUD = 0.003; // ~ −50 дБ: тише — это уже не «посреди звука»
  // по отсчётам: провал — 20–300 мс точной тишины, когда звук перед ним (последние ~5 мс) и после него (первые 5 мс)
  // громкий; звук, который затих сам, сюда не попадает. Блоки по 10 мс не годятся: пауза редко начинается ровно на их границе
  const scan = (d) => {
    const k = Math.exp(-1 / (0.005 * rate)); const minZ = rate * 0.02; const maxZ = rate * 0.3; const after = rate * 0.005;
    for (let i = 0; i < d.length; i += ch) {
      let a = 0; for (let c = 0; c < ch; c++) a = Math.max(a, Math.abs(d[i + c]));
      if (a === 0) { W.zr++; continue; }
      if (W.zr) { if (W.zr >= minZ && W.zr <= maxZ && W.env > LOUD) W.after = { n: 0, sum: 0 }; W.zr = 0; }
      W.env = W.env * k + a * (1 - k);
      if (W.after) {
        W.after.n++; W.after.sum += a;
        if (W.after.n >= after) { if (W.after.sum / W.after.n > LOUD) W.drops++; W.after = null; }
      }
    }
  };
  const review = () => {
    const now = performance.now();
    if (!W.at) { W.at = now; W.frames = 0; return; }
    const sec = (now - W.at) / 1000;
    if (sec < 30) return;
    const short = Math.max(0, 1 - W.frames / (sec * rate)) * 100;
    const parts = [];
    const ru = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
    if (W.drops >= 6) parts.push(`${W.drops} ${ru(W.drops, 'провал', 'провала', 'провалов')} тишины посреди звука`);
    if (short > 2) parts.push(`звука пришло на ${short.toFixed(0)}% меньше, чем прошло времени`);
    if (W.late >= 3) parts.push(`${W.late} ${ru(W.late, 'раз', 'раза', 'раз')} звук задерживался в пути до окна (до ${Math.round(W.maxGap)} мс)`);
    log.debug('screen', `Звук компьютера за ${Math.round(sec)} с: провалов ${W.drops}, недостача ${short.toFixed(1)}%, задержек ${W.late} (до ${Math.round(W.maxGap)} мс)`);
    if (parts.length && gen.enabled && now - W.warnAt > 60000) {
      W.warnAt = now;
      log.warn('screen', `Звук компьютера в демке идёт с перебоями: за ${Math.round(sec)} с — ${parts.join(', ')}. Зрители слышат это как «рябь»`, { hint: W.late >= 3 && W.drops < 6 && short <= 2
        ? 'Не успевает компьютер: игра и демка грузят процессор. Для игр — кодек H.264 (Настройки → Показ экрана) или «Видеокартой, как OBS» (стрелка у кнопки показа).'
        : 'Windows отдаёт звук с пропусками — так бывает, когда компьютер перегружен (игра и сжатие демки процессором, особенно кодек AV1) или у устройства вывода необычная частота: например, 384 кГц у наушников — поставьте 48 кГц (Параметры звука → устройство → Свойства → Дополнительно).' });
    }
    W.at = now; W.frames = 0; W.drops = 0; W.late = 0; W.maxGap = 0;
  };

  const pump = () => {
    if (!ready || stopped) return;
    const per = Math.round(rate / 100) * ch * 4; // 10 мс
    if (have < per) return;
    const all = new Uint8Array(have);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const usable = have - (have % per);
    for (let off = 0; off < usable; off += per) {
      const n = per / (ch * 4);
      const data = new Float32Array(all.buffer.slice(off, off + per));
      scan(data);
      try {
        const ad = new AudioData({ format: 'f32', sampleRate: rate, numberOfFrames: n, numberOfChannels: ch, timestamp: ts, data });
        writer.write(ad).catch(() => { /* дорожку остановили */ });
      } catch (e) { if (!stopped) log.debug('screen', `Звук без «Сходки»: ${e.message}`); }
      frames += n; ts = Math.round(frames * 1e6 / rate);
    }
    chunks = usable < have ? [all.subarray(usable)] : []; have -= usable;
  };

  const offData = pa.onData((i, buf) => {
    if (i !== id || stopped) return;
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (ready) {
      const t = performance.now();
      if (W.lastArrive && W.at && t - W.lastArrive > 150) { W.late++; W.maxGap = Math.max(W.maxGap, t - W.lastArrive); }
      W.lastArrive = t; W.frames += u8.length / (ch * 4);
      review();
    }
    chunks.push(u8); have += u8.length;
    if (have > 48000 * 8 * 2 && !ready) { chunks = []; have = 0; } // не копим бесконечно до READY
    pump();
  });
  const offMsg = pa.onMsg((m) => {
    if (!m || m.id !== id) return;
    if (m.type === 'line') {
      lines.push(m.line);
      const mm = /^READY (\d+) (\d+) (\w+)/.exec(m.line);
      if (mm) { rate = +mm[1]; ch = +mm[2]; fmt = mm[3]; ready = true; onReady(); pump(); }
    } else if (m.type === 'exit') {
      exited = true;
      if (!ready) onFail(new Error(lines.filter((l) => /^ERR/.test(l)).pop() || m.error || `помощник завершился (код ${m.code})`));
      else if (!stopped) log.warn('screen', 'Запись звука без «Сходки» неожиданно остановилась — в трансляции пропал звук компьютера', { hint: 'Начните показ заново. Если повторится — пришлите журнал.' });
    }
  });
  const cleanup = () => {
    stopped = true; offData(); offMsg();
    if (!exited) pa.stop(id).catch(() => {});
    writer.close().catch(() => {}); try { gen.stop(); } catch (_) { /* ignore */ }
  };
  const timer = setTimeout(() => onFail(new Error('помощник не ответил за 5 с')), 5000);
  try { await readyP; } catch (e) { clearTimeout(timer); cleanup(); throw e; } finally { clearTimeout(timer); }

  const winLine = lines.find((l) => /^INFO windows/.test(l));
  gen._skhExcluded = true;
  gen._skhStop = cleanup;
  gen._skhInfo = { rate, ch, fmt, windows: winLine ? winLine.slice(13) : '', include: opts.include || 0 };
  if (opts.include) gen._skhWindowOnly = true;
  return gen;
}
