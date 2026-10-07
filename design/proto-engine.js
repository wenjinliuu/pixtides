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
          rng: mulberry32((seed ^ hashStr(scene.id + '/edge/' + k)) >>> 0),
          buf: new Float32Array(ncol),
          bump: new Float32Array(ncol),
          w: 0, left: 0, count: 0,
        };
        b.w = (b.rng() * 2 - 1) * b.maxA * 0.5;
        b.left = this._ri(b.rng, this.run[0], this.run[1]);
        // 快进到当前时刻：先跳过已经平移出去的值，再按生成端方向填满
        const skip = radial ? 0 : Math.floor(this.t * b.speed);
        for (let j = 0; j < skip; j++) this._next(b);
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
  // 名字（或任意一句话）：同一句话永远是同一张
  function namePick(text, pool) {
    const norm = normalizeText(text);
    if (!norm) return null;
    const { seed, pick } = textSeed('name', norm);
    return { text: norm, scene: pool[pick % pool.length], seed };
  }

  // ---------- 全球同步的海 ----------
  // 种子按 UTC 日期，每天换一片海；时间按 UTC 当天已过的秒数。同一时刻、同样大小的屏幕，画面完全一致
  function globalSea(now) {
    const d = now || new Date();
    const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return { key, seed: textSeed('sea', key).seed, t: (d.getTime() - start) / 1000 };
  }

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
    normalizeText, normalizeDate, textSeed, localDateKey, dayPick, namePick, globalSea,
    rareOf, findRare, RARE_ODDS, hashStr, mulberry32, sha256,
  };
})(typeof window !== 'undefined' ? window : globalThis);
