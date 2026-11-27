/**
 * @xenra/dsh-draworld 前端：右侧栏里的真画布。
 *
 * 文档（笔迹 JSON）由宿主持有，这里只负责三件事：
 *   1. 把笔迹画到 <canvas>（按压感变粗细，所以有起收笔）；
 *   2. 接收鼠标/触控绘制，落笔后提交给宿主；
 *   3. 渲染结果回传 PNG，供模型用 read_image 验证。
 */

window.__ModuleLoader__.load({
  id: '@xenra/dsh-draworld',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TAB_ID = '@xenra/dsh-draworld/panel';
    const TAB_KIND = 'paintCanvas';
    /** 左栏全局面板的 id；sidebar.panellist 与 main 两个槽位用同一个 id 对上。 */
    const PANEL_ID = 'xenra-draworld';
    const API = '/canvas-api';
    /** 本插件的词条命名空间。 */
    const NS = 'xenraDraworld';

    /** 画布预设：比例、纸张（300dpi）、像素画布。尺寸都落在宿主 16~4096 的钳位里。 */
    const CANVAS_PRESETS = [
      { id: '1-1', label: '1:1', w: 1024, h: 1024, group: 'ratio' },
      { id: '4-3', label: '4:3', w: 1024, h: 768, group: 'ratio' },
      { id: '3-4', label: '3:4', w: 768, h: 1024, group: 'ratio' },
      { id: '16-9', label: '16:9', w: 1024, h: 576, group: 'ratio' },
      { id: '9-16', label: '9:16', w: 576, h: 1024, group: 'ratio' },
      { id: 'screen', label: '屏幕', w: 1920, h: 1080, group: 'paper' },
      { id: 'a4', label: 'A4', w: 2480, h: 3508, group: 'paper' },
      { id: 'a5', label: 'A5', w: 1748, h: 2480, group: 'paper' },
      { id: 'a6', label: 'A6', w: 1240, h: 1748, group: 'paper' },
      { id: 'b5', label: 'B5', w: 2079, h: 2953, group: 'paper' },
      { id: 'p16', label: '16', w: 16, h: 16, group: 'pixel' },
      { id: 'p32', label: '32', w: 32, h: 32, group: 'pixel' },
      { id: 'p64', label: '64', w: 64, h: 64, group: 'pixel' },
      { id: 'p128', label: '128', w: 128, h: 128, group: 'pixel' },
      { id: 'p256', label: '256', w: 256, h: 256, group: 'pixel' },
      { id: 'p512', label: '512', w: 512, h: 512, group: 'pixel' },
    ];

    const DICT = {
      zh: {
        title: '画界',
        open: '打开画界',
        'page.back': '回到对话',
        'page.tools': '画笔',
        'page.edit': '编辑',
        'page.canvas': '画布',
        'page.tab': '右栏画布',
        'page.hint': '左边画板，右上画笔、右下编辑与画布设置',
        'page.layerHint': '点一行选中它；◉ 控制显隐，不透明度和混合模式只作用于当前层',
        'page.importLayer': '导入图片',
        'page.importing': '导入中…',
        'page.imported': '已导入',
        'page.new': '新建',
        'page.new.title': '新建绘画',
        'page.new.saveQ': '当前这幅画要先留一份吗？',
        'page.new.saveHint': '「保存并新建」把当前渲染存成 PNG 落到保存路径（和「另存」同一处）；选「不保存」就直接换新画布，旧内容不再保留。',
        'page.new.saveAnd': '保存并新建',
        'page.new.skipSave': '不保存，直接新建',
        'page.new.cancel': '取消',
        'page.new.pick': '新画布怎么来？',
        'page.new.willSave': '会先把当前这幅存成 PNG',
        'page.new.blank': '空白画布',
        'page.new.blankHint': '挑一个尺寸，开一张干净的画布',
        'page.new.currentSize': '当前尺寸',
        'page.new.moreSizes': '更多尺寸 / 背景',
        'page.new.fromImage': '导入图片',
        'page.new.fromImageHint': '按图片尺寸建画布，图片放最底层（图层 1），上面自动留一层「绘画」',
        'page.new.chooseImage': '选择图片',
        'page.new.creating': '创建中…',
        'page.new.failed': '新建失败',
        'guide.title': '画界',
        'guide.description': '在右栏和模型一起在这块画布上画',
        'settings.subtitle': '画布参数由所有会话共用，保存后立刻生效',
        'settings.presets': '尺寸预设',
        'settings.presetRatio': '比例',
        'settings.presetPaper': '纸张（300dpi）',
        'settings.presetPixel': '像素画布',
        'settings.presetHint': '点一下立刻改尺寸，笔迹不移动；大画布更吃内存',
        'settings.size': '自定义',
        'settings.width': '宽',
        'settings.height': '高',
        'settings.background': '背景',
        'settings.dir': '缓存目录',
        'settings.saveDir': '保存路径',
        'settings.pathHint': '绝对路径；留空表示跟随缓存目录',
        'settings.dirHint': '画布文档 doc.json 和最近一次渲染 preview.png 放这里',
        'settings.saveHint': '另存的成品 PNG 放这里；清空则跟随缓存目录下的 exports',
        'settings.export': '另存当前画布',
        'settings.exported': '已保存到',
        'settings.copy': '复制路径',
        'settings.copied': '已复制',
        'settings.save': '保存',
        'settings.saved': '已保存',
        'settings.reset': '恢复默认',
        'settings.hint': '改尺寸不会挪动已有笔迹，只改画布边界',
        'settings.unreachable': '读不到画布参数，宿主可能没起来',
        clear: '清空',
        undo: '撤销',
        redo: '重做',
        replay: '回放',
        layers: '图层',
        layerAdd: '＋层',
        layerRemove: '删层',
        layerVisibility: '显隐',
        opacity: '不透明度',
        blendNormal: '正常',
        blendMultiply: '正片叠底',
        toolBrush: '笔',
        toolEraser: '擦',
        toolLine: '线',
        toolRect: '矩形',
        toolEllipse: '圆',
        brush: '笔刷',
        brushHint: '照画世界Pro 的画笔库分八类，32 支的写法各不相同（点开有样笔预览）',
        'brushGroup.basic': '常规画笔',
        'brushGroup.line': '勾线画笔',
        'brushGroup.sketch': '铅笔 / 素描',
        'brushGroup.water': '水彩',
        'brushGroup.inkwash': '水墨',
        'brushGroup.oil': '油画 / 厚涂',
        'brushGroup.air': '喷枪',
        'brushGroup.fx': '特效 / 网点',
        'brush.round': '圆头',
        'brush.hard': '硬边圆',
        'brush.softround': '软边圆',
        'brush.ballpoint': '圆珠笔',
        'brush.marker': '马克笔',
        'brush.flat': '平头笔',
        'brush.liner': '勾线笔',
        'brush.gpen': 'G 笔',
        'brush.ink': '墨水笔',
        'brush.outline': '描边笔',
        'brush.willow': '柳叶笔',
        'brush.pencil': '铅笔',
        'brush.sketch': '素描铅笔',
        'brush.charcoal': '炭笔',
        'brush.charcoalStick': '炭条',
        'brush.chalk': '粉笔',
        'brush.watercolor': '水彩笔',
        'brush.wash': '水彩铺色',
        'brush.wetedge': '湿边水彩',
        'brush.blender': '晕染笔',
        'brush.inkbrush': '水墨毛笔',
        'brush.hairbrush': '尖锋毛笔',
        'brush.drybrush': '干笔',
        'brush.oil': '油画笔',
        'brush.impasto': '厚涂笔',
        'brush.palette': '刮刀',
        'brush.airbrush': '软喷枪',
        'brush.airhard': '硬喷枪',
        'brush.airnoise': '噪点喷枪',
        'brush.halftone': '漫画网点',
        'brush.glow': '光效笔',
        'brush.sparkle': '粒子笔',
        layerCollapse: '收起',
        layerExpand: '展开',
        taper: '起收笔渐细',
        taperHint: '手绘时两头自动变细',
        staleHost: '画界宿主还是旧进程：笔刷目前只在前端生效，落笔后会按圆头重画。到「插件管理」把画界停用再启用（或重启 DSH）后重开这一页。',
        updateTip: '有新版本',
        updateNow: '当前',
        updateGo: '去 Release 下载',
        zoomFit: '适应',
        zoomActual: '1:1',
        panHint: '空格拖动/中键拖动平移，滚轮缩放',
        'settings.alpha': '透明底',
        'settings.alphaHint': '勾上就导出不含背景的 PNG，方便贴到别的画面上',
        color: '颜色',
        size: '笔宽',
        strokes: '笔迹',
        loading: '加载中…',
        empty: '在这块画布上画点什么',
        syncFailed: '与宿主失联',
      },
      en: {
        title: 'Canvas',
        open: 'Open canvas',
        'page.back': 'Back to chat',
        'page.tools': 'Brush',
        'page.edit': 'Edit',
        'page.canvas': 'Canvas',
        'page.tab': 'Side canvas',
        'page.hint': 'Board left, brushes top right, edit and canvas settings bottom right',
        'page.layerHint': 'Click a row to select it; ◉ toggles visibility. Opacity and blend apply to the active layer only',
        'page.importLayer': 'Import image',
        'page.importing': 'Importing…',
        'page.imported': 'Imported',
        'page.new': 'New',
        'page.new.title': 'New painting',
        'page.new.saveQ': 'Keep a copy of this painting first?',
        'page.new.saveHint': 'Save & new writes the current render to a PNG in the save path (same place as Export). Skip discards the old canvas.',
        'page.new.saveAnd': 'Save & new',
        'page.new.skipSave': 'Skip, just new',
        'page.new.cancel': 'Cancel',
        'page.new.pick': 'How should the new canvas start?',
        'page.new.willSave': 'The current painting will be saved as PNG',
        'page.new.blank': 'Blank canvas',
        'page.new.blankHint': 'Pick a size and start clean',
        'page.new.currentSize': 'Current size',
        'page.new.moreSizes': 'More sizes / background',
        'page.new.fromImage': 'Import image',
        'page.new.fromImageHint': 'Canvas takes the image size, image becomes layer 1, and a "Drawing" layer is added on top',
        'page.new.chooseImage': 'Choose image',
        'page.new.creating': 'Creating…',
        'page.new.failed': 'Could not create the canvas',
        'guide.title': 'Canvas',
        'guide.description': 'Draw on one shared canvas with the model in the right sidebar',
        'settings.subtitle': 'Canvas settings are shared by every session and apply on save',
        'settings.presets': 'Size presets',
        'settings.presetRatio': 'Ratio',
        'settings.presetPaper': 'Paper (300 dpi)',
        'settings.presetPixel': 'Pixel canvas',
        'settings.presetHint': 'One click applies the size; existing strokes stay put. Bigger canvases use more memory',
        'settings.size': 'Custom',
        'settings.width': 'Width',
        'settings.height': 'Height',
        'settings.background': 'Background',
        'settings.dir': 'Cache directory',
        'settings.saveDir': 'Save path',
        'settings.pathHint': 'Absolute path; leave empty to follow the cache directory',
        'settings.dirHint': 'Holds doc.json and the latest preview.png',
        'settings.saveHint': 'Exports land here; empty follows exports/ inside the cache directory',
        'settings.export': 'Save canvas as PNG',
        'settings.exported': 'Saved to',
        'settings.copy': 'Copy path',
        'settings.copied': 'Copied',
        'settings.save': 'Save',
        'settings.saved': 'Saved',
        'settings.reset': 'Reset defaults',
        'settings.hint': 'Changing the size moves no existing stroke; only the canvas bounds change',
        'settings.unreachable': 'Cannot read canvas settings; the host may not be running',
        clear: 'Clear',
        undo: 'Undo',
        redo: 'Redo',
        replay: 'Replay',
        layers: 'Layers',
        layerAdd: '+ layer',
        layerRemove: 'Remove',
        layerVisibility: 'Visibility',
        opacity: 'Opacity',
        blendNormal: 'Normal',
        blendMultiply: 'Multiply',
        toolBrush: 'Brush',
        toolEraser: 'Erase',
        toolLine: 'Line',
        toolRect: 'Rect',
        toolEllipse: 'Ellipse',
        brush: 'Brush type',
        brushHint: 'Mirrors Huashijie Pro’s brush library in eight groups; each of the 32 brushes renders differently (preview inside)',
        'brushGroup.basic': 'Basic',
        'brushGroup.line': 'Inking',
        'brushGroup.sketch': 'Pencil / sketch',
        'brushGroup.water': 'Watercolor',
        'brushGroup.inkwash': 'Ink wash',
        'brushGroup.oil': 'Oil / impasto',
        'brushGroup.air': 'Airbrush',
        'brushGroup.fx': 'Effects / halftone',
        'brush.round': 'Round',
        'brush.hard': 'Hard round',
        'brush.softround': 'Soft round',
        'brush.ballpoint': 'Ballpoint',
        'brush.marker': 'Marker',
        'brush.flat': 'Flat',
        'brush.liner': 'Liner',
        'brush.gpen': 'G-pen',
        'brush.ink': 'Ink pen',
        'brush.outline': 'Outline',
        'brush.willow': 'Willow',
        'brush.pencil': 'Pencil',
        'brush.sketch': 'Sketch pencil',
        'brush.charcoal': 'Charcoal',
        'brush.charcoalStick': 'Charcoal stick',
        'brush.chalk': 'Chalk',
        'brush.watercolor': 'Watercolor',
        'brush.wash': 'Wash',
        'brush.wetedge': 'Wet edge',
        'brush.blender': 'Blender',
        'brush.inkbrush': 'Ink brush',
        'brush.hairbrush': 'Fine brush',
        'brush.drybrush': 'Dry brush',
        'brush.oil': 'Oil brush',
        'brush.impasto': 'Impasto',
        'brush.palette': 'Palette knife',
        'brush.airbrush': 'Soft airbrush',
        'brush.airhard': 'Hard airbrush',
        'brush.airnoise': 'Noise airbrush',
        'brush.halftone': 'Halftone',
        'brush.glow': 'Glow',
        'brush.sparkle': 'Sparkle',
        layerCollapse: 'Hide',
        layerExpand: 'Layers',
        taper: 'Taper ends',
        taperHint: 'Hand strokes thin out at both ends',
        staleHost: 'The host is still an old process: brushes only work in the preview and strokes get redrawn as round. Disable and re-enable 画界 in Plugins (or restart DSH), then reopen this page.',
        updateTip: 'Update available',
        updateNow: 'now',
        updateGo: 'Get it on Releases',
        zoomFit: 'Fit',
        zoomActual: '1:1',
        panHint: 'Space or middle-drag to pan, wheel to zoom',
        'settings.alpha': 'Transparent',
        'settings.alphaHint': 'Export PNG without the background, ready to paste elsewhere',
        color: 'Color',
        size: 'Size',
        strokes: 'strokes',
        loading: 'Loading…',
        empty: 'Draw something',
        syncFailed: 'Host unreachable',
      },
    };

        /**
     * 笔刷表：照画世界Pro 画笔库的分类（常规/勾线/铅笔/水彩/水墨/油画/喷枪/特效）把每一支做成一行参数。
     * engine 决定怎么落笔，w/minRatio/gamma 决定粗细随压感怎么变；加一支只要加一行，界面和模型接口都从这张表长出来。
     */
    const BRUSHES = [
      // 常规画笔
      { id: 'round', group: 'basic', engine: 'solid', w: 1, minRatio: 0.28 },
      { id: 'hard', group: 'basic', engine: 'solid', w: 0.95, minRatio: 0.6, alpha: 0.95, cap: 'round' },
      { id: 'softround', group: 'basic', engine: 'soft', w: 1.1, minRatio: 0.45 },
      { id: 'ballpoint', group: 'basic', engine: 'solid', w: 0.55, minRatio: 0.85, alpha: 0.95 },
      { id: 'marker', group: 'basic', engine: 'flat', w: 0.95, minRatio: 1, cap: 'square' },
      { id: 'flat', group: 'basic', engine: 'flat', w: 1, minRatio: 0.8, cap: 'butt' },

      // 勾线画笔
      { id: 'liner', group: 'line', engine: 'solid', w: 0.5, minRatio: 0.2, gamma: 1.6 },
      { id: 'gpen', group: 'line', engine: 'solid', w: 0.85, minRatio: 0.25 },
      { id: 'ink', group: 'line', engine: 'solid', w: 0.9, minRatio: 0.7 },
      { id: 'outline', group: 'line', engine: 'solid', w: 0.7, minRatio: 0.55 },
      { id: 'willow', group: 'line', engine: 'solid', w: 1, minRatio: 0.08, gamma: 2 },

      // 铅笔 / 素描
      { id: 'pencil', group: 'sketch', engine: 'grain', w: 0.95, minRatio: 0.5, density: 0.85 },
      { id: 'sketch', group: 'sketch', engine: 'grain', w: 0.8, minRatio: 0.6, density: 0.5, fine: 1 },
      { id: 'charcoal', group: 'sketch', engine: 'grain', w: 1.15, minRatio: 0.45, density: 1, coarse: 1 },
      { id: 'charcoalStick', group: 'sketch', engine: 'grain', w: 1.35, minRatio: 0.35, density: 1, coarse: 1, spread: 0.5 },
      { id: 'chalk', group: 'sketch', engine: 'chalk', w: 1.1, minRatio: 0.4, density: 1 },

      // 水彩
      { id: 'watercolor', group: 'water', engine: 'wet', w: 1.15, minRatio: 0.5, rim: 1.15 },
      { id: 'wash', group: 'water', engine: 'wet', w: 1.5, minRatio: 0.7, rim: 0.9 },
      { id: 'wetedge', group: 'water', engine: 'wet', w: 1.05, minRatio: 0.45, rim: 1.5 },
      { id: 'blender', group: 'water', engine: 'soft', w: 1.35, minRatio: 0.6 },

      // 水墨
      { id: 'inkbrush', group: 'inkwash', engine: 'inkflow', w: 1, minRatio: 0.15, gamma: 1.9 },
      { id: 'hairbrush', group: 'inkwash', engine: 'inkflow', w: 1.05, minRatio: 0.1, gamma: 2.2, halo: 0.7 },
      { id: 'drybrush', group: 'inkwash', engine: 'dry', w: 1.2, minRatio: 0.35 },

      // 油画 / 厚涂
      { id: 'oil', group: 'oil', engine: 'oil', w: 1.1, minRatio: 0.55 },
      { id: 'impasto', group: 'oil', engine: 'oil', w: 1, minRatio: 0.5, thick: 1 },
      { id: 'palette', group: 'oil', engine: 'dry', w: 1.3, minRatio: 0.75, cap: 'butt', lanes: 3 },

      // 喷枪
      { id: 'airbrush', group: 'air', engine: 'spray', soft: 1, w: 1.25, minRatio: 0.4 },
      { id: 'airhard', group: 'air', engine: 'spray', w: 0.95, minRatio: 0.6, tight: 1 },
      { id: 'airnoise', group: 'air', engine: 'spray', w: 1.6, minRatio: 0.5, spread: 1.6 },

      // 特效 / 网点
      { id: 'halftone', group: 'fx', engine: 'halftone', w: 1, minRatio: 0.6 },
      { id: 'glow', group: 'fx', engine: 'glow', w: 1.2, minRatio: 0.5 },
      { id: 'sparkle', group: 'fx', engine: 'scatter', w: 1.3, minRatio: 0.4 },
    ];
    const BRUSH_IDS = BRUSHES.map((b) => b.id);
    // 笔刷的中文名：界面上「笔 · 圆头」这类显示要用，之前缺这张表所以显示成 undefined
    const BRUSH_LABELS = {
      round: '圆头', hard: '硬边圆', softround: '软边圆', ballpoint: '圆珠笔', marker: '马克笔', flat: '平头',
      liner: '勾线笔', gpen: 'G 笔', ink: '墨水笔', outline: '描边笔', willow: '柳叶笔',
      pencil: '铅笔', sketch: '素描铅笔', charcoal: '炭笔', charcoalStick: '炭条', chalk: '粉笔',
      watercolor: '水彩笔', wash: '铺色', wetedge: '湿边', blender: '晕染',
      inkbrush: '水墨毛笔', hairbrush: '尖锋毛笔', drybrush: '干笔',
      oil: '油画笔', impasto: '厚涂', palette: '刮刀',
      airbrush: '软喷枪', airhard: '硬喷枪', airnoise: '噪点喷枪',
      halftone: '漫画网点', glow: '光效', sparkle: '粒子',
    };
    const BRUSH_BY_ID = new Map(BRUSHES.map((b) => [b.id, { ...b, label: b.label || BRUSH_LABELS[b.id] || b.id }]));
    const BRUSH_GROUPS = ['basic', 'line', 'sketch', 'water', 'inkwash', 'oil', 'air', 'fx'];
    const ERASER_SPEC = { id: 'round', engine: 'solid', w: 1, minRatio: 0.3 };

    /** #rrggbb → rgba()，软笔和湿笔的径向渐变要用。 */
    function rgbaOf(hex, alpha) {
      const h = String(hex || '#111111').replace('#', '');
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${Number.isFinite(r) ? r : 17},${Number.isFinite(g) ? g : 17},${Number.isFinite(b) ? b : 17},${alpha})`;
    }

    /** 稳定伪随机：同一笔每次重绘抖动一致，回放和导出不会跳来跳去。 */
    function jitterOf(seed, i) {
      const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    }

    const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

    /** 沿折线等距取点，widthAt 给每个点配一个笔宽；喷枪/网点/光效这类「按点撒」的引擎靠它。 */
    function resamplePath(pts, widthAt, gap, maxCount) {
      const segs = [];
      let total = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const ax = Number(pts[i - 1][0]);
        const ay = Number(pts[i - 1][1]);
        const bx = Number(pts[i][0]);
        const by = Number(pts[i][1]);
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.05) continue;
        segs.push({ ax, ay, bx, by, len, start: total, i });
        total += len;
      }
      const out = [];
      if (!segs.length) return out;
      const step = Math.max(gap, total / Math.max(1, maxCount || 2400));
      let si = 0;
      for (let d = 0; d <= total; d += step) {
        while (si < segs.length - 1 && d > segs[si].start + segs[si].len) si += 1;
        const s = segs[si];
        const f = s.len > 0 ? clamp01((d - s.start) / s.len) : 0;
        out.push({
          x: s.ax + (s.bx - s.ax) * f,
          y: s.ay + (s.by - s.ay) * f,
          w: widthAt(pts[s.i], s.i),
          d,
        });
      }
      return out;
    }

    /** 逐段描一笔 ribbon：多数引擎的底子。 */
    function ribbon(g, pts, widthOf, mul, cap) {
      g.lineCap = cap || 'round';
      g.lineJoin = 'round';
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const ax = Number(a[0]);
        const ay = Number(a[1]);
        const bx = Number(b[0]);
        const by = Number(b[1]);
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;
        g.lineWidth = Math.max(0.4, ((widthOf(a, i - 1) + widthOf(b, i)) / 2) * mul);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }

    /**
     * 各笔刷的落笔方式。每支笔的差别是真的在这层分出来的：
     * solid 实边、flat 平头等宽、soft 软边、grain 颗粒、chalk 粉笔、dry 飞白、wet 水彩、
     * inkflow 水墨、oil 厚涂、spray 喷枪、halftone 网点、glow 光效、scatter 粒子。
     */
    const BRUSH_ENGINES = {
      solid(g, c) {
        g.globalAlpha = c.alpha;
        ribbon(g, c.pts, c.widthAt, 1, c.spec.cap || 'round');
      },

      flat(g, c) {
        // 平头笔：整条笔迹合成一个多边形一次填掉，接口处不会有台阶或发丝白缝
        const pts = c.pts;
        const left = [];
        const right = [];
        for (let i = 0; i < pts.length; i += 1) {
          const p = pts[i];
          const prev = pts[Math.max(0, i - 1)];
          const next = pts[Math.min(pts.length - 1, i + 1)];
          const dx = Number(next[0]) - Number(prev[0]);
          const dy = Number(next[1]) - Number(prev[1]);
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const w = c.widthAt(p, i) / 2;
          left.push([Number(p[0]) + nx * w, Number(p[1]) + ny * w]);
          right.push([Number(p[0]) - nx * w, Number(p[1]) - ny * w]);
        }
        g.globalAlpha = c.alpha;
        g.beginPath();
        g.moveTo(left[0][0], left[0][1]);
        for (let i = 1; i < left.length; i += 1) g.lineTo(left[i][0], left[i][1]);
        for (let i = right.length - 1; i >= 0; i -= 1) g.lineTo(right[i][0], right[i][1]);
        g.closePath();
        g.fill();
      },

      soft(g, c) {
        const passes = [[1.2, 0.12], [0.98, 0.45]];
        for (const [k, a] of passes) {
          g.globalAlpha = c.alpha * a;
          ribbon(g, c.pts, c.widthAt, k, 'round');
        }
      },

      grain(g, c) {
        // 一条淡底保证线是连续的，上面撒细颗粒；颗粒按笔迹 id 做种子，重绘/回放/导出完全一致
        g.globalAlpha = c.alpha * 0.32;
        ribbon(g, c.pts, c.widthAt, 0.86, 'round');
        const gap = Math.max(0.55, c.size * 0.012);
        const dots = resamplePath(c.pts, c.widthAt, gap, 6000);
        const spread = c.spec.spread || 0.2;
        for (let k = 0; k < dots.length; k += 1) {
          const p = dots[k];
          const n1 = jitterOf(c.seed, k * 3 + 1);
          const n2 = jitterOf(c.seed, k * 3 + 2);
          if (Math.abs(n2) > (c.spec.density || 1)) continue;
          const ox = jitterOf(c.seed, k * 3 + 5) * p.w * spread;
          const oy = jitterOf(c.seed, k * 3 + 6) * p.w * spread;
          const r = Math.max(0.25, p.w * (c.spec.coarse
            ? 0.03 + 0.05 * Math.abs(n1)
            : 0.025 + 0.04 * Math.abs(n1)));
          g.globalAlpha = c.alpha * (0.14 + 0.22 * Math.abs(jitterOf(c.seed, k * 3 + 7)));
          g.beginPath();
          g.arc(p.x + ox, p.y + oy, r, 0, Math.PI * 2);
          g.fill();
        }
      },

      chalk(g, c) {
        BRUSH_ENGINES.grain(g, { ...c, spec: { ...c.spec, density: 1, coarse: 1 } });
        const dots = resamplePath(c.pts, c.widthAt, Math.max(1.6, c.size * 0.06), 1600);
        for (let k = 0; k < dots.length; k += 1) {
          const p = dots[k];
          const n = Math.abs(jitterOf(c.seed, k * 5 + 4));
          g.globalAlpha = c.alpha * 0.12;
          g.beginPath();
          g.arc(
            p.x + jitterOf(c.seed, k * 5 + 2) * p.w * 0.42,
            p.y + jitterOf(c.seed, k * 5 + 3) * p.w * 0.42,
            Math.max(0.4, p.w * (0.05 + 0.06 * n)),
            0,
            Math.PI * 2,
          );
          g.fill();
        }
      },

      dry(g, c) {
        // 飞白：先铺一层薄的实条，再沿法线劈成几股细毛，每股各自按 ~10px 的段落随机断开
        const lanes = c.spec.lanes || 6;
        g.globalAlpha = c.alpha * 0.36;
        ribbon(g, c.pts, c.widthAt, 0.8, 'round');
        g.lineCap = 'round';
        for (let lane = 0; lane < lanes; lane += 1) {
          const f = (lane / Math.max(1, lanes - 1)) - 0.5;
          for (let i = 1; i < c.pts.length; i += 1) {
            const a = c.pts[i - 1];
            const b = c.pts[i];
            const ax = Number(a[0]);
            const ay = Number(a[1]);
            const bx = Number(b[0]);
            const by = Number(b[1]);
            if (![ax, ay, bx, by].every(Number.isFinite)) continue;
            const len = Math.hypot(bx - ax, by - ay);
            if (len < 0.05) continue;
            const nx = -(by - ay) / len;
            const ny = (bx - ax) / len;
            const w = (c.widthAt(a, i - 1) + c.widthAt(b, i)) / 2;
            // 每 8 段（约 10px）换一次噪声，断口才有「干笔刷过纸面」的长度
            const n = jitterOf(c.seed, lane * 811 + Math.floor(i / 8) * 7);
            if (n < -0.6) continue;
            const off = f * w * 0.8 + n * w * 0.06;
            g.globalAlpha = c.alpha * (0.26 + 0.24 * Math.abs(n));
            g.lineWidth = Math.max(0.3, w * (0.1 + 0.05 * Math.abs(n)));
            g.beginPath();
            g.moveTo(ax + nx * off, ay + ny * off);
            g.lineTo(bx + nx * off, by + ny * off);
            g.stroke();
          }
        }
      },

      wet(g, c) {
        // 水彩：先铺一条很淡的水体，再撒边缘略深的湿边圆；叠几笔才出浓度
        g.globalAlpha = c.alpha * 0.16;
        ribbon(g, c.pts, c.widthAt, 0.94, 'round');
        const dots = resamplePath(c.pts, c.widthAt, Math.max(1.4, c.size * 0.08), 2200);
        const rim = c.spec.rim || 1.1;
        g.globalAlpha = 1;
        for (const p of dots) {
          const r = Math.max(1.6, p.w * 0.85);
          const grad = g.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
          grad.addColorStop(0, rgbaOf(c.color, c.alpha * 0.07));
          grad.addColorStop(0.66, rgbaOf(c.color, c.alpha * 0.07 * rim));
          grad.addColorStop(1, rgbaOf(c.color, 0));
          g.fillStyle = grad;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.fill();
        }
      },

      inkflow(g, c) {
        // 水墨：外面一层淡墨渗开，里面一条实心芯，两头靠 taper 收成尖
        const halo = c.spec.halo === undefined ? 1 : c.spec.halo;
        g.globalAlpha = c.alpha * 0.12;
        ribbon(g, c.pts, c.widthAt, 1 + 0.8 * halo, 'round');
        g.globalAlpha = c.alpha * 0.95;
        ribbon(g, c.pts, c.widthAt, 1, 'round');
      },

      oil(g, c) {
        const thick = c.spec.thick === 1;
        g.globalAlpha = c.alpha * (thick ? 1 : 0.92);
        ribbon(g, c.pts, c.widthAt, 1, 'round');
        // 毛刷拖痕：沿法线错开的细条，厚涂多压一遍
        const lanes = thick ? 6 : 4;
        for (let lane = 0; lane < lanes; lane += 1) {
          const f = (lane / Math.max(1, lanes - 1)) - 0.5;
          for (let i = 1; i < c.pts.length; i += 1) {
            const a = c.pts[i - 1];
            const b = c.pts[i];
            const ax = Number(a[0]);
            const ay = Number(a[1]);
            const bx = Number(b[0]);
            const by = Number(b[1]);
            const len = Math.hypot(bx - ax, by - ay);
            if (len < 0.05) continue;
            const nx = -(by - ay) / len;
            const ny = (bx - ax) / len;
            const w = (c.widthAt(a, i - 1) + c.widthAt(b, i)) / 2;
            const n = jitterOf(c.seed, i * 13 + lane);
            if (Math.abs(n) > 0.85) continue;
            const off = f * w * 0.66 + n * w * 0.1;
            g.globalAlpha = c.alpha * 0.12;
            g.lineWidth = Math.max(0.3, w * 0.14);
            g.beginPath();
            g.moveTo(ax + nx * off, ay + ny * off);
            g.lineTo(bx + nx * off, by + ny * off);
            g.stroke();
          }
        }
      },

      spray(g, c) {
        const soft = c.spec.soft === 1;
        const tight = c.spec.tight === 1;
        const spread = c.spec.spread || 1;
        if (soft) {
          // 软喷枪：一串相互融掉的渐变圆，边界没有颗粒感
          const dots = resamplePath(c.pts, c.widthAt, Math.max(1.2, c.size * 0.08), 1800);
          g.globalAlpha = 1;
          for (const p of dots) {
            const r = Math.max(1.8, p.w * 1.1);
            const grad = g.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
            grad.addColorStop(0, rgbaOf(c.color, c.alpha * 0.07));
            grad.addColorStop(0.6, rgbaOf(c.color, c.alpha * 0.04));
            grad.addColorStop(1, rgbaOf(c.color, 0));
            g.fillStyle = grad;
            g.beginPath();
            g.arc(p.x, p.y, r, 0, Math.PI * 2);
            g.fill();
          }
          return;
        }
        const dots = resamplePath(c.pts, c.widthAt, Math.max(0.9, c.size * 0.05), 3000);
        const per = tight ? 3 : 4;
        for (let k = 0; k < dots.length; k += 1) {
          const p = dots[k];
          const base = p.w * (tight ? 0.09 : 0.11);
          for (let j = 0; j < per; j += 1) {
            const n1 = jitterOf(c.seed, k * 7 + j * 3 + 1);
            const n2 = jitterOf(c.seed, k * 7 + j * 3 + 2);
            const n3 = Math.abs(jitterOf(c.seed, k * 7 + j * 3 + 3));
            g.globalAlpha = c.alpha * (tight ? 0.2 : 0.11) * (0.5 + 0.5 * Math.abs(n1));
            g.beginPath();
            g.arc(p.x + n1 * p.w * spread, p.y + n2 * p.w * spread, Math.max(0.3, base * (0.4 + 0.6 * n3)), 0, Math.PI * 2);
            g.fill();
          }
        }
      },

      halftone(g, c) {
        // 网点：把笔迹盖住的格子挑出来，每格一个圆点，密的地方自然连成一片
        const grid = Math.max(3, c.size * 0.2);
        const dots = resamplePath(c.pts, c.widthAt, Math.max(1.4, grid * 0.55), 1600);
        const cells = new Set();
        for (const p of dots) {
          const reach = Math.ceil((p.w * 0.86) / grid);
          const gx0 = Math.round(p.x / grid);
          const gy0 = Math.round(p.y / grid);
          for (let dx = -reach; dx <= reach; dx += 1) {
            for (let dy = -reach; dy <= reach; dy += 1) {
              const cx = (gx0 + dx) * grid;
              const cy = (gy0 + dy) * grid;
              if (Math.hypot(cx - p.x, cy - p.y) > p.w * 0.86) continue;
              cells.add(`${gx0 + dx},${gy0 + dy}`);
            }
          }
        }
        g.globalAlpha = c.alpha * 0.9;
        for (const key of cells) {
          const comma = key.indexOf(',');
          const cx = Number(key.slice(0, comma)) * grid;
          const cy = Number(key.slice(comma + 1)) * grid;
          g.beginPath();
          g.arc(cx, cy, grid * 0.3, 0, Math.PI * 2);
          g.fill();
        }
      },

      glow(g, c) {
        const dots = resamplePath(c.pts, c.widthAt, Math.max(1.6, c.size * 0.12), 1600);
        for (const p of dots) {
          const r = Math.max(1.8, p.w * 1.3);
          const grad = g.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
          grad.addColorStop(0, rgbaOf(c.color, c.alpha * 0.16));
          grad.addColorStop(0.4, rgbaOf(c.color, c.alpha * 0.07));
          grad.addColorStop(1, rgbaOf(c.color, 0));
          g.fillStyle = grad;
          g.globalAlpha = 1;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.fill();
        }
      },

      scatter(g, c) {
        const dots = resamplePath(c.pts, c.widthAt, Math.max(1.6, c.size * 0.14), 1800);
        g.globalAlpha = 1;
        for (let k = 0; k < dots.length; k += 1) {
          const p = dots[k];
          const n1 = jitterOf(c.seed, k * 5 + 1);
          const n2 = jitterOf(c.seed, k * 5 + 2);
          const n3 = Math.abs(jitterOf(c.seed, k * 5 + 3));
          const x = p.x + n1 * p.w * 1.0;
          const y = p.y + n2 * p.w * 1.0;
          if (n3 > 0.85) {
            g.globalAlpha = c.alpha * 0.05;
            g.beginPath();
            g.arc(x, y, Math.max(1.2, p.w * 0.14), 0, Math.PI * 2);
            g.fill();
          } else {
            g.globalAlpha = c.alpha * (0.25 + 0.35 * n3);
            g.beginPath();
            g.arc(x, y, Math.max(0.35, p.w * (0.03 + 0.09 * n3)), 0, Math.PI * 2);
            g.fill();
          }
        }
      },
    };

    /**
     * 按笔刷把一笔画出来：宽度随压感变，taper=true 时起收笔渐细，具体落笔交给 engine。
     * 橡皮固定走圆头实心，在图层上擦成透明（destination-out）。
     */
    /** Chaikin 角切：把折线磨圆一遍，点会变多，形状更顺。 */
    function chaikin(pts, closed) {
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

    /** 描线的后处理：Chaikin 磨圆 + 轻微 RDP 收紧，出来就是一条顺的线而不是锯齿折线。 */
    function smoothPath(pts, closed, iterations) {
      const iters = Math.max(0, Math.min(3, Number(iterations) || 0));
      if (iters === 0 || pts.length < 3) return pts;
      let s = pts;
      for (let k = 0; k < iters; k += 1) s = chaikin(s, closed);
      // 磨圆之后点会翻倍，用很小容差压一下，保留曲率但别把点堆成山
      return rdp(s, 0.6);
    }

    /**
     * 渲染前的曲线补点：稀疏折线用 Catmull-Rom 补成曲线采样。
     * 这是「线条不流畅」的另一半原因——数据再顺，直接 lineTo 连接也会一段一段带折角。
     */
    function curvePts(pts) {
      const n = pts.length;
      if (n < 3) return pts;
      let total = 0;
      for (let i = 1; i < n; i += 1) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const avg = total / (n - 1);
      if (avg <= 2.5 || n > 4000) return pts;
      const samples = Math.max(2, Math.min(8, Math.round(avg / 2)));
      const pAt = (i) => pts[Math.max(0, Math.min(n - 1, i))];
      const out = [pts[0]];
      const hasPressure = pts[0].length > 2;
      for (let i = 0; i < n - 1; i += 1) {
        const p0 = pAt(i - 1);
        const p1 = pAt(i);
        const p2 = pAt(i + 1);
        const p3 = pAt(i + 2);
        for (let s = 1; s <= samples; s += 1) {
          const t = s / samples;
          const t2 = t * t;
          const t3 = t2 * t;
          const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
          const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
          if (hasPressure && p1.length > 2 && p2.length > 2) {
            const pr = Number(p1[2]) + (Number(p2[2]) - Number(p1[2])) * t;
            out.push([x, y, pr]);
          } else {
            out.push([x, y]);
          }
        }
      }
      return out;
    }

    function paintStroke(g, stroke) {
      const rawPts = stroke.points || [];
      if (rawPts.length < 2) return;
      // 填充笔迹：points 是一个多边形，直接填色（copy 出来的色块用它，比刷子糊一万笔准）
      if (stroke.mode === 'fill') {
        const pts = rawPts;
        g.save();
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = stroke.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(stroke.opacity)));
        g.fillStyle = stroke.color || '#ffffff';
        g.beginPath();
        g.moveTo(Number(pts[0][0]), Number(pts[0][1]));
        for (let i = 1; i < pts.length; i += 1) g.lineTo(Number(pts[i][0]), Number(pts[i][1]));
        g.closePath();
        // holes：区域里的洞（眼睛高光之类）用 evenodd 挖掉
        if (Array.isArray(stroke.holes)) {
          for (const hole of stroke.holes) {
            if (!hole || hole.length < 3) continue;
            g.moveTo(Number(hole[0][0]), Number(hole[0][1]));
            for (let i = 1; i < hole.length; i += 1) g.lineTo(Number(hole[i][0]), Number(hole[i][1]));
            g.closePath();
          }
        }
        g.fill('evenodd');
        g.restore();
        return;
      }
      const eraser = stroke.mode === 'eraser';
      // 笔迹补成曲线再画：稀疏控制点直连会出折角，这是「线条不流畅」的主因之一
      const pts = curvePts(rawPts);
      const spec = eraser ? ERASER_SPEC : (BRUSH_BY_ID.get(stroke.brush) || BRUSH_BY_ID.get('round'));
      const size = Number(stroke.size) || 8;
      const defaultMin = spec.minRatio === undefined ? 0.3 : spec.minRatio;
      const minRatio = stroke.minSize === undefined
        ? defaultMin
        : Math.max(0, Math.min(1, Number(stroke.minSize) || 0));
      const taperOn = stroke.taper === true;
      const segs = pts.length - 1;
      const alpha = (stroke.opacity === undefined ? 1 : Number(stroke.opacity)) * (spec.alpha === undefined ? 1 : spec.alpha);
      const color = stroke.color || '#111';
      const pressureAt = (p) => (p.length > 2 ? Math.max(0.02, Math.min(1, Number(p[2]))) : 0.75);
      const taperAt = (i) => {
        if (!taperOn || segs < 4) return 1;
        const edge = Math.max(1, Math.floor(segs * 0.15));
        if (i <= edge) return Math.max(0.18, i / edge);
        if (i >= segs - edge) return Math.max(0.18, (segs - i) / edge);
        return 1;
      };
      const widthAt = (p, i) => {
        const shaped = Math.pow(pressureAt(p), spec.gamma || 1);
        return Math.max(0.6, size * (spec.w || 1) * (minRatio + (1 - minRatio) * shaped) * taperAt(i));
      };

      g.save();
      if (eraser) {
        g.globalCompositeOperation = 'destination-out';
        g.strokeStyle = '#000';
        g.fillStyle = '#000';
      } else {
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = color;
        g.fillStyle = color;
      }
      const engine = BRUSH_ENGINES[spec.engine] || BRUSH_ENGINES.solid;
      engine(g, {
        pts,
        spec,
        size,
        alpha,
        color,
        widthAt,
        seed: String(stroke.id || 'x').split('').reduce((n, ch) => n + ch.charCodeAt(0), 0) || 1,
      });
      g.restore();
    }

    /** 图层合成用的离屏画布，尺寸变了再重建，避免每帧分配。 */
    let scratch = null;
    let scratchW = 0;
    let scratchH = 0;
    const scratchOf = (w, hgt) => {
      if (!scratch) scratch = document.createElement('canvas');
      if (scratchW !== w || scratchH !== hgt) {
        scratch.width = w;
        scratch.height = hgt;
        scratchW = w;
        scratchH = hgt;
      }
      return scratch;
    };

    const layersOf = (doc) => {
      if (Array.isArray(doc.layers) && doc.layers.length > 0) return doc.layers;
      return [{ id: 'l1', visible: true, opacity: 1, blend: 'normal', strokes: doc.strokes || [] }];
    };

    /** 导入图片的缓存：file -> { el, ok, promise }。渲染同步进行，所以素材要提前载入。 */
    const IMAGES = new Map();
    const imageUrl = (file) => `${API}/image/${String(file).split('/').map(encodeURIComponent).join('/')}`;

    /** 取一张图的缓存项；第一次用就开载，载入结果记在 ok 上。 */
    function imageEntry(file) {
      const hit = IMAGES.get(file);
      if (hit) return hit;
      const el = new Image();
      const entry = { el, ok: false, promise: null };
      entry.promise = new Promise((resolve) => {
        el.addEventListener('load', () => {
          entry.ok = true;
          resolve();
        }, { once: true });
        el.addEventListener('error', () => {
          entry.ok = false;
          resolve();
        }, { once: true });
      });
      el.src = imageUrl(file);
      IMAGES.set(file, entry);
      return entry;
    }

    /** 把文档里引用到的图片都备好；已经载入的跳过，载入失败的也算「有结果」，不会卡住轮询。 */
    function ensureImages(doc) {
      const pending = [];
      for (const layer of layersOf(doc)) {
        const meta = layer.image;
        if (!meta || !meta.file) continue;
        const entry = imageEntry(meta.file);
        if (!entry.ok) {
          // 最多等 2 秒：图片一直不回来也不能把轮询卡死
          pending.push(Promise.race([
            entry.promise,
            new Promise((resolve) => setTimeout(resolve, 2000)),
          ]));
        }
      }
      return Promise.all(pending);
    }

    /** 图片层：按文档里记的落位画上去；还没载入就先不画（下一帧会补）。 */
    function drawImageLayer(ctx, meta) {
      const entry = IMAGES.get(meta.file);
      const img = entry && entry.el;
      if (!img || !img.naturalWidth) return;
      const w = Number(meta.w) || img.naturalWidth;
      const h = Number(meta.h) || img.naturalHeight;
      ctx.drawImage(img, Number(meta.x) || 0, Number(meta.y) || 0, w, h);
    }

    /** 把文档画到画布：逐层合成，支持显隐、不透明度、正片叠底；withBackground=false 得到透明底。 */
    function renderDoc(canvas, doc, opts = {}) {
      if (!canvas || !doc) return;
      const w = doc.width || 1024;
      const hgt = doc.height || 1024;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== hgt) canvas.height = hgt;      const g = canvas.getContext('2d');
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, w, hgt);
      if (opts.withBackground !== false) {
        g.fillStyle = doc.background || '#ffffff';
        g.fillRect(0, 0, w, hgt);
      }
      g.restore();

      for (const layer of layersOf(doc)) {
        if (layer.visible === false) continue;
        const opacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
        if (!opacity) continue;
        const blend = layer.blend === 'multiply' ? 'multiply' : 'source-over';
        const strokes = layer.strokes || [];
        const hasImage = Boolean(layer.image && layer.image.file);
        // 有橡皮、带透明度或混合模式的层必须走离屏，否则橡皮会把背景也擦穿
        const hasEraser = strokes.some((s) => s.mode === 'eraser');
        if (opacity === 1 && blend === 'source-over' && !hasEraser) {
          if (hasImage) drawImageLayer(g, layer.image);
          for (const s of strokes) paintStroke(g, s);
          continue;
        }
        // 需要整层合成时先画到离屏，再按不透明度/混合模式贴回来
        const sctx = scratchOf(w, hgt).getContext('2d');
        sctx.save();
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.globalCompositeOperation = 'source-over';
        sctx.globalAlpha = 1;
        sctx.clearRect(0, 0, w, hgt);
        sctx.restore();
        if (hasImage) drawImageLayer(sctx, layer.image);
        for (const s of strokes) paintStroke(sctx, s);
        g.save();
        g.globalAlpha = opacity;
        g.globalCompositeOperation = blend;
        g.drawImage(scratchOf(w, hgt), 0, 0);
        g.restore();
      }
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.restore();
    }

    /** 造一块离屏画布。 */
    function surface(w, h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.min(4096, Math.round(w)));
      c.height = Math.max(1, Math.min(4096, Math.round(h)));
      return c;
    }

    /** 只留一层（模型要"只看线稿"时用）：强制可见、不透明、正常混合。 */
    function docOnlyLayer(doc, ref) {
      const list = layersOf(doc);
      if (!ref) return doc;
      const layer = list.find((l) => l.id === ref || l.name === ref);
      if (!layer) throw new Error(`没有这一层：${ref}`);
      return { ...doc, layers: [{ ...layer, visible: true, opacity: 1, blend: 'normal' }] };
    }

    /** 去掉所有图片层，只留笔迹（compare 时"你画的"一侧）。 */
    function docWithoutImages(doc) {
      return {
        ...doc,
        layers: layersOf(doc).map((l) => (l.image ? { ...l, image: null } : l)),
      };
    }

    /** 文档里第一张可见的图片层（参考图）。 */
    function refLayerOf(doc) {
      const list = layersOf(doc);
      return list.find((l) => l.image && l.image.file && l.visible !== false) || list.find((l) => l.image && l.image.file) || null;
    }

    /** 把某块区域裁出来并按 zoom 放大，返回 { dataUrl, width, height }。 */
    function cropCanvas(src, rect, zoom, background) {
      const sx = Math.max(0, Math.round(rect.x));
      const sy = Math.max(0, Math.round(rect.y));
      const sw = Math.max(1, Math.round(rect.w));
      const sh = Math.max(1, Math.round(rect.h));
      const z = Math.max(0.2, Math.min(8, Number(zoom) || 1));
      const out = surface(sw * z, sh * z);
      const g = out.getContext('2d');
      if (background) {
        g.fillStyle = background;
        g.fillRect(0, 0, out.width, out.height);
      }
      // 放大到 2 倍以上时关掉插值，让人看清像素块；缩小则保留平滑
      g.imageSmoothingEnabled = z < 2;
      g.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height, zoom: z };
    }

    function parseRectIn(rect, doc) {
      const src = Array.isArray(rect) ? { x: rect[0], y: rect[1], w: rect[2], h: rect[3] } : (rect || {});
      const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      const x = Math.max(0, Math.round(n(src.x, 0)));
      const y = Math.max(0, Math.round(n(src.y, 0)));
      const w = Math.max(1, Math.round(n(src.w, (doc.width || 1024) - x)));
      const h = Math.max(1, Math.round(n(src.h, (doc.height || 1024) - y)));
      return { x, y, w: Math.min(w, (doc.width || 1024) - x), h: Math.min(h, (doc.height || 1024) - y) };
    }

    function toHex(r, g, b) {
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }

    // ---- 纯算法：轮廓追踪 / 折线简化 / 主色聚类 ---------------------------------
    // 写成不碰 DOM 的纯函数，方便自测；跑起来仍然只在浏览器里。

    /** 把像素数据化成「墨迹掩码」：暗=墨，透明当空白。 */
    function inkMask(data, w, h, threshold) {
      const t = Number.isFinite(Number(threshold)) ? Number(threshold) : 0.45;
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          const a = data[i + 3] / 255;
          if (a < 0.12) continue;
          const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
          // 深色是墨；透明底上任何不透明像素都算墨
          const dark = 1 - lum;
          mask[y * w + x] = dark >= t || (a < 0.98 && data[i + 3] > 40) ? 1 : 0;
        }
      }
      return mask;
    }

    /** 3×3 盒子模糊两遍：让细线的两条边并成一条，追踪结果不会碎成双线。 */
    function blurMask(mask, w, h) {
      let src = mask;
      for (let pass = 0; pass < 2; pass += 1) {
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            let sum = 0;
            let n = 0;
            for (let dy = -1; dy <= 1; dy += 1) {
              const yy = y + dy;
              if (yy < 0 || yy >= h) continue;
              for (let dx = -1; dx <= 1; dx += 1) {
                const xx = x + dx;
                if (xx < 0 || xx >= w) continue;
                sum += src[yy * w + xx];
                n += 1;
              }
            }
            out[y * w + x] = sum / n >= 0.5 ? 1 : 0;
          }
        }
        src = out;
      }
      return src;
    }

    /** Ramer–Douglas–Peucker：把像素锯齿折线压成少量控制点。 */
    function rdp(points, tolerance) {
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

    /**
     * Marching squares 抽等值轮廓：返回一串折线（局部像素坐标）。
     * 输入是墨迹掩码，输出是「参考图的边界」，不是中心线——描出来就是原图的形。
     */
    function marchingSquares(mask, w, h) {
      const segs = [];
      const edgePoint = (key, x, y) => {
        // 每条边的中点用整数 key 记，拼接时不会因浮点误差错位
        if (key === 't') return [x * 2 + 1, y * 2];
        if (key === 'r') return [x * 2 + 2, y * 2 + 1];
        if (key === 'b') return [x * 2 + 1, y * 2 + 2];
        return [x * 2, y * 2 + 1];
      };
      const push = (a, b) => {
        segs.push([a, b]);
      };
      for (let y = 0; y < h - 1; y += 1) {
        for (let x = 0; x < w - 1; x += 1) {
          const v0 = mask[y * w + x];
          const v1 = mask[y * w + x + 1];
          const v2 = mask[(y + 1) * w + x + 1];
          const v3 = mask[(y + 1) * w + x];
          const code = (v0 << 3) | (v1 << 2) | (v2 << 1) | v3;
          if (code === 0 || code === 15) continue;
          const T = edgePoint('t', x, y);
          const R = edgePoint('r', x, y);
          const B = edgePoint('b', x, y);
          const L = edgePoint('l', x, y);
          switch (code) {
            case 1: case 14: push(L, B); break;
            case 2: case 13: push(B, R); break;
            case 3: case 12: push(L, R); break;
            case 4: case 11: push(T, R); break;
            case 6: case 9: push(T, B); break;
            case 7: case 8: push(L, T); break;
            // 5 / 10 是鞍点，两条都要出
            case 5: push(L, T); push(B, R); break;
            case 10: push(T, R); push(L, B); break;
            default: break;
          }
        }
      }
      return segs;
    }

    /** 把线段拼成折线：端点 key 相同的接起来，闭合的就首尾相连。 */
    function stitchSegments(segs) {
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
        // 往后接
        for (;;) {
          const tailKey = keyOf(line[line.length - 1]);
          const next = (byKey.get(tailKey) || []).find((j) => !used.has(j));
          if (next === undefined) break;
          used.add(next);
          const seg = segs[next];
          const p = keyOf(seg[0]) === tailKey ? seg[1] : seg[0];
          line.push(p);
          if (keyOf(p) === keyOf(line[0])) break; // 闭环
        }
        // 往前接（开路径的情况）
        for (;;) {
          const headKey = keyOf(line[0]);
          const prev = (byKey.get(headKey) || []).find((j) => !used.has(j));
          if (prev === undefined) break;
          used.add(prev);
          const seg = segs[prev];
          const p = keyOf(seg[0]) === headKey ? seg[1] : seg[0];
          line.unshift(p);
        }
        lines.push(line);
      }
      return lines;
    }

    /** 点在多边形内（射线法）：判断轮廓嵌套用。 */
    function pointInPolygon(x, y, pts) {
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

    /** 骨架线在每点处的墨宽：沿法线往两边数连续墨点，取中位数当作这根线的笔宽。 */
    function pathWidth(mask, w, h, path) {
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
        // 法线方向
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
      if (values.length === 0) return 0;
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    }

    /** 一批线的墨宽（和 paths 一一对应），用来按原线宽落笔。 */
    function pathWidths(mask, w, h, paths) {
      return paths.map((p) => pathWidth(mask, w, h, p));
    }

    /** 多边形面积（鞋带公式），用来判断这个闭合轮廓够不够大、值不值得填。 */
    function polygonArea(pts) {
      let sum = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        sum += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(sum) / 2;
    }

    /**
     * 按闭合轮廓取内部主色，映射到 palette 里最接近的一档 —— 就是「按区域填色」。
     * 返回 [{ points, color, area }]，points 已换算到画布坐标。
     */
    function regionFills(refCanvas, rect, traced, palette, opts = {}) {
      const minFill = Math.max(20, Number(opts.minFill) || 320);
      const maxFills = Math.max(1, Number(opts.maxFills) || 60);
      const cands = traced.paths
        .map((p, i) => ({ pts: p, closed: Boolean(traced.closed && traced.closed[i]), area: polygonArea(p) }))
        .filter((c) => c.closed && c.area >= minFill)
        .sort((a, b) => b.area - a.area);
      // 轮廓嵌套：大的在外，小的在内；偶数层要填，奇数层是洞（眼睛高光之类）
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
        while (p !== -1 && d < 8) {
          d += 1;
          p = parents[p];
        }
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
        const w = Math.max(1, Math.ceil(x1 - x0));
        const h = Math.max(1, Math.ceil(y1 - y0));
        // 铺满整块的那条轮廓多半是背景，跳过
        if (w * h > rect.w * rect.h * 0.82) continue;
        // 遮罩：把多边形填实
        const maskCan = surface(w, h);
        const mg = maskCan.getContext('2d');
        mg.fillStyle = '#000';
        mg.beginPath();
        mg.moveTo(cand.pts[0][0] - x0, cand.pts[0][1] - y0);
        for (let i = 1; i < cand.pts.length; i += 1) mg.lineTo(cand.pts[i][0] - x0, cand.pts[i][1] - y0);
        mg.closePath();
        for (const hole of holes) {
          mg.moveTo(hole.pts[0][0] - x0, hole.pts[0][1] - y0);
          for (let i = 1; i < hole.pts.length; i += 1) mg.lineTo(hole.pts[i][0] - x0, hole.pts[i][1] - y0);
          mg.closePath();
        }
        mg.fill('evenodd');
        // 参考图这块 + 用遮罩抠出来
        const colCan = surface(w, h);
        const cg = colCan.getContext('2d');
        cg.drawImage(refCanvas, rect.x + x0, rect.y + y0, w, h, 0, 0, w, h);
        cg.globalCompositeOperation = 'destination-in';
        cg.drawImage(maskCan, 0, 0);
        const data = cg.getImageData(0, 0, w, h).data;
        // 内部主色（5 位量化取最高档的均值）
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4 * 3) {
          if (data[i + 3] < 32) continue;
          const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
          const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
          cur.r += data[i];
          cur.g += data[i + 1];
          cur.b += data[i + 2];
          cur.n += 1;
          buckets.set(key, cur);
        }
        if (buckets.size === 0) continue;
        const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
        const rgb = [top.r / top.n, top.g / top.n, top.b / top.n];
        let best = palette[0];
        let bestD = Infinity;
        for (const c of palette) {
          const d = (c.rgb[0] - rgb[0]) ** 2 + (c.rgb[1] - rgb[1]) ** 2 + (c.rgb[2] - rgb[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        fills.push({
          points: cand.pts.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]),
          holes: holes.map((h) => h.pts.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])])),
          color: best ? best.hex : toHex(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])),
          area: Math.round(cand.area),
        });
      }
      return fills;
    }

    /** Zhang-Suen 细化：把线压成 1px 骨架，用于「中心线」描线。 */
    function thinning(mask, w, h) {
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

    /** 骨架 → 折线：从端点走一遍，剩下的环再走一遍。 */
    function skeletonPaths(skel, w, h) {
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

    /** 三次贝塞尔在 t 处的点。 */
    function bezierPoint(seg, t) {
      const p0 = seg[0];
      const c1 = seg[1];
      const c2 = seg[2];
      const p1 = seg[3];
      const mt = 1 - t;
      const b0 = mt * mt * mt;
      const b1 = 3 * t * mt * mt;
      const b2 = 3 * t * t * mt;
      const b3 = t * t * t;
      return [
        p0[0] * b0 + c1[0] * b1 + c2[0] * b2 + p1[0] * b3,
        p0[1] * b0 + c1[1] * b1 + c2[1] * b2 + p1[1] * b3,
      ];
    }

    /**
     * 三次贝塞尔拟合（Schneider 的自动拟合思路）：把一串点拟成尽量少的曲线段。
     * 比磨圆更根本——长弧能一条曲线走完，不再靠大量短线段凑。
     * 返回 [[p0, c1, c2, p1], …]。
     */
    function fitBezier(points, tolerance) {
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
        // 弦长参数化
        const u = [0];
        for (let i = 1; i <= last; i += 1) {
          u.push(u[i - 1] + (Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1e-4));
        }
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
        let a1;
        let a2;
        if (Math.abs(det) > 1e-9) {
          a1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det;
          a2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det;
        } else {
          a1 = 0;
          a2 = 0;
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
        // 取每段的采样误差，找最离谱的那点当切分位置
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

    /** 把拟合出的曲线段采样回点串（落笔还是用点，笔刷引擎才吃得到压感）。 */
    function bezierSample(segs, step, cap) {
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

    /**
     * 参考图 → 折线：掩码 → 模糊 → 轮廓 → 简化 → 过滤碎片。
     * 输出坐标是这块区域内的像素坐标（半像素精度），调用方自己加偏移。
     */
    function traceInk(imageData, w, h, opts = {}) {
      const center = opts.mode === 'center';
      const tolerance = Math.max(0.5, Number(opts.tolerance) || (center ? 1.2 : 2.5));
      const minLength = Math.max(2, Number(opts.minLength) || 12);
      const maxLines = Math.max(1, Number(opts.maxLines) || 80);
      const maxPointsPerLine = Math.max(6, Number(opts.maxPointsPerLine) || 160);
      const smoothIters = Math.max(0, Math.min(3, opts.smooth === undefined ? 1 : Number(opts.smooth) || 0));
      const wantFit = opts.fit === true;
      const fitStep = Math.max(1.5, Number(opts.fitStep) || 3);
      const tolFit = Math.max(0.3, Number(opts.fitTolerance) || tolerance * 0.9);
      let lines;
      if (center) {
        // 中心线：先细化成 1px 骨架，再从端点走线
        const skel = thinning(inkMask(imageData, w, h, opts.threshold), w, h);
        lines = skeletonPaths(skel, w, h).map((pts) => pts.map((p) => [p[0] * 2, p[1] * 2]));
      } else {
        lines = stitchSegments(marchingSquares(blurMask(inkMask(imageData, w, h, opts.threshold), w, h), w, h));
      }
      const out = [];
      const closedFlags = [];
      let dropped = 0;
      for (const raw of lines) {
        const pts = raw.map((p) => [p[0] / 2, p[1] / 2]);
        // 闭合环去掉重复的末点（draw 会自己收尾）
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
        // 贝塞尔拟合优先：长弧一条曲线走完，比磨圆更「像手画的」
        if (wantFit && simplified.length >= 3) {
          const segsFit = fitBezier(simplified, tolFit);
          const sampled = bezierSample(segsFit, fitStep, maxPointsPerLine * 2);
          if (sampled.length >= 2) simplified = sampled;
        } else if (smoothIters > 0) {
          // 磨圆一遍再收紧：像素阶梯走出来的折角会被抹掉，线看起来才是「画」出来的
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
      return { paths: out, closed: closedFlags, mode: center ? 'center' : 'edge', lines: out.length, points, dropped, tolerance, smooth: smoothIters, fit: wantFit, threshold: opts.threshold === undefined ? 0.45 : Number(opts.threshold) };
    }

    /** 主色聚类：真 k-means（初值取量化后占比最高的几档，10 轮迭代）。 */
    function kmeansColors(data, k, stepPx = 2) {
      const samples = [];
      for (let i = 0; i < data.length; i += 4 * stepPx) {
        if (data[i + 3] < 16) continue;
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
      if (samples.length === 0) throw new Error('这块区域里没有不透明的像素');
      const kk = Math.max(2, Math.min(8, Math.round(k)));
      // 初值：先按 5 位量化统计，取占比最高的 kk 档的均值
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
      let centers = [...buckets.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, kk)
        .map((v) => [v.r / v.n, v.g / v.n, v.b / v.n]);
      while (centers.length < kk) centers.push([255, 255, 255]);
      for (let iter = 0; iter < 10; iter += 1) {
        const sums = centers.map(() => [0, 0, 0, 0]);
        for (const s of samples) {
          let best = 0;
          let bestD = Infinity;
          for (let c = 0; c < centers.length; c += 1) {
            const dr = s[0] - centers[c][0];
            const dg = s[1] - centers[c][1];
            const db = s[2] - centers[c][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) {
              bestD = d;
              best = c;
            }
          }
          const acc = sums[best];
          acc[0] += s[0];
          acc[1] += s[1];
          acc[2] += s[2];
          acc[3] += 1;
        }
        centers = sums.map((acc, i) => (acc[3] ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] : centers[i]));
      }
      // 用最终中心再数一遍归属，算占比
      const counts = centers.map(() => 0);
      for (const s of samples) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < centers.length; c += 1) {
          const dr = s[0] - centers[c][0];
          const dg = s[1] - centers[c][1];
          const db = s[2] - centers[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        counts[best] += 1;
      }
      return centers
        .map((c, i) => ({
          hex: toHex(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])),
          rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])],
          ratio: Number(((counts[i] / samples.length) * 100).toFixed(1)),
          pixels: counts[i],
        }))
        .filter((c) => c.pixels > 0)
        .sort((a, b) => b.ratio - a.ratio);
    }

    /**
     * 宿主塞过来的像素任务：全部在这里用 <canvas> 算完再回传。
     * 宿主只搬运结果，不引任何图像解码依赖。
     */
    function runPixelTask(job, doc) {
      if (!doc) return { ok: false, error: '文档还没加载' };
      const kind = job.kind;
      const params = job.params || {};

      if (kind === 'crop' || kind === 'ref') {
        const rect = parseRectIn(params.rect, doc);
        const zoom = params.zoom === undefined ? 1 : Number(params.zoom);
        let src = null;
        let background = null;
        if (kind === 'crop') {
          const target = params.layer ? docOnlyLayer(doc, params.layer) : doc;
          src = surface(doc.width, doc.height);
          renderDoc(src, target, { withBackground: true });
          background = null;
        } else {
          const layer = params.layer
            ? layersOf(doc).find((l) => l.image && (l.id === params.layer || l.name === params.layer))
            : refLayerOf(doc);
          if (!layer) throw new Error('画布上没有可用的参考图');
          src = surface(doc.width, doc.height);
          const g = src.getContext('2d');
          g.clearRect(0, 0, src.width, src.height);
          drawImageLayer(g, layer.image);
        }
        const out = cropCanvas(src, rect, zoom, background);
        return { ok: true, dataUrl: out.dataUrl, width: out.width, height: out.height, zoom: out.zoom, rect, layer: params.layer || null };
      }

      if (kind === 'pick') {
        const x = Math.round(Number(params.x));
        const y = Math.round(Number(params.y));
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error('pick 的坐标非法');
        const onCanvas = params.on === 'canvas';
        const srcDoc = onCanvas ? doc : (params.layer ? docOnlyLayer(doc, params.layer) : doc);
        const c = surface(doc.width, doc.height);
        renderDoc(c, srcDoc, { withBackground: onCanvas });
        const px = c.getContext('2d').getImageData(x, y, 1, 1).data;
        const alpha = Number((px[3] / 255).toFixed(3));
        return {
          ok: true,
          x,
          y,
          on: onCanvas ? 'canvas' : 'ref',
          hex: toHex(px[0], px[1], px[2]),
          rgb: [px[0], px[1], px[2]],
          alpha,
          ink: alpha > 0.15,
        };
      }

      if (kind === 'compare') {
        const layer = params.layer
          ? layersOf(doc).find((l) => l.image && (l.id === params.layer || l.name === params.layer))
          : refLayerOf(doc);
        if (!layer) throw new Error('画布上没有可用的参考图：先 import 一张');
        const W = doc.width || 1024;
        const H = doc.height || 1024;
        const rect = parseRectIn(params.rect, doc);

        const ref = surface(W, H);
        const rg = ref.getContext('2d');
        rg.clearRect(0, 0, W, H);
        drawImageLayer(rg, layer.image);

        const drawn = surface(W, H);
        renderDoc(drawn, docWithoutImages(doc), { withBackground: false });

        const rd = rg.getImageData(rect.x, rect.y, rect.w, rect.h).data;
        const dd = drawn.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h).data;
        const diff = surface(rect.w, rect.h);
        const dg = diff.getContext('2d');
        const diffData = dg.createImageData(rect.w, rect.h);
        const out = diffData.data;

        let refInk = 0;
        let drawInk = 0;
        let covered = 0;
        let extra = 0;
        let sumDiff = 0;
        let missedMinX = Infinity;
        let missedMinY = Infinity;
        let missedMaxX = -Infinity;
        let missedMaxY = -Infinity;
        // 32×32 的网格，用来告诉模型「哪一格还没画到」
        const GRID = 32;
        const cells = new Map();

        for (let i = 0, p = 0; i < rd.length; i += 4, p += 1) {
          const ra = rd[i + 3];
          const da = dd[i + 3];
          const isRef = ra > 12;
          const isDraw = da > 12;
          const px = rect.x + (p % rect.w);
          const py = rect.y + Math.floor(p / rect.w);
          const o = i;
          if (isRef) refInk += 1;
          if (isDraw) drawInk += 1;
          if (isRef && isDraw) {
            covered += 1;
            sumDiff += (Math.abs(rd[i] - dd[i]) + Math.abs(rd[i + 1] - dd[i + 1]) + Math.abs(rd[i + 2] - dd[i + 2])) / 3;
            // 两边都有：按平均色显示成暗灰，方便看出形变
            out[o] = Math.round((rd[i] + dd[i]) / 2);
            out[o + 1] = Math.round((rd[i + 1] + dd[i + 1]) / 2);
            out[o + 2] = Math.round((rd[i + 2] + dd[i + 2]) / 2);
            out[o + 3] = 140;
          } else if (isRef) {
            // 参考有、你没画 = 品红（漏画）
            out[o] = 255;
            out[o + 1] = 0;
            out[o + 2] = 255;
            out[o + 3] = 235;
            if (px < missedMinX) missedMinX = px;
            if (py < missedMinY) missedMinY = py;
            if (px > missedMaxX) missedMaxX = px;
            if (py > missedMaxY) missedMaxY = py;
            const key = `${Math.floor(((px - rect.x) / rect.w) * GRID)},${Math.floor(((py - rect.y) / rect.h) * GRID)}`;
            const cell = cells.get(key) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
            cell.n += 1;
            if (px < cell.x0) cell.x0 = px;
            if (py < cell.y0) cell.y0 = py;
            if (px > cell.x1) cell.x1 = px;
            if (py > cell.y1) cell.y1 = py;
            cells.set(key, cell);
          } else if (isDraw) {
            // 你画了、参考没有 = 青（多画）
            out[o] = 0;
            out[o + 1] = 210;
            out[o + 2] = 255;
            out[o + 3] = 200;
            extra += 1;
          }
        }
        dg.putImageData(diffData, 0, 0);

        const gaps = [...cells.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((c) => ({
          x: Math.round(c.x0),
          y: Math.round(c.y0),
          w: Math.round(c.x1 - c.x0) + 1,
          h: Math.round(c.y1 - c.y0) + 1,
          missed: c.n,
        }));

        const metrics = {
          rect,
          refInkPixels: refInk,
          drawnInkPixels: drawInk,
          coveredPixels: covered,
          extraPixels: extra,
          // 参考图的笔画里，有多少被你盖住了
          coveragePct: refInk ? Number(((covered / refInk) * 100).toFixed(1)) : 100,
          // 你画的东西里，有多少是参考图里没有的
          extraPct: drawInk ? Number(((extra / drawInk) * 100).toFixed(1)) : 0,
          meanColorDiff: covered ? Number((sumDiff / covered).toFixed(1)) : null,
          missedBounds: Number.isFinite(missedMinX)
            ? { x: Math.round(missedMinX), y: Math.round(missedMinY), w: Math.round(missedMaxX - missedMinX) + 1, h: Math.round(missedMaxY - missedMinY) + 1 }
            : null,
          topGaps: gaps,
        };
        return { ok: true, dataUrl: diff.toDataURL('image/png'), rect, metrics };
      }

      if (kind === 'fill') {
        const W = doc.width || 1024;
        const H = doc.height || 1024;
        const rect = parseRectIn(params.rect || {}, doc);
        const sx = Math.round(Number(params.x));
        const sy = Math.round(Number(params.y));
        if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sy < 0 || sx >= W || sy >= H) {
          throw new Error('fill 的种子点超出画布');
        }
        // 边界只认笔迹（不含已填的色块），不然第二次填色会被自己的色块挡住
        const barrierDoc = {
          ...docWithoutImages(doc),
          layers: layersOf(doc).map((l) => ({
            ...l,
            image: null,
            strokes: (l.strokes || []).filter((s) => s.mode !== 'fill'),
          })),
        };
        const lineCan = surface(W, H);
        renderDoc(lineCan, barrierDoc, { withBackground: false });
        const lineData = lineCan.getContext('2d').getImageData(0, 0, W, H).data;
        const barrier = new Uint8Array(W * H);
        for (let i = 0, p = 0; i < lineData.length; i += 4, p += 1) {
          if (lineData[i + 3] > 24) barrier[p] = 1;
        }
        const seed = sy * W + sx;
        if (barrier[seed]) throw new Error('种子点落在线上：给一个区域内部的点（配合 pick 找空白）');
        // 泛洪：四连通，限定在 rect 内
        const region = new Uint8Array(W * H);
        const stack = new Int32Array(W * H);
        let top = 0;
        stack[top] = seed;
        top += 1;
        region[seed] = 1;
        let area = 0;
        const inRect = (x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
        while (top > 0) {
          top -= 1;
          const p = stack[top];
          area += 1;
          if (area > W * H * 0.62) throw new Error('这块没被线围住（填下去会把整片背景都涂了）：先有线稿，或给 rect 缩小范围');
          const x = p % W;
          const y = (p - x) / W;
          const cand = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
          for (const [nx, ny] of cand) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (!inRect(nx, ny)) continue;
            const q = ny * W + nx;
            if (region[q] || barrier[q]) continue;
            region[q] = 1;
            if (top >= stack.length) break;
            stack[top] = q;
            top += 1;
          }
        }
        // 区域边界 → 多边形
        const segs = marchingSquares(region, W, H);
        // 轮廓嵌套：偶数层是区域（要涂），奇数层是洞（evenodd 挖掉）
        const loops = stitchSegments(segs)
          .map((raw) => ({ pts: rdp(raw.map((p) => [p[0] / 2, p[1] / 2]), 1.5) }))
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
          const holes = loops
            .filter((_, j) => parents[j] === i)
            .slice(0, 10)
            .map((h) => h.pts.map((p) => [Math.round(p[0]), Math.round(p[1])]));
          polys.push({
            points: loops[i].pts.map((p) => [Math.round(p[0]), Math.round(p[1])]),
            holes,
            area: Math.round(loops[i].area),
          });
          if (polys.length >= 12) break;
        }
        // 颜色：给了就用；否则取参考图该点颜色，映射到参考图主色里最接近的一档
        let color = params.color || null;
        if (!color) {
          const ref = refLayerOf(doc);
          if (ref) {
            const refCan = surface(W, H);
            const rg = refCan.getContext('2d');
            rg.clearRect(0, 0, W, H);
            drawImageLayer(rg, ref.image);
            const refData = rg.getImageData(0, 0, W, H).data;
            const sxp = refData[seed * 4 + 3] > 16
              ? [refData[seed * 4], refData[seed * 4 + 1], refData[seed * 4 + 2]]
              : [255, 255, 255];
            let palette = [];
            try {
              palette = kmeansColors(refData, 6, 8);
            } catch {
              palette = [];
            }
            let best = null;
            let bestD = Infinity;
            for (const c of palette) {
              const d = (c.rgb[0] - sxp[0]) ** 2 + (c.rgb[1] - sxp[1]) ** 2 + (c.rgb[2] - sxp[2]) ** 2;
              if (d < bestD) {
                bestD = d;
                best = c;
              }
            }
            color = best ? best.hex : toHex(sxp[0], sxp[1], sxp[2]);
          } else {
            const comp = surface(W, H);
            renderDoc(comp, doc, { withBackground: true });
            const px = comp.getContext('2d').getImageData(sx, sy, 1, 1).data;
            color = toHex(px[0], px[1], px[2]);
          }
        }
        return {
          ok: true,
          seed: [sx, sy],
          area,
          color,
          polygons: polys,
        };
      }

      if (kind === 'copy') {
        const layer = params.layer
          ? layersOf(doc).find((l) => l.image && (l.id === params.layer || l.name === params.layer))
          : refLayerOf(doc);
        if (!layer) throw new Error('画布上没有可用的参考图：先 import 一张');
        const W = doc.width || 1024;
        const H = doc.height || 1024;
        const c = surface(W, H);
        const g = c.getContext('2d');
        g.clearRect(0, 0, W, H);
        drawImageLayer(g, layer.image);
        const rect = parseRectIn(params.rect, doc);
        const img = g.getImageData(rect.x, rect.y, rect.w, rect.h);
        // 线稿墨迹占比低 → 中心线更贴原线宽；照片/色块占比高 → 沿边界
        let mode = params.mode === 'center' || params.mode === 'edge' ? params.mode : 'auto';
        let inkRatio = null;
        let mask = null;
        if (mode === 'auto') {
          mask = inkMask(img.data, rect.w, rect.h, params.threshold);
          let inkPx = 0;
          for (let i = 0; i < mask.length; i += 1) inkPx += mask[i];
          inkRatio = inkPx / (rect.w * rect.h);
          mode = inkRatio < 0.13 ? 'center' : 'edge';
        }
        const traced = traceInk(img.data, rect.w, rect.h, {
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
        const palette = kmeansColors(img.data, Math.max(2, Math.min(8, Number(params.colors) || 6)), 3);
        const wantFill = params.style === 'flat' || params.style === 'anime';
        const fills = wantFill
          ? regionFills(c, rect, traced, palette, { minFill: params.minFill, maxFills: params.maxFills || 40 })
          : [];
        const paths = traced.paths.map((line) => line.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]));
        // 每根线的墨宽：中心线模式下量出来就是原线宽，宿主照这个 size 落笔
        if (!mask) mask = inkMask(img.data, rect.w, rect.h, params.threshold);
        const widths = pathWidths(mask, rect.w, rect.h, traced.paths);
        const lineWidth = widths.length ? Number((widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(2)) : null;
        return {
          ok: true,
          rect,
          paths,
          widths,
          lineWidth,
          closed: traced.closed,
          fills,
          palette,
          mode,
          smooth: traced.smooth,
          fit: traced.fit,
          inkRatio: inkRatio === null ? null : Number(inkRatio.toFixed(3)),
          lines: traced.lines,
          points: traced.points,
          dropped: traced.dropped,
          tolerance: traced.tolerance,
          threshold: traced.threshold,
        };
      }

      if (kind === 'trace') {
        const layer = params.layer
          ? layersOf(doc).find((l) => l.image && (l.id === params.layer || l.name === params.layer))
          : refLayerOf(doc);
        if (!layer) throw new Error('画布上没有可用的参考图：先 import 一张');
        const W = doc.width || 1024;
        const H = doc.height || 1024;
        const c = surface(W, H);
        const g = c.getContext('2d');
        g.clearRect(0, 0, W, H);
        drawImageLayer(g, layer.image);
        const rect = parseRectIn(params.rect, doc);
        const img = g.getImageData(rect.x, rect.y, rect.w, rect.h);
        const t = traceInk(img.data, rect.w, rect.h, {
          mode: params.mode === 'center' ? 'center' : 'edge',
          smooth: params.smooth,
          fit: params.fit === true,
          fitStep: params.fitStep,
          threshold: params.threshold,
          tolerance: params.tolerance,
          minLength: params.minLength,
          maxLines: params.maxLines,
        });
        // 区域内的坐标 → 画布坐标，模型可以直接喂 draw
        const paths = t.paths.map((line) => line.map((p) => [Math.round(rect.x + p[0]), Math.round(rect.y + p[1])]));
        return { ok: true, rect, paths, lines: t.lines, points: t.points, dropped: t.dropped, tolerance: t.tolerance, smooth: t.smooth, fit: t.fit, threshold: t.threshold };
      }

      if (kind === 'palette') {
        const layer = params.layer
          ? layersOf(doc).find((l) => l.image && (l.id === params.layer || l.name === params.layer))
          : refLayerOf(doc);
        if (!layer) throw new Error('画布上没有可用的参考图');
        const W = doc.width || 1024;
        const H = doc.height || 1024;
        const c = surface(W, H);
        const g = c.getContext('2d');
        g.clearRect(0, 0, W, H);
        drawImageLayer(g, layer.image);
        const rect = parseRectIn(params.rect, doc);
        const data = g.getImageData(rect.x, rect.y, rect.w, rect.h).data;
        const k = Math.max(2, Math.min(8, Math.round(Number(params.k) || 6)));
        // 真 k-means（初值取占比最高的几档，10 轮迭代），比纯量化更能抓住渐变
        const colors = kmeansColors(data, k);
        const sampled = colors.reduce((n, c) => n + c.pixels, 0);
        return { ok: true, colors, sampled, rect, method: 'kmeans' };
      }

      throw new Error(`未知像素任务：${kind}`);
    }

    /** 文档里所有笔迹按全局顺序拍平，回放和计数都用它。 */
    function flattenStrokes(doc) {
      const out = [];
      for (const layer of layersOf(doc)) {
        for (const s of layer.strokes || []) out.push({ layerId: layer.id, stroke: s });
      }
      out.sort((a, b) => (a.stroke.seq || 0) - (b.stroke.seq || 0));
      return out;
    }

    /** 前 n 笔的文档快照，用于回放逐帧渲染。 */
    function docAtStep(doc, entries, n) {
      const counts = new Map();
      for (let i = 0; i < n && i < entries.length; i += 1) {
        const id = entries[i].layerId;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      return {
        ...doc,
        layers: layersOf(doc).map((layer) => ({
          ...layer,
          strokes: (layer.strokes || []).slice(0, counts.get(layer.id) || 0),
        })),
      };
    }

    /** 形状工具：把起止点变成一条笔迹（矩形/椭圆用折线多点闭合）。 */
    function shapePoints(tool, a, b) {
      const p = (x, y, pr = 0.9) => [Math.round(x), Math.round(y), pr];
      if (tool === 'line') return [p(a[0], a[1]), p(b[0], b[1])];
      if (tool === 'rect') {
        const x1 = Math.min(a[0], b[0]);
        const y1 = Math.min(a[1], b[1]);
        const x2 = Math.max(a[0], b[0]);
        const y2 = Math.max(a[1], b[1]);
        return [p(x1, y1), p(x2, y1), p(x2, y2), p(x1, y2), p(x1, y1)];
      }
      // 椭圆：中心取两点中点，半轴取差
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2;
      const ry = Math.abs(b[1] - a[1]) / 2;
      const pts = [];
      const steps = 28;
      for (let i = 0; i <= steps; i += 1) {
        const ang = (Math.PI * 2 * i) / steps;
        pts.push(p(cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)));
      }
      return pts;
    }

    async function fetchDoc() {
      const r = await fetch(`${API}/doc`, { cache: 'no-store' });
      return r.json();
    }

    /** 把 File 读成 dataURL：导入图片、新建画布都走这条，不依赖本地路径。 */
    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => reject(new Error('read failed'));
        fr.readAsDataURL(file);
      });
    }

    /** 弹窗卡片：盖住整个界面居中显示，点多选项时用它，比在窄列里挤一排按钮好认。 */
    function Sheet(props) {
      const t = props.t || ((k) => k);
      if (!props.open) return null;
      return h('div', {
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--dsw-alias-bg-mask-2, rgba(0,0,0,0.38))',
        },
        onClick: (e) => {
          if (e.target === e.currentTarget) props.onClose();
        },
      },
        h('div', {
          style: {
            width: props.width || 460,
            maxWidth: '92vw',
            maxHeight: '80vh',
            overflowY: 'auto',
            background: 'var(--dsw-alias-bg-layer-1, #fff)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
            borderRadius: 14,
            boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
            padding: '14px 16px 18px',
            boxSizing: 'border-box',
            font: '13px/1.55 system-ui, "Microsoft YaHei", sans-serif',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
            h('span', { style: { fontWeight: 700, fontSize: 14 } }, props.title),
            h('button', {
              type: 'button',
              style: {
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-tertiary, inherit)',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                padding: '0 2px',
              },
              onClick: props.onClose,
            }, '×'),
          ),
          props.children,
        ),
      );
    }

    /**
     * 笔刷预览：用这支笔画一条样笔（带压感变化），一眼就能看出颗粒、湿边、飞白的差别。
     * 灰阶固定色，不跟着当前颜色走，免得看半天认不出笔刷本身。
     */
    function BrushPreview(props) {
      const ref = React.useRef(null);
      React.useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const w = 96;
        const hgt = 24;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hgt * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, hgt);
        const pts = [];
        for (let i = 0; i <= 26; i += 1) {
          const f = i / 26;
          pts.push([
            7 + f * (w - 14),
            hgt / 2 + Math.sin(f * Math.PI * 1.7) * 4.5,
            0.15 + 0.85 * Math.sin(f * Math.PI),
          ]);
        }
        paintStroke(ctx, {
          id: `preview-${props.id}`,
          color: '#8a8a8a',
          size: 7,
          brush: props.id,
          taper: true,
          minSize: 0.25,
          opacity: 1,
          points: pts,
        });
      }, [props.id]);
      return h('canvas', {
        ref,
        style: { width: 96, height: 24, display: 'block', maxWidth: '100%' },
      });
    }

    /**
     * 图层缩略图：把那一层的笔迹按比例缩到 30px 里。
     * 只在「笔迹数/图片签名」变化时重画（笔迹只增不减，够用了），不然每帧整层重绘太贵。
     */
    function LayerThumb(props) {
      const ref = React.useRef(null);
      const last = React.useRef('');
      React.useEffect(() => {
        const canvas = ref.current;
        const doc = props.docRef && props.docRef.current;
        if (!canvas || !doc) return;
        // 矢量层：签名（笔迹数）没变就不重画，免得每来一笔都把每一层重绘一遍
        if (props.sig === last.current && !String(props.sig).includes('img')) return;
        last.current = props.sig;
        const size = 30;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        const layer = layersOf(doc).find((l) => l.id === props.layerId);
        if (!layer) return;
        const w = doc.width || 1024;
        const hgt = doc.height || 1024;
        const s = Math.min(size / w, size / hgt);
        ctx.save();
        ctx.translate((size - w * s) / 2, (size - hgt * s) / 2);
        ctx.scale(s, s);
        if (layer.image && layer.image.file) drawImageLayer(ctx, layer.image);
        for (const stroke of layer.strokes || []) paintStroke(ctx, stroke);
        ctx.restore();
      }, [props.sig, props.layerId, props.docRef, props.rev]);
      return h('canvas', {
        ref,
        style: {
          width: 30,
          height: 30,
          flex: '0 0 30px',
          display: 'block',
          borderRadius: 4,
          background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.16))',
          outline: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
        },
      });
    }

    function CanvasPanel(props) {
      const t = props.t || ((k) => k);
      const canvasRef = React.useRef(null);
      const docRef = React.useRef(null);
      const revRef = React.useRef(0);
      const dragRef = React.useRef(null);
      const replayRef = React.useRef(null);
      const [revision, setRevision] = React.useState(0);
      const [error, setError] = React.useState(null);
      const [color, setColor] = React.useState('#111111');
      const [size, setSize] = React.useState(10);
      const [tool, setTool] = React.useState('brush');
      const [brush, setBrush] = React.useState('round');
      const [taper, setTaper] = React.useState(true);
      const [staleHost, setStaleHost] = React.useState(false);
      const [layerDock, setLayerDock] = React.useState(true);
      // 图层不透明度拖动时先用本地值显示，等宿主回包（700ms 轮询）再对齐，不然滑块会跳
      const [optOpacity, setOptOpacity] = React.useState(null);
      const [playing, setPlaying] = React.useState(false);
      /** 宿主查到的版本信息：有新版本时在标题旁边挂一枚提示。 */
      const [updateInfo, setUpdateInfo] = React.useState(null);
      const [meta, setMeta] = React.useState({ strokes: 0, redo: 0, layers: [], activeLayer: null, background: '#ffffff', width: 1024, height: 1024 });
      const viewportRef = React.useRef(null);
      const viewRef = React.useRef({ scale: 1, x: 0, y: 0 });
      const panRef = React.useRef(null);
      const spaceRef = React.useRef(false);
      const userViewRef = React.useRef(false);
      const fitDimsRef = React.useRef(null);
      const [view, setViewState] = React.useState({ scale: 1, x: 0, y: 0 });
      const [spaceHeld, setSpaceHeld] = React.useState(false);
      /** 整页模式里的弹窗卡片：tools / layers / canvas，null 表示都关着。 */
      const [sheet, setSheet] = React.useState(null);
      /** 导入图片：选完文件直接读成 dataURL 交给宿主，不依赖任何文件对话框 API。 */
      const [importNote, setImportNote] = React.useState(null);
      const importRef = React.useRef(null);
      /** 新建绘画：先问要不要存当前这幅，再选空白/图片。 */
      const [pendingSave, setPendingSave] = React.useState(false);
      const [newNote, setNewNote] = React.useState(null);
      const newImportRef = React.useRef(null);

      // 顶栏「新建」按钮通过桥直接开这里的弹窗
      React.useEffect(() => {
        const b = props.bridge;
        if (!b) return undefined;
        b.current.newPaint = () => {
          setPendingSave(false);
          setNewNote(null);
          setSheet('newSave');
        };
        return () => {
          b.current.newPaint = null;
        };
      }, [props.bridge]);

      // 只在打开画界的这个会话里把 paint_canvas 接上（宿主按会话绑定），
      // 免得别的会话（比如正在写代码的那个）被画布协议带偏。
      React.useEffect(() => {
        const sessionId = props.sessionId;
        if (!sessionId) return undefined;
        const attachBody = JSON.stringify({ sessionId, variant: props.variant || 'tab' });
        fetch(`${API}/attach`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: attachBody,
        }).catch(() => {});
        return () => {
          // 宿主侧有 15 秒宽限，切标签时的卸载不会真的解绑
          fetch(`${API}/detach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          }).catch(() => {});
        };
      }, [props.sessionId, props.variant]);

      const setView = React.useCallback((next) => {
        viewRef.current = next;
        setViewState(next);
      }, []);

      const readMeta = React.useCallback((doc) => {
        const layers = (doc.layers || []).map((l) => ({
          id: l.id,
          name: l.name,
          visible: l.visible !== false,
          opacity: l.opacity === undefined ? 1 : l.opacity,
          blend: l.blend || 'normal',
          count: (l.strokes || []).length,
          image: Boolean(l.image && l.image.file),
        }));
        setMeta({
          strokes: layers.reduce((n, l) => n + l.count, 0),
          redo: (doc.redo || []).length,
          layers,
          activeLayer: doc.activeLayer,
          background: doc.background || '#ffffff',
          width: doc.width || 1024,
          height: doc.height || 1024,
        });
      }, []);

      const uploadPreview = React.useCallback(() => {
        const canvas = canvasRef.current;
        const doc = docRef.current;
        if (!canvas || !doc) return;
        try {
          const dataUrl = canvas.toDataURL('image/png');
          // 同一帧再渲染一遍透明底，导出时不用再往返
          const alphaCanvas = document.createElement('canvas');
          renderDoc(alphaCanvas, doc, { withBackground: false });
          const alphaDataUrl = alphaCanvas.toDataURL('image/png');
          fetch(`${API}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, alphaDataUrl }),
          }).catch(() => {});
        } catch {
          /* 画布被污染或过大时忽略 */
        }
      }, []);

      /** 适应窗口：整幅画缩进可视区并居中。 */
      const fitToDoc = React.useCallback((w, h) => {
        const el = viewportRef.current;
        if (!el || !w || !h) return;
        const vw = el.clientWidth;
        const vh = el.clientHeight;
        if (vw <= 0 || vh <= 0) return;
        const scale = Math.min(vw / w, vh / h) * 0.96;
        setView({ scale, x: (vw - w * scale) / 2, y: (vh - h * scale) / 2 });
        userViewRef.current = false;
      }, [setView]);

      /** 以某点为锚缩放：鼠标下面那一点保持不动。 */
      const zoomAt = React.useCallback((clientX, clientY, factor) => {
        const el = viewportRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cur = viewRef.current;
        const nextScale = Math.max(0.06, Math.min(16, cur.scale * factor));
        const atX = clientX - rect.left;
        const atY = clientY - rect.top;
        const px = (atX - cur.x) / cur.scale;
        const py = (atY - cur.y) / cur.scale;
        setView({ scale: nextScale, x: atX - px * nextScale, y: atY - py * nextScale });
        userViewRef.current = true;
      }, [setView]);

      const zoomBy = (factor) => {
        const el = viewportRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
      };

      const zoomActual = () => {
        const el = viewportRef.current;
        const doc = docRef.current;
        if (!el || !doc) return;
        setView({ scale: 1, x: (el.clientWidth - doc.width) / 2, y: (el.clientHeight - doc.height) / 2 });
        userViewRef.current = true;
      };

      // 滚轮缩放：必须非 passive 才能 preventDefault，所以自己挂原生监听
      React.useEffect(() => {
        const el = viewportRef.current;
        if (!el) return undefined;
        const onWheel = (e) => {
          e.preventDefault();
          zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
      }, [zoomAt]);

      // 空格 = 临时抓手；在输入框里按空格不抢
      React.useEffect(() => {
        const isEditing = (target) => {
          const tag = (target && target.tagName) || '';
          return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
        };
        const down = (e) => {
          if (e.code !== 'Space' || isEditing(e.target)) return;
          spaceRef.current = true;
          setSpaceHeld(true);
          e.preventDefault();
        };
        const up = (e) => {
          if (e.code !== 'Space') return;
          spaceRef.current = false;
          setSpaceHeld(false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
          window.removeEventListener('keydown', down);
          window.removeEventListener('keyup', up);
        };
      }, []);

      // 视口大小变化时，只要用户没手动缩放过就重新适应
      React.useEffect(() => {
        const el = viewportRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => {
          if (userViewRef.current) return;
          const doc = docRef.current;
          if (doc) fitToDoc(doc.width, doc.height);
        });
        ro.observe(el);
        return () => ro.disconnect();
      }, [fitToDoc]);

      const onViewPointerDown = (evt) => {
        if (!(evt.button === 1 || spaceRef.current)) return;
        evt.preventDefault();
        evt.currentTarget.setPointerCapture?.(evt.pointerId);
        panRef.current = { id: evt.pointerId, sx: evt.clientX, sy: evt.clientY, base: viewRef.current };
      };

      const onViewPointerMove = (evt) => {
        const pan = panRef.current;
        if (!pan || pan.id !== evt.pointerId) return;
        setView({
          scale: pan.base.scale,
          x: pan.base.x + (evt.clientX - pan.sx),
          y: pan.base.y + (evt.clientY - pan.sy),
        });
        userViewRef.current = true;
      };

      const onViewPointerUp = (evt) => {
        if (panRef.current && panRef.current.id === evt.pointerId) panRef.current = null;
      };

      // 初次加载 + 轮询宿主版本（用户或模型都可能改动文档）
      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const tick = async () => {
          try {
            const body = await fetchDoc();
            if (!alive || !body.ok) return;
            // 宿主有没有 32 支笔刷：旧进程只认 5 支，落笔后笔刷会被丢掉，重画成圆头
            setStaleHost(!(Number(body.brushes) >= BRUSHES.length));
            setUpdateInfo(body.update || null);
            docRef.current = body.doc;
            await ensureImages(body.doc);
            if (!alive) return;
            if (body.revision !== revRef.current) {
              revRef.current = body.revision;
              setRevision(body.revision);
              readMeta(body.doc);
              renderDoc(canvasRef.current, body.doc);
              setTimeout(uploadPreview, 300);
              // 第一次拿到文档、或画布尺寸变了，重新适应窗口
              const fit = fitDimsRef.current;
              if (!fit || fit.w !== body.doc.width || fit.h !== body.doc.height) {
                fitDimsRef.current = { w: body.doc.width, h: body.doc.height };
                fitToDoc(body.doc.width, body.doc.height);
              }
            }
            setError(null);
          } catch {
            if (alive) setError(t('syncFailed'));
          } finally {
            if (alive) timer = setTimeout(tick, 700);
          }
        };
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
          if (replayRef.current) clearTimeout(replayRef.current);
        };
      }, [fitToDoc, readMeta, t, uploadPreview]);

      // 像素任务：宿主把裁切/取色/差分塞进队列，这里取走、算完回传。
      // 只在画界面板打开时存在，所以「模型要看得见」的前提是用户开着画界。
      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const seen = [];
        const drain = async () => {
          try {
            if (docRef.current) {
              const res = await fetch(`${API}/jobs`, { cache: 'no-store' });
              const body = await res.json();
              for (const job of (body && body.jobs) || []) {
                if (seen.includes(job.id)) continue;
                seen.push(job.id);
                if (seen.length > 120) seen.shift();
                let result;
                try {
                  result = runPixelTask(job, docRef.current);
                } catch (err) {
                  result = { ok: false, error: String((err && err.message) || err) };
                }
                fetch(`${API}/job`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: job.id, result }),
                }).catch(() => {});
              }
            }
          } catch {
            /* 宿主没开或网络抖动：下一轮再试 */
          }
          if (alive) timer = setTimeout(drain, 700);
        };
        drain();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, []);

      // 尺寸变化时重画（保证位图不被拉伸糊掉）
      React.useEffect(() => {
        if (docRef.current) renderDoc(canvasRef.current, docRef.current);
      }, [revision]);

      const posOf = (evt) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = ((evt.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;
        const pressure = evt.pressure && evt.pressure > 0 ? evt.pressure : 0.55;
        return [Math.round(x), Math.round(y), Number(pressure.toFixed(3))];
      };

      const tempStroke = () => {
        const drag = dragRef.current;
        if (!drag) return null;
        const base = {
          color,
          size,
          opacity: 1,
          mode: tool === 'eraser' ? 'eraser' : 'brush',
          brush: tool === 'eraser' ? 'round' : brush,
        };
        if (drag.mode === 'free') {
          if (drag.points.length < 2) return null;
          // 手绘才带笔锋与最小笔宽；形状工具保持等宽，不然矩形角会缺一块
          return { ...base, taper, minSize: 0.3, points: drag.points };
        }
        return { ...base, points: shapePoints(drag.tool, drag.start, drag.end) };
      };

      // 手上空中的那一笔只画在屏幕上，不提交
      const showTemp = () => {
        const doc = docRef.current;
        const stroke = tempStroke();
        if (!doc || !stroke) return;
        const base = layersOf(doc);
        const activeId = doc.activeLayer || (base[base.length - 1] || {}).id;
        renderDoc(canvasRef.current, {
          ...doc,
          layers: base.map((l) => (l.id === activeId ? { ...l, strokes: [...(l.strokes || []), stroke] } : l)),
        });
      };

      const onPointerDown = (evt) => {
        if (playing || spaceRef.current || evt.button === 1) return;
        evt.currentTarget.setPointerCapture?.(evt.pointerId);
        const p = posOf(evt);
        if (tool === 'brush') {
          dragRef.current = { mode: 'free', points: [p] };
        } else {
          dragRef.current = { mode: 'shape', tool, start: p, end: p };
        }
      };

      const onPointerMove = (evt) => {
        const drag = dragRef.current;
        if (!drag) return;
        const p = posOf(evt);
        if (drag.mode === 'free') {
          const last = drag.points[drag.points.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
          drag.points.push(p);
          if (drag.points.length % 4 === 0) showTemp();
          return;
        }
        drag.end = p;
        showTemp();
      };

      const finish = async () => {
        const stroke = tempStroke();
        dragRef.current = null;
        const doc = docRef.current;
        if (!stroke) {
          if (doc) renderDoc(canvasRef.current, doc);
          return;
        }
        if (stroke.points.length < 2) {
          if (doc) renderDoc(canvasRef.current, doc);
          return;
        }
        try {
          await fetch(`${API}/stroke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strokes: [stroke], layer: doc ? doc.activeLayer : undefined }),
          });
        } catch {
          setError(t('syncFailed'));
        }
      };

      /** 新建一幅：save 决定先把当前这幅存成 PNG；带 image 就按图片尺寸建画布。 */
      const startNewPainting = async (opts = {}) => {
        setNewNote(t('page.new.creating'));
        try {
          const r = await fetch(`${API}/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              save: pendingSave === true,
              width: opts.width,
              height: opts.height,
              dataUrl: opts.image ? opts.image.dataUrl : undefined,
              name: opts.image ? opts.image.name : undefined,
            }),
          });
          const body = await r.json();
          if (body && body.ok) {
            setNewNote(null);
            setSheet(null);
            setPendingSave(false);
            userViewRef.current = false;
            // 尺寸变了，fitDimsRef 清掉，下一帧按新画布重新适应
            fitDimsRef.current = null;
            return;
          }
          setNewNote((body && body.error) || t('page.new.failed'));
        } catch {
          setNewNote(t('page.new.failed'));
        }
      };

      /** 新建时选了一张图片：读出来直接按图片尺寸建画布。 */
      const startNewFromImage = async (evt) => {
        const input = evt.target;
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          await startNewPainting({
            withSave: true,
            image: { dataUrl, name: file.name.replace(/\.[^.]+$/, '') },
          });
        } catch {
          setNewNote(t('page.new.failed'));
        } finally {
          input.value = '';
        }
      };

      const onOp = async (op, extra = {}) => {
        try {
          await fetch(`${API}/op`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, ...extra }),
          });
        } catch {
          setError(t('syncFailed'));
        }
      };

      /** 选一张本机图片 → 宿主存进 images/ → 压成最底下的图片层（图层 1）。 */
      const importImage = async (evt) => {
        const input = evt.target;
        const file = input.files && input.files[0];
        if (!file) return;
        setImportNote(t('page.importing'));
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const r = await fetch(`${API}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl,
              name: file.name.replace(/\.[^.]+$/, ''),
              fit: 'contain',
            }),
          });
          const body = await r.json();
          setImportNote(body && body.ok
            ? `${t('page.imported')} · ${body.layer.name}`
            : (body && body.error) || t('syncFailed'));
        } catch {
          setImportNote(t('syncFailed'));
        } finally {
          input.value = '';
        }
      };

      // 回放：按全局顺序逐笔重画，节奏按笔数自适应
      const replay = () => {
        const doc = docRef.current;
        if (!doc || playing) return;
        const entries = flattenStrokes(doc);
        if (entries.length === 0) return;
        const step = Math.max(1, Math.ceil(entries.length / 90));
        let n = 0;
        setPlaying(true);
        renderDoc(canvasRef.current, docAtStep(doc, entries, 0));
        const tick = () => {
          n += step;
          if (n >= entries.length) {
            renderDoc(canvasRef.current, doc);
            replayRef.current = null;
            setPlaying(false);
            return;
          }
          renderDoc(canvasRef.current, docAtStep(doc, entries, n));
          replayRef.current = setTimeout(tick, 60);
        };
        replayRef.current = setTimeout(tick, 80);
      };

      const btn = {
        padding: '3px 9px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      };
      const btnOn = (active) => ({
        ...btn,
        borderColor: active ? 'var(--dsw-alias-border-l3, rgba(127,127,127,0.65))' : undefined,
        background: active ? 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.14))' : 'transparent',
      });
      const selectStyle = {
        padding: '2px 4px',
        borderRadius: 4,
        background: 'transparent',
        color: 'inherit',
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        font: 'inherit',
      };
      const barStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))',
        flex: '0 0 auto',
        flexWrap: 'wrap',
      };

      const activeLayer = meta.layers.find((l) => l.id === meta.activeLayer) || meta.layers[meta.layers.length - 1] || null;
      const toolBtn = (id, label) => h('button', { type: 'button', style: btnOn(tool === id), onClick: () => setTool(id) }, label);

      /* ---------- 可复用的几块，两种排布共用 ---------- */

      const colorCtl = h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        t('color'),
        h('input', {
          type: 'color',
          value: color,
          onChange: (e) => setColor(e.target.value),
          style: { width: 26, height: 20, padding: 0, border: 'none', background: 'none' },
        }),
      );

      const sizeCtl = h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        t('size'),
        h('input', {
          type: 'range',
          min: 1,
          max: 120,
          value: size,
          onChange: (e) => setSize(Number(e.target.value)),
          style: { width: 96 },
        }),
        h('span', { style: { minWidth: 22, textAlign: 'right' } }, String(size)),
      );

      const toolCtl = h('div', { style: { display: 'inline-flex', gap: 3, flexWrap: 'wrap' } },
        toolBtn('brush', t('toolBrush')),
        toolBtn('eraser', t('toolEraser')),
        toolBtn('line', t('toolLine')),
        toolBtn('rect', t('toolRect')),
        toolBtn('ellipse', t('toolEllipse')),
      );

      const opsCtl = h('div', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        h('button', { type: 'button', style: btn, disabled: playing, onClick: () => onOp('undo') }, `↶ ${t('undo')}`),
        h('button', {
          type: 'button',
          style: btn,
          disabled: playing || meta.redo === 0,
          onClick: () => onOp('redo'),
        }, `↷ ${t('redo')}`),
        h('button', {
          type: 'button',
          style: btn,
          disabled: playing || meta.strokes === 0,
          onClick: replay,
        }, `▶ ${t('replay')}`),
        h('button', { type: 'button', style: btn, disabled: playing, onClick: () => onOp('clear') }, t('clear')),
      );

      const layersBlock = (maxH) => h(React.Fragment, null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
          h('span', { style: { opacity: 0.6 } }, t('layers')),
          h('button', { type: 'button', style: btn, onClick: () => onOp('layer.add', { name: null }) }, t('layerAdd')),
          meta.layers.length > 1 && activeLayer
            ? h('button', { type: 'button', style: btn, onClick: () => onOp('layer.remove', { id: activeLayer.id }) }, t('layerRemove'))
            : null,
        ),
        h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            maxHeight: maxH || 118,
            overflowY: 'auto',
          },
        },
          meta.layers.map((l) => h('div', {
            key: l.id,
            onClick: () => onOp('layer.set', { id: l.id, patch: { active: true } }),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 4px',
              borderRadius: 4,
              cursor: 'pointer',
              background: l.id === meta.activeLayer
                ? 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.14))'
                : 'transparent',
            },
          },
            h('button', {
              type: 'button',
              style: { ...btn, padding: '0 4px', border: 'none' },
              title: t('layerVisibility'),
              onClick: (e) => {
                e.stopPropagation();
                onOp('layer.set', { id: l.id, patch: { visible: !l.visible } });
              },
            }, l.visible ? '◉' : '○'),
            h('span', {
              style: {
                flex: '1 1 auto',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                opacity: l.visible ? 1 : 0.45,
              },
            }, l.name),
            l.image
              ? h('span', { style: { opacity: 0.45, fontSize: 10 } }, 'IMG')
              : h('span', { style: { opacity: 0.45 } }, String(l.count)),
          )),
        ),
        activeLayer
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, paddingTop: 6, flexWrap: 'wrap' } },
            h('span', { style: { opacity: 0.6 } }, t('opacity')),
            h('input', {
              type: 'range',
              min: 0,
              max: 1,
              step: 0.05,
              value: activeLayer.opacity,
              onChange: (e) => onOp('layer.set', { id: activeLayer.id, patch: { opacity: Number(e.target.value) } }),
              style: { width: 72 },
            }),
            h('select', {
              value: activeLayer.blend,
              onChange: (e) => onOp('layer.set', { id: activeLayer.id, patch: { blend: e.target.value } }),
              style: selectStyle,
            },
              h('option', { value: 'normal' }, t('blendNormal')),
              h('option', { value: 'multiply' }, t('blendMultiply')),
            ),
          )
          : null,
      );

      const viewportBlock = h('div', {
        ref: viewportRef,
        onPointerDown: onViewPointerDown,
        onPointerMove: onViewPointerMove,
        onPointerUp: onViewPointerUp,
        onPointerCancel: onViewPointerUp,
        style: {
          flex: '1 1 auto',
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
          background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.14))',
          cursor: spaceHeld ? 'grab' : 'default',
        },
      },
        h('div', {
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            width: meta.width || 1024,
            height: meta.height || 1024,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          },
        },
          h('canvas', {
            ref: canvasRef,
            onPointerDown,
            onPointerMove,
            onPointerUp: finish,
            onPointerCancel: finish,
            onPointerLeave: (e) => { if (dragRef.current) finish(e); },
            style: {
              width: meta.width || 1024,
              height: meta.height || 1024,
              display: 'block',
              background: meta.background || '#ffffff',
              borderRadius: 2,
              boxShadow: '0 6px 28px rgba(0,0,0,0.35)',
              touchAction: 'none',
              cursor: playing ? 'progress' : (spaceHeld ? 'grab' : 'crosshair'),
            },
          }),
        ),
        h('div', {
          title: t('panHint'),
          style: {
            position: 'absolute',
            right: 8,
            bottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '3px 5px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.42)',
            color: '#f2f2f2',
          },
        },
          h('button', { type: 'button', style: { ...btn, border: 'none', padding: '1px 7px' }, onClick: () => zoomBy(1 / 1.2) }, '−'),
          h('span', {
            style: { minWidth: 42, textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
          }, `${Math.round(view.scale * 100)}%`),
          h('button', { type: 'button', style: { ...btn, border: 'none', padding: '1px 7px' }, onClick: () => zoomBy(1.2) }, '＋'),
          h('button', {
            type: 'button',
            style: { ...btn, border: 'none', padding: '1px 7px' },
            onClick: () => {
              const d = docRef.current;
              if (d) fitToDoc(d.width, d.height);
            },
          }, t('zoomFit')),
          h('button', { type: 'button', style: { ...btn, border: 'none', padding: '1px 7px' }, onClick: zoomActual }, t('zoomActual')),
        ),
      );

      /** 整页布局里的卡片壳。 */
      const card = (title, children, extra) => h('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
          borderRadius: 10,
          padding: '9px 10px 10px',
          background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
          h('span', { style: { fontWeight: 600, opacity: 0.85 } }, title),
          extra ? h('span', { style: { marginLeft: 'auto', opacity: 0.45, fontSize: 11 } }, extra) : null,
        ),
        children,
      );

      /* ---------- 整页模式用的按钮与弹窗卡片 ---------- */
      const pill = {
        boxSizing: 'border-box',
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.1))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: 'pointer',
        font: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'center',
        whiteSpace: 'nowrap',
      };
      const pillOn = (active) => ({
        ...pill,
        borderColor: active ? 'var(--dsw-alias-brand-primary, #4c8bf5)' : 'var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        background: active
          ? 'var(--dsw-alias-button-ghost-active-fill, rgba(76,139,245,0.14))'
          : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.1))',
        color: active ? 'var(--dsw-alias-brand-primary, #4c8bf5)' : 'var(--dsw-alias-label-primary, inherit)',
      });

      const TOOLS = [
        { id: 'brush', label: t('toolBrush'), glyph: '✎' },
        { id: 'eraser', label: t('toolEraser'), glyph: '⌫' },
        { id: 'line', label: t('toolLine'), glyph: '╱' },
        { id: 'rect', label: t('toolRect'), glyph: '▭' },
        { id: 'ellipse', label: t('toolEllipse'), glyph: '◯' },
      ];
      const currentTool = TOOLS.find((x) => x.id === tool) || TOOLS[0];

      const currentBrush = BRUSH_BY_ID.get(brush) || BRUSH_BY_ID.get('round');
      const brushGroups = BRUSH_GROUPS.map((gid) => ({
        id: gid,
        label: t(`brushGroup.${gid}`),
        items: BRUSHES.filter((b) => b.group === gid).map((b) => BRUSH_BY_ID.get(b.id)),
      }));

      /**
       * 侧边图层视窗：像画世界那样贴在画板右边，能收起成一条窄轨。
       * 展开时是「头部（层数/收起）+ 层列表（缩略图/眼睛/不透明度/混合）+ 底部（新建/删除）」。
       */
      const layerDockBlock = h('div', {
        key: 'layer-dock',
        style: {
          flex: `0 0 ${layerDock ? 214 : 34}px`,
          width: layerDock ? 214 : 34,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
          transition: 'flex-basis 140ms ease, width 140ms ease',
        },
      },
        layerDock
          ? [
            h('div', {
              key: 'head',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 8px',
                borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
              },
            },
              h('span', { style: { fontWeight: 700, fontSize: 12 } }, t('layers')),
              h('span', {
                style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, inherit)' },
              }, String(meta.layers.length)),
              h('button', {
                type: 'button',
                title: t('layerCollapse'),
                style: { ...pill, marginLeft: 'auto', padding: '1px 8px', fontSize: 12 },
                onClick: () => setLayerDock(false),
              }, '›'),
            ),
            h('div', {
              key: 'list',
              style: {
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              },
            },
              [...meta.layers].reverse().map((l) => {
                const isActive = l.id === meta.activeLayer;
                return h('div', {
                  key: l.id,
                  onClick: () => onOp('layer.set', { id: l.id, patch: { active: true } }),
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 5px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    border: `1px solid ${isActive ? 'var(--dsw-alias-brand-primary, #4c8bf5)' : 'transparent'}`,
                    background: isActive
                      ? 'var(--dsw-alias-button-ghost-active-fill, rgba(76,139,245,0.14))'
                      : 'transparent',
                    opacity: l.visible ? 1 : 0.55,
                  },
                },
                  h('button', {
                    type: 'button',
                    title: t('layerVisibility'),
                    style: {
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-secondary, inherit)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 12,
                      flex: '0 0 14px',
                    },
                    onClick: (e) => {
                      e.stopPropagation();
                      onOp('layer.set', { id: l.id, patch: { visible: !l.visible } });
                    },
                  }, l.visible ? '◉' : '○'),
                  h(LayerThumb, { layerId: l.id, sig: `${l.count}:${l.image ? 'img' : 'vec'}`, docRef, rev: revision }),
                  h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                    h('div', {
                      style: {
                        fontSize: 11.5,
                        fontWeight: isActive ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }, l.name),
                    h('div', {
                      style: {
                        fontSize: 10,
                        color: 'var(--dsw-alias-label-tertiary, inherit)',
                        display: 'flex',
                        gap: 6,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                      },
                    },
                      h('span', null, l.image ? 'IMG' : `${l.count} ${t('strokes')}`),
                      l.opacity < 1 ? h('span', null, `${Math.round(l.opacity * 100)}%`) : null,
                      l.blend === 'multiply' ? h('span', null, t('blendMultiply')) : null,
                    ),
                  ),
                );
              }),
            ),
            activeLayer
              ? h('div', {
                key: 'foot',
                style: {
                  borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
                  padding: '7px 8px 9px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 } },
                  h('span', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)' } }, t('opacity')),
                  h('input', {
                    type: 'range',
                    min: 0,
                    max: 1,
                    step: 0.05,
                    value: optOpacity && optOpacity.id === activeLayer.id ? optOpacity.v : activeLayer.opacity,
                    onChange: (e) => {
                      const v = Number(e.target.value);
                      setOptOpacity({ id: activeLayer.id, v });
                      onOp('layer.set', { id: activeLayer.id, patch: { opacity: v } });
                    },
                    style: { flex: '1 1 auto', minWidth: 0, accentColor: 'var(--dsw-alias-brand-primary, #4c8bf5)' },
                  }),
                  h('span', {
                    style: { minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
                  }, `${Math.round((optOpacity && optOpacity.id === activeLayer.id ? optOpacity.v : activeLayer.opacity) * 100)}%`),
                ),
                h('select', {
                  value: activeLayer.blend,
                  onChange: (e) => onOp('layer.set', { id: activeLayer.id, patch: { blend: e.target.value } }),
                  style: {
                    width: '100%',
                    boxSizing: 'border-box',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
                    background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.1))',
                    color: 'var(--dsw-alias-label-primary, inherit)',
                    padding: '3px 6px',
                    font: 'inherit',
                  },
                },
                  h('option', { value: 'normal' }, t('blendNormal')),
                  h('option', { value: 'multiply' }, t('blendMultiply')),
                ),
                h('div', { style: { display: 'flex', gap: 6 } },
                  h('button', {
                    type: 'button',
                    style: { ...pill, flex: '1 1 auto', padding: '4px 8px' },
                    onClick: () => onOp('layer.add', { name: null }),
                  }, `＋ ${t('layerAdd')}`),
                  meta.layers.length > 1
                    ? h('button', {
                      type: 'button',
                      style: { ...pill, padding: '4px 8px' },
                      onClick: () => onOp('layer.remove', { id: activeLayer.id }),
                    }, t('layerRemove'))
                    : null,
                ),
              )
              : null,
          ]
          : h('button', {
            type: 'button',
            title: t('layerExpand'),
            onClick: () => setLayerDock(true),
            style: {
              flex: '1 1 auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '10px 0',
              border: 'none',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary, inherit)',
              cursor: 'pointer',
            },
          },
            h('span', { style: { fontSize: 14 } }, '▤'),
            h('span', {
              style: { writingMode: 'vertical-rl', fontSize: 11, letterSpacing: 1 },
            }, t('layers')),
            h('span', {
              style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary, inherit)' },
            }, String(meta.layers.length)),
          ),
      );

      // 整页模式：A1 画板在左，B1 画笔 / B2 编辑与画布在右；多选项都收进弹窗卡片
      if (props.variant === 'page') {
        const layerName = activeLayer ? activeLayer.name : '—';
        return h('div', {
          style: {
            display: 'flex',
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            font: '12px/1.5 system-ui, "Microsoft YaHei", sans-serif',
            color: 'var(--dsw-alias-label-primary, inherit)',
          },
        },
          // A1：画板
          h('div', {
            style: {
              flex: '1 1 auto',
              minWidth: 0,
              minHeight: 260,
              display: 'flex',
              flexDirection: 'column',
              padding: 12,
            },
          },
            error
              ? h('div', { style: { padding: '0 0 6px', color: 'var(--dsw-alias-label-error, #e5484d)' } }, error)
              : null,
            staleHost
              ? h('div', {
                style: {
                  marginBottom: 6,
                  padding: '5px 8px',
                  borderRadius: 8,
                  fontSize: 11,
                  color: 'var(--dsw-alias-label-error, #e5484d)',
                  background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.1))',
                },
              }, t('staleHost'))
              : null,
            updateInfo && updateInfo.hasUpdate
              ? h('div', {
                style: {
                  marginBottom: 6,
                  padding: '5px 8px',
                  borderRadius: 8,
                  fontSize: 11,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                  background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.1))',
                  border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))',
                },
              },
                h('span', null, `${t('updateTip')} ${updateInfo.latest}${updateInfo.local ? `（${t('updateNow')} ${updateInfo.local}）` : ''}`),
                updateInfo.url
                  ? h('a', {
                    href: updateInfo.url,
                    target: '_blank',
                    rel: 'noreferrer',
                    style: { color: 'var(--dsw-alias-brand-primary, inherit)', fontWeight: 600 },
                  }, t('updateGo'))
                  : null)
              : null,
            h('div', {
              style: {
                flex: '1 1 auto',
                minHeight: 0,
                display: 'flex',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))',
              },
            }, viewportBlock, layerDockBlock),
          ),

          // 右列
          h('aside', {
            style: {
              flex: '0 0 286px',
              width: 286,
              minHeight: 0,
              borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
              padding: '12px 12px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              overflowY: 'auto',
              boxSizing: 'border-box',
            },
          },
            // B1：画笔
            card(t('page.tools'), h(React.Fragment, null,
              h('div', { style: { display: 'flex', alignItems: 'stretch', gap: 8, marginBottom: 10 } },
                h('button', {
                  type: 'button',
                  style: { ...pill, flex: '1 1 auto', justifyContent: 'flex-start', padding: '7px 10px', fontSize: 13 },
                  onClick: () => setSheet('tools'),
                },
                  h('span', { style: { fontSize: 15, lineHeight: 1 } }, currentTool.glyph),
                  h('span', { style: { fontWeight: 600 } }, currentTool.label),
                  h('span', {
                    style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11 },
                  }, `· ${currentBrush.label}`),
                  h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11 } }, '▾'),
                ),
                h('label', {
                  title: t('color'),
                  style: {
                    flex: '0 0 auto',
                    width: 38,
                    height: 34,
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    background: color,
                    cursor: 'pointer',
                    position: 'relative',
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                  },
                },
                  h('input', {
                    type: 'color',
                    value: color,
                    onChange: (e) => setColor(e.target.value),
                    style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' },
                  }),
                ),
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
                h('span', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)', flex: '0 0 auto' } }, t('size')),
                h('input', {
                  type: 'range',
                  min: 1,
                  max: 120,
                  value: size,
                  onChange: (e) => setSize(Number(e.target.value)),
                  style: { flex: '1 1 auto', minWidth: 0, accentColor: 'var(--dsw-alias-brand-primary, #4c8bf5)' },
                }),
                h('span', {
                  style: {
                    flex: '0 0 auto',
                    minWidth: 26,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  },
                }, String(size)),
              ),
              h('button', {
                type: 'button',
                style: { ...pill, width: '100%', justifyContent: 'flex-start', padding: '7px 10px' },
                onClick: () => setLayerDock((v) => !v),
              },
                h('span', { style: { fontSize: 13 } }, '▤'),
                h('span', null, t('layers')),
                h('span', {
                  style: { color: 'var(--dsw-alias-label-tertiary, inherit)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 },
                }, layerName),
                h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11 } },
                  `${meta.layers.length} ${layerDock ? '▸' : '◂'}`),
              ),
            ), `${meta.strokes} ${t('strokes')}`),

            // B2：编辑 + 画布
            card(t('page.edit'), h(React.Fragment, null,
              h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 } },
                h('button', { type: 'button', style: { ...pill, opacity: playing ? 0.55 : 1 }, disabled: playing, onClick: () => onOp('undo') }, `↶ ${t('undo')}`),
                h('button', {
                  type: 'button',
                  style: { ...pill, opacity: (playing || meta.redo === 0) ? 0.55 : 1 },
                  disabled: playing || meta.redo === 0,
                  onClick: () => onOp('redo'),
                }, `↷ ${t('redo')}`),
                h('button', {
                  type: 'button',
                  style: { ...pill, opacity: (playing || meta.strokes === 0) ? 0.55 : 1 },
                  disabled: playing || meta.strokes === 0,
                  onClick: replay,
                }, `▶ ${t('replay')}`),
                h('button', { type: 'button', style: { ...pill, opacity: playing ? 0.55 : 1 }, disabled: playing, onClick: () => onOp('clear') }, `⌫ ${t('clear')}`),
              ),
              h('button', {
                type: 'button',
                style: { ...pill, width: '100%', justifyContent: 'flex-start', padding: '7px 10px', marginTop: 2 },
                onClick: () => setSheet('canvas'),
              },
                h('span', { style: { fontSize: 13 } }, '⬒'),
                h('span', null, t('page.canvas')),
                h('span', {
                  style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary, inherit)', fontVariantNumeric: 'tabular-nums' },
                }, `${meta.width}×${meta.height}`),
                h('span', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11 } }, '▸'),
              ),
            ), `rev ${revision}`),

            h('div', {
              style: {
                padding: '2px 2px 0',
                color: 'var(--dsw-alias-label-caption, inherit)',
                fontSize: 11,
                lineHeight: 1.6,
              },
            }, t('panHint')),
          ),

          // 弹窗卡片：工具、图层、画布设置
          h(Sheet, {
            open: sheet === 'tools',
            title: t('page.tools'),
            width: 560,
            onClose: () => setSheet(null),
          },
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } },
              TOOLS.map((x) => h('button', {
                key: x.id,
                type: 'button',
                style: { ...pill, flexDirection: 'column', gap: 4, padding: '12px 8px', fontSize: 13 },
                onClick: () => {
                  setTool(x.id);
                  setSheet(null);
                },
                ...(x.id === tool
                  ? {
                    borderColor: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                    background: 'var(--dsw-alias-button-ghost-active-fill, rgba(76,139,245,0.14))',
                    color: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                  }
                  : null),
              },
                h('span', { style: { fontSize: 20, lineHeight: 1 } }, x.glyph),
                h('span', null, x.label),
              )),
            ),
            h('div', {
              style: {
                marginTop: 14,
                paddingTop: 10,
                borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.22))',
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 } },
                h('span', { style: { fontWeight: 600 } }, t('brush')),
                h('span', {
                  style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11 },
                }, t('brushHint')),
              ),
              h('div', { style: { maxHeight: '52vh', overflowY: 'auto', paddingRight: 4 } },
                brushGroups.map((grp) => h('div', { key: grp.id, style: { marginBottom: 10 } },
                  h('div', {
                    style: {
                      color: 'var(--dsw-alias-label-secondary, inherit)',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 5,
                    },
                  }, grp.label),
                  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 } },
                    grp.items.map((b) => h('button', {
                      key: b.id,
                      type: 'button',
                      title: t(`brush.${b.id}`),
                      style: {
                        ...pill,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 3,
                        padding: '5px 6px 4px',
                        minWidth: 0,
                      },
                      onClick: () => {
                        setBrush(b.id);
                        setSheet(null);
                      },
                      ...(b.id === brush
                        ? {
                          borderColor: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                          color: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                          background: 'var(--dsw-alias-button-ghost-active-fill, rgba(76,139,245,0.14))',
                        }
                        : null),
                    },
                      h(BrushPreview, { id: b.id }),
                      h('span', {
                        style: { fontSize: 11, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                      }, t(`brush.${b.id}`)),
                    )),
                  ),
                )),
              ),
              h('label', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  paddingTop: 8,
                  cursor: 'pointer',
                  fontSize: 12,
                },
              },
                h('input', {
                  type: 'checkbox',
                  checked: taper,
                  onChange: (e) => setTaper(e.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary, #4c8bf5)' },
                }),
                h('span', null, t('taper')),
                h('span', {
                  style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11 },
                }, t('taperHint')),
              ),
            ),
          ),

          h(Sheet, {
            open: sheet === 'layers',
            title: t('layers'),
            width: 460,
            onClose: () => setSheet(null),
          },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                style: pill,
                onClick: () => {
                  if (importRef.current) importRef.current.click();
                },
              }, `🖼 ${t('page.importLayer')}`),
              h('input', {
                ref: importRef,
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif',
                style: { display: 'none' },
                onChange: importImage,
              }),
              importNote
                ? h('span', {
                  style: {
                    color: 'var(--dsw-alias-label-tertiary, inherit)',
                    fontSize: 11,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 260,
                  },
                }, importNote)
                : null,
            ),
            layersBlock(240),
            h('div', { style: { paddingTop: 10, color: 'var(--dsw-alias-label-caption, inherit)', fontSize: 11 } },
              t('page.layerHint')),
          ),

          h(Sheet, {
            open: sheet === 'canvas',
            title: t('page.canvas'),
            width: 560,
            onClose: () => setSheet(null),
          },
            h(SettingsSection, { t, compact: true }),
          ),

          // 新建第一步：先问当前这幅要不要留一份
          h(Sheet, {
            open: sheet === 'newSave',
            title: t('page.new.title'),
            width: 440,
            onClose: () => setSheet(null),
          },
            h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('page.new.saveQ')),
            h('div', {
              style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 12, marginBottom: 16 },
            }, t('page.new.saveHint')),
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' } },
              h('button', { type: 'button', style: pill, onClick: () => setSheet(null) }, t('page.new.cancel')),
              h('button', {
                type: 'button',
                style: pill,
                onClick: () => {
                  setPendingSave(false);
                  setNewNote(null);
                  setSheet('newPick');
                },
              }, t('page.new.skipSave')),
              h('button', {
                type: 'button',
                style: {
                  ...pill,
                  borderColor: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                  color: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                  fontWeight: 600,
                },
                onClick: () => {
                  setPendingSave(true);
                  setNewNote(null);
                  setSheet('newPick');
                },
              }, t('page.new.saveAnd')),
            ),
          ),

          // 新建第二步：空白画布（挑尺寸）或导入图片（按图片尺寸建）
          h(Sheet, {
            open: sheet === 'newPick',
            title: t('page.new.pick'),
            width: 520,
            onClose: () => setSheet(null),
          },
            pendingSave
              ? h('div', {
                style: {
                  marginBottom: 10,
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  background: 'var(--dsw-alias-button-ghost-active-fill, rgba(76,139,245,0.12))',
                  color: 'var(--dsw-alias-brand-primary, #4c8bf5)',
                },
              }, t('page.new.willSave'))
              : null,
            h('div', {
              style: {
                border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))',
                borderRadius: 10,
                padding: '10px 12px 12px',
                marginBottom: 10,
              },
            },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('page.new.blank')),
              h('div', {
                style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11, marginBottom: 8 },
              }, t('page.new.blankHint')),
              h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 } },
                ['1-1', '4-3', '16-9', '9-16', 'a4'].map((id) => CANVAS_PRESETS.find((p) => p.id === id)).filter(Boolean).map((p) => h('button', {
                  key: p.id,
                  type: 'button',
                  style: { ...pill, flexDirection: 'column', gap: 2, padding: '8px 6px' },
                  onClick: () => startNewPainting({ width: p.w, height: p.h }),
                },
                  h('span', { style: { fontWeight: 600 } }, p.label),
                  h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption, inherit)' } }, `${p.w}×${p.h}`),
                )),
                h('button', {
                  type: 'button',
                  style: { ...pill, flexDirection: 'column', gap: 2, padding: '8px 6px' },
                  onClick: () => startNewPainting({ width: meta.width, height: meta.height }),
                },
                  h('span', { style: { fontWeight: 600 } }, t('page.new.currentSize')),
                  h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption, inherit)' } }, `${meta.width}×${meta.height}`),
                ),
              ),
              h('div', { style: { fontSize: 11, paddingTop: 8 } },
                h('button', {
                  type: 'button',
                  style: { ...pill, padding: '4px 9px' },
                  onClick: () => setSheet('canvas'),
                }, t('page.new.moreSizes')),
              ),
            ),
            h('div', {
              style: {
                border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))',
                borderRadius: 10,
                padding: '10px 12px 12px',
              },
            },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('page.new.fromImage')),
              h('div', {
                style: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 11, marginBottom: 8 },
              }, t('page.new.fromImageHint')),
              h('button', {
                type: 'button',
                style: pill,
                onClick: () => {
                  if (newImportRef.current) newImportRef.current.click();
                },
              }, `🖼 ${t('page.new.chooseImage')}`),
              h('input', {
                ref: newImportRef,
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif',
                style: { display: 'none' },
                onChange: startNewFromImage,
              }),
            ),
            newNote
              ? h('div', {
                style: { paddingTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary, inherit)' },
              }, newNote)
              : null,
          ),        );
      }
      // 右栏模式：原来的窄条排布
      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          font: '12px/1.4 system-ui, "Microsoft YaHei", sans-serif',
          color: 'var(--dsw-alias-label-primary, #eee)',
        },
      },
        h('div', { style: barStyle },
          colorCtl,
          sizeCtl,
          toolCtl,
          h('span', { style: { marginLeft: 'auto', opacity: 0.6 } }, `${meta.strokes} ${t('strokes')}`),
        ),
        h('div', { style: { ...barStyle, borderBottom: 'none', paddingTop: 0 } },
          opsCtl,
          h('span', { style: { marginLeft: 'auto', opacity: 0.45 } }, `rev ${revision}`),
        ),
        h('div', {
          style: {
            borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))',
            padding: '6px 8px',
            flex: '0 0 auto',
          },
        }, layersBlock(118)),
        error
          ? h('div', { style: { padding: '4px 8px', color: '#e5484d' } }, error)
          : null,
        viewportBlock,
      );
    }

    /** 设置里的画布页：尺寸、背景、缓存目录、保存路径，外加把当前画布另存成 PNG。 */
    function SettingsSection(props) {
      const t = props.t || ((k) => k);
      const compact = Boolean(props.compact);
      const openFn = props.onOpenTab || props.onOpenCanvas;
      const [state, setState] = React.useState(null);
      const [note, setNote] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [copied, setCopied] = React.useState(null);
      const [alpha, setAlpha] = React.useState(false);

      const read = React.useCallback(async () => {
        try {
          const r = await fetch(`${API}/config`, { cache: 'no-store' });
          const body = await r.json();
          if (body && body.ok) {
            setState({
              width: body.width,
              height: body.height,
              background: body.background,
              cacheDir: body.cacheDir || '',
              saveDir: body.saveDir || '',
              defaults: body.defaults || {},
            });
            return;
          }
          setNote((body && body.error) || t('settings.unreachable'));
        } catch {
          setNote(t('settings.unreachable'));
        }
      }, [t]);

      React.useEffect(() => {
        read();
      }, [read]);

      const patch = (key, value) => setState((prev) => (prev ? { ...prev, [key]: value } : prev));

      const save = async (values) => {
        if (!values) return;
        setBusy(true);
        setNote(null);
        try {
          const r = await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              width: values.width,
              height: values.height,
              background: values.background,
              cacheDir: values.cacheDir,
              saveDir: values.saveDir,
            }),
          });
          const body = await r.json();
          if (body && body.ok) {
            setState((prev) => (prev
              ? {
                ...prev,
                width: body.width,
                height: body.height,
                background: body.background,
                cacheDir: body.cacheDir || prev.cacheDir,
                saveDir: body.saveDir || prev.saveDir,
              }
              : prev));
            setNote(t('settings.saved'));
          } else {
            setNote((body && body.error) || t('settings.unreachable'));
          }
        } catch {
          setNote(t('settings.unreachable'));
        } finally {
          setBusy(false);
        }
      };

      /** 点预设就立刻改尺寸，不用再按保存。 */
      const applyPreset = (preset) => {
        if (!state) return;
        const next = { ...state, width: preset.w, height: preset.h };
        setState(next);
        save(next);
      };

      const exportPng = async () => {
        setBusy(true);
        setNote(null);
        try {
          const r = await fetch(`${API}/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transparent: alpha }),
          });
          const body = await r.json();
          if (body && body.ok) setNote(`${t('settings.exported')} ${body.path}`);
          else setNote((body && body.error) || t('settings.unreachable'));
        } catch {
          setNote(t('settings.unreachable'));
        } finally {
          setBusy(false);
        }
      };

      const copy = (value, key) => {
        if (!value) return;
        try {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(key);
            setTimeout(() => setCopied(null), 1500);
          }).catch(() => {});
        } catch {
          /* 剪贴板不可用时安静跳过 */
        }
      };

      const field = {
        width: 92,
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
      };
      const pathField = {
        ...field,
        flex: '1 1 auto',
        minWidth: 0,
        width: 'auto',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
      };
      const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' };
      const labelStyle = { minWidth: 84, opacity: 0.75 };
      const btn = {
        padding: '5px 12px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      };
      const unit = { opacity: 0.5, minWidth: 18 };

      const pathRow = (labelKey, valueKey, hintKey) => h('div', { style: { padding: '9px 0' } },
        h('div', { style: { opacity: 0.75, marginBottom: 4 } }, t(labelKey)),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('input', {
            type: 'text',
            spellCheck: false,
            value: state[valueKey] || '',
            style: pathField,
            onChange: (e) => patch(valueKey, e.target.value),
            placeholder: t('settings.pathHint'),
          }),
          h('button', { type: 'button', style: btn, onClick: () => copy(state[valueKey], valueKey) },
            copied === valueKey ? t('settings.copied') : t('settings.copy')),
        ),
        h('div', { style: { opacity: 0.5, fontSize: 12, paddingTop: 3 } }, t(hintKey)),
      );

      return h('div', {
        style: {
          padding: compact ? '0' : '4px 12px 20px',
          maxWidth: compact ? 'none' : 620,
          width: '100%',
          boxSizing: 'border-box',
          font: `${compact ? '12px' : '13px'}/1.5 system-ui, "Microsoft YaHei", sans-serif`,
          color: 'var(--dsw-alias-label-primary, inherit)',
        },
      },
        compact
          ? (openFn
            ? h('div', { style: { marginBottom: 8 } },
              h('button', {
                type: 'button',
                style: { ...btn, padding: '3px 10px', opacity: 0.8 },
                onClick: openFn,
              }, t('page.tab')))
            : null)
          : h('div', { style: { fontWeight: 600, marginBottom: 2 } }, t('title')),
        compact
          ? null
          : h('div', { style: { opacity: 0.6, marginBottom: 12 } }, t('settings.subtitle')),
        !compact && openFn
          ? h('div', { style: { marginBottom: 12 } },
            h('button', {
              type: 'button',
              style: { ...btn, padding: '6px 12px', fontWeight: 600 },
              onClick: openFn,
            }, `🎨 ${t('open')}`))
          : null,

        state === null
          ? h('div', { style: { opacity: 0.6, padding: '6px 0' } }, note || t('loading'))
          : h(React.Fragment, null,
            h('div', { style: { paddingBottom: 4 } },
              h('div', { style: { opacity: 0.75, marginBottom: 6 } }, t('settings.presets')),
              ...['ratio', 'paper', 'pixel'].map((group) => h('div', { key: group, style: { marginBottom: 8 } },
                h('div', { style: { opacity: 0.5, fontSize: 11, marginBottom: 4 } },
                  t(group === 'ratio' ? 'settings.presetRatio' : group === 'paper' ? 'settings.presetPaper' : 'settings.presetPixel')),
                h('div', {
                  style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 },
                },
                  CANVAS_PRESETS.filter((p) => p.group === group).map((p) => {
                    const active = String(state.width) === String(p.w) && String(state.height) === String(p.h);
                    return h('button', {
                      key: p.id,
                      type: 'button',
                      title: `${p.w}×${p.h}`,
                      disabled: busy,
                      onClick: () => applyPreset(p),
                      style: {
                        ...btn,
                        padding: '5px 4px',
                        textAlign: 'left',
                        borderColor: active
                          ? 'var(--dsw-alias-border-l3, rgba(127,127,127,0.7))'
                          : 'var(--dsw-alias-border-l1, rgba(127,127,127,0.28))',
                        background: active
                          ? 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.14))'
                          : 'transparent',
                        lineHeight: 1.25,
                      },
                    },
                      h('div', { style: { fontWeight: 600 } }, p.label),
                      h('div', { style: { opacity: 0.45, fontSize: 10 } }, `${p.w}×${p.h}`),
                    );
                  }),
                ),
              )),
              h('div', { style: { opacity: 0.5, fontSize: 11, paddingBottom: 4 } }, t('settings.presetHint')),
            ),
            h('div', { style: rowStyle },
              h('span', { style: labelStyle }, t('settings.size')),
              h('input', {
                type: 'number',
                min: 16,
                max: 4096,
                step: 1,
                value: state.width,
                style: field,
                onChange: (e) => patch('width', e.target.value),
              }),
              h('span', { style: unit }, '×'),
              h('input', {
                type: 'number',
                min: 16,
                max: 4096,
                step: 1,
                value: state.height,
                style: field,
                onChange: (e) => patch('height', e.target.value),
              }),
              h('span', { style: { opacity: 0.5 } }, 'px'),
            ),
            h('div', { style: rowStyle },
              h('span', { style: labelStyle }, t('settings.background')),
              h('input', {
                type: 'color',
                value: state.background || '#ffffff',
                onChange: (e) => patch('background', e.target.value),
                style: { width: 34, height: 24, padding: 0, border: 'none', background: 'none' },
              }),
              h('span', { style: { opacity: 0.5, fontFamily: 'ui-monospace, monospace' } }, state.background || '#ffffff'),
            ),
            pathRow('settings.dir', 'cacheDir', 'settings.dirHint'),
            pathRow('settings.saveDir', 'saveDir', 'settings.saveHint'),
            h('div', { style: { opacity: 0.55, fontSize: 12, paddingTop: 2 } }, t('settings.hint')),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, paddingTop: 10 } },
              h('input', {
                type: 'checkbox',
                checked: alpha,
                onChange: (e) => setAlpha(e.target.checked),
              }),
              h('span', null, t('settings.alpha')),
              h('span', { style: { opacity: 0.5, fontSize: 12 } }, t('settings.alphaHint')),
            ),
            h('div', { style: { display: 'flex', gap: 8, paddingTop: 14, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                style: { ...btn, fontWeight: 600 },
                disabled: busy,
                onClick: () => save(state),
              }, t('settings.save')),
              h('button', {
                type: 'button',
                style: btn,
                disabled: busy,
                onClick: () => {
                  const defaults = state.defaults || {};
                  const reset = {
                    width: defaults.width || 1024,
                    height: defaults.height || 1024,
                    background: defaults.background || '#ffffff',
                    cacheDir: state.cacheDir,
                    saveDir: state.saveDir,
                  };
                  setState((prev) => (prev ? { ...prev, ...reset } : prev));
                  save(reset);
                },
              }, t('settings.reset')),
              h('button', {
                type: 'button',
                style: btn,
                disabled: busy,
                onClick: exportPng,
              }, t('settings.export')),
            ),
            note
              ? h('div', {
                style: {
                  paddingTop: 10,
                  fontSize: 12,
                  wordBreak: 'break-all',
                  opacity: 0.8,
                },
              }, note)
              : null,
          ),
      );
    }

    /** 整页模式的入口：C1 标识条 + 下面一块大画板与右列工具。 */
    function WorkspacePage(props) {
      const t = props.t || ((k) => k);
      const onBack = props.onBack;
      const onOpenTab = props.onOpenTab;
      /** 顶栏按钮要能开到 CanvasPanel 里的弹窗，用这个桥传一下。 */
      const bridge = React.useRef({});
      const headBtn = {
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      };
      return h('div', {
        style: {
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--dsw-alias-label-primary, inherit)',
        },
      },
        // C1：左上角标识
        h('div', {
          style: {
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            height: 46,
            borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))',
          },
        },
          h('span', {
            style: { fontSize: 13, letterSpacing: 0.3, display: 'inline-flex', alignItems: 'baseline', gap: 1 },
          },
            h('span', { style: { opacity: 0.45, fontFamily: 'ui-monospace, monospace' } }, 'xenra.'),
            h('span', { style: { fontWeight: 700 } }, t('title')),
          ),
          h('span', {
            style: { opacity: 0.38, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, t('page.hint')),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8, flex: '0 0 auto' } },
            h('button', {
              type: 'button',
              style: { ...headBtn, fontWeight: 600 },
              onClick: () => {
                const fn = bridge.current && bridge.current.newPaint;
                if (typeof fn === 'function') fn();
              },
            }, `＋ ${t('page.new')}`),
            onOpenTab
              ? h('button', { type: 'button', style: headBtn, onClick: onOpenTab }, t('page.tab'))
              : null,
            onBack
              ? h('button', { type: 'button', style: headBtn, onClick: onBack }, `← ${t('page.back')}`)
              : null,
          ),
        ),
        // A1 画板 + 右列 B1/B2 都由 CanvasPanel 的整页排布给出
        h('div', { style: { flex: '1 1 auto', minHeight: 0, minWidth: 0 } },
          h(CanvasPanel, { ...props, t, variant: 'page', onOpenTab, bridge }),
        ),
      );
    }

    /** 左栏导航里的图标：一块画板加一支笔。 */
    function PanelIcon(props) {
      const size = (props && props.size) || 16;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'aria-hidden': true,
      },
        h('rect', { x: 3, y: 4.5, width: 18, height: 14, rx: 3, strokeWidth: 1.3, opacity: 0.8 }),
        h('path', { d: 'M6.8 15.2l3.4-3.6 2.2 2.2 2.6-3.2 2.4 3.1', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 8.4, cy: 8.2, r: 1.2, fill: 'currentColor', stroke: 'none' }),
      );
    }

    /** 引导页条目的图标：一块画布加一支笔，线条跟随主题色。 */
    function GuideArtwork() {
      return h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'aria-hidden': true,
      },
        h('rect', { x: 3, y: 4.5, width: 18, height: 13, rx: 3, strokeWidth: 1.3, opacity: 0.75 }),
        h('path', { d: 'M6.5 15.5c2.3-4.4 4.3-6.5 8-7.2', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('circle', { cx: 16.2, cy: 8.1, r: 1.5, fill: 'currentColor', stroke: 'none' }),
      );
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      // 纯算法露出，供离线自测（不影响装载）
      __pixel: { inkMask, blurMask, rdp, marchingSquares, stitchSegments, traceInk, kmeansColors, polygonArea, pointInPolygon, pathWidths, regionFills, thinning, skeletonPaths, chaikin, smoothPath, curvePts, fitBezier, bezierSample, bezierPoint, brushes: [...BRUSH_BY_ID.values()] },
      apply(ctx) {
        let t = (k) => k;
        try {
          ctx.effect(() => ctx.locale.register(NS, DICT));
          t = ctx.locale.bind(NS);
        } catch {
          t = (k) => k;
        }

        // 右栏「开始」页的入口行：guide 条目是引导页唯一的来源，没有它就不会出现在列表里。
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          multiple: false,
          priority: 'builtin',
          title: () => t('title'),
          guide: [{
            id: 'open',
            order: 15,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: GuideArtwork,
          }],
        }));

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, (props) => h(CanvasPanel, { ...props, t })));

        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
        }, () => t('title')));

        // 左栏导航多一行「画界」（排在插件、自动化任务之后）：点它就把中栏切成整页画板。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('title'),
          locale: NS,
        }, PanelIcon));

        // 中栏的整页内容：main 是 keyed slot，key 必须和 panellist 的 id 一致，宿主才会切过去。
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => {
            const safe = (fn) => () => {
              try {
                fn();
              } catch {
                /* 没有 layout / sidebarRight 时静默 */
              }
            };
            return {
              onBack: safe(() => ctx.layout.selectPanel(null)),
              onOpenTab: safe(() => ctx.sidebarRight.openTab(TAB_KIND, { params: {} })),
            };
          },
        }, (props) => h(WorkspacePage, { ...props, t })));
      },
    };
  },
});

