// 画廊：分类标签 + 瀑布流卡片。每个画面两张示例（不同种子、比例和配色），卡片链到 /p/<编号>，按住或悬停时动起来。
// 分类记在地址的 #sky 这类锚点里，可以直接分享某一类。
import { create, encodeRecipe, hashStr, uiTokens, RECIPE_DEFAULTS, SEED_SPACE, View, type Recipe, type Sim, type Variant, type Scene } from '@pixtides/engine';
import { SCENES, CATEGORIES, byId } from '@pixtides/scenes';

const $ = (id: string) => document.getElementById(id)!;
const store = {
  get<V>(k: string, d: V): V { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 存不了就算了 */ } },
};

const T = {
  zh: { title: '画廊', home: '回首页', all: '全部', note: '{n} 个画面。点卡片打开编辑器，按住看它动起来。', themeAuto: '自动', themeDark: '深色', themeLight: '浅色', lang: 'EN', palDefault: '原色',
    foot: '代码 MIT · 生成的图归你，可商用 · 字体 Fusion Pixel / Silkscreen（OFL）' },
  en: { title: 'Gallery', home: 'Home', all: 'All', note: '{n} scenes. Tap a card to open it in the editor; press and hold to see it move.', themeAuto: 'Auto', themeDark: 'Dark', themeLight: 'Light', lang: '中', palDefault: 'Original',
    foot: 'Code MIT · Your pictures are yours, commercial use OK · Fonts Fusion Pixel / Silkscreen (OFL)' },
};
type Lang = keyof typeof T;
let lang: Lang = store.get<Lang>('pt-lang', navigator.language.startsWith('zh') ? 'zh' : 'en');
if (!(lang in T)) lang = 'zh';
const t = (k: keyof (typeof T)['zh'], vars?: Record<string, string | number>) => {
  let s: string = T[lang][k];
  if (vars) for (const v in vars) s = s.replace('{' + v + '}', String(vars[v]));
  return s;
};

// 主题：和首页同一份设置（pt-theme），界面色从封面画面推出
type ThemeMode = 'auto' | 'dark' | 'light';
const sysDark = matchMedia('(prefers-color-scheme: dark)');
let themeMode = store.get<ThemeMode>('pt-theme', 'auto');
const COVER = create(byId.shoal, { grid: 16, seed: 1, rare: false });
function applyTheme() {
  const mode = themeMode === 'auto' ? (sysDark.matches ? 'dark' : 'light') : themeMode;
  const ui = uiTokens(COVER.pal.slice(0, COVER.L), mode), st = document.documentElement.style;
  document.documentElement.dataset.theme = mode;
  const map: Record<string, string> = { bg: 'bg', panel: 'panel', raise: 'raise', line: 'line', fg: 'fg', muted: 'muted', accent: 'accent', onAccent: 'on-accent', shadow: 'shadow', deep: 'deep' };
  for (const k in map) st.setProperty('--' + map[k], ui[k as keyof typeof ui]);
  $('theme').textContent = t(({ auto: 'themeAuto', dark: 'themeDark', light: 'themeLight' } as const)[themeMode]);
}
$('theme').addEventListener('click', () => {
  themeMode = ({ auto: 'dark', dark: 'light', light: 'auto' } as const)[themeMode] || 'auto';
  store.set('pt-theme', themeMode);
  applyTheme();
});
sysDark.addEventListener?.('change', applyTheme);

// 卡片：每个画面两张。第二张换比例、换到第二套精选配色（有的话）
const RATIOS: Recipe['ratio'][] = ['1x1', '9x16', '4x5', '16x9', '3x4'];
interface Item { scene: Scene; recipe: Recipe }
const items: Item[] = [];
SCENES.forEach((scene, i) => {
  const presets: Variant[] = scene.presets || ['day'];
  for (let k = 0; k < 2; k++) {
    const seed = (hashStr(scene.id + '/gallery/' + k) * 977 + k) % SEED_SPACE;
    const ratio = k === 0 ? (i % 3 === 0 ? '4x5' : '1x1') : RATIOS[(i + k) % RATIOS.length];
    const variant = presets[k % presets.length];
    items.push({ scene, recipe: { scene, seed, ...RECIPE_DEFAULTS, ratio, variant, grid: 48 } });
  }
});

const presetName = (sc: Scene, v: Variant) => (v === 'day' ? sc.look?.[lang] || t('palDefault') : sc.times?.[v]?.name?.[lang]) || '';
const ratioOf = (id: Recipe['ratio']): [number, number] => { const [a, b] = id.split('x'); return [+a, +b.replace('_', '.')]; };

interface Card { el: HTMLAnchorElement; cv: HTMLCanvasElement; item: Item; sim: Sim | null; view: View | null; playing: boolean; t: number }
const cards: Card[] = [];
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

function paintCard(c: Card) {
  const [a, b] = ratioOf(c.item.recipe.ratio);
  const w = Math.round((c.cv.clientWidth || 240) * dpr()), h = Math.round((w * b) / a);
  if (!c.sim) {
    const r = c.item.recipe;
    c.sim = create(r.scene, { seed: r.seed, grid: r.grid, ratio: [a, b], variant: r.variant, rare: true });
    c.view = new View(c.cv);
  }
  c.view!.attach(c.sim, w, h);
  c.view!.render();
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const c = cards.find((x) => x.cv === e.target);
    if (c && !c.sim) paintCard(c);
  }
}, { rootMargin: '400px' });

let cat = (location.hash.slice(1) || 'all');
if (cat !== 'all' && !CATEGORIES.some((c) => c.id === cat)) cat = 'all';

function buildTabs() {
  const tabs = $('tabs');
  tabs.textContent = '';
  const add = (id: string, label: string, n: number) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.v = id;
    b.setAttribute('aria-pressed', String(id === cat));
    b.append(label);
    const s = document.createElement('small'); s.textContent = String(n); b.append(s);
    tabs.append(b);
  };
  add('all', t('all'), SCENES.length);
  for (const c of CATEGORIES) add(c.id, c.name[lang], SCENES.filter((s) => s.cat === c.id).length);
}
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
  if (!b || b.dataset.v === cat) return;
  cat = b.dataset.v!;
  history.replaceState(null, '', cat === 'all' ? location.pathname : '#' + cat);
  buildTabs(); buildGrid();
});

function buildGrid() {
  const grid = $('grid');
  for (const c of cards) io.unobserve(c.cv);
  grid.textContent = ''; cards.length = 0;
  for (const item of items) {
    if (cat !== 'all' && item.scene.cat !== cat) continue;
    const el = document.createElement('a');
    el.className = 'g-card';
    el.href = '/p/' + encodeRecipe(item.recipe);
    const cv = document.createElement('canvas');
    const [a, b] = ratioOf(item.recipe.ratio);
    cv.style.aspectRatio = `${a} / ${b}`;
    cv.setAttribute('aria-hidden', 'true');
    const meta = document.createElement('div'); meta.className = 'meta';
    const name = document.createElement('b'); name.textContent = item.scene.name[lang];
    const pal = document.createElement('small'); pal.textContent = presetName(item.scene, item.recipe.variant);
    meta.append(name, pal); el.append(cv, meta); grid.append(el);
    const card: Card = { el, cv, item, sim: null, view: null, playing: false, t: 0 };
    const on = () => { if (!reduce.matches) { if (!card.sim) paintCard(card); card.playing = true; kick(); } };
    const off = () => { card.playing = false; };
    el.addEventListener('pointerenter', on); el.addEventListener('pointerdown', on);
    el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
    el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') off(); });
    el.addEventListener('focus', on); el.addEventListener('blur', off);
    cards.push(card);
    io.observe(cv);
  }
}

// 动画：只推进正在播放的卡片，10 fps
let raf = 0, acc = 0, last = 0;
function frame(now: number) {
  raf = 0;
  const dt = Math.min(0.25, (now - (last || now)) / 1000); last = now; acc += dt;
  if (acc >= 0.1) { acc %= 0.1; for (const c of cards) if (c.playing && c.sim) { c.t += 0.1; c.sim.setTime(c.t); c.view!.render(); } }
  if (cards.some((c) => c.playing)) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i]').forEach((el) => { el.textContent = t(el.dataset.i as keyof (typeof T)['zh']); });
  $('note').textContent = t('note', { n: SCENES.length });
  $('lang').textContent = t('lang');
  $('lang').setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
  document.title = (lang === 'zh' ? '画廊 · 像素潮 PixTides' : 'Gallery · PixTides');
  applyTheme(); buildTabs(); buildGrid();
}
$('lang').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; store.set('pt-lang', lang); applyLang(); });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1) || 'all'; if (h !== cat) { cat = h; buildTabs(); buildGrid(); } });
let rt = 0;
window.addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(() => cards.forEach((c) => c.sim && paintCard(c)), 200); });

applyLang();
