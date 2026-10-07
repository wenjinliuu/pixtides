"""把 Fusion Pixel 12px 比例 zh_hans 子集化，只保留网站用到的字符，输出 public/fonts/pixtides-pixel.woff2。

用法（在仓库根目录）：python3 -I apps/web/tools/subset-font.py
字体来源：devDependency @fontsource/fusion-pixel-12px-proportional-sc（OFL-1.1），需要 pip 装 fonttools + brotli。
Fusion Pixel 声明了保留字体名（Reserved Font Name），子集属于修改版，
按 OFL 第 3 条不能再叫 "Fusion Pixel"，所以改名为 "PixTides Pixel"。改了页面文案后重跑一次并提交生成的字体。
"""
import pathlib
from fontTools import subset
from fontTools.ttLib import TTFont

web = pathlib.Path(__file__).resolve().parent.parent
root = web.parent.parent
src = web / 'node_modules/@fontsource/fusion-pixel-12px-proportional-sc/files/fusion-pixel-12px-proportional-sc-latin-400-normal.woff2'
out = web / 'public/fonts/pixtides-pixel.woff2'

files = [*(web / 'src').rglob('*.astro'), *(web / 'src').rglob('*.ts'), *(root / 'packages/scenes/src').rglob('*.ts'),
         *(root / 'apps/minitool').glob('*.html'), *(root / 'apps/minitool').glob('*.ts')]  # 小红书小工具版也用这份字体
text = ''.join(p.read_text('utf-8') for p in files)
chars = {c for c in text if ord(c) > 0x7F} | {chr(c) for c in range(0x20, 0x7F)}

font = TTFont(src)
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.notdef_outline = True
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in chars])
sub.subset(font)

# 改名：family / full name / PostScript name 都换掉，其余（版权、许可证）保留
NAMES = {1: 'PixTides Pixel', 2: 'Regular', 3: 'PixTides Pixel Regular', 4: 'PixTides Pixel Regular', 6: 'PixTidesPixel-Regular', 16: 'PixTides Pixel', 17: 'Regular'}
for rec in font['name'].names:
    if rec.nameID in NAMES:
        rec.string = NAMES[rec.nameID]
font.save(out)
print(f'{len(chars)} chars -> {out.relative_to(root)} ({out.stat().st_size} bytes)')
