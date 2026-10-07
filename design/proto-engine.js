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
