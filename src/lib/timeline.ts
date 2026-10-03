/**
 * 时间线渲染纯函数（Ticket 04）：排序、按日分组、分页、日内权重三档、时间格式化与站点内路径。
 * 版面规则与 docs/design/prototype-timeline.html 的 v-kinetic 变体一致：
 * - 每个日期组内 di=0 为头条（layout-c + w1），di=1 为 w2，其余 w3；
 * - di>0 的版面按奇偶交替（奇 layout-a，偶 layout-b）；
 * - 同一首次收录时间的条目以稳定 ID 升序作确定性次序（docs/mvp-architecture.md 建议）。
 *
 * 本模块只做纯计算（字符串进、字符串/数组出），不读文件、不触网、不用 import.meta.env，
 * 可被 Node 测试直接导入；基路径拼接由渲染层（src/lib/paths.ts）负责。
 */
import type { PublicEntry } from "../domain/contract.ts";

/** 每页最多条数（规格：每页最多 20 条）。 */
export const PAGE_SIZE = 20;

/** 全部 + 固定 11 个主题（顺序与原型 v4 一致）。 */
export const TOPICS = [
  "全部", "新闻", "科技", "文化", "科学", "社会",
  "经济", "环境", "健康", "教育", "艺术", "哲学",
] as const;
export type Topic = (typeof TOPICS)[number];

/** 主题 → 英文 URL slug（静态渲染使用独立页面，避免中文路径；「全部」即首页不设 slug）。 */
export const TOPIC_SLUGS: Record<string, string> = {
  全部: "",
  新闻: "news",
  科技: "tech",
  文化: "culture",
  科学: "science",
  社会: "society",
  经济: "economy",
  环境: "environment",
  健康: "health",
  教育: "education",
  艺术: "arts",
  哲学: "philosophy",
};

/** 主题 → 数据版画竖排英文词（与原型 EN_LABEL 一致）。 */
export const EN_LABEL: Record<string, string> = {
  全部: "INDEX",
  新闻: "NEWS",
  科技: "TECH",
  文化: "CULTURE",
  科学: "SCIENCE",
  社会: "SOCIETY",
  经济: "ECONOMY",
  环境: "ENVIRONMENT",
  健康: "HEALTH",
  教育: "EDUCATION",
  艺术: "ARTS",
  哲学: "PHILOSOPHY",
};

/** 原型英文月份表（日期组大字与 Hero 幽灵日期用）。 */
const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** 首次收录时间倒序；同时间按稳定 ID 升序（确定性）；不修改输入数组。 */
export function sortEntriesDesc(entries: PublicEntry[]): PublicEntry[] {
  return [...entries].sort((a, b) => {
    const byTime = Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface DayGroup {
  /** 日期前缀（ISO 字符串截取，不做时区换算）。 */
  date: string;
  entries: PublicEntry[];
}

/** 按日期前缀对已排序条目做连续分组。 */
export function groupEntriesByDay(sorted: PublicEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of sorted) {
    const date = item.firstSeenAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.entries.push(item);
    else groups.push({ date, entries: [item] });
  }
  return groups;
}

export interface PageSlice<T> {
  /** 收敛后的当前页（1 起）。 */
  page: number;
  totalPages: number;
  /** 本页首条在全量序列中的下标（跨页连续全局序号用）。 */
  start: number;
  slice: T[];
}

/** 分页：页码越界收敛到边界；空集合时 totalPages=1。 */
export function paginate<T>(items: T[], page: number): PageSlice<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  return { page: current, totalPages, start, slice: items.slice(start, start + PAGE_SIZE) };
}

export type EntryLayout = "layout-a" | "layout-b" | "layout-c";
export type EntryWeight = "w1" | "w2" | "w3";

/** 日内权重三档与版面分配（与原型 kineticEntryHTML 一致）。 */
export function entryWeights(di: number): { layout: EntryLayout; weight: EntryWeight } {
  const layout: EntryLayout = di === 0 ? "layout-c" : di % 2 === 1 ? "layout-a" : "layout-b";
  const weight: EntryWeight = di === 0 ? "w1" : di === 1 ? "w2" : "w3";
  return { layout, weight };
}

/** “HH:mm”（ISO 字符串截取，不做时区换算）。 */
export function formatClock(iso: string): string {
  return iso.slice(11, 16);
}

/** “YYYY-MM-DD HH:mm”（ISO 字符串截取，不做时区换算）。 */
export function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/** 英文月份名（“01”→JANUARY）。 */
export function monthEn(month: string): string {
  return MONTHS[Number(month) - 1] ?? "INDEX";
}

/**
 * 主题页站点根相对路径（不带基路径）：全部=首页，其余 /topics/<slug>/，第 2 页起 /page/N/。
 */
export function topicPagePath(topic: string, page: number): string {
  if (topic === "全部") {
    return page <= 1 ? "/" : `/page/${page}/`;
  }
  const slug = TOPIC_SLUGS[topic];
  if (!slug) throw new Error(`未知主题：${topic}`);
  const base = `/topics/${slug}/`;
  return page <= 1 ? base : `${base}page/${page}/`;
}

/** 详情页站点根相对路径：/items/<64hex>/。 */
export function itemPath(id: string): string {
  return `/items/${id}/`;
}

/** 最新收录日期（已排序首条的日期前缀）与当日条数（Hero 幽灵日期与菜单数据列用）。 */
export function latestDayStats(sorted: PublicEntry[]): { date: string; count: number } {
  const date = sorted[0]?.firstSeenAt.slice(0, 10) ?? "";
  return { date, count: sorted.filter((entry) => entry.firstSeenAt.slice(0, 10) === date).length };
}
