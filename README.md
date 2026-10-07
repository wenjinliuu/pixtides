# 像素潮 PixTides

纯前端、实时生成的像素风自然风景站：选一个画面，掷骰子，调到喜欢，下载当头像或壁纸。

- 设计方案：[docs/DESIGN.md](docs/DESIGN.md)
- 设计稿（可交互原型）：[design/home.html](design/home.html)，首页与编辑器同一页；共用引擎 [design/proto-engine.js](design/proto-engine.js)

## 第一版部署（Cloudflare Workers 静态资源）

V0 工程完成前，先把设计稿作为第一版上线（海与水 9 个画面）。

```bash
node design/tools/build-site.mjs   # 生成 site/
npx wrangler deploy                # 按 wrangler.jsonc 发布 site/
```

Cloudflare 后台连接本仓库时：构建命令填 `node design/tools/build-site.mjs`，部署命令保持 `npx wrangler deploy`，生产分支选 `main`。

## 许可

代码 MIT；生成的图片归用户，可随意使用，包括商用。中文像素字体为 Fusion Pixel 的子集（OFL-1.1，改名 PixTides Pixel），见 `design/tools/FusionPixel-OFL.txt`。
