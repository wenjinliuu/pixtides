export type Hex = string;
export type Variant = 'dawn' | 'day' | 'dusk' | 'night';
export type Layout = 'bands' | 'diagonal' | 'vertical' | 'radial';
export type Shape = 'square' | 'circle' | 'round';

/** 某个时段的配色：a 是手配色阶锚点（没有就由算法换色），glints 是该时刻才有的反光 / 发光色 */
export interface TimeSet {
  a?: Hex[];
  glints: Hex[];
}

/** 场景定义：加新画面只写一个这样的对象，不改引擎 */
export interface Scene {
  id: string;
  /** 编号前缀，两个字母 */
  code: string;
  cat: string;
  name: { zh: string; en: string };
  layout: Layout;
  /** 渐变方向（度），90 = 从上到下 */
  angle: number;
  /** 默认色带数 */
  steps: number;
  /** 参考图量化出的精确色阶（默认色带数时直接用） */
  pal?: Hex[];
  /** 配色锚点，按渐变起点 → 终点 */
  anchors?: Hex[];
  amp?: number;
  /** 台阶长短（格） */
  run: [number, number];
  patch?: number;
  dots?: number;
  glow?: Hex[];
  glowDensity?: number;
  silhouette?: 'moon';
  moon?: Hex;
  motion?: 'flow';
  /** 可能出现稀有彩蛋（鲸尾） */
  rare?: boolean;
  times?: Partial<Record<Exclude<Variant, 'day'>, TimeSet>>;
}

export interface SimOptions {
  /** 短边格数 */
  grid: number;
  ratio: [number, number];
  seed: number;
  angle: number | null;
  amp: number | null;
  /** 平台长短倍数 */
  terrace: number;
  bands: number | null;
  dots: number | null;
  /** 散落方块最大边长（半格） */
  dotMax: number;
  pair: number;
  invert: boolean;
  hue: number;
  variant: Variant;
  silhouette: boolean;
  silSeed: number;
  palette: Hex[] | null;
  /** 动画时间（秒） */
  time: number;
  /** 允许出现稀有彩蛋 */
  rare: boolean;
}
