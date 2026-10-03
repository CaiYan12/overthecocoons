import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractWdFromUrl,
  feedItemToRawEntry,
  parseFeed,
  stripHotnessSuffix,
  truncateChars,
} from "../../src/lib/feed-parse.ts";
import {
  FEED_FULL,
  FEED_INVALID_XML,
  FEED_NOT_RSS2,
} from "../data/feed-fixtures.ts";

/**
 * Ticket 03 归一化规则验收：
 * - 字段映射按 rss-parser 3.13.0 实际行为核实（GUID 含属性取文本 / link / description→content+contentSnippet）。
 * - 移除标题热度后缀；摘要上限 300 字（优先源摘要，缺失取源正文纯文本，皆无不编造）。
 * - wd 指纹从目标 URL 提取：多个取第一个、解码串精确比较、缺失/空值记 null。
 * - 原始时间语义未核实：本源恒为 null，不得使用 isoDate/pubDate。
 * - 坏字段原样传递，隔离判定与记录由 T02 管线负责，本层不丢条目。
 */

const SOURCE = "baidu-aishort";
const TOPIC = "新闻";

describe("stripHotnessSuffix：移除标题末尾「热度：<数字>」后缀", () => {
  it("移除空格分隔的数字热度后缀", () => {
    assert.equal(stripHotnessSuffix("合成测试条目一（无真实新闻） 热度：3143136"), "合成测试条目一（无真实新闻）");
  });
  it("标题本身就是后缀时得到空串（不编造标题）", () => {
    assert.equal(stripHotnessSuffix("热度：123"), "");
  });
  it("热度值非纯数字时不移除（按核查记录仅出现数字）", () => {
    assert.equal(stripHotnessSuffix("合成条目 热度：abc"), "合成条目 热度：abc");
  });
  it("后缀不在末尾时不移除", () => {
    assert.equal(stripHotnessSuffix("合成条目 热度：123456更多"), "合成条目 热度：123456更多");
  });
  it("无后缀标题原样保留", () => {
    assert.equal(stripHotnessSuffix("普通合成标题"), "普通合成标题");
  });
  it("数字后允许尾随空白", () => {
    assert.equal(stripHotnessSuffix("合成条目 热度：123 "), "合成条目");
  });
});

describe("extractWdFromUrl：wd 查询参数提取（MVP-Q19）", () => {
  it("提取第一个 wd 并解码", () => {
    assert.equal(
      extractWdFromUrl("https://search.example.test/s?wd=%E5%90%88%E6%88%90%E8%AF%8D%E4%B8%80&sa=fyb_news"),
      "合成词一",
    );
  });
  it("多个 wd 取第一个（不合并、不重排）", () => {
    assert.equal(
      extractWdFromUrl("https://search.example.test/s?wd=%E7%AC%AC%E4%B8%80&wd=%E7%AC%AC%E4%BA%8C"),
      "第一",
    );
  });
  it("解码串精确保留，不 trim、不归一化空白", () => {
    assert.equal(extractWdFromUrl("https://search.example.test/s?wd=%20%E4%BD%93"), " 体");
  });
  it("查询串中的 + 按查询参数语义解码为空格", () => {
    assert.equal(
      extractWdFromUrl("https://search.example.test/s?wd=%E6%96%B0%E8%83%BD%E6%BA%90%E8%BD%A6+%E5%A4%A7%E8%80%83"),
      "新能源车 大考",
    );
  });
  it("缺失 wd 返回 null", () => {
    assert.equal(extractWdFromUrl("https://search.example.test/search?q=x"), null);
  });
  it("wd 值为空串按缺失返回 null", () => {
    assert.equal(extractWdFromUrl("https://search.example.test/s?wd=&sa=1"), null);
  });
  it("非合法 URL 返回 null（隔离判定交给管线）", () => {
    assert.equal(extractWdFromUrl("not a url"), null);
  });
});

describe("truncateChars：按码点截断 300 字", () => {
  it("超过 300 字截断为前 300 个码点", () => {
    const text = "合成".repeat(200);
    assert.equal(truncateChars(text, 300).length, 300);
    assert.equal(truncateChars(text, 300), text.slice(0, 300));
  });
  it("不足上限原样返回", () => {
    assert.equal(truncateChars("短文本", 300), "短文本");
  });
});

describe("feedItemToRawEntry：解析条目归一化", () => {
  it("最小字段映射：guid/title/url/summary，热度后缀移除，originalTime 恒为 null", () => {
    const entry = feedItemToRawEntry(
      {
        guid: "9000001",
        title: "合成测试条目一（无真实新闻） 热度：3143136",
        link: "https://search.example.test/s?wd=%E5%90%88%E6%88%90%E8%AF%8D%E4%B8%80&sa=fyb_news",
        contentSnippet: "这是合成条目一的描述文本。",
        isoDate: "2026-10-03T12:01:58.000Z",
      },
      { sourceId: SOURCE, topic: TOPIC },
    );
    assert.equal(entry.sourceId, SOURCE);
    assert.equal(entry.guid, "9000001");
    assert.equal(entry.title, "合成测试条目一（无真实新闻）");
    assert.equal(entry.summary, "这是合成条目一的描述文本。");
    assert.equal(entry.url, "https://search.example.test/s?wd=%E5%90%88%E6%88%90%E8%AF%8D%E4%B8%80&sa=fyb_news");
    assert.equal(entry.wd, "合成词一");
    assert.equal(entry.originalTime, null, "首源时间语义未核实：即使解析器给出 isoDate 也不得用作原始时间");
    assert.equal(entry.topic, TOPIC);
  });
  it("摘要优先 contentSnippet；缺失时回退 content:encoded 的纯文本；皆无不编造", () => {
    const fromSnippet = feedItemToRawEntry(
      { guid: "g", title: "t", link: "https://search.example.test/s?wd=a", contentSnippet: "源摘要文本" },
      { sourceId: SOURCE, topic: TOPIC },
    );
    assert.equal(fromSnippet.summary, "源摘要文本");
    const fromEncoded = feedItemToRawEntry(
      {
        guid: "g",
        title: "t",
        link: "https://search.example.test/s?wd=a",
        "content:encoded": "<p>编码正文内容</p>",
        "content:encodedSnippet": "编码正文内容",
      },
      { sourceId: SOURCE, topic: TOPIC },
    );
    assert.equal(fromEncoded.summary, "编码正文内容");
    const none = feedItemToRawEntry(
      { guid: "g", title: "t", link: "https://search.example.test/s?wd=a" },
      { sourceId: SOURCE, topic: TOPIC },
    );
    assert.equal(none.summary, null);
  });
  it("摘要在纯文本化之后截断 300 字", () => {
    const entry = feedItemToRawEntry(
      { guid: "g", title: "t", link: "https://search.example.test/s?wd=a", contentSnippet: "合成".repeat(200) },
      { sourceId: SOURCE, topic: TOPIC },
    );
    assert.equal(entry.summary?.length, 300);
  });
  it("缺失 guid 映射为 null、缺失 link 映射为空串（原样传递给管线隔离）", () => {
    const entry = feedItemToRawEntry({ title: "t" }, { sourceId: SOURCE, topic: TOPIC });
    assert.equal(entry.guid, null);
    assert.equal(entry.url, "");
    assert.equal(entry.wd, null);
  });
});

describe("parseFeed：合成 RSS 全链路解析（rss-parser 3.13.0 实际行为）", () => {
  it("全量合成 feed 逐条归一化", async () => {
    const entries = await parseFeed(FEED_FULL, { sourceId: SOURCE, topic: TOPIC });
    assert.equal(entries.length, 10);

    // 条目一：热度后缀移除 + 常规描述摘要 + wd 解码。
    const basic = entries[0]!;
    assert.equal(basic.guid, "9000001");
    assert.equal(basic.title, "合成测试条目一（无真实新闻）");
    assert.equal(basic.summary, "这是合成条目一的描述文本，用于测试摘要归一化，不含真实新闻内容。");
    assert.equal(basic.wd, "合成词一");
    assert.equal(basic.originalTime, null);
    assert.equal(basic.topic, TOPIC);
    assert.equal(basic.sourceId, SOURCE);

    // 条目二：多个 wd 取第一个。
    assert.equal(entries[1]!.wd, "第一");
    // 条目三：无 wd。
    assert.equal(entries[2]!.wd, null);
    // 条目四：空值 wd 按缺失。
    assert.equal(entries[3]!.wd, null);
    // 条目五：超长描述截断 300 字。
    assert.equal(entries[4]!.summary?.length, 300);
    // 条目六：空描述 → 摘要 null，不编造。
    assert.equal(entries[5]!.summary, null);
    // 条目七：缺 GUID → null 原样传递。
    assert.equal(entries[6]!.guid, null);
    assert.ok(entries[6]!.title.includes("合成测试条目七"));
    // 条目八：HTML 描述纯文本化。
    assert.equal(entries[7]!.summary, "重点标签内容");
    // 条目九：content:encoded 纯文本回退。
    assert.equal(entries[8]!.summary, "编码正文内容纯文本");
    // 条目十：CDATA 标题仍移除热度后缀。
    assert.equal(entries[9]!.title, "合成CDATA条目");
  });

  it("损坏 XML 拒绝解析（UTF-8/XML 失败处理：解析层抛错）", async () => {
    await assert.rejects(() => parseFeed(FEED_INVALID_XML, { sourceId: SOURCE, topic: TOPIC }));
  });

  it("非 RSS 2.0 版本声明拒绝解析（不放宽为猜测）", async () => {
    await assert.rejects(() => parseFeed(FEED_NOT_RSS2, { sourceId: SOURCE, topic: TOPIC }), /RSS/);
  });
});
