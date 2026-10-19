/** Article RSS adapters. URL identity is fixed for these sources, including if GUID appears later. */
import Parser from "rss-parser";
import type { RawEntryInput, SourceFetchResult } from "../domain/ingestion.ts";
import { SUMMARY_MAX_CHARS, truncateChars } from "./feed-parse.ts";
import { fetchTextOnce } from "./source-fetch.ts";
import type { FetchSourceOptions } from "./baidu-source.ts";
import type { NewsSource } from "./sources.ts";
import { isArticleImageUrl } from "./article-image.ts";

/** Extract only a URL, never render upstream HTML. Ignore comments/scripts and non-src attributes. */
function firstArticleImage(html: unknown, sourceId: string): string | undefined {
  if (typeof html !== "string" || sourceId !== "geekpark") return undefined;
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  for (const [tag] of body.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    for (const attr of tag.matchAll(/([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if (attr[1]!.toLowerCase() !== "src") continue;
      const value = (attr[2] ?? attr[3] ?? attr[4] ?? "").replace(
        /&(?:amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi,
        (entity, decimal: string | undefined, hex: string | undefined) => {
          if (decimal || hex) {
            const point = Number.parseInt(decimal ?? hex!, decimal ? 10 : 16);
            return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
          }
          return entity.toLowerCase() === "&amp;" ? "&" : entity.toLowerCase() === "&quot;" ? '"' : "'";
        },
      );
      if (isArticleImageUrl(value, sourceId)) return value;
      break; // HTML uses the first src attribute, even when it is invalid.
    }
  }
  return undefined;
}

export async function parseNewsFeed(xml: string, source: NewsSource): Promise<RawEntryInput[]> {
  const feed = await new Parser().parseString(xml);
  if (feed.items.length === 0) throw new Error("来源返回空订阅，保留旧数据");
  return feed.items.map(item => {
    const url = typeof item.link === "string" ? item.link : "";
    let target: URL;
    try { target = new URL(url); } catch { throw new Error("来源文章链接无效"); }
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password ||
        !source.articleHosts.includes(target.hostname) || target.port) {
      throw new Error("来源文章链接不属于已核实的文章域名或协议");
    }
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) throw new Error("来源条目缺少标题");
    const rawSummary = item.contentSnippet || item["content:encodedSnippet"];
    const imageUrl = firstArticleImage(item["content:encoded"], source.id) ?? firstArticleImage(item.content, source.id);
    return {
      sourceId: source.id,
      // Legacy storage field name: for these explicitly configured feeds this stores a URL key,
      // not an upstream GUID. Do not normalize/strip query parameters or change policy later.
      guid: `url:${url}`,
      title,
      ...(imageUrl === undefined ? {} : { imageUrl }),
      summary: typeof rawSummary === "string" && rawSummary.length > 0
        ? truncateChars(rawSummary, SUMMARY_MAX_CHARS) : null,
      url,
      topic: source.topic,
      originalTime: null,
      wd: null,
    };
  });
}

export async function fetchNewsSource(source: NewsSource, options: FetchSourceOptions = {}): Promise<SourceFetchResult> {
  const now = options.now ?? (() => new Date());
  const attemptedAt = now().toISOString();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const attempts = options.maxAttempts ?? 2;
  let error = "来源获取失败";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const xml = await fetchTextOnce(source.feedUrl, options);
      const entries = await parseNewsFeed(xml, source);
      return { ok: true, sourceId: source.id, attemptedAt, succeededAt: now().toISOString(), entries };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      if (attempt < attempts) await sleep(options.backoffMs ?? 250);
    }
  }
  return { ok: false, sourceId: source.id, attemptedAt, error };
}
