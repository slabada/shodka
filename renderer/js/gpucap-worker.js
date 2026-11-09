// Рабочий поток «Видеокартой, как OBS» (1.19.0): подставляет готовые кадры H.264 от помощника skh-videocap.exe
// вместо кадров дорожки-пустышки 16×16, которую сжимает сам Chromium (RTCRtpScriptTransform, проверено в лаборатории,
// отчёт 14). Один поток на все отправки демки — зрителям напрямую и на сервер: кадр приходит один раз,
// каждой отправке — своя копия. Зритель сам находит в кадре SPS/PPS и IDR — размер картинки берёт из них.
'use strict';
const outs = new Map(); // id отправки → очередь кадров и счётчики
const MAX_Q = 4;        // больше — отправка отстала (сеть встала): выкидываем всё и ждём ключевой кадр
const ASLEEP_MS = 1000; // 1.20.3: столько отправка не брала кадры — она спит (соединение закрыто или встало)
let lastAsk = 0;

function askIdr(why) {
  const now = Date.now();
  if (now - lastAsk < 300) return;
  lastAsk = now;
  postMessage({ idr: why });
}

onmessage = (e) => {
  const m = e.data;
  if (m.au) {
    for (const o of outs.values()) {
      if (o.waitKey && !m.key) continue; // ждём целый кадр: промежуточные без него зритель не соберёт
      if (m.key) { o.waitKey = false; o.q.length = 0; }
      o.q.push(m.au.slice(0)); // своя копия: буфер, отданный в кадр, отсоединяется (отчёт 14, ловушка 1)
      if (o.q.length > MAX_Q) {
        o.q.length = 0; o.waitKey = true; o.skips++;
        // 1.20.3: целый кадр уходит всем, поэтому просим его только для отправки, которая берёт кадры. Спящая
        // (зритель ушёл, соединение закрыто) раньше просила его раз в секунду до конца показа; проснётся — попросит один раз
        if (Date.now() - o.lastPull < ASLEEP_MS) askIdr('отправка отстала'); else o.asleep = true;
      }
    }
  } else if (m.drop != null) outs.delete(m.drop);
  else if (m.stats) postMessage({ stats: [...outs].map(([id, o]) => ({ id, sent: o.sent, empty: o.empty, keyAsks: o.keyAsks, skips: o.skips })) });
};

onrtctransform = (e) => {
  const t = e.transformer;
  const id = t.options.id;
  const o = { q: [], waitKey: true, sent: 0, empty: 0, keyAsks: 0, skips: 0, lastPull: Date.now(), asleep: false };
  outs.set(id, o);
  askIdr('новая отправка');
  t.readable.pipeThrough(new TransformStream({
    transform(frame, ctl) {
      o.lastPull = Date.now();
      if (o.asleep) { o.asleep = false; askIdr('отправка снова берёт кадры'); }
      // ключевой кадр пустышки: начало или зритель попросил целый кадр (PLI) — берём IDR у помощника
      if (frame.type === 'key') {
        o.keyAsks++;
        if (!o.waitKey) { o.waitKey = true; o.q.length = 0; }
        askIdr('зритель просит целый кадр');
      }
      const au = o.q.shift();
      if (!au) { o.empty++; return; } // кадра от помощника для этой отправки нет — пустышку не шлём
      frame.data = au;
      o.sent++;
      ctl.enqueue(frame);
    },
  })).pipeTo(t.writable).catch(() => { outs.delete(id); });
};
