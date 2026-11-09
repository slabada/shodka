'use strict';
// Встроенный ретранслятор (TURN, RFC 8656) — через него идут голос, демки и прямые файлы,
// когда сервер велит программам соединяться «только через сервер». Нужен там, где coturn не поставить
// (сервер на Windows). Умеет ровно то, чем пользуется WebRTC в Chromium/Electron:
//   Binding, Allocate, Refresh, CreatePermission, ChannelBind, Send/Data, ChannelData;
//   клиент подключается по UDP или TCP, сам ретранслятор — UDP.
// Вход — временные учётки «общий секрет» (как coturn use-auth-secret): username = «срок:ник»,
// пароль = base64(HMAC-SHA1(секрет, username)). Их выдаёт сервер «Сходки» при входе.
// Пакеты между двумя ретрансляторами этого же сервера передаются внутри программы, без сети.
const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');

const MAGIC = 0x2112a442;
const METHOD = { BINDING: 0x001, ALLOCATE: 0x003, REFRESH: 0x004, SEND: 0x006, DATA: 0x007, CREATE_PERMISSION: 0x008, CHANNEL_BIND: 0x009 };
const CLS = { REQUEST: 0, INDICATION: 1, SUCCESS: 2, ERROR: 3 };
const ATTR = {
  MAPPED_ADDRESS: 0x0001, USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, CHANNEL_NUMBER: 0x000c,
  LIFETIME: 0x000d, XOR_PEER_ADDRESS: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019, XOR_MAPPED_ADDRESS: 0x0020, SOFTWARE: 0x8022, FINGERPRINT: 0x8028,
};
const ERR_TEXT = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 437: 'Allocation Mismatch', 438: 'Stale Nonce', 441: 'Wrong Credentials', 442: 'Unsupported Transport Protocol', 443: 'Peer Address Family Mismatch', 486: 'Allocation Quota Reached', 508: 'Insufficient Capacity' };
const PERMISSION_MS = 300e3;     // разрешение на адрес собеседника живёт 5 минут (клиент обновляет)
const CHANNEL_MS = 600e3;        // привязка канала — 10 минут
const DEFAULT_LIFETIME = 600;    // ретранслятор без продления живёт 10 минут
const MAX_LIFETIME = 3600;
const NONCE_MS = 3600e3;

// ---------------- разбор и сборка сообщений STUN ----------------
const msgType = (method, cls) => ((method & 0x0f80) << 2) | ((method & 0x0070) << 1) | (method & 0x000f) | ((cls & 2) << 7) | ((cls & 1) << 4);
const parseType = (t) => ({ method: ((t & 0x3e00) >> 2) | ((t & 0x00e0) >> 1) | (t & 0x000f), cls: ((t & 0x0100) >> 7) | ((t & 0x0010) >> 4) });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function parseStun(buf) {
  if (buf.length < 20) return null;
  const type = buf.readUInt16BE(0);
  if (type & 0xc000) return null;
  const len = buf.readUInt16BE(2);
  if (len % 4 || buf.readUInt32BE(4) !== MAGIC || 20 + len > buf.length) return null;
  const msg = { type, ...parseType(type), tid: buf.subarray(8, 20), raw: buf.subarray(0, 20 + len), attrs: new Map(), miOffset: -1 };
  let off = 20;
  while (off + 4 <= 20 + len) {
    const t = buf.readUInt16BE(off); const l = buf.readUInt16BE(off + 2);
    if (off + 4 + l > 20 + len) return null;
    if (msg.miOffset < 0 || t === ATTR.FINGERPRINT) { if (!msg.attrs.has(t)) msg.attrs.set(t, buf.subarray(off + 4, off + 4 + l)); } // после подписи учитываем только FINGERPRINT
    if (t === ATTR.MESSAGE_INTEGRITY && msg.miOffset < 0) msg.miOffset = off;
    off += 4 + ((l + 3) & ~3);
  }
  return msg;
}

function attrBuf(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0); b.writeUInt16BE(value.length, 2); value.copy(b, 4);
  return b;
}

// attrs: [[тип, Buffer], ...]; key — ключ подписи (MESSAGE-INTEGRITY), fingerprint — добавить FINGERPRINT
function buildStun(method, cls, tid, attrs = [], key = null, fingerprint = true) {
  const body = Buffer.concat(attrs.map(([t, v]) => attrBuf(t, v)));
  const head = Buffer.alloc(20);
  head.writeUInt16BE(msgType(method, cls), 0); head.writeUInt32BE(MAGIC, 4); tid.copy(head, 8);
  const parts = [head, body]; let len = body.length;
  if (key) {
    head.writeUInt16BE(len + 24, 2);
    const mi = crypto.createHmac('sha1', key).update(head).update(body).digest();
    parts.push(attrBuf(ATTR.MESSAGE_INTEGRITY, mi)); len += 24;
  }
  if (fingerprint) {
    head.writeUInt16BE(len + 8, 2);
    const crc = (crc32(Buffer.concat(parts)) ^ 0x5354554e) >>> 0;
    const v = Buffer.alloc(4); v.writeUInt32BE(crc, 0);
    parts.push(attrBuf(ATTR.FINGERPRINT, v)); len += 8;
  }
  head.writeUInt16BE(len, 2);
  return Buffer.concat(parts);
}

function checkIntegrity(msg, key) {
  if (msg.miOffset < 0) return false;
  const mi = msg.attrs.get(ATTR.MESSAGE_INTEGRITY);
  if (!mi || mi.length !== 20) return false;
  const pre = Buffer.from(msg.raw.subarray(0, msg.miOffset));
  pre.writeUInt16BE(msg.miOffset - 20 + 24, 2); // длина — «до подписи включительно»
  const h = crypto.createHmac('sha1', key).update(pre).digest();
  return crypto.timingSafeEqual(h, mi);
}

const ipToInt = (ip) => ip.split('.').reduce((a, x) => ((a << 8) | (Number(x) & 255)) >>> 0, 0);
const intToIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const isV4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
const v4 = (ip) => String(ip).replace(/^::ffff:/, '');

function xorAddr(ip, port) {
  const b = Buffer.alloc(8);
  b[1] = 0x01; b.writeUInt16BE((port ^ (MAGIC >>> 16)) & 0xffff, 2); b.writeUInt32BE((ipToInt(ip) ^ MAGIC) >>> 0, 4);
  return b;
}
function readXorAddr(v) {
  if (!v || v.length < 8) return null;
  if (v[1] !== 0x01) return { family: v[1] };
  return { ip: intToIp((v.readUInt32BE(4) ^ MAGIC) >>> 0), port: (v.readUInt16BE(2) ^ (MAGIC >>> 16)) & 0xffff };
}
function errorAttr(code, text) {
  const t = Buffer.from(text || ERR_TEXT[code] || 'Error', 'utf8');
  const b = Buffer.alloc(4 + t.length); b[2] = Math.floor(code / 100); b[3] = code % 100; t.copy(b, 4);
  return b;
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };

// внутренние сети, куда ретранслятор не отправляет ничего (чтобы через него нельзя было залезть в сеть хостинга)
const PRIVATE = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]];
function isPrivate(ip) {
  const n = ipToInt(ip);
  return PRIVATE.some(([base, bits]) => ((n ^ ipToInt(base)) >>> (32 - bits)) === 0);
}

// большие буферы сокетов: видео приходит пачками кадров, и маленький буфер терял бы пакеты
function bigBuffers(s) {
  try { s.setRecvBufferSize(4 * 1024 * 1024); } catch (_) { /* система может не позволить — не страшно */ }
  try { s.setSendBufferSize(4 * 1024 * 1024); } catch (_) { /* то же */ }
}

// Учётка по схеме «общий секрет»: username = «срок_в_секундах:ник»
function restPassword(secret, username) { return crypto.createHmac('sha1', secret).update(username).digest('base64'); }

/**
 * Запуск ретранслятора.
 * opts: { port=3478, secret, realm='skhodka', publicIp, relayMin=49160, relayMax=49999,
 *         maxPerUser=24, maxTotal=400, allowPrivatePeers=false, log }
 */
async function startTurn(opts) {
  const o = { port: 3478, realm: 'skhodka', relayMin: 49160, relayMax: 49999, maxPerUser: 24, maxTotal: 400, allowPrivatePeers: false, log: () => {}, ...opts };
  if (!o.secret) throw new Error('TURN: не задан общий секрет');
  if (!o.publicIp || !isV4(o.publicIp)) throw new Error('TURN: не задан внешний IPv4-адрес сервера');
  const log = o.log;
  const realmBuf = Buffer.from(o.realm);
  const nonceKey = crypto.randomBytes(16);
  const allocs = new Map();     // «udp|ip:port» или «tcp#n» → ретранслятор
  const byRelayPort = new Map(); // порт ретранслятора → ретранслятор
  const stat = { bytesIn: 0, bytesOut: 0, allocations: 0 };
  let tcpSeq = 0;

  const makeNonce = () => { const ts = Date.now().toString(16); return ts + '-' + crypto.createHmac('sha1', nonceKey).update(ts).digest('hex').slice(0, 16); };
  const nonceState = (n) => {
    const [ts, h] = String(n).split('-');
    if (!ts || !h || crypto.createHmac('sha1', nonceKey).update(ts).digest('hex').slice(0, 16) !== h) return 'bad';
    return Date.now() - parseInt(ts, 16) > NONCE_MS ? 'stale' : 'ok';
  };
  const peerAllowed = (ip) => isV4(ip) && (o.allowPrivatePeers || ip === o.publicIp || !isPrivate(ip));

  // ---------- отправка клиенту ----------
  function sendToClient(client, buf) {
    if (client.proto === 'udp') udp.send(buf, client.port, client.ip);
    else if (!client.sock.destroyed) client.sock.write(buf);
    stat.bytesOut += buf.length;
  }
  function channelData(num, data, tcp) {
    const pad = tcp ? (4 - (data.length % 4)) % 4 : 0;
    const b = Buffer.alloc(4 + data.length + pad);
    b.writeUInt16BE(num, 0); b.writeUInt16BE(data.length, 2); data.copy(b, 4);
    return b;
  }

  // пакет от собеседника (из сети или от соседнего ретранслятора) → клиенту
  function deliverFromPeer(a, ip, port, data) {
    if (a.closed) return;
    const perm = a.perms.get(ip);
    if (!perm || perm < Date.now()) return;
    const ch = a.chanByPeer.get(ip + ':' + port);
    if (ch && ch.expires > Date.now()) sendToClient(a.client, channelData(ch.num, data, a.client.proto === 'tcp'));
    else sendToClient(a.client, buildStun(METHOD.DATA, CLS.INDICATION, crypto.randomBytes(12), [[ATTR.XOR_PEER_ADDRESS, xorAddr(ip, port)], [ATTR.DATA, data]], null, false));
  }

  // пакет от клиента → собеседнику
  function relayToPeer(a, ip, port, data) {
    const perm = a.perms.get(ip);
    if (!perm || perm < Date.now() || !peerAllowed(ip)) return;
    stat.bytesIn += data.length;
    if (ip === o.publicIp) { // собеседник — тоже ретранслятор этого сервера: передаём внутри программы
      const b = byRelayPort.get(port);
      if (b) { deliverFromPeer(b, o.publicIp, a.relayPort, data); return; }
    }
    a.sock.send(data, port, ip);
  }

  function freeAlloc(a, why) {
    if (a.closed) return;
    a.closed = true;
    allocs.delete(a.key); byRelayPort.delete(a.relayPort);
    try { a.sock.close(); } catch (_) { /* уже закрыт */ }
    log('debug', 'turn', `Ретранслятор ${a.relayPort} (${a.user}) закрыт: ${why}`);
  }

  function bindRelaySocket() {
    return new Promise((resolve) => {
      let tries = 0;
      const attempt = () => {
        if (tries++ > 40) return resolve(null);
        const p = o.relayMin + crypto.randomInt(o.relayMax - o.relayMin + 1);
        if (byRelayPort.has(p)) return attempt();
        const s = dgram.createSocket('udp4');
        s.once('error', () => { try { s.close(); } catch (_) { /* */ } attempt(); });
        s.bind(p, '0.0.0.0', () => { s.removeAllListeners('error'); s.on('error', () => {}); bigBuffers(s); resolve({ sock: s, port: p }); });
      };
      attempt();
    });
  }

  // ---------- проверка учётки ----------
  // → { key, user } или null (ответ об ошибке уже отправлен)
  function authenticate(msg, client, reply) {
    const unauth = (code) => reply(buildStun(msg.method, CLS.ERROR, msg.tid, [[ATTR.ERROR_CODE, errorAttr(code)], [ATTR.REALM, realmBuf], [ATTR.NONCE, Buffer.from(makeNonce())]]));
    const userB = msg.attrs.get(ATTR.USERNAME); const nonceB = msg.attrs.get(ATTR.NONCE); const realmB = msg.attrs.get(ATTR.REALM);
    if (msg.miOffset < 0 || !userB || !nonceB || !realmB) { unauth(401); return null; }
    const ns = nonceState(nonceB.toString());
    if (ns === 'bad') { unauth(401); return null; }
    if (ns === 'stale') { unauth(438); return null; }
    const username = userB.toString();
    const exp = Number(username.split(':')[0]);
    if (!(exp * 1000 > Date.now())) { unauth(401); return null; }
    const key = crypto.createHash('md5').update(`${username}:${realmB.toString()}:${restPassword(o.secret, username)}`).digest();
    if (!checkIntegrity(msg, key)) { unauth(401); return null; }
    return { key, username, user: username.slice(username.indexOf(':') + 1) || '?' };
  }

  // ---------- обработка сообщений клиента ----------
  async function onClientMessage(buf, client) {
    // ChannelData: первые два бита 01
    if (buf.length >= 4 && (buf[0] & 0xc0) === 0x40) {
      const a = allocs.get(client.key); if (!a) return;
      const num = buf.readUInt16BE(0); const len = buf.readUInt16BE(2);
      if (4 + len > buf.length) return;
      const ch = a.chanByNum.get(num);
      if (!ch || ch.expires < Date.now()) return;
      relayToPeer(a, ch.ip, ch.port, buf.subarray(4, 4 + len));
      return;
    }
    const msg = parseStun(buf);
    if (!msg) return;
    const reply = (b) => sendToClient(client, b);
    const ok = (attrs, key) => reply(buildStun(msg.method, CLS.SUCCESS, msg.tid, attrs, key));
    const fail = (code, key) => reply(buildStun(msg.method, CLS.ERROR, msg.tid, [[ATTR.ERROR_CODE, errorAttr(code)]], key));

    if (msg.cls === CLS.INDICATION) {
      if (msg.method !== METHOD.SEND) return;
      const a = allocs.get(client.key); if (!a) return;
      const peer = readXorAddr(msg.attrs.get(ATTR.XOR_PEER_ADDRESS)); const data = msg.attrs.get(ATTR.DATA);
      if (!peer || !peer.ip || !data) return;
      relayToPeer(a, peer.ip, peer.port, data);
      return;
    }
    if (msg.cls !== CLS.REQUEST) return;

    if (msg.method === METHOD.BINDING) { ok([[ATTR.XOR_MAPPED_ADDRESS, xorAddr(client.ip, client.port)]]); return; }

    const auth = authenticate(msg, client, reply);
    if (!auth) return;
    const { key } = auth;
    let a = allocs.get(client.key);

    if (msg.method === METHOD.ALLOCATE) {
      if (a) { // повтор того же запроса (потерялся ответ) — отвечаем тем же; иначе — уже есть
        if (a.allocTid.equals(msg.tid)) return ok(a.allocAttrs, key);
        return fail(437, key);
      }
      const rt = msg.attrs.get(ATTR.REQUESTED_TRANSPORT);
      if (!rt || rt[0] !== 17) return fail(442, key);
      const mine = [...allocs.values()].filter((x) => x.user === auth.user).length;
      if (mine >= o.maxPerUser || allocs.size >= o.maxTotal) return fail(486, key);
      const lt = msg.attrs.get(ATTR.LIFETIME);
      const lifetime = Math.max(60, Math.min(MAX_LIFETIME, lt ? lt.readUInt32BE(0) : DEFAULT_LIFETIME));
      const r = await bindRelaySocket();
      if (!r) return fail(508, key);
      if (allocs.get(client.key)) { r.sock.close(); return; } // пока искали порт, пришёл повтор и уже обработан
      a = {
        key: client.key, client, user: auth.user, username: auth.username, sock: r.sock, relayPort: r.port,
        expires: Date.now() + lifetime * 1000, perms: new Map(), chanByNum: new Map(), chanByPeer: new Map(), allocTid: Buffer.from(msg.tid), closed: false,
      };
      a.allocAttrs = [[ATTR.XOR_RELAYED_ADDRESS, xorAddr(o.publicIp, r.port)], [ATTR.LIFETIME, u32(lifetime)], [ATTR.XOR_MAPPED_ADDRESS, xorAddr(client.ip, client.port)]];
      r.sock.on('message', (data, rinfo) => deliverFromPeer(a, v4(rinfo.address), rinfo.port, data));
      allocs.set(client.key, a); byRelayPort.set(r.port, a); stat.allocations++;
      log('debug', 'turn', `Ретранслятор ${r.port} для ${auth.user} (${client.proto} ${client.ip}:${client.port}), ${lifetime} с`);
      return ok(a.allocAttrs, key);
    }

    if (!a) return fail(437, key);
    if (a.username !== auth.username) return fail(441, key);

    if (msg.method === METHOD.REFRESH) {
      const lt = msg.attrs.get(ATTR.LIFETIME);
      const lifetime = lt ? Math.min(MAX_LIFETIME, lt.readUInt32BE(0)) : DEFAULT_LIFETIME;
      if (lifetime === 0) { ok([[ATTR.LIFETIME, u32(0)]], key); freeAlloc(a, 'клиент закрыл'); return; }
      a.expires = Date.now() + lifetime * 1000;
      return ok([[ATTR.LIFETIME, u32(lifetime)]], key);
    }

    if (msg.method === METHOD.CREATE_PERMISSION) {
      // атрибутов XOR-PEER-ADDRESS может быть несколько — разбираем все
      const peers = [];
      let off = 20;
      while (off + 4 <= msg.raw.length) {
        const t = msg.raw.readUInt16BE(off); const l = msg.raw.readUInt16BE(off + 2);
        if (t === ATTR.MESSAGE_INTEGRITY) break;
        if (t === ATTR.XOR_PEER_ADDRESS) peers.push(readXorAddr(msg.raw.subarray(off + 4, off + 4 + l)));
        off += 4 + ((l + 3) & ~3);
      }
      if (!peers.length) return fail(400, key);
      if (peers.some((p) => !p || !p.ip)) return fail(443, key);
      if (peers.some((p) => !peerAllowed(p.ip))) return fail(403, key);
      for (const p of peers) a.perms.set(p.ip, Date.now() + PERMISSION_MS);
      return ok([], key);
    }

    if (msg.method === METHOD.CHANNEL_BIND) {
      const numB = msg.attrs.get(ATTR.CHANNEL_NUMBER); const peer = readXorAddr(msg.attrs.get(ATTR.XOR_PEER_ADDRESS));
      if (!numB || numB.length < 4 || !peer) return fail(400, key);
      if (!peer.ip) return fail(443, key);
      const num = numB.readUInt16BE(0);
      if (num < 0x4000 || num > 0x7fff) return fail(400, key);
      if (!peerAllowed(peer.ip)) return fail(403, key);
      const pk = peer.ip + ':' + peer.port;
      const byNum = a.chanByNum.get(num); const byPeer = a.chanByPeer.get(pk);
      if ((byNum && byNum.ip + ':' + byNum.port !== pk) || (byPeer && byPeer.num !== num)) return fail(400, key);
      const ch = byNum || { num, ip: peer.ip, port: peer.port, expires: 0 };
      ch.expires = Date.now() + CHANNEL_MS;
      a.chanByNum.set(num, ch); a.chanByPeer.set(pk, ch);
      a.perms.set(peer.ip, Date.now() + PERMISSION_MS);
      return ok([], key);
    }
    return fail(400, key);
  }

  // ---------- UDP ----------
  const udp = dgram.createSocket('udp4');
  udp.on('message', (buf, rinfo) => {
    const ip = v4(rinfo.address);
    onClientMessage(buf, { proto: 'udp', ip, port: rinfo.port, key: `udp|${ip}:${rinfo.port}` }).catch((e) => log('warn', 'turn', `TURN: ${e.message}`));
  });
  udp.on('error', (e) => log('warn', 'turn', `TURN (UDP): ${e.message}`));
  await new Promise((res, rej) => { udp.once('error', rej); udp.bind(o.port, '0.0.0.0', () => { udp.removeListener('error', rej); res(); }); });
  bigBuffers(udp);

  // ---------- TCP: STUN и ChannelData идут потоком, ChannelData выровнены до 4 байт ----------
  const conns = new Set();
  const tcp = net.createServer((sock) => {
    sock.setNoDelay(true);
    const id = ++tcpSeq;
    const client = { proto: 'tcp', ip: v4(sock.remoteAddress), port: sock.remotePort, key: `tcp#${id}`, sock };
    conns.add(sock);
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      if (buf.length > 256 * 1024) { sock.destroy(); return; }
      for (;;) {
        if (buf.length < 4) break;
        let need;
        if ((buf[0] & 0xc0) === 0x40) { const l = buf.readUInt16BE(2); need = 4 + l + ((4 - (l % 4)) % 4); }
        else if ((buf[0] & 0xc0) === 0) { need = 20 + buf.readUInt16BE(2); }
        else { sock.destroy(); return; }
        if (buf.length < need) break;
        const frame = buf.subarray(0, need);
        buf = buf.subarray(need);
        onClientMessage(Buffer.from(frame), client).catch((e) => log('warn', 'turn', `TURN: ${e.message}`));
      }
    });
    const end = () => { conns.delete(sock); const a = allocs.get(client.key); if (a) freeAlloc(a, 'соединение закрыто'); };
    sock.on('close', end);
    sock.on('error', () => {});
    sock.setTimeout(10 * 60e3, () => sock.destroy());
  });
  await new Promise((res, rej) => { tcp.once('error', rej); tcp.listen(o.port, '0.0.0.0', () => { tcp.removeListener('error', rej); res(); }); });

  // ---------- уборка просроченного ----------
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const a of [...allocs.values()]) {
      if (a.expires < now) { freeAlloc(a, 'истёк срок'); continue; }
      for (const [ip, t] of a.perms) if (t < now) a.perms.delete(ip);
      for (const [n, ch] of a.chanByNum) if (ch.expires + 300e3 < now) { a.chanByNum.delete(n); a.chanByPeer.delete(ch.ip + ':' + ch.port); }
    }
  }, 30e3);
  sweep.unref();

  log('info', 'turn', `Ретранслятор (TURN) на порту ${o.port} UDP/TCP, внешний адрес ${o.publicIp}, порты ${o.relayMin}–${o.relayMax} UDP`);
  return {
    port: o.port,
    stats: () => ({ ...stat, active: allocs.size }),
    close: async () => {
      clearInterval(sweep);
      for (const a of [...allocs.values()]) freeAlloc(a, 'остановка');
      for (const s of conns) s.destroy();
      await Promise.all([new Promise((r) => udp.close(r)), new Promise((r) => tcp.close(r))]);
    },
  };
}

module.exports = { startTurn, restPassword, parseStun, buildStun, checkIntegrity, xorAddr, readXorAddr, METHOD, CLS, ATTR, MAGIC, crc32, isPrivate };
