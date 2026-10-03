import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BACKOFF_MS,
  BAIDU_FEED_URL,
  MAX_ATTEMPTS,
  SOURCE_DEFAULT_TOPIC,
  SOURCE_ID,
  fetchSourceEntries,
} from "../../src/lib/baidu-source.ts";
import { initializeState, ingest } from "../../src/domain/ingestion.ts";
import { verifyManifest } from "../../src/domain/contract.ts";
import { FEED_FULL, FIXTURE_FEED_HOST } from "../data/feed-fixtures.ts";

/**
 * 首源适配器验收：默认 feed 地址与来源 ID 冻结；最多 2 次尝试 + 短退避（Q21-1）；
 * 请求前 URL 安全校验；超时 / HTTP 失败 / UTF-8 失败 / XML 失败均在尝试内消化；
 * 产出可直接注入 T02 管线的 SourceFetchResult；坏条目经管线进入隔离。
 */

function feedResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}

/** 固定时钟：第 n 次调用返回第 n 个时间点（毫秒步进）。 */
function steppedClock(startMs: number, stepMs = 1000): () => Date {
  let n = 0;
  return () => new Date(startMs + n++ * stepMs);
}

const T0 = new Date("2026-10-03T08:00:00+08:00").getTime();

describe("来源身份与工程常量（冻结项）", () => {
  it("默认 feed 地址为用户指定首源", () => {
    assert.equal(BAIDU_FEED_URL, "https://rss.aishort.top/?type=baidu");
  });
  it("来源 ID 为冻结的 baidu-aishort", () => {
    assert.equal(SOURCE_ID, "baidu-aishort");
  });
  it("最多 2 次尝试、短退避为正数（Q21-1）", () => {
    assert.equal(MAX_ATTEMPTS, 2);
    assert.ok(BACKOFF_MS > 0);
  });
  it("来源默认主题为「新闻」（规格：首源主题 新闻、社会，两者结果相同；默认取新闻）", () => {
    assert.equal(SOURCE_DEFAULT_TOPIC, "新闻");
  });
});

describe("fetchSourceEntries：成功路径", () => {
  it("返回可注入管线的 SourceFetchResult，条目已归一化", async () => {
    const clock = steppedClock(T0);
    const result = await fetchSourceEntries({
      fetchImpl: ((input: RequestInfo | URL) => {
        assert.equal(String(input), BAIDU_FEED_URL, "默认请求用户指定的首源地址");
        return Promise.resolve(feedResponse(FEED_FULL));
      }) as typeof fetch,
      now: clock,
      sleep: async () => {},
    });
    assert.ok(result.ok);
    assert.equal(result.sourceId, SOURCE_ID);
    assert.equal(result.attemptedAt, new Date(T0).toISOString());
    assert.ok(new Date(result.succeededAt).getTime() >= new Date(result.attemptedAt).getTime());
    assert.equal(result.entries.length, 10);
    const basic = result.entries[0]!;
    assert.equal(basic.sourceId, SOURCE_ID);
    assert.equal(basic.guid, "9000001");
    assert.equal(basic.title, "合成测试条目一（无真实新闻）");
    assert.equal(basic.wd, "合成词一");
    assert.equal(basic.originalTime, null);
    assert.equal(basic.topic, SOURCE_DEFAULT_TOPIC);
  });
});

describe("fetchSourceEntries：重试与退避（Q21-1）", () => {
  it("第一次网络失败、第二次成功：共 2 次请求、1 次退避", async () => {
    const clock = steppedClock(T0);
    let calls = 0;
    const sleeps: number[] = [];
    const result = await fetchSourceEntries({
      fetchImpl: (() => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new TypeError("terminated"));
        }
        return Promise.resolve(feedResponse(FEED_FULL));
      }) as typeof fetch,
      now: clock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.ok(result.ok);
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [BACKOFF_MS]);
  });
  it("两次均 5xx：重试耗尽后 ok:false 并携带失败原因", async () => {
    let calls = 0;
    const result = await fetchSourceEntries({
      fetchImpl: (() => {
        calls += 1;
        return Promise.resolve(new Response("boom", { status: 500 }));
      }) as typeof fetch,
      now: steppedClock(T0),
      sleep: async () => {},
    });
    assert.ok(!result.ok);
    assert.equal(result.sourceId, SOURCE_ID);
    assert.equal(result.attemptedAt, new Date(T0).toISOString());
    assert.equal(calls, 2, "最多 2 次尝试");
    assert.match(result.error, /500/);
  });
  it("每次尝试都超时：重试耗尽后 ok:false", async () => {
    let calls = 0;
    const result = await fetchSourceEntries({
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
        });
      }) as typeof fetch,
      now: steppedClock(T0),
      sleep: async () => {},
      timeoutMs: 15,
    });
    assert.ok(!result.ok);
    assert.equal(calls, 2);
    assert.match(result.error, /超时/);
  });
  it("200 但 XML 非法：解析失败计入尝试并重试", async () => {
    let calls = 0;
    const result = await fetchSourceEntries({
      fetchImpl: (() => {
        calls += 1;
        return Promise.resolve(feedResponse("this is not xml at all"));
      }) as typeof fetch,
      now: steppedClock(T0),
      sleep: async () => {},
    });
    assert.ok(!result.ok);
    assert.equal(calls, 2);
    assert.ok(result.error.length > 0);
  });
  it("200 但非合法 UTF-8：编码失败计入尝试并重试", async () => {
    const result = await fetchSourceEntries({
      fetchImpl: (() =>
        Promise.resolve(new Response(Uint8Array.from([0xff, 0xfe, 0x00, 0x41]), { status: 200 }))) as typeof fetch,
      now: steppedClock(T0),
      sleep: async () => {},
    });
    assert.ok(!result.ok);
    assert.match(result.error, /UTF-8|编码/);
  });
});

describe("fetchSourceEntries：URL 安全校验前置", () => {
  it("私有/环回 feed 地址在请求前拒绝（不发起任何请求）", async () => {
    let calls = 0;
    const result = await fetchSourceEntries({
      feedUrl: "http://127.0.0.1:8080/feed.xml",
      fetchImpl: (() => {
        calls += 1;
        return Promise.resolve(feedResponse(FEED_FULL));
      }) as typeof fetch,
      now: steppedClock(T0),
      sleep: async () => {},
    });
    assert.ok(!result.ok);
    assert.equal(calls, 0);
    assert.match(result.error, /环回|私有|保留|主机/);
  });
  it("重定向到私网同样拒绝（安全约束覆盖逐跳）", async () => {
    const result = await fetchSourceEntries({
      fetchImpl: (() =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: "http://192.168.0.9/feed" } }),
        )) as typeof fetch,
      now: steppedClock(T0),
      sleep: async () => {},
    });
    assert.ok(!result.ok);
    assert.match(result.error, /私有|保留|主机/);
  });
});

describe("接入 T02 管线：归一化结果可直接 ingest，坏条目进入隔离", () => {
  it("ingest 合成 feed 结果：好条目收录、缺 GUID 条目隔离且公开记录字段完整", async () => {
    const attemptedAt = "2026-10-03T08:00:00+08:00";
    const result = await fetchSourceEntries({
      fetchImpl: (() => Promise.resolve(feedResponse(FEED_FULL))) as typeof fetch,
      now: () => new Date(attemptedAt),
      sleep: async () => {},
    });
    assert.ok(result.ok);

    const previous = {
      state: initializeState(SOURCE_ID, attemptedAt),
      items: { schemaVersion: 1, items: [] },
    };
    const outcome = ingest(previous, result);
    // 10 条中 1 条缺 GUID 被隔离，9 条收录。
    assert.equal(outcome.items.items.length, 9);
    assert.equal(outcome.state.quarantined.length, 1);
    const record = outcome.state.quarantined[0]!;
    assert.equal(record.sourceId, SOURCE_ID);
    assert.equal(record.guid, null);
    assert.equal(record.reasonCategory, "缺 GUID");
    assert.ok(record.originalTitle.includes("合成测试条目七"));
    assert.ok(record.targetUrl.startsWith(FIXTURE_FEED_HOST));
    assert.equal(record.quarantinedAt, result.succeededAt);
    // 公开快照携带同一条隔离记录（Q22 四字段 + guid）。
    assert.equal(outcome.snapshot.quarantined.length, 1);
    assert.equal(outcome.snapshot.quarantined[0]!.reasonCategory, "缺 GUID");
    // 产出三文件契约自洽。
    verifyManifest(outcome.state, outcome.items, outcome.manifest);
  });
});
