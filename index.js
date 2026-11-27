/**
 * @xenra/dsh-draworld — DSH 里的一块真画布。
 *
 * 为什么自己做：控制外部绘画软件时，笔迹只能靠合成输入，压感打不通、也没法结构化校验。
 * 自己持有画布后，一切变成数据：文档是 JSON，笔迹是点序列，渲染在前端，
 * 于是压感、粗细变化、撤销、导出、量化检查全都可控。
 *
 * 分工：
 *   - 宿主（本文件）：持有文档、落盘、广播版本、提供绘图工具、收前端渲染结果；
 *   - 前端（client.js）：把文档画到 <canvas>，接收鼠标绘制，并把渲染结果回传。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

export const name = "@xenra/dsh-draworld";

const SECTION_NAME = "canvas-paint";
const SECTION_ORDER = 61;

const DEFAULT_LAYER_NAME = "图层 1";
const UPDATE_REPO = "RUO-MO/dsh-draworld";
const BRUSH_IDS = [
  // 常规
  'round', 'hard', 'softround', 'ballpoint', 'marker', 'flat',
  // 勾线
  'liner', 'gpen', 'ink', 'outline', 'willow',
  // 铅笔 / 素描
  'pencil', 'sketch', 'charcoal', 'charcoalStick', 'chalk',
  // 水彩
  'watercolor', 'wash', 'wetedge', 'blender',
  // 水墨
  'inkbrush', 'hairbrush', 'drybrush',
  // 油画 / 厚涂
  'oil', 'impasto', 'palette',
  // 喷枪
  'airbrush', 'airhard', 'airnoise',
  // 特效
  'halftone', 'glow', 'sparkle',
];

const DEFAULT_DOC = {
  version: 2,
  width: 1024,
  height: 1024,
  background: "#ffffff",
  activeLayer: "l1",
  seq: 0,
  layers: [
    { id: "l1", name: DEFAULT_LAYER_NAME, visible: true, opacity: 1, blend: "normal", strokes: [] },
  ],
  redo: [],
};

/** 压回 0~1，非数字按 1 处理。 */
function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

/**
 * 只看文件头就认出 PNG / JPEG / WebP / GIF 并读出像素尺寸，不引图片解码库。
 * 认不出来就返回 null（宁可拒绝，也不要存一张渲染不出来的图）。
 */
function probeImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  // PNG：IHDR 宽高在 16..23 字节，大端
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width && height) return { ext: "png", mime: "image/png", width, height };
  }
  // JPEG：扫到 SOFn 就拿尺寸
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off += 1;
        continue;
      }
      const marker = buf[off + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      const len = buf.readUInt16BE(off + 2);
      if (len < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(off + 5);
        const width = buf.readUInt16BE(off + 7);
        if (width && height) return { ext: "jpg", mime: "image/jpeg", width, height };
      }
      off += 2 + len;
    }
  }
  // WebP：三种块各自带尺寸
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      const width = 1 + buf.readUIntLE(24, 3);
      const height = 1 + buf.readUIntLE(27, 3);
      if (width && height) return { ext: "webp", mime: "image/webp", width, height };
    }
    if (chunk === "VP8 " && buf.length > 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width && height) return { ext: "webp", mime: "image/webp", width, height };
    }
    if (chunk === "VP8L" && buf.length > 24) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width && height) return { ext: "webp", mime: "image/webp", width, height };
    }
  }
  // GIF：宽高在 6..9 字节，小端
  if (buf.toString("ascii", 0, 3) === "GIF") {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    if (width && height) return { ext: "gif", mime: "image/gif", width, height };
  }
  return null;
}

/** 由扩展名反推 MIME，图片路由用。 */
function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

/**
 * 把任何版本的文档规整成 v2：顶层 strokes（v1）搬进第一层，
 * 顺手给缺 seq 的老笔迹补上递增序号，redo 栈没有就补空数组。
 */
function migrateDoc(parsed = {}) {
  const width = Math.max(16, Math.min(4096, Number(parsed.width) || DEFAULT_DOC.width));
  const height = Math.max(16, Math.min(4096, Number(parsed.height) || DEFAULT_DOC.height));
  const background = typeof parsed.background === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.background)
    ? parsed.background.toLowerCase()
    : DEFAULT_DOC.background;

  let counter = 0;
  const normalizeLayer = (layer, index) => {
    const strokes = Array.isArray(layer.strokes) ? layer.strokes : [];
    for (const s of strokes) {
      if (typeof s.seq === "number") {
        counter = Math.max(counter, s.seq);
      } else {
        counter += 1;
        s.seq = counter;
      }
      if (!s.id) s.id = `s${s.seq}`;
    }
    return {
      id: String(layer.id || `l${index + 1}`),
      name: String(layer.name || `图层 ${index + 1}`),
      visible: layer.visible !== false,
      opacity: clamp01(layer.opacity),
      blend: layer.blend === "multiply" ? "multiply" : "normal",
      strokes,
      // 图片层：file 相对缓存目录（images/xxx.png），x/y/w/h 是它在画布上的落位
      image: layer.image && typeof layer.image.file === "string"
        ? {
          file: String(layer.image.file).slice(0, 200),
          x: Number(layer.image.x) || 0,
          y: Number(layer.image.y) || 0,
          w: Math.max(1, Number(layer.image.w) || 1),
          h: Math.max(1, Number(layer.image.h) || 1),
        }
        : undefined,
    };
  };

  const rawLayers = Array.isArray(parsed.layers) && parsed.layers.length > 0
    ? parsed.layers
    : [{ id: "l1", name: DEFAULT_LAYER_NAME, strokes: Array.isArray(parsed.strokes) ? parsed.strokes : [] }];
  const layers = rawLayers.map(normalizeLayer);

  const redo = Array.isArray(parsed.redo)
    ? parsed.redo.filter((entry) => entry && entry.stroke).slice(-200)
    : [];

  // 选区：有的文档没有这个字段；不合法就当没有选区
  let selection = null;
  if (parsed.selection && typeof parsed.selection === "object") {
    const kind = parsed.selection.type === "lasso" ? "lasso" : "rect";
    if (kind === "rect") {
      const r = parsed.selection.rect || {};
      const x = Math.max(0, Math.round(Number(r.x) || 0));
      const y = Math.max(0, Math.round(Number(r.y) || 0));
      const w = Math.min(width - x, Math.max(1, Math.round(Number(r.w) || width)));
      const h = Math.min(height - y, Math.max(1, Math.round(Number(r.h) || height)));
      selection = { type: "rect", rect: { x, y, w, h } };
    } else if (Array.isArray(parsed.selection.points) && parsed.selection.points.length >= 3) {
      selection = {
        type: "lasso",
        points: parsed.selection.points
          .map((p) => [Math.round(Number(p[0])), Math.round(Number(p[1]))])
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
      };
    }
  }

  return {
    version: 2,
    width,
    height,
    background,
    activeLayer: layers.some((l) => l.id === parsed.activeLayer) ? parsed.activeLayer : layers[layers.length - 1].id,
    seq: counter,
    layers,
    redo,
    selection,
  };
}

const PROTOCOL = `你可以用 \`paint_canvas\` 在界面里的一块真画布上作画，用户也能在同一块画布上画。

画布是**数据**而不是像素截图：文档由**图层**组成，每层是若干笔迹，每笔是一串带压感的点。
所以可以精确撤销/重做、可以分层编辑、可以让用户接着改。

工作方式（像人类画师那样）：
1. \`paint_canvas action=doc\` 先看画布尺寸、图层、已有笔迹和内容范围，别盲目落笔。
2. 分阶段画：草稿（大而淡）→ 铺色 → 细化 → 细节。阶段之间换图层更清楚，
   用 \`action=draw\` 带 \`layer="线稿"\` 这样的名字，图层不存在会自动建。
3. \`action=draw\` 提交一笔：points 给**稀疏控制点**即可（一条曲线 3~5 个点），
   每个点可选第三项作为压感 0~1；压感会让笔迹自然变粗变细，别自己塞几十个等压感的点。
   \`brush\` 可换笔刷（照画世界Pro 画笔库分八类，共 32 支）：常规 round/hard/softround/ballpoint/marker/flat；
   勾线 liner/gpen/ink/outline/willow；铅笔素描 pencil/sketch/charcoal/charcoalStick/chalk；
   水彩 watercolor/wash/wetedge/blender；水墨 inkbrush/hairbrush/drybrush；油画 oil/impasto/palette；
   喷枪 airbrush/airhard/airnoise；特效 halftone/glow/sparkle。\`taper=true\` 起收笔渐细，
   \`minSize\` 是最小笔宽比例（默认按笔刷给，0~1）。
   用法：描线用 liner/gpen/ink + taper，草稿用 pencil/sketch，排线用 charcoal，上色铺底用 wash/watercolor，
   大块厚涂用 oil/impasto，渐变和光晕用 airbrush/airnoise/glow，明确要画网点才用 halftone。
4. 每画几笔用 \`action=view\` 看一眼渲染结果（返回 PNG 路径、每层的包围盒与覆盖率），不要假设画对了。
   要贴脸看细节就带 \`rect=[x,y,w,h]\` 与 \`zoom=2~4\`；只看某一层就带 \`layer="线稿"\`。
5. 画错用 \`action=undo\` 撤掉最近一笔，撤多了用 \`action=redo\` 回来；要整幅重来才用 \`action=clear\`。
6. 图层不只是画布边界：\`action=layer layerOp=add name="上色"\` 建层，\`layerOp=set\` 改名字/显隐/\`layerOpacity\`/\`blend\`/\`locked\`，
   \`layerOp=select\` 切成当前层，\`layerOp=list\` 看全部（含每层的图片信息和笔迹数）。
   想让某层淡一点就 \`layerOpacity=0.4\`，想做叠加效果就 \`blend=multiply\`；把参考图那一层 \`locked=true\` 就盖不上去也擦不掉。
7. 图片当底稿：\`action=import path="D:\\\\ref\\\\pose.png"\` 会把图存进缓存目录的 images/ 并压成**最底层**（图层 1），
   默认 contain（整张居中放进画布）；之后正常 draw 就是描图。导入后图层里带 \`image\` 字段。
8. 画布本身也能改：\`action=canvas width=… height=… background=#rrggbb\`；\`action=export\` 把当前渲染另存成 PNG。

**最省事的复刻就两条命令**（不需要自己估坐标、算配色、找缺口）：
- \`action=copy style=anime\`（或 lineart / flat）：自动抽轮廓、按区域配主色、建「色块 / 线稿」两层，并顺带跑一次 compare，直接给出覆盖率；
- \`action=fix target=90 maxRounds=3\`：只看最漏的几块自动补描，到达标或没得补就停，返回每轮数字。
- \`action=fill x=… y=…\`：点一片区域就按 palette 填色（边界来自已有笔迹，也能手动给 color），不用一笔笔涂；
- \`action=select rect=[x,y,w,h]\` 或 \`points=[[x,y]…]\`（套索）把落笔限制在选区里，\`clearSelection=true\` 取消；
  改局部之前先设选区，就不会糊到整幅。
- \`action=trace mode="center"\` 走骨架中心线，适合线稿/细线参考图（默认 edge 沿墨迹边界）。

**复刻一张图**照这个闭环走，不要凭缩略图估坐标：
- \`action=ref rect=[x,y,w,h] zoom=2\` → read_image 看参考图那块细节；整张就用 \`action=ref\`（返回原图路径）。
- \`action=pick x=… y=…\` → 读参考图某点的颜色与透明度：\`ink=true\` 说明这点在线条上，\`ink=false\` 就是空白。
- \`action=trace\` → 参考图抽轮廓：返回一串折线 \`paths\`（画布坐标），每段直接当 \`draw\` 的 points，
  不用自己估坐标。\`threshold\` 调深浅（照片给 0.3~0.5）、\`tolerance\` 调概括程度（默认 2.5）。
- \`action=palette k=6\` → 参考图主色和占比，配色别猜 hex。
- \`action=view layer="线稿" rect=… zoom=2\` → 看自己画的那一块对不对。
- \`action=compare\` → 差分图（品红=参考有而你没画，青=你画多了）+ 数值（\`coveragePct\`、\`extraPct\`、\`meanColorDiff\`、\`topGaps\` 最漏的几块）。\`coveragePct\` 往 90+ 推，\`extraPct\` 压下去，就是收敛。
- 一笔要多处对称就用 \`mirror="x"\` 或 \`"y"\`；一次补很多笔用 \`batches=[…]\`。
- 大面积改写前先 \`action=snapshot label="上色前"\`，画崩了 \`action=restore\` 整幅回退（比逐笔 undo 干净）。

用户也可能同时在画布上画，所以落笔前先 doc 看一眼版本，必要时以最新内容为准。`;

/** 每个缓存目录只留一份内存文档（见 Document.forDir）。挂在 globalThis 上，插件被重新加载也能复用。 */
const DOC_REGISTRY = globalThis.__xenraDraworldDocs || new Map();
globalThis.__xenraDraworldDocs = DOC_REGISTRY;

/** 文档读写：单一 JSON 文件，写入用临时文件替换，避免半截文件。 */
class Document {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "doc.json");
    this.preview = path.join(dir, "preview.png");
    this.previewAlpha = path.join(dir, "preview-alpha.png");
    this.doc = null;
    this.revision = 0;
    this.writtenAt = 0;
    this.snapshots = [];
    this.snapSeq = 0;
    this.load();
    this.loadSnapshots();
  }

  /** 快照目录：模型动手前存一版，画崩了整幅回退（比逐笔 undo 干净）。 */
  get snapshotDir() {
    return path.join(this.dir, "snapshots");
  }

  loadSnapshots() {
    try {
      const listDir = this.snapshotDir;
      if (!existsSync(listDir)) return;
      const files = readdirSync(listDir).filter((f) => f.endsWith(".json")).sort();
      for (const f of files.slice(-6)) {
        const raw = JSON.parse(readFileSync(path.join(listDir, f), "utf8"));
        if (raw && raw.doc) {
          this.snapshots.push({ id: raw.id || f.replace(/\.json$/, ""), at: raw.at || 0, label: raw.label || "", revision: raw.revision || 0, doc: raw.doc, file: path.join(listDir, f) });
          this.snapSeq = Math.max(this.snapSeq, Number(String(raw.id || "").replace(/\D/g, "")) || 0);
        }
      }
    } catch {
      /* 快照坏了不影响画 */
    }
  }

  /** 存一版整幅快照：内存留一份，同时落盘（进程重启后还在）。 */
  snapshot(label) {
    this.snapSeq += 1;
    const id = `s${this.snapSeq}`;
    this.snapshots.push({ id, at: Date.now(), label: String(label || ""), revision: this.revision, doc: JSON.parse(JSON.stringify(this.doc)) });
    while (this.snapshots.length > 12) {
      const dropped = this.snapshots.shift();
      if (dropped && dropped.file) {
        try {
          rmSync(dropped.file, { force: true });
        } catch {
          /* 删不掉就算了 */
        }
      }
    }
    try {
      mkdirSync(this.snapshotDir, { recursive: true });
      const file = path.join(this.snapshotDir, `${id}.json`);
      writeFileSync(file, JSON.stringify({ id, at: Date.now(), label: String(label || ""), revision: this.revision, doc: this.doc }));
      this.snapshots[this.snapshots.length - 1].file = file;
    } catch {
      /* 落盘失败仍能用内存那份 */
    }
    return this.snapshots[this.snapshots.length - 1];
  }

  /** 整幅回到某一版快照（不给 id 就回最近一版）。 */
  restore(id) {
    const list = this.snapshots || [];
    if (list.length === 0) throw new Error("还没有快照：先 action=snapshot");
    const key = String(id || "").trim();
    const entry = key ? list.find((s) => s.id === key) : list[list.length - 1];
    if (!entry) throw new Error(`没有这版快照：${key}（现有 ${list.map((s) => s.id).join(" / ")}）`);
    this.doc = migrateDoc(JSON.parse(JSON.stringify(entry.doc)));
    this.bump();
    return entry;
  }

  /**
   * 同一个目录只保留一个实例：
   * 插件被重复加载（停用再启用、热重载）时，两个 Document 会各持一份内存文档，
   * 界面上读的是旧那份、模型画的是新那份，看起来就是「画了但界面不更新」。
   */
  static forDir(dir) {
    const key = path.resolve(dir);
    let rec = DOC_REGISTRY.get(key);
    if (!rec) {
      rec = new Document(key);
      DOC_REGISTRY.set(key, rec);
    }
    return rec;
  }

  /**
   * 磁盘上的 doc.json 比内存新（另一个进程/窗口刚画过）就整份接过来，
   * 保证落笔、撤销都发生在最新那份文档上。
   */
  syncFromDisk() {
    try {
      const st = statSync(this.file);
      if (st.mtimeMs <= this.writtenAt + 2) return false;
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      const rev = Number(parsed && parsed.revision) || 0;
      if (!parsed || rev <= this.revision) {
        this.writtenAt = st.mtimeMs;
        return false;
      }
      this.doc = migrateDoc(parsed);
      this.revision = rev;
      this.writtenAt = st.mtimeMs;
      return true;
    } catch {
      return false;
    }
  }

  load() {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && (Array.isArray(parsed.layers) || Array.isArray(parsed.strokes))) {
        this.doc = migrateDoc(parsed);
        this.revision = Number(parsed.revision) || 1;
        this.save(); // v1 文档读进来就立刻按 v2 落盘
        return;
      }
    } catch {
      /* 首次运行或文件损坏：重建 */
    }
    this.doc = migrateDoc({});
    this.revision = 1;
    this.save();
  }

  /** 把画布搬到另一个目录：新目录已有文档就读它，没有就把当前这份搬过去。 */
  relocate(nextDir) {
    const next = path.resolve(nextDir);
    if (next === this.dir) return false;
    const prevPreview = this.preview;
    const prevAlpha = this.previewAlpha;
    mkdirSync(next, { recursive: true });
    this.dir = next;
    this.file = path.join(next, "doc.json");
    this.preview = path.join(next, "preview.png");
    this.previewAlpha = path.join(next, "preview-alpha.png");
    if (existsSync(this.file)) {
      this.load();
      this.bump();
      return true;
    }
    // 新目录还没有画布：沿用当前文档，别把画丢了
    this.bump();
    try {
      if (existsSync(prevPreview)) copyFileSync(prevPreview, this.preview);
      if (existsSync(prevAlpha)) copyFileSync(prevAlpha, this.previewAlpha);
    } catch {
      /* 预览图搬不过去不影响画布本身 */
    }
    // 图片层引用的素材跟着文档一起搬，否则换个缓存目录就全是空白图
    try {
      const prevImages = path.join(path.dirname(prevPreview), "images");
      if (existsSync(prevImages)) cpSync(prevImages, this.imagesDir, { recursive: true });
    } catch {
      /* 素材没搬过去时，渲染会画不出图片，但文档本身不坏 */
    }
    return true;
  }

  save() {
    try {
      mkdirSync(this.dir, { recursive: true });
      const payload = JSON.stringify({ ...this.doc, revision: this.revision });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, payload, "utf8");
      writeFileSync(this.file, payload, "utf8");
      try {
        this.writtenAt = statSync(this.file).mtimeMs;
      } catch {
        this.writtenAt = Date.now();
      }
    } catch {
      /* 落盘失败不阻塞绘制 */
    }
  }

  bump() {
    this.revision += 1;
    this.save();
  }

  /** 按 id 或名字找一层。 */
  layer(idOrName) {
    const key = String(idOrName || "").trim();
    if (!key) return null;
    return this.doc.layers.find((l) => l.id === key) || this.doc.layers.find((l) => l.name === key) || null;
  }

  active() {
    return this.layer(this.doc.activeLayer) || this.doc.layers[this.doc.layers.length - 1];
  }

  /** 取一层；不给或没有就建同名层（模型按名字落笔时用）。 */
  ensureLayer(idOrName) {
    const key = String(idOrName || "").trim();
    if (!key) return this.active();
    const found = this.layer(key);
    if (found) return found;
    const layer = {
      id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name: key.slice(0, 40),
      visible: true,
      opacity: 1,
      blend: "normal",
      strokes: [],
    };
    this.doc.layers.push(layer);
    this.doc.activeLayer = layer.id;
    return layer;
  }

  /** 清空重开一幅：只保留画布尺寸和背景，图层回到一张空白。 */
  reset(input = {}) {
    const prevWidth = this.doc ? this.doc.width : DEFAULT_DOC.width;
    const prevHeight = this.doc ? this.doc.height : DEFAULT_DOC.height;
    const prevBackground = this.doc ? this.doc.background : DEFAULT_DOC.background;
    const clamp = (v, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(16, Math.min(4096, Math.round(n)));
    };
    this.doc = migrateDoc({
      width: clamp(input.width, prevWidth),
      height: clamp(input.height, prevHeight),
      background: input.background || prevBackground,
    });
    this.revision += 1;
    this.save();
    // 旧的渲染结果作废，否则 export / view 会拿到上一幅画
    for (const stale of [this.preview, this.previewAlpha]) {
      try {
        rmSync(stale, { force: true });
      } catch {
        /* 删不掉就算了，客户端下一帧会覆盖 */
      }
    }
    return this.doc;
  }

  /** 图片素材目录，跟着缓存目录走。 */
  get imagesDir() {
    return path.join(this.dir, "images");
  }

  /**
   * 把一张图片收进素材目录，并压成最底下的一层（相当于画世界里的「图层 1」）。
   * fit: contain（默认，整张放进画布并居中）| cover（铺满、超出部分裁掉）| stretch（拉满变形）。
   */
  importImage(input = {}) {
    const buf = Buffer.isBuffer(input.buffer) ? input.buffer : null;
    if (!buf || buf.length < 16) throw new Error("图片内容为空或不是本地文件");
    if (buf.length > 24 * 1024 * 1024) throw new Error("图片太大（上限 24MB）");
    const info = probeImage(buf);
    if (!info) throw new Error("只认 PNG / JPEG / WebP / GIF");
    mkdirSync(this.imagesDir, { recursive: true });
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    const fileName = `img-${stamp}-${rand}.${info.ext}`;
    writeFileSync(path.join(this.imagesDir, fileName), buf);

    const docW = this.doc.width;
    const docH = this.doc.height;
    const fit = input.fit === "cover" || input.fit === "stretch" ? input.fit : "contain";
    let w = docW;
    let h = docH;
    let x = 0;
    let y = 0;
    if (fit === "contain") {
      const scale = Math.min(docW / info.width, docH / info.height);
      w = Math.max(1, Math.round(info.width * scale));
      h = Math.max(1, Math.round(info.height * scale));
      x = Math.round((docW - w) / 2);
      y = Math.round((docH - h) / 2);
    } else if (fit === "cover") {
      const scale = Math.max(docW / info.width, docH / info.height);
      w = Math.max(1, Math.round(info.width * scale));
      h = Math.max(1, Math.round(info.height * scale));
      x = Math.round((docW - w) / 2);
      y = Math.round((docH - h) / 2);
    }

    const layer = {
      id: `l${stamp}${rand}`,
      name: String(input.name || "").trim().slice(0, 40) || "图片 1",
      visible: true,
      opacity: clamp01(input.opacity),
      blend: "normal",
      strokes: [],
      image: { file: path.posix.join("images", fileName), x, y, w, h },
    };
    this.doc.layers.unshift(layer); // 最底层
    this.doc.activeLayer = layer.id;
    this.bump();
    return {
      layer,
      image: { ...layer.image, sourceWidth: info.width, sourceHeight: info.height, mime: info.mime },
    };
  }

  addLayer(name) {
    const layer = {
      id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name: String(name || `图层 ${this.doc.layers.length + 1}`).trim().slice(0, 40) || `图层 ${this.doc.layers.length + 1}`,
      visible: true,
      opacity: 1,
      blend: "normal",
      strokes: [],
    };
    this.doc.layers.push(layer);
    this.doc.activeLayer = layer.id;
    this.bump();
    return layer;
  }

  updateLayer(idRef, patch = {}) {
    const layer = this.layer(idRef);
    if (!layer) throw new Error(`没有这一层：${idRef}`);
    if (typeof patch.name === "string" && patch.name.trim()) layer.name = patch.name.trim().slice(0, 40);
    if (patch.visible !== undefined) layer.visible = patch.visible !== false;
    if (patch.opacity !== undefined) layer.opacity = clamp01(patch.opacity);
    if (patch.blend !== undefined) layer.blend = patch.blend === "multiply" ? "multiply" : "normal";
    if (patch.locked !== undefined) layer.locked = patch.locked === true;
    if (patch.active === true) this.doc.activeLayer = layer.id;
    this.bump();
    return layer;
  }

  removeLayer(idRef) {
    if (this.doc.layers.length <= 1) throw new Error("至少留一层");
    const layer = this.layer(idRef);
    if (!layer) throw new Error(`没有这一层：${idRef}`);
    this.doc.layers = this.doc.layers.filter((l) => l !== layer);
    if (this.doc.activeLayer === layer.id) this.doc.activeLayer = this.doc.layers[this.doc.layers.length - 1].id;
    this.bump();
    return layer.id;
  }

  append(strokes, layerRef) {
    const layer = layerRef ? this.ensureLayer(layerRef) : this.active();
    if (layer.locked === true) throw new Error(`图层「${layer.name}」被锁定，画不上去；要动它先 action=layer layerOp=set locked=false`);
    const sel = this.doc.selection || null;
    let added = 0;
    for (const s of strokes) {
      // 有选区就只保留框内的点，一笔越界会被切成几段
      const parts = sel && s.mode !== "fill" ? clipPoints(s.points || [], sel) : [s.points];
      for (const points of parts) {
        if (!points || points.length < 2) continue;
        this.doc.seq += 1;
        added += 1;
        layer.strokes.push({
          id: `s${this.doc.seq}`,
          seq: this.doc.seq,
          color: s.color || "#111111",
          size: Number(s.size) || 8,
          opacity: s.opacity === undefined ? 1 : Number(s.opacity),
          mode: s.mode === "eraser" ? "eraser" : (s.mode === "fill" ? "fill" : "brush"),
          brush: BRUSH_IDS.includes(s.brush) ? s.brush : "round",
          taper: s.taper === true,
          minSize: s.minSize === undefined ? 0.3 : Math.max(0, Math.min(1, Number(s.minSize) || 0)),
          points,
        });
      }
    }
    this.doc.redo = [];
    this.lastAdded = added;
    this.bump();
    return layer;
  }

  /** 设/清选区：rect 或 lasso；不给就是全画布（等于清掉）。 */
  setSelection(sel) {
    if (!sel) {
      this.doc.selection = null;
      this.bump();
      return null;
    }
    this.doc.selection = sel;
    this.bump();
    return sel;
  }


  /** 清空：给层就只清那层，不给就整幅清空。 */
  clear(layerRef) {
    if (layerRef) {
      const layer = this.layer(layerRef);
      if (!layer) throw new Error(`没有这一层：${layerRef}`);
      layer.strokes = [];
    } else {
      for (const l of this.doc.layers) l.strokes = [];
    }
    this.doc.redo = [];
    this.bump();
  }

  /** 撤销：按全局 seq 找最后一笔，撤掉并压进 redo 栈。 */
  undo(n = 1) {
    let removed = 0;
    for (let i = 0; i < n; i += 1) {
      let best = null;
      for (const layer of this.doc.layers) {
        for (const s of layer.strokes) {
          if (!best || (s.seq || 0) > (best.stroke.seq || 0)) best = { layer, stroke: s };
        }
      }
      if (!best) break;
      best.layer.strokes = best.layer.strokes.filter((s) => s !== best.stroke);
      this.doc.redo = [...(this.doc.redo || []), { layerId: best.layer.id, stroke: best.stroke }].slice(-200);
      removed += 1;
    }
    if (removed > 0) this.bump();
    return removed;
  }

  redo(n = 1) {
    let done = 0;
    for (let i = 0; i < n; i += 1) {
      const entry = (this.doc.redo || []).pop();
      if (!entry) break;
      const layer = this.layer(entry.layerId) || this.active();
      layer.strokes.push(entry.stroke);
      layer.strokes.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      done += 1;
    }
    if (done > 0) this.bump();
    return done;
  }

  /** 内容范围（画布坐标系），用于回答"画到哪了"。 */
  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let points = 0;
    for (const layer of this.doc.layers) {
      for (const s of layer.strokes) {
        const r = (s.size || 8) / 2;
        for (const p of s.points || []) {
          points += 1;
          const x = Number(p[0]);
          const y = Number(p[1]);
          if (x - r < minX) minX = x - r;
          if (y - r < minY) minY = y - r;
          if (x + r > maxX) maxX = x + r;
          if (y + r > maxY) maxY = y + r;
        }
      }
    }
    if (!Number.isFinite(minX)) return null;
    return {
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(maxX - minX),
      h: Math.round(maxY - minY),
      points,
    };
  }

  /** 改画布尺寸/背景：只动画布本身，已有笔迹的坐标原样保留。 */
  configure(patch = {}) {
    const clamp = (v, lo, hi, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(lo, Math.min(hi, Math.round(n)));
    };
    let changed = false;
    if (patch.width !== undefined) {
      const w = clamp(patch.width, 16, 4096, this.doc.width);
      if (w !== this.doc.width) {
        this.doc.width = w;
        changed = true;
      }
    }
    if (patch.height !== undefined) {
      const h = clamp(patch.height, 16, 4096, this.doc.height);
      if (h !== this.doc.height) {
        this.doc.height = h;
        changed = true;
      }
    }
    if (typeof patch.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.background)) {
      const bg = patch.background.toLowerCase();
      if (bg !== this.doc.background) {
        this.doc.background = bg;
        changed = true;
      }
    }
    if (changed) this.bump();
    return changed;
  }

  summary() {
    const colors = new Set();
    let strokes = 0;
    let points = 0;
    const layers = this.doc.layers.map((l) => {
      strokes += l.strokes.length;
      points += l.strokes.reduce((n, s) => n + (s.points ? s.points.length : 0), 0);
      for (const s of l.strokes) colors.add(s.color);
      return {
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blend: l.blend,
        locked: l.locked === true,
        strokes: l.strokes.length,
        image: l.image ? { file: l.image.file, x: l.image.x, y: l.image.y, w: l.image.w, h: l.image.h } : null,
      };
    });
    return {
      width: this.doc.width,
      height: this.doc.height,
      background: this.doc.background,
      revision: this.revision,
      activeLayer: this.doc.activeLayer,
      strokes,
      points,
      colors: [...colors].slice(0, 12),
      bounds: this.bounds(),
      layers,
      selection: this.doc.selection || null,
      redo: (this.doc.redo || []).length,
      preview: existsSync(this.preview) ? this.preview : null,
      previewAlpha: existsSync(this.previewAlpha) ? this.previewAlpha : null,
    };
  }
}

/** 路径设置：缓存目录（画布工作区）与保存目录（导出 PNG），存在 rootDir/settings.json。 */
class PathSettings {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.file = path.join(rootDir, "settings.json");
    // saveDir 为 null 表示「跟随缓存目录」，即 <cacheDir>/exports
    this.values = { cacheDir: rootDir, saveDir: null };
    this.load();
  }

  /** 实际生效的保存目录。 */
  saveDir() {
    return this.values.saveDir || path.join(this.values.cacheDir, "exports");
  }

  /** 默认值（设置页「恢复默认」用）。 */
  defaults() {
    return {
      cacheDir: this.rootDir,
      saveDir: path.join(this.rootDir, "exports"),
    };
  }

  load() {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (raw && typeof raw === "object") {
        if (typeof raw.cacheDir === "string" && path.isAbsolute(raw.cacheDir)) this.values.cacheDir = raw.cacheDir;
        if (typeof raw.saveDir === "string" && path.isAbsolute(raw.saveDir)) this.values.saveDir = raw.saveDir;
      }
    } catch {
      /* 首次运行或文件损坏：用默认值 */
    }
  }

  save() {
    try {
      mkdirSync(this.rootDir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.values, null, 2), "utf8");
    } catch {
      /* 落盘失败不阻塞绘制 */
    }
  }

  /** 改路径：只接受绝对路径，先全部校验再建目录，失败抛错交给调用方。 */
  set(patch = {}) {
    const next = {};
    if (patch.cacheDir !== undefined) {
      const input = String(patch.cacheDir).trim();
      if (!input) throw new Error("cacheDir 不能为空");
      if (!path.isAbsolute(input)) throw new Error("cacheDir 需要绝对路径，例如 D:\\画布");
      next.cacheDir = path.resolve(input);
    }
    if (patch.saveDir !== undefined) {
      const input = String(patch.saveDir).trim();
      // 清空即回到默认：跟着缓存目录走
      if (!input) next.saveDir = null;
      else {
        if (!path.isAbsolute(input)) throw new Error("saveDir 需要绝对路径，例如 D:\\画布\\成品");
        next.saveDir = path.resolve(input);
      }
    }
    for (const value of Object.values(next)) if (value) mkdirSync(value, { recursive: true });
    Object.assign(this.values, next);
    if (Object.keys(next).length > 0) this.save();
    return next;
  }
}

/** 时间戳后缀：文件名用它排序，比毫秒数字好认。 */
function stampNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 插件自己的版本号：读同目录 package.json（插件被复制到 node_modules 后同样适用）。 */
function readLocalVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));
    return String(raw.version || "").trim();
  } catch {
    return "";
  }
}

/** 语义化版本比较：a>b 返回 1，相等 0，a<b 返回 -1；容忍 v 前缀与非数字段。 */
function compareVersion(a, b) {  const pa = String(a || "").replace(/^v/i, "").split(/[.\-+]/).map((v) => Number(v) || 0);
  const pb = String(b || "").replace(/^v/i, "").split(/[.\-+]/).map((v) => Number(v) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 用 git 查最新的 v* tag：绕过 Node fetch 的 TLS 信任问题（公司网络里很常见）。 */
function latestTagViaGit() {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["ls-remote", "--tags", `https://github.com/${UPDATE_REPO}.git`],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(new Error(`git ls-remote 失败：${(err && err.message) || err}`));
          return;
        }
        const tags = String(stdout || "")
          .split(/\r?\n/)
          .map((line) => (line.split("\t")[1] || "").trim())
          .filter((ref) => ref.startsWith("refs/tags/"))
          .map((ref) => ref.replace("refs/tags/", ""))
          .filter((tag) => !tag.endsWith("^{}") && /^v?\d/.test(tag));
        if (tags.length === 0) {
          reject(new Error("仓库里还没有 tag"));
          return;
        }
        tags.sort(compareVersion);
        resolve(tags[tags.length - 1]);
      },
    );
  });
}

/** rect 参数统一成分数形式：接受 [x,y,w,h] 或 {x,y,w,h}，缺省即整幅。 */
function parseRect(input, width, height) {
  let src = null;
  if (Array.isArray(input) && input.length >= 4) src = { x: input[0], y: input[1], w: input[2], h: input[3] };
  else if (input && typeof input === "object") src = input;
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const x = Math.max(0, Math.round(num(src && src.x, 0)));
  const y = Math.max(0, Math.round(num(src && src.y, 0)));
  const w = Math.max(1, Math.round(num(src && (src.w !== undefined ? src.w : src.width), width - x)));
  const h = Math.max(1, Math.round(num(src && (src.h !== undefined ? src.h : src.height), height - y)));
  return {
    x,
    y,
    w: Math.min(w, width - x),
    h: Math.min(h, height - y),
  };
}

/** 点在选区内？rect 直接比范围，lasso 用射线法。 */
function pointInSelection(x, y, sel) {
  if (!sel) return true;
  if (sel.type === "rect") {
    const r = sel.rect || {};
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  const pts = sel.points || [];
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

/** 按选区把一笔切成几段：选区外的点丢掉，落笔就「只画框内」。 */
function clipPoints(points, sel) {
  if (!sel) return [points];
  const runs = [];
  let cur = [];
  for (const p of points) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (pointInSelection(x, y, sel)) cur.push(p);
    else if (cur.length >= 2) {
      runs.push(cur);
      cur = [];
    } else {
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** 颜色亮度：挑「最像墨」的那一档当线色。支持 {rgb} 或 {hex}。 */
function lumOf(c) {
  if (!c) return 999;
  if (Array.isArray(c.rgb)) return 0.299 * c.rgb[0] + 0.587 * c.rgb[1] + 0.114 * c.rgb[2];
  const hex = String(c.hex || "").replace("#", "");
  if (hex.length < 6) return 999;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 每层的包围盒与「占了多少画布」，用来回答"哪块还没画"。 */
function layerDetails(docx) {
  const width = docx.width || 1024;
  const height = docx.height || 1024;
  const area = width * height;
  let images = 0;
  const layers = [];
  for (const layer of docx.layers) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let ink = 0;
    for (const s of layer.strokes || []) {
      const r = (Number(s.size) || 8) / 2;
      const pts = s.points || [];
      for (let i = 0; i < pts.length; i += 1) {
        const x = Number(pts[i][0]);
        const y = Number(pts[i][1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x - r < minX) minX = x - r;
        if (y - r < minY) minY = y - r;
        if (x + r > maxX) maxX = x + r;
        if (y + r > maxY) maxY = y + r;
        // 粗估涂到的面积：相邻点距离 × 笔宽
        if (i > 0) {
          const px = Number(pts[i - 1][0]);
          const py = Number(pts[i - 1][1]);
          if (Number.isFinite(px) && Number.isFinite(py)) ink += Math.hypot(x - px, y - py) * (r * 2);
        } else {
          ink += Math.PI * r * r;
        }
      }
    }
    if (layer.image && layer.image.w && layer.image.h) {
      const im = layer.image;
      minX = Math.min(minX, im.x);
      minY = Math.min(minY, im.y);
      maxX = Math.max(maxX, im.x + im.w);
      maxY = Math.max(maxY, im.y + im.h);
      ink += im.w * im.h;
      images += 1;
    }
    const has = Number.isFinite(minX);
    layers.push({
      id: layer.id,
      name: layer.name,
      kind: layer.image ? "image" : "draw",
      visible: layer.visible !== false,
      opacity: layer.opacity === undefined ? 1 : layer.opacity,
      blend: layer.blend || "normal",
      locked: layer.locked === true,
      strokes: (layer.strokes || []).length,
      bbox: has ? { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) } : null,
      inkPct: has ? Number(((Math.min(ink, area) / area) * 100).toFixed(1)) : 0,
      image: layer.image ? { file: layer.image.file, x: layer.image.x, y: layer.image.y, w: layer.image.w, h: layer.image.h } : null,
    });
  }
  return { width, height, images, layers, coveragePct: Number((layers.filter((l) => l.kind === "draw").reduce((n, l) => n + l.inkPct, 0)).toFixed(1)) };
}

/** 镜像一笔：x 轴镜像（左右对称）/ y 轴镜像（上下对称），坐标口径与画布一致。 */
function mirrorPoints(points, axis, width, height) {
  return points.map((p) => {
    const x = Number(p[0]);
    const y = Number(p[1]);
    return [axis === "x" ? Math.round(width - x) : Math.round(x), axis === "y" ? Math.round(height - y) : Math.round(y), p[2]];
  });
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 规范化点序列：[[x,y],[x,y,p]] → [{x,y,p}]，顺手挡掉明显越界的点。 */
function normalizePoints(points, width, height) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("stroke 至少需要 2 个点");
  if (points.length > 4000) throw new Error("点太多：给稀疏控制点即可（3~8 个）");
  return points.map((p) => {
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("点含非法坐标");
    const pressure = p.length > 2 ? Math.max(0.01, Math.min(1, Number(p[2]))) : 0.75;
    return [Math.round(x), Math.round(y), Number(pressure.toFixed(3))];
  });
}

/** 形状 → 点序列：和前端画线/矩形/椭圆用的是同一套几何（矩形、椭圆按折线闭合）。 */
function shapeToPoints(shape, points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("形状需要起止两个点");
  const a = [Number(points[0][0]), Number(points[0][1])];
  const last = points[points.length - 1];
  const b = [Number(last[0]), Number(last[1])];
  if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) {
    throw new Error("点含非法坐标");
  }
  const p = (x, y, pr = 0.9) => [Math.round(x), Math.round(y), pr];
  if (shape === "line") return [p(a[0], a[1]), p(b[0], b[1])];
  if (shape === "rect") {
    const x1 = Math.min(a[0], b[0]);
    const y1 = Math.min(a[1], b[1]);
    const x2 = Math.max(a[0], b[0]);
    const y2 = Math.max(a[1], b[1]);
    return [p(x1, y1), p(x2, y1), p(x2, y2), p(x1, y2), p(x1, y1)];
  }
  if (shape === "ellipse") {
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const rx = Math.abs(b[0] - a[0]) / 2;
    const ry = Math.abs(b[1] - a[1]) / 2;
    const out = [];
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const ang = (Math.PI * 2 * i) / steps;
      out.push(p(cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)));
    }
    return out;
  }
  throw new Error(`未知形状: ${shape}`);
}

export function apply(ctx, config = {}) {
  const tool = ctx.get ? ctx.get("tools") : ctx.tools;
  const prompt = ctx.get ? ctx.get("systemPrompt") : ctx.systemPrompt;
  const agents = ctx.get ? ctx.get("agents") : ctx.agents;
  let webServer = ctx.get ? ctx.get("webServer") : ctx.webServer;
  const rootDir = path.resolve(config.dir || path.join(process.cwd(), ".dsh-draworld"));
  const paths = new PathSettings(rootDir);
  let dir = paths.values.cacheDir;
  const docs = Document.forDir(dir);
  const disposers = [];
  const state = {
    toolOk: false,
    toolError: null,
    routeError: null,
    origin: null,
    // 默认按会话绑定：只有打开过画界的那个会话才看得见 paint_canvas。
    // 想退回旧行为（所有会话都有）就在插件配置里写 toolScope: "global"。
    scope: config.toolScope === "global" ? "global" : "session",
    // 版本自检：插件自己去 GitHub 看有没有新 Release，界面上给个提示
    update: { checkedAt: null, latest: null, hasUpdate: false, url: null, error: null, enabled: config.updateCheck !== false },
  };

  // ---- 像素任务队列 -----------------------------------------------------
  // 裁切、取色、差分这些活必须由前端算：浏览器早就把参考图解码进 <canvas> 了，
  // 宿主这边没有图像解码依赖，硬塞 @napi-rs/canvas 会让安装变重。
  // 流程：工具 execute 把任务塞进队列 → 前端 700ms 轮询取走 → 算完 POST 回来 → 这里转成工具输出。
  const PIXEL_TIMEOUT_MS = Math.max(1500, Number(config.pixelTimeout || 5000));
  const jobs = new Map();
  let jobSeq = 0;
  const jobStats = { done: 0, timeout: 0, failed: 0, queued: 0, last: null };

  const runPixelJob = (kind, params = {}, timeoutMs) => new Promise((resolve) => {
    jobSeq += 1;
    const id = `j${jobSeq}`;
    const limit = Math.max(1500, Number(timeoutMs) || PIXEL_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (!jobs.has(id)) return;
      jobs.delete(id);
      jobStats.timeout += 1;
      resolve({
        ok: false,
        error: `像素任务超时（${Math.round(limit / 1000)} 秒）：${kind}。需要在浏览器里打开画界面板，渲染与解码都在前端做`,
      });
    }, limit);
    jobs.set(id, {
      id,
      kind,
      params,
      at: Date.now(),
      settle: (payload) => {
        clearTimeout(timer);
        jobs.delete(id);
        resolve(payload);
      },
    });
    jobStats.queued += 1;
  });

  /** 前端来取任务：返回所有还没回结果的（前端自己按 id 去重）。 */
  const pendingJobs = () => [...jobs.values()].map((j) => ({ id: j.id, kind: j.kind, params: j.params, at: j.at }));

  const settleJob = (id, payload) => {
    const job = jobs.get(String(id || ""));
    if (!job) return false;
    if (payload && payload.ok) jobStats.done += 1;
    else if (payload && payload.error === "timeout") jobStats.timeout += 1;
    else jobStats.failed += 1;
    jobStats.last = { id: job.id, kind: job.kind, at: Date.now() };
    job.settle(payload || { ok: false, error: "前端没有回结果" });
    return true;
  };

  /** 前端回传的 PNG dataURL 落盘，返回可给 read_image 的绝对路径。 */
  const writePng = (dataUrl, prefix) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
    if (!m) throw new Error("前端回传的不是 PNG dataURL");
    const outDir = path.join(dir, "views");
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${prefix}-${stampNow()}-${jobSeq}.png`);
    writeFileSync(file, Buffer.from(m[1], "base64"));
    return file;
  };

  // ---- 版本自检 ---------------------------------------------------------
  const localVersion = String(config.version || "").trim() || readLocalVersion();
  let updateTimer = null;

  const checkUpdate = async () => {
    if (state.update.enabled === false) return state.update;
    let latest = null;
    let error = null;
    // 先问 git（不依赖 TLS 信任链，公司网络里 Node 的 fetch 常被中间证书拦掉）；
    // git 不可用时再退到 GitHub API。
    try {
      latest = await latestTagViaGit();
    } catch (gitErr) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
          signal: ctrl.signal,
          headers: { Accept: "application/vnd.github+json", "User-Agent": "@xenra/dsh-draworld" },
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const body = await res.json();
        latest = String(body.tag_name || "").replace(/^v/, "").trim() || null;
      } catch (err) {
        error = `${(gitErr && gitErr.message) || gitErr} / ${(err && err.message) || err}`;
      }
    }
    if (!latest) {
      state.update = { ...state.update, checkedAt: Date.now(), error: error || "没拿到版本信息" };
      return state.update;
    }
    const clean = String(latest).replace(/^v/, "").trim();
    state.update = {
      checkedAt: Date.now(),
      latest: clean,
      hasUpdate: Boolean(clean && localVersion && compareVersion(clean, localVersion) > 0),
      url: `https://github.com/${UPDATE_REPO}/releases/tag/v${clean}`,
      error: null,
      enabled: true,
      local: localVersion,
    };
    return state.update;
  };

  const scheduleUpdateCheck = () => {
    if (state.update.enabled === false) return;
    setTimeout(() => {
      checkUpdate().catch(() => {});
    }, 3000);
    updateTimer = setInterval(() => {
      checkUpdate().catch(() => {});
    }, 6 * 60 * 60 * 1000);
    if (updateTimer && typeof updateTimer.unref === "function") updateTimer.unref();
  };

  // ---- 会话绑定 ---------------------------------------------------------
  // DSH 的 agent 有自己的 ctx：把工具和提示词挂到 agent.ctx 上，就只影响那一个会话，
  // 不会像应用级 ctx 那样把「画布协议」塞进正在写代码的会话。
  let definition = null;
  const bound = new Map(); // sessionId -> { agent, disposers: [] }
  const wanted = new Set(); // 打开过画界的会话 id
  const detachTimers = new Map();

  const bindAgent = (agent) => {
    if (!agent || !agent.ctx || bound.has(agent.id)) return false;
    const list = [];
    try {
      if (agent.ctx.systemPrompt && typeof agent.ctx.systemPrompt.section === "function") {
        list.push(agent.ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: PROTOCOL }));
      }
    } catch (err) {
      state.toolError = `section: ${(err && err.message) || err}`;
    }
    try {
      if (definition && agent.ctx.tools && typeof agent.ctx.tools.register === "function") {
        list.push(agent.ctx.tools.register(definition));
      }
    } catch (err) {
      state.toolError = `register: ${(err && err.message) || err}`;
    }
    bound.set(agent.id, { agent, disposers: list });
    state.toolOk = list.length > 0;
    return true;
  };

  const unbindAgent = (sessionId) => {
    const rec = bound.get(sessionId);
    if (!rec) return false;
    for (const d of rec.disposers.reverse()) {
      try {
        d();
      } catch {
        /* 已经失效的注册不用管 */
      }
    }
    bound.delete(sessionId);
    state.toolOk = bound.size > 0;
    return true;
  };

  /** 前端打开画界时调用：把这个会话接上画布能力。 */
  const attachSession = (sessionId, meta = {}) => {
    const id = String(sessionId || "").trim();
    if (!id) return { ok: false, error: "需要 sessionId" };
    const timer = detachTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      detachTimers.delete(id);
    }
    wanted.add(id);
    const agent = agents && typeof agents.get === "function" ? agents.get(id) : null;
    const didBind = agent ? bindAgent(agent) : false;
    return { ok: true, sessionId: id, bound: didBind, pending: !agent, variant: meta.variant || null };
  };

  /** 前端关掉画界时调用：留 15 秒宽限，切标签时不会来回解绑/重绑。 */
  const detachSession = (sessionId) => {
    const id = String(sessionId || "").trim();
    if (!id) return { ok: false, error: "需要 sessionId" };
    wanted.delete(id);
    const timer = detachTimers.get(id);
    if (timer) clearTimeout(timer);
    detachTimers.set(id, setTimeout(() => {
      detachTimers.delete(id);
      if (!wanted.has(id)) unbindAgent(id);
    }, 15000));
    return { ok: true, sessionId: id, pendingDetach: true };
  };

  try {
    if (typeof ctx.on === "function") {
      const offCreated = ctx.on("agent/created", (payload) => {
        const agent = payload && payload.agent;
        if (agent && wanted.has(agent.id)) bindAgent(agent);
      });
      if (typeof offCreated === "function") disposers.push(offCreated);
      const offDisposed = ctx.on("agent/disposed", (payload) => {
        const agent = payload && payload.agent;
        if (agent) unbindAgent(agent.id);
      });
      if (typeof offDisposed === "function") disposers.push(offDisposed);
    }
  } catch (err) {
    state.toolError = `events: ${(err && err.message) || err}`;
  }

  // ---- 路由 -------------------------------------------------------------
  const mount = () => {
    if (!webServer) {
      state.routeError = "webServer 不可用";
      return;
    }
    try {
      state.origin = webServer.getOrigin();
    } catch (err) {
      state.routeError = `getOrigin 失败: ${(err && err.message) || err}`;
      return;
    }
    try {
      const dispose = webServer.register({
        kind: "prefix",
        path: "/canvas-api",
        handler: async (req, res) => {
          const url = new URL(req.url, "http://127.0.0.1");
          const route = url.pathname.replace(/^\/canvas-api/, "") || "/";
          // 别的窗口/进程刚画过就把内存换成磁盘上更新的那份（否则会拿旧文档覆盖新画）
          docs.syncFromDisk();

          if (route === "/attach" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              json(res, 200, { ok: true, ...attachSession(body.sessionId, body), scope: state.scope });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          if (route === "/detach" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              json(res, 200, { ok: true, ...detachSession(body.sessionId) });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }

          if (route === "/diagnostics" && req.method === "GET") {
            json(res, 200, {
              ok: true,
              api: 3,
              plugin: "@xenra/dsh-draworld",
              brushes: BRUSH_IDS.length,
              tools: { service: Boolean(tool), ok: state.toolOk, error: state.toolError },
              scope: { mode: state.scope, attached: [...wanted], bound: [...bound.keys()] },
              routes: { error: state.routeError, origin: state.origin },
              doc: {
                dir,
                revision: docs.revision,
                strokes: docs.summary().strokes,
                layers: docs.doc.layers.length,
              },
              preview: existsSync(docs.preview) ? docs.preview : null,
              previewAlpha: existsSync(docs.previewAlpha) ? docs.previewAlpha : null,
              jobs: { ...jobStats, pending: jobs.size },
              update: state.update,
            });
            return;
          }

          // 前端来取像素任务（裁切/取色/差分/主色），算完 POST 回 /job
          if (route === "/jobs" && req.method === "GET") {
            json(res, 200, { ok: true, revision: docs.revision, jobs: pendingJobs() });
            return;
          }
          if (route === "/job" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              const known = settleJob(body.id, body.result || body);
              json(res, known ? 200 : 404, { ok: known, error: known ? undefined : "没有这个任务（可能已经超时）" });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          // 主动查一次新版本（界面上点「检查更新」走这里）
          if (route === "/update" && (req.method === "GET" || req.method === "POST")) {
            try {
              const force = url.searchParams.get("force") === "1" || req.method === "POST";
              const result = force ? await checkUpdate() : state.update;
              json(res, 200, { ok: true, local: localVersion, ...result });
            } catch (err) {
              json(res, 500, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          if (route === "/doc" && req.method === "GET") {
            json(res, 200, {
              ok: true,
              api: 3,
              brushes: BRUSH_IDS.length,
              revision: docs.revision,
              doc: { ...docs.doc, revision: docs.revision },
              update: state.update,
              version: localVersion,
              pixelJobs: jobs.size,
            });
            return;
          }
          if (route === "/summary" && req.method === "GET") {
            // brushes 让前端能认出「宿主还是旧进程、笔刷没生效」这件事故（客户端刷新不换宿主）
            json(res, 200, { ok: true, ...docs.summary(), brushes: BRUSH_IDS.length, api: 3 });
            return;
          }
          // 设置页读的画布参数：尺寸、背景、缓存目录、保存目录
          if (route === "/config" && req.method === "GET") {
            json(res, 200, {
              ok: true,
              width: docs.doc.width,
              height: docs.doc.height,
              background: docs.doc.background,
              revision: docs.revision,
              cacheDir: dir,
              saveDir: paths.saveDir(),
              rootDir,
              followSaveDir: paths.values.saveDir === null,
              defaults: {
                width: DEFAULT_DOC.width,
                height: DEFAULT_DOC.height,
                background: DEFAULT_DOC.background,
                cacheDir: paths.defaults().cacheDir,
                saveDir: paths.defaults().saveDir,
              },
            });
            return;
          }
          if (route === "/config" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              const moved = paths.set({ cacheDir: body.cacheDir, saveDir: body.saveDir });
              if (moved.cacheDir !== undefined) {
                docs.relocate(moved.cacheDir);
                dir = docs.dir;
              }
              const changed = docs.configure(body);
              json(res, 200, {
                ok: true,
                changed,
                relocated: moved.cacheDir !== undefined,
                width: docs.doc.width,
                height: docs.doc.height,
                background: docs.doc.background,
                revision: docs.revision,
                cacheDir: dir,
                saveDir: paths.saveDir(),
              });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          // 把最近一次渲染另存到保存目录（可以要透明底那份）
          if (route === "/export" && req.method === "POST") {
            try {
              let transparent = false;
              try {
                const body = JSON.parse((await readBody(req)) || "{}");
                transparent = body.transparent === true;
              } catch {
                /* 空 body 就按带背景导出 */
              }
              const source = transparent ? docs.previewAlpha : docs.preview;
              if (!existsSync(source)) {
                json(res, 400, {
                  ok: false,
                  error: transparent
                    ? "还没有透明底的渲染结果：在右栏打开「画界」等一下渲染回传"
                    : "还没有渲染结果：先在右栏打开「画界」画一笔，渲染后会自动回传",
                });
                return;
              }
              const now = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
              const saveDir = paths.saveDir();
              mkdirSync(saveDir, { recursive: true });
              const target = path.join(saveDir, `画界-${stamp}${transparent ? "-alpha" : ""}.png`);
              copyFileSync(source, target);
              json(res, 200, { ok: true, path: target, saveDir, transparent });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          if (route === "/stroke" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              const strokes = Array.isArray(body.strokes) ? body.strokes : [body];
              const normalized = strokes.map((s) => ({
                color: typeof s.color === "string" ? s.color : "#111111",
                size: Math.max(1, Math.min(400, Number(s.size) || 8)),
                opacity: s.opacity === undefined ? 1 : Math.max(0.02, Math.min(1, Number(s.opacity))),
                mode: s.mode === "eraser" ? "eraser" : "brush",
                brush: s.brush,
                taper: s.taper === true,
                minSize: s.minSize,
                points: normalizePoints(s.points, docs.doc.width, docs.doc.height),
              }));
              const layer = docs.append(normalized, body.layer);
              json(res, 200, {
                ok: true,
                revision: docs.revision,
                added: normalized.length,
                layer: { id: layer.id, name: layer.name },
              });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          if (route === "/op" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              let result = null;
              if (body.op === "clear") {
                docs.clear(body.layer);
              } else if (body.op === "undo") {
                result = docs.undo(Math.max(1, Math.round(Number(body.count) || 1)));
              } else if (body.op === "redo") {
                result = docs.redo(Math.max(1, Math.round(Number(body.count) || 1)));
              } else if (body.op === "layer.add") {
                result = docs.addLayer(body.name);
              } else if (body.op === "layer.set") {
                result = docs.updateLayer(body.id, body.patch || body);
              } else if (body.op === "layer.remove") {
                result = docs.removeLayer(body.id);
              } else {
                json(res, 400, { ok: false, error: `未知操作: ${body.op}` });
                return;
              }
              json(res, 200, { ok: true, revision: docs.revision, result });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          // 图片层素材：前端按 doc.json 里的 file 取原图，二进制直出
          if (route.startsWith("/image/") && req.method === "GET") {
            try {
              const rel = decodeURIComponent(route.slice("/image/".length));
              const safe = path.normalize(rel).replace(/^[/\\]+/, "");
              if (safe.includes("..") || path.isAbsolute(safe)) throw new Error("非法路径");
              const file = path.join(dir, safe);
              if (!existsSync(file)) {
                json(res, 404, { ok: false, error: `没有这张图：${safe}` });
                return;
              }
              const buf = readFileSync(file);
              res.writeHead(200, {
                "Content-Type": mimeOf(file),
                "Cache-Control": "no-store",
                "Content-Length": buf.length,
              });
              res.end(buf);
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }

          // 新开一幅：先把当前渲染存成 PNG（可选），再重置画布；给图片就用图片尺寸建画布
          if (route === "/new" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              let savedPath = null;
              if (body.save === true) {
                if (!existsSync(docs.preview)) {
                  json(res, 400, {
                    ok: false,
                    error: "当前这幅还没有渲染结果，没法保存：先在界面里打开画界等一帧回传",
                  });
                  return;
                }
                const now = new Date();
                const pad = (n) => String(n).padStart(2, "0");
                const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                const saveDir = paths.saveDir();
                mkdirSync(saveDir, { recursive: true });
                savedPath = path.join(saveDir, `画界-${stamp}.png`);
                copyFileSync(docs.preview, savedPath);
              }
              let buffer = null;
              if (typeof body.path === "string" && body.path.trim()) {
                const file = path.resolve(body.path.trim());
                if (!existsSync(file)) throw new Error(`找不到文件：${file}`);
                buffer = readFileSync(file);
              } else if (typeof body.dataUrl === "string") {
                const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(body.dataUrl);
                if (!m) throw new Error("需要图片 dataURL");
                buffer = Buffer.from(m[1], "base64");
              }
              let info = null;
              if (buffer) {
                info = probeImage(buffer);
                if (!info) throw new Error("只认 PNG / JPEG / WebP / GIF");
              }
              const width = info ? Math.max(16, Math.min(4096, info.width)) : body.width;
              const height = info ? Math.max(16, Math.min(4096, info.height)) : body.height;
              docs.reset({ width, height, background: body.background });
              let picture = null;
              if (buffer) {
                const imp = docs.importImage({ buffer, name: body.name || "图片 1", fit: "contain" });
                // 空白那层改名成「绘画」并设为当前层，省掉一张空层
                const top = docs.layer("图层 1") || docs.addLayer("绘画");
                docs.updateLayer(top.id, { name: "绘画", active: true });
                picture = { imageLayer: imp.layer.name, drawLayer: "绘画" };
              }
              json(res, 200, {
                ok: true,
                revision: docs.revision,
                savedPath,
                width: docs.doc.width,
                height: docs.doc.height,
                background: docs.doc.background,
                picture,
                ...docs.summary(),
              });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }

          // 导入图片作为最底层（图层 1）：可以给 path，也可以给 dataUrl（前端选文件走这条）
          if (route === "/import" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              let buffer = null;
              if (typeof body.path === "string" && body.path.trim()) {
                const file = path.resolve(body.path.trim());
                if (!existsSync(file)) throw new Error(`找不到文件：${file}`);
                buffer = readFileSync(file);
              } else if (typeof body.dataUrl === "string") {
                const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(body.dataUrl);
                if (!m) throw new Error("需要图片 dataURL");
                buffer = Buffer.from(m[1], "base64");
              }
              if (!buffer) throw new Error("要么给 path（本机绝对路径），要么给 dataUrl");
              const fallbackName = typeof body.path === "string" && body.path.trim()
                ? path.basename(body.path, path.extname(body.path))
                : "";
              const result = docs.importImage({
                buffer,
                name: body.name || fallbackName,
                fit: body.fit,
                opacity: body.opacity,
              });
              json(res, 200, {
                ok: true,
                revision: docs.revision,
                layer: { id: result.layer.id, name: result.layer.name, opacity: result.layer.opacity },
                image: result.image,
                width: docs.doc.width,
                height: docs.doc.height,
              });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }

          // 前端把渲染结果回传：不用截屏、不依赖任何外部窗口
          if (route === "/preview" && req.method === "POST") {
            try {
              const body = JSON.parse((await readBody(req)) || "{}");
              const m = /^data:image\/png;base64,(.+)$/.exec(body.dataUrl || "");
              if (!m) {
                json(res, 400, { ok: false, error: "需要 PNG dataURL" });
                return;
              }
              mkdirSync(dir, { recursive: true });
              writeFileSync(docs.preview, Buffer.from(m[1], "base64"));
              // 透明底那份可选：同一帧渲染两遍，省一次往返
              const alpha = /^data:image\/png;base64,(.+)$/.exec(body.alphaDataUrl || "");
              let alphaPath = null;
              if (alpha) {
                writeFileSync(docs.previewAlpha, Buffer.from(alpha[1], "base64"));
                alphaPath = docs.previewAlpha;
              }
              json(res, 200, { ok: true, path: docs.preview, alphaPath });
            } catch (err) {
              json(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
            return;
          }
          json(res, 404, { ok: false, error: "no such canvas route" });
        },
      });
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (err) {
      state.routeError = `注册 canvas-api 失败: ${(err && err.message) || err}`;
    }
  };

  // ---- 工具 -------------------------------------------------------------
  definition = {
    name: "paint_canvas",
    description:
      "在 DSH 界面里的真画布上作画。画布由分层数据构成（每层是带压感的点序列，或一张导入的图片），用户可以同时在同一块画布上画。" +
      "action=doc 看画布摘要；draw 提交一笔（layer 指定图层，不存在会自动建；shape 可画直线/矩形/椭圆，batches 一次多笔）；" +
      "view 取最新渲染结果（rect 裁切、zoom 放大、layer 只看单层，并给每层的包围盒与覆盖率）；" +
      "ref 把参考图（或它的一块裁切）导出成 PNG，用 read_image 直接看；pick 读某点的颜色/透明度；" +
      "compare 出「当前画面 vs 参考图」的差分图和数值；palette 提参考图主色；" +
      "snapshot / restore 整幅存档与回退；undo / redo 撤销重做；clear 清空（给 layer 只清那层）；" +
      "layer 增删改图层（name/visible/layerOpacity/blend/locked）；" +
      "import 把本机图片导入成最底下的图片层（path 或 dataUrl）；canvas 改画布尺寸和背景；export 把当前渲染另存成 PNG。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["doc", "copy", "fix", "fill", "draw", "view", "ref", "trace", "pick", "compare", "palette", "select", "snapshot", "restore", "undo", "redo", "clear", "layer", "import", "canvas", "export", "new"],
          description: "要执行的动作。new 是另起一幅（可先保存当前、也可用图片建画布）。",
        },
        points: {
          type: "array",
          description: "draw: 画布像素控制点 [[x,y],[x,y,pressure0to1],…]，给稀疏控制点即可（3~8 个）；shape 模式下只取首尾两点作为起止。",
          items: { type: "array", items: { type: "number" } },
        },
        shape: {
          type: "string",
          enum: ["line", "rect", "ellipse"],
          description: "draw: 画直线/矩形/椭圆，points 只给两个对角点即可。",
        },
        color: { type: "string", description: "draw: 颜色，#rrggbb，默认 #111111。" },
        size: { type: "number", description: "draw: 笔宽（画布像素），默认 8。压感会在此基础上缩放。" },
        opacity: { type: "number", description: "draw: 这一笔的不透明度 0.02..1，默认 1。" },
        brush: {
          type: "string",
          enum: BRUSH_IDS,
          description:
            "draw: 笔刷 id，照画世界Pro 的画笔库分八类："
            + "常规 round 圆头 / hard 硬边圆 / softround 软边圆 / ballpoint 圆珠笔 / marker 马克笔 / flat 平头；"
            + "勾线 liner 勾线笔 / gpen G笔 / ink 墨水笔 / outline 描边笔 / willow 柳叶笔；"
            + "铅笔素描 pencil 铅笔 / sketch 素描铅笔 / charcoal 炭笔 / charcoalStick 炭条 / chalk 粉笔；"
            + "水彩 watercolor 水彩笔 / wash 铺色 / wetedge 湿边 / blender 晕染；"
            + "水墨 inkbrush 水墨毛笔 / hairbrush 尖锋毛笔 / drybrush 干笔；"
            + "油画 oil 油画笔 / impasto 厚涂 / palette 刮刀；"
            + "喷枪 airbrush 软喷枪 / airhard 硬喷枪 / airnoise 噪点喷枪；"
            + "特效 halftone 漫画网点 / glow 光效 / sparkle 粒子。默认 round。",
        },
        taper: { type: "boolean", description: "draw: 起收笔渐细（手绘感），默认 false。" },
        minSize: {
          type: "number",
          description: "draw: 最小笔宽占 size 的比例 0..1，默认 0.3；压力最轻时也不会细成一条线。",
        },
        eraser: { type: "boolean", description: "draw: 用橡皮（在图层上擦成透明，露出下层）。" },
        layer: {
          type: "string",
          description: "draw / clear / layer: 图层 id 或名字，比如「线稿」「上色」。不填就是当前图层。",
        },
        layerOp: {
          type: "string",
          enum: ["list", "add", "select", "set", "remove"],
          description: "layer: list 列图层（默认）；add 新建；select 设为当前；set 改属性；remove 删掉。",
        },
        name: {
          type: "string",
          description: "layer.add：新层名字；layer.set：改名；import：图片层名字（默认「图片 1」）。",
        },
        visible: { type: "boolean", description: "layer.set：这层显不显示。" },
        layerOpacity: {
          type: "number",
          description: "layer.set / import：图层不透明度 0..1（1 不透明，0.3 很淡）。",
        },
        blend: {
          type: "string",
          enum: ["normal", "multiply"],
          description: "layer.set：混合模式，multiply 是正片叠底。",
        },
        path: {
          type: "string",
          description: "import: 本机图片的绝对路径（PNG/JPEG/WebP/GIF）。",
        },
        dataUrl: { type: "string", description: "import: 图片 dataURL，和 path 二选一。" },
        fit: {
          type: "string",
          enum: ["contain", "cover", "stretch"],
          description: "import: 落位方式，默认 contain（整张居中放进画布）。",
        },
        width: { type: "number", description: "canvas: 新宽度 16~4096。" },
        height: { type: "number", description: "canvas: 新高度 16~4096。" },
        background: { type: "string", description: "canvas: 背景色 #rrggbb。" },
        transparent: { type: "boolean", description: "export: 导出透明底那份（需要界面回传过透明帧）。" },
        save: {
          type: "boolean",
          description: "new: 先把当前这幅保存成 PNG（落到保存路径），再重置画布。",
        },
        count: { type: "number", description: "undo / redo: 处理几笔，默认 1。" },
        rect: {
          type: "array",
          description: "view / ref / pick / compare / palette: 关注的区域 [x,y,w,h]（画布像素）。不给就是整幅；复刻时用它能贴脸看五官、转角、衣褶。",
          items: { type: "number" },
        },
        zoom: {
          type: "number",
          description: "view / ref: 裁切后放大到多少倍（1=原像素，2=看见像素块），默认 1，上限 8。配合 rect 用。",
        },
        batches: {
          type: "array",
          description: "draw: 一次提交多笔 [[{points,color,size,brush,…},…]]，省往返；每笔字段和单笔 draw 一样。",
          items: { type: "object", additionalProperties: true },
        },
        mirror: {
          type: "string",
          enum: ["x", "y"],
          description: "draw: 同时镜像画一笔，x=左右对称、y=上下对称（复刻人像/建筑用）。",
        },
        x: { type: "number", description: "pick: 要读颜色的点 x（画布像素）。" },
        y: { type: "number", description: "pick: 要读颜色的点 y（画布像素）。" },
        on: {
          type: "string",
          enum: ["ref", "canvas"],
          description: "pick / compare / palette: 读参考图（默认，第一个图片层）还是读当前画面。",
        },
        threshold: {
          type: "number",
          description: "trace: 墨迹阈值 0~1（越大越只抓深色），默认 0.45。照片类参考图给 0.3~0.5。",
        },
        tolerance: {
          type: "number",
          description: "trace: 折线简化容差（像素），默认 2.5。大一点更概括，小一点更贴边。",
        },
        minLength: { type: "number", description: "trace: 丢掉的短线段长度下限（像素），默认 12，用来滤掉噪点。" },
        maxLines: { type: "number", description: "trace: 最多返回几条折线，默认 80。" },
        style: {
          type: "string",
          enum: ["lineart", "flat", "anime"],
          description: "copy: 复刻风格。lineart 只出线稿；flat 只出区域色块；anime 出线稿+色块（默认）。",
        },
        colors: { type: "number", description: "copy / palette: 主色档数 2~8，默认 6。" },
        minFill: { type: "number", description: "copy: 小于多少像素的闭合区域不填色，默认 320。" },
        target: { type: "number", description: "fix: 目标覆盖率百分比，默认 90。到了就停。" },
        maxRounds: { type: "number", description: "fix: 最多迭代几轮，默认 3（上限 5）。" },
        refLayer: { type: "string", description: "copy / fix: 用哪一个图片层当参考图，默认第一张可见图片层。" },
        mode: {
          type: "string",
          enum: ["edge", "center"],
          description: "trace: edge 沿墨迹边界（默认，照片/色块用）；center 取骨架中心线（线稿/细线用，描出来更贴原线宽）。",
        },
        clearSelection: {
          type: "boolean",
          description: "select: 清掉选区，恢复整幅可画。",
        },
        k: { type: "number", description: "palette: 要几档主色，默认 6（上限 8）。" },
        snapshotId: { type: "string", description: "restore: 回退到哪一版快照（snapshot 返回的 id）；不给回最近一版。" },
        label: { type: "string", description: "snapshot: 这版备注，比如「上色前」。" },
        locked: { type: "boolean", description: "layer.set：锁定这层（参考图锁住，模型就盖不上去，也不会被误擦）。" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const action = args && args.action;
      docs.syncFromDisk();
      try {
        switch (action) {
          case "new": {
            let savedPath = null;
            if (args.save === true) {
              if (!existsSync(docs.preview)) {
                throw new Error("当前这幅还没有渲染结果，没法保存：先在界面里打开画界等一帧回传");
              }
              const now = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
              const saveDir = paths.saveDir();
              mkdirSync(saveDir, { recursive: true });
              savedPath = path.join(saveDir, `画界-${stamp}.png`);
              copyFileSync(docs.preview, savedPath);
            }
            let buffer = null;
            if (typeof args.path === "string" && args.path.trim()) {
              const file = path.resolve(args.path.trim());
              if (!existsSync(file)) throw new Error(`找不到文件：${file}`);
              buffer = readFileSync(file);
            } else if (typeof args.dataUrl === "string") {
              const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(args.dataUrl);
              if (!m) throw new Error("需要图片 dataURL");
              buffer = Buffer.from(m[1], "base64");
            }
            let info = null;
            if (buffer) {
              info = probeImage(buffer);
              if (!info) throw new Error("只认 PNG / JPEG / WebP / GIF");
            }
            const width = info ? Math.max(16, Math.min(4096, info.width)) : args.width;
            const height = info ? Math.max(16, Math.min(4096, info.height)) : args.height;
            docs.reset({ width, height, background: args.background });
            let picture = null;
            if (buffer) {
              const imp = docs.importImage({ buffer, name: args.name || "图片 1", fit: "contain" });
              const top = docs.layer("图层 1") || docs.addLayer("绘画");
              docs.updateLayer(top.id, { name: "绘画", active: true });
              picture = { imageLayer: imp.layer.name, drawLayer: "绘画" };
            }
            return {
              ok: true,
              revision: docs.revision,
              savedPath,
              picture,
              ...docs.summary(),
              hint: picture
                ? "新画布按图片尺寸建好，图片在最底层，上面「绘画」是当前层，直接 draw 就是描图。"
                : "空白画布已经开好，直接 draw 落笔。",
            };
          }
          case "doc":
            return { ok: true, ...docs.summary(), dir };
          case "draw": {
            const W = docs.doc.width;
            const H = docs.doc.height;
            const batch = Array.isArray(args.batches) ? args.batches : null;
            const list = [];
            if (batch) {
              if (batch.length === 0) throw new Error("batches 是空的");
              if (batch.length > 200) throw new Error("一次最多 200 笔，多了分几次");
              for (const item of batch) {
                const src = item && item.shape ? shapeToPoints(item.shape, item.points) : (item && item.points);
                const points = normalizePoints(src, W, H);
                list.push({
                  color: item.color || args.color || "#111111",
                  size: item.size || args.size || 8,
                  opacity: item.opacity === undefined ? (args.opacity === undefined ? 1 : args.opacity) : item.opacity,
                  mode: (item.eraser === true || args.eraser) ? "eraser" : "brush",
                  brush: item.brush || args.brush,
                  taper: item.taper === undefined ? args.taper === true : item.taper === true,
                  minSize: item.minSize === undefined ? args.minSize : item.minSize,
                  points,
                });
              }
            } else {
              const source = args.shape ? shapeToPoints(args.shape, args.points) : args.points;
              const points = normalizePoints(source, W, H);
              list.push({
                color: args.color || "#111111",
                size: args.size || 8,
                opacity: args.opacity === undefined ? 1 : args.opacity,
                mode: args.eraser ? "eraser" : "brush",
                brush: args.brush,
                taper: args.taper === true,
                minSize: args.minSize,
                points,
              });
            }
            // 镜像：一笔画两边（对称复刻人像/建筑）
            const axis = args.mirror === "x" || args.mirror === "y" ? args.mirror : null;
            const strokes = axis ? list.concat(list.map((s) => ({ ...s, points: mirrorPoints(s.points, axis, W, H) }))) : list;
            const layer = docs.append(strokes, args.layer);
            return {
              ok: true,
              revision: docs.revision,
              layer: { id: layer.id, name: layer.name },
              added: strokes.length,
              ...docs.summary(),
            };
          }
          case "layer": {
            const op = args.layerOp || "list";
            // 层既能用 id 也能用名字：模型常把 add 返回的 id 直接塞回来，这里都认
            const target = args.layer !== undefined ? args.layer : (args.layerId !== undefined ? args.layerId : args.id);
            if (op === "list") {
              return { ok: true, revision: docs.revision, active: docs.doc.activeLayer, layers: docs.summary().layers };
            }
            if (op === "add") {
              const layer = docs.addLayer(args.name);
              return { ok: true, revision: docs.revision, layer: { id: layer.id, name: layer.name }, layers: docs.summary().layers };
            }
            if (op === "select") {
              const layer = docs.layer(target);
              if (!layer) throw new Error(`没有这一层：${target}`);
              docs.doc.activeLayer = layer.id;
              docs.bump();
              return { ok: true, revision: docs.revision, active: layer.id, layers: docs.summary().layers };
            }
            if (op === "set") {
              const patch = {};
              if (args.name !== undefined) patch.name = args.name;
              if (args.visible !== undefined) patch.visible = args.visible;
              if (args.layerOpacity !== undefined) patch.opacity = args.layerOpacity;
              if (args.blend !== undefined) patch.blend = args.blend;
              if (args.locked !== undefined) patch.locked = args.locked === true;
              const layer = docs.updateLayer(target, patch);
              return {
                ok: true,
                revision: docs.revision,
                layer: {
                  id: layer.id,
                  name: layer.name,
                  visible: layer.visible,
                  opacity: layer.opacity,
                  blend: layer.blend,
                  locked: layer.locked === true,
                },
                layers: docs.summary().layers,
              };
            }
            if (op === "remove") {
              const removed = docs.removeLayer(target);
              return { ok: true, revision: docs.revision, removed, layers: docs.summary().layers };
            }
            throw new Error(`未知 layerOp: ${op}`);
          }
          case "import": {
            let buffer = null;
            if (typeof args.path === "string" && args.path.trim()) {
              const file = path.resolve(args.path.trim());
              if (!existsSync(file)) throw new Error(`找不到文件：${file}`);
              buffer = readFileSync(file);
            } else if (typeof args.dataUrl === "string") {
              const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(args.dataUrl);
              if (!m) throw new Error("需要图片 dataURL");
              buffer = Buffer.from(m[1], "base64");
            }
            if (!buffer) throw new Error("import 需要 path（本机绝对路径）或 dataUrl");
            const fallbackName = args.path
              ? path.basename(String(args.path), path.extname(String(args.path)))
              : "";
            const result = docs.importImage({
              buffer,
              name: args.name || fallbackName,
              fit: args.fit,
              opacity: args.layerOpacity,
            });
            return {
              ok: true,
              revision: docs.revision,
              layer: { id: result.layer.id, name: result.layer.name },
              image: result.image,
              ...docs.summary(),
              hint: "图片已经压成最底层（图层 1）；之后 draw 落到的默认图层在它上面，直接画就是描图效果。",
            };
          }
          case "canvas": {
            const changed = docs.configure({ width: args.width, height: args.height, background: args.background });
            return {
              ok: true,
              revision: docs.revision,
              changed,
              width: docs.doc.width,
              height: docs.doc.height,
              background: docs.doc.background,
            };
          }
          case "export": {
            const source = args.transparent ? docs.previewAlpha : docs.preview;
            if (!existsSync(source)) {
              throw new Error(args.transparent
                ? "还没有透明底渲染：先在界面里打开画界，等前端回传一帧"
                : "还没有渲染结果：先在界面里打开画界画一笔，前端会把渲染回传");
            }
            const now = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const saveDir = paths.saveDir();
            mkdirSync(saveDir, { recursive: true });
            const target = path.join(saveDir, `画界-${stamp}${args.transparent ? "-alpha" : ""}.png`);
            copyFileSync(source, target);
            return { ok: true, path: target, saveDir, transparent: Boolean(args.transparent) };
          }
          case "undo":
            docs.undo(Math.max(1, Math.round(Number(args.count) || 1)));
            return { ok: true, revision: docs.revision, ...docs.summary() };
          case "redo":
            docs.redo(Math.max(1, Math.round(Number(args.count) || 1)));
            return { ok: true, revision: docs.revision, ...docs.summary() };
          case "clear":
            // layer 给 id/名字就只清那层；给 all/* 或干脆不给就整幅清空
            docs.clear(args.layer && args.layer !== "all" && args.layer !== "*" ? args.layer : undefined);
            return { ok: true, revision: docs.revision, ...docs.summary() };
          case "view": {
            const s = docs.summary();
            const detail = layerDetails(docs.doc);
            const rect = parseRect(args.rect, docs.doc.width, docs.doc.height);
            const wantCrop = Boolean(args.rect || args.layer || (args.zoom && args.zoom !== 1));
            if (!wantCrop) {
              return {
                ok: true,
                revision: docs.revision,
                preview: s.preview,
                previewAlpha: s.previewAlpha,
                hasPreview: Boolean(s.preview),
                width: docs.doc.width,
                height: docs.doc.height,
                strokes: s.strokes,
                points: s.points,
                bounds: s.bounds,
                layers: detail.layers,
                layersSummary: s.layers,
                hint: s.preview
                  ? "用 read_image 看这个 PNG；要贴脸看细节就带 rect=[x,y,w,h] 与 zoom=2~4，只看某一层就带 layer=\"线稿\"。"
                  : "还没有渲染结果：在界面里打开「画界」标签页后，渲染会自动回传。",
              };
            }
            const job = await runPixelJob("crop", {
              rect,
              zoom: args.zoom === undefined ? 1 : Number(args.zoom),
              layer: args.layer === undefined ? null : args.layer,
            });
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            const file = writePng(job.dataUrl, "view");
            return {
              ok: true,
              revision: docs.revision,
              path: file,
              rect,
              zoom: job.zoom,
              layer: job.layer,
              width: job.width,
              height: job.height,
              layers: detail.layers,
              hint: "用 read_image 看这个 PNG；它就是这块区域按 " + job.zoom + " 倍渲染的样子。",
            };
          }
          case "ref": {
            const detail = layerDetails(docs.doc);
            const wanted = args.layer !== undefined ? args.layer : null;
            const target = wanted
              ? detail.layers.find((l) => l.kind === "image" && (l.id === wanted || l.name === wanted))
              : detail.layers.find((l) => l.kind === "image" && l.visible);
            if (!target) throw new Error(wanted ? `没有这个图片层：${wanted}` : "画布上还没有图片层，先 action=import");
            const copy = path.resolve(dir, target.image.file);
            if (!existsSync(copy)) throw new Error(`参考图文件不在了：${copy}`);
            const rect = parseRect(args.rect, docs.doc.width, docs.doc.height);
            const wantCrop = Boolean(args.rect || (args.zoom && args.zoom !== 1));
            if (!wantCrop) {
              return {
                ok: true,
                revision: docs.revision,
                path: copy,
                layer: { id: target.id, name: target.name },
                placement: target.image,
                size: { width: Math.round(target.image.w), height: Math.round(target.image.h) },
                hint: "这就是参考图原文件，用 read_image 直接看；要看某一块就带 rect=[x,y,w,h]。",
              };
            }
            const job = await runPixelJob("ref", { rect, zoom: args.zoom === undefined ? 1 : Number(args.zoom), layer: target.id });
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            const file = writePng(job.dataUrl, "ref");
            return {
              ok: true,
              revision: docs.revision,
              path: file,
              rect,
              zoom: job.zoom,
              layer: { id: target.id, name: target.name },
              width: job.width,
              height: job.height,
              hint: "参考图的这块裁切，用 read_image 看。",
            };
          }
          case "fill": {
            if (args.x === undefined || args.y === undefined) throw new Error("fill 需要 x、y：区域内部的一个种子点");
            const rect = parseRect(args.rect, docs.doc.width, docs.doc.height);
            const job = await runPixelJob("fill", {
              x: Math.round(Number(args.x)),
              y: Math.round(Number(args.y)),
              rect,
              color: args.color || null,
            }, PIXEL_TIMEOUT_MS * 3);
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            if (!job.polygons || job.polygons.length === 0) throw new Error("这个种子点没围出可填的区域：先有线稿边界，或者换一个点");
            const want = String(args.fillLayer || args.layer || "色块").trim();
            const found = docs.layer(want);
            const target = found && !found.locked && !found.image ? found : docs.addLayer(want);
            docs.append(
              job.polygons.map((p) => ({ mode: "fill", color: job.color, size: 1, opacity: args.opacity === undefined ? 1 : args.opacity, points: p.points })),
              target.id,
            );
            return {
              ok: true,
              revision: docs.revision,
              layer: { id: target.id, name: target.name },
              color: job.color,
              area: job.area,
              polygons: job.polygons.length,
              seed: job.seed,
              hint: `填了 ${job.area} 像素，用 ${job.color}；换一个点还能接着填。`,
            };
          }
          case "select": {
            if (args.clearSelection === true || args.clear === true) {
              docs.setSelection(null);
              return { ok: true, revision: docs.revision, selection: null, hint: "选区已清掉，整幅都能画了。" };
            }
            if (Array.isArray(args.rect) && args.rect.length >= 4) {
              const rect = parseRect(args.rect, docs.doc.width, docs.doc.height);
              docs.setSelection({ type: "rect", rect });
              return { ok: true, revision: docs.revision, selection: docs.doc.selection, hint: `矩形选区 ${rect.w}×${rect.h}：之后落笔只保留框内的点。` };
            }
            if (Array.isArray(args.points) && args.points.length >= 3) {
              const points = args.points
                .map((p) => [Math.round(Number(p[0])), Math.round(Number(p[1]))])
                .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
              if (points.length < 3) throw new Error("套索至少要 3 个点");
              docs.setSelection({ type: "lasso", points });
              return { ok: true, revision: docs.revision, selection: docs.doc.selection, hint: `套索选区 ${points.length} 个点：之后落笔只保留圈内的点。` };
            }
            throw new Error("select 需要 rect=[x,y,w,h]、points=[[x,y]…]（套索），或 clearSelection=true 清掉");
          }
          case "copy": {
            const style = args.style === "lineart" || args.style === "flat" ? args.style : "anime";
            const rect = parseRect(args.rect, docs.doc.width, docs.doc.height);
            const job = await runPixelJob("copy", {
              rect,
              style,
              layer: args.refLayer === undefined ? null : args.refLayer,
              threshold: args.threshold,
              tolerance: args.tolerance,
              minLength: args.minLength,
              maxLines: args.maxLines,
              colors: args.colors,
              minFill: args.minFill,
            }, PIXEL_TIMEOUT_MS * 3);
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            const created = [];
            // 同名空层直接复用，避免反复 copy 堆出一串「线稿 2」「色块 3」
            const pickLayer = (name) => {
              const want = String(name || "").trim();
              const found = want ? docs.layer(want) : null;
              if (found && !found.locked && !found.image && (found.strokes || []).length === 0) return found;
              return docs.addLayer(want || undefined);
            };
            // 先铺色块（在线稿下面），再描线，顺序就是画师的习惯
            if (style !== "lineart" && job.fills.length > 0) {
              const layer = pickLayer(args.fillLayer || "色块");
              docs.append(
                job.fills.map((f) => ({ mode: "fill", color: f.color, size: 1, opacity: 1, points: f.points })),
                layer.id,
              );
              created.push({ name: layer.name, kind: "fill", items: job.fills.length });
            }
            if (style !== "flat" && job.paths.length > 0) {
              const palette = job.palette || [];
              const darkest = palette.length
                ? palette.reduce((a, b) => (lumOf(a) <= lumOf(b) ? a : b))
                : null;
              const layer = pickLayer(args.layer || "线稿");
              const brush = BRUSH_IDS.includes(args.brush) ? args.brush : "liner";
              const size = Math.max(1, Number(args.size) || 3);
              const strokes = job.paths
                .filter((p) => p && p.length >= 2)
                .map((points) => ({ color: args.color || (darkest && darkest.hex) || "#111111", size, brush, opacity: 1, points }));
              docs.append(strokes, layer.id);
              created.push({ name: layer.name, kind: "line", items: strokes.length });
            }
            // 自动验收，让模型不用再问一次
            const cmp = await runPixelJob("compare", { rect: job.rect }, PIXEL_TIMEOUT_MS * 2);
            return {
              ok: true,
              revision: docs.revision,
              style,
              rect: job.rect,
              created,
              palette: job.palette,
              lines: job.lines,
              fills: job.fills.length,
              points: job.points,
              metrics: cmp.ok ? cmp.metrics : null,
              hint: `已按 ${style} 复刻：${created.map((c) => `${c.name}(${c.items})`).join(" + ") || "没有可画的内容"}。`
                + (cmp.ok ? `覆盖率 ${cmp.metrics.coveragePct}%，多画 ${cmp.metrics.extraPct}%。` : "（验收没跑成，稍后 action=compare 再看）")
                + "想补差距就 action=fix。",
            };
          }
          case "fix": {
            const rect = parseRect(args.rect, docs.doc.width, docs.doc.height);
            const maxRounds = Math.max(1, Math.min(5, Math.round(Number(args.maxRounds) || 3)));
            const target = Math.max(30, Math.min(99, Number(args.target) || 90));
            const rounds = [];
            let last = null;
            for (let i = 0; i < maxRounds; i += 1) {
              const cmp = await runPixelJob("compare", { rect }, PIXEL_TIMEOUT_MS * 2);
              if (!cmp.ok) return { ok: false, error: cmp.error, rounds, revision: docs.revision };
              last = cmp.metrics;
              const entry = {
                round: i + 1,
                coveragePct: cmp.metrics.coveragePct,
                extraPct: cmp.metrics.extraPct,
                gaps: (cmp.metrics.topGaps || []).length,
              };
              rounds.push(entry);
              if (cmp.metrics.coveragePct >= target) break;
              const gaps = (cmp.metrics.topGaps || []).slice(0, 2);
              if (gaps.length === 0) break;
              let added = 0;
              for (const g of gaps) {
                const x = Math.max(0, Math.round(g.x) - 6);
                const y = Math.max(0, Math.round(g.y) - 6);
                const w = Math.min(docs.doc.width - x, Math.round(g.w) + 12);
                const h = Math.min(docs.doc.height - y, Math.round(g.h) + 12);
                if (w < 4 || h < 4) continue;
                const tr = await runPixelJob("trace", {
                  rect: [x, y, w, h],
                  layer: args.refLayer === undefined ? null : args.refLayer,
                  threshold: args.threshold === undefined ? 0.5 : args.threshold,
                  tolerance: Math.min(2, Number(args.tolerance) || 2),
                  minLength: 6,
                  maxLines: 30,
                }, PIXEL_TIMEOUT_MS * 2);
                if (!tr.ok || !tr.paths.length) continue;
                const brush = BRUSH_IDS.includes(args.brush) ? args.brush : "liner";
                const strokes = tr.paths
                  .filter((p) => p.length >= 2)
                  .map((points) => ({ color: args.color || "#111111", size: Math.max(1, Number(args.size) || 3), brush, points }));
                if (strokes.length === 0) continue;
                docs.append(strokes, args.layer || "线稿");
                added += strokes.length;
              }
              entry.addedStrokes = added;
              if (added === 0) break;
            }
            // 收尾再验收一次，数字才是补完后的
            const final = await runPixelJob("compare", { rect }, PIXEL_TIMEOUT_MS * 2);
            return {
              ok: true,
              revision: docs.revision,
              rounds,
              metrics: final.ok ? final.metrics : last,
              target,
              hint: final.ok
                ? `补了 ${rounds.reduce((n, r) => n + (r.addedStrokes || 0), 0)} 笔，覆盖率 ${final.metrics.coveragePct}%（目标 ${target}%）。`
                : "补完了但验收没跑成，稍后 action=compare 看。",
            };
          }
          case "trace": {
            const job = await runPixelJob("trace", {
              rect: parseRect(args.rect, docs.doc.width, docs.doc.height),
              layer: args.layer === undefined ? null : args.layer,
              threshold: args.threshold,
              tolerance: args.tolerance,
              minLength: args.minLength,
              maxLines: args.maxLines,
              mode: args.mode === "center" ? "center" : "edge",
            });
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            return {
              ok: true,
              revision: docs.revision,
              rect: job.rect,
              lines: job.lines,
              points: job.points,
              dropped: job.dropped,
              tolerance: job.tolerance,
              threshold: job.threshold,
              paths: job.paths,
              hint: "paths 是从参考图抽出的轮廓折线（画布坐标），每段直接当 draw 的 points 用；长图可分批 batches=[…]。"
                + "描完用 view rect+zoom 对照，再用 compare 看 coveragePct。",
            };
          }
          case "pick": {            if (args.x === undefined || args.y === undefined) throw new Error("pick 需要 x 和 y（画布像素）");
            const job = await runPixelJob("pick", {
              x: Math.round(Number(args.x)),
              y: Math.round(Number(args.y)),
              layer: args.layer === undefined ? null : args.layer,
              on: args.on === "canvas" ? "canvas" : "ref",
            });
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            return { ok: true, revision: docs.revision, ...job };
          }
          case "compare": {
            const job = await runPixelJob("compare", {
              rect: parseRect(args.rect, docs.doc.width, docs.doc.height),
              layer: args.layer === undefined ? null : args.layer,
            });
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            const file = writePng(job.dataUrl, "compare");
            return {
              ok: true,
              revision: docs.revision,
              path: file,
              rect: job.rect,
              metrics: job.metrics,
              hint: "read_image 看差分图（品红=参考有而你没画，青=你画多了），metrics 里是覆盖率与色差。",
            };
          }
          case "palette": {
            const k = Math.max(2, Math.min(8, Math.round(Number(args.k) || 6)));
            const job = await runPixelJob("palette", { k, rect: parseRect(args.rect, docs.doc.width, docs.doc.height), layer: args.layer === undefined ? null : args.layer });
            if (!job.ok) return { ok: false, error: job.error, revision: docs.revision };
            return { ok: true, revision: docs.revision, ...job };
          }
          case "snapshot": {
            const entry = docs.snapshot(args.label);
            return {
              ok: true,
              revision: docs.revision,
              id: entry.id,
              label: entry.label,
              snapshots: docs.snapshots.map((s) => ({ id: s.id, label: s.label, at: s.at, revision: s.revision })),
            };
          }
          case "restore": {
            const entry = docs.restore(args.snapshotId || args.id);
            return {
              ok: true,
              revision: docs.revision,
              restored: entry.id,
              label: entry.label,
              ...docs.summary(),
            };
          }
          default:
            return { ok: false, error: `未知 action: ${action}` };
        }
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    },
    isConcurrencySafe: () => false,
  };

  if (state.scope === "global") {
    // 旧行为：所有会话都能看到画布工具与画布协议（会把正在做别的事的会话带偏，默认已关掉）
    if (prompt) disposers.push(prompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: PROTOCOL }));
    if (tool) {
      try {
        disposers.push(tool.register(definition));
        state.toolOk = true;
      } catch (err) {
        state.toolError = String((err && err.message) || err);
      }
    }
  }

  if (webServer) mount();
  else if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (scope) => {
      webServer = scope.webServer || (scope.get ? scope.get("webServer") : null);
      if (webServer) {
        state.routeError = null;
        mount();
      }
    });
  }

  scheduleUpdateCheck();

  // 诊断并进了 /canvas-api 的 prefix 路由里（宿主的 register 只认 prefix/exact 两种，
  // 单独注册 exact 在部分版本上不生效，之前这个接口一直 404）

  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) {
      try {
        disposers[i]();
      } catch {
        /* ignore */
      }
    }
  };
}
