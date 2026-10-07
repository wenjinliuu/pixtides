// 颜色：OKLCH 插值、晨 / 昏 / 夜换色、界面配色。所有色板都是纯色值，不用透明度。

import type { Hex, Variant } from './types';

/** [L, C, H]：亮度 0–1、彩度、色相（度） */
export type Lch = [number, number, number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function hexToRgb(hex: Hex): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex(rgb: number[]): Hex {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function rgbToOklab(rgb: number[]): [number, number, number] {
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
function oklabToRgb(L: number, a: number, b: number): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: Hex): Lch {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

/** 超出 sRGB 时降低彩度，保持亮度和色相 */
export function oklchToHex(lch: Lch): Hex {
  const L = Math.max(0, Math.min(1, lch[0]));
  const h = (lch[2] * Math.PI) / 180;
  let c = lch[1];
  for (let i = 0; i < 30; i++) {
    const rgb = oklabToRgb(L, c * Math.cos(h), c * Math.sin(h));
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(rgb.map(toGam));
    c *= 0.88;
  }
  return rgbToHex(oklabToRgb(L, 0, 0).map(toGam));
}

function mixLch(A: Lch, B: Lch, t: number): Lch {
  let h1 = A[2], h2 = B[2];
  if (A[1] < 0.02) h1 = h2;
  if (B[1] < 0.02) h2 = h1;
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, (h1 + dh * t + 360) % 360];
}

/** 锚点 → n 个色阶（锚点等距分布） */
export function ramp(anchors: Hex[], n: number): Hex[] {
  const A = anchors.map(hexToOklch);
  if (n <= 1) return [oklchToHex(A[0])];
  const out: Hex[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (A.length - 1);
    const k = Math.min(A.length - 2, Math.floor(t));
    out.push(oklchToHex(mixLch(A[k], A[k + 1], t - k)));
  }
  return out;
}

/** 用户调色：色相旋转 + 饱和度倍数 + 明暗偏移。只转色相时与 hueRotate 完全一致（老编号逐格不变） */
export function adjust(hex: Hex, hue: number, sat = 1, light = 0): Hex {
  if (sat === 1 && !light) return hueRotate(hex, hue);
  const c = hexToOklch(hex);
  c[0] = Math.max(0, Math.min(1, c[0] + light));
  c[1] = Math.max(0, c[1] * sat);
  c[2] = (c[2] + hue) % 360;
  return oklchToHex(c);
}

export function hueRotate(hex: Hex, deg: number): Hex {
  if (!deg) return hex;
  const c = hexToOklch(hex);
  c[2] = (c[2] + deg) % 360;
  return oklchToHex(c);
}

/** 往天色转时一律走"色相增大"的方向（蓝 → 紫 → 玫瑰 → 橘），只有目标就在身后一点点时才往回转 */
const hueToward = (h1: number, h2: number, t: number) => {
  let dh = (((h2 - h1) % 360) + 360) % 360;
  if (dh > 300) dh -= 360;
  return (h1 + dh * t + 360) % 360;
};

const hueShort = (h1: number, h2: number, t: number) => {
  let dh = (((h2 - h1) % 360) + 540) % 360 - 180;
  return (h1 + dh * t + 360) % 360;
};

interface SkySpec { kd?: number; kl?: number; cs?: number; k?: number; stops: Lch[] }
/**
 * 每个时段取这段时间里最好看的那一刻做基调：
 * 晨 = 柔和的晨光（蓝灰、藕紫、淡玫瑰、淡杏，饱和度压低）；
 * 昏 = 蓝调时刻（深钴蓝、群青、薰衣草，地平线一抹粉）；
 * 夜 = 深海军蓝 → 灰蓝 → 月光下的冷灰蓝（场景有手配夜色板时优先用手配）。
 * 按每一阶在色板里的明暗位置对上天色，kd / kl 是暗部 / 亮部靠拢的程度。
 */
const SKY: Record<Exclude<Variant, 'day'>, SkySpec> = {
  dawn: { kd: 0.45, kl: 0.85, cs: 0.7, stops: [[0.36, 0.05, 250], [0.58, 0.06, 275], [0.76, 0.06, 320], [0.88, 0.05, 15], [0.95, 0.04, 60]] },
  dusk: { kd: 0.6, kl: 0.88, cs: 1, stops: [[0.22, 0.13, 262], [0.4, 0.16, 270], [0.58, 0.13, 292], [0.74, 0.1, 330], [0.88, 0.08, 15]] },
  night: { k: 0.72, stops: [[0.14, 0.05, 268], [0.34, 0.08, 260], [0.66, 0.06, 245]] },
};
function skyAt(stops: Lch[], r: number): Lch {
  const t = Math.max(0, Math.min(1, r)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(t));
  const A = stops[k], B = stops[k + 1], f = t - k;
  return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, hueToward(A[2], B[2], f)];
}

/** strength：往天色靠拢的程度，1 = 完全按天色（海与水）；暖色或本身颜色就是主体的画面用小一点，保住自己的颜色 */
export function variantPalette(pal: Hex[], kind: Variant, strength = 1): Hex[] {
  if (kind === 'day') return pal.slice();
  const sky = SKY[kind];
  const lch = pal.map(hexToOklch), Ls = lch.map((c) => c[0]);
  const lo = Math.min(...Ls), hi = Math.max(...Ls);
  return lch.map((c) => {
    const r = hi > lo ? (c[0] - lo) / (hi - lo) : 0.5, tg = skyAt(sky.stops, r);
    if (kind === 'night') return oklchToHex([c[0] + (tg[0] - c[0]) * sky.k!, c[1] + (tg[1] - c[1]) * sky.k!, tg[2]]);
    const k = (sky.kd! + (sky.kl! - sky.kd!) * r) * strength;
    // 海与水（strength = 1）沿用"往色相增大方向转"；暖色画面走最短的色相弧（橙 → 红 → 紫），不会经过绿色
    const hue = strength < 1 ? hueShort(c[2], tg[2], k) : hueToward(c[2], tg[2], k);
    return oklchToHex([c[0] + (tg[0] - c[0]) * k, (c[1] + (tg[1] - c[1]) * k) * sky.cs!, hue]);
  });
}

export interface UiTokens {
  bg: Hex; panel: Hex; raise: Hex; line: Hex; muted: Hex; fg: Hex; accent: Hex; onAccent: Hex; shadow: Hex; deep: Hex;
}

/** 界面配色：从当前画面推出。dark 用最深色阶做深底；light 用浅底、最深色阶做强调色 */
export function uiTokens(pal: Hex[], mode: 'dark' | 'light'): UiTokens {
  let darkest = pal[0], lightest = pal[0];
  for (const h of pal) {
    if (hexToOklch(h)[0] < hexToOklch(darkest)[0]) darkest = h;
    if (hexToOklch(h)[0] > hexToOklch(lightest)[0]) lightest = h;
  }
  const d = hexToOklch(darkest), hue = d[2], chroma = Math.min(d[1] * 0.45, 0.045);
  const li = hexToOklch(lightest);
  if (mode === 'light') {
    return {
      bg: oklchToHex([0.975, Math.min(chroma * 0.4, 0.014), hue]),
      panel: oklchToHex([0.952, Math.min(chroma * 0.5, 0.018), hue]),
      raise: oklchToHex([0.99, Math.min(chroma * 0.3, 0.01), hue]),
      line: oklchToHex([0.84, Math.min(chroma * 0.8, 0.03), hue]),
      muted: oklchToHex([0.48, Math.min(chroma, 0.035), hue]),
      fg: oklchToHex([0.2, Math.min(chroma, 0.04), hue]),
      accent: oklchToHex([Math.min(d[0], 0.42), Math.max(d[1], 0.06), hue]),
      onAccent: oklchToHex([0.985, 0.01, hue]),
      shadow: oklchToHex([0.74, Math.min(chroma, 0.03), hue]),
      deep: darkest,
    };
  }
  return {
    bg: oklchToHex([0.14, chroma, hue]),
    panel: oklchToHex([0.18, chroma, hue]),
    raise: oklchToHex([0.235, chroma * 1.1, hue]),
    line: oklchToHex([0.34, chroma * 1.2, hue]),
    muted: oklchToHex([0.72, chroma * 0.8, hue]),
    fg: oklchToHex([0.96, Math.min(chroma, 0.02), hue]),
    accent: oklchToHex([Math.max(0.82, li[0]), Math.min(li[1], 0.14), li[2]]),
    onAccent: oklchToHex([0.14, chroma, hue]),
    shadow: oklchToHex([0.08, chroma, hue]),
    deep: darkest,
  };
}
