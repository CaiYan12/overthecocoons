/**
 * 合成 RSS 测试资料（架构文档约定 tests/data/：合成数据，不冒充真实新闻）。
 *
 * 形状对照 2026-10-03 真实首源核查记录（docs/product-alignment.md）：
 * RSS 2.0；条目字段 title / link / description / guid(isPermaLink="false") / pubDate；
 * 标题末尾带「热度：<数字>」后缀；链接为带 wd 查询参数的搜索结果页。
 * 所有标题、描述均为合成文本，仅用于自动化测试。
 */

export const FIXTURE_FEED_HOST = "https://search.example.test";

/** 用给定条目 XML 包装成 RSS 2.0 feed 文本。 */
export function buildFeed(items: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "<channel>",
    "<title>合成测试源</title>",
    "<link>https://feed.example.test/</link>",
    "<description>仅用于自动化测试的合成数据，不是真实新闻。</description>",
    ...items,
    "</channel>",
    "</rss>",
  ].join("\n");
}

/** 条目一：热度后缀 + 常规描述 + wd（含 sa/rsv 参数）。 */
export const ITEM_BASIC = [
  "<item>",
  "<title>合成测试条目一（无真实新闻） 热度：3143136</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=%E5%90%88%E6%88%90%E8%AF%8D%E4%B8%80&amp;sa=fyb_news&amp;rsv_dl=fyb_news</link>`,
  "<description>这是合成条目一的描述文本，用于测试摘要归一化，不含真实新闻内容。</description>",
  '<guid isPermaLink="false">9000001</guid>',
  "<pubDate>Sat, 03 Oct 2026 20:01:58 +0800</pubDate>",
  "</item>",
].join("\n");

/** 条目二：同一 URL 携带多个 wd 参数（按 Q19 取第一个）。 */
export const ITEM_MULTI_WD = [
  "<item>",
  "<title>合成测试条目二 热度：999</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=%E7%AC%AC%E4%B8%80&amp;wd=%E7%AC%AC%E4%BA%8C</link>`,
  "<description>合成条目二的描述。</description>",
  '<guid isPermaLink="false">9000002</guid>',
  "</item>",
].join("\n");

/** 条目三：目标链接没有 wd 参数（Q19：照常收录、指纹为空）。 */
export const ITEM_NO_WD = [
  "<item>",
  "<title>合成测试条目三 热度：888</title>",
  `<link>${FIXTURE_FEED_HOST}/search?q=synthetic</link>`,
  "<description>合成条目三的描述。</description>",
  '<guid isPermaLink="false">9000003</guid>',
  "</item>",
].join("\n");

/** 条目四：wd 参数存在但值为空串（归一化按缺失处理，记 null）。 */
export const ITEM_EMPTY_WD = [
  "<item>",
  "<title>合成测试条目四 热度：777</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=&amp;sa=fyb_news</link>`,
  "<description>合成条目四的描述。</description>",
  '<guid isPermaLink="false">9000004</guid>',
  "</item>",
].join("\n");

/** 条目五：描述超过 300 字（Q21-7：纯文本化后截断 300 字）。 */
export const ITEM_LONG_DESCRIPTION = [
  "<item>",
  "<title>合成测试条目五 热度：666</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=%E9%95%BF%E6%8F%8F%E8%BF%B0</link>`,
  `<description>${"合成".repeat(200)}</description>`,
  '<guid isPermaLink="false">9000005</guid>',
  "</item>",
].join("\n");

/** 条目六：描述为空元素（摘要缺失，不编造）。 */
export const ITEM_EMPTY_DESCRIPTION = [
  "<item>",
  "<title>合成测试条目六 热度：555</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=%E7%A9%BA%E6%8F%8F%E8%BF%B0</link>`,
  "<description></description>",
  '<guid isPermaLink="false">9000006</guid>',
  "</item>",
].join("\n");

/** 条目七：缺少 GUID（归一化原样传递，由 T02 管线隔离为「缺 GUID」）。 */
export const ITEM_NO_GUID = [
  "<item>",
  "<title>合成测试条目七（无 GUID） 热度：444</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=%E6%97%A0GUID</link>`,
  "<description>合成条目七的描述。</description>",
  "</item>",
].join("\n");

/** 条目八：描述内嵌 HTML 标记（源正文纯文本化后应得到标签外文本）。 */
export const ITEM_HTML_DESCRIPTION = [
  "<item>",
  "<title>合成测试条目八 热度：333</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=HTML</link>`,
  "<description>&lt;b&gt;重点&lt;/b&gt;标签内容</description>",
  '<guid isPermaLink="false">9000008</guid>',
  "</item>",
].join("\n");

/** 条目九：无 description，仅 content:encoded（摘要回退到源正文纯文本）。 */
export const ITEM_CONTENT_ENCODED = [
  "<item>",
  "<title>合成测试条目九 热度：222</title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=%E7%BC%96%E7%A0%81%E6%AD%A3%E6%96%87</link>`,
  "<content:encoded><![CDATA[编码正文内容纯文本]]></content:encoded>",
  '<guid isPermaLink="false">9000009</guid>',
  "</item>",
].join("\n");

/** 条目十：CDATA 包裹的标题（热度后缀仍须移除）。 */
export const ITEM_CDATA_TITLE = [
  "<item>",
  "<title><![CDATA[合成CDATA条目 热度：123456]]></title>",
  `<link>${FIXTURE_FEED_HOST}/s?wd=CDATA</link>`,
  "<description>合成条目十的描述。</description>",
  '<guid isPermaLink="false">9000010</guid>',
  "</item>",
].join("\n");

/** 全量合成 feed：覆盖上述全部条目形态。 */
export const FEED_FULL = buildFeed([
  ITEM_BASIC,
  ITEM_MULTI_WD,
  ITEM_NO_WD,
  ITEM_EMPTY_WD,
  ITEM_LONG_DESCRIPTION,
  ITEM_EMPTY_DESCRIPTION,
  ITEM_NO_GUID,
  ITEM_HTML_DESCRIPTION,
  ITEM_CONTENT_ENCODED,
  ITEM_CDATA_TITLE,
]);

/** 结构损坏的 XML（截断文档）。 */
export const FEED_INVALID_XML = buildFeed(["<item><title>截断的合成条目"]);

/** 非 RSS 2.0 版本声明（rss-parser 默认不识别，解析必须失败）。 */
export const FEED_NOT_RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="3.9"><channel><title>伪版本合成源</title></channel></rss>`;
