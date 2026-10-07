/*
 * PixTides 设计稿共享引擎（proto-engine.js）
 * 只服务于 design/ 下的原型页面，不是 V0 的 packages/engine。
 *
 * 模型：场景 + 参数 + 种子 + 时间 → 半格网格（2G）上的色阶编号矩阵 cells。
 * 预览、动画、PNG、SVG 都从同一个 cells 出图。
 * 动画是时间的纯函数：同一种子、同一时刻，任何设备算出的画面都一样（"全球同步的海"）。
 */
(function (global) {
  'use strict';

  // ---------- 随机数与哈希 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // 第 i 个时间片的随机数：只取决于种子和片号，与何时打开页面无关
  const tickRng = (seed, tag, i) => mulberry32((seed ^ hashStr(tag) ^ Math.imul(i | 0, 2654435761)) >>> 0);

  // SHA-256（同步实现）：文字种子用它，换任何语言都能算出同样的结果
  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(str) {
    const msg = new TextEncoder().encode(str), len = msg.length;
    const total = (((len + 9 + 63) >> 6) << 6);
    const buf = new Uint8Array(total);
    buf.set(msg); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, (len * 8) >>> 0); dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return H; // 8 个 32 位整数
  }

  // ---------- 颜色：OKLCH 插值 ----------
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function rgbToOklab(rgb) {
    const r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  function oklabToRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }
  function hexToOklch(hex) {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
  }
  // 超出 sRGB 时降低彩度，保持亮度和色相
  function oklchToHex(lch) {
    const L = Math.max(0, Math.min(1, lch[0])), h = (lch[2] * Math.PI) / 180;
    let c = lch[1];
    for (let i = 0; i < 30; i++) {
      const rgb = oklabToRgb(L, c * Math.cos(h), c * Math.sin(h));
      if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(rgb.map(toGam));
      c *= 0.88;
    }
    return rgbToHex(oklabToRgb(L, 0, 0).map(toGam));
  }
  function mixLch(A, B, t) {
    let h1 = A[2], h2 = B[2];
    if (A[1] < 0.02) h1 = h2;
    if (B[1] < 0.02) h2 = h1;
    let dh = h2 - h1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, (h1 + dh * t + 360) % 360];
  }
  // 锚点 → n 个色阶（锚点等距分布）
  function ramp(anchors, n) {
    const A = anchors.map(hexToOklch);
    if (n <= 1) return [oklchToHex(A[0])];
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * (A.length - 1);
      const k = Math.min(A.length - 2, Math.floor(t));
      out.push(oklchToHex(mixLch(A[k], A[k + 1], t - k)));
    }
    return out;
  }
  function hueRotate(hex, deg) {
    if (!deg) return hex;
    const c = hexToOklch(hex);
    c[2] = (c[2] + deg) % 360;
    return oklchToHex(c);
  }
  // 在 OKLab 里直线混合：从青色往暖色混时经过灰，不会绕到绿色
  function mixLab(A, B, t) {
    const a = [A[1] * Math.cos((A[2] * Math.PI) / 180), A[1] * Math.sin((A[2] * Math.PI) / 180)];
    const b = [B[1] * Math.cos((B[2] * Math.PI) / 180), B[1] * Math.sin((B[2] * Math.PI) / 180)];
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    return [A[0] + (B[0] - A[0]) * t, Math.hypot(x, y), ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360];
  }
  // 色相只往"增大"方向转：青 → 紫 → 粉 → 橙，像真实的晨昏天空，不经过绿色
  function mixWarm(A, B, t) {
    const h1 = A[1] < 0.02 ? B[2] : A[2];
    const dh = (((B[2] - h1) % 360) + 360) % 360;
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, (h1 + dh * t) % 360];
  }
  // 晨 / 昏 / 夜变体：亮部偏暖、暗部偏紫；夜整体压暗偏蓝
  function variantColor(hex, kind) {
    const c = hexToOklch(hex);
    const lightness = c[0];
    if (kind === 'dawn') {
      const t = lightness > 0.7 ? 0.55 : 0.25;
      const target = lightness > 0.7 ? [lightness + 0.02, Math.max(c[1], 0.09), 45] : [lightness + 0.02, c[1] * 0.85, 285];
      return oklchToHex(mixWarm(c, target, t));
    }
    if (kind === 'dusk') {
      const t = lightness > 0.7 ? 0.6 : 0.4;
      const target = lightness > 0.7 ? [lightness - 0.08, Math.max(c[1], 0.13), 25] : [lightness - 0.1, c[1], 300];
      return oklchToHex(mixWarm(c, target, t));
    }
    if (kind === 'night') {
      return oklchToHex(mixLab(c, [lightness * 0.62, c[1] * 0.8, 262], 0.55));
    }
    return hex;
  }
  // 界面配色：从当前画面推出。dark 用最深色阶做深底；light 用浅底、最深色阶做强调色
  function uiTokens(pal, mode) {
    let darkest = pal[0], lightest = pal[0];
    for (const h of pal) {
      if (hexToOklch(h)[0] < hexToOklch(darkest)[0]) darkest = h;
      if (hexToOklch(h)[0] > hexToOklch(lightest)[0]) lightest = h;
    }
    const d = hexToOklch(darkest), hue = d[2], chroma = Math.min(d[1] * 0.45, 0.045);
    const li = hexToOklch(lightest);
    if (mode === 'light') {
      return {
        bg: oklchToHex([0.975, Math.min(chroma * 0.4, 0.014), hue]),
        panel: oklchToHex([0.952, Math.min(chroma * 0.5, 0.018), hue]),
        raise: oklchToHex([0.99, Math.min(chroma * 0.3, 0.01), hue]),
        line: oklchToHex([0.84, Math.min(chroma * 0.8, 0.03), hue]),
        muted: oklchToHex([0.48, Math.min(chroma, 0.035), hue]),
        fg: oklchToHex([0.2, Math.min(chroma, 0.04), hue]),
        accent: oklchToHex([Math.min(d[0], 0.42), Math.max(d[1], 0.06), hue]),
        onAccent: oklchToHex([0.985, 0.01, hue]),
        shadow: oklchToHex([0.74, Math.min(chroma, 0.03), hue]),
        deep: darkest,
      };
    }
    return {
      bg: oklchToHex([0.14, chroma, hue]),
      panel: oklchToHex([0.18, chroma, hue]),
      raise: oklchToHex([0.235, chroma * 1.1, hue]),
      line: oklchToHex([0.34, chroma * 1.2, hue]),
      muted: oklchToHex([0.72, chroma * 0.8, hue]),
      fg: oklchToHex([0.96, Math.min(chroma, 0.02), hue]),
      accent: oklchToHex([Math.max(0.82, li[0]), Math.min(li[1], 0.14), li[2]]),
      onAccent: oklchToHex([0.14, chroma, hue]),
      shadow: oklchToHex([0.08, chroma, hue]),
      deep: darkest,
    };
  }

  // ---------- 场景 ----------
  // anchors 按渐变起点 → 终点；pal 是参考图量化出的精确色阶（默认色带数时直接使用）
  const SCENES = [
    { id: 'shoal', code: 'sh', cat: 'sea', name: { zh: '浅滩', en: 'Shoal' }, layout: 'bands', angle: 94, steps: 6,
      pal: ['#0009F1', '#064EFE', '#1696FD', '#58DAFD', '#97F8FC', '#A9FBFD'], amp: 1, run: [2, 6], patch: 1.2, dots: 1 },
    { id: 'swell', code: 'sw', cat: 'sea', name: { zh: '斜浪', en: 'Swell' }, layout: 'diagonal', angle: 124, steps: 6,
      pal: ['#000FE8', '#0559FE', '#118DFE', '#59D3FD', '#83EDFD', '#A5F9FD'], amp: 0.8, run: [1, 3], patch: 0.8, dots: 1.1 },
    { id: 'tide', code: 'td', cat: 'sea', name: { zh: '潮汐', en: 'Tide' }, layout: 'diagonal', angle: 108, steps: 6,
      pal: ['#0113EE', '#0E53FE', '#1E8CFD', '#4DC6FD', '#8BEEFD', '#A3F8FD'], amp: 1.3, run: [1, 4], patch: 1, dots: 1.2 },
    { id: 'abyss', code: 'ab', cat: 'sea', name: { zh: '深海', en: 'Abyss' }, layout: 'bands', angle: 90, steps: 7,
      anchors: ['#3EC0FD', '#000DEB', '#020338'], amp: 1, run: [2, 5], patch: 0.8, dots: 0.9,
      glow: ['#5AD6FD', '#A4F9FD', '#D8FEFF'], glowDensity: 70 },
    { id: 'reef', code: 'rf', cat: 'sea', name: { zh: '珊瑚礁', en: 'Coral Reef' }, layout: 'bands', angle: 92, steps: 7,
      anchors: ['#0FB8D8', '#38E0C8', '#FF8FA8'], amp: 1.1, run: [1, 4], patch: 1.2, dots: 1,
      glow: ['#FFF1A6', '#FFFFFF', '#FF5C8A'], glowDensity: 90 },
    { id: 'moonsea', code: 'ms', cat: 'sea', name: { zh: '月下海', en: 'Moonlit Sea' }, layout: 'bands', angle: 90, steps: 7,
      anchors: ['#020442', '#1A3A9E', '#C8D8FF'], amp: 0.8, run: [3, 7], patch: 0.7, dots: 0.8,
      silhouette: 'moon', moon: '#F4F6FF' },
    { id: 'icelake', code: 'il', cat: 'sea', name: { zh: '冰湖', en: 'Ice Lake' }, layout: 'radial', angle: 0, steps: 7,
      anchors: ['#E8FEFF', '#7FD8F0', '#2A6FB8'], amp: 1.2, run: [1, 3], patch: 1, dots: 0.8 },
    { id: 'ripple', code: 'rp', cat: 'sea', name: { zh: '涟漪', en: 'Ripple' }, layout: 'radial', angle: 0, steps: 7,
      anchors: ['#C2FCFE', '#148FFD', '#02087A'], amp: 0.8, run: [1, 3], patch: 0.8, dots: 1 },
    { id: 'waterfall', code: 'wf', cat: 'sea', name: { zh: '瀑布', en: 'Waterfall' }, layout: 'vertical', angle: 0, steps: 6,
      anchors: ['#000DEB', '#3EC0FD', '#C8FDFF'], amp: 1.4, run: [3, 9], patch: 1, dots: 1, motion: 'flow' },
    // 其余分类各一个代表画面，只用于首页缩略图
    { id: 'sunset', code: 'ss', cat: 'sky', name: { zh: '日落', en: 'Sunset' }, layout: 'bands', angle: 270, steps: 7,
      anchors: ['#FF9A3D', '#F0477A', '#5A1F8C'], amp: 0.9, run: [3, 8], patch: 1.2, dots: 0.7 },
    { id: 'dune', code: 'dn', cat: 'land', name: { zh: '沙丘', en: 'Dunes' }, layout: 'diagonal', angle: 160, steps: 6,
      anchors: ['#FFE29A', '#F2A24A', '#A6522A'], amp: 1.2, run: [2, 7], patch: 0.8, dots: 0.6 },
    { id: 'autumn', code: 'au', cat: 'plant', name: { zh: '秋林', en: 'Autumn Woods' }, layout: 'diagonal', angle: 118, steps: 7,
      anchors: ['#FFD25A', '#F07A2A', '#8C2A1E'], amp: 1, run: [1, 4], patch: 1.2, dots: 1.3 },
    { id: 'snownight', code: 'sn', cat: 'weather', name: { zh: '雪夜', en: 'Snowy Night' }, layout: 'bands', angle: 90, steps: 6,
      anchors: ['#0B1640', '#3A5DA8', '#FFFFFF'], amp: 0.7, run: [3, 8], patch: 0.6, dots: 0.6,
      glow: ['#FFFFFF', '#C9D8F5'], glowDensity: 40 },
    { id: 'neon', code: 'ne', cat: 'mood', name: { zh: '霓虹', en: 'Neon' }, layout: 'diagonal', angle: 135, steps: 7,
      anchors: ['#14002E', '#FF2BD6', '#2BF5FF'], amp: 1, run: [1, 4], patch: 1, dots: 1 },
  ];
  const CATEGORIES = [
    { id: 'sea', name: { zh: '海与水', en: 'Sea & Water' }, count: 9, cover: 'shoal' },
    { id: 'sky', name: { zh: '天空与光', en: 'Sky & Light' }, count: 8, cover: 'sunset' },
    { id: 'land', name: { zh: '大地与山', en: 'Land & Peaks' }, count: 5, cover: 'dune' },
    { id: 'plant', name: { zh: '植物与季节', en: 'Plants & Seasons' }, count: 6, cover: 'autumn' },
    { id: 'weather', name: { zh: '天气与时刻', en: 'Weather & Hours' }, count: 5, cover: 'snownight' },
    { id: 'mood', name: { zh: '心情', en: 'Moods' }, count: 3, cover: 'neon' },
  ];
  const byId = Object.fromEntries(SCENES.map((s) => [s.id, s]));

  // 首页浅滩的四个时段色板（深 → 浅，均 6 阶）；编辑器里的「晨 / 昼 / 昏 / 夜」对浅滩也用这四套
  const SHOAL_TIMES = {
    dawn: ramp(['#1A1C8C', '#4B63E6', '#9DC2F7', '#FFD6C4'], 6),
    day: byId.shoal.pal.slice(),
    dusk: ramp(['#2B0C7A', '#7A2FC4', '#F0609A', '#FFB47E'], 6),
    night: ramp(['#010226', '#061070', '#1638B8', '#4A90E2'], 6),
  };
  byId.shoal.times = SHOAL_TIMES;
  // 时段边界（本地时间）：晨 5–9 点，昼 10–16 点，昏 17–19 点，夜 20–次日 4 点
  function timeOfDay(date) {
    const h = (date || new Date()).getHours();
    if (h >= 5 && h < 10) return 'dawn';
    if (h >= 10 && h < 17) return 'day';
    if (h >= 17 && h < 20) return 'dusk';
    return 'night';
  }

  // ---------- 稀有彩蛋 ----------
  // 由场景 + 种子决定，任何人打开同一编号都会看到；约 1/512
  const RARE_ODDS = 512;
  const RARE_SCENES = ['shoal', 'swell', 'tide', 'abyss', 'reef', 'moonsea'];
  function rareOf(sceneId, seed) {
    if (!RARE_SCENES.includes(sceneId)) return null;
    return hashStr('pixtides/rare/v1/' + sceneId + '/' + (seed >>> 0)) % RARE_ODDS === 0 ? 'whale' : null;
  }
  function findRare(scene, from) {
    for (let s = from >>> 0, i = 0; i < 200000; i++, s = (s + 1) >>> 0) if (rareOf(scene.id, s)) return s;
    return null;
  }
  // 鲸尾剪影（主格单位，X = 填色）
  const WHALE = ['X.....X', 'XX...XX', '.XXXXX.', '..XXX..', '...X...', '...X...', '..XXX..'];

  // ---------- 生成 ----------
  const DEFAULTS = {
    grid: 32, ratio: [1, 1], seed: 1, angle: null, amp: null, terrace: 1, bands: null,
    dots: null, dotMax: 5, pair: 0.22, invert: false, hue: 0, variant: 'day',
    silhouette: true, silSeed: 0, palette: null, time: 0, rare: true,
  };

  function scenePalette(scene, o) {
    const n = o.bands || scene.steps;
    const v = o.variant === 'base' ? 'day' : o.variant;
    let pal;
    if (o.palette) pal = o.palette.slice();
    else if (scene.times && scene.times[v] && n === scene.steps) pal = scene.times[v].slice();
    else {
      pal = scene.pal && n === scene.pal.length ? scene.pal.slice() : ramp(scene.pal || scene.anchors, n);
      if (v !== 'day') pal = pal.map((h) => variantColor(h, v));
    }
    if (o.hue) pal = pal.map((h) => hueRotate(h, o.hue));
    if (o.invert) pal.reverse();
    return pal;
  }

  const CHUNK = 512;
  class Sim {
    constructor(scene, opts) {
      const o = (this.o = Object.assign({}, DEFAULTS, opts));
      this.scene = scene;
      const G = o.grid, ra = o.ratio[0], rb = o.ratio[1];
      let Gw, Gh;
      if (ra >= rb) { Gh = G; Gw = Math.max(1, Math.round((G * ra) / rb)); }
      else { Gw = G; Gh = Math.max(1, Math.round((G * rb) / ra)); }
      const W = Gw * 2, H = Gh * 2, S = 2 * G;
      Object.assign(this, { G, W, H, S, t: o.time || 0 });
      const seed = (this.seed = o.seed >>> 0);
      const rnd = mulberry32((seed ^ hashStr(scene.id)) >>> 0);
      const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

      // 色板：色带 + 光点 + 月亮 + 鲸尾
      const bandPal = scenePalette(scene, o);
      const L = (this.L = bandPal.length);
      const glow = (scene.glow || []).map((h) => hueRotate(h, o.hue));
      this.glowStart = L;
      this.moonIdx = L + glow.length;
      this.pal = bandPal.concat(glow, scene.moon ? [hueRotate(scene.moon, o.hue)] : []);

      // 几何
      const amp = o.amp != null ? o.amp : scene.amp != null ? scene.amp : 1;
      const tm = o.terrace || 1;
      this.run = [Math.max(1, Math.round(scene.run[0] * tm)), Math.max(1, Math.round(scene.run[1] * tm))];
      if (this.run[1] < this.run[0]) this.run[1] = this.run[0];
      const radial = (this.radial = scene.layout === 'radial');
      const angDeg = o.angle != null ? o.angle : scene.angle;
      const ang = (angDeg * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang);
      const aw = W / S, ah = H / S;
      let cx = 0, cy = 0;
      if (radial) { cx = (rnd() - 0.5) * 0.3 * Math.min(aw, ah); cy = (rnd() - 0.5) * 0.3 * Math.min(aw, ah); }
      const extV = radial ? Math.hypot(aw / 2 + Math.abs(cx), ah / 2 + Math.abs(cy)) * 0.9 : 0.5 * (Math.abs(c) * aw + Math.abs(s) * ah);
      const extU = 0.5 * (Math.abs(s) * aw + Math.abs(c) * ah);
      const gap = (this.gap = (radial ? extV : 2 * extV) / L);
      const unit = (this.unit = 1 / G);
      const ncol = (this.ncol = radial ? Math.max(24, Math.round(G * 2.4 * Math.max(aw, ah))) : Math.ceil(2 * extU * G) + 2);

      // 每个格子的 (v, u)：v 沿渐变方向，u 是边界游走数组的列号
      const n = W * H;
      this.V = new Float32Array(n);
      this.U = new Uint16Array(n);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const px = (x + 0.5) / S - aw / 2 - cx, py = (y + 0.5) / S - ah / 2 - cy, i = y * W + x;
        if (radial) {
          this.V[i] = Math.hypot(px, py);
          this.U[i] = Math.floor(((Math.atan2(py, px) + Math.PI) / (2 * Math.PI)) * ncol) % ncol;
        } else {
          this.V[i] = px * c + py * s;
          this.U[i] = Math.min(ncol - 1, Math.max(0, Math.floor((-px * s + py * c + extU) * G)));
        }
      }

      // 色带边界：随机游走阶梯。每条边界有自己的随机数流，平移次数 = floor(时间 × 速度)
      const flow = scene.motion === 'flow';
      const gdir = rnd() < 0.5 ? -1 : 1;
      this.bounds = [];
      const nb = radial ? L + 3 : L - 1;
      for (let k = 0; k < nb; k++) {
        const b = {
          base: radial ? 0 : -extV + (k + 1) * gap + (rnd() - 0.5) * gap * 0.3,
          jit: (rnd() - 0.5) * 0.3,
          maxA: gap * 0.95 * amp + 1e-6,
          dir: flow ? -1 : rnd() < 0.8 ? gdir : -gdir,
          speed: flow ? 2.4 + rnd() * 1.6 : 0.35 + rnd() * 1.25,
          k, rng: null,
          buf: new Float32Array(ncol),
          bump: new Float32Array(ncol),
          w: 0, left: 0, count: 0, g: 0,
        };
        // 快进到当前时刻：游走按 512 步一块重新播种，所以只需从所在块的开头补算
        const skip = radial ? 0 : Math.floor(this.t * b.speed);
        b.g = Math.floor(skip / CHUNK) * CHUNK;
        while (b.g < skip) this._next(b);
        b.count = skip;
        if (b.dir > 0) for (let j = 0; j < ncol; j++) b.buf[j] = this._next(b);
        else for (let j = ncol - 1; j >= 0; j--) b.buf[j] = this._next(b);
        if (radial) { // 径向闭合：首尾相接
          const d = b.buf[ncol - 1] - b.buf[0];
          for (let j = 0; j < ncol; j++) b.buf[j] = Math.round((b.buf[j] - (d * j) / ncol) / (unit / 2)) * (unit / 2);
        }
        this.bounds.push(b);
      }
      this.rspeed = 0.12 + rnd() * 0.06;
      this.p = radial ? this.rspeed * this.t : 0;

      this.layer = new Uint8Array(n);
      this.cells = new Uint8Array(n);
      // 参考分层：只按各边界的基准线分层，与时间无关。散落方块按它取色，保证任何时刻打开都一样
      this.layer0 = new Uint8Array(n);
      if (radial) { const p0 = this.p; this.p = 0; this._layers(); this.layer0.set(this.layer); this.p = p0; }
      else for (let i = 0; i < n; i++) { let l = 0; for (const b of this.bounds) if (this.V[i] > b.base) l++; this.layer0[i] = l; }
      this._layers();

      // 嵌入的色块补丁："岛"，颜色相对锚点所在色带 ±1
      this.patches = [];
      const area = (W * H) / (S * S);
      const np = Math.round(((scene.patch || 1) * G * area) / 7);
      for (let p = 0; p < np; p++) {
        const w = ri(2, 6) * 2, h = ri(1, 2) * 2, x0 = ri(0, Gw - 1) * 2, y0 = ri(0, Gh - 1) * 2;
        this.patches.push({ x0, y0, w, h, d: rnd() < 0.5 ? -1 : 1 });
      }

      // 散落方块
      this.dots = [];
      const dd = o.dots != null ? o.dots : scene.dots != null ? scene.dots : 1;
      const nd = Math.round((dd * G * G * area) / 20);
      const addDot = (x, y, w, h, col) => this.dots.push({ x0: x, y0: y, x, y, w, h, col0: col, col, off: false });
      for (let i = 0; i < nd; i++) {
        const r = rnd(), sz0 = r < 0.55 ? 2 : r < 0.82 ? 3 : r < 0.95 ? 4 : 5;
        const sz = Math.max(1, Math.min(o.dotMax, sz0));
        const w = sz + (rnd() < 0.12 ? 1 : 0), h = sz;
        const x0 = ri(-1, W - 2), y0 = ri(-1, H - 2);
        const col = this._dotColor(this._layerAt(x0, y0, this.layer0), rnd);
        addDot(x0, y0, w, h, col);
        if (rnd() < o.pair) { // 对角相连的一对
          const dx = rnd() < 0.5 ? w : -w, dy = rnd() < 0.5 ? h : -h;
          addDot(x0 + dx, y0 + dy, w, h, rnd() < 0.6 ? col : this._dotColor(this._layerAt(x0, y0, this.layer0), rnd));
        }
      }

      // 光点：按各自相位在两三个色阶间切换
      this.glows = [];
      if (glow.length) {
        const ng = Math.round((G * G * area) / (scene.glowDensity || 60));
        for (let i = 0; i < ng; i++) {
          const g0 = this.glowStart + ri(0, glow.length - 1);
          const g1 = this.glowStart + ri(0, glow.length - 1);
          this.glows.push({
            x: ri(0, W - 1), y: ri(0, H - 1), s: rnd() < 0.7 ? 1 : 2,
            ph: rnd(), per: 1.4 + rnd() * 2.6,
            seq: rnd() < 0.5 ? [g0, g1, g0, -1] : [g0, -1, g1, -1, -1],
          });
        }
      }

      // 剪影：月亮
      this.moon = null;
      if (scene.silhouette === 'moon' && o.silhouette) this._makeMoon();

      // 稀有彩蛋：鲸尾
      this.rare = o.rare ? rareOf(scene.id, seed) : null;
      this.whale = null;
      if (this.rare === 'whale') {
        const wr = mulberry32((seed ^ hashStr('whale')) >>> 0);
        const sw = WHALE[0].length * 2, sh = WHALE.length * 2;
        this.whale = {
          x: Math.floor(wr() * Math.max(1, W - sw)),
          y: Math.floor(H * 0.45 + wr() * Math.max(1, H * 0.5 - sh)),
        };
      }

      this.compute();
    }

    _ri(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
    _next(b) {
      if (b.g % CHUNK === 0) { // 每块开头重新播种，起点由种子、边界号、块号决定
        b.rng = mulberry32((this.seed ^ hashStr(this.scene.id + '/edge/' + b.k + '/' + b.g / CHUNK)) >>> 0);
        b.w = (b.rng() * 2 - 1) * b.maxA * 0.5;
        b.left = this._ri(b.rng, this.run[0], this.run[1]);
      }
      b.g++;
      const r = b.rng;
      if (b.left <= 0) {
        let jump = (r() < 0.5 ? -1 : 1) * this._ri(r, 1, 3) * this.unit * (r() < 0.2 ? 0.5 : 1);
        if (Math.abs(b.w + jump) > b.maxA) { jump = -jump; if (Math.abs(b.w + jump) > b.maxA) jump = 0; }
        b.w += jump;
        b.left = this._ri(r, this.run[0], this.run[1]);
      }
      b.left--;
      return b.w;
    }

    _layers() {
      const { V, U, layer, bounds, L } = this, n = V.length;
      if (!this.radial) {
        for (let i = 0; i < n; i++) {
          const v = V[i], u = U[i];
          let l = 0;
          for (let k = 0; k < bounds.length; k++) { const b = bounds[k]; if (v > b.base + b.buf[u] + b.bump[u]) l++; }
          layer[i] = l;
        }
        return;
      }
      // 径向：第 j 圈半径 = (j+1+p+jit)·gap + 游走；圈号无限延伸，颜色按往返序取色阶
      const gap = this.gap, p = this.p, K = bounds.length, P = 2 * (L - 1);
      for (let i = 0; i < n; i++) {
        const v = V[i], u = U[i];
        const R = (j) => { const b = bounds[((j % K) + K) % K]; return (j + 1 + p + b.jit) * gap + b.buf[u]; };
        let j = Math.floor(v / gap - p - 1) + 1;
        while (R(j) >= v) j--;
        while (R(j + 1) < v) j++;
        const m = (((j + 1) % P) + P) % P;
        layer[i] = m < L ? m : P - m;
      }
    }
    _layerAt(x, y, src) {
      x = Math.max(0, Math.min(this.W - 1, x)); y = Math.max(0, Math.min(this.H - 1, y));
      return (src || this.layer)[y * this.W + x];
    }
    _dotColor(base, rnd) {
      const L = this.L;
      const dir = base <= 1 ? 1 : base >= L - 2 ? -1 : rnd() < 0.5 ? -1 : 1; // 深区点亮色、浅区点深色
      const mag = rnd() < 0.6 ? 1 : rnd() < 0.8 ? 2 : 3;
      return Math.max(0, Math.min(L - 1, base + dir * mag));
    }
    _makeMoon() {
      const { W, H, S, o } = this;
      const r2 = mulberry32((hashStr('moon') ^ Math.imul(o.seed, 31) ^ Math.imul(o.silSeed + 1, 977)) >>> 0);
      const R = (0.09 + r2() * 0.07) * S;
      const mx = Math.round(R + 3 + r2() * Math.max(1, W - 2 * R - 6));
      const my = Math.round(R + 3 + r2() * Math.max(1, H * 0.32 - R - 3));
      const crescent = r2() < 0.45;
      const off = crescent ? { x: (r2() < 0.5 ? -1 : 1) * R * (0.45 + r2() * 0.3), y: -R * 0.25 } : null;
      const halos = 1 + (r2() < 0.5 ? 1 : 0);
      const spots = crescent ? [] : Array.from({ length: 2 + Math.floor(r2() * 3) }, () => ({
        x: Math.round(mx + (r2() - 0.5) * R), y: Math.round(my + (r2() - 0.5) * R), s: r2() < 0.6 ? 1 : 2,
      }));
      this.moon = { mx, my, R, off, halos, spots };
    }

    // 按当前时刻算出单格起伏与散落方块的状态（只看最近几秒的时间片）
    _events() {
      const T = Math.floor(this.t * 10), seed = this.seed;
      if (!this.radial) {
        for (const b of this.bounds) b.bump.fill(0);
        const rate = (0.5 + 0.3 * this.bounds.length) * (this.ncol / 40);
        for (let i = T - 16; i <= T; i++) {
          const r = tickRng(seed, 'bump', i);
          if (r() >= rate / 10) continue;
          const b = this.bounds[Math.floor(r() * this.bounds.length)];
          const c0 = Math.floor(r() * this.ncol), w = 1 + Math.floor(r() * 3), d = (r() < 0.5 ? -1 : 1) * this.unit;
          const ttl = 4 + Math.floor(r() * 12);
          if (i + ttl <= T) continue;
          for (let j = c0; j < Math.min(this.ncol, c0 + w); j++) b.bump[j] += d;
        }
      }
      const nd = this.dots.length;
      for (const d of this.dots) { d.x = d.x0; d.y = d.y0; d.col = d.col0; d.off = false; }
      if (!nd) return;
      const blink = Math.min(3, nd * 0.03);
      for (let i = T - 40; i <= T; i++) {
        const r = tickRng(seed, 'dot', i);
        if (r() >= blink / 10) continue;
        const d = this.dots[Math.floor(r() * nd)];
        const dur = 5 + Math.floor(r() * 15);
        let dx = 0, dy = 0;
        while (!dx && !dy) { dx = Math.floor(r() * 5) - 2; dy = Math.floor(r() * 5) - 2; }
        if (T < i + dur) { d.off = true; continue; }
        d.off = false;
        d.x = Math.max(-1, Math.min(this.W - 2, d.x0 + dx));
        d.y = Math.max(-1, Math.min(this.H - 2, d.y0 + dy));
        d.col = this._dotColor(this._layerAt(d.x, d.y, this.layer0), r);
      }
    }

    // 合成一帧：色带 → 补丁 → 散落方块 → 光点 → 月亮 → 鲸尾
    compute() {
      const { W, H, L, layer, cells } = this;
      this._events();
      this._layers();
      cells.set(layer);
      const pc = this.patches.map((p) => Math.max(0, Math.min(L - 1, this._layerAt(p.x0, p.y0) + p.d)));
      this.patches.forEach((p, k) => {
        for (let y = p.y0; y < Math.min(H, p.y0 + p.h); y++) for (let x = p.x0; x < Math.min(W, p.x0 + p.w); x++) cells[y * W + x] = pc[k];
      });
      for (const d of this.dots) {
        if (d.off) continue;
        for (let y = Math.max(0, d.y); y < Math.min(H, d.y + d.h); y++)
          for (let x = Math.max(0, d.x); x < Math.min(W, d.x + d.w); x++) cells[y * W + x] = d.col;
      }
      for (const g of this.glows) {
        const idx = g.seq[Math.floor((this.t / g.per + g.ph) * g.seq.length) % g.seq.length];
        if (idx < 0) continue;
        for (let y = g.y; y < Math.min(H, g.y + g.s); y++) for (let x = g.x; x < Math.min(W, g.x + g.s); x++) cells[y * W + x] = idx;
      }
      const m = this.moon;
      if (m) {
        const outer = m.R + m.halos * 1.6;
        for (let y = Math.max(0, Math.floor(m.my - outer)); y < Math.min(H, Math.ceil(m.my + outer)); y++)
          for (let x = Math.max(0, Math.floor(m.mx - outer)); x < Math.min(W, Math.ceil(m.mx + outer)); x++) {
            const d = Math.hypot(x + 0.5 - m.mx, y + 0.5 - m.my), i = y * W + x;
            const cut = m.off && Math.hypot(x + 0.5 - m.mx - m.off.x, y + 0.5 - m.my - m.off.y) < m.R;
            if (d < m.R && !cut) cells[i] = this.moonIdx;
            else if (d < m.R + 1.6 && !m.off) cells[i] = Math.min(L - 1, layer[i] + 2);
            else if (d < outer && !m.off) cells[i] = Math.min(L - 1, layer[i] + 1);
          }
        for (const sp of m.spots)
          for (let y = sp.y; y < sp.y + sp.s; y++) for (let x = sp.x; x < sp.x + sp.s; x++)
            if (x >= 0 && y >= 0 && x < W && y < H) cells[y * W + x] = L - 1;
      }
      const wh = this.whale;
      if (wh) {
        const cy = Math.min(H - 1, wh.y + WHALE.length), cx = Math.min(W - 1, wh.x + WHALE[0].length);
        const col = this.layer0[cy * W + cx] >= L / 2 ? 0 : L - 1; // 浅水里用最深色，深水里用最浅色
        WHALE.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            if (row[rx] !== 'X') continue;
            for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
              const x = wh.x + rx * 2 + xx, y = wh.y + ry * 2 + yy;
              if (x >= 0 && y >= 0 && x < W && y < H) cells[y * W + x] = col;
            }
          }
        });
      }
    }

    // 跳到绝对时刻 t（秒）。同一种子、同一 t，任何设备得到同一帧
    setTime(t) {
      this.t = t;
      if (this.radial) this.p = this.rspeed * t;
      else {
        for (const b of this.bounds) {
          const target = Math.floor(t * b.speed), n = b.buf.length;
          while (b.count < target) {
            if (b.dir > 0) { b.buf.copyWithin(0, 1); b.buf[n - 1] = this._next(b); }
            else { b.buf.copyWithin(1, 0); b.buf[0] = this._next(b); }
            b.count++;
          }
        }
      }
      this.compute();
    }
    step(dt) { this.setTime(this.t + dt); }

    setPalette(bands) { // 换色板（色阶数必须一致），保留光点与月亮色
      this.pal = bands.concat(this.pal.slice(this.L));
    }
  }

  function create(scene, opts) {
    return new Sim(typeof scene === 'string' ? byId[scene] : scene, opts);
  }

  // ---------- 绘制 ----------
  const hexInt = (h) => parseInt(h.slice(1), 16);
  const intHex = (n) => '#' + n.toString(16).padStart(6, '0');

  // 每格对齐到整数像素：第 x 列占 round(x·f) 到 round((x+1)·f)，除不尽时相邻格子差 1 px
  function edges(n, px) {
    const e = new Int32Array(n + 1);
    for (let i = 0; i <= n; i++) e[i] = Math.round((i * px) / n);
    return e;
  }

  // 把 sim 整张画到 ctx（同色横向合并）
  function paint(ctx, sim, w, h) {
    const { W, H, cells, pal } = sim, xe = edges(W, w), ye = edges(H, h);
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const c = cells[y * W + x];
        let e = x + 1;
        while (e < W && cells[y * W + e] === c) e++;
        ctx.fillStyle = pal[c];
        ctx.fillRect(xe[x], ye[y], xe[e] - xe[x], ye[y + 1] - ye[y]);
        x = e;
      }
    }
  }

  // 视图：只重画颜色变化的格子；支持逐格溶解
  class View {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.sim = null;
      this.diss = null;
    }
    attach(sim, w, h) {
      const sizeChanged = !this.sim || this.w !== w || this.h !== h || this.sim.W !== sim.W || this.sim.H !== sim.H;
      this.sim = sim;
      if (sizeChanged) {
        this.w = w; this.h = h;
        this.cv.width = w; this.cv.height = h;
        this.xe = edges(sim.W, w); this.ye = edges(sim.H, h);
        this.shown = new Int32Array(sim.W * sim.H).fill(-1);
        this.diss = null;
      }
    }
    // 记录当前画面，之后按随机顺序把格子换成新颜色
    dissolve(ms) {
      const n = this.shown.length;
      const order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      this.diss = { from: this.shown.slice(), sel: new Uint8Array(n), order, done: 0, t0: performance.now(), ms };
    }
    get busy() { return !!this.diss; }
    render() {
      const { sim, ctx, xe, ye, shown } = this, W = sim.W, H = sim.H, cells = sim.cells;
      const palInt = sim.pal.map(hexInt);
      const D = this.diss;
      if (D) {
        const target = Math.min(D.order.length, Math.floor(((performance.now() - D.t0) / D.ms) * D.order.length));
        for (; D.done < target; D.done++) D.sel[D.order[D.done]] = 1;
        if (D.done >= D.order.length) this.diss = null;
      }
      let last = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const col = D && !D.sel[i] ? D.from[i] : palInt[cells[i]];
        if (col === shown[i]) continue;
        shown[i] = col;
        if (col !== last) { ctx.fillStyle = intHex(col); last = col; }
        ctx.fillRect(xe[x], ye[y], xe[x + 1] - xe[x], ye[y + 1] - ye[y]);
      }
    }
  }

  // ---------- 导出 ----------
  // 形状的每一行可见区间（硬边，不抗锯齿）
  function rowSpan(shape, y, w, h) {
    if (shape === 'circle') {
      const r = Math.min(w, h) / 2, cy = h / 2, dy = y + 0.5 - cy;
      if (Math.abs(dy) >= r) return null;
      const hw = Math.sqrt(r * r - dy * dy);
      return [Math.round(w / 2 - hw), Math.round(w / 2 + hw)];
    }
    if (shape === 'round') {
      const R = Math.min(w, h) * 0.2, yy = y + 0.5;
      const dy = yy < R ? R - yy : yy > h - R ? yy - (h - R) : 0;
      if (!dy) return [0, w];
      const hw = R - Math.sqrt(Math.max(0, R * R - dy * dy));
      return [Math.round(hw), Math.round(w - hw)];
    }
    return [0, w];
  }
  function maskShape(ctx, w, h, shape) {
    if (!shape || shape === 'square') return;
    for (let y = 0; y < h; y++) {
      const sp = rowSpan(shape, y, w, h);
      if (!sp) { ctx.clearRect(0, y, w, 1); continue; }
      if (sp[0] > 0) ctx.clearRect(0, y, sp[0], 1);
      if (sp[1] < w) ctx.clearRect(sp[1], y, w - sp[1], 1);
    }
  }

  function toCanvas(sim, w, h, shape) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    paint(ctx, sim, w, h);
    maskShape(ctx, w, h, shape);
    return cv;
  }
  // 一对头像：画一张 2:1 的图，左右各取一半，拼起来是一片连续的海
  function pairCanvases(sim, size, shape) {
    const whole = document.createElement('canvas');
    whole.width = size * 2; whole.height = size;
    paint(whole.getContext('2d'), sim, size * 2, size);
    return [0, 1].map((k) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      ctx.drawImage(whole, k * size, 0, size, size, 0, 0, size, size);
      maskShape(ctx, size, size, shape);
      return cv;
    });
  }

  function toSVG(sim, w, h, shape) {
    const { W, H, cells, pal } = sim, out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${w}" height="${h}" shape-rendering="crispEdges">`);
    let open = '<g>';
    if (shape === 'circle') {
      out.push(`<defs><clipPath id="s"><circle cx="${W / 2}" cy="${H / 2}" r="${Math.min(W, H) / 2}"/></clipPath></defs>`);
      open = '<g clip-path="url(#s)">';
    } else if (shape === 'round') {
      const r = Math.min(W, H) * 0.2;
      out.push(`<defs><clipPath id="s"><rect width="${W}" height="${H}" rx="${r}" ry="${r}"/></clipPath></defs>`);
      open = '<g clip-path="url(#s)">';
    }
    out.push(open);
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const c = cells[y * W + x];
        let e = x + 1;
        while (e < W && cells[y * W + e] === c) e++;
        out.push(`<rect x="${x}" y="${y}" width="${e - x}" height="${y === H - 1 ? 1 : 1.02}" fill="${pal[c]}"/>`);
        x = e;
      }
    }
    out.push('</g></svg>');
    return out.join('');
  }

  // 导出分辨率
  // 横向比例按长边 1920/2560/3840/5120/7680；竖向比例按短边 1080/1440/2160/2880/4320（手机壁纸不缩水）；
  // 1:1 用 1080/2048/4096/5120/8192
  const TIERS = [
    { id: '1080p', long: 1920, short: 1080, square: 1080 },
    { id: '2K', long: 2560, short: 1440, square: 2048 },
    { id: '4K', long: 3840, short: 2160, square: 4096 },
    { id: '5K', long: 5120, short: 2880, square: 5120 },
    { id: '8K', long: 7680, short: 4320, square: 8192 },
  ];
  function exportSize(tierId, ratio) {
    const t = TIERS.find((x) => x.id === tierId) || TIERS[0];
    const [a, b] = ratio;
    const even = (v) => Math.round(v / 2) * 2;
    if (a === b) return [t.square, t.square];
    return a > b ? [t.long, even((t.long * b) / a)] : [t.short, even((t.short * b) / a)];
  }

  // ---------- 编号：Crockford base32（不区分大小写，不用 I L O U） ----------
  // 设计稿只编码场景码 + 种子；V0 再把引擎版本号和改动过的参数打包进去
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function b32(n, len) {
    let s = '';
    n = n >>> 0;
    do { s = B32[n % 32] + s; n = Math.floor(n / 32); } while (n);
    return s.padStart(len, '0');
  }
  // 显示用：大写、分组，例如 SH-7KQ-9ZT
  function shortCode(scene, seed) {
    const body = b32(seed, 7);
    return (scene.code || 'px').toUpperCase() + '-' + body.slice(0, 3) + '-' + body.slice(3);
  }
  // 解析：忽略大小写、连字符和空格；O 当 0，I / L 当 1
  function parseCode(str) {
    const raw = String(str).toUpperCase().replace(/[\s-]/g, '');
    const scene = SCENES.find((x) => x.code.toUpperCase() === raw.slice(0, 2));
    if (!scene) return null;
    const body = raw.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!body || body.length > 7 || /[^0-9A-HJKMNP-TV-Z]/.test(body)) return null;
    let n = 0;
    for (const ch of body) n = n * 32 + B32.indexOf(ch);
    return n > 0xffffffff ? null : { scene, seed: n >>> 0 };
  }

  // ---------- 文字种子：日期、名字、生日用同一套规则 ----------
  // 规则 v1：先规范化文字，再算 SHA-256('pixtides/v1/<类型>/<文字>')，取前 4 字节做种子、后 4 字节挑画面
  function normalizeText(s) {
    return String(s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  // 日期写法统一成 YYYY-MM-DD：2026-10-7、2026/10/07、2026.10.7、20261007、2026年10月7日 都可以
  function normalizeDate(s) {
    const t = String(s).normalize('NFKC').trim();
    let m = t.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function textSeed(kind, text) {
    const H = sha256('pixtides/v1/' + kind + '/' + text);
    return { seed: H[0] >>> 0, pick: H[1] >>> 0 };
  }
  function localDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- 今日一张 v1 ----------
  // 日期 = 访问者本地日期（年月日）；2026-10-07 是第 1 张，之前的日期也能算（生日就用它）。
  // 画面按"每轮把全部画面打乱后轮一遍"排期，相邻两天不会是同一个画面；种子 = 文字种子('day', 日期)。
  const TODAY_EPOCH = Date.UTC(2026, 9, 7);
  function dayIndex(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - TODAY_EPOCH) / 864e5);
  }
  function rawOrder(cycle, S) {
    const r = mulberry32(hashStr('pixtides/today/v1/cycle/' + cycle));
    const a = Array.from({ length: S }, (_, i) => i);
    for (let i = S - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function dayPick(key, pool) {
    const n = dayIndex(key), S = pool.length;
    const cycle = Math.floor(n / S), pos = ((n % S) + S) % S;
    const order = rawOrder(cycle, S);
    if (S > 1 && order[0] === rawOrder(cycle - 1, S)[S - 1]) [order[0], order[1]] = [order[1], order[0]];
    return { key, no: n + 1, scene: pool[order[pos]], seed: textSeed('day', key).seed };
  }
  // 名字规范化：在通用规范化之上，去掉所有空格和常见分隔符（· ・ - _ . ' ’），
  // 让"王 小明"="王小明"、"Mary-Jane"="maryjane"。繁简、平假名 / 片假名、带重音的字母不合并（名字要区分开）
  function normalizeName(s) {
    return normalizeText(s).replace(/[\s\u00B7\u30FB\-_.'\u2019]/g, '');
  }
  // 名字（或任意一句话）：同一句话永远是同一张。指定画面时种子不变，同一个名字在每个画面里都有"自己的那张"
  function namePick(text, pool, scene) {
    const norm = normalizeName(text);
    if (!norm) return null;
    const { seed, pick } = textSeed('name', norm);
    return { text: norm, scene: scene || pool[pick % pool.length], seed };
  }

  // 生日：带年份 = 那一天的今日一张；不带年份 = 只按月日，同一天生日的人共享一张
  function birthdayPick(key, pool, withYear, scene) {
    if (withYear) { const d = dayPick(key, pool); return { scene: scene || d.scene, seed: d.seed, no: d.no, date: key }; }
    const md = key.slice(5), { seed, pick } = textSeed('md', md);
    return { scene: scene || pool[pick % pool.length], seed, date: md };
  }
  // 名字 + 生日：两者一起决定一张，重名的人也能各有一张
  function comboPick(text, key, pool, withYear, scene) {
    const norm = normalizeName(text);
    if (!norm) return null;
    const date = withYear ? key : key.slice(5), { seed, pick } = textSeed('name+date', norm + '|' + date);
    return { text: norm, date, scene: scene || pool[pick % pool.length], seed };
  }

  // ---------- 全球同步 ----------
  // 动画时间 = 从 2026-01-01 00:00 UTC 起算的秒数。画面（种子）由今日一张决定，浪由这个时间决定：
  // 同一天的人看到同一张，同一时刻、同样大小的屏幕看到同一片浪
  const SYNC_EPOCH = Date.UTC(2026, 0, 1);
  function globalTime(now) { return ((now ? now.getTime() : Date.now()) - SYNC_EPOCH) / 1000; }

  // ---------- 字体 ----------
  // 中文像素字体：Fusion Pixel 12px 比例 zh_hans 的子集（OFL-1.1）。
  // Fusion Pixel 声明了保留字体名，子集属于修改版，因此改名为 "PixTides Pixel" 后内嵌。
  const FONT_B64 = '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';
  function injectFont() {
    if (typeof document === 'undefined' || FONT_B64.indexOf('__') === 0) return;
    const st = document.createElement('style');
    st.textContent = `@font-face{font-family:"PixTides Pixel";src:url(data:font/woff2;base64,${FONT_B64}) format("woff2");font-display:swap}`;
    document.head.appendChild(st);
  }
  injectFont();

  global.PixTides = {
    SCENES, CATEGORIES, byId, SHOAL_TIMES, timeOfDay, ramp, uiTokens, hexToOklch, oklchToHex,
    create, View, paint, toCanvas, pairCanvases, toSVG, TIERS, exportSize, shortCode, parseCode,
    normalizeText, normalizeName, normalizeDate, textSeed, localDateKey, dayPick, namePick, birthdayPick, comboPick, globalTime,
    rareOf, findRare, RARE_ODDS, hashStr, mulberry32, sha256,
  };
})(typeof window !== 'undefined' ? window : globalThis);
