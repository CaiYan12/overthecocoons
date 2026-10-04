import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDataInitialize,
  runDataUpdate,
  StateMissingError,
  DataCorruptionError,
  ClockMonotonicError,
  InitializationRefusedError,
} from "../../src/lib/data-update.ts";
import {
  LocalDirDataStore,
  GitCheckoutDataStore,
  ConflictError,
  dataBranchHeadDigest,
  EMPTY_DATA_BRANCH_SHA,
  type DataBranchRead,
  type DataStore,
  type StoredFiles,
} from "../../src/lib/data-store.ts";
import { verifyManifest } from "../../src/domain/contract.ts";
import { SOURCE_ID } from "../../src/lib/baidu-source.ts";
import type { RawEntryInput, SourceFetchResult } from "../../src/domain/ingestion.ts";

/**
 * Ticket 07 验收场景（任务书 + carry 裁定）：
 * - 采集 → 校验 → 写 data 编排（本地演练目录模拟 data 分支）。
 * - 【carry】调用 ingest 前必须先 verifyManifest（摘要校验是停写链前置）。
 * - 【carry】运行时钟单调：失败运行的 attemptedAt 早于上次 succeededAt 会触发未来时间
 *   停写——编排用运行时刻实际时钟做前置闸门，测试覆盖连续运行场景。
 * - 初始化仅手动入口：无可信初始数据时不产生任何快照（显式拒绝，绝不伪造首日数据）。
 * - 并发冲突即失败（参数化"当前 SHA"），不 force、不自动合并。
 * - 来源失败保留窗口内旧快照并记录 lastFailureAt/Reason 落盘。
 */

const T0 = new Date("2026-10-03T08:00:00+08:00");
const T1 = new Date("2026-10-03T09:00:00+08:00");
const T2 = new Date("2026-10-03T10:00:00+08:00");
/** 早于 T1 的时钟（模拟运行时钟回拨 / 失败运行 attemptedAt 早于上次成功时间）。 */
const T_EARLIER = new Date("2026-10-03T08:30:00+08:00");

const clockAt = (d: Date) => () => new Date(d.getTime());
const iso = (d: Date) => d.toISOString();

let dir: string;
let store: LocalDirDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "otc-data-update-"));
  store = new LocalDirDataStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

let guidSeq = 0;
function makeEntry(overrides: Partial<RawEntryInput> = {}): RawEntryInput {
  guidSeq += 1;
  return {
    sourceId: SOURCE_ID,
    guid: `g-${guidSeq}`,
    title: `合成条目 ${guidSeq}（无真实新闻）`,
    summary: "合成摘要，仅用于自动化测试。",
    url: "https://example.com/s?wd=%E6%B5%8B%E8%AF%95",
    topic: "新闻",
    originalTime: null,
    wd: "测试",
    ...overrides,
  };
}

function okFetch(entries: RawEntryInput[], at: Date) {
  return () => {
    fetchCalls += 1;
    const result: SourceFetchResult = {
      ok: true,
      sourceId: SOURCE_ID,
      attemptedAt: iso(at),
      succeededAt: iso(at),
      entries,
    };
    return Promise.resolve(result);
  };
}

function failFetch(at: Date, error: string) {
  return () => {
    fetchCalls += 1;
    const result: SourceFetchResult = {
      ok: false,
      sourceId: SOURCE_ID,
      attemptedAt: iso(at),
      error,
    };
    return Promise.resolve(result);
  };
}

let fetchCalls = 0;

/** 手动初始化 + 首轮成功采集，得到一个可信非空状态（后续损坏/冲突测试在其上构造）。 */
async function seedWithEntries(entries: RawEntryInput[]): Promise<void> {
  await runDataInitialize({ store, now: clockAt(T0) });
  await runDataUpdate({ store, now: clockAt(T1), fetchSource: okFetch(entries, T1) });
}

async function readTexts(): Promise<DataBranchRead> {
  const read = await store.read();
  if (read === null) throw new Error("测试前置失败：存储应为空 Non-null");
  return read;
}

function parseFiles(read: DataBranchRead): StoredFiles {
  return {
    state: JSON.parse(read.stateText as string),
    items: JSON.parse(read.itemsText as string),
    manifest: JSON.parse(read.manifestText as string),
  };
}

describe("手动初始化（MVP-Q13：独立人为动作）", () => {
  it("空存储初始化：写入三文件且自洽，不产生任何快照", async () => {
    const result = await runDataInitialize({ store, now: clockAt(T0) });
    const read = await readTexts();
    const files = parseFiles(read);
    // 三文件自洽：读回后摘要校验必须通过。
    verifyManifest(files.state, files.items, files.manifest);
    assert.equal(files.state.identities.length, 0, "初始台账为空");
    assert.equal(files.state.sources.length, 0, "初始来源状态为空");
    // 初始化不产生快照：结果对象不存在 snapshot 字段。
    assert.equal("snapshot" in result, false, "初始化不得产出公开快照");
    assert.ok(result.newHeadSha.length > 0);
    assert.notEqual(result.newHeadSha, EMPTY_DATA_BRANCH_SHA);
  });

  it("已有权威状态时初始化被拒绝：绝不自动清空台账重采（MVP-Q13）", async () => {
    await seedWithEntries([makeEntry()]);
    const before = await readTexts();
    await assert.rejects(
      () => runDataInitialize({ store, now: clockAt(T2) }),
      InitializationRefusedError,
    );
    const after = await readTexts();
    assert.equal(after.headSha, before.headSha, "存储不得被初始化改动");
  });

  it("存储损坏时初始化同样被拒绝（恢复走人工，不自动重建）", async () => {
    await seedWithEntries([makeEntry()]);
    // 篡改 manifest 摘要使其与 state 不符。
    const read = await readTexts();
    const manifest = JSON.parse(read.manifestText as string);
    manifest.stateSha256 = "0".repeat(64);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    await assert.rejects(
      () => runDataInitialize({ store, now: clockAt(T2) }),
      InitializationRefusedError,
    );
  });
});

describe("更新路径发现无权威状态（任务书：空状态显式拒绝，绝不伪造首日数据）", () => {
  it("空存储运行更新：StateMissingError，不写任何文件、不产生任何快照", async () => {
    await assert.rejects(() => runDataUpdate({ store, now: clockAt(T1), fetchSource: okFetch([makeEntry()], T1) }), StateMissingError);
    assert.equal(readdirSync(dir).length, 0, "拒绝时不得留下任何文件");
    assert.equal(await store.read(), null, "存储仍为空");
  });
});

describe("采集 → 校验 → 写 data 编排（本地演练目录模拟 data 分支）", () => {
  it("初始化后首轮更新：三文件落盘自洽，条目与来源状态正确", async () => {
    await runDataInitialize({ store, now: clockAt(T0) });
    const result = await runDataUpdate({
      store,
      now: clockAt(T1),
      fetchSource: okFetch([makeEntry({ guid: "g-a" }), makeEntry({ guid: "g-b" })], T1),
    });
    assert.equal(result.kind, "updated");
    const read = await readTexts();
    const files = parseFiles(read);
    verifyManifest(files.state, files.items, files.manifest);
    assert.equal(files.items.items.length, 2);
    assert.equal(files.items.items[0]!.firstSeenAt, iso(T1), "首轮收录时间 = 成功获取时间");
    assert.equal(files.state.sources[0]!.sourceId, SOURCE_ID);
    assert.equal(files.state.sources[0]!.lastSucceededAt, iso(T1));
    assert.equal(files.state.identities.length, 2);
    // 编排产物携带内存快照（供验证/构建侧复用），isFixture 必须为 false。
    assert.equal(result.snapshot.isFixture, false);
    assert.equal(result.snapshot.entries.length, 2);
  });
});

describe("【carry 裁定】调用 ingest 前先 verifyManifest（损坏即停写，先于任何抓取）", () => {
  it("manifest 摘要与 state 不符：DataCorruptionError，且不发起抓取、不写盘", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    // 篡改 state 内容（保持合法 JSON 结构，但摘要不再匹配）。
    const read = await readTexts();
    const state = JSON.parse(read.stateText as string);
    state.stateTakenAt = "2026-10-03T08:59:00.000Z";
    writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
    const tampered = await readTexts();

    fetchCalls = 0;
    await assert.rejects(
      () =>
        runDataUpdate({
          store,
          now: clockAt(T2),
          fetchSource: failFetch(T2, "HTTP 503"),
        }),
      DataCorruptionError,
    );
    assert.equal(fetchCalls, 0, "摘要校验失败必须在抓取之前终止");
    const after = await readTexts();
    assert.equal(after.headSha, tampered.headSha, "损坏状态不得被改写（停写）");
  });

  it("坏 JSON（state.json 非法）：DataCorruptionError，停写", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    writeFileSync(join(dir, "state.json"), "{not valid json", "utf-8");
    const tampered = await readTexts();
    await assert.rejects(
      () => runDataUpdate({ store, now: clockAt(T2), fetchSource: okFetch([makeEntry({ guid: "g-2" })], T2) }),
      DataCorruptionError,
    );
    assert.equal((await readTexts()).headSha, tampered.headSha, "坏 JSON 不得触发任何写入");
  });

  it("字段缺失（items.json 缺必需数组）：DataCorruptionError，停写", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const read = await readTexts();
    const items = JSON.parse(read.itemsText as string);
    delete items.items;
    writeFileSync(join(dir, "items.json"), JSON.stringify(items, null, 2), "utf-8");
    const tampered = await readTexts();
    await assert.rejects(
      () => runDataUpdate({ store, now: clockAt(T2), fetchSource: okFetch([makeEntry({ guid: "g-2" })], T2) }),
      DataCorruptionError,
    );
    assert.equal((await readTexts()).headSha, tampered.headSha);
  });

  it("三文件不完整（缺少 manifest.json）：DataCorruptionError，不自动重建", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    rmSync(join(dir, "manifest.json"));
    const tampered = await readTexts();
    await assert.rejects(
      () => runDataUpdate({ store, now: clockAt(T2), fetchSource: okFetch([makeEntry({ guid: "g-2" })], T2) }),
      DataCorruptionError,
    );
    assert.equal((await readTexts()).headSha, tampered.headSha);
  });
});

describe("【carry 裁定】运行时钟单调（用运行时刻实际时钟，不信任 feed 时间）", () => {
  it("连续运行中时钟早于上次成功时间：ClockMonotonicError，抓取不得发起、状态保持", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const before = await readTexts();
    fetchCalls = 0;
    // 失败运行的 attemptedAt（= 运行时钟 08:30）早于上次 succeededAt（09:00）——
    // 若放行将触发未来时间停写；编排必须在此之前以时钟单调错误终止。
    await assert.rejects(
      () =>
        runDataUpdate({
          store,
          now: clockAt(T_EARLIER),
          fetchSource: failFetch(T_EARLIER, "HTTP 503"),
        }),
      ClockMonotonicError,
    );
    assert.equal(fetchCalls, 0, "时钟闸门必须先于抓取");
    assert.equal((await readTexts()).headSha, before.headSha, "状态不得被改写");
  });

  it("时钟单调时连续成功运行：新条目以新时钟记账，状态自洽", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const result = await runDataUpdate({
      store,
      now: clockAt(T2),
      fetchSource: okFetch([makeEntry({ guid: "g-1" }), makeEntry({ guid: "g-2" })], T2),
    });
    assert.equal(result.kind, "updated");
    const files = parseFiles(await readTexts());
    verifyManifest(files.state, files.items, files.manifest);
    const second = files.items.items.find((item) => item.guid === "g-2");
    assert.ok(second, "新条目应被收录");
    assert.equal(second.firstSeenAt, iso(T2), "新条目首次收录时间 = 本次成功获取时间");
    const first = files.items.items.find((item) => item.guid === "g-1");
    assert.equal(first!.firstSeenAt, iso(T1), "旧条目首次收录时间不刷新");
  });

  it("时钟单调时来源失败：降级保留旧条目，lastFailureAt/Reason 落盘，lastSucceededAt 不变", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" }), makeEntry({ guid: "g-2" })]);
    const result = await runDataUpdate({
      store,
      now: clockAt(T2),
      fetchSource: failFetch(T2, "获取失败：HTTP 503"),
    });
    assert.equal(result.kind, "degraded", "来源失败但旧数据可信：降级继续");
    // 编排层验证落盘（读回存储断言，不仅看内存返回值）。
    const files = parseFiles(await readTexts());
    verifyManifest(files.state, files.items, files.manifest);
    const status = files.state.sources[0]!;
    assert.equal(status.lastFailureAt, iso(T2), "失败时间落盘");
    assert.equal(status.lastFailureReason, "获取失败：HTTP 503", "失败原因落盘");
    assert.equal(status.lastSucceededAt, iso(T1), "失败不刷新成功获取时间");
    assert.equal(status.lastAttemptedAt, iso(T2));
    assert.equal(files.items.items.length, 2, "窗口内旧条目保留");
    assert.equal(result.snapshot.entries.length, 2, "降级快照保留窗口内旧条目");
  });
});

describe("并发控制（参数化当前 SHA：失败不 force、不自动合并）", () => {
  it("本地模拟存储：读取后分支前进（SHA 变化），以旧 SHA 写入即 ConflictError 且内容不被覆盖", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    // 读取方 B 在分支前进前读取。
    const readerB = new LocalDirDataStore(dir);
    const readB = await readerB.read();
    assert.ok(readB);
    // 另一写入方 A 使分支前进。
    await runDataUpdate({
      store,
      now: clockAt(T2),
      fetchSource: okFetch([makeEntry({ guid: "g-1" }), makeEntry({ guid: "g-2" })], T2),
    });
    const afterA = await readTexts();
    // B 以过期 SHA 写入：必须失败。
    const filesB = parseFiles(readB);
    await assert.rejects(() => readerB.write(filesB, readB.headSha), ConflictError);
    // A 的版本保持，未被 B 覆盖（不 force、不合并）。
    const afterB = await readTexts();
    assert.equal(afterB.headSha, afterA.headSha);
    const filesAfter = parseFiles(afterB);
    assert.equal(filesAfter.items.items.length, 2, "保持 A 写入的内容");
  });

  it("编排把读取到的当前 SHA 传给 store.write（参数化接口接线）", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const read = await readTexts();
    const recorded: string[] = [];
    const recordingStore: DataStore = {
      read: () => Promise.resolve(read),
      write: (_files: StoredFiles, expectedHeadSha: string) => {
        recorded.push(expectedHeadSha);
        return Promise.resolve({ newHeadSha: "simulated-new-sha" });
      },
    };
    const result = await runDataUpdate({
      store: recordingStore,
      now: clockAt(T2),
      fetchSource: okFetch([makeEntry({ guid: "g-1" })], T2),
    });
    assert.deepEqual(recorded, [read.headSha], "写回必须以读取时的 SHA 为前提");
    assert.equal(result.newHeadSha, "simulated-new-sha");
  });

  it("write 报告冲突时编排原样失败：不重试、不自动合并", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const read = await readTexts();
    const conflictStore: DataStore = {
      read: () => Promise.resolve(read),
      write: () => Promise.reject(new ConflictError("模拟：data 分支已前进")),
    };
    fetchCalls = 0;
    await assert.rejects(
      () =>
        runDataUpdate({
          store: conflictStore,
          now: clockAt(T2),
          fetchSource: okFetch([makeEntry({ guid: "g-1" })], T2),
        }),
      ConflictError,
    );
    assert.equal(fetchCalls, 1, "冲突不触发自动重试");
  });
});

describe("GitCheckoutDataStore（工作流运行时形态：SHA 由调用方以 git rev-parse 提供）", () => {
  it("读取返回调用方提供的 SHA 与三文件文本；正常写入落盘", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const gitStore = new GitCheckoutDataStore(dir, "deadbeef");
    const read = await gitStore.read();
    assert.ok(read);
    assert.equal(read.headSha, "deadbeef");
    assert.equal(JSON.parse(read.stateText!).stateTakenAt, iso(T1), "stateText 为 state.json 原文");
    assert.ok(read.itemsText!.length > 0);
    // 正常写入。
    const files = parseFiles(read);
    files.state.stateTakenAt = iso(T2);
    const writeResult = await gitStore.write(files, "deadbeef");
    const onDisk = JSON.parse(readFileSync(join(dir, "state.json"), "utf-8"));
    assert.equal(onDisk.stateTakenAt, iso(T2), "写入应落盘");
    assert.equal(writeResult.newHeadSha.length, 64, "新 HEAD 为写入内容摘要");
  });

  it("write 的 expectedHeadSha 与读取时不符：ConflictError", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const gitStore = new GitCheckoutDataStore(dir, "sha-at-read");
    const read = await gitStore.read();
    assert.ok(read);
    const files = parseFiles(read);
    await assert.rejects(() => gitStore.write(files, "sha-elsewhere"), ConflictError);
  });

  it("读取后文件被外部改动：写入拒绝（运行中漂移检测）", async () => {
    await seedWithEntries([makeEntry({ guid: "g-1" })]);
    const gitStore = new GitCheckoutDataStore(dir, "sha-at-read");
    const read = await gitStore.read();
    assert.ok(read);
    // 模拟运行中外部改动（并发写入在 git push 层最终兜底）。
    const items = JSON.parse(read.itemsText as string);
    items.items = [];
    writeFileSync(join(dir, "items.json"), JSON.stringify(items, null, 2), "utf-8");
    const files = parseFiles(read);
    await assert.rejects(() => gitStore.write(files, "sha-at-read"), ConflictError);
  });
});

describe("dataBranchHeadDigest（模拟 HEAD 摘要）", () => {
  it("相同文本摘要稳定，任一文件变化摘要变化", () => {
    const a = dataBranchHeadDigest('{"x":1}', "[]", "{}");
    assert.equal(a, dataBranchHeadDigest('{"x":1}', "[]", "{}"));
    assert.notEqual(a, dataBranchHeadDigest('{"x":2}', "[]", "{}"));
    assert.notEqual(a, dataBranchHeadDigest('{"x":1}', "[1]", "{}"));
    assert.notEqual(a, dataBranchHeadDigest('{"x":1}', "[]", '{"y":1}'));
  });

  it("缺失文件以 null 参与摘要且与空串可区分", () => {
    const withNull = dataBranchHeadDigest(null, null, null);
    const withEmpty = dataBranchHeadDigest("", "", "");
    assert.notEqual(withNull, withEmpty);
    assert.equal(withNull, EMPTY_DATA_BRANCH_SHA);
  });
});
