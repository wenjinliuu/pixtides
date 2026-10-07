// 像素潮 · 小红书小工具版：单页，选画面 / 配色 / 粒度 / 比例，画布一直在动；保存到相册、带图发笔记都走容器接口（window.xhs.miniTool）。
// 构建：esbuild 打成一个经典脚本、转译到 Chrome 61（见 build.mjs）。容器不联网、不能下载文件、不能用剪贴板。
import { create, encodeRecipe, exportSize, hashStr, randomSeed, toCanvas, uiTokens, paint, View, RECIPE_DEFAULTS, RATIOS, type Recipe, type Scene, type Sim, type Variant } from '@pixtides/engine';
import { SCENES, CATEGORIES } from '@pixtides/scenes';

interface MiniTool {
  saveImageToPhotosAlbum?(o: { filePath: string }): Promise<unknown>;
  writeTempFile?(o: { data: string }): Promise<{ filePath: string }>;
  postNote?(o: { title?: string; content?: string; pageType?: string; mediaInfo: { image_resources: { url: string }[] } }): Promise<unknown>;
  setStorage?(o: { key: string; data: string }): Promise<unknown>;
  getStorage?(o: { key: string }): Promise<{ data?: string }>;
}
const mini = (): MiniTool | null => {
  const x = (window as unknown as { xhs?: { miniTool?: MiniTool } }).xhs;
  return (x && x.miniTool) || null;
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const GRIDS = [16, 24, 32, 48, 64, 96];
const RATIO_IDS: Recipe['ratio'][] = ['1x1', '9x16', '3x4', '16x9'];
const ratioOf = (id: Recipe['ratio']): [number, number] => { const r = RATIOS.filter((x) => x.id === id)[0].r; return [r[0], r[1]]; };

// 当前这张：默认参数 + 用户在这里能改的几项，编号和网页版通用
const S = { scene: SCENES[0], seed: randomSeed(), variant: 'day' as Variant, grid: 48, ratio: '9x16' as Recipe['ratio'] };
let cat = S.scene.cat;
const recipe = (): Recipe => ({ ...RECIPE_DEFAULTS, scene: S.scene, seed: S.seed, variant: S.variant, grid: S.grid, ratio: S.ratio });
const presetsOf = (sc: Scene): Variant[] => sc.presets || ['day'];
const presetName = (sc: Scene, v: Variant) => (v === 'day' ? (sc.look && sc.look.zh) || '原色' : (sc.times && sc.times[v as 'dawn'] && sc.times[v as 'dawn']!.name && sc.times[v as 'dawn']!.name!.zh)) || '配色';

const view = new View($('view') as HTMLCanvasElement);
let sim: Sim | null = null, t = 0;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);

function fit(): [number, number] {
  const stage = $('stage'), box = $('box'), [a, b] = ratioOf(S.ratio);
  // 舞台高度：竖屏比例时高一些，最多占屏幕 55%
  const H = Math.round(Math.min(window.innerHeight * 0.55, b > a ? 460 : 320));
  stage.style.height = H + 'px';
  const W = stage.clientWidth;
  let w = W, h = (W * b) / a;
  if (h > H) { h = H; w = (H * a) / b; }
  box.style.width = Math.floor(w) + 'px'; box.style.height = Math.floor(h) + 'px';
  return [Math.floor(w), Math.floor(h)];
}

function applyTheme() {
  if (!sim) return;
  const ui = uiTokens(sim.pal.slice(0, sim.L), 'dark'), st = document.documentElement.style;
  const map: Record<string, string> = { bg: 'bg', panel: 'panel', raise: 'raise', line: 'line', fg: 'fg', muted: 'muted', accent: 'accent', onAccent: 'on-accent', shadow: 'shadow' };
  for (const k in map) st.setProperty('--' + map[k], ui[k as keyof typeof ui]);
}

function rebuild(dissolve = 0) {
  const [w, h] = fit();
  const next = create(S.scene, { seed: S.seed, variant: S.variant, grid: S.grid, ratio: ratioOf(S.ratio), time: t });
  const pw = Math.round(w * dpr()), ph = Math.round(h * dpr());
  if (dissolve && sim && sim.W === next.W && sim.H === next.H && view.w === pw && view.h === ph) view.dissolve(dissolve);
  sim = next;
  view.attach(sim, pw, ph);
  view.render();
  applyTheme();
  syncUi();
}

// ---------- 控件 ----------
function chip(label: string, on: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip' + (on ? ' on' : ''); b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
const thumbs: Record<string, string> = {};
function thumb(sc: Scene): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = 136;
  const ctx = cv.getContext('2d')!;
  if (thumbs[sc.id]) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = thumbs[sc.id]; }
  else { paint(ctx, create(sc, { grid: 16, seed: hashStr(sc.id), rare: false }), 136, 136); thumbs[sc.id] = cv.toDataURL(); }
  return cv;
}
function buildScenes() {
  const cats = $('cats'); cats.textContent = '';
  CATEGORIES.forEach((c) => cats.appendChild(chip(c.name.zh, c.id === cat, () => { cat = c.id; buildScenes(); $('scenes').scrollLeft = 0; })));
  const box = $('scenes'); box.textContent = '';
  SCENES.filter((s) => s.cat === cat).forEach((sc) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'scene' + (sc === S.scene ? ' on' : '');
    const name = document.createElement('span'); name.textContent = sc.name.zh;
    b.appendChild(thumb(sc)); b.appendChild(name);
    b.addEventListener('click', () => setScene(sc));
    box.appendChild(b);
  });
}
function syncUi() {
  $('name').textContent = S.scene.name.zh;
  $('code').textContent = encodeRecipe(recipe());
  const ps = $('presets'); ps.textContent = '';
  presetsOf(S.scene).forEach((v) => ps.appendChild(chip(presetName(S.scene, v), v === S.variant, () => { S.variant = v; rebuild(350); })));
  const gs = $('grids'); gs.textContent = '';
  GRIDS.forEach((g) => gs.appendChild(chip(g + ' 格', g === S.grid, () => { S.grid = g; rebuild(); })));
  const rs = $('ratios'); rs.textContent = '';
  RATIO_IDS.forEach((r) => rs.appendChild(chip(r.replace('x', ':'), r === S.ratio, () => { S.ratio = r; rebuild(); })));
  const strip = $('scenes').children;
  for (let i = 0; i < strip.length; i++) strip[i].className = 'scene' + (SCENES.filter((s) => s.cat === cat)[i] === S.scene ? ' on' : '');
}
function setScene(sc: Scene) {
  S.scene = sc;
  if (presetsOf(sc).indexOf(S.variant) < 0) S.variant = 'day';
  if (cat !== sc.cat) { cat = sc.cat; buildScenes(); }
  rebuild(400);
}
const step = (d: number) => { const list = SCENES.filter((s) => s.cat === S.scene.cat); setScene(list[(list.indexOf(S.scene) + d + list.length) % list.length]); };
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('dice').addEventListener('click', () => { S.seed = randomSeed(); rebuild(400); });

// 画布上左右滑换画面
(function swipe() {
  const el = $('stage');
  let x0 = 0, y0 = 0, on = false;
  el.addEventListener('touchstart', (e) => { const p = e.touches[0]; x0 = p.clientX; y0 = p.clientY; on = true; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!on) return; on = false;
    const p = e.changedTouches[0], dx = p.clientX - x0, dy = p.clientY - y0;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
})();

// ---------- 导出：浪静下来的那一刻（t = 0），2K 档 ----------
let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast'); el.textContent = msg; el.className = 'toast show';
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { el.className = 'toast'; }, 2400);
}
function imageData(): string {
  const [w, h] = exportSize('2K', ratioOf(S.ratio));
  const still = create(S.scene, { seed: S.seed, variant: S.variant, grid: S.grid, ratio: ratioOf(S.ratio) });
  return toCanvas(still, w, h).toDataURL('image/png');
}
async function imagePath(m: MiniTool): Promise<string> {
  const data = imageData();
  if (m.writeTempFile) { try { return (await m.writeTempFile({ data })).filePath; } catch (e) { /* 写临时文件失败就直接用 data URI */ } }
  return data;
}
let busy = false;
async function withBusy(btn: string, fn: () => Promise<void>) {
  if (busy) return;
  busy = true; ($(btn) as HTMLButtonElement).disabled = true;
  try { await fn(); } finally { busy = false; ($(btn) as HTMLButtonElement).disabled = false; }
}
$('save').addEventListener('click', () => withBusy('save', async () => {
  const m = mini();
  if (!m || !m.saveImageToPhotosAlbum) { toast('请在小红书里打开小工具后保存'); return; }
  toast('正在生成…');
  try { await m.saveImageToPhotosAlbum({ filePath: await imagePath(m) }); toast('已保存到相册'); }
  catch (e) { toast('没有保存成功，请检查相册权限'); }
}));
$('post').addEventListener('click', () => withBusy('post', async () => {
  const m = mini();
  if (!m || !m.postNote) { toast('请在小红书里打开小工具后发笔记'); return; }
  toast('正在生成…');
  const code = encodeRecipe(recipe());
  try {
    await m.postNote({
      title: ('像素潮 · ' + S.scene.name.zh).slice(0, 20),
      content: '用像素潮生成的像素风景「' + S.scene.name.zh + ' · ' + presetName(S.scene, S.variant) + '」。\n编号 ' + code + '，在网页版 pixtides.com 输入编号能得到同一张图。\n#像素风 #壁纸 #头像',
      pageType: 'photo_publish',
      mediaInfo: { image_resources: [{ url: await imagePath(m) }] },
    });
  } catch (e) { toast('没有打开发布页，请稍后再试'); }
}));

// ---------- 动画：10 fps，画布一直在动；切到后台就停 ----------
let last = 0, acc = 0;
function frame(now: number) {
  const dt = Math.min(0.25, (now - (last || now)) / 1000); last = now; acc += dt;
  if (sim && !document.hidden) {
    let tick = false;
    if (acc >= 0.1) { acc %= 0.1; t += 0.1; sim.setTime(t); tick = true; }
    if (tick || view.busy) view.render();
  }
  requestAnimationFrame(frame);
}
let rt = 0;
window.addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(() => rebuild(), 200); });

buildScenes();
rebuild();
requestAnimationFrame(frame);
