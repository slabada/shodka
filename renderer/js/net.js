// Подключение к серверу хоста по WebSocket: запросы с ответами, автопереподключение, пинг.
import { log } from './log.js';

const api = window.api;

export class Connection {
  constructor(host, port, { secure = false, password = '', hostKey = '' } = {}) {
    this.hostKey = hostKey; // секрет хоста: свой встроенный сервер узнаёт хоста по нему, а не по адресу 127.0.0.1
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.password = password;
    this.helloInfo = null;
    this.ws = null;
    this.handlers = new Map();
    this.pending = new Map();
    this.ref = 1;
    this.closedByUser = false;
    this.retry = 0;
    this.lastPong = 0;
    this.rtt = null;
    this.pingTimer = null;
  }

  on(type, cb) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(cb);
    return () => this.handlers.get(type).delete(cb);
  }

  emit(type, data) { for (const cb of this.handlers.get(type) || []) { try { cb(data); } catch (e) { log.error('ui', `Ошибка в обработчике «${type}»: ${e.message}`, { err: e }); } } }

  get url() { return `${this.secure ? 'wss' : 'ws'}://${this.host.includes(':') ? '[' + this.host + ']' : this.host}:${this.port}`; }

  // Первое подключение: при ошибке выясняем точную причину через TCP-проверку в главном процессе.
  async connect() {
    this.closedByUser = false;
    try {
      await this.open();
      return this.helloInfo;
    } catch (_) {
      const cs = this.secure ? await api.certStatus(this.host) : null;
      if (cs === 'rejected') { const e = new Error('Вы не подтвердили сертификат сервера'); e.hint = 'Подключитесь снова и нажмите «Доверять», если отпечаток совпадает с тем, что показывает сервер.'; e.code = 'cert'; throw e; }
      if (cs === 'mismatch') { const e = new Error('Сертификат сервера изменился — соединение заблокировано'); e.hint = 'Если сервер переустанавливали, нажмите «Забыть сервер» и подключитесь заново. Подробности в журнале.'; e.code = 'cert_mismatch'; throw e; }
      const t = await api.netTest(this.host, this.port);
      if (t.ok) {
        const e = new Error('Порт открыт, но это не сервер «Сходки» или соединение сброшено');
        e.hint = 'Проверьте номер порта. Возможно, на этом порту работает другая программа.';
        throw e;
      }
      const e = new Error(t.msg || 'Не удалось подключиться');
      e.hint = t.hint; e.code = t.code;
      throw e;
    }
  }

  open() {
    return new Promise((resolve, reject) => {
      let opened = false;
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      this.ws = ws;
      // пока человек читает окно «Новый сервер» и сверяет отпечаток — не обрываем попытку
      let timer;
      const arm = (ms) => { timer = setTimeout(async () => {
        if (opened) return;
        if (this.secure && (await api.certStatus(this.host)) === 'pending') { arm(3000); return; }
        ws.close(); reject(new Error('timeout'));
      }, ms); };
      arm(7000);
      ws.onopen = () => {
        opened = true; clearTimeout(timer);
        this.retry = 0;
        this.lastPong = Date.now();
        this.startPing();
        log.info('ws', `Соединение с сервером ${this.host}:${this.port} установлено${this.secure ? ' (зашифровано)' : ''}`);
        this.waitHello().then((h) => { this.helloInfo = h; resolve(); });
        this.send({ type: 'hello', v: 1, password: this.password, ...(this.hostKey ? { hostKey: this.hostKey } : {}) });
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (_) { log.warn('ws', 'Сервер прислал непонятные данные'); return; }
        if (m.type === 'pong') { this.lastPong = Date.now(); this.rtt = Date.now() - m.t; this.emit('rtt', this.rtt); return; }
        if (m.type === 'hello') { this.helloInfo = m; if (this.onHello) { const f = this.onHello; this.onHello = null; f(m); } }
        if (m.ref && this.pending.has(m.ref)) {
          const p = this.pending.get(m.ref);
          this.pending.delete(m.ref);
          clearTimeout(p.timer);
          if (m.type === 'error') { const e = new Error(m.message); e.code = m.code; p.reject(e); } else p.resolve(m);
          if (m.type !== 'auth_ok' && m.type !== 'voice_joined' && m.type !== 'hello') return;
        } else if (m.type === 'error') {
          log.warn('ws', `Сервер: ${m.message}`);
        }
        this.emit(m.type, m);
      };
      ws.onerror = () => { /* подробности придут в onclose / через netTest */ };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (this.ws !== ws) return; // это соединение мы уже бросили сами (сервер не отвечал)
        if (!opened) { this.failPending(); reject(new Error('closed')); return; }
        this.lost(ev.code);
      };
    });
  }

  // связь потеряна: отклоняем ожидающие запросы, сообщаем и переподключаемся
  failPending() {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Соединение с сервером потеряно')); }
    this.pending.clear();
  }

  lost(code) {
    this.stopPing();
    this.failPending();
    if (this.closedByUser) return;
    const reason = code === 1001 ? 'хост остановил сервер или закрыл программу' : code === 1006 || code === 4000 ? 'связь оборвалась (интернет или Radmin VPN?)' : `код ${code}`;
    log.warn('ws', `Связь с сервером потеряна: ${reason}. Переподключаюсь…`);
    this.emit('disconnected', { code, reason });
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      if (this.closedByUser) return;
      try {
        await this.open();
        log.info('ws', 'Переподключение удалось');
        this.emit('reconnected');
      } catch (_) {
        if (this.retry === 3) {
          const t = await api.netTest(this.host, this.port);
          if (!t.ok) log.error('ws', `Сервер недоступен: ${t.msg}`, { hint: t.hint });
        }
        this.emit('reconnecting', { attempt: this.retry, delay: Math.min(15000, 1000 * 2 ** this.retry) });
        this.scheduleReconnect();
      }
    }, delay);
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > 15000 && this.ws && this.ws.readyState === 1) {
        log.warn('ws', 'Сервер не отвечает 15 секунд — переподключаюсь');
        // не ждём, пока Chromium дождётся закрытия мёртвого соединения (до минуты): бросаем его и переподключаемся сразу
        const ws = this.ws; this.ws = null; ws.onmessage = null;
        try { ws.close(4000, 'stale'); } catch (_) { /* ignore */ } // 4000 — сервер поймёт, что это обрыв, а не выход, и подержит место в комнате
        this.lost(1006);
        return;
      }
      this.send({ type: 'ping', t: Date.now() });
    }, 4000);
  }

  stopPing() { clearInterval(this.pingTimer); this.pingTimer = null; }

  // ответ на hello (старые серверы отвечают без номера запроса — ждём любой hello)
  waitHello(ms = 8000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.onHello = null; resolve({ needPassword: false, passwordOk: true }); }, ms);
      this.onHello = (m) => { clearTimeout(t); resolve(m); };
    });
  }

  async setPassword(password) {
    this.password = password;
    const p = this.waitHello();
    this.send({ type: 'hello', v: 1, password, ...(this.hostKey ? { hostKey: this.hostKey } : {}) });
    return p;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  request(msg, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ref = this.ref++;
      const timer = setTimeout(() => { this.pending.delete(ref); reject(new Error('Сервер не ответил вовремя')); }, timeoutMs);
      this.pending.set(ref, { resolve, reject, timer });
      if (!this.send({ ...msg, ref })) { clearTimeout(timer); this.pending.delete(ref); reject(new Error('Нет соединения с сервером')); }
    });
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    if (this.ws) try { this.ws.close(1000); } catch (_) { /* ignore */ }
  }
}
