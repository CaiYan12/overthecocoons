import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSnapshot, loadSnapshotFrom } from "../../src/lib/snapshot.ts";

/** 在临时目录写一个快照文件并返回其绝对路径（测试结束由 describe 清理）。 */
function writeTempSnapshot(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "otc-snapshot-"));
  const file = join(dir, "snapshot.json");
  writeFileSync(file, content, "utf-8");
  tempDirs.push(dir);
  return file;
}

const tempDirs: string[] = [];

describe("loadSnapshot（构建期数据注入缝）", () => {
  it("默认读取仓库 fixtures/snapshot.json，且明确标记为演示数据", () => {
    const snap = loadSnapshot();
    assert.equal(snap.schemaVersion, 1);
    assert.equal(snap.isFixture, true, "仓库自带快照必须是演示数据");
    assert.ok(snap.entries.length > 0, "演示快照应包含至少一条条目");
    assert.ok(Array.isArray(snap.quarantined), "公开快照必须携带隔离列表字段");
    assert.ok(Array.isArray(snap.sources), "公开快照必须携带来源状态字段");
    for (const entry of snap.entries) {
      assert.equal(typeof entry.id, "string");
      assert.equal(typeof entry.title, "string");
      assert.equal(typeof entry.summary, "string");
      assert.equal(typeof entry.topic, "string");
      assert.equal(typeof entry.firstSeenAt, "string");
      assert.equal(typeof entry.url, "string");
    }
  });

  it("可通过 SNAPSHOT_PATH 环境变量注入其他快照文件", () => {
    const file = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "2026-10-03T00:00:00+08:00",
        entries: [],
        quarantined: [],
        sources: [],
      }),
    );
    const previous = process.env.SNAPSHOT_PATH;
    try {
      process.env.SNAPSHOT_PATH = file;
      const snap = loadSnapshot();
      assert.equal(snap.isFixture, false);
      assert.deepEqual(snap.entries, []);
    } finally {
      if (previous === undefined) {
        delete process.env.SNAPSHOT_PATH;
      } else {
        process.env.SNAPSHOT_PATH = previous;
      }
    }
  });

  it("快照文件缺失时抛出错误（不静默造数据）", () => {
    assert.throws(() => loadSnapshotFrom("Z:/definitely/missing/snapshot.json"));
  });

  it("非法 JSON 抛出错误", () => {
    const file = writeTempSnapshot("{ not valid json");
    assert.throws(() => loadSnapshotFrom(file));
  });

  it("缺少必需字段（schemaVersion/isFixture/entries）时抛出错误", () => {
    const file = writeTempSnapshot(JSON.stringify({ entries: [] }));
    assert.throws(() => loadSnapshotFrom(file));
    const file2 = writeTempSnapshot(
      JSON.stringify({ schemaVersion: 1, isFixture: true, generatedAt: "2026-10-03T00:00:00+08:00" }),
    );
    assert.throws(() => loadSnapshotFrom(file2));
  });

  it("公开快照必须包含隔离列表与来源状态数组（Ticket 02 契约演进）", () => {
    const withoutQuarantined = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "2026-10-03T00:00:00+08:00",
        entries: [],
        sources: [],
      }),
    );
    assert.throws(() => loadSnapshotFrom(withoutQuarantined), /quarantined/);
    const withoutSources = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "2026-10-03T00:00:00+08:00",
        entries: [],
        quarantined: [],
      }),
    );
    assert.throws(() => loadSnapshotFrom(withoutSources), /sources/);
  });

  it("隔离条目公开字段（标题/链接/原因/时间）缺失时抛出错误", () => {
    const file = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "2026-10-03T00:00:00+08:00",
        entries: [],
        quarantined: [
          {
            guid: null,
            originalTitle: "t",
            targetUrl: "https://example.com",
            reasonCategory: "缺 GUID",
          },
        ],
        sources: [],
      }),
    );
    assert.throws(() => loadSnapshotFrom(file), /quarantinedAt/);
  });

  it("entries[] 内字段分支：元素非对象、缺字符串字段时抛出错误", () => {
    const base = {
      schemaVersion: 1,
      isFixture: false,
      generatedAt: "2026-10-03T00:00:00+08:00",
      quarantined: [],
      sources: [],
    };
    const notObject = writeTempSnapshot(JSON.stringify({ ...base, entries: ["oops"] }));
    assert.throws(() => loadSnapshotFrom(notObject), /entries\[0\] 不是对象/);
    const missingField = writeTempSnapshot(
      JSON.stringify({
        ...base,
        entries: [
          { id: "a".repeat(64), title: "t", summary: "", topic: "新闻", firstSeenAt: "2026-10-03T00:00:00+08:00" },
        ],
      }),
    );
    assert.throws(() => loadSnapshotFrom(missingField), /缺少字符串字段 url/);
  });

  it("entries[].id 非 64 位小写十六进制时抛出错误（终审收尾项）", () => {
    const file = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "2026-10-03T00:00:00+08:00",
        entries: [
          {
            id: "not-a-stable-id",
            title: "t",
            summary: "",
            topic: "新闻",
            firstSeenAt: "2026-10-03T00:00:00+08:00",
            url: "https://example.com",
          },
        ],
        quarantined: [],
        sources: [],
      }),
    );
    assert.throws(() => loadSnapshotFrom(file), /64 位小写十六进制/);
  });

  it("entries[].firstSeenAt 不可解析时抛出错误", () => {
    const file = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "2026-10-03T00:00:00+08:00",
        entries: [
          {
            id: "a".repeat(64),
            title: "t",
            summary: "",
            topic: "新闻",
            firstSeenAt: "昨天下午",
            url: "https://example.com",
          },
        ],
        quarantined: [],
        sources: [],
      }),
    );
    assert.throws(() => loadSnapshotFrom(file), /无效时间/);
  });

  it("generatedAt 不可解析时抛出错误（终审收尾项）", () => {
    const file = writeTempSnapshot(
      JSON.stringify({
        schemaVersion: 1,
        isFixture: false,
        generatedAt: "not-a-timestamp",
        entries: [],
        quarantined: [],
        sources: [],
      }),
    );
    assert.throws(() => loadSnapshotFrom(file), /无效时间/);
  });
});

// node:test 结束后清理临时目录
process.on("exit", () => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结果
    }
  }
});
