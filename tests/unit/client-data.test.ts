/**
 * 构建期客户端数据岛（Ticket 05）：时间线页内嵌 JSON 的构造与序列化。
 * 约束：只含客户端渲染所需字段；序列化必须转义 `<`，防止 `</script>` 提前闭合注入。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PublicSnapshot } from "../../src/domain/contract.ts";
import { buildTimelineData, serializeClientData } from "../../src/lib/client-data.ts";

const snapshot: PublicSnapshot = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "snapshot.json"), "utf-8"),
) as PublicSnapshot;

test("buildTimelineData：只保留客户端渲染字段并附带基路径与演示标注", () => {
  const data = buildTimelineData(snapshot, "/overthecocoons");
  assert.equal(data.base, "/overthecocoons");
  assert.equal(data.isFixture, true);
  assert.equal(data.entries.length, snapshot.entries.length);
  for (const [index, entry] of data.entries.entries()) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "firstSeenAt",
      "id",
      "summary",
      "title",
      "topic",
      "url",
    ]);
    assert.equal(entry.id, snapshot.entries[index]!.id);
    assert.equal(entry.title, snapshot.entries[index]!.title);
    assert.equal(entry.summary, snapshot.entries[index]!.summary);
    assert.equal(entry.topic, snapshot.entries[index]!.topic);
    assert.equal(entry.firstSeenAt, snapshot.entries[index]!.firstSeenAt);
    assert.equal(entry.url, snapshot.entries[index]!.url);
  }
});

test("serializeClientData：输出是合法 JSON 且不含裸 `<`（防 </script> 注入）", () => {
  const data = buildTimelineData(snapshot, "/overthecocoons");
  const serialized = serializeClientData(data);
  assert.ok(!serialized.includes("<"), "序列化结果不得包含裸 < 字符");
  const parsed = JSON.parse(serialized) as typeof data;
  assert.deepEqual(parsed, data);
});

test("serializeClientData：含 < 的标题/摘要也被转义且解析后还原", () => {
  const data = buildTimelineData(
    {
      ...snapshot,
      entries: [
        {
          id: "a".repeat(64),
          title: "标题<script>alert(1)</script>测试",
          summary: "摘要含 </script> 与 <b>加粗</b>",
          topic: "新闻",
          firstSeenAt: "2026-10-03T08:00:00+08:00",
          url: "https://example.com/s?wd=x",
        },
      ],
      isFixture: true,
    },
    "/overthecocoons",
  );
  const serialized = serializeClientData(data);
  assert.ok(!serialized.includes("<"), "恶意片段必须被转义");
  const parsed = JSON.parse(serialized) as typeof data;
  assert.equal(parsed.entries[0]!.title, data.entries[0]!.title);
  assert.equal(parsed.entries[0]!.summary, data.entries[0]!.summary);
});
