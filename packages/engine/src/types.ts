export type Hex = string;
export type Variant = 'dawn' | 'day' | 'dusk' | 'night';
export type Layout = 'bands' | 'diagonal' | 'vertical' | 'radial';
export type Shape = 'square' | 'circle' | 'round';
/** 剪影种类：月亮 / 太阳 / 群山 / 树 / 帆船 / 灯塔 */
export type SilKind = 'moon' | 'sun' | 'mountains' | 'trees' | 'boat' | 'lighthouse';

/** 某个时段的配色：a 是手配色阶锚点（没有就由算法换色），glints 是该时刻才有的反光 / 发光色 */
export interface TimeSet {
  /** 这套配色的名字（编辑器里显示） */
  name?: { zh: string; en: string };
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
  /** 剪影，可以叠几种，按顺序画（先远后近） */
  silhouette?: SilKind | SilKind[];
  /** 圆盘色：月亮、太阳、灯室 */
  moon?: Hex;
  /** 群山：各层颜色（色带位置 0..1，远 → 近）、积雪颜色、峰顶与山脚的高度（占画面高度） */
  /** colors / snowColor：群山自带的颜色（远 → 近），跟着时段一起换色；不写就从色带里取 tones */
  ridge?: { tones: number[]; snow?: number; top?: [number, number]; colors?: Hex[]; snowColor?: Hex };
  /** 树 / 帆船 / 灯塔的颜色（色带位置 0..1） */
  silTone?: number;
  /** 树 / 帆船 / 灯塔自带的颜色（色带里没有合适的深色时用），优先于 silTone */
  silColor?: Hex;
  /** 灯塔条纹颜色 */
  stripeTone?: number;
  treeKind?: 'pine' | 'round';
  /** 松树每层顶上压一道雪（雪景） */
  treeSnow?: boolean;
  /** 树和灯塔站在哪条线上（占画面高度，1 = 底边） */
  groundY?: number;
  /** 帆船所在的水平线 */
  horizon?: number;
  /** 太阳圆心的高度范围 */
  sunY?: [number, number];
  /** 光点怎么动：闪烁（默认）/ 飘落（雪、花瓣）/ 雨丝 */
  glowMotion?: 'twinkle' | 'fall' | 'rain';
  /** 闪电颜色：有它就会不时劈下一道闪电 */
  bolt?: Hex;
  /** 晨 / 昏往天色靠拢的程度（默认 1）；暖色画面用 0.4–0.6，保住自己的颜色 */
  tint?: number;
  /** 径向构图的圆心（相对画面中心，单位 = 短边），不写就在中心附近随机 */
  center?: [number, number];
  motion?: 'flow';
  /** 可能出现稀有彩蛋（鲸尾） */
  rare?: boolean;
  times?: Partial<Record<Exclude<Variant, 'day'>, TimeSet>>;
  /** 默认配色（day 那一套）的名字 */
  look?: { zh: string; en: string };
  /**
   * 编辑器里给用户选的精选配色，按显示顺序；不写就只有默认一套。
   * 编号里沿用原来存时段的 2 位：day / dawn / dusk / night 四个槽位就是最多 4 套配色
   */
  presets?: Variant[];
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
  /** 饱和度倍数（1 = 原样） */
  sat: number;
  /** 明暗偏移（OKLCH 亮度，0 = 原样） */
  light: number;
  variant: Variant;
  silhouette: boolean;
  silSeed: number;
  palette: Hex[] | null;
  /** 动画时间（秒） */
  time: number;
  /** 允许出现稀有彩蛋 */
  rare: boolean;
}
