// 生成：场景 + 参数 + 种子 + 时间 → 半格网格（2G）上的色阶编号矩阵 cells。
// 预览、动画、PNG、SVG 都从同一个 cells 出图。动画是时间的纯函数：同一种子、同一时刻，任何设备得到同一帧。

import { hueRotate, ramp, variantPalette } from './color';
import { hashStr, mulberry32, seedMix, SEED_SPACE, tickRng, type Rng } from './rng';
import type { Hex, Scene, SimOptions, Variant } from './types';

export const DEFAULTS: SimOptions = {
  grid: 32, ratio: [1, 1], seed: 1, angle: null, amp: null, terrace: 1, bands: null,
  dots: null, dotMax: 5, pair: 0.22, invert: false, hue: 0, variant: 'day',
  silhouette: true, silSeed: 0, palette: null, time: 0, rare: true,
};

// ---------- 稀有彩蛋 ----------
// 由场景 + 种子决定，任何人打开同一编号都会看到；约 1/512
export const RARE_ODDS = 512;
export function rareOf(scene: Scene, seed: number): 'whale' | null {
  if (!scene.rare) return null;
  return hashStr('pixtides/rare/v1/' + scene.id + '/' + seed) % RARE_ODDS === 0 ? 'whale' : null;
}
export function findRare(scene: Scene, from: number): number | null {
  for (let s = from % SEED_SPACE, i = 0; i < 200000; i++, s = (s + 1) % SEED_SPACE) if (rareOf(scene, s)) return s;
  return null;
}
/** 鲸尾剪影（主格单位，X = 填色） */
const WHALE = ['X.....X', 'XX...XX', '.XXXXX.', '..XXX..', '...X...', '...X...', '..XXX..'];

/** 色带色板：手配夜色板 > 参考图色阶 / 锚点插值 → 晨昏夜换色 → 色相旋转 → 深浅反转 */
export function scenePalette(scene: Scene, o: SimOptions): Hex[] {
  const n = o.bands || scene.steps;
  const v = o.variant;
  let pal: Hex[];
  const timeSet = v !== 'day' ? scene.times?.[v] : undefined;
  if (o.palette) pal = o.palette.slice();
  else if (timeSet?.a) pal = ramp(timeSet.a, n);
  else {
    pal = scene.pal && n === scene.pal.length ? scene.pal.slice() : ramp((scene.pal || scene.anchors)!, n);
    if (v !== 'day') pal = variantPalette(pal, v);
  }
  if (o.hue) pal = pal.map((h) => hueRotate(h, o.hue));
  if (o.invert) pal.reverse();
  return pal;
}

const CHUNK = 512;

interface Bound {
  base: number; jit: number; maxA: number; dir: number; speed: number; k: number;
  rng: Rng | null; buf: Float32Array; bump: Float32Array; w: number; left: number; count: number; g: number;
}
interface Dot { x0: number; y0: number; x: number; y: number; w: number; h: number; col0: number; col: number; off: boolean }
interface Glow { x: number; y: number; s: number; ph: number; per: number; seq: number[] }
interface Moon { mx: number; my: number; R: number; off: { x: number; y: number } | null; halos: number; spots: { x: number; y: number; s: number }[] }

export class Sim {
  readonly o: SimOptions;
  readonly scene: Scene;
  /** 短边主格数 */
  readonly G: number;
  /** 半格网格的宽高 */
  readonly W: number;
  readonly H: number;
  readonly S: number;
  readonly seed: number;
  /** 色带数 */
  readonly L: number;
  /** 完整色板：色带 + 光点 + 月亮 + 时段反光 */
  pal: Hex[];
  /** 每格的色阶编号（pal 下标） */
  readonly cells: Uint8Array;
  rare: 'whale' | null;
  t: number;

  private readonly glowStart: number;
  private readonly moonIdx: number;
  private readonly glintStart: number;
  private readonly run: [number, number];
  private readonly radial: boolean;
  private readonly gap: number;
  private readonly unit: number;
  private readonly ncol: number;
  private readonly V: Float32Array;
  private readonly U: Uint16Array;
  private readonly bounds: Bound[] = [];
  private readonly rspeed: number;
  private p: number;
  private readonly layer: Uint8Array;
  private readonly layer0: Uint8Array;
  private readonly patches: { x0: number; y0: number; w: number; h: number; d: number }[] = [];
  private readonly dots: Dot[] = [];
  private readonly glows: Glow[] = [];
  private moon: Moon | null = null;
  private readonly whale: { x: number; y: number } | null = null;

  constructor(scene: Scene, opts: Partial<SimOptions> = {}) {
    const o = (this.o = { ...DEFAULTS, ...opts });
    this.scene = scene;
    const G = o.grid, ra = o.ratio[0], rb = o.ratio[1];
    let Gw: number, Gh: number;
    if (ra >= rb) { Gh = G; Gw = Math.max(1, Math.round((G * ra) / rb)); }
    else { Gw = G; Gh = Math.max(1, Math.round((G * rb) / ra)); }
    const W = Gw * 2, H = Gh * 2, S = 2 * G;
    this.G = G; this.W = W; this.H = H; this.S = S; this.t = o.time || 0;
    const seed = (this.seed = Math.floor(o.seed) % SEED_SPACE);
    const rnd = mulberry32(seedMix(seed, scene.id));
    const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

    // 色板：色带 + 光点 + 月亮 + 时段反光
    const bandPal = scenePalette(scene, o);
    const L = (this.L = bandPal.length);
    const vkey: Variant = o.variant;
    const timeSet = vkey !== 'day' ? scene.times?.[vkey] ?? null : null;
    // 有时段反光色时，光点也换成这个时刻的颜色（深海夜里是蓝色荧光）
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
    const nb = radial ? L + 3 : L - 1;
    for (let k = 0; k < nb; k++) {
      const b: Bound = {
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
      while (b.g < skip) this.next(b);
      b.count = skip;
      if (b.dir > 0) for (let j = 0; j < ncol; j++) b.buf[j] = this.next(b);
      else for (let j = ncol - 1; j >= 0; j--) b.buf[j] = this.next(b);
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
    if (radial) { const p0 = this.p; this.p = 0; this.layers(); this.layer0.set(this.layer); this.p = p0; }
    else for (let i = 0; i < n; i++) { let l = 0; for (const b of this.bounds) if (this.V[i] > b.base) l++; this.layer0[i] = l; }
    this.layers();

    // 嵌入的色块补丁："岛"，颜色相对锚点所在色带 ±1
    const area = (W * H) / (S * S);
    const np = Math.round(((scene.patch || 1) * G * area) / 7);
    for (let p = 0; p < np; p++) {
      const w = ri(2, 6) * 2, h = ri(1, 2) * 2, x0 = ri(0, Gw - 1) * 2, y0 = ri(0, Gh - 1) * 2;
      this.patches.push({ x0, y0, w, h, d: rnd() < 0.5 ? -1 : 1 });
    }

    // 散落方块
    const dd = o.dots != null ? o.dots : scene.dots != null ? scene.dots : 1;
    const nd = Math.round((dd * G * G * area) / 20);
    const addDot = (x: number, y: number, w: number, h: number, col: number) => this.dots.push({ x0: x, y0: y, x, y, w, h, col0: col, col, off: false });
    for (let i = 0; i < nd; i++) {
      const r = rnd(), sz0 = r < 0.55 ? 2 : r < 0.82 ? 3 : r < 0.95 ? 4 : 5;
      const sz = Math.max(1, Math.min(o.dotMax, sz0));
      const w = sz + (rnd() < 0.12 ? 1 : 0), h = sz;
      const x0 = ri(-1, W - 2), y0 = ri(-1, H - 2);
      const col = this.dotColor(this.layerAt(x0, y0, this.layer0), rnd);
      addDot(x0, y0, w, h, col);
      if (rnd() < o.pair) { // 对角相连的一对
        const dx = rnd() < 0.5 ? w : -w, dy = rnd() < 0.5 ? h : -h;
        addDot(x0 + dx, y0 + dy, w, h, rnd() < 0.6 ? col : this.dotColor(this.layerAt(x0, y0, this.layer0), rnd));
      }
    }

    // 时段反光：约三成散落方块换成反光色，多落在暗处（像水面上的碎光）；用独立随机数，不影响构图
    if (glints.length) {
      const gr = mulberry32(seedMix(seed, 'glint/' + vkey));
      for (const d of this.dots) {
        const dark = this.layer0[Math.max(0, Math.min(H - 1, d.y0)) * W + Math.max(0, Math.min(W - 1, d.x0))] < L / 2;
        if (gr() < (dark ? 0.45 : 0.15)) d.col0 = d.col = this.glintStart + Math.floor(gr() * glints.length);
      }
    }

    // 光点：按各自相位在两三个色阶间切换
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
    if (scene.silhouette === 'moon' && o.silhouette) this.makeMoon();

    // 稀有彩蛋：鲸尾
    this.rare = o.rare ? rareOf(scene, seed) : null;
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

  private ri(r: Rng, a: number, b: number) { return a + Math.floor(r() * (b - a + 1)); }

  private next(b: Bound): number {
    if (b.g % CHUNK === 0) { // 每块开头重新播种，起点由种子、边界号、块号决定
      b.rng = mulberry32(seedMix(this.seed, this.scene.id + '/edge/' + b.k + '/' + b.g / CHUNK));
      b.w = (b.rng() * 2 - 1) * b.maxA * 0.5;
      b.left = this.ri(b.rng, this.run[0], this.run[1]);
    }
    b.g++;
    const r = b.rng!;
    if (b.left <= 0) {
      let jump = (r() < 0.5 ? -1 : 1) * this.ri(r, 1, 3) * this.unit * (r() < 0.2 ? 0.5 : 1);
      if (Math.abs(b.w + jump) > b.maxA) { jump = -jump; if (Math.abs(b.w + jump) > b.maxA) jump = 0; }
      b.w += jump;
      b.left = this.ri(r, this.run[0], this.run[1]);
    }
    b.left--;
    return b.w;
  }

  private layers(): void {
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
    // 径向：第 j 圈半径 = (j+1+p+jit)·gap + 游走；圈号无限延伸，颜色按往返序取色阶（浅→深→浅）
    const gap = this.gap, p = this.p, K = bounds.length, P = 2 * (L - 1);
    for (let i = 0; i < n; i++) {
      const v = V[i], u = U[i];
      const R = (j: number) => { const b = bounds[((j % K) + K) % K]; return (j + 1 + p + b.jit) * gap + b.buf[u]; };
      let j = Math.floor(v / gap - p - 1) + 1;
      while (R(j) >= v) j--;
      while (R(j + 1) < v) j++;
      const m = (((j + 1) % P) + P) % P;
      layer[i] = m < L ? m : P - m;
    }
  }

  private layerAt(x: number, y: number, src?: Uint8Array): number {
    x = Math.max(0, Math.min(this.W - 1, x)); y = Math.max(0, Math.min(this.H - 1, y));
    return (src || this.layer)[y * this.W + x];
  }

  private dotColor(base: number, rnd: Rng): number {
    const L = this.L;
    const dir = base <= 1 ? 1 : base >= L - 2 ? -1 : rnd() < 0.5 ? -1 : 1; // 深区点亮色、浅区点深色
    const mag = rnd() < 0.6 ? 1 : rnd() < 0.8 ? 2 : 3;
    return Math.max(0, Math.min(L - 1, base + dir * mag));
  }

  private makeMoon(): void {
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

  /** 按当前时刻算出单格起伏与散落方块的状态（只看最近几秒的时间片） */
  private events(): void {
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
      d.col = this.dotColor(this.layerAt(d.x, d.y, this.layer0), r);
    }
  }

  /** 合成一帧：色带 → 补丁 → 散落方块 → 光点 → 月亮 → 鲸尾 */
  private compute(): void {
    const { W, H, L, layer, cells } = this;
    this.events();
    this.layers();
    cells.set(layer);
    const pc = this.patches.map((p) => Math.max(0, Math.min(L - 1, this.layerAt(p.x0, p.y0) + p.d)));
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

  /** 跳到绝对时刻 t（秒）。同一种子、同一 t，任何设备得到同一帧 */
  setTime(t: number): void {
    this.t = t;
    if (this.radial) this.p = this.rspeed * t;
    else {
      for (const b of this.bounds) {
        const target = Math.floor(t * b.speed), n = b.buf.length;
        while (b.count < target) {
          if (b.dir > 0) { b.buf.copyWithin(0, 1); b.buf[n - 1] = this.next(b); }
          else { b.buf.copyWithin(1, 0); b.buf[0] = this.next(b); }
          b.count++;
        }
      }
    }
    this.compute();
  }

  step(dt: number): void { this.setTime(this.t + dt); }
}

export function create(scene: Scene, opts?: Partial<SimOptions>): Sim {
  return new Sim(scene, opts);
}
