// 文字种子规则 v1：日期、名字、生日用同一套规则。规则发布后永不修改；要改就出 v2，旧编号继续按 v1 算。
// 先规范化文字，再算 SHA-256('pixtides/v1/<类型>/<文字>')，取前 5 字节（40 位）做构图种子。
// 文字只决定"底座构图"（色带怎么拐、岛和方块放在哪），画面、配色、粒度、起伏等全部留给用户选。

import { hashStr, mulberry32, sha256 } from './rng';
import type { Scene } from './types';

export function normalizeText(s: string): string {
  return String(s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 名字：在通用规范化之上去掉所有空格和常见分隔符（· ・ - _ . ' ’）。繁简、假名、带重音的字母不合并 */
export function normalizeName(s: string): string {
  return normalizeText(s).replace(/[\s·・\-_.'’]/g, '');
}

/** 日期统一成 YYYY-MM-DD：2026-10-7、2026/10/07、2026.10.7、20261007、2026年10月7日 都可以；无效日期返回 null */
export function normalizeDate(s: string): string | null {
  const t = String(s).normalize('NFKC').trim();
  const m = t.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export type SeedKind = 'day' | 'name' | 'md' | 'name+date';

export function textSeed(kind: SeedKind, text: string): number {
  const H = sha256('pixtides/v1/' + kind + '/' + text);
  return H[0] * 256 + (H[1] >>> 24); // 前 5 字节：约 1.1 万亿种
}

export function localDateKey(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- 今日一张 v1 ----------
// 日期 = 访问者本地日期（年月日）；2026-10-07 是第 1 张，之前的日期也能算（生日就用它）。
// 画面按"每轮把全部画面打乱后轮一遍"排期，相邻两天不会是同一个画面；种子 = 文字种子('day', 日期)。
const TODAY_EPOCH = Date.UTC(2026, 9, 7);

function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - TODAY_EPOCH) / 864e5);
}
function rawOrder(cycle: number, S: number): number[] {
  const r = mulberry32(hashStr('pixtides/today/v1/cycle/' + cycle));
  const a = Array.from({ length: S }, (_, i) => i);
  for (let i = S - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export interface DayPick { key: string; no: number; scene: Scene; seed: number }

export function dayPick(key: string, pool: readonly Scene[]): DayPick {
  const n = dayIndex(key), S = pool.length;
  const cycle = Math.floor(n / S), pos = ((n % S) + S) % S;
  const order = rawOrder(cycle, S);
  if (S > 1 && order[0] === rawOrder(cycle - 1, S)[S - 1]) [order[0], order[1]] = [order[1], order[0]];
  return { key, no: n + 1, scene: pool[order[pos]], seed: textSeed('day', key) };
}

/** 名字（或任意一句话）：同一句话永远是同一个构图；画面由用户选 */
export function namePick(text: string, scene: Scene): { text: string; scene: Scene; seed: number } | null {
  const norm = normalizeName(text);
  if (!norm) return null;
  return { text: norm, scene, seed: textSeed('name', norm) };
}

/** 生日：含年份 = 那一天今日一张的构图种子；不含年份 = 只按月日，同一天生日的人共享一个构图 */
export function birthdayPick(key: string, pool: readonly Scene[], withYear: boolean, scene: Scene) {
  if (withYear) {
    const d = dayPick(key, pool);
    return { scene, seed: d.seed, no: d.no as number | undefined, daySceneOfDate: d.scene as Scene | undefined, date: key };
  }
  const md = key.slice(5);
  return { scene, seed: textSeed('md', md), no: undefined, daySceneOfDate: undefined, date: md };
}

/** 名字 + 生日：两者一起决定构图，重名的人也能各有一张 */
export function comboPick(text: string, key: string, withYear: boolean, scene: Scene) {
  const norm = normalizeName(text);
  if (!norm) return null;
  const date = withYear ? key : key.slice(5);
  return { text: norm, date, scene, seed: textSeed('name+date', norm + '|' + date) };
}
