// 纯静态站：构建产物 dist/ 由 Cloudflare Workers 静态资源托管（见仓库根目录 wrangler.jsonc）
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://pixtides.com',
  build: { format: 'file' },
});
