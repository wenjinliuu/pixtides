/*
 * PixTides 设计稿共享引擎（proto-engine.js）
 * 只服务于 design/ 下的原型页面，不是 V0 的 packages/engine。
 *
 * 模型：场景 + 参数 + 种子 → 半格网格（2G）上的色阶编号矩阵 cells。
 * 预览、动画、PNG、SVG 都从同一个 cells 出图。
 * 动画只改格子的色阶编号：边界游走数组平移、单格起伏、散落方块熄灭重现、光点相位切换。
 */
(function (global) {
  'use strict';

  // ---------- 随机数 ----------
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
  // 早 / 晚变体：亮部偏暖、暗部偏紫，晚上整体压暗
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
    return hex;
  }
  // 界面配色：从当前画面最深色阶推出深底
  function uiTokens(pal) {
    let darkest = pal[0], lightest = pal[0];
    for (const h of pal) {
      if (hexToOklch(h)[0] < hexToOklch(darkest)[0]) darkest = h;
      if (hexToOklch(h)[0] > hexToOklch(lightest)[0]) lightest = h;
    }
    const d = hexToOklch(darkest), hue = d[2], chroma = Math.min(d[1] * 0.45, 0.045);
    const li = hexToOklch(lightest);
    return {
      bg: oklchToHex([0.14, chroma, hue]),
      panel: oklchToHex([0.18, chroma, hue]),
      raise: oklchToHex([0.235, chroma * 1.1, hue]),
      line: oklchToHex([0.34, chroma * 1.2, hue]),
      muted: oklchToHex([0.72, chroma * 0.8, hue]),
      fg: oklchToHex([0.96, Math.min(chroma, 0.02), hue]),
      accent: oklchToHex([Math.max(0.82, li[0]), Math.min(li[1], 0.14), li[2]]),
      ink: oklchToHex([0.14, chroma, hue]),
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

  // 首页浅滩的四个时段色板（深 → 浅，均 6 阶）
  const SHOAL_TIMES = {
    dawn: ramp(['#1A1C8C', '#4B63E6', '#9DC2F7', '#FFD6C4'], 6),
    day: byId.shoal.pal.slice(),
    dusk: ramp(['#2B0C7A', '#7A2FC4', '#F0609A', '#FFB47E'], 6),
    night: ramp(['#010226', '#061070', '#1638B8', '#4A90E2'], 6),
  };
  // 时段边界（本地时间）：晨 5–9 点，昼 10–16 点，昏 17–19 点，夜 20–次日 4 点
  function timeOfDay(date) {
    const h = (date || new Date()).getHours();
    if (h >= 5 && h < 10) return 'dawn';
    if (h >= 10 && h < 17) return 'day';
    if (h >= 17 && h < 20) return 'dusk';
    return 'night';
  }

  // ---------- 生成 ----------
  const DEFAULTS = {
    grid: 32, ratio: [1, 1], seed: 1, angle: null, amp: null, terrace: 1, bands: null,
    dots: null, dotMax: 5, pair: 0.22, invert: false, hue: 0, variant: 'base',
    silhouette: true, silSeed: 0, palette: null,
  };

  function scenePalette(scene, o) {
    const n = o.bands || scene.steps;
    let pal = o.palette ? o.palette.slice()
      : scene.pal && n === scene.pal.length ? scene.pal.slice()
      : ramp(scene.pal || scene.anchors, n);
    if (o.variant && o.variant !== 'base') pal = pal.map((h) => variantColor(h, o.variant));
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
      Object.assign(this, { G, W, H, S, t: 0 });
      const rnd = mulberry32((o.seed ^ hashStr(scene.id)) >>> 0);
      this.rnd = rnd;
      this.mrnd = mulberry32((Math.imul(o.seed, 7919) + 13) >>> 0);
      const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

      // 色板：色带 + 光点 + 月亮
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
      const step = (this.unit = 1 / G);
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

      // 色带边界：随机游走阶梯
      const flow = scene.motion === 'flow';
      const gdir = rnd() < 0.5 ? -1 : 1;
      this.bounds = [];
      const nb = radial ? L + 3 : L - 1;
      for (let k = 0; k < nb; k++) {
        const b = {
          base: radial ? 0 : -extV + (k + 1) * gap + (rnd() - 0.5) * gap * 0.3,
          jit: (rnd() - 0.5) * 0.3,
          maxA: gap * 0.95 * amp + 1e-6,
          w: 0, left: 0, acc: rnd(),
          dir: flow ? -1 : rnd() < 0.8 ? gdir : -gdir,
          speed: flow ? 2.4 + rnd() * 1.6 : 0.35 + rnd() * 1.25,
          buf: new Float32Array(ncol),
          bump: new Float32Array(ncol),
        };
        b.w = (rnd() * 2 - 1) * b.maxA * 0.5;
        b.left = ri(this.run[0], this.run[1]);
        // 生成端在哪一侧，就从哪一侧开始填，平移时新值与旧值连续
        if (b.dir > 0) for (let j = 0; j < ncol; j++) b.buf[j] = this._next(b, rnd);
        else for (let j = ncol - 1; j >= 0; j--) b.buf[j] = this._next(b, rnd);
        if (radial) { // 径向闭合：首尾相接
          const d = b.buf[ncol - 1] - b.buf[0];
          for (let j = 0; j < ncol; j++) b.buf[j] = Math.round((b.buf[j] - (d * j) / ncol) / (step / 2)) * (step / 2);
        }
        this.bounds.push(b);
      }
      this.p = 0; // 径向外扩的相位（以圈距为单位）
      this.rspeed = 0.12 + rnd() * 0.06;

      this.layer = new Uint8Array(n);
      this.cells = new Uint8Array(n);
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
      for (let i = 0; i < nd; i++) {
        const r = rnd(), sz0 = r < 0.55 ? 2 : r < 0.82 ? 3 : r < 0.95 ? 4 : 5;
        const sz = Math.max(1, Math.min(o.dotMax, sz0));
        const w = sz + (rnd() < 0.12 ? 1 : 0), h = sz;
        const x0 = ri(-1, W - 2), y0 = ri(-1, H - 2);
        const col = this._dotColor(this._layerAt(x0, y0), rnd);
        this.dots.push({ x: x0, y: y0, w, h, col, off: 0 });
        if (rnd() < o.pair) { // 对角相连的一对
          const dx = rnd() < 0.5 ? w : -w, dy = rnd() < 0.5 ? h : -h;
          this.dots.push({ x: x0 + dx, y: y0 + dy, w, h, col: rnd() < 0.6 ? col : this._dotColor(this._layerAt(x0, y0), rnd), off: 0 });
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

      this.compute();
    }

    _next(b, rnd) {
      if (b.left <= 0) {
        const ri = (a, z) => a + Math.floor(rnd() * (z - a + 1));
        let jump = (rnd() < 0.5 ? -1 : 1) * ri(1, 3) * this.unit * (rnd() < 0.2 ? 0.5 : 1);
        if (Math.abs(b.w + jump) > b.maxA) { jump = -jump; if (Math.abs(b.w + jump) > b.maxA) jump = 0; }
        b.w += jump;
        b.left = ri(this.run[0], this.run[1]);
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
    _layerAt(x, y) {
      x = Math.max(0, Math.min(this.W - 1, x)); y = Math.max(0, Math.min(this.H - 1, y));
      return this.layer[y * this.W + x];
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

    // 合成一帧：色带 → 补丁 → 散落方块 → 光点 → 月亮
    compute() {
      const { W, H, L, layer, cells } = this;
      this._layers();
      cells.set(layer);
      const pc = this.patches.map((p) => Math.max(0, Math.min(L - 1, this._layerAt(p.x0, p.y0) + p.d)));
      this.patches.forEach((p, k) => {
        for (let y = p.y0; y < Math.min(H, p.y0 + p.h); y++) for (let x = p.x0; x < Math.min(W, p.x0 + p.w); x++) cells[y * W + x] = pc[k];
      });
      for (const d of this.dots) {
        if (d.off > 0) continue;
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
    }

    // 推进 dt 秒
    step(dt) {
      const rnd = this.mrnd;
      this.t += dt;
      if (this.radial) this.p += this.rspeed * dt;
      else {
        for (const b of this.bounds) {
          b.acc += b.speed * dt;
          while (b.acc >= 1) {
            b.acc -= 1;
            const n = b.buf.length;
            if (b.dir > 0) { b.buf.copyWithin(0, 1); b.buf[n - 1] = this._next(b, rnd); }
            else { b.buf.copyWithin(1, 0); b.buf[0] = this._next(b, rnd); }
          }
        }
        // 单格起伏：小概率让某条边界的 1–3 列抬起或压下一格
        this._bumps = this._bumps || [];
        const rate = (0.5 + 0.3 * this.bounds.length) * (this.ncol / 40);
        if (rnd() < rate * dt) {
          const b = this.bounds[Math.floor(rnd() * this.bounds.length)];
          const c0 = Math.floor(rnd() * this.ncol), w = 1 + Math.floor(rnd() * 3), d = (rnd() < 0.5 ? -1 : 1) * this.unit;
          for (let j = c0; j < Math.min(this.ncol, c0 + w); j++) b.bump[j] += d;
          this._bumps.push({ b, c0, w, d, ttl: 0.4 + rnd() * 1.2 });
        }
        this._bumps = this._bumps.filter((e) => {
          e.ttl -= dt;
          if (e.ttl > 0) return true;
          for (let j = e.c0; j < Math.min(this.ncol, e.c0 + e.w); j++) e.b.bump[j] -= e.d;
          return false;
        });
      }
      // 散落方块偶尔熄灭，再在附近半格处出现
      const nd = this.dots.length;
      if (nd && rnd() < Math.min(3, nd * 0.03) * dt) {
        const d = this.dots[Math.floor(rnd() * nd)];
        if (d.off <= 0) d.off = 0.5 + rnd() * 1.5;
      }
      for (const d of this.dots) {
        if (d.off > 0) {
          d.off -= dt;
          if (d.off <= 0) {
            let dx = 0, dy = 0;
            while (!dx && !dy) { dx = Math.floor(rnd() * 5) - 2; dy = Math.floor(rnd() * 5) - 2; }
            d.x = Math.max(-1, Math.min(this.W - 2, d.x + dx));
            d.y = Math.max(-1, Math.min(this.H - 2, d.y + dy));
            this._layers();
            d.col = this._dotColor(this._layerAt(d.x, d.y), rnd);
          }
        }
      }
      this.compute();
    }

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

  // 每格对齐到整数像素：第 x 列占 round(x·f) 到 round((x+1)·f)
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

  function toCanvas(sim, w, h, shape) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    paint(ctx, sim, w, h);
    if (shape && shape !== 'square') {
      for (let y = 0; y < h; y++) {
        const sp = rowSpan(shape, y, w, h);
        if (!sp) { ctx.clearRect(0, y, w, 1); continue; }
        if (sp[0] > 0) ctx.clearRect(0, y, sp[0], 1);
        if (sp[1] < w) ctx.clearRect(sp[1], y, w - sp[1], 1);
      }
    }
    return cv;
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
  // 设计稿只编码场景码 + 种子；V0 再把全部参数和引擎版本号打包进去
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function b32(n, len) {
    let s = '';
    n = n >>> 0;
    do { s = B32[n % 32] + s; n = Math.floor(n / 32); } while (n);
    return s.padStart(len, '0');
  }
  // 显示用：大写、分组，例如 SH-7KQ-9ZT
  function shortCode(scene, seed) {
    const body = b32(seed, 6);
    return (scene.code || 'px').toUpperCase() + '-' + body.slice(0, 3) + '-' + body.slice(3);
  }
  // 解析：忽略大小写、连字符和空格；O 当 0，I / L 当 1
  function parseCode(str) {
    const raw = String(str).toUpperCase().replace(/[\s-]/g, '');
    const scene = SCENES.find((x) => x.code.toUpperCase() === raw.slice(0, 2));
    if (!scene) return null;
    const body = raw.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!body || /[^0-9A-HJKMNP-TV-Z]/.test(body)) return null;
    let n = 0;
    for (const ch of body) n = n * 32 + B32.indexOf(ch);
    return n > 0xffffffff ? null : { scene, seed: n >>> 0 };
  }
  function dateSeed(d) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { key, seed: hashStr('pixtides:' + key) };
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
    create, View, paint, toCanvas, toSVG, TIERS, exportSize, shortCode, parseCode, dateSeed, hashStr, mulberry32,
  };
})(typeof window !== 'undefined' ? window : globalThis);
