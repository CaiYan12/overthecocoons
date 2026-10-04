/**
 * data 更新编排（Ticket 07）：把 T03 采集管线编排为 data 分支的更新工作流。
 *
 * 运行流程（runDataUpdate，定时/手动共用）：
 * 1. 读取 data 分支三文件与当前 HEAD SHA（参数化"当前 SHA"，MVP-Q17）。
 * 2. 解析 + verifyManifest 摘要校验——【carry 裁定】这是停写链完整性的前置条件，
 *    必须先于抓取与 ingest：损坏即终止（不抓取、不写入、不发布）。
 * 3. 运行时钟单调闸门——【carry 裁定】失败运行的 attemptedAt 早于上次 succeededAt
 *    会触发未来时间停写：编排只用运行时刻的实际时钟（可注入，不信任 feed 时间），
 *    实际时钟早于可信状态时间即在此之前终止。
 * 4. 抓取首源（复用 T03 获取层：http/https + host 安全校验 + 超时重试编排；
 *    永不抛错，失败以 ok:false 结果返回）。
 * 5. ingest 合并（T02 管线：身份复核、隔离、7 天窗口、失败降级）。
 * 6. 写入前自检：产物三文件必须通过同一摘要校验才允许落盘。
 * 7. 以读取时的 HEAD SHA 为前提写回；分支已前进即 ConflictError——失败不 force、
 *    不自动合并，等待下次重试（MVP-Q17）。真实 git 提交/推送由工作流运行时执行。
 *
 * 初始化（runDataInitialize，MVP-Q13：仅独立手动入口）：
 * - 只允许在空 data 分支上执行一次，建立空权威台账（无抓取、无快照产物）；
 * - 已存在任何数据（含损坏残留）即拒绝——绝不自动清空台账重采；
 * - 定时/手动更新发现无权威状态时显式拒绝（StateMissingError），
 *   绝不伪造首日数据、绝不自动初始化。
 */
import {
  SCHEMA_VERSION,
  canonicalJson,
  parseIsoTime,
  sha256hex,
  verifyManifest,
  type ItemsFile,
  type ManifestFile,
  type StateFile,
} from "../domain/contract.ts";
import {
  ingest,
  initializeState,
  type IngestOutcome,
  type SourceFetchResult,
} from "../domain/ingestion.ts";
import { fetchSourceEntries, SOURCE_ID } from "./baidu-source.ts";
import { EMPTY_DATA_BRANCH_SHA, type DataStore, type StoredFiles } from "./data-store.ts";

/** 无权威状态：data 分支为空。更新路径显式拒绝，不自动初始化（MVP-Q13）。 */
export class StateMissingError extends Error {
  constructor() {
    super(
      "权威状态缺失：data 分支没有可信初始数据。定时/手动更新不自动初始化（MVP-Q13），" +
        "请先执行仅手动的初始化入口（init-data 工作流或本地 CLI --init）。",
    );
    this.name = "StateMissingError";
  }
}

/** 数据损坏：解析失败 / 结构非法 / 摘要不符 / 三文件不完整。停写，人工恢复（MVP-Q13/Q18）。 */
export class DataCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataCorruptionError";
  }
}

/** 运行时钟早于可信状态时间（时钟回拨）。停写，等时钟恢复后重试。 */
export class ClockMonotonicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClockMonotonicError";
  }
}

/** 初始化拒绝：data 分支已存在数据（含损坏残留）。恢复走人工，不自动清空（MVP-Q13）。 */
export class InitializationRefusedError extends Error {
  constructor() {
    super(
      "初始化拒绝：data 分支已存在权威状态或残留文件。初始化只在空存储上执行一次；" +
        "损坏恢复请按 MVP-Q13/Q18 由人工从 data 分支 Git 历史核对后处理，绝不自动清空台账重采。",
    );
    this.name = "InitializationRefusedError";
  }
}

export interface DataUpdateDeps {
  store: DataStore;
  /**
   * 运行时钟：编排只用运行时刻的实际时钟（可注入便于测试），绝不采用 feed 提供的时间。
   */
  now?: () => Date;
  /**
   * 来源获取缝（测试与演练注入）；缺省为真实首源适配器 fetchSourceEntries——
   * 复用 T03 获取层（http/https + host 校验、超时、2 次尝试短退避），永不抛错。
   */
  fetchSource?: () => Promise<SourceFetchResult>;
}

export interface DataUpdateResult {
  /** updated = 来源获取成功；degraded = 来源失败但旧数据可信（保留旧条目，Q9 降级）。 */
  kind: "updated" | "degraded";
  previousHeadSha: string;
  newHeadSha: string;
  state: StateFile;
  items: ItemsFile;
  manifest: ManifestFile;
  /** 内存公开快照产物（不写入 data 分支；公开快照由构建侧从权威状态生成）。 */
  snapshot: IngestOutcome["snapshot"];
}

export interface DataInitDeps {
  store: DataStore;
  now?: () => Date;
}

export interface DataInitResult {
  newHeadSha: string;
  state: StateFile;
  items: ItemsFile;
  manifest: ManifestFile;
  // 刻意不含 snapshot：初始化只建立空权威台账，不产生任何快照。
}

function parseJsonFile(text: string, filename: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new DataCorruptionError(`数据损坏：${filename} 不是合法 JSON，拒绝写入（停写，MVP-Q13）：${(cause as Error).message}`);
  }
}

/**
 * 运行时钟单调闸门（carry 裁定）：实际时钟必须不早于可信状态中的状态侧时间
 * （stateTakenAt 与各来源的尝试/成功/失败时间）。台账/隔离的条目级时间由
 * ingest 的未来时间拒绝以运行基准兜底（纵深防御）。
 */
function assertRunClockMonotonic(state: StateFile, runNow: Date): void {
  const nowMs = runNow.getTime();
  const checks: Array<{ label: string; value: string | null }> = [
    { label: "state.stateTakenAt", value: state.stateTakenAt },
  ];
  for (const source of state.sources) {
    checks.push(
      { label: `sources[${source.sourceId}].lastAttemptedAt`, value: source.lastAttemptedAt },
      { label: `sources[${source.sourceId}].lastSucceededAt`, value: source.lastSucceededAt },
      { label: `sources[${source.sourceId}].lastFailureAt`, value: source.lastFailureAt },
    );
  }
  for (const { label, value } of checks) {
    if (value === null) continue;
    let ms: number;
    try {
      ms = parseIsoTime(value, label);
    } catch (cause) {
      throw new DataCorruptionError(
        `数据损坏：可信状态中的时间字段无效（${label}=${value}），拒绝写入（停写）：${(cause as Error).message}`,
      );
    }
    if (ms > nowMs) {
      throw new ClockMonotonicError(
        `运行时钟单调性检查失败：${label}=${value} 晚于本次运行时刻 ${runNow.toISOString()}。` +
          "为保证运行时钟单调（失败运行的 attemptedAt 不得早于上次 succeededAt），本次运行终止（停写）。" +
          "请检查系统时钟或运行环境后重试。",
      );
    }
  }
}

/**
 * 单次 data 更新：读取 → verifyManifest（carry 前置）→ 时钟闸门 → 抓取 → ingest →
 * 自检 → 参数化 SHA 写回。任何失败都以类型化错误终止，绝不产生半写状态。
 */
export async function runDataUpdate(deps: DataUpdateDeps): Promise<DataUpdateResult> {
  const now = deps.now ?? (() => new Date());
  const fetchSource = deps.fetchSource ?? (() => fetchSourceEntries({ now }));

  // 1. 读取当前权威状态与 HEAD SHA。
  const read = await deps.store.read();
  if (read === null) {
    throw new StateMissingError();
  }
  if (read.stateText === null || read.itemsText === null || read.manifestText === null) {
    throw new DataCorruptionError(
      "数据损坏：data 三文件不完整（state.json / items.json / manifest.json 缺一不可），" +
        "拒绝写入（停写）。恢复请按 MVP-Q13/Q18 由人工从 data 分支 Git 历史核对后处理。",
    );
  }

  // 2. 解析 + 摘要校验（carry 裁定：先于抓取与 ingest）。
  const state = parseJsonFile(read.stateText, "state.json") as StateFile;
  const items = parseJsonFile(read.itemsText, "items.json") as ItemsFile;
  const manifest = parseJsonFile(read.manifestText, "manifest.json") as ManifestFile;
  try {
    verifyManifest(state, items, manifest);
  } catch (cause) {
    throw new DataCorruptionError(
      `数据损坏：三文件摘要校验未通过，拒绝写入（停写，MVP-Q13）：${(cause as Error).message}`,
    );
  }

  // 3. 运行时钟单调闸门（carry 裁定：先于抓取）。
  assertRunClockMonotonic(state, now());

  // 4. 抓取（永不抛错；失败以 ok:false 返回，按 Q9 降级）。
  const result = await fetchSource();

  // 5. ingest 合并（T02 管线：身份/隔离/窗口/来源状态；内部含未来时间停写兜底）。
  const outcome = ingest({ state, items }, result);

  // 6. 写入前自检：产物三文件自洽才允许落盘。
  verifyManifest(outcome.state, outcome.items, outcome.manifest);

  // 7. 以读取时的 HEAD SHA 为前提写回；分支已前进即 ConflictError（不 force、不合并）。
  const written: StoredFiles = { state: outcome.state, items: outcome.items, manifest: outcome.manifest };
  const { newHeadSha } = await deps.store.write(written, read.headSha);

  return {
    kind: result.ok ? "updated" : "degraded",
    previousHeadSha: read.headSha,
    newHeadSha,
    state: outcome.state,
    items: outcome.items,
    manifest: outcome.manifest,
    snapshot: outcome.snapshot,
  };
}

/**
 * 首次 data 初始化（MVP-Q13：仅独立手动入口）。只在空 data 分支上执行一次，
 * 建立空权威台账（无抓取、无快照产物）；已存在任何数据即拒绝。
 * 首日真实数据由初始化之后的首次更新采集——绝不伪造首日数据。
 */
export async function runDataInitialize(deps: DataInitDeps): Promise<DataInitResult> {
  const now = deps.now ?? (() => new Date());
  const existing = await deps.store.read();
  if (existing !== null) {
    // 无论内容是否损坏都不自动清空（恢复是人工动作，MVP-Q13/Q18）。
    throw new InitializationRefusedError();
  }
  const nowIso = now().toISOString();
  const state = initializeState(SOURCE_ID, nowIso);
  const items: ItemsFile = { schemaVersion: SCHEMA_VERSION, items: [] };
  const manifest: ManifestFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso,
    stateSha256: sha256hex(canonicalJson(state)),
    itemsSha256: sha256hex(canonicalJson(items)),
    publicContentVersion: state.publicContentVersion,
    publicContentDigest: state.publicContentDigest,
  };
  // 写入前自检：初始三文件必须通过同一摘要校验（与更新链对称）。
  verifyManifest(state, items, manifest);
  const { newHeadSha } = await deps.store.write({ state, items, manifest }, EMPTY_DATA_BRANCH_SHA);
  return { newHeadSha, state, items, manifest };
}
