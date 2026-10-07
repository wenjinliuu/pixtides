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
  // 晨 / 昏：冷暖对比才像真实的日出日落——暗部（深水、阴影）保留蓝紫，中间调转玫瑰色，
  // 只有最亮的一两阶是杏色 / 橘色，金色收得很窄。kd / kl 是暗部 / 亮部向天色靠拢的程度。
  // 夜：深海军蓝 → 灰蓝 → 月光下的冷灰蓝，整体压暗、降饱和。
  // 往天色转时一律走"色相增大"的方向（蓝 → 紫 → 玫瑰 → 橘），只有目标就在身后一点点时才往回转
  const hueToward = (h1, h2, t) => { let dh = (((h2 - h1) % 360) + 360) % 360; if (dh > 300) dh -= 360; return (h1 + dh * t + 360) % 360; };
  const SKY = {
    dawn: { kd: 0.45, kl: 0.85, stops: [[0.32, 0.06, 255], [0.55, 0.07, 280], [0.74, 0.07, 320], [0.87, 0.06, 10], [0.95, 0.045, 55]] }, // 玫瑰晨光
    dusk: { kd: 0.45, kl: 0.92, stops: [[0.20, 0.11, 270], [0.36, 0.13, 300], [0.52, 0.16, 345], [0.68, 0.16, 32], [0.82, 0.14, 55]] }, // 橘粉余晖：比晨更暗、更饱和，亮端是橘色
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
      return oklchToHex([c[0] + (tg[0] - c[0]) * k, c[1] + (tg[1] - c[1]) * k, hueToward(c[2], tg[2], k)]);
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
    dawn: variantPalette(byId.shoal.pal, 'dawn'),
    day: byId.shoal.pal.slice(),
    dusk: variantPalette(byId.shoal.pal, 'dusk'),
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
  // 规则 v1：先规范化文字，再算 SHA-256('pixtides/v1/<类型>/<文字>')，只取前 4 字节做构图种子。
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
    return { seed: H[0] >>> 0 };
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
    rareOf, findRare, RARE_ODDS, hashStr, mulberry32, sha256,
  };
})(typeof window !== 'undefined' ? window : globalThis);
