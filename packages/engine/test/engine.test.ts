import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  create, dayPick, encodePNG, edges, exportSize, findRare, namePick, normalizeDate, normalizeName, parseCode, rareOf,
  rowSpan, sha256, shortCode, textSeed, toSVG, SEED_SPACE, encodeRecipe, parseRecipe, recipeOptions, RECIPE_DEFAULTS, type Recipe, type Sim, type Variant,
} from '../src/index';
import { byId, LIVE, SCENES } from '@pixtides/scenes';

const require = createRequire(import.meta.url);
const fnv = (a: Uint8Array) => createHash('sha256').update(a).digest('hex').slice(0, 16);
const VARIANTS: Variant[] = ['dawn', 'day', 'dusk', 'night'];

// 已上线的设计稿引擎（design/proto-engine.js）：V0 引擎必须逐格一致，老编号才能还原成同一张图
function loadProto() {
  const src = readFileSync(require.resolve('../../../design/proto-engine.js'), 'utf8');
  const ctx: Record<string, unknown> = { TextEncoder, Math, Date, console };
  ctx.globalThis = ctx;
  runInNewContext(src, ctx);
  return ctx.PixTides as {
    create: (id: string, o: object) => { cells: Uint8Array; pal: string[]; setTime: (t: number) => void; rare: string | null };
    shortCode: (s: object, seed: number) => string;
    dayPick: (k: string, pool: object[]) => { scene: { id: string }; seed: number; no: number };
    namePick: (t: string, s: object) => { seed: number };
    SCENES: { id: string; cat: string }[];
    byId: Record<string, object>;
  };
}

describe('与已上线的设计稿引擎一致', () => {
  const P = loadProto();
  const cases: { id: string; o: Record<string, unknown> }[] = [];
  // 只比已上线的海与水：其余分类在设计稿里只是首页缩略图，V1 重新定义
  for (const s of LIVE) for (const v of VARIANTS) {
    cases.push({ id: s.id, o: { seed: 123456789 + s.id.length * 7919, variant: v } });
  }
  for (const id of ['shoal', 'tide', 'ripple', 'waterfall', 'moonsea', 'abyss']) {
    cases.push({ id, o: { grid: 64, ratio: [9, 19.5], seed: 2 ** 39 + 17, variant: 'day', time: 24110499.3 } });
    cases.push({ id, o: { grid: 12, ratio: [21, 9], seed: 42, hue: 120, invert: true, bands: 9, amp: 1.7, terrace: 1.6, dots: 2.4, dotMax: 3, pair: 0.5, angle: 33 } });
  }
  it.each(cases)('$id $o', ({ id, o }) => {
    const a = create(byId[id], o as never);
    const b = P.create(id, o);
    expect(a.pal).toEqual(Array.from(b.pal));
    expect(fnv(a.cells)).toBe(fnv(b.cells));
    a.setTime((o.time as number ?? 0) + 7.3);
    b.setTime((o.time as number ?? 0) + 7.3);
    expect(fnv(a.cells)).toBe(fnv(b.cells));
  });
  it('编号、今日一张、名字种子一致', () => {
    const pool = P.SCENES.filter((s) => s.cat === 'sea');
    for (const key of ['2026-10-07', '2026-12-31', '1990-02-03', '2030-06-15']) {
      const a = dayPick(key, LIVE), b = P.dayPick(key, pool);
      expect([a.scene.id, a.seed, a.no]).toEqual([b.scene.id, b.seed, b.no]);
    }
    expect(namePick('王 小明', byId.shoal)!.seed).toBe(P.namePick('王 小明', P.byId.shoal).seed);
    for (const seed of [0, 1, 4294967295, SEED_SPACE - 1]) expect(shortCode(byId.tide, seed)).toBe(P.shortCode(P.byId.tide, seed));
  });
});

describe('快照：固定种子 → 固定画面', () => {
  it.each(LIVE.map((s) => s.id))('%s', (id) => {
    const out = VARIANTS.map((v) => fnv(create(byId[id], { seed: 20261007, variant: v }).cells));
    expect(out).toMatchSnapshot();
  });
});

describe('全球同步：任何时刻打开，推进到同一时刻画面一致', () => {
  it.each(SCENES.map((s) => s.id))('%s', (id) => {
    const t = 24110499.5;
    const a = create(byId[id], { grid: 20, ratio: [9, 19.5], seed: 77, time: t });
    const b = create(byId[id], { grid: 20, ratio: [9, 19.5], seed: 77, time: t - 60 });
    for (let i = 0; i < 600; i++) b.step(0.1);
    b.setTime(t);
    expect(fnv(a.cells)).toBe(fnv(b.cells));
  });
  it('换时段只换颜色，构图不变', () => {
    const day = create(byId.shoal, { seed: 9, variant: 'day' });
    const dusk = create(byId.shoal, { seed: 9, variant: 'dusk' });
    let diff = 0;
    for (let i = 0; i < day.cells.length; i++) if ((day.cells[i] < day.L) !== (dusk.cells[i] < dusk.L) || (day.cells[i] < day.L && day.cells[i] !== dusk.cells[i])) diff++;
    expect(diff / day.cells.length).toBeLessThan(0.05); // 只有被换成反光色的散落方块不同
  });
});

describe('文字种子 v1', () => {
  it('SHA-256 与 Node 一致', () => {
    for (const s of ['', 'abc', '像素潮 PixTides', 'a'.repeat(200)]) {
      const hex = Array.from(sha256(s), (x) => x.toString(16).padStart(8, '0')).join('');
      expect(hex).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
  it('取前 5 字节', () => {
    const d = createHash('sha256').update('pixtides/v1/name/王小明').digest();
    expect(textSeed('name', '王小明')).toBe(d.readUIntBE(0, 5));
  });
  it('名字规范化：去空格分隔符，繁简不合并', () => {
    expect(normalizeName(' 王 小明 ')).toBe('王小明');
    expect(normalizeName('Mary-Jane')).toBe('maryjane');
    expect(normalizeName('ＡＢＣ　ｄ')).toBe('abcd');
    expect(namePick('张伟', byId.shoal)!.seed).not.toBe(namePick('張偉', byId.shoal)!.seed);
  });
  it('日期写法统一', () => {
    expect(normalizeDate('2026年10月7日')).toBe('2026-10-07');
    expect(normalizeDate('20261007')).toBe('2026-10-07');
    expect(normalizeDate('1990/2/30')).toBeNull();
  });
  it('今日一张：相邻两天不重复同一画面', () => {
    let prev = '';
    for (let i = -500; i < 500; i++) {
      const key = new Date(Date.UTC(2026, 9, 7 + i)).toISOString().slice(0, 10);
      const id = dayPick(key, LIVE).scene.id;
      expect(id).not.toBe(prev);
      prev = id;
    }
    expect(dayPick('2026-10-07', LIVE).no).toBe(1);
  });
});

describe('编号', () => {
  it('往返、大小写与易混字母', () => {
    for (const seed of [0, 1, 123456789, SEED_SPACE - 1]) {
      const code = shortCode(byId.ripple, seed);
      expect(parseCode(code, SCENES)).toEqual({ scene: byId.ripple, seed });
      expect(parseCode(code.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o'), SCENES)?.seed).toBe(seed);
    }
    expect(parseCode('ZZ-1234-5678', SCENES)).toBeNull();
    expect(parseCode('SH-1234', SCENES)?.seed).toBe(parseInt('1234', 32)); // 旧的短种子仍可解析
    expect(parseCode('SH-UUUU-UUUU', SCENES)).toBeNull();
  });
  it('配方编号：默认参数不加尾段，改动的参数都能还原', () => {
    const base: Recipe = { scene: byId.moonsea, seed: 987654321012, ...RECIPE_DEFAULTS };
    expect(encodeRecipe(base)).toBe(shortCode(byId.moonsea, 987654321012));
    const cases: Partial<Recipe>[] = [
      { grid: 96 }, { variant: 'dusk', grid: 16 }, { ratio: '9x19_5', hue: 359, invert: true },
      { angle: 0, amp: 0, terrace: 2.5, bands: 10, dots: 3, dotMax: 2, pair: 0.6, silhouette: false, silSeed: 15 },
      { amp: 1.3, terrace: 0.4, dots: 0, pair: 0.02, angle: 271, bands: 4 },
    ];
    for (const c of cases) {
      const r = { ...base, ...c };
      const code = encodeRecipe(r);
      expect(parseRecipe(code, SCENES)).toEqual(r);
      expect(parseRecipe(code.toLowerCase(), SCENES)).toEqual(r);
      const a = create(r.scene, recipeOptions(r)), b = create(r.scene, recipeOptions(parseRecipe(code, SCENES)!));
      expect(fnv(a.cells)).toBe(fnv(b.cells));
    }
    expect(encodeRecipe({ ...base, variant: 'dusk', grid: 16 }).length).toBeLessThanOrEqual(17);
  });
  it('稀有彩蛋约 1/512，只在指定画面', () => {
    let n = 0;
    for (let s = 0; s < 100000; s++) if (rareOf(byId.shoal, s)) n++;
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(250);
    expect(findRare(byId.icelake, 0)).toBeNull();
    const s = findRare(byId.tide, 1000)!;
    expect(create(byId.tide, { seed: s }).rare).toBe('whale');
  });
});

describe('导出', () => {
  it('分辨率档位', () => {
    expect(exportSize('8K', [1, 1])).toEqual([8192, 8192]);
    expect(exportSize('1080p', [9, 19.5])).toEqual([1080, 2340]);
    expect(exportSize('4K', [16, 9])).toEqual([3840, 2160]);
  });

  // 最小 PNG 解码：只处理本编码器的输出（8 位索引色、过滤类型 0）
  function decode(png: Uint8Array) {
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let off = 8, w = 0, h = 0, plte: Uint8Array | null = null, trns: Uint8Array | null = null;
    const idat: Uint8Array[] = [];
    while (off < png.length) {
      const len = dv.getUint32(off), type = new TextDecoder().decode(png.subarray(off + 4, off + 8));
      const data = png.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') { w = dv.getUint32(off + 8); h = dv.getUint32(off + 12); expect([data[8], data[9]]).toEqual([8, 3]); }
      if (type === 'PLTE') plte = data;
      if (type === 'tRNS') trns = data;
      if (type === 'IDAT') idat.push(data);
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    expect(raw.length).toBe((w + 1) * h);
    return { w, h, plte: plte!, trns, px: (x: number, y: number) => raw[y * (w + 1) + 1 + x] };
  }

  function expected(sim: Sim, w: number, h: number) {
    const xe = edges(sim.W, w), ye = edges(sim.H, h);
    const col = (x: number) => { let i = 0; while (xe[i + 1] <= x) i++; return i; };
    const row = (y: number) => { let i = 0; while (ye[i + 1] <= y) i++; return i; };
    return (x: number, y: number) => sim.cells[row(y) * sim.W + col(x)];
  }

  it('方形 PNG 每个像素都对应正确的格子', async () => {
    const sim = create(byId.tide, { seed: 5, grid: 24, ratio: [9, 16] });
    const [w, h] = [301, 533]; // 故意除不尽
    const d = decode(await encodePNG(sim, w, h, 'square'));
    expect([d.w, d.h]).toEqual([w, h]);
    expect(d.trns).toBeNull();
    const exp = expected(sim, w, h);
    for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 5) expect(d.px(x, y)).toBe(exp(x, y));
    const hex = (i: number) => '#' + Array.from(d.plte.subarray(i * 3, i * 3 + 3), (v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    expect(sim.pal.map((_, i) => hex(i))).toEqual(sim.pal);
  });

  it('圆形 PNG：圆外透明，圆内是画面', async () => {
    const sim = create(byId.shoal, { seed: 8 });
    const s = 400, d = decode(await encodePNG(sim, s, s, 'circle'));
    const clear = sim.pal.length;
    expect(d.trns![clear]).toBe(0);
    expect(d.px(0, 0)).toBe(clear);
    expect(d.px(200, 200)).not.toBe(clear);
    for (let y = 0; y < s; y += 9) {
      const sp = rowSpan('circle', y, s, s);
      if (!sp) { expect(d.px(200, y)).toBe(clear); continue; }
      if (sp[0] > 0) expect(d.px(sp[0] - 1, y)).toBe(clear);
      expect(d.px(sp[0], y)).not.toBe(clear);
    }
  });

  it('8K 也能编码，且体积很小', async () => {
    const sim = create(byId.reef, { seed: 3, grid: 64 });
    const png = await encodePNG(sim, 8192, 8192, 'round');
    expect(png.length).toBeLessThan(3 * 1024 * 1024);
    const d = decode(png);
    expect([d.w, d.h]).toEqual([8192, 8192]);
  }, 60000);

  it('SVG 带尺寸和形状裁剪', () => {
    const svg = toSVG(create(byId.shoal, { seed: 1 }), 2048, 2048, 'circle');
    expect(svg).toContain('width="2048"');
    expect(svg).toContain('<clipPath id="s"><circle');
  });
});
