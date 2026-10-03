/**
 * 客户端增强入口（Ticket 05）：单入口模块，按页面挂点按需初始化各子系统。
 * - 挂点来自 T04 静态层（data-mode/data-kmenu/data-ktop/data-klist 等），缺哪个跳哪个；
 * - 任一子系统初始化失败只跳过该子系统，不破坏其余增强与无 JS 可读性；
 * - html[data-oct-client="ready"] 标记模块已执行（测试与调试用，无行为含义）；
 * - 动效（GSAP、过渡面板、光标、HUD 阅读）全部属 Ticket 06，本模块不做。
 */
import { initCopyLink } from "./copy.ts";
import { initMenu } from "./menu.ts";
import { initTheme } from "./theme.ts";
import { initTimeline } from "./timeline-view.ts";
import { initTopButton } from "./top.ts";

function boot(): void {
  // 阅读位置仅在本次访问内存中：关闭浏览器跨加载滚动恢复，使「刷新重置」语义成立
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
  for (const init of [initTheme, initMenu, initTopButton, initCopyLink, initTimeline]) {
    try {
      init();
    } catch {
      // 单个子系统失败不阻断其余增强；静态层始终可读
    }
  }
  document.documentElement.setAttribute("data-oct-client", "ready");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
