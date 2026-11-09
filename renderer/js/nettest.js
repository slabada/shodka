// «Проверить интернет» (1.15.1): сколько стример может отдавать.
// Шлём на сервер до 64 МБ, но не дольше 6 секунд, и считаем скорость по ходу отправки
// (первую секунду пропускаем — соединение в это время разгоняется). Сервер данные не хранит.

const SIZE_MB = 64;
let blob = null;
function payload() {
  if (!blob) {
    const chunk = new Uint8Array(1024 * 1024); // нули: по сети они всё равно идут зашифрованными
    blob = new Blob(Array.from({ length: SIZE_MB }, () => chunk), { type: 'application/octet-stream' });
  }
  return blob;
}

// base — адрес сервера (http(s)://адрес:порт), token — вход; onProgress(доля 0…1)
export function measureUpload(base, token, { maxMs = 6000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const samples = [];
    const t0 = performance.now();
    let finished = false;
    const result = () => {
      const late = samples.filter((x) => x.t >= 1000);
      let mbps;
      if (late.length >= 2) {
        const a = late[0]; const b = late[late.length - 1];
        mbps = ((b.loaded - a.loaded) * 8) / ((b.t - a.t) / 1000) / 1e6;
      } else {
        const b = samples[samples.length - 1];
        mbps = b && b.t > 0 ? (b.loaded * 8) / (b.t / 1000) / 1e6 : 0;
      }
      return { mbps: Math.max(0, mbps), bytes: samples.length ? samples[samples.length - 1].loaded : 0, ms: Math.round(performance.now() - t0) };
    };
    const finish = (fn) => { if (finished) return; finished = true; clearTimeout(guard); fn(); };
    xhr.open('POST', base + '/speedtest');
    xhr.setRequestHeader('x-skh-token', token || '');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      const t = performance.now() - t0;
      samples.push({ t, loaded: e.loaded });
      if (onProgress) onProgress(Math.min(1, t / maxMs));
      if (t >= maxMs) finish(() => { xhr.abort(); resolve(result()); });
    };
    xhr.onload = () => finish(() => {
      if (xhr.status === 200) { samples.push({ t: performance.now() - t0, loaded: SIZE_MB * 1024 * 1024 }); resolve(result()); return; }
      let msg = ''; try { msg = JSON.parse(xhr.responseText).error; } catch (_) { /* ignore */ }
      reject(new Error(msg || (xhr.status === 404 ? 'сервер старый — обновите его до 1.15.1' : `код ${xhr.status}`)));
    });
    xhr.onerror = () => finish(() => reject(new Error('нет связи с сервером')));
    const guard = setTimeout(() => finish(() => { xhr.abort(); samples.length ? resolve(result()) : reject(new Error('сервер не ответил')); }), maxMs + 4000);
    xhr.send(payload());
  });
}

// Что поставить в «Авто» по скорости отдачи: 85 % отдачи делим на ожидаемых зрителей.
// «Лучшее качество» — 10 Мбит/с на зрителя (1080p, 60 кадров).
export const BEST_MBPS = 10;
export function pickQuality(upMbps, expectedViewers = 2) {
  const usable = Math.max(0, upMbps) * 0.85;
  const per = Math.max(2, Math.min(12, Math.floor(usable / Math.max(1, expectedViewers))));
  const best = Math.floor(usable / BEST_MBPS);
  return { per, best, usable };
}
