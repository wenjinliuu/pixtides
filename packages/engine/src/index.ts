// @pixtides/engine：场景 + 参数 + 种子 + 时间 → 格子矩阵；Canvas 预览、PNG（索引色）与 SVG 导出都从同一个矩阵出图。
export * from './types';
export { mulberry32, hashStr, sha256, seedMix, randomSeed, tickRng, SEED_SPACE } from './rng';
export { hexToOklch, oklchToHex, ramp, hueRotate, variantPalette, uiTokens, type Lch, type UiTokens } from './color';
export { Sim, create, scenePalette, rareOf, findRare, RARE_ODDS, DEFAULTS } from './sim';
export { edges, paint, View } from './render';
export { TIERS, exportSize, rowSpan, toCanvas, pairCanvases, toSVG, type TierId } from './export';
export { encodePNG } from './png';
export { shortCode, parseCode } from './code';
export {
  normalizeText, normalizeName, normalizeDate, textSeed, localDateKey, dayPick, namePick, birthdayPick, comboPick,
  type DayPick, type SeedKind,
} from './text';
export { timeOfDay, globalTime } from './time';
