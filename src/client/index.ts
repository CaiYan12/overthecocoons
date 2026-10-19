/**
 * 客户端增强入口（Ticket 05/06）：单入口模块，按页面挂点按需初始化各子系统。
 * - 挂点来自 T04 静态层（data-mode/data-kmenu/data-ktop/data-klist 等），缺哪个跳哪个；
 * - 任一子系统初始化失败只跳过该子系统，不破坏其余增强与无 JS 可读性；
 * - motion（Ticket 06）最先初始化：动效库脚本加载失败 / reduced-motion 时整体退化为静态层
 *   （内容直显、无隐藏初态），其余子系统照常增强；
 * - 来源筛选面板（Issue #34）必须在 initTimeline 之后：面板只读/只提交时间线视图持有的
 *   已应用来源集合（单一事实源），初始化失败时静态入口保持为来源说明页链接；
 * - html[data-oct-client="ready"] 标记模块已执行（测试与调试用，无行为含义）；
 *   motion 另有 html[data-oct-motion="on"|"off"] 与 html[data-oct-intro="done"] 测试挂钩。
 */
import { initCopyLink } from "./copy.ts";
import { initDocNavigation } from "./doc-navigation.ts";
import { initMenu } from "./menu.ts";
import { initLongformMotion } from "./longform-motion.ts";
import { initMotion } from "./motion.ts";
import { initNavigationMotion } from "./navigation-motion.ts";
import { initTheme } from "./theme.ts";
import { initTimeline, sourceFilterHost } from "./timeline-view.ts";
import { initTopButton } from "./top.ts";
import { initScrollbars } from "./scrollbars.ts";
import { initArticleImages } from "./article-images.ts";
import { initDetailMotion } from "./detail-motion.ts";
import { initSourceFilter } from "./source-filter.ts";

function boot(): void {
  // 阅读位置仅在本次访问内存中：关闭浏览器跨加载滚动恢复，使「刷新重置」语义成立
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
  for (const init of [initArticleImages, initMotion, initDetailMotion, initLongformMotion, initDocNavigation, initNavigationMotion, initTheme, initScrollbars, initMenu, initTopButton, initCopyLink, initTimeline]) {
    try {
      init();
    } catch {
      // 单个子系统失败不阻断其余增强；静态层始终可读
    }
  }
  // 来源筛选面板：时间线视图就绪后再接管入口（失败保持静态链接降级）
  try {
    initSourceFilter(sourceFilterHost());
  } catch {
    // 面板未初始化：入口仍是通往来源说明页的原生链接
  }
  document.documentElement.setAttribute("data-oct-client", "ready");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
