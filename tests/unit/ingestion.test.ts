import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initializeState,
  ingest,
  WINDOW_MS,
} from "../../src/domain/ingestion.ts";
import type { RawEntryInput } from "../../src/domain/ingestion.ts";
import type { ItemsFile, StateFile } from "../../src/domain/contract.ts";
import { stableId, verifyManifest } from "../../src/domain/contract.ts";

/**
 * Ticket 02 验收场景（任务书）：
 * 同 GUID 重抓 / 内容修订 / 关键词冲突 / 缺 GUID / 不同 GUID 同搜索词；
 * 7 天窗口边界、旧条目累积、过期再出现、未来或无效时间拒绝；
 * 来源失败保留可信旧数据；坏状态不自动造台账（停写）。
 *
 * 管线为纯函数：来源以注入方式给入（不触网），时间为测试显式给定的 ISO 字符串。
 */

const SOURCE = "test-source";
/** 运行基准时间 T0。 */
const T0 = "2026-10-03T08:00:00+08:00";
const T1 = "2026-10-03T09:00:00+08:00";

function makeEntry(overrides: Partial<RawEntryInput> = {}): RawEntryInput {
  return {
    sourceId: SOURCE,
    guid: "g-default",
    title: "测试条目",
    summary: "测试摘要",
    url: "https://example.com/s?wd=%E6%B5%8B%E8%AF%95",
    topic: "新闻",
    originalTime: null,
    wd: "测试",
    ...overrides,
  };
}

function okRun(attemptedAt: string, entries: RawEntryInput[]) {
  return { ok: true as const, sourceId: SOURCE, attemptedAt, succeededAt: attemptedAt, entries };
}

function failRun(attemptedAt: string, error: string) {
  return { ok: false as const, sourceId: SOURCE, attemptedAt, error };
}

/** 显式手动初始化（对应 MVP-Q13 的独立手动入口缝），再跑首轮采集。 */
function firstRun(entries: RawEntryInput[]) {
  const previous = {
    state: initializeState(SOURCE, T0),
    items: { schemaVersion: 1, items: [] } as ItemsFile,
  };
  return ingest(previous, okRun(T0, entries));
}

describe("场景一：同 GUID 重抓不刷新首次收录时间（规格内容规则 1/3）", () => {
  it("重抓同一 GUID：firstSeenAt 保持首轮值，台账只有一条身份，条目不重复", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g1" })]),
    );
    assert.equal(run2.items.items.length, 1, "重抓不得产生重复条目");
    assert.equal(run2.items.items[0]!.firstSeenAt, T0, "首次收录时间不得刷新");
    assert.equal(run2.state.identities.length, 1, "台账身份不得重复");
    assert.equal(run2.items.items[0]!.stableId, stableId(SOURCE, "g1"));
  });

  it("新条目首次收录时间等于成功获取时间（收录发生于校验通过并保存）", () => {
    const run = firstRun([makeEntry({ guid: "g1" })]);
    assert.equal(run.items.items[0]!.firstSeenAt, T0);
  });
});

describe("场景二：内容修订保留首次收录时间（规格内容规则 3）", () => {
  it("标题/摘要修订：firstSeenAt 不变，内容更新，内容版本递增", () => {
    const run1 = firstRun([makeEntry({ guid: "g1", title: "旧标题", summary: "旧摘要" })]);
    const versionBefore = run1.state.publicContentVersion;
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g1", title: "新标题", summary: "新摘要" })]),
    );
    assert.equal(run2.items.items[0]!.firstSeenAt, T0);
    assert.equal(run2.items.items[0]!.title, "新标题");
    assert.equal(run2.items.items[0]!.contentVersion, 2, "条目内容版本应递增");
    assert.equal(
      run2.state.publicContentVersion,
      versionBefore + 1,
      "可读内容变化应计入公开内容版本",
    );
  });

  it("仅原始时间字段变化不视为内容修订：首次收录时间与内容版本均不变", () => {
    // originalTime 属原始时间字段（语义未核实前不使用），不是可读内容；
    // 其变化不得触发条目内容版本或公开内容版本变化（MVP-Q21 第 8 项）。
    const run1 = firstRun([makeEntry({ guid: "g1", originalTime: null })]);
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g1", originalTime: "2026-10-03T07:00:00+08:00" })]),
    );
    assert.equal(run2.items.items[0]!.firstSeenAt, T0, "首次收录时间不得刷新");
    assert.equal(run2.items.items[0]!.contentVersion, 1, "条目内容版本不得递增");
    assert.equal(
      run2.state.publicContentVersion,
      run1.state.publicContentVersion,
      "公开内容版本不得递增",
    );
  });
});

describe("场景三：关键词变化按身份冲突隔离（MVP-Q19 + 内容规则 3）", () => {
  it("同 GUID、不同 wd：旧条目保留，新输入隔离为身份冲突，台账指纹不变", () => {
    const run1 = firstRun([makeEntry({ guid: "g1", wd: "天气" })]);
    const newUrl = "https://example.com/s?wd=%E4%BD%93%E8%82%B2";
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g1", wd: "体育", url: newUrl })]),
    );
    assert.equal(run2.items.items.length, 1);
    assert.equal(run2.items.items[0]!.wdFingerprint, "天气", "旧数据不被覆盖");
    assert.equal(run2.state.identities[0]!.wdFingerprint, "天气");
    assert.equal(run2.state.quarantined.length, 1, "冲突输入应被隔离");
    const q = run2.state.quarantined[0]!;
    assert.equal(q.reasonCategory, "身份冲突");
    assert.equal(q.originalTitle, "测试条目");
    assert.equal(q.targetUrl, newUrl);
    assert.equal(q.quarantinedAt, T1);
    assert.equal(q.guid, "g1");
  });
});

describe("场景四：缺 GUID 隔离，不兜底造身份（内容规则 2）", () => {
  it("guid 缺失：进入隔离并携带公开四字段，不写台账、不进条目", () => {
    const run = firstRun([makeEntry({ guid: null, title: "无 GUID 条目" })]);
    assert.equal(run.items.items.length, 0, "缺 GUID 不得兜底造身份");
    assert.equal(run.state.identities.length, 0);
    assert.equal(run.state.quarantined.length, 1);
    const q = run.state.quarantined[0]!;
    assert.equal(q.reasonCategory, "缺 GUID");
    assert.equal(q.originalTitle, "无 GUID 条目");
    assert.equal(q.guid, null, "缺 GUID 时不得用链接伪造身份依据");
    assert.equal(q.quarantinedAt, T0);
  });

  it("空字符串 GUID 视同缺失：隔离记录 guid 记为 null，产出状态可再次通过校验", () => {
    const run = firstRun([makeEntry({ guid: "" })]);
    assert.equal(run.state.quarantined[0]!.guid, null);
    assert.doesNotThrow(() => ingest({ state: run.state, items: run.items }, okRun(T1, [])));
  });
});

describe("场景五：不同 GUID 相同搜索词不合并（内容规则 1）", () => {
  it("两个不同 GUID、同 wd：各自独立收录，互不隔离", () => {
    const run = firstRun([
      makeEntry({ guid: "g1", wd: "同一关键词" }),
      makeEntry({ guid: "g2", title: "另一条", wd: "同一关键词" }),
    ]);
    assert.equal(run.items.items.length, 2, "不同 GUID 不因相同搜索词合并");
    assert.equal(run.state.identities.length, 2);
    assert.equal(run.state.quarantined.length, 0, "相同 wd 不是身份冲突");
  });
});

describe("wd 缺失处理（MVP-Q19）", () => {
  it("缺失 wd：照常收录，指纹记空并标注，后续同 GUID 跳过关键词冲突检测", () => {
    const run1 = firstRun([makeEntry({ guid: "g1", wd: null, url: "https://example.com/no-wd" })]);
    assert.equal(run1.items.items[0]!.wdFingerprint, "");
    assert.equal(run1.items.items[0]!.wdMissing, true);
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g1", wd: null, url: "https://example.com/no-wd" })]),
    );
    assert.equal(run2.state.quarantined.length, 0, "指纹缺失时跳过冲突检测");
    assert.equal(run2.items.items[0]!.firstSeenAt, T0);
  });
});

describe("协议校验（MVP-Q21 第 3 项）", () => {
  it("目标链接非 http/https：隔离为协议不合法", () => {
    const run = firstRun([
      makeEntry({ guid: "g-ftp", url: "ftp://example.com/file", wd: null }),
    ]);
    assert.equal(run.items.items.length, 0);
    assert.equal(run.state.quarantined[0]!.reasonCategory, "协议不合法");
  });
});

describe("7 天窗口（验收矩阵“窗口”行）", () => {
  it("7 天边界：恰好 7 天的条目仍在窗口内（含边界），更早的移除", () => {
    const run1 = firstRun([makeEntry({ guid: "g-edge" })]);
    // 恰好 7 天后运行，feed 为空：条目仍在窗口内。
    const at7d = ingest(
      { state: run1.state, items: run1.items },
      okRun("2026-10-10T08:00:00+08:00", []),
    );
    assert.equal(at7d.items.items.length, 1, "恰好 7 天的条目不得提前移除");
    // 再晚 1 秒运行：条目移出窗口。
    const past7d = ingest(
      { state: at7d.state, items: at7d.items },
      okRun("2026-10-10T08:00:01+08:00", []),
    );
    assert.equal(past7d.items.items.length, 0, "超过 7 天的条目移出窗口");
    assert.equal(past7d.state.identities.length, 1, "身份记录不因内容过期丢失");
  });

  it("旧条目累积：后续运行不全量覆盖，窗口内历史条目保留（内容规则 9）", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g2", title: "第二天新条目" })]),
    );
    const ids = run2.items.items.map((item) => item.guid).sort();
    assert.deepEqual(ids, ["g1", "g2"], "旧条目不得被当前 feed 列表覆盖");
  });

  it("过期再出现：旧 GUID 再次被抓到不重计首次收录、不回窗口，台账保留", () => {
    const run1 = firstRun([makeEntry({ guid: "g-old" })]);
    const later = ingest(
      { state: run1.state, items: run1.items },
      okRun("2026-10-11T08:00:00+08:00", []),
    );
    assert.equal(later.items.items.length, 0, "已过期条目先移出窗口");
    const reappear = ingest(
      { state: later.state, items: later.items },
      okRun("2026-10-11T09:00:00+08:00", [makeEntry({ guid: "g-old" })]),
    );
    assert.equal(reappear.items.items.length, 0, "过期条目重现不得重新入窗");
    const identity = reappear.state.identities[0]!;
    assert.equal(identity.firstSeenAt, T0, "首次收录时间不重计");
    assert.equal(reappear.state.identities.length, 1, "身份记录仍在台账");
  });

  it("窗口常量恰为 7 天", () => {
    assert.equal(WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  });
});

describe("未来或无效状态时间被拒绝", () => {
  it("attemptedAt 非法：整次运行抛错（停写）", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    assert.throws(() => ingest({ state: run1.state, items: run1.items }, okRun("not-a-date", [])));
  });

  it("succeededAt 早于 attemptedAt：抛错", () => {
    assert.throws(() =>
      ingest(
        { state: initializeState(SOURCE, T0), items: { schemaVersion: 1, items: [] } },
        { ok: true, sourceId: SOURCE, attemptedAt: T1, succeededAt: T0, entries: [] },
      ),
    );
  });

  it("条目携带未来的原始时间：隔离为字段校验失败", () => {
    const run = firstRun([
      makeEntry({ guid: "g-future", originalTime: "2026-10-03T23:00:00+08:00" }),
    ]);
    assert.equal(run.items.items.length, 0);
    assert.equal(run.state.quarantined[0]!.reasonCategory, "字段校验失败");
  });

  it("条目携带非法的原始时间：隔离为字段校验失败", () => {
    // V8 Date.parse 对越界“日”会进位（如 2026-02-30），因此选取越界“月”作无效样本。
    const run = firstRun([makeEntry({ guid: "g-badtime", originalTime: "2026-13-01T00:00:00+08:00" })]);
    assert.equal(run.state.quarantined[0]!.reasonCategory, "字段校验失败");
  });

  it("旧台账存在未来的首次收录时间：拒绝写入（停写）", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    const tampered: StateFile = {
      ...run1.state,
      identities: [{ ...run1.state.identities[0]!, firstSeenAt: "2026-10-04T08:00:00+08:00" }],
    };
    assert.throws(() => ingest({ state: tampered, items: run1.items }, okRun(T1, [])), /首次收录/);
  });
});

describe("来源失败降级（验收矩阵“失败”行）", () => {
  it("来源失败且有可信旧数据：保留旧条目、记录失败与最后成功时间，不伪造数据", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    const run2 = ingest({ state: run1.state, items: run1.items }, failRun(T1, "上游连接超时"));
    assert.equal(run2.items.items.length, 1, "旧条目保留");
    assert.equal(run2.items.items[0]!.guid, "g1");
    assert.equal(run2.snapshot.entries.length, 1, "输出旧快照");
    const source = run2.state.sources[0]!;
    assert.equal(source.lastAttemptedAt, T1);
    assert.equal(source.lastSucceededAt, T0, "成功获取时间不得被失败运行刷新");
    assert.equal(source.lastFailureAt, T1);
    assert.equal(source.lastFailureReason, "上游连接超时");
    assert.equal(run2.state.quarantined.length, 0, "失败运行不得伪造任何条目或隔离记录");
  });

  it("失败运行发生窗口过期：清理过期内容并计入公开内容版本", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      failRun("2026-10-11T08:00:00+08:00", "上游连接超时"),
    );
    assert.equal(run2.items.items.length, 0, "过期内容被清理");
    assert.equal(run2.state.identities.length, 1, "身份台账保留");
    assert.ok(run2.state.publicContentVersion > run1.state.publicContentVersion, "窗口变化计入版本");
    assert.equal(run2.snapshot.entries.length, 0);
  });
});

describe("停写语义：坏状态/损坏输入不自动造台账（MVP-Q13）", () => {
  it("items 与 manifest 摘要不符：verifyManifest 抛错", () => {
    const run = firstRun([makeEntry({ guid: "g1" })]);
    const tampered: ItemsFile = { ...run.items, items: [] };
    assert.throws(() => verifyManifest(run.state, tampered, run.manifest), /摘要/);
  });

  it("state 与 manifest 摘要不符：verifyManifest 抛错", () => {
    const run = firstRun([makeEntry({ guid: "g1" })]);
    const tampered: StateFile = { ...run.state, stateTakenAt: T1 };
    assert.throws(() => verifyManifest(tampered, run.items, run.manifest), /摘要/);
  });

  it("完整往返（含隔离记录）通过 verifyManifest", () => {
    const run = firstRun([
      makeEntry({ guid: "g1" }),
      makeEntry({ guid: null, title: "坏条目" }),
    ]);
    verifyManifest(run.state, run.items, run.manifest); // 不抛错即通过
  });

  it("缺失必需字段的 state：校验抛错，管线拒绝运行", () => {
    const broken = {} as unknown as StateFile;
    assert.throws(
      () =>
        ingest(
          { state: broken, items: { schemaVersion: 1, items: [] } },
          okRun(T0, []),
        ),
    );
  });

  it("items 中存在台账外身份：视为损坏，拒绝写入", () => {
    const run = firstRun([makeEntry({ guid: "g1" })]);
    const alien: ItemsFile = {
      schemaVersion: 1,
      items: [
        {
          ...run.items.items[0]!,
          stableId: stableId(SOURCE, "g-alien"),
          guid: "g-alien",
        },
      ],
    };
    assert.throws(() => ingest({ state: run.state, items: alien }, okRun(T1, [])), /台账/);
  });
});

describe("运行时间基准统一为成功获取时间（审查修复环 R1）", () => {
  const T0_SUCCEEDED = "2026-10-03T09:00:00+08:00";
  const T2_ATTEMPTED = "2026-10-03T08:30:00+08:00";
  const T2_SUCCEEDED = "2026-10-03T10:00:00+08:00";

  it("succeededAt > attemptedAt 的运行：状态时间/首次收录/快照基准一致取 succeededAt", () => {
    const run1 = ingest(
      { state: initializeState(SOURCE, T0), items: { schemaVersion: 1, items: [] } },
      {
        ok: true,
        sourceId: SOURCE,
        attemptedAt: T0,
        succeededAt: T0_SUCCEEDED,
        entries: [makeEntry({ guid: "g1" })],
      },
    );
    assert.equal(run1.state.stateTakenAt, T0_SUCCEEDED, "状态时间取成功获取时间");
    assert.equal(run1.items.items[0]!.firstSeenAt, T0_SUCCEEDED);
    assert.equal(run1.snapshot.generatedAt, T0_SUCCEEDED, "快照基准取成功获取时间");
    // 产出的状态不得自相矛盾：内部复核（未来时间检查）必须能接受它自己。
    assert.doesNotThrow(() =>
      ingest(
        { state: run1.state, items: run1.items },
        { ok: true, sourceId: SOURCE, attemptedAt: T0_SUCCEEDED, succeededAt: T0_SUCCEEDED, entries: [] },
      ),
    );
  });

  it("succeededAt > attemptedAt 的运行之后，下一次 attemptedAt 更早（但自身成功时间更晚）的运行不触发未来时间停写", () => {
    const run1 = ingest(
      { state: initializeState(SOURCE, T0), items: { schemaVersion: 1, items: [] } },
      {
        ok: true,
        sourceId: SOURCE,
        attemptedAt: T0,
        succeededAt: T0_SUCCEEDED,
        entries: [makeEntry({ guid: "g1" })],
      },
    );
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      {
        ok: true,
        sourceId: SOURCE,
        attemptedAt: T2_ATTEMPTED,
        succeededAt: T2_SUCCEEDED,
        entries: [],
      },
    );
    assert.equal(run2.state.stateTakenAt, T2_SUCCEEDED);
    assert.equal(run2.items.items.length, 1, "旧条目仍在窗口内");
    assert.equal(run2.items.items[0]!.firstSeenAt, T0_SUCCEEDED, "首次收录时间不刷新");
  });
});

describe("公开内容版本（MVP-Q21 第 8 项）", () => {
  it("仅尝试时间变化：版本不变", () => {
    const run1 = firstRun([makeEntry({ guid: "g1" })]);
    const run2 = ingest(
      { state: run1.state, items: run1.items },
      okRun(T1, [makeEntry({ guid: "g1" })]),
    );
    assert.equal(run2.state.publicContentVersion, run1.state.publicContentVersion);
    assert.equal(run2.manifest.publicContentDigest, run1.manifest.publicContentDigest);
  });

  it("隔离列表变化计入公开内容版本", () => {
    const base = firstRun([makeEntry({ guid: "g1" })]);
    const withQuarantine = ingest(
      { state: base.state, items: base.items },
      okRun(T1, [makeEntry({ guid: null, title: "缺 GUID 条目" })]),
    );
    assert.equal(withQuarantine.items.items.length, 1, "正常条目不变");
    assert.ok(
      withQuarantine.state.publicContentVersion > base.state.publicContentVersion,
      "隔离列表变化应计入公开内容版本",
    );
    assert.notEqual(
      withQuarantine.manifest.publicContentDigest,
      base.manifest.publicContentDigest,
    );
  });
});

describe("公开快照与三文件契约", () => {
  it("快照按首次收录时间倒序、同时间按稳定 ID 次序；来源状态公开", () => {
    const run = firstRun([
      makeEntry({ guid: "g-late", title: "晚条目" }),
      makeEntry({ guid: "g-early", title: "早条目" }),
    ]);
    // 同一运行内 firstSeenAt 相同（均为 succeededAt），按稳定 ID 确定性排序。
    const ids = run.snapshot.entries.map((entry) => entry.id);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(run.snapshot.isFixture, false);
    assert.equal(run.snapshot.generatedAt, T0);
    assert.equal(run.snapshot.sources.length, 1);
  });

  it("隔离条目公开字段：标题+链接+原因+时间（MVP-Q22）", () => {
    const run = firstRun([makeEntry({ guid: "g-ftp", url: "ftp://example.com/x", wd: null })]);
    assert.equal(run.snapshot.quarantined.length, 1);
    const q = run.snapshot.quarantined[0]!;
    assert.equal(typeof q.originalTitle, "string");
    assert.equal(typeof q.targetUrl, "string");
    assert.equal(typeof q.reasonCategory, "string");
    assert.equal(typeof q.quarantinedAt, "string");
  });
});
