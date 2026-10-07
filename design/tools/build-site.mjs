// 把设计稿组装成可部署的静态站点（site/），供 Cloudflare Workers 静态资源托管。
// 设计稿文件是唯一来源，这里只做复制：home.html → index.html，并保留 home.html / editor.html 旧链接。
// 用法：node design/tools/build-site.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'design');
const out = join(root, 'site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'home.html'), join(out, 'index.html'));
cpSync(join(src, 'home.html'), join(out, 'home.html'));
cpSync(join(src, 'editor.html'), join(out, 'editor.html'));
cpSync(join(src, 'proto-engine.js'), join(out, 'proto-engine.js'));
cpSync(join(src, 'favicon.svg'), join(out, 'favicon.svg'));
// 页面和脚本每次部署都会变：浏览器每次都回源确认，CDN 边缘照常缓存
writeFileSync(join(out, '_headers'), ['/*', '  Cache-Control: public, max-age=0, must-revalidate', '  X-Content-Type-Options: nosniff', ''].join('\n'));
console.log('site/ 已生成');
