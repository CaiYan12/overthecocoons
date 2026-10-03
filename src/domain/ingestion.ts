/**
 * 采集管线核心（Ticket 02）：身份合并、7 天窗口、隔离与失败降级。
 *
 * 纯函数设计：来源以 `SourceFetchResult` 注入（本票不触网，真实获取层属 Ticket 03），
 * 时间由调用方以 ISO 8601 字符串显式给入，便于测试与工作流复现。
 *
 * 规则依据（docs/mvp-decisions.md / docs/mvp-spec.md 内容规则）：
 * - 身份 = 来源 ID + GUID（MVP-Q15）；不同 GUID 不因相似标题或相同搜索词合并（内容规则 1）。
 * - 缺 GUID 隔离，不兜底用链接造身份（内容规则 2，MVP-Q19）。
 * - 同一身份关键词变化按身份冲突隔离；首次收录时间固定（内容规则 3，MVP-Q19）。
 * - 台账无限保留，items 仅 7 天窗口（MVP-Q14，内容规则 8/9）。
 * - 来源失败且旧数据可信：输出旧快照 + 明确失败与最后成功时间，不伪造数据。
 * - 损坏/未来/无效状态时间拒绝写入（停写，MVP-Q13/Q21）。
 * - 公开内容版本仅随可读内容/窗口/隔离列表变化递增（MVP-Q21 第 8 项）。
 */
import {
  SCHEMA_VERSION,
  assertItemsFile,
  assertStateFile,
  canonicalJson,
  parseIsoTime,
  sha256hex,
  stableId,
  type ItemEntry,
  type ItemsFile,
  type LedgerIdentity,
  type ManifestFile,
  type PublicEntry,
  type PublicQuarantineRecord,
  type PublicSnapshot,
  type PublicSourceStatus,
  type QuarantineReason,
  type QuarantineRecord,
  type SourceStatus,
  type StateFile,
} from "./contract.ts";

/** 公开保留窗口：7 天。 */
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 来源归一化后的条目输入（wd 为已解码的精确字符串；指纹提取逻辑属 Ticket 03）。 */
export interface RawEntryInput {
  sourceId: string;
  /** 原始 GUID；缺失为 null（照常校验并隔离，不兜底造身份）。 */
  guid: string | null;
  title: string;
  /** 源摘要或正文纯文本；两者皆无为 null（不编造）。 */
  summary: string | null;
  url: string;
  topic: string;
  /** 原始时间：语义未核实前必须为 null（当前首源恒 null）。 */
  originalTime: string | null;
  /** 解码后的 wd；目标链接缺失该参数时为 null。 */
  wd: string | null;
}

export type SourceFetchResult =
  | {
      ok: true;
      sourceId: string;
      attemptedAt: string;
      succeededAt: string;
      entries: RawEntryInput[];
    }
  | { ok: false; sourceId: string; attemptedAt: string; error: string };

export interface IngestPrevious {
  state: StateFile;
  items: ItemsFile;
}

export interface IngestOutcome {
  state: StateFile;
  items: ItemsFile;
  manifest: ManifestFile;
  snapshot: PublicSnapshot;
}

function requireSourceId(sourceId: string): void {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    throw new Error("管线输入错误：sourceId 不能为空");
  }
}

/**
 * 显式手动初始化权威状态（MVP-Q13：首次初始化必须是独立人为动作）。
 * 日常更新（ingest）绝不自动调用本函数；定时任务发现无权威状态必须报错停止。
 */
export function initializeState(sourceId: string, runAt: string): StateFile {
  requireSourceId(sourceId);
  parseIsoTime(runAt, "初始化时间");
  return {
    schemaVersion: SCHEMA_VERSION,
    stateTakenAt: runAt,
    publicContentVersion: 0,
    publicContentDigest: sha256hex(canonicalJson({ entries: [], quarantined: [] })),
    identities: [],
    quarantined: [],
    sources: [],
  };
}

function compareEntryDesc(a: PublicEntry, b: PublicEntry): number {
  const timeDiff = Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
  if (timeDiff !== 0) return timeDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareQuarantineDesc(a: PublicQuarantineRecord, b: PublicQuarantineRecord): number {
  const timeDiff = Date.parse(b.quarantinedAt) - Date.parse(a.quarantinedAt);
  if (timeDiff !== 0) return timeDiff;
  const titleDiff = a.originalTitle.localeCompare(b.originalTitle, "zh-Hans-CN");
  if (titleDiff !== 0) return titleDiff;
  return a.targetUrl < b.targetUrl ? -1 : a.targetUrl > b.targetUrl ? 1 : 0;
}

/** 公开内容摘要：窗口内公开条目 + 隔离列表的规范哈希（排除尝试时间等非公开内容字段）。 */
function computeVisibleDigest(
  entries: PublicEntry[],
  quarantined: PublicQuarantineRecord[],
): string {
  const sortedEntries = [...entries].sort(compareEntryDesc);
  const sortedQuarantined = [...quarantined].sort(compareQuarantineDesc);
  return sha256hex(canonicalJson({ entries: sortedEntries, quarantined: sortedQuarantined }));
}

/**
 * 生成公开快照：以 snapshotTakenAt 为时间基准筛选 7 天窗口，服务器统一排序。
 * isFixture 恒为 false（真实管线输出；演示快照由仓库 fixtures 提供）。
 */
export function buildPublicSnapshot(
  state: StateFile,
  items: ItemsFile,
  snapshotTakenAt: string,
): PublicSnapshot {
  const windowStartMs = parseIsoTime(snapshotTakenAt, "快照时间") - WINDOW_MS;
  const entries = items.items
    .filter((item) => Date.parse(item.firstSeenAt) >= windowStartMs)
    .map<PublicEntry>((item) => ({
      id: item.stableId,
      title: item.title,
      summary: item.summary,
      topic: item.topic,
      firstSeenAt: item.firstSeenAt,
      url: item.url,
    }))
    .sort(compareEntryDesc);
  const quarantined = state.quarantined
    .filter((record) => Date.parse(record.quarantinedAt) >= windowStartMs)
    .map<PublicQuarantineRecord>((record) => ({
      guid: record.guid,
      originalTitle: record.originalTitle,
      targetUrl: record.targetUrl,
      reasonCategory: record.reasonCategory,
      quarantinedAt: record.quarantinedAt,
    }))
    .sort(compareQuarantineDesc);
  const sources = state.sources.map<PublicSourceStatus>((status) => ({
    sourceId: status.sourceId,
    lastAttemptedAt: status.lastAttemptedAt,
    lastSucceededAt: status.lastSucceededAt,
    lastFailureAt: status.lastFailureAt,
    lastFailureReason: status.lastFailureReason,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    isFixture: false,
    generatedAt: snapshotTakenAt,
    entries,
    quarantined,
    sources,
  };
}

/** 拒绝未来状态时间：任何台账/隔离/来源时间晚于本次运行时间都视为损坏（停写）。 */
function rejectFutureStateTimes(state: StateFile, runAtMs: number): void {
  const stateMs = parseIsoTime(state.stateTakenAt, "state.stateTakenAt");
  if (stateMs > runAtMs) {
    throw new Error("数据损坏：state.stateTakenAt 晚于本次运行时间，拒绝写入（停写）");
  }
  for (const identity of state.identities) {
    if (parseIsoTime(identity.firstSeenAt, "identities[].firstSeenAt") > runAtMs) {
      throw new Error("数据损坏：台账存在未来的首次收录时间，拒绝写入（停写）");
    }
  }
  for (const record of state.quarantined) {
    if (parseIsoTime(record.quarantinedAt, "quarantined[].quarantinedAt") > runAtMs) {
      throw new Error("数据损坏：隔离记录存在未来时间，拒绝写入（停写）");
    }
  }
  for (const source of state.sources) {
    for (const [label, value] of [
      ["lastAttemptedAt", source.lastAttemptedAt],
      ["lastSucceededAt", source.lastSucceededAt],
      ["lastFailureAt", source.lastFailureAt],
    ] as const) {
      if (value !== null && parseIsoTime(value, `sources[].${label}`) > runAtMs) {
        throw new Error(`数据损坏：来源状态 ${label} 晚于本次运行时间，拒绝写入（停写）`);
      }
    }
  }
}

/**
 * 单次采集合并：读取可信旧状态 → 逐条身份复核与隔离 → 7 天窗口清理 →
 * 输出新的三文件契约与公开快照。旧状态损坏即抛错，绝不自动重建台账（停写）。
 */
export function ingest(previous: IngestPrevious, result: SourceFetchResult): IngestOutcome {
  const state = assertStateFile(previous.state);
  const previousItems = assertItemsFile(previous.items);
  requireSourceId(result.sourceId);

  // 成功获取时间必须不早于尝试时间。
  const attemptedMs = parseIsoTime(result.attemptedAt, "attemptedAt");
  if (result.ok) {
    if (parseIsoTime(result.succeededAt, "succeededAt") < attemptedMs) {
      throw new Error("管线输入错误：succeededAt 早于 attemptedAt");
    }
  }
  // 运行基准统一取 succeededAt（成功运行）或 attemptedAt（失败运行，无成功时间可取）：
  // 首次收录时间以 succeededAt 记账（内容规则 4），状态时间/窗口/快照基准必须不早于它，
  // 否则产出状态内部自相矛盾（firstSeenAt 晚于 stateTakenAt），可能被下一次运行误判为未来时间而停写。
  // 前置校验已保证 succeededAt >= attemptedAt，故成功运行的基准即 max(attemptedAt, succeededAt)。
  const runAt = result.ok ? result.succeededAt : result.attemptedAt;
  const runBaseMs = parseIsoTime(runAt, "runAt");

  // 旧数据可信性校验：结构（assert* 已做）+ 台账一致性 + 无未来时间（以本次运行基准比较）。任何失败都停写。
  const identityIds = new Set(state.identities.map((identity) => identity.stableId));
  for (const item of previousItems.items) {
    if (!identityIds.has(item.stableId)) {
      throw new Error(
        `数据损坏：items 中存在台账之外的身份（stableId=${item.stableId}），拒绝写入（停写）`,
      );
    }
  }
  rejectFutureStateTimes(state, runBaseMs);

  const identities: LedgerIdentity[] = [...state.identities];
  const identityIndex = new Map(identities.map((identity) => [identity.stableId, identity]));
  const itemsById = new Map<string, ItemEntry>(previousItems.items.map((item) => [item.stableId, item]));
  const newQuarantines: QuarantineRecord[] = [];

  const quarantine = (
    reason: QuarantineReason,
    raw: RawEntryInput,
    stable: string | null,
  ): void => {
    newQuarantines.push({
      sourceId: result.sourceId,
      // 空串 GUID 与缺失同义：记录为 null，保证产出的 state 能再次通过契约校验。
      guid: raw.guid === "" ? null : raw.guid,
      stableId: stable,
      originalTitle: raw.title,
      targetUrl: raw.url,
      reasonCategory: reason,
      quarantinedAt: runAt,
    });
  };

  if (result.ok) {
    for (const raw of result.entries) {
      if (raw.sourceId !== result.sourceId) {
        throw new Error("管线输入错误：条目 sourceId 与来源结果不一致");
      }
      // 缺 GUID：隔离，不兜底造身份（内容规则 2）。
      if (typeof raw.guid !== "string" || raw.guid.length === 0) {
        quarantine("缺 GUID", raw, null);
        continue;
      }
      // 目标链接仅接受 http/https（MVP-Q21 第 3 项）。
      let protocol: string;
      try {
        protocol = new URL(raw.url).protocol;
      } catch {
        quarantine("协议不合法", raw, null);
        continue;
      }
      if (protocol !== "http:" && protocol !== "https:") {
        quarantine("协议不合法", raw, null);
        continue;
      }
      // 原始时间：无效或晚于本次尝试（attemptedAt，条目被观察的时刻）即字段校验失败；
      // 故意不用运行基准比较——尝试时刻已是未来的原始时间必然不可信（语义未核实前不使用）。
      if (raw.originalTime !== null) {
        let timeValid = false;
        try {
          timeValid = parseIsoTime(raw.originalTime, "原始时间") <= attemptedMs;
        } catch {
          timeValid = false;
        }
        if (!timeValid) {
          quarantine("字段校验失败", raw, null);
          continue;
        }
      }

      let sid: string;
      try {
        sid = stableId(result.sourceId, raw.guid);
      } catch {
        // GUID 含分隔符等结构性非法值：无法建立可信身份。
        quarantine("字段校验失败", raw, null);
        continue;
      }

      const existingIdentity = identityIndex.get(sid);
      if (!existingIdentity) {
        // 新身份：首次收录时间 = 成功获取时间（校验通过并保存权威状态）。
        const identity: LedgerIdentity = {
          stableId: sid,
          sourceId: result.sourceId,
          guid: raw.guid,
          firstSeenAt: result.succeededAt,
          wdFingerprint: raw.wd ?? "",
          wdMissing: raw.wd === null,
        };
        identities.push(identity);
        identityIndex.set(sid, identity);
        itemsById.set(sid, {
          stableId: sid,
          sourceId: result.sourceId,
          guid: raw.guid,
          title: raw.title,
          summary: raw.summary ?? "",
          topic: raw.topic,
          url: raw.url,
          firstSeenAt: result.succeededAt,
          originalTime: raw.originalTime,
          wdFingerprint: raw.wd ?? "",
          wdMissing: raw.wd === null,
          contentVersion: 1,
        });
        continue;
      }

      // 已知身份：关键词精确比较（解码后相等才算一致；缺失 wd 跳过检测，MVP-Q19）。
      if (raw.wd !== null && !existingIdentity.wdMissing && raw.wd !== existingIdentity.wdFingerprint) {
        quarantine("身份冲突", raw, sid);
        continue;
      }
      // 身份此前缺 wd、本次补齐：记录指纹（不视为冲突）。
      if (existingIdentity.wdMissing && raw.wd !== null) {
        const updated: LedgerIdentity = {
          ...existingIdentity,
          wdFingerprint: raw.wd,
          wdMissing: false,
        };
        identities[identities.indexOf(existingIdentity)] = updated;
        identityIndex.set(sid, updated);
      }
      // 内容修订：仅更新可读内容，首次收录时间固定；未变化不动版本。
      const item = itemsById.get(sid);
      if (item) {
        const summary = raw.summary ?? "";
        const wdFilled = item.wdMissing && raw.wd !== null;
        if (
          item.title !== raw.title ||
          item.summary !== summary ||
          item.url !== raw.url ||
          item.topic !== raw.topic ||
          wdFilled
        ) {
          itemsById.set(sid, {
            ...item,
            title: raw.title,
            summary,
            url: raw.url,
            topic: raw.topic,
            wdFingerprint: wdFilled ? raw.wd! : item.wdFingerprint,
            wdMissing: wdFilled ? false : item.wdMissing,
            contentVersion: item.contentVersion + 1,
          });
        }
      }
    }
  }

  // 7 天窗口清理：首次收录时间在窗口内的条目保留，其余移出（台账不受影响）。
  // 窗口基准与快照基准一致（成功运行为 succeededAt，失败运行为 attemptedAt）。
  const windowStartMs = runBaseMs - WINDOW_MS;
  const visibleItems = [...itemsById.values()]
    .filter((item) => Date.parse(item.firstSeenAt) >= windowStartMs)
    .sort((a, b) => {
      const timeDiff = Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
      if (timeDiff !== 0) return timeDiff;
      return a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0;
    });

  // 来源状态：尝试/成功/失败分字段记录，失败不刷新成功获取时间。
  const previousSource = state.sources.find((source) => source.sourceId === result.sourceId);
  const sources: SourceStatus[] = [
    ...state.sources.filter((source) => source.sourceId !== result.sourceId),
    {
      sourceId: result.sourceId,
      lastAttemptedAt: result.attemptedAt,
      lastSucceededAt: result.ok
        ? result.succeededAt
        : previousSource?.lastSucceededAt ?? null,
      lastFailureAt: result.ok ? previousSource?.lastFailureAt ?? null : runAt,
      lastFailureReason: result.ok ? previousSource?.lastFailureReason ?? null : result.error,
    },
  ];

  const stateCandidate: StateFile = {
    schemaVersion: SCHEMA_VERSION,
    stateTakenAt: runAt,
    publicContentVersion: state.publicContentVersion,
    publicContentDigest: state.publicContentDigest,
    identities,
    quarantined: [...state.quarantined, ...newQuarantines],
    sources,
  };

  const newItemsFile: ItemsFile = { schemaVersion: SCHEMA_VERSION, items: visibleItems };
  const snapshot = buildPublicSnapshot(stateCandidate, newItemsFile, runAt);
  const digest = computeVisibleDigest(snapshot.entries, snapshot.quarantined);
  const publicContentVersion =
    digest === state.publicContentDigest ? state.publicContentVersion : state.publicContentVersion + 1;
  const newState: StateFile = { ...stateCandidate, publicContentVersion, publicContentDigest: digest };
  const manifest: ManifestFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: runAt,
    stateSha256: sha256hex(canonicalJson(newState)),
    itemsSha256: sha256hex(canonicalJson(newItemsFile)),
    publicContentVersion,
    publicContentDigest: digest,
  };
  return { state: newState, items: newItemsFile, manifest, snapshot };
}
