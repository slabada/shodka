// Голосовая комната: WebRTC-соединения «каждый с каждым». Путь выбирается сам: напрямую через интернет,
// через Radmin VPN (если есть) или через ретранслятор сервера, если напрямую не выходит («серый» адрес).
// Сервер только пересылает служебные сигналы, звук и видео идут между ПК.
import { log, explain } from './log.js';
import { settings, set, parseIceServers } from './settings.js';
import { createEchoFreeTrack } from './echo.js';
import { startProcessAudio, processAudioAvailable } from './procaudio.js';
import { SfuLink } from './sfu.js';
import { GpuCapture, encName, gpuCaptureMissing, GPU_MISSING_HINT, GPU_LOST_HINT } from './gpucap.js';

const api = window.api;
let APP_VERSION = ''; // сообщаем зрителям вместе с трансляцией — по журналу видно, у кого старая версия
let MULTI_CORE = false; // 1.18.2: программа запущена со сжатием процессором на нескольких ядрах (main.js)
Promise.resolve(api.appInfo && api.appInfo()).then((i) => { if (i) { APP_VERSION = i.version; MULTI_CORE = !!i.multiCore; } }).catch(() => {});
export const multiCoreActive = () => MULTI_CORE;
const RES = { 720: 720, 1080: 1080, 1440: 1440 };
// Звук компьютера в трансляции захватывается только в Windows (в тестах — подставной тон)
const IS_WIN = /win/i.test(navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform);
// '1' — подставной тон (без эха), 'monitor' — настоящий loopback через монитор PulseAudio (с эхом голосов)
const FAKE_MODE = (api.testFlags && api.testFlags.fakeScreenAudio) || '';
const FAKE_SCREEN_AUDIO = !!FAKE_MODE;
export const CAN_SHARE_AUDIO = IS_WIN || FAKE_SCREEN_AUDIO;
const SCREEN_AUDIO_BITRATE = 160000;
// 1.23: отдельные дорожки «музыка для всех» и «звуки для всех» (моно Opus; музыка — как раньше в голосе, 96 кбит/с)
const FX_MUSIC_BPS = 96000;
const FX_SFX_BPS = 64000;

// Звук трансляции — музыка и игры, а не голос: стерео, 160 кбит/с, без «тишинного» режима (DTX).
// Параметры кодека задаёт принимающая сторона в своём SDP, поэтому стример правит пришедший ответ
// только для своей звуковой дорожки трансляции (по её mid).
function tuneScreenAudio(desc, mid) {
  if (!desc || !desc.sdp || !mid) return desc;
  const sections = desc.sdp.split(/\r\n(?=m=)/);
  let changed = false;
  const out = sections.map((sec) => {
    if (!sec.startsWith('m=audio') || !new RegExp(`\\r\\na=mid:${mid}(\\r\\n|$)`).test(sec)) return sec;
    const pt = (sec.match(/\r\na=rtpmap:(\d+) opus\/48000/i) || [])[1];
    if (!pt) return sec;
    const want = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: String(SCREEN_AUDIO_BITRATE), usedtx: '0', useinbandfec: '1' };
    const lines = sec.split('\r\n');
    const i = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
    const params = {};
    if (i >= 0) for (const kv of lines[i].slice(`a=fmtp:${pt} `.length).split(';')) { const [k, v] = kv.split('='); if (k) params[k.trim()] = (v || '').trim(); }
    Object.assign(params, want);
    const line = `a=fmtp:${pt} ` + Object.entries(params).map(([k, v]) => `${k}=${v}`).join(';');
    if (i >= 0) lines[i] = line; else lines.splice(lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `)) + 1, 0, line);
    changed = true;
    return lines.join('\r\n');
  });
  return changed ? { type: desc.type, sdp: out.join('\r\n') } : desc;
}

// Подставной «звук компьютера» для автотестов на Linux: стерео-тон 440/660 Гц
function fakeSystemAudio() {
  const ctx = new AudioContext({ sampleRate: 48000 });
  const merger = ctx.createChannelMerger(2);
  for (const [ch, f] of [[0, 440], [1, 660]]) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = f; g.gain.value = 0.2; o.connect(g); g.connect(merger, 0, ch); o.start();
  }
  const dest = ctx.createMediaStreamDestination(); dest.channelCount = 2; merger.connect(dest);
  return dest.stream.getAudioTracks()[0];
}

// «H.264 — процессор» (1.17.5): тот же H.264, но профиль Constrained Baseline (42e01f) — его Chromium на Windows
// сжимает только процессором (OpenH264), видеокарта не участвует. Для ПК, где видеокарта не сжимает ни кадра
// (vertigo, RX 9070 XT, 22.10: 0 кадров за минуту — у зрителей чёрный экран). Зритель распаковывает как обычный H.264.
export const H264SW = 'H264SW';
// «H.264 — сжатие на нескольких ядрах» (1.18.2): тоже Constrained Baseline (OpenH264), но с packetization-mode=0 —
// Chromium режет кадр на куски по размеру пакета, и OpenH264 сжимает куски на нескольких ядрах (настройка при запуске
// программы, main.js; с 1.20.1 — всегда, выбирается на ходу). С packetization-mode=1 кадр — один кусок, и ядро работает одно, сколько потоков
// ни разреши. Замер на этом ПК (24.10, i5-9300HF, 1080p60 «игра»): packetization-mode=1 — 21,5 мс на кадр с настройкой
// и без; packetization-mode=0 с настройкой — 11 мс и 55–56 кадров/с вместо 39–40.
export const H264MT = 'H264MT';
export const isCpuH264 = (c) => c === H264SW || c === H264MT;
export const codecMime = (c) => (isCpuH264(c) ? 'H264' : c);
export const codecRu = (c) => (c === H264SW ? 'H.264 (процессор)' : c === H264MT ? 'H.264 (несколько ядер)' : c);
// 1.19.2: что советовать, когда процессор не успевает сжимать демку, — по выбранному кодеку (раньше «выберите H.264 —
// кодирует видеокарта» получали и те, кто выбрал сжатие процессором нарочно, потому что видеокарта у них не сжимает)
const GPU_MODE = '«Видеокартой, как OBS» (стрелка у кнопки показа) снимает с процессора и захват, и сжатие';
export function cpuCodecHint(c) {
  if (c === H264SW) return `Сейчас кодек «H.264 — процессор», он сжимает на одном ядре. Выберите «H.264 — сжатие на нескольких ядрах» или поставьте демке 30 кадров/с в Настройки → Показ экрана; ${GPU_MODE}.`;
  if (c === H264MT) return `Процессор не успевает даже на нескольких ядрах${MULTI_CORE ? '' : ' (а они включатся только после перезапуска «Сходки»)'}: поставьте демке 30 кадров/с или 720p в Настройки → Показ экрана; ${GPU_MODE}.`;
  if (c === 'H264') return `Поставьте демке 30 кадров/с или 720p в Настройки → Показ экрана, закройте тяжёлые программы; ${GPU_MODE}.`;
  return `Сейчас кодек ${codecRu(c)} — его сжимает процессор. Видеокартой сжимается H.264: выберите «H.264 (рекомендуется)» в Настройки → Показ экрана или поставьте демке 30 кадров/с; ${GPU_MODE}.`;
}
// 1.19.3: AV1 в «Сходке» сжимает только процессор (сжатие AV1 видеокартой в Electron 43 выключено) — у irritat 22.10
// это занимало больше 4 ядер, в пике больше 6. Подпись в настройках звала его «для новых видеокарт» — теперь говорим прямо
function av1Note() {
  log.warn('screen', 'Кодек AV1: демку сжимает процессор, а не видеокарта — вместе с игрой возможны рывки, мелкая картинка и прерывания звука', { hint: 'Для игр выберите «H.264 (рекомендуется)» в Настройки → Показ экрана — его сжимает видеокарта. Зрителям без новых видеокарт AV1 тоже тяжело: его распаковывает их процессор.' });
}
const isCB = (c) => /profile-level-id=42e0/i.test(c.sdpFmtpLine || '');
const pm1 = (c) => /packetization-mode=1/.test(c.sdpFmtpLine || '');
// для журнала: H.264 кусками (packetization-mode=0) — сколько ядер сжимают, видно только так
const pieces = (c) => (c && /h264/i.test(c.mimeType || '') && !pm1(c) ? `, кадр кусками — ${MULTI_CORE ? 'сжимают несколько ядер' : 'но сжатие на нескольких ядрах при этом запуске выключено'}` : '');

export function prefCodecs(tx, kind, want) {
  if (!tx.setCodecPreferences) return;
  try {
    const recv = (RTCRtpReceiver.getCapabilities(kind) || {}).codecs || [];
    const mime = `${kind}/${codecMime(want)}`.toLowerCase();
    const preferred = recv.filter((c) => c.mimeType.toLowerCase() === mime);
    if (!preferred.length) return false;
    if (want === 'H264') preferred.sort((a, b) => pm1(b) - pm1(a));
    if (want === H264SW) preferred.sort((a, b) => (pm1(b) && isCB(b)) - (pm1(a) && isCB(a)) || pm1(b) - pm1(a));
    if (want === H264MT) preferred.sort((a, b) => (!pm1(b) && isCB(b)) - (!pm1(a) && isCB(a)) || isCB(b) - isCB(a));
    tx.setCodecPreferences([...preferred, ...recv.filter((c) => !preferred.includes(c))]);
    return true;
  } catch (e) {
    log.warn('screen', `Не удалось задать кодек ${want}: ${e.message}`);
    return false;
  }
}

// Умеет ли видеокарта этого ПК сжимать H.264 1080p60 (ответ запоминаем)
let hwH264P = null;
export function hwH264() {
  // Видели настоящее сжатие видеокартой (encoderImplementation + powerEfficientEncoder в статистике показа) — верим ему:
  // mediaCapabilities на Windows для H.264 отвечает «процессор», даже когда сжимает NVIDIA (отчёты 19.10)
  if (settings.hwSeen && settings.hwSeen.H264) return Promise.resolve(true);
  if (!hwH264P) {
    hwH264P = (async () => {
      try {
        if (!navigator.mediaCapabilities || !navigator.mediaCapabilities.encodingInfo) return null;
        const r = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: 'video/H264;profile-level-id=42001f;packetization-mode=1', width: 1920, height: 1080, framerate: 60, bitrate: 8e6 } });
        return r.supported ? !!r.powerEfficient : false;
      } catch (_) { return null; }
    })();
  }
  return hwH264P;
}

// Что сейчас отправляем. С 1.15.5 качество только своё: разрешение, кадры, скорость на зрителя и кодек — из настроек
// (режима «Авто» и авторежима больше нет). Скорость — потолок: если отдача известна (проверка интернета),
// она делится на зрителей вживую (uplinkShare).
export const DEFAULT_MBPS = 8;
export function screenTarget(mode = 'motion') {
  const s = settings;
  return { res: String(s.screenRes || '1080'), fps: Number(s.screenFps) || 60, mbps: Number(s.screenBitrate) || DEFAULT_MBPS, codec: s.screenCodec || 'H264', mode };
}

// Что важнее, когда не хватает скорости или процессора: в «игре» — кадры, в «тексте» — чёткость.
// Одно решение, без 'balanced' (иначе 1080→720→480).
const DEGRADE = { motion: 'maintain-framerate', detail: 'maintain-resolution' };
// Подсказка кодировщику дорожки демки — всегда «движение»: смена подсказки пересоздаёт поток отправки в Chromium
// (ключевой кадр, кодировщик и оценка канала начинают заново). Режим «Текст» задаётся через DEGRADE.
const HINT = 'motion';

// Старт демки (1.17.0): кодировщик начинает с умеренной скорости — 4 Мбит/с (или меньше, если столько выбрано),
// дальше Chromium разгоняется сам по своей оценке канала. Без подсказки он начинает с 0,3 Мбит/с, и первые секунды —
// «мыло». «Пола» скорости и старта сразу на полной скорости больше нет: на слабом канале они давали потери и обрывы.
export const START_KBPS = 4000;
// предел кадров на отправке: у захвата видеокартой Chromium сжимает пустышку — на каждый кадр помощника по кадру,
// и если два кадра пришли почти разом, предел ровно в выбранные кадры/с выкинул бы один (зритель недосчитался бы кадра)
function sendFps(sc, tg) { return sc && sc.gpu ? tg.fps * 2 : tg.fps; }
export function startKbps(mbps = DEFAULT_MBPS) { return Math.min(START_KBPS, Math.round(mbps * 1000)); }
function startBitrate(desc, mbps = DEFAULT_MBPS) {
  if (!desc || !desc.sdp || !/m=video/.test(desc.sdp)) return desc;
  const extra = `;x-google-start-bitrate=${startKbps(mbps)}`;
  const lines = desc.sdp.split('\r\n');
  const videoPts = new Set();
  let inVideo = false;
  for (const l of lines) {
    if (l.startsWith('m=')) inVideo = l.startsWith('m=video');
    const m = inVideo && l.match(/^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\//i);
    if (m) videoPts.add(m[1]);
  }
  const out = lines.map((l) => {
    const m = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (m && videoPts.has(m[1]) && !/x-google-(start|min|max)-bitrate/.test(l)) return l + extra;
    return l;
  });
  for (const pt of videoPts) {
    if (!out.some((l) => l.startsWith(`a=fmtp:${pt} `))) {
      const i = out.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
      if (i >= 0) out.splice(i + 1, 0, `a=fmtp:${pt} ${extra.slice(1)}`);
    }
  }
  return { type: desc.type, sdp: out.join('\r\n') };
}

// Голос с запасом (RED): каждый кусочек голоса едет ещё раз в следующем пакете — если один пакет потерялся,
// звук берётся из копии, и пропуска не слышно. Голосу нужно ~0,06 Мбит/с вместо 0,03. Старые версии «Сходки»
// такой голос понимают (это умеет сам Chromium), а если предложить его не им, а нам — тоже договоримся.
function preferRed(tx) {
  if (!tx || !tx.setCodecPreferences) return false;
  try {
    const c = (RTCRtpReceiver.getCapabilities('audio') || {}).codecs || [];
    const red = c.filter((x) => x.mimeType.toLowerCase() === 'audio/red');
    if (!red.length) return false;
    tx.setCodecPreferences([...red, ...c.filter((x) => !red.includes(x))]);
    return true;
  } catch (e) { log.debug('rtc', `Голос с запасом не включился: ${e.message}`); return false; }
}

// Запас у зрителя: «Плавно» — копим ~0,15 с картинки, чтобы сгладить неровную сеть; «Минимум задержки» — без запаса
export const LATENCY_MS = { smooth: 150, low: 0 };
function applyLatency(receiver) {
  if (!receiver || !('jitterBufferTarget' in receiver)) return;
  try { receiver.jitterBufferTarget = LATENCY_MS[settings.screenLatency] ?? LATENCY_MS.smooth; } catch (_) { /* старый Chromium */ }
}

// Проверка картинки (1.17.4): сколько кадров реально идёт по дорожке и не чёрная ли картинка — по копии дорожки,
// каждый проверяемый кадр уменьшается до 64×36. Чтобы «чёрная демка» была видна в журнале: захват не даёт кадров,
// даёт чёрные кадры, или у стримера картинка есть, а у зрителя чёрная (сжатие/распаковка). 22.10 у vertigo
// первый кадр захват отдавал, а что было дальше — по журналу понять было нельзя.
// → { frames, fps, w, h, avg, max (яркость 0–255) } или null, если проверить нельзя
export const PIC_BLACK = 10; // ярче этого нет ни одной точки — картинка чёрная
export async function pictureCheck(track, ms = 2000) {
  if (typeof MediaStreamTrackProcessor === 'undefined' || !track || track.readyState !== 'live') return null;
  let t; let reader;
  try { t = track.clone(); reader = new MediaStreamTrackProcessor({ track: t }).readable.getReader(); } catch (_) { if (t) t.stop(); return null; }
  const c = document.createElement('canvas'); c.width = 64; c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  const luma = (f) => {
    g.drawImage(f, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data; let sum = 0, max = 0;
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 2 + d[i + 1] * 5 + d[i + 2]) / 8; sum += y; if (y > max) max = y; }
    return { avg: sum / (d.length / 4), max };
  };
  let frames = 0; let w = 0; let h = 0; const seen = [];
  const t0 = performance.now(); const end = t0 + ms;
  const giveUp = setTimeout(() => { reader.cancel().catch(() => {}); }, ms + 1500); // кадров нет совсем — read() сам не вернётся
  try {
    while (performance.now() < end) {
      const { value: f, done } = await reader.read();
      if (done || !f) break;
      frames++; w = f.displayWidth; h = f.displayHeight;
      try { if (frames === 1 || frames % 15 === 0) seen.push(luma(f)); } catch (_) { /* кадр не рисуется */ } finally { f.close(); }
    }
  } catch (_) { /* дорожку остановили */ } finally { clearTimeout(giveUp); reader.cancel().catch(() => {}); t.stop(); }
  const secs = Math.max(0.5, (Math.min(performance.now(), end) - t0) / 1000);
  return { frames, fps: Math.round(frames / secs), w, h, avg: seen.length ? seen.reduce((s, x) => s + x.avg, 0) / seen.length : null, max: seen.length ? Math.max(...seen.map((x) => x.max)) : null };
}
const picText = (r) => `${r.fps} кадров/с, ${r.w}×${r.h}`;
const PIC_HINT_STREAMER = 'Windows отдаёт программе пустой экран. Попробуйте по очереди: выключить HDR (Параметры → Система → Дисплей); в Параметры → Система → Дисплей → Графика добавить «Сходку» и выбрать видеокарту, к которой подключён монитор; показать окно вместо всего экрана; обновить или откатить драйвер видеокарты.';

// Первый кадр захвата (1.16.1): дал ли экран хоть один кадр за FIRST_FRAME_MS. true — дал, false — нет,
// null — проверить нельзя. Копию дорожки не делаем: смотрим невидимым <video> — у видео из MediaStream
// «loadedmetadata» наступает только с первым кадром.
export const FIRST_FRAME_MS = 5000;
const NO_FRAMES_HINT = 'Windows не отдаёт программе картинку экрана. Если показываете игру — поставьте в ней «Оконный без рамки» вместо «Полный экран». Ещё помогает: выключить HDR (Параметры → Система → Дисплей), показать окно вместо всего экрана, обновить драйвер видеокарты и перезагрузить компьютер.';
function firstFrame(track, ms = FIRST_FRAME_MS) {
  return new Promise((resolve) => {
    let v;
    try { v = document.createElement('video'); v.muted = true; v.playsInline = true; } catch (_) { resolve(null); return; }
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true; clearTimeout(timer);
      v.onloadedmetadata = v.onresize = null;
      try { v.pause(); } catch (_) { /* ignore */ }
      v.srcObject = null;
      resolve(r);
    };
    const timer = setTimeout(() => finish(v.videoWidth > 0), ms);
    v.onloadedmetadata = v.onresize = () => { if (v.videoWidth > 0) finish(true); };
    try { v.srcObject = new MediaStream([track]); } catch (_) { finish(null); return; }
    v.play().catch(() => {});
  });
}

// Каким путём идёт связь с другом: по выбранной паре адресов (ICE)
export function pathOf(l, rm) {
  if (l.candidateType === 'relay' || rm.candidateType === 'relay') return 'relay';
  const a = rm.address || '';
  if (/^26\./.test(a) || /^fdfd:/i.test(a)) return 'radmin';
  if (/^25\./.test(a)) return 'hamachi';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fd)/i.test(a) && l.candidateType === 'host' && rm.candidateType === 'host') return 'lan';
  return 'direct';
}

class Peer {
  constructor(voice, name) {
    this.voice = voice;
    this.name = name;
    this.polite = voice.me > name; // одинаково считается с обеих сторон
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.queue = Promise.resolve();
    this.restarts = 0;
    this.state = 'new';
    this.rtt = null;
    this.remoteScreenId = null;
    this.remoteScreenInfo = null;
    this.remoteScreen = null;      // MediaStream с видео друга
    this.screenStats = null;
    this.sentScreen = false;
    this.viaSfu = false;           // стример: этот зритель смотрит мою демку через сервер (размножитель, 1.16)
    this.wantsSfu = false;         // стример: зритель умеет и хочет смотреть через сервер
    this.sfuBad = false;           // стример: через сервер у зрителя сейчас не вышло — до нового включения значка «сервер» (1.20.3)
    this.sfuIn = null;             // зритель: { video, audio } — потоки демки этого стримера от сервера
    this.prevOut = null; this.prevIn = null; this.lowFps = 0; this.limit = { reason: 'none', n: 0 };
    this.slowTicks = 0; this.slowHere = false; // зритель: этот компьютер не успевает показывать демку (для «светофора»)
    this.loggedPair = '';
    this.loggedEncoder = '';

    const iceServers = [...(voice.iceServers || []), ...parseIceServers(settings.iceServers)];
    const relayOnly = (settings.forceRelay || voice.relayOnly) && iceServers.some((x) => x.username);
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceTransportPolicy: relayOnly ? 'relay' : 'all' });
    if (relayOnly) log.info('rtc', `${name}: соединение только через ретранслятор (${voice.relayOnly ? 'так настроен сервер' : 'включено в настройках сети'})`);
    const pc = this.pc;

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.signal({ kind: 'sdp', description: pc.localDescription });
      } catch (e) {
        log.error('rtc', `Ошибка согласования с ${name}: ${e.message}`, { err: e });
      } finally { this.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) { log.debug('rtc', `${name}: свой кандидат ${candidate.candidate.split(' ').slice(4, 8).join(' ')}`); this.signal({ kind: 'ice', candidate }); } };
    pc.onicecandidateerror = (e) => log.debug('rtc', `ICE-ошибка (${name}): ${e.errorCode} ${e.errorText} ${e.url || ''}`);
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);
    pc.oniceconnectionstatechange = () => log.debug('rtc', `${name}: ICE ${pc.iceConnectionState}`);
    pc.onsignalingstatechange = () => log.debug('rtc', `${name}: сигнализация ${pc.signalingState}`);
    pc.ontrack = (e) => this.onTrack(e);

    if (voice.micTrack) this.micSender = pc.addTrack(voice.micTrack, voice.micStream);
    else this.audioTx = pc.addTransceiver('audio', { direction: 'recvonly' });
    this.voiceTx = this.audioTx || pc.getTransceivers().find((t) => t.sender === this.micSender);
    preferRed(this.voiceTx);
    if (this.micSender && voice.musicKbps) this.applyMusicBitrate();
    this.armWatchdog();
    // 1.23: музыка и звуки для всех — отдельными дорожками, если друг это умеет (старые версии сигнал пропускают
    // и получают всё вместе с голосом, как раньше)
    this.fxOk = false; this.musicTx = null; this.sfxTx = null; this.remoteFx = null; this.rxMusic = null; this.rxSfx = null;
    this.signal({ kind: 'caps', fx: 1 });
  }

  // друг умеет раздельные дорожки: ему голос — без музыки и звуков, а музыка и звуки — отдельно
  async setupFx() {
    const v = this.voice;
    if (this.pc.signalingState === 'closed') return;
    this.signal({ kind: 'fx', music: v.musicOut.id, sfx: v.sfxOut.id }); // до согласования — чтобы друг узнал дорожки
    if (this.micSender && v.micTrack) await this.micSender.replaceTrack(v.mic.voiceTrack || v.micTrack);
    this.musicTx = this.pc.addTransceiver('audio', { direction: 'sendonly', streams: [v.musicOut], sendEncodings: [{ maxBitrate: FX_MUSIC_BPS }] });
    this.sfxTx = this.pc.addTransceiver('audio', { direction: 'sendonly', streams: [v.sfxOut], sendEncodings: [{ maxBitrate: FX_SFX_BPS }] });
    this.applyMusicBitrate();
    await this.refreshFx();
    log.debug('rtc', `${this.name}: музыка и звуки для всех — отдельными дорожками`);
  }

  // дорожки музыки и звуков шлём, только пока они звучат — в тишине они не занимают интернет
  async refreshFx() {
    if (!this.fxOk || this.pc.signalingState === 'closed') return;
    const m = this.voice.mic;
    const put = (tx, on, track) => { const want = on ? track || null : null; return tx && tx.sender.track !== want ? tx.sender.replaceTrack(want) : null; };
    try { await Promise.all([put(this.musicTx, this.voice.musicOn, m.musicTrack), put(this.sfxTx, this.voice.sfxOn, m.sfxTrack)]); } catch (e) { log.debug('rtc', `${this.name}: дорожки музыки и звуков не обновились: ${e.message}`); }
  }

  // чья это дорожка: музыка или звуки этого друга (null — голос или трансляция)
  fxKind(tx, sid) {
    if (tx && tx === this.rxMusic) return 'music';
    if (tx && tx === this.rxSfx) return 'sfx';
    if (this.remoteFx && sid) { if (sid === this.remoteFx.music) return 'music'; if (sid === this.remoteFx.sfx) return 'sfx'; }
    return null;
  }

  // Музыка для всех (music.js): пока она играет, голосовая дорожка идёт с битрейтом для музыки.
  // Скорость задаёт отправитель — у друзей обновлять программу не нужно.
  async applyMusicBitrate() {
    const s = this.micSender;
    if (!s || this.pc.signalingState === 'closed') return;
    try {
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) return;
      const want = this.voice.musicKbps && !this.fxOk ? this.voice.musicKbps * 1000 : undefined; // 1.23: с отдельной дорожкой музыки голосу хватает обычного
      if (p.encodings[0].maxBitrate === want) return;
      if (want) p.encodings[0].maxBitrate = want; else delete p.encodings[0].maxBitrate;
      await s.setParameters(p);
      log.debug('rtc', `${this.name}: голос ${want ? `${want / 1000} кбит/с (играет музыка)` : 'обычный битрейт'}`);
    } catch (e) { log.debug('rtc', `${this.name}: битрейт для музыки не задан: ${e.message}`); }
  }

  // Если соединение «зависло» и не установилось — перезапускаем ICE (не дольше 3 раз).
  armWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.pc.connectionState === 'connected' || this.pc.signalingState === 'closed') return;
      if (this.restarts < 3) { this.restart(`за 8 секунд не соединились (${this.pc.connectionState})`); this.armWatchdog(); } else this.onState('failed'); // подсказка про брандмауэр + редкие повторы
    }, 8000);
  }

  signal(data) { this.voice.conn.send({ type: 'signal', to: this.name, data }); }

  handle(data) {
    this.queue = this.queue.then(() => this.process(data)).catch((e) => log.warn('rtc', `Сигнал от ${this.name} не обработан: ${e.message}`, { err: e }));
    return this.queue;
  }

  async process(data) {
    const pc = this.pc;
    if (pc.signalingState === 'closed') return;
    if (data.kind === 'sdp') {
      const d = data.description;
      const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) { log.debug('rtc', `Встречное предложение от ${this.name} проигнорировано`); return; }
      try { await pc.setRemoteDescription(tuneScreenAudio(startBitrate(d, Math.min(this.voice.target().mbps, this.voice.uplinkShare())), this.atx && this.atx.mid)); } catch (e) {
        log.debug('rtc', `SDP с подсказкой стартовой скорости не принят (${e.message}) — применяю как есть`);
        await pc.setRemoteDescription(d);
      }
      if (d.type === 'offer') {
        await pc.setLocalDescription();
        this.signal({ kind: 'sdp', description: pc.localDescription });
      }
      if (this.voice.musicKbps) this.applyMusicBitrate();
    } else if (data.kind === 'ice') {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { log.debug('rtc', `Кандидат от ${this.name} отклонён${this.ignoreOffer ? ' (встречное предложение)' : ''}: ${e.message}`); }
    } else if (data.kind === 'screen-meta') {
      const prevAudio = this.remoteScreenInfo && this.remoteScreenInfo.audio;
      this.remoteScreenId = data.streamId;
      this.remoteScreenInfo = data.info || null;
      const ec = this.remoteScreenInfo && this.remoteScreenInfo.echo;
      const ecKey = ec ? `${ec.mode}:${ec.db != null ? Math.round(ec.db / 5) : ''}` : (this.remoteScreenInfo ? 'old' : '');
      if (ecKey && ecKey !== this.loggedEcho) {
        this.loggedEcho = ecKey;
        const v = this.remoteScreenInfo.v ? `Сходка ${this.remoteScreenInfo.v}` : 'старая версия Сходки (до 1.6.2)';
        const what = !ec ? 'про голоса зрителей не сообщает' : ec.mode === 'excluded' ? 'Windows сама не пускает голоса зрителей в звук трансляции'
          : ec.mode === 'guard' ? `голоса зрителей вычитаются${ec.ms != null ? `, задержка ${ec.ms} мс` : ' (ищу)'}${ec.db != null ? `, убрано ${ec.db} дБ` : ''}` : 'вычитание голосов выключено — зрители могут слышать себя';
        log.debug('screen', `Трансляция ${this.name}: ${v}; ${what}`);
      }
      if (this.remoteScreen && prevAudio && this.remoteScreenInfo && prevAudio !== this.remoteScreenInfo.audio) {
        log.info('screen', `${this.name} ${this.remoteScreenInfo.audio === 'on' ? 'включил(а)' : 'выключил(а)'} звук трансляции`);
      }
      this.voice.emit('screen', this.name);
    } else if (data.kind === 'screen-stop') {
      this.clearRemoteScreen();
      this.voice.emit('screen', this.name);
    } else if (data.kind === 'screen-h') {
      // стример сообщает, что у него: упирается ли кодировщик в процессор или в скорость, сколько кадров даёт экран
      this.remoteHealth = { lim: String(data.lim || 'none'), hw: !!data.hw, src: Number(data.src) || 0, at: Date.now() };
    } else if (data.kind === 'screen-vw') {
      // 1.20: стример сообщает, кто сейчас смотрит его демку (полоса под демкой: «Смотрят 3»)
      this.remoteWatchers = Array.isArray(data.who) ? data.who.slice(0, 32).map((x) => String(x).slice(0, 64)) : null;
    } else if (data.kind === 'caps') {
      if (data.fx && !this.fxOk) { this.fxOk = true; await this.setupFx(); }
    } else if (data.kind === 'fx') {
      this.remoteFx = { music: String(data.music || ''), sfx: String(data.sfx || '') };
    } else if (data.kind === 'voice-q') {
      // друг сообщает: «тебя слышно с перебоями» — покажем это говорящему (app.js)
      this.voice.emit('voiceq', { name: this.name, loss: Number(data.loss) || 0, conceal: Number(data.conceal) || 0, jitter: Number(data.jitter) || 0, path: String(data.path || '') });
    } else if (data.kind === 'watch') {
      this.demoCaps = !!data.rep; // зритель умеет «Отчёт о демке»
      // 1.16: зритель может смотреть через сервер (размножитель). 1.20.3: fb — через сервер у него сейчас не вышло
      // (сам он «через сервер» хочет по-прежнему): показываем напрямую, но его выбор не забываем — раньше после частых
      // нажатий значка «сервер» у стримера такой зритель навсегда оставался «напрямую»
      if (data.fb) this.sfuBad = true; else { this.wantsSfu = !!data.sfu; this.sfuBad = false; }
      await this.voice.addViewer(this.name);
    } else if (data.kind === 'screen-sfu') {
      // стример отдаёт демку через сервер: забираем её там (ids — его потоки на сервере)
      await this.voice.sfuWatch(this, { video: data.video ? String(data.video) : null, audio: data.audio ? String(data.audio) : null });
    } else if (data.kind === 'screen-p2p') {
      // у стримера размножитель перестал работать — он шлёт демку напрямую; потоки с сервера больше не нужны
      if (this.sfuIn) { this.voice.sfu.closeConsumers(this.name); this.sfuIn = null; log.info('screen', `${this.name} теперь показывает демку напрямую (размножитель недоступен)`); this.voice.emit('screen', this.name); }
    } else if (data.kind === 'demo-start' || data.kind === 'demo-ask' || data.kind === 'demo-sum') {
      // «Отчёт о демке» (demoreport.js); старые версии такие сигналы просто пропускают
      this.voice.emit('demo', { ...data, from: this.name });
    } else if (data.kind === 'unwatch') {
      const was = this.sentScreen;
      await this.detachScreen();
      this.voice.rebalance();
      if (was && this.voice.screen) this.voice.emit('viewer', { name: this.name, on: false });
    }
  }

  onTrack(e) {
    const t = e.track;
    const sid = e.streams[0] && e.streams[0].id;
    const out = this.voice.output;
    // Звук трансляции отличаем от голоса по приёмнику: при повторном показе Chromium может прислать
    // старый id потока, и без этого звук игры подменял бы голос друга.
    const tx = e.transceiver;
    const fx = t.kind === 'audio' && this.fxKind(tx, sid);
    if (fx) {
      if (tx) { if (fx === 'music') this.rxMusic = tx; else this.rxSfx = tx; }
      out.add(fx + ':' + this.name, t, this.voice.fxVolume(fx, this.name));
      log.debug('rtc', `${fx === 'music' ? 'Музыка' : 'Звуки'} ${this.name} — отдельной дорожкой`);
      return;
    }
    let isScreen = t.kind === 'video' || !!(sid && sid === this.remoteScreenId);
    if (!isScreen && tx) isScreen = tx === this.rxScreenAudio || (!!this.rxVoice && tx !== this.rxVoice && !!this.remoteScreenId);
    if (t.kind === 'audio' && tx) { if (isScreen) this.rxScreenAudio = tx; else this.rxVoice = tx; }
    if (isScreen) {
      if (this.sfuIn) { this.voice.sfu.closeConsumers(this.name); this.sfuIn = null; } // пришло напрямую — потоки с сервера больше не нужны
      this.addScreenTrack(t, e.receiver, 'напрямую');
    } else {
      this.voiceTrackId = t.id;
      out.add('voice:' + this.name, t, (settings.userVolumes || {})[this.name] ?? 100);
      log.debug('rtc', `Голос ${this.name} подключён`);
    }
  }

  // дорожка демки этого стримера (напрямую — из onTrack, через сервер — от размножителя)
  addScreenTrack(t, receiver, how) {
    const out = this.voice.output;
    if (receiver) { this.screenReceivers = (this.screenReceivers || []).filter((r) => r.track && r.track.readyState === 'live' && r.track.kind !== t.kind).concat(receiver); applyLatency(receiver); }
    if (!this.remoteScreen) this.remoteScreen = new MediaStream();
    for (const old of this.remoteScreen.getTracks()) if (old.kind === t.kind) this.remoteScreen.removeTrack(old);
    this.remoteScreen.addTrack(t);
    if (t.kind === 'audio') out.add('screen:' + this.name, t, this.voice.screenMuted ? 0 : this.voice.screenVolume);
    log.info('screen', `Получаю ${t.kind === 'video' ? 'видео' : 'звук'} демонстрации от ${this.name}${how === 'через сервер' ? ' через сервер (размножитель)' : ''}`);
    if (t.kind === 'video') { this.picBad = null; this.checkRemotePicture(t, how); }
    this.voice.emit('screen', this.name);
  }

  // 1.17.4: через 6 с смотрим 2 с пришедшей картинки — идут ли кадры и не чёрные ли они — и сверяем с тем,
  // что стример видит у себя (screen-meta: pic). Так по журналу зрителя видно, где пропадает картинка.
  checkRemotePicture(t, how) {
    clearTimeout(this.picTimer);
    this.picTimer = setTimeout(async () => {
      const mine = () => this.remoteScreen && this.remoteScreen.getVideoTracks().includes(t) && t.readyState === 'live';
      if (!mine()) return;
      const r = await pictureCheck(t);
      if (!r || !mine()) return;
      const sp = this.remoteScreenInfo && this.remoteScreenInfo.pic;
      // 1.19.2: стример показывает видеокартой — у себя он картинку не проверяет (в окне только пустышка), и совет «H.264 — процессор» ему не поможет
      const gpu = !!(this.remoteScreenInfo && this.remoteScreenInfo.gpu);
      const theirs = sp === 'ok' ? 'у стримера картинка есть' : sp === 'black' ? 'у стримера захват тоже отдаёт чёрную картинку' : sp === 'none' ? 'у стримера захват не даёт новых кадров'
        : gpu ? 'стример показывает «Видеокартой, как OBS» — у себя картинку он не проверяет' : 'что у стримера — неизвестно (версия до 1.17.4 или проверка ещё идёт)';
      const GPU_TIP = 'Стример показывает «Видеокартой, как OBS»: переключите значок «сервер» (через сервер / напрямую); не поможет — пусть стример выключит «Видеокартой» (стрелка у кнопки показа), покажет обычным способом и пришлёт журнал.';
      const path = how === 'через сервер' ? 'через сервер' : this.path === 'relay' ? 'через ретранслятор' : 'напрямую';
      if (r.frames === 0) {
        this.picBad = `Картинка не приходит: за 2 секунды ни одного кадра (${path}); ${theirs}.`;
        log.warn('screen', `Демка ${this.name} не показывается: за 2 секунды не пришло ни одного кадра (${path}); ${theirs}`, { hint: sp === 'ok' ? 'Картинка теряется по дороге или при сжатии: переключите значок «сервер» (через сервер / напрямую); стримеру — кодек «H.264 — процессор» в Настройки → Показ экрана.' : gpu ? GPU_TIP : 'Пусть стример пришлёт свой журнал — в нём видно, что с захватом.' });
      } else if (r.max != null && r.max < PIC_BLACK) {
        this.picBad = `Картинка чёрная: кадры идут (${picText(r)}), но в них ничего нет; ${theirs}.`;
        log.warn('screen', `Демка ${this.name} чёрная: кадры идут (${picText(r)}, ${path}), но картинка чёрная; ${theirs}`, { hint: sp === 'ok' ? 'У стримера картинка есть, у вас — чёрная: она теряется при сжатии или распаковке. Стримеру — кодек «H.264 — процессор» в Настройки → Показ экрана (сжимает процессор); вам — обновить драйвер видеокарты.'
          : sp === 'black' ? 'Чёрной картинку отдаёт уже захват у стримера — подробности в его журнале.' : gpu ? GPU_TIP : 'Пусть стример пришлёт свой журнал — в нём видно, что с захватом.' });
      } else log.info('screen', `Демка ${this.name}: картинка есть (${picText(r)}, ${path})`);
      this.voice.emit('screen', this.name);
    }, 6000);
  }

  clearRemoteScreen() {
    clearTimeout(this.sfuReWatch);
    if (this.sfuIn) { this.voice.sfu.closeConsumers(this.name); this.sfuIn = null; }
    this.remoteScreen = null; this.screenStats = null; this.prevIn = null; this.slowHere = false; this.slowTicks = 0; this.remoteWatchers = null;
    clearTimeout(this.picTimer); this.picBad = null;
    this.voice.output.remove('screen:' + this.name);
  }

  onState(s) {
    const prev = this.state;
    this.state = s;
    this.voice.emit('peers');
    if (s === 'connected') {
      clearTimeout(this.discTimer);
      clearTimeout(this.watchdog);
      if (prev !== 'connected') log.info('rtc', `Соединение с ${this.name} установлено`);
      if (this.voice.pendingWatch === this.name) { this.voice.pendingWatch = null; setTimeout(() => { if (!this.voice.watching) this.voice.watch(this.name); }, 300); }
      this.restarts = 0; clearTimeout(this.slowTimer); this.slowTimer = null; this.slowDelay = 0;
    } else if (s === 'disconnected') {
      log.warn('rtc', `Связь с ${this.name} прервалась, жду восстановления…`);
      clearTimeout(this.discTimer);
      this.discTimer = setTimeout(() => { if (this.pc.connectionState === 'disconnected') this.restart('нет связи 6 секунд'); }, 6000);
    } else if (s === 'failed') {
      if (this.restarts < 3) { this.restart('соединение не установилось'); this.armWatchdog(); }
      else if (this.slowDelay) this.slowRetry();
      else {
        this.slowRetry();
        log.error('rtc', `Не удаётся соединиться с ${this.name} — не будет слышно друг друга`, {
          hint: this.voice.iceServers.some((x) => x.username)
            ? 'Не вышло даже через ретранслятор сервера. Хозяину сервера: проверьте, что в панели хостинга открыты порты 3478 (TCP и UDP) и 40000–40999 (UDP). Ещё бывает, что антивирус или брандмауэр Windows блокирует «Сходку» — разрешите её для частных и общественных сетей.'
            : 'Чаще всего виноват брандмауэр Windows: Radmin VPN создаёт сеть, которую Windows считает «Общественной», а разрешение для программы дано только для «Частных». Откройте «Брандмауэр Защитника Windows → Разрешение взаимодействия с приложением» и поставьте обе галочки для «Сходки» (у вас и у друга). Также проверьте, что вы в одной сети Radmin и пинг между вами проходит. Надёжнее — сервер в интернете: у него есть ретранслятор для тех, кто не может соединиться напрямую.',
        });
      }
    }
  }

  // после трёх быстрых попыток не сдаёмся: пробуем реже (30 с, 60 с, потом раз в 2 минуты), пока не соединимся —
  // например, Radmin VPN отвалился на минуту и вернулся
  slowRetry() {
    if (this.slowTimer || this.pc.signalingState === 'closed') return;
    this.slowDelay = Math.min(120000, this.slowDelay ? this.slowDelay * 2 : 30000);
    this.slowTimer = setTimeout(() => {
      this.slowTimer = null;
      if (this.pc.signalingState === 'closed' || this.pc.connectionState === 'connected') return;
      log.info('rtc', `Снова пробую соединиться с ${this.name}`);
      try { this.pc.restartIce(); } catch (_) { /* ignore */ }
      this.slowRetry();
    }, this.slowDelay);
  }

  restart(reason) {
    this.restarts++;
    log.warn('rtc', `Переподключение к ${this.name} (${reason}), попытка ${this.restarts}/3`);
    try { this.pc.restartIce(); } catch (e) { log.warn('rtc', `restartIce: ${e.message}`); }
  }

  async setMicTrack(track) {
    if (this.fxOk) { await this.refreshFx(); if (track) track = this.voice.mic.voiceTrack || track; } // 1.23: голос без музыки и звуков
    if (this.micSender) { await this.micSender.replaceTrack(track); return; }
    if (!track) return;
    if (this.audioTx && this.audioTx.sender && !this.audioTx.sender.track) {
      this.audioTx.direction = 'sendrecv';
      this.audioTx.sender.setStreams(this.voice.micStream);
      await this.audioTx.sender.replaceTrack(track);
      this.micSender = this.audioTx.sender;
      if (this.voice.musicKbps) this.applyMusicBitrate();
      return;
    }
    this.micSender = this.pc.addTrack(track, this.voice.micStream);
    this.voiceTx = this.pc.getTransceivers().find((t) => t.sender === this.micSender);
    preferRed(this.voiceTx);
    if (this.voice.musicKbps) this.applyMusicBitrate();
  }

  // ---- отправка своей демонстрации этому участнику ----
  async attachScreen(sc) {
    this.signal({ kind: 'screen-meta', streamId: sc.stream.id, info: sc.info });
    const tg = this.voice.target(); const codec = this.voice.codec();
    const enc = { maxBitrate: tg.mbps * 1e6, maxFramerate: sendFps(sc, tg) };
    // 1.19.0: захват видеокартой — подмену кадров Chromium принимает, только если она стоит на отправке до первого
    // согласования (иначе он тихо пропускает её мимо — проверено: через сервер шла пустышка 16×16). Отправка, которая
    // уже договорилась без подмены, для этого не годится — закрываем её и делаем новую.
    // 1.19.2: и наоборот — на отправке, где подмена была, а потом её сняли, Chromium обычные кадры выбрасывает
    // (проверено: кодировщик сжимал, а не уходило ни байта — у зрителя пусто после показа видеокартой)
    if (this.vtx && !!sc.gpu !== !!this.vtxGpu) { try { this.vtx.stop(); } catch (_) { /* уже закрыта */ } this.vtx = null; }
    if (!this.vtx) {
      this.vtx = this.pc.addTransceiver(sc.video, { direction: 'sendonly', streams: [sc.stream], sendEncodings: [enc] });
      this.vtxGpu = !!sc.gpu;
      if (sc.gpu) { sc.gpu.attach(this.vtx.sender, this.name); this.gpuOut = sc.gpu; }
      if (prefCodecs(this.vtx, 'video', codec) === false) log.warn('screen', `Кодек ${codecRu(codec)} недоступен на этом ПК — будет выбран автоматически`);
    } else {
      // зритель вернулся или показ начат заново — кодек мог смениться, обновляем предпочтение до согласования
      prefCodecs(this.vtx, 'video', codec);
      this.vtx.sender.setStreams(sc.stream);
      await this.vtx.sender.replaceTrack(sc.video);
      this.vtx.direction = 'sendonly';
    }
    // захват видеокартой — сжатые пустышки на этой отправке подменяются кадрами помощника (attach второй раз не ставит)
    if (sc.gpu) { sc.gpu.attach(this.vtx.sender, this.name); this.gpuOut = sc.gpu; }
    else if (this.vtx.sender.transform) { this.vtx.sender.transform = null; this.gpuOut = null; }
    if (sc.audio) await this.attachScreenAudio(sc);
    this.sentScreen = true;
    this.attachedAt = performance.now();
    await this.applyEncoding();
  }

  async attachScreenAudio(sc) {
    if (!this.atx) this.atx = this.pc.addTransceiver(sc.audio, { direction: 'sendonly', streams: [sc.stream], sendEncodings: [{ maxBitrate: SCREEN_AUDIO_BITRATE }] });
    else { this.atx.sender.setStreams(sc.stream); await this.atx.sender.replaceTrack(sc.audio); this.atx.direction = 'sendonly'; }
  }

  // Кодек меняется только через повторное согласование (картинка на секунду замрёт)
  async changeCodec(codec) {
    if (!this.vtx || !this.sentScreen || this.viaSfu) return;
    if (prefCodecs(this.vtx, 'video', codec) === false) { log.warn('screen', `Кодек ${codecRu(codec)} недоступен на этом ПК`); return; }
    if (this.pc.signalingState !== 'stable') return;
    await this.pc.onnegotiationneeded();
  }

  async applyEncoding() {
    if (this.viaSfu) return; // смотрит через сервер — качество задаёт один общий поток (Voice.sfuEncoding)
    let failed = false;
    if (this.atx && this.sentScreen) {
      try {
        const ap = this.atx.sender.getParameters();
        if (!ap.encodings || !ap.encodings.length) ap.encodings = [{}];
        ap.encodings[0].maxBitrate = SCREEN_AUDIO_BITRATE; ap.encodings[0].priority = 'high'; ap.encodings[0].networkPriority = 'high';
        await this.atx.sender.setParameters(ap);
      } catch (e) { failed = true; log.debug('screen', `Параметры звука трансляции для ${this.name}: ${e.message}`); }
    }
    if (!this.vtx || !this.sentScreen) return;
    const sender = this.vtx.sender;
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      // всё как в настройках (1.17.0: автоподстройки под зрителя больше нет)
      const tg = this.voice.target();
      // не впритык к интернету: если знаем свою отдачу (проверка интернета), делим её на всех зрителей с запасом 15 %
      const share = this.voice.uplinkShare();
      p.encodings[0].maxBitrate = Math.round(Math.min(tg.mbps, share) * 1e6);
      p.encodings[0].maxFramerate = sendFps(this.voice.screen, tg);
      p.encodings[0].scaleResolutionDownBy = 1; // разрешение задаёт захват (как выбрано в настройках)
      p.encodings[0].priority = 'high';
      p.encodings[0].networkPriority = 'high';
      p.degradationPreference = DEGRADE[this.voice.mode()];
      await sender.setParameters(p);
    } catch (e) {
      failed = true;
      log.debug('screen', `Параметры кодирования для ${this.name}: ${e.message}`);
    }
    // 1.17.0: пока идёт согласование (например, к показу только что добавился звук трансляции), Chromium отвергает
    // параметры («modified RTCP parameters») — и демка шла бы без них. Повторяем, когда согласование закончится.
    if (failed && !this.encRetry && (this.encTries = (this.encTries || 0) + 1) <= 3) {
      this.encRetry = true;
      this.whenStable().then(() => { this.encRetry = false; if (this.sentScreen && !this.viaSfu) this.applyEncoding(); });
    } else if (!failed) this.encTries = 0;
  }

  // согласование с другом закончилось (или 5 с прошло)
  whenStable() {
    const pc = this.pc;
    return new Promise((resolve) => {
      const done = () => { pc.removeEventListener('signalingstatechange', check); clearTimeout(t); setTimeout(resolve, 50); };
      const check = () => { if (pc.signalingState === 'stable' || pc.signalingState === 'closed') done(); };
      const t = setTimeout(done, 5000);
      pc.addEventListener('signalingstatechange', check);
      check();
    });
  }

  async detachScreen() {
    if (!this.sentScreen) return;
    this.sentScreen = false;
    this.prevOut = null;
    if (this.viaSfu) { this.viaSfu = false; this.voice.updateGuard(); this.voice.emit('peers'); return; } // смотрел через сервер
    try {
      if (this.gpuOut && this.vtx) { this.gpuOut.detach(this.vtx.sender); this.gpuOut = null; }
      if (this.vtx) { await this.vtx.sender.replaceTrack(null); this.vtx.direction = 'inactive'; }
      if (this.atx) { await this.atx.sender.replaceTrack(null); this.atx.direction = 'inactive'; }
    } catch (e) { log.debug('screen', `detach: ${e.message}`); }
    this.voice.updateGuard();
    this.voice.emit('peers');
  }

  // ---- статистика: пинг, качество демонстрации, тип соединения ----
  async stats() {
    if (this.pc.connectionState === 'closed') return;
    const r = await this.pc.getStats();
    const by = new Map(); r.forEach((s) => by.set(s.id, s));
    const now = performance.now();
    // Путь, по которому реально идёт звук: у Radmin VPN их бывает два (IPv4 26.x и IPv6 fdfd::),
    // поэтому берём выбранную пару из transport, а не первую «успешную».
    const transport = [...r.values()].find((x) => x.type === 'transport' && x.selectedCandidatePairId);
    const pair = transport ? by.get(transport.selectedCandidatePairId)
      : [...r.values()].filter((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded').sort((a, b) => (b.bytesReceived || 0) - (a.bytesReceived || 0))[0];
    if (pair) {
      this.rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : this.rtt;
      const l = by.get(pair.localCandidateId); const rm = by.get(pair.remoteCandidateId);
      const key = `${l && l.address}:${l && l.candidateType}→${rm && rm.address}:${rm && rm.candidateType}`;
      if (l && rm) this.path = pathOf(l, rm);
      if (key !== this.loggedPair && l && rm) {
        const first = !this.loggedPair;
        this.loggedPair = key;
        const a = rm.address || '';
        const how = { direct: 'напрямую', lan: 'напрямую (одна домашняя сеть)', radmin: 'через Radmin VPN', hamachi: 'через Hamachi', relay: 'через ретранслятор сервера' }[this.path];
        const proto = (l.relayProtocol || l.protocol || '').toUpperCase();
        log.info('rtc', `Связь с ${this.name}: ${how} — ${l.address || '?'} ↔ ${a || '?'} (${proto}), пинг ${this.rtt ?? '?'} мс${first ? '' : ' (путь сменился)'}`);
        if (this.path === 'relay') log.info('rtc', `С ${this.name} напрямую не получилось — голос и демка идут через ретранслятор сервера${proto === 'TCP' ? ' по TCP (UDP закрыт — задержка чуть больше)' : ''}. Это нормально для «серого» адреса у провайдера или строгого роутера.`);
      }
    }
    for (const s of r.values()) {
      if (s.type === 'outbound-rtp' && s.kind === 'video' && this.sentScreen && !this.viaSfu) {
        const codec = by.get(s.codecId);
        const gpu = this.voice.screen && this.voice.screen.gpu;
        const enc = `${s.encoderImplementation || '?'}|${codec ? codec.mimeType : '?'}`;
        if (gpu && s.encoderImplementation && enc !== this.loggedEncoder) {
          this.loggedEncoder = enc;
          log.info('screen', `Кодирование для ${this.name}: H264 — видеокарта, ${encName(gpu.info.enc)} (захват видеокартой; Chromium сжимает только пустышку 16×16)`);
        } else if (s.encoderImplementation && enc !== this.loggedEncoder) {
          this.loggedEncoder = enc;
          const hw = s.powerEfficientEncoder ? 'аппаратный (видеокарта)' : 'программный (процессор)';
          log.info('screen', `Кодирование для ${this.name}: ${codec ? codec.mimeType.replace('video/', '') : '?'}, ${s.encoderImplementation} — ${hw}${pieces(codec)}`);
          const cname = codec ? codec.mimeType.replace('video/', '') : '';
          if (cname && s.powerEfficientEncoder && !(settings.hwSeen && settings.hwSeen[cname])) set({ hwSeen: { ...(settings.hwSeen || {}), [cname]: s.encoderImplementation } });
          // 1.19.2: совет — по выбранному кодеку. «H.264 — процессор» и «несколько ядер» выбраны нарочно — молчим;
          // набора «Плавно» в меню показа нет с 1.15.5 (раньше совет отправлял туда)
          const chosen = this.voice.codec();
          if (!s.powerEfficientEncoder && this.voice.target().fps >= 60 && (s.frameHeight || 0) >= 1000 && !isCpuH264(chosen)) {
            log.warn('screen', '1080p60 сжимает процессор — возможны подтормаживания', { hint: chosen === 'H264'
              ? 'Выбран H.264, но видеокарта не взяла сжатие на себя. Попробуйте «Видеокартой, как OBS» (стрелка у кнопки показа → «Захват») или обновите драйвер видеокарты.'
              : `Сейчас кодек ${codecRu(chosen)} — его сжимает процессор. Видеокартой сжимается H.264: выберите «H.264 (рекомендуется)» в Настройки → Показ экрана или включите «Видеокартой, как OBS» (стрелка у кнопки показа).` });
          }
        }
        if (this.prevOut) {
          const dt = (now - this.prevOut.t) / 1000;
          this.outStats = { fps: Math.round(s.framesPerSecond || 0), w: gpu ? gpu.info.w : s.frameWidth, h: gpu ? gpu.info.h : s.frameHeight, mbps: ((s.bytesSent - this.prevOut.bytes) * 8 / dt / 1e6) };
        }
        this.prevOut = { t: now, bytes: s.bytesSent };
        const reason = s.qualityLimitationReason || 'none';
        if (reason !== 'none') {
          if (reason === this.limit.reason) this.limit.n++; else this.limit = { reason, n: 1 };
          if (this.limit.n === (reason === 'bandwidth' ? 5 : 3)) {
            if (reason === 'cpu') log.warn('screen', `Процессор не успевает кодировать демонстрацию для ${this.name} — качество снижено`, { hint: cpuCodecHint(this.voice.codec()) });
            else if (reason === 'bandwidth') log.warn('screen', `Не хватает скорости отдачи до ${this.name} — качество снижено`, { hint: `Ваш интернет не тянет ${this.voice.target().mbps} Мбит/с на каждого зрителя. Снизьте битрейт в настройках. Кабель вместо Wi-Fi и закрытые торренты/загрузки обычно помогают.` });
          }
        } else this.limit = { reason: 'none', n: 0 };
        // первые 15 с кодировщик «разгоняется» — ограничения в это время нормальны
        if (now - (this.attachedAt || 0) < 15000) this.limit = { reason: 'none', n: 0 };
        // «светофор» у зрителя: сообщаем ему, что происходит у нас (при изменении и раз в 15 с).
        // lvl всегда 0 — для «светофора» старых версий (у них по нему было «качество снижено автоподстройкой»)
        const msrc = [...r.values()].find((x) => x.type === 'media-source' && x.kind === 'video');
        if (!gpu) this.voice.checkEncoder(s, msrc, this.attachedAt || 0, `для ${this.name}`);
        const hh = { lim: this.limit.n >= 2 ? this.limit.reason : 'none', lvl: 0, hw: gpu ? true : !!s.powerEfficientEncoder, src: msrc ? Math.round(msrc.framesPerSecond || 0) : 0 };
        const hk = JSON.stringify(hh);
        if (hk !== this.sentHealth || now - (this.sentHealthAt || 0) > 15000) { this.sentHealth = hk; this.sentHealthAt = now; this.signal({ kind: 'screen-h', ...hh }); }
      }
      if (s.type === 'inbound-rtp' && s.kind === 'audio' && s.trackIdentifier === this.voiceTrackId) this.audioStats(s, now);
      if (s.type === 'inbound-rtp' && s.kind === 'audio' && !this.sfuIn && this.remoteScreen && s.trackIdentifier === (this.remoteScreen.getAudioTracks()[0] || {}).id) this.screenAudioStats(s, now);
      if (s.type === 'inbound-rtp' && s.kind === 'video' && this.remoteScreen && !this.sfuIn) this.inVideo(s, by, now);
    }
    // смотрю демку через сервер (размножитель): картинка приходит не по соединению с другом, а от сервера
    const sv = this.sfuIn && this.sfuIn.video;
    if (sv && !sv.closed && this.remoteScreen) {
      const r2 = await sv.getStats().catch(() => null);
      if (r2) { const by2 = new Map(); r2.forEach((x) => by2.set(x.id, x)); for (const x of r2.values()) if (x.type === 'inbound-rtp' && x.kind === 'video') this.inVideo(x, by2, now); }
    }
    const sa = this.sfuIn && this.sfuIn.audio;
    if (sa && !sa.closed && this.remoteScreen) {
      const r3 = await sa.getStats().catch(() => null);
      if (r3) for (const x of r3.values()) if (x.type === 'inbound-rtp' && x.kind === 'audio') this.screenAudioStats(x, now);
    }
  }

  // 1.19.3: звук демки (зритель) — та же проверка, что у голоса: потери, «дрожание» сети и «додуманный» звук.
  // Раньше проверялся только голос, и «звук рябит» у irritat 24.10 в журналах не было видно никак.
  // Тишина, которую «додумывать» не нужно (стример молчит), не считается
  screenAudioStats(s, now) {
    const prev = this.prevScreenAudio;
    const cur = { id: s.id, lost: s.packetsLost || 0, recv: s.packetsReceived || 0, conc: (s.concealedSamples || 0) - (s.silentConcealedSamples || 0), total: s.totalSamplesReceived || 0, events: s.concealmentEvents || 0 };
    this.prevScreenAudio = cur;
    if (!prev || prev.id !== cur.id) return; // напрямую ↔ через сервер — счётчики свои
    const lost = cur.lost - prev.lost; const recv = cur.recv - prev.recv; const total = cur.total - prev.total;
    const a = { loss: recv + lost > 0 ? (Math.max(0, lost) / (recv + lost)) * 100 : 0, jitter: Math.round((s.jitter || 0) * 1000), conceal: total > 0 ? ((cur.conc - prev.conc) / total) * 100 : 0, events: cur.events - prev.events };
    this.screenAudioIn = a;
    this.screenAudioBad = a.conceal > 3 && a.events >= 3 ? (this.screenAudioBad || 0) + 1 : 0;
    if (this.screenAudioBad !== 2 || (this.screenAudioWarnAt && now - this.screenAudioWarnAt < 60000)) return;
    this.screenAudioWarnAt = now;
    const where = `${a.conceal.toFixed(0)}% звука пришлось «додумывать», потери пакетов ${a.loss.toFixed(1)}%, дрожание сети ${a.jitter} мс`;
    if (a.loss > 1) log.warn('screen', `Звук демки ${this.name} прерывается: теряются пакеты (${where})`, { hint: `Нестабильный интернет — у вас или у ${this.name}. Если у других зрителей звук ровный — дело в вашем интернете. Помогает кабель вместо Wi-Fi, закрытые закачки и торренты.` });
    else if (a.jitter > 30) log.warn('screen', `Звук демки ${this.name} прерывается: сильно скачет задержка сети (${where})`, { hint: 'Обычно это Wi-Fi или загруженный канал (закачки, стримы). Помогает кабель или сеть 5 ГГц.' });
    else log.warn('screen', `Звук демки ${this.name} прерывается, хотя сеть в порядке (${where})`, { hint: `Скорее не успевает компьютер ${this.name}: игра и сжатие демки процессором (особенно кодек AV1 или VP9 — для игр лучше H.264). Если с перебоями и голоса друзей — не успевает ваш компьютер.` });
  }

  // входящая картинка демки (зритель): кадры, скорость, потери, «не успевает этот ПК»; s — inbound-rtp видео
  inVideo(s, by, now) {
    const codec = by.get(s.codecId);
    if (this.prevIn) {
      const dt = (now - this.prevIn.t) / 1000;
      const lost = s.packetsLost - this.prevIn.lost; const got = s.packetsReceived - this.prevIn.recv;
      this.screenStats = {
        fps: Math.round(s.framesPerSecond || 0), w: s.frameWidth || 0, h: s.frameHeight || 0,
        mbps: (s.bytesReceived - this.prevIn.bytes) * 8 / dt / 1e6,
        loss: got + lost > 0 ? (lost / (got + lost)) * 100 : 0,
        codec: codec ? codec.mimeType.replace('video/', '') : '', decoder: s.decoderImplementation || '',
        freezes: s.freezeCount || 0, newFreezes: (s.freezeCount || 0) - (this.prevIn.freezes || 0),
      };
      // зритель: успевает ли этот компьютер показывать картинку (выкидывает кадры, долго декодирует)
      const fr = (s.framesReceived || 0) - (this.prevIn.frames || 0); const dropped = (s.framesDropped || 0) - (this.prevIn.dropped || 0);
      const dec = (s.framesDecoded || 0) - (this.prevIn.decoded || 0); const decT = (s.totalDecodeTime || 0) - (this.prevIn.decT || 0);
      const perFrame = dec > 0 ? decT / dec : 0; const budget = 1 / Math.max(15, (this.remoteScreenInfo && this.remoteScreenInfo.fps) || 60);
      // и только когда кадров реально меньше нужного — иначе это не мешает смотреть. Только для журнала и «светофора»:
      // стримера снизить качество не просим (1.17.0 — автоподстройки под зрителя больше нет)
      const slow = fr > 20 && this.screenStats.fps < (1 / budget) * 0.85 && (dropped / fr > 0.15 || perFrame > budget);
      this.slowTicks = slow ? this.slowTicks + 1 : 0;
      const slowHere = this.slowTicks >= 2;
      if (slowHere !== this.slowHere) {
        this.slowHere = slowHere;
        if (slowHere) log.info('screen', `Компьютер не успевает показывать демонстрацию ${this.name} (выброшено ${Math.round(dropped / fr * 100)}% кадров, декодирование ${Math.round(perFrame * 1000)} мс на кадр)`, { hint: 'Закройте тяжёлые программы, обновите драйвер видеокарты; помогает и окно демки поменьше.' });
      }
      const want = (this.remoteScreenInfo && this.remoteScreenInfo.fps) || 60;
      if (this.screenStats.fps && this.screenStats.fps < want * 0.7) this.lowFps++; else this.lowFps = 0;
      if (this.lowFps === 4) {
        // экран стримера сам отдаёт столько кадров (он сообщает частоту захвата в screen-h): почти стоит — это не беда,
        // двигается, но кадров мало — больше и не придёт. 1.19.2: без «компьютер не успевает» — ровные ~32 кадра у vertigo
        // (24.10) были не нехваткой сил, а, скорее всего, таймером Windows 11 при окне «Сходки», закрытом игрой
        const hs = this.remoteHealth && Date.now() - this.remoteHealth.at < 40000 ? this.remoteHealth : null;
        const src = hs && hs.src > 0 ? hs.src : 0;
        if (src && this.screenStats.fps >= src * 0.8) {
          if (src < 10) log.debug('screen', `Демонстрация ${this.name}: экран почти не меняется — ${this.screenStats.fps} кадров/с, так и должно быть`);
          else log.info('screen', `Демонстрация ${this.name}: экран стримера отдаёт только ${Math.round(src)} кадров/с — больше и не приходит`, { hint: src >= 30 && src <= 34
            ? `Ровно около 32 кадров/с часто бывает в Windows 11, когда окно «Сходки» у стримера свёрнуто или закрыто игрой. ${this.name} может попробовать «Видеокартой, как OBS» (стрелка у кнопки показа).`
            : `Так бывает, когда картинка на экране стримера меняется реже или он показывает одно окно. ${this.name} может попробовать «Видеокартой, как OBS» (стрелка у кнопки показа).` });
          this.lowFps = 5; // повторять не будем, пока кадров снова не станет нормально
        } else {
        const why = this.screenStats.loss > 2 ? `потеря пакетов ${this.screenStats.loss.toFixed(1)}% — сеть не справляется` : 'стример ограничен процессором/скоростью отдачи или ваш ПК не успевает декодировать';
        log.warn('screen', `Демонстрация ${this.name}: ${this.screenStats.fps} FPS вместо ${want} (${why})`, { hint: 'Подробности — в журнале у стримера. Где узкое место, видно по цветной точке слева внизу демки (наведите мышку).' });
        }
      }
      if (this.screenStats.loss > 5) log.debug('screen', `Потери ${this.screenStats.loss.toFixed(1)}%`);
    }
    this.prevIn = { t: now, bytes: s.bytesReceived, lost: s.packetsLost || 0, recv: s.packetsReceived || 0, frames: s.framesReceived || 0, dropped: s.framesDropped || 0, decoded: s.framesDecoded || 0, decT: s.totalDecodeTime || 0, freezes: s.freezeCount || 0 };
    this.healthHist = (this.healthHist || []).concat(this.screenStats ? [this.screenStats] : []).slice(-3); // ~6 с для «светофора»
  }

  // откуда брать статистику картинки демки этого стримера: от сервера (размножитель) или от соединения с другом
  screenReport() {
    const sv = this.sfuIn && this.sfuIn.video;
    return sv && !sv.closed ? sv.getStats() : this.pc.getStats();
  }

  // «Светофор» демки у зрителя: где узкое место — у стримера, в сети или у этого компьютера.
  // Смотрим на последние ~6 секунд, чтобы одна неровная секунда не перекрашивала его.
  screenHealth() {
    const hist = this.healthHist || [];
    if (!this.remoteScreen) return null;
    // 1.17.4: проверка картинки нашла чёрную или пустую — раньше «светофор» считал это «картинка почти не меняется, всё хорошо»
    if (this.picBad) return { level: 'bad', short: 'нет картинки', why: this.picBad };
    if (!hist.length) return null;
    const avg = (f) => hist.reduce((t, x) => t + f(x), 0) / hist.length;
    const fps = avg((x) => x.fps), loss = avg((x) => x.loss), mbps = avg((x) => x.mbps);
    const freezes = hist.reduce((t, x) => t + Math.max(0, x.newFreezes || 0), 0);
    const h = this.remoteHealth && Date.now() - this.remoteHealth.at < 40000 ? this.remoteHealth : null;
    // сколько кадров вообще может прийти: не больше, чем захватывает стример (игра на 45 к/с — это не «просадка»)
    let want = (this.remoteScreenInfo && this.remoteScreenInfo.fps) || 60;
    if (h && h.src > 0) want = Math.min(want, h.src);
    const relay = this.path === 'relay' ? ' Связь идёт через ретранслятор сервера.' : this.path === 'radmin' ? ' Связь идёт через Radmin VPN — если он гонит её через свой ретранслятор, будет хуже.' : '';
    // картинка стоит (текст, пауза в игре) — кадров мало нарочно, это не проблема
    if (fps < want * 0.6 && mbps < 0.6 && loss < 1 && !freezes) return { level: 'ok', short: '', why: 'Всё хорошо. Картинка почти не меняется — кадров меньше нарочно, так экономится скорость.' };
    let level = 'ok', short = '', why = 'Всё хорошо: кадров столько, сколько отдаёт стример, потерь нет.';
    const low = fps < want * 0.85, veryLow = fps < want * 0.6;
    if (this.slowHere) { short = 'ваш ПК'; why = 'Узкое место — этот компьютер: не успевает распаковывать и показывать картинку. Закройте тяжёлые программы, обновите драйвер видеокарты.'; }
    else if (h && h.lim === 'cpu') { short = 'ПК стримера'; why = `Узкое место — компьютер стримера: не успевает сжимать видео${h.hw ? '' : ' (сжимает процессор, а не видеокарта)'}. Стримеру: 30 кадров/с в Настройки → Показ экрана, игра в «окне без рамки».`; }
    else if (loss > 2) { short = 'сеть'; why = `Узкое место — сеть: теряется ${loss.toFixed(1)}% пакетов.${relay} Чаще всего виноват Wi-Fi у стримера или у вас — кабель решает. Помогают закрытые торренты и загрузки.`; }
    else if (h && h.lim === 'bandwidth') { short = 'скорость'; why = `Узкое место — скорость между вами: отдача интернета у стримера или ваш интернет.${relay} Стримеру: кабель вместо Wi-Fi, закрыть загрузки; или скорость поменьше в Настройки → Показ экрана.`; }
    else if (low) { short = 'мало кадров'; why = `Кадров ${Math.round(fps)} из ${want}.${relay} Подробности — в журнале у стримера.`; }
    if (!short && h && h.src > 0 && h.src < ((this.remoteScreenInfo && this.remoteScreenInfo.fps) || 60) * 0.7) why += ` Стример захватывает ${h.src} кадров/с — больше и не придёт (так бывает при показе одного окна или в меню игры).`;
    if (short) level = veryLow || loss > 5 || freezes > 1 ? 'bad' : 'warn';
    else if (freezes) { level = 'warn'; short = 'рывки'; why = `Картинка замирала (${freezes} раз за несколько секунд).${relay} Если часто — включите «Плавно» внизу демки.`; }
    return { level, short, why };
  }

  // Качество входящего голоса: потери пакетов, «дрожание» сети и заполненные паузы (то, что слышно как заикания)
  audioStats(s, now) {
    const prev = this.prevAudio;
    this.prevAudio = { t: now, lost: s.packetsLost || 0, recv: s.packetsReceived || 0, conc: s.concealedSamples || 0, total: s.totalSamplesReceived || 0, events: s.concealmentEvents || 0 };
    if (!prev) return;
    const lost = this.prevAudio.lost - prev.lost; const recv = this.prevAudio.recv - prev.recv;
    const total = this.prevAudio.total - prev.total; const conc = this.prevAudio.conc - prev.conc;
    const a = {
      loss: recv + lost > 0 ? (Math.max(0, lost) / (recv + lost)) * 100 : 0,
      jitter: Math.round((s.jitter || 0) * 1000),
      conceal: total > 0 ? (conc / total) * 100 : 0,
      events: this.prevAudio.events - prev.events,
      buffer: s.jitterBufferEmittedCount ? Math.round((s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000) : null,
    };
    this.audioIn = a;
    // заикания — это когда приходится «додумывать» звук; тихие паузы (DTX) сюда не попадают
    const bad = a.conceal > 3 && a.events >= 3;
    this.audioBad = bad ? (this.audioBad || 0) + 1 : 0;
    if (this.audioBad === 2 && (!this.audioWarnAt || now - this.audioWarnAt > 30000)) {
      this.audioWarnAt = now;
      const where = `${a.conceal.toFixed(0)}% звука пропало, потери пакетов ${a.loss.toFixed(1)}%, дрожание сети ${a.jitter} мс`;
      if (a.loss > 1) log.warn('audio', `Голос ${this.name} прерывается: теряются пакеты (${where})`, { hint: `Нестабильный интернет — у вас или у ${this.name}. Помогает кабель вместо Wi-Fi, сеть 5 ГГц, закрыть закачки и торренты. Если у остальных ${this.name} звучит нормально — проблема в вашем интернете.` });
      else if (a.jitter > 30) log.warn('audio', `Голос ${this.name} прерывается: сильно скачет задержка сети (${where})`, { hint: 'Обычно это Wi-Fi или загруженный канал (закачки, стримы). Попробуйте кабель или сеть 5 ГГц.' });
      // 1.17.3: виноват может быть и компьютер говорящего (22.10: irritat сжимал демку AV1 процессором — пакеты голоса опаздывали)
      else log.warn('audio', `Голос ${this.name} прерывается, хотя сеть в порядке (${where})`, { hint: `Не успевает компьютер — ваш или ${this.name}. Если прерывается только ${this.name} — скорее у него: игра или демка грузят процессор (демке — кодек H.264, 30 кадров/с). Если прерываются все — у вас: проверьте нагрузку на процессор, режим питания «Максимальная производительность», другие наушники (особенно если Bluetooth), звуковой драйвер.` });
    }
    // говорящий сам не слышит, как его слышат, — подскажем ему (не чаще раза в минуту и только если виновата сеть)
    if (this.audioBad >= 2 && (a.loss > 1 || a.jitter > 30) && (!this.voiceQSentAt || now - this.voiceQSentAt > 60000)) {
      this.voiceQSentAt = now;
      this.signal({ kind: 'voice-q', loss: Math.round(a.loss * 10) / 10, conceal: Math.round(a.conceal), jitter: a.jitter, path: this.path || '' });
    }
  }

  close() {
    clearTimeout(this.discTimer);
    clearTimeout(this.watchdog); clearTimeout(this.slowTimer); this.slowTimer = null;
    clearTimeout(this.sfuReWatch);
    if (this.sfuIn) { this.voice.sfu.closeConsumers(this.name); this.sfuIn = null; }
    // 1.20.3: зритель ушёл или соединение пересоздаётся — его отправку «Видеокартой» отцепляем. Раньше она оставалась
    // у помощника, не брала кадры и раз в секунду просила целый кадр — всем остальным зрителям (волны «квадратов»)
    if (this.gpuOut && this.vtx) { this.gpuOut.detach(this.vtx.sender); this.gpuOut = null; }
    try { this.pc.close(); } catch (_) { /* ignore */ }
    this.voice.output.remove('voice:' + this.name);
    this.voice.output.remove('screen:' + this.name);
    this.voice.output.remove('music:' + this.name);
    this.voice.output.remove('sfx:' + this.name);
  }
}

export class Voice {
  constructor({ me, conn, mic, output, iceServers = [], relayOnly = false, sfu = false }) {
    this.me = me; this.conn = conn; this.mic = mic; this.output = output; this.iceServers = iceServers; this.relayOnly = relayOnly;
    this.sfuOn = !!sfu;          // 1.16: на сервере работает размножитель демки (server/sfu.js)
    this.sfu = new SfuLink(this);
    this.sfuSt = { prev: null, limit: { reason: 'none', n: 0 }, loggedEnc: '', sentHealth: '', sentAt: 0, since: 0 };
    this.sfuOut = null;
    this.peers = new Map();
    this.room = null;
    this.micTrack = null; this.micStream = new MediaStream();
    this.screen = null;       // моя демонстрация
    this.watching = null;     // чью демонстрацию смотрю
    this.screenVolume = settings.screenVolume ?? 100;
    this.screenMuted = false;
    this.screenGen = 0;       // номер запуска показа (чтобы отменять устаревшие)
    this.handlers = new Map();
    this.statsTimer = null;
    this.musicKbps = 0;       // играет музыка для всех (music.js) — битрейт голосовой дорожки, 0 — обычный
    // 1.23: постоянные «потоки» для отдельных дорожек музыки и звуков — по их id друг узнаёт, что это за дорожка
    this.musicOut = new MediaStream(); this.sfxOut = new MediaStream();
    this.musicOn = false; this.sfxOn = false; this.sfxTimer = null;
  }

  setMusicBitrate(kbps) {
    const v = Math.max(0, Math.round(Number(kbps) || 0));
    if (v === this.musicKbps) return;
    this.musicKbps = v;
    this.musicOn = v > 0;
    for (const p of this.peers.values()) { p.applyMusicBitrate(); p.refreshFx(); }
  }

  // звук для всех вот-вот заиграет (soundboard.js): включаем дорожку звуков; выключится через 30 с тишины.
  // true — дорожка только что включилась (друзьям нужен миг, чтобы её принять)
  async sfxWake(ms = 0) {
    clearTimeout(this.sfxTimer);
    this.sfxTimer = setTimeout(() => { this.sfxOn = false; for (const p of this.peers.values()) p.refreshFx(); }, ms + 30e3);
    if (this.sfxOn) return false;
    this.sfxOn = true;
    const fx = [...this.peers.values()].filter((p) => p.fxOk);
    await Promise.all(fx.map((p) => p.refreshFx()));
    return fx.length > 0;
  }

  // громкость музыки или звуков друга у меня: его ползунок × общий ползунок в настройках
  fxVolume(kind, name) {
    const per = (settings[kind === 'music' ? 'userMusicVolumes' : 'userSfxVolumes'] || {})[name] ?? 100;
    const all = settings[kind === 'music' ? 'friendsMusicVolume' : 'friendsSfxVolume'] ?? 100;
    return Math.round((per * all) / 100);
  }
  applyFxVolumes() {
    for (const name of this.peers.keys()) for (const k of ['music', 'sfx']) this.output.setSourceVolume(k + ':' + name, this.fxVolume(k, name));
  }

  on(type, cb) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(cb); }
  emit(type, data) { for (const cb of this.handlers.get(type) || []) { try { cb(data); } catch (e) { log.error('ui', e.message, { err: e }); } } }

  peer(name) {
    let p = this.peers.get(name);
    if (!p) { p = new Peer(this, name); this.peers.set(name, p); this.emit('peers'); }
    return p;
  }

  // Соединение начинает новичок (он присылает предложение) — так нет «встречных» предложений.
  async join(room, peerNames) {
    this.room = room;
    for (const n of peerNames) this.peer(n);
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => {
      for (const p of this.peers.values()) p.stats().catch((e) => log.debug('rtc', `stats: ${e.message}`));
      this.sfuStats().catch((e) => log.debug('screen', `статистика размножителя: ${e.message}`));
      this.sendWatchers();
      this.emit('stats');
    }, 2000);
  }

  // 1.20: зрителям — кто ещё смотрит мою демку (при изменении и раз в 15 с; старые версии сигнал пропускают)
  sendWatchers() {
    const viewers = this.screen ? [...this.peers.values()].filter((p) => p.sentScreen) : [];
    const who = viewers.map((p) => p.name);
    const key = JSON.stringify(who), now = Date.now();
    if (key === this.sentWatchers && now - (this.sentWatchersAt || 0) < 15000) return;
    this.sentWatchers = key; this.sentWatchersAt = now;
    for (const p of viewers) p.signal({ kind: 'screen-vw', who });
  }

  // друг сменил ник посреди звонка: соединение то же, меняются только имена
  renamePeer(from, to) {
    if (this.me === from) { this.me = to; return; }
    const p = this.peers.get(from);
    if (!p) return;
    this.peers.delete(from); this.peers.set(to, p);
    p.name = to;
    this.output.renameSource('voice:' + from, 'voice:' + to);
    this.output.renameSource('screen:' + from, 'screen:' + to);
    this.output.renameSource('music:' + from, 'music:' + to);
    this.output.renameSource('sfx:' + from, 'sfx:' + to);
    if (this.watching === from) this.watching = to;
    if (this.sfu.cons.has(from)) { this.sfu.cons.set(to, this.sfu.cons.get(from)); this.sfu.cons.delete(from); } // потоки демки с сервера
    this.emit('peers');
  }

  // друг зашёл заново (а не продолжил после обрыва) — его старое соединение больше не нужно, ждём от него новое предложение
  peerJoined(name) {
    if (this.peers.has(name)) {
      log.debug('rtc', `${name} зашёл заново — старое соединение закрываю`);
      const rewatch = this.watching === name;
      this.peerLeft(name);
      if (rewatch) this.pendingWatch = name; // смотрели его демку — продолжим, как только соединимся снова
    }
    log.debug('rtc', `${name} зашёл, жду от него предложение`);
  }

  // мы вернулись на сервер после обрыва, звонок не прерывался: обновляем учётки ретранслятора и чиним то, что успело порваться
  resumed(names, iceServers) {
    if (iceServers) {
      this.iceServers = iceServers;
      const all = [...iceServers, ...parseIceServers(settings.iceServers)];
      for (const p of this.peers.values()) { try { p.pc.setConfiguration({ ...p.pc.getConfiguration(), iceServers: all }); } catch (e) { log.debug('rtc', `setConfiguration: ${e.message}`); } }
    }
    for (const p of this.peers.values()) {
      if (p.pc.connectionState !== 'connected' && p.pc.signalingState !== 'closed') { log.info('rtc', `${p.name}: связь прервалась, пока не было сервера — переподключаюсь`); try { p.pc.restartIce(); } catch (_) { /* ignore */ } }
    }
    this.syncRoom(names);
  }

  // сервер перезапускался и не помнит комнату: соединения с друзьями создаём заново (как новичок — мы присылаем
  // предложения), а микрофон, свою демку и громкости не трогаем
  rebuild(names, iceServers) {
    if (iceServers) this.iceServers = iceServers;
    this.sfu.reset(); // сервер перезапускался — его размножитель всё забыл
    const rewatch = this.watching;
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    if (rewatch) { this.watching = null; this.pendingWatch = rewatch; }
    for (const n of names) this.peer(n);
    this.updateGuard();
    this.emit('peers'); this.emit('screen');
  }

  // список комнаты от сервера: кого там больше нет дольше минуты — закрываем (он мог уйти, пока мы были без сервера)
  syncRoom(names) {
    const here = new Set(names);
    const now = Date.now();
    for (const [name, p] of [...this.peers]) {
      if (here.has(name)) { p.missingSince = 0; continue; }
      if (!p.missingSince) p.missingSince = now;
      else if (now - p.missingSince > 60e3) { log.info('rtc', `${name} больше нет в комнате — закрываю соединение`); this.peerLeft(name); }
    }
    if (!this.syncTimer) this.syncTimer = setInterval(() => { if (this.lastNames) this.syncRoom(this.lastNames); }, 20e3);
    this.lastNames = names;
  }

  peerLeft(name) {
    const p = this.peers.get(name);
    if (!p) return;
    p.close();
    this.peers.delete(name);
    if (p.sentScreen) this.rebalance();
    this.updateGuard();
    if (this.watching === name) { this.watching = null; this.emit('screen', name); }
    this.emit('peers');
  }

  signal(from, data) { if (this.room) this.peer(from).handle(data); }

  async setMicTrack(track) {
    this.micTrack = track;
    for (const t of this.micStream.getTracks()) this.micStream.removeTrack(t);
    if (track) this.micStream.addTrack(track);
    for (const p of this.peers.values()) await p.setMicTrack(track).catch((e) => log.warn('rtc', `Не удалось обновить микрофон для ${p.name}: ${e.message}`));
  }

  // ---------- демонстрация ----------
  // Захват — ровно как выбрано в настройках (разрешение и кадры). Посреди показа захват сам не меняется;
  // новое разрешение или кадры в настройках — экран берётся заново (applyScreenQuality → switchSource)
  videoConstraints() {
    const tg = this.target();
    const video = { frameRate: { ideal: tg.fps, max: tg.fps } };
    const h = RES[tg.res];
    if (h) video.height = { ideal: h, max: h }; // ширина подстроится по пропорциям экрана
    return video;
  }

  // Захват экрана или окна. Звук компьютера захватывается всегда, когда это возможно, —
  // тогда кнопка «Звук» включает и выключает его мгновенно, без перезапуска трансляции.
  // gpu — снимать ли видеокартой: новый показ — как в настройках, а смена экрана или качества посреди показа —
  // тем же способом, каким показ начат (1.19.2: «Видеокартой» включили посреди обычного показа — у зрителей была
  // пустышка 16×16, а помощник оставался работать после «Стоп»; новая настройка — со следующего показа, как и написано)
  async capture(sourceId, { gpu = !!settings.screenGpu && IS_WIN } = {}) {
    if (gpu) return this.captureGpu(sourceId); // 1.19.0: «Видеокартой, как OBS»
    const video = this.videoConstraints();
    const audio = IS_WIN ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, restrictOwnAudio: true } : false;
    // Звук без «Сходки» своим помощником (Windows 10 2004+/11) — запускаем параллельно с захватом экрана
    const useProc = (IS_WIN || (api.testFlags && api.testFlags.fakeProcAudio)) && settings.screenAudioExclusive !== false && processAudioAvailable();
    const allButUs = () => startProcessAudio().catch((e) => { log.warn('screen', `Звук компьютера без «Сходки» записать не удалось (${e.message}) — беру весь звук компьютера`, { hint: 'Голоса друзей будут вычитаться из трансляции программой. Нужна Windows 10 версии 2004 или новее.' }); return null; });
    // показывают одно окно — в трансляцию идёт звук только этой программы, остальные не слышны
    const wantWindow = /^window:/.test(String(sourceId)) && settings.screenAudioWindowOnly !== false;
    this.audioNote = '';
    if (wantWindow && IS_WIN && !useProc) {
      this.audioNote = 'computer';
      log.warn('screen', 'Звук только этого окна записать не получится — в трансляции будет весь звук компьютера', { hint: settings.screenAudioExclusive === false ? 'Включите «Записывать звук компьютера без звука «Сходки»» в Настройки → Показ экрана.' : 'Нужна Windows 10 версии 2004 или новее (или Windows 11).' });
    }
    const procP = !useProc ? null : wantWindow ? this.windowAudio(sourceId).then((t) => t || allButUs()) : allButUs();
    try {
      const stream = await this.captureWith(sourceId, video, audio, procP);
      stream._skhCapKey = JSON.stringify(video); // с какими настройками снят экран (applyScreenQuality)
      return stream;
    } catch (e) {
      if (procP) procP.then((t) => t && t._skhStop()); // экран не захватился — помощник не нужен
      throw e;
    }
  }

  // 1.19.0: «Видеокартой, как OBS» — экран снимает и сжимает видеокарта (gpucap.js), только весь экран.
  // В демку идёт дорожка-пустышка, её кадры на отправке подменяются готовыми кадрами помощника.
  // Звук — тем же помощником записи звука без «Сходки», что и всегда.
  async captureGpu(sourceId) {
    // 1.19.2: помощника нет (антивирус убрал или обновление поставлено без папки videocap) — говорим прямо, что делать;
    // на обычный захват сами не переходим. Выключить режим можно — переключатель в меню показа остаётся рабочим (app.js)
    const miss = await gpuCaptureMissing();
    if (miss) throw Object.assign(new Error(`Помощника захвата видеокартой нет в папке программы (${miss})`), { hint: GPU_MISSING_HINT });
    const m = /^screen:(\d+):/.exec(String(sourceId));
    if (!m) throw new Error('видеокартой показывается только весь экран — окно выберите с выключенным «Видеокартой, как OBS»');
    const tg = this.target();
    const useProc = settings.screenAudioExclusive !== false && processAudioAvailable();
    this.audioNote = '';
    if (!useProc) log.warn('screen', 'Захват видеокартой: звук компьютера пишет только помощник записи звука, а он здесь недоступен — показ пойдёт без звука', { hint: 'Нужна Windows 10 версии 2004 или новее и включённое «Записывать звук компьютера без звука «Сходки»» в Настройки → Показ экрана.' });
    const procP = useProc ? startProcessAudio().catch((e) => { log.warn('screen', `Звук компьютера записать не удалось (${e.message}) — показ пойдёт без звука`); return null; }) : null;
    const gpu = new GpuCapture({
      fps: tg.fps, kbps: startKbps(tg.mbps), output: Number(m[1]), source: String(sourceId),
      capKbps: () => Math.min(this.target().mbps, this.uplinkShare()) * 1000,
      onExit: (why, x) => this.gpuExit(gpu, why, x),
      // захват вернулся после потери экрана другого размера (игра сменила разрешение) — зрителям новый размер
      onResume: ({ resized }) => { if (resized && this.screen && this.screen.gpu === gpu) this.sendScreenMeta(); },
      onMany: (n) => this.gpuManyHint(gpu, n),
    });
    let track;
    try { track = await gpu.start(); } catch (e) {
      if (procP) procP.then((t) => t && t._skhStop && t._skhStop());
      throw new Error(`Захват видеокартой не запустился: ${e.message}`);
    }
    const stream = new MediaStream([track]);
    const pt = procP ? await procP : null;
    if (pt) stream.addTrack(pt);
    stream._skhGpu = gpu;
    stream._skhCapKey = JSON.stringify(this.videoConstraints());
    return stream;
  }

  // помощник захвата видеокартой остановился сам — показ останавливаем (на обычный захват сами не переходим).
  // lost (1.19.3) — Windows 30 с не возвращала помощнику экран
  gpuExit(gpu, why, { lost = false } = {}) {
    const sc = this.screen;
    if (!sc || sc.gpu !== gpu) return;
    log.warn('screen', `Захват видеокартой остановился (${why}) — показ остановлен`, { hint: lost ? GPU_LOST_HINT : 'Начните показ заново. Если повторяется — выключите «Видеокартой, как OBS» стрелкой у кнопки показа и пришлите журнал.' });
    this.emit('gpufail', { why, lost });
    this.stopScreen();
  }

  // 1.20.1: показ видеокартой смотрят напрямую двое и больше — сжатие одно, и качество у всех равняется на зрителя
  // с самым слабым интернетом (у vertigo 25.10 — «шакал и квадраты»). Через сервер так не бывает: один раз за показ
  // подсказываем включить значок «сервер» — сами ничего не переключаем
  gpuManyHint(gpu, n) {
    if (gpu.manyHinted || !this.sfuOn || settings.screenViaServer !== false) return;
    gpu.manyHinted = true;
    log.info('screen', `Показ видеокартой смотрят напрямую ${n} — подсказка включить «через сервер»`);
    this.emit('gpumany', { n });
  }

  // захват видеокартой: другой экран или другие кадры/с — помощник заново, показ не прерывается
  async switchGpu(sc, sourceId, name) {
    const m = /^screen:(\d+):/.exec(String(sourceId));
    if (!m) {
      log.warn('screen', 'Видеокартой показывается только весь экран — окно этим способом не показать', { hint: 'Выключите «Видеокартой, как OBS» стрелкой у кнопки показа и начните показ заново.' });
      throw new Error('видеокартой — только весь экран');
    }
    try { await sc.gpu.restart({ fps: this.target().fps, output: Number(m[1]), source: String(sourceId) }); } catch (e) {
      log.error('screen', `Захват видеокартой не перезапустился (${e.message}) — показ остановлен`);
      this.stopScreen();
      throw e;
    }
    sc.sourceId = sourceId; sc.name = name || sc.name; sc.capKey = JSON.stringify(this.videoConstraints());
    this.sendScreenMeta();
    log.info('screen', `Трансляция переключена на «${sc.name || 'экран'}» (${sc.info.w}×${sc.info.h}, видеокартой)`);
    this.emit('myscreen');
    return sc;
  }

  // звук одной программы — той, чьё окно показывают (Windows 10 2004+/11). Не получилось — null
  async windowAudio(sourceId) {
    try {
      const r = await api.procAudio.windowPid(sourceId);
      if (!r || !r.ok) throw new Error((r && r.reason) || 'не удалось узнать, чьё это окно');
      const t = await startProcessAudio({ include: r.pid });
      log.info('screen', `Звук трансляции — только из программы этого окна (процесс ${r.pid}): другие программы и «Сходка» не слышны`);
      return t;
    } catch (e) {
      this.audioNote = 'computer';
      log.warn('screen', `Звук только этого окна записать не удалось (${e.message}) — беру звук компьютера без «Сходки»`, { hint: 'Так бывает с программами, запущенными от администратора, и в старых Windows 10. Если мешает — выключите звук трансляции стрелкой у кнопки показа.' });
      return null;
    }
  }

  async captureWith(sourceId, video, audio, procP) {
    await api.screenSelect({ id: sourceId, audio: !!audio });
    let stream;
    if (FAKE_MODE === 'monitor') { // тест: видео — холст (в Xvfb захват экрана недоступен)
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d');
      let f = 0; setInterval(() => { g.fillStyle = `hsl(${(f++ * 3) % 360},60%,40%)`; g.fillRect(0, 0, 640, 360); }, 33);
      stream = cv.captureStream(30);
    } else try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio });
    } catch (e) {
      if (!audio || !['NotReadableError', 'AbortError', 'NotFoundError', 'OverconstrainedError'].includes(e.name)) throw e;
      log.warn('screen', 'Звук компьютера не захватился — показываю без звука', { hint: 'Проверьте, что в Windows выбрано устройство воспроизведения по умолчанию (Параметры → Система → Звук → Вывод).', err: e });
      await api.screenSelect({ id: sourceId, audio: false });
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    }
    if (FAKE_MODE === 'monitor' && !stream.getAudioTracks().length) {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const mon = devs.find((d) => d.kind === 'audioinput' && /loopspeakers|monitor of speakers/i.test(d.label));
      if (!mon) throw new Error('тест: нет монитора PulseAudio «Speakers»');
      const s2 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mon.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
      stream.addTrack(s2.getAudioTracks()[0]);
      this.output.playTestGame();
    } else if (FAKE_SCREEN_AUDIO && !stream.getAudioTracks().length && !procP) stream.addTrack(fakeSystemAudio());
    if (procP) {
      const pt = await procP;
      if (pt) {
        for (const t of stream.getAudioTracks()) { stream.removeTrack(t); t.stop(); }
        stream.addTrack(pt);
      } else if (FAKE_SCREEN_AUDIO && !stream.getAudioTracks().length) stream.addTrack(fakeSystemAudio());
    }
    return stream;
  }

  // Windows 11 сам исключает звук «Сходки» из захвата. Windows 10 так не умеет — тогда голоса друзей,
  // которые проигрывает программа, вычитаются из звука трансляции (echo.js), иначе друзья слышат себя.
  async prepareAudio(raw) {
    const excluded = raw._skhExcluded ? true : FAKE_MODE === '1' ? true : FAKE_MODE === 'monitor' ? false : !!raw.getSettings().restrictOwnAudio;
    if (excluded || settings.screenEchoCancel === false) return { audio: raw, raw, guard: null, excluded };
    try {
      const guard = await createEchoFreeTrack(this.output, raw, { onStatus: () => this.sendScreenMeta() });
      return { audio: guard.track, raw, guard, excluded };
    } catch (e) {
      log.warn('screen', 'Не удалось включить вычитание голосов друзей — звук пойдёт как есть', { err: e });
      return { audio: raw, raw, guard: null, excluded };
    }
  }

  releaseAudio(sc) {
    if (sc.guard) sc.guard.stop();
    if (sc.rawAudio && sc.rawAudio._skhStop) sc.rawAudio._skhStop();
    if (sc.rawAudio) sc.rawAudio.stop();
  }

  screenInfo() {
    const sc = this.screen;
    // захват видеокартой: в окне только пустышка 16×16 — размер и кадры знает помощник
    const st = sc.gpu && sc.gpu.info ? { width: sc.gpu.info.w, height: sc.gpu.info.h, frameRate: sc.gpu.info.fps } : sc.video.getSettings();
    const g = sc.guard && sc.guard.state;
    // что с голосами зрителей в звуке трансляции: excluded — Windows сама не пускает, guard — вычитаем, none — попадают
    const echo = sc.ownAudioExcluded ? { mode: 'excluded' } : g ? { mode: 'guard', ms: g.delayMs != null ? Math.round(g.delayMs) : null, db: g.removedDb != null ? Math.round(g.removedDb) : null } : { mode: 'none' };
    // gpu (1.19.2) — показ видеокартой: зритель знает, почему проверки картинки у стримера нет (старые версии поле пропускают);
    // srv (1.20.3) — показываю ли через сервер, если зритель его хочет: 0 — у меня «напрямую»
    return { w: st.width, h: st.height, fps: Math.round(st.frameRate || this.target().fps), audio: sc.audio ? (sc.audio.enabled ? 'on' : 'off') : 'none', name: sc.name, v: APP_VERSION, echo, rep: 1, pic: sc.pic || null, gpu: sc.gpu ? 1 : 0,
      srv: this.sfuUsable() && !sc.sfuFailed ? 1 : 0 };
  }

  sendScreenMeta() {
    const sc = this.screen;
    if (!sc) return;
    sc.info = this.screenInfo();
    for (const p of this.peers.values()) if (p.sentScreen) p.signal({ kind: 'screen-meta', streamId: sc.stream.id, info: sc.info });
  }

  // Показ запущен, а экран за 5 с не дал ни одного кадра — у зрителей будет чёрная демка. Так было у друга
  // на Windows 11 (сборка 26300, 21.10): захват выдавал 0 кадров. Говорим сразу — в журнале и на экране (app.js).
  watchFirstFrame(sc, track, probe) {
    probe.then((ok) => {
      if (this.screen !== sc || sc.video !== track || track.readyState !== 'live') return;
      if (ok !== false) { if (!sc.gpu) this.checkPicture(sc, track); return; } // у пустышки проверять нечего
      log.warn('screen', `За ${FIRST_FRAME_MS / 1000} секунд захват экрана не дал ни одного кадра — у зрителей демка будет чёрной`, { hint: NO_FRAMES_HINT });
      this.emit('noframes', { name: sc.name });
    });
  }

  // 1.17.5: захват кадры даёт, а кодировщик за 6 с не сжал ни одного — у зрителей чёрный экран. Так было у vertigo
  // (RX 9070 XT, драйвер 32.0.32015, 22.10): AMD H.264 принял кадры и молчал минуту. Если сжимала видеокарта (H.264) —
  // один раз переключаем демку на «H.264 — процессор» и запоминаем в настройках (вернуть можно там же). Иначе — только пишем.
  checkEncoder(s, msrc, since, who) {
    const sc = this.screen;
    if (!sc || sc.encChecked) return;
    if (performance.now() - Math.max(since || 0, sc.encSince || 0) < 6000) return;
    if (!msrc || !(msrc.frames > 30)) return; // сам захват кадров не даёт — это другая беда (watchFirstFrame / checkPicture)
    sc.encChecked = true;
    if ((s.framesEncoded || 0) > 0) return;
    const impl = s.encoderImplementation || '?';
    if (s.powerEfficientEncoder && this.codec() === 'H264') {
      log.warn('screen', `Видеокарта не сжимает демку ${who}: за 6 секунд ни одного кадра (${impl}) — у зрителей чёрный экран. Переключаю сжатие на процессор («H.264 — процессор»)`, { hint: 'Так бывает с некоторыми драйверами видеокарт (у vertigo — AMD RX 9070 XT). Вернуть сжатие видеокартой — Настройки → Показ экрана → кодек «H.264 (рекомендуется)», например после обновления драйвера.' });
      this.emit('encstuck', { impl, to: H264SW });
      sc.encChecked = false; sc.encSince = performance.now(); // через 6 с проверим и сжатие процессором
      set({ screenCodec: H264SW }); // app.js → applyScreenQuality: новый кодек зрителям и на сервер
    } else {
      log.warn('screen', `Демка ${who} не сжимается: за 6 секунд ни одного кадра (${impl}, ${s.powerEfficientEncoder ? 'видеокарта' : 'процессор'}) — у зрителей чёрный экран`, { hint: 'Пришлите журнал. Можно попробовать показать окно вместо всего экрана или другой кодек в Настройки → Показ экрана.' });
      this.emit('encstuck', { impl, to: null });
    }
  }

  // 1.17.4: первый кадр был — а дальше? Через 3 с смотрим 2 с захвата: идут ли кадры и не чёрные ли они.
  // Итог — в журнал и зрителям (screen-meta: pic), чтобы у зрителя было видно, где пропадает картинка
  checkPicture(sc, track) {
    setTimeout(async () => {
      if (this.screen !== sc || sc.video !== track || track.readyState !== 'live') return;
      const r = await pictureCheck(track);
      if (!r || this.screen !== sc || sc.video !== track) return;
      sc.pic = r.frames === 0 ? 'none' : r.max != null && r.max < PIC_BLACK ? 'black' : 'ok';
      if (sc.pic === 'none') log.warn('screen', 'Захват экрана отдал первый кадр и встал: за 2 секунды ни одного нового кадра — у зрителей картинка замрёт или будет чёрной', { hint: PIC_HINT_STREAMER });
      else if (sc.pic === 'black') log.warn('screen', `Захват экрана отдаёт кадры (${picText(r)}), но картинка чёрная — у зрителей будет чёрный экран`, { hint: PIC_HINT_STREAMER });
      else log.info('screen', `Проверка картинки: захват ${picText(r)}, картинка есть (яркость ${Math.round(r.avg / 2.55)}%)`);
      this.sendScreenMeta();
    }, 3000);
  }

  watchEnded(track) {
    track.addEventListener('ended', () => {
      if (this.screen && this.screen.video === track) { log.info('screen', 'Источник демонстрации закрыт'); this.stopScreen(); }
    });
  }

  // захват уже не нужен (показ остановили, вышли из голоса или начали другой показ) — закрываем всё
  dropCapture(stream, prep) {
    if (prep) this.releaseAudio({ guard: prep.guard, rawAudio: prep.raw });
    if (stream._skhGpu) stream._skhGpu.stop();
    for (const t of stream.getTracks()) { if (t._skhStop) t._skhStop(); t.stop(); }
    log.debug('screen', 'Запуск показа отменён — захват закрыт');
  }

  async startScreen(sourceId, withAudio, name = '') {
    await this.stopScreen();
    const gen = ++this.screenGen;
    const stale = () => gen !== this.screenGen || !this.room;
    const s = settings;
    let stream;
    try { stream = await this.capture(sourceId); } catch (e) {
      const x = explain(e, 'screen');
      log.error('screen', x.msg, { err: e, hint: x.hint || e.hint });
      throw e;
    }
    if (stale()) { this.dropCapture(stream, null); return null; }
    const v = stream.getVideoTracks()[0];
    const probe = firstFrame(v); // сразу — чтобы застать первый кадр (неподвижный экран новых может не давать)
    let a = stream.getAudioTracks()[0] || null;
    let prep = null;
    if (a) {
      prep = await this.prepareAudio(a);
      if (stale()) { this.dropCapture(stream, prep); return null; }
      if (prep.audio !== a) { stream.removeTrack(a); stream.addTrack(prep.audio); a = prep.audio; }
      a.contentHint = 'music'; a.enabled = !!withAudio;
    }
    if (v.contentHint !== undefined) v.contentHint = HINT;
    const tg0 = this.target();
    const gpu = stream._skhGpu || null;
    this.screen = { stream, video: v, capKey: stream._skhCapKey, audio: a, rawAudio: prep && prep.raw, guard: prep && prep.guard, ownAudioExcluded: !!(prep && prep.excluded), sourceId, name, codec: gpu ? H264SW : tg0.codec, gpu, info: null,
      audioSource: a ? (prep && prep.raw && prep.raw._skhWindowOnly ? 'window' : 'computer') : 'none', audioNote: this.audioNote || '' };
    await this.startPreview(this.screen);
    if (stale()) { const sc0 = this.screen; this.screen = null; this.stopPreview(sc0); this.dropCapture(stream, prep); return null; }
    this.screen.info = this.screenInfo();
    const info = this.screen.info;
    log.info('screen', `Демонстрация запущена: «${name || 'экран'}» ${info.w}×${info.h} @ ${info.fps} FPS · качество: ${gpu || tg0.res === 'source' ? 'как на экране' : tg0.res + 'p'},${tg0.fps} кадров/с, ${gpu ? `захват и сжатие видеокартой — ${encName(gpu.info.enc)}` : `кодек ${codecRu(tg0.codec)}`}, до ${tg0.mbps} Мбит/с на зрителя, режим «${this.mode() === 'detail' ? 'Текст' : 'Игра'}» · звук: ${a ? (a.enabled ? 'включён' : 'выключен') : 'нет'}`);
    if (a) {
      const as = prep.raw._skhInfo ? { channelCount: prep.raw._skhInfo.ch, sampleRate: prep.raw._skhInfo.rate } : prep.raw.getSettings();
      this.screen.ownAudioExcluded = prep.excluded;
      const how = prep.raw._skhWindowOnly ? 'звук только из программы этого окна — остальные программы и «Сходка» в трансляцию не попадают'
        : prep.raw._skhExcluded ? `звук «Сходки» в трансляцию не попадает (своя запись без программы${prep.raw._skhInfo && prep.raw._skhInfo.windows ? ', Windows ' + prep.raw._skhInfo.windows : ''}) — друзья не услышат себя`
        : prep.excluded ? 'голоса из «Сходки» Windows сама не пускает в трансляцию'
        : prep.guard ? 'Windows не умеет исключать звук программы (так бывает в Windows 10) — голоса друзей вычитаются из трансляции автоматически, первые секунды разговора они могут быть слышны тихо'
          : 'голоса друзей попадут в трансляцию';
      log.info('screen', `Звук компьютера: ${as.channelCount || '?'} канала, ${as.sampleRate || '?'} Гц; ${how}`, !prep.excluded && !prep.guard ? { hint: 'Друзья будут слышать себя в трансляции. Включите «Убирать голоса друзей» в Настройки → Показ экрана или выключите звук трансляции стрелкой у кнопки показа.' } : undefined);
    } else if (CAN_SHARE_AUDIO) log.warn('screen', 'Трансляция идёт без звука компьютера — подробности выше');
    if (!gpu && tg0.codec === 'AV1') av1Note();
    if (tg0.fps >= 60 && info.fps < 50) log.warn('screen', `Система отдаёт только ${info.fps} FPS вместо ${tg0.fps}`, { hint: 'Часто так бывает при захвате отдельного окна. Попробуйте захватить весь экран.' });
    this.updateGuard(); // зрителей пока нет — вычитание ждёт первого
    this.watchEnded(v);
    this.watchFirstFrame(this.screen, v, probe);
    this.conn.send({ type: 'voice_state', streaming: true });
    this.emit('myscreen');
    return this.screen;
  }

  // Звук компьютера в трансляции — вкл/выкл на ходу (выключенная дорожка шлёт тишину)
  setScreenAudio(on) {
    const sc = this.screen;
    if (!sc || !sc.audio) return false;
    if (sc.audio.enabled === !!on) return true; // уже так (меню и настройки могут позвать дважды)
    sc.audio.enabled = !!on;
    this.updateGuard();
    log.info('screen', `Звук трансляции ${on ? 'включён' : 'выключен'}`);
    this.sendScreenMeta();
    this.emit('myscreen');
    return true;
  }

  // Смена экрана или окна без остановки трансляции: зрители продолжают смотреть
  // requality — тот же экран с другим разрешением или кадрами (applyScreenQuality)
  async switchSource(sourceId, name = '', { requality = false } = {}) {
    const sc = this.screen;
    if (!sc) return this.startScreen(sourceId, settings.screenAudio, name);
    if (sc.gpu) return this.switchGpu(sc, sourceId, name);
    const gen = this.screenGen;
    const stale = () => gen !== this.screenGen || this.screen !== sc || !this.room;
    // 1.20.3: пока старый захват того же экрана открыт, Chromium отдаёт новый в его размере и с его кадрами:
    // начал в 720p 30 — 1080p 60 посреди показа не включалось. Поэтому сначала закрываем старый (и копию для превью) —
    // у зрителей на долю секунды замирает последний кадр
    if (requality) { this.stopPreview(sc); sc.video.stop(); }
    let ns;
    for (let i = 0; ; i++) {
      try { ns = await this.capture(sourceId, { gpu: false }); break; } catch (e) {
        if (requality && i === 0 && !stale()) { log.warn('screen', `Взять экран заново не вышло (${e.message}) — пробую ещё раз`); continue; }
        const x = explain(e, 'screen');
        log.error('screen', `Не удалось переключиться: ${x.msg}`, { err: e, hint: x.hint || e.hint });
        if (requality && !stale()) this.stopScreen(); // старый захват уже закрыт — показывать нечего
        throw e;
      }
    }
    if (stale()) { this.dropCapture(ns, null); return null; }
    const nv = ns.getVideoTracks()[0];
    const probe = firstFrame(nv);
    let na = ns.getAudioTracks()[0] || null;
    let prep = null;
    if (na) { prep = await this.prepareAudio(na); if (stale()) { this.dropCapture(ns, prep); return null; } na = prep.audio; }
    if (nv.contentHint !== undefined) nv.contentHint = HINT;
    if (na) { na.contentHint = 'music'; na.enabled = sc.audio ? sc.audio.enabled : !!settings.screenAudio; }
    const oldV = sc.video; const oldA = sc.audio; const old = { guard: sc.guard, rawAudio: sc.rawAudio };
    sc.stream.removeTrack(oldV); sc.stream.addTrack(nv);
    if (oldA) sc.stream.removeTrack(oldA);
    if (na) sc.stream.addTrack(na);
    sc.video = nv; sc.capKey = ns._skhCapKey; sc.audio = na; sc.sourceId = sourceId; sc.name = name;
    sc.rawAudio = prep && prep.raw; sc.guard = prep && prep.guard; sc.ownAudioExcluded = prep ? prep.excluded : sc.ownAudioExcluded;
    sc.audioSource = na ? (prep && prep.raw && prep.raw._skhWindowOnly ? 'window' : 'computer') : 'none'; sc.audioNote = this.audioNote || '';
    this.watchEnded(nv);
    this.watchFirstFrame(sc, nv, probe);
    await this.startPreview(sc);
    for (const p of this.peers.values()) {
      // 1.19.2: кто смотрит через сервер, получит новые дорожки через сервер (sfu.replaceTracks ниже). Раньше и ему
      // включалась отправка звука напрямую (осталась от прошлого просмотра напрямую) — его программа, получив звук
      // напрямую, закрывала поток с сервера, и картинка пропадала
      if (!p.sentScreen || p.viaSfu) continue;
      try {
        await p.vtx.sender.replaceTrack(nv);
        if (na) await p.attachScreenAudio(sc);
        else if (p.atx) await p.atx.sender.replaceTrack(null);
      } catch (e) { log.warn('screen', `Не удалось переключить трансляцию для ${p.name}: ${e.message}`); }
    }
    if (this.sfu.hasProducer()) {
      const fresh = await this.sfu.replaceTracks(sc).catch((e) => { log.warn('screen', `Не удалось переключить демку на сервере: ${e.message}`); return false; });
      if (fresh) for (const p of this.peers.values()) if (p.sentScreen && p.viaSfu) p.signal({ kind: 'screen-sfu', ...this.sfu.ids() }); // появился звук — зрителям заново
    }
    oldV.stop(); if (oldA) oldA.stop(); this.releaseAudio(old);
    this.updateGuard();
    this.sendScreenMeta();
    log.info('screen', `Трансляция переключена на «${name || 'экран'}» (${sc.info.w}×${sc.info.h})`);
    this.emit('myscreen');
    return sc;
  }

  // Новое качество — сразу, без остановки показа. Разрешение или кадры поменялись — экран берётся заново с новыми
  // настройками (как при смене экрана: зрители продолжают смотреть); скорость, режим и кодек — у кодировщика.
  // Изменения идут по очереди: пока экран берётся заново, следующее ждёт.
  applyScreenQuality() {
    const run = (this.qualityQueue || Promise.resolve()).then(() => this.applyScreenQualityNow());
    this.qualityQueue = run.catch(() => {});
    return run;
  }
  async applyScreenQualityNow() {
    const sc = this.screen;
    if (!sc) return;
    // 1.19.2: видеокартой разрешение всегда как у экрана — заново помощник нужен только для других кадров/с
    // (раньше и смена разрешения перезапускала его: заминка и лишний целый кадр у зрителей)
    if (sc.gpu ? this.target().fps !== sc.gpu.fps : JSON.stringify(this.videoConstraints()) !== sc.capKey) {
      log.info('screen', 'Новое разрешение или кадры — беру экран заново с новыми настройками, зрители продолжают смотреть');
      try { await this.switchSource(sc.sourceId, sc.name, { requality: true }); } catch (_) { /* switchSource уже написал в журнал */ }
      if (this.screen !== sc) return;
    }
    for (const p of this.peers.values()) await p.applyEncoding();
    await this.sfuEncoding();
    const codec = this.codec();
    if (codec !== sc.codec) {
      sc.codec = codec;
      if (codec === 'AV1') av1Note();
      for (const p of this.peers.values()) await p.changeCodec(codec).catch((e) => log.warn('screen', `Смена кодека для ${p.name}: ${e.message}`));
      await this.sfuRecodec();
    }
    setTimeout(() => {
      if (this.screen !== sc) return;
      this.sendScreenMeta();
      const tg = this.target();
      log.info('screen', `Качество трансляции: «${tg.mode === 'detail' ? 'Текст' : 'Игра'}» · ${sc.info.w}×${sc.info.h}, до ${tg.fps} кадров/с, до ${tg.mbps} Мбит/с, кодек ${codecRu(codec)}`);
      this.emit('myscreen');
    }, 400);
  }

  // Зрителей стало больше или меньше — заново делим свою отдачу между ними (если она известна)
  rebalance() {
    if (!this.screen || !settings.screenNet) return;
    for (const p of this.peers.values()) if (p.sentScreen) p.applyEncoding();
    this.sfuEncoding();
  }

  // Режим демки: «Игра» (motion — важнее плавность) или «Текст» (detail — важнее чёткость). С 1.15.5 — только как выбрано.
  mode() { return settings.screenMode === 'detail' ? 'detail' : 'motion'; }
  target() { return screenTarget(this.mode()); }
  // кодек — только как в настройках (1.17.0: сама на H.264 программа больше не переходит).
  // Захват видеокартой: договариваемся о H.264 Constrained Baseline — пустышку 16×16 сжимает OpenH264, а уходят кадры помощника
  codec() { return this.screen && this.screen.gpu ? H264SW : this.target().codec; }
  // Сколько можно отдать каждому потоку, если известна своя отдача (проверка интернета): 85 % на всех поровну.
  // Через сервер (размножитель) уходит ОДИН поток на всех, кто смотрит через него, — отдача на них не делится.
  uplinkShare() {
    const n = settings.screenNet;
    if (!n || !(n.up > 0) || Date.now() - (n.at || 0) > 14 * 864e5) return Infinity; // проверке больше двух недель — не верим
    const direct = [...this.peers.values()].filter((p) => p.sentScreen && !p.viaSfu).length;
    const streams = Math.max(1, direct + (this.sfuViewers() > 0 ? 1 : 0));
    return Math.max(1, (n.up * 0.85) / streams);
  }

  // Превью своей демки у стримера — 5 кадров в секунду вместо 60: видеокарте меньше работы во время игры.
  // Друзьям уходит полная частота: копия дорожки прореживается отдельно.
  async startPreview(sc) {
    this.stopPreview(sc);
    if (sc.gpu) return; // захват видеокартой: в окне только пустышка — превью нет (app.js пишет почему)
    await this.makePreview(sc);
  }
  async makePreview(sc) {
    try {
      // маленькая копия (до 360p, 5 кадров): для превью хватает, а захвату она не мешает — у копии своё уменьшение,
      // сам захват идёт как выбрано в настройках
      const t = sc.video.clone();
      sc.previewTrack = t; sc.preview = new MediaStream([t]);
      await t.applyConstraints({ height: { max: 360 }, frameRate: { max: 5 } }).catch(() => {});
    } catch (_) { sc.preview = sc.stream; }
  }
  stopPreview(sc) {
    if (sc.previewTrack) { sc.previewTrack.stop(); sc.previewTrack = null; }
    sc.preview = null;
  }
  // Захват всегда идёт как выбрано в настройках — и когда демку никто не смотрит (1.17.0: паузы захвата больше нет)
  async addViewer(name) {
    const p = this.peers.get(name);
    if (!this.screen || !p) return;
    log.info('screen', `${name} смотрит вашу демонстрацию`);
    await this.attachViewer(p, this.screen, name);
  }
  async attachViewer(p, sc, name) {
    const again = p.sentScreen;
    const viaSfu = p.wantsSfu && !p.sfuBad && this.sfuUsable() && !sc.sfuFailed;
    if (p.sentScreen && p.viaSfu !== viaSfu) await p.detachScreen(); // зритель переходит с сервера на «напрямую» или наоборот
    let done = false;
    if (viaSfu) {
      try { await this.sfuAttach(p); done = true; } catch (e) {
        if (this.screen !== sc) return;
        log.warn('screen', `Через сервер показать демку ${name} не вышло (${e.message}) — показываю напрямую`);
      }
    }
    if (!done) await p.attachScreen(sc);
    this.updateGuard();
    this.rebalance();
    if (!again) this.emit('viewer', { name, on: true });
    this.emit('peers');
  }

  // ---------- размножитель демки (1.16): показ и просмотр через сервер ----------
  setSfu(on) {
    if (this.sfuOn === !!on) return;
    this.sfuOn = !!on;
    if (!on) this.sfuBroken('both', 'размножитель на сервере не работает');
  }
  sfuUsable() { return this.sfuOn && settings.screenViaServer !== false; }
  sfuViewers() { return [...this.peers.values()].filter((p) => p.sentScreen && p.viaSfu).length; }

  // 1.16.3: значок «сервер» на панели звонка — демки через сервер (размножитель) или напрямую, сразу, посреди показа.
  // Как стример — переводим своих зрителей (кто сам хочет «через сервер»); как зритель — просим стримера прислать
  // демку другим путём. on — уже сохранённая настройка screenViaServer.
  async setViaServer(on) {
    const sc = this.screen;
    if (sc) {
      if (on) { sc.sfuFailed = false; for (const p of this.peers.values()) p.sfuBad = false; } // включили руками — через сервер пробуем заново, даже если в этом показе он ломался
      const wantSfu = on && this.sfuUsable();
      for (const p of [...this.peers.values()]) {
        if (!p.sentScreen || this.screen !== sc) continue;
        const want = wantSfu && p.wantsSfu && !p.sfuBad;
        if (want === p.viaSfu) continue;
        if (!want) {
          p.sentScreen = false; p.viaSfu = false;
          p.signal({ kind: 'screen-p2p' });
          await p.attachScreen(sc).catch((e) => log.warn('screen', `Показать напрямую ${p.name} не вышло: ${e.message}`));
        } else {
          await p.detachScreen();
          try { await this.sfuAttach(p); } catch (e) {
            log.warn('screen', `Через сервер показать демку ${p.name} не вышло (${e.message}) — показываю напрямую`);
            await p.attachScreen(sc).catch(() => {});
          }
        }
      }
      if (!wantSfu && this.screen === sc) { this.sfu.closeProducers(); this.sfuOut = null; }
      if (this.screen === sc) { this.updateGuard(); this.rebalance(); this.sendScreenMeta(); this.emit('peers'); this.emit('myscreen'); }
    }
    // смотрю чужую демку — прошу стримера прислать её нужным путём (решает он: у него может быть «напрямую»)
    const name = this.watching; const w = name && this.peers.get(name);
    // 1.20.3: стример (с 1.20.3) сообщает, как показывает (srv в screen-meta): у него «напрямую» — через сервер
    // не будет, пока он сам не включит значок. Раньше зритель видел горящий значок и «переключено», а смотрел напрямую
    const byStreamer = !!(w && on && this.sfuUsable() && w.remoteScreenInfo && w.remoteScreenInfo.srv === 0);
    if (w) {
      w.sfuFailedAt = 0;
      const sfu = on && this.sfuUsable() ? 1 : 0;
      if (sfu !== (w.sfuIn ? 1 : 0)) w.signal({ kind: 'watch', rep: 1, sfu });
    }
    log.info('screen', `Демки — ${on ? 'через сервер (размножитель)' : 'напрямую'}: переключено${sc ? ' во время показа' : ''}${name ? `, смотрю ${name}` : ''}`
      + (byStreamer ? ` — но ${name} показывает напрямую (у него значок «сервер» выключен), его демку пока смотрю напрямую` : ''));
    if (byStreamer) this.emit('pathbystreamer', { name });
  }

  // стример: этот зритель будет смотреть через сервер — отдаём демку серверу (если ещё не отдаём) и говорим зрителю, где её взять
  async sfuAttach(p) {
    const sc = this.screen;
    const tg = this.target();
    const direct = [...this.peers.values()].filter((x) => x.sentScreen && !x.viaSfu).length;
    const n = settings.screenNet; const known = Number.isFinite(this.uplinkShare());
    const share = known ? Math.max(1, (n.up * 0.85) / (direct + 1)) : Infinity;
    const mbps = Math.min(tg.mbps, share);
    const first = !this.sfu.hasProducer();
    // старт — как напрямую: умеренные 4 Мбит/с (или меньше, если столько выбрано), дальше Chromium разгоняется сам
    const ids = await this.sfu.produce(sc, { codec: this.codec(), enc: { maxBitrate: Math.round(mbps * 1e6), maxFramerate: sendFps(sc, tg) }, startKbps: startKbps(mbps),
      onVideoSender: sc.gpu ? (s) => sc.gpu.attach(s, 'сервер') : null }); // захват видеокартой — подмена и на сервер
    if (this.screen !== sc) throw new Error('показ уже закончился');
    if (first) { this.sfuSt = { prev: null, limit: { reason: 'none', n: 0 }, loggedEnc: '', sentHealth: '', sentAt: 0, since: performance.now() }; log.info('screen', `Демка идёт через сервер (размножитель): одна отправка на всех, кто смотрит через него — до ${Math.round(mbps * 10) / 10} Мбит/с`); }
    p.signal({ kind: 'screen-meta', streamId: sc.stream.id, info: sc.info });
    p.signal({ kind: 'screen-sfu', video: ids.video, audio: ids.audio });
    p.sentScreen = true; p.viaSfu = true; p.attachedAt = performance.now(); p.prevOut = null; p.outStats = null;
    await this.sfuEncoding();
  }

  // стример: скорость, кадры и «что важнее» для общего потока на сервер
  async sfuEncoding() {
    if (!this.screen || !this.sfu.hasProducer()) return;
    const tg = this.target();
    await this.sfu.setEncoding({ maxBitrate: Math.min(tg.mbps, this.uplinkShare()) * 1e6, maxFramerate: sendFps(this.screen, tg), degradationPreference: DEGRADE[this.mode()] })
      .catch((e) => log.debug('screen', `Параметры потока на сервер: ${e.message}`));
  }

  // стример: кодек сменился — поток на сервер заново, зрителям — где новый
  async sfuRecodec() {
    const sc = this.screen;
    if (!sc || !this.sfu.hasProducer()) return;
    const viewers = [...this.peers.values()].filter((p) => p.sentScreen && p.viaSfu);
    this.sfu.closeProducer('video');
    try {
      for (const p of viewers) { p.sentScreen = false; p.viaSfu = false; }
      for (const p of viewers) await this.sfuAttach(p);
    } catch (e) {
      log.warn('screen', `Сменить кодек на сервере не вышло (${e.message}) — показываю напрямую`);
      sc.sfuFailed = true; this.sfu.closeProducers();
      for (const p of viewers) { p.sentScreen = false; p.viaSfu = false; p.signal({ kind: 'screen-p2p' }); await p.attachScreen(sc).catch(() => {}); }
    }
    this.updateGuard();
  }

  // стример: через сервер никто не смотрит — поток на паузе; снова смотрят — идёт
  sfuSync() {
    if (!this.screen || !this.sfu.hasProducer()) return;
    this.sfu.setPaused(this.sfuViewers() === 0).catch(() => {});
  }

  // зритель: стример отдаёт демку через сервер — забираем её там. Не вышло — просим «напрямую».
  async sfuWatch(p, ids) {
    if (this.watching !== p.name) { p.signal({ kind: 'unwatch' }); return; }
    try {
      const got = await this.sfu.consume(p.name, ids);
      if (this.watching !== p.name) { this.sfu.closeConsumers(p.name); return; }
      clearTimeout(p.sfuReWatch);
      p.sfuIn = got;
      for (const c of [got.video, got.audio]) if (c) p.addScreenTrack(c.track, c.rtpReceiver, 'через сервер');
      // соединение с сервером должно установиться за несколько секунд — иначе смотрим напрямую
      const t = this.sfu.t.recv;
      setTimeout(() => { if (p.sfuIn === got && (!t || t.connectionState !== 'connected')) this.sfuFallback(p, 'соединение с сервером не установилось за 10 секунд'); }, 10000);
    } catch (e) { if (!e.superseded) this.sfuFallback(p, e.message); } // superseded — пока подключались, стример прислал новое
  }
  sfuFallback(p, why) {
    if (p.sfuIn) { this.sfu.closeConsumers(p.name); p.sfuIn = null; }
    p.sfuFailedAt = Date.now();
    log.warn('screen', `Смотреть демку ${p.name} через сервер не вышло (${why}) — смотрю напрямую`);
    // fb (1.20.3): это не новый выбор — «через сервер» я по-прежнему хочу, когда стример снова его включит
    if (this.watching === p.name) p.signal({ kind: 'watch', rep: 1, sfu: 0, fb: 1 });
  }

  // соединение с размножителем порвалось или он сам упал: стример шлёт напрямую, зрители смотрят напрямую
  sfuBroken(dir, why) {
    const sc = this.screen;
    if ((dir === 'send' || dir === 'both') && sc && this.sfu.hasProducer()) {
      log.warn('screen', `Размножитель: ${why} — показываю демку напрямую`);
      sc.sfuFailed = true;
      this.sfu.closeProducers();
      for (const p of this.peers.values()) {
        if (!p.sentScreen || !p.viaSfu) continue;
        p.sentScreen = false; p.viaSfu = false;
        p.signal({ kind: 'screen-p2p' });
        p.attachScreen(sc).then(() => this.rebalance()).catch((e) => log.warn('screen', `Показать напрямую ${p.name} не вышло: ${e.message}`));
      }
      this.updateGuard();
    }
    if (dir === 'recv' || dir === 'both') {
      // стример у себя, скорее всего, тоже заметит и пришлёт «напрямую» сам — подождём чуть-чуть, потом попросим сами
      for (const p of this.peers.values()) {
        if (!p.sfuIn) continue;
        const was = p.sfuIn;
        setTimeout(() => { if (p.sfuIn === was) this.sfuFallback(p, why); }, dir === 'both' ? 1500 : 0);
      }
    }
    if (dir === 'both') setTimeout(() => { if (!this.sfuOn) this.sfu.reset(); }, 2000);
  }

  // сервер закрыл поток, который я смотрю (стример сменил кодек или закончил показ): новый придёт сам; нет — спросим ещё раз
  sfuClosed(cid) {
    const owner = this.sfu.onClosed(cid);
    const p = owner && this.peers.get(owner);
    if (!p || !p.sfuIn) return;
    clearTimeout(p.sfuReWatch);
    p.sfuReWatch = setTimeout(() => {
      if (this.watching !== owner || !p.sfuIn || (p.sfuIn.video && !p.sfuIn.video.closed)) return;
      p.sfuIn = null;
      log.info('screen', `Поток демки ${owner} на сервере закрылся — подключаюсь заново`);
      this.watch(owner);
    }, 5000);
  }

  // стример: что уходит на сервер — для журнала и «светофора» у зрителей
  async sfuStats() {
    const sc = this.screen;
    if (!sc || !this.sfu.hasProducer() || this.sfu.prod.paused) { this.sfuOut = null; return; }
    const r = await this.sfu.producerStats();
    if (!r) return;
    const by = new Map(); r.forEach((x) => by.set(x.id, x));
    const s = [...r.values()].find((x) => x.type === 'outbound-rtp' && x.kind === 'video');
    if (!s) return;
    const now = performance.now(); const st = this.sfuSt;
    const codec = by.get(s.codecId); const cname = codec ? codec.mimeType.replace('video/', '') : '';
    const enc = `${s.encoderImplementation || '?'}|${cname}`;
    const gpu = sc.gpu;
    if (gpu && s.encoderImplementation && enc !== st.loggedEnc) {
      st.loggedEnc = enc;
      log.info('screen', `Кодирование демки для сервера: H264 — видеокарта, ${encName(gpu.info.enc)} (захват видеокартой)`);
    } else if (s.encoderImplementation && enc !== st.loggedEnc) {
      st.loggedEnc = enc;
      const prof = codec && /profile-level-id=([0-9a-f]{6})/i.exec(codec.sdpFmtpLine || '');
      log.info('screen', `Кодирование демки для сервера: ${cname || '?'}${prof ? ` (профиль ${prof[1]})` : ''}, ${s.encoderImplementation} — ${s.powerEfficientEncoder ? 'аппаратный (видеокарта)' : 'программный (процессор)'}${pieces(codec)}`);
      if (cname && s.powerEfficientEncoder && !(settings.hwSeen && settings.hwSeen[cname])) set({ hwSeen: { ...(settings.hwSeen || {}), [cname]: s.encoderImplementation } });
    }
    if (st.prev) {
      const dt = (now - st.prev.t) / 1000;
      this.sfuOut = { fps: Math.round(s.framesPerSecond || 0), w: gpu ? gpu.info.w : s.frameWidth, h: gpu ? gpu.info.h : s.frameHeight, mbps: ((s.bytesSent - st.prev.bytes) * 8 / dt / 1e6) };
    }
    st.prev = { t: now, bytes: s.bytesSent };
    const reason = s.qualityLimitationReason || 'none';
    if (reason !== 'none' && now - st.since > 15000) { if (reason === st.limit.reason) st.limit.n++; else st.limit = { reason, n: 1 }; } else st.limit = { reason: 'none', n: 0 };
    if (st.limit.reason === 'cpu' && st.limit.n === 3) log.warn('screen', 'Процессор не успевает кодировать демку — качество снижено', { hint: cpuCodecHint(this.codec()) });
    if (st.limit.reason === 'bandwidth' && st.limit.n === 5) log.warn('screen', 'Не хватает скорости отдачи до сервера — качество снижено', { hint: `Ваш интернет не тянет ${this.target().mbps} Мбит/с. Снизьте скорость в Настройки → Показ экрана; помогают кабель вместо Wi-Fi и закрытые закачки.` });
    // «светофор» у зрителей, которые смотрят через сервер
    const msrc = [...r.values()].find((x) => x.type === 'media-source' && x.kind === 'video');
    if (!gpu) this.checkEncoder(s, msrc, st.since, 'для сервера');
    const hh = { lim: st.limit.n >= 2 ? st.limit.reason : 'none', lvl: 0, hw: gpu ? true : !!s.powerEfficientEncoder, src: msrc ? Math.round(msrc.framesPerSecond || 0) : 0 };
    const hk = JSON.stringify(hh);
    if (hk !== st.sentHealth || now - st.sentAt > 15000) {
      st.sentHealth = hk; st.sentAt = now;
      for (const p of this.peers.values()) if (p.sentScreen && p.viaSfu) p.signal({ kind: 'screen-h', ...hh });
    }
  }

  // Вычитание голосов из звука трансляции (запасной вариант, когда звук «Сходки» вырезать не удалось)
  // работает, только пока его результат кто-то слышит: звук трансляции включён и есть зрители.
  updateGuard() {
    const sc = this.screen;
    this.sfuSync(); // зрители поменялись — поток на сервер (размножитель) на паузу или обратно
    if (!sc || !sc.guard) return;
    const viewers = [...this.peers.values()].filter((p) => p.sentScreen).length;
    const on = !!(sc.audio && sc.audio.enabled) && viewers > 0;
    if (sc.guard.active === on) return;
    sc.guard.setEnabled(on);
    log.debug('screen', on ? 'Вычитание голосов друзей из трансляции работает' : `Вычитание голосов друзей на паузе — ${viewers ? 'звук трансляции выключен' : 'трансляцию никто не смотрит'}`);
  }

  async stopScreen() {
    this.screenGen++; // запуск, который ещё идёт, больше не нужен
    if (!this.screen) return;
    const sc = this.screen;
    this.screen = null;
    for (const p of this.peers.values()) {
      if (p.sentScreen) { p.signal({ kind: 'screen-stop' }); await p.detachScreen(); }
    }
    this.sfu.closeProducers(); this.sfuOut = null;
    if (sc.gpu) sc.gpu.stop();
    sc.stream.getTracks().forEach((t) => t.stop());
    this.stopPreview(sc);
    this.releaseAudio(sc);
    this.conn.send({ type: 'voice_state', streaming: false });
    log.info('screen', 'Демонстрация остановлена');
    this.emit('myscreen');
  }

  watch(name) {
    if (this.watching && this.watching !== name) this.unwatch();
    const p = this.peers.get(name);
    if (!p) return;
    this.watching = name;
    // rep — умеем «Отчёт о демке»; sfu — можем смотреть через сервер (размножитель), если он есть и через него недавно не ломалось
    const sfu = this.sfuUsable() && !(p.sfuFailedAt && Date.now() - p.sfuFailedAt < 5 * 60e3);
    p.signal({ kind: 'watch', rep: 1, sfu: sfu ? 1 : 0 });
    log.info('screen', `Подключаюсь к демонстрации ${name}…`);
    this.emit('screen', name);
  }

  unwatch() {
    const name = this.watching;
    if (!name) return;
    this.watching = null;
    const p = this.peers.get(name);
    if (p) { p.signal({ kind: 'unwatch' }); p.clearRemoteScreen(); }
    this.emit('screen', name);
  }

  setLatency() {
    for (const p of this.peers.values()) for (const r of p.screenReceivers || []) applyLatency(r);
  }

  setScreenVolume(pct) {
    this.screenVolume = pct;
    if (pct > 0) this.screenMuted = false;
    for (const p of this.peers.values()) this.output.setSourceVolume('screen:' + p.name, this.screenMuted ? 0 : pct);
  }

  setScreenMuted(m) {
    this.screenMuted = !!m;
    for (const p of this.peers.values()) this.output.setSourceVolume('screen:' + p.name, this.screenMuted ? 0 : this.screenVolume);
  }

  async leave() {
    await this.stopScreen();
    this.watching = null;
    this.sfu.close();
    clearInterval(this.statsTimer); clearInterval(this.syncTimer); this.syncTimer = null;
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.room = null;
    this.emit('peers');
  }
}
