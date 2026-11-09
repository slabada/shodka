// Аватарка: картинка обрезается кружком в окне обрезки и сохраняется 256×256 WebP (~20–40 КБ).
// Главная копия — на сервере (видна со всех компьютеров), вторая — в папке программы: на новом
// сервере, где вас ещё не видели, аватарка загрузится сама.
import { settings } from './settings.js';

const api = window.api;
const SIZE = 256;

export async function sha256hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

// копия аватарки на этом компьютере — своя для каждого ника
let cur = { owner: null, a: undefined }; // a: { bytes, type, hash, url } | null; undefined — ещё не загружали
const ok = (o) => String(o || '').trim().toLowerCase();

function wrap(a) {
  if (!a) return null;
  const bytes = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
  return { bytes, type: a.type, url: URL.createObjectURL(new Blob([bytes], { type: a.type })) };
}

export async function loadLocalAvatar(owner) {
  if (!owner) return null;
  if (cur.owner === ok(owner) && cur.a !== undefined) return cur.a;
  const a = wrap(await api.avatarGet(owner, ok(owner) === ok(settings.nick)).catch(() => null));
  if (a) a.hash = await sha256hex(a.bytes);
  if (cur.a && cur.a.url) URL.revokeObjectURL(cur.a.url);
  cur = { owner: ok(owner), a };
  return a;
}
export const localAvatar = (owner) => (owner && cur.owner === ok(owner) ? cur.a || null : null);

export async function saveLocalAvatar(owner, a) {
  if (!owner) return null;
  const r = await api.avatarSet(owner, a ? { type: a.type, bytes: a.bytes } : null);
  if (!r || !r.ok) throw new Error('Не удалось сохранить аватарку' + (r && r.error ? `: ${r.error}` : ''));
  if (cur.a && cur.a.url) URL.revokeObjectURL(cur.a.url);
  const w = a ? wrap(a) : null;
  if (w) w.hash = await sha256hex(w.bytes);
  cur = { owner: ok(owner), a: w };
  return w;
}

// ---------- окно обрезки ----------
// Возвращает { bytes, type } или null, если человек нажал «Отмена».
export async function chooseAvatar(file) {
  if (!file || !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('Аватаркой может быть картинка JPG, PNG или WebP');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Не удалось открыть картинку — файл повреждён или формат не поддерживается');
  try { return await cropDialog(bmp); } finally { bmp.close(); }
}

function cropDialog(bmp) {
  const dlg = document.getElementById('avatar-dlg');
  const cv = document.getElementById('crop-canvas');
  const zoomEl = document.getElementById('crop-zoom');
  const g = cv.getContext('2d');
  const W = cv.width; const R = W * 0.44; // радиус кружка на холсте
  const base = (2 * R) / Math.min(bmp.width, bmp.height); // при zoom=1 кружок закрыт картинкой полностью
  const st = { zoom: 1, cx: bmp.width / 2, cy: bmp.height / 2 }; // центр кружка в координатах картинки
  zoomEl.value = '1';

  const clamp = () => {
    const half = R / (base * st.zoom);
    st.cx = Math.min(bmp.width - half, Math.max(half, st.cx));
    st.cy = Math.min(bmp.height - half, Math.max(half, st.cy));
  };
  const draw = () => {
    clamp();
    const k = base * st.zoom;
    g.fillStyle = '#0f1017'; g.fillRect(0, 0, W, W);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, W / 2 - st.cx * k, W / 2 - st.cy * k, bmp.width * k, bmp.height * k);
    // затемняем всё вне кружка
    g.save(); g.fillStyle = 'rgba(8, 9, 15, .62)';
    g.beginPath(); g.rect(0, 0, W, W); g.arc(W / 2, W / 2, R, 0, Math.PI * 2, true); g.fill('evenodd');
    g.restore();
    g.strokeStyle = 'rgba(255, 255, 255, .55)'; g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, W / 2, R, 0, Math.PI * 2); g.stroke();
  };

  return new Promise((resolve) => {
    let drag = null;
    const scale = () => cv.getBoundingClientRect().width / W; // холст ужат CSS-ом
    const onDown = (e) => { drag = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); };
    const onMove = (e) => {
      if (!drag) return;
      const k = base * st.zoom * scale();
      st.cx = drag.cx - (e.clientX - drag.x) / k; st.cy = drag.cy - (e.clientY - drag.y) / k; draw();
    };
    const onUp = () => { drag = null; cv.classList.remove('drag'); };
    const setZoom = (z) => { st.zoom = Math.min(5, Math.max(1, z)); zoomEl.value = String(st.zoom); draw(); };
    const onWheel = (e) => { e.preventDefault(); setZoom(st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
    const onZoom = () => setZoom(Number(zoomEl.value));
    const done = (res) => {
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('wheel', onWheel); zoomEl.removeEventListener('input', onZoom);
      dlg.removeEventListener('close', onClose);
      document.getElementById('crop-save').onclick = null;
      document.getElementById('crop-cancel').onclick = null;
      document.getElementById('crop-close').onclick = null;
      if (dlg.open) dlg.close();
      resolve(res);
    };
    const onClose = () => done(null);
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false }); zoomEl.addEventListener('input', onZoom);
    dlg.addEventListener('close', onClose);
    document.getElementById('crop-cancel').onclick = () => done(null);
    document.getElementById('crop-close').onclick = () => done(null);
    document.getElementById('crop-save').onclick = async () => {
      clamp();
      const half = R / (base * st.zoom);
      const out = new OffscreenCanvas(SIZE, SIZE);
      const og = out.getContext('2d'); og.imageSmoothingQuality = 'high';
      og.drawImage(bmp, st.cx - half, st.cy - half, half * 2, half * 2, 0, 0, SIZE, SIZE);
      const blob = await out.convertToBlob({ type: 'image/webp', quality: 0.9 });
      done({ bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp' });
    };
    draw();
    dlg.showModal();
  });
}
