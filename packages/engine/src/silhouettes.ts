// 剪影：太阳、群山（可带积雪）、树、帆船、灯塔。全部程序生成，"骨架固定 + 细节在范围里随机"。
// 都画在半格网格上，宽高尽量取偶数（整格），保证缩成头像也认得出。颜色取色带里的某一阶（tone = 0..1 的位置），
// 月亮 / 太阳 / 灯室用场景的 moon 色。每种剪影有独立的随机数流，换剪影不影响底下的构图。

import { mulberry32, seedMix, type Rng } from './rng';
import type { Scene, SilKind } from './types';

export interface SilCtx {
  W: number;
  H: number;
  S: number;
  L: number;
  /** 当前帧的色带分层（光晕按它提亮） */
  layer: Uint8Array;
  /** 各色带的亮度（OKLCH L），按背景明暗挑剪影颜色时用 */
  lum: number[];
  /** 圆盘色（太阳 / 灯室）的色板下标，没有为 -1 */
  disc: number;
  /** 场景自带颜色的色板下标：群山各层、积雪、树 / 船 / 灯塔；没有为 null / -1 */
  ridgeIdx: number[] | null;
  snowIdx: number;
  silIdx: number;
}

export interface SilLayer {
  draw(cells: Uint8Array, t: number): void;
}

const ri = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
/** 细部（桅杆、树干、灯室…）的粗细单位：32 格时 1 个半格，粒度越细越粗，保证细格子下也看得清 */
export const detailUnit = (S: number) => Math.max(1, Math.round(S / 64));

export function silRng(seed: number, kind: string, silSeed: number): Rng {
  return mulberry32((seedMix(seed, 'sil/' + kind) ^ Math.imul(silSeed + 1, 977)) >>> 0);
}

export function buildSilhouettes(kinds: SilKind[], scene: Scene, ctx: SilCtx, seed: number, silSeed: number): SilLayer[] {
  const out: SilLayer[] = [];
  const tone = (f: number | undefined, d: number) => Math.max(0, Math.min(ctx.L - 1, Math.round((f ?? d) * (ctx.L - 1))));
  const silCol = ctx.silIdx >= 0 ? ctx.silIdx : tone(scene.silTone, 0);
  for (const k of kinds) {
    const r = silRng(seed, k, silSeed);
    if (k === 'sun') out.push(sun(ctx, r, scene));
    else if (k === 'mountains') out.push(mountains(ctx, r, scene, tone));
    else if (k === 'trees') out.push(trees(ctx, r, scene, silCol));
    else if (k === 'boat') out.push(boat(ctx, r, scene, ctx.silIdx >= 0 ? ctx.silIdx : scene.silTone != null ? silCol : -1));
    else if (k === 'lighthouse') out.push(lighthouse(ctx, r, scene, silCol, tone(scene.stripeTone, 1)));
  }
  return out;
}

const put = (ctx: SilCtx, cells: Uint8Array, x: number, y: number, c: number) => {
  if (x >= 0 && y >= 0 && x < ctx.W && y < ctx.H) cells[y * ctx.W + x] = c;
};
const rect = (ctx: SilCtx, cells: Uint8Array, x0: number, y0: number, w: number, h: number, c: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(ctx, cells, x, y, c);
};

/** 太阳：大圆盘 + 一两圈提亮的光晕；高度在地平线附近（日出 / 日落） */
function sun(ctx: SilCtx, r: Rng, scene: Scene): SilLayer {
  const { W, H, S, L } = ctx;
  const R = (0.11 + r() * 0.07) * S;
  const [lo, hi] = scene.sunY ?? [0.45, 0.62];
  const mx = Math.round(R + 3 + r() * Math.max(1, W - 2 * R - 6));
  const my = Math.round(H * (lo + r() * (hi - lo)));
  const halos = 2 + (r() < 0.5 ? 1 : 0);
  // 横向切口：复古落日的几道缝，只在下半个圆盘
  const cuts = r() < 0.6 ? 2 + Math.floor(r() * 2) : 0;
  return {
    draw(cells) {
      const outer = R + halos * 1.8;
      for (let y = Math.max(0, Math.floor(my - outer)); y < Math.min(H, Math.ceil(my + outer)); y++)
        for (let x = Math.max(0, Math.floor(mx - outer)); x < Math.min(W, Math.ceil(mx + outer)); x++) {
          const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my), i = y * W + x;
          if (d < R) {
            const below = y + 0.5 - my;
            const cut = cuts && below > R * 0.15 && Math.floor((below / R) * (cuts * 2 + 1)) % 2 === 1;
            if (!cut) cells[i] = ctx.disc >= 0 ? ctx.disc : L - 1;
          } else {
            const ring = Math.ceil((d - R) / 1.8);
            if (ring <= halos) cells[i] = Math.min(L - 1, ctx.layer[i] + (halos - ring + 1));
          }
        }
    },
  };
}

/** 群山：远 → 近几层，远山浅、近山深。山脊逐个半格计算，按细部单位走台阶，边缘和画面的像素密度一致 */
function mountains(ctx: SilCtx, r: Rng, scene: Scene, tone: (f: number | undefined, d: number) => number): SilLayer {
  const { W, H, S } = ctx;
  const u = detailUnit(S);
  const spec = scene.ridge ?? { tones: [0.3, 0.12, 0] };
  const n = spec.colors?.length || spec.tones.length;
  const [top, low] = spec.top ?? [0.32, 0.62];
  const ridges: { y: Int16Array; col: number; snow: Int16Array | null; snowCol: number }[] = [];
  for (let li = 0; li < n; li++) {
    const y = new Int16Array(W);
    const f = n > 1 ? li / (n - 1) : 1;
    const peakTop = H * (top + (low - top) * f * 0.75); // 近的层峰低一些
    const floor = H * (low + (1 - low) * 0.35 * f);
    const np = 1 + Math.floor(r() * 3) + (W > H * 1.3 ? 1 : 0);
    const peaks = Array.from({ length: np }, () => ({
      x: r() * W, y: peakTop + r() * (floor - peakTop) * 0.45, s: 0.45 + r() * 0.85, // s = 坡度（每个半格下降多少半格）
    }));
    // 山脊：沿坡度走台阶，每级高 u（一个细部单位），平台在坡缓处自然变长；偶尔随机抬一级，山脊不会太规整
    let jitter = 0, prev = 0;
    for (let x = 0; x < W; x++) {
      if (x % (3 * u) === 0 && r() < 0.25) jitter = Math.max(-2 * u, Math.min(2 * u, jitter + (r() < 0.5 ? -u : u)));
      let best = floor;
      for (const p of peaks) best = Math.min(best, p.y + Math.abs(x + 0.5 - p.x) * p.s);
      let v = Math.round((best + jitter) / u) * u;
      if (x > 0 && Math.abs(v - prev) > 0 && Math.abs(v - prev) < u) v = prev;
      y[x] = prev = v;
    }
    let snow: Int16Array | null = null;
    if (spec.snow != null || spec.snowColor) { // 积雪：只在高处，雪线以上的山脊往下几格
      snow = new Int16Array(W);
      const line = peakTop + (floor - peakTop) * (0.35 + r() * 0.15);
      for (let i = 0; i < W; i++) snow[i] = y[i] < line - u ? Math.min(Math.round((line - y[i]) * 0.7) + 2 * u, 10 * u) : 0; // 刚冒过雪线的小尖不积雪，免得出现零星白点
    }
    ridges.push({ y, col: ctx.ridgeIdx?.[li] ?? tone(spec.tones[li], 0), snow, snowCol: ctx.snowIdx >= 0 ? ctx.snowIdx : tone(spec.snow, 1) });
  }
  return {
    draw(cells) {
      for (const rd of ridges)
        for (let x = 0; x < W; x++) {
          const y0 = Math.max(0, rd.y[x]);
          for (let y = y0; y < H; y++) cells[y * W + x] = rd.col;
          if (rd.snow) for (let y = y0; y < Math.min(H, y0 + rd.snow[x]); y++) cells[y * W + x] = rd.snowCol;
        }
    },
  };
}

/** 树：一排针叶或阔叶树，树干在下、树冠在上，高矮不一 */
function trees(ctx: SilCtx, r: Rng, scene: Scene, col: number): SilLayer {
  const { W, H, S } = ctx;
  const kind = scene.treeKind ?? (r() < 0.5 ? 'pine' : 'round');
  const base = Math.round(H * (scene.groundY ?? 1));
  const u = detailUnit(S);
  const shapes: { x: number; w: number; h: number; trunk: number }[] = [];
  let x = ri(r, -2, 4);
  while (x < W) {
    const h = even(S * (0.14 + r() * 0.16));
    const w = even(kind === 'pine' ? h * (0.45 + r() * 0.15) : h * (0.6 + r() * 0.25));
    shapes.push({ x, w, h, trunk: Math.max(even(h * 0.18), 2 * u) });
    x += w + (r() < 0.3 ? 0 : ri(r, 0, 3) * 2) - (r() < 0.4 ? 2 : 0);
  }
  return {
    draw(cells) {
      for (const s of shapes) {
        const cx = s.x + s.w / 2, crownBottom = base - s.trunk;
        rect(ctx, cells, Math.round(cx) - u, crownBottom, 2 * u, s.trunk, col);
        const ch = s.h - s.trunk;
        for (let yy = 0; yy < ch; yy++) {
          const f = (yy + 1) / ch; // 树顶 → 树冠底
          let half: number;
          if (kind === 'pine') { // 两三层叠起来的三角：每层下沿比上一层宽
            const tiers = ch > 16 ? 3 : 2, tf = (f * tiers) % 1 || 1, ti = Math.min(tiers - 1, Math.floor(f * tiers - 1e-6));
            half = Math.max(1, Math.round(((0.35 + 0.65 * ((ti + tf) / tiers)) * s.w) / 2));
          } else half = Math.max(1, Math.round((Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)) * s.w) / 2));
          rect(ctx, cells, Math.round(cx - half), crownBottom - ch + yy, half * 2, 1, col);
        }
      }
    },
  };
}

/** 帆船：远处的一叶小帆。颜色按所在位置的背景亮度挑（比背景深一截，不用死黑），船下有一道随时间晃动的倒影 */
function boat(ctx: SilCtx, r: Rng, scene: Scene, fixed: number): SilLayer {
  const { W, H, S, L, lum, layer } = ctx;
  const u = detailUnit(S);
  const len = even(Math.max(S * (0.08 + r() * 0.05), 12)); // 粗格子下至少 6 格长，否则认不出是船
  const hx = Math.round(r() * Math.max(1, W - len - 4)) + 2;
  const hy = Math.round(H * (scene.horizon ?? 0.62));
  const mast = even(len * (1 + r() * 0.3));
  const tri = r() < 0.6, side = r() < 0.5 ? 1 : -1, ph = r() * 6.28;
  // 按背景亮度挑一阶：目标亮度 = 背景 × k，取最接近的色带
  const near = (target: number) => { let best = 0; for (let i = 1; i < L; i++) if (Math.abs(lum[i] - target) < Math.abs(lum[best] - target)) best = i; return best; };
  return {
    draw(cells, t) {
      const bg = layer[Math.min(H - 1, hy) * W + Math.min(W - 1, hx + (len >> 1))];
      const col = fixed >= 0 ? fixed : near(lum[bg] * 0.62), ref = near(lum[bg] * 0.85);
      const bob = Math.sin(t * 1.4 + ph) > 0.35 ? u : 0;
      const y = hy + bob;
      // 倒影：船下几行断续的短横，左右错开，随时间晃
      for (let k = 0; k < 4 * u; k++) {
        const yy = hy + 3 * u + k * 2;
        const w = Math.max(u, Math.round(len * (0.8 - k / (5 * u)) / 2) * 2);
        const off = Math.round(Math.sin(t * 2 + k + ph) * 1.5 * u);
        if ((k + Math.floor(t * 3)) % 3 !== 2) rect(ctx, cells, hx + ((len - w) >> 1) + off, yy, w, u, ref);
      }
      for (let k = 0; k < 2 * u; k++) { const inset = k >= u ? u : 0; rect(ctx, cells, hx + inset, y + k, len - 2 * inset, 1, col); } // 船身：下面一半收窄
      const mx = hx + Math.round(len * (side > 0 ? 0.35 : 0.65));
      rect(ctx, cells, mx, y - mast, u, mast, col);
      const sh = mast - 2 * u, sw = Math.round(len * 0.45);
      for (let yy = 0; yy < sh; yy++) {
        const w = tri ? Math.max(1, Math.round((sw * (yy + 1)) / sh)) : Math.round(sw * (0.6 + (0.4 * (yy + 1)) / sh));
        rect(ctx, cells, side > 0 ? mx + u : mx - w, y - mast + u + yy, w, 1, col);
      }
    },
  };
}

/** 灯塔：下宽上窄、横条纹、顶部灯室；光束左右扫过（提亮背景） */
function lighthouse(ctx: SilCtx, r: Rng, scene: Scene, col: number, stripe: number): SilLayer {
  const { W, H, S, L } = ctx;
  const h = even(S * (0.32 + r() * 0.16));
  const wb = even(S * (0.07 + r() * 0.03)), wt = Math.max(2, even(wb * 0.6));
  const left = r() < 0.5;
  const x0 = left ? ri(r, 2, Math.max(2, Math.round(W * 0.25))) : W - wb - ri(r, 2, Math.max(2, Math.round(W * 0.25)));
  const ground = Math.round(H * (scene.groundY ?? 0.86));
  const bands = 2 + Math.floor(r() * 3);
  const u = detailUnit(S);
  const cx = x0 + wb / 2, top = ground - h, lampY = top - 4 * u;
  const beam = r() < 0.8, per = 6 + r() * 4;
  const rock = Array.from({ length: 5 }, () => ri(r, 0, 2) * 2);
  return {
    draw(cells, t) {
      if (beam) { // 光束：从灯室向一侧张开的扇形，周期性左右扫
        const ph = ((t / per) % 1 + 1) % 1, dir = ph < 0.5 ? -1 : 1, on = Math.abs(Math.sin(ph * Math.PI * 2)) > 0.25;
        if (on) for (let y = Math.max(0, lampY - 10); y < Math.min(H, lampY + 12); y++)
          for (let x = 0; x < W; x++) {
            const dx = (x + 0.5 - cx) * dir, dy = y + 0.5 - (lampY + 1);
            if (dx > 3 * u && Math.abs(dy) < u + dx * 0.16) { const i = y * W + x; cells[i] = Math.min(L - 1, ctx.layer[i] + 1); }
          }
      }
      for (let y = top; y < ground; y++) {
        const f = (y - top) / h, w = Math.round((wt + (wb - wt) * f) / 2) * 2;
        const striped = Math.floor(f * bands * 2) % 2 === 1;
        rect(ctx, cells, Math.round(cx - w / 2), y, w, 1, striped ? stripe : col);
      }
      rect(ctx, cells, Math.round(cx - wt / 2) - u, top - u, wt + 2 * u, u, col); // 走廊
      rect(ctx, cells, Math.round(cx - wt / 2), lampY, wt, 3 * u, ctx.disc >= 0 ? ctx.disc : L - 1); // 灯室
      rect(ctx, cells, Math.round(cx - wt / 2), lampY - 2 * u, wt, 2 * u, col); // 屋顶
      for (let y = ground; y < H; y++) { // 礁石：从基座往下越来越宽，一直到底边
        const w = wb + 4 + Math.round(((y - ground) * 3) / 2) * 2 + rock[(y - ground) % rock.length];
        rect(ctx, cells, Math.round(cx - w / 2), y, w, 1, col);
      }
    },
  };
}
