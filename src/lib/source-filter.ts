/**
 * 来源筛选纯规则（Issue #34）：订阅固定次序、条目来源归属、来源并集 × 主题交集、
 * 入口标题/辅文、全选三态与外部输入规范化。
 *
 * 本模块是纯计算（对象进、对象/字符串出），无 I/O、无 DOM、无 Node 依赖，
 * 构建期、客户端增强与 Node 单测共用同一份规则（不镜像第二份）。
 *
 * 口径（规格 Implementation Decisions）：
 * - 六个订阅顺序固定，不按热度、结果量或访问行为重排；中新网三个频道分别可选；
 * - 条目来源缺失时沿用历史百度归属（旧快照兼容，身份与采集逻辑不变）；
 * - 已选来源之间取并集，再与当前主题取交集；不改变输入顺序（调用方传已排序数组）；
 * - 零来源集合返回空列表，不退化成「全部」——零源不是正式状态，由 UI 层阻止提交，
 *   纯函数仍须可判定。
 */
import { NEWS_SOURCES, sourcePresentation } from "./sources.ts";

/** 历史首源 ID（旧快照条目无 sourceId 时的归属；与 src/lib/sources.ts 同一事实源）。 */
export const LEGACY_SOURCE_ID = "baidu-aishort";

/**
 * 六个订阅的固定次序：百度第一（历史首源），其余与 NEWS_SOURCES 声明顺序一致。
 * 名称一律经 sourcePresentation 取得，不另抄一份字符串。
 */
export const SUBSCRIPTIONS: readonly { id: string; name: string }[] = [
  LEGACY_SOURCE_ID,
  ...NEWS_SOURCES.map((source) => source.id),
].map((id) => ({ id, name: sourcePresentation(id).name }));

/** 已知订阅 ID 集合（固定次序）。 */
const SUBSCRIPTION_IDS: readonly string[] = SUBSCRIPTIONS.map((item) => item.id);

/** 条目归属来源：显式 sourceId 优先，缺省沿用历史百度归属。 */
export function entrySourceId(entry: { sourceId?: string }): string {
  return entry.sourceId ?? LEGACY_SOURCE_ID;
}

/**
 * 来源并集 × 主题交集：先按已选来源取并集，再与当前主题取交集；
 * 保持输入顺序不变（不重排、不重新抓源、不改首次收录时间）。
 * `topic` 为「全部」时不限主题。
 */
export function filterTimeline<T extends { topic: string; sourceId?: string }>(
  sorted: readonly T[],
  topic: string,
  sources: readonly string[],
): T[] {
  const selected = new Set(sources);
  if (selected.size === 0) return [];
  return sorted.filter(
    (entry) =>
      selected.has(entrySourceId(entry)) && (topic === "全部" || entry.topic === topic),
  );
}

/** 入口标题：单源显示来源名；多源与全选显示「多源聚合」。 */
export function selectionTitle(sources: readonly string[]): string {
  return sources.length === 1 ? sourcePresentation(sources[0]).name : "多源聚合";
}

/** 入口辅文：「已选 N / 6 个订阅源」。 */
export function selectionSummary(sources: readonly string[]): string {
  return `已选 ${sources.length} / ${SUBSCRIPTIONS.length} 个订阅源`;
}

/** 全选三态：全选 true / 部分 "mixed" / 未选 false（供 input.indeterminate 使用）。 */
export function allState(sources: readonly string[]): boolean | "mixed" {
  const selected = new Set(sources);
  const count = SUBSCRIPTION_IDS.filter((id) => selected.has(id)).length;
  if (count === 0) return false;
  return count === SUBSCRIPTION_IDS.length ? true : "mixed";
}

/**
 * 规范化外部输入（history.state 等）：只保留已知订阅 ID、去重，并按固定次序重排；
 * 非数组、空集合或全部非法 → null（调用方据此回退到全选）。
 */
export function normalizeSources(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const provided = new Set(raw.filter((item): item is string => typeof item === "string"));
  const normalized = SUBSCRIPTION_IDS.filter((id) => provided.has(id));
  return normalized.length === 0 ? null : normalized;
}
