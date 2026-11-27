/**
 * 宿主侧像素任务实现：crop / ref / pick / palette / trace / copy / fill / compare。
 * 依赖 ./pixels.js（纯 JS 解码、光栅化、折线、聚类）；不依赖浏览器。
 */
import path from "node:path";
import {
  loadImage, inkMask, blurMask, marchingSquares, stitchSegments, rdp, traceInk,
  kmeansColors, polygonArea, pointInPolygon, pathWidths, rasterDoc, cropSurface, zoomSurface,
  encodePng, makeSurface, toHex, inkDistance, pathPointWidths, posterizeFills,
} from "./pixels.js";

const dataUrlOf = (surf) => `data:image/png;base64,${encodePng(surf.data, surf.w, surf.h).toString("base64")}`;

/** 某点的亮度（0~255），越界就夹回边缘。 */
function lumAt(data, w, h, x, y) {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
  const i = (yi * w + xi) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * 笔触复刻（style=paint）：把参考图按网格取样，每格出 1~2 笔
 * 「沿等色线方向」的短线，颜色取该格均色、笔宽取格宽、不透明度随局部对比度走。
 *
 * 跟 copy 的 edge/中心线不同，这不是"描轮廓"，而是像画师铺色：先大片铺，再靠笔触的边缘留给线稿层去压。
 * 好处是不依赖闭合区域（厚涂、渐变、火焰这类没有明确边界的也能出效果），缺点是笔数多、只近似。
 */
function paintStrokesFromBitmap(cut, rect, palette, opts = {}) {
  const w = cut.w;
  const h = cut.h;
  const d = cut.data;
  const maxStrokes = Math.max(100, Math.min(20000, Number(opts.maxStrokes) || 8000));
  // 网格边长跟笔数上限挂钩：粗铺吃掉约 45% 预算，剩的留给细节
  const coarseAuto = Math.sqrt((w * h) / Math.max(200, maxStrokes * 0.45));
  const step = Math.max(4, Math.min(48, Math.round(Number(opts.step) || coarseAuto / 2)));
  const minLum = opts.minLum === undefined ? 240 : Number(opts.minLum);
  const passes = Number(opts.passes) === 1 ? 1 : 2;
  const strokes = [];
  let cells = 0;
  let skippedBg = 0;
  let seed = 20261128;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  // 取样一格：均色 + 平均亮度 + 局部对比度（mag）
  const sample = (cx, cy, size) => {
    let r = 0, g = 0, b = 0, n = 0, lumSum = 0;
    const half = Math.max(1, Math.round(size / 2));
    const wob = Math.max(2, Math.round(size / 8));
    for (let y = Math.round(cy) - half; y < Math.round(cy) + half; y += wob) {
      for (let x = Math.round(cx) - half; x < Math.round(cx) + half; x += wob) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        if (d[i + 3] < 16) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        n += 1;
        lumSum += lumAt(d, w, h, x, y);
      }
    }
    if (n === 0) return null;
    const gx = lumAt(d, w, h, cx + size, cy) - lumAt(d, w, h, cx - size, cy);
    const gy = lumAt(d, w, h, cx, cy + size) - lumAt(d, w, h, cx, cy - size);
    return {
      color: `#${hex2(r / n)}${hex2(g / n)}${hex2(b / n)}`,
      lum: lumSum / n,
      mag: Math.min(1, Math.hypot(gx, gy) / 90),
      ang: Math.atan2(gy, gx) + Math.PI / 2,
    };
  };
  // 落一笔：长度/抖动跟格子走，宽高都盖住格子的对角线，否则会透白底、整片发灰
  const push = (cx, cy, size, s, wide, alpha) => {
    const len = size * (1.15 + 0.5 * rnd());
    const jx = (rnd() - 0.5) * size * 0.4;
    const jy = (rnd() - 0.5) * size * 0.4;
    const pts = [];
    for (let t = -1; t <= 1; t += 1) {
      pts.push([
        Math.round(rect.x + cx + jx + Math.cos(s.ang) * (len / 2) * t),
        Math.round(rect.y + cy + jy + Math.sin(s.ang) * (len / 2) * t),
      ]);
    }
    strokes.push({
      color: s.color,
      size: Number((size * (wide + 0.25 * s.mag)).toFixed(2)),
      opacity: Number((alpha + 0.1 * s.mag).toFixed(2)),
      points: pts,
    });
  };

  // 第一遍：粗铺。网格放大一倍，保证先整幅有颜色，不做成一半空白一半细节
  const coarse = Math.min(48, Math.max(6, Math.round(step * 2)));
  for (let cy = coarse / 2; cy < h; cy += coarse) {
    for (let cx = coarse / 2; cx < w; cx += coarse) {
      if (strokes.length >= maxStrokes) break;
      const s = sample(cx, cy, coarse);
      if (!s) continue;
      if (s.lum >= minLum) { skippedBg += 1; continue; }
      cells += 1;
      push(cx, cy, coarse, s, 1.05, 0.9);
    }
    if (strokes.length >= maxStrokes) break;
  }
  // 第二遍：细节。只补局部对比强的地方（脸、手、火焰边缘、褶皱），平涂区不再叠
  const wantDetail = Number(opts.passes) !== 1;
  if (wantDetail) {
    for (let cy = step / 2; cy < h; cy += step) {
      for (let cx = step / 2; cx < w; cx += step) {
        if (strokes.length >= maxStrokes) break;
        const s = sample(cx, cy, step);
        if (!s) continue;
        if (s.lum >= minLum) continue;
        if (s.mag < 0.16) continue;
        cells += 1;
        push(cx, cy, step, s, 1.15, 0.88);
      }
      if (strokes.length >= maxStrokes) break;
    }
  }
  return {
    strokes,
    stats: { step, passes: wantDetail ? 2 : 1, coarse, cells, skippedBg, strokes: strokes.length, capped: strokes.length >= maxStrokes },
  };
}

function refLayer(doc, wanted) {
  const layers = (doc.layers || []).filter((l) => l.image);
  if (wanted) return layers.find((l) => l.id === wanted || l.name === wanted) || null;
  return layers.find((l) => l.visible !== false) || layers[0] || null;
}

function clampRect(rect, w, h) {
  const r = rect || {};
  const x = Math.max(0, Math.min(w - 1, Math.round(Number(r.x) || 0)));
  const y = Math.max(0, Math.min(h - 1, Math.round(Number(r.y) || 0)));
  const cw = Math.max(1, Math.min(w - x, Math.round(Number(r.w) || w)));
  const ch = Math.max(1, Math.min(h - y, Math.round(Number(r.h) || h)));
  return { x, y, w: cw, h: ch };
}

/** 只画参考图那一层，得到整幅位图。 */
async function refSurface(doc, resolve, params) {
  const layer = refLayer(doc, params.layer);
  if (!layer) throw new Error("画布上没有可用的参考图：先 import 一张");
  const img = await loadImage(resolve(layer.image.file));
  const surf = makeSurface(doc.width || 1024, doc.height || 1024);
  const { blitImage } = await import("./pixels.js");
  blitImage(surf, img, layer.image.x || 0, layer.image.y || 0, layer.image.w || img.width, layer.image.h || img.height);
  return surf;
}

export async function runHeadless(kind, params, doc, resolve) {
  const W = doc.width || 1024;
  const H = doc.height || 1024;
  if (kind === "crop") {
    const rect = clampRect(params.rect, W, H);
    const zoom = Math.max(1, Math.min(8, Math.round(Number(params.zoom) || 1)));
    let surf;
    if (params.layer) {
      const one = { ...doc, layers: (doc.layers || []).filter((l) => l.id === params.layer || l.name === params.layer) };
      surf = await rasterDoc(one, { resolve });
    } else {
      surf = await rasterDoc(doc, { resolve });
    }
    const cut = cropSurface(surf, rect);
    const zoomed = zoomSurface(cut, zoom);
    return { ok: true, dataUrl: dataUrlOf(zoomed), rect, zoom, layer: params.layer || null, width: zoomed.w, height: zoomed.h, headless: true };
  }
  if (kind === "ref") {
    const layer = refLayer(doc, params.layer);
    if (!layer) throw new Error(params.layer ? `没有这个图片层：${params.layer}` : "画布上还没有图片层，先 action=import");
    const img = await loadImage(resolve(layer.image.file));
    const surf = makeSurface(img.width, img.height);
    const { blitImage } = await import("./pixels.js");
    blitImage(surf, img, 0, 0, img.width, img.height);
    const rect = clampRect(params.rect || { x: 0, y: 0, w: img.width, h: img.height }, img.width, img.height);
    const cut = cropSurface(surf, rect);
    const zoomed = zoomSurface(cut, Math.max(1, Math.min(8, Math.round(Number(params.zoom) || 1))));
    return { ok: true, dataUrl: dataUrlOf(zoomed), rect, zoom: Number(params.zoom) || 1, width: zoomed.w, height: zoomed.h, headless: true };
  }
  if (kind === "pick") {
    const x = Math.round(Number(params.x));
    const y = Math.round(Number(params.y));
    const surf = params.on === "canvas" ? await rasterDoc(doc, { resolve }) : await refSurface(doc, resolve, params);
    if (x < 0 || y < 0 || x >= surf.w || y >= surf.h) throw new Error("坐标超出画布");
    const i = (y * surf.w + x) * 4;
    const data = surf.data;
    return {
      ok: true,
      x, y,
      hex: toHex(data[i], data[i + 1], data[i + 2]),
      rgb: [data[i], data[i + 1], data[i + 2]],
      alpha: data[i + 3] / 255,
      ink: data[i + 3] > 12 && (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) < 128,
      headless: true,
    };
  }
  if (kind === "palette") {
    const surf = await refSurface(doc, resolve, params);
    const rect = clampRect(params.rect, surf.w, surf.h);
    const cut = cropSurface(surf, rect);
    const k = Math.max(2, Math.min(8, Math.round(Number(params.k) || 6)));
    const colors = kmeansColors(cut.data, k);
    return { ok: true, colors, sampled: Math.round((rect.w * rect.h) / 2), rect, method: "kmeans", headless: true };
  }
  if (kind === "trace") {
    const surf = await refSurface(doc, resolve, params);
    const rect = clampRect(params.rect, surf.w, surf.h);
    const cut = cropSurface(surf, rect);
    const t = traceInk(cut.data, cut.w, cut.h, {
      mode: params.mode === "center" ? "center" : "edge",
      smooth: params.smooth,
      fit: params.fit === true,
      fitStep: params.fitStep,
      threshold: params.threshold,
      tolerance: params.tolerance,
      minLength: params.minLength,
      maxLines: params.maxLines,
    });
    const paths = t.paths.map((line) => line.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]));
    // 调 THRESHOLD/TOLERANCE/STEP 时得有反馈：给线宽分布和墨迹占比，
    // 不然只能肉眼反复试（0.1.38 之前 trace 只回 lines/points/dropped）。
    const mask = inkMask(cut.data, cut.w, cut.h, params.threshold);
    let inkPx = 0;
    for (let i = 0; i < mask.length; i += 1) inkPx += mask[i];
    const widths = pathWidths(mask, cut.w, cut.h, t.paths);
    const widthAvg = widths.length ? Number((widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(2)) : null;
    const stats = {
      inkRatio: Number((inkPx / (cut.w * cut.h)).toFixed(4)),
      widthAvg,
      widthMin: widths.length ? Number(Math.min(...widths).toFixed(2)) : null,
      widthMax: widths.length ? Number(Math.max(...widths).toFixed(2)) : null,
      pointsPerLine: t.lines ? Number((t.points / t.lines).toFixed(1)) : null,
      droppedPct: t.lines + t.dropped > 0 ? Number((t.dropped / (t.lines + t.dropped) * 100).toFixed(1)) : null,
    };

    // widths=true：折线带上逐点压力（第 3 个数），让笔迹自己长成原图的粗细，
    // 而不是一条从头到尾同宽的「硬线」。pressure = 局部线宽 / p90 线宽，配合 size=sizeHint、minSize=0 用。
    let pathsWidth = null;
    let sizeHint = null;
    if (params.widths) {
      const dist = inkDistance(mask, cut.w, cut.h);
      const perPath = t.paths.map((line) => pathPointWidths(mask, cut.w, cut.h, line, dist));
      const all = perPath.reduce((acc, arr) => acc.concat(arr), []);
      all.sort((a, b) => a - b);
      const p90 = all.length ? all[Math.floor(all.length * 0.9)] : 1;
      sizeHint = Math.max(2, Math.round(p90));
      pathsWidth = t.paths.map((line, li) => line.map((p, k) => [
        Math.round(rect.x + p[0]),
        Math.round(rect.y + p[1]),
        Number(Math.min(1, Math.max(0.05, perPath[li][k] / sizeHint)).toFixed(3)),
      ]));
      stats.sizeHint = sizeHint;
      stats.widthP90 = Number(p90.toFixed(2));
    }

    return {
      ok: true, rect, paths, lines: t.lines, points: t.points, dropped: t.dropped,
      tolerance: t.tolerance, smooth: t.smooth, fit: t.fit, mode: t.mode, headless: true, stats,
      ...(pathsWidth ? { pathsWidth, sizeHint } : {}),
    };
  }
  if (kind === "copy") {
    const surf = await refSurface(doc, resolve, params);
    const rect = clampRect(params.rect, surf.w, surf.h);
    const cut = cropSurface(surf, rect);
    const mask = inkMask(cut.data, cut.w, cut.h, params.threshold);
    let inkPx = 0;
    for (let i = 0; i < mask.length; i += 1) inkPx += mask[i];
    const inkRatio = Number((inkPx / (cut.w * cut.h)).toFixed(3));
    const mode = params.mode === "center" || params.mode === "edge" ? params.mode : (inkRatio < 0.13 ? "center" : "edge");
    const t = traceInk(cut.data, cut.w, cut.h, {
      mode,
      smooth: params.smooth === undefined ? 2 : params.smooth,
      fit: params.fit === undefined ? true : params.fit,
      fitStep: params.fitStep || 3,
      threshold: params.threshold,
      tolerance: params.tolerance,
      minLength: params.minLength === undefined ? 16 : params.minLength,
      maxLines: params.maxLines || 160,
      maxPointsPerLine: params.maxPointsPerLine || 120,
    });
    const palette = kmeansColors(cut.data, Math.max(2, Math.min(8, Number(params.colors) || 6)));
    const paths = t.paths.map((line) => line.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]));
    const widths = pathWidths(inkMask(cut.data, cut.w, cut.h, params.threshold), cut.w, cut.h, t.paths);
    const lineWidth = widths.length ? Number((widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(2)) : null;
    const wantFill = params.style === "flat" || params.style === "anime";
    const wantPaint = params.style === "paint";
    // 色块必须靠闭合轮廓；中心线模式下的路径是骨架，不闭合，所以填色另跑一遍边界追踪
    let edgeTrace = t;
    if (wantFill && mode === "center") {
      edgeTrace = traceInk(cut.data, cut.w, cut.h, {
        mode: "edge",
        smooth: params.smooth === undefined ? 2 : params.smooth,
        fit: false,
        threshold: params.threshold,
        tolerance: params.tolerance,
        minLength: params.minLength === undefined ? 16 : params.minLength,
        maxLines: params.maxLines || 160,
        maxPointsPerLine: params.maxPointsPerLine || 120,
      });
    }
    const fills = wantFill
      ? regionFillsFromBitmap(cut, edgeTrace, palette, { minFill: params.minFill, maxFills: params.maxFills || 40, rect })
      : [];
    const paint = wantPaint
      ? paintStrokesFromBitmap(cut, rect, palette, {
        step: params.paintStep,
        maxStrokes: params.maxStrokes,
        minLum: params.paintMinLum,
        passes: params.paintPasses,
      })
      : null;
    return {
      ok: true, rect, paths, widths, lineWidth, closed: t.closed, fills, palette, mode,
      smooth: t.smooth, fit: t.fit, inkRatio, lines: t.lines, points: t.points, dropped: t.dropped, headless: true,
      ...(paint ? { paint: paint.strokes, paintStats: paint.stats } : {}),
    };
  }
  if (kind === "posterize") {
    const surf = await refSurface(doc, resolve, params);
    const rect = clampRect(params.rect, surf.w, surf.h);
    const cut = cropSurface(surf, rect);
    const res = posterizeFills(cut.data, cut.w, cut.h, {
      colors: params.colors,
      minArea: params.minArea,
      tolerance: params.tolerance,
      maxFills: params.maxFills,
      lines: params.lines === true,
      minLength: params.minLength,
      maxLines: params.maxLines,
    });
    const shift = (pts) => pts.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]);
    const fills = res.fills.map((f) => ({ color: f.color, points: shift(f.points), holes: (f.holes || []).map(shift), area: f.area }));
    const paths = res.paths.map(shift);
    return { ok: true, rect, fills, paths, stats: res.stats, headless: true };
  }
  if (kind === "fill") {
    const sx = Math.round(Number(params.x));
    const sy = Math.round(Number(params.y));
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sy < 0 || sx >= W || sy >= H) throw new Error("fill 的种子点超出画布");
    // 屏障只认笔迹（不含色块），否则第二次填会被自己的色块挡住
    const barrierDoc = { ...doc, layers: (doc.layers || []).map((l) => ({ ...l, image: null, strokes: (l.strokes || []).filter((s) => s.mode !== "fill") })) };
    const drawn = await rasterDoc(barrierDoc, { resolve, withImages: false });
    const barrier = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; p += 1, i += 4) barrier[p] = drawn.data[i + 3] > 24 ? 1 : 0;
    if (barrier[sy * W + sx]) throw new Error("这个点落在线上：换一个区域内部的点");
    const rect = clampRect(params.rect, W, H);
    const region = new Uint8Array(W * H);
    const stack = [sy * W + sx];
    let count = 0;
    while (stack.length) {
      const q = stack.pop();
      if (region[q] || barrier[q]) continue;
      const x = q % W;
      const y = (q - x) / W;
      if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) continue;
      region[q] = 1;
      count += 1;
      if (x > 0) stack.push(q - 1);
      if (x < W - 1) stack.push(q + 1);
      if (y > 0) stack.push(q - W);
      if (y < H - 1) stack.push(q + W);
    }
    if (count === 0) throw new Error("这个种子点没围出可填的区域");
    if (count > W * H * 0.62) throw new Error("这块区域连到了整片背景（超过画布 62%）：先有线稿，或者用 rect 缩小范围");
    const loops = stitchSegments(marchingSquares(region, W, H))
      .map((raw) => {
        const pts = raw.map((p) => [p[0] / 2, p[1] / 2]);
        // stitch 会把首点重复接在末尾；rdp 对首尾同点的折线会直接塌成两点
        if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1.5) pts.pop();
        return { pts: rdp(pts, 1.5) };
      })
      .map((v) => ({ ...v, area: polygonArea(v.pts) }))
      .filter((v) => v.area > 40)
      .sort((a, b) => b.area - a.area)
      .slice(0, 40);
    const parents = loops.map(() => -1);
    for (let i = 0; i < loops.length; i += 1) {
      const p0 = loops[i].pts[0];
      let best = -1;
      for (let j = 0; j < i; j += 1) {
        if (loops[j].area <= loops[i].area) continue;
        if (!pointInPolygon(p0[0], p0[1], loops[j].pts)) continue;
        if (best === -1 || loops[j].area < loops[best].area) best = j;
      }
      parents[i] = best;
    }
    const depths = loops.map((_, i) => {
      let d = 0;
      let p = parents[i];
      while (p !== -1 && d < 8) {
        d += 1;
        p = parents[p];
      }
      return d;
    });
    const polys = [];
    for (let i = 0; i < loops.length; i += 1) {
      if (depths[i] % 2 !== 0) continue;
      const holes = loops.filter((_, j) => parents[j] === i).slice(0, 10).map((hh) => hh.pts.map((p) => [Math.round(p[0]), Math.round(p[1])]));
      polys.push({ points: loops[i].pts.map((p) => [Math.round(p[0]), Math.round(p[1])]), holes, area: Math.round(loops[i].area) });
      if (polys.length >= 12) break;
    }
    let color = params.color || null;
    if (!color) {
      const ref = await refSurface(doc, resolve, params);
      const pal = kmeansColors(ref.data, 6, 4);
      const i = (sy * W + sx) * 4;
      const rgb = [ref.data[i], ref.data[i + 1], ref.data[i + 2]];
      let best = pal[0];
      let bestD = Infinity;
      for (const c of pal) {
        const d = (c.rgb[0] - rgb[0]) ** 2 + (c.rgb[1] - rgb[1]) ** 2 + (c.rgb[2] - rgb[2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      color = best ? best.hex : toHex(rgb[0], rgb[1], rgb[2]);
    }
    return { ok: true, seed: [sx, sy], area: count, color, polygons: polys, headless: true };
  }
  if (kind === "compare") {
    const rect = clampRect(params.rect, W, H);
    const ref = await refSurface(doc, resolve, params);
    const drawn = await rasterDoc({ ...doc, layers: (doc.layers || []).map((l) => ({ ...l, image: null })) }, { resolve, withImages: false });
    return compareSurfaces(ref, drawn, rect);
  }
  throw new Error(`无界面模式不支持这个像素任务：${kind}`);
}

/** 参考图 vs 当前画面：品红=漏画、青=多画，给出覆盖率与最漏的几块。 */
export function compareSurfaces(ref, drawn, rect) {
  const rd = ref.data;
  const dd = drawn.data;
  const diff = makeSurface(rect.w, rect.h);
  const out = diff.data;
  let refInk = 0;
  let drawInk = 0;
  let covered = 0;
  let extra = 0;
  let sumDiff = 0;
  const GRID = 32;
  const cells = new Map();
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const si = ((rect.y + y) * ref.w + (rect.x + x)) * 4;
      const di = (y * rect.w + x) * 4;
      const ra = rd[si + 3];
      const da = dd[si + 3];
      const isRef = ra > 12;
      const isDraw = da > 12;
      if (isRef) refInk += 1;
      if (isDraw) drawInk += 1;
      if (isRef && isDraw) {
        covered += 1;
        sumDiff += (Math.abs(rd[si] - dd[si]) + Math.abs(rd[si + 1] - dd[si + 1]) + Math.abs(rd[si + 2] - dd[si + 2])) / 3;
        out[di] = Math.round((rd[si] + dd[si]) / 2);
        out[di + 1] = Math.round((rd[si + 1] + dd[si + 1]) / 2);
        out[di + 2] = Math.round((rd[si + 2] + dd[si + 2]) / 2);
        out[di + 3] = 140;
      } else if (isRef) {
        out[di] = 255;
        out[di + 1] = 0;
        out[di + 2] = 255;
        out[di + 3] = 235;
        const key = `${Math.floor((x / rect.w) * GRID)},${Math.floor((y / rect.h) * GRID)}`;
        const cell = cells.get(key) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
        cell.n += 1;
        if (rect.x + x < cell.x0) cell.x0 = rect.x + x;
        if (rect.y + y < cell.y0) cell.y0 = rect.y + y;
        if (rect.x + x > cell.x1) cell.x1 = rect.x + x;
        if (rect.y + y > cell.y1) cell.y1 = rect.y + y;
        cells.set(key, cell);
      } else if (isDraw) {
        out[di] = 0;
        out[di + 1] = 210;
        out[di + 2] = 255;
        out[di + 3] = 200;
        extra += 1;
      }
    }
  }
  const gaps = [...cells.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((c) => ({
    x: Math.round(c.x0), y: Math.round(c.y0), w: Math.round(c.x1 - c.x0) + 1, h: Math.round(c.y1 - c.y0) + 1, missed: c.n,
  }));
  return {
    ok: true,
    dataUrl: dataUrlOf(diff),
    rect,
    metrics: {
      rect,
      refInkPixels: refInk,
      drawnInkPixels: drawInk,
      coveredPixels: covered,
      extraPixels: extra,
      coveragePct: refInk ? Number(((covered / refInk) * 100).toFixed(1)) : 100,
      extraPct: drawInk ? Number(((extra / drawInk) * 100).toFixed(1)) : 0,
      meanColorDiff: covered ? Number((sumDiff / covered).toFixed(1)) : null,
      topGaps: gaps,
    },
    headless: true,
  };
}

/** 闭合轮廓取内部主色（宿主版：按点在多边形内采样，不依赖 canvas 遮罩）。 */
function regionFillsFromBitmap(cut, traced, palette, opts = {}) {
  const minFill = Math.max(20, Number(opts.minFill) || 320);
  const maxFills = Math.max(1, Number(opts.maxFills) || 60);
  const cands = traced.paths
    .map((p, i) => ({ pts: p, closed: Boolean(traced.closed && traced.closed[i]), area: polygonArea(p) }))
    .filter((c) => c.closed && c.area >= minFill)
    .sort((a, b) => b.area - a.area);
  const parents = cands.map(() => -1);
  for (let i = 0; i < cands.length; i += 1) {
    const p0 = cands[i].pts[0];
    let best = -1;
    for (let j = 0; j < i; j += 1) {
      if (cands[j].area <= cands[i].area) continue;
      if (!pointInPolygon(p0[0], p0[1], cands[j].pts)) continue;
      if (best === -1 || cands[j].area < cands[best].area) best = j;
    }
    parents[i] = best;
  }
  const depths = cands.map((_, i) => {
    let d = 0;
    let p = parents[i];
    while (p !== -1 && d < 8) { d += 1; p = parents[p]; }
    return d;
  });
  const fills = [];
  for (const [ci, cand] of cands.entries()) {
    if (fills.length >= maxFills) break;
    if (depths[ci] % 2 !== 0) continue;
    const holes = cands.filter((_, j) => parents[j] === ci).slice(0, 10);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of cand.pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    if ((x1 - x0) * (y1 - y0) > cut.w * cut.h * 0.82) continue;
    const buckets = new Map();
    const step = 3;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(cut.h - 1, Math.ceil(y1)); y += step) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(cut.w - 1, Math.ceil(x1)); x += step) {
        if (!pointInPolygon(x, y, cand.pts)) continue;
        if (holes.some((hh) => pointInPolygon(x, y, hh.pts))) continue;
        const i = (y * cut.w + x) * 4;
        if (cut.data[i + 3] < 32) continue;
        const key = ((cut.data[i] >> 3) << 10) | ((cut.data[i + 1] >> 3) << 5) | (cut.data[i + 2] >> 3);
        const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
        cur.r += cut.data[i];
        cur.g += cut.data[i + 1];
        cur.b += cut.data[i + 2];
        cur.n += 1;
        buckets.set(key, cur);
      }
    }
    if (buckets.size === 0) continue;
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    const rgb = [top.r / top.n, top.g / top.n, top.b / top.n];
    let best = palette[0];
    let bestD = Infinity;
    for (const c of palette) {
      const d = (c.rgb[0] - rgb[0]) ** 2 + (c.rgb[1] - rgb[1]) ** 2 + (c.rgb[2] - rgb[2]) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    const rect = opts.rect || { x: 0, y: 0 };
    fills.push({
      points: cand.pts.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]),
      holes: holes.map((hh) => hh.pts.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])])),
      color: best ? best.hex : toHex(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])),
      area: Math.round(cand.area),
    });
  }
  return fills;
}

export { inkMask, blurMask, marchingSquares, stitchSegments, rdp };
