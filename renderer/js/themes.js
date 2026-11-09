// Дизайны «Сходки» (1.20): основной «Шёлк» и 46 вариантов, которые показывались скринами 24–25.10.2026
// (каталог vse-dizainy) — номера и имена те же. Цвета взяты из таблиц макетов (materialy\dizain-maket\sborka-maketov).
// 1.20.4: ещё 40 — серия «Бархат» 57–96 (показана скринами программы 30.10.2026, materialy\dizain-maket\barhat-57-96).
// Дизайн = CSS-переменные на <html> (цвета, стекло, сияние фона) + классы серии на <body> (отделка: блики, рамки,
// объёмные аватарки, пузыри чата в «Люксе»). Основной «Шёлк» — значения по умолчанию из styles.css: для него ничего не ставится.

const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const cm = (c, p) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const f1 = (x) => String(Math.round(x * 10) / 10);

// Пятно сияния из макета (эллипс w×h в окне 1440×900, размытый на blur) — мягкий радиальный перелив в долях окна:
// так сияние ложится одинаково при любом размере окна.
function blob(w, h, left, top, color, blur = 90) {
  const r = Math.min(w, h) / 2, R = r + 2 * blur;
  const inner = Math.max(0, Math.round(100 * (r - blur) / R));
  return `radial-gradient(${f1((w / 2 + 2 * blur) / 14.4)}% ${f1((h / 2 + 2 * blur) / 9)}% at ${f1((left + w / 2) / 14.4)}% ${f1((top + h / 2) / 9)}%, ${color}, ${color} ${inner}%, transparent)`;
}

// меню, всплывашки, окна — тот же фон, чуть светлее и с оттенком акцента (у основного «Шёлка» ровно так и выходит)
function surfaces(bg, a1, text) {
  const tone = mix(a1, text, 0.4);
  const m = (k) => mix(bg, tone, k);
  return { '--surf': m(0.11), '--surf2': m(0.125), '--surf-dlg': m(0.057), '--surf-tip': m(0.087), '--surf-log': m(0.025),
    '--ring': m(0.09), '--ring-tile': m(0.06), '--ink1': m(0.049), '--ink2': m(0.08) };
}
function base({ bg, bg2, text, t2, t3, a1, a2, a3, ink, ok, live, soft = 13, msg }) {
  return {
    '--bg': bg, '--bg2': bg2, '--text': text, '--text2': t2, '--text3': t3, '--msg-text': msg || mix(text, t2, 0.38),
    '--acc1': a1, '--acc2': a2, '--acc3': a3 || a2, '--lamp': a1, '--lamp-soft': cm(a1, soft), '--on-lamp': ink,
    '--acc-grad': `linear-gradient(140deg, ${a1}, ${a2})`,
    '--mint': ok, '--mint-soft': cm(ok, 13), '--rose': live, '--rose-soft': cm(live, 13),
    ...surfaces(bg, a1, text),
  };
}

// ---------- 1–4: первые направления (макет template.html) ----------
function first(p) {
  const line = p.line;
  const v = {
    ...base({ ...p, soft: 13 }),
    '--lamp-soft': p.soft,
    '--glass': p.tile || 'rgba(255, 255, 255, .03)', '--glass-hi': p.hover, '--ink3': p.hover, '--line': line,
    '--r-xl': p.r + 'px',
    '--glow': p.blobs ? p.blobs.join(', ') : 'none',
    '--panel-bg': p.panel, '--panel-shadow': `inset 0 0 0 1px ${p.border}, ${p.shadow}`, '--panel-sheen': p.sheen || 'none',
    '--mid-bg': p.panel, '--mid-shadow': `inset 0 0 0 1px ${p.border}, ${p.shadow}`, '--mid-pad': '12px 16px 0',
    '--acc-shadow': `0 8px 24px -10px ${p.a1}`, '--cb-on-shadow': `0 8px 24px -10px ${p.a1}`, '--send-shadow': `0 6px 18px -8px ${p.a1}`,
    '--room-bg': p.room || p.soft, '--room-shadow': 'none', '--ico-bg': p.soft,
    '--tab-bg': p.hover, '--tab-shadow': `inset 0 0 0 1px ${line}`,
    '--me-bg': p.me || 'rgba(0, 0, 0, .22)', '--me-shadow': `inset 0 0 0 1px ${line}`,
    '--composer-bg': p.me || 'rgba(0, 0, 0, .25)', '--composer-shadow': `inset 0 0 0 1px ${line}`, '--composer-focus': p.me || 'rgba(0, 0, 0, .3)',
    '--callbar-bg': p.callbar || 'rgba(0, 0, 0, .28)', '--callbar-shadow': `inset 0 0 0 1px ${line}, inset 0 1px 0 rgba(255, 255, 255, .05)`,
    '--cb-bg': 'rgba(255, 255, 255, .055)',
    '--tile-bg': p.tile || 'rgba(255, 255, 255, .03)', '--tile-edge': `inset 0 0 0 1px ${line}`,
    '--spk': p.ok, '--spk-tile-bg': p.tile || 'rgba(255, 255, 255, .03)',
    '--spk-tile-shadow': `0 0 0 1px ${cm(p.ok, 35)}, 0 0 28px -8px ${p.ok}`, '--spk-frame': `linear-gradient(${cm(p.ok, 55)}, ${cm(p.ok, 55)})`,
    '--stage-shadow': p.stage,
    '--leave-grad': p.leave || 'linear-gradient(140deg, #FF8E8E, #F06A86)',
    '--live-bg': p.live, '--live-ink': '#fff',
    '--ss-bg': p.hover, '--ss-edge': `inset 0 0 0 1px ${line}`, '--ss-on': p.soft,
  };
  if (p.label) Object.assign(v, { '--group-case': 'uppercase', '--group-track': p.label[0], '--group-size': p.label[1] });
  return v;
}
const FIRST = [
  ['grafit', 1, 'Графит', {
    bg: '#0B0B0D', bg2: '#0B0B0D', panel: '#141416', border: 'rgba(255, 255, 255, .075)', hover: 'rgba(255, 255, 255, .055)', line: 'rgba(255, 255, 255, .07)',
    text: '#F2F2F4', t2: '#A1A1A8', t3: '#6B6B73', a1: '#F4F5F7', a2: '#C9CCD3', ink: '#0B0B0D', soft: 'rgba(255, 255, 255, .08)', live: '#FF6B6B', ok: '#7AD9A8',
    r: 14, shadow: 'inset 0 1px 0 rgba(255, 255, 255, .04)', label: ['.08em', '11px'], room: 'rgba(255, 255, 255, .07)',
    tile: '#18181B', me: '#1B1B1E', callbar: '#18181B', leave: 'linear-gradient(#E5484D, #E5484D)',
    stage: '0 0 0 1px rgba(255, 255, 255, .075), 0 24px 60px -28px rgba(0, 0, 0, .8)' }],
  ['polnoch', 2, 'Полночь', {
    bg: '#050813', bg2: '#070B18', panel: 'rgba(255, 255, 255, .045)', border: 'rgba(255, 255, 255, .09)', hover: 'rgba(255, 255, 255, .06)', line: 'rgba(255, 255, 255, .07)',
    text: '#EEF3FF', t2: '#9AA7C4', t3: '#5F6B88', a1: '#7CC8FF', a2: '#9DA9FF', ink: '#06142A', soft: 'rgba(124, 200, 255, .14)', live: '#FF8A9B', ok: '#7EE0C3',
    r: 26, shadow: 'inset 0 1px 0 rgba(255, 255, 255, .10), 0 30px 60px -30px rgba(0, 0, 0, .6)', callbar: 'rgba(255, 255, 255, .06)',
    blobs: [blob(720, 520, -160, -200, 'rgba(64, 120, 255, .38)'), blob(640, 520, 920, 640, 'rgba(40, 190, 220, .26)'), blob(520, 420, 520, 220, 'rgba(120, 90, 255, .18)')],
    stage: '0 0 0 1px rgba(255, 255, 255, .1), 0 30px 80px -30px rgba(40, 120, 255, .45)' }],
  ['hvoya', 3, 'Хвоя', {
    bg: '#060C0A', bg2: '#08110E', panel: 'rgba(140, 255, 210, .028)', border: 'rgba(170, 255, 220, .07)', hover: 'rgba(160, 255, 215, .05)', line: 'rgba(170, 255, 220, .065)',
    text: '#E9F3EE', t2: '#93A89F', t3: '#5E7369', a1: '#7FE0BE', a2: '#4FC79D', ink: '#05160F', soft: 'rgba(127, 224, 190, .12)', live: '#FF8C8C', ok: '#7FE0BE',
    r: 20, shadow: 'inset 0 1px 0 rgba(200, 255, 230, .05)', label: ['.14em', '10.5px'],
    sheen: 'radial-gradient(120% 60% at 50% -10%, rgba(255, 255, 255, .035), transparent 60%)',
    blobs: [blob(700, 500, -220, -240, 'rgba(40, 160, 110, .22)'), blob(600, 460, 1040, 700, 'rgba(30, 120, 100, .20)')],
    stage: '0 0 0 1px rgba(170, 255, 220, .09), 0 30px 80px -34px rgba(40, 200, 140, .30)' }],
  ['bordo', 4, 'Бордо', {
    bg: '#0C0809', bg2: '#120A0E', panel: 'rgba(255, 220, 230, .03)', border: 'rgba(255, 210, 222, .07)', hover: 'rgba(255, 210, 222, .05)', line: 'rgba(255, 210, 222, .065)',
    text: '#F5ECEF', t2: '#B09AA2', t3: '#77626A', a1: '#F2A7B8', a2: '#C9799A', ink: '#2A0D17', soft: 'rgba(242, 167, 184, .13)', live: '#FF7F8F', ok: '#9EDDB9',
    r: 22, shadow: 'inset 0 1px 0 rgba(255, 225, 233, .06)', leave: 'linear-gradient(140deg, #FF6A5F, #D93A4E)',
    sheen: 'radial-gradient(120% 60% at 50% -10%, rgba(255, 255, 255, .035), transparent 60%)',
    blobs: [blob(720, 520, -220, -260, 'rgba(150, 40, 80, .30)'), blob(640, 480, 1020, 700, 'rgba(120, 30, 60, .26)'), blob(380, 300, 700, -160, 'rgba(220, 120, 150, .10)')],
    stage: '0 0 0 1px rgba(255, 210, 222, .1), 0 30px 80px -30px rgba(200, 60, 110, .35)' }],
];

// ---------- 5–16: «Полночь+», «Полночь Люкс» и оттенки синего (lux.css, make4.py) ----------
function lux(p) {
  const { a1, a2, a3, ok } = p;
  const panel = p.p3 ? 'linear-gradient(180deg, rgba(255, 255, 255, .06), rgba(255, 255, 255, .018) 40%, rgba(255, 255, 255, .012))'
    : 'linear-gradient(180deg, rgba(255, 255, 255, .075), rgba(255, 255, 255, .026) 38%, rgba(255, 255, 255, .018))';
  const shadow = 'inset 0 1px 0 rgba(255, 255, 255, .13), 0 50px 90px -40px rgba(0, 0, 14, .95)';
  const frame = `linear-gradient(165deg, rgba(255, 255, 255, .26), rgba(255, 255, 255, .05) 26%, rgba(255, 255, 255, .02) 68%, ${cm(a1, 16)})`;
  const gloss = `inset 0 1px 0 rgba(255, 255, 255, .65), inset 0 -1px 0 rgba(0, 20, 60, .25), 0 12px 32px -12px ${cm(a1, 85)}`;
  const tile = 'linear-gradient(180deg, rgba(255, 255, 255, .06), rgba(255, 255, 255, .018))';
  return {
    ...base({ ...p, text: '#F1F5FF' }),
    '--glass': 'rgba(255, 255, 255, .04)', '--glass-hi': 'rgba(255, 255, 255, .07)', '--line': 'rgba(255, 255, 255, .06)',
    '--r-xl': (p.p3 ? 32 : 28) + 'px',
    '--glow': ['radial-gradient(120% 95% at 50% 38%, transparent 52%, rgba(0, 0, 6, .6))',
      blob(980, 680, -300, -330, p.b1), blob(820, 640, 880, 620, p.b2), blob(640, 480, 540, 150, p.b3)].join(', '),
    '--panel-bg': panel, '--panel-shadow': shadow, '--panel-frame': frame,
    '--mid-bg': panel, '--mid-shadow': shadow, '--mid-pad': p.p3 ? '14px 18px 0' : '12px 16px 0',
    '--acc-grad': `linear-gradient(180deg, rgba(255, 255, 255, .38), rgba(255, 255, 255, 0) 55%), linear-gradient(120deg, ${a1}, ${a2} 55%, ${a3})`,
    '--acc-shadow': gloss, '--cb-on-shadow': gloss, '--send-shadow': gloss,
    '--room-bg': `linear-gradient(90deg, ${cm(a1, 17)}, ${cm(a1, 3)})`, '--room-shadow': `inset 0 1px 0 rgba(255, 255, 255, .08), inset 0 0 0 1px ${cm(a1, 12)}`,
    '--ico-bg': `linear-gradient(180deg, ${cm(a1, 22)}, ${cm(a1, 6)})`,
    '--tab-bg': 'linear-gradient(180deg, rgba(255, 255, 255, .10), rgba(255, 255, 255, .035))', '--tab-shadow': 'inset 0 1px 0 rgba(255, 255, 255, .13), inset 0 0 0 1px rgba(255, 255, 255, .05)',
    '--me-bg': 'rgba(0, 4, 18, .32)', '--me-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, .06), inset 0 1px 0 rgba(255, 255, 255, .07)',
    '--composer-bg': 'rgba(0, 4, 18, .38)', '--composer-shadow': 'inset 0 1px 3px rgba(0, 0, 0, .45), inset 0 0 0 1px rgba(255, 255, 255, .07)', '--composer-focus': 'rgba(0, 4, 18, .45)',
    '--callbar-bg': 'linear-gradient(180deg, rgba(255, 255, 255, .10), rgba(255, 255, 255, .035))',
    '--callbar-shadow': 'inset 0 1px 0 rgba(255, 255, 255, .17), inset 0 0 0 1px rgba(255, 255, 255, .07), 0 26px 50px -20px rgba(0, 0, 12, .95)',
    '--cb-bg': 'linear-gradient(180deg, rgba(255, 255, 255, .08), rgba(255, 255, 255, .03))',
    '--tile-bg': tile, '--tile-edge': 'inset 0 1px 0 rgba(255, 255, 255, .1), inset 0 0 0 1px rgba(255, 255, 255, .045)',
    '--spk': ok, '--spk-tile-bg': tile, '--spk-frame': 'none',
    '--spk-tile-shadow': `inset 0 1px 0 rgba(255, 255, 255, .12), 0 0 0 1px ${cm(ok, 55)}, 0 0 44px -12px ${cm(ok, 60)}`,
    '--stage-shadow': `0 0 0 1px rgba(255, 255, 255, .13), 0 40px 90px -34px ${p.glow}, 0 10px 120px -50px rgba(255, 140, 120, .35)`,
    '--stage-inner': 'inset 0 1px 0 rgba(255, 255, 255, .22), inset 0 0 0 1px rgba(255, 255, 255, .06)',
    '--leave-grad': 'linear-gradient(180deg, rgba(255, 255, 255, .26), rgba(255, 255, 255, 0) 55%), linear-gradient(120deg, #FF8C8C, #EC5A7E)', '--leave-glow': 'rgba(255, 100, 130, .8)',
    '--live-bg': 'rgba(255, 138, 155, .10)', '--live-ink': '#FFB6C1',
    '--group-color': p.lab, '--group-size': '11.5px',
    '--ss-bg': 'linear-gradient(180deg, rgba(255, 255, 255, .065), rgba(255, 255, 255, .02))', '--ss-edge': 'inset 0 1px 0 rgba(255, 255, 255, .09), inset 0 0 0 1px rgba(255, 255, 255, .05)',
    '--ss-on': `linear-gradient(180deg, ${cm(a1, 26)}, ${cm(a1, 10)})`, '--ss-on-edge': 'inset 0 1px 0 rgba(255, 255, 255, .18)',
  };
}
const LUX = { bg: '#03050D', bg2: '#060A17', t2: '#94A1BF', t3: '#5A6585', a1: '#8FD3FF', a2: '#A3B6FF', a3: '#C3B6FF', ink: '#061226', ok: '#7EE6C8', live: '#FF8A9B',
  b1: 'rgba(42, 98, 255, .38)', b2: 'rgba(20, 176, 214, .30)', b3: 'rgba(104, 80, 255, .17)', glow: 'rgba(40, 110, 255, .6)', lab: '#626E92', msg: '#D8E0F4' };
// имя: фон, фон2, сияние (3 пятна), акцент (3 цвета), тёмный текст на акценте, свечение демки, текст2, текст3, подписи, сообщения
const BLUES = [
  ['Сапфир', '#03061A', '#070B22', ['rgba(36, 80, 255, .46)', 'rgba(40, 120, 255, .24)', 'rgba(96, 72, 255, .18)'], ['#8DB8FF', '#A2A9FF', '#BDB2FF'], '#0A1030', 'rgba(50, 90, 255, .6)', '#97A0C4', '#5B6488', '#636C96', '#DBE0F6'],
  ['Кобальт', '#010720', '#04102C', ['rgba(0, 72, 255, .55)', 'rgba(0, 120, 255, .30)', 'rgba(30, 60, 220, .25)'], ['#5FB0FF', '#4E8DFF', '#6F7DFF'], '#021036', 'rgba(0, 90, 255, .7)', '#8FA2C8', '#566A94', '#5A6E9C', '#D6E2F8'],
  ['Электрик', '#01030C', '#020617', ['rgba(0, 90, 255, .62)', 'rgba(0, 170, 255, .34)', 'rgba(0, 40, 170, .35)'], ['#4FC3FF', '#2F8BFF', '#4C63FF'], '#00122E', 'rgba(0, 140, 255, .75)', '#8EA6C8', '#50678E', '#557099', '#D8E8FF'],
  ['Лазурь', '#021018', '#04161F', ['rgba(0, 140, 255, .42)', 'rgba(0, 200, 225, .28)', 'rgba(40, 110, 255, .16)'], ['#7FE6FF', '#5EC2FF', '#8FB8FF'], '#032030', 'rgba(0, 170, 240, .6)', '#8FAAB8', '#557080', '#5B7889', '#D8EDF4'],
  ['Лёд', '#050B14', '#0A1220', ['rgba(80, 150, 255, .30)', 'rgba(140, 215, 255, .22)', 'rgba(170, 200, 255, .12)'], ['#D4F0FF', '#AEDBFF', '#C9D8FF'], '#0A1A2E', 'rgba(140, 200, 255, .45)', '#A3B2C6', '#66758B', '#6C7B92', '#E4ECF7'],
  ['Индиго', '#06041A', '#0B0824', ['rgba(70, 50, 255, .45)', 'rgba(100, 70, 240, .25)', 'rgba(40, 80, 255, .16)'], ['#A9AEFF', '#B59CFF', '#CBA8FF'], '#140C36', 'rgba(90, 70, 255, .6)', '#9E9AC6', '#625E8C', '#67639A', '#E0DEF8'],
  ['Глубокое море', '#02121A', '#041A22', ['rgba(10, 110, 160, .44)', 'rgba(15, 165, 165, .28)', 'rgba(28, 78, 216, .16)'], ['#7EE6DC', '#66C9EE', '#86B6FF'], '#032428', 'rgba(20, 150, 170, .55)', '#8EADB4', '#55737A', '#5A7C84', '#D8EEF0'],
  ['Полярное сияние', '#030714', '#070C1E', ['rgba(42, 107, 255, .40)', 'rgba(25, 195, 178, .26)', 'rgba(122, 75, 255, .24)'], ['#7FE8D4', '#7CB8FF', '#B49CFF'], '#08162A', 'rgba(60, 140, 255, .55)', '#93A3C0', '#5A6886', '#5F6E90', '#DCE5F5'],
  ['Сталь', '#070A10', '#0C1018', ['rgba(70, 100, 140, .42)', 'rgba(90, 120, 150, .26)', 'rgba(50, 70, 110, .22)'], ['#C3D4EA', '#A3B8D6', '#C9D2E4'], '#121A26', 'rgba(90, 120, 160, .45)', '#9AA3B2', '#636C7B', '#687284', '#E1E5EC'],
  ['Деним', '#060A13', '#0B1120', ['rgba(50, 85, 150, .48)', 'rgba(60, 105, 175, .26)', 'rgba(30, 50, 95, .32)'], ['#A2BEEE', '#8BA8DE', '#B4C2EA'], '#0E1830', 'rgba(70, 110, 190, .5)', '#95A0B8', '#5E6982', '#63708C', '#DDE3EF'],
];

// ---------- 17–26: «Шёлк» в 10 расцветках (make5.py) — сам «Шёлк» программы, меняется цвет; отблеск по стеклу ----------
const SHELK_PANEL = 'inset 0 0 0 1px rgba(255, 255, 255, .06), inset 0 1px 0 rgba(255, 255, 255, .05), 0 30px 60px -36px rgba(0, 0, 0, .7)';
const SHELK_SHEEN = 'linear-gradient(125deg, rgba(255, 255, 255, .04), transparent 32%, transparent 62%, rgba(255, 255, 255, .022) 82%, transparent)';
function shelkCommon(a1) {
  return {
    '--panel-shadow': SHELK_PANEL, '--panel-sheen': SHELK_SHEEN,
    '--mid-bg': 'rgba(255, 255, 255, .034)', '--mid-shadow': SHELK_PANEL, '--mid-pad': '12px 16px 0',
    '--callbar-bg': 'rgba(255, 255, 255, .04)',
    '--cb-on-shadow': `0 10px 28px -12px ${a1}`,
  };
}
function shelk([, bg, bg2, [g1, g2, g3], [a1, a2], ink, t2, t3]) {
  return {
    ...base({ bg, bg2, text: '#ECEDF4', t2, t3, a1, a2, ink, ok: '#82DDB8', live: '#FF8E9A', soft: 14 }),
    ...shelkCommon(a1),
    '--glow': [blob(980, 620, 230, -400, g1), blob(720, 520, -280, 700, g2), blob(640, 480, 1040, 220, g3)].join(', '),
    '--room-bg': cm(a1, 14), '--room-shadow': 'none',
    '--stage-shadow': `0 0 0 1px rgba(255, 255, 255, .08), 0 30px 80px -32px ${cm(a1, 40)}`,
    '--spk': a1, '--spk-tile-shadow': `0 0 0 1px ${cm(a1, 30)}, 0 0 32px -8px ${a1}`, '--spk-frame': `linear-gradient(${cm(a1, 55)}, ${cm(a1, 55)})`,
  };
}
// имя: фон, фон2, сияние (3 пятна), акцент (2 цвета), тёмный текст на акценте, текст2, текст3
const SHELK = [
  ['Лаванда (нынешний)', '#0A0B12', '#0D0E17', ['rgba(120, 130, 255, .24)', 'rgba(190, 150, 255, .14)', 'rgba(130, 160, 255, .08)'], ['#A3B0FF', '#C6ADFF'], '#11122A', '#9A9DB2', '#666980'],
  ['Розовый кварц', '#0F0A0E', '#140D12', ['rgba(255, 140, 185, .20)', 'rgba(205, 120, 225, .13)', 'rgba(255, 170, 190, .07)'], ['#F6B6CB', '#E2A8EC'], '#2A0F20', '#B19CAA', '#7A6573'],
  ['Сирень', '#0D0A13', '#120E1A', ['rgba(170, 120, 255, .24)', 'rgba(255, 140, 220, .11)', 'rgba(140, 110, 255, .08)'], ['#C9AAFF', '#E9AAF2'], '#1E0E34', '#A59BBA', '#6E6585'],
  ['Персик', '#100B0A', '#150F0D', ['rgba(255, 160, 120, .18)', 'rgba(255, 120, 145, .11)', 'rgba(255, 190, 150, .06)'], ['#FFC6A6', '#FFAABA'], '#2E1308', '#B3A098', '#7C6A63'],
  ['Небо', '#070C14', '#0A101A', ['rgba(100, 170, 255, .22)', 'rgba(130, 210, 255, .12)', 'rgba(120, 150, 255, .07)'], ['#A2D2FF', '#ABC2FF'], '#0B1A33', '#98A5B8', '#626F84'],
  ['Бирюза', '#061012', '#091517', ['rgba(40, 200, 210, .19)', 'rgba(60, 140, 255, .12)', 'rgba(80, 220, 200, .06)'], ['#86E8F0', '#93C6FF'], '#06242A', '#93ABAF', '#5D7579'],
  ['Мята', '#08100E', '#0B1512', ['rgba(90, 220, 170, .17)', 'rgba(80, 180, 220, .10)', 'rgba(120, 230, 190, .06)'], ['#A2EDCC', '#8ADBE6'], '#0A2A20', '#97ABA4', '#61756E'],
  ['Изумруд', '#06100C', '#091510', ['rgba(40, 180, 120, .22)', 'rgba(30, 140, 160, .13)', 'rgba(60, 200, 140, .07)'], ['#74E4B3', '#5ECAC3'], '#05261A', '#90A99E', '#5A7268'],
  ['Слива', '#100810', '#160C16', ['rgba(170, 60, 125, .24)', 'rgba(120, 50, 165, .15)', 'rgba(220, 100, 170, .07)'], ['#E59DC6', '#B99DF2'], '#2B0C22', '#AE96AA', '#776075'],
  ['Серебро', '#0A0A0D', '#0E0E12', ['rgba(200, 205, 225, .09)', 'rgba(150, 160, 190, .09)', 'rgba(220, 225, 240, .04)'], ['#E4E7EF', '#B9BFCD'], '#15171E', '#A0A2AC', '#686A75'],
];

// ---------- 27–36: «Шёлк нежный» (make6.py) — сумеречный фон с оттенком, пастельный туман, перелив 2–3 цветов ----------
const NEZH_PANEL = 'inset 0 0 0 1px rgba(255, 255, 255, .075), inset 0 1px 0 rgba(255, 255, 255, .09), 0 30px 60px -36px rgba(0, 0, 0, .5)';
function nezh([, bg, bg2, [g1, g2, g3], [a1, a2, a3], ink, t2, t3]) {
  const gloss = `inset 0 1px 0 rgba(255, 255, 255, .55), 0 10px 28px -12px ${cm(a2, 75)}`;
  return {
    ...base({ bg, bg2, text: '#F4F1F8', t2, t3, a1, a2, a3, ink, ok: '#A6E8CD', live: '#FF9DAA', soft: 17 }),
    '--glass': 'rgba(255, 255, 255, .04)', '--glass-hi': 'rgba(255, 255, 255, .065)', '--line': 'rgba(255, 255, 255, .065)',
    '--r-xl': '30px',
    '--glow': [blob(1040, 720, -220, -400, g1, 120), blob(940, 680, 780, 620, g2, 120), blob(720, 520, 520, 180, g3, 120)].join(', '),
    '--panel-bg': 'rgba(255, 255, 255, .05)', '--panel-shadow': NEZH_PANEL,
    '--panel-sheen': 'linear-gradient(125deg, rgba(255, 255, 255, .055), transparent 34%, transparent 64%, rgba(255, 255, 255, .03) 84%, transparent)',
    '--mid-bg': 'rgba(255, 255, 255, .05)', '--mid-shadow': NEZH_PANEL, '--mid-pad': '12px 16px 0',
    '--acc-grad': `linear-gradient(120deg, ${a1}, ${a2} 55%, ${a3})`, '--acc-shadow': gloss, '--cb-on-shadow': gloss, '--send-shadow': gloss,
    '--leave-grad': 'linear-gradient(120deg, #FFB8B4, #F59BB4)', '--leave-ink': '#3E1222', '--leave-glow': 'rgba(245, 150, 175, .7)',
    '--cb-bg': 'rgba(255, 255, 255, .07)', '--callbar-bg': 'rgba(255, 255, 255, .06)', '--callbar-shadow': 'inset 0 1px 0 rgba(255, 255, 255, .1), 0 20px 40px -22px rgba(0, 0, 0, .55)',
    '--live-bg': 'rgba(255, 157, 170, .12)', '--live-ink': '#FFC2CA',
    '--spk': a1, '--spk-tile-shadow': `0 0 0 1px ${cm(a1, 26)}, 0 0 36px -8px ${cm(a2, 80)}`, '--spk-frame': `linear-gradient(${cm(a1, 50)}, ${cm(a1, 50)})`,
    '--tile-bg': 'rgba(255, 255, 255, .04)', '--tile-edge': 'inset 0 0 0 1px rgba(255, 255, 255, .065)',
    '--room-bg': `linear-gradient(90deg, ${cm(a1, 20)}, ${cm(a3, 6)})`, '--room-shadow': 'none',
    '--stage-shadow': `0 0 0 1px rgba(255, 255, 255, .1), 0 30px 80px -32px ${cm(a2, 45)}`,
    '--composer-bg': 'rgba(255, 255, 255, .04)', '--composer-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, .07)', '--composer-focus': 'rgba(255, 255, 255, .06)',
    '--me-bg': 'rgba(255, 255, 255, .04)', '--me-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, .07)',
    '--ss-bg': 'rgba(255, 255, 255, .05)',
  };
}
// имя: фон, фон2, туман (3), акцент (3 цвета перелива), тёмный текст на акценте, текст2, текст3
const NEZH = [
  ['Лавандовый туман', '#15131F', '#1A1826', ['rgba(170, 160, 255, .30)', 'rgba(255, 180, 220, .16)', 'rgba(150, 190, 255, .14)'], ['#CFCAFF', '#DCC8FF', '#F6CBEA'], '#221B3D', '#A8A4BE', '#716D88'],
  ['Пудра', '#1B1319', '#21181F', ['rgba(255, 170, 200, .24)', 'rgba(220, 170, 255, .16)', 'rgba(255, 205, 195, .12)'], ['#FFCBD9', '#F5C6E6', '#E7C9FF'], '#3A1A2A', '#B9A3AF', '#806B77'],
  ['Персиковый рассвет', '#1B1515', '#211A1A', ['rgba(255, 190, 160, .22)', 'rgba(255, 165, 190, .16)', 'rgba(205, 175, 255, .11)'], ['#FFD8C4', '#FFC6C9', '#FFBBD2'], '#3D1E18', '#BBA7A2', '#836F6A'],
  ['Утреннее небо', '#121722', '#171D2A', ['rgba(160, 200, 255, .26)', 'rgba(205, 185, 255, .16)', 'rgba(175, 230, 255, .12)'], ['#C4E3FF', '#CBD3FF', '#DCCBFF'], '#16243D', '#A2ACBF', '#6B7589'],
  ['Мятный крем', '#121916', '#17201C', ['rgba(165, 235, 210, .20)', 'rgba(175, 210, 255, .14)', 'rgba(225, 240, 205, .09)'], ['#C6F3DF', '#C3EBEC', '#CCE2FF'], '#173328', '#A2B4AC', '#6A7C75'],
  ['Сирень', '#18131F', '#1E1827', ['rgba(205, 165, 255, .28)', 'rgba(255, 175, 230, .14)', 'rgba(175, 175, 255, .13)'], ['#E0CAFF', '#EEC6FA', '#FFCBEB'], '#2E1A40', '#AFA3BF', '#776B88'],
  ['Голубая лагуна', '#10181A', '#152022', ['rgba(145, 225, 235, .20)', 'rgba(165, 195, 255, .16)', 'rgba(195, 240, 230, .09)'], ['#BFF1F2', '#C3E3FA', '#CBD5FF'], '#143034', '#9FB3B6', '#677B7E'],
  ['Жемчуг', '#151519', '#1B1B21', ['rgba(225, 222, 245, .12)', 'rgba(205, 195, 235, .12)', 'rgba(235, 215, 225, .08)'], ['#F0EDF7', '#E2DCF0', '#EEDCE6'], '#23212E', '#AAA8B5', '#73717E'],
  ['Ягоды с молоком', '#1B1320', '#211928', ['rgba(235, 155, 205, .22)', 'rgba(175, 145, 245, .18)', 'rgba(255, 195, 215, .09)'], ['#F6C3DF', '#E7C2F2', '#D2C4FF'], '#381A33', '#B5A1B5', '#7D6A7E'],
  ['Опал', '#13151E', '#191C27', ['rgba(165, 235, 220, .17)', 'rgba(185, 175, 255, .20)', 'rgba(255, 195, 225, .12)'], ['#C2F1E5', '#D2CCFF', '#FFD3E8'], '#1E2338', '#A7AABD', '#6F7286'],
];

// ---------- 37–46: «Шёлк» как был + перелив двух цветов (make7.py) ----------
function duo([, c1, c2, cmid]) {
  const m = cmid || `color-mix(in srgb, ${c1}, ${c2})`;
  const two = `-8px 10px 26px -12px ${cm(c1, 80)}, 8px 10px 26px -12px ${cm(c2, 80)}`;
  return {
    ...base({ bg: '#0A0B12', bg2: '#0D0E17', text: '#ECEDF4', t2: '#9A9DB2', t3: '#666980', a1: c1, a2: c2, a3: cmid || c2, ink: '#14122A', ok: '#82DDB8', live: '#FF8E9A', soft: 14 }),
    ...shelkCommon(c1),
    '--c1': c1, '--c2': c2, '--cm': m, '--acc3': m,
    '--acc-grad': `linear-gradient(120deg, ${c1}, ${m} 50%, ${c2})`, '--acc-shadow': two, '--cb-on-shadow': two, '--send-shadow': two,
    '--glow': [blob(900, 640, -240, -360, cm(c1, 30)), blob(860, 620, 820, 640, cm(c2, 26)), blob(620, 440, 560, 160, cm(m, 12))].join(', '),
    '--panel-frame': `linear-gradient(160deg, ${cm(c1, 32)}, rgba(255, 255, 255, .04) 28%, rgba(255, 255, 255, .03) 72%, ${cm(c2, 28)})`,
    '--room-bg': `linear-gradient(90deg, ${cm(c1, 22)}, ${cm(c2, 12)})`, '--room-shadow': 'none',
    '--ico-bg': `linear-gradient(140deg, ${cm(c1, 22)}, ${cm(c2, 14)})`,
    '--tab-bg': `linear-gradient(120deg, ${cm(c1, 16)}, ${cm(c2, 12)})`,
    '--stage-shadow': `-30px 34px 90px -40px ${cm(c1, 55)}, 30px 34px 90px -40px ${cm(c2, 55)}`,
    '--stage-frame': `linear-gradient(120deg, ${cm(c1, 85)}, rgba(255, 255, 255, .08) 35%, rgba(255, 255, 255, .08) 65%, ${cm(c2, 85)})`,
    '--spk': c1, '--spk-tile-shadow': `-10px 0 34px -14px ${cm(c1, 90)}, 10px 0 34px -14px ${cm(c2, 90)}`, '--spk-frame': `linear-gradient(120deg, ${c1}, ${c2})`,
    '--ss-on': `linear-gradient(120deg, ${cm(c1, 18)}, ${cm(c2, 14)})`,
  };
}
// имя, цвет 1, цвет 2, цвет между ними (null — смешать поровну)
const DUO = [
  ['Лаванда и персик', '#A3B0FF', '#FFB4A2', null],
  ['Сахарная вата', '#8EC8FF', '#F6A8D6', null],
  ['Бирюза и фиалка', '#6FE0DC', '#A98CFF', null],
  ['Мята и небо', '#8DEBC6', '#8EB8FF', null],
  ['Роза и сирень', '#FF9DC2', '#B59DFF', null],
  ['Закат', '#FF9C8A', '#A98BFF', '#FF8FB8'],
  ['Океан', '#5E8BFF', '#52DDD0', null],
  ['Лёд и сирень', '#9FE3FF', '#C9A8FF', null],
  ['Ягода и абрикос', '#FF82AC', '#FFB98E', null],
  ['Опал — три цвета', '#8FE6D4', '#F7B3D9', '#A9B4FF'],
];

// ---------- 57–96: «Бархат» (30.10.2026) — глубокий насыщенный цвет на всё окно, как в «Полночи», и пастельный перелив
// двух цветов, как в «Шёлк перелив»; стекло и блеск — от «Полночь+». Цвета подобраны так, чтобы фон и перелив вместе
// заметно отличались от 1–46 и друг от друга (ΔE2000 не меньше 12)
function barhat([, , bg, [r, g, b, al], c1, c2]) {
  const tint = `rgba(${r}, ${g}, ${b}, ${al})`;
  const seen = mix(bg, hex([r, g, b]), al * 0.5); // фон, каким его видно
  const m = mix(c1, c2, 0.5);
  const two = `-8px 10px 26px -12px ${cm(c1, 80)}, 8px 10px 26px -12px ${cm(c2, 80)}`;
  return {
    ...lux({ ...LUX, bg, bg2: mix(bg, seen, 0.5), a1: c1, a2: m, a3: c2, ink: mix(bg, '#000000', 0.25),
      b1: tint, b2: cm(c2, 15), b3: cm(c1, 11), glow: tint,
      t2: mix(seen, '#FFFFFF', 0.6), t3: mix(seen, '#FFFFFF', 0.38), lab: mix(seen, '#FFFFFF', 0.42), msg: mix(seen, '#FFFFFF', 0.86) }),
    '--c1': c1, '--c2': c2, '--cm': m,
    '--panel-frame': `linear-gradient(160deg, ${cm(c1, 34)}, rgba(255, 255, 255, .05) 28%, rgba(255, 255, 255, .03) 72%, ${cm(c2, 30)})`,
    '--room-bg': `linear-gradient(90deg, ${cm(c1, 22)}, ${cm(c2, 12)})`,
    '--ico-bg': `linear-gradient(140deg, ${cm(c1, 22)}, ${cm(c2, 14)})`,
    '--cb-on-shadow': two, '--send-shadow': two,
    '--stage-frame': `linear-gradient(120deg, ${cm(c1, 85)}, rgba(255, 255, 255, .08) 35%, rgba(255, 255, 255, .08) 65%, ${cm(c2, 85)})`,
    '--spk': c1, '--spk-tile-shadow': `-10px 0 34px -14px ${cm(c1, 90)}, 10px 0 34px -14px ${cm(c2, 90)}`, '--spk-frame': `linear-gradient(120deg, ${c1}, ${c2})`,
    '--ss-on': `linear-gradient(120deg, ${cm(c1, 18)}, ${cm(c2, 14)})`,
  };
}
// короткое имя (на плашке), полное (фон · перелив), фон, сияние фона (цвет и прозрачность), цвет 1, цвет 2
const BARHAT = [
  ['Ежевика и мята', 'Ежевика · сирень и мята', '#1E0A24', [150, 50, 160, .4], '#E6C2F5', '#B3ECD2'],
  ['Ежевика и мёд', 'Ежевика · мёд и коралл', '#1E0A24', [150, 50, 160, .4], '#F3DD9A', '#F7B6A6'],
  ['Лиловый сон', 'Ежевика · лаванда и персик', '#1E0A24', [150, 50, 160, .4], '#CDBFF7', '#F9CCB0'],
  ['Лиловое небо', 'Ежевика · лаванда и небо', '#1E0A24', [150, 50, 160, .4], '#CDBFF7', '#B7D6F8'],
  ['Черничный мёд', 'Черника · мёд и фисташка', '#120A30', [100, 70, 230, .42], '#F3DD9A', '#CFE9B0'],
  ['Черника и роза', 'Черника · роза и абрикос', '#120A30', [100, 70, 230, .42], '#F6BFD3', '#F8D3A0'],
  ['Голубой коралл', 'Черника · голубика и коралл', '#120A30', [100, 70, 230, .42], '#B9C2F6', '#F7B6A6'],
  ['Ночная бирюза', 'Черника · бирюза и небо', '#120A30', [100, 70, 230, .42], '#A9E8E6', '#B7D6F8'],
  ['Тёплый малахит', 'Малахит · абрикос и голубика', '#04201F', [20, 150, 140, .4], '#F8D3A0', '#B9C2F6'],
  ['Роза и малахит', 'Малахит · роза и бирюза', '#04201F', [20, 150, 140, .4], '#F6BFD3', '#A9E8E6'],
  ['Тропики', 'Малахит · абрикос и мята', '#04201F', [20, 150, 140, .4], '#F8D3A0', '#B3ECD2'],
  ['Малахит и небо', 'Малахит · фисташка и небо', '#04201F', [20, 150, 140, .4], '#CFE9B0', '#B7D6F8'],
  ['Розовое вино', 'Вино · роза и персик', '#24081A', [170, 40, 100, .4], '#F6BFD3', '#F9CCB0'],
  ['Вино и небо', 'Вино · роза и небо', '#24081A', [170, 40, 100, .4], '#F6BFD3', '#B7D6F8'],
  ['Мятное вино', 'Вино · мята и небо', '#24081A', [170, 40, 100, .4], '#B3ECD2', '#B7D6F8'],
  ['Вишнёвый сад', 'Вино · роза и фисташка', '#24081A', [170, 40, 100, .4], '#F6BFD3', '#CFE9B0'],
  ['Макарон', 'Шоколад · лаванда и фисташка', '#1E1008', [170, 90, 40, .34], '#CDBFF7', '#CFE9B0'],
  ['Мята и какао', 'Шоколад · мята и коралл', '#1E1008', [170, 90, 40, .34], '#B3ECD2', '#F7B6A6'],
  ['Шоколад и небо', 'Шоколад · сирень и небо', '#1E1008', [170, 90, 40, .34], '#E6C2F5', '#B7D6F8'],
  ['Зефир в какао', 'Шоколад · лаванда и коралл', '#1E1008', [170, 90, 40, .34], '#CDBFF7', '#F7B6A6'],
  ['Осенний лес', 'Ельник · персик и мёд', '#061C10', [40, 140, 80, .36], '#F9CCB0', '#F3DD9A'],
  ['Ельник и роза', 'Ельник · лаванда и роза', '#061C10', [40, 140, 80, .36], '#CDBFF7', '#F6BFD3'],
  ['Сирень в лесу', 'Ельник · сирень и фисташка', '#061C10', [40, 140, 80, .36], '#E6C2F5', '#CFE9B0'],
  ['Лимонный лес', 'Ельник · лимон и бирюза', '#061C10', [40, 140, 80, .36], '#EEF0A8', '#A9E8E6'],
  ['Звёздная ночь', 'Синяя ночь · лимон и небо', '#081430', [40, 90, 220, .4], '#EEF0A8', '#B7D6F8'],
  ['Ночь и персик', 'Синяя ночь · персик и бирюза', '#081430', [40, 90, 220, .4], '#F9CCB0', '#A9E8E6'],
  ['Мятная ночь', 'Синяя ночь · лаванда и мята', '#081430', [40, 90, 220, .4], '#CDBFF7', '#B3ECD2'],
  ['Ночной коралл', 'Синяя ночь · фисташка и коралл', '#081430', [40, 90, 220, .4], '#CFE9B0', '#F7B6A6'],
  ['Фруктовый лёд', 'Малина · бирюза и коралл', '#26061E', [200, 40, 130, .38], '#A9E8E6', '#F7B6A6'],
  ['Малина и мёд', 'Малина · мёд и голубика', '#26061E', [200, 40, 130, .38], '#F3DD9A', '#B9C2F6'],
  ['Малина и лимон', 'Малина · абрикос и лимон', '#26061E', [200, 40, 130, .38], '#F8D3A0', '#EEF0A8'],
  ['Малина и мята', 'Малина · фисташка и бирюза', '#26061E', [200, 40, 130, .38], '#CFE9B0', '#A9E8E6'],
  ['Гранат и лимон', 'Гранат · лимон и мята', '#2A0A0A', [200, 50, 40, .34], '#EEF0A8', '#B3ECD2'],
  ['Гранат и небо', 'Гранат · персик и небо', '#2A0A0A', [200, 50, 40, .34], '#F9CCB0', '#B7D6F8'],
  ['Медовый гранат', 'Гранат · роза и мёд', '#2A0A0A', [200, 50, 40, .34], '#F6BFD3', '#F3DD9A'],
  ['Гранат и лёд', 'Гранат · бирюза и голубика', '#2A0A0A', [200, 50, 40, .34], '#A9E8E6', '#B9C2F6'],
  ['Лимонный риф', 'Морская ночь · лимон и коралл', '#032430', [0, 140, 190, .4], '#EEF0A8', '#F7B6A6'],
  ['Медовое море', 'Морская ночь · мёд и бирюза', '#032430', [0, 140, 190, .4], '#F3DD9A', '#A9E8E6'],
  ['Тёплое море', 'Морская ночь · сирень и персик', '#032430', [0, 140, 190, .4], '#E6C2F5', '#F9CCB0'],
  ['Морской бриз', 'Морская ночь · фисташка и голубика', '#032430', [0, 140, 190, .4], '#CFE9B0', '#B9C2F6'],
];

// ---------- каталог: основной + 86 по номерам (47–56 пропущены: те «ночи» не делались) ----------
const theme = (id, n, group, short, title, cls, vars, sw) => ({ id, n, group, short, title, cls, vars, sw,
  bar: vars['--bg'] || '#0A0B12', sym: vars['--text2'] || '#9A9DB2' });
export const THEMES = [
  theme('shelk', 0, 'Основной', 'Шёлк · основной', 'Основной «Шёлк» — как было', '', {}, { bg: '#0A0B12', a: ['#A3B0FF', '#C6ADFF', '#C6ADFF'] }),
  ...FIRST.map(([id, n, name, p]) => theme(id, n, 'Первые варианты', name, name, ['th-first', 'th-' + id].join(' '), first(p), { bg: p.bg, a: [p.a1, p.a2, p.a2] })),
];
THEMES.push(
  theme('polnoch-plus', 5, 'Первые варианты', 'Полночь+', 'Полночь+', 'th-lux th-softlive th-ball', lux(LUX), { bg: LUX.bg, a: [LUX.a1, LUX.a2, LUX.a3] }),
  theme('polnoch-lux', 6, 'Первые варианты', 'Полночь Люкс', 'Полночь Люкс — чат пузырями, участники без карточек', 'th-lux th-softlive th-ball th-p3',
    lux({ ...LUX, p3: true, b1: 'rgba(48, 96, 255, .44)', b2: 'rgba(16, 190, 220, .34)', b3: 'rgba(120, 84, 255, .22)' }), { bg: LUX.bg, a: [LUX.a1, LUX.a2, LUX.a3] }),
);
BLUES.forEach(([name, bg, bg2, [b1, b2, b3], [a1, a2, a3], ink, glow, t2, t3, lab, msg], i) => THEMES.push(
  theme('blue-' + (i + 1), 7 + i, '«Полночь+» — оттенки синего', name, 'Полночь+ · ' + name, 'th-lux th-softlive th-ball',
    lux({ ...LUX, bg, bg2, b1, b2, b3, a1, a2, a3, ink, glow, t2, t3, lab, msg }), { bg, a: [a1, a2, a3] })));
SHELK.forEach((p, i) => THEMES.push(
  theme('shelk-' + (i + 1), 17 + i, '«Шёлк» — расцветки', p[0], 'Шёлк · ' + p[0], 'th-shelk', shelk(p), { bg: p[1], a: [p[4][0], p[4][1], p[4][1]] })));
NEZH.forEach((p, i) => THEMES.push(
  theme('nezh-' + (i + 1), 27 + i, '«Шёлк нежный»', p[0], 'Шёлк нежный · ' + p[0], 'th-nezh th-softlive th-ball', nezh(p), { bg: p[1], a: p[4] })));
DUO.forEach((p, i) => THEMES.push(
  theme('duo-' + (i + 1), 37 + i, '«Шёлк» — перелив двух цветов', p[0], 'Шёлк перелив · ' + p[0], 'th-shelk th-duo', duo(p), { bg: '#0A0B12', a: [p[1], p[3] || p[2], p[2]] })));
BARHAT.forEach((p, i) => THEMES.push(
  theme('barhat-' + (i + 1), 57 + i, '«Бархат» — глубокий цвет и пастель', p[0], 'Бархат · ' + p[1], 'th-lux th-softlive th-ball th-duo', barhat(p), { bg: p[2], a: [p[4], mix(p[4], p[5], 0.5), p[5]] })));

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
const SERIES = ['th-first', 'th-grafit', 'th-polnoch', 'th-hvoya', 'th-bordo', 'th-lux', 'th-p3', 'th-softlive', 'th-ball', 'th-shelk', 'th-nezh', 'th-duo'];

// Поставить дизайн: переменные — на <html>, классы серии — на <body>. Прежние переменные снимаются.
let applied = [];
export function applyTheme(t) {
  const st = document.documentElement.style;
  for (const k of applied) st.removeProperty(k);
  applied = Object.keys(t.vars);
  for (const [k, v] of Object.entries(t.vars)) st.setProperty(k, v);
  document.body.classList.remove(...SERIES);
  if (t.cls) document.body.classList.add(...t.cls.split(' '));
  document.body.dataset.theme = t.id;
}

// кружок дизайна в меню: фон дизайна кольцом и его акцент переливом внутри
export function swatchCss(t) {
  const [a1, a2, a3] = t.sw.a;
  return `background: linear-gradient(140deg, ${a1}, ${a2} 55%, ${a3}); box-shadow: inset 0 0 0 3px ${t.sw.bg}, 0 0 0 1px rgba(255, 255, 255, .16);`;
}
