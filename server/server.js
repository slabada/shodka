'use strict';
// Встроенный сервер «Сходки». Запускается на ПК хоста.
// Отвечает за: аккаунты, друзей, чат (общий + личные), голосовые комнаты
// и пересылку сигналов WebRTC между участниками. Сам звук и видео идут
// напрямую между компьютерами (через Radmin VPN / ZeroTier / локалку).
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');

const PROTOCOL_VERSION = 1;
const FEATURES = ['password', 'avatar', 'p2p', 'chat2', 'voicehold', 'space', 'speedtest', 'admins', 'moddel', 'logpull']; // chat2: ответы, правка, удаление и поиск сообщений // что умеет этот сервер (новые клиенты включают кнопки только при поддержке)
const VOICE_ROOMS = ['Балдёж'];
const NAME_RE = /^[\p{L}\p{N}_.\-]{2,24}$/u;
// ники, совпадающие со служебными словами JavaScript («__proto__», «constructor»…), запрещены
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype).map((x) => x.toLowerCase()));
const validName = (n) => NAME_RE.test(n) && !RESERVED.has(n.toLowerCase());
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// одиночные половинки суррогатных пар (обрезанные эмодзи) ломают encodeURIComponent и JSON — убираем
const wellFormed = (x) => String(x).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
const cutChars = (x, n) => Array.from(String(x)).slice(0, n).join('');
const MAX_TEXT = 2000;
const MAX_IMAGE = 8 * 1024 * 1024;           // одна картинка — до 8 МБ (клиент сам ужимает до ~1–2 МБ)
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }; // без анимации
const MAX_AVATAR = 1024 * 1024;               // аватарка 256×256 WebP весит ~20–40 КБ
const AVATAR_RE = /^[0-9a-f]{40}\.(webp|png|jpg)$/;

// TURN-учётка на 12 часов по схеме «общий секрет» (coturn: use-auth-secret)
function turnCredentials(turn, user) {
  if (!turn || !turn.secret || !turn.urls || !turn.urls.length) return [];
  const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${String(user).replace(/:/g, '')}`;
  const credential = crypto.createHmac('sha1', turn.secret).update(username).digest('base64');
  const stun = turn.urls.filter((u) => u.startsWith('stun:'));
  const relay = turn.urls.filter((u) => u.startsWith('turn:') || u.startsWith('turns:'));
  const out = [];
  if (stun.length) out.push({ urls: stun });
  if (relay.length) out.push({ urls: relay, username, credential });
  return out;
}

// Параметры:
//   tls: { cert, key } — шифрованное соединение (wss://), для сервера в интернете
//   password — пароль сервера (пусто — без пароля, как в сети Radmin VPN)
//   turn: { secret, urls } — ретранслятор (coturn или встроенный server/turn.js) для тех, у кого не получается прямое соединение
//   relayOnly — голос, демки и прямые файлы всех участников идут только через ретранслятор (программы 1.14+)
function createServer({ port = 41234, host = '0.0.0.0', dataDir, log = () => {}, tls = null, password = '', turn = null, relayOnly = false, maxConnPerIp = 12, filesMaxMb = 2048, diskReserve = 2 * 1024 ** 3, hostKey = '', voiceHoldMs = 60e3, admins = [], sfu = null }) {
  const store = new Store(dataDir, log);
  const filesDir = path.join(dataDir, 'files');
  const avatarsDir = path.join(filesDir, 'avatars');
  try { fs.mkdirSync(avatarsDir, { recursive: true }); } catch (_) { /* ignore */ }
  if (!store.data.files) store.data.files = {};
  // недогруженные файлы с прошлого запуска (обрыв связи) — убираем
  try { for (const f of fs.readdirSync(filesDir)) if (f.endsWith('.part')) fs.unlinkSync(path.join(filesDir, f)); } catch (_) { /* ignore */ }
  const uploads = new Map(); // ник → времена загрузок (не больше 30 в минуту)
  const clients = new Set(); // все соединения
  // Админы сервера (1.15.3): ники из настроек сервера (на VPS — пункт меню «Админы»). Хост своего сервера — тоже админ.
  const adminKeys = new Set((Array.isArray(admins) ? admins : []).map((n) => Store.key(n)).filter(Boolean));
  const isAdmin = (conn) => !!conn.isHost || (!!conn.user && adminKeys.has(Store.key(conn.user)));
  // размножитель демки (1.16, только сервер на VPS — server/sfu.js): программы узнают о нём по features 'sfu' и полю sfu в auth_ok
  const features = () => (sfu ? [...FEATURES, 'sfu'] : FEATURES);
  // удалённый админом ник 10 минут нельзя занять снова — иначе программа удалённого тут же переподключится и создаст его заново
  const deletedNicks = new Map(); // key → до какого времени
  const recentlyDeleted = (name) => { const t = deletedNicks.get(Store.key(name)); if (t && t > Date.now()) return Math.ceil((t - Date.now()) / 60e3); if (t) deletedNicks.delete(Store.key(name)); return 0; };
  let nextConnId = 1;

  // ---------- картинки чата: POST /upload (с токеном входа), GET /files/<id> ----------
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-skh-token, x-file-name, content-type, range', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition' };
  // файл удалили между проверкой и чтением или Windows не дал его открыть — обрываем ответ, а не падаем
  function pipeFile(stream, res) {
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  const reply = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS }); res.end(JSON.stringify(obj)); };

  function trimFiles() {
    const all = Object.entries(store.data.files).filter(([, f]) => f.kind !== 'file').sort((a, b) => a[1].ts - b[1].ts); // лимит — только для картинок
    let total = all.reduce((t, [, f]) => t + f.size, 0);
    const limit = filesMaxMb * 1024 * 1024;
    let removed = 0;
    while (total > limit && all.length) {
      const [id, f] = all.shift();
      try { fs.unlinkSync(path.join(filesDir, id + '.' + f.ext)); } catch (_) { /* уже нет */ }
      delete store.data.files[id]; total -= f.size; removed++;
    }
    if (removed) { log('info', 'server', `Место для картинок закончилось (${filesMaxMb} МБ) — удалил ${removed} самых старых`); store.scheduleSave(); }
  }

  // файлы, которые загрузили, но так и не отправили сообщением (отмена в последний момент, обрыв), — убираем через час
  function sweepOrphans() {
    const used = new Set();
    for (const list of Object.values(store.data.messages)) for (const m of list) { if (m.file) used.add(m.file.id); if (m.image) used.add(m.image.id); }
    let n = 0;
    for (const [id, f] of Object.entries(store.data.files)) {
      if (used.has(id) || Date.now() - f.ts < 3600e3) continue;
      fs.unlink(path.join(filesDir, id + '.' + f.ext), () => {}); delete store.data.files[id]; n++;
    }
    if (n) { store.scheduleSave(); log('info', 'server', `Убрал ${n} неотправленных файлов`); }
    // аватарки, которые больше никто не носит
    const worn = new Set(store.allUsers().map((u) => u.avatar).filter(Boolean));
    try {
      for (const f of fs.readdirSync(avatarsDir)) {
        if (worn.has(f)) continue;
        const p = path.join(avatarsDir, f);
        try { if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
  }

  // ---------- аватарки: POST /avatar (с токеном), GET /avatars/<sha>.<ext> ----------
  // Имя файла — отпечаток содержимого: одна и та же картинка не хранится дважды, отдаётся с вечным кэшем.
  function uploadAvatar(req, res) {
    const user = store.userByToken(String(req.headers['x-skh-token'] || ''));
    if (!user) return reply(res, 401, { error: 'Войдите заново' });
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = AVATAR_TYPES[type];
    if (!ext) return reply(res, 415, { error: 'Аватаркой может быть только картинка (JPG, PNG или WebP)' });
    if (Number(req.headers['content-length'] || 0) > MAX_AVATAR) return reply(res, 413, { error: 'Аватарка слишком большая (больше 1 МБ)' });
    const chunks = []; let size = 0; let aborted = false;
    req.on('data', (c) => { if (aborted) return; size += c.length; if (size > MAX_AVATAR) { aborted = true; reply(res, 413, { error: 'Аватарка слишком большая (больше 1 МБ)' }); req.destroy(); } else chunks.push(c); });
    req.on('error', () => {});
    req.on('end', () => {
      if (aborted) return;
      if (!size) return reply(res, 400, { error: 'Пустой файл' });
      const buf = Buffer.concat(chunks);
      const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40) + '.' + ext;
      const done = () => {
        const u = store.getUser(user.name);
        if (!u) return reply(res, 401, { error: 'Войдите заново' });
        delete u.avatarOff;
        if (u.avatar !== name) { u.avatar = name; store.scheduleSave(); pushUsers(); log('info', 'server', `${u.name} сменил аватарку`); }
        reply(res, 200, { avatar: name });
      };
      const file = path.join(avatarsDir, name);
      if (fs.existsSync(file)) return done();
      fs.writeFile(file, buf, (e) => {
        if (e) { log('error', 'server', `Не удалось сохранить аватарку: ${e.message}`); return reply(res, 500, { error: 'Сервер не смог сохранить аватарку' }); }
        done();
      });
    });
  }

  function serveAvatar(req, res, name) {
    if (!AVATAR_RE.test(name)) { res.writeHead(404, CORS); return res.end(); }
    const file = path.join(avatarsDir, name);
    fs.stat(file, (e, st) => {
      if (e) { res.writeHead(404, CORS); return res.end(); }
      const ext = name.split('.').pop();
      const type = Object.keys(AVATAR_TYPES).find((t) => AVATAR_TYPES[t] === ext);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000, immutable', ...CORS });
      if (req.method === 'HEAD') return res.end();
      pipeFile(fs.createReadStream(file), res);
    });
  }
  sweepOrphans();
  const sweepTimer = setInterval(sweepOrphans, 3600e3); sweepTimer.unref && sweepTimer.unref();

  function upload(req, res) {
    const user = store.userByToken(String(req.headers['x-skh-token'] || ''));
    if (!user) return reply(res, 401, { error: 'Войдите заново' });
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = IMAGE_TYPES[type];
    if (!ext) return reply(res, 415, { error: 'Можно отправлять только картинки (JPG, PNG, WebP, GIF)' });
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_IMAGE) return reply(res, 413, { error: 'Картинка слишком большая (больше 8 МБ)' });
    const now = Date.now(); const k = Store.key(user.name);
    const times = (uploads.get(k) || []).filter((t) => now - t < 60000);
    if (times.length >= 30) return reply(res, 429, { error: 'Слишком много картинок подряд — подождите минуту' });
    times.push(now); uploads.set(k, times);
    const chunks = []; let size = 0; let aborted = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_IMAGE) { aborted = true; reply(res, 413, { error: 'Картинка слишком большая (больше 8 МБ)' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (aborted) return;
      if (!size) return reply(res, 400, { error: 'Пустой файл' });
      const id = crypto.randomBytes(16).toString('hex');
      fs.writeFile(path.join(filesDir, id + '.' + ext), Buffer.concat(chunks), (e) => {
        if (e) { log('error', 'server', `Не удалось сохранить картинку: ${e.message} (диск заполнен?)`); return reply(res, 500, { error: 'Сервер не смог сохранить картинку' }); }
        store.data.files[id] = { owner: k, type, ext, size, ts: Date.now() };
        store.scheduleSave(); trimFiles();
        reply(res, 200, { id });
      });
    });
  }

  // ---------- файлы любого размера: POST /upload-file (поток прямо на диск), отдача с докачкой (Range) ----------
  const RESERVE = diskReserve; // на диске всегда оставляем запас (2 ГБ), чтобы хост не остался без места
  function freeSpace() {
    try { const st = fs.statfsSync(filesDir); return st.bavail * st.bsize; } catch (_) { return Infinity; }
  }
  const fileName = (s) => cutChars(wellFormed(String(s || 'файл')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, ''), 180) || 'файл';
  const human = (n) => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' ГБ' : n >= 1024 ** 2 ? Math.round(n / 1024 ** 2) + ' МБ' : Math.ceil(n / 1024) + ' КБ';

  let inFlight = 0; // байт, которые сейчас загружаются
  function uploadFile(req, res) {
    const user = store.userByToken(String(req.headers['x-skh-token'] || ''));
    if (!user) return reply(res, 401, { error: 'Войдите заново' });
    const len = Number(req.headers['content-length']);
    if (!Number.isFinite(len) || len <= 0) return reply(res, 411, { error: 'Пустой файл' });
    // место, обещанное загрузкам, которые ещё идут, тоже занято (иначе две большие загрузки сразу забьют диск)
    const free = freeSpace() - inFlight;
    if (len > free - RESERVE) return reply(res, 507, { error: `У хоста мало места на диске: свободно ${human(Math.max(0, free - RESERVE))}, а файл ${human(len)}` });
    // в счёт — только ещё не записанная часть (записанная уже вычтена из свободного места самим диском)
    let pending = len; inFlight += len;
    const release = () => { inFlight -= pending; pending = 0; };
    res.on('close', release);
    let name = 'файл';
    try { name = fileName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch (_) { /* битое имя */ }
    const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().slice(0, 100);
    const id = crypto.randomBytes(16).toString('hex');
    const tmp = path.join(filesDir, id + '.part');
    const out = fs.createWriteStream(tmp);
    let size = 0; let failed = false;
    const fail = (code, msg) => { if (failed) return; failed = true; req.unpipe(out); out.destroy(); fs.unlink(tmp, () => {}); if (!res.headersSent) reply(res, code, { error: msg }); };
    req.on('data', (c) => { size += c.length; const d = Math.min(pending, c.length); pending -= d; inFlight -= d; if (size > len) fail(400, 'Размер файла не совпал'); });
    req.on('close', () => { if (!req.complete) { fail(499, 'Отправка прервана'); log('info', 'server', `${user.name}: отправка файла «${name}» прервана`); } });
    out.on('error', (e) => { if (failed) return; log('error', 'server', `Не удалось записать файл: ${e.message} (диск заполнен?)`); fail(500, 'Сервер не смог сохранить файл — возможно, закончилось место'); });
    out.on('finish', () => {
      if (failed) return;
      if (size !== len) return fail(400, 'Файл пришёл не целиком — попробуйте ещё раз');
      fs.rename(tmp, path.join(filesDir, id + '.bin'), (e) => {
        if (e) return fail(500, 'Сервер не смог сохранить файл');
        store.data.files[id] = { kind: 'file', owner: Store.key(user.name), type, ext: 'bin', name, size, ts: Date.now() };
        store.scheduleSave();
        log('info', 'server', `${user.name} загрузил файл «${name}» (${human(size)})`);
        reply(res, 200, { id });
      });
    });
    req.pipe(out);
  }

  function serveFile(req, res, id) {
    const f = /^[0-9a-f]{32}$/.test(id) && own(store.data.files, id) && store.data.files[id];
    if (!f) { res.writeHead(404, CORS); return res.end(); }
    const file = path.join(filesDir, id + '.' + f.ext);
    fs.stat(file, (e, st) => {
      if (e) { res.writeHead(404, CORS); return res.end(); }
      const head = { 'Content-Type': f.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', ...CORS };
      if (f.kind === 'file') { try { head['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(wellFormed(f.name || 'файл'))}`; } catch (_) { head['Content-Disposition'] = 'attachment'; } }
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
        let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
        if (start < 0) start = 0;
        if (start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, ...CORS }); return res.end(); }
        end = Math.min(end, st.size - 1);
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        return pipeFile(fs.createReadStream(file, { start, end }), res);
      }
      res.writeHead(200, { ...head, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      pipeFile(fs.createReadStream(file), res);
    });
  }

  // Проверка интернета (1.15.1): программа шлёт сюда несколько десятков мегабайт, сервер считает и выбрасывает их —
  // так стример узнаёт свою скорость отдачи. Одна проверка на человека за раз, не чаще раза в 5 с, не больше 256 МБ.
  const speedtests = new Map(); // ключ ника → время начала
  function speedtest(req, res) {
    const user = store.userByToken(String(req.headers['x-skh-token'] || ''));
    if (!user) return reply(res, 401, { error: 'Войдите заново' });
    const k = Store.key(user.name); const now = Date.now();
    if (speedtests.has(k) && now - speedtests.get(k) < 5000) return reply(res, 429, { error: 'Проверка уже идёт — подождите пару секунд' });
    speedtests.set(k, now);
    let bytes = 0; let first = 0; let done = false;
    const LIMIT = 256 * 1024 * 1024;
    req.on('data', (c) => { if (!first) first = Date.now(); bytes += c.length; if (bytes > LIMIT && !done) { done = true; reply(res, 413, { error: 'Слишком много' }); req.destroy(); } });
    req.on('end', () => { if (done) return; done = true; reply(res, 200, { bytes, ms: first ? Date.now() - first : 0 }); });
  }

  const page = (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method === 'POST' && url === '/upload') return upload(req, res);
    if (req.method === 'POST' && url === '/avatar') return uploadAvatar(req, res);
    if ((req.method === 'GET' || req.method === 'HEAD') && url.startsWith('/avatars/')) return serveAvatar(req, res, url.slice(9));
    if (req.method === 'POST' && url === '/upload-file') return uploadFile(req, res);
    if (req.method === 'POST' && url === '/speedtest') return speedtest(req, res);
    if ((req.method === 'GET' || req.method === 'HEAD') && url.startsWith('/files/')) return serveFile(req, res, url.slice(7));
    // Простая страница-проверка: можно открыть адрес сервера в браузере.
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Сервер «Сходка» работает. Подключайтесь через приложение.\nВерсия протокола: ${PROTOCOL_VERSION}\n`);
  };
  const httpServer = tls ? https.createServer({ cert: tls.cert, key: tls.key }, page) : http.createServer(page);
  httpServer.requestTimeout = 0; // большой файл может грузиться долго — не обрываем через 5 минут
  httpServer.timeout = 0;
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024 });
  // ws пересылает ошибки http-сервера (например, занятый порт) — без этого обработчика процесс падает.
  wss.on('error', (e) => log('debug', 'server', `wss error: ${e.code || e.message}`));

  // ---------- вспомогательное ----------
  const send = (conn, msg) => {
    if (conn.ws.readyState === 1) {
      try { conn.ws.send(JSON.stringify(msg)); } catch (e) { log('warn', 'server', `Ошибка отправки ${conn.user || conn.id}: ${e.message}`); }
    }
  };
  const authed = () => [...clients].filter((c) => c.user);
  const connsOf = (name) => authed().filter((c) => Store.key(c.user) === Store.key(name));
  // «держим место»: связь человека с сервером оборвалась, а звонок между компьютерами идёт мимо сервера и, скорее всего,
  // жив. Минуту не объявляем остальным, что он ушёл; сигналы для него копим и отдаём, когда он вернётся.
  const VOICE_HOLD_MS = voiceHoldMs;
  let closing = false;
  const holds = new Map(); // ключ ника → { name, room, muted, deafened, streaming, timer, queue }
  const isOnline = (name) => connsOf(name).length > 0 || holds.has(Store.key(name));
  const sendToUser = (name, msg) => connsOf(name).forEach((c) => send(c, msg));
  const broadcast = (msg) => authed().forEach((c) => send(c, msg));
  const err = (conn, code, message, ref) => send(conn, { type: 'error', code, message, ref });
  const dmChannel = (a, b) => 'dm:' + [Store.key(a), Store.key(b)].sort().join('|');
  // в какой переписке действие и кому разослать изменения: общий чат — всем, личка — двоим
  const chatTarget = (conn, m) => {
    if (m.channel === 'general') return { channel: 'general', deliver: (msg) => broadcast(msg) };
    const withName = typeof m.with === 'string' ? m.with : typeof m.to === 'string' ? m.to : null;
    if (!withName) return null;
    const me = store.getUser(conn.user), other = store.getUser(withName);
    if (!me || !other) return null;
    return { channel: dmChannel(me.name, other.name), deliver: (msg) => { sendToUser(me.name, msg); if (Store.key(me.name) !== Store.key(other.name)) sendToUser(other.name, msg); } };
  };
  const replySnapshot = (o) => {
    const r = { id: o.id, author: o.author, text: String(o.text || '').slice(0, 200) };
    if (o.image) r.image = true;
    if (o.file) r.file = String(o.file.name || '').slice(0, 120);
    return r;
  };

  function userList() {
    return store.allUsers().map((u) => ({ name: u.name, online: isOnline(u.name), avatar: u.avatar || null }));
  }
  const pushUsers = () => broadcast({ type: 'users', list: userList() });

  function voiceState() {
    const rooms = {};
    for (const r of VOICE_ROOMS) rooms[r] = [];
    for (const c of authed()) {
      if (c.voice) rooms[c.voice.room].push({ name: c.user, muted: !!c.voice.muted, deafened: !!c.voice.deafened, streaming: !!c.voice.streaming });
    }
    for (const h of holds.values()) rooms[h.room].push({ name: h.name, muted: !!h.muted, deafened: !!h.deafened, streaming: !!h.streaming, away: true });
    return rooms;
  }
  // «вместе N мин»: встреча начинается, когда в комнате стало двое и больше. Короткий обрыв (до минуты)
  // её не сбрасывает. Отдаём не время начала, а сколько прошло — часы на компьютерах могут не совпадать.
  const together = new Map(); // комната → { since, droppedAt }
  function togetherState(rooms) {
    const now = Date.now(); const out = {};
    for (const r of VOICE_ROOMS) {
      const n = (rooms[r] || []).length; let t = together.get(r);
      if (n >= 2) {
        if (!t || (t.droppedAt && now - t.droppedAt > 60e3)) { t = { since: now, droppedAt: 0 }; together.set(r, t); } else t.droppedAt = 0;
        out[r] = now - t.since;
      } else if (t && !t.droppedAt) t.droppedAt = now;
    }
    return out;
  }
  const pushVoice = () => { const rooms = voiceState(); broadcast({ type: 'voice_rooms', rooms, together: togetherState(rooms) }); };

  // место держали, но человек не вернулся (или зашёл заново, а не продолжил) — теперь он ушёл для всех
  function dropHold(name, reason, push = true) {
    const k = Store.key(name); const h = holds.get(k);
    if (!h) return;
    clearTimeout(h.timer); holds.delete(k);
    if (sfu) sfu.closePeer(k, reason);
    for (const c of authed()) if (c.voice && c.voice.room === h.room && Store.key(c.user) !== k) send(c, { type: 'voice_peer_left', name: h.name });
    log('info', 'server', `${h.name} вышел из «${h.room}» (${reason})`);
    if (push) { pushVoice(); if (!isOnline(h.name)) pushUsers(); }
  }
  function holdVoice(conn) {
    const v = conn.voice; conn.voice = null;
    const k = Store.key(conn.user);
    if (holds.has(k)) dropHold(conn.user, 'повтор', false);
    const h = { name: conn.user, room: v.room, muted: v.muted, deafened: v.deafened, streaming: v.streaming, queue: [] };
    h.timer = setTimeout(() => dropHold(h.name, `не вернулся за ${VOICE_HOLD_MS / 1000} с`), VOICE_HOLD_MS);
    if (h.timer.unref) h.timer.unref();
    holds.set(k, h);
    log('info', 'server', `${conn.user}: связь с сервером оборвалась — держу место в «${v.room}» ${VOICE_HOLD_MS / 1000} с, звонок не прерываю`);
    pushVoice();
  }

  function leaveVoice(conn, reason) {
    if (!conn.voice) return;
    const room = conn.voice.room;
    conn.voice = null;
    if (sfu) sfu.closePeer(Store.key(conn.user), reason || 'вышел из комнаты');
    for (const c of authed()) {
      if (c !== conn && c.voice && c.voice.room === room) send(c, { type: 'voice_peer_left', name: conn.user });
    }
    log('info', 'server', `${conn.user} вышел из «${room}»${reason ? ' (' + reason + ')' : ''}`);
    pushVoice();
  }

  // ник сменился: у всех подключений этого пользователя новое имя, остальным — событие и свежие списки
  function announceRename(from, to, user) {
    for (const c of authed()) if (Store.key(c.user) === Store.key(from)) c.user = to;
    if (sfu) sfu.rename(Store.key(from), Store.key(to), to);
    broadcast({ type: 'user_renamed', from, to });
    pushUsers(); pushVoice();
  }

  // защита от перебора с одного адреса (пароль сервера, старые пароли): 10 ошибок за 10 минут — пауза 10 минут
  const ipFails = new Map();
  const isLocal = (addr) => addr === '127.0.0.1' || addr === '::1';
  function ipFailed(addr) {
    if (isLocal(addr)) return;
    const now = Date.now(); const f = ipFails.get(addr) || { n: 0, first: now, until: 0 };
    if (now - f.first > 600e3) { f.n = 0; f.first = now; }
    if (++f.n >= 10) { f.until = now + 600e3; f.n = 0; f.first = now; log('warn', 'server', `С адреса ${addr} много неверных паролей — пауза 10 минут`); }
    ipFails.set(addr, f);
    if (ipFails.size > 5000) for (const [k, v] of ipFails) if (v.until < now && now - v.first > 600e3) ipFails.delete(k);
  }
  const ipLocked = (addr) => { const f = ipFails.get(addr); return !!(f && f.until > Date.now()); };

  // защита от перебора пароля аккаунта: 5 ошибок за 10 минут — пауза 10 минут
  const loginFails = new Map();
  function loginFailed(name) {
    const k = Store.key(name); const now = Date.now();
    const f = loginFails.get(k) || { n: 0, first: now, until: 0 };
    if (now - f.first > 600e3) { f.n = 0; f.first = now; }
    f.n++; if (f.n >= 5) { f.until = now + 600e3; f.n = 0; f.first = now; }
    loginFails.set(k, f);
  }
  function loginLocked(name) {
    const f = loginFails.get(Store.key(name));
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60e3) : 0;
  }

  function onAuthed(conn, user, token, ref) {
    const wasOnline = isOnline(user.name);
    conn.user = user.name;
    conn.token = token;
    send(conn, {
      type: 'auth_ok', ref, token, name: user.name, hasPassword: !!user.pw, avatarOff: !!user.avatarOff,
      voiceRooms: VOICE_ROOMS, friends: [], users: userList(), rooms: voiceState(), together: togetherState(voiceState()),
      iceServers: turnCredentials(turn, user.name), relayOnly: !!(relayOnly && turn && turn.secret), admin: isAdmin(conn),
      ...(sfu ? { sfu: !!sfu.up } : {}),
    });
    log('info', 'server', `${user.name} вошёл (${conn.addr})`);
    if (!wasOnline) pushUsers();
  }

  // ---------- обработчики сообщений ----------
  const handlers = {
    hello(conn, m) {
      if (m.v !== PROTOCOL_VERSION) {
        err(conn, 'version', `Версия приложения не совпадает с хостом (у вас ${m.v}, у хоста ${PROTOCOL_VERSION}). Обновите приложение у всех.`);
      }
      // хост — тот, кто знает секрет своего встроенного сервера (на VPS хоста нет: обслуживание — командой skhodka)
      const hk = (x) => crypto.createHash('sha256').update(String(x)).digest(); // одинаковая длина — сравнение без исключений
      conn.isHost = !!hostKey && typeof m.hostKey === 'string' && crypto.timingSafeEqual(hk(m.hostKey), hk(hostKey));
      const given = String(m.password || '');
      if (password) {
        // перебор пароля сервера: с одного адреса — не больше 10 ошибок за 10 минут, с одного соединения — 3
        if (ipLocked(conn.addr)) { send(conn, { type: 'hello', ref: m.ref, v: PROTOCOL_VERSION, rooms: VOICE_ROOMS, needPassword: true, passwordOk: false, features: features() }); return setTimeout(() => conn.ws.close(), 300); }
        const a = crypto.createHash('sha256').update(given).digest();
        const b = crypto.createHash('sha256').update(password).digest();
        conn.passOk = crypto.timingSafeEqual(a, b);
        if (!conn.passOk && given) {
          log('warn', 'server', `Неверный пароль сервера с ${conn.addr}`);
          ipFailed(conn.addr);
          if ((conn.passFails = (conn.passFails || 0) + 1) >= 3) setTimeout(() => conn.ws.close(), 900);
        }
      } else conn.passOk = true;
      const reply = () => send(conn, { type: 'hello', ref: m.ref, v: PROTOCOL_VERSION, rooms: VOICE_ROOMS, needPassword: !!password, passwordOk: conn.passOk, features: features() });
      // неверный пароль — отвечаем с задержкой (защита от перебора)
      if (!conn.passOk && given) setTimeout(reply, 800); else reply();
    },

    register(conn, m) {
      const name = String(m.name || '').trim();
      const password = String(m.password || '');
      if (!validName(name)) return err(conn, 'bad_name', 'Ник: 2–24 символа, буквы, цифры, _ . -', m.ref);
      if (password.length < 4) return err(conn, 'bad_password', 'Пароль слишком короткий (минимум 4 символа)', m.ref);
      const del = recentlyDeleted(name);
      if (del) return err(conn, 'deleted', `Ник «${name}» недавно удалён с сервера. Занять его снова можно через ${del} мин.`, m.ref);
      if (store.getUser(name)) return err(conn, 'name_taken', `Ник «${name}» уже занят на этом сервере. Если это вы — проверьте пароль.`, m.ref);
      // Новый ник — всегда новый аккаунт. Раньше вход под другим ником с того же компьютера считался
      // сменой ника, но после «Выйти из аккаунта» так второй человек за этим ПК забирал чужой аккаунт.
      // Сменить свой ник — в профиле; старые ненужные ники хост удаляет правым щелчком.
      const user = store.createUser(name, password);
      log('info', 'server', `Зарегистрирован новый пользователь: ${name}`);
      onAuthed(conn, user, store.issueToken(user), m.ref);
      pushUsers();
    },

    // Вход: password — ключ этого компьютера (или старый пароль), accountPassword — пароль аккаунта,
    // которым можно войти с любого компьютера (тогда этот компьютер запоминается за аккаунтом).
    login(conn, m) {
      const user = store.getUser(m.name);
      if (!user) return err(conn, 'no_account', `Ника «${m.name}» на этом сервере ещё нет`, m.ref);
      const key = String(m.password || '');
      if (!user.hash && !(user.kids && user.kids.length) && !user.pw) {
        // ник освобождён хостом — закрепляем за тем, кто вошёл первым
        if (key.length < 4) return err(conn, 'bad_password', 'Пароль слишком короткий', m.ref);
        store.setPassword(user, key);
        log('info', 'server', `Освобождённый ник ${user.name} закреплён за новым компьютером (${conn.addr})`);
        return onAuthed(conn, user, store.issueToken(user), m.ref);
      }
      const humanPass = key.length < 32; // старый вход по паролю (до входа по ключу компьютера) — его можно подбирать
      if (humanPass && (loginLocked(user.name) || ipLocked(conn.addr))) return err(conn, 'too_many', 'Слишком много неверных попыток входа. Попробуйте через 10 минут.', m.ref);
      if (store.deviceKnown(user, key)) return onAuthed(conn, user, store.issueToken(user), m.ref);
      const ap = m.accountPassword != null ? String(m.accountPassword) : '';
      if (ap) {
        const lock = loginLocked(user.name);
        if (lock) return err(conn, 'too_many', `Слишком много неверных паролей для «${user.name}». Попробуйте через ${lock} мин.`, m.ref);
        if (store.checkAccountPassword(user, ap)) {
          loginFails.delete(Store.key(user.name));
          if (key.length >= 32) store.addDevice(user, key);
          log('info', 'server', `${user.name} вошёл по паролю аккаунта с нового компьютера (${conn.addr})`);
          return onAuthed(conn, user, store.issueToken(user), m.ref);
        }
        loginFailed(user.name); ipFailed(conn.addr);
        log('warn', 'server', `Неверный пароль аккаунта «${user.name}» с ${conn.addr}`);
        return setTimeout(() => err(conn, 'bad_password', 'Неверный пароль', m.ref), 700);
      }
      if (humanPass) { loginFailed(user.name); ipFailed(conn.addr); }
      log('warn', 'server', `Вход под ником «${user.name}» с незнакомого компьютера (${conn.addr})`);
      // небольшая задержка против перебора
      if (user.pw) return setTimeout(() => err(conn, 'need_password', `Ник «${user.name}» защищён паролем. Если это ваш аккаунт — введите пароль.`, m.ref), 300);
      return setTimeout(() => err(conn, 'bad_login', `Ник «${user.name}» уже занят на этом сервере`, m.ref), 600);
    },

    resume(conn, m) {
      const user = store.userByToken(String(m.token || ''));
      if (!user) return err(conn, 'bad_token', 'Сессия устарела — войдите заново', m.ref);
      onAuthed(conn, user, m.token, m.ref);
    },

    // закрепить ник за ключом этого компьютера (вход только по нику)
    bind_key(conn, m) {
      const key = String(m.key || '');
      if (key.length < 32) return err(conn, 'bad_key', 'Неверный ключ устройства', m.ref);
      const user = store.getUser(conn.user);
      if (!store.deviceKnown(user, key)) { store.addDevice(user, key); log('info', 'server', `${user.name}: ник закреплён за этим компьютером`); }
      send(conn, { type: 'ok', ref: m.ref });
    },

    // пароль аккаунта: с ним можно войти под своим ником с любого компьютера
    set_password(conn, m) {
      const user = store.getUser(conn.user);
      const pw = String(m.password || '');
      if (pw.length < 6) return err(conn, 'bad_password', 'Пароль — минимум 6 символов', m.ref);
      if (pw.length > 64) return err(conn, 'bad_password', 'Пароль слишком длинный (до 64 символов)', m.ref);
      if (user.pw) {
        const lock = loginLocked(user.name);
        if (lock) return err(conn, 'too_many', `Слишком много неверных паролей. Попробуйте через ${lock} мин.`, m.ref);
        if (!store.checkAccountPassword(user, m.current)) { loginFailed(user.name); return setTimeout(() => err(conn, 'bad_current', 'Текущий пароль неверный', m.ref), 700); }
      }
      const had = !!user.pw;
      store.setAccountPassword(user, pw);
      log('info', 'server', `${user.name} ${had ? 'сменил' : 'задал'} пароль аккаунта`);
      send(conn, { type: 'ok', ref: m.ref, hasPassword: true });
    },

    // смена ника: друзья, переписка и вход остаются, старый ник исчезает из списка
    rename(conn, m) {
      const name = String(m.name || '').trim();
      if (!validName(name)) return err(conn, 'bad_name', 'Ник: 2–24 символа, буквы, цифры, _ . -', m.ref);
      const old = conn.user;
      if (name === old) return send(conn, { type: 'ok', ref: m.ref, name });
      const taken = store.getUser(name);
      if (taken && Store.key(taken.name) !== Store.key(old)) return err(conn, 'name_taken', `Ник «${name}» уже занят`, m.ref);
      const user = store.renameUser(old, name);
      log('info', 'server', `${old} сменил ник на ${name}`);
      send(conn, { type: 'ok', ref: m.ref, name });
      announceRename(old, name, user);
    },

    // удалить свой файл (или любой — если вы хост): освобождает место, в чате остаётся «файл удалён»
    file_delete(conn, m) {
      const id = String(m.id || '');
      const f = store.data.files[id];
      if (!f) return err(conn, 'no_file', 'Файл уже удалён', m.ref);
      const host = !!conn.isHost;
      if (f.owner !== Store.key(conn.user) && !host) return err(conn, 'forbidden', 'Удалить можно только свой файл', m.ref);
      fs.unlink(path.join(filesDir, id + '.' + f.ext), () => {});
      delete store.data.files[id];
      store.scheduleSave();
      log('info', 'server', `${conn.user} удалил файл «${f.name || id}»`);
      send(conn, { type: 'ok', ref: m.ref });
      broadcast({ type: 'file_deleted', id });
    },

    // хост может убрать с сервера старые, никому не нужные ники (только с этого же компьютера)
    // админ (или хост) удаляет пользователя; того, кто в сети, сначала отключает
    admin_delete_user(conn, m) {
      if (!isAdmin(conn)) return err(conn, 'forbidden', 'Удалять пользователей может только админ сервера', m.ref);
      const u = store.getUser(m.name);
      if (!u) return err(conn, 'no_user', 'Пользователь не найден', m.ref);
      if (Store.key(u.name) === Store.key(conn.user)) return err(conn, 'self', 'Себя удалить нельзя', m.ref);
      const online = isOnline(u.name);
      if (online) {
        if (!m.force) return err(conn, 'online', `${u.name} сейчас в сети`, m.ref);
        for (const c of connsOf(u.name)) {
          c.kicked = true;
          send(c, { type: 'kicked', reason: 'deleted', by: conn.user });
          leaveVoice(c, 'удалён с сервера');
          const ws = c.ws; setTimeout(() => { try { ws.close(4003, 'deleted'); } catch (_) { /* ignore */ } }, 200);
          c.user = null;
        }
        dropHold(u.name, 'удалён с сервера', false);
        deletedNicks.set(Store.key(u.name), Date.now() + 10 * 60e3);
      }
      store.deleteUser(u.name);
      log('info', 'server', `${conn.user || 'Хост'} удалил пользователя ${u.name}${online ? ' (был в сети — отключён)' : ''}`);
      send(conn, { type: 'ok', ref: m.ref });
      pushVoice(); pushUsers();
    },

    // убрать свою аватарку
    avatar_clear(conn, m) {
      const user = store.getUser(conn.user);
      if (user) { const had = !!user.avatar; user.avatar = null; user.avatarOff = true; store.scheduleSave(); if (had) { pushUsers(); log('info', 'server', `${user.name} убрал аватарку`); } }
      send(conn, { type: 'ok', ref: m.ref });
    },

    // хост «освобождает» ник того, кто потерял и пароль, и папку программы: первый вошедший с этим ником
    // забирает аккаунт со всей перепиской
    admin_release_user(conn, m) {
      if (!isAdmin(conn)) return err(conn, 'forbidden', 'Это может только админ сервера', m.ref);
      const u = store.getUser(m.name);
      if (!u) return err(conn, 'no_user', 'Пользователь не найден', m.ref);
      if (isOnline(u.name)) return err(conn, 'online', `${u.name} сейчас в сети — освободить можно только ник того, кто не в сети`, m.ref);
      store.releaseUser(u);
      loginFails.delete(Store.key(u.name));
      log('info', 'server', `${conn.user || 'Хост'} освободил ник ${u.name}: следующий вход под этим ником заберёт аккаунт`);
      send(conn, { type: 'ok', ref: m.ref });
    },

    logout(conn, m) {
      // выход с чужого компьютера: забываем его, чтобы под этим ником с него больше не входили без пароля
      // (и свой компьютер — если у аккаунта есть пароль: на общем ПК после выхода под ником без пароля не войти)
      let forgot = false;
      if (m && m.forget && conn.user) { const u = store.getUser(conn.user); if (u && (forgot = store.forgetDevice(u, String(m.key || '')))) log('info', 'server', `${u.name} вышел и отвязал компьютер (${conn.addr})`); }
      if (m && m.ref) send(conn, { type: 'ok', ref: m.ref, forgot });
      if (conn.token) store.revokeToken(conn.token);
      leaveVoice(conn, 'выход');
      conn.user = null;
      pushUsers();
    },

    // ---- чат ----
    chat_send(conn, m) {
      const text = String(m.text || '').trim();
      let image = null;
      if (m.image) {
        const id = String(m.image.id || '');
        const f = store.data.files[id];
        if (!f || f.owner !== Store.key(conn.user)) return err(conn, 'bad_image', 'Картинка не загрузилась — попробуйте ещё раз', m.ref);
        const dim = (v) => Math.max(0, Math.min(20000, Math.round(Number(v) || 0)));
        image = { id, type: f.type, w: dim(m.image.w), h: dim(m.image.h), size: f.size };
      }
      let file = null;
      if (m.file && !image) {
        const id = String(m.file.id || '');
        const f = store.data.files[id];
        if (!f || f.kind !== 'file' || f.owner !== Store.key(conn.user)) return err(conn, 'bad_file', 'Файл не загрузился — попробуйте ещё раз', m.ref);
        file = { id, name: f.name, size: f.size, type: f.type };
      }
      // файл «напрямую»: на сервере его нет, он лежит у отправителя и передаётся с его компьютера
      if (m.p2p && !image && !file) {
        const id = String(m.p2p.id || '');
        const name = String(m.p2p.name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200).trim();
        const size = Number(m.p2p.size);
        if (!/^[0-9a-f]{32}$/.test(id) || !name || !Number.isFinite(size) || size < 0) return err(conn, 'bad_file', 'Файл не отправился — попробуйте ещё раз', m.ref);
        file = { id, name, size: Math.round(size), type: String(m.p2p.type || '').slice(0, 100), p2p: true };
      }
      if (!text && !image && !file) return;
      if (text.length > MAX_TEXT) return err(conn, 'too_long', `Сообщение слишком длинное (максимум ${MAX_TEXT} символов)`, m.ref);
      const msg = { id: crypto.randomBytes(8).toString('hex'), author: conn.user, text, ts: Date.now() };
      if (image) msg.image = image;
      if (file) msg.file = file;
      // ответ на сообщение: храним короткую выдержку — цитата видна, даже если оригинал давно ушёл вверх
      if (typeof m.reply === 'string' && m.reply) {
        const ch = chatTarget(conn, m);
        const orig = ch && store.findMessage(ch.channel, m.reply);
        if (orig && !orig.deleted) msg.reply = replySnapshot(orig);
      }
      if (m.channel === 'general') {
        msg.channel = 'general';
        store.addMessage('general', msg);
        broadcast({ type: 'chat', msg });
      } else if (typeof m.to === 'string') {
        const me = store.getUser(conn.user);
        const other = store.getUser(m.to);
        if (!other) return err(conn, 'no_user', 'Получатель не найден', m.ref);
        msg.channel = dmChannel(me.name, other.name);
        msg.to = other.name;
        store.addMessage(msg.channel, msg);
        sendToUser(me.name, { type: 'chat', msg });
        if (Store.key(me.name) !== Store.key(other.name)) sendToUser(other.name, { type: 'chat', msg });
      } else {
        return err(conn, 'bad_channel', 'Неизвестный канал', m.ref);
      }
      send(conn, { type: 'ok', ref: m.ref });
    },

    history(conn, m) {
      let channel;
      if (m.channel === 'general') channel = 'general';
      else if (typeof m.with === 'string') channel = dmChannel(conn.user, m.with);
      else return err(conn, 'bad_channel', 'Неизвестный канал', m.ref);
      const h = store.history(channel, m.before, 80);
      send(conn, { type: 'history', ref: m.ref, key: m.channel === 'general' ? 'general' : 'dm:' + m.with, ...h });
    },

    // ---- правка, удаление и поиск сообщений ----
    chat_edit(conn, m) {
      const ch = chatTarget(conn, m);
      if (!ch) return err(conn, 'bad_channel', 'Неизвестный канал', m.ref);
      const msg = store.findMessage(ch.channel, String(m.id || ''));
      if (!msg || msg.deleted) return err(conn, 'no_message', 'Сообщение не найдено — возможно, его уже удалили', m.ref);
      if (Store.key(msg.author) !== Store.key(conn.user)) return err(conn, 'forbidden', 'Изменить можно только своё сообщение', m.ref);
      const text = String(m.text || '').trim();
      if (text.length > MAX_TEXT) return err(conn, 'too_long', `Сообщение слишком длинное (максимум ${MAX_TEXT} символов)`, m.ref);
      if (!text && !msg.image && !msg.file) return err(conn, 'empty', 'Пустое сообщение нельзя сохранить — лучше удалите его', m.ref);
      if (text === msg.text) return send(conn, { type: 'ok', ref: m.ref });
      msg.text = text;
      msg.edited = Date.now();
      for (const x of store.data.messages[ch.channel] || []) if (x.reply && x.reply.id === msg.id) x.reply = replySnapshot(msg);
      store.scheduleSave();
      send(conn, { type: 'ok', ref: m.ref });
      ch.deliver({ type: 'chat_update', msg });
    },

    // удалить своё сообщение (хост и админы сервера — любое, 1.18: раньше только хост); картинка или файл с сервера удаляются вместе с ним
    chat_delete(conn, m) {
      const ch = chatTarget(conn, m);
      if (!ch) return err(conn, 'bad_channel', 'Неизвестный канал', m.ref);
      const msg = store.findMessage(ch.channel, String(m.id || ''));
      if (!msg) return err(conn, 'no_message', 'Сообщение не найдено', m.ref);
      if (msg.deleted) return send(conn, { type: 'ok', ref: m.ref });
      const mine = Store.key(msg.author) === Store.key(conn.user);
      if (!mine && !isAdmin(conn)) return err(conn, 'forbidden', 'Удалить можно только своё сообщение', m.ref);
      for (const att of [msg.image, msg.file]) {
        if (!att || att.p2p) continue;
        const f = store.data.files[att.id];
        if (f && f.owner === Store.key(msg.author)) { fs.unlink(path.join(filesDir, att.id + '.' + f.ext), () => {}); delete store.data.files[att.id]; }
      }
      for (const k of ['text', 'image', 'file', 'reply', 'edited']) delete msg[k];
      msg.text = '';
      msg.deleted = Date.now();
      for (const x of store.data.messages[ch.channel] || []) if (x.reply && x.reply.id === msg.id) x.reply = { id: msg.id, author: x.reply.author, deleted: true };
      store.scheduleSave();
      log('info', 'server', `${conn.user} удалил сообщение ${mine ? 'своё' : 'от ' + msg.author}`);
      send(conn, { type: 'ok', ref: m.ref });
      ch.deliver({ type: 'chat_update', msg });
    },

    chat_search(conn, m) {
      const ch = chatTarget(conn, m);
      if (!ch) return err(conn, 'bad_channel', 'Неизвестный канал', m.ref);
      const q = String(m.q || '').trim().slice(0, 100);
      if (q.length < 2) return send(conn, { type: 'chat_search', ref: m.ref, results: [], total: 0 });
      send(conn, { type: 'chat_search', ref: m.ref, ...store.searchMessages(ch.channel, q, 50) });
    },

    // ---- голос ----
    voice_join(conn, m) {
      if (!VOICE_ROOMS.includes(m.room)) return err(conn, 'bad_room', 'Нет такой голосовой комнаты', m.ref);
      // один пользователь — одна голосовая сессия: выкидываем старую (другое окно/ПК)
      for (const c of connsOf(conn.user)) {
        if (c !== conn && c.voice) { leaveVoice(c, 'вход с другого окна'); send(c, { type: 'voice_kicked', reason: 'Вы подключились к голосу из другого окна' }); }
      }
      if (conn.voice) leaveVoice(conn, 'смена комнаты');
      const k = Store.key(conn.user);
      const h = holds.get(k);
      // продолжение звонка после обрыва: соединения между компьютерами живы — никому ничего не объявляем
      if (m.resume && h && h.room === m.room) {
        clearTimeout(h.timer); holds.delete(k);
        const peers = authed().filter((c) => c !== conn && c.voice && c.voice.room === m.room).map((c) => c.user)
          .concat([...holds.values()].filter((x) => x.room === m.room).map((x) => x.name));
        conn.voice = { room: m.room, muted: !!m.muted, deafened: !!m.deafened, streaming: !!h.streaming && !!m.streaming };
        send(conn, { type: 'voice_joined', room: m.room, peers, resumed: true, held: true, ref: m.ref });
        for (const q of h.queue) send(conn, q);
        log('info', 'server', `${conn.user} вернулся в «${m.room}» после обрыва — звонок не прерывался`);
        pushVoice(); pushUsers();
        return;
      }
      // место не держалось (сервер перезапускался или прошло больше минуты): заходит заново, но свою демку
      // и микрофон программа не выключает — только пересоздаёт соединения с друзьями
      if (h) dropHold(conn.user, 'зашёл заново', false);
      else if (sfu) sfu.closePeer(k, 'зашёл заново'); // соединения с размножителем от прошлого раза больше не нужны
      const peers = authed().filter((c) => c !== conn && c.voice && c.voice.room === m.room).map((c) => c.user)
        .concat([...holds.values()].filter((x) => x.room === m.room).map((x) => x.name));
      conn.voice = { room: m.room, muted: !!m.muted, deafened: !!m.deafened, streaming: !!(m.resume && m.streaming) };
      send(conn, { type: 'voice_joined', room: m.room, peers, ref: m.ref, ...(m.resume ? { resumed: true, held: false } : {}) });
      for (const c of authed()) {
        if (c !== conn && c.voice && c.voice.room === m.room) send(c, { type: 'voice_peer_joined', name: conn.user });
      }
      for (const x of holds.values()) if (x.room === m.room) x.queue.length < 400 && x.queue.push({ type: 'voice_peer_joined', name: conn.user });
      log('info', 'server', `${conn.user} зашёл в «${m.room}» (там уже: ${peers.join(', ') || 'никого'})`);
      pushVoice();
    },

    voice_leave(conn) { leaveVoice(conn); dropHold(conn.user, 'вышел'); },

    voice_state(conn, m) {
      if (!conn.voice) return;
      if ('muted' in m) conn.voice.muted = !!m.muted;
      if ('deafened' in m) conn.voice.deafened = !!m.deafened;
      if ('streaming' in m) conn.voice.streaming = !!m.streaming;
      if (sfu && 'streaming' in m && !m.streaming) sfu.closeProducers(Store.key(conn.user)); // показ закончился — его поток в размножителе тоже
      pushVoice();
    },

    signal(conn, m) {
      if (!conn.voice) return;
      const target = authed().find((c) => c.voice && c.voice.room === conn.voice.room && Store.key(c.user) === Store.key(m.to));
      const h = !target && holds.get(Store.key(m.to));
      if (h && h.room === conn.voice.room) {
        // адресат на минуту пропал с сервера — сохраним сигнал и отдадим, когда вернётся
        if (h.queue.length < 400) h.queue.push({ type: 'signal', from: conn.user, data: m.data });
        return;
      }
      if (!target) {
        log('debug', 'server', `Сигнал от ${conn.user} для ${m.to} отброшен — адресат не в комнате`);
        return;
      }
      send(target, { type: 'signal', from: conn.user, data: m.data });
    },

    // сигналы прямой передачи файлов (WebRTC) между двумя программами: сервер только пересылает
    p2p(conn, m) {
      const data = m.data;
      if (!data || typeof data !== 'object' || JSON.stringify(data).length > 32768) return;
      let targets = connsOf(String(m.to || ''));
      if (m.toConn) targets = targets.filter((c) => c.id === Number(m.toConn));
      if (!targets.length) return send(conn, { type: 'p2p', from: String(m.to || ''), fromConn: 0, data: { kind: 'offline', sid: data.sid } });
      for (const t of targets) if (t !== conn) send(t, { type: 'p2p', from: conn.user, fromConn: conn.id, data });
    },

    // 1.18: админ забирает журнал у человека в сети — его программа сама присылает файл админу в личку
    log_request(conn, m) {
      if (!isAdmin(conn)) return err(conn, 'forbidden', 'Забирать журналы может только админ сервера', m.ref);
      const name = String(m.to || '');
      if (Store.key(name) === Store.key(conn.user)) return err(conn, 'self', 'Свой журнал — кнопка «Журнал» → «В чат»', m.ref);
      const targets = connsOf(name);
      if (!targets.length) return err(conn, 'offline', `${name} сейчас не в сети`, m.ref);
      const now = Date.now();
      conn.logReqs = (conn.logReqs || []).filter((t) => now - t < 60000);
      if (conn.logReqs.length >= 6) return err(conn, 'flood', 'Слишком часто — подождите минуту', m.ref);
      conn.logReqs.push(now);
      const t = targets[targets.length - 1]; // самое свежее окно этого человека
      send(t, { type: 'log_request', from: conn.user });
      log('info', 'server', `${conn.user} забирает журнал у ${t.user}`);
      send(conn, { type: 'ok', ref: m.ref, to: t.user });
    },

    ping(conn, m) { send(conn, { type: 'pong', t: m.t }); },

    // сколько файла сервер сейчас примет (свободно на диске минус запас и идущие загрузки)
    files_space(conn, m) { send(conn, { type: 'files_space', ref: m.ref, free: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, freeSpace() - inFlight - RESERVE)) }); },

    // ---- размножитель демки (1.16): программа договаривается с mediasoup через эти запросы; ответ — { type: 'sfu', ref, data } ----
    sfu_caps(conn, m) { sfuCall(conn, m, async (who) => ({ caps: await sfu.caps(who) })); },
    sfu_transport(conn, m) { sfuCall(conn, m, (who) => sfu.createTransport(who, m.dir)); },
    sfu_connect(conn, m) { sfuCall(conn, m, async (who) => { await sfu.connect(who, m.tid, m.dtlsParameters); return {}; }); },
    sfu_produce(conn, m) { sfuCall(conn, m, async (who) => ({ id: await sfu.produce(who, m.tid, m.kind, m.rtpParameters, m.appData, !!(conn.voice && conn.voice.streaming)) })); },
    sfu_consume(conn, m) { sfuCall(conn, m, (who) => sfu.consume(who, m.tid, m.producerId, m.rtpCapabilities)); },
    sfu_resume(conn, m) { sfuCall(conn, m, async (who) => { await sfu.resume(who, m.id); return {}; }); },
    sfu_keyframe(conn, m) { sfuCall(conn, m, async (who) => { await sfu.keyframe(who, m.id); return {}; }); },
    sfu_pause(conn, m) { sfuCall(conn, m, async (who) => { await sfu.pauseProducer(who, m.id, !!m.paused); return {}; }); },
    sfu_close(conn, m) {
      sfuCall(conn, m, async (who) => {
        if (m.producer) sfu.closeProducer(who, m.producer);
        if (m.consumer) sfu.closeConsumer(who, m.consumer);
        return {};
      });
    },
    sfu_stats(conn, m) { sfuCall(conn, m, async (who) => ({ list: await sfu.stats(who) })); },
  };

  // запрос к размножителю: только у тех, кто в голосовой комнате; ошибки mediasoup — понятной ошибкой с тем же ref
  function sfuCall(conn, m, fn) {
    if (!sfu) return err(conn, 'no_sfu', 'Этот сервер не умеет раздавать демку (нет размножителя)', m.ref);
    if (!conn.voice) return err(conn, 'not_in_voice', 'Сначала зайдите в голосовую комнату', m.ref);
    const now = Date.now();
    conn.sfuTimes = (conn.sfuTimes || []).filter((t) => now - t < 10000);
    if (conn.sfuTimes.length >= 60) return err(conn, 'flood', 'Слишком много запросов к размножителю', m.ref);
    conn.sfuTimes.push(now);
    const who = { key: Store.key(conn.user), name: conn.user, room: conn.voice.room };
    Promise.resolve().then(() => fn(who)).then(
      (data) => send(conn, { type: 'sfu', ref: m.ref, data: data || {} }),
      (e) => { if (!e.code) log('warn', 'sfu', `${conn.user}: ${m.type} — ${e.message}`); err(conn, e.code || 'sfu', e.message, m.ref); },
    );
  }
  if (sfu) {
    // размножитель упал или поднялся — сообщаем всем: программы переходят на «напрямую» и обратно
    sfu.onState((on) => broadcast({ type: 'sfu_state', on }));
    sfu.notify = (key, msg) => { for (const c of authed()) if (Store.key(c.user) === key) send(c, msg); };
  }

  const PUBLIC = new Set(['hello', 'register', 'login', 'resume', 'ping']);
  const NEEDS_SERVER_PASSWORD = new Set(['register', 'login', 'resume']);
  const perIp = new Map();

  wss.on('connection', (ws, req) => {
    const conn = { id: nextConnId++, ws, user: null, voice: null, alive: true, addr: (req.socket.remoteAddress || '?').replace('::ffff:', ''), passOk: !password, chatTimes: [] };
    // не больше N соединений с одного адреса — защита от флуда в открытом интернете
    const n = (perIp.get(conn.addr) || 0) + 1;
    if (n > maxConnPerIp) { log('warn', 'server', `Слишком много подключений с ${conn.addr} — отклонено`); ws.close(1008, 'too many connections'); return; }
    perIp.set(conn.addr, n);
    clients.add(conn);
    log('debug', 'server', `Новое подключение #${conn.id} с ${conn.addr}`);

    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (_) { return log('warn', 'server', `Битое сообщение от ${conn.addr}`); }
      const h = handlers[m.type];
      if (!h) return err(conn, 'unknown', `Неизвестная команда: ${m.type}`, m.ref);
      if (!PUBLIC.has(m.type) && !conn.user) return err(conn, 'auth', 'Сначала войдите в аккаунт', m.ref);
      if (NEEDS_SERVER_PASSWORD.has(m.type) && !conn.passOk) return err(conn, 'server_password', 'Нужен пароль сервера', m.ref);
      if (m.type === 'chat_send' || m.type === 'chat_edit' || m.type === 'chat_delete') {
        const now = Date.now();
        conn.chatTimes = conn.chatTimes.filter((t) => now - t < 5000);
        if (conn.chatTimes.length >= 8) return err(conn, 'flood', 'Слишком часто — подождите пару секунд', m.ref);
        conn.chatTimes.push(now);
      }
      try { h(conn, m); } catch (e) {
        log('error', 'server', `Ошибка обработки «${m.type}» от ${conn.user || conn.addr}: ${e.stack || e.message}`);
        err(conn, 'internal', 'Внутренняя ошибка сервера (подробности в логе хоста)', m.ref);
      }
    });
    ws.on('close', (code) => {
      clients.delete(conn);
      const left = (perIp.get(conn.addr) || 1) - 1;
      if (left > 0) perIp.set(conn.addr, left); else perIp.delete(conn.addr);
      if (conn.user) {
        // 1000/1001/1005 — человек сам вышел или закрыл программу; иначе связь оборвалась — место в комнате держим
        if (conn.voice && ![1000, 1001, 1005].includes(code) && !closing) holdVoice(conn);
        else leaveVoice(conn, 'отключился');
        log('info', 'server', `${conn.user} отключился (код ${code})`);
        if (!isOnline(conn.user)) {
          pushUsers();
          const u = store.getUser(conn.user);
          if (u) { u.lastSeen = Date.now(); store.scheduleSave(); }
        }
      }
    });
    ws.on('error', (e) => log('warn', 'server', `Ошибка соединения с ${conn.user || conn.addr}: ${e.message}`));
  });

  // проверка «живости» соединений — отваливает зависших (например, при обрыве Radmin)
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { log('warn', 'server', `${c.user || c.addr} не отвечает 30 с — отключаю`); c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch (_) { /* ignore */ }
    }
  }, 15000);

  return new Promise((resolve, reject) => {
    const onError = (e) => {
      clearInterval(heartbeat);
      reject(e);
    };
    httpServer.once('error', onError);
    httpServer.listen(port, host, () => {
      httpServer.off('error', onError);
      httpServer.on('error', (e) => log('error', 'server', `Ошибка сервера: ${e.message}`));
      log('info', 'server', `Сервер запущен на ${host}:${port}${tls ? ' (шифрование TLS)' : ''}${password ? ', вход по паролю' : ''}${turn && turn.secret ? ', ретранслятор подключён' : ''}`);
      resolve({
        port,
        rooms: VOICE_ROOMS,
        stats: () => ({ connections: clients.size, online: new Set(authed().map((c) => Store.key(c.user))).size }),
        close: () => new Promise((res) => {
          clearInterval(heartbeat); clearInterval(sweepTimer);
          closing = true; for (const h of holds.values()) clearTimeout(h.timer); holds.clear();
          for (const c of clients) { try { c.ws.close(1001, 'host shutdown'); } catch (_) { /* ignore */ } }
          store.flush();
          wss.close();
          httpServer.close(() => res());
          setTimeout(res, 1500);
          log('info', 'server', 'Сервер остановлен');
        }),
      });
    });
  });
}

module.exports = { createServer, turnCredentials, PROTOCOL_VERSION, VOICE_ROOMS };
