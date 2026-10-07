// @pixtides/scenes：场景定义。加新画面只在这里加一个对象，不改引擎。
// 晨 / 昏按"那段时间最好看的一刻"由引擎算法统一换色；夜用手配色板（a）；glints 是该时刻才有的反光 / 发光色。

import type { Scene, TimeSet } from '@pixtides/engine';

/** 蓝调时刻的反光：零星暖色灯光 + 淡粉余光 */
const BLUE_HOUR: TimeSet = { glints: ['#FFC98A', '#FFD9E6', '#FFE9B8'] };

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
  // ---------- 其余分类各一个代表画面，只用于首页缩略图（V1 再补全） ----------
  { id: 'sunset', code: 'ss', cat: 'sky', name: { zh: '日落', en: 'Sunset' }, layout: 'bands', angle: 270, steps: 7, anchors: ['#FF9A3D', '#F0477A', '#5A1F8C'], amp: 0.9, run: [3, 8], patch: 1.2, dots: 0.7 },
  { id: 'dune', code: 'dn', cat: 'land', name: { zh: '沙丘', en: 'Dunes' }, layout: 'diagonal', angle: 160, steps: 6, anchors: ['#FFE29A', '#F2A24A', '#A6522A'], amp: 1.2, run: [2, 7], patch: 0.8, dots: 0.6 },
  { id: 'autumn', code: 'au', cat: 'plant', name: { zh: '秋林', en: 'Autumn Woods' }, layout: 'diagonal', angle: 118, steps: 7, anchors: ['#FFD25A', '#F07A2A', '#8C2A1E'], amp: 1, run: [1, 4], patch: 1.2, dots: 1.3 },
  { id: 'snownight', code: 'sn', cat: 'weather', name: { zh: '雪夜', en: 'Snowy Night' }, layout: 'bands', angle: 90, steps: 6, anchors: ['#0B1640', '#3A5DA8', '#FFFFFF'], amp: 0.7, run: [3, 8], patch: 0.6, dots: 0.6, glow: ['#FFFFFF', '#C9D8F5'], glowDensity: 40 },
  { id: 'neon', code: 'ne', cat: 'mood', name: { zh: '霓虹', en: 'Neon' }, layout: 'diagonal', angle: 135, steps: 7, anchors: ['#14002E', '#FF2BD6', '#2BF5FF'], amp: 1, run: [1, 4], patch: 1, dots: 1 },
];

export interface Category { id: string; name: { zh: string; en: string }; count: number; cover: string; live: boolean }

export const CATEGORIES: readonly Category[] = [
  { id: 'sea', name: { zh: '海与水', en: 'Sea & Water' }, count: 9, cover: 'shoal', live: true },
  { id: 'sky', name: { zh: '天空与光', en: 'Sky & Light' }, count: 8, cover: 'sunset', live: false },
  { id: 'land', name: { zh: '大地与山', en: 'Land & Peaks' }, count: 5, cover: 'dune', live: false },
  { id: 'plant', name: { zh: '植物与季节', en: 'Plants & Seasons' }, count: 6, cover: 'autumn', live: false },
  { id: 'weather', name: { zh: '天气与时刻', en: 'Weather & Hours' }, count: 5, cover: 'snownight', live: false },
  { id: 'mood', name: { zh: '心情', en: 'Moods' }, count: 3, cover: 'neon', live: false },
];

export const byId: Readonly<Record<string, Scene>> = Object.fromEntries(SCENES.map((s) => [s.id, s]));

/** 当前开放的画面（V0：海与水 9 个）；今日一张也从这里排期 */
export const LIVE: readonly Scene[] = SCENES.filter((s) => s.cat === 'sea');
