// 页面交互：第一屏（今日一张）、编辑区、导出、日历、我的海、分类。从设计稿 design/home.html 移植，
// 引擎与场景改为从 @pixtides/engine、@pixtides/scenes 引入；编号带上改动过的参数，/p/<编号> 直接打开那张图。
import * as E from '@pixtides/engine';
import type { Recipe, Sim, TierId, Variant, Shape } from '@pixtides/engine';
import { SCENES, CATEGORIES, byId, LIVE } from '@pixtides/scenes';

const P = { ...E, SCENES, CATEGORIES, byId };
// 页面元素按 id 取；元素都写在 index.astro 里，这里不逐个声明类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const $ = (id: string): any => document.getElementById(id);
const store = {
  get<V>(k: string, d: V): V { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式等存不了就算了 */ } },
};

// ================= 文案 =================
const T = {
  zh: {
    tag: '每一张都由代码现场画出', sub: '选一个画面，掷骰子，调到喜欢，下载当头像或壁纸。', editThis: '调这张', random: '随机一张',
    auto: '自动', dawn: '晨', day: '昼', dusk: '昏', night: '夜', timeAuto: '自动', timeDebug: '调试',
    grainChip: '粒度 · {g}',
    sync: '此刻全世界看到同一片浪', dayPlate: '今日一张 · 第 {n} 张 · {name}', rollPlate: '回看 {d} · 第 {n} 张 · {name}', backToday: '回到今天',
    calendar: '日历', calTitle: '今日一张 · 日历', calNote: '每天打开就收集当天那张。点任意一天，第一屏换成那天的海，浪仍和全世界同步。',
    mineScene: '画面', autoScene: '自动', palFollow: '跟随首页', fromDay: '{d} 的今日一张', swipe: '← 左右滑动换画面 →', dice: '换一张', scene: '画面 · 海与水', grain: '像素粒度', ratio: '画面比例',
    palette: '配色', hue: '色相整体旋转', avatar: '头像预览', circle: '圆形', rounded: '圆角', square: '方',
    pairTitle: '一对头像', pairExport: '导出一对', pairHint: '两张并排时浪是连着的，适合情侣或好友各用一张。',
    more: '更多', angle: '渐变方向', amp: '浪线起伏', terrace: '平台长短', bands: '色带数量', dots: '散落方块 · 密度', dotMax: '散落方块 · 最大',
    pairRatio: '散落方块 · 成对比例', sil: '剪影（月亮）', silNext: '换一个', invert: '深浅反转', play: '▶ 动起来', pause: '❚❚ 停下', rareDebug: '刷一张稀有的（调试）',
    export: '导出 PNG / SVG', exportHint: '画布上的浪一直在动；导出的是这张图浪静下来的那一刻，与编号一一对应。', exTitle: '导出', res: '分辨率', shape: '形状', safe: '安全区参考线',
    format: '格式', download: '下载', longPress: '长按图片保存到相册。', close: '关闭',
    todayTitle: '今日一张', todayNote: '按你所在地的日期，同一天全世界看到同一张。每天来看一眼，日历上就多一格。', openEditor: '在编辑器里打开',
    mineTitle: '我的海', mineNote: '先选一个画面，再输入名字、一句话或生日。文字只决定底座构图，同样的输入永远是同一个构图，换台手机也一样。', byName: '名字', byBirthday: '生日', byCombo: '名字 + 生日', withYear: '含年份', make: '生成', originIs: '来自 ',
    catsTitle: '六类风景', catsNote: '36 个画面，同一种画风。按住卡片看它动起来。', foot: '代码 MIT · 生成的图归你，可商用 · 字体 Fusion Pixel / Silkscreen（OFL）',
    soon: 'V1 上线', radial: '径向', cells: '格', lang: 'EN', prev: '上一个画面', next: '下一个画面',
    themeAuto: '自动', themeDark: '深色', themeLight: '浅色',
    pngHint: 'PNG 用索引色编码，文件小，最高 8K。竖向比例按短边算。', svgHint: 'SVG 同色合并成长矩形，任意放大都清晰。',
    cellHint: '每格约 {n} px，格子偏细，换高一档会更清晰。', toCircle: '圆形头像用 1:1，已切到 1:1', saved: '已保存 ', declined: '已取消保存',
    busy: '已有一个保存窗口，请先处理', failed: '这个尺寸生成失败，换小一档试试', making: '正在生成…', makingPct: '正在生成… {n}%', copied: '链接已复制：', copyCode: '点编号复制分享链接',
    rare: '稀有 · 鲸尾', rareFound: '找到一张稀有的：', rareNone: '这个画面没有彩蛋',
    originFrom: '改自 ', fromHero: '此刻的海', fromToday: '今日一张', fromName: '「{t}」的海', fromBirthday: '{d} 的海', fromCode: '编号',
    no: '第 {n} 张', collected: '已收集 {n} 天', wd: ['一', '二', '三', '四', '五', '六', '日'],
    mineName: '「{t}」的海', mineDay: '{d} 的海', mineMD: '每年 {d} 生日的海', mineCombo: '「{t}」+ {d} 的海',
    mineMDExplain: '不含年份时只按月日：每年 {d} 生日的人共享这一张。', mineComboExplain: '名字规范化为「{n}」，和日期 {d} 一起算种子，重名的人也能各有一张。', mineNameExplain: '规范化后是「{n}」：全角转半角、英文转小写、去掉空格和分隔符；再算 SHA-256，取前 5 字节做构图种子。名字只决定构图，画面、配色、粒度都由你选。',
    mineDayExplain: '含年份时用那一天「今日一张」的构图：{d} 是第 {n} 张，那天排到的画面是「{s}」，选同一个画面就是那天的那张。', pairSaved: '已导出一对', heroCode: '今天的海',
  },
  en: {
    tag: 'Every picture is drawn live, in code', sub: 'Pick a scene, roll the dice, tune it, and save it as an avatar or wallpaper.', editThis: 'Edit this one', random: 'Surprise me',
    auto: 'Auto', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night', timeAuto: 'auto', timeDebug: 'debug',
    grainChip: 'Grain · {g}',
    sync: 'Everyone sees these same waves right now', dayPlate: 'Picture of the day · No. {n} · {name}', rollPlate: 'Looking back {d} · No. {n} · {name}', backToday: 'Back to today',
    calendar: 'Calendar', calTitle: 'Picture of the day · Calendar', calNote: 'Open the site to collect that day’s picture. Tap any day to show its sea up top; the waves stay in sync with everyone.',
    mineScene: 'Scene', autoScene: 'Auto', palFollow: 'Following home', fromDay: 'picture of {d}', swipe: '← Swipe for another scene →', dice: 'Reroll', scene: 'Scene · Sea & Water', grain: 'Pixel grain', ratio: 'Aspect ratio',
    palette: 'Colors', hue: 'Rotate hue', avatar: 'Avatar preview', circle: 'Circle', rounded: 'Rounded', square: 'Square',
    pairTitle: 'Matching pair', pairExport: 'Export pair', pairHint: 'Side by side, the waves join up. One for you, one for a friend.',
    more: 'More', angle: 'Direction', amp: 'Wave height', terrace: 'Terrace length', bands: 'Bands', dots: 'Scatter · density', dotMax: 'Scatter · max size',
    pairRatio: 'Scatter · pairs', sil: 'Silhouette (moon)', silNext: 'Another', invert: 'Invert light/dark', play: '▶ Animate', pause: '❚❚ Stop', rareDebug: 'Find a rare one (debug)',
    export: 'Export PNG / SVG', exportHint: 'The waves keep moving on the canvas; the export is the calm moment of this picture, matching its code.', exTitle: 'Export', res: 'Resolution', shape: 'Shape', safe: 'Safe-area guide',
    format: 'Format', download: 'Download', longPress: 'Press and hold the image to save it.', close: 'Close',
    todayTitle: 'Picture of the day', todayNote: 'By your local date, everyone sees the same picture on the same day. Visit daily to fill your calendar.', openEditor: 'Open in editor',
    mineTitle: 'Your sea', mineNote: 'Pick a scene, then type a name or phrase, or pick a birthday. The text sets only the base composition; the same input always gives the same composition, on any device.', byName: 'Name', byBirthday: 'Birthday', byCombo: 'Name + birthday', withYear: 'Include year', make: 'Make', originIs: 'From ',
    catsTitle: 'Six worlds', catsNote: '36 scenes, one style. Press and hold a card to see it move.', foot: 'Code MIT · Your pictures are yours, commercial use OK · Fonts Fusion Pixel / Silkscreen (OFL)',
    soon: 'In V1', radial: 'radial', cells: 'cells', lang: '中', prev: 'Previous scene', next: 'Next scene',
    themeAuto: 'Auto', themeDark: 'Dark', themeLight: 'Light',
    pngHint: 'PNG uses indexed color: small files, up to 8K. Portrait ratios are sized by the short edge.', svgHint: 'SVG merges same-color runs into long rects; sharp at any size.',
    cellHint: 'Each cell is about {n} px. Pick a higher tier for a crisper result.', toCircle: 'Circle avatars are 1:1, switched to 1:1', saved: 'Saved ', declined: 'Save canceled',
    busy: 'A save prompt is already open', failed: 'That size failed, try a smaller one', making: 'Rendering…', makingPct: 'Rendering… {n}%', copied: 'Link copied: ', copyCode: 'Tap the code to copy a share link',
    rare: 'Rare · Whale tail', rareFound: 'Found a rare one: ', rareNone: 'This scene has no easter egg',
    originFrom: 'Remixed from ', fromHero: 'today’s sea', fromToday: 'picture of the day', fromName: '“{t}”', fromBirthday: '{d}', fromCode: 'code',
    no: 'No. {n}', collected: '{n} days collected', wd: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    mineName: '“{t}”', mineDay: 'The sea of {d}', mineMD: 'Every {d} birthday', mineCombo: '“{t}” + {d}',
    mineMDExplain: 'Without the year, only month and day count: everyone born on {d} shares this one.', mineComboExplain: 'The name normalizes to “{n}” and is hashed together with {d}, so people with the same name still get their own.', mineNameExplain: 'Normalized to “{n}”: full-width to half-width, lowercase, spaces and separators removed. Then SHA-256; the first 5 bytes become the composition seed. The name sets only the composition; scene, colors and grain are yours to choose.',
    mineDayExplain: 'With the year, this uses that date’s picture-of-the-day composition: {d} is No. {n}, and its scene was {s}. Pick the same scene to get that exact picture.', pairSaved: 'Pair exported', heroCode: 'Today’s sea',
  },
};
type Lang = keyof typeof T;
type Key = { [K in keyof (typeof T)['zh']]: (typeof T)['zh'][K] extends string ? K : never }[keyof (typeof T)['zh']];
let lang: Lang = store.get<Lang>('pt-lang', navigator.language.startsWith('zh') ? 'zh' : 'en');
if (!(lang in T)) lang = 'zh';
const t = (k: string, vars?: Record<string, string | number>): string => {
  let s = T[lang][k as Key];
  if (vars) for (const v in vars) s = s.replace('{' + v + '}', String(vars[v]));
  return s;
};

// ================= 主题：自动 / 深色 / 浅色 =================
const sysDark = matchMedia('(prefers-color-scheme: dark)');
type ThemeMode = 'auto' | 'dark' | 'light';
let themeMode = store.get<ThemeMode>('pt-theme', 'auto');
const resolvedTheme = (): 'dark' | 'light' => (themeMode === 'auto' ? (sysDark.matches ? 'dark' : 'light') : themeMode);
function applyTheme(pal: string[]) {
  const mode = resolvedTheme(), ui = P.uiTokens(pal, mode), st = document.documentElement.style;
  document.documentElement.dataset.theme = mode;
  const map: Record<keyof E.UiTokens, string> = { bg: 'bg', panel: 'panel', raise: 'raise', line: 'line', fg: 'fg', muted: 'muted', accent: 'accent', onAccent: 'on-accent', shadow: 'shadow', deep: 'deep' };
  for (const k of Object.keys(map) as (keyof E.UiTokens)[]) st.setProperty('--' + map[k], ui[k]);
  themeMeta.setAttribute('content', ui.bg);
}
function applyHeroTokens(pal: string[]) {
  const ui = P.uiTokens(pal, 'dark'), st = document.documentElement.style;
  st.setProperty('--h-bg', ui.bg); st.setProperty('--h-fg', ui.fg); st.setProperty('--h-accent', ui.accent);
  st.setProperty('--h-on', ui.onAccent); st.setProperty('--h-ink', ui.shadow);
}
const themeMeta = document.createElement('meta');
themeMeta.name = 'theme-color';
document.head.append(themeMeta);
$('theme').addEventListener('click', () => {
  themeMode = ({ auto: 'dark', dark: 'light', light: 'auto' } as const)[themeMode] || 'auto';
  store.set('pt-theme', themeMode);
  syncThemeChip();
  applyTheme(sim.pal.slice(0, sim.L));
});
sysDark.addEventListener?.('change', () => applyTheme(sim.pal.slice(0, sim.L)));
function syncThemeChip() { $('theme').textContent = t({ auto: 'themeAuto', dark: 'themeDark', light: 'themeLight' }[themeMode]); }

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const dpr = () => Math.min(3, window.devicePixelRatio || 1);
const SEA = LIVE;

// ================= 第一屏：今日一张，浪全球同步 =================
const hero = $('hero');
const heroView = new P.View($('sea'));
let todayKey = P.localDateKey(new Date());
let heroDay = todayKey, heroPick = P.dayPick(todayKey, SEA), heroSim: Sim | null = null;
let timeMode: 'auto' | Variant = 'auto', heroTime: Variant = P.timeOfDay(), heroVisible = true;
// 第一屏粒度：与编辑区"像素粒度"同一组 8 档（短边格数），点一下换下一档，记在本机
const GRIDS: readonly number[] = P.GRIDS;
let heroGrain = store.get('pt-grain', 32);
if (!GRIDS.includes(heroGrain)) heroGrain = 32;
function buildHero(transition = 0) {
  heroPick = P.dayPick(heroDay, SEA);
  const w = hero.clientWidth, h = hero.clientHeight;
  const G = heroGrain;
  if (transition && heroSim && !reduce.matches) heroView.dissolve(transition);
  heroSim = P.create(heroPick.scene, { grid: G, ratio: [w, h], seed: heroPick.seed, time: P.globalTime(), variant: heroTime });
  heroView.attach(heroSim, Math.round(w * dpr()), Math.round(h * dpr()));
  heroView.render();
  applyHeroTokens(heroSim.pal.slice(0, heroSim.L));
  updateDayPlate();
  kick();
}
function updateDayPlate() {
  const vars = { n: heroPick.no, name: heroPick.scene.name[lang], d: heroDay };
  $('dayPlate').textContent = t(heroDay === todayKey ? 'dayPlate' : 'rollPlate', vars) + (heroSim && heroSim.rare ? ' · ' + t('rare') : '');
  $('backToday').hidden = heroDay === todayKey;
}
function setHeroTime(next: Variant, animate: boolean) {
  if (next === heroTime) return;
  heroTime = next;
  buildHero(animate ? 1000 : 0);
  updateTimeLabel();
  followHero();
}
function setHeroDay(key: string) {
  if (key === heroDay) return;
  heroDay = key;
  buildHero(800);
  followHero();
}
function updateTimeLabel() { $('timeLabel').textContent = t(heroTime) + ' · ' + (timeMode === 'auto' ? t('timeAuto') : t('timeDebug')); }
function updateSyncPlate() {
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  $('syncPlate').textContent = t('sync') + ' · ';
  const b = document.createElement('b');
  b.textContent = `UTC ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  $('syncPlate').append(b);
}
$('timeSeg').addEventListener('click', (e: Event) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  timeMode = b.dataset.t as typeof timeMode;
  document.querySelectorAll('#timeSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  setHeroTime(timeMode === 'auto' ? P.timeOfDay() : timeMode, true);
  updateTimeLabel();
});
$('backToday').addEventListener('click', () => setHeroDay(todayKey));
function syncGrainChip() { $('grain').textContent = t('grainChip', { g: heroGrain }); }
$('grain').addEventListener('click', () => {
  heroGrain = GRIDS[(GRIDS.indexOf(heroGrain) + 1) % GRIDS.length];
  store.set('pt-grain', heroGrain);
  syncGrainChip();
  buildHero();
  followHero();
});
setInterval(() => {
  updateSyncPlate();
  if (timeMode === 'auto') setHeroTime(P.timeOfDay(), true);
  const k = P.localDateKey(new Date());
  if (k !== todayKey) { // 本地零点：换成新的一张，并收进日历
    const follow = heroDay === todayKey;
    todayKey = k; collect(k);
    if (follow) setHeroDay(k);
  }
}, 1000);
// ================= 编辑区 =================
type Ratio = (typeof P.RATIOS)[number];
const RATIOS: readonly Ratio[] = P.RATIOS;
const rr = (r: Ratio): [number, number] => [r.r[0], r.r[1]];
interface Origin { kind: 'hero' | 'mine' | 'code'; code: string; day?: string; label?: string }
const S: {
  scene: E.Scene; seed: number; grid: number; ratio: Ratio; variant: Variant; hue: number;
  angle: number | null; amp: number | null; terrace: number; bands: number | null; dots: number | null; dotMax: number; pair: number;
  silhouette: boolean; silSeed: number; invert: boolean; tier: TierId; shape: Shape; fmt: 'png' | 'svg'; safe: boolean;
  origin: Origin | null; edited: boolean;
} = {
  scene: heroPick.scene, seed: heroPick.seed, grid: heroGrain, ratio: RATIOS[0], variant: heroTime, hue: 0,
  angle: null, amp: null, terrace: 1, bands: null, dots: null, dotMax: 5, pair: 0.22, silhouette: true, silSeed: 0, invert: false,
  tier: '4K', shape: 'square', fmt: 'png', safe: false,
  origin: { kind: 'hero', code: P.shortCode(heroPick.scene, heroPick.seed), day: heroDay }, edited: false,
};
const view = new P.View($('view'));
let sim!: Sim, editTime = 0, editVisible = false;
// 当前这张的完整配方；编号由它算出，任何人打开同一编号都还原出同一张
const recipe = (): Recipe => ({
  scene: S.scene, seed: S.seed, grid: S.grid, ratio: S.ratio.id, variant: S.variant, hue: S.hue, invert: S.invert, angle: S.angle,
  amp: S.amp, terrace: S.terrace, bands: S.bands, dots: S.dots, dotMax: S.dotMax, pair: S.pair, silhouette: S.silhouette, silSeed: S.silSeed,
});
const curCode = () => P.encodeRecipe(recipe());
const shareUrl = (code: string) => location.origin + '/p/' + code;
const simOpts = (extra?: Partial<E.SimOptions>): Partial<E.SimOptions> => Object.assign({
  grid: S.grid, ratio: rr(S.ratio), seed: S.seed, variant: S.variant, hue: S.hue, angle: S.angle, amp: S.amp, terrace: S.terrace,
  bands: S.bands, dots: S.dots, dotMax: S.dotMax, pair: S.pair, silhouette: S.silhouette, silSeed: S.silSeed, invert: S.invert,
}, extra);

function fitBox() {
  const wrap = $('wrap'), box = $('box'), [a, b] = S.ratio.r;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  let w = W, h = (W * b) / a;
  if (h > H) { h = H; w = (H * a) / b; }
  box.style.width = Math.floor(w) + 'px'; box.style.height = Math.floor(h) + 'px';
  return [Math.floor(w), Math.floor(h)];
}
function rebuild(transition = 0) {
  const [w, h] = fitBox();
  const next = P.create(S.scene, simOpts({ time: editTime }));
  const pw = Math.round(w * dpr()), ph = Math.round(h * dpr());
  if (transition && sim && sim.W === next.W && sim.H === next.H && view.w === pw && view.h === ph && !reduce.matches) view.dissolve(transition);
  sim = next;
  view.attach(sim, pw, ph);
  view.render();
  drawAvatars();
  drawPair();
  applyTheme(sim.pal.slice(0, sim.L));
  syncUi();
  kick();
}
// 换来源（此刻的海 / 今日一张 / 我的海 / 编号）时清掉"改过"标记
function load(next: Partial<typeof S>, origin?: Origin | null) {
  Object.assign(S, { angle: null, amp: null, bands: null, dots: null, silSeed: 0, hue: 0, invert: false, terrace: 1 }, next);
  S.origin = origin || null;
  S.edited = false;
  editTime = 0;
  rebuild(450);
}
const touched = () => { if (S.origin) S.edited = true; };

function drawAvatars() {
  const src = $('view'), sw = src.width, sh = src.height, s = Math.min(sw, sh), sx = (sw - s) / 2, sy = (sh - s) / 2;
  for (const id of ['avC', 'avR', 'avS']) {
    const cv = $(id), ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, sx, sy, s, s, 0, 0, cv.width, cv.height);
  }
}
function pairSim() { return P.create(S.scene, simOpts({ ratio: [2, 1] })); }
function drawPair() {
  const [a, b] = P.pairCanvases(pairSim(), 216, 'square');
  for (const [id, c] of [['pairA', a], ['pairB', b]] as const) { const ctx = $(id).getContext('2d'); ctx.clearRect(0, 0, 216, 216); ctx.drawImage(c, 0, 0); }
}

function buildChips() {
  $('gridChips').innerHTML = GRIDS.map((g) => `<button class="chip" type="button" data-v="${g}">${g}</button>`).join('');
  $('ratioChips').innerHTML = RATIOS.map((r) => {
    const k = 20 / Math.max(r.r[0], r.r[1]);
    return `<button class="chip ratio" type="button" data-v="${r.id}" aria-label="${r.label}"><i style="width:${Math.round(r.r[0] * k + 4)}px;height:${Math.round(r.r[1] * k + 4)}px"></i><span>${r.label}</span></button>`;
  }).join('');
  $('tierChips').innerHTML = P.TIERS.map((x) => `<button class="chip" type="button" data-v="${x.id}">${x.id}</button>`).join('');
  const sc = $('scenes');
  SEA.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'scene'; b.dataset.v = s.id;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 144;
    b.append(cv, document.createElement('span'));
    sc.append(b);
    P.paint(cv.getContext('2d')!, P.create(s, { grid: 16, seed: P.hashStr(s.id), rare: false }), 144, 144);
  });
}
const press = (el: HTMLElement, val: unknown) => el.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(val))));
function originText() {
  const o = S.origin;
  if (!o) return '';
  if (o.kind === 'hero') return o.day === todayKey ? t('fromToday') : t('fromDay', { d: o.day || '' });
  if (o.kind === 'mine') return o.label || '';
  return t('fromCode') + ' ' + o.code;
}
function syncUi() {
  const sc = S.scene, idx = SEA.indexOf(sc);
  $('name').textContent = sc.name[lang];
  $('code').textContent = curCode(); // 编号可能带参数段，不再拼格数，窄屏也放得下
  $('origin').hidden = !S.origin;
  $('origin').textContent = (S.edited ? t('originFrom') : t('originIs')) + originText();
  $('rareTag').hidden = !sim.rare;
  $('rareTag').textContent = t('rare');
  $('sceneOut').textContent = idx + 1 + ' / ' + SEA.length;
  press($('scenes'), sc.id);
  document.querySelectorAll('#scenes .scene span').forEach((sp, i) => { sp.textContent = SEA[i].name[lang]; });
  press($('gridChips'), S.grid); $('gridOut').textContent = S.grid + ' ' + t('cells');
  press($('ratioChips'), S.ratio.id); $('ratioOut').textContent = S.ratio.label;
  press($('variantChips'), S.variant);
  $('palOut').textContent = following() ? t('palFollow') + ' · ' + t(S.variant) : t(S.variant);
  $('hue').value = S.hue; $('hueOut').textContent = S.hue + '°';
  const radial = sc.layout === 'radial', ang = S.angle != null ? S.angle : sc.angle;
  $('angle').value = ang; $('angle').disabled = radial; $('angleOut').textContent = radial ? t('radial') : ang + '°';
  const amp = S.amp ?? sc.amp ?? 1; $('amp').value = amp; $('ampOut').textContent = (+amp).toFixed(1);
  $('terrace').value = S.terrace; $('terraceOut').textContent = (+S.terrace).toFixed(1);
  const bands = S.bands || sc.steps; $('bands').value = bands; $('bandsOut').textContent = bands;
  const dots = S.dots ?? sc.dots ?? 1; $('dots').value = dots; $('dotsOut').textContent = (+dots).toFixed(1);
  $('dotMax').value = S.dotMax; $('dotMaxOut').textContent = (S.dotMax / 2).toFixed(1) + ' ' + t('cells');
  $('pair').value = S.pair; $('pairOut').textContent = Math.round(S.pair * 100) + '%';
  $('silRow').hidden = sc.silhouette !== 'moon';
  $('sil').checked = S.silhouette; $('silNext').disabled = !S.silhouette;
  $('invert').checked = S.invert;
}
function setScene(sc: E.Scene) {
  S.scene = sc;
  S.angle = S.amp = S.bands = S.dots = null; S.silSeed = 0;
  touched();
  rebuild(450);
  $('scenes').querySelector(`[data-v="${sc.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
const step = (d: number) => setScene(SEA[(SEA.indexOf(S.scene) + d + SEA.length) % SEA.length]);
$('scenes').addEventListener('click', (e: any) => { const b = e.target.closest('.scene'); if (b) setScene(P.byId[b.dataset.v]); });
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('dice').addEventListener('click', () => { S.seed = P.randomSeed(); S.silSeed = 0; S.origin = null; S.edited = false; rebuild(400); });
$('gridChips').addEventListener('click', (e: any) => { const b = e.target.closest('[data-v]'); if (b) { S.grid = +b.dataset.v; touched(); rebuild(); } });
$('ratioChips').addEventListener('click', (e: any) => { const b = e.target.closest('[data-v]'); if (b) { S.ratio = RATIOS.find((r) => r.id === b.dataset.v) || RATIOS[0]; touched(); rebuild(); } });
$('variantChips').addEventListener('click', (e: any) => { const b = e.target.closest('[data-v]'); if (b) { S.variant = b.dataset.v; touched(); rebuild(350); } });
const sliders: Record<string, (v: string) => unknown> = { hue: (v) => (S.hue = +v), angle: (v) => (S.angle = +v), amp: (v) => (S.amp = +v), terrace: (v) => (S.terrace = +v),
  bands: (v) => (S.bands = +v), dots: (v) => (S.dots = +v), dotMax: (v) => (S.dotMax = +v), pair: (v) => (S.pair = +v) };
let pending = 0;
Object.keys(sliders).forEach((id) => $(id).addEventListener('input', (e: any) => {
  sliders[id](e.target.value); touched();
  if (!pending) pending = requestAnimationFrame(() => { pending = 0; rebuild(); });
}));
$('sil').addEventListener('change', (e: any) => { S.silhouette = e.target.checked; touched(); rebuild(); });
$('silNext').addEventListener('click', () => { S.silSeed++; touched(); rebuild(300); });
$('invert').addEventListener('change', (e: any) => { S.invert = e.target.checked; touched(); rebuild(400); });
$('findRare').addEventListener('click', () => {
  const s = P.findRare(S.scene, P.randomSeed());
  if (s == null) { toast(t('rareNone')); return; }
  S.seed = s; S.origin = null; S.edited = false; rebuild(400);
  toast(t('rareFound') + P.shortCode(S.scene, s));
});

(function swipe() {
  const el = $('wrap');
  let x0 = 0, y0 = 0, id: number | null = null;
  el.addEventListener('pointerdown', (e: PointerEvent) => { id = e.pointerId; x0 = e.clientX; y0 = e.clientY; });
  el.addEventListener('pointerup', (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) { step(dx < 0 ? 1 : -1); $('swipeHint').hidden = true; }
  });
  el.addEventListener('pointercancel', () => { id = null; });
})();

// 第一屏 → 编辑区：把第一屏那张（含所选时段的配色）带下来。
// 编辑区没被改过时一直跟随第一屏；用户在编辑区自己选了配色或改了参数，就不再跟随
const following = () => !!(S.origin && S.origin.kind === 'hero' && !S.edited);
function editHero() {
  load({ scene: heroPick.scene, seed: heroPick.seed, variant: heroTime, grid: heroGrain, ratio: S.ratio },
    { kind: 'hero', code: P.shortCode(heroPick.scene, heroPick.seed), day: heroDay });
}
function followHero() {
  if (!following()) return;
  if (S.scene !== heroPick.scene || S.seed !== heroPick.seed || S.variant !== heroTime || S.grid !== heroGrain || S.origin?.day !== heroDay) editHero();
}
$('editThis').addEventListener('click', (e: any) => {
  e.preventDefault();
  if (!following()) editHero();
  $('edit').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth' });
});
$('randomOne').addEventListener('click', () => {
  load({ scene: SEA[Math.floor(Math.random() * SEA.length)], seed: P.randomSeed(), variant: 'day' }, null);
  $('edit').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth' });
});
function openInEditor(next: Partial<typeof S>, origin: Origin | null) {
  load(next, origin);
  $('edit').scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth' });
}

// ================= 导出 =================
const exportDims = () => P.exportSize(S.tier, rr(S.ratio));
function syncExport() {
  press($('tierChips'), S.tier);
  press($('shapeChips'), S.shape); press($('fmtChips'), S.fmt);
  $('safe').checked = S.safe;
  const [w, h] = exportDims();
  $('exSize').textContent = w + ' × ' + h;
  $('fmtHint').textContent = S.fmt === 'png' ? t('pngHint') : t('svgHint');
  const cell = Math.min(w / sim.W, h / sim.H);
  $('cellHint').hidden = !(S.fmt === 'png' && cell < 6);
  $('cellHint').textContent = t('cellHint', { n: cell.toFixed(1) });
  const box = $('exPreviewBox'), pv = $('exPreview');
  const k = 164 / Math.max(w, h), pw = Math.round(w * k * 2), ph = Math.round(h * k * 2);
  const c = P.toCanvas(P.create(S.scene, simOpts()), pw, ph, S.shape);
  pv.width = pw; pv.height = ph; pv.style.width = pw / 2 + 'px'; pv.style.height = ph / 2 + 'px';
  pv.getContext('2d').drawImage(c, 0, 0);
  box.querySelector('.safe-ring')?.remove();
  if (S.safe) {
    const ring = document.createElement('div'), d = (Math.min(pw, ph) / 2) * 0.8;
    ring.className = 'safe-ring';
    Object.assign(ring.style, { width: d + 'px', height: d + 'px', left: `calc(50% - ${d / 2}px)`, top: `calc(50% - ${d / 2}px)` });
    box.append(ring);
  }
}
$('openExport').addEventListener('click', () => { $('sheet').hidden = false; syncExport(); $('closeExport').focus(); });
const closeExport = () => { $('sheet').hidden = true; $('openExport').focus(); };
$('closeExport').addEventListener('click', closeExport);
$('sheet').addEventListener('click', (e: any) => { if (e.target === $('sheet')) closeExport(); });
document.addEventListener('keydown', (e: any) => { if (e.key === 'Escape' && !$('sheet').hidden) closeExport(); });
$('tierChips').addEventListener('click', (e: any) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { S.tier = b.dataset.v; syncExport(); } });
$('fmtChips').addEventListener('click', (e: any) => { const b = e.target.closest('[data-v]'); if (!b) return; S.fmt = b.dataset.v; syncExport(); });
$('shapeChips').addEventListener('click', (e: any) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  S.shape = b.dataset.v;
  if (S.shape === 'circle' && S.ratio.r[0] !== S.ratio.r[1]) { S.ratio = RATIOS[0]; touched(); rebuild(); toast(t('toCircle')); }
  syncExport();
});
$('safe').addEventListener('change', (e: any) => { S.safe = e.target.checked; syncExport(); });

// 保存：claude.ai 里走 downloads 能力；普通浏览器用 a[download]；都不行就弹出图片让用户长按保存
// claude.ai 预览环境里才有 window.claude；正式站上恒为 undefined，走 a[download]
interface Downloads { save(o: { filename: string; data: Blob }): Promise<void> }
type ClaudeHost = { use(name: 'downloads'): Promise<Downloads> };
let downloadsP: Promise<Downloads | null | undefined> | null = null;
const getDownloads = () => {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  return (downloadsP ||= host?.use ? host.use('downloads').catch(() => null) : Promise.resolve(undefined));
};
async function offer(filename: string, blob: Blob) {
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast(t('saved') + filename); return true; }
    catch (err) {
      const e = err as { code?: string } | null;
      if (e && e.code === 'declined') { toast(t('declined')); return false; }
      if (e && e.code === 'rate_limited') { toast(t('busy')); return false; }
    }
  }
  const url = URL.createObjectURL(blob);
  if (dl === undefined && window.top === window.self) {
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t('saved') + filename);
    return true;
  }
  $('resultImg').src = url; $('result').hidden = false;
  return false;
}
$('resultClose').addEventListener('click', () => { $('result').hidden = true; });
$('code').addEventListener('click', async () => {
  const url = shareUrl(curCode());
  try { await navigator.clipboard.writeText(url); toast(t('copied') + url); }
  catch { history.replaceState(null, '', '/p/' + curCode()); toast(url); } // 剪贴板不可用时至少把地址栏换成分享链接
});
const canvasBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
let exporting = false;
$('doExport').addEventListener('click', async () => {
  const [w, h] = exportDims(), m = P.create(S.scene, simOpts());
  const base = `pixtides-${curCode()}-${w}x${h}${S.shape === 'square' ? '' : '-' + S.shape}`;
  if (S.fmt === 'svg') { offer(base + '.svg', new Blob([P.toSVG(m, w, h, S.shape)], { type: 'image/svg+xml' })); return; }
  if (exporting) return;
  exporting = true; $('doExport').disabled = true;
  toast(t('making'));
  try {
    const png = await P.encodePNG(m, w, h, S.shape, (done, total) => toast(t('makingPct', { n: Math.round((done / total) * 100) })));
    await offer(base + '.png', new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  } catch { toast(t('failed')); }
  finally { exporting = false; $('doExport').disabled = false; }
});
$('pairExport').addEventListener('click', async () => {
  const [a, b] = P.pairCanvases(pairSim(), 2048, 'circle'), code = curCode();
  if (await offer(`pixtides-${code}-pair-A.png`, await canvasBlob(a))) await offer(`pixtides-${code}-pair-B.png`, await canvasBlob(b));
});

// ================= 收集日历（弹层）：回看任意一天 =================
let calMonth = todayKey.slice(0, 7);
const days = new Set(store.get<string[]>('pt-days', []));
function collect(key: string) { days.add(key); store.set('pt-days', [...days]); $('calBadge').textContent = days.size; }
collect(todayKey);
function drawCal() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1), daysIn = new Date(y, m, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const g = $('calGrid');
  g.textContent = '';
  T[lang].wd.forEach((w) => { const s = document.createElement('span'); s.className = 'wd'; s.textContent = w; g.append(s); });
  for (let i = 0; i < lead; i++) g.append(document.createElement('span'));
  for (let d = 1; d <= daysIn; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'day'; b.textContent = String(d);
    b.setAttribute('aria-pressed', String(key === heroDay));
    if (key > todayKey) { b.classList.add('future'); b.disabled = true; }
    if (key === todayKey) b.classList.add('today');
    if (days.has(key)) {
      b.classList.add('got');
      const cv = document.createElement('canvas'), pk = P.dayPick(key, SEA);
      cv.width = cv.height = 48;
      P.paint(cv.getContext('2d')!, P.create(pk.scene, { grid: 8, seed: pk.seed, variant: 'day' }), 48, 48);
      b.append(cv);
    }
    b.addEventListener('click', () => { setHeroDay(key); closeCal(); window.scrollTo({ top: 0, behavior: reduce.matches ? 'auto' : 'smooth' }); });
    g.append(b);
  }
  $('calMonth').textContent = calMonth;
  $('calCount').textContent = t('collected', { n: days.size });
}
const shiftMonth = (k: number) => { const [y, m] = calMonth.split('-').map(Number), d = new Date(y, m - 1 + k, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; drawCal(); };
$('calPrev').addEventListener('click', () => shiftMonth(-1));
$('calNext').addEventListener('click', () => shiftMonth(1));
function closeCal() { $('calSheet').hidden = true; }
$('openCal').addEventListener('click', () => { calMonth = heroDay.slice(0, 7); drawCal(); $('calSheet').hidden = false; $('closeCal').focus(); });
$('closeCal').addEventListener('click', closeCal);
$('calSheet').addEventListener('click', (e: any) => { if (e.target === $('calSheet')) closeCal(); });
document.addEventListener('keydown', (e: any) => { if (e.key === 'Escape') closeCal(); });
// ================= 我的海：选画面 + 名字 / 生日 → 种子 =================
const mineView = new P.View($('mineCv'));
let mineMode: 'name' | 'birthday' | 'combo' = 'name', mineScene = SEA[0];
let mineResult: { scene: E.Scene; seed: number; kind: string; label: string } | null = null;
(function buildMineScenes() {
  const box = $('mineScenes');
  SEA.forEach((sc) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'scene'; b.dataset.v = sc.id;
    const cv = document.createElement('canvas'); cv.width = cv.height = 112;
    b.append(cv, document.createElement('span'));
    box.append(b);
    P.paint(cv.getContext('2d')!, P.create(sc, { grid: 12, seed: P.hashStr(sc.id), rare: false }), 112, 112);
  });
  box.addEventListener('click', (e: any) => {
    const b = e.target.closest('.scene');
    if (!b) return;
    mineScene = P.byId[b.dataset.v];
    makeMine();
  });
})();
function makeMine() {
  const typed = ($('mineText').value || $('mineText').placeholder).trim();
  const withYear = $('mineYear').checked;
  // 不含年份时用 2000 年（闰年，2 月 29 日也能选），只取月日参与计算
  const key = withYear ? P.normalizeDate($('mineDate').value) || '2000-01-01' : `2000-${$('mineMonth').value}-${$('mineDay').value}`;
  let r: { scene: E.Scene; seed: number }, label: string, explain: string;
  if (mineMode === 'name') {
    const n = P.namePick(typed, mineScene) || P.namePick('像素潮', mineScene)!; // 只有分隔符的输入规范化后为空，退回占位
    r = n;
    label = t('mineName', { t: typed });
    explain = t('mineNameExplain', { n: n.text });
  } else if (mineMode === 'birthday') {
    const b = P.birthdayPick(key, SEA, withYear, mineScene);
    r = b;
    label = t(withYear ? 'mineDay' : 'mineMD', { d: b.date });
    explain = withYear && b.daySceneOfDate ? t('mineDayExplain', { d: key, n: b.no ?? '', s: b.daySceneOfDate.name[lang] }) : t('mineMDExplain', { d: b.date });
  } else {
    const c = P.comboPick(typed, key, withYear, mineScene) || P.comboPick('像素潮', key, withYear, mineScene)!;
    r = c;
    label = t('mineCombo', { t: typed, d: c.date });
    explain = t('mineComboExplain', { n: c.text, d: c.date });
  }
  mineResult = { scene: r.scene, seed: r.seed, kind: mineMode, label };
  $('mineName').textContent = label;
  $('mineExplain').textContent = explain;
  const s = P.create(mineResult.scene, { grid: 24, seed: mineResult.seed });
  const w = Math.round(($('mineCv').clientWidth || 360) * dpr());
  mineView.attach(s, w, w);
  mineView.render();
  $('mineCode').textContent = mineResult.scene.name[lang] + ' · ' + P.shortCode(mineResult.scene, mineResult.seed) + (s.rare ? ' · ' + t('rare') : '');
  press($('mineScenes'), mineScene.id);
  $('mineSceneOut').textContent = mineScene.name[lang];
  document.querySelectorAll('#mineScenes .scene span').forEach((sp, i) => { sp.textContent = SEA[i].name[lang]; });
}
$('mineTabs').addEventListener('click', (e: any) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  mineMode = b.dataset.v;
  press($('mineTabs'), mineMode);
  $('mineText').hidden = mineMode === 'birthday';
  $('yearRow').hidden = mineMode === 'name';
  syncDateInputs();
  makeMine();
});
$('mineForm').addEventListener('submit', (e: any) => { e.preventDefault(); makeMine(); });
// 月 / 日下拉：日数随月份变化
(function fillMonths() {
  $('mineMonth').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}</option>`).join('');
})();
function fillDays(keep: string) {
  const n = new Date(2000, +$('mineMonth').value, 0).getDate();
  $('mineDay').innerHTML = Array.from({ length: n }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}</option>`).join('');
  $('mineDay').value = String(Math.min(+keep || 1, n)).padStart(2, '0');
}
function syncDateInputs() {
  const needDate = mineMode !== 'name', withYear = $('mineYear').checked;
  $('mineDate').hidden = !(needDate && withYear);
  $('mdRow').hidden = !(needDate && !withYear);
  const monthWord = lang === 'zh' ? '月' : '', dayWord = lang === 'zh' ? '日' : '';
  $('mineMonth').querySelectorAll('option').forEach((o: HTMLOptionElement, i: number) => { o.textContent = i + 1 + monthWord; });
  $('mineDay').querySelectorAll('option').forEach((o: HTMLOptionElement, i: number) => { o.textContent = i + 1 + dayWord; });
}
$('mineYear').addEventListener('change', () => {
  const full = P.normalizeDate($('mineDate').value) || '2000-01-01';
  if ($('mineYear').checked) { // 打开：把月日放回带年份的日期里，年份保持原来的
    const y = full.slice(0, 4), m = $('mineMonth').value, last = new Date(+y, +m, 0).getDate(); // 平年没有 2 月 29 日，就落到 28 日
    $('mineDate').value = `${y}-${m}-${String(Math.min(+$('mineDay').value, last)).padStart(2, '0')}`;
  } else { // 关闭：日期框换成月 / 日，值跟着带过来
    $('mineMonth').value = full.slice(5, 7);
    fillDays(full.slice(8, 10));
  }
  syncDateInputs();
  makeMine();
});
$('mineDate').addEventListener('change', makeMine);
$('mineMonth').addEventListener('change', () => { fillDays($('mineDay').value); syncDateInputs(); makeMine(); });
$('mineDay').addEventListener('change', makeMine);
$('mineMonth').value = '01'; fillDays('01');
$('mineOpen').addEventListener('click', () => {
  if (!mineResult) return;
  openInEditor({ scene: mineResult.scene, seed: mineResult.seed, ratio: RATIOS[0], variant: 'day' },
    { kind: 'mine', label: t('mineTitle') + ' · ' + mineResult.label, code: P.shortCode(mineResult.scene, mineResult.seed) });
});

// ================= 分类入口 =================
interface Card { el: HTMLElement; cv: HTMLCanvasElement; sim: Sim; view: E.View; playing: boolean; t: number }
const cards: Card[] = [];
function buildCats() {
  const grid = $('catGrid');
  grid.textContent = ''; cards.length = 0;
  for (const c of P.CATEGORIES) {
    const live = c.live;
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'cat';
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const b = document.createElement('b'); b.textContent = c.name[lang];
    const sm = document.createElement(live ? 'small' : 'span');
    sm.className = live ? '' : 'soon'; sm.textContent = live ? String(c.count) : t('soon');
    meta.append(b, sm); el.append(cv, meta); grid.append(el);
    if (live) el.addEventListener('click', () => openInEditor({ scene: P.byId[c.cover], seed: P.randomSeed(), variant: 'day' }, null));
    const card: Card = { el, cv, sim: P.create(P.byId[c.cover], { grid: 16, seed: P.hashStr(c.id), rare: false }), view: new P.View(cv), playing: false, t: 0 };
    const on = () => { if (!reduce.matches) { card.playing = true; kick(); } }, off = () => { card.playing = false; };
    el.addEventListener('pointerenter', on); el.addEventListener('pointerdown', on);
    el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
    el.addEventListener('pointerup', (e: PointerEvent) => { if (e.pointerType !== 'mouse') off(); });
    el.addEventListener('focus', on); el.addEventListener('blur', off);
    cards.push(card);
  }
  sizeCards();
}
function sizeCards() { cards.forEach((c) => { const w = Math.round(c.cv.clientWidth * dpr()) || 320; c.view.attach(c.sim, w, w); c.view.render(); }); }

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

// ================= 统一动画循环（10 fps；溶解时逐帧） =================
const FPS = 10;
let raf = 0, last = 0, acc = 0;
function frame(now: number) {
  raf = 0;
  if (document.hidden) return;
  const dt = Math.min(0.25, (now - (last || now)) / 1000);
  last = now;
  const moving = !reduce.matches;
  acc += dt;
  const tick = acc >= 1 / FPS;
  if (tick) acc %= 1 / FPS;
  if (heroVisible) {
    if (moving && tick) heroSim!.setTime(P.globalTime());
    if ((moving && tick) || heroView.busy) heroView.render();
  }
  if (editVisible) { // 编辑区一直动：用户只定构图和配色，浪的细小起伏由时间驱动
    if (moving && tick) { editTime += 1 / FPS; sim.setTime(editTime); }
    if ((moving && tick) || view.busy) { view.render(); drawAvatars(); }
  }
  if (tick) cards.forEach((c) => { if (c.playing) { c.t += 1 / FPS; c.sim.setTime(c.t); c.view.render(); } });
  const busy = heroView.busy || view.busy || cards.some((c) => c.playing) || (moving && (heroVisible || editVisible));
  if (busy) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', kick);
reduce.addEventListener?.('change', () => { syncUi(); kick(); });
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.target === hero) heroVisible = e.isIntersecting; else editVisible = e.isIntersecting; });
  kick();
});
io.observe(hero); io.observe($('edit'));

// ================= 语言 =================
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i]').forEach((el) => { el.textContent = t(el.dataset.i!); });
  document.querySelectorAll<HTMLElement>('[data-i-title]').forEach((el) => { el.title = t(el.dataset.iTitle!); });
  $('lang').textContent = t('lang');
  $('lang').setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
  $('prev').setAttribute('aria-label', t('prev')); $('next').setAttribute('aria-label', t('next'));
  syncThemeChip(); syncGrainChip(); updateTimeLabel(); updateSyncPlate();
  buildCats();
  if (sim) syncUi();
  updateDayPlate();
  if (!$('calSheet').hidden) drawCal();
  syncDateInputs();
  makeMine();
  if (!$('sheet').hidden) syncExport();
}
$('lang').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; store.set('pt-lang', lang); applyLang(); });

let rt = 0, lastSize = '';
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = window.setTimeout(() => {
    const size = hero.clientWidth + 'x' + hero.clientHeight;
    if (size !== lastSize) { lastSize = size; buildHero(); }
    rebuild(); sizeCards();
  }, 180);
});

// ================= 启动 =================
// 地址里的编号直接打开那张图：/p/SH-7KQ9-ZT2M（分享链接），老链接 #SH-7KQ9-ZT2M 也认
const pathCode = decodeURIComponent(location.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1] || '');
const fromHash = P.parseRecipe(pathCode || location.hash.replace('#', ''), SEA);
buildHero();
lastSize = hero.clientWidth + 'x' + hero.clientHeight;
buildChips();
if (fromHash) {
  const { ratio, ...rest } = fromHash;
  Object.assign(S, rest, { ratio: RATIOS.find((r) => r.id === ratio) || RATIOS[0] });
  S.origin = { kind: 'code', code: P.encodeRecipe(fromHash) };
}
rebuild();
applyLang();
if (fromHash) $('edit').scrollIntoView();
kick();
if (document.fonts) document.fonts.ready.then(sizeCards);
