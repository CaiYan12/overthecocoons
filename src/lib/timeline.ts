/**
 * 时间线渲染纯函数（Ticket 04 起，T7 版式诚实化演进）：排序、按日分组、分页、两档版式、
 * 日组头规则、时间格式化与站点内路径。
 * 版式口径见 docs/adr/0003-timeline-hierarchy-and-time-presentation.md：
 * - 不设位置型头条档；条目两档由「有无摘要」驱动（entryLayout），有摘要按日内序号奇偶交替；
 * - 日组头规则驱动（dayHeadInfo）：同日条目分钟全相同 → 批次形态，条目行省略时间；
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
  /** 北京时间日期「YYYY-MM-DD」（日界按北京时间归属，UI 票 #18）。 */
  date: string;
  entries: PublicEntry[];
}

/** 按北京时间日期对已排序条目做连续分组（倒序输入保证日期严格降序）。 */
export function groupEntriesByDay(sorted: PublicEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of sorted) {
    const date = beijingDate(item.firstSeenAt);
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

export type EntryLayout = "layout-a" | "layout-b" | "layout-compact";

/**
 * 两档版式（ADR 0003「取消位置型头条档」）：条目同级，层级由内容事实驱动——
 * 有摘要 = 标准版式，按日内序号奇偶交替（di 奇图右 layout-a，di 偶图左 layout-b，di=0 归偶）；
 * 无摘要 = 紧凑行 layout-compact（无版画、无摘要段），不参与左右交替。
 * 判定只用「有无摘要」这一确定性内容事实，无展示位置语义、无编辑挑选。
 */
export function entryLayout(di: number, hasSummary: boolean): EntryLayout {
  if (!hasSummary) return "layout-compact";
  return di % 2 === 1 ? "layout-a" : "layout-b";
}

/** 日组头规则输出（ADR 0003「日组头规则驱动」）。 */
export interface DayHeadInfo {
  /** true = 批次形态（同日条目首次收录分钟全相同）：日组头显示「批次 hh:mm · N 条」，条目行省略时间。 */
  batch: boolean;
  /** 批次时刻（北京时间 HH:mm）；batch=false 时为 null。 */
  clock: string | null;
  /** 该日条目数。 */
  count: number;
}

/**
 * 日组头规则：同日条目首次收录时间分钟全相同 → 批次形态；一旦出现不同分钟 → 非批次，
 * 条目行显示各自时间（北京时间）。分钟比较用北京时间墙钟口径（与排序/分组同源换算）；
 * 单条条目分钟自相同，按规则归批次形态（不特判条数）；空组恒为非批次。
 */
export function dayHeadInfo(entries: Array<{ firstSeenAt: string }>): DayHeadInfo {
  const count = entries.length;
  if (count === 0) return { batch: false, clock: null, count };
  const clocks = new Set(entries.map((item) => formatClock(item.firstSeenAt)));
  const batch = clocks.size === 1;
  return { batch, clock: batch ? formatClock(entries[0]!.firstSeenAt) : null, count };
}

/** 北京时间固定偏移 +08:00（中国无夏令时，固定偏移换算安全；UI 票 #18）。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 把 ISO 时间换算为「北京时间墙钟」的纪元毫秒：加固定 +08:00 后按 UTC 读各字段。
 * 输入必须带时区偏移（Z 或 ±HH:MM）——数据管线写 toISOString()（Z 结尾），仓库 fixtures 用 +08:00；
 * 无偏移字符串会被 Date.parse 按运行环境本地时区解释（构建机与浏览器结果不同），直接拒绝，不做模糊猜测。
 * 只用 Date/字符串运算，Node（构建期静态渲染）与浏览器（客户端增强）行为一致。
 */
function beijingShiftedMs(iso: string): number {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    throw new Error(`时间字符串缺少时区偏移（需要 Z 或 ±HH:MM），拒绝按本地时区猜测：${iso}`);
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`无法解析的 ISO 时间：${iso}`);
  }
  return ms + BEIJING_OFFSET_MS;
}

/** 北京时间日期「YYYY-MM-DD」（日期组头、Hero 幽灵日期、今日条数等日界统一口径）。 */
export function beijingDate(iso: string): string {
  return new Date(beijingShiftedMs(iso)).toISOString().slice(0, 10);
}

/** 北京时间「HH:mm」（可见时刻文本；UTC 数据直读会让中文读者少看 8 小时，UI 票 #18）。 */
export function formatClock(iso: string): string {
  return new Date(beijingShiftedMs(iso)).toISOString().slice(11, 16);
}

/** 北京时间「YYYY-MM-DD HH:mm」（可见时间文本；机器可读的 datetime 属性由调用方保留 UTC 原值）。 */
export function formatDateTime(iso: string): string {
  return new Date(beijingShiftedMs(iso)).toISOString().slice(0, 16).replace("T", " ");
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

/** 最新收录日（北京时间日界）与当日条数（Hero 幽灵日期与菜单数据列用）。 */
export function latestDayStats(sorted: PublicEntry[]): { date: string; count: number } {
  const date = sorted[0] ? beijingDate(sorted[0].firstSeenAt) : "";
  return { date, count: sorted.filter((entry) => beijingDate(entry.firstSeenAt) === date).length };
}
