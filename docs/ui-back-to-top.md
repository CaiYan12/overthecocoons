# 返回顶部按钮：视觉与显隐动效对齐

日期：2026-10-15。状态：用户已确认效果；功能提交 `157052c` 已推送main，构建、部署及线上回顶验收通过。证据见文末发布记录。

## 请求与范围

用户调用 `grill-with-docs` 与 `design-flow`，要求优化 `button.k-top`：以合适的 SVG 替换中心文字、增加很小很淡的浮层阴影、使随滚动出现和消失的动画更灵动。保留页面既有 v-kinetic 风格。

本轮使用截图与当前源码对齐后实施，仅调整该按钮及对应测试、文档。此项属于可逆 UI 打磨，不新增领域术语或 ADR。

## 修改前事实

- `src/components/KSite.astro`：原生 button，`aria-label="返回顶部"`；一个进度环 SVG，中心是 `.arr` 内的文字 `↑`。
- `src/styles/kinetic.css`：默认 64×64，≤767px 为 58×58；使用 surface/rule/accent token；没有阴影。显隐为 opacity 160ms ease-out；reduced-motion 时移除过渡。
- `.k-top svg` 当前统一绝对定位并旋转 -90deg，专为进度环设计；新增中心 SVG 必须区分图标与圆环选择器，避免继承环的尺寸与旋转。
- `src/client/top.ts`：scrollY≥400 时切换 `.show`；点击平滑回顶，reduced-motion 直接回顶。
- `src/client/motion.ts`：fine pointer 的磁吸直接操作按钮本体 x/y，幅度各≤8px，跟随 0.3s，离开 0.55s elastic 回正。显隐位移不能直接与它争用同一元素的 x/y。
- 时长基线：`--motion-fast:160ms`、`--motion-normal:280ms`、`--motion-slow:550ms`；沿用现有动效体系，不新增动画依赖。

## 已确认决定

- **Q1**：使用「向上箭头＋顶部短横线」，参考 [Lucide arrow-up-to-line](https://lucide.dev/icons/arrow-up-to-line)。不使用字体字符替代图标。
- **Q2**：轻抬轻落、一次微回弹；出现时从下方轻抬并略缩放后归位，消失沿原路轻落淡出。快速反向滚动从当前状态接续。现有鼠标磁吸保留。

## 已确认的整体方案

以下整体方案已由用户确认；实际参数与验证结果见后文。

1. 中心采用上述线性 SVG：建议 20×20、约1.5px 描边，使用当前主题 ink 色并校准光学中心。保留现有圆形尺寸、位置、外边框、进度环与悬停强调色。
2. 增加贴近表面的淡阴影：建议向下2px、模糊5px、无扩张；浅色约8%黑、深色单独校准可见度，仍保持轻薄，不做发光或大范围投影。阴影跟随按钮整体运动，悬停不额外升高。
3. 出现沿用280ms基准：建议从下方约10px、scale约0.95、opacity0到终态，终点仅一次极小回弹（上冲≤1px/缩放≤1.015）。退场建议160ms轻落缩小淡出，不反复弹跳。
4. 显隐与磁吸使用独立变换层；隐藏时取消命中和键盘聚焦，快速跨过400px门槛可以反向接续，无瞬移、残留偏移或重复播放。窗口短、触屏与减少动态效果下均可正常回顶。
5. 保持400px触发门槛和原有回顶行为；减少动态效果时取消位移、缩放和回弹，保留静态图标及轻阴影。进度环仍表达页面滚动进度。

## 实现阶段验收

- SVG 不受进度环旋转/尺寸样式影响；明暗主题、桌面/移动尺寸下均清晰居中。
- 浅阴影只提供轻微离面感，不形成厚重悬浮球。
- 通过400px门槛的进出、反复跨阈值、磁吸过程中退出、离开回正、点击回顶均连续；不得让显隐补间与磁吸争用变换属性。
- 隐藏态不拦点击或进入Tab顺序；可见态保留可访问名称和键盘操作；触屏无假悬停；reduced-motion不播放空间运动。
- 使用实际构建产物与独立浏览器检查；测试期间冻结源码，验证完成后再改文档。自动化移动配置不等于真机/FPS证明。
- 对现有 `tests/e2e/interactions.spec.ts`、`tests/e2e/motion.spec.ts` 中回顶/进度/磁吸/降级行为做相关回归，再核对新增动画的真实中间帧与快速打断。

## 实现与验收记录

- `KSite.astro`：中心改为20×20、1.5描边的内联 SVG（向上箭头＋顶横线）；`.k-top-ring` 单独承接原环的尺寸/旋转；`.k-top-face` 承载完整表面与新显隐变换。
- `kinetic.css`：表面阴影 `0 2px 5px`，浅色8%、深色22%黑色透明度；系统自动深色同样生效，不发光。按钮尺寸/位置/环参数保留，悬停描边仅在 hover+fine 时启用。
- `top.ts`：280ms、`back.out(0.8)` 轻抬10px/scale0.95至终态；160ms、`power3.out` 原路退出。透明度沿用CSS token；磁吸仍只控制按钮本体，新显隐只控制内表面。反向取消旧补间后保留当前姿态。时长按产物实际ms/s单位解析。
- 隐藏态 `tabIndex=-1`、`aria-hidden=true`，若自身仍有焦点则解除；可见态恢复原生button语义。缺GSAP保留CSS显隐与回顶，无JS保持隐藏不可聚焦；reduced-motion不做空间变换且直接回顶。pagehide/pageshow处理终态与恢复。
- 暂停GSAP祖先时钟时，普通`set`不立即渲染（专项先失败：y仍为10）；收尾改为显式`set(...).progress(1)`，原生定时兜底落到终态并清理旧补间。该失败用例修复后通过全部五配置。

### 执行结果（2026-10-15）

- Red：新增回归在旧产物上失败，确认隐藏按钮原先没有移出Tab序；随后实现并检查SVG、阴影、精确399/400门槛与可见终态。一次尺寸断言采到了入场缩放帧，改为等待终态后测量，未放宽20px要求。
- `pnpm test` 全量通过：check 98文件0 errors、0 warnings、2个既有execCommand弃用hints；build 66页面；Node 304/304；Chromium e2e 182/182（含新增6项）。
- `pnpm exec playwright test tests/e2e/top-button.spec.ts`：五配置合计28通过、2跳过。跳过仅为两种触屏配置不适用的鼠标磁吸测试；其余均覆盖中间帧微回弹、快速反向、隐藏焦点、系统明暗、reduced-motion、缺库/无JS、暂停时钟收尾。
- 按`/code-review`做独立只读复审：Standards 0 findings；Spec 0 findings。比较基线为任务起点HEAD `fd8f26b6652c08d779c234af877b98a5ba0dfc6c` 至本轮指定实现文件的工作区差异；未提交文件的新测试单独读取。不是远端/CI结论。
- 独立Codex浏览器读取实际构建预览 `127.0.0.1:4321`：明暗主题下SVG轮廓、光学居中、淡投影与原进度环实看通过；点击回顶最终 `scrollY=0`、visibility hidden、tabIndex -1、按钮不持有焦点。近景截图：`audit/top-button-light.jpg`、`audit/top-button-dark.jpg`（忽略的本地证据，不入git）。
- 全量测试期间源码与文档冻结；完成后再更新验收记录。主站`::1:4321`与用户开发服务`127.0.0.1:4322`均保留；测试预览已自动结束，临时浏览器标签已关闭。

### 边界

上述执行结果为本地构建与浏览器证据，不等同于远端CI或线上验收，也未作新手机实机或FPS验收。用户已于2026-10-15确认本轮效果，并授权提交推送；后续线上核对单独记录。

## 发布记录（2026-10-15）

- 用户明确授权仅提交推送本项修改。功能提交 [`157052c7ae32679ca979f5a312ca1702ee3f20e5`](https://github.com/CaiYan12/overthecocoons/commit/157052c7ae32679ca979f5a312ca1702ee3f20e5) 已推送main；包含3个实现文件、新专项测试及对应文档/记忆共10文件。没有纳入启动器、启动器README说明及其记忆，保留其他工作区改动。
- [`build-deploy` 运行38670422989](https://github.com/CaiYan12/overthecocoons/actions/runs/38670422989) 的headSha精确对应上述提交，build/deploy两个job均success；Pages部署于北京时间10:20完成。该工作流执行真实数据快照生成、构建和发布，不据此声称远端执行了本地全部测试。
- 独立浏览器核对线上关于页：新SVG路径与表面层存在，滚过门槛可见、tabIndex0；浅色阴影8%、深色22%、ink颜色正确，生产`--motion-normal`为`.28s`，按钮实看通过。浏览器标签已关闭，不连接用户Chrome。
- 线上CSS `KNav.CK7RGfdX.css` 与客户端脚本 `KSite.astro_astro_type_script_index_0_lang.boCS6DV6.js` 均HTTP200且与本地验收产物逐字节一致；对应SHA-256为 `c1e14c9e39b82c42661887e7eefeda0625ee68b983d8c09002dd064cff2d5b5a` / `ba5323a87aace68782573d2f76d535c8d7037977b75d58e19bcd99079700c9a8`。本地报告 `audit/top-button-live-release.json` 为忽略证据。
- 对真实线上站点运行原有「阈值显隐、点击平滑回到顶部」Chromium回归，1/1通过，包含点击后等待`scrollY===0`；临时配置关闭本地webServer并仅替换baseURL，未改测试断言。本地/线上证据分列，不作新真机或FPS结论。
- 本节及发布记忆作为同项文档证据补充提交；无额外功能变更。
