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
  const FONT_B64 = 'd09GMk9UVE8AAFxAAAsAAAABRpgAAFvxAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAADYTHbQZgAKIcATYCJAOMPgQGBYgSByAXJBiKdFvQRXGHbLdbKXsPoLwBtf/d1FIqPTtCe5ySBCMpKoKNA4AE//Ds////P3WpiGxttpG06/4DiHJFxSQQURAl3aRNQCOiEU25nGnRVCs3WyPteIc81lrL13iFq6rKz/GukFVVdri6ALdh7w8jPfssNn30eH5C7qBM8ldbEfen+2LSYvnYEI3tE74ISbCtCLmiRQhJQlK3s3UacyNQ/7PhG5L+TAuCH4qQCdn+TkhC0r9iWtB2ehFNQRKyw2+nI2+hQOr311cWJgppmH+oPU0gukfre7xVQDk2p0aycvKk/wf+XO/vbwFckE9YkA/crQvAQatuB6V1Rl7E6tgFL3A88BzLfxV0IFGcswFFeQZlPU+LBj0cle8dLwpkqBsSR5/PAT3t5uM+IqP04hxogYUChANTl6Zbkq54BndFRiHBxhG+htYZx3h6EX2qZQPbttyPrFQH5iY3r+0hp6k4RaBgU1dCEI5HCj4dXLbdWNA58bxMyliniED43vOf9LT2raX1AYMFg8GkL+mFBC8K7EUDBmfybINJm3QhtRNdvAiLH+HHi7B4CT9e6F82tm5Ihm7pbjKPcJ/84DUjoTiTwWSlsmrPoQ8gJd28eK5Lugb2ki6wivX5B/m+//utFSz/iNveHWL7Q8QiiaSnUwOZRAOSuIHYtr/HhJPCQLtYSs5Oz/9dQ8mIKlPhqyqr+ioc4+UfBO/nwiXHCgDGdnPTmyJNYBcLtXnjDAjuQC1scdKWlMh/e/8GIJ8sgbaAqqAted29u92KIJJSLo7uaK3VlX/Uoy5S0otVtFLy7t4hc4OY5GtAerNQkJApgdApiZLJQbwSQtRSE/BB0352JuqNcMiL26DAu2RpKbS9nEjoZ78qCKHw0D9xMX14gAv4AfAuoposDIBqEsz/f1P9vrRAUW8B7axmImPTCbLvol4TBuI5+9w9jUJV9QdQqN8kQa2WnvnGmHvuraJAiO8PAEpaIvX0jXOhy8ZkE2QTBS4IJwx6YmegcGy7NwOswFz3v7xyYkpY1zSs4TWMcya/YsfYqu/S2wpKhRGpEH8ZznoR65n82lUMPEASYLc/3Pt/tq+6PbE93dWKQosESCBpt4esQfc9T5mWllrp1D1sgwFpQwCLAhLr9raWTGqDoy/Z3MPFl7lp1tzNISksdeMv8vwneXOlF4jCTEaK/xw/5jUGEMABO3ADPwiDOEiDHCiBGmiBHhiBGVjBbtgPh8EWHMEVPMEXAiEUIuE4nIbzEAPxkAzpkA35UAxX4AaUAgXuw2Ooglp4AW/gA3yBH9AINOiAHhiAEfgJf2ECZmABlmEdtgF4QHAIO8KN8IMoHInG4olkKp0JCEViiVQmVyhVao1WpxeIwpHYEq2tIwCCwBAoDI5AotAYLGAc3ECgpAZAYBFRMXEJSSlpGQFAIOCQ0HAISCjomNi4+AKBQcEhoWHhEVHQMLBkyxUEAgYBBQOHgIQK4bqbbrtrjygLyoHyoAJDo8dPnTl34cq1W4eMGDNhyow5S1as2bBlx54BQ0aMmTBlxpwFS1as37zdTgOHjhw7cerMuQuXrly7cevuNkisHLz4RuFINBZPJFPpTEAoEkukMrlCpdZodXqBUCSWSGVyhVKl1mhl5wSEIrFEKpMrlCq1RqtTmF5w7DhenGA4JiElI6ekoqahJTg6Pjkrr6isqq6pratvUFhUXFJaVl5RWVVdU+v2nYPCouKS0rLyisqq6pra4mSvPYqIS8k1NHbi9NnzFy9fvXnQsFHjps2at2jVhi17BgwZMWbCjDkLlqxYs2HLbXccMGTEuEnTZs1btGzVpm1/0ENNT51T5y5du3Xv0bNX7z4dPHry7MWrN+8+fPn249effw+evHDlzoMnL958+PLbHw8cOXXu0rVb9x49e/Xhh88AEi2QyCqqa+sbm1vbO4tJySmpaekZmVnZObl5+RUSk5JT0tQ1NLW0d3bjwYuwlJySlp6JjYOLR7cYLK0DkdjE1MzC0sraxoCQiISUjJyCkoqahpaOnoCQiJiElIycgpKKmoaWbTuGxCSkZOQUlFTUNLQE7HjL4eVPki1Wm93hdLk9BiKJTKHS6Awmi83h8viPJDKFSqMzmCw2h8vbx0AkkSlUGp3BZLE5XB64CERGA1ZUTTcsug0lWVG3/Tiv+3m/fzDOy7rtx3ndrw48agAGwAQwAywAK8AGsAMcACfABfAFuAF+AA/AH+AFBIAQIAyIAKKAGCAOSACSgBQgF5AG5AEygHxAFlAASoAyoAKoAmqAOqABaAJagF5AG9AH6AD6AV3AABgBxoAJYAqYAeaABWAJWAF2AWvAHmAD2AdsAQfgBDgDLoAr4Aa4Ax6AJ+AF+AW8AX+AD+Af8AUCQBAQDIQAoUAYEA5EAJFAFBAXiAbiATFAfKABNAEdh1gUmGCQMKh2FAXPOaXsNnOmgqF8Stja2VO7eZIYGsv8BOa6XUgTJofL1+3RD7kyrL6ayFVHU40tQUn300+pOlfd7Z9b+tJ7fXeLN7zfvmi1vbaO+zK6WOgiGR39Wmsm2Fx6zfGrbTjJ5goz3/4/KhzAeMiLhjZ29QZvjTRVd7dD0ZJoEmSRJ81Pkyp1GpY1CDzng737jr+T4foYayjqa4wmwO5Qo3Pz66a6XaKlVSOQIzdKupjFIUq6mlq689hd4z+KoXmKOp0zzIfF5qvNwtKHKdTp59GH6Bv3gXlBkny8PP61oPJ+tTrgfvq0p8/HYL8FXGmOQBdFrX3Npthr6U19Hq174m1aAEchFHJfvXCoIiTFgphBsrXBocSlS1Xq6qdLw/Nsui7PHjZCvh79KMxa7BP0V7WNPknnfOelf8hme7YP0Qu7AsndDHn+EKxyclP6zs51bjysH/JzyyQtZDAipRtjiyzOKoKSsKqp4N48kfF7sOMA6Y/H0wk/G0EmORJRuDWYEJ+8VNDlx4DPg30uILMKZ7LO4uPg2n5jqfzaoWLYtYg72zvx/rjxEnGX/s3F9iZJpoGMW739a6NIln51e73XPoxNMVh3x9/W3px2Cyvy9OPpryWQckVWly0q8xlIuTTQwg+56O5OrEe48WrsIfZITcGht02a4jnSiV7UnXq4/OOuF8Yvk9GNZV/eTOLOLVbZ3sY3estI24/6o06Uu8H1n1d1SPxd8te7+2jMR76iZNPilwgyqeXTt6VTX+MUHQUBJiQxp0D7Ooixe3M5GrX/mh/L1xT+A0T41tqTrmANyjwU7DVoD8lQd1dLY3tM91AIcuwWgTBaOCOkRh9WhVt4fFL5P6uXjEBDi7zXFYck4tdlIkHx1/6ZHuWPAoHcvNZchx/8rbavsZO2lnNcWV7EPXSr2HsYj2bQQ4tEUREvmqwUK+g/2I5hmN+yHV+JXNemU5un9o/p5m0bweZ0ebT8KXZjyeHCCP/O71czV6r5yqOdpH9VrCYHK0teSoGgVZ+1X2XY5la05kn1Zv5oLD3KK15n6ouLTVnczkrqntlqV9bCG7t8mbJ79iXPqkrDX8ujjGn8H2/kg+TX2UhAQVpmtPO6n/7buf7QJyZFku1qNYouXrQhWZ0ut9/tV/45FyH4atHhCt387HeKNO95tMVQaS2txf4yuvA68kc/i17LxeSb6jkOvaHcyXXx/P7vISF4UmP71G0f6QgghyTGqlqqTF3V7SmVe+VkfNWkvvkwP9r7T+uG4w+vq75xWMZ576zPsQYziN1FupTZe9A9FNWffXcDYJBMzCvMGxQAiZNOPsOOlK4dEJOuRKnBLIx8VtnlXWgFNZqAyhdcdi9Mw3J2tKRKqmjIEpxcjtVYwoLPu4xu9xIDK3cK7Sqzq8axieVXkh7sAvl2unw0HIrl1YgJKYHMInS+1C73yU9cPGnnV3KPajOJm7O9uZbWozos4hFIs1OV9MxPvKod716tNvCxpJt7yd3tmVX82GQ6GjFyX4wT4M6gtG72o74mrBNkTbag0qNoIaSYT2SdhA90SwsRk477S/RghcaJCaWZc1nmiOfrJ6FfkSmSnqik5Eq0QNpaKhls6dbIevgCr1eSFXLWPpBn65xlCv4eURRCoYTN3zDlI5qoKGqmii/bMjUvT6gLlmGSxu6umaKp0rldoXURtLlLqAKdjotuumoVYtAL8Jm+rOcMREpFY2jvByOBIhuzzfhAD7QxYS3QA6ZcRdhiRto15sUsRC7uTOgUIc8o2lnJFKCUtUQxnrERz9t1u3Ad0WW3oVJ7xMr3216fbmqyT60i8/af9MkBhe7742CgLoeO+uqwRo8tOEI046gTOgLJINvdatjhy7DFPqo7Zjgc8JojWqTPnIx84azXGxNc3HtgmusFddz0ytDBXbli2zzEivafp1FX+2iCl5la3pxd1M6HUIF+viblmuXnqpm/YTWWBBCkCGRVLEg4dzcFCysV4mdBqJMBYe7ahR9GFiGtUKSOHlF2qkRreOyYRq8sOO7dVUNOiHfflpMh+p3a75nTu31xRkGys6wVmnXOEd15f92IvhpdsNaGdEitGG1vXbRYmthccbhItsUna5ewu5yohiRqlmVSkmVXTUo+4rUUoc4YkXrCkLRDvknfW4JGGdZaZBqWYlRW7C7JzpaDKUC9XHOv5Sm7JF9RrgKeiP4oPG5I0aldUZwIJfIqXLLtVDfNuuxl2BWzbltwVdc911Q8c93YRzc0vHbzwPa6FQxkUKiUX4Ey1Z1TftttDeUoGurc8dshd4/DPUQc3N+zkx6QPTQy4ZGeVx5L5WjAEy8DKoLkqZQow4oqdxOqPTWpcanET1R8Z3dF7Tl4imTRdXWecRXhjee85aF7sV+7l9q+eUXQ4HWQF94cRvXWyqR3OTa9P6/Dhz2++mjijU/4cnbW50xf5N31lU+hb1Ju+a7mgR9R/qrz2XH1hRo4xUHjru3R5ALNLGq17PMVzW2Z2jXarPRo91CrQ9pjnRwdt6nL1Ihu1aKM6/H3TO9+nfoOatLv5akBmSItGnTZXkOZhpEOohlx0Ixu4ZZRrU57ZUwsP4/8lC8bza897vnNGdGwP9E++6ulxj82BcZlJfmPc9uEuRcmff0z5eqNaWlUMzrqzO71wpyCEvNCmiw4GbMYYNRSrHEMf42WJSPqtWKrwqqgh9ZU3bHOXVRVtm0QVNuU8tqWse+2bX2zYyEfk7dcq8DfQ2Z9qJSow6NMKeY9eS3Dc4wPp2q/omXq9Ragwv8udB/OPardqk+eVL8d/vkZY/z7e/t7P/994f5X+/q/8b/+sv/RX+Rvtm+ZGsD8y14dlaeJ7E/H3g2y+/bh95rcBhZB/xIqH0Dgtaivvw2NMPsnU/e2nE++WzQjrSLm8zJixRD4Nwalt9ffNv/uifKYqdM9Me6P3zvBthgcN0dZFjjatcWdNGE7482jCwAVXr4roKAj+79MxS7UYJjjgSfh+1GI/ONHY2RypHssLMuDyO9RPOnH7YIPFdQHMI455lhvqc3KtFLWBfH5BUNagcbk54Pg7ncUAT/HRYmIh9xD/3inN23Xk3DrQr+Hxf449wlf5rMV+2TRovxyyfHbW4L8T9bgrXu7aEK2vAvre7u721riXwTVdwHbDQEOAjyD7reRok10Xo76ZUmubFv1Qj3y3ijfWKSF3wu6rqAY/zn4zYhpVSK0ZhmDeX5uOTjNHy5CpUJCFzt5NU57WyqUBpkYYPd3bg4T6AbhwYpyKKKyd2SWe0VLXHnDWjsSITLK2kJHQzyugBWDmKeHeN29gZ8fcrjNQMB748G9NICmXetMbK1PDeyvSG+7TLOfSyP6l8Wn0LRz7VIujMKmGvjnRn7jRS6o/G3Yyt+fSERWqfvLFEOEO9qgOO2nuzDD61JvKiP2gtLNYYh3aCVCFiI6AxFUKiP9U6LyNiITiOEX3fDUhZ/Vuz9zLQQSczvdAZGYXgvDndIKIz/Ab0j9/HJK/1+CEXgrFY2+MELMpXtnuxCCySbdeRPjvBHIJq3G0VH4ad8t+OL38qiNGLR2sNH2fI7KU45dFw0RsuhJOBWc8BgCOJPDonGxU8EZdQaCN5WCJjxgcRfpj5mveqh/ZLOvj6WoxeFT8PwFzFSzpHU3JqMype+t/NcWoBpIaM62q5H7qUYL+LfNyZ8zv1Vexi31VACb3zX15gxPDjqG7iNcue9cFbN0wTZnAkydi9+jJWZif+vtqdfyr7NTGU9T3lEnObNksUTT99eHGgIq8F6HT5GfdwgHn+hvzsBgX0nlLj67xF74uGI3f8nvRyi+WW5YPGia/XHuYzXZX35+Uxj5fkUqLQizsGmpzEo7RS4K5eoG6aZL+0Nb8ee12QFMb3eKdm7LrJn+21ZYdYyCKY/Utbjx6bv1uN2lsvXimylTjKak0x+jgpTwcpcqQ224RNYnoabUq9e2Ge/7pd4i9VkZXs1JtegUYC6CAn7jqhnLPRtpliH8FQX3VWe7b8s3sEe25Q0XvRdN3B55UrkvZownvHOQD98DuSx0G4G6dPh0++S87jzyKW0PHVte2FPezhrW0bCCb60U8NRH2u8dgb7ygvjp82WNoR/WMHfHm3xVEyhynEKtQxrak912jNUsteiu9MLDgTFBe42/IY1+qNlt4fh9kGQ65qSbpmy0e9HC519KRyT3RjlywQLLfaSzdJvCSgSL2DYWwuq4a0kUblK8xfcD5zhC5QEpMIZpUTOozD1Mvvg6PcEFm+M0MJ21tZNRYJAeLeTZv/HfUGLLgE1ebzW8b97pKnVW5t8WubvrnjJWcvei45ZtqbktgCc/uoiIk+uZIqVY6CJ/WwUB78iBVgaLBVFEGLBltAxkVkBA3+83fIMHPKJgs7yHgOJ/xv9Efs9vXOcwIPmUzOa/QVJkgyrV5IOAOMkL+Gfxm1uKMf/Nemj89hDFcB9eWMadN7uBJIJiv/gdcmFWKVaJFMjJGyqwH6oorCgCoU5RXtrCElUr7zCDT/z0+Pt69qU3kn8D7e9VDH7TVpLb4BD/spz3uC3xp12rzLvlVQhhuzFnk9+boY1lW2p/w53u/r6/L8aUs++f/j1btfHaaZHN3QrYfcc3dze3a36PUwPw7yOwO52KBpLVVvuOw1t3rI/FLdA0rO/CG5RtLeVXou76m851Oq7M0xssP07uTd5mB1OJNl7zSB5t3QHfxX0BejI87j3grAufzRbs7vf0qg99qH8HO5VuzbOnaEf4vsFv0rSKuxrTpSxS9i+tBUxKkXIJhvrIJ5F322/oZKC7ZvlTgT2uuQfDdJTjdC/YN3zxY6jQKL/Tpkvfqkjr/+aV87PFMJGn6f5+JlJMjtYyGAHj8eeuAG/K82cuOwmkh6nPJ2/fuuo0+DhOxRbnUDpxV0luI23RiqdQwPxofCTVrlcylv1gagc0jvprqso66x1+pBoV/BPvTHtCQ0fp3+ww7OdGNkg/r+8/4bvaw/YusfO9Cp3PRqiM76ZgziISBC5TL8UEyFAkOm8cJY4BXzH/3iDOgy2X8zks6r1IxUWqmVgrgG8nvXV5auVabIAeF6iyB87Ch5OH35b1rSTj+Wys1cNp8q74bEHTdt1reTt1croEJ32jHZ7PNozFG7nQMtBTE9siz1RZCdgJ9BePZzqz4QOBZYXSqGQREM+epwX4v2beF5nvhQor+7EKzZh+noqPFeltH9tV4FMEV2cE4f0ZerSTEO3EB1Clqr0j8uMnnC75HiJaevrnb2fKKGjyCjzsMoB+i2LSGvsObEcPe/z7BUzQYeIjYd6/FZGdrgRatCKVcOjIh1v049AEv31rbfBl8c3Fj9wX2a958YAXDJJ5/sFanJNNME++Qv5/Tdf0oPttjW4DJr7+hj1q77+6WgGcGI/j/WeJcBLklH48ZisE8ASjld6mbOiTQPrcfTv6JY865Zi0zVGMEnNU2EBa59DbjWHDTRhH3CqGlrZi092AEQcFWLBtfYgd1cxVC7UnlMhuiNpH2omYtZIWgIrvTXb+WMl9m79NyCdvOXSf2yIYy+3JEiTBLTgFOSQiRZoQKmtS3myzLBbaH7/DMjajI0Xz5/GAQMkUvFMjraSl5GDQLKfPSX/ILdhZ6SGN5y1/93a2DUi9OHF14uD0mbO9YecUAbLp/1ywEv+iXsCy2o/tWX4zgF83TVe+nq5WjgutvDQ6PsY+FmUAEBxORSC9Weet7W1Olmo0stcWlZXrllFM10q1ERFZvYWHIewN63lfj+8cYMdI8zVb5va0CYPnN/7VFlv3nXe+2YdfL8RPdp1BUVACdmAzISSnZJ6CXxqBB1lrsErbmRQXLzu8NkIerlqD7aig5c5EBF+j7v6uo+TV8dsttkykpFDBJyoEUrlq/ahC4XuEP5WxaIypYHvSlqvReqky/MC2dyE+7C+0GxVRfpT9GBL4VwWQp0R+l4zeuJJ3Cl1HmU564bYRzLmF+VY2kbcjW2f8kzeJ6nqLLAJbqVEfrXqvFKJZfb91xdELT71+WI1dUaZKGquoBE75aTHIhRGxEWlfCc2UYecrNRJiXn+K8V562HoighWy9WQIeHl0bDDdSLrJ20S1yMmU99Lz30fUKBypaYZE7lRu/fz13Vm2SckBJROm3YMH79LpVl6g6+IOvJv/lD7fQhYNTm0JK/o2VkTq606Ad+ZVHziyLU78u4EsEd2rBMRdCZkb4C4w+wqHuBO5XeZomYHlN9DwNbTV9NvdivusV3FEYz8hN+O+5TvCKLWuk28mqUKQ/t5+YOJ8KynXNEPTdVfyNektn49569GTYl7GHqglkla/b2VqOI9ukEImPsnNe2zAmw9FNomJrlC1RK/Re04EAOeNtCotWPvfdiiclsZV2h9mJkt54rfd0fL3QZhmoRhxlmILFbYpcW/hX3jSVtskTJmb14vIlK3Ci2Vkyv10rRCFyOV3pGzh/GsiCb5omBpMEVQBBU+wayO3SvHULxn6k/EU57TElb3WzVvoAhJBD9FeZA37mCSldx/ORyBsqpYLKqt3dbrnQri8kJ/nhSVapRM0la1FgffbaZxy0JFrVBeAMPQ08J9EeWoE5M2RpcUPs9rfuAImb0mG1sfOqX5/wTvs1lWoXP9MArh0TAa+aiLMpx9qQl6wgkZwHVOT5ddVc/iYjWwGifILn6sE2kFC7F+l4TpNVrZOQqlZ5YRxHuVMNsOdlEFGYTUGExskICjqfjFFKQzLWwcqVReU6VRy2C+9dTxiMkroHiM2AkcCSTNdOCvn03U/miUD3XjT7u4eqfKlELOojjGq6lu/qailJEi/6R3SLS7/P9f4SQJncKagwt62QAXOU7crSfMJibtW+sCLKQ4lbg5yeT11kL+S60i+3jlEZl/KAlQcjZZr8VbdJhjlN9TZzL95bVzE0U2D0Pg3pCRLl7vtoprcYQgn1QjBwJ6atUDvbNUF6zyBCmO9BCFkS1RuWTbHoCKkIy4of0MKGUWayZK2tLrPng4B11Z+ZqpE/yZWnL13aTSkIR61CR6mohbB7muqruaaihL1GC/pL9C4/uWGrB/EgYPoDB6zhbBoCWSZmshRnun8LLtu77NpmSVZNlw1kar2npdalsUasZ5H846y2z9HtImHKXp98dYHwl0lMZ0f+vs7+z23dPp7XQziUUdFI5Yt1FvPFt/HnZAb0hc7kexpb191bVkqeE3RhXPfFmWq4gslPv3Mo1z7/r77/r2ykI5Fz2X8k5fXQV+3PHpe80BkoKbqpjNyTRr46+Ih+aV92Z0pIxK4UQaIaTeTbwqbLjN08/nVymJBz4a0gtchWoIzWmYdICaej5wY9yZTJV3tQiu2eXL3nSFK5I1f1sqx7URHoIh3Z4msj5jOYVdDKQiyX3WYtIuARGttFfmW8zVXKWl2xPeDSmMg2Ri3VHIA77UWdyqvLcWv2DRRsjgJFu55q7pe/WaQoW5vdS9C1hL6eeT5A1pMsYbLyl1qlZfMqqgTzdYIfdvlVkLGZl5rspgpsIqUyhvTXEpT3iMICvdvi+TgoAOm22hL8xF1QkcRVtngvlVZegsF0TQGyntmBcIXGXzn2xUWaYG749KBRZE5aegS+2/7UyQIQTihRVMLnQo8lFYHkD5RS4N7aHEJ6lLViSbpxpEBXCIMOfwuI1uEpi6gEMybrAKskWucLAJRwQs1qMv7/4pxDTFixfYfBycPVENTPMDS6iM99CjLQmou0pPsNKZpWWE8kEFQPXjHCdbpSG9BX7zzTrM3vXpXfVKAoMC620WcczenqRWDCJD11CTxErqyEp8g/5qO1/fOpuObXr7V3erDyqZVUYFc5qnRvhTJuaHhNUzDbdz0K8l5WH2Z703TB/1Z4rJsx+3I0U6Nxt7vjOyAfizb8rfhNGeVKlHBc6+NTD9Vrc7NgKtrVa4tMvROZ1SqFxmQqOPTENK6lp37B7kbKasHIbf8Q/xNelX4ZGrusZsYLQ5RuYpy94pqWegpS1i8YujgLEunloMWXztbz+/HHnGIt3lyqRSqQ65d27WqCBbfLGmot2W2qU1lZ75AQFEJYwMTqIvtSBspmpnikkrcsywWbZf4kiuVXD7DKMGim9KFfZ+uvSFrwZPXYvJj1fYEPMGO4RCUlrtCM7AGf12Y8iVKDjwmO5ONPG5uYXNbhCxjgxuXjQED25Me3E66WK+r2NVvK28r6bSx+CcFJjWTz11dCBvoUT7w9+VqyjPIcg4wA/4JOhX4VeHCn373/Xx3832F9I2uxSavVOyJ+H41LsrDUE+YUHMg2pkvkM1XWEA9+ORFK9R6UFHhQpeQuJ0SeP2Qy7ultytPHC0PzB0nukjVo5y39y6cGlxlmYXleivM9FB/Sya2IKy3VvsWaSPFSqU/d+Q80Emt1E52lWKbMqwGrOitZlAmOsnT8xu+7nRJoH3SbK65M8g/XOEtAE5CQaAg69SxUIL32Pvu0sp/SDlS+03V6uUVg8zylOL7QdGbJKKPd39DeySycV9bz1DuUBa8/aZCzLKlp/NwH//J/maK/bZy1zqYDGGUWkwWsOkv8mclsjeswQHM/lFLkX23V+Ok19OzysZaZQaqZkosDg3lCLKfx3zaKUE3lS6XbVSYJGMAASIIkM376TPyD6vi9VjWktTu5MW3T7pb0cvlsGRly5V0WMAv0ilFrtWPrXutyG0qpVp5YwoezmfYjKeuZAtSxhkFAcLeNtSZPhzp9AXIS6mfbfvI2yyGN7ybW7kTROZRXoxalH8X77DN1UiBbDTpnoPsBe/i7afnAxJ0L6iLwBacKWshbB8K8hgMKvcXdwscZODTMo7GgKuki1LrOikOOltBpiqp2h84iDZ1eRZk5OTH743LeSu3iFrH2XO5K29pCl476WJ89O8XIOXDoE8i/ucopRFp6d3fpHTepFCUCnGVFmWCZd94G/plKNG3wuxQW0NS/4VYRWZAgbRYM2bmMv3uO8FGcK7Io1fRYFgvmbzjsNdV7fth6vsmHtN084odqvgVBZHVGKSUgtqJ8GBdML7CxlgXgvCFUj7MvLISFtZLmVe+oEjnMcOv5qJMY49tbIoSrTCiawW6a4H9GkLStgx0Y4vtldRCkXUWNEZ0rFkAIMKTWMaQ+Xvirb5H6NHwB0kFp+/2qd/DoNI60uWnRwUNava5Ui4xpcIBPAldicFf+n6z+P18/bpy/9vfxG9WaVf3Iu0hDPj/KFzzPlzIir1eeEAzGsZZNCmdE8sAH+5AEk2XP/QkhXVlXyP/dUMByPbelwfX/4mqC0xfBtgWc3P+TqoNrEvr/mk+JmIJkeUXxCg/0W6TRe77lpWlnQSaJ/6m1A+PjfmERNAPWOXoan4W8XK1XvNvqtrpAH2HdSfDFHENtXXWYFzTvm1RUYsY6DuTXh9gTMRdJCc8s4sXu+utKT6PnXoYeso5pkkI9wIyVEvVxFLk8+5hKP0qIMaRBR1CyqwdP1ij6vyFq5QrcJrpuVJnkHHAtQXu3yPSxIHGJN8VcR54xOtzZQ+sFL9/otKOFHd616CPFtEw7+elpFI711M7Sfv2n0U39zhZ1QVWGVjpFEjCRWMO6okojGOtwdiKao/iMTgpwArw64arY6QttFShXaS8IYEao+Jugr8EcO7t8oy/OZRCu/y6FN9ka7Wpk9YuKw70LKd81IBixjehocQITWNpzGygM36dgRzVb5iqt69h5yHTrg0aqVy0ypmzdFFp0L9LyiUYoSPrQkFrEN0ASHqxNJ5q6ZNEN2jjGg3OCv8WwQlCaq5xNea4FyfyA/VtjxLbkl74tECjxKEtYlbiFFPbrcRVZ6mFSZmWIgRbJxscXcy0YDDOoCJyJaqgbpv24EpCmywueyiqFxwSImEs7Aee7kKN+GsNDyZgRKt8xUhk6BUxIwgoDa2ergvv06XNEMhbExZW1eqkIK4QKU2T/En2AwzcNO9wdTso3rYCYQnmqWSJuWUYFEadD6WuHFCIOnrMnNb8lvyh9n4nb9aX6h5HoqYuI8QSdxbasfQIFyPXDK7z87Gb8q2tkGY6T+E3MZWDr+NQ1q7DMHY5HkOpPsPpJBfpfVQjrrS/oatYajV9lsvEraRhkrnGbVsZRwRSnzpKJpff15VbSgHccgpGr9uL/dcqDHGebudO8bOtPRElIdBDmkPaE1tdobS+rRRM4pkBaSmO7UvEn6TF/vXNIn6gB/Lz/haj9AHJak2uAHqEQmChGoY2E3y7xbdw8nfT6QaBjioC0qX9yHtJdCxs85B/N11QOnHDAkpfUFeveBo+E1Fv5pFch4JNJg25oh7RJgCFxaJZDh17DEUIk5jCAurIxdHv6ixCnKkqC9fFP7YtoGQyDctxNUG3Nk1ExIr4CweQy7bKrty4wN4tQmQdlRJ8yBBN8am+VwLd3JAH1wUu7rbGPr3JPi4uJ6Tb+wxIkTFuWYSCSzYAqK8qVvBk1ukkIM9VpjE+7pgdV+EgYtgENJ/G81zwrHVgfCR4v+AdnOcW6MpLtfR8xLbmMmd9IPHpQpRM2s0aIXyPlPQjNjMv8zxAxRQA1e0shHKqjn0HChmgxeeL1PuIeyG4TbRDDzO6eMEoUovZrnjdNYiszQ83bPHNUkJNFoXWHYLtzOkxvXEu4t47EsfVUWKHhVF9cNHM11WReH6FXN2RyAqYbJ4pCuzWAv8ifYVD2FnAaWBOvkNch0DT2T3zXBlAv0S6LKJlpIxQ+4aOCKb4brs/trbgmmcc28uiBw7czYlTkynChaxmtKg6rjbLpIb0ZgOkKkvGznVkmYS9/aKyVKVo+kTxHhIMb7W4iuXfhXRTUClLPps+SEuE4WapSUhHsFeLu3fFm9ajSulZjGZXiZBeR5w88Ol4VyXwGMhys4PcU3B8xN9ilSkpIxWXkMB781ya8VsZ23qToi9WybDxrXJXNGfVIKOmwMPxJ+80BuOmZjFp2yRfYVhwelDWmYCFDh60Zs6fh7q1/0GliwHD1tHVbdq3vGh4NaVNf+A919uHxJwyotuK+a6qL5QJjOEcIWxDuwXa5MpLH4ga/dbf83vaVJGMtIschK1Doc2GaAJGbdx+qEAqeEJgW5juUgMnpjgd29apMSgvgBxs5v+YPXL1wJY7O4t2BIo4SDgdB2hJdcDADuLWL9YlVlUwX3NZ5BuM35oSRqL6byfih3tUGJxxvbtS+8px2fqD109uBC48SvpikQWJu6jvL+HKxTvC6fSnO1W9b51fc3pXYDj7Vy+7b9zkrsmCtoGponYivtLakyzVuJUSp8LriUmXPXYBAmhRjm6g1E0t4uMo9Cqoe7D2+gmkf7j/dT0DC9o5gciBHo+H/xppUw2+ypIO2iB+YArULItnOBzL1ed2Glhxim+pgmuQ5dxeXyBfibTZZqG5A+5pzUCTfpWRnY+X99UeTYF2MGwQfF7E5iy1snEANwbdgv0AwDD0CU55hRutLmGl3liyMem4Q26T5g3ho7lW1ay2O/FqEuZLQEaW9T27VD5inowmMySRE1VTSpOvvS/4d6gvhtxjz+tR28HRVgwxFGoxtrFo3ZbxUpPIgPckKVivX4MVy5QnX8JbSnKRs7g+OtL+O0pZ4Kkg2i8+Z9npeJxTBTA0YlusbJBd6Zp8CjrCFTQq6R0v6AC1lqCvNBGerBxys8bg42agIajWggzXcdGlglKrd22L20xBb5o9NS3Zgj46eeYaXwd4os1CkFuJdOGPZL79+nunbxukJIwWRUjxHPlePTsbVIu3IO+TIKuKF5WqNU0L1yXfrkRN+j5J+umLZRaernFSIMeTe8wsZr8Dkie5iBxtpqrGauMcmI1YPGBJxerg8X5HltjuYCMvQKDUS+II0VszCFYpn23t7/VgF8kO8lKSSy/JZYqW1AnjirLb1NIvxQHs1kQAK/CkEFyArMEqTaM42I4geAC87xnnpiJ2CGZvdqBmx8W4CfEBjfcEZaAxf86wyCwODdjznO2dmrKG4GC2/Pm1UpEVBRWCddS6fUcjr+qxi3yHtE2+EIxCd/ycQZeonzeOYHdIaEZIMKHY7RJIxctmIZWRZhbK6t29zbCToe+3k2TI1EImZApx5YW/uS0j0pfQysg8cUMM6xe4d5uvL0fAvg4fMl7ik2b0+zDvVHseujc7v0CBAvVdQQDRjHWFW2LcIn7qQLZUSU5OAfZiUkuClXQO779kIAOGwyGREOiYwbdLbUR+yJazaGJwZMYR47AIaq3MWRm42Y/jPYcivUCjIAO68xrCW6u3sOfP6OuKmfhChJjDajQ3oJ20Xf9CGPIC+gsiLQCYiutwCf2rxrX83WUo7cNv5qXq0XFcpnvjmLl9De/e1zrz3Y6cChsWw7iSOoo+iQvM3rP3LASMimBevLx0lZnI3xb4j6UJGiHTV4B6eE6Vd1i0wWMnNsqkjA+xbVIIuhm/j4JcxotKFiBRoFt1OMcItZmM+GR09qZ4TPG4PBci6iCLFBVWkfjkzFxDLHQAguiCu/I5QBS0xaDM4iyUkH3O79NC1n6rdbPGPwcLSRMxLYg4Q4UfUrqPQAzCWLm83HRLrZwekX6l7YPgVRzAdym8ISyCnprrl6bGzceg+L9wrjDVgozjmBuqbpfdgYlD1sCnflI3WDoj0ti9/VqfC1QENcZV+URMJEQndZvW98yBSWZWQ30siy8haiIQ9FatyJJUDtT3Ru7ODN9abW6ucRdiffTd/UIEj3Zpkomwu2tJI5ihvxEYI5jym9xbafqrHwn0ySLGpCL8uCeXRlfiWYo3RmiaeaX6WMIfwOhQacvrmJh7NaJf+bqLU5Cvb1n3oZGZCtLkK0sKqOmFOpYgzhUXc6pT6JdqCdrq6na/+q7wyDGyee8b0C3Xhkw3rSoG9AJzLtU/1wW1XmJLaSMK8YBFSwjYmLqIAnER0ZXYdIlFVakILcvqrGofTl9V6RIpVMh9YGQ7yBVP0rWc2o9So2/xEyhmelbrdogjBMeOWRS+p/XG9nEamyzjow4HzoN+mJCfH/QywqRwKBHp6a+LNm1C4y+BeKeEXyLODI2n9T/6XffBBjoqI+ZqSSEia8P/haYLZmI1GgbqA11tpAd16Vu0ef13DktXbwNwQ9NH/c9QXe96yZe49Na4VdWkCIK7/S/i9LdszhAGPqZ2AWI1PH3FQQRN0DiMS0WDXOBLGgwVr9yoZCSRfuAmRYkFcpQui2u1ZlIlNa7MdNmG9i11EpVQjv+PK6Xqdfhcwwb8hiKElfGpqFIcL/pa4faHq5aGwcAa3HHdHEO50u3ncSnNsYA/UuX/6a/BeAKFasiU2zhf7s/XLP+WEOmynUDf7e73pI9LEWMfZQoZpNNBNfjwttaZQrRB6EHuXBkXrQdhg0XqF1vk4Ks/aDlB9ciYfi/vG10Xx6jez3hE2m8al70IWjbAtzBOwYvy4l6HnmkITgnMWSfxnlKIpmWStweYfenBX9EEj3blIfahNC5hMRVZbls/qFk5rgwb1iCEwFoImLZ+A+unxfkQhD8Gq0O64ZU98OF9KQZLf0adsqN/u3951hC7OXS3zJqGXFcQEklNc8d0rkf/r9bZ2Cvy73Ol8oVKb52+2rZAcorCvfjclMv0Z0qC4wwxhNoiZQzitu9mfBj9VcscNmjsjKIIZLffTQXaIHSqQ4touuK1FfdhSDebyTxbu0X9Ri7egsUz31WjQyunXg23dJnRGfOulgNNmpS4WDpnDcYqN+HiwqPtlzgjbBlAQDFvyZVGzdb2styFo3H0MeNghFwrLVmKMxRYkgyaul+u6nB5/J10gkdOFyRztJfIT/sxUz3BoFqcaxZBusjGxbXrxnd/Tpxvi6GndGLvLPRKRIH7VFVHkUZAm/Ew8+yp5WrT/Sz0pYLlaGlLDIednHqjV+l3YkRygT/KfluoTlDBPHl+nGG2GtTZaTYRvWOMQgt70367obigEHhjUdYsGn5ZCQpMCwATRHHSZSTuHyyCu0zIVeqNpTBaYXY1AdeFBsuzlyJHm5wI+O7dFROuJf3hWicuxaHuRPZ3sxH7Uvk23IvqChr4VQIxom7JLoruFtAR/D3gUgptehMO6miCjKLIkztFEEH2Ptnz0QuONqj9EC2sf6TWY0f85ljpYoPbhXfawngbT+FiqmS80UpZBzZKLb+3Zlef27WbGXckvrQ8gz7qUejm/NTdNkyWxmaPZVU+liJ3DRBBhXwYf2W7nxxSu0yNVAIfsTPGXRnz/Xaa4g6G3DYSRDzQtuGpA3NdCW1OEuuyWHTMnovm/asU3pNkklt2S253LPa9emhR1sOy7adKPLgue7TlZIR4gVZW6jxda394gxzU+8Mt68rIQExSS8dLeJwX33+k4AQ5dnP2vRDUKH//jelAYCJBtH4Dd23262VlyDzyQFQUVD+G6aXGS5xeoqURDmQHLpR06bAI060JXGblGkeFIrVZjjj2VDKyS8jo+DsnyzVAno9HkeFO/fXcdZnxlrt4fUt76DmmMqRsZ6kN7jpTmsasahzm1luJvpKDFbbzLoRdyuwIqHUUug9BJU9or7PgkTExrUIpCRLLbTMflfWbqk7jbAU1VAQjsO0PzXCfyUjREaJdYd4hno7yA6QcTVauRbKaQF2o9IJxGuOdci5FOtdr9S5mXvxTiSRTNemQY2SaFXm7pg7/4eyiS4DZflYI+Lrhp3I9oN8V4qaBCWahCzWvu2vxciidvuGGgOzYrd8c5LjCmPgOQ3EC/LRcSU5qDNY1zO7Zq/YKVwi9WCblV7rE5PzGBLyqwgSY8yhCc7UBXtBsJsHYxKY5FNsj1xLBs6hHOvnyl9XQzuas7jD4K3MaaDFroytcpAUryEVO9qkUxDDMMd5/6wP/4t8E5xGmECSULcKtG9uL7tAuVLPPblaBRMp1I8SWFxE2kWNYWZpEJ8c5V3JhuZn5PcZiJEaUjuvA4Ek/0PDlIRvXcyw1hz4n6iQ76bhHHjmqbpwIZwV5xWrtdDdTEDiYTaZjudrJ/+kTdSln+xWK/8JJOLUj3T6q8CjoIGuz3BzyUL9sLHrJSq1adItYufpGfIZdoBdyEnO7Ovrmi/hkAwF2cznJZSigDBYKp94tID4rM5FM+NJ+eMoAXo6cdAHs3xCHKMftP7erk4iTe+LIWXs+Yc2CPrJ2dN8jJGuDtikT3EltFL5EgV1LfNBXDd79oTY1C0SbrXMVdYkVgrJQSI5eoDpIRfhEcCSRB1IwRLoc709jKQGTkLrcGXJf08DOT9KRP+ifRSaiErWGFCHT/GAmVpFRfJoMr9P5fYrRxTUVOuaCYDsmPqoPM/Nl7Vaqr7DluS+VX1fE4tfqhyhskVx8hP5q6jEpYcf05wXBfkI64tZU2GlSUhACvg0fC2lCALMT+AkkYrgLD1kWuwmUQ4R92WJfm6TV137ed0OSsqT6yQyRFd7O5Q3rSVZlsSz9qbOEv73qVD3z28wx/OIiWbEciTR+4txus+ira53Lj5PwqhmiEyNqS+rVmuEkwgmgjWHwYMlx9CAOIeK/RaEnJItfbJ0j5NP1KPG2ch2cOG1ra7PkjsLI+02UL5HmQ+Y70oze3w1Oo3+bVNMvKVvBxpIscSu7IUHGAlK6k901rB9X6SeNIRfNJmEQIL/jeBo6ug6DONC83UQQfer23FpPsdkqdb3NwXBDkN/vVW5PTcCCE+UKa2km0M2puiIcUeAYp7elXBUzwGXYti4QDNG3CoTB+f3yLq/nrnAgcPDRqWw0FJA7dXwdl6E7SG29QRI/VC4g0A3GLJKIlsMs9v/9ZeCnLxMyKRsvZhSZXrxtqKhyPyJgeWb2gfezRi6DghzGKdL2CP54uMLQbpjXUFLHgZUe1ZdmNEwioLKBekzpLGKn8vtOFZsYsmqV/xKccAxDE8QTGOqGEZCJM2WkDV3m0gHry6v+fiv8eUbw9lqpcPO4dSbzYLfU0HMkGqQcEHJHZiEbDV8ouyoMbj3HJ1ZvbM9XdUQN4ofPjWWCsPeyMMSi5AqCtszHlEen0NHcXLZCwTTZVFNr5GIVK0Yx+lK3h0ykKnNqb+/toISHrU1a6UEWNu9zRgDkZtgQ5C7n8G4i7XGouYSNmjD28g3i4FshhV4nZTot3t4Fiey0AEblj8KeEmjJTUA3Vt5usbdnpHjKJ4q27/tjM9R4oZJxu/cj5GJ8ZJaDiTU7fMFb+vas3WcdEMo/PYFz2aQkwWqGMHO5RDopQo8pWfvEZQgQ3FFRjNAXkpOKHLG8c4P+ExrIatP5Ix/BA3iZjfJ8ZTI79NE0CuLalkAed7YAMwwWePPEEdCIYv/qA74GiHtTYJqSSbhxRkSAF9vCI4yU6WnWy/nAsl9mCXP0tKKwtNkXibsDlpTkdlXtN6KzV0kpqgut/gjcZj0WBabcR0QzWggC5wSTsPyeHQHdZGLO6Ha9GvzhB95esCP6TqtoMX3N3JcWEwT5Ms9wzDBzLbyicTAONstGfC2Gcz0v501r8Gx2UnLOnm/SB9kb7QhbJyVRvObL3RYOT6aH6Vd/enteMjVnTtkrtLHtiRdpxCa2xnvzZ1HdHEynkudQT0d9Kyagy5e5Ckk7B4Iso1IDHNA1XUpi4qDGhsKVEZ/06cMIYsu4nHBOcWkO7MpPzT2NNWMLm1y9iHPu7lwCMdklocabksLKFQVQQ4QHD2jI2V2cdOwEZXL9K8zW9tvvjXCcQZrt+sFae/91djkGAz8OEQSNotvHeCGYtaGNcC0MF3E02JewNBmjiU/B6cqtylx82U4yH2qkmyGSvQdPF8DbB2ZQu23hRqq/ikkVqWndxql7tetjytQKBNMs0P5p1NyjUTiN15LOGzwopqAcnQQntyEy5XMD4SCeHxw8LTzPh+TobJa0xgtxdJfsDbVDSp4nkEsq14yfp29NlPeRDei+5qI1sJGSXvSgAf2B76Ad2tKDabttdRehWLkbKyI5APHpfwZ0S9H8IHqICrFwlWLlokvlpOVJQ0+ag/vrl9r7A/lSTeLtZxfd3XZjsEr5wkpvCT4f+2Ik0Btitsg7sf3ii4xSn4DKfqXqNzut25oWpI9Nl4GnDtqrxKShdGy8jMQ7J1r4YItSheahsDQ4N0bYAvlcM6ZVq1W+yc91pm4JuuatiWOmVRFXtdwzOXmG89MfODu2ghdRtI6f/YF4yYnsqNQit81K60Uij6YkIONzSBvSUNx7L32x1BfcnB2SvdzuB5tL3HNDN/ByWAZmy5NXIjvpByOk3BtbLPjpWbhKT/9V5Qd138kejLseeV9dq+rZiH2XprtHVBLQs1fChe7nWzi0DwRSswWbpIYWbV7z9scB3cBzscwXrjPwCJoUr0m01mTna8TSen7G92qw73bHbTGvum82NMC8zgDpPtASYRo4sI3q3dZpGbvHuaIzelJgJdC5U8RwKQxjr/Dd0ObyWvJhFOJ4rcbL3ZUGsEUG9ENBNFM8Dm4KfhknTu8xMZ7TjU23NRE/h2x3fWEmx/xmN7vfSNT5q2EvBGibdPgKi/jmohSfXvczDm2OJfy+TdenC2x/LBUoSYNmNLJoFqhUrNC2jeCjTWNO9SY0k6Z5Q4cK4FiLgn6aYVLT7nCWuzZSgKSpEUs6JruueIGDfHeRzy3Nz2DhzsA8SMlpKv+MtTM7FGlUn7HRRA3y5mXqGde5oZXECfN9+pJ+O48v1hCAzyoPb49Gq/h/2SpWVz+WJmjvZ0LkHA4uSIabcaXfefJyvXNK29JpD1fKeg76DJvw0AE+B7WqYOr9ZWqOdXRJ9DL/E3IrDGsb/lxfNrRZhJ3GRktV7OApDQiwaBXRMdyjZOgqmLYMXmC2B7D6Unphlllz5JMJJfU6yRxqBt3NZwXgKgXS9WaJxRq3NF+J+WPXELcnsJvpklCiS/3mf8i6skZWSeirZ9bzKVxueojnhw8fGrSjwtSWwPM3bCgwIK/jaK9ouHplkYJw85/iCRwZ9+gKPxx1o+lQWi0mvOi0NJ1YEuCDkpTUZRV+y06LBLj7e3ZSA+5gr0JH6LK5cnkqwSGKL8rVKMwbHWAWVm0jBnGRWctKDQxyd0byWm6RwjnlMGYr8J4gicwNOmJixsaLiPFmt38L6x08Luybn+/ko3mLXbOMsGPSI5W3DJWH9QKTrVDn2T2NAPccptdczv6AeSfDF295us1Lyy+RmKVOmB2sZutKGeWVIaUyO6gv/TKbrNNvIemBk6J87peQkz512C2yKbwaHPrAdKG9qEgPsAS9ebeJB1xaoSzPdBL6YNvb4BfVnkEwACP+zgKci/IRDXfr9ZmvVVw+G+Dl0RI3fMtIFfZ8xjP1DnLfrcHyBmR+8YXqt43DPUI1kj00rga/zR7qZNqSpuH59j6eIuimlt6dQ5nLq0UqMcAPI1/Mzrst3eWcKsywlZg7PjGnEAHcjCW+m3tTHy3TG4J60R8nUYyWUyB3IcPE+t3MdPQag5uM0y+hdDingsXpuWelkIqV8iUwT9yxP/SSRtZWvJheTER7N/5EWiJW/xDedOSl7e/BSz8a+WhlnT1lO1vGDzqQMXsh2yMpK+33/Ob7vxFF93ANbpo08u4NbU1E42j+lggHh927b3+DK0zteL2isFyMSw509WbTENDzTFNRqkiPSSKApGENWHbReq++SY7fzRN9CkB8OQmoyUXjzuOmb2qP69ED3PSCGpCmbQcqv9MmJK8bLW4KDZcFnOnbbLen9nmbaTMUuHKC8Y489U3dIttffJYlIKG7RiyCX+Cbe/ReYVqg1XqETVYyYXTWNJLVlvGD3YcPIihSWikM73aOEaeLUMv+uaDVsJbxd+migdcwTClVUkkSuqvAOx+gOeTZCsk6n9DbWwrunVLI3qA8XKcYDFwM9YT9wDlEQLdL7UAEcCj1EKFIT5GstQKUFQ9Ynm8oKvsBo3GOk7Yv4jiNWfW6dyOzFs7qNDLgg2Owx/hOPWPj76WJAVdnc50ORWuXa9fyPw6Q9K+dwij5muCOJ9ouWlgMhRYYSS/UDXFoIY6nGaQNCRHSkAl3rUSkbJYcuEwYn60yGjOjx2ZS+xbdD//vQ0UDc+ORPmBSjbhqhw8LG6SbFQhh6x1ciNkioTQXSmq3WLYjAqvi9tiadiEdW2ZYmUYb/bwNsg2nfUvlnhEyKV3U6uUfjnu6ivTp2hvJPSKVqjGJsLTqgnrlQgXbUPKUPd8PRnGJRDpD3lqlfOadghSb5SBN+NPVo72m5Cz0w8CdlsrskXEgh4gb9AJO6qyTfYK66929Cc63nYH1nXNhJORboI1uxifN4OI74hC4pcL9kt+edrPjM9049YVXNgPPffbP5I9e+ySZFnoVtEiX75gRdrZUly6rB2oUYoY+b6EWEdQZCJcG5/cwCFr9yG7W6foJ5BcDSWb0q/nmXDSvcHyUayrjnW/GktG6tgmnnZ45URtEAm6xiv1U9nXu/G9yYB7prEd+wnjOJovf/EVzfehuQVSeumPEsavHJ+mVCG8TSBXBCGd6cv9c1ttPs/9XC7u4mh7l66XI1w6dcrTh5qjVHkWmh7inxZDqzlNgtu+2NtpN1gH3mfm/8SkcVfppWBDSzIBa7bNGiuCcze8vLysslEOu0IdTOo1CrjVj1Lf3DtKeyexROWZcOBKXjoJwWFnBcqvWj559tYXY9mV3o6x4/3m2reE6HJWAj6sm7chT7t5VrKno8jKx3q8GO4aeil1a+Bwx1mHTjOG4yhY1n9WUmgh9M1Er3lYTTBnNdC04GXfeqh/b7hBrVzng6rfdwFFNjrZ5q+rOAKJV16oi5QGhwv4PLR+rmQHFlDJqXR9NPf8y9WwIy0gDGKYlzfApyIx/JNNVJCUYdm4biAJi3SxF0DWp9ClIx2aUPlAS1Q+6zEPFyScRk4d4gmuudy2NPVN06khHESiDZKbeX7fRcfj3wxfm5u1T5S5v0uBysbBwZzM+S2JSxlCJaT+g6y66hGukuTPbH3otPCjqTSsbdUePFU5l0WgHgc9Sx6X+ADSUN9TbA9OD1nte9kYTrcl3VbZ7OOINXyFGBpZ4IHkJtEc9JzbPkZUSO1h30T2ASpEABSrqvq3s6Xs9tVWiQYpYkd3SruPtEg6Eu8I2LnKfdiSBYkb2ZGDCyFOpCGuMp07uu/VJXsCIhEqHhI33cM+MTV0pTP/q7yYChr0cAKl/VFjoyy37rTTGVxjyrNvUd8jhdyffL3Kw6OYhbXkBOwcFQf02/GB3YcWDaf7nmWM2kx0yNr4l8kldwfRiUc9JW1tjrHllLPMCHq3oWF5FJn+R5+1U8FMN0oxaCHM+FGSF0t/rMg/WSq6GE7jMdY8XzJcmzOcstoJ52Kaf2jLoIUyun4VEnrODn1bQKZgd4qvjWl5RXKN38dHmWCi3pXZGPm4QxU+6bX18Uh2SVDOrCYlvZauV6sYVrTQq2DWH3bEZzekU8Nlm561A8OAJCXpNZhW/8JzKMTy4fclKHtMhOES55n5MW81QTJrH28tXQM+iURTKdjckBbqEE1/KT9ufQEu9BrEfCuapn/d2DDaI1tKpubzcpnWll9HW/fJ0HvuXP0BYUVkvmSZ5Lhk0cUAsM7rmlvED0ZmyPA11PGAE0GV1rniiCNciuTjUYQp8NTau5EmTUK/OGWbX+ZeRcKsiW9JinuNjlOHcHgfejfkrRkzr1dVvdgfej+ED6O7UJo9u21gfMpJ7DS8+X1DcibnS7A7adgJS27gwHyPArUkSl10lsUX0thTZDBoWJhDfNjm+lMo/BugRH9Hyq1V+jaWE6EViUH2itENRr/TkGm/chPxsq5bCPNLl13EmYJRcqVHzX0o90wMOMXN5iSqbDjQr4J05DJ1RTuqpgLJZW+p+IaTETy9dQOCef2RNouBQZ/rJpGCR5HtWd19kiqtp3uLccWCgZEGs9SYz9yTZHIaJDaEruRgu06Cv/brodiVNgN07ctsoB6RZrIOMZUoPpi3Efgx+3t8VkVfc+ERKR8TXe4WTf5Ydi9J+RXzsGrzhsxq3cgdQqREFPcX56X8tjtxRNgT+qjXBQJPrINh6z/HfGOqXtMhl1FqOSDUoMDqNotiITCqovzB+HKlOLoPZg02H8Xzzx7xnbO832oyQXd4BReNsQg9n8fl+shZRpVu8vvPIk6MjG430fvDIkv7u2IWH8e5WOkbaJREq+xMgF91PuO73z1GFkiwr72KbdSr+ZekIMzG39SywWXGadTH70XD0wLE0mvoNAZSOcclEV1DE9nQqRSpACunZxi3fKp5M9eykWZ42VhE2Qc5X/UV8vw5YFdUphIveWPlpJ8aZZ5nPlhrPfI7RibHzCIkrWNhfXSrF7dUzkCHqIizuUqD3jwElZkE7TJDVN5DRb3XG2TcghZGnwWN696DftbsbSR3RqUTruTTuHKmcGMOMPJSIAHmaHzdNGhynpIStbriil0kmPP6NGWV42FiUiP5XCQqOXBZiRuNZGPiuLB2dCmsylpLDbb0cO59tzYwKxobcC7r+95pWI/XpF923ayO2F1kpisXi8BpmH3oXD6xYDtVLUcc+xHuFveTMjUdYNq7EvbfJ8NqtmOjoMV1hnELP5rjx8vdug++tKjwX7Hey7w+OIrEm+E+YS5U4aBXduTm6B6ZKc7bO6XL4Ku1Ybs8JfUIibTctlgK1EWOXQxazLBkZrKaKd0jr0gwFiznHi63hfw/M+R3xW1OvOg2Qo3BqdjkSnUWyhOmwjukn5ZsqsksDVn8VsD1nqG83VD50ASV8bhiry8gPlTsPoMhBker1QDAyyhx5V8c5rVoYL++A2pfdLdoyB+NKRpAGjwmnFYuxSSZWmPLJwiSB7EYq0DyvCD3AshVvsYjjnsVIVXDkatak4Zh4enoNoUbrUiyoskOj1JbIwu/eOLhQyx+o/NicNqgZ3TsnKEcaQ7NfUUlTCX4kkZfOipJLgoFrifbYJOC101IJzLvXc+7x1mdjh7lcPLN0ZTxE2IQC3Lhx4VRrZCH7fD2wf9wiZREGVL9DPHDiD6Ws57wBRi5L88zMkRtbKb20vHjPcF2+ZkCtcrmQojMZn3+ypWs+63w13ptQYAwJFqaZVP+zRup6m+/hCAUkAgrMksD5oh599apVhiJ9tCjLz8eCpf5u2dqSjByA+bx3pI2ZVDUTdbm3JhWe1BAWTiaxB6fQfLHRiMsJyjeS8rf2SV4MlYXccZ9x/fICb+E5fbgrGtGvWtIx83lIfz6FQD7pKca8yiqCgp9+9f3vLKVfZr2ArDhduCYb1b4LvMD0Y025fT2tat1GhaSralxHRWF3C4i7LqoqgcEaBwuRsQ2H97ebIli0KnzsQeqM5E6JU266VU0vNwOojuEFfuxAFdEEFHChfqH1e/C9ESXg64qJF4kbMVcXYy1dyoI7mYbcw4zGwkIhSOR5GgyewR1kjCPbK8fG/Hja3mEmEVaveSedN8hwc1vWhEEnXzUN97B8JrZh5ggyft9iWOBcQDt/krRd8PLrWJvbjarLktmbmjsxw8oTmOJ/TruNKjalK+Dg+3gre5STt0MRhvJwHA93q88JGSzP0AsVL5G7w0ik1I4bdtJ5y4wShr/JVeEy9fqQUvxz3vt3Lswhhvu18h5q6kzyGv9/BmMHAem9SnlaZgoZ+xPabyb07E6XTt0k7uaGSPGBF+ACJ6SLC/ItrGogk6+rAvULtCL4UEKaWMhJRgv8AKu7s+JM5fdw7x3qnsOktUqXeFX4/y9TXZ3fpbj23iyyiSvM8rOB+pOqGBjJatAZBqdDvE/wlfj+YijuTD0TPWMPp4uKjMVGAM3JIMkGtVi9fiH3F1qlDObueaLcjo28X81HlQ0pYFz5R26DPTVXmrabbGH2K7e3mN9ktrval0yBgkkjsQJas/XvlpUxG1hnWk0Swa1GssyITowkPlbi77QYezy3Ac9k3EJuWmKVu3dsFAezpTP53TLICrhtUQNgPWY+m0RQnboQdAvDs5gXNrCmnyMIflnpC+p9qJgahhwdUB9vS8aCN1S5uk9O9LwpmLnHNZL9UThNLAjcD79BsoRRjqqp65qvpX6wnZp+NN6dP9uLpGG7SFoLDlptPpIunGa/0PPdAX6EGj1VVMlz3Sla3mKtbCjqf5SuVsF5jJ7WhvQo04oa5WXiPtdukhsYi9jcpMOJ20WjlKjZc8csmTcIMEuVhsp7Axukm13KD0DXZEpQ5/d0107IGGAz2b740FjKkRwvWU9cqmB6XKbCwUmyNw2EPaNo0RjC2mPQ5daLDMRtyi0rPCQqDvE4T/9WFXavS3heeO4XBUJHq1IuWJE0i8DkCVVzTnrduuVxYxOVtcBfSq9ZQnJo7d12Icp9zH/K4/1RwmeMLR2sJd1v8ljsvjevXnbh2LXMtpH1/9t5hAtEiBiqKhPhTHLF+aKqVOiSrooXUyNuvwgc1FZ9LJaJbjDKURgAg46fNrn42nscElycSuF0QJA4LfXj4EsAYAFW7oZkz/TsjyVPUXEFR5M7k+El59GsNnsWQ9uVrvbXU8EnSJgsdH3rTX0L9Zw5rYKTZthb6UR+5qrEeyOZdVEDOpp+RRKpL5F9LYWfeqkd4m/+ccaG941civMtujxVfhebKD8dGSCjN+5GdFT0ablxVJCDUJgqFn7U62TDsUZ3Xn2yhWOwEGINZoFpLkghIFKY2PC7bHxOjgHJYq13icVCkSu97e5UgGDYwQ8O80M9f6sTCXm37ZuFUv1CQe65rLm0tl24MyLupiWidzwnCp5UGtbZP9krpU/CXLjEjxt5YP2DNyFq+NIajNcQqLGD7bkOV0du6rkZOZK7ORzc5pFps67ecTcktk7WS2nCdgnryN7jfGmbxKVp9HeiLPQ+AzOSTrOTmb3ZQijXWk8FXUYw06L0qhCj8B1Y7L/q3aXgs0XFfgXCIX6tsTMDOuLK7Dq1SGQbyBUfkwroyz+8lsjjCVF/VwfNkKRnSPp9m7dM9C8r8lJ2+2YPQ2hm2OAjRIHpxs4i6+lv4vH60N1crR7dRR9RLEHvMIP6im2m/UL6M1gtztqZOug4O25KVxSK/l/1i9n4g14FnSLsO7Y2UXvVBnG468D1M4qTZLue8G9kkq/bkkZhWmUAuW+/CWMXkoLOmXk7OG5dEhdDY7ECnAtWFhYp7RnnkItxXrWLmT7H2zKmz0WSplAd2Q5DJVmBbq4dV+o6xZHa3xz7DWmxpnpm64ljhzy5SvCysvDpVzSVlXozPi6v3lPV7W1CWIiVnNrXzIEUr+hRvEO6FXbsVwxoDu4BixbTH9XTq7eRKdBtGo7MiKlReGRGyO10Z0NWshmThZ9DzdyyregtqZijia2xSCqLu8Vz6Yu/rHaiNNHys/PCEUYPDXqpA/ZyFMa9W1RMq06G3t39yjmwnFaRnwUMyu7kpJIa+Eu8rk4QidtvA5UUjZuEQpB4k46nmtnqUpJj8i9m2BkJGHl9q/I4USkVyCfU/8WUtaz7naarPw2o2Sjbm/RamI0Bxh6/Mx/k2nuxkT0OnBN2/TOT9H9fwx6PNwbiOugczxzsA6D1CTfqYLNTCiXngf0mfyhSGhkmM0n/nzeQGY7+IT/mFt6J8nGXqbocE/qyyyhCTefXSh0ipgP38pVOkezOBKGiXxQ763guQ8yMPOsiVYstaA1qsYI2BG9cNUYg/BuRG1GGSGzE90XpSZPxP+fvtTzle14iSQ87JQgBz7f7c7Z3rKP1uvfo+OlzTWy/CywlSHzl8DnVFlPnjDfgd1OLljiyyZnyHy7sJebt9W9GLXigINDfPeeJIAUQ7BAxDFW1h8vy038k6POx8n/q3OqUTmmuBRrKAPeAgn0jBcPNv5KR//ZZfhtEUilVXL6AHx17fqjDfuiMINv4hj16ILXevgWVlrZ0bBIhxdX//5rZkJ4uJCHldcPmBfGbmtEmu3Yk6M7zOK8ix6tK2367eCkbS0NssD3O/JloDSZ7GynFuH8dsvcrvOMEHdKVGGQ2PVo7pbqlSqDEegn++p7qH/XthlEQWyqNiEWm1/LR3aVwZJOl89PXYm6/5MthNiD2VV4iJu6rFr/ArNILDlaWOzio0nLGsmoGb3UNr/esUZE0u9+Fjg78VdI/JNTaXDFNPZxMcq4PFQwHfF3U67bAWLe9UwfuvajmFd0etWOQcs/WZOhBp4wM8Z7SYQr4qx/I2T4Uqc7vl/ge1yin8Tj9rPtPYsJtBjsE8Acu1DsVCChNpX/j9q9Q8Y7FZlVSUsvS8MuyGJjiH8lVcwcdlw4cxvEJGdNDpvDCyh4tP9/7ee5t+J5nHJB+/1CkaEuLnQvK/oOr1lNUzxpqdKl1PAnlR6CQTo9izi8a6N5jaf6hZz951xs1e3iJQvQ4LmgSiejSK0NbJv0CnsXWrGzoDeUCez+ipqbjI63tZK2IGQwXiwX0U/U4EvmN+/eI8h2MHkAzM2xlazJzaKeiGFOvSCAu2B0QAa/n3kOECe6M3vOsp+Vn7gSnkvntlo/Jq0nfv3sZ0st/De3gw1ncMeC1JL3kb1keWhY1McVK0Lqj+Cy/hofTwZsWUba8GzMdxYuh4fTx5l8eyBT+Xo2QCDyNonwvuXSJNhEo77Ro20qv0KqicauWjRW8GYCLzbwTACyJWCirWHcSpGVtZLKBt7aJaWbAs5dkXuf2NXT3TaFqOQJh1se+2c9aC20aVPpE/jAbsH/7dantQXIG7NpyWDCfpMGBAfBJZ5pZ4aDPOLCcRLE3FtIcd/e6Eo+lp9x+nxnq4XhEGpmL3LQU+guA2Ju48Hmrq/+eA3zIDjakSk/hpVn4Wz56XJErio5/ru8zqEqn5hXojzITM5jQXCdYYFD9fwChmKFt/pim8OvE9zW+4zJSWT6wFcu0ddL4x+W7K3YBiqUgRYADLAzGktSCsuEC8IwPbCBwHM+UxJF2FgG6IqSoCRCAXYwHmmZH2FBqQQFACJF6FZaf7U8BrDUWgB2sIQFq4RX04QXx4nhpvLJcUZ4vTxWg+qnLrRtJQVCCYkNQsfFoOFkIJ18IKAR0AnIq1hx4Q+ETMrHJ9sq7ftjJlOypRBVqkFCHLnSjE/1o1nCb1hw0ZJpGzAeHMcQES2yxxwlX9BEgEg988MUYNrDNrIxZnHXZhC3Ylmf85gNLl/jjtnby4ebhV1zbjWdxSVklFR19QzMbl1wd7GBqZpwJppz/PCfb/rdlehORP1acXGXptWbD1h3bPt1Y9L59WQOWCwgaFgOLiJQfJ5cOzsPbbG9a5hs/WOfqVkUIr0RiLtayS6JCorKVt12w//asvaioPtVQU3XVg570pXO96X+0gay8EVPnlS3NK2c+AYJHTpZLwOQ5d2Sv/T/+OkUtOnbps/bdX+Wu+ipTr0fvQmEUuwpSr1SJuq8eqVeqsyguqopW0AFjMANrCAYHCV4AGajwBpphDP7COKxoXi2rdbSlttYR2um3moGAITfKoiaaoz1eRcAH+BSL8BqSsduwGhNjaQ6YPeaAUeZDyV3JVeqVJ/VSKH0jGrVRNwuxIZuyA79nCn/iHrGW3bJTDkslN+SllMtPWZBVi7N8Vs6aWjf72r60HXbQTtTq9QnX6U65X+FQKMP3mBlzY0WkxqaEJpbklVzuyqpZL1tkQj6bgSaJCcQ04o9i1Fo40xXL7LowkZlGmkknSAUxrazSDI1ONgdmNs/Fi9cuflnl1dzDsUmxMW4uLjvOxMW4u7g/hz/503B3woOE/YSLhPuEF+tssM0uexxwxFFnZD56tXdMPJFYkLiZ1L6MW97OJjMGOUNSyG9A4TCE51b5SEEtPpcxZTMl0GAaSiNoBcvYE/vO6lgD62S/OQiK2BR74kDci0fRI0bEjFiVqFJSp9QFla6+qlG1VFdgP57AeCxGi7t4iW+xA7txAIeRrjGaXfNpCS2rbfVdfa2/6+3GtqE1bU2HK3cn7r+X8Do+0c/6ec8IxsE2OISQUBhceBMmw0rYiRAFo1P0jAExKC4lYopNaSml9eTs9uXSjbOr1tXbzcPd2/1A+QGzkcnFlGQyAeCBeungUpyr/tDlotCT3Y47EHPvtEBtvR3yledk8c/Y/yuFc2+Lq+T9dOGaLyu+wJV57Hl55MFgzfyd/OdzR4L10J2nyuo3QzvDRIUH9UQHuZiedD/4vmtKoe73/RLcx4G9nX56f+X/gXUMbO36Nm0gEv/98TN/MlvMnEmMDY71jHWNFSNK/9L7B18O/LUfbx+0nZ/uvfLSCw89cMNls5P22tRKFjKo2tCy5jSunxpVt9pVp++i6q6dKKitlnoqKqesUkooKofEhcnGfJPMYvZTkvOkoF/h5cuWLFa0cFaayYWPq8/eXHWs94cfVHxej9Oellqq0Mw7PpfNYsAU8YFHAgH44eGTDx65RZi55+Nu9Pex9D9+/bYyvLgVnHlWeGf/JzKZVCaZ7phNZO3qfVX5OCa9JHwUmdyTa8KS3FLPmdKnS5LxjIWe9zlz+PNnv/Tp3YtnhzrIXlazioXFUKFJTei/htWq9zr67yO9t3e3Xqs1XwMD1rOO1Xx5cXAvjahLZfJgxoQMfzCCNrSgDu/wYMOKCV5wx9H7yj2KUIdKtfAlUsLF10H/e+i2q8vKy26UZZWdLKMyKGvtW6PRaulj6T3yP80qyEfJO8nbyZtJ4lUOLm7wH7vYzLe88sgDp6xzSSUT9FABO7iDFcYYoIEtBjAIwRIKkIUQeMARXUGJWqxiGIPoRi52d5DuRh1p7A2XQ09g8XN+1k/6Ci8986Ne3St4Frfgsl3lcjfnAp2r2+907KwdtYOWZr/ZZ3bDLtsuK2/ZLJhF89QMNbTmVKOKt3AOdWr/2qe2qs1rOTWhxtVltSQ7ZKP8Il/LXbkuGzEjzglOwSJQvsDp/Cv/xDu4EEfYNRbYFMNRGrWiltSU8lEuiqnaqivVTGVRTpfjZXN5pVwqyAUWVQFFXyGXb+dbOQNGIRbOQjSEQiAEgD94ghu4gjM4gD3sAT2QBHbyi9SRh8SQTmKQWS47LB9cavp3id2Jlq46KO503OW44VjaxsVs8Y+//IZC+tT5JEkSJE7KSCMkV+IL4jFxn7hHXCeuESkxI44SI4lPcClv3F8+dvZZn4//7TjVhg2p98oTFOXIbrnpQvCBwrVwKcxk9KMbpWfcYe61e+VeyoT0SJ6clovSxhS+zaXsy7t5J88yG2Opi6h0n8qolHLJlnbTVvJqW6qPCzpRmlGKUfxRPJEj8xaRouE7s33Ta5MDk0FqHq1En6ClgMBgHGleO3RU6dsor+VyHMVSTe2v0FdN/6aGhbsxTbFULGETBQzBfLdFI41p1EuQFWYFGsbj2VEEIcNkPr7fvqN4gOUKbSgT5/DvFwyxQlsiDNA5/NBXnzH9UdrRf1I4T+wD47gZgs4pIW0ojbJdyODKYz0lhynfhz8NmTsocBpLnUbcxVgqYciwGAA1DYZgWUjig/xD7PccPqoQYbEFjULs+gMSyKjIx8zgvgf3mQoBMC9fc9DQvik4AOYNAPBANaCAYNkB4DnAWiAgBc8Bc+9sFyiUAF1gQRM5JXAghJAFC6gjVMEGPMhgOjsIDrBG/gtOOIJRPuQCZQyf4IbrmKu3yQPGqDbshZNwCmLgDERCOETAOcCDKgSDGuBBH3RBH/RBE/Cf64SryGk1po3GnUycaNVUg8npvLEySWlNjBCXbyhRr5u7HQPKrATXIygOsMtD63P5kKsoR3W3IchvsLTLsOWI0k3KE5NbcKKzCqYIl8G9gvJ0+asCKkt33QgH4sa6Js2QgnWQcYno2m3GLGeUMWhI64mEw6tu+23GZWZzdVY0IsbUfmXe5AALofYVjRpe8zIRLVorhzmPWogHyHeoVMYjouwTtttnP+lOyISOSvbJOKdrPdIn8O4TsVMhGQkDJ96cLcXEgOMT1daNwAzZplPKKsMwtDWTaS2zHRKMhEMgruylUcIwqkE4ayaBTDXRjRgWcdRTPoYGU2cnmRhwQkapnQpvGA5oLvslNK2RPIe5acr5FSyVabg16xkDRLnQw+jhrznCIJrFD8dI0Rwa6jSXCLzJz7EEJm+8hwgS2/bkyyKZU0YZe7qeaQp+B8Vj3rv+a4Zxk/n/XUNgMMe8z+UAAAAA';
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
