// Картинки в чате: подготовка (ужимаем большие фото, скриншоты оставляем чёткими), загрузка на сервер
// с прогрессом, просмотр крупно, копирование и сохранение.
const api = window.api;
const MAX_SIDE = 2048;           // больше по длинной стороне не нужно — экономим место на сервере и трафик
const KEEP_BYTES = 1.5e6;        // небольшие PNG/JPG/WebP отправляем как есть (скриншоты останутся чёткими)
const MAX_BYTES = 8e6;

export function serverBase(S) {
  const h = S.host.includes(':') && !S.host.startsWith('[') ? `[${S.host}]` : S.host;
  // порт по умолчанию (443/80) не пишем: Chromium всё равно его убирает, и адреса должны совпадать
  const dflt = S.secure ? 443 : 80;
  return `${S.secure ? 'https' : 'http'}://${h}${Number(S.port) === dflt ? '' : ':' + S.port}`;
}
export const imageUrl = (S, id) => `${serverBase(S)}/files/${id}`;

export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Можно отправлять только картинки');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Не удалось открыть картинку — файл повреждён или формат не поддерживается');
  const w = bmp.width, h = bmp.height;
  const simple = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  if ((file.type === 'image/gif' && file.size <= MAX_BYTES) || (simple && file.size <= KEEP_BYTES && Math.max(w, h) <= MAX_SIDE)) {
    bmp.close();
    return { blob: file, type: file.type, w, h };
  }
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const canvas = new OffscreenCanvas(cw, ch);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, cw, ch);
  bmp.close();
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 });
  if (blob.size > MAX_BYTES * 0.9) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return { blob, type: blob.type, w: cw, h: ch };
}

export function uploadImage(S, token, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', serverBase(S) + '/upload');
    xhr.setRequestHeader('x-skh-token', token);
    xhr.setRequestHeader('content-type', blob.type);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      if (xhr.status === 200 && r.id) resolve(r.id);
      else reject(new Error(r.error || `Сервер не принял картинку (код ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Картинка не отправилась — нет связи с сервером'));
    xhr.ontimeout = () => reject(new Error('Картинка отправлялась слишком долго — медленный интернет?'));
    xhr.send(blob);
  });
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export const imageFileName = (img) => `skhodka-${img.id.slice(0, 8)}.${EXT[img.type] || 'png'}`;

export async function copyImage(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
  const png = await c.convertToBlob({ type: 'image/png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export async function saveImage(url, name) {
  const buf = await (await fetch(url)).arrayBuffer();
  return api.saveFile(name, new Uint8Array(buf));
}

// ---------- файлы любого размера ----------
export function fmtSize(n) {
  const f = (v, d) => v.toFixed(d).replace(/\.0$/, '').replace('.', ',');
  if (n >= 1024 ** 3) return f(n / 1024 ** 3, n >= 10 * 1024 ** 3 ? 0 : 1) + ' ГБ';
  if (n >= 1024 ** 2) return f(n / 1024 ** 2, n >= 100 * 1024 ** 2 ? 0 : 1) + ' МБ';
  if (n >= 1024) return Math.round(n / 1024) + ' КБ';
  return n + ' Б';
}

// файл уходит потоком прямо с диска (в память целиком не читается), можно отменить
export function uploadFile(S, token, file, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', serverBase(S) + '/upload-file');
    xhr.setRequestHeader('x-skh-token', token);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name || 'файл'));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.timeout = 0;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      if (xhr.status === 200 && r.id) resolve(r.id);
      else reject(new Error(r.error || `Сервер не принял файл (код ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Файл не отправился — связь с сервером прервалась'));
    xhr.onabort = () => { const e = new Error('Отправка отменена'); e.canceled = true; reject(e); };
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

// значок по расширению
export function fileKind(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz'].includes(ext)) return 'archive';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus'].includes(ext)) return 'audio';
  if (['exe', 'msi', 'bat', 'apk'].includes(ext)) return 'app';
  if (['txt', 'doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'md', 'rtf', 'odt'].includes(ext)) return 'doc';
  return 'file';
}
