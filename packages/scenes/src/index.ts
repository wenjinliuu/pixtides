// @pixtides/scenes：场景定义。加新画面只在这里加一个对象，不改引擎。
// 晨 / 昏按"那段时间最好看的一刻"由引擎算法统一换色；夜用手配色板（a）；glints 是该时刻才有的反光 / 发光色。

import type { Scene, TimeSet } from '@pixtides/engine';

/** 蓝调时刻的反光：零星暖色灯光 + 淡粉余光 */
const BLUE_HOUR: TimeSet = { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] };
/** 晨光的反光：淡杏、淡玫瑰 */
const DAWN: TimeSet = { glints: ['#FFE7D6', '#FFC9C9'] };
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
  {
    id: 'clear', code: 'qk', cat: 'sky', name: { zh: '晴空', en: 'Clear Sky' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#0A63FE', '#7AE6FD', '#E6FEFF'], amp: 0.8, run: [3, 8], patch: 0.6, dots: 0.5,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#03081E', '#12285A', '#3D6496', '#9FB8D8'], glints: STARS } },
  },
  {
    id: 'bluehour', code: 'bh', cat: 'sky', name: { zh: '蓝调时刻', en: 'Blue Hour' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#140A6E', '#4B3FD8', '#C48BE8'], amp: 0.8, run: [3, 8], patch: 0.7, dots: 0.5,
    silhouette: 'lighthouse', moon: '#FFE9A8', silTone: 0, stripeTone: 0.45, groundY: 0.9,
    times: { dawn: DAWN, dusk: { a: ['#140A6E', '#4B3FD8', '#C48BE8'], glints: ['#FFE9A8', '#FFD9E6'] }, night: { a: ['#05031C', '#1A1652', '#3E3A8C', '#8A7FC4'], glints: STARS } },
  },
  {
    id: 'sunrise', code: 'sr', cat: 'sky', name: { zh: '日出', en: 'Sunrise' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#2A1B6E', '#FF7A59', '#FFD66B'], amp: 0.8, run: [3, 8], patch: 0.6, dots: 0.5,
    silhouette: ['sun', 'mountains'], moon: '#FFF3C4', sunY: [0.5, 0.64], ridge: { tones: [0.2, 0.06, 0], top: [0.58, 0.74] },
    times: { dawn: { a: ['#3A2A7A', '#E07A8C', '#FFD0A0'], glints: ['#FFF1D6'] }, dusk: BLUE_HOUR, night: { a: ['#05041A', '#1C1650', '#4A3A80', '#9A86C0'], glints: STARS } },
  },
  {
    id: 'sunset', code: 'ss', cat: 'sky', name: { zh: '日落', en: 'Sunset' }, tint: 0.5, layout: 'bands', angle: 270, steps: 7,
    anchors: ['#FF9A3D', '#F0477A', '#5A1F8C'], amp: 0.9, run: [3, 8], patch: 1.2, dots: 0.7,
    silhouette: 'boat', silTone: 1, horizon: 0.7,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#3A4A80', '#1E2456', '#0C0E2E', '#04050F'], glints: STARS } },
  },
  {
    id: 'aurora', code: 'ar', cat: 'sky', name: { zh: '极光', en: 'Aurora' }, layout: 'bands', angle: 90, steps: 8,
    anchors: ['#03142E', '#0E3A5A', '#18D6A0', '#9A5CFF', '#03142E'], amp: 1.8, run: [1, 3], patch: 0.6, dots: 0.4,
    glow: ['#FFFFFF', '#CFFFF0'], glowDensity: 70,
    silhouette: 'mountains', ridge: { tones: [0.06, 0], top: [0.74, 0.86] },
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#020A1A', '#082A44', '#12B88A', '#7A44E0', '#020A1A'], glints: STARS } },
  },
  {
    id: 'starry', code: 'st', cat: 'sky', name: { zh: '星夜', en: 'Starry Night' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#020442', '#000DEB', '#58DAFD'], amp: 0.8, run: [3, 8], patch: 0.6, dots: 0.4,
    glow: ['#FFFFFF', '#FFF6C8', '#BFE3FF'], glowDensity: 40,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#010220', '#06107A', '#2A5ABF', '#8FC4F0'], glints: STARS } },
  },
  {
    id: 'milkyway', code: 'mw', cat: 'sky', name: { zh: '银河', en: 'Milky Way' }, layout: 'diagonal', angle: 130, steps: 9,
    anchors: ['#05031F', '#120C40', '#3B2A8C', '#F2C9FF', '#3B2A8C', '#120C40', '#05031F'], amp: 1.1, run: [1, 4], patch: 0.8, dots: 0.7,
    glow: ['#FFFFFF', '#F2C9FF', '#BFD8FF'], glowDensity: 32,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#020110', '#0A0630', '#2A1E70', '#E0B8F5', '#2A1E70', '#0A0630', '#020110'], glints: STARS } },
  },
  {
    id: 'cumulus', code: 'jy', cat: 'sky', name: { zh: '积云', en: 'Cumulus' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#3D8BFF', '#BFE3FF', '#FFFFFF'], amp: 1.4, run: [1, 3], patch: 1.6, dots: 0.6,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#060C26', '#1E3360', '#5A7AA8', '#A8BCD8'], glints: STARS } },
  },
  // ---------- 大地与山 ----------
  {
    id: 'farhills', code: 'ys', cat: 'land', name: { zh: '远山', en: 'Distant Hills' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#2B3A6B', '#7D93C9', '#E3ECFF'], amp: 0.5, run: [4, 10], patch: 0.4, dots: 0.3,
    silhouette: 'mountains', ridge: { tones: [0.4, 0.22, 0.08, 0], top: [0.46, 0.7] },
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#04071A', '#141E42', '#3A4C80', '#8A9CC8'], glints: STARS } },
  },
  {
    id: 'snowpeak', code: 'xs', cat: 'land', name: { zh: '雪山', en: 'Snow Peaks' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#2F5FC8', '#8FC0F0', '#EAF6FF'], amp: 0.5, run: [4, 10], patch: 0.4, dots: 0.3,
    silhouette: 'mountains', ridge: { tones: [], colors: ['#8098C8', '#58709E', '#34466E'], snowColor: '#FFFFFF', top: [0.26, 0.56] },
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#070C22', '#1C2A5A', '#5A72A8', '#C8D4EC'], glints: ['#FFFFFF', '#D8E6FF'] } },
  },
  { id: 'dune', code: 'dn', cat: 'land', name: { zh: '沙丘', en: 'Dunes' }, tint: 0.5, layout: 'diagonal', angle: 160, steps: 6, anchors: ['#FFE29A', '#F2A24A', '#A6522A'], amp: 1.2, run: [2, 7], patch: 0.8, dots: 0.6,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#5A5A80', '#2E3058', '#14152E', '#06060F'], glints: STARS } } },
  {
    id: 'canyon', code: 'cy', cat: 'land', name: { zh: '峡谷', en: 'Canyon' }, tint: 0.5, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#F7B07A', '#C9542E', '#5E1E1E'], amp: 1.6, run: [1, 3], patch: 0.9, dots: 0.7,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#4A3A5A', '#2A1E3A', '#160E20', '#08050C'], glints: STARS } },
  },
  {
    id: 'lava', code: 'mg', cat: 'land', name: { zh: '熔岩', en: 'Lava' }, tint: 0.5, layout: 'radial', angle: 0, steps: 7,
    anchors: ['#FFE15A', '#FF5A1F', '#1E0A0A'], amp: 1.2, run: [1, 3], patch: 1, dots: 0.8,
    glow: ['#FFE15A', '#FFB23A'], glowDensity: 70,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#FFC23A', '#E0300F', '#3A0A08', '#0C0303'], glints: ['#FFE15A', '#FF8A3A'] } },
  },
  // ---------- 植物与季节 ----------
  {
    id: 'forest', code: 'fr', cat: 'plant', name: { zh: '森林', en: 'Forest' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#E4F9B0', '#9AD870', '#3E9A4E'], amp: 1.1, run: [2, 5], patch: 1, dots: 0.8,
    silhouette: 'trees', treeKind: 'round', silColor: '#103A24', tint: 0.5,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#4A7A68', '#1E4A3A', '#0C2A1E'], glints: ['#E8FFB0', '#B8F27A'] } },
  },
  {
    id: 'sakura', code: 'sk', cat: 'plant', name: { zh: '春樱', en: 'Cherry Blossom' }, tint: 0.5, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#FFF4F8', '#FFB7CF', '#E5578A'], amp: 1, run: [2, 5], patch: 1, dots: 0.8,
    glow: ['#FFFFFF', '#FFD6E4', '#FF8FB5'], glowDensity: 40, glowMotion: 'fall',
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#E8D0E8', '#9A6AA0', '#4A2A5A', '#160A20'], glints: ['#FFE0EC', '#FFFFFF'] } },
  },
  { id: 'autumn', code: 'au', cat: 'plant', name: { zh: '秋林', en: 'Autumn Woods' }, tint: 0.5, layout: 'diagonal', angle: 118, steps: 7, anchors: ['#FFD25A', '#F07A2A', '#8C2A1E'], amp: 1, run: [1, 4], patch: 1.2, dots: 1.3,
    glow: ['#FFD25A', '#F07A2A', '#C8401E'], glowDensity: 70, glowMotion: 'fall',
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#6A5A70', '#3E2A40', '#1E1220', '#0A060C'], glints: ['#FFC870'] } } },
  {
    id: 'wheat', code: 'wt', cat: 'plant', name: { zh: '麦田', en: 'Wheat Field' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#5FB8FF', '#EAF4FF', '#FFE6A0', '#D99A2B'], tint: 0.5, amp: 1.1, run: [2, 5], patch: 0.9, dots: 0.9,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#0A1430', '#2A3A60', '#6A6A70', '#3A3020'], glints: STARS } },
  },
  {
    id: 'lavender', code: 'xc', cat: 'plant', name: { zh: '薰衣草', en: 'Lavender' }, layout: 'bands', angle: 90, steps: 7,
    anchors: ['#C9B8FF', '#8A63D8', '#4A3070', '#2E5A2E'], tint: 0.6, amp: 1.2, run: [1, 3], patch: 1, dots: 1.4,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#4A4080', '#2A2058', '#141A2E', '#0A140C'], glints: STARS } },
  },
  {
    id: 'tundra', code: 'tn', cat: 'plant', name: { zh: '苔原', en: 'Tundra' }, tint: 0.5, layout: 'radial', angle: 0, steps: 7,
    anchors: ['#E6FFD8', '#6CC98A', '#14503C'], amp: 1.1, run: [1, 3], patch: 1, dots: 0.9,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#A8C8B8', '#3A6A5A', '#12302A', '#04100C'], glints: ['#E6FFD8'] } },
  },
  // ---------- 天气与时刻 ----------
  {
    id: 'mist', code: 'fg', cat: 'weather', name: { zh: '晨雾', en: 'Morning Mist' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#F2F4FA', '#B8C3DE', '#6D7DA8'], amp: 0.6, run: [5, 12], patch: 0.4, dots: 0.3,
    silhouette: 'trees', treeKind: 'pine', silTone: 0.6,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#5A6488', '#2E3658', '#141A30', '#080A14'], glints: STARS } },
  },
  {
    id: 'rainnight', code: 'rn', cat: 'weather', name: { zh: '雨夜', en: 'Rainy Night' }, layout: 'vertical', angle: 0, steps: 6,
    anchors: ['#0E1530', '#2F4A80', '#8FB2E0'], amp: 1.2, run: [3, 9], patch: 0.6, dots: 0.5,
    glow: ['#8FB2E0', '#C9DCF5'], glowDensity: 22, glowMotion: 'rain',
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#070B1C', '#1C2E58', '#5A7AB0'], glints: ['#FFD08A', '#C9DCF5'] } },
  },
  {
    id: 'snownight', code: 'sn', cat: 'weather', name: { zh: '雪夜', en: 'Snowy Night' }, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#0B1640', '#3A5DA8', '#FFFFFF'], amp: 0.7, run: [3, 8], patch: 0.6, dots: 0.6,
    glow: ['#FFFFFF', '#C9D8F5'], glowDensity: 40, glowMotion: 'fall',
    silhouette: 'trees', treeKind: 'pine', silTone: 0, groundY: 0.92,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#050A22', '#22386E', '#D8E4F8'], glints: ['#FFFFFF', '#FFE6B0'] } },
  },
  {
    id: 'storm', code: 'ts', cat: 'weather', name: { zh: '雷暴', en: 'Thunderstorm' }, layout: 'diagonal', angle: 110, steps: 6,
    anchors: ['#140B2E', '#5A3FA0', '#9C8CD8'], amp: 1.3, run: [1, 4], patch: 1, dots: 0.6,
    glow: ['#9C8CD8', '#C8C0F0'], glowDensity: 26, glowMotion: 'rain', bolt: '#FFE45A',
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#08051A', '#2E2060', '#6A5CA8'], glints: ['#C8C0F0'] } },
  },
  {
    id: 'rainbow', code: 'rb', cat: 'weather', name: { zh: '彩虹', en: 'Rainbow' }, tint: 0.5, layout: 'radial', angle: 0, steps: 7, center: [0, 0.75],
    anchors: ['#FF5A5A', '#FF9A3D', '#FFE15A', '#5FD068', '#3D8BFF', '#9A5CFF'], amp: 0.8, run: [2, 5], patch: 0.6, dots: 0.5,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#8A3A5A', '#8A5A3A', '#8A803A', '#3A7048', '#2A4A8A', '#5A3A8A'], glints: STARS } },
  },
  // ---------- 心情 ----------
  {
    id: 'mono', code: 'ds', cat: 'mood', name: { zh: '单色', en: 'Monochrome' }, layout: 'diagonal', angle: 120, steps: 7,
    anchors: ['#0A2A66', '#3D7BE0', '#CFE4FF'], amp: 1, run: [2, 6], patch: 1, dots: 0.9,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#030A1E', '#14305E', '#4A6AA0', '#A0B8DC'], glints: STARS } },
  },
  { id: 'neon', code: 'ne', cat: 'mood', name: { zh: '霓虹', en: 'Neon' }, tint: 0.5, layout: 'diagonal', angle: 135, steps: 7, anchors: ['#14002E', '#FF2BD6', '#2BF5FF'], amp: 1, run: [1, 4], patch: 1, dots: 1,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#08001A', '#C010A8', '#10C0D8'], glints: ['#FFFFFF', '#FF8AF0'] } } },
  {
    id: 'mintcream', code: 'mt', cat: 'mood', name: { zh: '薄荷奶油', en: 'Mint Cream' }, tint: 0.5, layout: 'bands', angle: 90, steps: 6,
    anchors: ['#FFF8E6', '#BFF2DC', '#4FC9A8'], amp: 0.9, run: [2, 6], patch: 1, dots: 0.8,
    times: { dawn: DAWN, dusk: BLUE_HOUR, night: { a: ['#B8C8C0', '#5A8A7A', '#1E4038', '#081410'], glints: STARS } },
  },
];

export interface Category { id: string; name: { zh: string; en: string }; count: number; cover: string; live: boolean }

export const CATEGORIES: readonly Category[] = [
  { id: 'sea', name: { zh: '海与水', en: 'Sea & Water' }, count: 9, cover: 'shoal', live: true },
  { id: 'sky', name: { zh: '天空与光', en: 'Sky & Light' }, count: 8, cover: 'sunset', live: true },
  { id: 'land', name: { zh: '大地与山', en: 'Land & Peaks' }, count: 5, cover: 'snowpeak', live: true },
  { id: 'plant', name: { zh: '植物与季节', en: 'Plants & Seasons' }, count: 6, cover: 'autumn', live: true },
  { id: 'weather', name: { zh: '天气与时刻', en: 'Weather & Hours' }, count: 5, cover: 'snownight', live: true },
  { id: 'mood', name: { zh: '心情', en: 'Moods' }, count: 3, cover: 'neon', live: true },
];

export const byId: Readonly<Record<string, Scene>> = Object.fromEntries(SCENES.map((s) => [s.id, s]));

/** 当前开放的画面（V0：海与水 9 个）；今日一张也从这里排期 */
export const LIVE: readonly Scene[] = SCENES.filter((s) => s.cat === 'sea');
