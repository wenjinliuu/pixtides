// 打包小红书小工具：dist-minitool/ → pixtides-minitool.zip（index.html 在 zip 根目录）
// JS 打成一个经典脚本（iife），转译到 Chrome 61；字体从网站目录和 @fontsource 拷进包里，不引用任何外部资源。
// 用法（仓库根目录）：node apps/minitool/build.mjs
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'dist-minitool');
const zip = join(root, 'pixtides-minitool.zip');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets', 'fonts'), { recursive: true });
await build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome61'],
  minify: true,
  legalComments: 'none',
  outfile: join(out, 'assets', 'main.js'),
  alias: { '@pixtides/engine': join(root, 'packages/engine/src/index.ts'), '@pixtides/scenes': join(root, 'packages/scenes/src/index.ts') },
});
cpSync(join(here, 'index.html'), join(out, 'index.html'));
cpSync(join(here, 'style.css'), join(out, 'assets', 'style.css'));
cpSync(join(root, 'apps/web/public/fonts/pixtides-pixel.woff2'), join(out, 'assets', 'fonts', 'pixtides-pixel.woff2'));
cpSync(join(root, 'apps/web/node_modules/@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff2'), join(out, 'assets', 'fonts', 'silkscreen.woff2'));

// 自查：产物里不能有容器禁用的写法
const js = readFileSync(join(out, 'assets', 'main.js'), 'utf8');
const banned = ['fetch(', 'XMLHttpRequest', 'eval(', 'new Function(', 'WebAssembly', 'navigator.clipboard', 'window.open(', 'CompressionStream', 'Object.fromEntries', '??'];
const hits = banned.filter((b) => js.includes(b));
if (/\?\.[A-Za-z_$]/.test(js)) hits.push('可选链 ?.'); // 三元的 b?.7 不算
if (hits.length) console.warn('⚠ 产物里出现：' + hits.join('、') + '（请确认是否会被执行）');

rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.DS_Store'], { cwd: out });
console.log(`dist-minitool/ → pixtides-minitool.zip（${(statSync(zip).size / 1024).toFixed(0)} KB）`);
