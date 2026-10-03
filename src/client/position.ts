/**
 * 阅读位置恢复决策（Ticket 05，纯函数，浏览器/Node 两端可用）。
 *
 * 内存语义（docs/mvp-spec.md「交互与视觉」）：阅读位置只在当前访问内存中，
 * 刷新/重新打开重置。内容变化时保留主题并尽量按原条目恢复，不存在则限制页码并提示变化。
 *
 * 决策规则：
 * - 无记忆 → none（正常渲染请求页）；
 * - 记忆条目存在于当前筛选列表且正好位于目标页 → restore（按原条目恢复）；
 * - 记忆条目不在当前筛选列表（内容变化/主题不含该条目）→ fallback（回退有效页码并播报）；
 * - 记忆条目在列表但不在目标页 → none（用户显式选择的页码优先，不做越页跳转）。
 */
export type RestoreMode = "none" | "restore" | "fallback";

export interface RestoreDecision {
  mode: RestoreMode;
  /** restore 模式下记忆条目在筛选列表中的下标（即 data-gi）；其余为 -1。 */
  index: number;
}

/**
 * @param filteredSorted 当前主题筛选后的完整条目（已按首次收录时间倒序）
 * @param rememberedId 本次访问内存中的阅读条目 ID（无则 null）
 * @param requestedPage 请求页码（1 起，可越界，内部收敛）
 * @param pageSize 每页条数
 */
export function resolveRestore(
  filteredSorted: ReadonlyArray<{ id: string }>,
  rememberedId: string | null,
  requestedPage: number,
  pageSize: number,
): RestoreDecision {
  if (!rememberedId) return { mode: "none", index: -1 };
  const index = filteredSorted.findIndex((entry) => entry.id === rememberedId);
  if (index < 0) return { mode: "fallback", index: -1 };
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
  const targetPage = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const entryPage = Math.floor(index / pageSize) + 1;
  if (entryPage === targetPage) return { mode: "restore", index };
  return { mode: "none", index: -1 };
}
