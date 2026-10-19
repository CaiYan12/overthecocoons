/** Shared source metadata; no network or Node dependencies (also used by client rendering). */
export interface NewsSource {
  readonly id: string;
  readonly name: string;
  readonly feedUrl: string;
  readonly website: string;
  readonly topic: string;
  readonly articleHosts: readonly string[];
}

/** Frozen per-feed identities. URL identity is an explicit policy for these feeds, not a GUID fallback. */
export const NEWS_SOURCES: readonly NewsSource[] = [
  { id: "chinanews-society", name: "中新网·社会", feedUrl: "https://www.chinanews.com.cn/rss/society.xml", website: "https://www.chinanews.com.cn/", topic: "社会", articleHosts: ["www.chinanews.com.cn"] },
  { id: "chinanews-world", name: "中新网·国际", feedUrl: "https://www.chinanews.com.cn/rss/world.xml", website: "https://www.chinanews.com.cn/", topic: "新闻", articleHosts: ["www.chinanews.com.cn"] },
  { id: "chinanews-dxw", name: "中新网·东西问", feedUrl: "https://www.chinanews.com.cn/rss/dxw.xml", website: "https://www.chinanews.com.cn/", topic: "文化", articleHosts: ["www.chinanews.com.cn"] },
  { id: "geekpark", name: "极客公园", feedUrl: "https://www.geekpark.net/rss", website: "https://www.geekpark.net/", topic: "科技", articleHosts: ["www.geekpark.net"] },
  { id: "solidot", name: "Solidot", feedUrl: "https://www.solidot.org/index.rss", website: "https://www.solidot.org/", topic: "科技", articleHosts: ["www.solidot.org"] },
];

export function sourcePresentation(sourceId?: string): { name: string; linkLabel: string } {
  // Only legacy entries without sourceId use the historical Baidu attribution.
  if (sourceId === undefined || sourceId === "baidu-aishort") {
    return { name: "百度热点", linkLabel: "查看百度搜索结果" };
  }
  const source = NEWS_SOURCES.find(s => s.id === sourceId);
  return { name: source?.name ?? sourceId, linkLabel: "查看来源文章" };
}
