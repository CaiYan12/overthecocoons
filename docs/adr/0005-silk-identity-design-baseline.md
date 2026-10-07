---
status: proposed
---

# 设计基准更替：v-kinetic → silk（丝线标识）

2026-10-07，T13（票 #30）实施记录。设计裁定（B 版采纳 + 丝纹/靛色/字体三项方案）为维护者
在 #27 原型评审中拍板；本文留档基准更替事实与实现者为落地而拟定的参数，**待总审定稿**。

## 基准更替

- **新视觉基准**：`docs/design/prototype-silk.html` **B 版（默认态，`data-silk="B"`）**——
  维护者 2026-10-07 评审裁定采纳 B 版（静态连接），弃 A 版（解开编排）。
- **旧基准归档**：`docs/design/prototype-timeline.html`（v-kinetic）不再作为视觉基准，
  文件保留作历史参照；其静态层结构（三栏、日组、版画、HUD、菜单）仍是本站骨架，
  silk 基准仅在其上叠加/替换 P2 三项（丝线、靛色、丝纹）并延续 T11 减动效、T12 展示字体。
- 原型文件只读、不入构建；生产实现零外链（原型允许 CDN，生产不沿用）。

## B 版丝线（静态连接）落地参数（实现者拟定，总审定稿）

1. **列表 rail 常驻红线**：`.k-day .k-line.silk-rail`＝原 1px 灰线由同元素上的
   `silk-rail` 类覆盖为 **2px `var(--accent)`**（桌面 left=calc(72px+14px)，移动端 left=9px，
   沿用既有定位）。原型 A 版的 rail 变色 transition 属编排态，不移植——B 版零动效依赖。
2. **日组钉点**：每个日组 rail 顶端一枚 `.silk-pin`（9px 圆、`var(--surface)` 底、
   2px accent 描边，纯装饰 aria-hidden）。B 版为静态空心点（原型的 is-pinned 实心+光晕态
   属 A 版，不移植）。
3. **Hero 静态丝线**：自「茧」字底部穿出（`.silk-anchor` 挂点 + `.silk-static` SVG）。
   参数直取原型 B：双路径（主线 `M58,2 C62,34 …20,178`、副线 40% 透明度）、线宽 2px、
   桌面 110×180 / 移动端 84×138、top 72%/70%、translateX(-55%)。无解开动画。
   与生产 T5 行距（letter-spacing 1.16em）的适配：挂点 `letter-spacing:0` +
   等值 `margin-right:1.16em` 补偿——尾随字距会计入 inline-block 盒宽、把字形推离锚点中心，
   补偿后字形位置与原视觉一致（原型行距仅 .08em，无需此处理）。
4. **与 `.k-day .k-progress` 进度线的关系＝替代**（票面交由实现者裁定）：rail 常驻红线后，
   红色进度线在同位叠合不可见（同一视觉通道）；k-progress 的结构、CSS 与 motion scaleY scrub
   驱动一并移除。阅读进度的信息性反馈由 HUD READING PROGRESS（readbar + pct，T11 保留）
   完整承担——rail 处进度呈现是同一滚动进度的重复通道，不构成信息损失。
5. **节点样式不变**：条目 `.k-node`（9px surface 底、rule 描边、激活态 accent）与原型 B 一致，
   仅其所在 rail 由灰转红。
6. **三降级同构**：B 版天然静态——无 JS（结构即静态）、reduced-motion（无动效可降）、
   移动端（rail 左移 9px、丝线 84×138）三路径呈现一致，e2e 覆盖。
7. **分页/主题页连续性**：KPageHead 页（无 Hero）不做页头连接线——静态走线的唯一锚点是
   Hero「茧」字，页头无该锚点；rail 按日组分段常驻，自首个日组顶（页头下沿）起，
   组间自然衔接。Hero 页的丝线终点点在首日组 rail 顶钉点上，与原型 B 视觉一致。

## 丝纹（稳定 ID 派生）落地参数（实现者拟定，总审定稿）

- 纯函数 `silkTexturePaths(id)`（`src/lib/silk.ts`）：64hex 稳定 ID → 4 条曲线参数
  （1 条灰衬 `s s2` + 3 条 accent 红 `s`），FNV-1a 正逆双混杂种子 + mulberry32 PRNG
  （纯整数运算，ECMAScript 规范定义，跨引擎逐位一致；无 Math.random、无时间依赖）。
- 曲线注入 `viewBox 0 0 264 198`、两端出血（x -10 → 274）；线宽/透明度档位直取原型样例
  （1.2/.5、2/.9、1.4/.6、1/.35）；y 波动带与摆幅为密度克制的实现者参数（见源码 BANDS 表）。
- 确定性由单测锁定（`tests/unit/silk.test.ts`）：同 ID 恒同、12 个不同 ID 两两相异、
  单字符变异敏感、d 语法有界可解析、非 64hex 显式抛错。
- 注入点：时间线标准行版画 + 详情页版画（`KEntryMedia`），客户端重渲染（timeline-view）
  用同一函数注入同构标记；aria-hidden 装饰语义不变（T9 口径延续）；左下角 `.sid` 等宽小字
  为 ID 前 6 位前缀（原型样例同位）。
- 零运行时开销：构建期内联 SVG，无图片请求、无 CDN。

## 靛色站外信号落地参数

- token：`--indigo` 浅 `#2F5168` / 深 `#8DB3C9`（票面交接档口径，加入 :root、
  data-theme=dark、auto 三变量组）。
- 判定规则（确定性，`src/lib/links.ts isExternalUrl`）：绝对 http(s) 且 origin ≠ 站点 origin
  → 站外；相对路径、锚点、非 http(s) 协议、不可解析 → 不染。构建期（KEntryMeta/详情页，
  `Astro.site.origin`）与客户端（timeline-view，`location.origin`）同一函数。
- 应用点（全站排查）：条目「查看百度搜索结果 ↗」（时间线静态 + 客户端重渲染 + 详情页）、
  HUD「提交新来源（GitHub Issue）↗」、关于页提交入口、隐私页 GitHub Issues、
  来源页 4 处（feed 地址、百度榜单规则、百度知识产权声明、运营者博文）。`↗` 保留。
- **有意偏离（票面优先）**：原型 HUD 站外链接仍为 accent 红，票面「全站外链靛色」明确点名
  页脚/HUD 入口——生产按票面染靛。
- **不染站点**：「↩ 返回主站」（`https://caiyan12.github.io/`）与本站同 origin（部署于
  caiyan12.github.io/overthecocoons），按规则属家族内导航，保持原样式；站内链接
  （品牌、导航、详情、主题 tab、分页、页脚站内导航）零变化。
- 「复制链接」按钮虽与外链相邻且复用 ext 类名（历史按钮样式钩子），但复制的是本站详情 URL
  （站内动作），CSS 显式 `color:inherit` 不染靛。
- 对比度实测（WCAG 2.x 相对亮度复算，测试留数）：浅 7.71:1、深 7.96:1，均 ≥4.5:1（AA）。

## 字体项

T12（票 #29）已先行落地（思源宋体 Heavy 子集自托管 + `--font-display`），本票无改动，
记录其为 silk 三项采纳之一。
