/**
 * 宿主侧像素引擎（无界面兜底）。
 *
 * 前端（浏览器 <canvas>）不在的时候，copy / trace / palette / pick / compare / fill / view 这些
 * 也要能算：这里用纯 JS 解码 PNG、编码 PNG，再把笔迹用简单胶囊笔触光栅化出来。
 * 第三方依赖为零，只用到 node 自带的 zlib 与 child_process（非 PNG 的输入靠系统转换一次）。
 *
 * 注意：光栅化是「圆头近似」，跟浏览器里 32 支笔刷的真实引擎有差别，
 * 所以 compare 的数字在无界面模式下是近似值；有面板时仍优先用面板算。
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

// ---------------------------------------------------------------- PNG 编解码

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 解一张 8bit PNG（灰度 / RGB / RGBA / 灰度+alpha），返回 { w, h, data(RGBA) }。 */
export function decodePng(buf) {
  if (!PNG_SIG.equals(buf.subarray(0, 8))) throw new Error("不是 PNG（签名不对）");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height) throw new Error("PNG 缺 IHDR");
  if (bitDepth !== 8) throw new Error(`PNG 位深 ${bitDepth} 暂不支持（只支持 8bit）`);
  if (interlace !== 0) throw new Error("PNG 是隔行扫描，暂不支持");
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error(`PNG 颜色类型 ${colorType} 暂不支持（调色板图请另存成真彩色）`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      row[i] = v & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (channels === 4) {
      data[i * 4] = pixels[i * 4];
      data[i * 4 + 1] = pixels[i * 4 + 1];
      data[i * 4 + 2] = pixels[i * 4 + 2];
      data[i * 4 + 3] = pixels[i * 4 + 3];
    } else if (channels === 3) {
      data[i * 4] = pixels[i * 3];
      data[i * 4 + 1] = pixels[i * 3 + 1];
      data[i * 4 + 2] = pixels[i * 3 + 2];
      data[i * 4 + 3] = 255;
    } else if (channels === 2) {
      const g = pixels[i * 2];
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = pixels[i * 2 + 1];
    } else {
      const g = pixels[i];
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

function crc32(buf) {
  if (!crc32.table) {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    crc32.table = t;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** RGBA → PNG（不压缩策略用固定 filter 0，速度快）。 */
export function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 读图（PNG 直接解，其它走系统转换）

const IMAGE_CACHE = new Map(); // path -> { mtime, width, height, data }

function convertToPng(src, dst) {
  const ps = [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile('${src.replace(/'/g, "''")}'); ` +
      `$bmp=New-Object System.Drawing.Bitmap($img.Width,$img.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); ` +
      `$g.DrawImage($img,0,0,$img.Width,$img.Height); $bmp.Save('${dst.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png); ` +
      `$g.Dispose(); $bmp.Dispose(); $img.Dispose()`,
  ];
  return new Promise((resolve, reject) => {
    const which = process.platform === "win32" ? "powershell" : null;
    if (!which) {
      reject(new Error("这台机器不是 Windows，非 PNG 的参考图请先转成 PNG"));
      return;
    }
    execFile(which, ps, { timeout: 30000, windowsHide: true }, (err) => {
      if (err) reject(new Error(`系统转换失败：${err.message}`));
      else resolve(dst);
    });
  });
}

/** 读一张图 → { width, height, data }；按路径+mtime 缓存。 */
export async function loadImage(filePath) {
  const abs = path.resolve(filePath);
  const st = fs.statSync(abs);
  const hit = IMAGE_CACHE.get(abs);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  let pngPath = abs;
  if (!/\.png$/i.test(abs)) {
    pngPath = path.join(os.tmpdir(), `draworld-${Buffer.from(abs).toString("hex").slice(-16)}.png`);
    await convertToPng(abs, pngPath);
  }
  const img = decodePng(fs.readFileSync(pngPath));
  const entry = { mtime: st.mtimeMs, ...img };
  IMAGE_CACHE.set(abs, entry);
  return entry;
}

// ---------------------------------------------------------------- 纯算法（和前端同一套思路）

export function inkMask(data, w, h, threshold) {
  const t = threshold === undefined ? 0.45 : Math.max(0, Math.min(1, Number(threshold)));
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; p += 1, i += 4) {
    const a = data[i + 3];
    if (a < 24) continue;
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    if (lum < t) mask[p] = 1;
  }
  return mask;
}

export function blurMask(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          n += mask[ny * w + nx];
        }
      }
      out[y * w + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

/** 掩码边界 → 线段（半像素坐标，尺寸 2 倍网格）。边中点用整数 key，拼接不会错位。 */
export function marchingSquares(mask, w, h) {
  const segs = [];
  const edgePoint = (key, x, y) => {
    if (key === "t") return [x * 2 + 1, y * 2];
    if (key === "r") return [x * 2 + 2, y * 2 + 1];
    if (key === "b") return [x * 2 + 1, y * 2 + 2];
    return [x * 2, y * 2 + 1];
  };
  const push = (a, b) => segs.push([a, b]);
  for (let y = 0; y < h - 1; y += 1) {
    for (let x = 0; x < w - 1; x += 1) {
      const v0 = mask[y * w + x];
      const v1 = mask[y * w + x + 1];
      const v2 = mask[(y + 1) * w + x + 1];
      const v3 = mask[(y + 1) * w + x];
      const code = (v0 << 3) | (v1 << 2) | (v2 << 1) | v3;
      if (code === 0 || code === 15) continue;
      const T = edgePoint("t", x, y);
      const R = edgePoint("r", x, y);
      const B = edgePoint("b", x, y);
      const L = edgePoint("l", x, y);
      switch (code) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(T, R); break;
        case 6: case 9: push(T, B); break;
        case 7: case 8: push(L, T); break;
        case 5: push(L, T); push(B, R); break;
        case 10: push(T, R); push(L, B); break;
        default: break;
      }
    }
  }
  return segs;
}

export function stitchSegments(segs) {
  const keyOf = (p) => `${p[0]},${p[1]}`;
  const byKey = new Map();
  segs.forEach((seg, i) => {
    for (const p of seg) {
      const k = keyOf(p);
      const list = byKey.get(k);
      if (list) list.push(i);
      else byKey.set(k, [i]);
    }
  });
  const used = new Set();
  const lines = [];
  for (let i = 0; i < segs.length; i += 1) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [segs[i][0], segs[i][1]];
    for (;;) {
      const tailKey = keyOf(line[line.length - 1]);
      const next = (byKey.get(tailKey) || []).find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      const seg = segs[next];
      const p = keyOf(seg[0]) === tailKey ? seg[1] : seg[0];
      line.push(p);
      if (keyOf(p) === keyOf(line[0])) break;
    }
    for (;;) {
      const headKey = keyOf(line[0]);
      const prev = (byKey.get(headKey) || []).find((j) => !used.has(j));
      if (prev === undefined) break;
      used.add(prev);
      const seg = segs[prev];
      const p = keyOf(seg[0]) === headKey ? seg[1] : seg[0];
      line.unshift(p);
      if (keyOf(p) === keyOf(line[line.length - 1])) break;
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

/** Zhang-Suen 细化：厚墨迹缩成 1px 骨架。 */
export function thinning(mask, w, h) {
  const img = Uint8Array.from(mask);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  let guard = 0;
  while (changed && guard < 40) {
    guard += 1;
    changed = false;
    for (let step = 0; step < 2; step += 1) {
      const del = [];
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          if (!img[y * w + x]) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let i = 0; i < 8; i += 1) if (seq[i] === 0 && seq[i + 1] === 1) a += 1;
          if (a !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          del.push(y * w + x);
        }
      }
      if (del.length > 0) {
        changed = true;
        for (const p of del) img[p] = 0;
      }
    }
  }
  return img;
}

/** 骨架 → 折线：先走端点，再走剩下的环。 */
export function skeletonPaths(skel, w, h) {
  const deg = new Uint8Array(w * h);
  const N8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!skel[y * w + x]) continue;
      let d = 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (skel[ny * w + nx]) d += 1;
      }
      deg[y * w + x] = d;
    }
  }
  const visited = new Uint8Array(w * h);
  const paths = [];
  const walk = (sx, sy) => {
    const path = [[sx, sy]];
    visited[sy * w + sx] = 1;
    let x = sx;
    let y = sy;
    for (;;) {
      let next = null;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (skel[q] && !visited[q]) {
          next = [nx, ny];
          break;
        }
      }
      if (!next) break;
      visited[next[1] * w + next[0]] = 1;
      path.push(next);
      x = next[0];
      y = next[1];
    }
    return path;
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (skel[p] && deg[p] === 1 && !visited[p]) paths.push(walk(x, y));
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (skel[p] && !visited[p]) paths.push(walk(x, y));
    }
  }
  return paths;
}

export function rdp(points, tolerance) {
  if (points.length <= 2 || !(tolerance > 0)) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const ax = points[first][0];
    const ay = points[first][1];
    const bx = points[last][0];
    const by = points[last][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-6;
    let index = -1;
    let best = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const px = points[i][0] - ax;
      const py = points[i][1] - ay;
      const dist = Math.abs(px * dy - py * dx) / len;
      if (dist > best) {
        best = dist;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function chaikin(pts, closed) {
  const n = pts.length;
  if (n < 3) return pts;
  const out = [];
  if (!closed) out.push(pts[0]);
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
    out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

export function smoothPath(pts, closed, iterations) {
  const iters = Math.max(0, Math.min(3, Number(iterations) || 0));
  if (iters === 0 || pts.length < 3) return pts;
  let s = pts;
  for (let k = 0; k < iters; k += 1) s = chaikin(s, closed);
  return rdp(s, 0.6);
}

export function bezierPoint(seg, t) {
  const mt = 1 - t;
  const b0 = mt * mt * mt;
  const b1 = 3 * t * mt * mt;
  const b2 = 3 * t * t * mt;
  const b3 = t * t * t;
  return [
    seg[0][0] * b0 + seg[1][0] * b1 + seg[2][0] * b2 + seg[3][0] * b3,
    seg[0][1] * b0 + seg[1][1] * b1 + seg[2][1] * b2 + seg[3][1] * b3,
  ];
}

export function fitBezier(points, tolerance) {
  const tol = Math.max(0.2, Number(tolerance) || 1);
  const pts = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
  const segs = [];
  if (pts.length < 2) return segs;
  const unit = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = Math.hypot(dx, dy) || 1;
    return [dx / n, dy / n];
  };
  const fitOne = (p, t1, t2) => {
    const last = p.length - 1;
    const u = [0];
    for (let i = 1; i <= last; i += 1) u.push(u[i - 1] + (Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1e-4));
    const total = u[last] || 1;
    for (let i = 0; i <= last; i += 1) u[i] /= total;
    const C = [[0, 0], [0, 0]];
    const X = [0, 0];
    for (let i = 0; i <= last; i += 1) {
      const t = u[i];
      const mt = 1 - t;
      const b0 = mt * mt * mt;
      const b1 = 3 * t * mt * mt;
      const b2 = 3 * t * t * mt;
      const b3 = t * t * t;
      const a1 = [t1[0] * b1, t1[1] * b1];
      const a2 = [t2[0] * b2, t2[1] * b2];
      C[0][0] += a1[0] * a1[0] + a1[1] * a1[1];
      C[0][1] += a1[0] * a2[0] + a1[1] * a2[1];
      C[1][0] = C[0][1];
      C[1][1] += a2[0] * a2[0] + a2[1] * a2[1];
      const px = p[i][0] - (p[0][0] * (b0 + b1) + p[last][0] * (b2 + b3));
      const py = p[i][1] - (p[0][1] * (b0 + b1) + p[last][1] * (b2 + b3));
      X[0] += a1[0] * px + a1[1] * py;
      X[1] += a2[0] * px + a2[1] * py;
    }
    const det = C[0][0] * C[1][1] - C[0][1] * C[1][0];
    let a1 = 0;
    let a2 = 0;
    if (Math.abs(det) > 1e-9) {
      a1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det;
      a2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det;
    }
    const chord = Math.hypot(p[last][0] - p[0][0], p[last][1] - p[0][1]) || 1;
    if (!(a1 > chord * 0.02)) a1 = chord / 3;
    if (!(a2 > chord * 0.02)) a2 = chord / 3;
    const seg = [
      p[0],
      [p[0][0] + t1[0] * a1, p[0][1] + t1[1] * a1],
      [p[last][0] + t2[0] * a2, p[last][1] + t2[1] * a2],
      p[last],
    ];
    let maxErr = 0;
    let maxIdx = Math.floor(last / 2);
    for (let i = 1; i < last; i += 1) {
      const q = bezierPoint(seg, u[i]);
      const d = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
      if (d > maxErr) {
        maxErr = d;
        maxIdx = i;
      }
    }
    return { seg, maxErr, maxIdx };
  };
  const fitRange = (s, e, t1, t2, depth) => {
    const p = pts.slice(s, e + 1);
    if (p.length === 2) {
      const c1 = [p[0][0] + (p[1][0] - p[0][0]) / 3, p[0][1] + (p[1][1] - p[0][1]) / 3];
      const c2 = [p[0][0] + (p[1][0] - p[0][0]) * 2 / 3, p[0][1] + (p[1][1] - p[0][1]) * 2 / 3];
      segs.push([p[0], c1, c2, p[1]]);
      return;
    }
    const r = fitOne(p, t1, t2);
    if (r.maxErr <= tol || p.length <= 3 || depth >= 12) {
      segs.push(r.seg);
      return;
    }
    const k = s + Math.max(1, Math.min(p.length - 2, r.maxIdx));
    const center = unit(pts[k - 1], pts[k + 1]);
    fitRange(s, k, t1, [-center[0], -center[1]], depth + 1);
    fitRange(k, e, [center[0], center[1]], t2, depth + 1);
  };
  fitRange(0, pts.length - 1, unit(pts[0], pts[1]), unit(pts[pts.length - 1], pts[pts.length - 2]), 0);
  return segs;
}

export function bezierSample(segs, step, cap) {
  const out = [];
  if (!Array.isArray(segs) || segs.length === 0) return out;
  const max = Math.max(8, Number(cap) || 400);
  for (const seg of segs) {
    const len = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1])
      + Math.hypot(seg[2][0] - seg[1][0], seg[2][1] - seg[1][1])
      + Math.hypot(seg[3][0] - seg[2][0], seg[3][1] - seg[2][1]);
    const n = Math.max(2, Math.min(64, Math.ceil(len / Math.max(1, Number(step) || 3))));
    for (let i = out.length ? 1 : 0; i <= n; i += 1) {
      const q = bezierPoint(seg, i / n);
      out.push([q[0], q[1]]);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

export function pathWidths(mask, w, h, paths) {
  return paths.map((path) => {
    if (!path || path.length < 2) return 0;
    const samples = Math.min(12, path.length);
    const values = [];
    for (let k = 0; k < samples; k += 1) {
      const idx = Math.floor((k * (path.length - 1)) / Math.max(1, samples - 1));
      const p = path[idx];
      const q = path[Math.min(path.length - 1, idx + 1)];
      const r = path[Math.max(0, idx - 1)];
      const dx = q[0] - r[0];
      const dy = q[1] - r[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      let n = 1;
      for (const sign of [1, -1]) {
        for (let step = 1; step <= 8; step += 1) {
          const px = Math.round(p[0] + nx * step * sign);
          const py = Math.round(p[1] + ny * step * sign);
          if (px < 0 || py < 0 || px >= w || py >= h) break;
          if (!mask[py * w + px]) break;
          n += 1;
        }
      }
      values.push(n);
    }
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
}

/** 墨迹到背景的 chamfer 距离（两遍扫描，8 邻域 1 / 1.414）。返回值 ×2 就是局部线宽。 */
export function inkDistance(mask, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        if (x > 0) v = Math.min(v, d[i - w - 1] + 1.414);
        v = Math.min(v, d[i - w] + 1);
        if (x + 1 < w) v = Math.min(v, d[i - w + 1] + 1.414);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x + 1 < w) v = Math.min(v, d[i + 1] + 1);
      if (y + 1 < h) {
        if (x + 1 < w) v = Math.min(v, d[i + w + 1] + 1.414);
        v = Math.min(v, d[i + w] + 1);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 1.414);
      }
      d[i] = v;
    }
  }
  return d;
}

/** 折线上每个点的局部线宽（像素）；没给距离图就现算一张。 */
export function pathPointWidths(mask, w, h, path, dist, cap = 0) {
  const d = dist || inkDistance(mask, w, h);
  const out = new Array(path.length);
  for (let k = 0; k < path.length; k += 1) {
    const p = path[k];
    const x = Math.max(0, Math.min(w - 1, Math.round(p[0])));
    const y = Math.max(0, Math.min(h - 1, Math.round(p[1])));
    let v = 2 * d[y * w + x];
    if (cap > 0) v = Math.min(v, cap);
    out[k] = Number(Math.max(1, v).toFixed(2));
  }
  return out;
}

export function kmeansColors(data, k, stepPx = 2) {
  const samples = [];
  for (let i = 0; i < data.length; i += 4 * stepPx) {
    if (data[i + 3] < 16) continue;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (samples.length === 0) throw new Error("这块区域里没有不透明的像素");
  const kk = Math.max(2, Math.min(12, Math.round(k)));
  const buckets = new Map();
  for (const s of samples) {
    const key = ((s[0] >> 3) << 10) | ((s[1] >> 3) << 5) | (s[2] >> 3);
    const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    cur.r += s[0];
    cur.g += s[1];
    cur.b += s[2];
    cur.n += 1;
    buckets.set(key, cur);
  }
  const init = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, kk).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
  while (init.length < kk && samples.length > init.length) init.push(samples[init.length * 7 % samples.length].slice());
  let centers = init;
  for (let iter = 0; iter < 10; iter += 1) {
    const acc = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const s of samples) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const d = (s[0] - centers[c][0]) ** 2 + (s[1] - centers[c][1]) ** 2 + (s[2] - centers[c][2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const a = acc[best];
      a.r += s[0];
      a.g += s[1];
      a.b += s[2];
      a.n += 1;
    }
    centers = acc.map((a, i) => (a.n ? [a.r / a.n, a.g / a.n, a.b / a.n] : centers[i]));
  }
  return centers.map((c) => ({
    hex: toHex(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])),
    rgb: c.map((v) => Math.round(v)),
    ratio: samples.length ? 100 : 0,
  }));
}

export function toHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

function bboxOf(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

/**
 * 彩图 → 按色阶分区填色（posterize）。比阈值描线适合彩稿：
 * 先把整幅图量化成 k 色，每一色的连通区按轮廓各自成一块可编辑填色，
 * 大块先铺、小块压在上面，孔洞挂到外层多边形上当 holes。
 * opts.lines=true 时再把色块之间的边界trace成线稿。
 */
export function posterizeFills(imageData, w, h, opts = {}) {
  const k = Math.max(2, Math.min(12, Math.round(Number(opts.colors) || 8)));
  const minArea = Math.max(4, Number(opts.minArea) || Math.round((w * h) / 4000));
  const tolerance = Math.max(0.5, Number(opts.tolerance) || 1.2);
  const maxFills = Math.max(1, Number(opts.maxFills) || 1600);
  const thinKeep = Math.max(0, Number(opts.thinKeep) || 30);
  const palette = kmeansColors(imageData, k, Math.max(1, Math.round(Number(opts.sampleStep) || 3)));
  const pal = palette.map((p) => p.rgb);
  const idx = new Uint8Array(w * h).fill(255);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (imageData[i + 3] < 16) continue;
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < pal.length; c += 1) {
      const d = (imageData[i] - pal[c][0]) ** 2 + (imageData[i + 1] - pal[c][1]) ** 2 + (imageData[i + 2] - pal[c][2]) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    idx[p] = best;
  }
  // 色阶图先做一遍众数滤波：把彩稿里的渐变噪点和零星小岛抹掉，
  // 不然轮廓会碎成一地碎屑，线稿层也跟着炸。
  const passes = Math.max(0, Math.min(3, opts.denoise === undefined ? 1 : Number(opts.denoise) || 0));
  for (let pass = 0; pass < passes; pass += 1) {
    const out = Uint8Array.from(idx);
    const counts = new Uint16Array(pal.length + 1);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const p = y * w + x;
        if (idx[p] === 255) continue;
        counts.fill(0);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const q = idx[p + dy * w + dx];
            if (q !== 255) counts[q] += 1;
          }
        }
        let best = idx[p];
        let bc = counts[best];
        for (let c = 0; c < pal.length; c += 1) {
          if (counts[c] > bc) {
            bc = counts[c];
            best = c;
          }
        }
        out[p] = best;
      }
    }
    idx.set(out);
  }
  // 相邻像素属于不同色阶的地方，就是色块边界（后面可选地描成线稿）
  const edge = new Uint8Array(w * h);
  let edgePixels = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const v = idx[p];
      if (v === 255) continue;
      if ((x + 1 < w && idx[p + 1] !== 255 && idx[p + 1] !== v) || (y + 1 < h && idx[p + w] !== 255 && idx[p + w] !== v)) {
        edge[p] = 1;
        edgePixels += 1;
      }
    }
  }
  const rings = [];
  for (let c = 0; c < pal.length; c += 1) {
    const mask = new Uint8Array(w * h);
    let area = 0;
    for (let p = 0; p < w * h; p += 1) {
      if (idx[p] === c) {
        mask[p] = 1;
        area += 1;
      }
    }
    if (area < minArea) continue;
    for (const raw of stitchSegments(marchingSquares(mask, w, h))) {
      const pts = raw.map((p) => [p[0] / 2, p[1] / 2]);
      if (pts.length < 4) continue;
      if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) > 2) continue;
      pts.pop();
      const sa = signedArea(pts);
      const bb = bboxOf(pts);
      const span = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0);
      // 细长条（衣褶高光、发丝边）面积小但很长，一律扔掉会在交界处留白缝，
      // 所以面积不够但跨度够的也留着。
      if (Math.abs(sa) < minArea && span < thinKeep) continue;
      const simplified = rdp(pts, tolerance).map((p) => [
        Number(Math.max(0, Math.min(w - 1, p[0])).toFixed(1)),
        Number(Math.max(0, Math.min(h - 1, p[1])).toFixed(1)),
      ]);
      if (simplified.length < 3) continue;
      rings.push({ color: palette[c].hex, c, pts: simplified, area: Math.abs(sa), sign: Math.sign(sa), bbox: bboxOf(simplified), holes: [] });
    }
  }
  // 正反两种环都当成独立色块，按面积从大到小铺：大块先垫底，小块压上去。
  // 不把反向环当 holes 扣掉——扣掉会在彩色交界处留出一圈白缝，肉眼就是「没画满」。
  const fills = rings
    .sort((a, b) => b.area - a.area)
    .slice(0, maxFills)
    .map((r) => ({ color: r.color, points: r.pts, holes: [], area: Math.round(r.area) }));
  const stats = {
    colorCount: pal.length,
    palette: palette.map((p) => p.hex),
    fills: fills.length,
    fillPixels: fills.reduce((n, f) => n + f.area, 0),
    coveragePct: Number(((fills.reduce((n, f) => n + f.area, 0) / (w * h)) * 100).toFixed(1)),
    edgePixels,
  };
  let lines = { paths: [], widths: [] };
  if (opts.lines === true) {
    const ink = new Uint8Array(w * h * 4);
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      const on = edge[p] === 1;
      ink[i] = on ? 0 : 255;
      ink[i + 1] = on ? 0 : 255;
      ink[i + 2] = on ? 0 : 255;
      ink[i + 3] = 255;
    }
    lines = traceInk(ink, w, h, {
      threshold: 0.4,
      minLength: Number(opts.minLength) || 24,
      maxLines: Math.max(1, Number(opts.maxLines) || 900),
      tolerance: Number(opts.lineTolerance) || 1.4,
      smooth: 1,
      fit: false,
    });
    stats.lineCount = lines.lines;
    stats.linePoints = lines.points;
    stats.lineColors = pal.length;
  }
  return { fills, stats, paths: lines.paths || [], widths: lines.widths || [] };
}

/** 参考图 → 折线（和前端 traceInk 同一套参数）。 */
export function traceInk(imageData, w, h, opts = {}) {
  const center = opts.mode === "center";
  const tolerance = Math.max(0.5, Number(opts.tolerance) || (center ? 1.2 : 2.5));
  const minLength = Math.max(2, Number(opts.minLength) || 12);
  const maxLines = Math.max(1, Number(opts.maxLines) || 80);
  const maxPointsPerLine = Math.max(6, Number(opts.maxPointsPerLine) || 160);
  const smoothIters = Math.max(0, Math.min(3, opts.smooth === undefined ? 1 : Number(opts.smooth) || 0));
  const wantFit = opts.fit === true;
  const fitStep = Math.max(1.5, Number(opts.fitStep) || 3);
  const mask = inkMask(imageData, w, h, opts.threshold);
  let lines;
  if (center) {
    const skel = thinning(mask, w, h);
    lines = skeletonPaths(skel, w, h).map((pts) => pts.map((p) => [p[0] * 2, p[1] * 2]));
  } else {
    lines = stitchSegments(marchingSquares(blurMask(mask, w, h), w, h));
  }
  const out = [];
  const closedFlags = [];
  let dropped = 0;
  for (const raw of lines) {
    const pts = raw.map((p) => [p[0] / 2, p[1] / 2]);
    const a = pts[0];
    const b = pts[pts.length - 1];
    const closed = pts.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
    if (closed) pts.pop();
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < minLength) {
      dropped += 1;
      continue;
    }
    let simplified = rdp(pts, tolerance);
    if (wantFit && simplified.length >= 3) {
      const sampled = bezierSample(fitBezier(simplified, Math.max(0.3, tolerance * 0.9)), fitStep, maxPointsPerLine * 2);
      if (sampled.length >= 2) {
        // 闭合环拟合容易外冲，夹回画布内，否则色块 bbox 会虚大
        simplified = sampled.map((p) => [
          Math.max(0, Math.min(w - 1, p[0])),
          Math.max(0, Math.min(h - 1, p[1])),
        ]);
      }
    } else if (smoothIters > 0) {
      simplified = smoothPath(simplified, closed, smoothIters);
    }
    if (simplified.length > maxPointsPerLine) {
      const stepN = Math.ceil(simplified.length / maxPointsPerLine);
      simplified = simplified.filter((_, i) => i % stepN === 0 || i === simplified.length - 1);
    }
    out.push(simplified.map((p) => [Number(p[0].toFixed(1)), Number(p[1].toFixed(1))]));
    closedFlags.push(closed);
    if (out.length >= maxLines) break;
  }
  const points = out.reduce((n, l) => n + l.length, 0);
  return { paths: out, closed: closedFlags, mode: center ? "center" : "edge", mask, lines: out.length, points, dropped, tolerance, smooth: smoothIters, fit: wantFit };
}

// ---------------------------------------------------------------- 光栅化

function parseColor(hex) {
  const s = String(hex || "#111111").replace("#", "");
  const n = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
}

function makeSurface(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

function blendPixel(surf, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= surf.w || y >= surf.h) return;
  const i = (y * surf.w + x) * 4;
  const d = surf.data;
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  d[i] = d[i] * (1 - a) + rgb[0] * a;
  d[i + 1] = d[i + 1] * (1 - a) + rgb[1] * a;
  d[i + 2] = d[i + 2] * (1 - a) + rgb[2] * a;
  d[i + 3] = Math.max(d[i + 3], Math.round(255 * a));
}

/** 圆头胶囊笔触（近似浏览器里的实心笔刷）。 */
function strokeCapsule(surf, pts, radius, rgb, alpha) {
  const r = Math.max(0.6, radius);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(d / Math.max(0.8, r * 0.6)));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const cx = a[0] + (b[0] - a[0]) * t;
      const cy = a[1] + (b[1] - a[1]) * t;
      const x0 = Math.floor(cx - r);
      const x1 = Math.ceil(cx + r);
      const y0 = Math.floor(cy - r);
      const y1 = Math.ceil(cy + r);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (Math.hypot(x - cx, y - cy) <= r) blendPixel(surf, x, y, rgb, alpha);
        }
      }
    }
  }
}

/** 多边形填充（even-odd，支持洞）。 */
function fillPolygon(surf, outer, holes, rgb, alpha) {
  const rings = [outer, ...(Array.isArray(holes) ? holes.filter((h) => h && h.length >= 3) : [])];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(surf.h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y += 1) {
    const cy = y + 0.5;
    const xs = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
        const a = r[j];
        const b = r[i];
        if ((a[1] > cy) === (b[1] > cy)) continue;
        xs.push(a[0] + ((cy - a[1]) * (b[0] - a[0])) / ((b[1] - a[1]) || 1e-9));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx = Math.max(0, Math.round(xs[k]));
      const ex = Math.min(surf.w - 1, Math.round(xs[k + 1]));
      for (let x = sx; x <= ex; x += 1) blendPixel(surf, x, y, rgb, alpha);
    }
  }
}

/** 把一张图按 x,y,w,h 画进 surface（最近邻缩放）。 */
export function blitImage(surf, img, x, y, w, h) {
  const dw = Math.max(1, Math.round(w));
  const dh = Math.max(1, Math.round(h));
  for (let j = 0; j < dh; j += 1) {
    for (let i = 0; i < dw; i += 1) {
      const sx = Math.min(img.width - 1, Math.floor((i * img.width) / dw));
      const sy = Math.min(img.height - 1, Math.floor((j * img.height) / dh));
      const si = (sy * img.width + sx) * 4;
      const a = img.data[si + 3] / 255;
      blendPixel(surf, Math.round(x) + i, Math.round(y) + j, [img.data[si], img.data[si + 1], img.data[si + 2]], a);
    }
  }
}

/**
 * 文档 → 位图。opts.withImages=false 时不画图片层，opts.onlyImage 只画某张图片层。
 */
export async function rasterDoc(doc, opts = {}) {
  const w = doc.width || 1024;
  const h = doc.height || 1024;
  const surf = makeSurface(w, h);
  const withImages = opts.withImages !== false;
  for (const layer of doc.layers || []) {
    if (layer.visible === false) continue;
    const lo = layer.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(layer.opacity)));
    if (layer.image) {
      if (!withImages) continue;
      const img = await loadImage(opts.resolve(layer.image.file));
      blitImage(surf, img, layer.image.x || 0, layer.image.y || 0, layer.image.w || img.width, layer.image.h || img.height);
      continue;
    }
    for (const s of layer.strokes || []) {
      const rgb = parseColor(s.color);
      const so = s.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(s.opacity)));
      const alpha = lo * so;
      if (s.mode === "fill") {
        fillPolygon(surf, s.points || [], s.holes || [], rgb, alpha);
      } else {
        const size = Number(s.size) || 8;
        strokeCapsule(surf, s.points || [], size / 2, rgb, alpha);
      }
    }
  }
  return surf;
}

export function cropSurface(surf, rect) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.min(surf.w - x, Math.round(rect.w));
  const h = Math.min(surf.h - y, Math.round(rect.h));
  const out = makeSurface(w, h);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const si = ((y + j) * surf.w + (x + i)) * 4;
      const di = (j * w + i) * 4;
      out.data[di] = surf.data[si];
      out.data[di + 1] = surf.data[si + 1];
      out.data[di + 2] = surf.data[si + 2];
      out.data[di + 3] = surf.data[si + 3];
    }
  }
  return out;
}

/** 最近邻放大。 */
export function zoomSurface(surf, zoom) {
  const z = Math.max(1, Math.round(zoom));
  if (z === 1) return surf;
  const out = makeSurface(surf.w * z, surf.h * z);
  for (let y = 0; y < out.h; y += 1) {
    for (let x = 0; x < out.w; x += 1) {
      const si = ((y / z | 0) * surf.w + (x / z | 0)) * 4;
      const di = (y * out.w + x) * 4;
      out.data[di] = surf.data[si];
      out.data[di + 1] = surf.data[si + 1];
      out.data[di + 2] = surf.data[si + 2];
      out.data[di + 3] = surf.data[si + 3];
    }
  }
  return out;
}

export { makeSurface };
