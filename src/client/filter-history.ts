/**
 * 详情返回快照的 history 读写与恢复判定（Issue #35，复审 B11 抽取）。
 *
 * 从 src/client/timeline-view.ts 抽出的原因：时间线视图同时承担渲染、来源集合、分页、
 * 阅读位置与快照，属于 Divergent Change 风险点。本模块只做「history.state 的读写与
 * 导航类型判定」这一件事，渲染与定位仍留在时间线视图（通过回调注入），不反向依赖 DOM。
 *
 * 语义（规格 Implementation Decisions，未改动）：
 * - 快照只写进当前历史条目的 `history.state`（键 `octFilter`），不新增 URL 参数、静态路由、
 *   localStorage/sessionStorage，也不发送给服务端或统计；
 * - 刷新或重新打开是新的历史条目，`history.state` 不带本键 → 来源回到全部；
 * - 只有浏览器后退/前进（`back_forward`，含 BFCache 命中）才恢复；`navigate` / `reload` /
 *   `prerender` / 未知一律不恢复。
 */
import { FILTER_STATE_KEY, readFilterState, shouldRestore, type FilterState } from "./return-state.ts";

/**
 * 把当前条件写进 history.state（`replaceState`，不新增历史条目）。
 * 异常时静默跳过（快照丢失只退化为「返回不恢复」，不阻断阅读）。
 */
export function writeFilterHistory(state: FilterState): void {
  try {
    const previous =
      typeof history.state === "object" && history.state !== null ? history.state : {};
    history.replaceState({ ...previous, [FILTER_STATE_KEY]: state }, "");
  } catch {
    // 快照写入失败不阻断阅读；下一次状态变化会重试。
  }
}

/** 本次导航类型（`performance` 不可用时返回 undefined → 不恢复）。 */
export function navigationType(): string | undefined {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type;
  } catch {
    return undefined;
  }
}

/**
 * 装上恢复入口：启动时（`back_forward`）与 BFCache 命中时（`pageshow.persisted`）各读一次
 * `history.state`，交给注入的回调重放。返回「启动时是否已恢复」供调用方决定是否写初始快照。
 */
export function restoreFilterHistory(onRestore: (state: FilterState) => void): boolean {
  // BFCache 命中时模块不重跑（页面从内存恢复，pageshow 在 boot 之后派发）：
  // 首次导航的 pageshow 也派发但 persisted 为 false，不触发。
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const restored = readFilterState(history.state);
    if (restored) onRestore(restored);
  });
  if (!shouldRestore(navigationType(), false)) return false;
  const restored = readFilterState(history.state);
  if (!restored) return false;
  onRestore(restored);
  return true;
}
