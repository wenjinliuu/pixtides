// 编号：场景码 + 8 位 Crockford base32 种子（40 位）。不区分大小写，不用 I L O U，适合印在图上让人照着念、照着敲。

import { SEED_SPACE } from './rng';
import type { Scene } from './types';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function b32(n: number, len: number): string {
  let s = '';
  n = Math.floor(n);
  do { s = B32[n % 32] + s; n = Math.floor(n / 32); } while (n);
  return s.padStart(len, '0');
}

/** 显示用：大写、分组，例如 SH-7KQ9-ZT2M */
export function shortCode(scene: Scene, seed: number): string {
  const body = b32(seed, 8);
  return scene.code.toUpperCase() + '-' + body.slice(0, 4) + '-' + body.slice(4);
}

/** 解析：忽略大小写、连字符和空格；O 当 0，I / L 当 1。认不出返回 null */
export function parseCode(str: string, scenes: readonly Scene[]): { scene: Scene; seed: number } | null {
  const raw = String(str).toUpperCase().replace(/[\s-]/g, '');
  const scene = scenes.find((x) => x.code.toUpperCase() === raw.slice(0, 2));
  if (!scene) return null;
  const body = raw.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!body || body.length > 8 || /[^0-9A-HJKMNP-TV-Z]/.test(body)) return null;
  let n = 0;
  for (const ch of body) n = n * 32 + B32.indexOf(ch);
  return n >= SEED_SPACE ? null : { scene, seed: n };
}
