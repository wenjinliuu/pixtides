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
  // 真实天色（暗 → 亮，OKLCH）：
  // 晨：靛紫的残夜 → 淡玫瑰 → 杏桃色的地平线，整体偏亮、对比柔和
  // 昏：深紫 → 玫红 → 琥珀橙，饱和度最高
  // 夜：深海军蓝 → 灰蓝 → 月光下的冷灰蓝，整体压暗、降饱和
  const SKY = {
    dawn: { k: 0.62, warm: true, stops: [[0.34, 0.09, 285], [0.66, 0.09, 340], [0.93, 0.065, 60]] },
    dusk: { k: 0.68, warm: true, stops: [[0.24, 0.12, 300], [0.56, 0.17, 5], [0.84, 0.14, 62]] },
    night: { k: 0.72, warm: false, stops: [[0.14, 0.05, 268], [0.34, 0.08, 260], [0.66, 0.06, 245]] },
  };
  function skyAt(stops, r, warm) {
    const t = Math.max(0, Math.min(1, r)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t));
    return (warm ? mixWarm : mixLab)(stops[k], stops[k + 1], t - k);
  }
  function variantPalette(pal, kind) {
    const sky = SKY[kind];
    if (!sky) return pal.slice();
    const lch = pal.map(hexToOklch), Ls = lch.map((c) => c[0]);
    const lo = Math.min(...Ls), hi = Math.max(...Ls);
    return lch.map((c) => {
      const target = skyAt(sky.stops, hi > lo ? (c[0] - lo) / (hi - lo) : 0.5, sky.warm);
      // 色相直接取天色（地平线就该是杏色 / 琥珀色），亮度和饱和度保留一部分原画面
      return oklchToHex([c[0] + (target[0] - c[0]) * sky.k, c[1] + (target[1] - c[1]) * sky.k, target[2]]);
    });
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
      if (v !== 'day') pal = variantPalette(pal, v);
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
