"""把 Fusion Pixel 12px 比例 zh_hans 子集化，只保留设计稿用到的字符，并内嵌进 proto-engine.js。

用法：python3 design/tools/subset-font.py <fusion-pixel-12px-proportional-zh_hans.woff2>
字体来源：npm 包 @fontsource/fusion-pixel-12px-proportional-sc（OFL-1.1）。
Fusion Pixel 声明了保留字体名（Reserved Font Name），子集属于修改版，
按 OFL 第 3 条不能再叫 "Fusion Pixel"，所以改名为 "PixTides Pixel"。
"""
import base64, io, pathlib, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont

here = pathlib.Path(__file__).resolve().parent.parent
sources = [here / 'home.html', here / 'editor.html', here / 'proto-engine.js']
engine = here / 'proto-engine.js'

text = ''.join(p.read_text('utf-8') for p in sources)
# 去掉已内嵌的 base64，避免把旧字体数据当作字符
text = re.sub(r"const FONT_B64 = '[^']*';", '', text)
chars = {c for c in text if ord(c) > 0x7F} | {chr(c) for c in range(0x20, 0x7F)}

font = TTFont(sys.argv[1])
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.notdef_outline = True
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in chars])
sub.subset(font)

FAMILY = 'PixTides Pixel'
names = font['name']
for rec in list(names.names):
    if rec.nameID in (1, 16):
        names.setName(FAMILY, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    elif rec.nameID in (2, 17):
        names.setName('Regular', rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    elif rec.nameID == 4:
        names.setName(FAMILY + ' Regular', 4, rec.platformID, rec.platEncID, rec.langID)
    elif rec.nameID == 6:
        names.setName('PixTidesPixel-Regular', 6, rec.platformID, rec.platEncID, rec.langID)
    elif rec.nameID == 3:
        names.setName('PixTides Pixel Regular (subset of Fusion Pixel 12px Proportional zh_hans)', 3, rec.platformID, rec.platEncID, rec.langID)

buf = io.BytesIO()
font.flavor = 'woff2'
font.save(buf)
b64 = base64.b64encode(buf.getvalue()).decode()

src = engine.read_text('utf-8')
src = re.sub(r"const FONT_B64 = '[^']*';", "const FONT_B64 = '" + b64 + "';", src)
engine.write_text(src, 'utf-8')
print(f'{len(chars)} chars, woff2 {len(buf.getvalue())} bytes, base64 {len(b64)} bytes')
