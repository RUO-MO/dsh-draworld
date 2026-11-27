# @xenra/dsh-draworld

**在 DeepSeek Harness 里放一块真正属于你的画布。**

右侧栏多一个「画布」标签页，你和模型在同一块画布上画：你用鼠标，模型用 `paint_canvas` 工具。
画布是数据而不是截图——每一笔都是带压感的点序列，所以能精确撤销、能查看结构、能接着改。

## 为什么换了方向

之前那版是去**控制外部绘画软件**（画世界Pro），靠合成输入落笔。结果是：
压感打不通、笔迹等宽、坐标要标定、还抢前台和鼠标。

自己持有画布后，这些问题都不存在了：渲染在我们手里，压感就是数据里的一个数。

## 能力

| 工具动作 | 说明 |
|---|---|
| `doc` | 看画布尺寸、图层、笔迹数、颜色、内容范围、当前版本；图层里带 `image` 就说明是图片层 |
| `draw` | 提交一笔：稀疏控制点 + 每点压感，颜色/笔宽/不透明度自定；`layer="线稿"` 按名字落层，没有就自动建；`shape="line/rect/ellipse"` 只给两个对角点就能画形状 |
| `layer` | `layerOp=list/add/select/set/remove`；`set` 能改 `name`、`visible`、**`layerOpacity`**、`blend=normal/multiply` |
| `import` | `path="D:\\ref\\pose.png"` 或 `dataUrl`，把图收进 `images/` 并压成**最底层**（图层 1），`fit=contain/cover/stretch` |
| `canvas` | 改画布本身：`width`/`height`（16~4096）、`background=#rrggbb` |
| `view` | 取最新渲染结果（带背景 PNG、透明底 PNG 两个路径），用于确认画对了 |
| `export` | 把最新渲染另存成 PNG 到保存路径（`transparent=true` 要透明底那份） |
| `undo` / `redo` | 撤掉 / 恢复最近 N 笔，跨图层按全局顺序走 |
| `clear` | 清空画布；带 `layer` 就只清那一层 |

界面里也能画：颜色、笔宽、橡皮、直线/矩形/椭圆三个形状工具、撤销/重做、按笔迹顺序回放、
图层增删与显隐/**不透明度**/正片叠底，笔迹实时同步给模型。界面上能做的每一件事在工具里都有对应动作，
模型不需要"点界面"。

## 画笔

一支笔有四个可调量：**工具**（笔/擦/线/矩形/圆）、**笔刷**、**颜色**、**笔宽**，外加一个「起收笔渐细」开关。
笔刷按画世界Pro 的画笔库分了八类，共 32 支，每支的差别都在渲染上（`engine` 不一样，不是换个名字）：

| 分类 | 笔刷 |
|---|---|
| 常规 | `round` 圆头、`hard` 硬边圆、`softround` 软边圆、`ballpoint` 圆珠笔、`marker` 马克笔、`flat` 平头 |
| 勾线 | `liner` 勾线笔、`gpen` G 笔、`ink` 墨水笔、`outline` 描边笔、`willow` 柳叶笔 |
| 铅笔 / 素描 | `pencil` 铅笔、`sketch` 素描铅笔、`charcoal` 炭笔、`charcoalStick` 炭条、`chalk` 粉笔 |
| 水彩 | `watercolor` 水彩笔、`wash` 铺色、`wetedge` 湿边、`blender` 晕染 |
| 水墨 | `inkbrush` 水墨毛笔、`hairbrush` 尖锋毛笔、`drybrush` 干笔 |
| 油画 / 厚涂 | `oil` 油画笔、`impasto` 厚涂、`palette` 刮刀 |
| 喷枪 | `airbrush` 软喷枪、`airhard` 硬喷枪、`airnoise` 噪点喷枪 |
| 特效 | `halftone` 漫画网点、`glow` 光效、`sparkle` 粒子 |

十三个落笔方式（`BRUSH_ENGINES`）撑着这 32 支，加一支只用在表里加一行：

- **solid** 实边 ribbon，宽度随压感变；**flat** 平头/方头等宽（马克、平头、刮刀）
- **soft** 三层渐宽 —— 软边圆、晕染
- **grain** 淡底 + 颗粒散点 —— 铅笔、素描、炭笔、炭条；种子取笔迹 id，**回放和导出永远一致**
- **chalk** 颗粒再叠一层粗粉点
- **dry** 沿法线劈成几股细毛、随机断开的飞白 —— 干笔、刮刀
- **wet** 一片淡圆斑、边缘比中心深（湿边），叠几笔才出浓度 —— 水彩三支
- **inkflow** 外圈淡墨 + 实心芯 —— 水墨毛笔、尖锋毛笔
- **oil** 厚底 + 毛刷拖痕，`thick` 多压一遍 —— 油画、厚涂
- **spray** 按点撒小圆 —— 三种喷枪（软/硬/噪点靠散布和半径区分）
- **halftone** 按格挑点、每格一个圆 —— 漫画网点，密处自然连片
- **glow** 径向渐变叠光晕；**scatter** 稀疏粒子 + 偶尔大光斑

`taper=true` 时两端按 15% 的长度渐细到 `minSize`（默认取笔刷自带的，0~1），形状工具不吃这一套（否则矩形角会缺一块）。
橡皮固定走圆头实心 `destination-out`，不吃笔刷参数。

模型侧同一套：`draw` 带 `brush`（32 个 id 之一，未知值回退 `round`）、`taper`、`minSize`，
系统提示里写明「描线用 liner/gpen/ink + taper，草稿用 pencil/sketch，排线用 charcoal，铺底用 wash/watercolor，
厚涂用 oil/impasto，光晕用 airbrush/glow，网点才用 halftone」。

界面上：笔工具按钮点开是弹窗卡片（560 宽），上半 5 个工具、下半按八类排的笔刷格，
**每一格都画着这支笔的样笔预览**（灰阶、带压感变化），当前笔刷名字直接写在按钮上（`笔 · 铅笔`）。

## 新建一幅

顶栏「＋ 新建」两步走：

1. **当前这幅要不要留一份？**「保存并新建」把当前渲染的 PNG 存进保存路径（和「另存」同一处，文件名 `画界-<时间>.png`）；
   「不保存，直接新建」丢掉旧画布；「取消」什么都不做。
2. **新画布怎么来？**「空白画布」挑一个尺寸（1:1 / 4:3 / 16:9 / 9:16 / A4 / 当前尺寸，另有「更多尺寸 / 背景」跳到画布设置）；
   「导入图片」选一张 PNG/JPEG/WebP/GIF —— **画布尺寸直接取图片尺寸**，图片压成最底层（图层 1），
   上面把原来那张空层改名成「绘画」并设为当前层，所以点开就能描。

走 `POST /canvas-api/new`，body 是 `{ save, width, height, background, dataUrl|path, name }`；
模型侧对应 `paint_canvas action=new`，参数同名字段（含 `save`）。

## 图片层

「导入图片」有两条路：**新建时**用图片开一张新画布（推荐，尺寸跟着图片走），
或在「图层」卡片里**导入到当前画布**（作为最底层，默认 `contain` 整张居中；也支持 `cover`/`stretch`）。

素材存进 `<缓存目录>/images/`，用 `/canvas-api/image/<file>` 取原字节，前端 `Image` 预载后参与同一套图层合成，
所以显隐、不透明度、正片叠底、导出、透明底导出对图片层一样生效；换缓存目录时 `images/` 跟着搬。

## 图层

文档是 v2 结构：`layers[{ id, name, visible, opacity, blend, strokes }]`，每笔带全局 `seq`。
旧版（v1，顶层 `strokes`）读进来会自动搬进第一层并落盘成 v2，不会丢画。

- 橡皮在图层上擦成透明（`destination-out`），露出下层，不再涂背景色；
- 带橡皮、透明度或混合模式的层会先画到离屏再合成，所以擦不到背景；
- 撤销栈和重做栈都是数据，重启后还能重做（redo 栈随文档落盘，上限 200 笔）。

## 从哪进去

两个入口，同一份画布：

1. **左栏导航的「画界」**（在「插件 / 自动化任务」下面那一组）——点它把中栏整个切成画界页面，
   像「上下文洞察」那样占满主区域，适合正经画。走 `sidebar.panellist`（图标行）+ `main`（keyed slot，
   `key: 'xenra-draworld'`）两个槽位注册，两者用同一个 id 对上；`ctx.layout.selectPanel(id)` 负责切过去。
2. 右栏「开始」页列表里的一行**画界**（在「工作区文件」下面），点它在右栏开个画布 tab，边聊边画。
   这一行来自 tab 定义里的 `guide` 数组——引导页只认 `guide` 条目，没有它这个 tab 不会出现在列表里，
   只能靠「新建 tab」菜单打开。

整页模式的排布（按你标的格子）：

- **C1** 顶栏：`xenra.画界` 标识，右边是「右栏画布」和「回到对话」；
- **A1** 画板：占满左边，滚轮缩放、空格/中键平移，右下角有缩放 HUD；
- **B1** 右上：当前工具按钮（点开才弹卡片选笔/擦/线/矩形/圆）、颜色色块、笔宽滑杆、
  「图层」按钮（弹卡片里做增删、显隐、不透明度、混合模式）；
- **B2** 右下：撤销/重做/回放/清空四个按钮，加一个「画布 1024×1024」按钮，
  点开是画布设置卡片（尺寸预设、自定义宽高、背景、缓存目录、保存路径、另存 PNG）。

配色全部走宿主的真实设计变量（`--dsw-alias-label-primary/secondary/tertiary/caption`、
`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-border-l1/l2/l3`、`--dsw-alias-brand-primary`），
不再用 `#eee` 这类写死的浅色——之前那版在浅色主题下就是白字白底，所以整列看着像灰掉了。

## 配置在哪

整页模式的 **B2** 卡片里（`main` 面板内嵌，带 `compact` 排版）；右栏窄条里不重复放，避免两套界面。
配置块用 `SettingsSection` 组件本身，和原来「设置」里那一页完全一样，只是不再依赖 `settings.section` /
`plugins.tab`。

之前那版把它挂在**设置对话框**（`settings.section`）：那个对话框盖住整个界面，改完看不见画布；
插件页的 `plugins.tab` 也试过，但那是「插件」页里的标签页，仍然得来回切。现在是面板级，画板就在左边。

页里有这些：**尺寸预设**（比例 / 纸张 300dpi / 像素画布，点一下立刻生效）、自定义宽高（16~4096）、
背景色、**缓存目录**、**保存路径**，外加「另存当前画布」把最新渲染存成 PNG（落在保存路径里，可勾透明底）。

预设表：

- 比例：1:1 1024×1024、4:3 1024×768、3:4 768×1024、16:9 1024×576、9:16 576×1024
- 纸张（300dpi）：屏幕 1920×1080、A4 2480×3508、A5 1748×2480、A6 1240×1748、B5 2079×2953
- 像素画布：16、32、64、128、256、512（正方形）

- 缓存目录：`doc.json` 和 `preview.png` 放哪。改它会把画布整体搬过去，新目录已有 `doc.json` 就读新的，
  没有就沿用当前文档，不会把画了一半的画弄丢。
- 保存路径：默认是缓存目录下的 `exports/`，另存的成品都落这里。
- 路径只接受绝对路径，目录不存在会自动创建；这两条存在 `<插件配置 dir>/settings.json`，和画布数据分开存，
  所以缓存目录本身可以随便挪。

尺寸和背景也写进 `doc.json`，所有会话共用一份画布，保存即生效；改尺寸不挪动已有笔迹，只改画布边界。

## 画布视角

画布放在一个可视区里，缩放和平移只改视图，不改文档坐标：

- **滚轮**：以鼠标位置为锚缩放（0.06×~16×），鼠标下面那一点不会跑；
- **空格 + 拖动**、**中键拖动**：平移；
- 右下角有 `−` / 百分比 / `＋` / `适应` / `1:1`，打开 tab 或画布尺寸变化时自动「适应」；
- 用户没手动缩放过时，视口尺寸变化会重新适应，手动缩放之后就不再抢。

落笔坐标走 `canvas.getBoundingClientRect()`，它已经包含 CSS 变换，所以放大到 800% 落笔也不会偏。

## 压感是真的

前端按每个点的压感插值笔宽（`0.25 + 0.75 × pressure`），端点圆头。
所以给 3~5 个控制点就能画出一条**起笔细、行笔粗、收笔细**的线，不需要塞密集点。

## 数据在哪

```
<插件配置 dir>/settings.json  缓存目录与保存路径（路径改了画布数据跟着走）
<缓存目录>/doc.json          画布文档（v2：图层 + 笔迹 + redo 栈）
<缓存目录>/preview.png       最近一次渲染（带背景）
<缓存目录>/preview-alpha.png 最近一次渲染（透明底）
<保存路径>/画界-时间戳.png    另存出来的成品；透明底带 -alpha 后缀
```

默认目录是宿主进程的 `.dsh-draworld`。想放到工作区，在 `cordis.patch.yml` 的 `config.dir` 指定。

## 会话绑定

`paint_canvas` 默认**只挂在打开过画界的那个会话上**，不再对所有会话广播。

- 打开画界（左栏整页或右栏标签页）时，前端把当前 `sessionId` POST 到 `/canvas-api/attach`，宿主在 `agent.ctx.tools.register()` + `agent.ctx.systemPrompt.section()` 里挂工具与画布协议；关掉画界 15 秒后解绑（切标签不会来回抖）。
- 别的会话（正在写代码、写文档的）完全看不到画布工具和画布协议，不会被带偏。
- 会话还没加载好时先挂着，`agent/created` 一到就补绑。
- 想回到「所有会话都有」的旧行为，在插件配置里写 `toolScope: "global"`，不推荐。

同一份画布只保留一个内存文档：插件被重复加载（停用再启用、热重载）时共用 `Document`（按缓存目录缓存到 `globalThis`），并且每次请求前都会核对磁盘上的 `doc.json`——别的窗口或进程刚画过就整份换成更新的那版，避免「模型画了但界面不更新」或旧文档覆盖新画。

## 接口

```
GET  /canvas-api/doc            文档 + 版本
GET  /canvas-api/summary        摘要
GET  /canvas-api/config         画布尺寸 / 背景 / 缓存目录 / 保存路径
POST /canvas-api/config         改尺寸、背景或两个目录
POST /canvas-api/export         把最新渲染另存到保存路径（body 可带 transparent）
POST /canvas-api/stroke         追加笔迹（body 可带 layer）
POST /canvas-api/op             clear | undo | redo | layer.add | layer.set | layer.remove
POST /canvas-api/preview        前端回传双帧渲染（dataUrl + alphaDataUrl）
POST /canvas-api/attach         把画布工具绑到某个会话（body: sessionId, variant）
POST /canvas-api/detach         解绑（15 秒宽限）
GET  /canvas-api/diagnostics    工具注册 / 路由 / 文档状态 / 绑定到哪些会话
```

## 版本号

插件管理器按 `package.json` 的 `version` 判断有没有更新，本地目录安装的插件改了文件但版本没动，它不认。

- 一次性升号：`node tools/bump-version.mjs`（`--dry` 只打印不写）
- 常驻监听：`node tools/watch-version.mjs`，盯 `index.js`、`client.js`、`README.md`、`icon.svg`、`cordis.patch.yml`、`locale/`，停手 8 秒后把补丁号 +1，一批改动只升一次

## 已知限制

- 选区（矩形/套索/魔棒）还没做，笔迹不能裁切或限制在选区内。
- 参考图导入还没做，画布只能从空白开始。
- 混合模式只有 normal 和 multiply；滤镜、液化、变形属于像素管线，暂不做。
- `view` 需要画布标签页至少打开过一次（渲染在浏览器里完成）。
- 界面代码改动后需要刷新一次页面才会生效。
- 会话绑定只对「打开画界之后」的请求生效；打开前发出的那一步还看不到 `paint_canvas`。
