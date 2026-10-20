# 来源选择面板：已形成规格

日期：2026-10-19。状态：Q1–Q7已确认，用户调用 to-spec 推进规格阶段，并明确确认测试边界与发布。[完整规格](ui-source-filter-spec.md)已发布为[Issue #33](https://github.com/CaiYan12/overthecocoons/issues/33)，标签ready-for-agent；正文回读与本地一致。用户已确认两票拆分与依赖，实施票 [#34](https://github.com/CaiYan12/overthecocoons/issues/34) 与 [#35](https://github.com/CaiYan12/overthecocoons/issues/35) 已发布（#35 原生阻塞于 #34）；实施进度见集成分支 `codex/source-filter`。

> **实施状态（2026-10-19 更新）**：第一票 #34 的功能、样式、动效与专项 e2e 已落地并本地全绿，
> 见本文末「实施与验证证据」节。第二票 #35（跨文档返回恢复）**已实现并通过本地验证**（非 BFCache
> 返回路径全绿；BFCache 命中路径在 headless 环境未命中，显式记录未验收，见该节）。

## 用户目标

将首页及各主题分类页右侧 SOURCE 下的「多源聚合」改为可点击入口，点击打开界面，选择已接入来源。样式与动画最大限度沿用现有页面。

## 已核实基线

- `src/components/KHud.astro` 当前使用普通段落显示来源标题；按快照全部来源计算，主题页显示相同全局摘要。
- 本地 `http://127.0.0.1:4322/overthecocoons/` 当前为六源真实快照、214条；此为本地事实，不是线上发布证明。
- 已接入订阅为百度热点、中新网·社会、中新网·国际、中新网·东西问、极客公园、Solidot；「网站」与「订阅源」不完全等同，中新网有三个频道。
- 当前主题增强为本页内筛选；公开条目已有 `sourceId`。新增来源选择不需要重新抓源；来源过滤尚未实现。
- 视觉以 `src/styles/kinetic.css`、`docs/ui-menu-motion.md`、`docs/ui-links.md` 为基线。现有 MENU 为同主题纸面、细线、轻阴影、280ms对称进退；不采用早期倒置配色记录。

## 第一轮已确认

1. 来源支持多选及「全部来源」。仅选一个时入口显示该来源名称，选多个时显示「多源聚合」。此决定覆盖初轮单选建议。
2. 六个订阅分别显示，中新网三个频道不合并。
3. 用户选择A：桌面居中纸面弹层、手机底部上拉。
4. 选项参考外卖平台加菜的按钮型复选框，但必须遵循本站既有设计风格。

## 按钮型复选框视觉方案

- 紧凑按钮自然换行，继承现有字体与主题；细线边框、直角或极小圆角，无外卖平台品牌色。
- 未选为纸色与墨色，选中用暗红边界/勾选标记和轻微底色共同表达；勾选状态不能只靠颜色。
- 「全部来源」作为独立全选控件，与六个订阅分组；多选入口辅文建议显示「已选 N / 6 个订阅源」。
- 面板、按钮反馈、关闭路径及列表切换分别编排，待交互确认后固化参数；沿用现有主题层次与轻阴影方向。

## 第二轮已确认（用户：按推荐）

4. 面板内暂选，按「应用」后生效；取消/Esc/遮罩关闭撤销未应用修改。
5. 主题与来源取交集，切任一维保留另一维、重置第1页；所有订阅始终可选，空结果明确说明并提供放宽筛选入口。
6. 「全部来源」勾满六项，取消任一项进入部分选中；允许暂选为零，但禁用应用并提示至少选择一个来源，正式列表不产生零源状态。
7. 当前访问内保留来源选择，刷新/重开重置全部来源；进入详情后浏览器返回恢复筛选与阅读位置，不持久记录来源偏好。恢复机制须实施时验证，当前尚未具备来源状态。

## 完整方案补充

- 范围为首页、分页、各topic及其分页的时间线HUD；来源说明/关于/原则/隐私/条目详情的内容型HUD不增加筛选入口。
- 入口保留现有SOURCE标签和标题字号，将来源标题改成可操作入口，辅文反映已选数量；首次默认全部来源。
- 全选控件体现全选/部分选中/全不选三种状态；全部选中时再次取消全选可进入零项暂选，应用仍禁用。重新打开面板从已应用状态开始，不保留取消的草稿。
- 面板结构为「选择来源」标题与关闭入口、独立全选控件、六个按钮型复选框、已选数量/有效提示、取消/应用。按钮保留真实checkbox语义及Space操作，最小点击高度44px。重复应用同一集合仅关闭面板，不重排或重播时间线。
- 空交集明确展示当前筛选无内容；「全部来源」只放宽来源，「全部主题」只放宽主题，避免一键无声清空另一维。分页、NOW READING分母和日期目录以交集结果为准，原共同排序和条目身份不变。
- 应用先完成面板退场，再执行列表既有切换；切换后的新结果定位到时间线开头。取消保留原滚动位置。返回详情前的筛选/位置与刷新重置分别验证。
- 桌面面板轻抬淡入、手机从底部上拉；进退均沿用280ms正常时长和现有缓出曲线，关闭可中断进入。内容以160ms/短错峰显现，按钮反馈160ms；不新增弹跳或大范围模糊。选中语义立即更新，反馈动画不延后复选操作。
- 主题继承现有paper/ink/muted/rule/accent，面板沿用94%纸色+6%墨色色差及轻阴影。保持自定义光标/滚动条风格，避免与MENU叠开，锁背景滚动且不造成页面宽度跳变。
- 使用原生模态焦点约束；Esc/关闭/遮罩均取消，关闭后恢复入口焦点。应用后的焦点须保持可见、播报结果。短屏只让弹层内容滚动，不改变两侧栏既有自然高度规则。
- 本次新增面板的reduced-motion取消空间位移与错峰，保留轻淡入淡出；键盘操作不等待逐项显现。既有MENU特殊动效裁定不扩大到本面板。
- 无JS或筛选初始化失败时，入口降级为现有来源说明页链接，不提供失效按钮；静态主题/分页/条目阅读继续可用。本次不增加来源组合的静态路由或分享URL。
- 缺动效库、暂停时钟、快速开关与pagehide须可用且能解除滚动锁；不因退出中断丢失已应用选择或误提交草稿。

## 验收与执行边界

- 对来源集合/全选/零选防护、主题交集、排序和页码收敛做针对性测试；浏览器覆盖应用/取消、空态、入口名称/计数、键盘、移动布局、返回恢复、刷新重置、降级和真实动效中间帧。
- 以真实六源快照验收，不仅使用旧单源fixture；检查320/390/768/1024/1440宽度与明暗主题，构建产物和独立浏览器验证。触屏模拟不等于新真机/FPS验收。
- 用户指定to-spec并确认测试边界与发布，已完成规格Issue #33发布；本轮未修改功能、未运行本次实现测试或构建。未创建实施拆分票、Git提交、推送或部署。

## 实施与验证证据（第一票 #34，2026-10-19）

分支 `ticket/source-filter-panel`（worktree，基线 = 集成分支 `codex/source-filter` tip `c342c79`）。

### 落地文件

| 文件 | 内容 |
| --- | --- |
| `src/lib/source-filter.ts` | 纯规则：六订阅固定次序、`entrySourceId` 旧百度缺省、`filterTimeline`（来源并集×主题交集）、`selectionTitle`/`selectionSummary`、`allState` 三态、`normalizeSources` |
| `src/client/source-filter.ts` | 面板状态机：草稿隔离、全选三态、零项禁用、取消族、应用先退场、焦点返回与可见、滚动锁与 pagehide、缺库/停钟兜底、入口 `<a>`→`<button>` 接管 |
| `src/client/timeline-view.ts` | 已应用来源集合（单一事实源）、`syncSourceUi`、空态两维放宽、应用/放宽回第 1 页 |
| `src/client/motion.ts` | `sourcePanelOpenMotion`/`sourcePanelCloseMotion`/`resetSourcePanelMotion` |
| `src/components/KHud.astro` | 时间线 HUD 来源入口 + 面板静态结构（内容型 HUD 不变） |
| `src/styles/kinetic.css` | `.k-source*` 与 `.k-empty-actions` |
| `fixtures/snapshot-sources.json` + `astro.sources.config.ts` | 六源确定性夹具（56 条）与独立产物 `.snapshot/sources-dist` |
| `tests/unit/source-filter.test.ts` | 纯规则单测 |
| `tests/e2e/source-filter.spec.ts` | 23 个真实页面交互用例（4323 多源产物） |

### 实测数字（本机，2026-10-19）

- `pnpm run check`：**0 error / 0 warning / 2 hints**（既有 hints）。
- `pnpm run build`：通过（演示夹具产物）。
- `pnpm run test:node`：**325 passed / 0 failed / 0 skipped**。
- `pnpm exec playwright test --project=chromium`：**226 passed / 2 skipped**（跳过项为既有触屏专项：
  `links.spec.ts:195` 触屏页内导航 hover、`media-surface.spec.ts:169` 触屏鼠标光斑，均按引擎能力标注不适用）。
- `pnpm exec playwright test --project=chromium --project=firefox --project=webkit --project=mobile-chrome --project=mobile-safari tests/e2e/source-filter.spec.ts`：**115 passed**（23 用例 × 5 配置，无跳过）。

### 实施中确认的两处产品口径

1. **HUD 总数恒为两位补零**（`KHud.astro` 的 `totalText` 与 `timeline-view.ts` 的 `pad2`）：
   Solidot 5 条显示 `05`，不是 `5`。规格只要求辅文表达已选数量，未改变总数格式。
2. **单页结果不渲染分页器**（既有分页口径，见 `tests/e2e/interactions.spec.ts` 单页断言）：
   来源交集收敛到单页时，「回第 1 页」表现为分页器隐藏、条目从第 1 条开始。

### 实施中修复的实现缺陷

- **应用后焦点在短视口不可见**：`renderView` 先把页面定位到时间线开头，≤767px 时 HUD 仍在首屏之外
  （实测 iPhone 13 的 664px 视口：入口 `top` 692）。规格要求「应用后焦点可见且不被重渲染留在
  不可见位置」，因此在焦点落位后补一次 `scrollIntoView({ block: "nearest" })`；桌面右栏本就可见，
  不产生滚动（由 e2e 断言 `scrollY === 0` 守住）。
- **滚动条规则被误合并**：`.k-scrollbar` 与 `[data-scrollbar=page]` 两条规则曾被拼成一行，
  后者成为无效选择器后缀，页面滚动条 `top` 偏移与 `z-index` 全部失效。已还原为两行。

### 未验证 / 未覆盖（如实标注）

- 未做**真实六源快照**（`.snapshot/multi-source-local-20261019/snapshot.json`）的独立浏览器视觉验收，
  也未做 320/390/768/1024/1440 × 明暗的人工实看；本轮只有自动化断言（含深色对比度 ≥4.5:1 的像素实测）。
- 未做**新真机**、**FPS** 与**线上**验证；移动配置为 Playwright 设备模拟，不等同真机。
- 未推送、未建 PR、未部署。

## 实施与验证证据（第二票 #35，2026-10-19）

分支 `ticket/source-filter-return`（worktree，基线 = 集成分支 `codex/source-filter` tip `8b8786e`）。

### 落地文件

| 文件 | 内容 |
| --- | --- |
| `src/client/return-state.ts` | **新建**纯模块：`FilterState`、`readFilterState`（结构/来源/主题/页码任一非法即整体判无快照）、`shouldRestore`（仅 `back_forward` 或 `pageshow.persisted`） |
| `src/client/timeline-view.ts` | 每次渲染与阅读位置变化 `history.replaceState({octFilter:{…}})`（只写 state）；启动按导航类型恢复；`pageshow(persisted)` 收口；恢复走既有 `resolveRestore` |
| `src/client/motion.ts` | `onListRendered(deferred, instantReveal)`：恢复路径条目直显，不重播拆字/摘要/媒体入场 |
| `tests/unit/return-state.test.ts` | **新建** 9 条纯规则用例（含与 `resolveRestore` 组合的目标失效回退） |
| `tests/e2e/source-filter-return.spec.ts` | **新建** 10 条真实跨文档导航用例（4323 多源产物） |
| `src/pages/privacy.astro` | 「本地存储」补来源筛选与阅读位置只暂存于当前会话历史条目、不写存储、不发服务端 |

### 实现口径

- 快照键 `octFilter`，写入 `history.state`；**不加 URL 参数、不加静态路由、不写 localStorage/sessionStorage**。
- 恢复判据：`performance.getEntriesByType("navigation")[0].type === "back_forward"`（实测跨文档后退
  headless/headful 一致）；BFCache 命中时模块不重跑，由 `pageshow(persisted===true)` 按同一 `history.state` 重放。
- `navigate` / `reload` / `prerender` / 未知 → 忽略 state，来源回到全选（刷新/重开重置语义不变）。
- 恢复目标失效（条目已不在交集结果）：沿用既有 `resolveRestore` 的 `fallback`，回退有效页码并播报
  「原条目不在当前内容中」，不制造无效页码。
- 播报口径：`已恢复来源筛选与阅读位置：{来源名}，{主题}，第 {p} 页，共 N 页`。
- 恢复不重播入场：`onListRendered` 的 `instantReveal` 跳过拆字/摘要/媒体入场初态，进度线与节点激活照常重建。

### 实测数字（本机，2026-10-19）

- `pnpm run check`：**0 error / 0 warning / 2 hints**（既有 hints）。
- `pnpm run build`：通过（66 页）。
- `pnpm run test:node`：**334 passed / 0 failed / 0 skipped**。
- `pnpm exec playwright test --project=chromium tests/e2e/source-filter.spec.ts tests/e2e/source-filter-return.spec.ts`：
  **32 passed / 1 skipped**（23 + 9 通过；跳过项为 BFCache，见下）。
- `pnpm exec playwright test --project=chromium`（全量）：**235 passed / 3 skipped**。
- 五配置矩阵 `--project=chromium --project=firefox --project=webkit --project=mobile-chrome --project=mobile-safari tests/e2e/source-filter-return.spec.ts`：
  **45 passed / 5 skipped**（每配置 9 通过 + BFCache 1 跳过）。

### 实施中修复的实现缺陷

- **恢复被 CSS 平滑滚动劫持**：`html { scroll-behavior: smooth }` 下 `scrollIntoView({behavior:"auto"})`
  仍走平滑滚动，Firefox 实测被 `ScrollTrigger.refresh` 打断，停在离读线 263px 处。恢复路径与目标失效
  回退改为显式 `behavior: "instant"`——规格要求恢复原阅读位置不重播无意义动效。

### 未验收 / 未覆盖（如实标注）

- **BFCache 命中路径未验收**：headless Chromium 即使 `ignoreDefaultArgs: ["--disable-back-forward-cache"]`
  也拿不到 `pageshow.persisted === true`（实测）。按用户约束本轮不弹 headful 窗口，该用例在 5 配置下
  全部**显式 skip 并记录原因**，不伪造通过；留待最终独立验收一次性确认。
- 未做真实六源快照的独立浏览器视觉验收、新真机、FPS 与线上证据（同第一票边界）。
- 未推送、未建 PR、未合入 main。
