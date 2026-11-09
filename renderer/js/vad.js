// «Когда говорю»: решает, когда открыть микрофон. Работает по уровню звука после шумоподавления.
// Автоматический режим сам следит за уровнем фона и голоса и подбирает порог.
// Защита от клавиатуры: щелчок короче 40 мс не открывает микрофон, а начало громкой речи — открывает сразу.
// Начало слова не теряется: сам голос идёт с задержкой 0,05 с (audio.js, PREROLL_S), а решение принимается без неё.
export class VadGate {
  constructor() {
    this.floor = -65;   // уровень фона, дБ
    this.speech = -30;  // типичный уровень голоса, дБ
    this.above = 0;     // сколько тиков подряд выше порога
    this.lastLoud = -1e9;
    this.open = false;
    this.thr = -50;
  }

  threshold(auto, manual) {
    if (!auto) return manual;
    return Math.min(-30, Math.max(-72, Math.max(this.floor + 12, this.speech - 22)));
  }

  // db — уровень за последние ~20 мс, now — время в мс
  // holdMs — сколько держать микрофон открытым после последнего громкого звука: 0,5 с — концы слов
  // и короткие паузы между словами не обрезаются
  step(db, now, { auto = true, manual = -50, keyboard = true, holdMs = 500 } = {}) {
    // фон: быстро опускаемся в паузах между словами, медленно (1,5 дБ/с) поднимаемся, если стало шумнее
    if (db < this.floor) this.floor += (db - this.floor) * 0.3;
    else this.floor += 0.03;
    this.floor = Math.min(this.floor, this.speech - 10);
    // голос: то, что заметно громче фона
    if (db > this.floor + 10) this.speech += (db - this.speech) * 0.02;

    const thr = this.threshold(auto, manual);
    this.above = db > thr ? this.above + 1 : 0;
    // открывается по порогу, а пока открыт — держится и на 6 дБ тише порога: затихающий конец слова не обрезается
    if (this.above >= (keyboard ? 2 : 1) || db > thr + 12 || (this.open && db > Math.max(thr - 6, this.floor + 6))) this.lastLoud = now;
    this.open = now - this.lastLoud < holdMs;
    this.thr = thr;
    return this.open;
  }
}

// Ровная громкость голоса (1.15.1). Раз в 20 мс: следим за уровнем голоса только когда человек говорит
// (микрофон открыт и звук заметно громче фона) и плавно подтягиваем его к LEVEL.target:
// тише — до +15 дБ, громче — до −10 дБ. Вверх медленно (3 дБ/с), вниз быстрее (8 дБ/с),
// а если пик вот-вот упрётся в потолок — сразу. Шум в паузах не усиливается: в паузах усиление не меняется.
export const LEVEL = { target: -22, minDb: -10, maxDb: 15, ceil: 0.9, upPerTick: 0.06, downPerTick: 0.16 };
export function levelStep(st, { db, peak = 0, open, floor = -70, enabled = true }) {
  let agcDb = st.agcDb || 0; let speechDb = st.speechDb ?? null;
  if (!enabled) return { agcDb: 0, speechDb };
  if (open && db > -60 && db > floor + 12) {
    speechDb = speechDb == null ? db : speechDb + (db - speechDb) * 0.04; // уровень голоса за ~0,5 с
    const target = Math.max(LEVEL.minDb, Math.min(LEVEL.maxDb, LEVEL.target - speechDb));
    agcDb = target > agcDb ? Math.min(target, agcDb + LEVEL.upPerTick) : Math.max(target, agcDb - LEVEL.downPerTick);
  }
  // защита от перегруза: пик после выравнивания не выше потолка
  if (peak > 0 && peak * 10 ** (agcDb / 20) > LEVEL.ceil) agcDb = Math.max(LEVEL.minDb, 20 * Math.log10(LEVEL.ceil / peak));
  return { agcDb, speechDb };
}
