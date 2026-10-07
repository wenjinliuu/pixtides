// 导出：分辨率档位、形状（方 / 圆 / 圆角，硬边不抗锯齿）、SVG、Canvas 预览图与一对头像。

import { paint } from './render';
import type { Sim } from './sim';
import type { Shape } from './types';

/**
 * 横向比例按长边 1920 / 2560 / 3840 / 5120 / 7680；竖向比例按短边 1080 / 1440 / 2160 / 2880 / 4320（手机壁纸不缩水）；
 * 1:1 用 1080 / 2048 / 4096 / 5120 / 8192
 */
export const TIERS = [
  { id: '1080p', long: 1920, short: 1080, square: 1080 },
  { id: '2K', long: 2560, short: 1440, square: 2048 },
  { id: '4K', long: 3840, short: 2160, square: 4096 },
  { id: '5K', long: 5120, short: 2880, square: 5120 },
  { id: '8K', long: 7680, short: 4320, square: 8192 },
] as const;
export type TierId = (typeof TIERS)[number]['id'];

export function exportSize(tierId: TierId, ratio: [number, number]): [number, number] {
  const t = TIERS.find((x) => x.id === tierId) || TIERS[0];
  const [a, b] = ratio;
  const even = (v: number) => Math.round(v / 2) * 2;
  if (a === b) return [t.square, t.square];
  return a > b ? [t.long, even((t.long * b) / a)] : [t.short, even((t.short * b) / a)];
}

/** 形状在第 y 行的可见区间 [x0, x1)；整行不可见返回 null */
export function rowSpan(shape: Shape, y: number, w: number, h: number): [number, number] | null {
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

function maskShape(ctx: CanvasRenderingContext2D, w: number, h: number, shape: Shape): void {
  if (shape === 'square') return;
  for (let y = 0; y < h; y++) {
    const sp = rowSpan(shape, y, w, h);
    if (!sp) { ctx.clearRect(0, y, w, 1); continue; }
    if (sp[0] > 0) ctx.clearRect(0, y, sp[0], 1);
    if (sp[1] < w) ctx.clearRect(sp[1], y, w - sp[1], 1);
  }
}

/** 画到新 canvas（用于预览和小尺寸导出；大尺寸 PNG 用 encodePNG，不经过 canvas） */
export function toCanvas(sim: Sim, w: number, h: number, shape: Shape = 'square'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  paint(ctx, sim, w, h);
  maskShape(ctx, w, h, shape);
  return cv;
}

/** 一对头像：画一张 2:1 的图，左右各取一半，并排时浪是连着的 */
export function pairCanvases(sim: Sim, size: number, shape: Shape): [HTMLCanvasElement, HTMLCanvasElement] {
  const whole = document.createElement('canvas');
  whole.width = size * 2; whole.height = size;
  paint(whole.getContext('2d')!, sim, size * 2, size);
  const half = (k: number) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(whole, k * size, 0, size, size, 0, 0, size, size);
    maskShape(ctx, size, size, shape);
    return cv;
  };
  return [half(0), half(1)];
}

/** SVG：同色横向合并成长矩形，任意放大都清晰 */
export function toSVG(sim: Sim, w: number, h: number, shape: Shape = 'square'): string {
  const { W, H, cells, pal } = sim, out: string[] = [];
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
