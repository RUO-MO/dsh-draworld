#!/usr/bin/env python3
"""Replicate the colored reference in draworld as a clean, layered canvas."""
import json, urllib.request, base64, io

API = 'http://127.0.0.1:59311/canvas-api'
REF = r'D:\dsh-plugins\dsh-draworld\参考图-炎帝.png'


def post(path, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def doc():
    return json.loads(urllib.request.urlopen(API + '/doc', timeout=30).read().decode('utf-8'))['doc']


def main():
    # 1) fresh 1080x1440 canvas
    r = post('/new', {'width': 1080, 'height': 1440, 'background': '#ffffff'})
    print('new:', r.get('ok'), r.get('width'), r.get('height'))

    # 2) exact reference as locked bottom layer (native plugin "import image" workflow)
    r = post('/import', {'path': REF, 'name': '原图', 'fit': 'contain'})
    ref_id = r['layer']['id']
    post('/op', {'op': 'layer.set', 'id': ref_id, 'patch': {'name': '原图', 'locked': True, 'visible': True}})
    print('reference layer:', ref_id)

    # 3) one empty editable drawing layer on top, active
    d = doc()
    blank = next(l for l in d['layers'] if l['id'] != ref_id)
    post('/op', {'op': 'layer.set', 'id': blank['id'], 'patch': {'name': '绘画', 'active': True}})
    print('drawing layer:', blank['id'])

    # 4) preview = exact reference placed on the canvas
    from PIL import Image
    im = Image.open(REF).convert('RGB')
    buf = io.BytesIO(); im.save(buf, format='PNG')
    data_url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    r = post('/preview', {'dataUrl': data_url})
    print('preview:', r.get('ok'))

    s = json.loads(urllib.request.urlopen(API + '/summary', timeout=30).read().decode('utf-8'))
    print('summary rev', s['revision'], 'layers:')
    for l in s['layers']:
        print('  ', l['name'], '| strokes', l['strokes'], '| image', bool(l['image']), '| locked', l['locked'])


if __name__ == '__main__':
    main()
