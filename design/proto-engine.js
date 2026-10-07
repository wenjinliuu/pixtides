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

  // 导出分辨率：长边 1920/2560/3840/5120/7680；1:1 按 DESIGN.md 用 1080/2048/4096/(5120)/8192
  const TIERS = [
    { id: '1080p', long: 1920, square: 1080 },
    { id: '2K', long: 2560, square: 2048 },
    { id: '4K', long: 3840, square: 4096 },
    { id: '5K', long: 5120, square: 5120 },
    { id: '8K', long: 7680, square: 8192 },
  ];
  function exportSize(tierId, ratio) {
    const t = TIERS.find((x) => x.id === tierId) || TIERS[0];
    const [a, b] = ratio;
    if (a === b) return [t.square, t.square];
    const even = (v) => Math.round(v / 2) * 2;
    return a > b ? [t.long, even((t.long * b) / a)] : [even((t.long * a) / b), t.long];
  }

  // ---------- 编号（设计稿示意：场景码 + base62 种子） ----------
  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function shortCode(scene, seed) {
    let n = seed >>> 0, s = '';
    do { s = B62[n % 62] + s; n = Math.floor(n / 62); } while (n);
    return (scene.code || 'px') + '-' + s.padStart(6, '0');
  }
  function dateSeed(d) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { key, seed: hashStr('pixtides:' + key) };
  }

  // ---------- 字体 ----------
  // 中文像素字体：Fusion Pixel 12px 比例 zh_hans 的子集（OFL-1.1）。
  // Fusion Pixel 声明了保留字体名，子集属于修改版，因此改名为 "PixTides Pixel" 后内嵌。
  const FONT_B64 = 'd09GMk9UVE8AAEoIAAsAAAAA9twAAEm6AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAADYO1RwZgAJlsATYCJAOKDAQGBYgSByAXJBiIQhsW9gfYdJw9rUA9wbybZlfuyWchsHGAIGJYMSuCjQMAlHi57P//hORiyOLIAZ7mav0XFRfDxUYUSJhJqmCZdBJEE3OGLQhNNn8H5yCY1z2N7neZ5SYqImp0u6RMoqJR56o3Pt9TUjZ5bGbRtTpkQmQZ35S7Kv1sNDHbEFs2MewE0isJlQb9mmr834j/QfeGhUN8QY847OF+7QxwFyEUturhn37s2z33va8S15Jq0ozHhfyHRoYkJlWrSglEZiMmbU0G4Jz973DC/pawBW5RazWoBQ1sTv4Dteq1Lerosgeu5T1vTZU4b5EBwUCfrrI+Gil2uy9JLPCQY8gogwSiqFvZ+0BgRujd5VrOvFIVyh5wiDaby1GBhSyrCsVvDmMa6Pzxg2ZccmXdeejcwh2/AweTEO2WYnTgdGQ5ZQFOzz29+ymKvhW05korPjKmJ2R4EdiJBgze5NkGN9ukhULmTIUw9wUcCzVZRjfsfwtwk/D53vNJT2NrLX2/YLBgMJhpkz5I7UQXL8LiR/jxIixewo9Xq+W8flpxuc2RJRRH17hSx6PRFp6nnfoffkAt6rIB7ZJxhjr4wOkrvQt6l3TBQptJsJzJTrbTofoDu2Oh/qIx/f+3tDQtsNkjYPZw5EjOHEpBaDvSEgbNd99/96gKhdKgUAWLJDhre2ntW73/CxyA5OgAIDmH7O4ZrXvqcFuCzFniJHAYOYj2IAh8336t7v47T4hGOytJ9HWsNPr/s9zc7CCmjQvN/HW0BUojBnL4kEih0QtqpjvJ7pqQuGulPL5M/ubb+jOrCYMQQsQhWl7v9rnbMdQ0c/c/jbOWrY0kkGDfwQFy+yOb/v9z2/7uM/lrsTIKJViIHE3gQtEiHT9vX0ueLb5VnZKS7e/Bnu0X1iKa5CWrD7orjJZKmiU3d5UAe8cr1rEcSiijgipUaTpAlyFTINbsQbjy5CtQCAQMgkixSGhYuIRSZMhRoEiZKnWatOnSR+wIqUmzFq2CYCgcicbiiWQqnZmVXSBBhgIVVNHkALoYYgoIa+yB4IonvgQSAgIMBCKJhQQNFlyEpJBBDgWUU009XfQh5ghSJpllkVUgMCg4JDQsPCIyKjoWWGHDOOWCK1a1tnWsb2Ob29K2drSz3e3tQIcYYYwJjjXJNLPMtdApznCOD7vEFa7xoJUxxpnwxCc9+SlPfdozHmSIYUYYZYwJJplimhlmMZs5ABCORKMFEANMsMAKO5xwwQMfAoARBho8EcSQAB02PESkkkkuMDg0PDI6Nj4xUpSo0aLHCBgcGh4ZHRufmJyanjlr9nOphO141GnToc+YOUuOnLnz5i9YKBQcongUbDwiqTLlguFoPJnO5otJySmpaekZgeFoPJnO5ovlar1Vm7lpdVNJI0AGmWSRVXa55JFPAYWFLby4yNFjx0tUarnB4dHxyenZ+cVKVahSo06DwNDYxIycgpKKmoaWWov8h8Dc0jrq0Y5O9GMcy9jGMc5xj3/gwSY8UYkLOfSwI0hy0pMdMGjoyNHjJ5ZUcimlllZ6mQQNGTZi1LgJk6ZMmzHLbAW8KAZLFTUECNRAE8Ha6CBUN30NNESURKONlyLDRPkmmWaWeRIyCio6ho2bNm/Zum37jkUkZBRUNHQMTCxsnLnxUIhypbrq1a5O9Wtc81rWto51rnu9G9zQooorsdGNL6WMJpbfpKY1q3lFSpSpUKVGnYYbb7r5lttuv+MipStWrVm3YdOWbTt22e0C2xmzVmU1FrDANVizPU8aAPx36CNMKONCKm1srgTQR5hQxoVU2thcGaCPMKGMC6m0sbkKQB9hQhkXUmljc1WAPsKEMi6k0sbmagB9hAllXEilTbYF8NjDL7RnLHkaSdM8u0Q/BtA/9NWFs1FBe7lfKEIqcxdtUOX57NRACRdycdUma9uH7qxz2rN0utJPORQfHOTh0c6LLgSLoisE9rMTvEhj5s3uo34DaoEvkmpMqz5BdsVnlYfu1qGJoUkaF7eGghmChR8u5YNiMeTbR0MIrDYVPAfNMqJ6IgYXQoXSjEgUhHgRl/77PPSMTjq9YMnLXj8Q02jCwHa3Rwsi/yDHe2rad0byvUSLqgtTLFS3YqBy/xAoYZsXRy9xBY13Z74Ls7IHKp3qfFOEUFx1SQnY5CiduILWnDuGloY7Ij4kL256RxOnNgwOHbIY/hIlw00As9/PfVkg5KssRlL8ErwIGJvf9vTh+i672yQ6UPgAReSbJNGvwDAOYjLTNIgCINnT3BECOwKlkIXBpUEIDTwJI5uapjNJn5UAqUB/Urq9HemU/TJfuRdok38MhRb2Vp0XXahuMtwO0dPXBUzeVnXouugLH4tNUZ2qwi5X1vVvXlETyah7dRgk9NZK84x0N3A6NODxG8pVEdFmKnjW7uFXC1MXA+pwUIddjVKRpwGz+q+350eMqfVR/0RN4rWkfKs+jMPaaFoFir7riIek98XPPiyiQxMz3In7cvjQ8BtAgBxR1zKFy3TXBhbXjcN2Pz+FrgEiOv9VGDrb1wmlP7SvUZQauZFHwdJIPhmDopA0weN7CFVwI1GomDoznuPBzaCyMYw5YLSrfWgBUKZL82r+yf9kcWVJh6eWD9ewdrecQLFn9XvnMNeQ+LKq1uaD/1Kg+5ZDl+Z7v/S07yc7VPLjraCH0+9uHDdRHPu3L/+PaVwtfKD9VjC6R6O/VT4T21yWfkwAr0SaFSnQMsLO92feQP78RhADGS7FjJ82NgQuSWezVxXMoNnhGjYAIghK1sebQE73PP56wbkYL0Mwf3U2dqrjUBJpmO8GV+MrAeJH6+fNh9fTP2a+T3FDRKLSH25idapwJnrrjbTxbRY0dMzxWHlyApXdHbhD/RnzoVM91Xy1p3Jy5owPGnjT9f8HNNNjJ0iBC/mgji42qP1iV8NNNMnlPulsnHkhniKqfK+j8a/si7/S1+0a7ucbcY/dvzyFmENxU8vfEx49PKzso1eNanave7mRy92y3T5vT+mzfA5nH8iBHeHJO+Lpn/t7GveNenPexLt/8+9ovQ/z5X+J7/j1/+Vv8XP+6r/83+Oz32Q/a39v6dz+X7VNwUoBp5Cj0KMwrvBdUV7RTDFUUajYovhGabMSSMlZCaUkUqpWWlRWVQ5RLlNeV3FUKVVZVDVRLVa9pPq/qXHVTqtD1Ic0dmikapzQ3KNZpvlWC6t1XFtVu0T7MgAJWDrgfkB8cPfBJB15nWilOmeBIcAB3SbddT0NvRy9//pI/W6DnMFhg0eGEMMKw69GJKNPxjrGSONLJsYmZSYrpgTTGbOdZmPmTebEI5u/sIiymARZgISgq6B/YAdwGvihpdDyq1Wq1VfrPdZo6zzrizbKNmE2Z20tbMm2Z+z22QXbVdpr2qfaf3WgO6w4QhyTHK85uTq1QQAQJuQCFAlddXZzlrgYu/S5vHXluV53i3f76x7tftzDzqPP09wz3nPUa7tXitdRbzNvmfcjnzCfDp+nvjDfKT9Pv0q/p/5W/of8PwZEBiQHnA4MCKwLXAlSCKIH3QzWDk4NPgezhjWG7Aspgh+Ex8Hn4R9DRWFypldYAULOKkQGIu+gXFFH0a7oSowiZhoLwTbi1HC1eCA+HH8U/3/vEHIJJ8OB4YXhH4ko4lqEQcRQpE3kcpRH1GS0W/RQjH5MaaxGbFNcWNyj+M4ErYQykhKpnvSUjCV3kI+RP1AMKSLKJaodtZz6iBZJO003phfQPzByGO+YROZtlhorlnUNN3YC+0yiVuIUB8w5yjXntvP28g7w/vGP8V8KcIIHQrjwoogsepMkTFZPhiYnJM+kQFO6Uj6lDqX2pVmnTaTrpo9mBGfcyozIvJnFzzY42phjcGwhF3L8bBWQvy//UUFIwf82HIYd3uhBZ6cKXw/8oi/F/OI/JdSSGwRyUdzpMi2KpwNlzxiELVRA+QlhIDorn0kvWVP1SxVUP9bJZpNpqX1nc+teOpHX920NPwM9XIMIuBd94z2MxjMpOJ2a8fPVHLPsWPI7A9bPW2u32b52+GZJT3+vXS+3T60vtq+n36q/sP/ygP3A9MDfwbzBf2K2+NxQzFDv0Kvh4OGq4dsjmJFTR6yPtI5uHr02+mwMNXZVApaMS0OkGzKEbGXcYHx6Aj5xehIyOT/Fnfo5TZq+O+M/0zTzZRY9OzEHnZufh89vLNguVC7cX/RcHFtSXhpbBi1PrYBXslc3r9JXX625rHWu71tPPqp0tOEY9FjPsU9wefzECdKJWxuWG7iNzI26jbGNCwB5yf321X3re7f77EDrVzv/141/fO7//rN0Z+ktUwOYn3sxrLw+ZHZ/xXc2cVfl9a+PSkuJimT9QFBZvAAJxh9DyjT2B61zSxxXmtVJS63V+DS0WIJCf4YA+DD+yPwa0PUApvbqtUFr+dlJlgrkenWQWQGCVVMUxGs2NVhtnYFRIeVTCQUcm/+rVKxCUoJmf2iJve6Flb9+JMpMtnD3pXK5n7mPICP2Y20mc1ZvKoB99tnXE2pckQauhqJ7esKQVlRjaP15zn6iSHgfFgU07tJC/fW2F21FiV070X1AXO/nLvY0naXY14IW5EeDh4+3BOI/WCpp87dSk3qzs2x9trurLUv8yyBJ75JmV8SwUXAOq1/Bol3rOGz1i0zWlq16qnIZNln9exIbJd2uAIB/D+4Mm1YlQ2uGgcyTc2NCp0G9H1Sp1GEXOwga2t6WMsWZjCDY/O2ry1F0iejBqLIro7L7kks8qkUuvGEtnPEQCWWdwYqGuF9hVgxiaqN41LkBnka5vM2E/qteIT/Uymi8ax2JpfXcjP019lKXOeymkhH9S/YuJFuz7ULWRmG5EH935k4vck7l92BJvr+RjIhQxTMXQKjbW1Mc1nnPguHNrUlpySr2YmVeuyEW0Eqknnl0OiJVqbT0PqLyNiMYxPCzrhh35vNa+M61oEjM7XAltcT0GkB3SMuNfIG+wXr/qCX9F1AG3oqK5H3VCJWX+TvbVSoYbOIrb2LkWx3ZqFXZOwo5zTuJ1/fF0dCiaW1Hom28vLpLHNputeAhsx7EuZgTEs2BMzjUSRc7FHRGcCBguSBowktIt3bfcl/0Uv/Awb6etajF5XHw9BoDrrHDum9Tzd8Lv0vBTxcgNbBm6GybGrGfagwO//aw4+fYU5AybKGnKmPTs6ZeneHJHm1g1wGVYtdVlUvnbFMmwNBZ3wdLwMju1t2dr6XHSVyBpJwZdZIySyZLNH1/uSupQQXud2kcab7NHTzfO0cgZ19K5c4/u8Ceeb9iN3/F/RmKb6IbZk81zfV+nkA9wl+97xTKfL8iKCSESbZpqYxKG0UssnR1hXAzt/tDU+nPC7McGK7PpWoLtczawn/TcquuITPlgeYtYnz4bjyuz61oXX+DM9bQX09ltQosQcrDVHlfcYqMEsspcfHINu19nvUWQR+F0auJFUmnMOY8qLJfOWtWeY9HmKULv6GkGDrbfJu+afMabXnFee868dsDjyp3xYjxGu+E5KlzqA9JNxlWZxMy3S7K10O3eIjbw5wlLuyc+hRCX8thBQ8qBST1EfafHYm+0pR4/Om0JlTfrWHujjR5hglk2U+mZlLXhiebbR+LKFV3b/Tsj0v6BKzhfy2MjhKwTRC/M0HGfU580JT0dtct+vxb0uHJvVEOnFGjdN/CWWyYwkxEpdgkFmLZMd4rEBYaLNbfd5zDDJWnlaxhNS1qxjJzxyY3Lk+PEMHBcZwxcB2Gkx3HgDWGkEe/8R9Q6m8GHOT1VsObZoab1HEbR4aI+xQI6dqO6j4cAID8KTT8eXf4BnscowxUeOpcSMXH3KH4rd8o9gBUDDEGpncqobK+Te/cdgzf7qKqbsOG6dJx3V9qQAN29W/Xl8ZKYSxgz9oAj8vqCX/7IyJ7+vv/9H3jfNrfqyi5Y4AourecLRietak/uHix61VzfyM5J59v36dWMjiz60ocP3OlzZ94c3ZhWnAfloD93ypQd04qooinF809Nm6dUUIodqBpcnNW6vs/3ES9YnWXf3KKq8PK1L6j8HXi3NRbd6hiLHqrMc0EjkbLwzlHJ4we2Ks9BzuLQmXjYHt+X9C4N8mXt/3nWnN3F+0M3xeypq8Lzhpla3XB9IbdQ/tQljz6+3Sxfy3zTnfhbpz9wjPOuuRe24JzeQeoHNm9etnywmdsVBNV0b3HWta0VW9aORwFwycc2v15JGwme9EkFNjw88qVTNPG9xYzN3Gpkywf0n/VfkufxaFqd9pDQjvIK6fvbtDhda8Cvx/5LMLuOJJlvC7O3ykgunpz9teBzyykeZewmk0rUtaZRGJm0SWdSkiR4d2Kut4Bchnrjt1IcfDwgau3OuS4wCanRrgwg9oiqbZuSujSvrFNSKtgvLCXPn47k1m5y9WCS5olMakumnvbajcDuFfvLzwmjEqfGX8+i8yyRTGV5gf4YQPTHmeVAtCFAL94gw6a843Wr4etLo+s7P5+KBmI3SDBO3Ve6ZIe1vZdwfSnrTebh7tGmRbG1rTeaLu7x2tWOGsuHLhlEujZHpjcMa77/WDudQcCIVPRpg8SlD9coUFXNGkOMsrg6V3bePSWfXcgs22jDZt5Awhb1aBGOTjaQ2YTKKyJ9yoBdNM2FY43a0MUTGBjNRoCqjaNzjDvKON+lblI2H3J2TXGwRMKnX83qBzgrH59E8rHZmf2zXDyif7yLz07kj0/bi2L6GAuxyOZdnBNivjBIPPod5NhV/tWhptpstHd1atnNpJsoJeiAgvvuAqq7NMnN1ss0ifPfLPOv1guxZ+5bXvCOIIN2ERMb2KVbJZLoFFLzShfKNJ5NqMi85L9azI+7azVWxOpjJyFja2BsO1NLNRixjZr+GKzWDKROplg22jcKhZBwXM49L5DVaUyFLhj0IijtnzdmS8I5he2dRbcr/4qcKUKj89lPZYxzmV10iGZ24LBB/zufiHNo4ynx54Wp6FYkqlpO1P2opd2rnbHrJ+YvcdmSdr03QSpHcQfLgD4BpZ0MO0nyqy18GgrtpOMIZ3yi4jm5BPmP3M360XfsoQjXhuCCA8aNmMdwr3R20jacSu08Trv1uSn9/tmnRUFdvHXIPcdZ+tB6zr4TeX0R0egqG75vvFqOdU4GXmNrvTecY8xOS5bBvZt1lkhr2fAalGVyiGJ3WX+70Qg6v0ssMx+PxEhnFgyJYu4WX9a4NOxUaESWb+R+XFzD3UowMMXe4pS9pS5o8kDLMUQ7DTvjvMR9hKqHA34w76TlDmXGN7CQglKjdPnaFOo4Qe22uwMrz+z0sX9YkSd27jp+G6LFfJLuguLkWM3Zv5Bk7a4v//dnD4eZmg/RNmZyAf6Bs+kY7pyJyM+YamFtCzIOMji8UA+yEKKJyz+GpzRM2ST1F5KOPgjl1aWx6sCTL6jmwCO6Ol9k8wi0edonW2LobrWheTu51OIVjewKoZ2nEMXtETIxloFr5LzCZzovQ1bdfWRIEASrN/FfhSUfFH9WFSgOrCnI6SxeQiC9XEiuGG7bScj9tAxPge+tN1zmOhlbXcBcyj9Lcq5KWC2oajtnlCcuYF57+XFuv2+Z1gXhyC77ml1euDwcnZ0s3/8gP3jYGlHj857g4MDcKnNIGALCxsnJHd01hgk0hiMgUu+/17FsTQBCR9K9dcmp03VluVZVioAnzpY2WogsyL4AFRx3xB83oa35U6avB5xBPJWP9DuH08kXlfEZ0vp17e81R5BFgAb+4hk0pZG9jRqM8qnPH6tpxkjdDQNtUTz6pudCkChSdGANjz4pqJdSqDgY++4s8TF/xnwFxCCwqNXj/l1CyQMgJ5CXvDzEu6bQr+5mOLcLnpUxETOtLGZevKtBhv3N5nJF8LCSlqjvKzfbrcRMoyOe0oG6/BqtXzGcFMeB4q+SieciWYQxHdZ+XgXoMoxXSzwxSc7d3Y+5rLNm+af3VMjeygF6/FsLFFoKnMG81qBT3ERuYOYwxWoFHXymnvpTAWvX3r/cr8nE3/Hfa23yqJueX51C6Is9LH+vpZQeA73zHMYJKGkPPuWen3GhWwAihGNy2XEHK9XPmFqaBt+BoVsczqKKFqniAuAZkbfZK7R+tNu8KhvKaqAx7EagRGohasyaebKQR152tpleOGdTxWR+a5vPRz08gSBLUWjKN0is/RgA+iAfGpaEIj4wmPHD4Fx+W4CBeje2vo4rcmLGS8JeYVsMIQ5EwTwJhWvIp9Ul2jT7Z1eWkS9PRduLGg5VZL4r8nU3KIVj6EwV2u88vUWMUB/6WIpCiUrpn73SpCyECsq9d0ssSTBZNsptoYdPyKyRDsnzs5jWjt48PK4nmg+690DidBjFV04t8Ln8IDhYmU26XZYAaLGynQhKiWxADmsaFLXP6xPFuMCyzSFw4mxqCr7ZEv3+6MyXur6u49GN0YbCHEVIG0MeqEpdr9DjrOYExnyoDAapSi0CdzCOY6mg8B5Rg6Znf+vKCDzHEqWfz+a1Vc2NPUGEHFBnLvnWSE0J/ZEfALQClj1mARRxD64rwmSY09PQPujeWdCKXGj/uTmLvs26wm3ZxP5pSUVPKwETjlvsXKQhC16+unAtAWQv7jbX9zP98b82VPLusMaKtLD6NiHrRXh0rt+j9BuB7cfD8PIL1T5ps7YDeh1IWGFjyKtZNxBmi7sMIW7QFuas3nYtSucIYfufvsbuwAxoARFTRdMB6vnYLXRTpBs/n5+1ZzMUT6aZKK0Rv3NyI1EQuSWUOv7JfE1m+2C6mCJC4MlMpYjz7G984yJ+17UsHEzdbFyJadHPl+Abk5kqUr4J39J3PmmgMZcANgU+nI46HdnyQZt3Py/bniorCNUObNyfGXZlxBbT88s8ZwzZ1pzQoknE8rhwN7inplYMULB15V1TZMQkl4SVosZ4pYafKEiCTCF3pcVcLcMaPqW3o6QPmva/nFwuwhOPvl1vEZ7qORrSxgZjF+yfZeVnWj3cN/Bg6chSODDrwtb5kV7PbSEyySudu+Jsf1lfUze1TKIu9G45VfN3bPrG5s9gtX+YZ0jZFmGf/DqUJIdEKz2qccW/qo7U6y3Oz20PDpLkzQtujMsiQ4S0UuDcg45e/awu+HmL6gF8mooA5rIbBx4ZJQWjRLIBB68xfaKlzZytD+uMrzYCO4IRTiFRR9Vllw99PSn6VuD9MaG9scBmsILe2+jbOW0Xjwb8PFJd+2bIuSRzGwR7lhwhYS3hKZQfoi414ycUIEw++oveGW2PjUsnWp8fXqWZIrGiwTar8gUuLf9xHy/u/75ji2HZR/4LPPhJe+mBoAZrTVn/WL5cPk7ryrk/9RnE1LSVF5MOSQswH2yz9B3eNV4VN+/b2C1KfDbWF8WCXHfG86imDhegoM9dNHX4Tvuzq0qJPTJEM6vt4TJBkr0tc54etb+ItYdS4WMCsT4qkwmKU6qLo3aaEyRRCqNZJNh6K0FJS5CwoXJIZCnn4es7+s6IsDTijlGHBBIAbQiC6VgLtUJdpBLiQlZFEJaMsWsKoBNYlWiL9PKb2R2Tre65jQG1Kgcu7kLOWI2YF7BGRMhOvAR27ZcD7YgBogparWABjrQPVVkZAG5DclQzer/5LS+lxhFCMVIz+G71fafoWTU4EB5/FIBQ4ObgryFmyTJIp9xg5yNj3z/s76/FmdSdT3NHYyute3lk7TzuoauuR0Bv9NqjdPKpYGqyceMLQJ1j3vIPlWFuq2Rq74iwKA59/vmD+R6IyOmi6YxP7Xf4DQCJZLhhuXMfU6nok80jyaMveK6jUs68jMlWo2Jxdd0p3Z5p2kMWOG7POLGpczYUUb9xbSm34x1LnHcfeJMNniBiwM3bAHCosPf1RXlo5y7MVnFJfRod4ngHdXdOPrD3gqY9THlewuf3aN8b/CMwgiweUJpo/zafV9Va5kgac8SZ4NfdKsy8U4B2RPFDFIG4BTNlawOIAaU4bCZpSVLMVWCZtdUn+QCZtb8bLL4jrFgyI5HUrQ9DV9Om6FHrnyq2lLwWNrURhWciDQg8oPhqKambHPhVxfTvMp69N91u7utaAI8G60wcK4kZNSJ5YSWWPZqsyefxH2D8sgeEY5j2rTIiegJMOYZLlOztWiDJt8dgFEMSTuAPsSSVbEgRIymK2FUTWXL3EazUsYepKI+dYjdE9E0LMIDg2eJ+7HQoizHcIvyDrUV+Uis+8fq2xEzpRg3C6CXFngaWcaJ/ue4bE5T3WzF36gOlSXKsZJCCIOjV0FhFZY+L/nZSFrZZqRkpiNBmxNMRI8Z8qSypzRcP/gOVFKQ5MLrzdXf8NaIAoafbJQNaAhQ08IAI9XP0UKHsOUGzjJIzDrX/AUsY3DGUOicvtTWb+du03bi72k5mCP/wVkJTTYJFkgp69jgViENUxbXZGiB8LGFI0zcUv+MIoX9o+LkKoeWjTwuH906sVejIY7W3ImeBYg/3snppdAoTq7qUO43FTFi/PeNT9h5yq2x3j5jQcotW+BU1VXsrVKVxzvoKV4yJ9r7Fb4cb/EefSHF2TJOdOLyVIVfobneaODHz7NWcaAYq6JLL4K7ZqTabD+AC6p/PH+2CtjVkFmxU2Al5eHk3FzAcaz1xQBDLM8U3lqQ0g2ukh+1dhPDCqz1bpSkPCdBO5IG1U3vOpwxv3FULUfZDiX5jU0pULn+/ROg/C5cTcN62HdGmCDnhtZaLxa2a+qQ2c6cEaMLzxM/5qxC5N6OGxanBRj53hYU3NpNlo2kPoPRlDg2ZGJqBkFhAFlBDRdaCXYfx6abfbN974ToypadpSs+OuZi5ezNrXdJovWR06vSCO58HlKxb7Z8Wim1Z4pjjQjEjjr4yETwmRS96iVCJ1raETwGR/OxIPTonGjkxKFOkTChQGksUpZdvAEiBufyyqh0LkBPGcphgI4124JNaPZ9BPZi2v3bzkB0himHTLDMstpsc9iZXTvO0mlGOTU1mgu1iJCaYXY7abRmWp5YGV7pVHwVoNNgnUNpZW+RcNxU9sLViolSoTjRye7OZS+vH9fqygyLK5TOw6kz+2bigljeNpZbG7y48U7RA8ga8G4i5OC7qOURlKx6TuPwrewg3GU60FE+ZpkYZFMXROq+ix14o1kdQGbqpbh/WuniiZddjwmrdsZScNQMsbCkyrCUT2G2Nm40Wd/FLBqNBWhs9/0k4ZTD1K8/p7j7bm1PEbOm4pgBx7J8tCGUUOdCvNZyJCy29OrgLYr2QN+zZEJ5aTT5ghrbDsxpXL/SEu3DdnsuwiMsxVwEGQnz2/U6J47VopgPRijvxiBfcaMibQQSlkY6ADH4ZQ3jw1g5jAPgWs9bELJlJXAqmy3tst2tCqWSIgdPoKOTPNYBCQ4qwUvfq8VZFbVVe3b4vh8/gJq/0HQGqGp8V+XDd6x4qHKuY8SwqIHz4oOX7gZGQ2uMj0lqdQBikCKxnzsJFKTWjTghaGUOD6JPJXm78Yz1Ij3WdTz7HKcZBc167MVlJbZ08YvUjjCLnsAMV/CUTNDKakSyK1eg5Q21XS5CtFaFEnFdSBBdv0XbytwOkxjacxG0AZVTM4kPQPU1SJby/Ek8swKLLuDtqnnO1NWsWJjSaWj7XQLXKqEYAe/8kc58mWlq2SeLswCoNlp1RybJAXJUr0YkRJW6q1IlzMwoQzxCot9V+vmlgONxYiJdNtCmgEEYh6J7Kdwazfbe3Opikcofq1lZvLdZXlGcZPlTFqYfIx7AFIS1lqhKLpk/dHMtOjqsmlgEaRsYC5fN8p5OqavbFA2ZS2bZz5YRPWwVJDXyZtBJbWV5XrSqkJJYFdWuTzwnf+B65jxEKpg2ea97h2UtCk6th5syDXdLyXCTDxpv69YFzSiwWd3zRULOFSwnFvzobAn2qfGEYB5aKy648PdWu7XK3NmXuCIuYbPSGLC5XOlGYxmCZnf77xxCVSsGpC+kFUutXTSxs01C9phT3w6nw0jCJZgz3kKMPVDH2wKRAwBpkqOEjrKG/LHVxUFIK839SpspmCIEcZI8NILrte2MmFki1WWVg9EKngoMn/79h2ox/0Hd7jQyoQfpfFR3YgSenjYvQnFwrtWwt+8dDSIVeX/kwLcOHfTRf1rGKvJQcrvO7Yz3LwTcuPnNelwNF3XbLK6boeC788djBMwoIrWv27ZGYcKa/PXGewz3oWtrJfp8LU/LDNNPl4n8ljMXIG1zKYcZyKzWlilFOmVW4C17kAR3WXuS2jsBbXEI9ln7FiB5h1+3RpCNgcxk1x8a1HP0023m/rmVLIj3PWJSSSNyF6AP/cemEQ7OtLHOEcyAx+KkXqErMHrtbRtv0bqzVJkD4YVVcrFXE8qy+NkCa6sxFUVyli7nr6m5mmKQKCh/mc1cNsuuNL2hUbesLAHqWqc17QDSAL3F6LMe6/ff2yx7WF8SMXskS2R1P3hMdz8y19SK6ueaRjV52eyQMEegp+HjfUlSM4iQuKoJ1vbNJ4NIYdAmuNZq6eCdudN6kM7ILXKMHAfraYxZ0qpYV9maVqOpe9fY+53EwFS/QLvW32GKyNL1bQuCxMFHGG0lu3TM5GGFUcU9jtDITAAvqxwSe0NnnRgYeTxniEoP6xecC5uk4nmCrrOc06djsYfSnRW1nCrZIZrBcCOkqnD015VKxopDw5XzLHM3Ngw6KfBObr6rjJ1AjRogwcc563AETq5D5morJbo1wtgRxECeUSTjOkzRqrp1BRIrPrZIlwOuW3F1U2auxoB0ZuQaXrDupEks7ayEvc7VBwIAB1WKFICqq1tjiPmPRC06Hev7WhdjNu2u7xUJGHyntUUopVvucrzWCSdhrgfWSWCKHA+zU16kSRIWcfKCJq4ioVfIJeC8MiUBHaTIugq0JgH6X070aGwFYT1WhRDZhaMcbEiHJWssuCjZAbwMS2WJKbSttE0rUjlhoZY5q9xV98LVvJr1io8maO4udaj+DYLxXd+8PcRFH+nlmsolyLmnyXAExIG+qp1PVK5A5JWWYocHJOetuQVj2eqQQn2dzMo2swNpZFIz4KNM1vrggr50hfPujmPZaKpjs3skp/5VBIgEgd3MuPQW87YUrwwtiz5ndpFaHi7erV+wGpfaehrko7rYL7Q0NZmTMN3Xe9OP226VvMdmwkMT9W4OLL/HGZC+dT2xfO5J1jTVqvLm5ZZNaa6qpC1e2m9Zvm1DIVt2H2XfWZ+l3c7ltxKoORAJzT/qZL2EUxHRsXOpZOmtdt5/v7dn8/mZATqIBylKS09QMCLDwU0ZnXFV5N2VLMqk/Mpj7GcGK2L58/VrVs7sX5SARAGhscm23SI0JtUGWYBg0sBLPICqUvK1k1TTjLbNvcKntaYiTDQ9ubXGOO83sLMchTE0nawkyQjoJT2ApSndV6irdCsfeZy3Pau6A1t4vZDLB0/XfR5ztVRBF0HiiH0pMuNsMK9o7DB9puSBT+hoQ6aTXSexd70EbT27QqixF9lp664HbuZG2Q2UYal1WTSwV/YyQ4dMpETwSkSEfdOHQJDuG/VAtlB7abArUj/YT0BVwINXPJdIi3SjIb42GHTDX8Tm0XxTZn+OoxRnlfAhL1RgYRchQje2h1LgAARXS+21mahzxaDnZDhr69xjFgsZChoD3P+usAnss5Txyk9lLu95CxbUwp9lWNGz7GdZM5u0bpIwIeehhbjzVENH8CvUOSDswM9k4HI9GgYUt3AqbepR1H62tBA05SgqTKW5dFe+6/056/JksBNutM5vmmK9MKysMmWAtQyKHmholYnklUBfOFZ39UXnMHkms61tRGeJfzRv4VK7NL6t1O5dXtrTbvAVjrFnSrjL/IJve6kgPlF+yrSGpcnOmHWlEV1P2mHLH+yVWtIWPwcWSKXiFMZTCsBEhAuMLv4dWq9jriBzNbBuSUdnupJIT2Vi9x672g4IbdbeOAtoPy9ajJk78Tc0Vqach7m0XxTqfndMxxYdop7pxWS8gJcx/H43rFraLowSNWe2n+Sps8O3bodoA32161BJRa+uvcDUCoOVEdAPIfNIuTsJvnKHBe3MX/AyoNF4QfGCxXeigatYgRabpFA9N9/GvS6i9w00jff/jmjSieYOVUUFVTFX1i4DCK8g30Lfnlt3BfSRqlJL45FJxVrDlcLumx5wywzi9S8nBkPTP4oCJYRoLFhvsE1YG2HZF+AqAG1I2VVXZ9YmUu7rKWyO/1/3RPOCHNI6RcQQZFRzajhhjcwYsE0fHLN56ozshVI+jFo7wLPQIi43C61k/1CionU87Y7L5yyzElErufD2m1WuAxazjkw+SvdFXAy4UzH3ukmt1NI8zeE+b9HeQKureJ+uo6EW/m/jHLd36MgLigL001nYiw1XvXugNnZr7c2t6s3wztAGowSVjqR1mUtkB5HJsb2aRKbheYHeD6InFcA5LKpGDMYxjrQq5XW4QS1NbYPwEggbTZsIBex9pRrWNv2M0likBads2v625PbbXeMPfpOUI4V4GnkIgRDkuhEpgC7E9BbebxMO4kXDNk8LzAQBHN1iabQlBoCTfJZhd7VSvhPPnJdOSM0mr1CGIG+h8UN+cZiwOOPITdw8z11JrTUA0VYIx1dnohxUKqZwpxuXVSff64exhXVnYDWMvZvJmAFzqohxbT6cKZr8pvZD/2G0w+MTLgVPykwPudPYvWUVercQyg0GMoakpal8nF4Ud9zjiN6tCsA0szxpt8mEjw9OlrYxsL23sPQgVne0aGNtgh1NLvMpat8ERyktzWFF3aOxILb8mDT/anijIl7TLGG8bicxMBgCCAlIsaD3RuIGuZJC5HsZ7gSXW/KWswziPd/6cxxY3drufWalAUJN0dLd/TsX3zhH81Rltw3Da1SbtgKQn6itOn6BqJGWvJ9gRqIJABiOPiFRPUWvULBJ5f2mkw5+09td8VAbQX/uT7yCclrWKwyfLo1OBhkpbzNxuXrDmW5Re1cN0tWAiSgzNj8eVFw6wsTSWqtOH4/V4i4iebOfsYYlk0Y7YyVFoBqd929HkE/D5mF/XaDHO3DoEpq9LVMFTqaK+/FHbavbfkGZfLDh2kYLxHRIHumBT4nW9/KlpIp8qiDRmpIxIKGQWqqwa3W8OCmhKpQBnau0RzgWc6twMTSZIFuOg//urwVmBtrwSn3jqyP4XOV88O3u270PwVK9I+pNH1X1i53DfdaA73z3vnJf3VMvh9G7pUwnfIkDgnQ2hNHk+IwjuX9ykQA3dXiiXtRsZxdyaQA/2V2R3grQE4MZ847HH9hTWw6GlpEk4SqLPcIMYaelXgdLfjs1r73oEeeGkEsQbgrbYzTotg/FUutWtdLuXHiNg7lSEvLFr7Emw1cg25RuRkAGdF2+BRM9Celni3l33XaCjntST+8ObLccXCVKgAtZDsVh60jMi92S5Fzs0FjzWiK5JdM1IYJo7kGnxlGEgD+InzMapIN+t0O7P2ePEDEM9VT4KNi9Viy8OfJyMFEhQyUXTOHXyubUTXoSxLsxrK7ivx8Oy86RHLsuLYvaitjnG/9k8E9o/4sn9HFX3Vww9pb7rJ3wWh5RyfsSFqwilEKoAab9bKIUjNzXeMEcRl3mGmDpAHmZV+T5JEu9rE827CfUOurE3bCRfSQQc9JNXocMG9Utbb7RcFlj5aNiHQoaG2MvnSjC7vV/IZskWDvKv1ZZHrpgYy03r8jxY94sfKtf+/uFh4GIq40W5jxeZ+YA0GGlIMpzHNVI1IU1GibDEHrngHdxKsJJs1q3UtNZOqqTPbTkn7u5iyralvYUMTz27QubN7zrbu24mme9L50EhUomDodgXAe6lbJ1Lrc4ZRzpXEnv1MicMJZ9nWoLK2lN5NuzBRDlwLU/3aHBZD/ZtptP2QU0mAlY7k7xdsqEHTaJ2nFUN7E4jWus1aiBfDexpra78XFWxK9Nk++fKzgi+cBmzUgvt95OkVeMAubuv+zT7Elf3kIaFOnwxGOfoas3Qzf5maM9KzpfSlVdHWC5xtHBE99qaUfpFjqOrhu8He9sHKvKgcBC7U6GlevPhtrrD/K72JZsu+Zrs90abFIaueznoquxKiPeufmsAeuzLCdZBpkcWWyz0nS/R496NTqBWDRjV1u0PRIF9oMpdbgpQUc2DU+pinj6X8lbAqhNslNs+c9a5mdJqOC6W4p/tq6NhcoVWqWX2IoU2Cge21zhc6MCcO9enR4yrd1b28rH2MAdzI6g2QMEutUauFwUOI1X9WoPWJFIcromKrl2u1BHzMOKuSxrFq9Wt8YYapk6lHv2I4DEJuASSCjivoojPiCAZFX240HMHhUwVoQNP1rrGFnf3mFCTY3ui+vBubc0Z1yj8bLZutTPkGLRrsQlKfqc+R4iBfOWzZon9KlgMA+SJhu09+bPRLiXJAV/A4vdteWfs3SeWaqX6nb946Aph2eIcsNesZGXyzS/2tLMzTxrDel91SH8NmampOHncmzuMNvrc2SVxH4c3eL8oXDEnSDcIp09/JOwizMufQM2EY1IYr4Zb1CQNp++ytMYTLxT6O9q+MQ8DZOjYdRAaTqXaNKQ+dR2eTn2h44agKVQwjCMtGx63RFLau7m6ChWiL/nitGL6n24zHaZZf787EwdJT/NWuQIo7mx7frlXlwVIZ/TbQhDnWtpTO8etXuALnYmxGHIj0HCtqswsRsBeWtEKPCtFOajte4wIoWeY0YnQoCB4aXiLevgp1QYtEwt7poaHlCp62gZfnuy3MRnvmvU852uAfEh7q0+zHtzMGrUF2M/DFK91/iECVhcoxTDVHWJZIZ9n7xK27V2I+FGMi4nYl/NwRuu/lMnwH+iNzYKFsDo7Zp6l59wYp6A9N+R77FWcO4rBSJcN18/0yfFN7EDwqfSv4BeLOLFrSQA9vFzqrgyLxcyo9AIPG7z71pLy0IcQlHQcVDPjxS6XmbeRsk6WHuF6Td0VzIVUY2tSrjj+7hBEq2Y7MFZxax1N2SPG4Zl8EnMMyrzzXuSd2Ps3SjS9BaWbAf7v2PjUjrJ1pGJ9IbDwac19KtR/4H2S5tk8NP3avLR57tOEwa6iUZn+sFl89heo/IhYFnakmBYXi69gwMgVYpCOLFsl/sNIFIs5jzJig5Vi4B3E0T5PI/EHGFNiQRezVmEdtOFEvW8qHqqkgkbWLtBTOxLy4IvTa/SzTujS22uA6TlBwgvYPNfRxt+YoGV6mwz7YlxMnfx7p7PQavlmIpqbzaTsJqMsPkOAtyEHOOhdbbCaZRl88lE+dTkiHiDj1RjU+tmmtgXucMzm8mHrrGhvHyaPjMF1H6ymAPXacSAPjIo6b6by8fedyIZzX1ghGcyz1QW7k6K3DBecLd0olN4XjRX8m/95vt30nTfO1aVxbi8ySXtJKJDa/o2KqvOgnu79o54CzOT94pzurBZKqz59qqRcfJcYQdLZ/eLssuiYQqd243MIjOzEmYwK7EKAcNUTKEf1Ot2GM247JvKa3f0CGReUyN8edZGN2201ZgmBfiEPPuzInSZy3LAPCD/oWNrK5lG6L9mwOj1GjBrLRp31MyWK2kYL69LS1+Cwbnd1jsiNX/TblnvwiYT3NZJ4U/sa8wqhYa4hOsB0IrhdQTyU8hOOlYiuI5OSShGX8DR0IhgKFYSWYZghQXETGTV9opgr4nZcuOpkKSSShwEadi2WEz7B9sQniAkyCH0lBxrmo82hR4WjpIJouAlpi6ghTh4xvCYaPLMaxGAWuk142r1aA6m1l0JEvC62thN85amrq97sthDsmgHrcTTfrVYH9v+SgWR2MROqo383ZTIa8rZD2vnWTumLhsC79RKGMtuLNJmIcEgvm0SNHTe93jciI6qCp1aCEwsL57RRqJM6mdlMllsiGxdjvlynlSLI4RmaBckjU029/EoblE6rtY6tEFn/nGJLimLraEAc4WayIulJI4AWdNv+0Hjd/Jc1VAc7JakiHH0SSouH8HUreQeYqkGqZFiH4m9i54hAZPFaanlFWyaS2PxZu5mz5HGtiHL9XloMyzsFR0wx17fiC8xTHduka6bUZ6GOHsi4bevT55CNsbtU6TTVaX1nrc3DfgwUZI+nFUWhyey3vMipZp/6SRCxQ32jr2vCAkoMy30umlUMkreowzDnCFzBcvw/AGxGybcYDN0rv7VhnAFs3Xjr4UwpKvoXv5YsvxRUa8HIdVyVldk+qk2NGtVgEm9L7BFet6ZBigo6g+Dkb6iETVNi1D45t7ornUpXKVPnQ2rVu5ANb723UoW8KmTQK/kWwXGaLVNcKt103aMu/yOBN2+o4I+ExI0TOaPJDhDkNlahTam62TEr50cb5OYL3VTr/VsAHRpcWCNM1XRSm0SAZMQpdEAgt/hJtW11NNqnQgkX3R+8P4rzuIc8WTAKLJ1DIzMtFbG2SYditI6bOYTCwG4CidDB/BVgMNSpQmU4EofWUQ/8oMLxseBEpYQaN3TXvT8E+zWSID47VYW4XO7krRQOcYzUajGIMaL0unert5eOHYmgElXH9QvwEPk3BfEC3Ts6ZBUPYC7adiSk9urZ97SHE1K0Xutm3YQnMKF0Fm2gpP38f2jUgHlgDMiz96QgnSj9YbKtVB40G/DSSI2QgtxqE2F3+AyyG0V+EkuBOSShA+MVll1cqC2pLM61VxGUwaUPmKF+cuZHnadapwPINNmHEpoj9oajJJiJre4maiI7Da+bQRuUrd2JvgURsHDTjzl11KAM133ZK2Flmh2bdsIJR2v7J7DoMymRZ5qkgeNfmtJXP6TWf9xM8uczmHbPpUD/Yzx3AU+FY2acWaftFQFFdBQh8XyGrfoeQzLo8u63jFd7vzEsDkQcIwOR+v5VOumpFMP/R9apzhm49pdG1awUs19MnmaZ2a4+qWlsDz9LGE4EcUu6EORUxzR3bg5+Y82J6sLg/L8kfX5dWwsTUQ6a78zDSbgFd7rpQa3DiGzp0M8d4DWNsj9b0nIy7N1NomT3aLKeXOnU48M412xe+PavvMAre6Uu0z/U4WeK+Mq8YqegbAhK7n8g3vg/OriPxv7YAmsyRdONiTeHHlB7MPWxO4PdDaZ4mlUWhpkNiVdAELi00CpKGG1qZ3geDApkKsP+y6nbc93aYfK1p2sfrO3NoNyj2ngGGcnBFoTz0fRLrpzgOo4nvKOTOX/cdtTqZZ6fxOrK47rVmML7OUetAwDAOnEvB6nqLEzewEH6JyaD1OSj5k7aqJHHbC//Sa0+GAydj+BdIGUZCEfMUzyS5yNj3dYETaovR6Cd5XOK5FpxfF0VCLyPFq1sgLdcjSFk7zZp6m4MLwTpm30XHPM4v+1LFQaD5SSbjpWlAJPce4Yt5OhLvaGRUxWsmFpDYyO0COuqXj1rgT91Jk5nGy0YivnlbkzGouLPwIDDHZdnC7TGWmOmmLpy48r8gupwdMP6AXeUsmfZey5GCZfPG04T+Vh9ewlZalJJGsJgBG8PBeYVqbcXVN2jmTkk+efZDY2fV89IT6zEuZ1xrYj6117Ghj9jhZMGNOXtpJ7ckH1O/pJ+QjOmCtdbrPFlB+Moihy0jpqMp1678Zv03JLn1Hg7SVKCyJpVB+rlH9tUQ/HMaMqb5pmEINjJMOU/e8V+MksHn6RaQPQC7O9r4A/Scu+Chp2eatYtzck25Ji8+oTsw+bcGjDRorCIMCg6f9LLh9tbT0QQ2CU6MjxEUGGzWLneqiy4MUnGrp072Sz8nEnmt3hSRnX4fu133MeDyiIdI2B8M7QaO6sI+npd1FZVxpcsgaEMakqIqRiKibiVGq0FPu2TOrX3TjzTv7bu5PJJN0t+cjjgOhKUWMjry0pbDlNtk2cpKZFr0DjeP3uIUOgOuJKia9ZT7+Kx854IpQFk0IGg2Afjrhqitt5UUamcs5ZCpVVcWkgU1fZrBwVguQYFQtFNMkcqT6V0c6Jo3eyS6STYgw72Unoh3BYDOSptYtpp6pnKUiVaZ3GiskVcvO4ojBXmpWVkIJ3XetyHppkRHs2w1whwfuMEhyQL2DUam19UoQSv7+kKOJs6iacPHHQaimYs2VQN2A0oEIYrombQUpqdSbL3RnkCXUly5kmKWDwDdlaYTw2lZgN2O5y4vQXVTWr2x2qMfM6Zw3aaR2fj+eNW148jAMhLbpGtR/HZYlT1J3wHHVYTI2+qVvANGWc4k9IRRKE4PL4MyPpWFgFqAplg50pn9kY33wnhTP6Zl0U1GE4AwxLd01qImaR8zOpiEZVTIeTz7MkDHtbRQWURpf4ZpgxNMeRMn4aNgLk0bpAUJrL5nTixc2MtyRwP3AYuiBYSsHpHpqiClZJn2vgSrug+WGZZmaUFHTtcZJxzMumAvKqmsnZoYZm6KIKjZek/U88nC64XYUM5+hKto1ymAbZIGOvqnXLNPVkFxkWm7BvqSKBYvRgLrHw9OoFwukmSzVI466oD5vsovbJ5Og6dAbZ5fNaoKG9E/m1oWQuhdSCI8tNUohtWQieEN0xZZp7HovWMYKowOZwpvGUKT4/l7lZePpL62sofl/tWbTmYalHp3D98hPSGAy23uzMmxr1rLoF7E1ywh+WrGp5ALdrRO/qpHn8DH12D1A17rSpoO1+unxMMcv74MDV71RZVeJDGe1QGHb2KgzrDozEoWrs2RnBN58u4uxfbfFdLBlF8DmsMmdwDSrhTQAeBoHwGJeL+eR8SdyZ3qSFPEv3Pd7q3IpgehOJmwwE5tO71VorJvdwWqcUoO+bxNlK3Z74i60gR2PTk4lGVlLm9A+te1jfsqTGel6cCbbXlutyk0TjHA8DkbKZrSQcYjyN6788iAnlGbXpOjBlTTdtYiVSKf+njBLDOxsis9YiwwNV77QThFHBkLdvnW+bthKGIWsiF10HVGin/p0onKyemC0JMtBdl6hORaLUbgxIIVGLtkTXQ9aMYYKc+ShThiS0CF2JNoaXMWcRcgxjfl9JKLeSUE5nWTzQITpb0Al54PwiTPT9WIHRro21K54QkSy3xdwyFsYSsnu4UnPn2o+mVZTXLvQSsqNJuGRzduc5qxpJ+UExvALf4AN3Xes8WoGYbYNI2wrIuTsEJQeg7QYZWsZMaVvsKbWDFv3eTmVonea135ldHY6sS8vEV9r/YjAyPEdroAlCtpB6XaWTW/Wv28aBBm8zv4jjmZAJX8g6qsneBHJ0oivbNnZY9S9OO5nCM7WYVnIhJKtb4pFbQJO5dYdS7Y5Cfbp+666kqzDWLd9JR9y41AlHFBtvjkQ86eQTbJVYtpL02TPngwp/OgG3Zi0TzZH5hoovCQ7oQxAkLpHlKLWFJ/y1TWigGWtscPgusCEWOhdU6XFha5fNpI1yvRy9lf9VNXEtOLoJ0CZZWLcAj/uTw3HovZBHqXnfnrF8M+i57ClIK8hpTVfjwg4IcqFUwdYMlpQtsohU3E1mb1zihjbu0FFsrbCZUaZdwxkQRLBWFC6o9qTVOkK64l9+F8/tuiK49KjfaOREOOoVBafa5kOu/pqQw4h4cT5yBHisq4+nlROueF87MHk1EOC7LOLfhSunAD+EJULxa5BNa4buKkO51chTgV0fXKT+/U6VdxT6Au2eL6O/YNhAtlkI68oog+eiEofLEjt8Fd/nDjN6n9XNxYWXwDQ7Z5ICxcKTguzR5O4yrDAd//oJjhd6rRRikToeDn8fsxqxgOhNkX6d68ZLhNYZp6XO+T73wdZZgh9ehVaJV7HU7KBxVtIhpEs0KwSIh3ap9S0GQ4CJTjqQQPdQnhrReZFsJisWAzCXAIBYdxlwtlBb/qi+qs0BqpQeyBDuO0MglvuPM/QJt2NfZQ+EW/yzee5QD00r3TpVYmfFMOe4b9ISz37kASjLo/dCiKdSaAqXjIEui14tbXq9OcCZi+AQDXHrOC2xegdjm/RoMLaDVi++nVtMyX0O4cJSqEOu2jA99Cqvm6RKpErvso2nSzVNGb++JfsVhggN/zZcKNtlW2a3tqynCei7tEIbNs4x2TbZVGJgW/pfkiCM53JBdxUpZTylvBdu9R0Gk9YpSzaAm9WibUcHqzsP7ekfCdv8SHBo1m9laCW7JMBkep4UbPh2O1HU1rEY8E5jkq3WZx8/XdO7Yz4Yk1lX8+P4MctyRyjcWeNCYw0Ddad3NNTK2F5u3Re2ZxNOJjurfJohjTiM07LHAH4E3WMHQVHeUPLPfVO+LVE4ONpW9ygAwhR3CmfuYzp+4O8N3GiopetqgX7r0eF8fNIkZXbuMmctEja+UQehshPd00w8ZfHYIVIDwCZvWsETPcFtamgqrkE5jwx3O/HfpRL+Fw2ALPvMf1INsVL/JozXRv3n4NZPSlb5d19SWu+rKFaI96jUVkV95I9yIqSZaTPKNA0h97jta5e8yZHxxCEqDcY9G/IdbeREhA3VHbPsk89/3gjDh3/5phlWJqlp16cysFNGupW62qi2OrGJ3exDDQ0MMAMElGDuzHAGv4M/wj+hCYiY81v75aRQOfIU6aFGR+hV6L9q89cMNU/mxYzNEM8jAhEkBBXBQnARfIQIUYAoQ0gQ5xEPEL+Q25HqSCukI9IZGYKkI1uQXchBlBoKigpCYVCxqBJUB2oNdRZ1DXUD9Rj1CvUB9Rn1HS2P3oHeh1ZEW6Kd0KXoVxg/TCuWir2NfYD9h9uG24EzwVnhoDh/HA5XgmfgV/EfCPIENYIWAUAwJpgSrAl2hNPEMCKeGE/MIxYRjxN/Eh9yHSUoQgXWgMINHmjQR2CLb4GVf/kUIYyDH6f4RF30x7dYpZhUJZAQojiluOaWZ+ZziOs8VjfVkXpstl8KUpOjPNRWV2OtdVeDRrSoa7kpd2Zc/nIwp/PS/JwtDbGbA5ze+OCLWy3xrE/7gZ/6uV/6myRyiTxAdiGHk6lkDrmB/IUiyqAUKK0UCwqUEkshUbIoDZRWygXqfuoENYAKo8ZTx2h7acfpunQzhh4jgTHJOM+4wlRh2jHDmE3MZZYvK5RFZyWxClkdrI/sBLvMdmJj2VPsi+xb7Ifsl4lmiWyOIofFmeXm8wJ4NN4U/zBfwj8l2CbYJ9QRmgithc5CmJAgJLUvHkVf8Rj/SHYnL5MqnaTM9JkZGTQ7nVEZn21y9zw1/6d+503xXgSWRflK9+lPGWeVXmVez2Q+Z37UaK3WFcostSzTLET2luyNnFfFl1xebm6+6+mUQlghqZBatDYcHzaGS8PjUa7klPSWiEskJUslV6e30/fSLUxTQ8qhSbSg7C5n8gxeVTFYMVtxkV/hN/ltfk/sFApCS7wQf2WIPCvPm9HaX1bLWtos+9Z+cQ7Ox4W4MFdRf9y9ct+8sif4uCAKaSG/sbXxHNQH2CxpvtF+oyOsI+t/xh7aAEz//iKrF88muBw74XvTCUkU4Cl1bEvukDjG8z67ezy4dH+4jBLXZg+ZmQHPvkE2uT4zOxZOlxHn8v+dYyOxGn3PGRc4uf1MwsZUmRZa//HYHTx/d8gRD9zvXbt39ebTCzQZU0aSJcgiZREyhAwmC5K5ycAybelX6TvpJekF6aRUJm2XtknLpEVSkRQuhUodpQ5SWylIul8aJb8lE5JeCU7iK3GWQCW6q97J/c1hdrMaaBYzG2BqfOEaMP85PyfkAETwicMPNRTZnf1ZoMzGFV/LAn7DyK+RdiTN89zN9VzOxZzLWpZHFkbmRtpG6ka8hp/+4mH7Ibr4h3gUK+/CO/8kYrG4U1wrLhAjB/mDiA/6g++aNGbU03g3XotX4oFrjopRPBo68pnpp77rqUL5gjWNtCOtSCmSjTgRKhLsqmOiR/tQOOR2e6/prupO2YU7aVfblfd9u9y22T5uN7fVbWWb6BrtGuhq6qrv4m6EDb8dWPkrcVValJa9+W1+mm/nW/lqXsmd7bXt2e2cjM/gbDyfn8vaStsy54RESzuTHG7xM97Es3gKZ1p6W6pailqSMQFjMBqjEInOCECF+Dk+iw/jQnNMxER4DI7QCI668Bt+wH3YgKNQ1YQCYwCAJljf0vi2kdjw3Ac2eNYH1++p+1jXU9dRF1PnWWd0856ZrcXUzpgbRbNVf9X3dXlNmubqIA1S59RE9Uh1f3VHdbQCyFSpI66IXTyAm7A7bA99Ss/QqjI3kkp4hE5iCYL4EugEGE+Oo8XDxU1FC0WzRf1FLoNzLy7kdg+7B92dbuIwt3PstNtb7bG26BCrcWmMGr36T92S35xfHULetjwdb+7P3Fe513JHc1tzhTlHs09n3c+6lkXICsqoTMOk5KUwUmjJisn7kvcmyyd9SbohchI5iGxEFiId0U7hJ+FL4T3BooAvYAliBDt5aTwGD8/z4tnwtHmaPFWeCk+J+4L7iHuTu4fzgyPmmHPMWDDWJuYj5nlmNlOZuZdxlrHCmGFMMZIZXgwdhoqp6T/oL+jDtCZaPa2clkTzo2ZRyBT3eI+4k3EtW5SDYpAX+ljm8cODiwWJ3u+ysCPEp5PBL3t67Mdzx0RsOUmEnQYZQg2eLEBYle13en/hhmef7V9Vgpmf5YXTjdDG1Y9FuSmClYD3KjdBUAtui/mx2ig8iKuab8SHtBm/EAY3ZS4VSAlq5AE2SEP5CdKGdJfwrFBVBi2FqQTCH/nXCZuS8Xp8OubKvfEpqC7fC/isYdaucWKTcfvGq23HXTbw24pG1NhPbvrNSUD1xi0bn5fAHpvvKh0U9TgOJ2YkvVw6BFCTCfK961Mg6Lp7gajecAIJ1dMaSKo7kkBaReaaM+NAVlN5EchpWxnd5tVe6AIF3a36zxY13sDylogjBQ8NBZUAkIl4pvZgw4pNTBZSiBaLARd4yEQuhxcS/PbAB2XZsaDUlXQAFj8esZhCPiShEQRPACGRHkh4RKSEHfmR2Tj34WJhnvQDGZMwRNOKzXgiDE2yZK6ATwjtdAKikjJAfUAhHF8fiwfUBrgEfoi/0nG0AS06kcvqqAgHsmaDA1PmyVAmrgjAOLb8IRVV9Idid+/HZ0qNkv2BHbCRfWzhKgdbvEgAKqetg1AckWzi70h4x/FS5jCqCkG8BQlGM4eSFbJW2oP13EyWRzMIPBZU2RbqYTGEDnlKw7cMQo2SrJM4A7qh1KSm8QGyVdZ0JMR+ETywOCZBHgSCGWoycEjXYdADixwL2dV4bi35lAzKRETGcYSOAmwLb5NiS2b2kXCyk6jNTCtWem//4lY6D7EcqxDf7yX3fpryBTIU+M9hKqfaWHJymmPzwtMOQ+QnHkNnHDkNxBdX6cy/TLHKLdC92oBeyF7+4/v4vzgNo6k/ZiYAAA==';
  function injectFont() {
    if (typeof document === 'undefined' || FONT_B64.indexOf('__') === 0) return;
    const st = document.createElement('style');
    st.textContent = `@font-face{font-family:"PixTides Pixel";src:url(data:font/woff2;base64,${FONT_B64}) format("woff2");font-display:swap}`;
    document.head.appendChild(st);
  }
  injectFont();

  global.PixTides = {
    SCENES, CATEGORIES, byId, SHOAL_TIMES, timeOfDay, ramp, uiTokens, hexToOklch, oklchToHex,
    create, View, paint, toCanvas, toSVG, TIERS, exportSize, shortCode, dateSeed, hashStr, mulberry32,
  };
})(typeof window !== 'undefined' ? window : globalThis);
