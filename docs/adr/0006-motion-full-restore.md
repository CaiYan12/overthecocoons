---
status: accepted
---

# 动效全量回补：撤销 Q5 减动效裁定

2026-10-07，T14（票 #31）实施记录。**裁定主体是维护者本人**：P2 系列实施完成后维护者实机审查，
对原「Q5 减动效」裁定改判为 **A：全面恢复**——动效恢复到本轮 UI 优化前（`a1ce4d5`）的形态与参数。
本文取代以下裁定的动效维度：

- **ADR 0004**（Hero 仅首页、轻量页头与首次 intro 判定）中「首次 intro 判定规则」一节——
  `shouldPlayIntro` 判定删除（`src/lib/intro-rule.ts` 及其单测已删），恢复「有 Hero 即播 intro」；
  ADR 0004 其余内容（Hero 仅时间线第一页、轻量页头设计参数）不受影响，继续有效。
- **ADR 0005**（设计基准更替：silk）第 4 条「与 `.k-day .k-progress` 进度线的关系＝替代」——
  替代裁定撤销；T13 的丝线 B 版静态 rail（常驻红线 + 钉点）与丝纹、靛色、字体项全部保留。
- T11 票面（UI 票 #28）的减动效部分（视差/tilt/磁性/hint 循环/拆字/摘要 clip）。
- T1 票面中 k-dot 脉动移除项。

## 恢复清单与参数出处（均直取 `a1ce4d5`，无参数改动）

1. **Hero 视差**：hero-en `yPercent 26`、幽灵日期 `yPercent 60`，`scrollTrigger start "top top"`
   / `end "bottom top"` / `scrub 0.4`；scroll hint 滚动淡出（`autoAlpha 0`，scrub true）保持。
2. **版画 tilt**：`initTilt`（rotateX ×−8 / rotateY ×10、quickTo 0.4s power3、enter scale 1.05 /
   leave scale 1）+ `.k-media-tilt` 三层 DOM（构建期 KEntryMedia 与客户端 timeline-view 同构）
   + CSS `perspective: 900px` / `preserve-3d` / `will-change: transform`。tilt 包裹整个 art 层
   （丝纹 SVG 在 art 内随动——与 a1ce4d5 的差异仅 art 内部内容由 T13 丝纹取代）。
3. **光标磁性**：`initMagnetic`（收集点 `.k-tabs .tab`、`[data-mode]`、`[data-kmenu-open]`、
   `[data-ktop]`；≤8px、×0.3、quickTo 0.3s power3、elastic.out(1,.4) 回正；仅 pointer:fine）。
4. **k-dot 脉动**：`@keyframes k-pulse { 50% { opacity: .35 } }`、`animation: k-pulse 2.2s
   ease-in-out infinite`；HUD 快照文案（「快照 · 每日更新 · …（北京时间）」）不动。
5. **scroll hint 循环**：`.k-scrollhint i` 灰底 72×1 overflow hidden + `::after` accent 划线
   `@keyframes k-hint 2.4s var(--ease-out) infinite`（45% 归零 / 90%,100% 出画）。
6. **列表标题拆字升起**：`.k-headline a` splitChars + `yPercent 110/rotate 2` 初态 +
   `yPercent 0/rotate 0, duration 0.5, stagger 0.02` 揭示。splitChars 用 T13 递归版（保 T5
   aria 语义：链接 a 命名点 aria-label=完整标题、.kw/.ch aria-hidden）；紧凑行（无摘要条目）
   无媒体无摘要，标题拆字与 meta 揭示照常参与。
7. **摘要 clip + meta 揭示**：摘要 `clip-path inset(0 0 100% 0)` → `inset(0 0 0% 0)`（0.42s
   power2.out，delay 0.08）；meta `autoAlpha 0 + letterSpacing .2em` → `autoAlpha 1 +
   letterSpacing .04em`（0.3s power2.out，delay 0.14）。T11「letterSpacing 每帧触发布局」的
   性能顾虑随裁定 A 撤销（一次性揭示，a1ce4d5 即此形态）。
8. **intro 每页重播**：`shouldPlayIntro`（referrer / Navigation Timing 判定）删除，有 Hero 即
   经 `scheduleIntro` 播放（T12 字体就绪等待保留）；`data-oct-intro=done` 标记语义不变
   （补间完成时打标）。T12 的 fonts.ready 竞速与预绘制遮蔽解除时序不受影响。
9. **k-progress 进度线**：`.k-day .k-progress` 恢复 a1ce4d5 形态（2px accent、`scaleY(0)`
   起始、transform-origin top、will-change: transform）+ motion scaleY scrub（start "top 72%"
   / end "bottom 55%" / scrub 0.6）。**叠合关系**：T13 静态丝线 rail（`silk-rail` 常驻红线）
   保留，进度线 DOM 置于 rail 之后同位覆盖（构建期 TimelinePage 与客户端 dayGroupsHtml 同构）。
   已知呈现事实（留档）：rail 与进度线同为 2px accent 红，同位叠合后进度生长在视觉上与常驻
   rail 重合——裁定 A 明确接受该形态（结构与驱动恢复优先），rail 处进度反馈的可见性由
   HUD READING PROGRESS（readbar + pct）继续承担。
   **T14 追改（2026-10-07 二次裁定，用户实机复审后）**：上述同色叠合不可见问题由维护者裁定解决——
   rail 回归旧灰线样式（`silk-rail` 2px accent 覆盖与类删除，1px `var(--rule)` + 暗色 45% accent
   混 rule 变体恢复），红色 accent 让位给进度线恢复可见；丝线身份由 Hero 穿出丝线、日组钉点与
   版画丝纹承载。本文第 9 条的进度线形态与驱动不变，仅叠合底色变更（ADR 0005 第 1 条同步注记被取代）。
10. **will-change 验收线调整**：总审「≤5」断言改为「不高于 a1ce4d5 基线水平（≤7）」——
    恢复后合成层回增（.k-hero-en / .k-hero-date / .k-media-tilt / .k-progress）是预期行为。

## 不受影响的既定裁定（T14 不动清单）

P0 修复（时区 / VT 真播放 / header 守卫 / 主题 auto / a11y / 快照口径）、P1 版式诚实化
（两档版式 / 日组头 / 批次规则 / 摘要 300 字 / 轻量页头——无 Hero 页本无 intro 属既定）、
丝线 B 版静态 rail + 丝纹 + 靛色（#30）、字体子集与 @font-face 内联（#29）、自定义光标本体
（语义两档）、NOW READING 随动、客户端图纪律（客户端模块禁止 value 级导入 domain/node 模块）。

## 三降级复核

- 无 JS：恢复项全部为 JS 驱动或纯增强，静态层结构完整（进度线 scaleY(0) 不显示、hint 划线
  动画为 CSS 循环、k-dot 脉动为 CSS 循环——两者无 JS 亦成立且无害）。
- reduced-motion：`initMotion` 整体不启用（data-oct-motion=off），GSAP 驱动项全静；CSS 循环
  （k-pulse / k-hint）有各自 `@media (prefers-reduced-motion: reduce)` 关停规则（a1ce4d5 语义带回）。
- 移动端：磁性 / tilt / 自定义光标维持 pointer:fine 门槛；视差 scrub 不分设备但属既有 a1ce4d5 形态。
