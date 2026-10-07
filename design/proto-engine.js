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
  // 构图种子是 40 位整数（约 1.1 万亿种，世界人口的一百多倍）；派生随机数时把高 8 位和低 32 位一起混进去
  const SEED_SPACE = 2 ** 40, TWO32 = 4294967296;
  function seedMix(seed, salt) {
    const lo = seed % TWO32, hi = Math.floor(seed / TWO32);
    return (lo ^ Math.imul(hi + 1, 0x9E3779B1) ^ hashStr(salt)) >>> 0;
  }
  const randomSeed = () => Math.floor(Math.random() * SEED_SPACE);
  // 第 i 个时间片的随机数：只取决于种子和片号，与何时打开页面无关
  const tickRng = (seed, tag, i) => mulberry32((seedMix(seed, tag) ^ Math.imul(i | 0, 2654435761)) >>> 0);

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
  // 每个时段取这段时间里最好看的那一刻做基调：
  // 晨 = 柔和的晨光（蓝灰、藕紫、淡玫瑰、淡杏，饱和度压低）；昏 = 蓝调时刻（日落后天色最美的那十几分钟：
  // 深钴蓝、群青、薰衣草，地平线一抹粉）。按每一阶在色板里的明暗位置对上天色，kd / kl 是暗部 / 亮部靠拢的程度。
  // 夜：深海军蓝 → 灰蓝 → 月光下的冷灰蓝，整体压暗、降饱和。
  // 往天色转时一律走"色相增大"的方向（蓝 → 紫 → 玫瑰 → 橘），只有目标就在身后一点点时才往回转
  const hueToward = (h1, h2, t) => { let dh = (((h2 - h1) % 360) + 360) % 360; if (dh > 300) dh -= 360; return (h1 + dh * t + 360) % 360; };
  const SKY = {
    dawn: { kd: 0.45, kl: 0.85, cs: 0.7, stops: [[0.36, 0.05, 250], [0.58, 0.06, 275], [0.76, 0.06, 320], [0.88, 0.05, 15], [0.95, 0.04, 60]] }, // 柔和晨光：比昏淡一些
    dusk: { kd: 0.6, kl: 0.88, cs: 1, stops: [[0.22, 0.13, 262], [0.40, 0.16, 270], [0.58, 0.13, 292], [0.74, 0.10, 330], [0.88, 0.08, 15]] }, // 蓝调时刻：深钴蓝、群青、薰衣草，地平线一抹粉
    night: { k: 0.72, stops: [[0.14, 0.05, 268], [0.34, 0.08, 260], [0.66, 0.06, 245]] },
  };
  function skyAt(stops, r) { // 天色渐变沿色相增大方向走：蓝 → 紫 → 玫瑰 → 杏橘，不经过绿色
    const t = Math.max(0, Math.min(1, r)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t));
    const A = stops[k], B = stops[k + 1], f = t - k;
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, hueToward(A[2], B[2], f)];
  }
  function variantPalette(pal, kind) {
    const sky = SKY[kind];
    if (!sky) return pal.slice();
    const lch = pal.map(hexToOklch), Ls = lch.map((c) => c[0]);
    const lo = Math.min(...Ls), hi = Math.max(...Ls);
    return lch.map((c) => {
      const r = hi > lo ? (c[0] - lo) / (hi - lo) : 0.5, tg = skyAt(sky.stops, r);
      if (kind === 'night') return oklchToHex([c[0] + (tg[0] - c[0]) * sky.k, c[1] + (tg[1] - c[1]) * sky.k, tg[2]]);
      const k = sky.kd + (sky.kl - sky.kd) * r;
      return oklchToHex([c[0] + (tg[0] - c[0]) * k, (c[1] + (tg[1] - c[1]) * k) * sky.cs, hueToward(c[2], tg[2], k)]);
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

  // ---------- 晨 / 昏 / 夜 ----------
  // 晨、昏按"那段时间最好看的一刻"由算法统一换色（见 SKY），保留每个画面自己的明暗结构；
  // 夜用手配色板（锚点顺序与昼一致：渐变起点 → 终点）。
  // glints 是这个时刻才有的"反光 / 发光"颜色：日落时水面上的金橘色碎光、夜里深海的蓝色荧光、晨雾里的淡粉光，
  // 会替换一部分散落方块，并用作光点。
  const TIMES = {
    shoal: {
      dawn: { glints: ['#FFE7D6', '#FFC9C9'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#030616', '#0B1A3A', '#1F3A66', '#5C7FA8'], glints: ['#E8F0FF', '#AFC8F0'] },
    },
    swell: {
      dawn: { glints: ['#FFEADF', '#FFD0D6'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#02050F', '#0A1B33', '#1D4060', '#6A90B0'], glints: ['#EAF3FF', '#9FC2E6'] },
    },
    tide: {
      dawn: { glints: ['#FFF1E6', '#FFCFD2'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#030716', '#0E2240', '#27507A', '#8FB0D0'], glints: ['#F0F6FF', '#B5CDEB'] },
    },
    abyss: { // 起点是水面
      dawn: { glints: ['#FFE3D6', '#C9B8F0', '#FFF4EC'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#3A5C86', '#12244A', '#050B1E', '#010208'], glints: ['#7FE0FF', '#B8F4FF', '#5AA8FF'] }, // 深海荧光
    },
    reef: {
      dawn: { glints: ['#FFF1E0', '#FFC2C8'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#06223A', '#0D4A5C', '#3A3F6E', '#7A5A8A'], glints: ['#6FF2E0', '#B8FFF4', '#9AA8FF'] },
    },
    moonsea: { // 本身是月夜；晨 / 昏是月亮还挂着的天色
      dawn: { glints: ['#FFF3EA'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#01020F', '#0B1440', '#3A5490', '#A8B8E0'], glints: ['#F2F6FF'] },
    },
    icelake: { // 起点是中心
      dawn: { glints: ['#FFFFFF', '#FFE0E6'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#C9D8F0', '#6F8DB8', '#2A3E70', '#0C1430'], glints: ['#FFFFFF', '#D8E8FF'] },
    },
    ripple: {
      dawn: { glints: ['#FFF6F0', '#FFD3DA'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#B8D4F0', '#3A64A0', '#10204A', '#02040F'], glints: ['#FFFFFF', '#CFE2FF'] },
    },
    waterfall: {
      dawn: { glints: ['#FFFFFF', '#FFDDE4'] },
      dusk: { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] }, // 蓝调时刻：零星暖色灯光 + 淡粉余光
      night: { a: ['#020616', '#142C55', '#4D74A8', '#C8D8F0'], glints: ['#FFFFFF', '#DCE8FF'] },
    },
  };
  for (const id in TIMES) byId[id].times = TIMES[id];

  // 首页浅滩的四个时段色板（与编辑器同一套）
  const SHOAL_TIMES = {
    dawn: variantPalette(byId.shoal.pal, 'dawn'),
    day: byId.shoal.pal.slice(),
    dusk: variantPalette(byId.shoal.pal, 'dusk'),
    night: ramp(TIMES.shoal.night.a, 6),
  };
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
    return hashStr('pixtides/rare/v1/' + sceneId + '/' + seed) % RARE_ODDS === 0 ? 'whale' : null;
  }
  function findRare(scene, from) {
    for (let s = from % SEED_SPACE, i = 0; i < 200000; i++, s = (s + 1) % SEED_SPACE) if (rareOf(scene.id, s)) return s;
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
    else if (v !== 'day' && scene.times && scene.times[v] && scene.times[v].a) pal = ramp(scene.times[v].a, n);
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
      const seed = (this.seed = Math.floor(o.seed) % SEED_SPACE);
      const rnd = mulberry32(seedMix(seed, scene.id));
      const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

      // 色板：色带 + 光点 + 月亮 + 鲸尾
      const bandPal = scenePalette(scene, o);
      const L = (this.L = bandPal.length);
      const vkey = o.variant === 'base' ? 'day' : o.variant;
      const timeSet = vkey !== 'day' && scene.times ? scene.times[vkey] : null;
      // 有时段反光色时，光点也换成这个时刻的颜色（深海夜里是蓝色荧光，日落是金橘色）
      const glow = (timeSet && scene.glow ? timeSet.glints : scene.glow || []).map((h) => hueRotate(h, o.hue));
      const glints = timeSet ? timeSet.glints.map((h) => hueRotate(h, o.hue)) : [];
      this.glowStart = L;
      this.moonIdx = L + glow.length;
      this.glintStart = L + glow.length + (scene.moon ? 1 : 0);
      this.pal = bandPal.concat(glow, scene.moon ? [hueRotate(scene.moon, o.hue)] : [], glints);

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

      // 时段反光：约三成散落方块换成反光色，多落在暗处（像水面上的碎光）
      if (glints.length) {
        const gr = mulberry32(seedMix(seed, 'glint/' + vkey));
        for (const d of this.dots) {
          const dark = this.layer0[Math.max(0, Math.min(H - 1, d.y0)) * W + Math.max(0, Math.min(W - 1, d.x0))] < L / 2;
          if (gr() < (dark ? 0.45 : 0.15)) d.col0 = d.col = this.glintStart + Math.floor(gr() * glints.length);
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
        const wr = mulberry32(seedMix(seed, 'whale'));
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
        b.rng = mulberry32(seedMix(this.seed, this.scene.id + '/edge/' + b.k + '/' + b.g / CHUNK));
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
      const r2 = mulberry32((seedMix(this.seed, 'moon') ^ Math.imul(o.silSeed + 1, 977)) >>> 0);
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
    n = Math.floor(n);
    do { s = B32[n % 32] + s; n = Math.floor(n / 32); } while (n);
    return s.padStart(len, '0');
  }
  // 显示用：大写、分组，例如 SH-7KQ9-ZT2M（场景码 + 8 位种子）
  function shortCode(scene, seed) {
    const body = b32(seed, 8);
    return (scene.code || 'px').toUpperCase() + '-' + body.slice(0, 4) + '-' + body.slice(4);
  }
  // 解析：忽略大小写、连字符和空格；O 当 0，I / L 当 1
  function parseCode(str) {
    const raw = String(str).toUpperCase().replace(/[\s-]/g, '');
    const scene = SCENES.find((x) => x.code.toUpperCase() === raw.slice(0, 2));
    if (!scene) return null;
    const body = raw.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!body || body.length > 8 || /[^0-9A-HJKMNP-TV-Z]/.test(body)) return null;
    let n = 0;
    for (const ch of body) n = n * 32 + B32.indexOf(ch);
    return n >= SEED_SPACE ? null : { scene, seed: n };
  }

  // ---------- 文字种子：日期、名字、生日用同一套规则 ----------
  // 规则 v1：先规范化文字，再算 SHA-256('pixtides/v1/<类型>/<文字>')，取前 5 字节（40 位）做构图种子。
  // 文字只决定"底座构图"（色带怎么拐、岛和方块放在哪），画面、配色、粒度、起伏等全部留给用户选
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
    return { seed: H[0] * 256 + (H[1] >>> 24) }; // 前 5 字节：约 1.1 万亿种
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
  // 名字（或任意一句话）：同一句话永远是同一个构图。画面由用户选，换画面时构图种子不变
  function namePick(text, scene) {
    const norm = normalizeName(text);
    if (!norm) return null;
    return { text: norm, scene, seed: textSeed('name', norm).seed };
  }

  // 生日：带年份 = 那一天今日一张的构图种子；不带年份 = 只按月日，同一天生日的人共享一个构图
  function birthdayPick(key, pool, withYear, scene) {
    if (withYear) { const d = dayPick(key, pool); return { scene, seed: d.seed, no: d.no, daySceneOfDate: d.scene, date: key }; }
    const md = key.slice(5);
    return { scene, seed: textSeed('md', md).seed, date: md };
  }
  // 名字 + 生日：两者一起决定构图，重名的人也能各有一张
  function comboPick(text, key, withYear, scene) {
    const norm = normalizeName(text);
    if (!norm) return null;
    const date = withYear ? key : key.slice(5);
    return { text: norm, date, scene, seed: textSeed('name+date', norm + '|' + date).seed };
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
    rareOf, findRare, RARE_ODDS, hashStr, mulberry32, sha256, randomSeed, SEED_SPACE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
