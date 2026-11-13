// Настройки пользователя — хранятся локально на этом компьютере.
const KEY = 'skhodka.settings.v1';

export const DEFAULTS = {
  // микрофон
  inputDevice: 'default',
  inputGain: 100,            // %
  noise: 'dfn',              // off | browser | rnnoise | dfn
  noiseStrength: 'normal',   // soft | normal | strong (для dfn)
  keyboardFilter: true,      // не открывать микрофон от щелчков клавиатуры
  highpass: true,            // срезать гул ниже 80 Гц
  vadAuto: true,             // чувствительность подбирается сама
  echoCancellation: true,
  autoGain: true,            // 1.15.1: ровная громкость голоса (своя, после шумоподавления)
  settingsVersion: 5,
  mode: 'vad',               // vad | ptt
  vadThreshold: -50,         // dB
  pttBinding: null,          // { label, dom: {type, code}, ui: {type, code} }
  pttGlobal: true,
  pttReleaseMs: 200,
  // звук
  outputDevice: 'default',
  outputVolume: 100,
  userVolumes: {},           // ник → %
  userMusicVolumes: {},      // 1.23: ник → % его «музыки для всех» у меня
  userSfxVolumes: {},        // 1.23: ник → % его «звуков для всех» у меня
  friendsMusicVolume: 100,   // 1.23: музыка для всех от любых друзей, %
  friendsSfxVolume: 100,     // 1.23: звуки для всех от любых друзей, %
  sounds: true,
  // демонстрация
  // 1.15.5: качество демки только своё (режима «Авто» и авторежима больше нет)
  screenRes: '1080',         // 720 | 1080 | 1440 | source
  screenFps: 60,
  screenBitrate: 8,          // Мбит/с на каждого зрителя (потолок: если отдача известна, она делится на зрителей)
  screenCodec: 'H264',       // H264 | H264SW (H.264 — процессор, 1.17.5) | H264MT (… на нескольких ядрах, 1.18.2) | VP9 | AV1 (VP8 убран в 1.20.2)
  screenGpu: false,          // 1.19.0: «Видеокартой, как OBS» — захват и сжатие помощником skh-videocap.exe (только весь экран)
  screenMode: 'motion',      // motion — «Игра» (важнее плавность) | detail — «Текст» (важнее чёткость)
  screenLatency: 'smooth',   // зритель: smooth — запас ~0,15 с (меньше рывков) | low — минимум задержки
  screenAudio: true,
  screenAudioExclusive: true, // Windows: записывать звук компьютера своим помощником — без звука «Сходки»
  screenAudioWindowOnly: true, // показываю одно окно — в трансляции звук только этой программы
  screenEchoCancel: true,    // Windows 10: если помощник не сработал — вычитать голоса друзей из звука трансляции
  closeToTray: true,         // крестик сворачивает в трей
  sidePanel: true,           // панель «Чат / На сервере» справа открыта
  sideWidth: 380,            // её ширина, px
  screenVolume: 100,         // громкость чужих трансляций у зрителя, %
  stageTilesHidden: false,   // плитки участников под демкой свёрнуты (демка крупнее)
  theme: 'shelk',            // 1.20: дизайн — основной «Шёлк» или один из 46 (themes.js)
  // сеть
  iceServers: '',            // по строке: stun:host:port или turn:user:pass@host:port
  forceRelay: false,         // только через ретранслятор сервера (для проверки и сложных сетей)
  filesDirect: false,        // 1.15: файлы от 10 МБ — напрямую с компьютера отправителя (иначе — через сервер)
  screenViaServer: true,     // 1.16: демки через сервер, если на нём работает размножитель (выкл — только напрямую)
  // прочее
  verboseLog: false,
  lastServer: '',
  lastPort: 41234,
  hostPort: 41234,
  recent: [],
  nick: '',                  // ник для входа
  deviceKey: '',             // секретный ключ этого компьютера (вместо пароля)
  tokens: {},                // "host:port" → токен входа
  downloads: {},             // id файла из чата → куда скачан (чтобы «Открыть» работало после перезапуска)
  p2pParts: {},              // id файла «напрямую» → недокачанный .skhpart (докачка после перезапуска)
};

let current = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) : {};
    // версия 1.1 и раньше: RNNoise/GTCRN по умолчанию → переводим на новое «лучшее» шумоподавление
    if ((stored.settingsVersion || 1) < 2) {
      if (!stored.noise || stored.noise === 'rnnoise' || stored.noise === 'gtcrn') stored.noise = 'dfn';
      stored.settingsVersion = 2;
    }
    // 1.15: режим демки «Плавность» → «Сама»: программа переключает игры ↔ текст по картинке
    if (stored.settingsVersion < 3) {
      if (!stored.screenMode || stored.screenMode === 'motion') stored.screenMode = 'auto';
      stored.settingsVersion = 3;
    }
    // 1.15.1: ровная громкость голоса включена у всех; демка — «Авто», всё про звук трансляции работает само
    if (stored.settingsVersion < 4) {
      stored.autoGain = true;
      stored.screenQuality = 'auto';
      for (const k of ['screenAutoQuality', 'screenAudioExclusive', 'screenEchoCancel', 'screenSelfDuck']) delete stored[k];
      stored.settingsVersion = 4;
    }
    // 1.15.5: «Авто», авторежим и «Беречь FPS в игре» убраны. У кого было «Авто» — ставим то, что «Авто» давало в игре:
    // 1080p, 60 кадров, H.264, 16 Мбит/с при свежей проверке интернета, иначе 8. «Сама по картинке» → «Игра».
    if (stored.settingsVersion < 5) {
      if (stored.screenQuality !== 'custom') {
        const n = stored.screenNet;
        const fresh = !!(n && n.up > 0 && Date.now() - (n.at || 0) <= 14 * 864e5);
        Object.assign(stored, { screenRes: '1080', screenFps: 60, screenCodec: 'H264', screenBitrate: fresh ? 16 : 8 });
      }
      if (stored.screenMode !== 'detail') stored.screenMode = 'motion';
      for (const k of ['screenQuality', 'screenSaveFps']) delete stored[k];
      stored.settingsVersion = 5;
    }
    // 1.20.2: VP8 убран из списка кодеков — у кого он был выбран, ставим H.264 (рекомендуется)
    if (stored.screenCodec === 'VP8') stored.screenCodec = 'H264';
    // обновлённые настройки сразу сохраняем, чтобы переход случился один раз
    if (raw && JSON.stringify(stored) !== raw) { try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch (_) { /* ignore */ } }
    return { ...DEFAULTS, ...stored };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export const settings = new Proxy({}, {
  get: (_t, k) => current[k],
  set: (_t, k, v) => { set({ [k]: v }); return true; },
});

export function set(patch) {
  const changed = Object.keys(patch).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(patch[k]));
  if (!changed.length) return;
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (_) { /* ignore */ }
  for (const l of listeners) l(changed, current);
}

export function onSettings(cb) { listeners.add(cb); return () => listeners.delete(cb); }

export function parseIceServers(text) {
  const out = [];
  for (const line of String(text || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
    const m = line.match(/^(turns?):(?:([^:@]+):([^@]+)@)?(.+)$/);
    if (m) out.push({ urls: `${m[1]}:${m[4]}`, username: m[2], credential: m[3] });
    else if (line.startsWith('stun:')) out.push({ urls: line });
  }
  return out;
}
