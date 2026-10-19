# 条目详情页入场

2026-10-19 用户指定 animate、gsap-core，要求 `/items/<id>/` 各项内容入场，同时保持图片适配。目标是页面阅读顺序与空间连续性，不修改内容、排序、布局或图片尺寸。

## 当前行为

- 返回链接、标题、图片、简介、来源元信息、操作区分别入场；HUD 的 SOURCE / STATUS / PROJECT 三组也参与。沿阅读顺序错开50ms，首屏以下内容在滚入视口时播放一次。全站导航、MENU 和页脚沿用既有行为。
- 标题、正文和非交互 HUD 内容使用280ms（`--motion-normal`）/power3.out 的透明度与12px轻抬。包含链接或按钮的区域仅淡入，保证点击与聚焦过程中入口位置稳定。
- 图片复用 `motion.ts:addMediaEntrance`：整体 autoAlpha、clipPath、art 缩放同一时间线900ms/power4.out；四边放开至-20%容纳投影，完成后再接管鼠标高光/倾斜。源图和占位版画一致，原820px/21:9、移动端clamp高度、object-fit:cover保持。
- 详情专用首绘标记在head中建立，模块准备好初态后解除；1500ms兜底已放行时，迟到模块直接保持静态，不重新遮蔽。无JS、缺库、减弱动态时静态可读。
- 键盘聚焦同步结束相应组；入场计时停滞1500ms时通过显式progress(1)收尾。pagehide回收上下文、监听器和图片等待状态，恢复页不重播；运行中切换减弱动态会退回静态。BFCache/pagehide与停钟测试为受控模拟，不等同真实浏览器缓存或真机证明。

## 本地验证

- 最终 `pnpm run check`：0 errors / 0 warnings、2条既有execCommand弃用提示；演示构建66页、真实214条快照构建250页通过。
- 最终五配置联合专项完整一轮：57 passed / 13 skipped（指针类型或剪贴板权限不适用，1.1m）。包括详情首绘与顺序中间帧、图片/图文对齐/高光、停钟与焦点、pagehide恢复、减弱动态、缺库、迟到脚本，及原图片所有权、复制成功/回退/失败播报、脚本失败降级。未重跑全站全部测试。
- IAB真实Geekpark图：1440px下820×351.4；390px下350.3×202.9；320px下280×180。图文同宽、横向溢出0，源图加载成功。入场中间帧 `audit/detail-motion-entry.png`，终态 `audit/detail-motion-final.png`，窄屏 `audit/detail-motion-320.png`。
- 独立无JS冒烟：Chromium/WebKit通过；Firefox已完成内容断言，但在关闭上下文时报 `Browser.removeBrowserContext` / `_maybeDontRestoreTabs` 协议错误，未计为通过。该错误发生于禁用JS环境，未据此修改产品或依赖。

## 过程与边界

- 初轮详情/图片联合58通过+21跳过+1 Firefox终态等待超时；隔离复核又在关闭上下文时报上述协议错误。采样器补齐停止与pagehide回收后，该项单独1/1及最终联合都通过；不声称已经确定最初超时或协议错误的单一根因。
- 复制回归最初在Chromium三条路径失败；包含交互入口的区域移除入场位移后，三路径及最终联合通过。按事件时序推断，原焦点直显推进会移动点击目标，因此保留淡入、取消入口位移；未把该推断写成已录制的pointer事件证据。
- 实现依据通过Context7核对的 [GSAP Timeline](https://gsap.com/docs/v3/GSAP/Timeline/) / [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) / [context](https://gsap.com/docs/v3/GSAP/gsap.context())。
- 未提交、推送、部署，无新真机/FPS/线上验收；新增来源公开展示依据仍遵循多源文档的未核查边界。
