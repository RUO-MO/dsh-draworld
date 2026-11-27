#!/usr/bin/env python3
"""Vectorize ref_lineart3.png into draworld brush strokes (editable)."""
import json, time
import numpy as np
from PIL import Image

SRC = r"D:\dsh-plugins\dsh-draworld\ref_lineart3.png"
OUT = r"D:\dsh-plugins\dsh-draworld\tools\ref3_strokes.json"

THRESHOLD = 175
MIN_LEN = 6
TOLERANCE = 1.3
STEP = 5


def zhang_suen(binary):
    img = binary.astype(np.uint8).copy()
    h, w = img.shape
    for _ in range(100):
        changed = False
        for stage in (0, 1):
            p = np.pad(img, 1)
            P2 = p[0:h, 1:w+1]; P3 = p[0:h, 2:w+2]
            P4 = p[1:h+1, 2:w+2]; P5 = p[2:h+2, 2:w+2]
            P6 = p[2:h+2, 1:w+1]; P7 = p[2:h+2, 0:w]
            P8 = p[1:h+1, 0:w]; P9 = p[0:h, 0:w]
            seq = [P2, P3, P4, P5, P6, P7, P8, P9]
            trans = np.zeros_like(img)
            for i in range(8):
                trans += (seq[i] == 0) & (seq[(i+1) % 8] == 1)
            n = P2+P3+P4+P5+P6+P7+P8+P9
            base = (img == 1) & (n >= 2) & (n <= 6) & (trans == 1)
            if stage == 0:
                rm = base & (P2*P4*P6 == 0) & (P4*P6*P8 == 0)
            else:
                rm = base & (P2*P4*P8 == 0) & (P2*P6*P8 == 0)
            ys, xs = np.nonzero(rm)
            if len(xs):
                img[ys, xs] = 0
                changed = True
        if not changed:
            break
    return img.astype(bool)


def chamfer(binary, cap=12):
    h, w = binary.shape
    d = np.where(binary, cap, 0).astype(np.float32)
    for _ in range(2):
        for y in range(h):
            left = cap
            for x in range(w):
                if binary[y, x]:
                    v = min(d[y, x], left + 1)
                    if y > 0:
                        v = min(v, d[y-1, x] + 1)
                        if x > 0: v = min(v, d[y-1, x-1] + 1.414)
                        if x < w-1: v = min(v, d[y-1, x+1] + 1.414)
                    d[y, x] = v; left = v
                else:
                    left = cap
        for y in range(h-1, -1, -1):
            right = cap
            for x in range(w-1, -1, -1):
                if binary[y, x]:
                    v = min(d[y, x], right + 1)
                    if y < h-1:
                        v = min(v, d[y+1, x] + 1)
                        if x < w-1: v = min(v, d[y+1, x+1] + 1.414)
                        if x > 0: v = min(v, d[y+1, x-1] + 1.414)
                    d[y, x] = v; right = v
                else:
                    right = cap
    return d


def walk(skel, widths):
    h, w = skel.shape
    rem = skel.copy()
    pad = np.pad(rem.astype(np.uint8), 1)
    deg = np.zeros((h, w), np.int8)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0: continue
            deg += pad[1+dy:1+dy+h, 1+dx:1+dx+w]

    def nbrs(y, x):
        out = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0: continue
                ny, nx = y+dy, x+dx
                if 0 <= ny < h and 0 <= nx < w and rem[ny, nx]:
                    out.append((ny, nx))
        return out

    def build(sy, sx):
        path = [(sy, sx)]; rem[sy, sx] = False
        cur = (sy, sx); steps = 0
        while steps < 25000:
            steps += 1
            ns = nbrs(*cur)
            if not ns: break
            ns.sort(key=lambda q: deg[q[0], q[1]])
            nxt = ns[0]
            path.append(nxt); rem[nxt] = False; cur = nxt
            if deg[cur[0], cur[1]] == 1: break
        if len(path) > 3:
            a, b = path[0], path[-1]
            if max(abs(a[0]-b[0]), abs(a[1]-b[1])) <= 1:
                path.append(a)
        if len(path) >= MIN_LEN:
            yield (path, [widths[y, x] for y, x in path])

    ys, xs = np.nonzero(rem & (deg == 1))
    for y, x in zip(ys.tolist(), xs.tolist()):
        if rem[y, x]:
            yield from build(y, x)
    ys, xs = np.nonzero(rem & (deg > 2))
    for y, x in zip(ys.tolist(), xs.tolist()):
        if rem[y, x]:
            yield from build(y, x)
    ys, xs = np.nonzero(rem)
    while len(ys):
        yield from build(int(ys[0]), int(xs[0]))
        ys, xs = np.nonzero(rem)


def rdp(points, eps):
    if len(points) <= 2 or eps <= 0: return points
    keep = np.zeros(len(points), bool); keep[0] = keep[-1] = True
    stack = [(0, len(points)-1)]
    while stack:
        a, b = stack.pop()
        p1, p2 = np.array(points[a], float), np.array(points[b], float)
        d = p2-p1; dn = np.hypot(*d)
        if dn < 1e-9: continue
        idx, best = -1, eps
        for i in range(a+1, b):
            p0 = np.array(points[i], float)
            dist = abs((p0[0]-p1[0])*d[1] - (p0[1]-p1[1])*d[0])/dn
            if dist > best: best, idx = dist, i
        if idx >= 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def resample(points, step):
    if len(points) < 2: return points
    out = [points[0]]; acc = 0.0
    ax, ay = points[0]
    for i in range(1, len(points)):
        bx, by = points[i]
        seg = np.hypot(bx-ax, by-ay)
        if seg < 1e-9: continue
        while acc + seg >= step:
            t = (step-acc)/seg
            ix, iy = ax+(bx-ax)*t, ay+(by-ay)*t
            out.append((ix, iy))
            ax, ay = ix, iy
            seg = np.hypot(bx-ax, by-ay); acc = 0.0
        acc += seg
    if np.hypot(points[-1][0]-out[-1][0], points[-1][1]-out[-1][1]) > 0.5:
        out.append(points[-1])
    return out


def main():
    t0 = time.time()
    im = Image.open(SRC).convert('L')
    ink = np.asarray(im) < THRESHOLD
    print('ink', int(ink.sum()), 'of', ink.size, flush=True)
    skel = zhang_suen(ink)
    print('skeleton', int(skel.sum()), f'{time.time()-t0:.1f}s', flush=True)
    widths = chamfer(ink)
    strokes = []
    for path, ws in walk(skel, widths):
        simp = rdp(path, TOLERANCE)
        simp = resample(simp, STEP)
        if len(simp) < 2: continue
        pts = [[round(x, 1), round(y, 1), 0.9] for y, x in simp]
        total = sum(np.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]) for i in range(1, len(pts)))
        if total < MIN_LEN: continue
        med = float(np.median(ws)) if len(ws) else 1
        size = max(1.5, min(7.0, 2*med))
        strokes.append({'points': pts, 'size': round(size, 2)})
    json.dump({'strokes': strokes}, open(OUT, 'w', encoding='utf-8'))
    print('wrote', len(strokes), 'strokes', sum(len(s['points']) for s in strokes), 'points', f'{time.time()-t0:.1f}s', flush=True)


if __name__ == '__main__':
    main()
