'use strict';
// «Отчёт о демке»: сколько процессора тратит сама «Сходка» — по видам процессов Chromium — и весь компьютер.
// Берём разницу cumulativeCPUUsage (секунды процессора с запуска процесса) между двумя замерами: это «% одного ядра».
// percentCPUUsage не годится: Electron делит его на число логических ядер (на 12 потоках «половина ядра» — 4 %)
// и сбрасывает его интервал при каждом вызове getAppMetrics (docs/api/structures/cpu-usage.md).
// Вспомогательный skh-audiocap.exe (звук без «Сходки») сюда не входит — это не процесс Chromium.

// вид процесса → короткое имя в отчёте
function kindOf(m) {
  if (m.type === 'Browser') return 'main';     // главный: захват экрана, звук трансляции, сеть сервера
  if (m.type === 'Tab') return 'window';       // окно: интерфейс, WebRTC, шумоподавление, сжатие процессором
  if (m.type === 'GPU') return 'gpu';          // GPU-процесс: сжатие и распаковка видеокартой, вывод на экран
  const n = String(m.serviceName || m.name || '').toLowerCase();
  if (n.includes('audio')) return 'audio';
  if (n.includes('network')) return 'network';
  if (n.includes('capture')) return 'capture';
  return 'other';
}

function createFootprint({ app, os, now = () => Date.now() }) {
  let prev = null;
  // { secs, procs: { main, window, gpu, audio, ... } (% одного ядра), ours (всего), sys: { total, max } (% всех ядер / самого
  // загруженного ядра), threads } — или null на первом замере
  function sample() {
    const t = now();
    const procs = new Map();
    let memKb = 0;
    for (const m of app.getAppMetrics()) {
      if (m.memory && typeof m.memory.workingSetSize === 'number') memKb += m.memory.workingSetSize;
      const cum = m.cpu && m.cpu.cumulativeCPUUsage;
      if (typeof cum === 'number') procs.set(m.pid, { cum, kind: kindOf(m) });
    }
    const cpus = os.cpus().map((c) => c.times);
    let out = null;
    if (prev && t - prev.t >= 200) {
      const dt = (t - prev.t) / 1000;
      const by = {}; let ours = 0;
      for (const [pid, p] of procs) {
        const a = prev.procs.get(pid);
        if (!a) continue; // процесс появился между замерами — посчитаем со следующего
        const core = Math.max(0, (p.cum - a.cum) / dt * 100);
        by[p.kind] = (by[p.kind] || 0) + core; ours += core;
      }
      for (const k of Object.keys(by)) by[k] = Math.round(by[k] * 10) / 10;
      let sys = null;
      if (prev.cpus.length === cpus.length && cpus.length) {
        const busy = cpus.map((c, i) => {
          const a = prev.cpus[i];
          const tot = (c.user + c.nice + c.sys + c.idle + c.irq) - (a.user + a.nice + a.sys + a.idle + a.irq);
          return tot > 0 ? Math.min(1, Math.max(0, 1 - (c.idle - a.idle) / tot)) : 0;
        });
        sys = { total: Math.round(100 * busy.reduce((s, x) => s + x, 0) / busy.length), max: Math.round(100 * Math.max(...busy)) };
      }
      // память: сколько занимает «Сходка» и сколько свободно у компьютера (мало свободной — игра и демка проседают)
      out = { secs: Math.round(dt * 10) / 10, procs: by, ours: Math.round(ours * 10) / 10, sys, threads: cpus.length, memMb: Math.round(memKb / 1024), freeMb: typeof os.freemem === 'function' ? Math.round(os.freemem() / 1048576) : null };
    }
    prev = { t, procs, cpus };
    return out;
  }
  return { sample };
}

module.exports = { createFootprint, kindOf };
