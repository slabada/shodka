'use strict';
// ZIP-архив без сторонних модулей (1.16.2: «Журнал» → «На рабочий стол»): сжатие — deflate из zlib, CRC-32 — своей таблицей.
// Имена — UTF-8 (флаг 0x0800), даты — DOS (местное время). Без ZIP64: до 65 535 файлов и 4 ГБ — журналам хватает с запасом.
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// files: [{ name, data (Buffer | Uint8Array | string), mtime?: Date }] → Buffer с готовым .zip
function makeZip(files) {
  const parts = []; const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.name), 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || '');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length; // не сжимается — кладём как есть
    const body = stored ? data : packed;
    const method = stored ? 0 : 8;
    const crc = crc32(data);
    const { time, date } = dosDateTime(f.mtime instanceof Date ? f.mtime : new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // нужна версия 2.0
    local.writeUInt16LE(0x0800, 6);    // имя в UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);           // сделан: версия 2.0, MS-DOS
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    // 30: доп. поле, 32: комментарий, 34: диск, 36: внутр. атрибуты, 38: внешн. атрибуты — нули
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

module.exports = { makeZip, crc32 };
