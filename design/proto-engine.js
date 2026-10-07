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
  // 晨 / 昏 / 夜变体：亮部偏暖、暗部偏紫；夜整体压暗偏蓝
  function variantColor(hex, kind) {
    const c = hexToOklch(hex);
    const lightness = c[0];
    if (kind === 'dawn') {
      const t = lightness > 0.7 ? 0.55 : 0.25;
      const target = lightness > 0.7 ? [lightness + 0.02, 0.09, 45] : [lightness + 0.02, c[1] * 0.85, 285];
      return oklchToHex(mixLch(c, target, t));
    }
    if (kind === 'dusk') {
      const t = lightness > 0.7 ? 0.6 : 0.4;
      const target = lightness > 0.7 ? [lightness - 0.08, 0.13, 25] : [lightness - 0.1, c[1], 300];
      return oklchToHex(mixLch(c, target, t));
    }
    if (kind === 'night') {
      return oklchToHex(mixLch(c, [lightness * 0.62, c[1] * 0.8, 262], 0.55));
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
  // 名字规范化（草案）：在通用规范化之上，去掉所有空格和常见分隔符（· ・ - _ . ' ’），
  // 让"王 小明"="王小明"、"Mary-Jane"="mary jane"。繁简、假名、带重音的字母不合并
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
    normalizeText, normalizeName, normalizeDate, textSeed, localDateKey, dayPick, namePick, globalTime,
    rareOf, findRare, RARE_ODDS, hashStr, mulberry32, sha256,
  };
})(typeof window !== 'undefined' ? window : globalThis);
