#!/usr/bin/env python3
"""
Trace the reference line art into draworld stroke data (points + per-line widths).
Pure Pillow + numpy. Outputs JSON: {"strokes":[{points:[[x,y,p],...], size:...}, ...]}
Coordinates are in canvas pixels (1080x1440), matching the imported reference layer.
"""
import json, sys, time
import numpy as np
from PIL import Image, ImageFilter

SRC = r"D:\DSH\DSHdata\.dsh\profiles\desktop\.dsh-draworld\images\img-mwy91t98-hrn9.png"
OUT = r"D:\dsh-plugins\dsh-draworld\tools\ref_strokes.json"

THRESHOLD = 175          # grayscale below this = ink
MIN_PATH_LEN = 5
TOLERANCE = 1.3          # RDP simplification in px
MAX_STEP = 5             # max spacing between sampled points along a curve
DOWNSAMPLE = 1           # full resolution for fidelity


def load_ink():
    im = Image.open(SRC).convert('L')
    w0, h0 = im.size
    if DOWNSAMPLE > 1:
        im = im.resize((w0 // DOWNSAMPLE, h0 // DOWNSAMPLE), Image.LANCZOS)
    a = np.asarray(im, dtype=np.uint8)
    ink = a < THRESHOLD
    return ink, w0, h0


def zhang_suen_skeleton(binary):
    """Zhang-Suen thinning. Returns boolean skeleton array."""
    img = binary.copy().astype(np.uint8)
    h, w = img.shape
    changed = True
    it = 0
    while changed and it < 100:
        it += 1
        changed = False
        for step in (0, 1):
            padded = np.pad(img, 1, mode='constant')
            P2 = padded[0:h,     1:w+1]
            P3 = padded[0:h,     2:w+2]
            P4 = padded[1:h+1,   2:w+2]
            P5 = padded[2:h+2,   2:w+2]
            P6 = padded[2:h+2,   1:w+1]
            P7 = padded[2:h+2,   0:w]
            P8 = padded[1:h+1,   0:w]
            P9 = padded[0:h,     0:w]
            P1 = img
            neigh = P2+P3+P4+P5+P6+P7+P8+P9
            seq = [P2, P3, P4, P5, P6, P7, P8, P9]
            trans = np.zeros_like(img)
            for i in range(8):
                trans += ((seq[i] == 0) & (seq[(i+1) % 8] == 1))
            cond2 = (P1 == 1) & (neigh >= 2) & (neigh <= 6) & (trans == 1)
            if step == 0:
                cond3 = (P2 * P4 * P6 == 0)
                cond4 = (P4 * P6 * P8 == 0)
            else:
                cond3 = (P2 * P4 * P8 == 0)
                cond4 = (P2 * P6 * P8 == 0)
            rm = cond2 & cond3 & cond4
            ys, xs = np.nonzero(rm)
            if len(xs):
                changed = True
                img[ys, xs] = 0
    return img.astype(bool)


def chamfer_distance(binary, cap=12):
    """Approx distance (px) from each ink pixel to nearest background pixel."""
    h, w = binary.shape
    dist = np.where(binary, cap, 0).astype(np.float32)
    # 2-pass chamfer with 3x4 / 4x3 masks, a few sweeps for convergence
    for _ in range(2):
        for y in range(h):
            row = dist[y]
            left = cap
            for x in range(w):
                if binary[y, x]:
                    v = min(dist[y, x], left + 1)
                    if y > 0:
                        v = min(v, dist[y-1, x] + 1, dist[y-1, x-1] + 1.414 if x > 0 else cap,
                                dist[y-1, x+1] + 1.414 if x < w-1 else cap)
                    row[x] = v
                    left = v
                else:
                    left = cap
        for y in range(h-1, -1, -1):
            row = dist[y]
            right = cap
            for x in range(w-1, -1, -1):
                if binary[y, x]:
                    v = min(dist[y, x], right + 1)
                    if y < h-1:
                        v = min(v, dist[y+1, x] + 1, dist[y+1, x+1] + 1.414 if x < w-1 else cap,
                                dist[y+1, x-1] + 1.414 if x > 0 else cap)
                    row[x] = v
                    right = v
                else:
                    right = cap
    return dist


def trace_skeleton(skel, widthmap):
    """Walk skeleton pixels into polylines by 8-neighbour connectivity."""
    h, w = skel.shape
    remaining = skel.copy()
    paths = []
    padded = np.pad(remaining.astype(np.uint8), 1)
    deg = np.zeros((h, w), dtype=np.int8)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            deg += padded[1+dy:1+dy+h, 1+dx:1+dx+w]

    def nbrs(y, x):
        out = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                ny, nx = y+dy, x+dx
                if 0 <= ny < h and 0 <= nx < w and remaining[ny, nx]:
                    out.append((ny, nx))
        return out

    starts = []
    ys, xs = np.nonzero(remaining & (deg == 1))
    starts += list(zip(ys.tolist(), xs.tolist()))
    ys, xs = np.nonzero(remaining & (deg > 2))
    starts += list(zip(ys.tolist(), xs.tolist()))

    for sy, sx in starts:
        if not remaining[sy, sx]:
            continue
        path = [(sy, sx)]
        remaining[sy, sx] = False
        cur = (sy, sx)
        steps = 0
        while steps < 20000:
            steps += 1
            ns = nbrs(*cur)
            if not ns:
                break
            ns.sort(key=lambda p: deg[p[0], p[1]])
            nxt = ns[0]
            path.append(nxt)
            remaining[nxt] = False
            cur = nxt
            if deg[cur[0], cur[1]] == 1:
                break
        if len(path) > 3:
            a, b = path[0], path[-1]
            if max(abs(a[0]-b[0]), abs(a[1]-b[1])) <= 1:
                path.append(a)
        if len(path) >= MIN_PATH_LEN:
            widths = [widthmap[y, x] for (y, x) in path]
            paths.append((path, widths))

    ys, xs = np.nonzero(remaining)
    while len(ys):
        sy, sx = int(ys[0]), int(xs[0])
        path = [(sy, sx)]
        remaining[sy, sx] = False
        cur = (sy, sx)
        steps = 0
        while steps < 20000:
            steps += 1
            ns = nbrs(*cur)
            if not ns:
                break
            nxt = ns[0]
            path.append(nxt)
            remaining[nxt] = False
            cur = nxt
        if len(path) >= MIN_PATH_LEN:
            widths = [widthmap[y, x] for (y, x) in path]
            paths.append((path, widths))
        ys, xs = np.nonzero(remaining)
    return paths


def rdp(points, eps):
    if len(points) <= 2 or eps <= 0:
        return points
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points)-1)]
    while stack:
        a, b = stack.pop()
        p1, p2 = np.array(points[a], float), np.array(points[b], float)
        d = p2 - p1
        dn = np.hypot(d[0], d[1])
        if dn < 1e-9:
            continue
        idx, best = -1, eps
        for i in range(a+1, b):
            p0 = np.array(points[i], float)
            dist = abs((p0[0]-p1[0])*d[1] - (p0[1]-p1[1])*d[0]) / dn
            if dist > best:
                best, idx = dist, i
        if idx >= 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def resample(points, step):
    if len(points) < 2:
        return points
    out = [points[0]]
    acc = 0.0
    ax, ay = points[0]
    for i in range(1, len(points)):
        bx, by = points[i]
        seg = np.hypot(bx-ax, by-ay)
        if seg < 1e-9:
            continue
        while acc + seg >= step:
            t = (step - acc) / seg
            ix = ax + (bx-ax)*t
            iy = ay + (by-ay)*t
            out.append((ix, iy))
            ax, ay = ix, iy
            seg = np.hypot(bx-ax, by-ay)
            acc = 0.0
        acc += seg
    if np.hypot(points[-1][0]-out[-1][0], points[-1][1]-out[-1][1]) > 0.5:
        out.append(points[-1])
    return out


def main():
    t0 = time.time()
    ink, w0, h0 = load_ink()
    print(f"ink pixels: {int(ink.sum())} of {ink.size}", flush=True)
    skel = zhang_suen_skeleton(ink)
    print(f"skeleton pixels: {int(skel.sum())} ({time.time()-t0:.1f}s)", flush=True)
    widthmap = chamfer_distance(ink)
    paths = trace_skeleton(skel, widthmap)
    print(f"raw paths: {len(paths)} ({time.time()-t0:.1f}s)", flush=True)

    strokes = []
    for path, widths in paths:
        simp = rdp(path, TOLERANCE)
        simp = resample(simp, MAX_STEP)
        if len(simp) < 2:
            continue
        pts = [[round(x*DOWNSAMPLE, 1), round(y*DOWNSAMPLE, 1), 0.9] for (y, x) in simp]
        total = sum(np.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]) for i in range(1, len(pts)))
        if total < MIN_PATH_LEN*DOWNSAMPLE:
            continue
        # local ink width ~ 2 * distance-to-background, clamped
        medw = float(np.median(widths)) if len(widths) else 1.0
        size = max(1.6, min(8.0, 2 * medw * DOWNSAMPLE))
        strokes.append({"points": pts, "size": round(size, 2)})

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({"strokes": strokes}, f)
    print(f"wrote {len(strokes)} strokes ({sum(len(s['points']) for s in strokes)} points) to {OUT} in {time.time()-t0:.1f}s", flush=True)


if __name__ == '__main__':
    main()
