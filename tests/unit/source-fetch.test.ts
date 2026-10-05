import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  fetchTextOnce,
} from "../../src/lib/source-fetch.ts";
import { FEED_FULL } from "../data/feed-fixtures.ts";

/**
 * 获取层（单次尝试）验收：获取与解析分离、仅 http/https 且请求前校验 host
 * （含重定向逐跳复验）、超时、非 2xx、响应大小上限、严格 UTF-8 解码失败。
 * 重试与退避的编排属来源适配器（baidu-source 测试）。
 */

function jsonResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" }, ...init });
}

describe("fetchTextOnce：成功路径", () => {
  it("返回响应文本且只请求一次，传入可中止信号", async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      seen.signal = init?.signal ?? null;
      return Promise.resolve(jsonResponse(FEED_FULL));
    }) as typeof fetch;
    const text = await fetchTextOnce("https://rss.aishort.top/?type=baidu", { fetchImpl });
    assert.equal(text, FEED_FULL);
    assert.ok(seen.signal instanceof AbortSignal, "必须携带 AbortSignal 以支持超时");
  });
});

describe("fetchTextOnce：请求前 URL 校验", () => {
  it("非 http/https 协议在请求前拒绝（fetch 一次都不发起）", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(jsonResponse("x"));
    }) as typeof fetch;
    await assert.rejects(
      () => fetchTextOnce("ftp://example.com/feed.xml", { fetchImpl }),
      /协议|http|https/,
    );
    assert.equal(calls, 0);
  });
  it("私有/环回主机在请求前拒绝", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(jsonResponse("x"));
    }) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("http://127.0.0.1:9000/feed", { fetchImpl }), /环回|私有|保留|主机/);
    await assert.rejects(() => fetchTextOnce("http://192.168.1.10/feed", { fetchImpl }), /私有|保留|主机/);
    assert.equal(calls, 0);
  });
});

describe("fetchTextOnce：超时", () => {
  it("超过 timeoutMs 未响应即中止并报超时", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
      });
    }) as typeof fetch;
    await assert.rejects(
      () => fetchTextOnce("https://rss.aishort.top/?type=baidu", { fetchImpl, timeoutMs: 20 }),
      /超时/,
    );
  });

  it("响应体读取中途触发超时：归一为「读取响应体超时」口径（T03 收尾项）", async () => {
    // fetch 响应头及时返回，但 body 流永不结束，直到 signal 中止读取——
    // 该场景在 readBodyWithLimit 内失败，错误消息必须与请求阶段同口径，不透出底层 abort 原文。
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve) => {
        const response = new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<rss>"));
            init?.signal?.addEventListener("abort", () => controller.error(new Error("This operation was aborted")));
          },
        }), { status: 200 });
        resolve(response);
      });
    }) as typeof fetch;
    await assert.rejects(
      () => fetchTextOnce("https://rss.aishort.top/?type=baidu", { fetchImpl, timeoutMs: 30 }),
      (error: Error) => {
        assert.match(error.message, /读取响应体超时/);
        assert.doesNotMatch(error.message, /This operation was aborted/);
        return true;
      },
    );
  });
});

describe("fetchTextOnce：HTTP 状态与非 2xx", () => {
  it("404 拒绝并包含状态码", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("https://example.com/feed", { fetchImpl }), /404/);
  });
  it("3xx 缺少 Location 视为失败", async () => {
    const fetchImpl = (() => Promise.resolve(new Response(null, { status: 302 }))) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("https://example.com/feed", { fetchImpl }), /重定向|Location/i);
  });
});

describe("fetchTextOnce：重定向逐跳复验（用户安全硬约束）", () => {
  it("公网跳转跟随并返回最终文本", async () => {
    const urls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: "https://final.example.test/feed.xml" } }),
        );
      }
      return Promise.resolve(jsonResponse(FEED_FULL));
    }) as typeof fetch;
    const text = await fetchTextOnce("https://start.example.test/r", { fetchImpl });
    assert.equal(text, FEED_FULL);
    assert.deepEqual(urls, ["https://start.example.test/r", "https://final.example.test/feed.xml"]);
  });
  it("重定向到私有地址必须拒绝且不发起该跳请求", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: "http://10.0.0.5/feed" } }),
      );
    }) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("https://start.example.test/r", { fetchImpl }), /私有|保留|主机/);
    assert.equal(calls, 1, "第二跳必须在请求前被拒绝");
  });
  it("重定向到环回/localhost 必须拒绝", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(null, { status: 301, headers: { location: "http://localhost:8080/x" } }),
      )) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("https://start.example.test/r", { fetchImpl }), /localhost|环回/);
  });
  it("重定向到尾点 localhost（localhost.）同样必须拒绝（审查修复环 R1）", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: "http://localhost.:8080/feed" } }),
      );
    }) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("https://start.example.test/r", { fetchImpl }), /尾点|localhost/);
    assert.equal(calls, 1, "第二跳必须在请求前被拒绝");
  });
  it("超过 maxRedirects 报错", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "https://hop.example.test/next" } }),
      )) as typeof fetch;
    await assert.rejects(
      () => fetchTextOnce("https://start.example.test/r", { fetchImpl, maxRedirects: 2 }),
      /重定向/,
    );
  });
});

describe("fetchTextOnce：响应体大小与编码", () => {
  it("超过 maxBytes 拒绝", async () => {
    const fetchImpl = (() => Promise.resolve(jsonResponse("x".repeat(64)))) as typeof fetch;
    await assert.rejects(
      () => fetchTextOnce("https://example.com/feed", { fetchImpl, maxBytes: 16 }),
      /大小|超过/,
    );
  });
  it("非合法 UTF-8 字节流拒绝（严格解码，不产生替换字符静默通过）", async () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x41, 0x42]);
    const fetchImpl = (() => Promise.resolve(new Response(bytes, { status: 200 }))) as typeof fetch;
    await assert.rejects(() => fetchTextOnce("https://example.com/feed", { fetchImpl }), /UTF-8|编码/);
  });
});

describe("默认参数（工程方案 Q21-1 的获取层基础）", () => {
  it("默认超时/大小上限/重定向上限已定义", () => {
    assert.equal(typeof DEFAULT_FETCH_TIMEOUT_MS, "number");
    assert.ok(DEFAULT_FETCH_TIMEOUT_MS > 0);
    assert.ok(DEFAULT_MAX_BYTES > 0);
    assert.ok(DEFAULT_MAX_REDIRECTS > 0);
  });
});
