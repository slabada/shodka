'use strict';
// Хранилище данных хоста: пользователи, друзья, сообщения, токены входа.
// Простой JSON-файл с атомарной записью (tmp + rename) и отложенным сохранением.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MESSAGES_PER_CHANNEL = 3000;

// Словари без прототипа: ключ «__proto__» или «constructor» из сети — просто ключ, а не внутренности JS
const dict = (o) => Object.assign(Object.create(null), o || {});
const MAPS = ['users', 'tokens', 'messages', 'files'];
function emptyData() {
  return { version: 1, users: dict(), tokens: dict(), messages: dict(), files: dict() };
}

class Store {
  constructor(dataDir, log) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'server-data.json');
    this.log = log;
    this.data = emptyData();
    this.saveTimer = null;
    this.load();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const bak = this.file + '.bak';
    // 1.17.3: файл, который не удалось ПРОЧИТАТЬ (занят антивирусом, нет прав), — не «повреждённая база».
    // Раньше сервер в этом случае начинал с пустой и при первом же сохранении затирал настоящую (аккаунты, чат).
    // Теперь ждём и пробуем снова, а не вышло — не запускаемся: лучше сервер не поднимется, чем всё потеряется.
    const read = (f) => {
      for (let i = 0; ; i++) {
        try { return fs.readFileSync(f, 'utf8'); } catch (e) {
          if (e.code === 'ENOENT') return null;
          if (i >= 4) {
            const err = new Error(`файл базы ${f} не читается (${e.code || e.message}) — сервер не запущен, чтобы не затереть базу. Проверьте права на папку и антивирус`);
            err.code = 'DB_UNREADABLE'; throw err;
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); // полсекунды и ещё раз
        }
      }
    };
    const parse = (raw) => { try { const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch (_) { return null; } };
    const raw = read(this.file);
    let parsed = raw != null ? parse(raw) : null;
    const fromMain = !!parsed;
    if (!parsed) {
      const rawBak = read(bak);
      if (raw == null && rawBak == null) { this.log('info', 'server', `Новая база данных сервера: ${this.file}`); return; }
      // основной файл повреждён (обрыв питания посреди записи) или пропал — берём последнюю целую копию
      let broken = '';
      if (raw != null) { broken = `${this.file}.broken-${Date.now()}`; try { fs.copyFileSync(this.file, broken); } catch (_) { broken = ''; } }
      parsed = rawBak != null ? parse(rawBak) : null;
      this.lastBak = Date.now(); // повреждённый основной файл не должен через минуту перезаписать целую копию
      if (parsed) this.log('warn', 'server', `База ${raw != null ? 'повреждена' : 'не найдена'} — восстановлена из резервной копии ${bak} (изменения за последнюю минуту могли пропасть)${broken ? `. Повреждённая сохранена в ${broken}` : ''}`);
      else {
        this.log('error', 'server', `Не удалось прочитать базу: файл повреждён, резервной копии нет${broken ? `. Копия сохранена в ${broken}` : ''}, создана новая база.`);
        return;
      }
    }
    this.data = Object.assign(emptyData(), parsed);
    for (const k of MAPS) this.data[k] = dict(parsed[k]);
    const users = Object.keys(this.data.users).length;
    this.log('info', 'server', `База загружена: ${users} польз., файл ${this.file}`);
    // прочитанная целиком база — она же свежая резервная копия
    if (fromMain) { try { fs.copyFileSync(this.file, bak); this.lastBak = Date.now(); } catch (_) { /* ignore */ } }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, 800);
  }

  saveNow() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      // 1.17.3: не чаще раза в минуту прежняя (целая) база становится резервной копией — на случай, если основной файл испортится
      if (Date.now() - (this.lastBak || 0) > 60000 && fs.existsSync(this.file)) {
        try { fs.copyFileSync(this.file, this.file + '.bak'); this.lastBak = Date.now(); } catch (_) { /* ignore */ }
      }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log('error', 'server', `Не удалось сохранить базу: ${e.message} (диск заполнен или нет прав на папку ${this.dir})`);
    }
  }

  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.saveNow();
  }

  // ---------- пользователи ----------
  static key(name) { return String(name || '').trim().toLowerCase(); }

  getUser(name) { return this.data.users[Store.key(name)] || null; }

  allUsers() { return Object.values(this.data.users); }

  createUser(name, password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const user = { name, salt, hash, kid: Store.fingerprint(password), created: Date.now(), friends: [], incoming: [], outgoing: [] };
    this.data.users[Store.key(name)] = user;
    this.scheduleSave();
    return user;
  }

  setPassword(user, password) {
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
    user.kid = Store.fingerprint(password);
    this.scheduleSave();
  }

  checkPassword(user, password) {
    const hash = crypto.scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.hash, 'hex');
    return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
  }

  // ---------- ключ устройства ----------
  // Вход только по нику: вместо пароля — секретный ключ компьютера. Отпечаток ключа (sha256) храним,
  // чтобы быстро находить старые ники того же человека (он мог раньше войти под другим ником).
  static fingerprint(key) { return crypto.createHash('sha256').update(String(key)).digest('hex'); }

  // ---------- несколько компьютеров и пароль аккаунта ----------
  // Основной ключ (hash/kid) — компьютер, с которого аккаунт создан. Остальные компьютеры, где человек
  // вошёл по паролю аккаунта, — в kids (отпечатки их ключей). Ключ устройства — 256 случайных бит,
  // поэтому отпечатка sha256 достаточно, перебрать его нельзя.
  isPrimaryKey(user, key) {
    if (!user || !user.hash) return false;
    const kid = Store.fingerprint(key);
    if (user.kid) return user.kid === kid;
    try { if (this.checkPassword(user, key)) { user.kid = kid; this.scheduleSave(); return true; } } catch (_) { /* ignore */ }
    return false;
  }

  deviceKnown(user, key) {
    if (!user || String(key || '').length < 4) return false;
    if (user.kids && user.kids.includes(Store.fingerprint(key))) return true;
    return this.isPrimaryKey(user, key);
  }

  addDevice(user, key) {
    if (!user.hash) return this.setPassword(user, key); // освобождённый ник: этот компьютер становится основным
    if (this.deviceKnown(user, key)) return;
    user.kids = [...(user.kids || []), Store.fingerprint(key)].slice(-10);
    this.scheduleSave();
  }

  // «Выйти из аккаунта»: чужой компьютер забываем всегда, свой основной — только если есть пароль
  // (без пароля человек не смог бы войти обратно)
  forgetDevice(user, key) {
    if (!user) return false;
    const kid = Store.fingerprint(key);
    if (user.kids && user.kids.includes(kid)) { user.kids = user.kids.filter((k) => k !== kid); this.scheduleSave(); return true; }
    if (user.pw && this.isPrimaryKey(user, key)) { user.salt = ''; user.hash = ''; delete user.kid; this.scheduleSave(); return true; }
    return false;
  }

  setAccountPassword(user, password) {
    const salt = crypto.randomBytes(16).toString('hex');
    user.pw = { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
    this.scheduleSave();
  }

  checkAccountPassword(user, password) {
    if (!user || !user.pw || !password) return false;
    const hash = crypto.scryptSync(String(password), user.pw.salt, 64);
    const expected = Buffer.from(user.pw.hash, 'hex');
    return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
  }

  // хост «освобождает» ник: ни один компьютер и пароль больше не подходят, первый вошедший с этим ником
  // забирает аккаунт вместе с перепиской (на случай, если человек потерял и пароль, и папку программы)
  releaseUser(user) {
    user.salt = ''; user.hash = ''; delete user.kid; delete user.kids; delete user.pw;
    for (const [t, v] of Object.entries(this.data.tokens)) if (v.user === Store.key(user.name)) delete this.data.tokens[t];
    this.scheduleSave();
  }

  // ---------- переименование и объединение ----------
  // Все ссылки на пользователя: друзья/заявки у других, токены, авторы сообщений, ключи личных переписок.
  _replaceRefs(oldKey, newKey) {
    for (const u of Object.values(this.data.users)) {
      for (const f of ['friends', 'incoming', 'outgoing']) {
        if (!u[f].includes(oldKey)) continue;
        u[f] = [...new Set(u[f].map((x) => (x === oldKey ? newKey : x)))].filter((x) => x !== Store.key(u.name));
      }
    }
    for (const t of Object.values(this.data.tokens)) if (t.user === oldKey) t.user = newKey;
    for (const f of Object.values(this.data.files || {})) if (f.owner === oldKey) f.owner = newKey;
  }

  _renameInMessages(oldKey, newName) {
    const newKey = Store.key(newName);
    const msgs = this.data.messages;
    for (const list of Object.values(msgs)) {
      for (const m of list) {
        if (Store.key(m.author) === oldKey) m.author = newName;
        if (m.to && Store.key(m.to) === oldKey) m.to = newName;
        if (m.reply && m.reply.author && Store.key(m.reply.author) === oldKey) m.reply.author = newName;
      }
    }
    for (const ch of Object.keys(msgs)) {
      if (!ch.startsWith('dm:')) continue;
      const parts = ch.slice(3).split('|');
      if (!parts.includes(oldKey)) continue;
      const next = 'dm:' + parts.map((x) => (x === oldKey ? newKey : x)).sort().join('|');
      const list = msgs[ch]; delete msgs[ch];
      for (const m of list) m.channel = next;
      // два разных человека стали одним (объединение) — их переписку друг с другом некуда деть;
      // а заметки «сам себе» (a|a → b|b) переезжают как обычно
      if (parts[0] !== parts[1] && next === 'dm:' + newKey + '|' + newKey) continue;
      msgs[next] = msgs[next] ? [...msgs[next], ...list].sort((a, b) => a.ts - b.ts).slice(-MAX_MESSAGES_PER_CHANNEL) : list;
    }
  }

  renameUser(oldName, newName) {
    const oldKey = Store.key(oldName), newKey = Store.key(newName);
    const user = this.data.users[oldKey];
    if (!user) return null;
    const prev = user.name;
    if (oldKey !== newKey) {
      delete this.data.users[oldKey];
      this.data.users[newKey] = user;
      this._replaceRefs(oldKey, newKey);
    }
    user.name = newName;
    user.prevNames = [...new Set([...(user.prevNames || []), prev])].filter((n) => n !== newName).slice(-10);
    this._renameInMessages(oldKey, newName);
    this.scheduleSave();
    return user;
  }



  deleteUser(name) {
    const k = Store.key(name);
    if (!this.data.users[k]) return false;
    delete this.data.users[k];
    for (const u of Object.values(this.data.users)) for (const f of ['friends', 'incoming', 'outgoing']) u[f] = u[f].filter((x) => x !== k);
    for (const [t, v] of Object.entries(this.data.tokens)) if (v.user === k) delete this.data.tokens[t];
    Store.archiveDms(this.data, k);
    this.scheduleSave();
    return true;
  }

  // Личные переписки удалённого ника убираем в архив (в базе остаются, но открыть их нельзя):
  // иначе тот, кто потом займёт этот ник, прочитал бы чужую переписку и получил бы чужие файлы.
  static archiveDms(data, k) {
    const stamp = Date.now();
    for (const ch of Object.keys(data.messages)) {
      if (!ch.startsWith('dm:') || !ch.slice(3).split('|').includes(k)) continue;
      data.messages[`deleted:${stamp}:${ch.slice(3)}`] = data.messages[ch];
      delete data.messages[ch];
    }
    for (const f of Object.values(data.files || {})) if (f.owner === k) f.owner = '';
  }

  // ---------- токены ----------
  issueToken(user) {
    const token = crypto.randomBytes(32).toString('hex');
    this.data.tokens[token] = { user: Store.key(user.name), created: Date.now() };
    this.scheduleSave();
    return token;
  }

  userByToken(token) {
    const t = this.data.tokens[token];
    if (!t) return null;
    return this.data.users[t.user] || null;
  }

  revokeToken(token) { delete this.data.tokens[token]; this.scheduleSave(); }

  // ---------- сообщения ----------
  addMessage(channel, msg) {
    if (!this.data.messages[channel]) this.data.messages[channel] = [];
    const list = this.data.messages[channel];
    list.push(msg);
    if (list.length > MAX_MESSAGES_PER_CHANNEL) list.splice(0, list.length - MAX_MESSAGES_PER_CHANNEL);
    this.scheduleSave();
  }

  findMessage(channel, id) {
    const list = this.data.messages[channel] || [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) return list[i];
    return null;
  }

  // поиск по тексту и именам файлов, без учёта регистра и ё/е; новые — первыми
  searchMessages(channel, query, limit = 50) {
    const norm = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е');
    const q = norm(query).trim();
    const list = this.data.messages[channel] || [];
    const out = [];
    let total = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.deleted) continue;
      const hay = norm(m.text) + (m.file ? '\n' + norm(m.file.name) : '');
      if (!hay.includes(q)) continue;
      total++;
      if (out.length < limit) out.push(m);
    }
    return { results: out, total };
  }

  history(channel, beforeId, limit = 80) {
    const list = this.data.messages[channel] || [];
    let end = list.length;
    if (beforeId) {
      const idx = list.findIndex((m) => m.id === beforeId);
      // такого сообщения уже нет (старые вытеснены лимитом) — дальше листать некуда, а не «сначала»
      if (idx < 0) return { messages: [], hasMore: false };
      end = idx;
    }
    const start = Math.max(0, end - limit);
    return { messages: list.slice(start, end), hasMore: start > 0 };
  }
}

module.exports = { Store };
