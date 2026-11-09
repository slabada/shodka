// «Отчёт о демке» — расчёты без браузера (проверяет test/demoreport.test.mjs).
// Сырые замеры WebRTC раз в секунду → посекундные значения → сводка по 5 с и за всё время →
// вывод простыми словами и записи для журнала (понятный текст + одна строка JSON для разработчика).

export const REPORT_SECS = 60;
export const JSON_MARK = 'DEMO-REPORT-JSON:';

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const delta = (b, a) => (num(b) != null && num(a) != null ? b - a : null);
// пара замеров с разных потоков (зритель переподключился, перешёл между «напрямую» и «через сервер»)
// или счётчики начались заново — это не секунда демки, а скачок: такую пару пропускаем (отчёт Egor2 22.10: −746 к/с)
const restarted = (a, b, keys) => a.id !== b.id || keys.some((k) => num(a[k]) != null && num(b[k]) != null && b[k] < a[k]);
const round = (x, d = 1) => (num(x) == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// выбранная пара адресов (как в rtc.js: по transport, иначе «успешная» с наибольшим трафиком)
function selectedPair(list, by) {
  const tr = list.find((s) => s.type === 'transport' && s.selectedCandidatePairId);
  if (tr) return by.get(tr.selectedCandidatePairId) || null;
  return list.filter((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')
    .sort((a, b) => (b.bytesReceived || 0) - (a.bytesReceived || 0))[0] || null;
}
function common(list, pathFn) {
  const by = new Map(list.map((s) => [s.id, s]));
  const pair = selectedPair(list, by);
  const l = pair && by.get(pair.localCandidateId); const r = pair && by.get(pair.remoteCandidateId);
  return { by, pair, path: l && r && pathFn ? pathFn(l, r) : null };
}

// ---- сырые замеры (из списка объектов getStats()) ----
// стример → зритель: исходящее видео демки
export function snapOut(list, t, pathFn) {
  const o = list.find((s) => s.type === 'outbound-rtp' && s.kind === 'video');
  if (!o) return null;
  const { by, pair, path } = common(list, pathFn);
  const rin = list.find((s) => s.type === 'remote-inbound-rtp' && s.kind === 'video');
  const src = list.find((s) => s.type === 'media-source' && s.kind === 'video');
  const codec = by.get(o.codecId);
  return {
    t, id: o.id, w: o.frameWidth, h: o.frameHeight, frames: o.framesEncoded, bytes: o.bytesSent, tgt: o.targetBitrate, qp: o.qpSum,
    lim: o.qualityLimitationReason, ld: o.qualityLimitationDurations || null, enc: o.encoderImplementation, pe: o.powerEfficientEncoder,
    key: o.keyFramesEncoded, nack: o.nackCount, pli: o.pliCount, encT: o.totalEncodeTime, rtx: o.retransmittedBytesSent,
    codec: codec ? codec.mimeType.replace('video/', '') : null,
    loss: rin ? rin.fractionLost : null, rtt: pair && num(pair.currentRoundTripTime) != null ? pair.currentRoundTripTime : rin ? rin.roundTripTime : null,
    aob: pair ? pair.availableOutgoingBitrate : null, path,
    srcW: src && src.width, srcH: src && src.height, srcFps: src && src.framesPerSecond,
  };
}
// зритель: входящее видео демки; view — что на экране у зрителя (размер окна демки, полный экран, приближение)
export function snapIn(list, t, pathFn, view = null) {
  const i = list.find((s) => s.type === 'inbound-rtp' && s.kind === 'video');
  if (!i) return null;
  const { by, pair, path } = common(list, pathFn);
  const codec = by.get(i.codecId);
  return {
    t, id: i.id, w: i.frameWidth, h: i.frameHeight, dec: i.framesDecoded, drop: i.framesDropped, recv: i.framesReceived, key: i.keyFramesDecoded,
    bytes: i.bytesReceived, qp: i.qpSum, frz: i.freezeCount, frzT: i.totalFreezesDuration, pau: i.pauseCount, pauT: i.totalPausesDuration,
    ifd: i.totalInterFrameDelay, ifd2: i.totalSquaredInterFrameDelay, jb: i.jitterBufferDelay, jbT: i.jitterBufferTargetDelay, jbN: i.jitterBufferEmittedCount,
    lost: i.packetsLost, got: i.packetsReceived, fec: i.fecPacketsReceived, fecDisc: i.fecPacketsDiscarded, nack: i.nackCount, pli: i.pliCount,
    decT: i.totalDecodeTime, jit: i.jitter, impl: i.decoderImplementation, pe: i.powerEfficientDecoder,
    codec: codec ? codec.mimeType.replace('video/', '') : null, rtt: pair ? pair.currentRoundTripTime : null, path, view,
  };
}

// ---- посекундные значения (разница двух замеров) ----
export function stepOut(a, b) {
  const dt = a && b ? (b.t - a.t) / 1000 : 0;
  if (!(dt > 0) || restarted(a, b, ['frames', 'bytes'])) return null;
  const fr = delta(b.frames, a.frames);
  const ld = (k) => (b.ld && a.ld ? delta(b.ld[k], a.ld[k]) : null);
  const qp = delta(b.qp, a.qp); const encT = delta(b.encT, a.encT);
  return {
    dt, w: b.w || 0, h: b.h || 0, fps: fr != null ? fr / dt : null,
    mbps: delta(b.bytes, a.bytes) != null ? (b.bytes - a.bytes) * 8 / dt / 1e6 : null,
    tgt: num(b.tgt) != null ? b.tgt / 1e6 : null,
    qp: fr > 0 && qp != null ? qp / fr : null, encMs: fr > 0 && encT != null ? encT / fr * 1000 : null,
    cpu: ld('cpu'), bw: ld('bandwidth'), oth: ld('other'), lim: b.lim || null,
    key: delta(b.key, a.key), nack: delta(b.nack, a.nack), pli: delta(b.pli, a.pli),
    rtx: delta(b.rtx, a.rtx) != null ? (b.rtx - a.rtx) * 8 / dt / 1e6 : null,
    loss: num(b.loss) != null ? b.loss * 100 : null, rtt: num(b.rtt) != null ? b.rtt * 1000 : null,
    aob: num(b.aob) != null ? b.aob / 1e6 : null,
    srcFps: num(b.srcFps), srcW: b.srcW || null, srcH: b.srcH || null,
    enc: b.enc || null, pe: b.pe == null ? null : !!b.pe, codec: b.codec, path: b.path,
  };
}
export function stepIn(a, b) {
  const dt = a && b ? (b.t - a.t) / 1000 : 0;
  if (!(dt > 0) || restarted(a, b, ['dec', 'bytes', 'frz', 'frzT', 'pau'])) return null;
  const dec = delta(b.dec, a.dec); const qp = delta(b.qp, a.qp); const decT = delta(b.decT, a.decT);
  const jbN = delta(b.jbN, a.jbN);
  const lost = delta(b.lost, a.lost); const got = delta(b.got, a.got);
  const fec = delta(b.fec, a.fec); const fecDisc = delta(b.fecDisc, a.fecDisc);
  const v = b.view; const va = a.view;
  // во сколько раз картинка на экране зрителя больше (>1) или меньше (<1) самого видео, в настоящих пикселях
  const scale = v && v.vw > 0 && v.vh > 0 && v.cw > 0 && v.ch > 0 ? Math.min(v.cw / v.vw, v.ch / v.vh) * (v.dpr || 1) : null;
  return {
    dt, w: b.w || 0, h: b.h || 0, fps: dec != null ? dec / dt : null,
    mbps: delta(b.bytes, a.bytes) != null ? (b.bytes - a.bytes) * 8 / dt / 1e6 : null,
    qp: dec > 0 && qp != null ? qp / dec : null, decMs: dec > 0 && decT != null ? decT / dec * 1000 : null,
    dec, drop: delta(b.drop, a.drop), recv: delta(b.recv, a.recv), key: delta(b.key, a.key),
    frz: delta(b.frz, a.frz), frzMs: delta(b.frzT, a.frzT) != null ? (b.frzT - a.frzT) * 1000 : null,
    pau: delta(b.pau, a.pau), pauMs: delta(b.pauT, a.pauT) != null ? (b.pauT - a.pauT) * 1000 : null,
    ifS: delta(b.ifd, a.ifd), ifQ: delta(b.ifd2, a.ifd2), // суммы задержек между кадрами — разброс считается в сводке
    jb: jbN > 0 && delta(b.jb, a.jb) != null ? (b.jb - a.jb) / jbN * 1000 : null,
    jbT: jbN > 0 && delta(b.jbT, a.jbT) != null ? (b.jbT - a.jbT) / jbN * 1000 : null,
    lost: lost != null ? Math.max(0, lost) : null, got, fec, fecUsed: fec != null && fecDisc != null ? Math.max(0, fec - fecDisc) : null,
    nack: delta(b.nack, a.nack), pli: delta(b.pli, a.pli),
    jit: num(b.jit) != null ? b.jit * 1000 : null, rtt: num(b.rtt) != null ? b.rtt * 1000 : null,
    scale, vdrop: v && va ? delta(v.dropped, va.dropped) : null, full: v ? !!v.full : null, zoom: v ? v.zoom || 1 : null,
    impl: b.impl || null, pe: b.pe == null ? null : !!b.pe, codec: b.codec, path: b.path,
  };
}

// ---- сводка: окна по 5 с и всё время ----
const AGG = {
  out: { avg: ['fps', 'mbps', 'tgt', 'qp', 'encMs', 'rtx', 'loss', 'rtt', 'aob', 'srcFps', 'maxBr', 'motion'], sum: ['key', 'nack', 'pli', 'cpu', 'bw', 'oth'], max: ['qp'], min: ['fps', 'mbps'],
    last: ['w', 'h', 'srcW', 'srcH', 'enc', 'pe', 'codec', 'path', 'lim', 'dp'] },
  in: { avg: ['fps', 'mbps', 'qp', 'decMs', 'jb', 'jbT', 'jit', 'rtt', 'scale', 'zoom'], sum: ['dec', 'drop', 'recv', 'key', 'frz', 'frzMs', 'pau', 'pauMs', 'ifS', 'ifQ', 'lost', 'got', 'fec', 'fecUsed', 'nack', 'pli', 'vdrop'],
    max: ['qp'], min: ['fps'], last: ['w', 'h', 'impl', 'pe', 'codec', 'path', 'full'] },
};
const R = { fps: 1, mbps: 2, tgt: 2, qp: 1, encMs: 1, rtx: 2, loss: 2, rtt: 0, aob: 2, srcFps: 1, maxBr: 2, decMs: 1, jb: 0, jbT: 0, jit: 1, scale: 2, zoom: 2, frzMs: 0, pauMs: 0, cpu: 1, bw: 1, oth: 1, ifS: 6, ifQ: 8 };

function aggregate(samples, kind) {
  const A = AGG[kind]; const r = { n: samples.length };
  const secs = samples.reduce((t, x) => t + (x.dt || 1), 0);
  r.secs = round(secs, 0);
  for (const k of A.avg) { const v = samples.map((x) => x[k]).filter((x) => num(x) != null); r[k] = v.length ? round(v.reduce((t, x) => t + x, 0) / v.length, R[k] ?? 1) : null; }
  for (const k of A.sum) { const v = samples.map((x) => x[k]).filter((x) => num(x) != null); r[k] = v.length ? round(v.reduce((t, x) => t + x, 0), R[k] ?? 0) : null; }
  for (const k of A.max) { const v = samples.map((x) => x[k]).filter((x) => num(x) != null); r[k + 'Max'] = v.length ? round(Math.max(...v), R[k] ?? 1) : null; }
  for (const k of A.min) { const v = samples.map((x) => x[k]).filter((x) => num(x) != null); r[k + 'Min'] = v.length ? round(Math.min(...v), R[k] ?? 1) : null; }
  for (const k of A.last) { const x = [...samples].reverse().find((s) => s[k] != null); r[k] = x ? x[k] : null; }
  if (kind === 'out') {
    // сколько времени кодировщик во что-то упирался: доля от записанного времени
    const share = (k) => (r[k] != null && secs > 0 ? round(Math.min(100, r[k] / secs * 100), 0) : null);
    r.limPct = { cpu: share('cpu'), bw: share('bw'), oth: share('oth') };
    const top = Object.entries(r.limPct).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])[0];
    r.lim = top && top[1] >= 20 ? { cpu: 'cpu', bw: 'bandwidth', oth: 'other' }[top[0]] : 'none';
    delete r.cpu; delete r.bw; delete r.oth;
  } else {
    // разброс задержки между кадрами (рывки): из сумм за весь отрезок, а не среднее посекундных
    const n = r.dec;
    if (n > 1 && r.ifS != null && r.ifQ != null) {
      r.ifdAvg = round(r.ifS / n * 1000, 1);
      r.ifdSd = round(Math.sqrt(Math.max(0, (r.ifQ - r.ifS * r.ifS / n) / n)) * 1000, 1);
    } else { r.ifdAvg = null; r.ifdSd = null; }
    delete r.ifS; delete r.ifQ;
    r.loss = r.lost != null && r.got != null && r.lost + r.got > 0 ? round(r.lost / (r.lost + r.got) * 100, 2) : null;
    r.dropPct = r.drop != null && r.recv > 0 ? round(r.drop / r.recv * 100, 1) : null;
  }
  return r;
}

// samples: [{ s (секунда от начала), dt, ...значения }]
export function summarize(samples, kind) {
  const ok = samples.filter(Boolean);
  const sum = aggregate(ok, kind);
  // в каких разрешениях шло видео и сколько секунд
  const res = {};
  for (const x of ok) if (x.w && x.h) { const k = `${x.w}x${x.h}`; res[k] = round((res[k] || 0) + (x.dt || 1), 0); }
  sum.res = res;
  const groups = new Map();
  for (const x of ok) { const g = Math.floor((x.s || 0) / 5); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
  const keep = kind === 'out' ? ['w', 'h', 'fps', 'mbps', 'tgt', 'qp', 'lim', 'loss', 'rtt', 'aob', 'motion', 'srcFps']
    : ['w', 'h', 'fps', 'mbps', 'qp', 'drop', 'frz', 'frzMs', 'ifdSd', 'jb', 'loss', 'fecUsed', 'scale'];
  const w5 = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([g, xs]) => {
    const a = aggregate(xs, kind); const o = { s: g * 5 };
    for (const k of keep) o[k] = a[k];
    return o;
  });
  return { sum, w5 };
}

// ---- ЦП самой «Сходки» (main/footprint.js → api.footprint, раз в секунду) ----
// samples: [{ s, procs: { main, window, gpu, audio, network, … } (% одного ядра), ours, sys: { total, max }, threads, bg }]
export function summarizeCpu(samples) {
  const ok = (samples || []).filter((x) => x && num(x.ours) != null);
  if (!ok.length) return null;
  const avg = (xs, f, d = 1) => { const v = xs.map(f).filter((x) => num(x) != null); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, d) : null; };
  const max = (f) => { const v = ok.map(f).filter((x) => num(x) != null); return v.length ? round(Math.max(...v), 1) : null; };
  const procs = {};
  for (const k of new Set(ok.flatMap((x) => Object.keys(x.procs || {})))) procs[k] = avg(ok, (x) => (x.procs || {})[k] || 0);
  const groups = new Map();
  for (const x of ok) { const g = Math.floor((x.s || 0) / 5); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
  const w5 = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([g, xs]) => ({ s: g * 5, ours: avg(xs, (x) => x.ours, 0), sys: avg(xs, (x) => x.sys && x.sys.total, 0) }));
  return {
    n: ok.length, ours: avg(ok, (x) => x.ours), oursMax: max((x) => x.ours), procs,
    sys: avg(ok, (x) => x.sys && x.sys.total, 0), sysMax: max((x) => x.sys && x.sys.total), coreMax: avg(ok, (x) => x.sys && x.sys.max, 0),
    memMb: avg(ok, (x) => x.memMb, 0), freeMb: (() => { const v = ok.map((x) => x.freeMb).filter((x) => num(x) != null); return v.length ? Math.min(...v) : null; })(),
    threads: ok[ok.length - 1].threads || null, bgPct: round(100 * ok.filter((x) => x.bg).length / ok.length, 0), w5,
  };
}
const PROC_RU = { main: 'главный (захват экрана)', window: 'окно (WebRTC, шумоподавление, интерфейс)', gpu: 'GPU-процесс (сжатие видеокартой, вывод)', audio: 'звук', network: 'сеть', capture: 'захват камеры', other: 'прочее' };
export function cpuLine(who, c) {
  if (!c) return null;
  const parts = Object.entries(c.procs || {}).filter(([, v]) => v >= 0.1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${PROC_RU[k] || k} ${fmt(v)}`);
  return `ЦП «Сходки» у ${who}: ${fmt(c.ours)}% одного ядра (пик ${fmt(c.oursMax)})${parts.length ? ` — ${parts.join(', ')}` : ''}`
    + ` · весь компьютер ${fmt(c.sys, 0)}% (пик ${fmt(c.sysMax, 0)}), самое загруженное ядро ${fmt(c.coreMax, 0)}%${c.threads ? ` · ${c.threads} потоков` : ''}`
    + `${c.bgPct ? ` · окно «Сходки» в фоне ${fmt(c.bgPct, 0)}% времени` : ''}`
    + `${c.memMb != null ? ` · память: «Сходка» ${fmt(c.memMb / 1024)} ГБ, свободно ${fmt((c.freeMb ?? 0) / 1024)} ГБ` : ''}`;
}

// ---- вывод простыми словами ----
const fmt = (x, d = 1) => (num(x) == null ? '?' : (Math.round(x * 10 ** d) / 10 ** d).toString().replace('.', ','));
// QP, после которого картинка заметно «мылится» (у кодеков разные шкалы)
const QP_BLUR = { H264: 36, VP8: 70, VP9: 150, AV1: 150, H265: 36 };
const PATH_RU = { direct: 'напрямую', lan: 'домашняя сеть', radmin: 'Radmin VPN', hamachi: 'Hamachi', relay: 'ретранслятор сервера', sfu: 'через сервер (размножитель)' };
// 1.16: «зритель» в отчёте стримера, который на самом деле — общий поток на сервер (размножитель)
export const SFU_OUT = 'сервер';
const who = (n) => (n === SFU_OUT ? 'сервер (размножитель)' : n);

// rep: { secs, streamer: { name, sys, state, out: { зритель: { sum } } } | null, viewers: { зритель: { sum, sys } | { missing } } }
// → до трёх строк [{ level: 'ok'|'warn'|'bad', text }]
export function verdict(rep) {
  const found = [];
  const add = (pri, level, text) => found.push({ pri: pri + (level === 'bad' ? 0 : 100), level, text });
  const st = rep.streamer;
  const outs = st ? Object.entries(st.out || {}).filter(([, x]) => x && x.sum && x.sum.n > 0) : [];
  const ins = Object.entries(rep.viewers || {}).filter(([, x]) => x && x.sum && x.sum.n > 0);
  const state = (st && st.state) || {};
  const wantFps = (state.target && state.target.fps) || 60;
  const hwH264 = st && st.sys && st.sys.codecs && st.sys.codecs.H264 && st.sys.codecs.H264.e === 'hw';
  const said = new Set(); // о ком уже сказали главное

  // 1. кодировщик стримера не успевает
  const cpu = outs.filter(([, x]) => (x.sum.limPct || {}).cpu >= 20);
  if (cpu.length) {
    const s = cpu[0][1].sum;
    // 1.19.2: совет — по выбранному кодеку: «H.264 — процессор» и «несколько ядер» выбирают нарочно, когда видеокарта
    // не сжимает, — «обновите драйвер» и «включите сжатие видеокартой» им не помогут
    const chosen = state.codec || '';
    const tip = chosen === 'H264SW' ? 'выбран «H.264 — процессор» (одно ядро): выберите «H.264 — сжатие на нескольких ядрах» или 30 кадров/с у демки, либо «Видеокартой, как OBS»'
      : chosen === 'H264MT' ? `не хватает даже нескольких ядер${state.multiCore === false ? ' (они включатся только после перезапуска «Сходки»)' : ''}: поставьте демке 30 кадров/с или 720p, либо «Видеокартой, как OBS»`
        : s.codec !== 'H264' ? 'включите сжатие видеокартой (кодек H.264)' : hwH264 ? 'видеокарта умеет H.264, но сжимает процессор: обновите драйвер видеокарты или попробуйте «Видеокартой, как OBS»' : 'видеокарта H.264 не сжимает: обновите её драйвер или снизьте разрешение и кадры';
    if (!s.pe) add(1, 'bad', `Процессор стримера не успевает сжимать видео (${s.enc || '?'}, ${s.codec || '?'}) — ${tip}`);
    else add(1, 'bad', `Видеокарта стримера не успевает сжимать видео (часто игра грузит её на 100%) — поставьте демке 30 кадров/с в Настройки → Показ экрана`);
  }
  // 1б. процессор стримера загружен почти полностью (игра + «Сходка»): демке и игре тесно
  const cpuS = st && st.cpu;
  if (cpuS && cpuS.sys >= 85) {
    add(1.5, cpuS.sys >= 95 ? 'bad' : 'warn', `Процессор стримера загружен на ${fmt(cpuS.sys, 0)}% — игре и демке тесно. «Сходка» берёт ${fmt(cpuS.ours)}% одного ядра`
      + `${(state.target || {}).fps > 30 ? ' — поставьте демке 30 кадров/с в Настройки → Показ экрана' : ''}`);
  }
  // 2. не хватает скорости: у всех — отдача стримера, у одного — канал до него
  // упор в скорость — это «мыло», только если картинка правда пережата (QP высокий) или разрешение снижено;
  // простой картинке и 0,7 Мбит/с хватает (отчёт 19.10: QP 16 — лучшее качество, а вывод был «мыло»)
  const blurry = (s) => s.qp >= (QP_BLUR[s.codec] || 36) || (s.h && s.srcH && s.h < s.srcH * 0.85);
  // 1.17.3: оценка канала всю запись росла — скорость ещё разгоняется после начала показа или переключения
  // «сервер / напрямую», а не упёрлась в интернет (отчёт 22.10 у Egor2: 5,8 → 7,8 Мбит/с сразу после переключения)
  const aobs = (x) => (x.w5 || []).map((w) => w.aob).filter((v) => v > 0);
  const ramping = (x) => {
    const a = aobs(x);
    if (a.length < 4) return false;
    for (let i = 1, top = a[0]; i < a.length; top = Math.max(top, a[i]), i++) if (a[i] < top * 0.85) return false;
    return a[a.length - 1] >= a[0] * 1.25;
  };
  const bwAll = outs.filter(([, x]) => (x.sum.limPct || {}).bw >= 20 && blurry(x.sum));
  const ramp = bwAll.filter(([, x]) => ramping(x));
  const bw = bwAll.filter(([, x]) => !ramping(x));
  if (ramp.length) {
    const a = aobs(ramp[0][1]);
    add(2, 'warn', `Скорость ещё разгонялась: оценка канала ${ramp[0][0] === SFU_OUT ? 'до сервера' : `до ${ramp[0][0]}`} выросла за запись с ${fmt(a[0])} до ${fmt(a[a.length - 1])} Мбит/с — после начала показа или переключения «сервер / напрямую» Chromium поднимает скорость постепенно, около минуты. Снимите отчёт ещё раз через минуту`);
    for (const [n] of ramp) said.add(n);
  }
  if (bw.length) {
    const s = bw[0][1].sum; const cap = s.maxBr || (state.target && state.target.mbps) || null;
    const how = `${fmt(s.mbps)} Мбит/с${cap ? ` вместо ${fmt(cap)}` : ''}`;
    if (bw.length === outs.length) add(2, 'bad', `Мыло из-за нехватки скорости отдачи у стримера: ${outs.length === 1 && outs[0][0] === SFU_OUT ? 'на сервер' : outs.length > 1 ? 'на каждого зрителя' : 'зрителю'} уходит ${how}${s.h ? `, разрешение ${s.h}p` : ''}`);
    else for (const [n] of bw) { add(2, 'bad', n === SFU_OUT ? `Мыло у тех, кто смотрит через сервер: не хватает скорости отдачи до сервера (${how})` : `Мыло у ${n}: не хватает скорости канала до него (${how}) — у остальных зрителей хватает`); said.add(n); }
  }
  // 3. потери в сети (берём у зрителя, иначе — что сообщил он стримеру)
  for (const [n, x] of outs.concat(ins)) {
    if (said.has(n)) continue;
    const viewer = rep.viewers && rep.viewers[n] && rep.viewers[n].sum;
    const loss = viewer && viewer.loss != null ? viewer.loss : x.sum.loss;
    if (loss > 2) {
      const path = (viewer && viewer.path) || x.sum.path;
      add(3, loss > 5 ? 'bad' : 'warn', `Потери в сети ${n === SFU_OUT ? 'по дороге на сервер' : `у ${n}`}: ${fmt(loss)}% пакетов${path === 'relay' ? ' (связь через ретранслятор)' : ''} — чаще всего Wi-Fi или загруженный канал; кабель решает`);
      said.add(n);
    }
  }
  // 4. компьютер зрителя не успевает распаковывать
  for (const [n, x] of ins) {
    const s = x.sum;
    // сравниваем с тем, сколько кадров реально приходит (стример может отдавать меньше 60 — это не вина зрителя)
    const recvFps = s.recv > 0 && s.secs > 0 ? s.recv / s.secs : null;
    const slowDecode = recvFps > 5 && s.decMs > 0.9 * 1000 / recvFps && s.fps < recvFps * 0.9;
    if ((s.dropPct > 10 && s.drop > 30) || slowDecode) {
      add(4, 'bad', `Компьютер ${n} не успевает распаковывать видео (${s.impl || '?'}${s.pe === false ? ', процессором' : ''}): выброшено ${fmt(s.dropPct)}% кадров, ${fmt(s.decMs)} мс на кадр`);
      said.add(n);
    }
  }
  // 5. замирания и рывки
  // «Замирания» в отрезки, когда экран стримера сам почти не менялся (рабочий стол, текст), — не замирания:
  // новых кадров просто нет. Считаем только отрезки, где экран стримера отдавал кадры (отчёт 19.10: «32 замирания» на стоящем экране).
  const changing = (n, w) => {
    const o = st && st.out && ((st.out[n] && st.out[n].w5) || (st.out[SFU_OUT] && st.out[SFU_OUT].w5)); // смотрел через сервер — экран стримера тот же
    if (!o) return true;
    const sw = o.find((y) => y.s === w.s);
    return !sw || sw.srcFps == null || sw.srcFps >= Math.max(10, wantFps * 0.3);
  };
  let staticNote = false;
  for (const [n, x] of ins) {
    const s = { ...x.sum };
    if (said.has(n)) continue;
    if (Array.isArray(x.w5) && x.w5.length) {
      const real = x.w5.filter((w) => changing(n, w));
      const frz = real.reduce((a, w) => a + (w.frz || 0), 0), frzMs = real.reduce((a, w) => a + (w.frzMs || 0), 0);
      if (frz < s.frz && (s.frz >= 2 || s.frzMs >= 1000)) staticNote = true;
      s.frz = frz; s.frzMs = frzMs;
    }
    if (s.frz >= 2 || s.frzMs >= 1000) add(5, s.frzMs >= 3000 ? 'bad' : 'warn', `Картинка у ${n} замирала ${s.frz} раз (всего ${fmt(s.frzMs / 1000)} с)${s.jit > 20 ? ` — сеть неровная (дрожание ${fmt(s.jit, 0)} мс), включите «Плавно»` : s.pli > 2 ? ' — терялись ключевые кадры' : ''}`);
    else if (s.ifdSd > 12 && s.fps >= 40) add(6, 'warn', `Кадры у ${n} идут неровно (разброс ${fmt(s.ifdSd)} мс)${s.jit > 15 ? ' — неровная сеть, помогает «Плавно»' : ''}`);
  }
  // 6. экран стримера отдаёт мало кадров (показ окна, игра ограничена)
  const src = outs.map(([, x]) => x.sum.srcFps).filter((v) => v != null);
  const motion = outs.map(([, x]) => x.sum.motion).filter((v) => v != null);
  const srcFps = src.length ? Math.min(...src) : null;
  if (srcFps != null && srcFps > 1 && srcFps < wantFps * 0.75 && (!motion.length || Math.max(...motion) > 0.5)) {
    const busy = cpuS && cpuS.coreMax >= 90 ? ` (процессор стримера занят: самое загруженное ядро ${fmt(cpuS.coreMax, 0)}%)` : '';
    // 1.19.2: «компьютер не успевает» — только когда процессор правда занят; ровные ~32 кадра у vertigo (24.10) были,
    // скорее всего, таймером Windows 11 при окне «Сходки», закрытом игрой, а не нехваткой сил
    const why = busy ? ' — компьютеру тесно вместе с игрой. Помогают 30 кадров/с в Настройки → Показ экрана, игра в «окне без рамки» и закрытый браузер; «Видеокартой, как OBS» снимает захват с процессора'
      : srcFps >= 30 && srcFps <= 34 ? ' — ровно около 32 кадров/с часто бывает в Windows 11, когда окно «Сходки» свёрнуто или закрыто игрой. Попробуйте «Видеокартой, как OBS» (стрелка у кнопки показа)'
        : ' — попробуйте «Видеокартой, как OBS» (стрелка у кнопки показа); помогают и игра в «окне без рамки», и закрытый браузер';
    add(7, 'warn', `Экран стримера отдаёт только ${fmt(srcFps, 0)} кадров/с из ${wantFps}, хотя картинка двигается${busy}${why}`);
  }
  if (staticNote) add(13, 'ok', 'Экран стримера часть времени почти не менялся — тогда новых кадров нет, и это не замирания');
  // память и питание у стримера: мало свободной памяти или ноутбук от батареи — игра и демка проседают
  const free = cpuS && cpuS.freeMb != null ? cpuS.freeMb / 1024 : st && st.sys && st.sys.freeGb;
  if (free != null && free < 1.5) add(6.5, 'warn', `У стримера свободно всего ${fmt(free)} ГБ памяти — игра и демка из-за этого проседают; закройте браузер и лишние программы`);
  if (st && st.sys && st.sys.battery) add(6.6, 'warn', 'Ноутбук стримера работает от батареи — Windows урезает частоту процессора и захвата; подключите зарядку');
  // 7. мыло без явного упора: кодировщику мало скорости для такой картинки; разрешение снижено
  for (const [n, x] of outs) {
    const s = x.sum;
    if (said.has(n) || s.lim !== 'none') continue;
    const blur = QP_BLUR[s.codec] || 36;
    if (s.qp >= blur) add(8, 'warn', `Мыло ${n === SFU_OUT ? 'у тех, кто смотрит через сервер' : `у ${n}`}: картинка сильно сжата (QP ${fmt(s.qp)}) — для неё мало ${fmt(s.mbps)} Мбит/с`);
    else if (s.h && s.srcH && s.h < s.srcH * 0.85) add(9, 'warn', `Кодировщик сам снизил разрешение для ${who(n)}: ${s.h}p вместо ${s.srcH}p`);
  }
  // 8. окно демки у зрителя меньше или больше картинки
  for (const [n, x] of ins) {
    const s = x.sum;
    if (s.scale != null && s.scale < 0.8 && !(s.zoom > 1.05)) add(11, 'warn', `У ${n} окно демки меньше картинки (уменьшается в ${fmt(1 / s.scale)} раза) — мелкий текст мылится; разверните демку на весь экран`);
    else if (s.scale > 1.3) add(12, 'warn', `У ${n} картинка растягивается в ${fmt(s.scale)} раза (экран больше ${s.h}p) — чуть мягче, это нормально`);
  }
  const lines = found.sort((a, b) => a.pri - b.pri).slice(0, 3).map(({ level, text }) => ({ level, text }));
  if (!lines.length) {
    const s = (outs[0] && outs[0][1].sum) || (ins[0] && ins[0][1].sum);
    lines.push({ level: 'ok', text: s ? `Всё хорошо: ${s.h || '?'}p, ${fmt(s.fps, 0)} кадров/с, ${fmt(s.mbps)} Мбит/с, потерь и замираний нет` : 'Нет данных: никто не смотрел демку во время записи' });
  }
  for (const [n, x] of Object.entries(rep.viewers || {})) if (x && x.missing && lines.length < 3) lines.push({ level: 'warn', text: `Нет данных от ${n}: ${x.missing === 'old' ? 'старая версия «Сходки»' : 'не прислал сводку'}` });
  return lines;
}

// ---- текст для журнала ----
const yes = (v) => (v === 'hw' ? '✓' : v === 'sw' ? 'процессор' : v === 'no' ? '—' : '?');
export function sysLine(s) {
  if (!s) return 'нет данных';
  const gpus = (s.gpus || []).map((g) => `${g.name}${g.driver ? ` (драйвер ${g.driver})` : ''}${s.gpus.length > 1 && g.active ? ' — активная' : ''}`).join('; ');
  const ds = (s.displays || []).map((d) => `${d.w}×${d.h}${d.hz ? ` ${d.hz} Гц` : ''}${d.scale && d.scale !== 1 ? ` (масштаб ${Math.round(d.scale * 100)}%)` : ''}${d.primary && s.displays.length > 1 ? ' — основной' : ''}`).join(', ');
  const c = s.codecs || {};
  const codecs = Object.keys(c).length ? ` · видеокарта сжимает/распаковывает 1080p60: ${Object.entries(c).map(([k, v]) => `${k} ${yes(v.e)}/${yes(v.d)}`).join(', ')}` : '';
  const vf = s.gpuFeatures ? ` · ускорение видео в Chromium: сжатие ${s.gpuFeatures.video_encode || '?'}, распаковка ${s.gpuFeatures.video_decode || '?'}` : '';
  return `${s.osName || s.os || '?'} · ЦП ${s.cpu || s.cpuModel || '?'} (${s.threads || s.cpus || '?'} потоков) · ОЗУ ${s.ramGb || s.memGb || '?'} ГБ`
    + ` · видеокарта ${gpus || '?'} · экран ${ds || '?'} · Electron ${s.electron || '?'} / Chromium ${s.chrome || '?'}${s.battery ? ' · от батареи!' : ''}${codecs}${vf}`;
}
const limRu = (p) => (!p ? '?' : `процессор ${p.cpu ?? '?'}%, скорость ${p.bw ?? '?'}%`);
const encRu = (impl, pe) => `${impl || '?'}${pe == null ? '' : pe ? ' — видеокарта' : ' — процессор'}`;

function outLine(n, s) {
  return `Стример → ${who(n)}: ${s.w || '?'}×${s.h || '?'}, ${fmt(s.fps)} к/с (мин ${fmt(s.fpsMin, 0)}), ${fmt(s.mbps)} Мбит/с (цель кодировщика ${fmt(s.tgt)}, потолок ${fmt(s.maxBr)}), QP ${fmt(s.qp)} (макс ${fmt(s.qpMax)})`
    + `, упирался: ${limRu(s.limPct)}, сжатие ${encRu(s.enc, s.pe)} ${s.codec || '?'}, ${fmt(s.encMs)} мс на кадр, ключевых кадров ${s.key ?? '?'}, NACK ${s.nack ?? '?'}, PLI ${s.pli ?? '?'}`
    + `, пинг ${fmt(s.rtt, 0)} мс, оценка канала ${fmt(s.aob)} Мбит/с, потери ${fmt(s.loss)}%, путь ${PATH_RU[s.path] || s.path || '?'}`
    + `${s.srcFps != null ? `, захват ${s.srcW || '?'}×${s.srcH || '?'} ${fmt(s.srcFps)} к/с` : ''}${s.motion != null ? `, «игра» ${Math.round(s.motion * 100)}% времени` : ''}`;
}
function inLine(n, s, extra = {}) {
  const view = s.scale == null ? '' : s.scale < 0.95 ? `, окно демки меньше картинки (×${fmt(s.scale, 2)})` : s.scale > 1.05 ? `, картинка растянута (×${fmt(s.scale, 2)})` : ', окно демки = размер картинки';
  return `Зритель ${n}: ${s.w || '?'}×${s.h || '?'}, ${fmt(s.fps)} к/с (мин ${fmt(s.fpsMin, 0)}), ${fmt(s.mbps)} Мбит/с, выброшено ${s.drop ?? '?'} кадров (${fmt(s.dropPct)}%), QP ${fmt(s.qp)}`
    + `, замирания ${s.frz ?? '?'} (${fmt(s.frzMs, 0)} мс), паузы ${s.pau ?? '?'}, разброс кадров ${fmt(s.ifdSd)} мс, буфер ${fmt(s.jb, 0)} мс (цель ${fmt(s.jbT, 0)}), дрожание ${fmt(s.jit, 0)} мс`
    + `, потери ${fmt(s.loss)}% (${s.lost ?? '?'} пакетов, FEC восстановил ~${s.fecUsed ?? '?'}), NACK ${s.nack ?? '?'}, PLI ${s.pli ?? '?'}, распаковка ${encRu(s.impl, s.pe)} ${s.codec || '?'} ${fmt(s.decMs)} мс на кадр`
    + `, пинг ${fmt(s.rtt, 0)} мс, путь ${PATH_RU[s.path] || s.path || '?'}${extra.latency ? `, режим «${extra.latency === 'low' ? 'Быстро' : 'Плавно'}»` : ''}${view}${s.full ? ', на весь экран' : ''}${s.vdrop ? `, экран пропустил ${s.vdrop} кадров` : ''}`;
}
const pad = (x, n) => String(x).padEnd(n);
function windowsTable(w5, kind) {
  if (!w5 || !w5.length) return undefined;
  const head = kind === 'out' ? ['с', 'размер', 'к/с', 'Мбит/с', 'цель', 'QP', 'упор', 'потери%', 'пинг', 'канал']
    : ['с', 'размер', 'к/с', 'Мбит/с', 'QP', 'выбр.', 'замир.', 'мс', 'разброс', 'буфер', 'потери%', 'FEC'];
  const rows = w5.map((x) => (kind === 'out'
    ? [`${x.s}–${x.s + 5}`, `${x.w}×${x.h}`, fmt(x.fps), fmt(x.mbps), fmt(x.tgt), fmt(x.qp), x.lim === 'none' ? '—' : x.lim === 'bandwidth' ? 'скорость' : x.lim === 'cpu' ? 'процессор' : x.lim || '?', fmt(x.loss), fmt(x.rtt, 0), fmt(x.aob)]
    : [`${x.s}–${x.s + 5}`, `${x.w}×${x.h}`, fmt(x.fps), fmt(x.mbps), fmt(x.qp), x.drop ?? '?', x.frz ?? '?', fmt(x.frzMs, 0), fmt(x.ifdSd), fmt(x.jb, 0), fmt(x.loss), x.fecUsed ?? '?']));
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)) + 1);
  return [head, ...rows].map((r) => r.map((c, i) => pad(c, widths[i])).join('').trimEnd()).join('\n');
}
function stateLine(st) {
  const s = st.state || {}; const tg = s.target || {}; const cap = s.capture || {};
  const net = s.net ? `, отдача ${fmt(s.net.up)} Мбит/с по проверке ${s.net.days != null ? `${s.net.days} дн. назад` : ''} → до ${fmt(s.uplinkShare)} на зрителя` : ', интернет не проверяли';
  return `Настройки стримера: ${s.quality === 'auto' ? '«Авто» (старая версия)' : 'своё качество'} (режим «${s.mode === 'detail' ? 'Текст' : 'Игра'}»: ${s.gpu || tg.res === 'source' ? 'как на экране' : (tg.res || '?') + 'p'}, ${tg.fps || '?'} к/с, до ${fmt(tg.mbps)} Мбит/с), ${s.gpu ? `захват и сжатие видеокартой — ${s.gpu.enc} (сейчас ${fmt((s.gpu.kbps || 0) / 1000)} Мбит/с, ${fmt(s.gpu.encMs)} мс на кадр, целых кадров по просьбе зрителей ${s.gpu.idrs || 0})` : `кодек ${s.codec || '?'}`}`
    + (!s.gpu && s.multiCore != null && /^H264(SW|MT)$/.test(s.codec || '') ? ` (сжатие процессором на ${s.multiCore ? 'нескольких ядрах' : 'одном ядре'})` : '')
    + `${net}`
    + `, захват ${cap.w || '?'}×${cap.h || '?'} ${fmt(cap.fps, 0)} к/с${s.hint ? `, подсказка кодировщику «${s.hint}»` : ''}`
    + (s.sfu ? `; размножитель на сервере ${s.sfu.on ? 'работает' : 'не работает'}${s.sfu.viewers && s.sfu.viewers.length ? `, через него смотрят: ${s.sfu.viewers.join(', ')}` : ''}${Array.isArray(s.sfu.out) && s.sfu.out.length
      ? ` (сервер → ${s.sfu.out.filter((x) => x.kind === 'video').map((x) => `${x.viewer} ${fmt((x.bitrate || 0) / 1e6)} Мбит/с, потери ${fmt((x.fractionLost || 0) / 2.56, 1)}%, повторов ${x.nackCount ?? '?'}`).join('; ')})` : ''}` : '');
}

// rep → [{ level, msg, details }] для журнала. Последняя запись несёт JSON одной строкой.
export function formatReport(rep) {
  const st = rep.streamer;
  const names = Object.keys(rep.viewers || {});
  const e = [];
  e.push({ level: 'info', msg: `════ Отчёт о демке${st ? ` ${st.name}` : ''}${names.length ? ` → ${names.join(', ')}` : ''}, ${rep.secs} с ════` });
  if (st) e.push({ level: 'info', msg: `Система стримера ${st.name}: ${sysLine(st.sys)}` });
  for (const [n, x] of Object.entries(rep.viewers || {})) if (x && x.sys) e.push({ level: 'info', msg: `Система зрителя ${n}: ${sysLine(x.sys)}` });
  if (st && st.state) e.push({ level: 'info', msg: stateLine(st) });
  if (st && st.cpu) e.push({ level: 'info', msg: cpuLine(`стримера ${st.name}`, st.cpu) });
  for (const [n, x] of Object.entries(rep.viewers || {})) if (x && x.cpu) e.push({ level: 'info', msg: cpuLine(`зрителя ${n}`, x.cpu) });
  if (st && st.note) e.push({ level: 'info', msg: st.note });
  for (const [n, x] of Object.entries((st && st.out) || {})) if (x && x.sum && x.sum.n) e.push({ level: 'info', msg: outLine(n, x.sum), details: windowsTable(x.w5, 'out') });
  for (const [n, x] of Object.entries(rep.viewers || {})) {
    if (x && x.sum && x.sum.n) e.push({ level: 'info', msg: inLine(n, x.sum, x), details: windowsTable(x.w5, 'in') });
    else e.push({ level: 'info', msg: `Зритель ${n}: нет данных (${x && x.missing === 'old' ? 'старая версия «Сходки» — отчёт не умеет' : x && x.missing === 'left' ? 'перестал смотреть' : 'сводка не пришла'})` });
  }
  const v = rep.verdict || verdict(rep);
  v.forEach((x, i) => e.push({ level: x.level === 'ok' ? 'info' : 'warn', msg: `Вывод${v.length > 1 ? ` ${i + 1}` : ''}: ${x.text}` }));
  e.push({ level: 'info', msg: '════ Конец отчёта (данные для разработчика — в подробностях этой строки) ════', details: `${JSON_MARK} ${JSON.stringify({ ...rep, verdict: v })}` });
  return e;
}
