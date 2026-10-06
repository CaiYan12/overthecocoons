---
status: proposed
---

# Hero 仅首页、轻量页头与首次 intro 判定

2026-10-06，T8（票 #25）实施记录。语义前提（Hero 仅时间线第一页、开场 intro 仅会话首次、
判定零存储）为用户在 #16 grilling 中裁定并落档于 ADR 0003 关联裁定与票面；本文留档
实现者为满足该语义而拟定的精确规则与设计参数，**待总审定稿**。

## Hero 渲染规则

时间线四类路由（index、page/[page]、topics/[slug]/index、topics/[slug]/page/[page]）中，
仅「全部」主题第 1 页（即 `/`）渲染 KHero（携带 `data-hero`）；其余三类路由渲染轻量页头
`KPageHead`（不携带 `data-hero`）。轻量页头不得带 `data-hero`：T3 的 header 首屏隐藏/
滚动显隐守卫仅以运行时 `[data-hero]` 存在性分支，页面无该挂点即 header 常显。

## 轻量页头设计参数（实现者拟定，总审定稿）

- 文案由纯函数 `pageHeadInfo(topic, page, isFixture)` 驱动（src/lib/timeline.ts），服务端与
  客户端重渲染共用：大字＝主题名（「全部」为「公共时间线」）；说明行＝英文标签
  （EN_LABEL，「全部」为 PUBLIC TIMELINE）· 「第 N 页」（仅 N≥2）· 「按收录时间排序」
  （演示快照追加「（演示数据）」，与日组头 k-day-sub 同口径）。
- 字阶与日组头同族：大字 `700 clamp(36px, 4.5vw, 64px)/1.1 var(--serif)`、`letter-spacing .04em`
  （与 .k-day-big 同档）；说明行 `11px / .26em / var(--muted)`（与 .k-day-sub 同档）。
- 版面：置于 hero 同位（三栏之上全宽），顶部净空桌面 128px / 移动端 96px（清固定 header
  68px/60px + 呼吸）；不加尺规线、竖排词等 Hero 装饰，保持「轻量」。
- 语义：页头大字为 `<h1>`（该路由此前无 h1）；客户端切主题/翻页后由 timeline-view 按同一
  文案函数同步改写，避免静态页头与客户端渲染的列表主题不一致。

## 首次 intro 判定规则（零存储）

开场编排（Hero Intro）仅当页面存在 Hero **且**「首次到达」时播放；跳过时必须立即标记
`html[data-oct-intro="done"]`（e2e waitForFunction 依赖该标记，且不得让等待补间收尾），
不建任何隐藏初态（内容直显）。Hero 页自身的滚动显隐（84px 阈值）与 Parallax 不受跳过影响。

判定函数 `shouldPlayIntro`（src/lib/intro-rule.ts，纯函数，输入 navigationType/referrer/origin）：

1. Navigation Timing 类型为 `reload` 或 `back_forward` → 跳过（刷新、历史前进/返回）；
2. 其余类型（`navigate` 等）且 `document.referrer` 解析后 origin 与站点 origin 相同 → 跳过
   （站内链接跳转到达）；
3. 其余情况（无 referrer、跨源 referrer、referrer 畸形、Navigation Timing 不可用时的
   referrer 兜底）→ 播放（直接到达/从外源进入）。

判定零存储：不写 sessionStorage/localStorage（privacy 页明文不写入 sessionStorage，
e2e 断言 sessionStorage 恒空、localStorage 仅主题 key）。Astro 静态站无客户端路由，
每次站内导航都是完整加载，referrer 规则可靠覆盖翻页/切主题往返；「同一标签页内首次
直接到达后刷新」与「翻页后返回」均按规则跳过，属有意取舍（宁可少播不可重播）。

已知边界（如实记录）：用户在站内浏览后从外源链接再次直接进入首页会重播 intro——
零存储约束下无法区分「全新会话」与「回访」，按「从外源进入＝新一次到达」处理。
