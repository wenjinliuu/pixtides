// @pixtides/scenes：场景定义。加新画面只在这里加一个对象，不改引擎。
// 配色：每个画面自己的几套精选配色（presets，最多 4 套，占用 day / dawn / dusk / night 四个槽位）。
// 海与水保留原来的晨 / 昏 / 夜数据，老编号照样还原；界面上只给精选的几套。

import type { Scene, TimeSet } from '@pixtides/engine';

/** 蓝调时刻的反光：零星暖色灯光 + 淡粉余光 */
const BLUE_HOUR: TimeSet = { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] };
/** 夜里的星光 */
const STARS = ['#FFFFFF', '#E8F0FF', '#FFF2C8'];

export const SCENES: readonly Scene[] = [
  // ---------- 海与水（V0） ----------
  {
    id: 'shoal', code: 'sh', cat: 'sea', name: { zh: '浅滩', en: 'Shoal' }, layout: 'bands', angle: 94, steps: 6,
    pal: ['#0009F1', '#064EFE', '#1696FD', '#58DAFD', '#97F8FC', '#A9FBFD'], amp: 1, run: [2, 6], patch: 1.2, dots: 1, rare: true,
    times: {
      dawn: { glints: ['#FFE7D6', '#FFC9C9'] },
      dusk: BLUE_HOUR,
      night: { a: ['#030616', '#0B1A3A', '#1F3A66', '#5C7FA8'], glints: ['#E8F0FF', '#AFC8F0'] },
    },
  },
  {
    id: 'swell', code: 'sw', cat: 'sea', name: { zh: '斜浪', en: 'Swell' }, layout: 'diagonal', angle: 124, steps: 6,
    pal: ['#000FE8', '#0559FE', '#118DFE', '#59D3FD', '#83EDFD', '#A5F9FD'], amp: 0.8, run: [1, 3], patch: 0.8, dots: 1.1, rare: true,
    times: {
      dawn: { glints: ['#FFEADF', '#FFD0D6'] },
      dusk: BLUE_HOUR,
      night: { a: ['#02050F', '#0A1B33', '#1D4060', '#6A90B0'], glints: ['#EAF3FF', '#9FC2E6'] },
    },
  },
  {
    id: 'tide', code: 'td', cat: 'sea', name: { zh: '潮汐', en: 'Tide' }, layout: 'diagonal', angle: 108, steps: 6,
    pal: ['#0113EE', '#0E53FE', '#1E8CFD', '#4DC6FD', '#8BEEFD', '#A3F8FD'], amp: 1.3, run: [1, 4], patch: 1, dots: 1.2, rare: true,
    times: {
      dawn: { glints: ['#FFF1E6', '#FFCFD2'] },
      dusk: BLUE_HOUR,
      night: { a: ['#030716', '#0E2240', '#27507A', '#8FB0D0'], glints: ['#F0F6FF', '#B5CDEB'] },
    },
  },
  {
    id: 'abyss', code: 'ab', cat: 'sea', name: { zh: '深海', en: 'Abyss' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#3EC0FD', '#000DEB', '#020338'], amp: 1, run: [2, 5], patch: 0.8, dots: 0.9, rare: true,
    glow: ['#5AD6FD', '#A4F9FD', '#D8FEFF'], glowDensity: 70,
    times: { // 起点是水面
      dawn: { glints: ['#FFE3D6', '#C9B8F0', '#FFF4EC'] },
      dusk: BLUE_HOUR,
      night: { a: ['#3A5C86', '#12244A', '#050B1E', '#010208'], glints: ['#7FE0FF', '#B8F4FF', '#5AA8FF'] }, // 深海荧光
    },
  },
  {
    id: 'reef', code: 'rf', cat: 'sea', name: { zh: '珊瑚礁', en: 'Coral Reef' }, layout: 'bands', angle: 92, steps: 7,
    anchors: ['#0FB8D8', '#38E0C8', '#FF8FA8'], amp: 1.1, run: [1, 4], patch: 1.2, dots: 1, rare: true,
    glow: ['#FFF1A6', '#FFFFFF', '#FF5C8A'], glowDensity: 90,
    times: {
      dawn: { glints: ['#FFF1E0', '#FFC2C8'] },
      dusk: BLUE_HOUR,
      night: { a: ['#06223A', '#0D4A5C', '#3A3F6E', '#7A5A8A'], glints: ['#6FF2E0', '#B8FFF4', '#9AA8FF'] },
    },
  },
  {
    id: 'moonsea', code: 'ms', cat: 'sea', name: { zh: '月下海', en: 'Moonlit Sea' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#020442', '#1A3A9E', '#C8D8FF'], amp: 0.8, run: [3, 7], patch: 0.7, dots: 0.8, rare: true,
    silhouette: 'moon', moon: '#F4F6FF',
    times: { // 本身是月夜；晨 / 昏是月亮还挂着的天色
      dawn: { glints: ['#FFF3EA'] },
      dusk: BLUE_HOUR,
      night: { a: ['#01020F', '#0B1440', '#3A5490', '#A8B8E0'], glints: ['#F2F6FF'] },
    },
  },
  {
    id: 'icelake', code: 'il', cat: 'sea', name: { zh: '冰湖', en: 'Ice Lake' }, layout: 'radial', angle: 0, steps: 7,
    anchors: ['#E8FEFF', '#7FD8F0', '#2A6FB8'], amp: 1.2, run: [1, 3], patch: 1, dots: 0.8,
    times: { // 起点是中心
      dawn: { glints: ['#FFFFFF', '#FFE0E6'] },
      dusk: BLUE_HOUR,
      night: { a: ['#C9D8F0', '#6F8DB8', '#2A3E70', '#0C1430'], glints: ['#FFFFFF', '#D8E8FF'] },
    },
  },
  {
    id: 'ripple', code: 'rp', cat: 'sea', name: { zh: '涟漪', en: 'Ripple' }, layout: 'radial', angle: 0, steps: 7,
    anchors: ['#C2FCFE', '#148FFD', '#02087A'], amp: 0.8, run: [1, 3], patch: 0.8, dots: 1,
    times: {
      dawn: { glints: ['#FFF6F0', '#FFD3DA'] },
      dusk: BLUE_HOUR,
      night: { a: ['#B8D4F0', '#3A64A0', '#10204A', '#02040F'], glints: ['#FFFFFF', '#CFE2FF'] },
    },
  },
  {
    id: 'waterfall', code: 'wf', cat: 'sea', name: { zh: '瀑布', en: 'Waterfall' }, layout: 'vertical', angle: 0, steps: 6,
    anchors: ['#000DEB', '#3EC0FD', '#C8FDFF'], amp: 1.4, run: [3, 9], patch: 1, dots: 1, motion: 'flow',
    times: {
      dawn: { glints: ['#FFFFFF', '#FFDDE4'] },
      dusk: BLUE_HOUR,
      night: { a: ['#020616', '#142C55', '#4D74A8', '#C8D8F0'], glints: ['#FFFFFF', '#DCE8FF'] },
    },
  },
  // ---------- 天空与光 ----------
  // 每个画面只留几套手调到好看的配色（presets），没有统一的晨 / 昏 / 夜换色
  {
    id: 'clear', code: 'qk', cat: 'sky', name: { zh: '晴空', en: 'Clear Sky' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#0A63FE', '#7AE6FD', '#E6FEFF'], amp: 0.8, run: [3, 8], patch: 0.6, dots: 0.5,
    look: { zh: '湛蓝', en: 'Azure' }, presets: ['day', 'dusk'],
    times: { dusk: { name: { zh: '粉霞', en: 'Pink Haze' }, a: ['#5A6FD8', '#C9A8E8', '#FFD6E0'], glints: ['#FFF1E6'] } },
  },
  {
    id: 'bluehour', code: 'bh', cat: 'sky', name: { zh: '蓝调灯塔', en: 'Blue Hour Lighthouse' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#140A6E', '#4B3FD8', '#C48BE8'], amp: 0.8, run: [3, 8], patch: 0.7, dots: 0.5,
    silhouette: 'lighthouse', moon: '#FFE9A8', silTone: 0, stripeTone: 0.45, groundY: 0.9,
    look: { zh: '蓝调', en: 'Blue Hour' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '深夜', en: 'Midnight' }, a: ['#05031C', '#1A1652', '#3E3A8C', '#8A7FC4'], glints: STARS } },
  },
  {
    id: 'sunrise', code: 'sr', cat: 'sky', name: { zh: '山间日出', en: 'Mountain Sunrise' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#2A1B6E', '#FF7A59', '#FFD66B'], amp: 0.8, run: [3, 8], patch: 0.6, dots: 0.5,
    silhouette: ['sun', 'mountains'], moon: '#FFF3C4', sunY: [0.5, 0.64], ridge: { tones: [0.2, 0.06, 0], top: [0.58, 0.74] },
    look: { zh: '金橘', en: 'Tangerine' }, presets: ['day', 'dawn'],
    times: { dawn: { name: { zh: '粉晨', en: 'Rosy Dawn' }, a: ['#3A2A7A', '#E07A8C', '#FFD0A0'], glints: ['#FFF1D6'] } },
  },
  {
    id: 'sunset', code: 'ss', cat: 'sky', name: { zh: '日落帆影', en: 'Sunset Sail' }, tint: 0.5, layout: 'bands', angle: 270, steps: 7,
    anchors: ['#FF9A3D', '#F0477A', '#5A1F8C'], amp: 0.9, run: [3, 8], patch: 1.2, dots: 0.7,
    silhouette: 'boat', horizon: 0.72,
    look: { zh: '橘紫', en: 'Amber Violet' }, presets: ['day', 'dusk'],
    times: { dusk: { name: { zh: '绯红', en: 'Crimson' }, a: ['#FFB070', '#E0405A', '#3A1050'], glints: ['#FFE0B0'] } },
  },
  {
    id: 'aurora', code: 'ar', cat: 'sky', name: { zh: '雪山极光', en: 'Aurora Peaks' }, layout: 'bands', angle: 90, steps: 8,
    anchors: ['#03142E', '#0E3A5A', '#18D6A0', '#9A5CFF', '#03142E'], amp: 1.8, run: [1, 3], patch: 0.6, dots: 0.4,
    glow: ['#FFFFFF', '#CFFFF0'], glowDensity: 70,
    silhouette: 'mountains', ridge: { tones: [], colors: ['#2A4466', '#152438'], snowColor: '#DDEAF5', top: [0.52, 0.74] },
    look: { zh: '青紫', en: 'Teal Violet' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '绿光', en: 'Green Veil' }, a: ['#020A1A', '#06302A', '#2EE6A0', '#7CF0C8', '#020A1A'], glints: STARS } },
  },
  {
    id: 'starry', code: 'st', cat: 'sky', name: { zh: '星夜', en: 'Starry Night' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#020442', '#000DEB', '#58DAFD'], amp: 0.8, run: [3, 8], patch: 0.6, dots: 0.4,
    glow: ['#FFFFFF', '#FFF6C8', '#BFE3FF'], glowDensity: 40,
    look: { zh: '深蓝', en: 'Deep Blue' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '墨夜', en: 'Ink Night' }, a: ['#010210', '#081450', '#2A4A9A', '#6A9AD8'], glints: STARS } },
  },
  {
    id: 'milkyway', code: 'mw', cat: 'sky', name: { zh: '银河', en: 'Milky Way' }, layout: 'diagonal', angle: 130, steps: 9,
    anchors: ['#05031F', '#120C40', '#3B2A8C', '#F2C9FF', '#3B2A8C', '#120C40', '#05031F'], amp: 1.1, run: [1, 4], patch: 0.8, dots: 0.7,
    glow: ['#FFFFFF', '#F2C9FF', '#BFD8FF'], glowDensity: 32,
    look: { zh: '紫银', en: 'Violet Silver' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '冷银', en: 'Cold Silver' }, a: ['#01020C', '#0A1030', '#2A3A78', '#D8E4FF', '#2A3A78', '#0A1030', '#01020C'], glints: STARS } },
  },
  {
    id: 'cumulus', code: 'jy', cat: 'sky', name: { zh: '积云', en: 'Cumulus' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#3D8BFF', '#BFE3FF', '#FFFFFF'], amp: 1.4, run: [1, 3], patch: 1.6, dots: 0.6,
    look: { zh: '晴蓝', en: 'Bright Blue' }, presets: ['day', 'dusk'],
    times: { dusk: { name: { zh: '晚霞', en: 'Afterglow' }, a: ['#4A5AC8', '#E8A8C8', '#FFE8D8'], glints: ['#FFF1E6'] } },
  },
  // ---------- 大地与山 ----------
  {
    id: 'farhills', code: 'ys', cat: 'land', name: { zh: '远山', en: 'Distant Hills' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#2B3A6B', '#7D93C9', '#E3ECFF'], amp: 0.5, run: [4, 10], patch: 0.4, dots: 0.3,
    silhouette: 'mountains', ridge: { tones: [0.4, 0.22, 0.08, 0], top: [0.46, 0.7] },
    look: { zh: '雾蓝', en: 'Misty Blue' }, presets: ['day', 'dawn'],
    times: { dawn: { name: { zh: '晨紫', en: 'Lilac Dawn' }, a: ['#3A3A70', '#B08AB8', '#F4E0E8'], glints: ['#FFF1E6'] } },
  },
  {
    id: 'snowpeak', code: 'xs', cat: 'land', name: { zh: '雪山', en: 'Snow Peaks' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#2F5FC8', '#8FC0F0', '#EAF6FF'], amp: 0.5, run: [4, 10], patch: 0.4, dots: 0.3,
    silhouette: 'mountains', ridge: { tones: [], colors: ['#8098C8', '#58709E', '#34466E'], snowColor: '#FFFFFF', top: [0.26, 0.56] },
    look: { zh: '晴雪', en: 'Clear Snow' }, presets: ['day', 'dawn'],
    times: { dawn: { name: { zh: '日照金山', en: 'Golden Peaks' }, a: ['#3A5AA8', '#F0B888', '#FFE8C8'], glints: ['#FFF1D6'] } },
  },
  {
    id: 'dune', code: 'dn', cat: 'land', name: { zh: '沙丘', en: 'Dunes' }, tint: 0.5, layout: 'diagonal', angle: 160, steps: 6,
    anchors: ['#FFE29A', '#F2A24A', '#A6522A'], amp: 1.2, run: [2, 7], patch: 0.8, dots: 0.6,
    look: { zh: '金沙', en: 'Golden Sand' }, presets: ['day', 'dusk'],
    times: { dusk: { name: { zh: '暮沙', en: 'Dusk Sand' }, a: ['#F0A8A0', '#B05A7A', '#4A2050'], glints: ['#FFE0C8'] } },
  },
  {
    id: 'canyon', code: 'cy', cat: 'land', name: { zh: '峡谷', en: 'Canyon' }, tint: 0.5, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#F7B07A', '#C9542E', '#5E1E1E'], amp: 1.6, run: [1, 3], patch: 0.9, dots: 0.7, look: { zh: '赭红', en: 'Ochre' },
  },
  {
    id: 'lava', code: 'mg', cat: 'land', name: { zh: '熔岩', en: 'Lava' }, tint: 0.5, layout: 'radial', angle: 0, steps: 7,
    anchors: ['#FFE15A', '#FF5A1F', '#1E0A0A'], amp: 1.2, run: [1, 3], patch: 1, dots: 0.8,
    glow: ['#FFE15A', '#FFB23A'], glowDensity: 70,
    look: { zh: '熔金', en: 'Molten Gold' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '暗火', en: 'Embers' }, a: ['#FFC23A', '#E0300F', '#3A0A08', '#0C0303'], glints: ['#FFE15A', '#FF8A3A'] } },
  },
  // ---------- 植物与季节 ----------
  {
    id: 'forest', code: 'fr', cat: 'plant', name: { zh: '林间树影', en: 'Woodland' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#E4F9B0', '#9AD870', '#3E9A4E'], amp: 1.1, run: [2, 5], patch: 1, dots: 0.8,
    silhouette: 'trees', treeKind: 'round', silColor: '#103A24', tint: 0.5, look: { zh: '嫩绿', en: 'Fresh Green' },
  },
  {
    id: 'sakura', code: 'sk', cat: 'plant', name: { zh: '春樱', en: 'Cherry Blossom' }, tint: 0.5, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#FFF4F8', '#FFB7CF', '#E5578A'], amp: 1, run: [2, 5], patch: 1, dots: 0.8,
    glow: ['#FFFFFF', '#FFD6E4', '#FF8FB5'], glowDensity: 40, glowMotion: 'fall',
    look: { zh: '粉樱', en: 'Pink' }, presets: ['day', 'dawn'],
    times: { dawn: { name: { zh: '白樱', en: 'White' }, a: ['#FFFFFF', '#FFE4EE', '#F2A0BE'], glints: ['#FFFFFF', '#FFD6E4', '#FF8FB5'] } },
  },
  {
    id: 'autumn', code: 'au', cat: 'plant', name: { zh: '秋林', en: 'Autumn Woods' }, tint: 0.5, layout: 'diagonal', angle: 118, steps: 7,
    anchors: ['#FFD25A', '#F07A2A', '#8C2A1E'], amp: 1, run: [1, 4], patch: 1.2, dots: 1.3,
    glow: ['#FFD25A', '#F07A2A', '#C8401E'], glowDensity: 70, glowMotion: 'fall',
    look: { zh: '金秋', en: 'Golden' }, presets: ['day', 'dusk'],
    times: { dusk: { name: { zh: '红叶', en: 'Maple' }, a: ['#FFB080', '#E04A3A', '#6A1A20'], glints: ['#FFB080', '#E04A3A', '#FFD25A'] } },
  },
  {
    id: 'grassland', code: 'gr', cat: 'plant', name: { zh: '草原', en: 'Grassland' }, tint: 0.5, layout: 'bands', angle: 90, steps: 8,
    anchors: ['#7EC8FF', '#E8F6FF', '#B8E86A', '#4FA83A', '#2A6A2A'], amp: 1, run: [2, 6], patch: 0.9, dots: 0.9,
    glow: ['#FFFFFF', '#FFE45A', '#FF9AC0'], glowDensity: 70,
    look: { zh: '盛夏', en: 'Midsummer' }, presets: ['day', 'dusk'],
    times: { dusk: { name: { zh: '金色草原', en: 'Golden Grass' }, a: ['#5A6AC8', '#FFC8A0', '#E8C060', '#9A8A3A', '#4A4A2A'], glints: ['#FFE8A0', '#FFFFFF'] } },
  },
  {
    id: 'wheat', code: 'wt', cat: 'plant', name: { zh: '麦田', en: 'Wheat Field' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#5FB8FF', '#EAF4FF', '#FFE6A0', '#D99A2B'], tint: 0.5, amp: 1.1, run: [2, 5], patch: 0.9, dots: 0.9, look: { zh: '麦黄', en: 'Wheat' },
  },
  {
    id: 'lavender', code: 'xc', cat: 'plant', name: { zh: '薰衣草', en: 'Lavender' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#C9B8FF', '#8A63D8', '#4A3070', '#2E5A2E'], tint: 0.6, amp: 1.2, run: [1, 3], patch: 1, dots: 1.4, look: { zh: '紫野', en: 'Purple Field' },
  },
  {
    id: 'tundra', code: 'tn', cat: 'plant', name: { zh: '苔原', en: 'Tundra' }, tint: 0.5, layout: 'radial', angle: 0, steps: 7,
    anchors: ['#E6FFD8', '#6CC98A', '#14503C'], amp: 1.1, run: [1, 3], patch: 1, dots: 0.9, look: { zh: '苔绿', en: 'Moss' },
  },
  // ---------- 天气与时刻 ----------
  {
    id: 'mist', code: 'fg', cat: 'weather', name: { zh: '雾中松林', en: 'Misty Pines' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#F2F4FA', '#B8C3DE', '#6D7DA8'], amp: 0.6, run: [5, 12], patch: 0.4, dots: 0.3,
    silhouette: 'trees', treeKind: 'pine', silTone: 0.6, look: { zh: '晨雾', en: 'Morning Fog' },
  },
  {
    id: 'rainnight', code: 'rn', cat: 'weather', name: { zh: '雨夜', en: 'Rainy Night' }, layout: 'vertical', angle: 0, steps: 6,
    anchors: ['#0E1530', '#2F4A80', '#8FB2E0'], amp: 1.2, run: [3, 9], patch: 0.6, dots: 0.5,
    glow: ['#8FB2E0', '#C9DCF5'], glowDensity: 22, glowMotion: 'rain', look: { zh: '夜雨', en: 'Night Rain' },
  },
  {
    id: 'snownight', code: 'sn', cat: 'weather', name: { zh: '雪夜松林', en: 'Snowy Pines' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#0B1640', '#3A5DA8', '#FFFFFF'], amp: 0.7, run: [3, 8], patch: 0.6, dots: 0.6,
    glow: ['#FFFFFF', '#C9D8F5'], glowDensity: 40, glowMotion: 'fall',
    silhouette: 'trees', treeKind: 'pine', silTone: 0, groundY: 0.92, look: { zh: '雪夜', en: 'Snow Night' },
  },
  {
    id: 'snowfield', code: 'xy', cat: 'weather', name: { zh: '雪原', en: 'Snowfield' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#9FB8E8', '#DCE8FA', '#FFFFFF'], amp: 0.6, run: [4, 10], patch: 0.5, dots: 0.4,
    glow: ['#FFFFFF', '#E8F0FF'], glowDensity: 30, glowMotion: 'fall',
    silhouette: 'mountains', ridge: { tones: [], colors: ['#C2D2EE'], top: [0.42, 0.56] },
    look: { zh: '初雪', en: 'First Snow' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '雪夜', en: 'Snow Night' }, a: ['#0A1440', '#3A5A9A', '#C8D8F0'], glints: ['#FFFFFF', '#E8F0FF'] } },
  },
  {
    id: 'storm', code: 'ts', cat: 'weather', name: { zh: '雷暴', en: 'Thunderstorm' }, layout: 'diagonal', angle: 110, steps: 6,
    anchors: ['#140B2E', '#5A3FA0', '#9C8CD8'], amp: 1.3, run: [1, 4], patch: 1, dots: 0.6,
    glow: ['#9C8CD8', '#C8C0F0'], glowDensity: 26, glowMotion: 'rain', bolt: '#FFE45A', look: { zh: '紫电', en: 'Violet Storm' },
  },
  {
    id: 'rainbow', code: 'rb', cat: 'weather', name: { zh: '彩虹', en: 'Rainbow' }, tint: 0.5, layout: 'radial', angle: 0, steps: 7, center: [0, 0.75],
    anchors: ['#FF5A5A', '#FF9A3D', '#FFE15A', '#5FD068', '#3D8BFF', '#9A5CFF'], amp: 0.8, run: [2, 5], patch: 0.6, dots: 0.5, look: { zh: '七彩', en: 'Spectrum' },
  },
  // ---------- 心情 ----------
  {
    id: 'mono', code: 'ds', cat: 'mood', name: { zh: '单色', en: 'Monochrome' }, layout: 'diagonal', angle: 120, steps: 7,
    anchors: ['#0A2A66', '#3D7BE0', '#CFE4FF'], amp: 1, run: [2, 6], patch: 1, dots: 0.9,
    look: { zh: '钴蓝', en: 'Cobalt' }, presets: ['day', 'dawn', 'dusk'],
    times: {
      dawn: { name: { zh: '玫瑰', en: 'Rose' }, a: ['#5A0A2A', '#D8487A', '#FFD0E0'], glints: ['#FFE4EE'] },
      dusk: { name: { zh: '森绿', en: 'Forest' }, a: ['#0A3020', '#3AA86A', '#D0F4DC'], glints: ['#E8FFF0'] },
    },
  },
  {
    id: 'neon', code: 'ne', cat: 'mood', name: { zh: '霓虹', en: 'Neon' }, tint: 0.5, layout: 'diagonal', angle: 135, steps: 7,
    anchors: ['#14002E', '#FF2BD6', '#2BF5FF'], amp: 1, run: [1, 4], patch: 1, dots: 1,
    look: { zh: '粉青', en: 'Pink Cyan' }, presets: ['day', 'night'],
    times: { night: { name: { zh: '紫金', en: 'Violet Gold' }, a: ['#120030', '#B020FF', '#FFD02B'], glints: ['#FFFFFF'] } },
  },
  {
    id: 'mintcream', code: 'mt', cat: 'mood', name: { zh: '薄荷奶油', en: 'Mint Cream' }, tint: 0.5, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#FFF8E6', '#BFF2DC', '#4FC9A8'], amp: 0.9, run: [2, 6], patch: 1, dots: 0.8,
    look: { zh: '薄荷', en: 'Mint' }, presets: ['day', 'dawn'],
    times: { dawn: { name: { zh: '蜜桃', en: 'Peach' }, a: ['#FFF6EC', '#FFD2C0', '#F08A7A'], glints: ['#FFFFFF'] } },
  },
];

export interface Category { id: string; name: { zh: string; en: string }; count: number; cover: string; live: boolean }

export const CATEGORIES: readonly Category[] = [
  { id: 'sea', name: { zh: '海与水', en: 'Sea & Water' }, count: 9, cover: 'shoal', live: true },
  { id: 'sky', name: { zh: '天空与光', en: 'Sky & Light' }, count: 8, cover: 'sunset', live: true },
  { id: 'land', name: { zh: '大地与山', en: 'Land & Peaks' }, count: 5, cover: 'snowpeak', live: true },
  { id: 'plant', name: { zh: '植物与季节', en: 'Plants & Seasons' }, count: 7, cover: 'autumn', live: true },
  { id: 'weather', name: { zh: '天气与时刻', en: 'Weather & Hours' }, count: 6, cover: 'snownight', live: true },
  { id: 'mood', name: { zh: '心情', en: 'Moods' }, count: 3, cover: 'neon', live: true },
];

export const byId: Readonly<Record<string, Scene>> = Object.fromEntries(SCENES.map((s) => [s.id, s]));

/** 当前开放的画面（V0：海与水 9 个）；今日一张也从这里排期 */
export const LIVE: readonly Scene[] = SCENES.filter((s) => s.cat === 'sea');
