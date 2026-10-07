// 绘制：Canvas 预览、动画（只重画变化的格子）、逐格溶解。

import type { Sim } from './sim';

const hexInt = (h: string) => parseInt(h.slice(1), 16);
const intHex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** 每格对齐到整数像素：第 i 格占 round(i·f) 到 round((i+1)·f)，除不尽时相邻格子差 1 px */
export function edges(n: number, px: number): Int32Array<ArrayBuffer> {
  const e = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) e[i] = Math.round((i * px) / n);
  return e;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 把整张图画到 ctx（同色横向合并） */
export function paint(ctx: Ctx2D, sim: Sim, w: number, h: number): void {
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

interface Dissolve { from: Int32Array; sel: Uint8Array; order: Uint32Array; done: number; t0: number; ms: number }

/** 视图：只重画颜色变化的格子；支持逐格溶解（按随机顺序把格子换成新颜色） */
export class View {
  readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  sim: Sim | null = null;
  w = 0;
  h = 0;
  private xe = new Int32Array(0);
  private ye = new Int32Array(0);
  private shown = new Int32Array(0);
  private diss: Dissolve | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  attach(sim: Sim, w: number, h: number): void {
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

  /** 记录当前画面，之后在 ms 毫秒内按随机顺序把格子换成新颜色 */
  dissolve(ms: number): void {
    const n = this.shown.length;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    this.diss = { from: this.shown.slice(), sel: new Uint8Array(n), order, done: 0, t0: performance.now(), ms };
  }

  get busy(): boolean { return !!this.diss; }

  render(): void {
    const sim = this.sim!;
    const { ctx, xe, ye, shown } = this, W = sim.W, H = sim.H, cells = sim.cells;
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
