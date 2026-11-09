// Лог ошибок и событий: хранение, перевод ошибок на понятный язык, панель внизу окна.
const api = window.api;
const MAX = 3000;
const entries = [];
const listeners = new Set();
let verbose = false;

export function setVerbose(v) { verbose = !!v; }

function push(e) {
  if (e.level === 'debug' && !verbose) return;
  entries.push(e);
  if (entries.length > MAX) entries.shift();
  for (const l of listeners) { try { l(e); } catch (_) { /* ignore */ } }
}

function fmtErr(err) {
  if (!err) return undefined;
  if (typeof err === 'string') return err;
  return `${err.name || 'Error'}: ${err.message || ''}${err.constraint ? ' (ограничение: ' + err.constraint + ')' : ''}${err.stack ? '\n' + err.stack.split('\n').slice(1, 6).join('\n') : ''}`;
}

function add(level, cat, msg, extra = {}) {
  const e = { ts: Date.now(), level, cat, msg: String(msg), hint: extra.hint, details: extra.details || fmtErr(extra.err), src: 'ui' };
  push(e);
  if (level !== 'debug' || verbose) { try { api.logWrite(e); } catch (_) { /* ignore */ } }
  if (level === 'error') console.error(`[${cat}] ${msg}`, extra.err || '');
  return e;
}

export const log = {
  debug: (cat, msg, extra) => add('debug', cat, msg, extra),
  info: (cat, msg, extra) => add('info', cat, msg, extra),
  warn: (cat, msg, extra) => add('warn', cat, msg, extra),
  error: (cat, msg, extra) => add('error', cat, msg, extra),
};

export function onLog(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function allEntries() { return entries.slice(); }

// записи главного процесса (сервер, захват экрана, сеть)
api.onLog((e) => push(e));
api.logRecent().then((list) => { for (const e of list) push(e); });

// ---------- перевод ошибок ----------
const MIC_PRIVACY = 'Windows: Пуск → Параметры → Конфиденциальность и защита → Микрофон → включите «Доступ к микрофону» и «Разрешить классическим приложениям доступ к микрофону».';

export function explain(err, ctx) {
  const name = err && err.name;
  if (ctx === 'mic') {
    switch (name) {
      case 'NotAllowedError': return { msg: 'Доступ к микрофону запрещён системой', hint: MIC_PRIVACY };
      case 'NotFoundError': return { msg: 'Микрофон не найден', hint: 'Подключите микрофон и выберите его в Настройки → Микрофон. Проверьте, что он не отключён в «Параметры звука» Windows.' };
      case 'NotReadableError': case 'AbortError': return { msg: 'Микрофон занят другой программой или драйвер не отвечает', hint: 'Закройте программы, которые могут держать микрофон (Discord, OBS, игры). В Windows: Панель звука → Запись → Свойства микрофона → Дополнительно → снимите галочки «монопольный режим». Переподключите устройство.' };
      case 'OverconstrainedError': return { msg: 'Выбранный микрофон отключён или недоступен', hint: 'Выберите другое устройство в настройках — пока используется микрофон по умолчанию.' };
      case 'SecurityError': return { msg: 'Доступ к микрофону заблокирован политикой безопасности', hint: MIC_PRIVACY };
      default: break;
    }
  }
  if (ctx === 'screen') {
    switch (name) {
      case 'NotAllowedError': return { msg: 'Демонстрация отменена или запрещена системой', hint: 'Выберите источник ещё раз. macOS: разрешите запись экрана в системных настройках.' };
      case 'NotReadableError': case 'AbortError': return { msg: 'Не удалось захватить экран/окно', hint: 'Если это игра в «эксклюзивном полноэкранном» режиме — переключите её в «Без рамки» или «Оконный». Защищённое видео (Netflix и т.п.) захватить нельзя. Обновите видеодрайвер.' };
      case 'NotFoundError': return { msg: 'Источник для демонстрации не найден', hint: 'Окно закрыто или монитор отключён — выберите заново.' };
      case 'OverconstrainedError': return { msg: 'Экран не поддерживает выбранные разрешение/FPS', hint: 'Выберите в настройках демонстрации другое разрешение (например, «Исходное») или 30 FPS.' };
      default: break;
    }
  }
  if (ctx === 'output') {
    return { msg: 'Не удалось переключить устройство вывода звука', hint: 'Устройство отключено. Выберите другое в Настройки → Звук.' };
  }
  return { msg: (err && err.message) || String(err), hint: undefined };
}

// ---------- панель лога ----------
const LEVEL_RU = { debug: 'отладка', info: 'инфо', warn: 'внимание', error: 'ошибка' };
const CAT_RU = { main: 'приложение', server: 'сервер', host: 'хост', net: 'сеть', ws: 'связь', mic: 'микрофон', audio: 'звук', rtc: 'соединение', screen: 'демонстрация', ptt: 'рация', chat: 'чат', ui: 'интерфейс', diag: 'диагностика', app: 'приложение' };

export function entryToText(e) {
  const t = new Date(e.ts).toLocaleTimeString('ru-RU');
  let s = `${t} [${LEVEL_RU[e.level] || e.level}] [${CAT_RU[e.cat] || e.cat}] ${e.msg}`;
  if (e.hint) s += `\n   → ${e.hint}`;
  if (e.details) s += `\n   ${e.details.split('\n').join('\n   ')}`;
  return s;
}

export function mountLogPanel({ panel, list, badge, filterEl, searchEl, onError }) {
  let filter = 'all';
  let search = '';
  let unseenErrors = 0;

  const matches = (e) => {
    if (filter === 'errors' && e.level !== 'error') return false;
    if (filter === 'warn' && e.level !== 'error' && e.level !== 'warn') return false;
    if (search && !(e.msg + ' ' + (e.hint || '') + ' ' + (e.details || '')).toLowerCase().includes(search)) return false;
    return true;
  };

  const row = (e) => {
    const div = document.createElement('div');
    div.className = `log-row lvl-${e.level}`;
    const head = document.createElement('div');
    head.className = 'log-head';
    const time = document.createElement('span'); time.className = 'log-time'; time.textContent = new Date(e.ts).toLocaleTimeString('ru-RU');
    const lvl = document.createElement('span'); lvl.className = 'log-lvl'; lvl.textContent = LEVEL_RU[e.level] || e.level;
    const cat = document.createElement('span'); cat.className = 'log-cat'; cat.textContent = CAT_RU[e.cat] || e.cat;
    const msg = document.createElement('span'); msg.className = 'log-msg'; msg.textContent = e.msg;
    head.append(time, lvl, cat, msg);
    div.append(head);
    if (e.hint) { const h = document.createElement('div'); h.className = 'log-hint'; h.textContent = '→ ' + e.hint; div.append(h); }
    if (e.details) {
      const d = document.createElement('details'); const s = document.createElement('summary'); s.textContent = 'подробности';
      const pre = document.createElement('pre'); pre.textContent = e.details; d.append(s, pre); div.append(d);
    }
    return div;
  };

  const render = () => {
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const e of entries) if (matches(e)) frag.append(row(e));
    list.append(frag);
    list.scrollTop = list.scrollHeight;
  };

  const updateBadge = () => {
    badge.textContent = unseenErrors ? String(unseenErrors) : '';
    badge.hidden = !unseenErrors;
  };

  onLog((e) => {
    if (e.level === 'error') {
      if (panel.hidden) { unseenErrors++; updateBadge(); }
      if (onError) onError(e);
    }
    if (!panel.hidden && matches(e)) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.append(row(e));
      while (list.childElementCount > 1500) list.firstChild.remove();
      if (atBottom) list.scrollTop = list.scrollHeight;
    }
  });

  filterEl.addEventListener('change', () => { filter = filterEl.value; render(); });
  searchEl.addEventListener('input', () => { search = searchEl.value.trim().toLowerCase(); render(); });

  return {
    show() { panel.hidden = false; unseenErrors = 0; updateBadge(); render(); },
    hide() { panel.hidden = true; },
    toggle() { if (panel.hidden) this.show(); else this.hide(); },
    text: () => entries.filter(matches).map(entryToText).join('\n'),
    clear() { entries.length = 0; render(); },
    filterErrors() { filterEl.value = 'errors'; filter = 'errors'; this.show(); },
  };
}

// ---------- глобальные ловушки ----------
window.addEventListener('error', (ev) => {
  // ошибки загрузки ресурсов приходят без ev.error
  if (ev.error) log.error('ui', `Ошибка в программе: ${ev.message}`, { err: ev.error, hint: 'Это баг. Сохраните лог и пришлите разработчику.' });
  else if (ev.target && ev.target !== window) log.warn('ui', `Не загрузился ресурс: ${ev.target.src || ev.target.href || ev.target.tagName}`);
}, true);
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  log.error('ui', `Необработанная ошибка: ${(r && r.message) || r}`, { err: r, hint: 'Это баг. Сохраните лог и пришлите разработчику.' });
});
