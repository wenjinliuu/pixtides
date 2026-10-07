// 索引色（调色板）PNG 编码器：不经过 canvas，绕过手机浏览器的画布上限（iOS 约 4096²），8K 也能导出。
// 逐行生成调色板下标，流式送进 deflate（CompressionStream），内存只占几行。
// 每格对齐整数像素（与 Canvas 预览同一套 edges）；圆形 / 圆角外用透明色（tRNS）。

import { edges } from './render';
import { rowSpan } from './export';
import type { Sim } from './sim';
import type { Shape } from './types';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

export interface PngProgress { (done: number, total: number): void }

/**
 * 把 sim 编码成 w × h 的索引色 PNG。
 * 返回 PNG 文件的字节；在浏览器里可直接 new Blob([bytes], { type: 'image/png' })。
 */
export async function encodePNG(sim: Sim, w: number, h: number, shape: Shape = 'square', onProgress?: PngProgress): Promise<Uint8Array> {
  const { W, H, cells, pal } = sim;
  const transparent = shape !== 'square';
  const nColors = pal.length + (transparent ? 1 : 0);
  if (nColors > 256) throw new Error('调色板超过 256 色');
  const clear = pal.length; // 透明色的下标

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // 位深
  ihdr[9] = 3; // 颜色类型：索引色
  const plte = new Uint8Array(nColors * 3);
  pal.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    plte[i * 3] = (n >> 16) & 255; plte[i * 3 + 1] = (n >> 8) & 255; plte[i * 3 + 2] = n & 255;
  });
  const trns = transparent ? new Uint8Array(nColors).fill(255) : null;
  if (trns) trns[clear] = 0;

  // 扫描线：每行 = 过滤类型 0 + w 个下标。同一格行的像素行只在形状遮罩不同时才需重算
  const xe = edges(W, w), ye = edges(H, h);
  const stride = w + 1;
  const base = new Uint8Array(stride);
  const cs = new CompressionStream('deflate'); // zlib 格式，正是 PNG 的 IDAT 需要的
  const writer = cs.writable.getWriter();
  const collected: Uint8Array[] = [];
  const reading = (async () => {
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collected.push(value);
    }
  })();

  const BATCH = 64; // 每次送 64 行，兼顾速度和内存
  let buf = new Uint8Array(stride * BATCH), filled = 0;
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) base.fill(cells[cy * W + cx], 1 + xe[cx], 1 + xe[cx + 1]);
    for (let y = ye[cy]; y < ye[cy + 1]; y++) {
      const row = buf.subarray(filled * stride, (filled + 1) * stride);
      row.set(base);
      row[0] = 0;
      if (transparent) {
        const sp = rowSpan(shape, y, w, h);
        if (!sp) row.fill(clear, 1);
        else {
          if (sp[0] > 0) row.fill(clear, 1, 1 + sp[0]);
          if (sp[1] < w) row.fill(clear, 1 + sp[1]);
        }
      }
      if (++filled === BATCH) {
        await writer.write(buf);
        buf = new Uint8Array(stride * BATCH);
        filled = 0;
        onProgress?.(y + 1, h);
      }
    }
  }
  if (filled) await writer.write(buf.subarray(0, filled * stride));
  await writer.close();
  await reading;
  onProgress?.(h, h);

  // 压缩数据按 1 MB 切成多个 IDAT
  let total = 0;
  for (const c of collected) total += c.length;
  const z = new Uint8Array(total);
  let off = 0;
  for (const c of collected) { z.set(c, off); off += c.length; }
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (trns) parts.push(chunk('tRNS', trns));
  const MB = 1 << 20;
  for (let i = 0; i < z.length; i += MB) parts.push(chunk('IDAT', z.subarray(i, Math.min(z.length, i + MB))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  let size = 0;
  for (const p of parts) size += p.length;
  const png = new Uint8Array(size);
  off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}
