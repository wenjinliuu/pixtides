# 像素潮 PixTides

纯前端、实时生成的像素风自然风景站：选一个画面，掷骰子，调到喜欢，下载当头像或壁纸。

- 设计方案：[docs/DESIGN.md](docs/DESIGN.md)
- 设计稿（可交互原型）：[design/home.html](design/home.html)

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `packages/engine` | 引擎：场景 + 参数 + 种子 + 时间 → 格子矩阵；预览、PNG（索引色，到 8K）、SVG、编号、文字种子 |
| `packages/scenes` | 场景定义，加新画面只改这里 |
| `apps/web` | 网站（Astro 静态构建），首页与编辑器同一页 |
| `design/` | 设计稿，引擎测试拿它的 `proto-engine.js` 核对逐格一致 |

```bash
pnpm install
pnpm dev         # 本地开发
pnpm test        # 引擎测试（快照、与设计稿逐格一致、PNG 解码）
pnpm typecheck
pnpm build       # 产物在 apps/web/dist
npx wrangler dev # 按 wrangler.jsonc 本地预览（含 _redirects 和 /p/<编号> 回退）
```

改了页面文案后运行 `python3 -I apps/web/tools/subset-font.py` 重新生成中文像素字体子集并提交。

## 部署（Cloudflare Workers 静态资源）

Cloudflare 后台连接本仓库：构建命令 `pnpm build`，部署命令 `npx wrangler deploy`，生产分支 `main`。推送 main 自动部署。

## 许可

代码 MIT；生成的图片归用户，可随意使用，包括商用。中文像素字体为 Fusion Pixel 的子集（OFL-1.1，改名 PixTides Pixel），见 `apps/web/public/fonts/OFL.txt`。
