# AGENTS.md

## 项目背景与当前状态

- 项目：跳出茧房 Over the cocoons。
- 先读 `GLOSSARY.md` 领域术语与 `docs/README.md` 文档索引，再读 `docs/mvp-decisions.md` / `docs/mvp-spec.md` 已确认规格、`docs/mvp-architecture.md` / `docs/mvp-implementation-plan.md` 实施建议，以及产品/UI基线。原始 `初版需求细化.md` 示例与未确认项不是实现证据；后续用户明确决定优先于旧记录。
- Ticket 01 工程骨架已建立：Astro 7.3.5 + TypeScript 6.0.3 + Tailwind CSS 4.3.3（`@tailwindcss/vite`），pnpm 10.26.2 锁文件已提交；占位首页（基路径 `/overthecocoons`、无 JS 可读、标注“演示数据”）；四条命令 `pnpm run check` / `build` / `test:node` / `test:e2e` 已在本地全部通过（2026-10-03，Node 24.18.0）。演示数据机制见 `docs/fixtures.md`（`fixtures/` 目录 + `SNAPSHOT_PATH` 注入）。
- Ticket 02 数据契约与身份规则已建立：`src/domain/contract.ts`（三文件契约 state/items/manifest、完整 SHA-256 稳定 ID＝来源 ID+NUL 分隔符+GUID、损坏校验）与 `src/domain/ingestion.ts`（可注入来源的纯函数合并管线：同 GUID 不重计首次收录、内容修订保留时间、wd 关键词冲突/缺 GUID/协议不合法/字段校验失败隔离、7 天窗口滚动、台账无限保留、失败降级保留旧快照、坏状态停写）；`src/lib/snapshot.ts` 公开快照校验随契约演进（新增 `quarantined`/`sources` 字段）。
- Ticket 03 首源归一化接入已建立：`src/lib/url-guard.ts`（服务端请求 URL 安全校验：仅 http/https、拒绝 localhost/环回/私有/链路本地/保留地址与数字形式 IP 伪装、重定向逐跳复验）、`src/lib/feed-parse.ts`（rss-parser 3.13.0 字段映射按其源码核实：GUID 取文本、description→content/contentSnippet；热度后缀移除、摘要 300 字上限、wd 取第一个解码精确串、originalTime 恒 null）、`src/lib/source-fetch.ts`（单次尝试获取：超时、非 2xx、有界读取、严格 UTF-8）、`src/lib/baidu-source.ts`（首源适配：SOURCE_ID 冻结为 `baidu-aishort`、默认 feed `https://rss.aishort.top/?type=baidu`、最多 2 次尝试加短退避、产出可注入管线的 SourceFetchResult）；`pnpm smoke:source` 只读烟测通过（2026-10-03，100 条、0 缺 wd、10 缺摘要、0 隔离）。获取/解析层未被页面导入，build 不隐式抓源；数据落盘工作流属 Ticket 07。
- Ticket 04 时间线与详情静态渲染已建立：UI 完全采用原型 v4（`docs/design/prototype-timeline.html` v-kinetic）静态层，token/构图/三栏/HUD/数据版画/分页器移植到 `src/styles/kinetic.css` 与 `src/components/`（KSite/KHeader/KHero/KNav/KHud/KEntry/KPager/KEmpty/KMenu/SiteFooter/TimelinePage/Longform，零 `<script>`，动效与光标等仅留 DOM/aria 挂点属 Ticket 06）；`src/lib/timeline.ts` 纯函数（倒序＋稳定 ID 确定性次序、按日分组、20 条分页、日内权重三档 layout-c/a/b 与 w1/w2/w3、主题 slug）；页面为 `index`、`page/[page]`、`topics/[slug](/page/[page])`（11 主题独立页面，空主题真实空态——无 JS 筛选裁定为链接式独立页面）、`items/[id]`（仅快照内条目生成）、`sources`（原始平台与 Feed 服务提供者分列、隔离条目公开表）、`about/principles/privacy`（长文页含简版目录）、404（条目已过期或不存在）；fixture 演示快照扩为 45 条（64hex 稳定 ID、5 个日期、新闻 23/社会 22、1 条隔离示例、SOURCE_ID 对齐 `baidu-aishort`）；构建产物断言 `tests/unit/render.test.ts`（18 条：基路径/倒序/分页/空态/版画结构/隐私约束零脚本无统计广告外部字体）与 `tests/unit/timeline.test.ts`（10 条）；实测修正原型一处手机端溢出（≤767 的 `.k-media` 覆盖被 `.layout-* .k-media` 特异性压制，致 layout-c 条目 21/9 比例溢出，已按原型意图同级修正）。
- 产品目标：拓宽视野为主、日常资讯为辅。公共时间线不按个人行为排序；可靠发布时间优先，缺失或语义未知时使用固定首次收录时间并明确标注。
- 核心约束：无个性化、无登录、无广告、无阅读历史、无第三方统计；不人工挑选、排序或推荐单条内容；允许来源准入和明确规则下的治理。
- 首版可单源正式公开。用户指定 `https://rss.aishort.top/?type=baidu`，定位为百度热点线索，首版按本站首次收录时间排序，入口标为“查看百度搜索结果”，移除标题热度后缀，不展示或使用热度排序。
- 首源本身有热搜筛选（百度官方《榜单规则》页载明按热度排序、每 5 分钟更新一次，站内 sources 页已引用该出处），不得宣称上游没有算法筛选。feed pubDate 语义已于 2026-10-05 实测核实：为上游聚合器（aishort）的抓取/入库时间，不是百度发布时间（同批 66 条 pubDate 挤在 11 秒内、与上游入库串号同序、恒早于本站收录时间 2–16 小时），不构成「可靠发布时间」——产品口径不变：排序用首次收录时间、管线 originalTime 恒 null；跨生成周期 pubDate 稳定性为非阻塞观察项（不设截止，多源接入或异常时复核）。源内容公开使用许可已于 2026-10-04 由维护者本人核查裁定（非商业、获取信息目的，依据与署名见站内 sources 页「使用许可与署名」段，证据留档台账）。图片、分类、全文和可靠商业标记在本次 feed 核查中缺失，不得臆造。
- 数据采用成功构建快照的最近 7 天窗口；重复抓取不刷新首次收录时间。每页最多 20 条，主题单选并可选“全部”，筛选后分页，刷新重置；首源默认主题为“新闻”“社会”。
- 摘要优先取源摘要、缺失时取源提供正文的纯文本，最多 300 字；当前首源不额外抓网页补图或正文。缺图或失败保留图片区域，用本站占位图；明确禁止外链时不请求源图。
- MVP 含时间线、主题筛选、来源页、关于／原则／隐私、图片与占位、每日更新、来源提交 Issue 模板；随机漫游、搜索、订阅输出和多源对照留到后续。
- 已确认 Astro + TypeScript、GitHub Actions 每日北京时间 08:00 触发及手动触发、GitHub Pages 子路径 `/overthecocoons`；不增加后端、数据库或用户系统。工程骨架、构建与三条工作流（`init-data` 手动初始化 / `update-data` 定时+手动写入 data 分支 / `build-deploy` 只读构建+Pages 部署）均已落地并实跑验证。
- 代码许可证为 MIT，版权署名 `CaiYan12`，`LICENSE` 已创建。来源内容不因项目许可证而重新许可。
- 首版接受全中文；90/10 仅作后续多源方向，不删减内容凑比例。默认固定 11 个主题，优先映射源明确分类，缺失时用来源默认主题。
- UI 结构、风格与动效已在 `docs/ui-alignment.md` / `docs/ui-design.md` 对齐；来源使用说明、稳定身份与跨构建状态、真实构建/浏览器（含跨浏览器矩阵）/动效/部署验收均已完成（2026-10-04，证据见台账与 `docs/mvp-implementation-plan.md` 发布闸门）。
- 原文代码未经验证；实现时必须核对依赖/API、解析和日期异常、抓取失败、去重、内容安全与子路径行为，不能直接复制并宣称可用。
- 产品、UI与MVP-Q1–Q22 已归档确认，规格、架构、依赖证据与实现计划已保存到 docs；MVP-Q13–Q22 于 2026-10-03 继续对齐后确认（初始化手动入口、损坏即停写停发人工恢复、台账无限保留、SHA-256 稳定 ID、三文件契约、并发冲突即失败、仅靠 data 分支历史恢复、wd 规则、隔离条目公开列出及八项工程方案固化）。
- **Ticket 01–08 全部实现完毕并已上线**（2026-10-04）：main 历史于 2026-10-04 重写（`git filter-branch` 抹除 15 张设计评审截图，`.git` 4.94 MB→0.47 MB；**重写前记录的所有 main SHA 一律失效**，data 分支 `444afba` 不受影响，定位用 `git log --oneline`），站点 https://caiyan12.github.io/overthecocoons/ 以**真实源数据**运行（data 分支 `444afba`：100 条真实条目、隔离 0、主题全部映射为「新闻」，「社会」为真实空态），页面不再标注「演示数据」。发布接线已实证：`update-data` 成功推送 data 后发 `repository_dispatch data-updated` → `build-deploy` 读取 data 固定提交、`verifyManifest` 摘要校验、生成 7 天窗口快照、`SNAPSHOT_PATH` 注入构建 → Pages 部署（注意：data 分支 push 本身不触发工作流——push 事件取被推送分支上的工作流文件版本，而 data 分支只有三文件）。动效库 GSAP 3.13.0 已自托管于 `public/vendor/`（T08 裁定，站点运行期零外链请求，SRI 由 dist 内文件实测断言）。本地全量 `pnpm test`（本机 e2e 口径＝chromium 50/50）通过：check 0 error、Node 254/254（2026-10-05 全清后口径；原 244 + 补强用例 10）；5 项目全矩阵 `pnpm test:e2e:matrix` 在全清改动后复跑仍全绿（245 passed + 5 skipped，2026-10-05）。台账 `.superpowers/sdd/mvp-tickets/progress.md` 与各票报告 `task-01..08-report.md` 为实施与验收记录；两轮独立复审已完成（T08 复审 APPROVED；全分支终审 CHANGES REQUIRED 的两条 Important 已修：契约层交叉校验 `identity.stableId`、锁定构建时间基准为 `state.stateTakenAt`），其余 deferred minor 分诊后 41 条已于 2026-10-05 全清（逐条处置口径见 `README.md` 末尾 TODO 与 `docs/remaining-work-report.md`）。
- **来源公开展示许可已完成**（2026-10-04）：维护者本人核查裁定为非商业、获取信息目的使用，依据与署名落在 `/sources/` 「使用许可与署名」段，证据留档台账 `.superpowers/sdd/mvp-tickets/progress.md`；feed 日期语义已于 2026-10-05 核实（见状态段 ③ 与 `docs/mvp-dependency-evidence.md`）。
- **仍未完成（如实标注，不得宣称通过）**：**剩余事项以 `README.md` 末尾 TODO 的 checkbox 清单为准**——① 线上性能已于 2026-10-05 裁决：不立项优化，接受现状并记录为已知限制（Lighthouse 13.5.0 单轮：线上移动 perf 67 / FCP 3.7s / LCP 3.9s，本地移动 90、桌面 100），Lighthouse 维持单轮口径不落门槛，数据岛 41,419 B 内联随同一裁决暂不处理；② deferred minor 41 条已于 2026-10-05 按用户指令全清（修复/测试补强/勘误/取舍裁定记录，逐条口径见 `docs/remaining-work-report.md`，`pnpm test` 全绿：check 0 error、Node 254/254、e2e 50/50）；③ 未核实项已于 2026-10-05 全部核实落档：feed pubDate 语义（裁定＝上游抓取时间，非百度发布时间，产品口径不变，证据见 `docs/mvp-dependency-evidence.md`）、百度热搜《榜单规则》文本（取自规则页而非浮层，站内 sources 页已引用官方出处）、GSAP 许可条款（核查落档）；仅余「跨生成周期 pubDate 稳定性」非阻塞观察项（不设截止，多源接入或异常时复核）——至此项目无阻塞、无待裁决事项。详情与证据见 `docs/remaining-work-report.md`。已闭环（2026-10-04）：跨浏览器 e2e 矩阵全绿（`pnpm test:e2e:matrix` 245+5；本机日常 `pnpm test:e2e` 仅 chromium）、第三方 action 13 处钉 commit SHA（B-②，运行 37206156255 实证）、手机实机由用户验证、来源许可裁定并上线。

## 2026-10-11 UI 与动效现状

- 用户已确认最终 MENU 层次与阴影合适，并授权更新文档、提交推送及核对 CI/CD。最终背景为 94% `--paper` / 6% `--ink`，同主题浅略暗、深略亮；下沿渐隐投影 4px、浓度10%→4%→透明，1px接触线8%。旧倒置配色、40px阴影均已被后续裁定覆盖。发布状态与验证证据见 `docs/ui-release-20261011.md`。
- 功能提交`d2f50e6`已推送main并上线；build-deploy运行`38135446881`的build／deploy均成功。独立线上Chromium明暗关于页验证4px阴影、实际逐字中间帧、全屏MENU、导航／滚动条／页脚边界及CSS产物一致；本地矩阵初轮失败和修复后分次证据见发布记录，不宣称第二次完整矩阵或新真机／FPS验收。
- 维护导航、目录及侧栏时先读 `docs/ui-navigation-alignment.md`：目录240ms对称进退已获GREEN；左右侧栏完整自然高度撑开页脚，完整容纳才吸附，无内部滚动；返回主站为左导航最后一项；导航与目录轨线实际2px，圆点光学对齐并带光圈。
- 维护新增编排时读 `docs/ui-longform-motion.md` / `docs/ui-menu-motion.md`：四说明页正文与HUD完整GSAP编排；MENU全屏不透明下拉／280ms原路上收，收起完成才导航。用户要求新增展示动效完整播放，保留旧首页／目录／光标门控。
- 滚动条与主题光标分别见 `docs/ui-scrollbars.md` / `docs/ui-theme-cursor.md`：自绘覆盖式纵向条不占槽位、页面轨道位于固定nav下方；拖动时光标即时同步；主题点击立即使用目标主题颜色，无双色边缘，内层280ms轻压回弹，过渡光标在nav之上。
- 浏览器验收使用独立浏览器。测试运行期间保持源码与文档冻结，结束后再写文件或构建，避免复用开发服务器的HMR影响结果；自动化移动配置不等同真机或FPS证明。
- 发布动效前用构建产物验收：生产CSS会将毫秒token压缩为秒，运行时按实际单位换算；延迟导航测试等待目标URL后再读取新页ready。开发服务器证据不替代产物行为。
- 分页维护见 `docs/ui-pagination.md`：静态与增强共用 `src/lib/pager.ts`；按分页栏宽度选择首尾／当前页窗口，禁止逐页无限铺开或分页内部滚动。页码跳转限定当前主题有效整数范围，保持无JS链接降级。新增大量页码场景须用真实数据或大页数验证，不能只检查45条演示快照。

## 2026-10-15 返回顶部按钮

- `button.k-top` 已按用户确认方案本地实现：20px细线SVG箭头＋顶横线，2px/5px轻投影，280ms轻抬一次微回弹／160ms原路退场；进度环、400px门槛及原磁吸保持。显隐由 `.k-top-face` 承载，磁吸仍操作button本体，禁止混写transform；进度环SVG使用专门选择器，避免误伤中心图标。
- 隐藏按钮退出Tab序，reduced-motion取消空间运动；反向/缺库/无JS/停钟收尾均已覆盖。GSAP祖先时钟暂停时普通set不渲染，终态使用显式progress推进。详情与边界见 `docs/ui-back-to-top.md`：本地 `pnpm test`（check0错误、Node304、Chromium182）通过，专项五配置28通过＋2触屏磁吸不适用跳过，独立Standards/Spec均0问题；用户已确认效果并授权提交推送，线上证据单独归档，未作新真机验收。
- 功能提交`157052c`已按用户授权推送main并上线；`build-deploy`运行`38670422989`的build/deploy均成功。线上SVG与明暗阴影实看、CSS/客户端脚本与本地逐字节一致、真实线上Chromium平滑回顶回归1/1通过；启动器及其README/记忆未纳入本次提交。详情见 `docs/ui-back-to-top.md` 发布记录。

## 2026-10-15 文字链接统一

- Issue #32 已按两轮确认规则本地实现：全部文字链接常态无下划线并继承颜色，hover 1px 同色线用700ms平滑展开／反向收回，多行逐行绘制、MENU仅文字标签；键盘焦点即时完整线，减弱动态即时显隐，触屏无残留hover。
- 静态及动态文字锚点统一LINK，标题VIEW已替换，版画OPEN及按钮轻量态保持；取消HUD旧4px位移与独立线，保留正文揭幕、主题／分页状态标记及目录进度。维护链接时先读 `docs/ui-links.md`，它覆盖历史靛色外链和相关光标／HUD裁定。
- 集成分支 `codex/link-interactions`，完整 `pnpm test`：check0错误/0警告、build66页、Node304/304、Chromium188通过+1触屏专用跳过；专项五配置26通过+9指针类型不适用跳过；独立Standards/Spec均0问题。独立浏览器实看320px拆字双行标题的中间帧／终态、LINK、明暗及无溢出；未宣称新真机/FPS/线上验证。
- 功能`7508fba`已按授权推送main，Issue32自动关闭；build-deploy38676012434的build/deploy均成功。真实线上Chromium链接专项3/3、独立浏览器明暗/真实hover中间帧/LINK及CSS/JS逐字节一致验证通过。启动器与其README/记忆仍为无关未提交改动；过程修复、验证与临时worktree归档状态见 `docs/ui-links.md`。

## 2026-10-19 五个网站订阅（本地）

- 本地已增加中新网社会／国际／东西问、极客公园、Solidot，保留百度，合计六个订阅；维护采集、来源标注或身份时先读 `docs/multi-source-ingestion.md`。新来源采用明确 URL 身份，百度历史台账不变；公开快照新增 `sourceId`，旧百度快照兼容缺省。
- 六源真实本地演练 214 条、0 隔离；`pnpm test` Node311、Chromium188+1skip 通过，真实快照另构建250页，独立IAB主题筛选/详情/六源状态通过。未提交推送或部署；新增来源公开展示依据仍待核查，旧“无待裁决”段不适用于本次新增来源发布。4322开发预览已注入本地真实快照，详情与边界见上述文档。
- 极客公园 RSS 首张准入文章图已本地接入（30/30），可选 `imageUrl` 穿透 items/快照/数据岛与静态及增强列表/详情；仅 HTTPS imgslim.geekpark.net，保留原容器尺寸/比例/动效，JS 加载失败回退版画，隐私页已说明 CDN 请求与 no-referrer。完整回归 Node314、Chromium188+1skip；真实构建250页、三引擎图片专项12项分次通过。未发布或验证新真机，新增来源图片公开使用依据仍待核查，详见同文档图片节。

## 2026-10-19 时间线图片高光（本地）

- 用户要求保留尺寸/比例与原 hover，在公共时间线及 `/items/<id>/` 详情的源图、占位版画增加鼠标局部高光和轻微纸面投影。光斑独立 transform 跟随、160ms 淡入淡出；细鼠标且支持 hover 才启用，触屏/减弱动态只留静态投影。详情原21:9与移动高度规则保留。维护时先读 `docs/ui-media-surface.md`。
- 揭示结束释放 clip-path，防止投影被裁；图片 tilt/高光随列表上下文清理重建，筛选分页后仍可用。最终 check0错误/0警告、演示build66/真实build250通过，五配置专项42通过+13指针类型不适用跳过；IAB真实源图明暗实看、264×198与窄屏无横溢出。未重跑全站全部测试，无新真机/FPS/线上验证，未提交发布。
- 详情补齐后的五配置表面专项30通过+15指针不适用跳过，check/build66通过；IAB真实详情图820×351.4、局部高光与投影明暗实看通过。此轮未重跑上条包含旧动效编排的42项，不混算为同一轮。
- 入场同步追改：媒体整体 autoAlpha、遮罩至 -20% 与 art 缩放在同一900ms时间线执行，预留投影绘制边界，完成后才接管提前 hover，防止投影末帧突现及缩放争抢。五配置较广专项首轮78通过+21不适用跳过+1移动Safari连续帧不足；诊断后仅放慢验收时钟，连续揭示五配置10/10通过，分次证据详见同文档，不宣称完整100项最终复跑或新真机/FPS/线上验证。

## 2026-10-19 详情逐项入场（本地）

- `/items/<id>/` 返回入口、标题、图片、简介、来源、操作区及HUD分组已增加滚入播放一次的GSAP入场，维护前读 `docs/ui-detail-motion.md`。正文280ms/power3.out轻抬淡入、50ms分组；交互区域仅淡入以保持点击位置稳定。图片复用列表900ms入场/投影/高光接管，原820px/21:9及移动高度规则保持。
- 详情专用首绘门控、1500ms迟到放行/停钟收尾、键盘直显、缺库/减弱动态静态及pagehide回收已实现。最终check0错误/0警告+2既有提示、build66及真实build250通过；五配置联合57通过+13指针/剪贴板不适用跳过。IAB源图1440/390/320图文同宽且无横溢出；无JS冒烟Chromium/WebKit通过，Firefox关闭上下文协议异常未计通过。初轮失败、复制位移修正及验收边界见同文档，未重跑全站全部测试，无新真机/FPS/线上验证，未提交发布。

## 2026-10-19 来源筛选（本地）

- Issue #34（来源多选面板 + 时间线交集过滤）与 #35（详情返回恢复来源筛选与阅读位置）已在集成分支 `codex/source-filter` 完成并复审修复；维护前先读 `docs/ui-source-filter-spec.md`（权威规格 + 验收勾选状态）与 `docs/ui-source-filter.md`（实施与证据）。六个订阅（百度 + 中新网社会/国际/东西问 + 极客公园 + Solidot）按订阅源分别可选，不按网站合并。
- 复审修复要点：①静态分页页首次进入的页码取自分页器 `[aria-current="page"]` 的 `data-page`（原先恒为 1，从 `/page/2/` 进详情再返回会丢页）；②减弱动态只做 opacity 轻淡入淡出（CSS keyframes，无位移/错峰；`kinetic.css` 的 reduced 段不得出现 transform 过渡）；③筛选初始化失败（数据岛损坏）时不接管入口，静态 `<a href="…/sources/">` 保持可用；④快照 history 读写与恢复判定抽到 `src/client/filter-history.ts`；⑤`sameSources`/`SUBSCRIPTION_IDS`/`LEGACY_SOURCE_ID` 收敛为单一事实源（后者在 `src/lib/sources.ts`）。
- 测试口径：e2e 不再断言私有状态机字段 `data-source-state`（只认 `dialog.open` 与可观察语义）；两个 spec 共用 `tests/e2e/source-filter-helpers.ts`；新增静态分页返回、减弱动态中间帧、初始化失败降级、MENU 互斥、取消不滚动、触屏 hover 门控与 320/390/768/1024/1440 × 明暗视口矩阵用例。
- 验证：check 0 错误/0 警告/2 既有提示、build 66 页、Node 336/336、Chromium 全量 245 passed + 3 skipped、来源筛选专项 42 passed + 1 skipped、五配置 210 passed + 5 skipped（跳过为既有触屏专项与 BFCache 显式 skip）。真实六源产物（250 页）在 320/390/768/1024/1440 × 明暗共 12 组实看截图：桌面居中、手机底部上拉、暗色同主题层次、选项 44px、无横溢出；短屏仅面板内容滚动。headless 脚本另复核静态 `/page/2/` 返回保持第 2 页与阅读位置（`scrollY=1332`）、减弱动态 5 帧淡入 + 5 帧淡出且位移恒 0。
- BFCache 命中路径：headless 拿不到 `pageshow.persisted`（五配置显式 skip 并记录），最终用 headful（窗口移出屏幕外）一次性确认 `persisted === true` 时来源/页码/阅读位置均恢复。**headless 自动化仍未覆盖该路径**，不得据一次人工确认宣称自动化已覆盖。
- 仍未验证：新真机、FPS、线上部署；移动配置为设备模拟。未推送、未部署。实施票 #34/#35 已按验收闭环，父规格 #33 保持 OPEN。

## 测试入口与产物契约（2026-10-20）

- `pnpm test` = `check` → `build` → `test:node` → `test:e2e`；**顺序承载依赖**（e2e 的 webServer 与产物断言都依赖 `dist`），不要拆散重排。
- **`test:node` 不先构建**：`tests/unit/render.test.ts` 读既有 `dist/`。已实测「改源码不重建 → 346 项全绿」的静默漏检，故需要「源码与产物一致」的硬保证时用 `pnpm run test:artifacts`（先 build、失败即停）。这是入口选择问题，不是测试缺陷，但仍不得用 `test:node` 的绿色声称产物正确。
- **产物测试测的是夹具，不是生产数据**：`test:artifacts` 与本地 `build` 默认走 `fixtures/snapshot.json`（`src/lib/snapshot.ts` 的 `DEFAULT_SNAPSHOT_PATH`），除非显式注入 `SNAPSHOT_PATH`。生产真实数据产物另由 `build-deploy.yml` 的 `SNAPSHOT_PATH=.snapshot/snapshot.json` 构建，两者不得混为一谈。
- CI 门禁在 `build-deploy.yml` 的 `build` job 内、`upload-pages-artifact` **之前**：`check` + 夹具 `build` + `test:node` + `test:e2e`。任一失败 → `build` 失败 → `deploy`（`needs: build`）不被调度，对 push / workflow_dispatch / repository_dispatch 三种触发同时生效。禁止把这些步骤移到部署之后或另建工作流并联（并联无先后保证，e2e 失败时代码可能已上线）。
- 光标形变测试有**两条路径**，都要保留：正常路径断言真实形变与渲染；超时路径主动延迟 `vt.ready` 越过 250ms 看门狗，断言正确降级（无形变、无残影、后续交互可用）。**不得放大 250ms 看门狗、放宽 ratio 阈值、加 retry 或排除用例**来换取通过——重负载下形变被跳看门狗主动跳过属设计内降级，不是 bug。

## 项目记忆与技能目录

- `.agents/memories/` 为**项目记忆目录**（已入 git 跟踪，不得加入 `.gitignore`）：`memory.md` 为统领索引，登记全部记忆条目与摘要；单条记忆文件名 `YYYYMMDDHHMM.md`（本地时间，精确到分）。会话需要既往项目经验时，先读 `memory.md` 索引再打开对应条目；记忆是经验与过程沉淀，**当前状态以本文件状态段与 Git 现状为权威**，冲突时以现状为准。
- `.agents/skills/` 为**项目技能目录**（已入 git 跟踪，不得加入 `.gitignore`）：项目专用技能以 Markdown 存放，是否加载由本文件「Agent skills」节声明；与个人全局技能（本机安装的斜杠技能）区分，二者不等同。
- **收尾强制更新记忆**：每次任务收尾必须更新 `.agents/memories/`——把本次任务的经验、状态变化、用户裁定写成或修订一条 `YYYYMMDDHHMM.md` 记忆，并同步登记 `memory.md` 索引；任务收尾不允许跳过这一步。
- **记忆机制优先级**：harness（如 opencode 等工具）的用户级/个人记忆机制照常可用；**项目级记忆一律且仅使用本目录 `.agents/memories/`**——不把项目记忆写入 harness 的项目级或工具私有存储，读项目既往经验也以本目录及其索引为准。

## Context7

Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

1. Always start with `resolve-library-id` using the library name and the user's question, unless the user provides an exact library ID in `/org/project` format.
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question). Use version-specific IDs when the user mentions a version.
3. `query-docs` with the selected library ID and the user's full question (not single words).
4. Answer using the fetched docs.

## Personal rules

1. **Never guess.** 严禁臆测事实、代码、配置、API、参数、版本、路径、数据结构、运行结果；无法确定先查证，无法查证则询问用户。
2. **Exact identifiers.** 文件名、路径、变量、函数、字段、JSON/YAML Key、参数、URL、命令、包名等必须严格保持实际大小写、拼写、符号和结构，禁止猜测、归一化或自动修正。
3. **Evidence first.** 涉及现有项目时，优先读取源码、配置、测试、日志、抓包及实际输出；实际环境优先于记忆和惯例。
4. **Fact ≠ inference.** 严格区分事实、推论、建议；未经验证不得写成事实，严禁用 “candidate” 等模糊表述掩盖未知。
5. **No fabrication.** 未执行的命令、未运行的测试、未验证的修改不得声称成功。
6. **Minimal change.** 修改前理解现状，只改必要部分；禁止无关重构、依赖升级或改变既有行为。
7. **Verify.** 修改后尽可能测试；无法验证必须明确说明。Debug 遵循：现象→证据→原因→修复→验证；不得把猜测称为 Root Cause，不得把 Workaround 称为 Fix。
8. **Boundaries.** 保护 Secret、隐私和敏感信息；删除、覆盖、重置、发布及外部通信等高风险操作须谨慎。工具权限不等于执行授权。
9. **Correctness.** 用户错了要指出，自己错了要纠正；新证据优先于旧结论，正确性优先于迎合。
10. **Self-improvement.** use /self-improvement 从用户纠正、失败、调试和项目经验中提取可复用规律，避免重复犯错；重要经验沉淀到持久化记忆或项目文档，但不得自行改变核心规则或编造经验。
11. **Diving Workflow.** 复杂任务采用特定 skill **Align→PRD→Issues→Execute**：
    - **Align:** 用 `/grill-me` 或 `/grill-with-docs` 消除歧义，必要时记录 `GLOSSARY.md`/ADR；简单任务跳过。
    - **SPEC:** 用 `/to-spec` 固化目标、范围、约束、验收标准。
    - **Issues:** 用 `/to-issues` 拆为可验证的 Vertical Slices。
    - **Execute:** 按 `/implement` 依赖执行；条件允许时 `/tdd`：失败测试→实现→通过→重构→提交。可使用 `/subagent-driven-development`。
12. **Proportionality.** 不为流程而流程；简单任务直接完成，复杂任务才启用完整 Workflow。
13. **Communication.** 直接、结构化、克制，避免夸赞和冗余。证据不足时明确说“不确定”，不得用猜测填空。
14. **Plannings.** 当使用计划模式时，编写计划严格采用分阶段、分步的细化步骤，并设计阶段 checkbox 与验收标准，作业过程中需要随时更新计划状态。每阶段完成后执行构建验证，最终完成时执行实机验证。

### 执行补充

- 所有文本使用 UTF-8；PowerShell 读写中文必须显式指定编码，保护原始需求文档。
- Git 提交、推送、合并、部署及对外通信必须有用户授权，技能中的流程步骤本身不构成授权。
- 不自动修改全局规则或持久化记忆；持久化记忆更新须有用户明确请求。
- `/to-issues` 是用户指定的流程名；本机初始化时实际检测到的是 `to-tickets`，未检测到 `to-issues` 文件夹。不得声称二者等同；执行该阶段前确认可用技能和映射。
- 建立构建/测试配置前，没有应用构建或实机验收可执行。后续报告须区分文件检查、本地运行、浏览器验证与线上部署证据。

## Agent skills

### Issue tracker

需求规格和任务使用 GitHub Issues，通过 `gh` CLI 操作；从实际 Git remote 解析目标仓库。See `docs/agents/issue-tracker.md`.

### Triage labels

采用默认五个 triage 标签，与 canonical roles 一一对应。See `docs/agents/triage-labels.md`.

### Domain docs

采用 single-context：根目录 `GLOSSARY.md` + `docs/adr/`，按需创建。See `docs/agents/domain.md`.
