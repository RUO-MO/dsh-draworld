#!/usr/bin/env python3
"""Push traced strokes into the live draworld canvas via its HTTP API, in batches."""
import json, urllib.request, base64, io, time

API = 'http://127.0.0.1:59311/canvas-api'
STROKES = r'D:\dsh-plugins\dsh-draworld\tools\ref_strokes.json'
REF = r'D:\DSH\DSHdata\.dsh\profiles\desktop\.dsh-draworld\images\img-mwy91t98-hrn9.png'
LAYER = '线稿'


def post(path, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    strokes = json.load(open(STROKES, encoding='utf-8'))['strokes']
    print('total strokes:', len(strokes))

    # dedicated line-art layer above the reference
    res = post('/op', {'op': 'layer.add', 'name': LAYER})
    print('layer add:', res.get('ok'))

    BATCH = 300
    sent = 0
    t0 = time.time()
    for i in range(0, len(strokes), BATCH):
        chunk = strokes[i:i+BATCH]
        payload = []
        for s in chunk:
            payload.append({
                'color': '#111111',
                'size': s['size'],
                'opacity': 1,
                'brush': 'ink',
                'taper': False,
                'points': s['points'],
            })
        r = post('/stroke', {'strokes': payload, 'layer': LAYER})
        if not r.get('ok'):
            print('FAIL batch', i, r)
            break
        sent += len(chunk)
        print(f'  pushed {sent}/{len(strokes)}  rev={r.get("revision")}', flush=True)

    # build a faithful preview: vector strokes drawn over the reference image,
    # matching what the browser canvas renders (reference locked underneath).
    from PIL import Image, ImageDraw
    im = Image.open(REF).convert('RGBA')
    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    for s in strokes:
        pts = [(p[0], p[1]) for p in s['points']]
        dr.line(pts, fill=(17, 17, 17, 255), width=max(1, int(round(s['size']))), joint='curve')
    comp = Image.alpha_composite(im, layer).convert('RGB')

    buf = io.BytesIO()
    comp.save(buf, format='PNG')
    data_url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    r = post('/preview', {'dataUrl': data_url})
    print('preview posted:', r.get('ok'), r.get('path'))
    print(f'done in {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main()
