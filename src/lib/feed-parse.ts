/**
 * RSS 解析与字段归一化（Ticket 03）：字符串进、归一化条目出，纯数据转换，无网络 I/O。
 *
 * 解析使用 rss-parser 3.13.0（docs/mvp-dependency-evidence.md 证据版本）。字段映射按其
 * 发布源码（lib/parser.js / lib/utils.js）核实，非凭记忆：
 * - guid：条目 GUID 带属性（如 isPermaLink="false"）时解析为对象，取 `._` 文本；纯文本原样。
 * - link：条目 <link> 文本（XML 实体已由解析器解码）。
 * - description：映射为 content（原文）+ contentSnippet（去 HTML 标签、解码实体、trim 后的
 *   纯文本）；snippet 不自动限 300 字。空 <description/> 得到空串而非缺失字段。
 * - content:encoded：映射为 'content:encoded' + 'content:encodedSnippet'（同上纯文本规则）。
 * - pubDate/isoDate：解析器可转换日期，但其语义未核实（docs/product-alignment.md），
 *   本层一律不采用——归一化条目的 originalTime 恒为 null。
 *
 * 归一化规则（docs/mvp-decisions.md）：
 * - 标题：移除末尾「热度：<数字>」后缀（2026-10-03 核查记录：100 条标题均匹配该精确后缀），
 *   其余标题文本原样保留，不做其他清洗。
 * - 摘要（Q21-7）：优先源摘要（contentSnippet），缺失时取源正文纯文本（content:encodedSnippet，
 *   即解析器对 content:encoded 做同一纯文本化的产物）；两者皆无则为 null，不编造。取到后
 *   按码点截断 300 字。对本首源（RSS 2.0，正文即 description）contentSnippet 本身就是
 *   源正文的纯文本，回退链在结构上等价于「摘要缺失时取源正文纯文本」。
 * - wd 指纹（Q19）：从条目目标 URL 查询参数取第一个 wd，返回解码后的精确字符串
 *   （不 trim、不归一化空白）；缺失或值为空串返回 null（照常收录、指纹记空并跳过冲突检测）。
 * - 缺失 GUID 映射为 null、缺失链接映射为空串：原样传递，隔离判定与记录由
 *   src/domain/ingestion.ts 管线负责，本层不丢条目、不造默认值。
 */
import Parser from "rss-parser";
import type { RawEntryInput } from "../domain/ingestion.ts";

/** 摘要字数上限（Q21-7）。 */
export const SUMMARY_MAX_CHARS = 300;

/** 标题末尾热度后缀（核查记录：`热度：<纯数字>`，前导空白属于后缀分隔）。 */
const HOTNESS_SUFFIX_PATTERN = /\s*热度：\d+\s*$/u;

/** 归一化所需的解析条目窄视图（rss-parser 的类型未覆盖 content:encodedSnippet 等字段）。 */
export interface ParsedItemView {
  [key: string]: unknown;
}

export interface FeedNormalizeOptions {
  sourceId: string;
  /** 来源默认主题（Q: 优先映射源明确分类，缺失时用来源默认主题；本层由来源适配器给定）。 */
  topic: string;
}

/** 移除标题末尾热度后缀；其余文本原样。 */
export function stripHotnessSuffix(title: unknown): string {
  if (typeof title !== "string") return "";
  return title.replace(HOTNESS_SUFFIX_PATTERN, "");
}

/** 从目标 URL 提取第一个 wd 的解码精确串；缺失/空值/非法 URL 返回 null。 */
export function extractWdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const first = parsed.searchParams.getAll("wd")[0];
  if (first === undefined || first.length === 0) return null;
  return first;
}

/** 按码点截断（不拆代理对）。 */
export function truncateChars(text: string, max: number): string {
  if (max <= 0) return "";
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 解析条目 → 管线输入。只做字段映射与上述归一化规则，不校验、不隔离。 */
export function feedItemToRawEntry(item: ParsedItemView, options: FeedNormalizeOptions): RawEntryInput {
  const url = textOf(item.link);
  const rawSummary = textOf(item.contentSnippet) || textOf(item["content:encodedSnippet"]);
  const summary = rawSummary.length > 0 ? truncateChars(rawSummary, SUMMARY_MAX_CHARS) : null;
  const guid = textOf(item.guid);
  return {
    sourceId: options.sourceId,
    guid: guid.length > 0 ? guid : null,
    title: stripHotnessSuffix(item.title),
    summary,
    url,
    topic: options.topic,
    // 首源时间语义未核实：即使解析器给出 pubDate/isoDate 也不作为原始时间使用。
    originalTime: null,
    wd: extractWdFromUrl(url),
  };
}

/** 解析 RSS/XML 文本并逐条归一化；XML 非法或非 RSS 2.0 即抛错（由调用方按失败处理）。 */
export async function parseFeed(xml: string, options: FeedNormalizeOptions): Promise<RawEntryInput[]> {
  const parser = new Parser();
  const feed = (await parser.parseString(xml)) as { items?: unknown } | undefined;
  const items = Array.isArray(feed?.items) ? feed.items : [];
  return items.map((item) => feedItemToRawEntry(item as ParsedItemView, options));
}
