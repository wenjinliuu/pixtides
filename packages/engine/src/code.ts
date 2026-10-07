// 编号就是配方：场景码 + 8 位种子 + （可选）改动过的参数。
// Crockford base32：不区分大小写，不用 I L O U，适合印在图上让人照着念、照着敲。
//
// 格式 v1：
//   SH-7KQ9-ZT2M            没改参数（10 位）
//   SH-7KQ9-ZT2M-3F0Q       改过参数：最后一段 = 14 位"改了哪些"的标记 + 各参数的值，按 5 位一个字符写出
// 以后格式升级时在最前面加版本字符；不带版本字符的编号永远按 v1 解析，老链接还原原样。

import { SEED_SPACE } from './rng';
import type { Scene, SimOptions, Variant } from './types';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function b32(n: number, len: number): string {
  let s = '';
  n = Math.floor(n);
  do { s = B32[n % 32] + s; n = Math.floor(n / 32); } while (n);
  return s.padStart(len, '0');
}

/** 画面比例（编号里存下标，顺序不能改，只能往后加） */
export const RATIOS = [
  { id: '1x1', r: [1, 1], label: '1:1' },
  { id: '9x16', r: [9, 16], label: '9:16' },
  { id: '9x19_5', r: [9, 19.5], label: '9:19.5' },
  { id: '16x9', r: [16, 9], label: '16:9' },
  { id: '16x10', r: [16, 10], label: '16:10' },
  { id: '21x9', r: [21, 9], label: '21:9' },
  { id: '3x4', r: [3, 4], label: '3:4' },
  { id: '4x5', r: [4, 5], label: '4:5' },
] as const satisfies readonly { id: string; r: [number, number]; label: string }[];
export type RatioId = (typeof RATIOS)[number]['id'];

/** 像素粒度（编号里存下标） */
export const GRIDS = [12, 16, 24, 32, 48, 64, 96, 128] as const;
const VARIANTS: Variant[] = ['dawn', 'day', 'dusk', 'night'];

/** 一张图的完整配方：编号能完整还原它 */
export interface Recipe {
  scene: Scene;
  seed: number;
  grid: number;
  ratio: RatioId;
  variant: Variant;
  hue: number;
  invert: boolean;
  angle: number | null;
  amp: number | null;
  terrace: number;
  bands: number | null;
  dots: number | null;
  dotMax: number;
  pair: number;
  silhouette: boolean;
  silSeed: number;
}

export const RECIPE_DEFAULTS: Omit<Recipe, 'scene' | 'seed'> = {
  grid: 32, ratio: '1x1', variant: 'day', hue: 0, invert: false, angle: null, amp: null, terrace: 1,
  bands: null, dots: null, dotMax: 5, pair: 0.22, silhouette: true, silSeed: 0,
};

/** 配方 → 引擎参数 */
export function recipeOptions(r: Recipe): Partial<SimOptions> {
  const ratio = RATIOS.find((x) => x.id === r.ratio)!.r;
  return {
    seed: r.seed, grid: r.grid, ratio: [ratio[0], ratio[1]], variant: r.variant, hue: r.hue, invert: r.invert, angle: r.angle,
    amp: r.amp, terrace: r.terrace, bands: r.bands, dots: r.dots, dotMax: r.dotMax, pair: r.pair, silhouette: r.silhouette, silSeed: r.silSeed,
  };
}

// 参数字段：顺序即标记位顺序，只能往后加。enc / dec 把值量化到界面滑块的步长
interface Field { key: keyof Omit<Recipe, 'scene' | 'seed'>; bits: number; enc: (v: never) => number; dec: (n: number) => unknown }
const tenths = (lo: number) => ({ enc: (v: number) => Math.round(v * 10) - lo, dec: (n: number) => (n + lo) / 10 });
const FIELDS: Field[] = [
  { key: 'grid', bits: 3, enc: (v: number) => Math.max(0, GRIDS.indexOf(v as (typeof GRIDS)[number])), dec: (n) => GRIDS[n] },
  { key: 'ratio', bits: 3, enc: (v: RatioId) => RATIOS.findIndex((x) => x.id === v), dec: (n) => RATIOS[n].id },
  { key: 'variant', bits: 2, enc: (v: Variant) => VARIANTS.indexOf(v), dec: (n) => VARIANTS[n] },
  { key: 'hue', bits: 9, enc: (v: number) => Math.round(v) % 360, dec: (n) => n % 360 },
  { key: 'invert', bits: 0, enc: () => 0, dec: () => true },
  { key: 'angle', bits: 9, enc: (v: number) => Math.round(v) % 360, dec: (n) => n % 360 },
  { key: 'amp', bits: 5, ...tenths(0) }, // 0–2.0
  { key: 'terrace', bits: 5, ...tenths(4) }, // 0.4–2.5
  { key: 'bands', bits: 3, enc: (v: number) => v - 4, dec: (n) => n + 4 }, // 4–10
  { key: 'dots', bits: 5, ...tenths(0) }, // 0–3.0
  { key: 'dotMax', bits: 2, enc: (v: number) => v - 2, dec: (n) => n + 2 }, // 2–5
  { key: 'pair', bits: 5, enc: (v: number) => Math.round(v * 50), dec: (n) => n / 50 }, // 0–0.6，步长 0.02
  { key: 'silhouette', bits: 0, enc: () => 0, dec: () => false },
  { key: 'silSeed', bits: 4, enc: (v: number) => Math.min(15, v), dec: (n) => n },
];

/** 显示用：大写、分组，例如 SH-7KQ9-ZT2M 或 SH-7KQ9-ZT2M-3F0Q */
export function encodeRecipe(r: Recipe): string {
  const body = b32(r.seed, 8);
  let code = r.scene.code.toUpperCase() + '-' + body.slice(0, 4) + '-' + body.slice(4);
  let mask = 0, bits = '';
  FIELDS.forEach((f, i) => {
    const v = r[f.key], d = RECIPE_DEFAULTS[f.key];
    if (v === d) return;
    const n = (f.enc as (x: unknown) => number)(v);
    if (f.bits && (n < 0 || n >= 2 ** f.bits)) return; // 超出可编码范围的值不写（界面不会产生）
    mask |= 1 << i;
    if (f.bits) bits += n.toString(2).padStart(f.bits, '0');
  });
  if (!mask) return code;
  bits = mask.toString(2).padStart(FIELDS.length, '0') + bits;
  bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0');
  let tail = '';
  for (let i = 0; i < bits.length; i += 5) tail += B32[parseInt(bits.slice(i, i + 5), 2)];
  return code + '-' + tail;
}

/** 只有场景和种子的编号（今日一张、我的海等用默认参数的图） */
export function shortCode(scene: Scene, seed: number): string {
  return encodeRecipe({ scene, seed, ...RECIPE_DEFAULTS });
}

/** 解析：忽略大小写、连字符和空格；O 当 0，I / L 当 1。认不出返回 null */
export function parseRecipe(str: string, scenes: readonly Scene[]): Recipe | null {
  const raw = String(str).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const scene = scenes.find((x) => x.code.toUpperCase() === raw.slice(0, 2));
  if (!scene) return null;
  const body = raw.slice(2, 10), tail = raw.slice(10);
  if (!body || /[^0-9A-HJKMNP-TV-Z]/.test(raw.slice(2))) return null;
  let seed = 0;
  for (const ch of body) seed = seed * 32 + B32.indexOf(ch);
  if (seed >= SEED_SPACE) return null;
  const r: Recipe = { scene, seed, ...RECIPE_DEFAULTS };
  if (!tail) return r;
  if (body.length < 8) return null;
  const bits = Array.from(tail, (ch) => B32.indexOf(ch).toString(2).padStart(5, '0')).join('');
  const mask = parseInt(bits.slice(0, FIELDS.length), 2);
  let pos = FIELDS.length;
  for (let i = 0; i < FIELDS.length; i++) {
    if (!(mask & (1 << i))) continue;
    const f = FIELDS[i];
    if (pos + f.bits > bits.length) return null;
    const n = f.bits ? parseInt(bits.slice(pos, pos + f.bits), 2) : 0;
    pos += f.bits;
    const v = f.dec(n);
    if (v === undefined) return null;
    (r as unknown as Record<string, unknown>)[f.key] = v;
  }
  return r;
}

/** 兼容：只取场景和种子 */
export function parseCode(str: string, scenes: readonly Scene[]): { scene: Scene; seed: number } | null {
  const r = parseRecipe(str, scenes);
  return r ? { scene: r.scene, seed: r.seed } : null;
}
