/**
 * 详情返回的来源筛选与阅读位置快照（Issue #35，纯规则，浏览器/Node 两端可用）。
 *
 * 语义（规格 Implementation Decisions）：
 * - 快照只写进当前历史条目的 `history.state`（键 `octFilter`），不新增 URL 参数、静态路由、
 *   localStorage/sessionStorage，也不发送给服务端或统计；
 * - 刷新或重新打开是新的历史条目，`history.state` 不带本键 → 来源回到全部；
 * - 只有浏览器后退/前进（`back_forward`，含 BFCache 命中）才恢复；`navigate` / `reload` /
 *   `prerender` / 未知一律不恢复。BFCache 命中时模块不重跑，`pageshow.persisted` 为 true
 *   且导航类型仍是 `back_forward`，两条判据都指向恢复。
 * - 结构非法、来源非法、主题未知、页码非正整数 → null（调用方按「无快照」处理，即全选来源）。
 *
 * 本模块只做纯计算（对象进、对象出），不触 DOM、不读存储，可被 Node 单测直接导入。
 */
import { TOPICS } from "../lib/timeline.ts";
import { normalizeSources } from "../lib/source-filter.ts";

/** `history.state` 内的快照键（唯一事实源，写读两端共用）。 */
export const FILTER_STATE_KEY = "octFilter";

/** 已应用筛选条件 + 当前阅读条目（页码 1 起）。 */
export interface FilterState {
  /** 已应用来源集合（非空、按 SUBSCRIPTIONS 固定次序）。 */
  sources: string[];
  /** 已应用主题（TOPICS 之一）。 */
  topic: string;
  /** 已应用页码（1 起正整数）。 */
  page: number;
  /** 当前阅读条目 id（无则 null）。 */
  readId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从 `history.state`（或任意外部输入）读出快照；任何一项不合法即整体判为无快照——
 * 部分恢复会让入口文案与实际列表不一致，比不恢复更糟。
 */
export function readFilterState(raw: unknown): FilterState | null {
  if (!isRecord(raw)) return null;
  const filter = raw[FILTER_STATE_KEY];
  if (!isRecord(filter)) return null;
  const sources = normalizeSources(filter.sources);
  if (!sources) return null;
  const topic = filter.topic;
  if (typeof topic !== "string" || !(TOPICS as readonly string[]).includes(topic)) return null;
  const page = filter.page;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return null;
  const readId = filter.readId;
  if (readId !== null && readId !== undefined && typeof readId !== "string") return null;
  return { sources, topic, page, readId: readId ? readId : null };
}

/**
 * 是否应在本导航中恢复：只有浏览器后退/前进（`back_forward`）或 BFCache 命中才恢复。
 * `navType` 取自 `performance.getEntriesByType("navigation")[0]?.type`。
 */
export function shouldRestore(navType: string | undefined, persisted: boolean): boolean {
  if (persisted) return true;
  return navType === "back_forward";
}
