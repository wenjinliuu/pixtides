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

  // ---------- 晨 / 昏 / 夜：每个画面一整套按自然景象设计的色板 ----------
  // 不是把昼的颜色拉色相，而是照真实的那个时刻重新配色；锚点顺序与昼一致（渐变起点 → 终点）。
  // glints 是这个时刻才有的"反光 / 发光"颜色：日落时水面上的金橘色碎光、夜里深海的蓝色荧光、晨雾里的淡粉光，
  // 会替换一部分散落方块，并用作光点。
  const TIMES = {
    shoal: {
      dawn: { a: ['#1F2A6B', '#5B6FB0', '#C7A6C9', '#F6D3C2'], glints: ['#FFE7D6', '#FFC9C9'] },
      dusk: { a: ['#1B1446', '#5A2A6E', '#C4506A', '#F59E5B', '#FFD58A'], glints: ['#FFE08A', '#FFB347'] },
      night: { a: ['#030616', '#0B1A3A', '#1F3A66', '#5C7FA8'], glints: ['#E8F0FF', '#AFC8F0'] },
    },
    swell: {
      dawn: { a: ['#23305E', '#6C7BB4', '#D2A9C4', '#FBE0CC'], glints: ['#FFEADF', '#FFD0D6'] },
      dusk: { a: ['#10203F', '#3B2C64', '#B4486A', '#F4884E', '#FFD27A'], glints: ['#FFE39A', '#FF9F4A'] },
      night: { a: ['#02050F', '#0A1B33', '#1D4060', '#6A90B0'], glints: ['#EAF3FF', '#9FC2E6'] },
    },
    tide: {
      dawn: { a: ['#2A3366', '#7486BE', '#E0B3C5', '#FFE8D2'], glints: ['#FFF1E6', '#FFCFD2'] },
      dusk: { a: ['#1A1240', '#4E2A72', '#D0566F', '#F7A15F', '#FFE0A0'], glints: ['#FFE9A8', '#FFB05A'] },
      night: { a: ['#030716', '#0E2240', '#27507A', '#8FB0D0'], glints: ['#F0F6FF', '#B5CDEB'] },
    },
    abyss: { // 起点是水面
      dawn: { a: ['#F4CDBF', '#8D84B8', '#2D3268', '#0B0E26'], glints: ['#FFE3D6', '#C9B8F0', '#FFF4EC'] },
      dusk: { a: ['#F2A06A', '#8C3F6E', '#2A1446', '#0A0618'], glints: ['#FFD58A', '#FF9E6E', '#FFF0C8'] },
      night: { a: ['#3A5C86', '#12244A', '#050B1E', '#010208'], glints: ['#7FE0FF', '#B8F4FF', '#5AA8FF'] }, // 深海荧光
    },
    reef: {
      dawn: { a: ['#5E86B0', '#9FC3C8', '#F2B9B4', '#FFD9C2'], glints: ['#FFF1E0', '#FFC2C8'] },
      dusk: { a: ['#2C4F7A', '#B0607A', '#F2945E', '#FFC98A'], glints: ['#FFE6A0', '#FF8A6A', '#FFFFFF'] },
      night: { a: ['#06223A', '#0D4A5C', '#3A3F6E', '#7A5A8A'], glints: ['#6FF2E0', '#B8FFF4', '#9AA8FF'] },
    },
    moonsea: { // 本身是月夜；晨 / 昏是月亮还挂着的天色
      dawn: { a: ['#2B2F5E', '#7A6FA6', '#E7B8C0', '#FFE3CF'], glints: ['#FFF3EA'] },
      dusk: { a: ['#1C1240', '#6B2F6E', '#E0706A', '#FFC48A'], glints: ['#FFE2A6'] },
      night: { a: ['#01020F', '#0B1440', '#3A5490', '#A8B8E0'], glints: ['#F2F6FF'] },
    },
    icelake: { // 起点是中心
      dawn: { a: ['#FFF1EA', '#E7C3D6', '#9C9AC8', '#4A5A96'], glints: ['#FFFFFF', '#FFE0E6'] },
      dusk: { a: ['#FFE2B8', '#F2A08A', '#A0588A', '#3A2A6A'], glints: ['#FFF4D6', '#FFC07A'] },
      night: { a: ['#C9D8F0', '#6F8DB8', '#2A3E70', '#0C1430'], glints: ['#FFFFFF', '#D8E8FF'] },
    },
    ripple: {
      dawn: { a: ['#FFE9DE', '#D7A9C8', '#6F6FB0', '#1E2460'], glints: ['#FFF6F0', '#FFD3DA'] },
      dusk: { a: ['#FFE0A0', '#F2865E', '#A0386E', '#241046'], glints: ['#FFF0C0', '#FFB060'] },
      night: { a: ['#B8D4F0', '#3A64A0', '#10204A', '#02040F'], glints: ['#FFFFFF', '#CFE2FF'] },
    },
    waterfall: {
      dawn: { a: ['#262E66', '#7C88C0', '#EBC4D0', '#FFF0E6'], glints: ['#FFFFFF', '#FFDDE4'] },
      dusk: { a: ['#1A1340', '#7A3470', '#F08A62', '#FFE2B0'], glints: ['#FFF0C8', '#FFB070'] },
      night: { a: ['#020616', '#142C55', '#4D74A8', '#C8D8F0'], glints: ['#FFFFFF', '#DCE8FF'] },
    },
  };
  for (const id in TIMES) byId[id].times = TIMES[id];

  // 首页浅滩的四个时段色板（与编辑器同一套）
  const SHOAL_TIMES = {
    dawn: ramp(TIMES.shoal.dawn.a, 6),
    day: byId.shoal.pal.slice(),
    dusk: ramp(TIMES.shoal.dusk.a, 6),
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
    else if (v !== 'day' && scene.times && scene.times[v]) pal = ramp(scene.times[v].a, n);
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
        const gr = mulberry32((seed ^ hashStr('glint/' + vkey)) >>> 0);
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
