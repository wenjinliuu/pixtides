import type { Variant } from './types';

/** 时段边界（本地时间）：晨 5–9 点，昼 10–16 点，昏 17–19 点，夜 20–次日 4 点 */
export function timeOfDay(date: Date = new Date()): Variant {
  const h = date.getHours();
  if (h >= 5 && h < 10) return 'dawn';
  if (h >= 10 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

/**
 * 全球同步：动画时间 = 从 2026-01-01 00:00 UTC 起算的秒数（连续不跳）。
 * 画面（种子）由今日一张决定，浪由这个时间决定：同一时刻、同样大小的屏幕看到同一片浪。
 */
const SYNC_EPOCH = Date.UTC(2026, 0, 1);
export function globalTime(now?: Date): number {
  return ((now ? now.getTime() : Date.now()) - SYNC_EPOCH) / 1000;
}
