#!/usr/bin/env python3
"""Draw ref3 strokes into a fresh draworld canvas as editable brush strokes."""
import json, urllib.request, base64, io

API = 'http://127.0.0.1:59311/canvas-api'
STROKES = r'D:\dsh-plugins\dsh-draworld\tools\ref3_strokes.json'


def post(path, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def get(path):
    return json.loads(urllib.request.urlopen(API + path, timeout=30).read().decode('utf-8'))


def main():
    # fresh white canvas
    r = post('/new', {'width': 1080, 'height': 1440, 'background': '#ffffff'})
    print('new:', r.get('ok'), r.get('width'), r.get('height'))

    strokes = json.load(open(STROKES, encoding='utf-8'))['strokes']
    # use the default layer, rename to 线稿
    doc = get('/doc')['doc']
    lid = doc['layers'][0]['id']
    post('/op', {'op': 'layer.set', 'id': lid, 'patch': {'name': '线稿', 'active': True}})
    print('layer:', lid)

    BATCH = 300
    for i in range(0, len(strokes), BATCH):
        chunk = strokes[i:i+BATCH]
        payload = [{
            'color': '#111111', 'size': s['size'], 'opacity': 1,
            'brush': 'ink', 'taper': False, 'points': s['points'],
        } for s in chunk]
        r = post('/stroke', {'strokes': payload, 'layer': '线稿'})
        if not r.get('ok'):
            print('FAIL', i, r); return
        print(f'  drawn {min(i+BATCH, len(strokes))}/{len(strokes)} rev={r.get("revision")}', flush=True)

    # render preview from strokes only (what the browser canvas shows)
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (1080, 1440), 'white')
    dr = ImageDraw.Draw(im)
    for s in strokes:
        dr.line([(p[0], p[1]) for p in s['points']], fill=(17, 17, 17),
                width=max(1, int(round(s['size']))), joint='curve')
    buf = io.BytesIO(); im.save(buf, format='PNG')
    data_url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    r = post('/preview', {'dataUrl': data_url})
    print('preview:', r.get('ok'))

    s = get('/summary')
    print('summary:', s['strokes'], 'strokes', s['points'], 'points', 'rev', s['revision'])
    for l in s['layers']:
        print('  ', l['name'], 'strokes', l['strokes'])


if __name__ == '__main__':
    main()
