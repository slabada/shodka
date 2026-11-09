// Интерфейс «Сходки»: экраны, чат, друзья, голос, демонстрация, настройки, лог.
import { log, mountLogPanel, setVerbose, explain } from './log.js';
import { settings, set, onSettings } from './settings.js';
import { Connection } from './net.js';
import { Mic, Output } from './audio.js';
import { Voice, CAN_SHARE_AUDIO, hwH264 } from './rtc.js';
import { gpuCaptureAvailable, encName } from './gpucap.js';
import { measureUpload, pickQuality } from './nettest.js';
import { imageUrl, prepareImage, uploadImage, copyImage, saveImage, imageFileName, uploadFile, fmtSize, fileKind, serverBase } from './chatmedia.js';
import { loadLocalAvatar, localAvatar, saveLocalAvatar, chooseAvatar } from './avatar.js';
import { P2PFiles, p2pAvailable, newFileId } from './p2pfiles.js';
import { openSnake } from './snake.js';
import { DemoReports } from './demoreport.js';
import { isBackground, onBackground, setSharing } from './footprint.js';
import { THEMES, themeById, applyTheme, swatchCss } from './themes.js';
import { MusicPlayer } from './music.js';
import { Soundboard } from './soundboard.js';

const api = window.api;
const $ = (id) => document.getElementById(id);
const isWindows = /win/i.test(navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform);

const S = {
  conn: null, host: '', port: 0, isHost: false, isAdmin: false, me: null,
  users: [], friends: [], rooms: {}, voiceRooms: [],
  view: null, chat: 'general', chats: new Map(), unread: new Map(),
  voice: null, inVoice: null, joining: false, muted: false, deafened: false,
  vpnAddr: '',
};
const mic = new Mic();
const output = new Output();
// музыка для всех: свои файлы подмешиваются в голос — слышат все в комнате (music.js)
const music = new MusicPlayer({ mic, output, voice: () => S.voice, toast: (t, o) => toast(t, o) });
// звуки для всех (1.21): смех, «ба-дум-тсс» и свои файлы по кнопке или клавише — тоже через голос (soundboard.js)
const sfx = new Soundboard({ mic, output, voice: () => S.voice, toast: (t, o) => toast(t, o) });
setVerbose(settings.verboseLog);
applyTheme(themeById(settings.theme)); // 1.20: дизайн — сразу, до первой отрисовки окна

// ===================== утилиты =====================
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls = 'i') {
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('class', cls);
  const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u);
  return s;
}
function setIcon(btn, name) { const u = btn.querySelector('use'); if (u) u.setAttribute('href', '#i-' + name); }
function label(btn, iconName, text) { btn.replaceChildren(...(iconName ? [icon(iconName)] : []), el('span', { text })); }
async function copyText(text, what) { await navigator.clipboard.writeText(text); toast(`${what || 'Текст'} скопирован`, { kind: 'ok' }); }
function hue(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
// подобранные переливы для аватарок без картинки: спокойные, хорошо различимые между собой
const AVATAR_TONES = [
  'linear-gradient(140deg, #F6C89A, #E0899B)', // персик → роза
  'linear-gradient(140deg, #A9B6FF, #7C7FE8)', // барвинок → индиго
  'linear-gradient(140deg, #8EE3CC, #5AA6D6)', // мята → небо
  'linear-gradient(140deg, #F5AFCF, #B88CE6)', // розовый → сирень
  'linear-gradient(140deg, #FFD59A, #F09A6E)', // абрикос → коралл
  'linear-gradient(140deg, #9EE7F0, #6B8BEA)', // лёд → синий
  'linear-gradient(140deg, #CDB8FF, #8E72E0)', // лаванда → фиалка
  'linear-gradient(140deg, #B9EBA6, #5DBE9E)', // салатовый → изумруд
  'linear-gradient(140deg, #FFB3B3, #D96A8C)', // клубника → малина
  'linear-gradient(140deg, #C2D4F5, #8193C9)', // дымчато-голубой → сталь
];
function avatar(name, online) {
  const a = el('div', { class: 'avatar', 'data-avatar': name }, String(name || '?').slice(0, 1).toUpperCase());
  a.style.background = AVATAR_TONES[hue(name) % AVATAR_TONES.length]; // мягкий пастельный перелив — цвет закреплён за ником
  if (online !== undefined) a.append(el('span', { class: 'st' + (online ? ' on' : '') }));
  paintAvatar(a, name);
  return a;
}
// своя аватарка — сразу из папки программы, чужие — с сервера
const serverHas = (f) => !!(S.conn && S.conn.helloInfo && (S.conn.helloInfo.features || []).includes(f));
function avatarSrc(name) {
  if (S.me && sameName(name, S.me)) { const la = localAvatar(S.me); if (la) return la.url; }
  const u = (S.users || []).find((x) => sameName(x.name, name));
  return u && u.avatar && S.conn ? `${serverBase(S)}/avatars/${u.avatar}` : null;
}
function paintAvatar(a, name) {
  const src = avatarSrc(name);
  const old = a.querySelector('img.av');
  if (old && old.getAttribute('src') === src) return;
  if (old) old.remove();
  a.classList.toggle('has-img', !!src);
  if (!src) return;
  const img = el('img', { class: 'av', src, alt: '', draggable: 'false' });
  img.onerror = () => { img.remove(); a.classList.remove('has-img'); };
  a.prepend(img);
}
function refreshAvatars() {
  for (const a of document.querySelectorAll('.avatar[data-avatar]')) paintAvatar(a, a.dataset.avatar);
  paintProfileAvatar();
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const lower = (s) => String(s || '').toLowerCase();
const sameName = (a, b) => lower(a) === lower(b);

const toastSeen = new Map();
function toast(text, { kind = 'info', hint, timeout = 5000, onclick } = {}) {
  const k = kind + text;
  if (toastSeen.has(k) && Date.now() - toastSeen.get(k) < 5000) return;
  toastSeen.set(k, Date.now());
  const t = el('div', { class: `toast ${kind}` }, el('div', {}, el('div', { text }), hint ? el('div', { class: 't-hint', text: hint }) : null));
  t.addEventListener('click', () => { t.remove(); if (onclick) onclick(); });
  $('toasts').append(t);
  while ($('toasts').childElementCount > 4) $('toasts').firstChild.remove();
  setTimeout(() => t.remove(), timeout);
}

function show(screenId) {
  for (const s of ['screen-start', 'screen-auth', 'screen-main']) $(s).hidden = s !== screenId;
  document.body.classList.toggle('in-main', screenId === 'screen-main'); // на главном экране «Журнал» — в шапке комнаты
}

function formError(id, err) {
  const box = $(id);
  if (!err) { box.hidden = true; return; }
  box.textContent = '';
  box.append(el('b', { text: err.message || String(err) }));
  if (err.hint) box.append(err.hint);
  box.hidden = false;
}

// ===================== лог =====================
const logPanel = mountLogPanel({
  panel: $('log-panel'), list: $('log-list'), badge: $('log-badge'),
  filterEl: $('log-filter'), searchEl: $('log-search'),
  onError: (e) => toast(e.msg, { kind: 'error', hint: e.hint ? e.hint.slice(0, 160) + (e.hint.length > 160 ? '…' : '') : 'Нажмите, чтобы открыть журнал', timeout: 9000, onclick: () => logPanel.filterErrors() }),
});
$('log-toggle').onclick = () => logPanel.toggle();
$('btn-log').onclick = () => logPanel.toggle();
// значок ошибок дублируем на кнопку в шапке
new MutationObserver(() => { const b = $('log-badge'); $('btn-log-badge').hidden = b.hidden; $('btn-log-badge').textContent = b.textContent; })
  .observe($('log-badge'), { attributes: true, childList: true, characterData: true, subtree: true });
$('log-close').onclick = () => logPanel.hide();
$('log-clear').onclick = () => logPanel.clear();
$('log-copy').onclick = async () => { await navigator.clipboard.writeText(logPanel.text()); toast('Журнал скопирован', { kind: 'ok' }); };
$('log-save').onclick = async () => { const p = await api.logSave(logPanel.text()); if (p) toast('Журнал сохранён: ' + p, { kind: 'ok' }); };
$('log-folder').onclick = () => api.logOpenFolder();
$('log-diag').onclick = () => diagnostics();
document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.code === 'KeyL') { e.preventDefault(); logPanel.toggle(); } });

async function diagnostics() {
  log.info('diag', '──────── Диагностика ────────');
  try {
    const i = await api.appInfo();
    log.info('diag', `Сходка ${i.version} · Electron ${i.electron} (Chromium ${i.chrome}) · ${i.os} · ЦП ${i.cpuModel} ×${i.cpus} · ОЗУ ${i.memGb} ГБ`);
    const ifs = await api.interfaces();
    if (ifs.length) log.info('diag', 'Сетевые адреса: ' + ifs.map((x) => `${x.kind} ${x.address} (${x.name})`).join('; '));
    if (!ifs.some((x) => x.kind === 'Radmin VPN') && S.host && isLanIp(S.host)) log.warn('diag', 'Адаптер Radmin VPN не найден, а сервер — по адресу Radmin', { hint: 'Запустите Radmin VPN и войдите в сеть.' });
    if (S.conn) log.info('diag', `Сервер ${S.host}:${S.port} · пинг до сервера ${S.conn.rtt ?? '?'} мс${S.isHost ? ' · вы хост' : ''}`);
    if (S.isHost) { const st = await api.hostStatus(); log.info('diag', `Сервер: ${st.running ? `работает, подключений ${st.connections}, онлайн ${st.online}` : 'остановлен'}`); }
    const devs = await navigator.mediaDevices.enumerateDevices();
    const ins = devs.filter((d) => d.kind === 'audioinput'); const outs = devs.filter((d) => d.kind === 'audiooutput');
    log.info('diag', `Микрофонов: ${ins.length}, устройств вывода: ${outs.length}`);
    if (!ins.length) log.error('diag', 'Не найдено ни одного микрофона', { hint: 'Подключите микрофон или проверьте его в Параметрах звука Windows.' });
    if (!mic.running) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); log.info('diag', `Микрофон доступен: «${s.getAudioTracks()[0].label}»`); s.getTracks().forEach((t) => t.stop()); } catch (e) { const x = explain(e, 'mic'); log.error('diag', x.msg, { hint: x.hint, err: e }); }
    } else log.info('diag', `Микрофон работает: «${mic.deviceLabel}», уровень ${Math.round(mic.level)} дБ`);
    const caps = (RTCRtpSender.getCapabilities('video') || { codecs: [] }).codecs.map((c) => c.mimeType.replace('video/', '')).filter((c) => !['rtx', 'red', 'ulpfec', 'flexfec-03'].includes(c));
    log.info('diag', `Видеокодеки: ${[...new Set(caps)].join(', ')}`);
    if (navigator.mediaCapabilities && navigator.mediaCapabilities.encodingInfo) {
      for (const c of ['H264', 'VP9', 'AV1']) {
        try {
          const r = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: 'video/' + c + (c === 'H264' ? ';profile-level-id=42001f;packetization-mode=1' : ''), width: 1920, height: 1080, framerate: 60, bitrate: 8e6 } });
          if (r.supported) log.info('diag', `${c} 1080p60: ${r.powerEfficient ? 'аппаратное кодирование (видеокарта) ✓' : 'программное (процессор)'}${r.smooth ? '' : ', может не успевать'}`);
        } catch (_) { /* ignore */ }
      }
    }
    if (S.voice) {
      for (const p of S.voice.peers.values()) {
        const a = p.audioIn;
        log.info('diag', `Голос: ${p.name} — ${p.state}, пинг ${p.rtt ?? '?'} мс${a ? `, пропадает звука ${a.conceal.toFixed(1)}%, потери пакетов ${a.loss.toFixed(1)}%, дрожание сети ${a.jitter} мс${a.buffer != null ? `, буфер ${a.buffer} мс` : ''}` : ''}`);
      }
    }
  } catch (e) {
    log.error('diag', `Диагностика прервана: ${e.message}`, { err: e });
  }
  log.info('diag', '──────── Готово ────────');
  logPanel.show();
}

// ===================== стартовый экран =====================
async function renderInterfaces(target) {
  const list = await api.interfaces();
  const box = $(target);
  box.textContent = '';
  if (!list.length) { box.append(el('div', { class: 'iface-note', text: 'Сеть не найдена. Подключитесь к интернету или Radmin VPN.' })); return list; }
  const vpnKinds = ['Radmin VPN', 'ZeroTier', 'Hamachi', 'Tailscale'];
  const shown = list.some((i) => vpnKinds.includes(i.kind)) && target === 'iface-list' ? list.filter((i) => vpnKinds.includes(i.kind)) : list;
  for (const i of shown) {
    const vpn = vpnKinds.includes(i.kind);
    box.append(el('div', { class: 'iface' },
      el('span', { class: 'kind' + (vpn ? ' vpn' : ''), text: i.kind }),
      el('code', { text: i.address }),
      el('button', { type: 'button', class: 'icon-btn', 'data-tip': 'Скопировать адрес', onclick: () => copyText(i.address, 'Адрес') }, icon('copy')),
    ));
  }
  if (!list.some((i) => i.kind === 'Radmin VPN')) box.append(el('div', { class: 'iface-note', text: 'Radmin VPN не найден. Если друзья не в вашей домашней сети — запустите Radmin VPN и войдите в общую сеть.' }));
  return list;
}

// Адрес можно вводить как угодно: «78.17.198.59», «26.1.2.3», «1.2.3.4:41234», «wss://сервер».
// Для адресов VPN/локальной сети сначала пробуем обычное соединение (как в Radmin), для интернета — шифрованное.
const isLanIp = (h) => /^(26\.|25\.|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) || h === 'localhost';
function parseAddress(text) {
  let t = String(text || '').trim();
  let scheme = null;
  const m = t.match(/^(wss?):\/\//i);
  if (m) { scheme = m[1].toLowerCase(); t = t.slice(m[0].length); }
  t = t.replace(/\/.*$/, '');
  let host = t; let port = null;
  const hp = t.match(/^([^:]+):(\d{1,5})$/);
  if (hp) { host = hp[1]; port = Number(hp[2]); }
  if (!/^[\w.-]+$/.test(host)) return null;
  const c = (secure, p) => ({ host, port: p, secure });
  if (scheme) return [c(scheme === 'wss', port || (scheme === 'wss' ? 443 : 41234))];
  if (port) return port === 443 ? [c(true, 443)] : isLanIp(host) ? [c(false, port), c(true, port)] : [c(true, port), c(false, port)];
  return isLanIp(host) ? [c(false, 41234), c(true, 443)] : [c(true, 443), c(false, 41234)];
}
const keyOf = (host, port) => `${host}:${port}`;

// последние серверы под полем адреса: щелчок — подключиться, крестик — убрать из списка, «Очистить» — убрать все
const recentLabel = (r) => r.addr || `${r.host}:${r.port}`;
function forgetRecent(labels) {
  const drop = new Set(labels);
  const recent = (settings.recent || []).filter((r) => !drop.has(recentLabel(r)));
  const patch = { recent };
  if (drop.has(settings.lastServer)) patch.lastServer = '';
  if (drop.has($('connect-host').value.trim())) $('connect-host').value = '';
  set(patch);
  renderRecent();
}
function renderRecent() {
  const box = $('recent'); box.textContent = '';
  const list = (settings.recent || []).slice(0, 6);
  for (const r of list) {
    const label = recentLabel(r);
    box.append(el('button', { type: 'button', class: 'recent-item', onclick: () => { $('connect-host').value = label; connectTo(label); } },
      el('span', { text: label }),
      el('span', { class: 'recent-x', role: 'button', 'aria-label': 'Убрать из списка', 'data-tip': 'Убрать из списка', onclick: (e) => { e.stopPropagation(); forgetRecent([label]); } }, icon('x'))));
  }
  if (list.length) box.append(el('button', { type: 'button', class: 'recent-clear', onclick: () => forgetRecent((settings.recent || []).map(recentLabel)) }, icon('trash'), el('span', { text: 'Очистить' })));
}

$('connect-host').value = settings.lastServer || '';
$('host-port').value = settings.hostPort || 41234;
renderRecent();
renderInterfaces('iface-list').then((l) => { const v = l.find((i) => i.kind === 'Radmin VPN') || l[0]; S.vpnAddr = v ? v.address : ''; });

$('connect-host').addEventListener('input', () => { $('connect-pass-box').hidden = true; $('connect-forget').hidden = true; });
$('form-connect').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('connect-host').value.trim();
  if (!parseAddress(text)) { formError('connect-error', { message: 'Не похоже на адрес. Пример: 78.17.198.59 или 26.123.45.67' }); return; }
  connectTo(text);
});
$('connect-forget').onclick = async () => {
  const cands = parseAddress($('connect-host').value) || [];
  for (const c of cands) await api.certForget(c.host);
  $('connect-forget').hidden = true;
  connectTo($('connect-host').value.trim());
};

$('form-host').addEventListener('submit', async (e) => {
  e.preventDefault();
  const port = Number($('host-port').value);
  const btn = e.submitter || $('form-host').querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Запускаю…';
  formError('host-error', null);
  const r = await api.hostStart(port);
  btn.disabled = false; btn.textContent = 'Запустить сервер';
  if (!r.ok) { formError('host-error', { message: r.message, hint: r.hint }); return; }
  set({ hostPort: port });
  S.isHost = true; S.hostKey = r.hostKey || '';
  const v = r.interfaces.find((i) => i.kind === 'Radmin VPN') || r.interfaces[0];
  S.vpnAddr = v ? v.address : '127.0.0.1';
  log.info('host', `Вы хост. Друзья подключаются к ${S.vpnAddr}:${port}`, { hint: 'При первом запуске Windows спросит про брандмауэр — отметьте ОБЕ галочки (частные и общественные сети), иначе друзья не подключатся.' });
  await connectTo(`127.0.0.1:${port}`, { local: true });
});

let connectGen = 0; // номер попытки подключения: результат устаревшей (двойной щелчок, смена сервера) выбрасываем
async function connectTo(text, { local = false } = {}) {
  const gen = ++connectGen;
  const stale = () => gen !== connectGen;
  S.isHost = !!local;
  formError('connect-error', null);
  $('connect-forget').hidden = true;
  const btn = $('form-connect').querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Подключаюсь…';
  if (S.conn) S.conn.close();
  const cands = local ? [{ host: '127.0.0.1', port: Number(text.split(':')[1]), secure: false }] : (parseAddress(text) || []);
  const typed = $('connect-pass').value;
  let conn = null; let firstErr = null;
  for (const c of cands) {
    const saved = (settings.serverPasswords || {})[keyOf(c.host, c.port)] || '';
    const attempt = new Connection(c.host, c.port, { secure: c.secure, password: typed || saved, hostKey: local ? S.hostKey : '' });
    try { await attempt.connect(); if (stale()) { attempt.close(); return; } conn = attempt; break; } catch (err) {
      if (stale()) return;
      firstErr ||= err;
      if (err.code === 'cert' || err.code === 'cert_mismatch') { firstErr = err; break; }
    }
  }
  btn.disabled = false; btn.textContent = 'Подключиться';
  if (!conn) {
    log.error('net', `Не удалось подключиться к ${text}: ${firstErr.message}`, { hint: firstErr.hint });
    formError(S.isHost ? 'host-error' : 'connect-error', firstErr);
    if (firstErr.code === 'cert_mismatch') $('connect-forget').hidden = false;
    return;
  }
  // пароль сервера
  const h = conn.helloInfo || {};
  if (h.needPassword && !h.passwordOk) {
    conn.close();
    $('connect-pass-box').hidden = false;
    $('connect-pass').focus();
    formError('connect-error', conn.password ? { message: 'Неверный пароль сервера', hint: 'Пароль показывает команда «skhodka info» на сервере.' } : { message: 'Этот сервер защищён паролем', hint: 'Введите пароль сервера и нажмите «Подключиться».' });
    return;
  }
  S.conn = conn; S.host = conn.host; S.port = conn.port; S.secure = conn.secure; S.addrLabel = text; S.serverPassword = conn.password;
  if (!S.isHost) {
    const recent = [{ addr: text }, ...(settings.recent || []).filter((r) => (r.addr || `${r.host}:${r.port}`) !== text)].slice(0, 8);
    const serverPasswords = { ...(settings.serverPasswords || {}) };
    if (conn.password) serverPasswords[keyOf(conn.host, conn.port)] = conn.password;
    set({ lastServer: text, recent, serverPasswords });
    $('connect-pass').value = ''; $('connect-pass-box').hidden = true;
  }
  bindConnection(conn);
  const token = (settings.tokens || {})[keyOf(conn.host, conn.port)];
  if (token) {
    try { const m = await conn.request({ type: 'resume', token }); if (stale()) return; enterMain(m); return; } catch (_) { /* токен устарел */ }
  }
  if (stale()) return;
  // ник уже знаем — входим сразу, без лишнего экрана
  showPasswordRow(false);
  if (settings.nick) {
    try { const m = await loginWithNick(settings.nick); if (stale()) return; enterMain(m); return; } catch (err) { if (stale()) return; formError('auth-error', err); if (err.code === 'need_password') showPasswordRow(true); }
  }
  $('auth-server-name').textContent = S.isHost ? `Ваш сервер запущен: ${S.vpnAddr}:${conn.port}` : `Сервер ${text}`;
  $('auth-name').value = settings.nick || '';
  show('screen-auth');
  $('auth-name').focus();
}

// Вход только по нику. Вместо пароля — секретный ключ этого компьютера (создаётся сам и хранится локально):
// ник закрепляется за компьютером, и с другого ПК занять его нельзя.
function deviceKey() {
  if (!settings.deviceKey) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    set({ deviceKey: Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') });
  }
  return settings.deviceKey;
}
// accountPassword — пароль аккаунта: им входят под своим ником с другого компьютера
async function loginWithNick(name, accountPassword = '') {
  const creds = { name, password: deviceKey() };
  try {
    return await S.conn.request({ type: 'login', ...creds, ...(accountPassword ? { accountPassword } : {}) });
  } catch (err) {
    if (err.code === 'no_account') {
      const m = await S.conn.request({ type: 'register', ...creds });
      // на новом сервере ник ещё свободен — заводим аккаунт сразу с тем же паролем
      if (accountPassword && serverHas('password')) {
        try { await S.conn.request({ type: 'set_password', password: accountPassword }); m.hasPassword = true; } catch (e) { log.warn('ws', `Пароль аккаунта не задан: ${e.message}`); }
      }
      return m;
    }
    if (err.code === 'need_password') {
      const e = new Error(`Ник «${name}» защищён паролем`);
      e.code = 'need_password';
      e.hint = 'Это ваш аккаунт с другого компьютера? Введите пароль аккаунта — дальше этот компьютер будет входить сам.';
      throw e;
    }
    if (err.code === 'bad_password') { const e = new Error('Неверный пароль'); e.code = 'bad_password'; e.hint = 'Проверьте раскладку и Caps Lock. Забыли пароль — попросите хоста освободить ник (правый щелчок по нику → «Освободить ник»).'; throw e; }
    if (err.code === 'bad_login') {
      const e = new Error(`Ник «${name}» уже занят на этом сервере`);
      e.hint = 'Если это не вы — придумайте другой ник. Если это ваш ник, но пароль аккаунта не задан, — попросите хоста освободить ник (правый щелчок по нику → «Освободить ник»), и войдите снова.';
      throw e;
    }
    throw err;
  }
}
function showPasswordRow(on) {
  $('auth-pass-row').hidden = !on;
  $('auth-pass-offer').hidden = on;
  if (on) setTimeout(() => $('auth-pass').focus(), 0);
}
$('auth-pass-toggle').onclick = () => showPasswordRow(true);

// ===================== вход =====================
$('form-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  formError('auth-error', null);
  const btn = $('auth-submit'); btn.disabled = true;
  try {
    const pass = $('auth-pass-row').hidden ? '' : $('auth-pass').value;
    const m = await loginWithNick($('auth-name').value.trim(), pass);
    $('auth-pass').value = '';
    enterMain(m);
  } catch (err) {
    formError('auth-error', err);
    if (err.code === 'need_password' || err.code === 'bad_password') { showPasswordRow(true); $('auth-pass').select(); }
    log.warn('ws', `Вход не удался: ${err.message}`);
  } finally { btn.disabled = false; }
});
$('auth-back').onclick = () => { if (S.conn) S.conn.close(); S.conn = null; show('screen-start'); };

function enterMain(m, again = false) {
  S.me = m.name;
  S.isAdmin = S.isHost || !!m.admin; // админ сервера (1.15.3): удаляет пользователей и освобождает ники
  S.iceServers = m.iceServers || [];
  // сервер в интернете может велеть: голос, демки и прямые файлы — только через его ретранслятор (Radmin не нужен)
  S.relayOnly = !!m.relayOnly && S.iceServers.some((x) => x.username);
  // 1.16: сервер на VPS раздаёт демки сам (размножитель): стример отправляет демку один раз, сервер — всем зрителям
  const sfuWas = S.sfuOn;
  S.sfuOn = serverHas('sfu') && !!m.sfu;
  if (S.sfuOn && !sfuWas) log.info('net', 'Сервер раздаёт демки сам (размножитель): стример отправляет демку один раз, отдача не делится между зрителями');
  else if (serverHas('sfu') && !m.sfu) log.warn('net', 'Размножитель демки на сервере сейчас не работает — демки идут напрямую между компьютерами');
  if (S.voice) S.voice.setSfu(S.sfuOn);
  renderSfuToggle();
  if (S.relayOnly) log.info('net', 'Сервер передаёт голос, демки и файлы через свой ретранслятор — Radmin VPN не нужен');
  else if (S.iceServers.length) log.info('net', 'Сервер выдал ретранслятор (TURN) — голос пройдёт, даже если прямое соединение невозможно');
  // запоминаем ник и закрепляем его за этим компьютером (для входов, сделанных раньше по паролю)
  if (settings.nick !== m.name) set({ nick: m.name });
  S.conn.send({ type: 'bind_key', key: deviceKey() });
  S.users = m.users; S.rooms = m.rooms; S.voiceRooms = m.voiceRooms; setTogether(m.together);
  // другой сервер или другой аккаунт — старые «непрочитанные» и открытая личка к нему не относятся
  const session = `${S.host}:${S.port}|${lower(m.name)}`;
  if (S.session !== session) { S.unread.clear(); S.session = session; }
  if (S.chat && S.chat.startsWith('dm:') && !m.users.some((u) => sameName(u.name, S.chat.slice(3)))) S.chat = 'general';
  set({ tokens: { ...(settings.tokens || {}), [`${S.host}:${S.port}`]: m.token } });
  $('me-name').textContent = S.me;
  $('me-avatar').replaceWith(Object.assign(avatar(S.me), { id: 'me-avatar' }));
  $('server-name').textContent = S.isHost ? 'Мой сервер' : isLanIp(S.host) ? 'Сервер друга' : 'Сервер';
  $('server-addr').textContent = inviteAddr();
  $('server-addr').className = 'server-addr copy';
  $('server-addr').dataset.tip = 'Скопировать адрес';
  $('server-addr').onclick = () => copyText(inviteAddr(), 'Адрес');
  S.chats.clear();
  show('screen-main');
  renderAll();
  if (!again) openView('voice'); else if (S.view === 'voice') renderVoiceView();
  setSide(settings.sidePanel !== false, S.sideTab || 'chat');
  openChannel(S.chat || 'general', { focus: false });
  log.info('ws', `Вы вошли как ${S.me}`);
  S.hasPassword = !!m.hasPassword;
  S.avatarOff = !!m.avatarOff;
  syncAvatar();
  // совет задать пароль — один раз на сервер
  const sk = `${S.host}:${S.port}`;
  if (serverHas('password') && !S.hasPassword && !(settings.pwHinted || {})[sk]) {
    set({ pwHinted: { ...(settings.pwHinted || {}), [sk]: 1 } });
    setTimeout(() => toast('Задайте пароль аккаунта — тогда сможете войти под своим ником с любого компьютера', { hint: 'Настройки → Профиль. Нажмите, чтобы открыть.', timeout: 12000, onclick: () => openSettings('profile') }), 2500);
  }
}

// ---------- аватарка ----------
// Главная — на сервере. Копия в папке программы нужна, чтобы на новом сервере (или после очистки базы)
// аватарка появилась сама. Если на сервере аватарка новее (сменили на другом компьютере) — копия обновляется.
let avatarSyncing = false;
async function syncAvatar() {
  if (!S.conn || !serverHas('avatar') || !S.me || avatarSyncing) return;
  avatarSyncing = true;
  try {
    const la = await loadLocalAvatar(S.me);
    const u = S.users.find((x) => sameName(x.name, S.me));
    const onServer = u && u.avatar ? u.avatar : null;
    if (!onServer && la) {
      // убрали аватарку на другом компьютере — убираем и копию здесь; иначе сервер её просто ещё не видел
      if (S.avatarOff) { await saveLocalAvatar(S.me, null); refreshAvatars(); } else await uploadAvatar(la);
    } else if (onServer && (!la || !la.hash.startsWith(onServer.split('.')[0]))) {
      const r = await fetch(`${serverBase(S)}/avatars/${onServer}`);
      if (r.ok) { const bytes = new Uint8Array(await r.arrayBuffer()); await saveLocalAvatar(S.me, { bytes, type: r.headers.get('content-type') || 'image/webp' }); refreshAvatars(); }
    }
  } catch (e) { log.warn('ws', `Аватарка: ${e.message}`); } finally { avatarSyncing = false; }
}
function uploadAvatar(a) {
  return new Promise((resolve, reject) => {
    const token = (settings.tokens || {})[`${S.host}:${S.port}`];
    const xhr = new XMLHttpRequest();
    xhr.open('POST', serverBase(S) + '/avatar');
    xhr.setRequestHeader('x-skh-token', token || '');
    xhr.setRequestHeader('content-type', a.type);
    xhr.timeout = 60000;
    xhr.onload = () => { let r = {}; try { r = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ } xhr.status === 200 ? resolve(r.avatar) : reject(new Error(r.error || `код ${xhr.status}`)); };
    xhr.onerror = () => reject(new Error('нет связи с сервером'));
    xhr.ontimeout = () => reject(new Error('сервер не ответил'));
    xhr.send(new Blob([a.bytes], { type: a.type }));
  });
}

function renderAll() { renderRooms(); renderDms(); renderMembers(); renderVoiceBar(); if (S.view === 'voice') renderVoiceView(); }

// ===================== события сервера =====================
function bindConnection(conn) {
  conn.on('users', (m) => { S.users = m.list; renderMembers(); renderDms(); refreshAvatars(); refreshP2PCards(); });
  conn.on('p2p', (m) => p2p.handle(m.from, m.fromConn, m.data));
  conn.on('voice_rooms', (m) => {
    S.rooms = m.rooms; setTogether(m.together); onRoomsChanged();
    if (S.voice && S.inVoice) S.voice.syncRoom((m.rooms[S.inVoice] || []).map((x) => x.name));
  });
  conn.on('chat', (m) => onChat(m.msg));
  conn.on('chat_update', (m) => onChatUpdate(m.msg));
  conn.on('user_renamed', (m) => onRenamed(m.from, m.to, m.merged));
  // админ удалил вас с сервера: не переподключаемся (иначе ник тут же создастся заново), возвращаемся к выбору сервера
  conn.on('kicked', async (m) => {
    if (S.conn !== conn) return;
    log.warn('net', `Вас удалили с сервера${m.by ? ` (${m.by})` : ''}`);
    const tokens = { ...(settings.tokens || {}) }; delete tokens[`${S.host}:${S.port}`];
    set({ tokens });
    try { await localLeaveVoice(true); } catch (_) { /* ignore */ }
    conn.close(); S.conn = null; S.me = null; S.view = null;
    show('screen-start');
    formError('connect-error', { message: 'Вас удалили с этого сервера.', hint: 'Если это ошибка — напишите админу сервера.' });
  });
  conn.on('file_deleted', (m) => {
    for (const c of S.chats.values()) for (const msg of c.messages) {
      if (msg.file && msg.file.id === m.id) msg.file.deleted = true;
      if (msg.image && msg.image.id === m.id) msg.image.deleted = true;
    }
    refreshFileCards(m.id);
  });
  conn.on('log_request', (m) => { if (m.from) sendLogToAdmin(String(m.from)); }); // админ забирает журнал (1.18)
  conn.on('voice_peer_joined', (m) => { if (S.voice) { S.voice.peerJoined(m.name); output.beep('join'); } });
  conn.on('voice_peer_left', (m) => { if (S.voice) { S.voice.peerLeft(m.name); output.beep('leave'); } });
  conn.on('signal', (m) => { if (S.voice) S.voice.signal(m.from, m.data); });
  // размножитель демки (1.16): упал/поднялся; поток, который я смотрю, закрылся на сервере
  conn.on('sfu_state', (m) => {
    const on = serverHas('sfu') && !!m.on;
    if (on === !!S.sfuOn) return;
    S.sfuOn = on;
    if (on) log.info('net', 'Размножитель демки на сервере снова работает — новые показы пойдут через сервер');
    else log.warn('net', 'Размножитель демки на сервере перестал работать — демки идут напрямую между компьютерами');
    if (S.voice) S.voice.setSfu(on);
    renderSfuToggle();
  });
  conn.on('sfu_closed', (m) => { if (S.voice) S.voice.sfuClosed(String(m.id || '')); });
  conn.on('voice_kicked', (m) => { toast(m.reason); localLeaveVoice(); });
  conn.on('rtt', (rtt) => { $('conn-status').dataset.tip = `Связь с сервером: ${rtt} мс`; });
  conn.on('disconnected', () => {
    $('conn-status').className = 'conn-dot bad';
    $('vb-status').textContent = 'Переподключение…'; $('vb-status').className = 'vb-status bad';
    // новый сервер держит наше место в комнате: голос и демки идут между компьютерами мимо сервера — звонок не трогаем
    S.keptVoice = !!(S.voice && serverHas('voicehold'));
    toast(S.keptVoice ? 'Связь с сервером потеряна — переподключаюсь. Звонок и демка продолжаются' : 'Связь с сервером потеряна — переподключаюсь…', { kind: 'error', hint: S.isHost ? undefined : isLanIp(S.host) ? 'Проверьте Radmin VPN и что хост не закрыл программу.' : 'Проверьте интернет. Если с ним всё в порядке — сервер, возможно, перезапускается.' });
    if (S.keptVoice) { log.info('rtc', 'Звонок продолжается без сервера: голос и демки идут напрямую между компьютерами'); return; }
    if (S.stageFull) setStageFull(false);
    if (S.voice) { S.voice.leave(); }
  });
  conn.on('reconnected', async () => {
    $('conn-status').className = 'conn-dot ok';
    const token = (settings.tokens || {})[`${S.host}:${S.port}`];
    try {
      const m = await conn.request({ type: 'resume', token }).catch(() => loginWithNick(settings.nick));
      const room = S.inVoice;
      const kept = S.keptVoice && S.voice && room; S.keptVoice = false;
      enterMain(m, true);
      toast('Связь восстановлена', { kind: 'ok' });
      if (kept && serverHas('voicehold')) {
        try {
          const r = await conn.request({ type: 'voice_join', room, muted: S.muted, deafened: S.deafened, streaming: !!S.voice.screen, resume: true });
          if (r.resumed) {
            if (r.held) { S.voice.resumed(r.peers, S.iceServers); log.info('rtc', `Вернулись в «${room}» — звонок не прерывался`); }
            else { S.voice.rebuild(r.peers, S.iceServers); log.info('rtc', `Вернулись в «${room}»: сервер перезапускался — пересоздаю соединения с друзьями, микрофон и демка не выключались`); }
            if (S.voice.screen) S.conn.send({ type: 'voice_state', streaming: true });
            renderVoiceBar(); renderRooms(); renderTiles();
            return;
          }
        } catch (e) { log.warn('rtc', `Продолжить звонок не вышло (${e.message}) — захожу в комнату заново`); }
      }
      if (room) { S.inVoice = null; await localLeaveVoice(true); joinVoice(room); }
      else if (serverHas('voicehold')) conn.send({ type: 'voice_leave' }); // вышли из комнаты, пока не было связи — сервер мог держать место
    } catch (e) {
      log.error('ws', `Не удалось восстановить вход: ${e.message}`, { hint: 'Войдите заново.' });
      await localLeaveVoice(true).catch(() => {}); // голос без входа не работает — не показываем «Вы в голосе»
      show('screen-auth');
    }
  });
}

// ===================== боковая панель =====================

function renderRooms() {
  const box = $('voice-rooms'); box.textContent = '';
  for (const room of S.voiceRooms) {
    const members = S.rooms[room] || [];
    const here = S.inVoice === room;
    const wrap = el('div', { class: 'voice-room' + (here ? ' here' : '') },
      el('button', { class: 'room-btn', onclick: () => joinVoice(room) },
        icon('volume'), el('span', { text: room }),
        members.length ? el('span', { class: 'count', text: String(members.length) }) : null,
        el('span', { class: 'join', text: 'Войти' })),
    );
    const list = el('div', { class: 'vr-members' });
    for (const mem of members) {
      list.append(el('div', { class: 'vr-member', 'data-speak': mem.name, oncontextmenu: (e) => openPopover(e, mem.name) },
        avatar(mem.name), el('span', { text: mem.name }),
        el('span', { class: 'flags' }, mem.streaming ? (here && !sameName(mem.name, S.me)
          ? el('button', { class: 'live live-btn', 'data-tip': `Смотреть демку ${mem.name}`, onclick: (e) => { e.stopPropagation(); if (S.voice) { S.voice.watch(mem.name); openView('voice'); } } }, 'в эфире')
          : el('span', { class: 'live' }, 'в эфире')) : null, mem.deafened ? icon('head-off') : mem.muted ? icon('mic-off') : null)));
    }
    wrap.append(list);
    box.append(wrap);
  }
}

// Личные сообщения: все, кто есть на сервере (друзья больше не нужны)
function renderDms() {
  const box = $('dm-list'); box.textContent = '';
  const list = S.users.filter((u) => !sameName(u.name, S.me)).sort((a, b) => (S.unread.get('dm:' + b.name) || 0) - (S.unread.get('dm:' + a.name) || 0) || b.online - a.online || a.name.localeCompare(b.name));
  if (!list.length) box.append(el('div', { class: 'empty-note' }, 'Когда друзья зайдут на сервер, им можно будет написать здесь.'));
  for (const u of list) {
    const key = 'dm:' + u.name;
    const n = S.unread.get(key) || 0;
    box.append(el('button', { class: 'nav-item dm-item' + (S.chat === key && chatVisible() ? ' active' : '') + (n ? ' unread' : ''), onclick: () => openChannel(key), oncontextmenu: (e) => openPopover(e, u.name) },
      avatar(u.name, u.online), el('span', { text: u.name }), n ? el('span', { class: 'badge' }, String(n)) : null));
  }
  const g = S.unread.get('general') || 0;
  const chatHidden = !chatVisible() || S.chat !== 'general';
  $('badge-chat').hidden = !(g && chatHidden); $('badge-chat').textContent = g;
  const any = [...S.unread.values()].some((x) => x > 0);
  $('side-dot').hidden = !(any && !S.sideOpen);
}

function renderMembers() {
  const box = $('member-list'); box.textContent = '';
  const users = S.users.slice().sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
  for (const u of users) {
    const me = sameName(u.name, S.me);
    box.append(el('div', { class: 'member' + (u.online ? ' online' : ''), oncontextmenu: (e) => { if (me) { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, [{ icon: 'edit', text: 'Сменить ник', fn: () => openSettings('profile') }]); } else openPopover(e, u.name); } },
      avatar(u.name, u.online), el('span', { text: u.name + (me ? ' (вы)' : '') }),
      !me ? el('button', { class: 'icon-btn act', 'data-tip': 'Написать', onclick: () => openChannel('dm:' + u.name) }, icon('chat')) : null));
  }
  $('members-count').textContent = String(S.users.filter((u) => u.online).length);
}

// ===================== представления =====================
// Основная область — всегда голосовая комната (до входа — «прихожая»), чат и участники — панель справа.
function openView(view) {
  S.view = 'voice';
  $('view-voice').hidden = false;
  renderVoiceView(); renderDms();
}

S.sideOpen = true; S.sideTab = 'chat';
const chatVisible = () => S.sideOpen && S.sideTab === 'chat';
function setSide(open, tab) {
  S.sideOpen = !!open; if (tab) S.sideTab = tab;
  $('side').hidden = !S.sideOpen;
  $('btn-side').classList.toggle('on', S.sideOpen);
  document.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('active', b.dataset.side === S.sideTab));
  $('pane-chat').hidden = S.sideTab !== 'chat';
  $('pane-members').hidden = S.sideTab !== 'members';
  if (chatVisible()) { S.unread.delete(S.chat); const box = $('messages'); box.scrollTop = box.scrollHeight; }
  renderDms();
  placeToasts();
}
// ширину панели можно менять, потянув за её левый край (двойной щелчок — как было)
const SIDE_MIN = 280;
function sideMax() { return Math.max(SIDE_MIN, Math.min(760, innerWidth - (innerWidth <= 1120 ? 232 + 40 : 264 + 56) - 400)); } // комнате оставляем минимум 400 px (левая колонка и отступы между панелями)
function applySideWidth(w) { $('side').style.width = Math.round(Math.max(SIDE_MIN, Math.min(sideMax(), w || 380))) + 'px'; placeToasts(); }
// всплывашки — в правом верхнем углу комнаты, левее панели чата: не закрывают поле ввода и последние сообщения
function placeToasts() {
  const gap = innerWidth <= 1120 ? 10 : 14;
  const right = S.sideOpen ? $('side').getBoundingClientRect().width + gap * 2 + 10 : gap + 10;
  document.documentElement.style.setProperty('--toast-right', Math.round(right) + 'px');
}
applySideWidth(settings.sideWidth);
window.addEventListener('resize', () => applySideWidth(settings.sideWidth || 380)); // окно снова шире — возвращаем выбранную ширину
$('side-resize').addEventListener('mousedown', (e) => {
  e.preventDefault();
  document.body.classList.add('resizing');
  const move = (ev) => applySideWidth(innerWidth - ev.clientX);
  const up = () => { document.body.classList.remove('resizing'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); set({ sideWidth: parseInt($('side').style.width, 10) }); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
$('side-resize').addEventListener('dblclick', () => { applySideWidth(380); set({ sideWidth: 380 }); });
$('btn-side').onclick = () => { const open = !S.sideOpen; set({ sidePanel: open }); setSide(open); if (open && S.sideTab === 'chat') input.focus(); };
$('side-close').onclick = () => { set({ sidePanel: false }); setSide(false); };
document.querySelectorAll('[data-side]').forEach((b) => { b.onclick = () => { setSide(true, b.dataset.side); if (b.dataset.side === 'chat') input.focus(); }; });
$('chat-back').onclick = () => openChannel('general');

// ===================== чат =====================
function chatKeyOf(msg) {
  if (msg.channel === 'general') return 'general';
  return 'dm:' + (sameName(msg.author, S.me) ? msg.to : msg.author);
}

async function openChannel(key, { focus = true } = {}) {
  if (S.chat !== key) { cancelCompose(); closeSearch(); }
  S.chat = key;
  $('chat-find').hidden = !canChat2();
  if (S.view !== 'voice') openView('voice');
  if (!chatVisible()) { set({ sidePanel: true }); setSide(true, 'chat'); }
  const dm = key.startsWith('dm:');
  const name = dm ? key.slice(3) : 'Общий чат';
  setIcon($('chat-ico'), dm ? 'chat' : 'hash');
  $('chat-title').textContent = name;
  $('chat-back').hidden = !dm;
  const u = dm && S.users.find((x) => sameName(x.name, name));
  $('chat-sub').textContent = dm ? (u && u.online ? 'в сети' : 'не в сети') : '';
  $('composer-input').placeholder = dm ? `Сообщение для ${name}` : 'Сообщение для всех';
  S.unread.delete(key); renderDms();
  if (!S.chats.has(key)) {
    S.chats.set(key, { messages: [], hasMore: false, loading: true });
    renderMessages();
    await loadHistory(key);
  }
  if (S.chat !== key) return;
  renderMessages();
  if (focus) $('composer-input').focus();
}

async function loadHistory(key, before) {
  const c = S.chats.get(key);
  try {
    const req = key === 'general' ? { type: 'history', channel: 'general', before } : { type: 'history', with: key.slice(3), before };
    const r = await S.conn.request(req);
    c.messages = [...r.messages, ...c.messages.filter((m) => !r.messages.some((x) => x.id === m.id))];
    c.hasMore = r.hasMore;
  } catch (e) {
    log.warn('chat', `Не удалось загрузить историю: ${e.message}`);
  } finally { c.loading = false; }
}

// текст сообщения: ссылки кликабельны, @ник подсвечен (а упоминание вас — ярче)
function appendMentions(frag, str) {
  const re = /@([\p{L}\p{N}_.\-]{2,24})/gu;
  let last = 0; let m;
  while ((m = re.exec(str))) {
    const u = S.users.find((x) => sameName(x.name, m[1]));
    if (!u) continue;
    if (m.index > last) frag.append(str.slice(last, m.index));
    frag.append(el('span', { class: 'mention' + (sameName(u.name, S.me) ? ' me' : ''), text: '@' + u.name }));
    last = m.index + m[0].length;
  }
  if (last < str.length) frag.append(str.slice(last));
}
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) appendMentions(frag, text.slice(last, m.index));
    frag.append(el('a', { href: m[0], target: '_blank', rel: 'noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) appendMentions(frag, text.slice(last));
  return frag;
}

function msgNode(m, prev) {
  const cont = prev && !m.reply && prev.author === m.author && m.ts - prev.ts < 5 * 60e3 && new Date(prev.ts).toDateString() === new Date(m.ts).toDateString();
  const nodes = [];
  if (!prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()) nodes.push(el('div', { class: 'day-sep', text: fmtDay(m.ts) }));
  const nameEl = el('span', { class: 'author', text: m.author });
  // тело сообщения — отдельным блоком: в «Полночь Люкс» (1.20) это пузырь, свои сообщения — справа
  const row = el('div', { class: 'msg' + (cont ? ' cont' : ' first') + (sameName(m.author, S.me) ? ' mine' : ''), 'data-id': m.id, title: new Date(m.ts).toLocaleString('ru-RU') },
    cont ? null : avatar(m.author),
    el('div', { class: 'mb' },
      cont ? null : el('div', { class: 'head' }, nameEl, el('span', { class: 'time', text: fmtTime(m.ts) })),
      m.reply ? replyQuote(m.reply) : null,
      el('div', { class: 'text' }, m.text ? linkify(m.text) : null,
        m.edited ? el('span', { class: 'edited', title: 'Изменено ' + new Date(m.edited).toLocaleString('ru-RU') }, 'изменено') : null,
        m.image ? imageNode(m) : null, m.file ? fileNode(m) : null)),
    msgActions(m));
  row._msg = m;
  nodes.push(row);
  return nodes;
}

// ---------- ответы, правка, удаление (сервер с поддержкой «chat2») ----------
const canChat2 = () => serverHas('chat2');
const canEdit = (m) => canChat2() && sameName(m.author, S.me) && !m.deleted;
// чужие сообщения в общем чате удаляют хост и (1.18, сервер с «moddel») админы сервера
const canModerate = () => S.isHost || (S.isAdmin && serverHas('moddel'));
const canDelete = (m) => canChat2() && !m.deleted && (sameName(m.author, S.me) || (canModerate() && m.channel === 'general'));
const chatTargetOf = (key) => (key === 'general' ? { channel: 'general' } : { with: key.slice(3) });
// что показать в цитате: свежий текст оригинала, если он загружен, иначе выдержку, сохранённую сервером
function replyInfo(r) {
  const c = S.chats.get(S.chat);
  const orig = c && c.messages.find((x) => x.id === r.id);
  if ((orig && orig.deleted) || r.deleted) return { author: r.author, text: 'сообщение удалено', gone: true };
  const src = orig || r;
  const text = (src.text || '').replace(/\s+/g, ' ').trim();
  const att = src.image ? 'Картинка' : src.file ? 'Файл ' + (typeof src.file === 'string' ? src.file : src.file.name) : '';
  return { author: (orig && orig.author) || r.author, text: text || att || '…' };
}
function replyQuote(r) {
  const info = replyInfo(r);
  return el('button', { class: 'reply-quote' + (info.gone ? ' gone' : ''), type: 'button', 'data-tip': info.gone ? null : 'Перейти к сообщению', onclick: () => { if (!info.gone) jumpToMessage(r.id); } },
    icon('reply'), el('b', { text: info.author }), el('span', { text: info.text }));
}
function msgActions(m) {
  if (!canChat2() || m.deleted) return null;
  const b = (ic, tip, fn, cls = '') => el('button', { class: 'icon-btn ' + cls, type: 'button', 'data-tip': tip, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic));
  return el('div', { class: 'msg-acts' },
    b('reply', 'Ответить', () => startReply(m)),
    canEdit(m) ? b('edit', 'Изменить', () => startEdit(m)) : null,
    canDelete(m) ? b('trash', 'Удалить', () => deleteMessage(m), 'danger') : null);
}

S.compose = null; // { mode: 'reply' | 'edit', msg, draft }
function renderCompose() {
  const c = S.compose;
  $('compose-ctx').hidden = !c;
  if (!c) return;
  const edit = c.mode === 'edit';
  setIcon($('compose-ctx-ico'), edit ? 'edit' : 'reply');
  $('compose-ctx-title').textContent = edit ? 'Изменение сообщения' : `Ответ для ${c.msg.author}`;
  const info = replyInfo({ id: c.msg.id, author: c.msg.author, text: c.msg.text, image: !!c.msg.image, file: c.msg.file ? c.msg.file.name : undefined });
  $('compose-ctx-sub').textContent = info.text;
  $('composer').classList.toggle('editing', edit);
}
function startReply(m) {
  if (S.compose && S.compose.mode === 'edit') cancelCompose();
  S.compose = { mode: 'reply', msg: m };
  renderCompose(); input.focus();
}
function startEdit(m) {
  const draft = S.compose && S.compose.mode === 'edit' ? S.compose.draft : input.value;
  S.compose = { mode: 'edit', msg: m, draft };
  input.value = m.text || '';
  input.dispatchEvent(new Event('input'));
  renderCompose(); input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function cancelCompose() {
  const c = S.compose; if (!c) return;
  S.compose = null;
  if (c.mode === 'edit') { input.value = c.draft || ''; input.dispatchEvent(new Event('input')); }
  renderCompose();
}
$('compose-ctx-x').onclick = () => { cancelCompose(); input.focus(); };
async function deleteMessage(m) {
  const what = m.image ? 'Сообщение с картинкой' : m.file && !m.file.p2p ? 'Сообщение с файлом' : 'Сообщение';
  const extra = (m.image || (m.file && !m.file.p2p)) ? ' Картинка или файл удалятся с сервера.' : '';
  const whose = sameName(m.author, S.me) ? '' : ` от ${m.author}`;
  if (!confirm(`${what}${whose} удалится у всех.${extra} Удалить?`)) return;
  try {
    await S.conn.request({ type: 'chat_delete', ...chatTargetOf(chatKeyOf(m)), id: m.id });
    if (m.file && m.file.p2p && sameName(m.author, S.me)) api.p2p.unshare(m.file.id).catch(() => {}); // своя раздача «напрямую» больше не нужна
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
// сервер прислал изменённое или удалённое сообщение
function onChatUpdate(msg) {
  const key = chatKeyOf(msg);
  const c = S.chats.get(key);
  if (!c) return;
  let touched = false;
  for (const x of c.messages) { // цитаты в ответах обновляем, даже если сам оригинал ещё не подгружен
    if (!x.reply || x.reply.id !== msg.id) continue;
    x.reply = msg.deleted ? { id: msg.id, author: x.reply.author, deleted: true } : { ...x.reply, text: String(msg.text || '').slice(0, 200) };
    touched = true;
  }
  const i = c.messages.findIndex((x) => x.id === msg.id);
  if (i >= 0) c.messages[i] = msg;
  if (i < 0 && !touched) return;
  if (S.compose && S.compose.msg.id === msg.id) { if (msg.deleted) cancelCompose(); else { S.compose.msg = msg; renderCompose(); } }
  if (S.chat === key) renderMessages({ keepScroll: true });
}
// ---------- поиск по переписке (на сервере, по всей сохранённой истории) ----------
let searchTimer = null, searchSeq = 0;
function openSearch() {
  if (!canChat2() || !chatVisible()) return;
  $('chat-search').hidden = false;
  const f = $('chat-search-input'); f.focus(); f.select();
  if (f.value.trim().length >= 2) runSearch();
}
function closeSearch() {
  clearTimeout(searchTimer); searchSeq++;
  $('chat-search').hidden = true; $('search-results').hidden = true; $('messages').hidden = false;
}
$('chat-find').onclick = () => ($('chat-search').hidden ? openSearch() : closeSearch());
$('chat-search-close').onclick = () => { closeSearch(); input.focus(); };
$('chat-search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
$('chat-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); input.focus(); }
  if (e.key === 'Enter') { e.preventDefault(); const first = $('search-results').querySelector('.sr-item'); if (first) first.click(); }
});
const normSearch = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е');
// подсветка найденного: позиции совпадают, потому что замена ё→е и строчные буквы не меняют длину
function highlight(text, q) {
  const frag = document.createDocumentFragment();
  const hay = normSearch(text), needle = normSearch(q);
  let i = 0, j;
  while (needle && (j = hay.indexOf(needle, i)) >= 0) {
    if (j > i) frag.append(text.slice(i, j));
    frag.append(el('mark', { text: text.slice(j, j + needle.length) }));
    i = j + needle.length;
  }
  frag.append(text.slice(i));
  return frag;
}
async function runSearch() {
  const q = $('chat-search-input').value.trim();
  const box = $('search-results');
  if (q.length < 2) { box.hidden = true; $('messages').hidden = false; return; }
  const seq = ++searchSeq; const key = S.chat;
  box.hidden = false; $('messages').hidden = true;
  if (!box.childElementCount) box.replaceChildren(el('div', { class: 'sr-note', text: 'Ищу…' }));
  let r;
  try { r = await S.conn.request({ type: 'chat_search', ...chatTargetOf(key), q }); } catch (err) {
    if (seq === searchSeq) box.replaceChildren(el('div', { class: 'sr-note', text: 'Не получилось найти: ' + err.message }));
    return;
  }
  if (seq !== searchSeq || S.chat !== key) return;
  const items = r.results.map((m) => {
    const text = (m.text || '').replace(/\s+/g, ' ').trim();
    const sub = text ? highlight(text.length > 220 ? text.slice(0, 220) + '…' : text, q) : m.file ? highlight('Файл ' + m.file.name, q) : 'Картинка';
    return el('button', { class: 'sr-item', type: 'button', onclick: () => { closeSearch(); jumpToMessage(m.id); } },
      avatar(m.author),
      el('div', { class: 'sr-body' },
        el('div', { class: 'sr-head' }, el('b', { text: m.author }), el('span', { text: `${fmtDay(m.ts)}, ${fmtTime(m.ts)}` })),
        el('div', { class: 'sr-text' }, sub)));
  });
  const head = !r.total ? 'Ничего не нашлось' : r.total > r.results.length ? `Найдено ${r.total}, показаны последние ${r.results.length}` : `Найдено: ${r.total}`;
  box.replaceChildren(el('div', { class: 'sr-note', text: head }), ...items);
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'KeyF' && !$('screen-main').hidden && !document.querySelector('dialog[open]')) { e.preventDefault(); openSearch(); }
});

// перейти к сообщению: при необходимости догружаем историю вверх
async function jumpToMessage(id) {
  const key = S.chat; const c = S.chats.get(key);
  if (!c) return;
  for (let n = 0; n < 45 && !c.messages.some((x) => x.id === id) && c.hasMore; n++) {
    const oldest = c.messages[0] && c.messages[0].id;
    await loadHistory(key, oldest);
    if (S.chat !== key) return;
  }
  const m = c.messages.find((x) => x.id === id);
  if (!m || m.deleted) { renderMessages({ keepScroll: true }); toast('Этого сообщения уже нет — его удалили или оно слишком старое'); return; }
  renderMessages({ keepScroll: true });
  const row = $('messages').querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}

function renderMessages({ keepScroll = false } = {}) {
  const box = $('messages');
  const c = S.chats.get(S.chat);
  const fromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
  box.textContent = '';
  if (!c) return;
  if (c.hasMore) box.append(el('button', { class: 'btn small load-more', onclick: async () => { const h = box.scrollHeight; await loadHistory(S.chat, c.messages[0] && c.messages[0].id); renderMessages(); box.scrollTop = box.scrollHeight - h; } }, 'Загрузить ещё'));
  if (c.loading) box.append(el('div', { class: 'empty-state', text: 'Загрузка…' }));
  const list = c.messages.filter((m) => !m.deleted);
  if (!c.loading && !list.length) box.append(S.chat === 'general' ? welcomeCard() : el('div', { class: 'empty-state' }, el('b', { text: `Это начало переписки с ${S.chat.slice(3)}` }), 'Сообщения видите только вы двое.'));
  let prev = null;
  for (const m of list) { box.append(...msgNode(m, prev)); prev = m; }
  box.scrollTop = keepScroll ? box.scrollHeight - box.clientHeight - fromBottom : box.scrollHeight;
}

function welcomeCard() {
  const step = (ic, title, sub, btnText, fn) => el('div', { class: 'wstep' },
    el('span', { class: 'wi' }, icon(ic)), el('div', {}, el('b', { text: title }), el('small', { text: sub })),
    el('button', { class: 'btn small', onclick: fn }, btnText));
  return el('div', { class: 'welcome' },
    el('h3', { text: `Привет, ${S.me}!` }),
    el('p', { text: 'Это общий чат сервера. Вот что можно сделать:' }),
    el('div', { class: 'welcome-steps' },
      step('user-plus', 'Позвать друзей', 'Отправьте им адрес сервера', 'Позвать', openInvite),
      step('screen', 'Показать экран', 'Зайдите в комнату и нажмите кнопку показа', 'Показать', async () => { if (!S.inVoice) await joinVoice(S.voiceRooms[0]); openPicker(); }),
      step('sliders', 'Проверить микрофон', 'Посмотрите, слышно ли вас', 'Проверить', () => openSettings())));
}

const seenMsgIds = new Set(); // одно и то же сообщение не считаем непрочитанным дважды
function onChat(msg) {
  if (seenMsgIds.has(msg.id)) return;
  seenMsgIds.add(msg.id); if (seenMsgIds.size > 2000) seenMsgIds.delete(seenMsgIds.values().next().value);
  const key = chatKeyOf(msg);
  const c = S.chats.get(key);
  const mine = sameName(msg.author, S.me);
  if (c && !c.messages.some((m) => m.id === msg.id)) {
    c.messages.push(msg);
    if (S.chat === key) {
      const box = $('messages');
      box.querySelectorAll(':scope > .welcome, :scope > .empty-state').forEach((x) => x.remove()); // переписка началась — приветствие больше не нужно
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      const prevShown = [...c.messages].slice(0, -1).reverse().find((x) => !x.deleted) || null;
      box.append(...msgNode(msg, prevShown));
      if (atBottom || mine) box.scrollTop = box.scrollHeight;
    }
  }
  // журнал, который админ попросил кнопкой «Скачать журнал» (1.18), — сразу в «Загрузки»
  const wait = !mine && msg.file && !msg.file.p2p && logWait.get(nickKey(msg.author));
  if (wait && Date.now() < wait && /^Skhodka-zhurnal-/.test(msg.file.name || '')) {
    logWait.delete(nickKey(msg.author));
    startDownload(msg.file);
    log.info('ui', `Журнал от ${msg.author} пришёл — скачиваю в «Загрузки» (${msg.file.name})`);
  }
  const seen = S.chat === key && chatVisible();
  if (!mine && (!seen || !document.hasFocus())) {
    if (!seen) S.unread.set(key, (S.unread.get(key) || 0) + 1);
    renderDms();
    output.beep('message');
    if (key !== 'general') api.notify(msg.author, msg.text ? msg.text.slice(0, 120) : msg.file ? '📎 ' + msg.file.name : '📷 Картинка');
  }
}

const input = $('composer-input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!S.chat) return;
  const ctx = S.compose;
  if (ctx && ctx.mode === 'edit') {
    const m = ctx.msg;
    if (!text && !m.image && !m.file) { deleteMessage(m); return; } // стёрли весь текст — предлагаем удалить
    if (text === (m.text || '')) { cancelCompose(); return; }
    try {
      await S.conn.request({ type: 'chat_edit', ...chatTargetOf(chatKeyOf(m)), id: m.id, text });
      if (S.compose === ctx) { S.compose = null; input.value = ctx.draft || ''; input.dispatchEvent(new Event('input')); renderCompose(); }
    } catch (err) { toast(err.message, { kind: 'error' }); }
    return;
  }
  if (!text) return;
  input.value = ''; input.style.height = 'auto';
  const reply = ctx && ctx.mode === 'reply' && chatKeyOf(ctx.msg) === S.chat ? ctx.msg.id : undefined;
  if (ctx) { S.compose = null; renderCompose(); }
  try {
    await S.conn.request(S.chat === 'general' ? { type: 'chat_send', channel: 'general', text, reply } : { type: 'chat_send', to: S.chat.slice(3), text, reply });
  } catch (err) {
    input.value = text;
    if (ctx) { S.compose = ctx; renderCompose(); }
    log.error('chat', `Сообщение не отправлено: ${err.message}`);
  }
});
// стрелка вверх в пустом поле — изменить своё последнее сообщение; Esc — отменить ответ или правку
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.compose) { e.preventDefault(); e.stopPropagation(); cancelCompose(); return; }
  if (e.key === 'ArrowUp' && !input.value && !S.compose && canChat2()) {
    const c = S.chats.get(S.chat);
    const last = c && [...c.messages].reverse().find((m) => !m.deleted && sameName(m.author, S.me) && m.text);
    if (last) { e.preventDefault(); startEdit(last); }
  }
});

// ===================== смена ника =====================
// Сервер переименовал пользователя (или объединил старый ник того же компьютера с новым):
// переносим переписку, громкость, голосовое соединение — ничего не теряется.
function onRenamed(from, to, merged) {
  const self = sameName(from, S.me);
  if (self && !merged) {
    // копия аватарки на компьютере хранится под ником — переносим под новый
    const la = localAvatar(from); if (la) saveLocalAvatar(to, { bytes: la.bytes, type: la.type }).then(refreshAvatars).catch(() => {});
    S.me = to; set({ nick: to });
    $('me-name').textContent = S.me;
    $('me-avatar').replaceWith(Object.assign(avatar(S.me), { id: 'me-avatar' }));
  }
  for (const c of S.chats.values()) for (const msg of c.messages) {
    if (sameName(msg.author, from)) msg.author = to;
    if (msg.to && sameName(msg.to, from)) msg.to = to;
    if (msg.reply && sameName(msg.reply.author, from)) msg.reply.author = to;
  }
  const oldKey = 'dm:' + from, newKey = 'dm:' + to;
  for (const k of [...S.chats.keys()]) if (sameName(k, oldKey)) {
    const c = S.chats.get(k); S.chats.delete(k);
    const ex = S.chats.get(newKey);
    S.chats.set(newKey, ex ? { ...ex, messages: [...ex.messages, ...c.messages].sort((a, b) => a.ts - b.ts) } : c);
  }
  for (const k of [...S.unread.keys()]) if (sameName(k, oldKey)) { S.unread.set(newKey, (S.unread.get(newKey) || 0) + S.unread.get(k)); S.unread.delete(k); }
  const vols = settings.userVolumes || {};
  const vk = Object.keys(vols).find((k) => sameName(k, from));
  if (vk && !self) { const nv = { ...vols, [to]: vols[vk] }; delete nv[vk]; set({ userVolumes: nv }); }
  if (S.voice) S.voice.renamePeer(from, to);
  if (S.chat && sameName(S.chat, oldKey)) S.chat = newKey;
  if (!merged) {
    log.info('ui', self ? `Ваш ник теперь «${to}»` : `${from} сменил(а) ник на «${to}»`);
    if (!self) toast(`${from} теперь ${to}`);
  }
  renderAll();
  if (S.chat.startsWith('dm:')) $('chat-title').textContent = S.chat.slice(3);
  renderMessages();
}

$('nick-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('s-nick').value.trim();
  if (!S.conn || !S.me) return toast('Сначала подключитесь к серверу', { kind: 'error' });
  if (name === S.me) return;
  $('s-nick-save').disabled = true;
  try {
    await S.conn.request({ type: 'rename', name });
    toast(`Готово: теперь вы ${name}`, { kind: 'ok' });
  } catch (err) {
    toast(err.message, { kind: 'error' });
    $('s-nick').value = S.me;
  } finally { $('s-nick-save').disabled = false; }
});
$('me-name').dataset.tip = 'Профиль: ник, аватарка, пароль';
$('me-name').onclick = () => openSettings('profile');

// ---------- аватарка в профиле ----------
function paintProfileAvatar() {
  const box = $('s-avatar'); if (!box) return;
  const name = S.me || settings.nick || '?';
  box.replaceChildren(avatar(name));
  const mine = S.users && S.me && S.users.find((x) => sameName(x.name, S.me));
  $('s-avatar-clear').hidden = !(localAvatar(S.me) || (mine && mine.avatar));
  const can = !S.conn || serverHas('avatar');
  $('s-avatar-hint').textContent = can ? 'Картинка JPG, PNG или WebP — после выбора её можно обрезать кружком. Видна всем, на любом вашем компьютере.'
    : 'Хост ещё не обновил Сходку: аватарку видите только вы. Друзья увидят её, как только он обновится.';
}
async function pickAvatar(file) {
  try {
    const a = await chooseAvatar(file);
    if (!a) return;
    if (S.conn && S.me && serverHas('avatar')) await uploadAvatar(a);
    S.avatarOff = false;
    await saveLocalAvatar(S.me || settings.nick, a);
    refreshAvatars();
    toast('Аватарка сохранена', { kind: 'ok' });
  } catch (e) { toast(e.message, { kind: 'error', hint: 'Аватарка не сохранилась — попробуйте ещё раз.' }); }
}
$('s-avatar').onclick = () => $('s-avatar-file').click();
$('s-avatar-choose').onclick = () => $('s-avatar-file').click();
$('s-avatar-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pickAvatar(f); };
$('s-avatar-clear').onclick = async () => {
  try {
    if (S.conn && S.me && serverHas('avatar')) await S.conn.request({ type: 'avatar_clear' });
    S.avatarOff = true;
    await saveLocalAvatar(S.me || settings.nick, null); refreshAvatars(); toast('Аватарка убрана', { kind: 'ok' });
  } catch (e) { toast(e.message, { kind: 'error' }); }
};
loadLocalAvatar(settings.nick).then(() => refreshAvatars());

// ---------- пароль аккаунта ----------
function paintPasswordUi() {
  const can = !!(S.conn && S.me && serverHas('password'));
  const has = !!S.hasPassword;
  $('s-pw-user').value = S.me || '';
  $('s-pw-state').className = 'hint small' + (has ? ' ok' : '');
  $('s-pw-state').textContent = !S.me ? 'Подключитесь к серверу, чтобы задать пароль.'
    : !can ? 'Хост ещё не обновил Сходку — пароль можно будет задать после обновления.'
      : has ? 'Пароль задан. С другого компьютера: введите ник, нажмите «Войти с паролем» и введите его — дальше тот компьютер будет входить сам.'
        : 'Пароль не задан: под вашим ником можно войти только с этого компьютера. Задайте пароль — и ник не потеряется, даже если переустановить Windows или удалить папку Сходки.';
  $('s-pw-cur-row').hidden = !has;
  $('s-pw-new-label').textContent = has ? 'Новый пароль' : 'Пароль';
  $('s-pw-save').textContent = has ? 'Сменить пароль' : 'Задать пароль';
  for (const id of ['s-pw-cur', 's-pw-new', 's-pw-save']) $(id).disabled = !can;
}
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('s-pw-new').value;
  if (pw.length < 6) return toast('Пароль — минимум 6 символов', { kind: 'error' });
  $('s-pw-save').disabled = true;
  try {
    await S.conn.request({ type: 'set_password', password: pw, current: $('s-pw-cur').value });
    const had = S.hasPassword; S.hasPassword = true;
    $('s-pw-cur').value = ''; $('s-pw-new').value = '';
    toast(had ? 'Пароль изменён' : 'Пароль задан — теперь можно войти под своим ником с любого компьютера', { kind: 'ok' });
  } catch (err) { toast(err.message, { kind: 'error' }); } finally { paintPasswordUi(); }
});

// ===================== картинки в чате =====================
let uploading = Promise.resolve();
let currentUpload = null; // { abort }
const IMAGE_COMPRESS_MAX = 40e6; // картинки до 40 МБ показываем в чате (ужимаем), больше — уходят файлом
function sendFiles(files) {
  const list = [...files];
  const view = S.chat;
  if (!list.length || !view) return;
  for (const file of list) {
    const asImage = /^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type) && file.size <= IMAGE_COMPRESS_MAX;
    uploading = uploading.then(() => (asImage ? sendOneImage(file, view) : sendOneFile(file, view))).catch(() => {});
  }
}
const sendImages = sendFiles; // вставка из буфера и перетаскивание
function uploadUi(label) {
  $('upload-bar').hidden = false; $('upload-progress').style.width = '0%';
  $('upload-text').textContent = label; $('upload-meta').textContent = '';
}
function takeComposerText(view) {
  if (S.compose && S.compose.mode === 'edit') return ''; // в поле — текст правки, а не подпись к картинке
  const text = S.chat === view ? input.value.trim() : '';
  if (text) { input.value = ''; input.style.height = 'auto'; }
  return text;
}
const chatBase = (view) => {
  const base = view === 'general' ? { type: 'chat_send', channel: 'general' } : { type: 'chat_send', to: view.slice(3) };
  if (S.compose && S.compose.mode === 'reply' && chatKeyOf(S.compose.msg) === view) { base.reply = S.compose.msg.id; S.compose = null; renderCompose(); }
  return base;
};
async function sendOneImage(file, view) {
  uploadUi(`Отправляю ${file.name && !/^image\.\w+$/.test(file.name) ? '«' + file.name + '»' : 'картинку'}…`);
  $('upload-cancel').hidden = true;
  try {
    const img = await prepareImage(file);
    const token = (settings.tokens || {})[`${S.host}:${S.port}`];
    const id = await uploadImage(S, token, img.blob, (f) => { $('upload-progress').style.width = Math.round(f * 100) + '%'; });
    await S.conn.request({ ...chatBase(view), text: takeComposerText(view), image: { id, w: img.w, h: img.h } });
    log.debug('chat', `Картинка отправлена: ${img.w}×${img.h}, ${Math.round(img.blob.size / 1024)} КБ`);
  } catch (err) {
    toast(err.message, { kind: 'error' });
    log.warn('chat', `Картинка не отправлена: ${err.message}`);
  } finally { $('upload-bar').hidden = true; }
}
// Файлы по умолчанию идут через сервер (1.15): доходят у всех, даже у кого напрямую не получается,
// и скачать их можно, когда отправитель уже выключил компьютер. Напрямую с вашего компьютера —
// если вы так выбрали в настройках (файлы от 10 МБ) или на сервере не хватает места.
const P2P_MIN = 10 * 1024 * 1024;
const canP2P = () => serverHas('p2p') && p2pAvailable();
async function pickFileRoute(file) {
  if (!canP2P()) return 'server';
  if (settings.filesDirect && file.size >= P2P_MIN) return 'p2p';
  if (file.size >= 256 * 1024 * 1024 && serverHas('space')) {
    try {
      const r = await S.conn.request({ type: 'files_space' });
      if (file.size > r.free) { log.info('chat', `На сервере свободно ${fmtSize(r.free)}, а файл ${fmtSize(file.size)} — отправляю напрямую с вашего компьютера`); return 'p2p-space'; }
    } catch (_) { /* не узнали — пробуем через сервер */ }
  }
  return 'server';
}
// plain — без подписи из поля ввода и без «ответа» (журнал из кнопки «В чат»); вернёт true, если файл ушёл
async function sendOneFile(file, view, { plain = false } = {}) {
  const base = () => (plain ? (view === 'general' ? { type: 'chat_send', channel: 'general' } : { type: 'chat_send', to: view.slice(3) }) : chatBase(view));
  const caption = () => (plain ? '' : takeComposerText(view));
  const route = await pickFileRoute(file);
  if (route !== 'server') {
    try {
      const id = newFileId();
      const where = await p2p.share(file, id);
      shareState.set(id, { ok: true, path: where });
      await S.conn.request({ ...base(), text: caption(), p2p: { id, name: file.name, size: file.size, type: file.type } });
      log.info('chat', `Файл «${file.name}» (${fmtSize(file.size)}) отправлен напрямую: друзья скачают его с вашего компьютера, пока вы в сети`);
      if (route === 'p2p-space') toast('На сервере мало места — файл отправлен напрямую с вашего компьютера', { hint: 'Друзья скачают его, пока «Сходка» у вас включена.', timeout: 9000 });
      return true;
    } catch (err) { log.warn('chat', `Напрямую отправить не получилось (${err.message}) — отправляю через сервер`); }
  }
  uploadUi(`Отправляю «${file.name}»`);
  $('upload-cancel').hidden = false;
  const token = (settings.tokens || {})[`${S.host}:${S.port}`];
  const t0 = performance.now();
  try {
    const up = uploadFile(S, token, file, (done, total) => {
      $('upload-progress').style.width = (done / total * 100).toFixed(1) + '%';
      const sec = (performance.now() - t0) / 1000; const speed = done / Math.max(sec, 0.3);
      const left = speed > 0 ? (total - done) / speed : 0;
      $('upload-meta').textContent = `${fmtSize(done)} из ${fmtSize(total)} · ${fmtSize(speed)}/с${left > 3 ? ' · ещё ' + fmtEta(left) : ''}`;
    });
    currentUpload = up;
    const id = await up.promise;
    await S.conn.request({ ...base(), text: caption(), file: { id } });
    log.info('chat', `Файл отправлен: «${file.name}» (${fmtSize(file.size)}) за ${fmtEta((performance.now() - t0) / 1000)}`);
    return true;
  } catch (err) {
    if (!err.canceled) { toast(err.message, { kind: 'error' }); log.warn('chat', `Файл «${file.name}» не отправлен: ${err.message}`); }
    return false;
  } finally { currentUpload = null; $('upload-bar').hidden = true; }
}

// ---------- «Журнал»: архив на рабочий стол и журнал в чат (1.16.2) ----------
// Все файлы журналов одним архивом на рабочий стол (собирает главный процесс, main/zip.js)
$('log-zip').onclick = async () => {
  const b = $('log-zip');
  if (b.disabled) return;
  b.disabled = true;
  try {
    const r = await api.logZipToDesktop();
    if (!r || !r.ok) throw new Error((r && r.error) || 'не получилось');
    toast('Архив журналов — на рабочем столе', { kind: 'ok', hint: `${r.name} · ${r.files} ${plural(r.files, 'файл', 'файла', 'файлов')}, ${fmtSize(r.bytes)}`, timeout: 9000 });
  } catch (e) {
    toast(`Архив журналов не сохранён: ${e.message}`, { kind: 'error' });
  } finally { b.disabled = false; }
};
// ---------- журнал по просьбе админа (1.18) ----------
// Админ нажимает «Скачать журнал» в меню человека: сервер передаёт просьбу, программа этого человека сама
// отправляет два последних журнала архивом админу в личку, а у админа архив сразу скачивается (onChat).
// Человеку ничего делать не нужно — он только видит уведомление, что админ забрал журнал.
const nickKey = (n) => String(n || '').trim().toLowerCase();
const logWait = new Map(); // у админа: ключ ника → до какого времени ждём от него журнал
async function requestLog(name) {
  const k = nickKey(name);
  try {
    await S.conn.request({ type: 'log_request', to: name });
    logWait.set(k, Date.now() + 90000);
    toast(`Прошу журнал у ${name} — он придёт в личку и сразу скачается`, { kind: 'ok' });
    log.info('ui', `Попросил журнал у ${name}`);
    setTimeout(() => {
      if (!logWait.has(k) || Date.now() < logWait.get(k)) return;
      logWait.delete(k);
      toast(`${name} не прислал журнал`, { kind: 'error', hint: 'Скорее всего, у него «Сходка» старее 1.18 — тогда журнал придётся прислать вручную: «Журнал» → «В чат».' });
    }, 91000);
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
let logSending = false;
async function sendLogToAdmin(admin) {
  if (logSending) return;
  logSending = true;
  try {
    const r = await api.logForAdmin(S.me);
    if (!r || !r.data) { log.warn('ui', `${admin} попросил журнал, но журналов пока нет`); return; }
    const file = new File([r.data], r.name, { type: 'application/zip' });
    let ok = false;
    uploading = uploading.then(async () => { ok = await sendOneFile(file, 'dm:' + admin, { plain: true }); }).catch(() => {});
    await uploading;
    if (ok) {
      toast(`Админ ${admin} забрал ваш журнал`, { hint: 'Программа сама отправила ему журнал за последние дни в личку — ничего делать не нужно.', timeout: 9000 });
      log.info('ui', `Журнал (${r.files} ${plural(r.files, 'файл', 'файла', 'файлов')}, ${fmtSize(file.size)}) отправлен админу ${admin} по его просьбе`);
    }
  } catch (e) { log.warn('ui', `Журнал админу ${admin} не отправлен: ${e.message}`); } finally { logSending = false; }
}
// Журнал за сегодня — сразу файлом в тот чат, что открыт справа (общий или личка)
$('log-send').onclick = async () => {
  const b = $('log-send');
  if (b.disabled) return;
  if (!S.conn || !S.me) { toast('Сначала подключитесь к серверу'); return; }
  const view = S.chat || 'general';
  const where = view === 'general' ? 'общий чат' : `личку ${view.slice(3)}`;
  b.disabled = true;
  try {
    const r = await api.logLatest();
    if (!r || !r.data) { toast('Журналов пока нет'); return; }
    const file = new File([r.data], r.name, { type: 'text/plain' });
    let ok = false;
    uploading = uploading.then(async () => { ok = await sendOneFile(file, view, { plain: true }); }).catch(() => {});
    await uploading;
    if (ok) {
      toast(`Журнал отправлен в ${where}`, { kind: 'ok', hint: `${r.name}, ${fmtSize(file.size)}` });
      log.info('ui', `Журнал «${r.name}» (${fmtSize(file.size)}) отправлен в ${where}`);
    }
  } catch (e) {
    toast(`Журнал не отправлен: ${e.message}`, { kind: 'error' });
  } finally { b.disabled = false; }
};
function fmtEta(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} с`;
  if (sec < 3600) return `${Math.floor(sec / 60)} мин ${sec % 60 ? (sec % 60) + ' с' : ''}`.trim();
  return `${Math.floor(sec / 3600)} ч ${Math.round((sec % 3600) / 60)} мин`;
}
$('upload-cancel').onclick = () => { if (currentUpload) currentUpload.abort(); };
$('composer-attach').onclick = () => $('composer-file').click();
$('composer-file').onchange = (e) => { sendFiles(e.target.files); e.target.value = ''; };
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData && e.clipboardData.files || [])];
  if (files.length) { e.preventDefault(); sendFiles(files); }
});
{
  const view = $('pane-chat'); let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  view.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('drop-hint').hidden = false; });
  view.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  view.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop-hint').hidden = true; } });
  view.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $('drop-hint').hidden = true; sendFiles(e.dataTransfer.files); });
}

function imageNode(m) {
  const { w, h } = m.image;
  const k = Math.min(1, w ? 400 / w : 1, h ? 300 / h : 1);
  const dw = w ? Math.round(w * k) : 300, dh = h ? Math.round(h * k) : 200;
  const img = el('img', { class: 'chat-img', src: imageUrl(S, m.image.id), alt: 'картинка', loading: 'lazy', width: dw, height: dh, onclick: () => openLightbox(m) });
  img._msg = m;
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => img.replaceWith(el('div', { class: 'chat-img-gone' }, icon('image'), 'Картинка больше недоступна (на сервере закончилось место или её удалили)'));
  return img;
}

// ---- карточка файла и скачивание ----
// состояние скачиваний: id файла → { status: 'idle'|'loading'|'done'|'error', received, total, path }
const dls = new Map();
const savedPaths = () => settings.downloads || {};
function rememberPath(id, p) {
  const d = { ...savedPaths(), [id]: p };
  const keys = Object.keys(d); if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete d[k];
  set({ downloads: d });
}
const FILE_ICON = { archive: 'file', video: 'play', audio: 'volume', app: 'screen', doc: 'list', file: 'file' };
const fileAuthor = new Map();   // id файла → кто отправил (для прямой передачи)
const shareState = new Map();   // свои файлы «напрямую»: id → { ok, code, path } — раздаются ли сейчас
const p2p = new P2PFiles({
  send: (to, toConn, data) => { if (S.conn) S.conn.send({ type: 'p2p', to, toConn: toConn || undefined, data }); },
  getIce: () => S.iceServers,
  getRelayOnly: () => !!S.relayOnly,
  onState: (id, st) => {
    dls.set(id, st);
    // недокачанное «напрямую» запоминаем — докачать можно и после перезапуска программы
    const parts = { ...(settings.p2pParts || {}) };
    if (st.part && st.status !== 'done') parts[id] = st.part; else delete parts[id];
    if (JSON.stringify(parts) !== JSON.stringify(settings.p2pParts || {})) set({ p2pParts: parts });
    if (st.status === 'done') { rememberPath(id, st.path); toast('Файл скачан', { kind: 'ok', onclick: () => api.showInFolder(st.path) }); }
    if (st.status === 'error' && st.code === 'offline') { const f = (document.querySelector(`.file-card[data-file="${id}"]`) || {})._msg; toast(`${(f && f.author) || 'Отправитель'} вышел из сети — ${f ? '«' + f.file.name + '» ' : 'файл '}докачается сам, когда он зайдёт`); }
    else if (st.status === 'error' && st.error) toast(`Файл не скачался: ${st.error}`, { kind: 'error' });
    refreshFileCards(id);
  },
  onSendInfo: (id, info) => {
    const cur = shareState.get(id) || { ok: true };
    const active = new Set(cur.active || []); if (info.active) active.add(info.to); else active.delete(info.to);
    shareState.set(id, { ...cur, active: [...active], sent: (cur.sent || 0) + (info.done ? 1 : 0) });
    refreshFileCards(id);
  },
});
const isOnlineUser = (name) => !!(S.users || []).find((u) => sameName(u.name, name) && u.online);
// Отправитель снова в сети — недокачанные напрямую файлы продолжают качаться сами. Только в момент,
// когда он зашёл (был «не в сети» → стал «в сети»), а не на каждое обновление списка — иначе бесконечные попытки.
const wasOnline = new Map();
function refreshP2PCards() {
  document.querySelectorAll('.file-card.p2p').forEach(renderFileCard);
  const cameOnline = new Set();
  for (const u of S.users || []) { const k = lower(u.name); if (u.online && wasOnline.get(k) === false) cameOnline.add(k); wasOnline.set(k, !!u.online); }
  if (!cameOnline.size) return;
  for (const [id, st] of dls) {
    if (st.status !== 'error' || !st.p2p || !st.part || !['offline', 'noconnect'].includes(st.code)) continue;
    const author = fileAuthor.get(id); const card = document.querySelector(`.file-card[data-file="${id}"]`);
    if (author && card && cameOnline.has(lower(author))) { log.info('chat', `${author} снова в сети — продолжаю скачивать «${card._msg.file.name}»`); startDownload(card._msg.file); }
  }
}
function fileNode(m) {
  const card = el('div', { class: 'file-card' + (m.file.p2p ? ' p2p' : ''), 'data-file': m.file.id });
  card._msg = m;
  fileAuthor.set(m.file.id, m.author);
  renderFileCard(card);
  return card;
}
function renderFileCard(card) {
  const m = card._msg; const f = m.file;
  const part = f.p2p && (settings.p2pParts || {})[f.id];
  const st = dls.get(f.id) || (savedPaths()[f.id] ? { status: 'done', path: savedPaths()[f.id] } : part ? { status: 'error', error: 'недокачан — можно продолжить', part, p2p: true } : { status: 'idle' });
  card.textContent = '';
  card.classList.toggle('deleted', !!f.deleted);
  const ico = el('div', { class: 'fc-ico ' + fileKind(f.name) }, icon(FILE_ICON[fileKind(f.name)] || 'file'));
  const info = el('div', { class: 'fc-info' }, el('div', { class: 'fc-name', text: f.name, title: f.name }));
  let sub;
  const mine = f.p2p && sameName(m.author, S.me);
  const share = mine ? shareState.get(f.id) : null;
  if (mine && !share) api.p2p.check(f.id).then((r) => { shareState.set(f.id, r); renderFileCard(card); });
  if (f.deleted) sub = 'Файл удалён с сервера';
  else if (mine) {
    const active = share && share.active && share.active.length;
    sub = `${fmtSize(f.size)} · ` + (!share ? '…' : active ? `отдаю напрямую: ${share.active.join(', ')}` : share.ok ? 'раздаётся с вашего компьютера' : share.code === 'changed' ? 'файл изменился — больше не раздаётся' : share.code === 'gone' ? 'файла больше нет на месте' : 'не раздаётся');
  } else if (st.status === 'loading') sub = st.total ? `${fmtSize(st.received || 0)} из ${fmtSize(st.total)}${st.connecting ? ' · соединяюсь напрямую…' : st.stalled ? ' · связь прервалась, продолжаю…' : st.speed ? ` · ${fmtSize(st.speed)}/с` : ''}` : 'Начинаю скачивание…';
  else if (st.status === 'done') sub = `${fmtSize(f.size)} · скачан`;
  else if (st.status === 'error') sub = `${fmtSize(f.size)} · ${st.error || 'не скачался, попробуйте ещё раз'}`;
  else sub = f.p2p ? `${fmtSize(f.size)} · напрямую от ${m.author}${isOnlineUser(m.author) ? '' : ' (не в сети)'}` : fmtSize(f.size);
  info.append(el('div', { class: 'fc-sub', text: sub }));
  if (st.status === 'loading' && st.total) { const bar = el('i', { class: 'fc-bar' }, el('b')); bar.firstChild.style.width = (st.received / st.total * 100).toFixed(1) + '%'; info.append(bar); }
  const acts = el('div', { class: 'fc-acts' });
  if (mine) {
    if (share && share.path) acts.append(el('button', { class: 'icon-btn', 'data-tip': 'Показать в папке', onclick: () => api.showInFolder(share.path) }, icon('folder')));
  } else if (!f.deleted) {
    if (st.status === 'loading') acts.append(el('button', { class: 'icon-btn', 'data-tip': 'Отменить', onclick: () => (f.p2p ? p2p.cancel(f.id) : api.downloadCancel(f.id)) }, icon('x')));
    else if (st.status === 'done') {
      acts.append(el('button', { class: 'btn small', 'data-tip': 'Открыть', onclick: () => openDownloaded(f) }, icon('open'), el('span', { class: 'lbl', text: 'Открыть' })));
      acts.append(el('button', { class: 'icon-btn', 'data-tip': 'Показать в папке', onclick: () => api.showInFolder(st.path) }, icon('folder')));
    } else acts.append(el('button', { class: 'btn small primary-soft', 'data-tip': st.status === 'error' && st.part ? 'Продолжить с того же места' : f.p2p ? 'Скачать напрямую с компьютера отправителя' : 'Скачать', onclick: () => startDownload(f) }, icon('save'), el('span', { class: 'lbl', text: st.status === 'error' && st.part ? 'Продолжить' : 'Скачать' })));
  }
  card.append(ico, info, acts);
}
function refreshFileCards(id) { document.querySelectorAll(`.file-card[data-file="${id}"]`).forEach(renderFileCard); }
async function startDownload(f, saveAs = false) {
  if (f.p2p) {
    const prev = dls.get(f.id) || {};
    const part = saveAs ? null : prev.part || (settings.p2pParts || {})[f.id] || null;
    p2p.download(f, fileAuthor.get(f.id), { saveAs, part, received: part ? prev.received || 0 : 0 });
    return;
  }
  dls.set(f.id, { status: 'loading', received: 0, total: f.size });
  refreshFileCards(f.id);
  const r = await api.download(f.id, `${imageUrl(S, f.id)}`, f.name, saveAs);
  if (!r.ok) { dls.delete(f.id); refreshFileCards(f.id); }
}
async function openDownloaded(f) {
  const p = (dls.get(f.id) || {}).path || savedPaths()[f.id];
  if (!p || !(await api.fileExists(p))) {
    const d = { ...savedPaths() }; delete d[f.id]; set({ downloads: d }); dls.delete(f.id); refreshFileCards(f.id);
    return toast('Файла уже нет на диске — скачайте ещё раз', { kind: 'error' });
  }
  const err = await api.openPath(p);
  if (err) toast(`Не удалось открыть: ${err}`, { kind: 'error' });
}
if (api.onDownload) api.onDownload((ev) => {
  if (ev.type === 'progress') dls.set(ev.key, { status: 'loading', received: ev.received, total: ev.total, stalled: !!ev.stalled, path: ev.path });
  else if (ev.type === 'done') {
    if (ev.state === 'completed') { dls.set(ev.key, { status: 'done', path: ev.path }); rememberPath(ev.key, ev.path); toast('Файл скачан', { kind: 'ok', onclick: () => api.showInFolder(ev.path) }); }
    else if (ev.state === 'cancelled') dls.delete(ev.key);
    else dls.set(ev.key, { status: 'error' });
  }
  refreshFileCards(ev.key);
});

// ---- просмотр крупно ----
let lbMsg = null;
function openLightbox(m) {
  lbMsg = m;
  $('lightbox-img').src = imageUrl(S, m.image.id);
  $('lightbox').hidden = false;
}
function closeLightbox() { $('lightbox').hidden = true; $('lightbox-img').removeAttribute('src'); lbMsg = null; }
$('lightbox').onclick = (e) => { if (e.target === $('lightbox')) closeLightbox(); };
$('lb-close').onclick = closeLightbox;
$('lb-copy').onclick = () => lbMsg && doCopyImage(lbMsg);
$('lb-save').onclick = () => lbMsg && doSaveImage(lbMsg);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('lightbox').hidden) closeLightbox(); });
async function doCopyImage(m) {
  try { await copyImage(imageUrl(S, m.image.id)); toast('Картинка скопирована', { kind: 'ok' }); } catch (e) { toast(`Не удалось скопировать: ${e.message}`, { kind: 'error' }); }
}
async function doSaveImage(m) {
  try { const r = await saveImage(imageUrl(S, m.image.id), imageFileName(m.image)); if (r && r.ok) toast('Картинка сохранена', { kind: 'ok' }); else if (r && r.error) throw new Error(r.error); } catch (e) { toast(`Не удалось сохранить: ${e.message}`, { kind: 'error' }); }
}

// ===================== меню правой кнопки =====================
function closeCtxMenu() { const m = $('ctx-menu'); m.hidden = true; try { if (m.matches(':popover-open')) m.hidePopover(); } catch (_) { /* ignore */ } }
function showCtxMenu(x, y, items) {
  const m = $('ctx-menu'); m.textContent = '';
  for (const it of items) {
    if (it === '-') { m.append(el('div', { class: 'qm-sep' })); continue; }
    m.append(el('button', { class: 'qm-item' + (it.danger ? ' danger' : ''), onmousedown: (e) => e.preventDefault(), onclick: () => { closeCtxMenu(); it.fn(); } },
      icon(it.icon || 'copy'), el('span', { text: it.text }), it.key ? el('small', { text: it.key }) : null));
  }
  m.hidden = false;
  // Пока открыто окно (настройки, аватарка), всё вне его неактивно — меню переносим внутрь этого окна
  // и показываем в верхнем слое, иначе оно оказывается под окном и не нажимается
  const modal = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')).pop();
  const home = modal || document.body;
  if (m.parentElement !== home) home.append(m);
  try { if (m.matches(':popover-open')) m.hidePopover(); m.showPopover(); } catch (_) { /* ignore */ }
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
}
document.addEventListener('mousedown', (e) => { if (!$('ctx-menu').hidden && !$('ctx-menu').contains(e.target)) closeCtxMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });
window.addEventListener('blur', closeCtxMenu);
$('messages').addEventListener('scroll', closeCtxMenu);

async function pasteInto(field) {
  // буфер читает сама программа (у окна нет разрешения на чтение буфера обмена):
  // текст — вставляем в поле; картинку (только в поле сообщения) — сразу отправляем, как Ctrl+V
  const r = await api.clipRead(field === input).catch(() => ({}));
  if (r.image && field === input) { sendImages([new File([r.image], 'image.png', { type: 'image/png' })]); return; }
  const text = r.text || '';
  if (!text) return toast(field === input ? 'В буфере обмена нет ни текста, ни картинки' : 'В буфере обмена нет текста');
  field.focus();
  field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return; // своё меню уже показал кто-то другой (участники, демонстрация)
  const t = e.target;
  const items = [];
  const field = t.closest('textarea, input:not([type]), input[type=text], input[type=search], input[type=password]');
  if (field && !field.disabled) {
    const has = field.selectionEnd > field.selectionStart;
    const selText = field.value.slice(field.selectionStart, field.selectionEnd);
    if (has && field.type !== 'password') items.push({ icon: 'cut', text: 'Вырезать', key: 'Ctrl+X', fn: async () => { await navigator.clipboard.writeText(selText); field.focus(); field.setRangeText('', field.selectionStart, field.selectionEnd, 'end'); field.dispatchEvent(new Event('input', { bubbles: true })); } });
    if (has && field.type !== 'password') items.push({ icon: 'copy', text: 'Копировать', key: 'Ctrl+C', fn: () => navigator.clipboard.writeText(selText) });
    if (!field.readOnly) items.push({ icon: 'paste', text: field === input ? 'Вставить (текст или картинку)' : 'Вставить', key: 'Ctrl+V', fn: () => pasteInto(field) });
    if (field.value) items.push({ icon: 'list', text: 'Выделить всё', key: 'Ctrl+A', fn: () => { field.focus(); field.select(); } });
  } else {
    const sel = String(window.getSelection() || '').trim();
    const img = t.closest('.chat-img');
    const link = t.closest('a[href]');
    const msgEl = t.closest('.msg');
    if (sel) items.push({ icon: 'copy', text: 'Копировать', key: 'Ctrl+C', fn: () => copyText(sel) });
    if (img && img._msg) {
      items.push({ icon: 'max', text: 'Открыть картинку', fn: () => openLightbox(img._msg) });
      items.push({ icon: 'copy', text: 'Копировать картинку', fn: () => doCopyImage(img._msg) });
      items.push({ icon: 'save', text: 'Сохранить картинку…', fn: () => doSaveImage(img._msg) });
    }
    if (link) {
      items.push({ icon: 'link', text: 'Копировать ссылку', fn: () => copyText(link.href, 'Ссылка') });
      items.push({ icon: 'link', text: 'Открыть ссылку', fn: () => window.open(link.href, '_blank') });
    }
    const fcard = t.closest('.file-card');
    if (fcard && fcard._msg && !fcard._msg.file.deleted) {
      const f = fcard._msg.file; const st = dls.get(f.id) || (savedPaths()[f.id] ? { status: 'done', path: savedPaths()[f.id] } : {});
      const mineP2P = f.p2p && sameName(fcard._msg.author, S.me);
      if (mineP2P) { /* свой файл «напрямую» — пункты ниже */ } else if (st.status === 'done') {
        items.push({ icon: 'open', text: 'Открыть файл', fn: () => openDownloaded(f) });
        items.push({ icon: 'folder', text: 'Показать в папке', fn: () => api.showInFolder(st.path) });
      } else if (st.status !== 'loading') items.push({ icon: 'save', text: 'Скачать в «Загрузки»', fn: () => startDownload(f) });
      if (st.status !== 'loading' && !mineP2P) items.push({ icon: 'save', text: 'Сохранить как…', fn: () => startDownload(f, true) });
      if (mineP2P) {
        const sh = shareState.get(f.id);
        if (sh && sh.path) items.push({ icon: 'folder', text: 'Показать в папке', fn: () => api.showInFolder(sh.path) });
        if (sh && sh.ok) items.push({ icon: 'x', text: 'Перестать раздавать', danger: true, fn: async () => { await api.p2p.unshare(f.id); shareState.set(f.id, { ok: false, code: 'nofile' }); refreshFileCards(f.id); } });
      }
      items.push({ icon: 'copy', text: 'Копировать имя файла', fn: () => copyText(f.name, 'Имя файла') });
      if (f.p2p) { /* файл «напрямую»: на сервере его нет — удалять нечего */ } else if (sameName(fcard._msg.author, S.me) || S.isHost) items.push({ icon: 'trash', text: 'Удалить файл с сервера', danger: true, fn: async () => {
        if (!confirm(`Удалить «${f.name}» с сервера? Скачать его больше будет нельзя.`)) return;
        try { await S.conn.request({ type: 'file_delete', id: f.id }); } catch (err) { toast(err.message, { kind: 'error' }); }
      } });
    }
    if (msgEl && msgEl._msg) {
      const m = msgEl._msg;
      if (canChat2() && !m.deleted) items.push({ icon: 'reply', text: 'Ответить', fn: () => startReply(m) });
      if (canEdit(m)) items.push({ icon: 'edit', text: 'Изменить', key: '↑', fn: () => startEdit(m) });
      if (m.text && !sel) items.push({ icon: 'copy', text: 'Копировать текст сообщения', fn: () => copyText(m.text) });
      if (!sameName(m.author, S.me)) items.push({ icon: 'person', text: `Упомянуть ${m.author}`, fn: () => { input.focus(); input.setRangeText(`@${m.author} `, input.selectionStart, input.selectionEnd, 'end'); } });
      if (canDelete(m)) items.push('-', { icon: 'trash', text: 'Удалить сообщение', danger: true, fn: () => deleteMessage(m) });
    }
  }
  if (!items.length) return;
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, items);
});

// ===================== голос =====================
let micLost = ''; // выбранный микрофон, который выдернули посреди звонка (1.17.3)
mic.on((ev) => {
  if (ev.type === 'track' && S.voice) S.voice.setMicTrack(ev.track);
  if (ev.type === 'speaking') document.querySelectorAll(`[data-speak="${CSS.escape(S.me || '')}"] .avatar, #me-avatar`).forEach((a) => a.classList.toggle('speaking', ev.speaking));
  if (ev.type === 'overload') {
    log.warn('mic', `Процессор не успевает обрабатывать звук лучшим шумоподавлением (загрузка ${Math.round(ev.load * 100)}%) — переключаю на лёгкое`, { hint: 'Если процессор мощный, а сообщение появилось во время тяжёлой игры, можно вернуть «Лучшее» в настройках микрофона.' });
    toast('Компьютер не успевает — включил лёгкое шумоподавление', { hint: 'Подробности в журнале' });
    set({ noise: 'rnnoise' });
  }
  if (ev.type === 'lost' && (S.inVoice || $('settings').open)) {
    // 1.17.3: выбранный микрофон запоминаем — вставят обратно, вернём его (micDevicesChanged)
    if (settings.inputDevice && settings.inputDevice !== 'default') micLost = settings.inputDevice;
    setTimeout(() => { if (settings.inputDevice !== 'default') set({ inputDevice: 'default' }); else mic.start().catch(() => {}); }, 800);
  }
});

async function joinVoice(room) {
  if (S.inVoice === room) { openView('voice'); return; }
  if (S.joining) return;
  S.joining = true;
  try {
    if (S.inVoice) await leaveVoice();
    await output.resume();
    let track = null;
    try { track = await mic.start(); } catch (e) {
      toast('Микрофон не работает — вы будете только слушать', { kind: 'error', hint: 'Что делать — написано в журнале (нажмите)', onclick: () => logPanel.filterErrors() });
    }
    mic.setMuted(S.muted || S.deafened);
    output.setDeafened(S.deafened);
    S.voice = new Voice({ me: S.me, conn: S.conn, mic, output, iceServers: S.iceServers || [], relayOnly: !!S.relayOnly, sfu: !!S.sfuOn });
    S.voice.on('peers', () => { renderTiles(); });
    S.voice.on('screen', () => { renderStage(); renderTiles(); });
    let wasStreaming = false;
    S.voice.on('myscreen', () => {
      const now = !!(S.voice && S.voice.screen);
      if (now !== wasStreaming) { wasStreaming = now; output.beep(now ? 'stream-on' : 'stream-off'); }
      setSharing(now); // окно в фоне во время показа не рисует лишнего (footprint.js)
      renderMyScreen(); renderVoiceBar();
    });
    S.voice.on('viewer', (v) => output.beep(v.on ? 'viewer-in' : 'viewer-out')); // зашли смотреть вашу демку / вышли
    S.voice.on('voiceq', onVoiceQ); // друг плохо слышит вас — скажем почему
    // экран за 5 с не дал ни одного кадра — у зрителей будет чёрная демка (1.16.1)
    S.voice.on('noframes', () => toast('Экран не отдаёт картинку — у зрителей демка чёрная', { kind: 'warn', hint: 'Игру — в «Оконный без рамки», выключить HDR. Подробности — в журнале (нажмите)', timeout: 15000, onclick: () => logPanel.show() }));
    // видеокарта не сжала ни кадра — у зрителей чёрный экран (1.17.5)
    // 1.20.1: показ видеокартой смотрят напрямую двое и больше — предлагаем включить «через сервер» (по нажатию)
    S.voice.on('gpumany', () => toast('Смотрят двое и больше — включите значок «сервер»', { hint: 'При показе видеокартой без сервера качество у всех равняется на зрителя с самым слабым интернетом. Через сервер каждый смотрит в своём качестве. Нажмите, чтобы включить', timeout: 20000, onclick: () => set({ screenViaServer: true }) }));
    // 1.20.3: зритель включил «сервер», а стример показывает напрямую — путь выбирает стример
    S.voice.on('pathbystreamer', (e) => toast(`${e.name} показывает напрямую`, { hint: `Через сервер будет, когда ${e.name} включит у себя значок «сервер» на панели звонка. Пока демка идёт напрямую.`, timeout: 10000 }));
    S.voice.on('gpufail', (e) => toast('Захват видеокартой остановился — показ остановлен', { kind: 'error', hint: e.lost ? 'Windows 30 секунд не отдавала экран — включите в игре «Оконный без рамки». Подробности — в журнале (нажмите)' : `${e.why}. Подробности — в журнале (нажмите)`, timeout: 15000, onclick: () => logPanel.show() }));
    S.voice.on('encstuck', (e) => toast(e.to ? 'Видеокарта не сжимает демку — переключил на сжатие процессором' : 'Демка не сжимается — у зрителей чёрный экран', { kind: 'warn', hint: e.to ? 'Кодек «H.264 — процессор» сохранён в Настройки → Показ экрана. Подробности — в журнале (нажмите)' : 'Подробности — в журнале (нажмите)', timeout: 15000, onclick: () => logPanel.show() }));
    S.voice.on('stats', () => { if (!isBackground()) { renderStageInfo(); renderMyScreenStats(); renderTilePings(); } });
    S.demo = new DemoReports(S.voice, { view: stageView, ui: {
      changed: renderDemoReport, toast: (t) => toast(t),
      done: (lines) => { const v = lines[0]; toast('Отчёт о демке готов — он в журнале', { kind: v && v.level === 'ok' ? 'ok' : 'info', hint: v ? v.text : '', timeout: 12000, onclick: () => logPanel.show() }); },
    } });
    await S.voice.setMicTrack(track);
    const r = await S.conn.request({ type: 'voice_join', room, muted: S.muted, deafened: S.deafened });
    S.inVoice = room;
    await S.voice.join(room, r.peers);
    log.info('rtc', `Вы в голосовом канале «${room}»${r.peers.length ? ', там: ' + r.peers.join(', ') : ' (пока один)'}`);
    output.beep('join');
    renderVoiceBar(); renderRooms(); openView('voice');
  } catch (e) {
    log.error('rtc', `Не удалось войти в голосовой канал: ${e.message}`, { err: e });
    await localLeaveVoice(true);
  } finally { S.joining = false; }
}

// Друг сообщил, что ваш голос у него прерывается. Если жалуется один — скорее его интернет, если все — ваш.
const voiceQ = new Map(); let voiceQToastAt = 0;
function onVoiceQ(r) {
  const now = Date.now();
  voiceQ.set(r.name, { ...r, at: now });
  for (const [k, v] of voiceQ) if (now - v.at > 90000) voiceQ.delete(k);
  const listeners = S.voice ? [...S.voice.peers.values()].filter((p) => p.state === 'connected').length : 1;
  const who = [...voiceQ.keys()];
  // «у всех» — когда жалуются хотя бы двое и это большинство тех, кто нас слышит
  const all = listeners >= 2 && who.length >= 2 && who.length >= listeners * 0.66;
  const lost = `пропадает около ${Math.max(1, Math.round(r.conceal))}% звука${r.loss > 1 ? `, теряется ${r.loss}% пакетов` : ''}${r.jitter > 30 ? ', сильно скачет задержка сети' : ''}`;
  const relay = r.path === 'relay' ? ' Связь с ним идёт через ретранслятор сервера.' : r.path === 'radmin' ? ' Связь идёт через Radmin VPN.' : '';
  const msg = all ? `Вас слышно с перебоями у всех (${who.join(', ')}): ${lost}` : `${r.name} слышит вас с перебоями: ${lost}`;
  const hint = all
    ? `Раз плохо у всех — дело, скорее всего, в вашем интернете: Wi-Fi (лучше кабель или 5 ГГц), закачки, торренты, обновления.${relay}`
    : `Если остальные слышат вас нормально — дело в интернете у ${r.name}. Если нет — в вашем: Wi-Fi, закачки, торренты.${relay}`;
  log.warn('audio', msg, { hint });
  if (now - voiceQToastAt > 120000) { voiceQToastAt = now; toast(msg, { kind: 'error', hint, timeout: 12000 }); }
}

async function localLeaveVoice(silent) {
  if (S.stageFull) setStageFull(false);
  if (S.demo) { S.demo.abort('вы вышли из комнаты'); S.demo = null; }
  music.leave();
  sfx.leave();
  if (S.voice) await S.voice.leave();
  S.voice = null;
  const was = S.inVoice;
  S.inVoice = null;
  await mic.stop();
  if (was && !silent) output.beep('leave');
  renderVoiceBar(); renderRooms();
  renderVoiceView();
}

async function leaveVoice() {
  if (S.conn) S.conn.send({ type: 'voice_leave' });
  await localLeaveVoice();
}

$('btn-leave').onclick = () => leaveVoice();
$('btn-voice-view').onclick = () => openView('voice');
$('btn-screen').onclick = () => { if (S.voice && S.voice.screen) S.voice.stopScreen(); else openPicker(); };

// ---------- панель звонка (как в Discord) ----------
const NOISE_SHORT = { dfn: 'лучшее', rnnoise: 'лёгкое', browser: 'простое', off: 'выключено' };
function renderCallbar() {
  const micOff = S.muted || S.deafened;
  const m = $('cb-mic');
  m.classList.toggle('off', micOff); setIcon(m, micOff ? 'mic-off' : 'mic');
  m.dataset.tip = (micOff ? 'Включить микрофон' : 'Выключить микрофон') + ' · Ctrl+M';
  const d = $('cb-deafen');
  d.classList.toggle('off', S.deafened); setIcon(d, S.deafened ? 'head-off' : 'head');
  d.dataset.tip = (S.deafened ? 'Включить звук' : 'Выключить звук') + ' · Ctrl+D';
  const streaming = !!(S.voice && S.voice.screen);
  $('cb-screen').classList.toggle('on', streaming);
  setIcon($('cb-screen'), streaming ? 'screen-stop' : 'screen');
  setIcon($('btn-screen'), streaming ? 'screen-stop' : 'screen');
  $('cb-screen').dataset.tip = streaming ? 'Остановить показ экрана · ПКМ — настройки' : 'Показать экран · ПКМ — настройки';
  if (qmOwner === 'screen') renderScreenMenu();
  const n = $('cb-noise'); const on = settings.noise !== 'off';
  n.classList.toggle('soft-on', on);
  n.dataset.tip = on ? `Шумоподавление: ${NOISE_SHORT[settings.noise]} (нажмите, чтобы выключить)` : 'Шумоподавление выключено (нажмите, чтобы включить)';
  renderSfuToggle();
}
// Значок «сервер» (1.16.3): демки через сервер (размножитель) или напрямую — своя и та, что смотрю.
// Горит — через сервер; перечёркнут — напрямую; серый — на этом сервере размножителя нет (всё и так напрямую).
function renderSfuToggle() {
  const b = $('cb-sfu');
  const via = settings.screenViaServer !== false;
  b.classList.toggle('soft-on', !!S.sfuOn && via);
  b.classList.toggle('cb-na', !S.sfuOn);
  setIcon(b, S.sfuOn && via ? 'server' : 'server-off');
  b.dataset.tip = !S.sfuOn ? 'Демки идут напрямую: на этом сервере нет размножителя'
    : via ? 'Демки через сервер (размножитель) — нажмите, чтобы напрямую' : 'Демки напрямую — нажмите, чтобы через сервер';
}
$('cb-mic').onclick = () => $('btn-mute').click();
$('cb-deafen').onclick = () => $('btn-deafen').click();
$('cb-screen').onclick = () => $('btn-screen').click();
$('cb-settings').onclick = () => openSettings();
$('cb-leave').onclick = () => leaveVoice();
music.build($('view-voice'));
function renderMusicBtn() {
  const b = $('cb-music');
  b.classList.toggle('on', music.live);
  b.classList.toggle('soft-on', !music.live && (music.open || !!music.current));
  b.dataset.tip = music.app ? `Для всех звучит: ${music.app.name}` : music.playing ? `Музыка для всех: ${music.current.name}` : 'Музыка для всех';
}
music.onchange = renderMusicBtn;
$('cb-music').onclick = () => { if (music.open) music.hide(); else { closeQuickMenu(); sfx.hide(); music.show($('cb-music'), $('callbar')); } };
addEventListener('resize', () => { if (music.open) music.place(); if (sfx.open) sfx.place(); });
renderMusicBtn();
sfx.build($('view-voice'));
function renderSfxBtn() {
  const b = $('cb-sfx');
  b.classList.toggle('on', sfx.live);
  b.classList.toggle('soft-on', !sfx.live && sfx.open);
}
sfx.onchange = renderSfxBtn;
$('cb-sfx').onclick = () => { if (sfx.open) sfx.hide(); else { closeQuickMenu(); music.hide(); sfx.show($('cb-sfx'), $('callbar')); } };
renderSfxBtn();
sfx.init();
$('room-invite').onclick = () => openInvite();
$('cb-sfu').onclick = () => {
  if (!S.sfuOn) { toast('На этом сервере нет размножителя — демки и так идут напрямую', { hint: 'Размножитель есть у сервера 1.16 на VPS.' }); return; }
  const on = settings.screenViaServer === false; // было «напрямую» — станет «через сервер», и наоборот
  set({ screenViaServer: on }); // дальше — onSettings: значок, галочка в настройках и переключение на ходу
  // 1.20.3: сам не показываю, а стример — напрямую: вместо «раздаёт сервер» будет всплывашка «… показывает напрямую» (rtc.js)
  const w = S.voice && S.voice.watching && S.voice.peers.get(S.voice.watching);
  if (on && !(S.voice && S.voice.screen) && w && w.remoteScreenInfo && w.remoteScreenInfo.srv === 0) return;
  toast(on ? 'Демки — через сервер' : 'Демки — напрямую', { kind: 'ok', timeout: 6000,
    hint: on ? 'Вашу демку и ту, что смотрите, раздаёт сервер. Картинка на секунду замрёт.' : 'Демки идут напрямую между компьютерами. Картинка на секунду замрёт.' });
};
$('cb-noise').onclick = () => {
  if (settings.noise !== 'off') { set({ lastNoise: settings.noise, noise: 'off' }); toast('Шумоподавление выключено'); }
  else { set({ noise: settings.lastNoise || 'dfn' }); toast(`Шумоподавление включено: ${NOISE_SHORT[settings.noise]}`, { kind: 'ok' }); }
};
// ---------- быстрые меню над панелью звонка ----------
let qmOwner = null;
function closeQuickMenu() { $('quick-menu').hidden = true; qmOwner = null; }
function placeQuickMenu(anchorId) {
  const qm = $('quick-menu');
  qm.hidden = false;
  const view = $('view-voice').getBoundingClientRect();
  const btn = $(anchorId).getBoundingClientRect();
  const bar = $('callbar').getBoundingClientRect();
  qm.style.left = Math.max(8, Math.min(view.width - qm.offsetWidth - 8, btn.left - view.left)) + 'px';
  qm.style.bottom = (view.bottom - bar.top + 8) + 'px';
}
const qmItem = (text, { sel = false, iconName = null, note = '', cls = '', keep = false, onClick }) => el('button', {
  class: `qm-item${sel ? ' sel' : ''}${cls ? ' ' + cls : ''}`,
  onclick: () => { if (!keep) closeQuickMenu(); onClick(); },
}, iconName ? icon(iconName) : el('i', { class: 'dot' }), el('span', { text }), note ? el('small', { text: note }) : null);
const qmToggle = (text, sub, on, { disabled = false, iconName = null, onClick }) => el('button', { class: 'qm-toggle', disabled, onclick: onClick },
  iconName ? icon(iconName) : null, el('span', { class: 'tt' }, el('span', { text }), sub ? el('small', { text: sub }) : null), el('span', { class: 'switch' + (on ? ' on' : '') }));

// 1.19.0: «Видеокартой, как OBS» — есть ли помощник skh-videocap.exe (только Windows, рядом с программой)
gpuCaptureAvailable().then((ok) => { S.gpuAvail = !!ok; });
function gpuState() {
  const sc = S.voice && S.voice.screen;
  const on = !!settings.screenGpu;
  // 1.19.2: помощника нет, а режим включён — переключатель остаётся рабочим, чтобы его можно было выключить
  // (раньше он был заблокирован, а показ не запускался вовсе)
  if (!S.gpuAvail && on && CAN_SHARE_AUDIO) return { on, sub: 'Помощника захвата видеокартой нет в папке программы — показ не начнётся. Выключите или поставьте обновление 1.19.x целиком' };
  if (!S.gpuAvail) return { on: false, disabled: true, sub: CAN_SHARE_AUDIO ? 'Помощника захвата видеокартой нет в папке программы' : 'Только в Windows' };
  if (sc && sc.gpu) return { on, sub: on ? `Сжимает ${encName(sc.gpu.info.enc)} · только весь экран, превью нет` : 'Выключится со следующего показа' };
  if (sc) return { on, sub: on ? 'Включится со следующего показа' : 'Снимает и сжимает видеокарта, процессор почти не занят' };
  return { on, sub: on ? 'Снимает и сжимает видеокарта, процессор почти не занят. Только весь экран' : 'Снимает и сжимает видеокарта, процессор почти не занят' };
}

// ---------- меню показа экрана (стрелка у кнопки «Показать экран») ----------
// Качество демки коротко: то, что выбрано в настройках.
// 1.19.2: показ видеокартой (идёт или будет) снимает экран в его разрешении — так и пишем, а не «1080p»
function gpuShow() { const sc = S.voice && S.voice.screen; return sc ? !!sc.gpu : !!(settings.screenGpu && S.gpuAvail); }
function customNote() {
  const s = settings;
  return `${gpuShow() || s.screenRes === 'source' ? 'как на экране' : s.screenRes + 'p'} · ${s.screenFps} к/с · ${s.screenBitrate} Мбит/с`;
}
// результат проверки интернета коротко — для меню кнопки показа
function netShort() {
  const n = settings.screenNet;
  return n && n.up ? `${fmtMbps(n.up)} Мбит/с` : 'узнать свою отдачу';
}
const fmtMbps = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace('.', ',');
function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many; }
function screenAudioState() {
  const sc = S.voice && S.voice.screen;
  if (!CAN_SHARE_AUDIO) return { on: false, disabled: true, sub: 'Звук компьютера можно передавать только в Windows' };
  if (sc && !sc.audio) return { on: false, disabled: true, sub: 'Не удалось захватить звук — причина в журнале' };
  const on = sc ? sc.audio.enabled : !!settings.screenAudio;
  if (!on) return { on, sub: sc ? 'Зрители не слышат звук компьютера' : 'Трансляция начнётся без звука' };
  if (sc && sc.guard) return { on, sub: 'Игры, музыка, видео — голоса друзей вычитаются автоматически' };
  return { on, sub: sc && sc.ownAudioExcluded === false ? 'Весь звук компьютера, включая голоса друзей' : 'Игры, музыка, видео — голоса друзей не попадают' };
}
function renderScreenMenu() {
  const qm = $('quick-menu');
  const sc = S.voice && S.voice.screen;
  const viewers = sc ? [...S.voice.peers.values()].filter((p) => p.sentScreen).map((p) => p.name) : [];
  const head = el('div', { class: 'qm-head' },
    el('b', {}, sc ? el('span', { class: 'live' }, 'в эфире') : null, sc ? `«${sc.name || 'Экран'}»` : 'Показ экрана'),
    el('small', { text: sc ? `${sc.info.w}×${sc.info.h}, ${sc.info.fps} к/с · ${viewers.length ? 'смотрят: ' + viewers.join(', ') : 'пока никто не смотрит'}` : 'Выберите качество и звук, потом начните показ' }));
  // 1.15.5: что показываю — выбирается вручную («Игра» / «Текст»); качество — только своё, меняется в настройках
  const detail = settings.screenMode === 'detail';
  const pickMode = (m) => { if (settings.screenMode !== m) { set({ screenMode: m }); renderScreenMenu(); } };
  const kind = [
    qmItem('Игра', { sel: !detail, note: 'важнее плавность', cls: 'qm-mode', keep: true, onClick: () => pickMode('motion') }),
    qmItem('Текст', { sel: detail, note: 'важнее чёткость букв', cls: 'qm-mode', keep: true, onClick: () => pickMode('detail') }),
  ];
  const quality = [
    qmItem(customNote(), { iconName: 'sliders', note: 'изменить', cls: 'qm-quality', keep: true, onClick: () => openSettings('screen') }),
    qmItem(netTest.running ? 'Проверяю интернет…' : 'Проверить интернет', { iconName: 'pulse', note: netShort(), keep: true, onClick: () => runNetTest() }),
  ];
  const g = gpuState();
  const capture = qmToggle('Видеокартой, как OBS', g.sub, g.on, {
    disabled: g.disabled, iconName: 'screen',
    onClick: () => { set({ screenGpu: !settings.screenGpu }); renderScreenMenu(); },
  });
  const a = screenAudioState();
  const sound = qmToggle('Звук компьютера', a.sub, a.on, {
    disabled: a.disabled, iconName: a.on ? 'volume' : 'speaker-off',
    onClick: () => {
      const next = !a.on;
      set({ screenAudio: next });
      if (sc) S.voice.setScreenAudio(next);
      renderScreenMenu();
    },
  });
  const rec = S.demo && S.demo.busy;
  const actions = sc ? [
    qmItem('Сменить экран или окно…', { iconName: 'swap', onClick: () => openPicker('switch') }),
    qmItem(rec ? (S.demo.running ? `Отчёт пишется… ${S.demo.left()} с` : 'Отчёт: собираю данные…') : 'Отчёт о демке', { iconName: 'file', note: rec ? '' : '60 с замеров → журнал', keep: rec,
      onClick: () => { if (!rec) S.demo.start('streamer'); } }),
    qmItem('Остановить показ', { iconName: 'screen-stop', cls: 'danger', onClick: () => S.voice.stopScreen() }),
  ] : [
    qmItem('Начать показ…', { iconName: 'screen', cls: 'accent', onClick: () => openPicker() }),
  ];
  qm.replaceChildren(head, el('div', { class: 'qm-sep' }),
    // 1.19.2: «Игра / Текст» задают, чем жертвует сжатие Chromium, — у показа видеокартой оно не участвует
    el('div', { class: 'qm-title', text: sc && sc.gpu ? 'Что показываю · видеокартой не влияет' : 'Что показываю' }), ...kind, el('div', { class: 'qm-sep' }),
    el('div', { class: 'qm-title', text: 'Качество' }), ...quality, el('div', { class: 'qm-sep' }),
    el('div', { class: 'qm-title', text: 'Захват' }), capture, el('div', { class: 'qm-sep' }),
    el('div', { class: 'qm-title', text: 'Звук' }), sound, el('div', { class: 'qm-sep' }),
    ...actions,
    qmItem('Все настройки показа', { iconName: 'sliders', onClick: () => openSettings('screen') }));
}
function openScreenMenu(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (qmOwner === 'screen') { closeQuickMenu(); return; }
  qmOwner = 'screen';
  renderScreenMenu();
  placeQuickMenu('cb-screen');
}
$('cb-screen-menu').onclick = openScreenMenu;
$('cb-screen').oncontextmenu = openScreenMenu;
$('btn-screen').oncontextmenu = (e) => { if (S.view === 'voice') openScreenMenu(e); };

$('cb-mic-menu').onclick = async (e) => {
  e.stopPropagation();
  const qm = $('quick-menu');
  if (qmOwner === 'mic') { closeQuickMenu(); return; }
  qmOwner = 'mic';
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (_) { /* ignore */ }
  const item = (text, sel, fn, dot = true) => el('button', { class: 'qm-item' + (sel ? ' sel' : ''), onclick: () => { closeQuickMenu(); fn(); } }, dot ? el('i', { class: 'dot' }) : icon('sliders'), el('span', { text }));
  const list = (kind, key) => {
    const items = [{ deviceId: 'default', label: 'Как в Windows' }, ...devs.filter((d) => d.kind === kind && !['default', 'communications'].includes(d.deviceId))];
    return items.map((d) => item(d.label || 'Устройство', (settings[key] || 'default') === d.deviceId, () => set({ [key]: d.deviceId })));
  };
  qm.replaceChildren(
    el('div', { class: 'qm-title', text: 'Микрофон' }), ...list('audioinput', 'inputDevice'),
    el('div', { class: 'qm-sep' }),
    el('div', { class: 'qm-title', text: 'Звук' }), ...list('audiooutput', 'outputDevice'),
    el('div', { class: 'qm-sep' }),
    el('div', { class: 'qm-title', text: 'Шумоподавление' }),
    ...[['dfn', 'Лучшее'], ['rnnoise', 'Лёгкое'], ['off', 'Выключено']].map(([v, t]) => item(t, settings.noise === v, () => set({ noise: v }))),
    el('div', { class: 'qm-sep' }),
    item('Все настройки голоса', false, () => openSettings(), false),
  );
  placeQuickMenu('cb-mic');
};
document.addEventListener('mousedown', (e) => {
  const qm = $('quick-menu');
  if (!qm.hidden && !qm.contains(e.target) && !e.target.closest('#cb-mic-menu, #cb-screen-menu')) closeQuickMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('quick-menu').hidden) closeQuickMenu(); });

function sendVoiceState() { if (S.inVoice && S.conn) S.conn.send({ type: 'voice_state', muted: S.muted || S.deafened, deafened: S.deafened }); }
function renderMuteButtons() {
  music.setDeafened(S.deafened);
  sfx.setDeafened(S.deafened);
  if (sfx.open) sfx.render();
  const micOff = S.muted || S.deafened;
  $('btn-mute').classList.toggle('off', micOff);
  setIcon($('btn-mute'), micOff ? 'mic-off' : 'mic');
  $('btn-mute').dataset.tip = (micOff ? 'Включить микрофон' : 'Выключить микрофон') + ' · Ctrl+M';
  $('btn-deafen').classList.toggle('off', S.deafened);
  setIcon($('btn-deafen'), S.deafened ? 'head-off' : 'head');
  $('btn-deafen').dataset.tip = (S.deafened ? 'Включить звук' : 'Выключить звук (никого не слышно)') + ' · Ctrl+D';
  renderCallbar();
  $('me-sub').textContent = S.deafened ? 'звук выключен' : S.muted ? 'микрофон выключен' : S.inVoice ? 'в голосе' : 'в сети';
  if (api.trayMuted) api.trayMuted(S.muted || S.deafened);
}
if (api.trayPrefs) api.trayPrefs({ closeToTray: settings.closeToTray !== false });
if (api.onTrayAction) api.onTrayAction((a) => { if (a === 'mute') $('btn-mute').click(); });
$('btn-mute').onclick = () => {
  if (S.deafened) { S.deafened = false; S.muted = false; output.setDeafened(false); } else S.muted = !S.muted;
  mic.setMuted(S.muted || S.deafened);
  output.beep(S.muted ? 'mute' : 'unmute');
  sendVoiceState(); renderMuteButtons();
};
$('btn-deafen').onclick = () => {
  S.deafened = !S.deafened;
  output.setDeafened(S.deafened);
  mic.setMuted(S.muted || S.deafened);
  output.beep(S.deafened ? 'mute' : 'unmute');
  sendVoiceState(); renderMuteButtons();
};

function renderVoiceBar() {
  $('voice-bar').hidden = !S.inVoice;
  renderMuteButtons();
  if (!S.inVoice) return;
  $('vb-status').textContent = 'Вы в голосе'; $('vb-status').className = 'vb-status';
  $('btn-voice-view').textContent = S.inVoice;
  const streaming = !!(S.voice && S.voice.screen);
  $('btn-screen').classList.toggle('on', streaming);
  $('btn-screen').dataset.tip = streaming ? 'Остановить показ экрана' : 'Показать экран';
  renderCallbar();
}

function roomMembers() { return (S.inVoice && S.rooms[S.inVoice]) || []; }

// кто в моей комнате сейчас показывает экран — чтобы прозвучало начало и конец чужой демонстрации
let streamingNow = null;
function onRoomsChanged() {
  renderRooms();
  if (!S.voice) { streamingNow = null; if (S.view === 'voice') renderVoiceView(); return; }
  const live = new Set(roomMembers().filter((x) => x.streaming && !sameName(x.name, S.me)).map((x) => lower(x.name)));
  if (streamingNow) {
    if ([...live].some((n) => !streamingNow.has(n))) output.beep('stream-on');
    else if ([...streamingNow].some((n) => !live.has(n) && roomMembers().some((x) => lower(x.name) === n))) output.beep('stream-off'); // вышел из комнаты — уже прозвучал выход
  }
  streamingNow = live;
  // если стример закончил показ — закрываем просмотр. Если его просто нет в списке (вышел — придёт «вышел»;
  // сервер перезапустился и он ещё не вернулся), не трогаем: после перезапуска просмотр продолжится сам
  if (S.voice.watching) {
    const m = roomMembers().find((x) => sameName(x.name, S.voice.watching));
    if (m && !m.streaming) { const n = S.voice.watching; S.voice.unwatch(); toast(`${n} закончил(а) демонстрацию`); }
  }
  renderTiles();
}

function renderVoiceView() {
  const room = S.inVoice || S.voiceRooms[0] || '';
  $('voice-title').textContent = room;
  const inCall = !!S.inVoice;
  $('lobby').hidden = inCall;
  for (const id of ['tiles', 'callbar']) $(id).hidden = !inCall;
  if (!inCall) {
    $('stage').hidden = true; $('room-empty').hidden = true;
    if (S.stageFull) setStageFull(false);
    renderLobby(room);
    return;
  }
  renderStage(); renderTiles(); renderMyScreen();
}

// «прихожая»: кто сейчас в комнате и большая кнопка «Войти»
function renderLobby(room) {
  const members = (S.rooms[room] || []);
  $('voice-sub').textContent = members.length ? peopleText(members.length) + togetherText(room) : 'пока никого';
  const box = $('lobby-tiles'); box.textContent = '';
  for (const m of members) box.append(el('div', { class: 'lobby-tile', oncontextmenu: (e) => openPopover(e, m.name) }, avatar(m.name), el('span', { text: m.name }), m.streaming ? el('span', { class: 'live' }, 'в эфире') : null));
  $('lobby-text').textContent = members.length ? (members.some((m) => m.streaming) ? 'Там идёт демонстрация экрана — заходите посмотреть' : 'Друзья уже здесь — заходите') : 'В комнате пока никого — зайдите первым, друзья увидят вас слева';
  $('lobby-join').onclick = () => joinVoice(room);
}

function renderTiles() {
  if (S.view !== 'voice' || !S.voice) return;
  const box = $('tiles'); box.textContent = '';
  const members = roomMembers();
  renderVoiceSub(members.length);
  for (const m of members) {
    const me = sameName(m.name, S.me);
    const p = !me && S.voice.peers.get(m.name);
    const canWatch = m.streaming && !me;
    const isWatched = canWatch && S.voice.watching && sameName(S.voice.watching, m.name);
    const tile = el('div', { class: 'tile' + (canWatch ? ' streaming can-watch' : '') + (isWatched ? ' watched' : ''), 'data-speak': m.name, 'data-tile': m.name,
      'data-tip': canWatch && !isWatched ? `Смотреть демку ${m.name}` : null,
      onclick: canWatch && !isWatched ? () => S.voice && S.voice.watch(m.name) : null,
      oncontextmenu: (e) => !me && openPopover(e, m.name) },
      el('div', { class: 'tflags' }, icon(m.deafened ? 'head-off' : m.muted ? 'mic-off' : 'mic')),
      el('div', { class: 'tav' }, avatar(m.name), m.streaming ? el('span', { class: 'live-dot', 'data-tip': 'В эфире — показывает экран' }) : null),
      el('div', { class: 'tname', text: me ? `${m.name} (вы)` : m.name }),
      // 1.20: под именем — что с человеком сейчас и пинг; «говорит» с полосками показывается, пока он говорит
      el('div', { class: 'tsub' },
        el('span', { class: 'tst', text: me ? 'вы' : m.streaming ? 'в эфире' : m.deafened ? 'без звука' : m.muted ? 'без микрофона' : '' }),
        el('span', { class: 'tsp' }, el('span', { class: 'bars' }, el('i'), el('i'), el('i'), el('i')), 'говорит'),
        el('span', { class: 'tping', 'data-ping': m.name })));
    if (m.streaming && !me) {
      const watching = S.voice.watching && sameName(S.voice.watching, m.name);
      tile.append(el('button', { class: 'btn small primary watch', onclick: (e) => { e.stopPropagation(); if (watching) S.voice.unwatch(); else S.voice.watch(m.name); } }, icon(watching ? 'check' : 'play'), watching ? 'Вы смотрите' : 'Смотреть'));
    }
    if (m.away && !me) tile.append(el('div', { class: 'tstate', 'data-tip': 'У него пропала связь с сервером. Голос и демка идут напрямую и, скорее всего, работают; программа сама переподключится' }, 'нет связи с сервером'));
    else if (p && p.state !== 'connected') tile.append(el('div', { class: 'tstate', style: `color:${p.state === 'failed' ? 'var(--rose)' : 'var(--lamp)'}` }, p.state === 'failed' ? 'нет связи — см. журнал' : 'соединяемся…'));
    box.append(tile);
    if (me) {
      const st = myScreenTileEl();
      if (st) { box.append(st); const v = st.querySelector('video'); if (v.paused) v.play().catch(() => {}); }
    }
  }
  $('room-empty').hidden = members.length > 1 || !!S.voice.watching;
  renderTilesToggle();
  renderStageSwitch();
  renderMyScreenStats();
  renderTilePings();
}

// «4 человека, вместе 1 ч 24 мин» под названием комнаты
function peopleText(n) {
  const d = n % 10, dd = n % 100;
  return `${n} ${d === 1 && dd !== 11 ? 'человек' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'человека' : 'человек'}`;
}
// Сколько длится встреча — считает сервер (одинаково у всех). Старый сервер этого не присылает — тогда не показываем.
function setTogether(t) {
  S.together = {};
  if (t && typeof t === 'object') for (const [room, ms] of Object.entries(t)) if (Number.isFinite(ms)) S.together[room] = Date.now() - ms;
}
function togetherText(room) {
  const start = S.together && S.together[room];
  if (!start) return '';
  const min = Math.floor((Date.now() - start) / 60e3);
  if (min < 1) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return `, вместе ${h ? h + ' ч ' : ''}${m} мин`;
}
function renderVoiceSub(n) {
  if (n == null) n = roomMembers().length;
  if (n <= 1) { $('voice-sub').textContent = 'пока только вы'; return; }
  $('voice-sub').textContent = peopleText(n) + togetherText(S.inVoice);
}
setInterval(() => {
  if (S.view !== 'voice' || $('view-voice').hidden) return;
  if (S.voice) renderVoiceSub();
  else { const room = S.voiceRooms && S.voiceRooms[0]; const n = (S.rooms[room] || []).length; if (n) $('voice-sub').textContent = peopleText(n) + togetherText(room); }
}, 20e3);

// путь связи с другом — на плитке рядом с пингом
const PATH_SHORT = { direct: 'напрямую', lan: 'напрямую', radmin: 'Radmin', hamachi: 'Hamachi', relay: 'сервер' };
const PATH_TIP = {
  direct: 'напрямую через интернет — быстрее всего',
  lan: 'напрямую, вы в одной домашней сети',
  radmin: 'через Radmin VPN',
  hamachi: 'через Hamachi',
  relay: 'через ретранслятор сервера: напрямую не получилось («серый» адрес у провайдера или строгий роутер). Работает, задержка чуть больше',
};
function renderTilePings() {
  if (!S.voice) return;
  document.querySelectorAll('[data-ping]').forEach((e) => {
    const p = S.voice.peers.get(e.dataset.ping);
    const path = p && p.state === 'connected' && p.path;
    e.replaceChildren(...(p && p.rtt != null ? [path ? el('span', { class: 'tpath', text: `${PATH_SHORT[path]} · ` }) : '', `${p.rtt} мс`] : []));
    e.classList.toggle('bad', !!(p && p.rtt > 150));
    e.classList.toggle('relay', path === 'relay');
    if (path) e.dataset.tip = `Связь с ${e.dataset.ping}: ${PATH_TIP[path]}. Пинг ${p.rtt} мс`; else delete e.dataset.tip;
  });
}

function renderStage() {
  const w = S.voice && S.voice.watching;
  if (w !== zoom.of) { zoom.of = w; resetZoom(); } // другая демка или закрыли — снова 100%
  $('stage').hidden = !w || S.view !== 'voice';
  if ($('stage').hidden && S.stageFull) setStageFull(false); // трансляция закончилась — не оставляем пустой полный экран
  fitStage();
  const video = $('stage-video');
  if (!w) { video.srcObject = null; return; }
  const p = S.voice.peers.get(w);
  const stream = p && p.remoteScreen;
  if (video.srcObject !== stream) { video.srcObject = stream || null; if (stream) video.play().catch(() => {}); }
  renderStageInfo();
  renderStageSwitch();
}

// на полосе трансляции — кнопки других демок в комнате: переключиться одним нажатием
function renderStageSwitch() {
  const box = $('stage-switch');
  const w = S.voice && S.voice.watching;
  const others = w ? roomMembers().filter((m) => m.streaming && !sameName(m.name, S.me) && !sameName(m.name, w)) : [];
  box.hidden = !others.length;
  box.replaceChildren(...others.map((m) => el('button', { class: 'btn small', 'data-tip': `Переключиться на демку ${m.name}`, onclick: () => S.voice && S.voice.watch(m.name) }, icon('play'), m.name)));
}

function renderStageInfo() {
  const w = S.voice && S.voice.watching;
  if (!w) return;
  const p = S.voice.peers.get(w);
  const s = p && p.screenStats;
  const info = $('stage-info');
  const via = p && p.sfuIn ? ' · через сервер' : '';
  const base = !p || !p.remoteScreen ? `Подключаюсь к трансляции ${w}…` : s ? `${w}   ${s.w}×${s.h}, ${s.fps} кадров/с, ${s.mbps.toFixed(1)} Мбит/с${s.loss > 0.5 ? `, потери ${s.loss.toFixed(1)}%` : ''}${via}` : `${w}, загрузка…${via}`;
  const au = p && p.remoteScreenInfo && p.remoteScreenInfo.audio;
  const note = au === 'off' ? 'звук выключен у стримера' : au === 'none' ? 'без звука' : '';
  const hl = p && p.screenHealth();
  info.replaceChildren(base, hl && hl.short ? el('span', { class: 'why' + (hl.level === 'bad' ? ' bad' : ''), text: `   · узкое место: ${hl.short}` }) : '', note ? el('span', { class: 'muted-note', text: `   · ${note}` }) : '');
  info.dataset.tip = info.textContent.trim();
  const dot = $('stage-health');
  dot.className = 'stage-health' + (hl ? ' ' + hl.level : '');
  dot.dataset.tip = hl ? hl.why : 'Жду первые замеры…';
  renderStageMute();
  renderStageLatency();
  renderStageStrip();
}
// запас у зрителя: «Плавно» — меньше рывков на неровной сети, «Быстро» — минимум задержки (для игр по очереди и т. п.)
function renderStageLatency() {
  const b = $('stage-lat'); const smooth = settings.screenLatency !== 'low';
  b.textContent = smooth ? 'Плавно' : 'Быстро';
  b.dataset.tip = smooth ? 'Плавно: копим 0,15 с картинки — меньше рывков. Нажмите для минимальной задержки' : 'Минимум задержки: без запаса, но на неровной сети возможны рывки. Нажмите для плавного режима';
  for (const x of $('ss-lat').children) x.classList.toggle('on', (x.dataset.lat === 'low') === !smooth);
}
function setStageLatency(mode) {
  if ((settings.screenLatency === 'low') === (mode === 'low')) return;
  set({ screenLatency: mode }); if (S.voice) S.voice.setLatency(); renderStageLatency();
  toast(mode === 'low' ? 'Демка: минимум задержки' : 'Демка: плавно (запас 0,15 с)', { kind: 'ok' });
}
$('stage-lat').onclick = () => setStageLatency(settings.screenLatency === 'low' ? 'smooth' : 'low');
for (const x of $('ss-lat').children) x.onclick = () => setStageLatency(x.dataset.lat);
$('stage-stop').onclick = () => S.voice && S.voice.unwatch();
$('ss-stop').onclick = () => S.voice && S.voice.unwatch();

// ---- полоса под демкой (1.20): кто смотрит (список присылает стример с 1.20), путь и качество ----
function renderStageStrip() {
  const w = S.voice && S.voice.watching;
  if (!w) return;
  const p = S.voice.peers.get(w);
  const s = p && p.screenStats;
  const list = p && p.remoteWatchers && p.remoteWatchers.length ? p.remoteWatchers : null;
  const names = list || [S.me];
  const path = p && p.sfuIn ? 'через сервер' : p && p.state === 'connected' && p.path ? (p.path === 'relay' ? 'через ретранслятор' : PATH_SHORT[p.path]) : '';
  const meta = [path, s && s.h ? `${s.h}p` : ''].filter(Boolean).join(' · ');
  const text = !list ? 'Вы смотрите' : names.length === 1 ? 'Смотрите только вы' : `Смотрят ${names.length}`;
  const box = $('ss-watch');
  const key = JSON.stringify([names, text, meta]);
  if (box.dataset.key === key) return; // аватарки не перерисовываем каждые 2 с
  box.dataset.key = key;
  const shown = names.slice(0, names.length > 4 ? 3 : 4);
  box.replaceChildren(el('div', { class: 'ss-stack' }, ...shown.map((n) => avatar(n)), names.length > shown.length ? el('span', { class: 'more', text: `+${names.length - shown.length}` }) : null),
    el('span', { class: 'ss-text' }, text, meta ? el('em', { text: ` · ${meta}` }) : null));
  box.dataset.tip = list ? `Смотрят: ${names.join(', ')}` : `Кто ещё смотрит, видно, когда у ${w} «Сходка» 1.20 или новее`;
}

// ---- «Отчёт о демке»: 60 с подробных замеров у вас и у стримера — в журнал (demoreport.js) ----
$('stage-report').onclick = () => S.demo && S.demo.start('viewer');
$('ss-report').onclick = () => S.demo && S.demo.start('viewer');
function renderDemoReport() {
  const b = $('stage-report'); const d = S.demo;
  const rec = !!(d && d.busy && d.cur.role === 'viewer');
  b.classList.toggle('rec', rec);
  if (rec) b.textContent = d.running ? String(d.left()) : '…'; else if (!b.querySelector('svg')) b.replaceChildren(icon('file'));
  b.dataset.tip = rec ? (d.running ? `Записываю отчёт о демке: осталось ${d.left()} с` : 'Отчёт о демке: собираю данные у стримера…')
    : 'Отчёт о демке: 60 секунд замеров у вас и у стримера — потом всё будет в журнале';
  const sb = $('ss-report');
  sb.classList.toggle('rec', rec);
  sb.querySelector('span').textContent = rec ? (d.running ? `Отчёт · ${d.left()} с` : 'Отчёт · жду стримера') : 'Отчёт о демке';
  sb.dataset.tip = b.dataset.tip;
  if (qmOwner === 'screen' && !$('quick-menu').hidden) renderScreenMenu();
}
// что видно у зрителя: размер окна демки в точках экрана, полный экран, приближение, пропуски кадров на экране
function stageView() {
  const v = $('stage-video');
  if ($('stage').hidden || !v.videoWidth) return null;
  const r = v.getBoundingClientRect(); const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
  return { vw: v.videoWidth, vh: v.videoHeight, cw: Math.round(r.width), ch: Math.round(r.height), dpr: devicePixelRatio, zoom: zoom.s, full: !!S.stageFull, dropped: q ? q.droppedVideoFrames : null };
}

// ---- приближение на демке: колёсико — к курсору, мышкой — двигать, 0 — как было ----
// Меняется только картинка у вас: зрители и стример ничего не замечают.
const ZOOM_MAX = 6;
const zoom = { s: 1, x: 0, y: 0, w: 0, h: 0, drag: null, of: null };
function applyZoom() {
  const st = $('stage'), v = $('stage-video');
  const W = st.clientWidth, H = st.clientHeight;
  if (zoom.w && W && (zoom.w !== W || zoom.h !== H)) { zoom.x *= W / zoom.w; zoom.y *= H / zoom.h; } // окно или полный экран — сохраняем место
  zoom.w = W; zoom.h = H;
  zoom.s = Math.max(1, Math.min(ZOOM_MAX, zoom.s));
  zoom.x = Math.min(0, Math.max(W - W * zoom.s, zoom.x)); // не даём увести картинку за край
  zoom.y = Math.min(0, Math.max(H - H * zoom.s, zoom.y));
  const dpr = devicePixelRatio || 1; // сдвиг — целыми пикселями экрана, иначе «1:1» снова чуть мылит
  zoom.x = Math.round(zoom.x * dpr) / dpr; zoom.y = Math.round(zoom.y * dpr) / dpr;
  v.style.transform = zoom.s === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  st.classList.toggle('zoomed', zoom.s > 1);
  $('zoom-val').textContent = Math.round(zoom.s * 100) + '%';
  $('zoom-out').disabled = zoom.s <= 1;
  $('zoom-in').disabled = zoom.s >= ZOOM_MAX;
  const n = nativeScale();
  $('zoom-native').hidden = !(n > 1.02);
  $('zoom-native').classList.toggle('on', n > 1.02 && Math.abs(zoom.s - n) < 0.01);
}
// «1:1»: один пиксель демки = один пиксель экрана. В окне демка обычно ужата (1440p в ~2,5 раза), и мелкий текст мылится.
function nativeScale() {
  const st = $('stage'), v = $('stage-video');
  if (!v.videoWidth || !st.clientWidth) return 1;
  const shown = Math.min(st.clientWidth, st.clientHeight * v.videoWidth / v.videoHeight); // ширина картинки на экране при 100%
  return Math.min(ZOOM_MAX, v.videoWidth / (shown * (devicePixelRatio || 1)));
}
function zoomNative() {
  const n = nativeScale();
  if (n <= 1.02) return;
  if (Math.abs(zoom.s - n) < 0.01) { resetZoom(); return; } // повторное нажатие — обратно 100%
  zoomAt(n / zoom.s);
}
function zoomAt(factor, cx, cy) { // точка (cx, cy) внутри демки остаётся под курсором
  const st = $('stage');
  if (cx == null) { cx = st.clientWidth / 2; cy = st.clientHeight / 2; }
  const ns = Math.max(1, Math.min(ZOOM_MAX, zoom.s * factor));
  const px = (cx - zoom.x) / zoom.s, py = (cy - zoom.y) / zoom.s;
  zoom.x = cx - px * ns; zoom.y = cy - py * ns; zoom.s = ns;
  if (ns === 1) { zoom.x = 0; zoom.y = 0; }
  applyZoom();
}
function resetZoom() { zoom.s = 1; zoom.x = 0; zoom.y = 0; applyZoom(); }
$('stage').addEventListener('wheel', (e) => {
  if (e.target.closest('.stage-bar')) return; // над полосой с кнопками колёсико не приближает
  e.preventDefault();
  const r = $('stage').getBoundingClientRect();
  const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0016)); // плавно и для мыши, и для тачпада
  zoomAt(k, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
$('stage-video').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || zoom.s <= 1) return;
  e.preventDefault();
  zoom.drag = { x: e.clientX - zoom.x, y: e.clientY - zoom.y };
  $('stage').classList.add('dragging');
});
addEventListener('mousemove', (e) => { if (!zoom.drag) return; zoom.x = e.clientX - zoom.drag.x; zoom.y = e.clientY - zoom.drag.y; applyZoom(); });
addEventListener('mouseup', () => { if (zoom.drag) { zoom.drag = null; $('stage').classList.remove('dragging'); } });
$('zoom-in').onclick = () => zoomAt(1.5);
$('zoom-out').onclick = () => zoomAt(1 / 1.5);
$('zoom-val').onclick = resetZoom;
$('zoom-native').onclick = zoomNative;
$('stage-video').addEventListener('resize', () => { if (!$('stage').hidden) applyZoom(); }); // сменилось разрешение демки
document.addEventListener('keydown', (e) => {
  if ($('stage').hidden || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(1 / 1.25); }
  else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  else if (e.key === '1') { e.preventDefault(); zoomNative(); }
});
new ResizeObserver(() => { if (!$('stage').hidden) applyZoom(); }).observe($('stage'));

// ---- рамка демки по пропорциям картинки: никаких чёрных полос по бокам или сверху ----
function fitStage() {
  const st = $('stage'), area = $('stage-area'), v = $('stage-video');
  if (st.hidden || S.stageFull) { st.style.width = ''; st.style.height = ''; st.classList.remove('fitted'); return; }
  const W = area.clientWidth, H = area.clientHeight;
  if (!W || !H) return;
  const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  const k = Math.min(W / vw, H / vh);
  const w = Math.max(1, Math.round(vw * k)) + 'px', h = Math.max(1, Math.round(vh * k)) + 'px';
  if (st.style.width !== w) st.style.width = w;
  if (st.style.height !== h) st.style.height = h;
  st.classList.toggle('fitted', !!v.videoWidth);
}
new ResizeObserver(fitStage).observe($('stage-area'));
$('stage-video').addEventListener('resize', fitStage);        // стример сменил разрешение или окно
$('stage-video').addEventListener('loadedmetadata', fitStage);

// ---- стрелка под демкой: свернуть плитки участников, чтобы демка стала крупнее (запоминается) ----
function renderTilesToggle() {
  const hidden = !!settings.stageTilesHidden;
  $('view-voice').classList.toggle('tiles-collapsed', hidden);
  const b = $('tiles-toggle');
  b.dataset.tip = hidden ? 'Показать участников' : 'Скрыть участников — демка станет крупнее';
  b.querySelector('span').textContent = hidden ? `Участники · ${S.voice ? roomMembers().length : 0}` : '';
}
$('tiles-toggle').onclick = () => { set({ stageTilesHidden: !settings.stageTilesHidden }); renderTilesToggle(); };
// ---- трансляция на весь экран ----
// Своя реализация: окно разворачивается на весь экран, трансляция растягивается на всё окно.
// Esc, конец трансляции, выход из комнаты или потеря связи всегда возвращают обычное окно.
S.stageFull = false;
let idleTimer = null;
function setStageFull(on) {
  on = !!on && !$('stage').hidden;
  if (S.stageFull === on) return;
  S.stageFull = on;
  document.body.classList.toggle('stage-full', on);
  fitStage();
  setIcon($('stage-full'), on ? 'x' : 'max');
  $('stage-full').dataset.tip = on ? 'Выйти из полного экрана · Esc' : 'На весь экран · двойной клик';
  api.setFullscreen(on).catch(() => {});
  if (on) stageActivity(); else { clearTimeout(idleTimer); $('stage').classList.remove('idle'); }
}
function stageActivity() {
  $('stage').classList.remove('idle');
  clearTimeout(idleTimer);
  if (S.stageFull) idleTimer = setTimeout(() => $('stage').classList.add('idle'), 2500); // панель и курсор прячутся, пока мышь не двигается
}
$('stage').addEventListener('mousemove', stageActivity);
$('stage-full').onclick = () => setStageFull(!S.stageFull);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.stageFull) { e.preventDefault(); e.stopPropagation(); setStageFull(false); } }, true);
if (api.onFullscreen) api.onFullscreen((on) => { if (!on && S.stageFull) setStageFull(false); }); // вышли из полного экрана средствами Windows
$('stage-vol').value = settings.screenVolume ?? 100;
$('stage-vol').oninput = (e) => {
  const v = Number(e.target.value);
  set({ screenVolume: v });
  if (S.voice) S.voice.setScreenVolume(v);
  renderStageMute();
};
function renderStageMute() {
  const muted = !S.voice || S.voice.screenMuted || Number($('stage-vol').value) === 0;
  $('stage-mute').classList.toggle('off', muted);
  setIcon($('stage-mute'), muted ? 'speaker-off' : 'volume');
  $('stage-mute').dataset.tip = muted ? 'Включить звук трансляции' : 'Выключить звук трансляции';
}
$('stage-mute').onclick = () => {
  if (!S.voice) return;
  if (Number($('stage-vol').value) === 0) { $('stage-vol').value = 100; set({ screenVolume: 100 }); S.voice.setScreenVolume(100); }
  else S.voice.setScreenMuted(!S.voice.screenMuted);
  renderStageMute();
};
$('stage-video').ondblclick = () => $('stage-full').click();

// Своя трансляция показывается отдельной карточкой с живым превью
let myScreenTile = null;
function myScreenTileEl() {
  const sc = S.voice && S.voice.screen;
  if (!sc) { myScreenTile = null; return null; }
  if (!myScreenTile || myScreenTile.dataset.stream !== sc.stream.id) {
    const v = el('video', { autoplay: true, playsinline: true }); v.muted = true; v.srcObject = sc.preview || sc.stream;
    myScreenTile = el('div', { class: 'tile screen-tile', 'data-stream': sc.stream.id },
      v, el('div', { class: 'st-foot' }, el('span', { class: 'live' }, 'в эфире'), el('span', { id: 'my-screen-stats' }),
        el('button', { class: 'icon-btn', id: 'my-screen-sound', onclick: () => { const a = screenAudioState(); if (a.disabled) return toast(a.sub); set({ screenAudio: !a.on }); S.voice.setScreenAudio(!a.on); } }, icon('volume')),
        el('button', { class: 'icon-btn', 'data-tip': 'Качество, звук, смена окна', onclick: (e) => openScreenMenu(e) }, icon('sliders')),
        el('button', { class: 'btn small danger', onclick: () => S.voice && S.voice.stopScreen() }, 'Стоп')));
  }
  const a = screenAudioState();
  const b = myScreenTile.querySelector('#my-screen-sound');
  b.classList.toggle('off', !a.on);
  setIcon(b, a.on ? 'volume' : 'speaker-off');
  b.dataset.tip = a.disabled ? a.sub : a.on ? 'Выключить звук трансляции' : 'Включить звук трансляции';
  const v = myScreenTile.querySelector('video');
  const src = sc.preview || sc.stream; // превью — 5 кадров в секунду: видеокарта не тратится на свою же демку
  // окно в фоне во время показа (человек в игре) — превью отключено: окно не перерисовывается ради него.
  // Захват видеокартой (1.19.0) — превью нет совсем: в окне только пустышка, картинка живёт в помощнике
  const paused = sc.gpu ? 'Захват видеокартой: превью нет — видеокарта не тратится на него. Зрители видят всё как обычно'
    : isBackground() ? 'Превью на паузе, пока окно в фоне — игре меньше нагрузки. Зрители видят всё как обычно' : '';
  if (paused) { if (v.srcObject) { v.srcObject = null; delete v.dataset.track; } }
  else if (v.srcObject !== src || v.dataset.track !== sc.video.id) { v.srcObject = null; v.srcObject = src; v.dataset.track = sc.video.id; v.play().catch(() => {}); }
  let note = myScreenTile.querySelector('.fp-note');
  if (paused && note && note.textContent !== paused) { note.remove(); note = null; }
  if (paused && !note) myScreenTile.insertBefore(el('div', { class: 'fp-note', text: paused }), v.nextSibling);
  else if (!paused && note) note.remove();
  return myScreenTile;
}
function renderMyScreen() { renderTiles(); }
function renderMyScreenStats() {
  const sc = S.voice && S.voice.screen;
  if (!sc) return;
  const viewers = [...S.voice.peers.values()].filter((p) => p.sentScreen);
  const st = viewers.filter((p) => !p.viaSfu).map((p) => p.outStats).filter(Boolean);
  if (S.voice.sfuOut && viewers.some((p) => p.viaSfu)) st.unshift(S.voice.sfuOut); // через сервер — один поток на всех
  const total = st.reduce((a, s) => a + s.mbps, 0);
  const first = st[0];
  const t = document.getElementById('my-screen-stats');
  if (t) {
    t.textContent = viewers.length ? `Смотрят: ${viewers.map((p) => p.name).join(', ')}${first ? `, ${first.fps} к/с` : ''}` : 'Пока никто не смотрит';
    t.title = first ? `${first.w}×${first.h}, ${first.fps} кадров/с, ${total.toFixed(1)} Мбит/с` : '';
  }
}

// окно ушло в фон во время показа / вернулось (footprint.js): превью и плитки — по месту
onBackground((bg) => {
  if (!S.voice) return;
  if (S.voice.screen) myScreenTileEl();
  if (!bg) { renderStageInfo(); renderMyScreenStats(); renderTilePings(); }
});

// индикаторы речи (окно в фоне во время показа — не обновляем: их никто не видит)
setInterval(() => {
  if (!S.voice || isBackground()) return;
  for (const p of S.voice.peers.values()) {
    const speaking = output.level('voice:' + p.name) > -50;
    if (speaking !== p.speaking) {
      p.speaking = speaking;
      document.querySelectorAll(`[data-speak="${CSS.escape(p.name)}"]`).forEach((e) => {
        if (e.classList.contains('tile')) e.classList.toggle('speaking', speaking);
        const a = e.querySelector('.avatar'); if (a) a.classList.toggle('speaking', speaking);
      });
    }
  }
  const tile = document.querySelector(`.tile[data-speak="${CSS.escape(S.me || '')}"]`);
  if (tile) tile.classList.toggle('speaking', mic.speaking);
}, 100);

// ===================== рация (push-to-talk) =====================
function matchPtt(type, code) { const b = settings.pttBinding; return b && b.dom && b.dom.type === type && b.dom.code === code; }
document.addEventListener('keydown', (e) => { if (settings.mode === 'ptt' && !e.repeat && matchPtt('key', e.code) && !(e.target.matches && e.target.matches('input,textarea'))) mic.setPtt(true); });
document.addEventListener('keyup', (e) => { if (settings.mode === 'ptt' && matchPtt('key', e.code)) mic.setPtt(false); });
document.addEventListener('mousedown', (e) => { if (settings.mode === 'ptt' && matchPtt('mouse', e.button)) mic.setPtt(true); });
document.addEventListener('mouseup', (e) => { if (settings.mode === 'ptt' && matchPtt('mouse', e.button)) mic.setPtt(false); });
let pttGlobalActive = false;
window.addEventListener('blur', () => { if (!pttGlobalActive) mic.setPtt(false); });
api.onPtt((down) => { if (settings.mode === 'ptt') mic.setPtt(down); });
async function configurePtt() {
  const b = settings.pttBinding;
  const r = await api.pttSet(b && b.ui ? b.ui : null, settings.mode === 'ptt' && settings.pttGlobal);
  pttGlobalActive = !!r.global;
}
configurePtt();

// ===================== контекстное меню участника =====================
let popName = null;
function openPopover(e, name) {
  e.preventDefault();
  popName = name;
  const pop = $('popover');
  $('pop-title').replaceChildren(avatar(name), el('span', { text: name }));
  const v = (settings.userVolumes || {})[name] ?? 100;
  $('pop-vol').value = v; $('pop-vol-val').textContent = v + '%';
  $('pop-dm').textContent = 'Написать';
  $('pop-dm').onclick = () => { pop.hidden = true; openChannel('dm:' + name); };
  const u = S.users.find((x) => sameName(x.name, name));
  const admin = S.isAdmin && u && !sameName(name, S.me);
  $('pop-del').hidden = !admin || (!u.online ? false : !S.isHost && !serverHas('admins')); // старый сервер не умеет удалять тех, кто в сети
  $('pop-release').hidden = !(admin && !u.online && serverHas('password'));
  $('pop-log').hidden = !(admin && u.online && serverHas('logpull'));
  $('pop-log').onclick = () => { pop.hidden = true; requestLog(name); };
  $('pop-release').onclick = async () => {
    pop.hidden = true;
    if (!confirm(`Освободить ник «${name}»?\nЕго пароль и привязка к компьютерам сбросятся. Первый, кто войдёт под этим ником, получит аккаунт со всеми друзьями и перепиской.\nДелайте это, только если человек сам попросил (потерял пароль и папку программы).`)) return;
    try { await S.conn.request({ type: 'admin_release_user', name }); toast(`Ник «${name}» освобождён — пусть ${name} войдёт под ним`, { kind: 'ok' }); } catch (err) { toast(err.message, { kind: 'error' }); }
  };
  $('pop-del').onclick = async () => {
    pop.hidden = true;
    const on = !!(u && u.online);
    if (!confirm(on ? `Удалить «${name}» с сервера?\nОн сейчас в сети — его сразу отключит от сервера и голосовой комнаты.\nЛичная переписка с ним сохранится в архиве. Ник «${name}» 10 минут нельзя будет занять снова; потом под ним можно зайти — это будет новый, пустой аккаунт.`
      : `Удалить «${name}» с сервера?\nОн пропадёт из списка. Если человек зайдёт снова под этим ником — просто появится заново.`)) return;
    try { await S.conn.request({ type: 'admin_delete_user', name, force: on }); toast(`${name} удалён с сервера`, { kind: 'ok' }); } catch (err) { toast(err.message, { kind: 'error' }); }
  };
  pop.hidden = false;
  pop.style.left = Math.min(e.clientX, innerWidth - 250) + 'px';
  pop.style.top = Math.min(e.clientY, innerHeight - (S.isAdmin ? 290 : 170)) + 'px';
}
$('pop-vol').oninput = (e) => {
  const v = Number(e.target.value);
  $('pop-vol-val').textContent = v + '%';
  set({ userVolumes: { ...(settings.userVolumes || {}), [popName]: v } });
  output.setSourceVolume('voice:' + popName, v);
};
document.addEventListener('mousedown', (e) => { if (!$('popover').hidden && !$('popover').contains(e.target)) $('popover').hidden = true; });

// ===================== выбор экрана =====================
let pickerSources = []; let pickerTab = 'screen'; let pickerSel = null; let pickerMode = 'start';
async function openPicker(mode = 'start') {
  if (!S.voice) return;
  pickerMode = mode;
  pickerSel = null; $('picker-go').disabled = true;
  // звук выбирается здесь, при запуске показа: экран — со звуком или без; окно — звук только этой программы,
  // весь звук или без звука. Выбор запоминается до следующего раза.
  pickerSound = !CAN_PICK_AUDIO || !settings.screenAudio ? 'off' : 'on';
  $('picker-snd').hidden = mode === 'switch' || !CAN_PICK_AUDIO;
  $('picker-go').textContent = mode === 'switch' ? 'Переключить' : 'Показать';
  $('picker').querySelector('h2').textContent = mode === 'switch' ? 'Что показывать вместо этого?' : 'Что показать?';
  $('picker-summary').textContent = mode === 'switch' ? 'Зрители продолжат смотреть — трансляция не прервётся.'
    : `Качество: ${customNote()}, режим «${settings.screenMode === 'detail' ? 'Текст' : 'Игра'}». Изменить — стрелка у кнопки показа.`;
  // 1.19.0: «Видеокартой, как OBS» показывает только весь экран — вкладки «Окно программы» нет
  const gpuOnly = mode === 'switch' ? !!(S.voice.screen && S.voice.screen.gpu) : !!(settings.screenGpu && S.gpuAvail);
  document.querySelector('[data-ptab="window"]').hidden = gpuOnly;
  if (gpuOnly) { pickerTab = 'screen'; $('picker-summary').textContent += ' Захват видеокартой — только весь экран, в его разрешении.'; }
  $('picker-grid').replaceChildren(el('div', { class: 'hint', text: 'Загружаю список…' }));
  $('picker').showModal();
  pickerSources = await api.screenSources();
  if (!pickerSources.length) { $('picker-grid').replaceChildren(el('div', { class: 'hint', text: 'Не удалось получить список экранов. Причина — в журнале.' })); return; }
  const screens = pickerSources.filter((x) => x.isScreen);
  // 1.19.3: основной монитор — первым; под каждым экраном размер и пометки «основной» / «здесь «Сходка»»
  // (у irritat «Экран 1» был монитором со «Сходкой», а игра — на другом). Выбирает по-прежнему человек
  if (screens.length > 1) {
    screens.sort((a, b) => (b.disp && b.disp.primary ? 1 : 0) - (a.disp && a.disp.primary ? 1 : 0));
    pickerSources = [...screens, ...pickerSources.filter((x) => !x.isScreen)];
  }
  screens.forEach((x, i) => {
    x.name = screens.length === 1 ? 'Весь экран' : `Экран ${i + 1}`;
    const d = x.disp; const many = screens.length > 1;
    x.sub = d ? [`${d.w}×${d.h}`, many && d.primary ? 'основной' : '', many && d.here ? 'здесь «Сходка»' : ''].filter(Boolean).join(' · ') : '';
    x.warn = !!(d && many && d.here);
  });
  if (screens.length === 1 && pickerTab === 'screen') pickerSel = screens[0].id;
  $('picker-go').disabled = !pickerSel;
  renderPicker();
}
let pickerSound = 'on'; // 'on' | 'off'; у окна ещё 'all' (весь звук), а 'on' у окна — только эта программа
// звук компьютера передаётся только в Windows (в автотестах — подставной помощник записи звука)
const CAN_PICK_AUDIO = CAN_SHARE_AUDIO || !!(api.testFlags && api.testFlags.fakeProcAudio);
function renderPickerSound() {
  const win = pickerTab === 'window';
  const opts = win ? [['on', 'Звук программы'], ['all', 'Весь звук'], ['off', 'Без звука']] : [['on', 'Со звуком'], ['off', 'Без звука']];
  if (pickerSound === 'all' && !win) pickerSound = 'on';
  if (pickerSound === 'on' && win && settings.screenAudioWindowOnly === false) pickerSound = 'all';
  $('picker-snd').replaceChildren(...opts.map(([v, t]) => el('button', { type: 'button', class: 'seg-btn' + (pickerSound === v ? ' active' : ''), onclick: () => { pickerSound = v; renderPickerSound(); } }, t)));
  // какой звук услышат друзья
  $('picker-sound').textContent = !CAN_PICK_AUDIO ? 'Звук компьютера можно передавать только в Windows' : pickerSound === 'off' ? 'Друзья увидят картинку без звука'
    : win && pickerSound === 'on' ? 'Звук: друзья услышат только эту программу'
      : 'Звук: весь звук компьютера, кроме голосов из «Сходки»';
}
function renderPicker() {
  document.querySelectorAll('[data-ptab]').forEach((t) => t.classList.toggle('active', t.dataset.ptab === pickerTab));
  renderPickerSound();
  const grid = $('picker-grid'); grid.textContent = '';
  for (const s of pickerSources.filter((x) => (pickerTab === 'screen') === x.isScreen)) {
    grid.append(el('button', { class: 'src' + (pickerSel === s.id ? ' sel' : ''), onclick: () => { pickerSel = s.id; $('picker-go').disabled = false; renderPicker(); }, ondblclick: () => $('picker-go').click() },
      s.thumb ? el('img', { class: 'thumb', src: s.thumb, alt: '' }) : el('div', { class: 'thumb' }),
      el('div', { class: 'sname' }, s.icon ? el('img', { src: s.icon, alt: '' }) : null, s.name),
      s.sub ? el('div', { class: 'ssub' + (s.warn ? ' here' : '') }, s.sub) : null));
  }
  // выбран монитор, на котором открыта «Сходка», а мониторов несколько — друзья увидят окно программы
  const sel = pickerTab === 'screen' && pickerSources.find((x) => x.id === pickerSel);
  $('picker-warn').textContent = sel && sel.warn ? 'На этом мониторе открыта «Сходка» — друзья увидят её окно. Игра на другом мониторе? Выберите его.' : '';
}
document.querySelectorAll('[data-ptab]').forEach((t) => { t.onclick = () => { pickerTab = t.dataset.ptab; renderPicker(); }; });
$('picker-close').onclick = () => $('picker').close();
// что сейчас слышат зрители — для всплывашки после запуска показа
function screenAudioText(sc) {
  if (!sc.audio) return 'Без звука.';
  if (!sc.audio.enabled) return 'Звук выключен.';
  if (sc.audioSource === 'window') return 'Друзья слышат звук только этого окна.';
  if (sc.audioNote === 'computer') return 'Звук только этого окна записать не удалось — друзья слышат весь звук компьютера (подробности в журнале).';
  return 'Звук компьютера включён.';
}
// 1.19.3: в журнал — какой монитор показывается; при захвате видеокартой — снимает ли помощник экран того же размера
// (номер экрана у Windows и у помощника могут не совпасть на ПК с двумя мониторами или видеокартами)
function noteScreen(src, sc) {
  if (!src || !src.isScreen || !src.disp || !sc) return;
  const d = src.disp; const n = pickerSources.filter((x) => x.isScreen).length;
  log.info('screen', `Показываю ${n > 1 ? src.name.toLowerCase() : 'весь экран'}: монитор ${d.w}×${d.h}${n > 1 ? `${d.primary ? ', основной' : ', не основной'}${d.here ? ', на нём окно «Сходки»' : ''} (мониторов: ${n})` : ''}`);
  const g = sc.gpu && sc.gpu.info;
  if (g && (Math.abs(g.w - d.w) > 2 || Math.abs(g.h - d.h) > 2)) {
    log.warn('screen', `Захват видеокартой снимает ${g.w}×${g.h}, а выбранный монитор — ${d.w}×${d.h}: возможно, снимается другой монитор`, { hint: 'Спросите у друзей, что они видят. Если не тот монитор — «Сменить экран» в меню показа или выключите «Видеокартой, как OBS» и пришлите журнал.' });
  }
}
$('picker-go').onclick = async () => {
  const id = pickerSel; const audio = CAN_PICK_AUDIO && pickerSound !== 'off';
  if (audio && pickerTab === 'window') set({ screenAudioWindowOnly: pickerSound === 'on' });
  const src = pickerSources.find((x) => x.id === id);
  const name = (src || {}).name || '';
  $('picker').close();
  if (pickerMode === 'switch' && S.voice.screen) {
    try { const sc = await S.voice.switchSource(id, name); if (!sc) return; noteScreen(src, sc); toast(`Теперь показываете «${name}»`, { kind: 'ok', hint: screenAudioText(sc) }); } catch (e) { toast('Не удалось переключить', { kind: 'error', hint: 'Причина — в журнале (нажмите)', onclick: () => logPanel.filterErrors() }); }
    return;
  }
  set({ screenAudio: audio });
  try {
    const sc = await S.voice.startScreen(id, audio, name);
    if (!sc) return; // пока запускался, показ отменили (вышли из голоса или начали другой)
    noteScreen(src, sc);
    toast('Вы показываете экран', { kind: 'ok', hint: `${screenAudioText(sc)} Качество и звук — стрелка у кнопки показа.` });
  } catch (e) {
    // 1.19.2: если у ошибки есть готовый совет (например, нет помощника видеокарты) — сразу показываем его
    toast('Показ экрана не запустился', { kind: 'error', hint: e.hint ? `${e.message}. ${e.hint}` : 'Причина — в журнале (нажмите)', timeout: e.hint ? 20000 : undefined, onclick: () => logPanel.filterErrors() });
  }
};

// ===================== настройки =====================
const dlg = $('settings');
let settingsOwnsMic = false;
let meterTimer = null;
$('btn-settings').onclick = () => openSettings();
$('settings-close').onclick = () => dlg.close();
dlg.addEventListener('close', async () => {
  clearInterval(meterTimer);
  await mic.monitor(false);
  if (abAudio) abAudio.pause();
  label($('s-test'), 'play', 'Послушать себя');
  if (settingsOwnsMic && !S.inVoice) await mic.stop();
  settingsOwnsMic = false;
});
document.querySelectorAll('[data-stab]').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('[data-stab]').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('[data-spane]').forEach((p) => { p.hidden = p.dataset.spane !== b.dataset.stab; });
  };
});

async function fillDevices() {
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) { log.warn('audio', `Список устройств недоступен: ${e.message}`); }
  const fill = (sel, kind, cur) => {
    sel.textContent = '';
    sel.append(el('option', { value: 'default' }, 'Как в Windows (по умолчанию)'));
    for (const d of devs.filter((x) => x.kind === kind && x.deviceId !== 'default' && x.deviceId !== 'communications')) sel.append(el('option', { value: d.deviceId }, d.label || `Устройство ${d.deviceId.slice(0, 6)}`));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'default';
  };
  fill($('s-input'), 'audioinput', settings.inputDevice);
  fill($('s-output'), 'audiooutput', settings.outputDevice);
}

function fillCodecs() {
  const caps = new Set(((RTCRtpSender.getCapabilities('video') || {}).codecs || []).map((c) => c.mimeType.replace('video/', '')));
  const sel = $('s-codec'); sel.textContent = '';
  const labels = { H264: 'H.264 (рекомендуется)', H264SW: 'H.264 — процессор (если с видеокартой у зрителей чёрный экран)', H264MT: 'H.264 — сжатие на нескольких ядрах (процессор)', VP9: 'VP9 (качественнее, грузит процессор)', AV1: 'AV1 — сжимает процессор, тяжело (и зрителям без новых видеокарт)' };
  for (const c of ['H264', 'H264SW', 'H264MT', 'VP9', 'AV1']) { const ok = caps.has(c === 'H264SW' || c === 'H264MT' ? 'H264' : c); sel.append(el('option', { value: c, disabled: !ok }, labels[c] + (ok ? '' : ' (недоступен)'))); }
  sel.value = settings.screenCodec;
  renderGpuCodec();
}

// 1.20.1: «Видеокартой, как OBS» сжимает всегда в H.264 — выбор кодека тогда ни на что не влияет, и он неактивен.
// «Сжатие на нескольких ядрах» перезапуска больше не просит (main.js включает его при каждом запуске)
function renderGpuCodec() {
  const gpu = !!settings.screenGpu;
  $('s-codec').disabled = gpu;
  $('s-codec-note').hidden = !gpu;
  $('s-gpu').checked = gpu; $('s-gpu').disabled = !S.gpuAvail && !gpu; // включён без помощника — можно выключить
}

function syncSettingsUi() {
  const s = settings;
  $('s-gain').value = s.inputGain; $('s-gain-val').textContent = s.inputGain + '%';
  document.querySelectorAll('[name="s-mode"]').forEach((r) => { r.checked = r.value === s.mode; });
  $('s-vad-box').hidden = s.mode !== 'vad'; $('s-ptt-box').hidden = s.mode !== 'ptt';
  $('s-vad').value = s.vadThreshold; $('s-vad-val').textContent = s.vadThreshold + ' дБ';
  $('s-ptt-key').textContent = s.pttBinding ? s.pttBinding.label : 'не назначена';
  $('s-ptt-global').checked = s.pttGlobal;
  $('s-ptt-rel').value = s.pttReleaseMs; $('s-ptt-rel-val').textContent = s.pttReleaseMs + ' мс';
  $('s-noise').value = s.noise; $('s-echo').checked = s.echoCancellation; $('s-agc').checked = s.autoGain;
  $('s-outvol').value = s.outputVolume; $('s-outvol-val').textContent = s.outputVolume + '%';
  $('s-sounds').checked = s.sounds;
  $('s-nick').value = S.me || settings.nick || ''; $('s-nick').disabled = $('s-nick-save').disabled = !S.me;
  paintProfileAvatar(); paintPasswordUi();
  $('s-tray').checked = s.closeToTray !== false;
  $('s-res').value = s.screenRes; $('s-fps').value = String(s.screenFps);
  $('s-bitrate').value = s.screenBitrate; $('s-bitrate-val').textContent = s.screenBitrate + ' Мбит/с';
  $('s-slat').value = s.screenLatency || 'smooth';
  document.querySelectorAll('[data-smode]').forEach((b) => b.classList.toggle('active', (s.screenMode === 'detail') === (b.dataset.smode === 'detail')));
  renderNetResult();
  $('s-ice').value = s.iceServers; $('s-verbose').checked = s.verboseLog; $('s-relay').checked = s.forceRelay;
  $('s-sfu').checked = s.screenViaServer !== false;
  $('s-p2p').checked = !!s.filesDirect;
  const sens = s.vadThreshold <= -65 ? 'высокая' : s.vadThreshold <= -40 ? 'средняя' : 'низкая';
  $('s-vad-val').textContent = sens;
  $('s-vad-auto').checked = s.vadAuto;
  $('s-vad-manual').hidden = s.vadAuto;
  $('s-keyboard').checked = s.keyboardFilter;
  $('s-highpass').checked = s.highpass;
  $('s-strength-box').hidden = s.noise !== 'dfn';
  document.querySelectorAll('[data-strength]').forEach((b) => b.classList.toggle('active', b.dataset.strength === s.noiseStrength));
  $('s-strength-note').textContent = { soft: 'Голос максимально естественный, фон слышен чуть-чуть.', normal: 'Баланс: фон почти не слышен, голос звучит естественно.', strong: 'Фон убирается полностью, но голос может звучать чуть «суше».' }[s.noiseStrength] || '';
  updateThresholdUi();
}
// «Игра» / «Текст» — что показываю (1.15.5: выбирается только вручную)
document.querySelectorAll('[data-smode]').forEach((b) => { b.onclick = () => set({ screenMode: b.dataset.smode }); });

// ---------- «Проверить интернет» ----------
// Сколько стример может отдавать: шлём данные на сервер 6 секунд. Качество проверка не меняет (1.15.5: оно только своё),
// а во время показа отдача делится между зрителями с запасом 15 % — выбранная скорость остаётся потолком.
const netTest = { running: false, progress: 0, error: '' };
function renderNetResult() {
  const out = $('s-net'); const bar = $('s-net-bar');
  if (!out) return;
  bar.hidden = !netTest.running; bar.firstElementChild.style.width = Math.round(netTest.progress * 100) + '%';
  $('s-nettest').disabled = netTest.running;
  if (netTest.running) { out.textContent = 'Проверяю: отправляю данные на сервер 6 секунд…'; return; }
  if (netTest.error) { out.textContent = `Не получилось: ${netTest.error}`; return; }
  const n = settings.screenNet;
  if (!n || !n.up) { out.textContent = 'Узнает вашу скорость отдачи: тогда демка не будет отдавать больше, чем тянет интернет, и поделит его между зрителями поровну.'; return; }
  const want = Number(settings.screenBitrate) || 8;
  const fits = Math.floor((n.up * 0.85) / want);
  const when = new Date(n.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  out.replaceChildren(
    'Отдача: ', el('b', { text: `${fmtMbps(n.up)} Мбит/с` }), `. ${fits >= 1 ? `При ваших ${want} Мбит/с на зрителя хватит на ${fits} ${plural(fits, 'зрителя', 'зрителей', 'зрителей')}` : `На ${want} Мбит/с даже одному зрителю не хватает`}`,
    `${fits >= 1 ? '; больше зрителей — отдача поделится поровну' : ` — каждый получит до ${fmtMbps(Math.max(1, n.up * 0.85))} Мбит/с`}. `, n.hw === true ? 'Сжимает видеокарта ✓ ' : n.hw === false ? 'Сжимает процессор — в тяжёлых играх может не успевать. ' : '',
    el('span', { class: 'muted', text: `Проверено ${when}.` }));
}
async function runNetTest({ silent = false } = {}) {
  if (netTest.running) return;
  if (!S.conn) { if (!silent) toast('Сначала подключитесь к серверу'); return; }
  if (silent && !serverHas('speedtest')) return;
  if (!serverHas('speedtest')) { toast('Сервер не умеет проверять интернет', { hint: 'Обновите сервер до 1.15.1 — проверка появится.' }); netTest.error = 'сервер старый — обновите его до 1.15.1'; renderNetResult(); return; }
  netTest.running = true; netTest.progress = 0; netTest.error = ''; renderNetResult(); if (qmOwner === 'screen') renderScreenMenu();
  const token = (settings.tokens || {})[`${S.host}:${S.port}`];
  try {
    const [r, hw] = await Promise.all([measureUpload(serverBase(S), token, { maxMs: silent ? 4000 : 6000, onProgress: (f) => { netTest.progress = f; renderNetResult(); } }), hwH264()]);
    if (!(r.mbps > 0)) throw new Error('не удалось измерить');
    const others = S.inVoice ? roomMembers().filter((m) => !sameName(m.name, S.me)).length : 0;
    const viewers = Math.max(1, Math.min(4, others || 2));
    const { per, best } = pickQuality(r.mbps, viewers);
    // проверка во время своей демки занижена (отдача уже занята показом): хуже прежней свежей — прежнюю не затираем
    const prevNet = settings.screenNet;
    if (S.voice && S.voice.screen && prevNet && prevNet.up > r.mbps && Date.now() - (prevNet.at || 0) < 14 * 864e5) {
      log.info('screen', `Проверка интернета во время показа: ${fmtMbps(r.mbps)} Мбит/с — меньше прежней (${fmtMbps(prevNet.up)}), оставляю прежнюю`);
      if (!silent) toast(`Во время показа отдача занята демкой — оставил прежний результат ${fmtMbps(prevNet.up)} Мбит/с`, { hint: 'Чтобы перепроверить, остановите показ и нажмите «Проверить интернет».' });
      return;
    }
    set({ screenNet: { up: Math.round(r.mbps * 10) / 10, mbps: per, at: Date.now(), host: S.host, hw } });
    log.info('screen', `${silent ? 'Тихая проверка' : 'Проверка'} интернета: отдача ${fmtMbps(r.mbps)} Мбит/с (${Math.round(r.bytes / 1048576)} МБ за ${(r.ms / 1000).toFixed(1)} с), ${best >= 1 ? `лучшего качества (10 Мбит/с на зрителя) хватит на ${best} ${plural(best, 'зрителя', 'зрителей', 'зрителей')}` : 'на лучшее качество (10 Мбит/с на зрителя) не хватает даже одному зрителю — демка пойдёт с меньшей скоростью'}${hw === true ? ', сжимает видеокарта' : hw === false ? ', сжимает процессор' : ''}${S.voice && S.voice.screen ? ' (проверка шла во время показа — отдача может быть занижена)' : ''}`);
    if (!silent) { const want = Number(settings.screenBitrate) || 8; const fits = Math.floor((r.mbps * 0.85) / want); toast(`Отдача ${fmtMbps(r.mbps)} Мбит/с`, { kind: 'ok', hint: fits >= 1 ? `При ваших ${want} Мбит/с на зрителя хватит на ${fits} ${plural(fits, 'зрителя', 'зрителей', 'зрителей')}. Зрителей больше — отдача поделится поровну.` : `На ${want} Мбит/с не хватает — демка будет отдавать столько, сколько тянет интернет.` }); }
  } catch (e) {
    netTest.error = e.message;
    log.warn('screen', `Проверка интернета не удалась: ${e.message}`);
  } finally {
    netTest.running = false; renderNetResult(); if (qmOwner === 'screen') renderScreenMenu();
  }
}
$('s-nettest').onclick = () => runNetTest();
// Тихая проверка интернета (1.15.2): без неё демка не знает отдачу — не делит её между зрителями, а «быстрый старт» выключен.
// Проверяем сами, когда человек подключён к серверу, но не в голосе (4 с отправки не помешают разговору):
// если проверки ещё не было, она для другого сервера или ей больше недели. Не чаще раза в час на сервер.
const silentNet = { tried: Object.create(null), ok: 0 };
setInterval(() => {
  const n = settings.screenNet;
  const fresh = n && n.up > 0 && n.host === S.host && Date.now() - (n.at || 0) < 7 * 864e5;
  const key = `${S.host}:${S.port}`;
  const ready = S.conn && S.me && !S.inVoice && !(S.voice && S.voice.screen) && !netTest.running && serverHas('speedtest');
  if (fresh || !ready || Date.now() - (silentNet.tried[key] || 0) < 3600e3) { silentNet.ok = 0; return; }
  if (++silentNet.ok < 2) return; // условия держатся ~20 с — человек не собирается сразу в комнату
  silentNet.tried[key] = Date.now(); silentNet.ok = 0;
  runNetTest({ silent: true });
}, 10e3);
const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 90) / 90) * 100));
function updateThresholdUi() {
  const auto = settings.vadAuto;
  const thr = auto ? mic.autoThreshold : settings.vadThreshold;
  $('s-meter-thr').hidden = thr == null || settings.mode !== 'vad';
  if (thr != null) $('s-meter-thr').style.left = dbToPct(thr) + '%';
  $('s-vad-note').textContent = auto
    ? 'Программа сама следит за фоном и вашим голосом. Сиреневая метка на полоске — текущий порог: голос должен заходить за неё.'
    : 'Сиреневая метка на полоске — порог. Голос должен заходить за неё, а фоновый шум — нет.';
}
document.querySelectorAll('[data-strength]').forEach((b) => { b.onclick = () => set({ noiseStrength: b.dataset.strength }); });

// ===================== обновления (1.20.5, GitHub Releases) =====================
let updState = { status: 'idle' };
let updToastFor = '';
function paintUpdate() {
  const s = updState;
  const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',');
  const text = {
    idle: 'Обновления проверяются сами при запуске и раз в 4 часа',
    checking: 'Проверяю, есть ли новая версия…',
    none: `У вас последняя версия — ${s.current || ''}`,
    downloading: `Скачиваю версию ${s.version || ''}${s.total ? ` — ${s.percent || 0}% (${mb(s.transferred || 0)} из ${mb(s.total)} МБ)` : '…'}`,
    ready: `Версия ${s.version} скачана. Поставится при перезапуске или при выходе из «Сходки»`,
    error: `Не удалось проверить обновления: ${s.error || 'ошибка'}`,
    unsupported: s.reason || 'Обновления недоступны',
  }[s.status] || '';
  $('upd-text').textContent = text;
  $('upd-check').hidden = s.status === 'ready' || s.status === 'unsupported';
  $('upd-check').disabled = s.status === 'checking' || s.status === 'downloading';
  $('upd-install').hidden = s.status !== 'ready';
  $('upd-bar').hidden = s.status !== 'downloading';
  $('upd-fill').style.width = (s.percent || 0) + '%';
}
function installUpdate() {
  if (S.inVoice && !confirm(`Перезапустить «Сходку» для обновления до ${updState.version}? Звонок прервётся на несколько секунд.`)) return;
  api.update.install();
}
function onUpdate(s) {
  updState = s || updState;
  paintUpdate();
  if (updState.status === 'ready' && updToastFor !== updState.version) {
    updToastFor = updState.version;
    log.info('update', `Скачана новая версия ${updState.version}`);
    toast(`Доступна новая версия ${updState.version}`, { kind: 'ok', hint: 'Нажмите, чтобы перезапустить и обновить. Или она поставится сама при выходе.', timeout: 20000, onclick: installUpdate });
  }
}
$('upd-check').onclick = () => api.update.check().then(onUpdate);
$('upd-install').onclick = installUpdate;
api.update.onState(onUpdate);
api.update.state().then(onUpdate);

async function openSettings(tab) {
  if (tab) { const b = document.querySelector(`[data-stab="${tab}"]`); if (b) b.click(); }
  syncSettingsUi();
  fillCodecs();
  dlg.showModal();
  if (!mic.running) {
    settingsOwnsMic = true;
    await mic.start().catch(() => {});
  }
  await fillDevices();
  renderInterfaces('s-ifaces');
  const i = await api.appInfo();
  $('s-about').textContent = `Сходка ${i.version}\nСистема: ${i.os}\nПроцессор: ${i.cpuModel} (${i.cpus} потоков), память ${i.memGb} ГБ\nДвижок: Electron ${i.electron}, Chromium ${i.chrome}\n\nДанные и база сервера:\n${i.userData}\n\nЖурналы:\n${i.logDir}`;
  clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    const f = $('s-meter');
    f.style.width = dbToPct(mic.level) + '%';
    if (settings.vadAuto) updateThresholdUi();
    f.classList.toggle('open', mic.open);
  }, 50);
}

const bindInput = (id, key, conv = (v) => v, ev = 'change') => $(id).addEventListener(ev, (e) => set({ [key]: conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value) }));
bindInput('s-input', 'inputDevice');
bindInput('s-output', 'outputDevice');
bindInput('s-gain', 'inputGain', Number, 'input');
bindInput('s-vad', 'vadThreshold', Number, 'input');
bindInput('s-ptt-global', 'pttGlobal');
bindInput('s-ptt-rel', 'pttReleaseMs', Number, 'input');
bindInput('s-noise', 'noise');
bindInput('s-vad-auto', 'vadAuto');
bindInput('s-keyboard', 'keyboardFilter');
bindInput('s-highpass', 'highpass');
bindInput('s-echo', 'echoCancellation');
bindInput('s-agc', 'autoGain');
bindInput('s-outvol', 'outputVolume', Number, 'input');
bindInput('s-sounds', 'sounds');
bindInput('s-tray', 'closeToTray');
bindInput('s-res', 'screenRes');
bindInput('s-fps', 'screenFps', Number);
bindInput('s-bitrate', 'screenBitrate', Number, 'input');
bindInput('s-codec', 'screenCodec');
bindInput('s-gpu', 'screenGpu');
bindInput('s-slat', 'screenLatency');
bindInput('s-ice', 'iceServers');
bindInput('s-verbose', 'verboseLog');
bindInput('s-relay', 'forceRelay');
bindInput('s-sfu', 'screenViaServer');
bindInput('s-p2p', 'filesDirect');
document.querySelectorAll('[name="s-mode"]').forEach((r) => r.addEventListener('change', () => set({ mode: r.value })));

$('s-test').onclick = async () => {
  const on = !mic.monitorEl;
  if (on && !mic.running) await mic.start().catch(() => {});
  await mic.monitor(on, settings.outputDevice);
  label($('s-test'), on ? 'x' : 'play', on ? 'Хватит' : 'Послушать себя');
};

let abUrls = null;
let abAudio = null;
$('s-rec').onclick = async () => {
  const btn = $('s-rec');
  if (!mic.running) await mic.start().catch(() => {});
  if (!mic.running) { toast('Микрофон не работает — причина в журнале', { kind: 'error' }); return; }
  btn.disabled = true;
  let left = 5;
  btn.textContent = `Говорите… ${left}`;
  const timer = setInterval(() => { left--; if (left > 0) btn.textContent = `Говорите… ${left}`; }, 1000);
  try {
    const { before, after } = await mic.recordTest(5);
    if (abUrls) { URL.revokeObjectURL(abUrls.before); URL.revokeObjectURL(abUrls.after); }
    abUrls = { before: URL.createObjectURL(before), after: URL.createObjectURL(after) };
    $('s-ab').hidden = false;
    playAb('after');
  } catch (e) {
    log.error('mic', `Не удалось записать пробу: ${e.message}`, { err: e });
  } finally {
    clearInterval(timer);
    btn.disabled = false; btn.textContent = 'Записать ещё раз';
  }
};
async function playAb(which) {
  if (!abUrls) return;
  if (abAudio) abAudio.pause();
  abAudio = new Audio(abUrls[which]);
  if (settings.outputDevice !== 'default' && abAudio.setSinkId) await abAudio.setSinkId(settings.outputDevice).catch(() => {});
  abAudio.play().catch((e) => log.warn('audio', `Не удалось воспроизвести: ${e.message}`));
}
$('s-play-before').onclick = () => playAb('before');
$('s-play-after').onclick = () => playAb('after');

$('s-ptt-bind').onclick = async () => {
  const btn = $('s-ptt-bind');
  btn.textContent = 'Нажмите нужную клавишу…'; btn.disabled = true;
  const domPromise = new Promise((resolve) => {
    const onKey = (e) => { e.preventDefault(); cleanup(); resolve({ type: 'key', code: e.code, label: e.code.replace(/^Key|^Digit/, '').replace('Left', ' (лев.)').replace('Right', ' (прав.)') }); };
    const onMouse = (e) => { if (e.button < 3 && e.button !== 1) return; e.preventDefault(); cleanup(); resolve({ type: 'mouse', code: e.button, label: e.button === 1 ? 'Колесо мыши' : `Мышь ${e.button + 1}` }); };
    const cleanup = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); };
    setTimeout(() => { document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onMouse, true); }, 150);
    setTimeout(() => { cleanup(); resolve(null); }, 10000);
  });
  const [dom, ui] = await Promise.all([domPromise, api.pttCapture()]);
  btn.textContent = 'Назначить'; btn.disabled = false;
  if (!dom && !ui) { toast('Клавиша не назначена: ничего не нажали за 10 секунд'); return; }
  const binding = { label: dom ? dom.label : `Код ${ui.code}`, dom: dom ? { type: dom.type, code: dom.code } : null, ui };
  set({ pttBinding: binding });
  log.info('ptt', `Клавиша рации: ${binding.label}${ui ? ' (работает и в свёрнутом окне)' : ' (только когда окно активно)'}`);
};

let micRestartTimer = null;
let qualityTimer = null;
onSettings((changed, s) => {
  syncSettingsUi();
  if (changed.some((k) => ['inputDevice', 'noise', 'noiseStrength', 'keyboardFilter', 'highpass', 'echoCancellation'].includes(k)) && mic.running) {
    clearTimeout(micRestartTimer);
    micRestartTimer = setTimeout(async () => {
      const monitoring = !!mic.monitorEl;
      await mic.start().catch(() => {});
      if (monitoring) await mic.monitor(true, s.outputDevice);
    }, 250);
  }
  if (changed.includes('inputGain')) mic.setGain(s.inputGain);
  if (changed.some((k) => ['mode', 'pttBinding', 'pttGlobal'].includes(k))) { configurePtt(); mic.setPtt(false); }
  if (changed.includes('outputDevice')) output.setDevice(s.outputDevice);
  if (changed.includes('noise')) renderCallbar();
  // демки через сервер или напрямую (значок на панели или галочка в настройках) — сразу, посреди показа (1.16.3)
  if (changed.includes('screenViaServer')) { renderSfuToggle(); if (S.voice) S.voice.setViaServer(s.screenViaServer !== false).catch((e) => log.warn('screen', `Переключение «через сервер / напрямую»: ${e.message}`)); }
  if (changed.includes('outputVolume')) output.setVolume(s.outputVolume);
  if (changed.includes('verboseLog')) setVerbose(s.verboseLog);
  if (changed.includes('closeToTray') && api.trayPrefs) api.trayPrefs({ closeToTray: s.closeToTray !== false });
  if (S.voice && changed.includes('screenLatency')) { S.voice.setLatency(); renderStageLatency(); }
  if (changed.includes('screenGpu')) { renderGpuCodec(); if (qmOwner === 'screen' && !$('quick-menu').hidden) renderScreenMenu(); }
  if (S.voice && S.voice.screen && changed.some((k) => ['screenBitrate', 'screenFps', 'screenMode', 'screenRes', 'screenCodec', 'screenNet'].includes(k))) {
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(() => S.voice && S.voice.applyScreenQuality(), 300);
  }
  if (changed.includes('screenAudio') && S.voice && S.voice.screen && S.voice.screen.audio && S.voice.screen.audio.enabled !== s.screenAudio) S.voice.setScreenAudio(s.screenAudio);
  if (changed.includes('iceServers') || changed.includes('forceRelay')) toast('Применится при следующем входе в голосовую комнату');
});

$('btn-logout').onclick = async () => {
  dlg.close();
  await leaveVoice();
  // выход: сервер забывает этот компьютер (свой — только если у аккаунта есть пароль, иначе обратно не войти)
  const who = S.me; const hadPw = S.hasPassword;
  if (S.conn) {
    const r = await S.conn.request({ type: 'logout', forget: true, key: deviceKey() }, 2500).catch(() => null); // старый сервер не отвечает — не ждём
    if (r && !r.forgot && !hadPw) toast(`У аккаунта «${who}» нет пароля — на этом компьютере под ним можно снова войти без пароля`, { hint: 'Чтобы выход был настоящим (например, на общем компьютере), сначала задайте пароль: Настройки → Профиль.', timeout: 12000 });
  }
  const tokens = { ...(settings.tokens || {}) }; delete tokens[`${S.host}:${S.port}`];
  set({ tokens, nick: '' });
  showPasswordRow(false);
  S.me = null; S.view = null;
  $('auth-server-name').textContent = S.isHost ? `Ваш сервер: ${S.vpnAddr}:${S.port}` : `Сервер ${S.host}:${S.port}`;
  $('auth-name').value = '';
  formError('auth-error', null);
  show('screen-auth');
  $('auth-name').focus();
};

let micRetryTimer = null;
navigator.mediaDevices.addEventListener('devicechange', () => {
  log.info('audio', 'Список аудиоустройств изменился');
  if (dlg.open) fillDevices();
  clearTimeout(micRetryTimer);
  micRetryTimer = setTimeout(() => { micDevicesChanged(); outputDevicesChanged(); }, 1000); // Windows присылает несколько событий подряд
});
// 1.20.3: выбранных наушников не было при запуске — звук шёл в устройство по умолчанию до перезапуска. Теперь:
// они появились — возвращаем звук на них (выбор в настройках при этом не менялся)
async function outputDevicesChanged() {
  const id = output.missingId;
  if (!id || settings.outputDevice !== id) return;
  let outs = [];
  try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch (_) { return; }
  if (!outs.some((d) => d.deviceId === id)) return;
  log.info('audio', 'Выбранное устройство вывода снова подключено — возвращаю звук на него');
  await output.setDevice(id);
}
// 1.17.3: микрофон выдернули посреди звонка, а другого не было — программа сдавалась, и пока не откроешь настройки
// или не перезайдёшь, тебя не слышно. Теперь: вставили выбранный микрофон — возвращаем его; появился любой — включаем.
async function micDevicesChanged() {
  if (!S.inVoice && !dlg.open) return; // микрофон нужен только в голосе и в настройках
  let ins = [];
  try { ins = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch (_) { return; }
  if (micLost && ins.some((d) => d.deviceId === micLost)) {
    const id = micLost; micLost = '';
    log.info('mic', 'Выбранный микрофон снова подключён — возвращаю его');
    set({ inputDevice: id }); // работающий микрофон перезапустит onSettings
    if (!mic.running) await mic.start().catch(() => {});
    return;
  }
  if (!mic.running && ins.length) {
    log.info('mic', 'Появился микрофон — включаю');
    await mic.start().catch(() => {});
  }
}

// ===================== приглашение =====================
function inviteAddr() { return S.isHost ? `${S.vpnAddr || '127.0.0.1'}${S.port !== 41234 ? ':' + S.port : ''}` : (S.addrLabel || S.host); }
function openInvite() {
  const addr = inviteAddr();
  $('invite-addr').textContent = addr;
  const lan = isLanIp(S.isHost ? (S.vpnAddr || '') : S.host);
  $('invite-hint').textContent = lan ? 'Друзьям нужно быть в той же сети Radmin VPN, скачать «Сходку» и ввести этот адрес:' : `Друзьям нужно скачать «Сходку» и ввести этот адрес${S.serverPassword ? ' и пароль' : ''}:`;
  $('invite-text').value = `Заходи в «Сходку»! Адрес: ${addr}${S.serverPassword ? `, пароль: ${S.serverPassword}` : ''}.${lan ? ' Нужно быть в той же сети Radmin VPN.' : ''}`;
  $('invite').showModal();
}
$('btn-invite').onclick = openInvite;
$('invite-close').onclick = () => $('invite').close();
$('invite-copy').onclick = () => copyText(inviteAddr(), 'Адрес');
$('invite-copy-text').onclick = () => copyText($('invite-text').value, 'Приглашение');
// 1.20.2: шпаргалка демки — кнопка «?» в шапке комнаты; Esc и щелчок мимо закрывают, как у остальных окон
$('btn-demo-help').onclick = () => { $('demo-help').showModal(); $('demo-help').querySelector('.help-body').scrollTop = 0; };
$('demo-help-close').onclick = () => $('demo-help').close();
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

// ===================== подсказки при наведении =====================
const tip = $('tip');
let tipTimer = null;
let tipTarget = null;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t === tipTarget) return;
  tipTarget = t;
  clearTimeout(tipTimer);
  tip.hidden = true;
  if (!t) return;
  tipTimer = setTimeout(() => {
    if (!t.isConnected || !t.dataset.tip) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    const w = tip.offsetWidth; const h = tip.offsetHeight;
    let top = r.top - h - 8;
    if (top < 6) top = r.bottom + 8;
    tip.style.top = top + 'px';
    tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
  }, 350);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tip.hidden = true; });

// ===================== змейка: двойной щелчок по значку «С» в рамке окна =====================
function snakePoints(n) {
  const d = n % 10, dd = n % 100;
  return d === 1 && dd !== 11 ? 'очко' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'очка' : 'очков';
}
document.querySelector('#titlebar .tb-logo').addEventListener('dblclick', () => openSnake({
  soundsOn: () => settings.sounds !== false && !S.deafened,
  audio: () => output.ctx, // звук идёт туда же, куда и остальные звуки программы
  canShare: () => !!(S.conn && S.me && !$('screen-main').hidden),
  onShare: async (score, record, best) => {
    const how = 'Кто больше? Змейка открывается двойным щелчком по значку «С» вверху слева';
    const text = record ? `🐍 Новый рекорд в змейке — ${score} ${snakePoints(score)}! ${how}`
      : `🐍 Змейка: ${score} ${snakePoints(score)}, мой рекорд — ${best}. ${how}`;
    try { await S.conn.request({ type: 'chat_send', channel: 'general', text }); return true; } catch (e) { log.warn('ui', `Счёт змейки не отправился: ${e.message}`); return false; }
  },
}));

// ===================== дизайны (1.20): плашка над карточкой, стрелки и меню с кружками =====================
// Дизайн меняется сразу, запоминается на этом компьютере; у каждого друга свой — друзья его не видят.
function useTheme(id, { animate = true } = {}) {
  const t = themeById(id);
  if (settings.theme !== t.id) set({ theme: t.id });
  const go = () => { applyTheme(t); renderThemeBar(); if (!$('theme-menu').hidden) renderThemeMenu(); };
  if (animate && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(go); else go();
  if (animate) log.info('ui', `Дизайн: ${themeTip(t)}`);
  if (api.setTitleBar) api.setTitleBar({ color: t.bar, symbol: t.sym }).catch(() => {}); // кнопки окна справа сверху — в тон фону
}
const themeTip = (t) => (t.n ? `${t.n} · ${t.title}` : t.title);
function renderThemeBar() {
  const t = themeById(settings.theme);
  $('theme-sw').style.cssText = swatchCss(t);
  $('theme-name').textContent = t.n ? `${t.n} · ${t.short}` : t.short;
  $('theme-cur').dataset.tip = `${themeTip(t)} — нажмите, чтобы выбрать из всех`;
}
function stepTheme(d) {
  const i = Math.max(0, THEMES.findIndex((x) => x.id === themeById(settings.theme).id));
  useTheme(THEMES[(i + d + THEMES.length) % THEMES.length].id);
}
function renderThemeMenu() {
  const cur = themeById(settings.theme).id;
  const sw = (t) => el('button', { class: 'tm-sw' + (t.id === cur ? ' on' : ''), type: 'button', style: swatchCss(t), 'data-tip': themeTip(t), 'aria-label': themeTip(t), onclick: () => useTheme(t.id) });
  const [main, ...rest] = THEMES;
  const groups = [];
  for (const t of rest) { const g = groups[groups.length - 1]; if (g && g.name === t.group) g.items.push(t); else groups.push({ name: t.group, items: [t] }); }
  const range = (g) => `${g.items[0].n}–${g.items[g.items.length - 1].n}`;
  $('theme-menu').replaceChildren(
    el('div', { class: 'tm-head' }, el('b', { text: 'Дизайны' }), el('small', { text: `${THEMES.length - 1} + основной` })),
    el('button', { class: 'tm-main', type: 'button', onclick: () => useTheme(main.id) }, sw(main), el('span', {}, 'Основной «Шёлк»', el('small', { text: 'как было до 1.20' }))),
    ...groups.flatMap((g) => [el('div', { class: 'tm-group', text: `${g.name} · ${range(g)}` }), el('div', { class: 'tm-grid' }, ...g.items.map(sw))]));
}
function placeThemeMenu() {
  const r = $('theme-bar').getBoundingClientRect(), m = $('theme-menu');
  m.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))) + 'px';
  m.style.bottom = Math.round(innerHeight - r.top + 8) + 'px';
}
function toggleThemeMenu(open = $('theme-menu').hidden) {
  const m = $('theme-menu');
  m.hidden = !open;
  $('theme-cur').classList.toggle('open', open);
  if (open) { renderThemeMenu(); placeThemeMenu(); const on = m.querySelector('.tm-grid .tm-sw.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
}
$('theme-prev').onclick = () => stepTheme(-1);
$('theme-next').onclick = () => stepTheme(1);
$('theme-cur').onclick = () => toggleThemeMenu();
document.addEventListener('mousedown', (e) => { if (!$('theme-menu').hidden && !e.target.closest('#theme-menu, #theme-cur')) toggleThemeMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('theme-menu').hidden) { e.stopPropagation(); toggleThemeMenu(false); } }, true);
addEventListener('resize', () => { if (!$('theme-menu').hidden) placeThemeMenu(); });
useTheme(settings.theme, { animate: false });

// ===================== горячие клавиши =====================
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || $('screen-main').hidden) return;
  if (e.code === 'KeyM') { e.preventDefault(); $('btn-mute').click(); }
  if (e.code === 'KeyD') { e.preventDefault(); $('btn-deafen').click(); }
});

// для автотестов: доступ к состоянию из тестового скрипта (только при запуске с тестовым флагом)
if (api.testFlags && (api.testFlags.fakeScreenAudio || api.testFlags.expose)) window.__skh = { S, output, mic, music, p2p, settings, set };

// ===================== старт =====================
output.setVolume(settings.outputVolume);
if (settings.outputDevice !== 'default') output.setDevice(settings.outputDevice);
api.hostStatus().then((st) => { if (st.running) log.info('host', 'Сервер уже запущен в этом окне'); });
log.info('ui', 'Интерфейс загружен. Лог открывается кнопкой «Лог» справа внизу или Ctrl+L.');
