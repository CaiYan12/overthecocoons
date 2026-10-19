import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNewsFeed, fetchNewsSource } from "../../src/lib/news-source.ts";
import { NEWS_SOURCES, sourcePresentation } from "../../src/lib/sources.ts";
import { ingest, initializeState, type IngestPrevious } from "../../src/domain/ingestion.ts";
import { buildTimelineData } from "../../src/lib/client-data.ts";
import { assertItemsFile, verifyManifest } from "../../src/domain/contract.ts";
import { isArticleImageUrl } from "../../src/lib/article-image.ts";

const feed = (link: string, title = "合成新闻", guid = "") => `<?xml version="1.0"?><rss version="2.0"><channel><title>测试</title><item><title>${title}</title><link>${link}</link>${guid}<description><![CDATA[<p>${"摘要😀".repeat(180)}</p>]]></description><pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
const source = NEWS_SOURCES[0]!;
const url = "https://www.chinanews.com.cn/sh/2026/10-19/100.shtml";
const T0 = "2026-10-19T02:00:00.000Z";

test("five selected feeds have explicit source-level topics and distinct frozen identities", () => {
  assert.deepEqual(NEWS_SOURCES.map(s => [s.id, s.topic]), [
    ["chinanews-society", "社会"], ["chinanews-world", "新闻"],
    ["chinanews-dxw", "文化"], ["geekpark", "科技"], ["solidot", "科技"],
  ]);
  assert.equal(new Set(NEWS_SOURCES.map(s => s.id)).size, 5);
});

test("news without GUID uses its exact article URL identity, with no date or wd inference", async () => {
  const [entry] = await parseNewsFeed(feed(url), source);
  assert.equal(entry!.guid, `url:${url}`);
  assert.equal(entry!.sourceId, source.id);
  assert.equal(entry!.originalTime, null);
  assert.equal(entry!.wd, null);
  assert.equal(entry!.topic, "社会");
  assert.equal(Array.from(entry!.summary!).length, 300);
  assert.ok(!entry!.summary!.includes("<p>"));
  const [later] = await parseNewsFeed(feed(url, "修订标题", "<guid>new-upstream-guid</guid>"), source);
  assert.equal(later!.guid, entry!.guid, "upstream adding a GUID must not change established URL identity");
});

test("URL identity and source provenance survive repeated ingestion and client serialization", async () => {
  const entries = await parseNewsFeed(feed(url), source);
  const first = ingest({ state: initializeState(source.id, T0), items: { schemaVersion: 1, items: [] } },
    { ok: true, sourceId: source.id, attemptedAt: T0, succeededAt: T0, entries });
  const T1 = "2026-10-19T03:00:00.000Z";
  const second = ingest(first, { ok: true, sourceId: source.id, attemptedAt: T1, succeededAt: T1,
    entries: await parseNewsFeed(feed(url, "修订标题"), source) });
  assert.equal(second.items.items.length, 1);
  assert.equal(second.items.items[0]!.firstSeenAt, T0);
  assert.equal(second.snapshot.entries[0]!.sourceId, source.id);
  const client = buildTimelineData(second.snapshot, "/overthecocoons");
  assert.equal(client.entries[0]!.sourceId, source.id);
  assert.equal(sourcePresentation(source.id).linkLabel, "查看来源文章");
  assert.equal(sourcePresentation(undefined).linkLabel, "查看百度搜索结果");
});

test("unexpected article hosts fail the source instead of inventing trusted entries", async () => {
  await assert.rejects(() => parseNewsFeed(feed("https://unrelated.example/article"), source), /文章链接/);
  await assert.rejects(() => parseNewsFeed(feed("javascript:alert(1)"), source), /文章链接/);
  await assert.rejects(() => parseNewsFeed(feed("https://www.chinanews.com.cn@evil.example/"), source), /文章链接/);
  await assert.rejects(() => parseNewsFeed("<rss version=\"2.0\"><channel><title>empty</title></channel></rss>", source), /空/);
});

test("identical URL in two configured feeds remains separate; URL spelling is not normalized", async () => {
  const world = NEWS_SOURCES[1]!;
  const [social] = await parseNewsFeed(feed(url), source);
  const [international] = await parseNewsFeed(feed(url), world);
  assert.notEqual(social!.sourceId, international!.sourceId);
  const exactUrl = `${url}?b=2&amp;a=1`;
  const [entry] = await parseNewsFeed(feed(exactUrl), source);
  assert.equal(entry!.guid, `url:${url}?b=2&a=1`);
});

test("failed source retries with bounded attempts and returns a failure result", async () => {
  let calls = 0;
  const result = await fetchNewsSource(source, {
    now: () => new Date(T0), sleep: async () => {},
    fetchImpl: async () => { calls++; return new Response("unavailable", { status: 503 }); },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.sourceId, source.id);
});

const geekpark = NEWS_SOURCES.find(s => s.id === "geekpark")!;
const imageUrl = "https://imgslim.geekpark.net/uploads/image/file/example.png";
const imageFeed = (html: string) => feed("https://www.geekpark.net/news/example")
  .replace(/<description>[\s\S]*?<\/description>/, `<description><![CDATA[${html}]]></description>`);

test("Geekpark uses the first valid article img src, not channel logos or other attributes", async () => {
  const html = `<!-- <img src="${imageUrl}/comment"> --><script>"<img src='${imageUrl}/script'>"</script>
    <img src="https://untrusted.example/pixel.png"><img data-src="${imageUrl}/lazy" title="src='${imageUrl}/title'">
    <img src='${imageUrl}?a=1&amp;b=2'><img src="${imageUrl}/second">`;
  const [entry] = await parseNewsFeed(imageFeed(html), geekpark);
  assert.equal(entry!.imageUrl, `${imageUrl}?a=1&b=2`);
  assert.equal(entry!.summary!.includes("<img"), false);
  const [unquoted] = await parseNewsFeed(imageFeed(`<img src=${imageUrl}>`), geekpark);
  assert.equal(unquoted!.imageUrl, imageUrl);
  const [encoded] = await parseNewsFeed(imageFeed("").replace("</item>", `<content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<img src="${imageUrl}">]]></content:encoded></item>`), geekpark);
  assert.equal(encoded!.imageUrl, imageUrl);
});

test("unverified image hosts, protocols, credentials and sources are excluded", async () => {
  for (const value of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://imgslim.geekpark.net/a.png", "https://imgslim.geekpark.net.evil.example/a.png", "https://imgslim.geekpark.net@evil.example/a.png", "https://user@imgslim.geekpark.net/a.png", "https://imgslim.geekpark.net:8080/a.png", "https://127.0.0.1/a.png"]) {
    assert.equal(isArticleImageUrl(value, "geekpark"), false, value);
    assert.equal((await parseNewsFeed(imageFeed(`<img src="${value}">`), geekpark))[0]!.imageUrl, undefined);
  }
  assert.equal(isArticleImageUrl(imageUrl, "solidot"), false);
  const [other] = await parseNewsFeed(feed(url).replace("<p>", `<img src="${imageUrl}"><p>`), source);
  assert.equal(other!.imageUrl, undefined);
});

test("image revisions propagate through persisted state and client data without refreshing identity or time", async () => {
  const initial: IngestPrevious = { state: initializeState(geekpark.id, T0), items: { schemaVersion: 1, items: [] } };
  const update = async (previous: IngestPrevious, html: string, time: string) => ingest(previous, {
    ok: true, sourceId: geekpark.id, attemptedAt: time, succeededAt: time,
    entries: await parseNewsFeed(imageFeed(html), geekpark),
  });
  const first = await update(initial, "文字摘要", T0);
  const second = await update(first, `文字摘要<img src="${imageUrl}">`, "2026-10-19T03:00:00.000Z");
  assert.equal(second.items.items[0]!.contentVersion, 2);
  assert.equal(second.items.items[0]!.firstSeenAt, T0);
  assert.equal(second.snapshot.entries[0]!.id, first.snapshot.entries[0]!.id);
  assert.equal(buildTimelineData(second.snapshot, "/overthecocoons").entries[0]!.imageUrl, imageUrl);
  assert.notEqual(second.state.publicContentDigest, first.state.publicContentDigest);
  const third = await update(second, "文字摘要", "2026-10-19T04:00:00.000Z");
  assert.equal(third.items.items[0]!.contentVersion, 3);
  assert.equal(Object.hasOwn(third.items.items[0]!, "imageUrl"), false);
  const persisted = JSON.parse(JSON.stringify(third));
  verifyManifest(persisted.state, persisted.items, persisted.manifest);
  assert.throws(() => assertItemsFile({ ...second.items, items: [{ ...second.items.items[0], imageUrl: "https://evil.example/a.png" }] }), /imageUrl/);
  const raw = (await parseNewsFeed(imageFeed("文字摘要"), geekpark))[0]!;
  const rejected = ingest(first, { ok: true, sourceId: geekpark.id, attemptedAt: "2026-10-19T04:00:00.000Z", succeededAt: "2026-10-19T04:00:00.000Z", entries: [{ ...raw, imageUrl: "https://evil.example/a.png" }] });
  assert.equal(rejected.state.quarantined[0]!.reasonCategory, "字段校验失败");
});
