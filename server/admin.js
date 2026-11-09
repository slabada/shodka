#!/usr/bin/env node
'use strict';
// Обслуживание базы сервера (запускать при ОСТАНОВЛЕННОМ сервере):
//   node admin.js users  --data /var/lib/skhodka
//   node admin.js free-nick <ник> --data /var/lib/skhodka   — освободить ник (человек сменил компьютер)
//   node admin.js delete-user <ник> --data /var/lib/skhodka — удалить ник с сервера (старые, ненужные)
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const i = argv.indexOf('--data');
const dataDir = i >= 0 ? argv[i + 1] : '/var/lib/skhodka';
const file = path.join(dataDir, 'server-data.json');
const [cmd, nick] = argv.filter((a, k) => a !== '--data' && argv[k - 1] !== '--data');

if (!fs.existsSync(file)) { console.error(`База не найдена: ${file}`); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const key = (s) => String(s || '').trim().toLowerCase();

if (cmd === 'users') {
  const list = Object.values(data.users || {});
  console.log(`Пользователей: ${list.length}`);
  for (const u of list) console.log(`  ${u.name}  (с ${new Date(u.created).toLocaleDateString('ru-RU')}${u.pw ? ', есть пароль' : ''}${u.kids && u.kids.length ? `, компьютеров: ${1 + u.kids.length}` : ''})`);
} else if (cmd === 'free-nick') {
  const u = data.users[key(nick)];
  if (!u) { console.error(`Ника «${nick}» нет на сервере`); process.exit(1); }
  // сбрасываем привязку к компьютеру и все входы — следующий, кто введёт ник, закрепит его за собой
  u.salt = ''; u.hash = ''; delete u.kid; delete u.kids; delete u.pw;
  for (const [t, v] of Object.entries(data.tokens || {})) if (v.user === key(nick)) delete data.tokens[t];
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
  console.log(`Ник «${u.name}» освобождён. Друзья и история сохранены — войдите под ним с нового компьютера.`);
} else if (cmd === 'delete-user') {
  const k = key(nick); const u = data.users[k];
  if (!u) { console.error(`Ника «${nick}» нет на сервере`); process.exit(1); }
  delete data.users[k];
  require('./store').Store.archiveDms(data, k);
  for (const x of Object.values(data.users)) for (const f of ['friends', 'incoming', 'outgoing']) x[f] = (x[f] || []).filter((y) => y !== k);
  for (const [t, v] of Object.entries(data.tokens || {})) if (v.user === k) delete data.tokens[t];
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
  console.log(`Ник «${u.name}» удалён с сервера. Его сообщения в истории остались.`);
} else {
  console.log('Команды: users | free-nick <ник> | delete-user <ник>   (опция --data <папка базы>)');
}
