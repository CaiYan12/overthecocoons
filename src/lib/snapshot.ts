/**
 * 构建期数据注入缝（Ticket 01 约定，Ticket 02 演进）：
 * - 默认读取仓库内 `fixtures/snapshot.json`（演示数据，页面必须标注“演示数据”）。
 * - 可用环境变量 `SNAPSHOT_PATH` 注入其他快照文件（绝对路径或相对项目根的路径），
 *   供后续工单把真实管线生成的快照替换进来；本模块只在构建期（Node 环境）执行。
 * - 文件缺失、JSON 非法或缺少必需字段时直接抛错，绝不静默造数据。
 *
 * Ticket 02 演进：公开快照类型与 src/domain/contract.ts 的 PublicSnapshot 对齐，
 * 新增必需数组字段 `quarantined`（隔离条目公开列表，MVP-Q20/Q22）与
 * `sources`（公开来源状态：尝试/成功/失败时间分字段，MVP-Q21）。
 * `generatedAt` 即快照时间基准；时间字段语义详见 src/domain/contract.ts 头注。
 */
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  PublicEntry,
  PublicQuarantineRecord,
  PublicSnapshot,
  PublicSourceStatus,
} from "../domain/contract.ts";

/** 公开条目（与 domain 契约一致）。 */
export type SnapshotEntry = PublicEntry;
export type Snapshot = PublicSnapshot;

/** 仓库内置的演示快照路径（相对项目根）。 */
export const DEFAULT_SNAPSHOT_PATH = "fixtures/snapshot.json";

/** 读取快照：环境变量 `SNAPSHOT_PATH` 优先，缺省用演示快照。 */
export function loadSnapshot(): Snapshot {
  const configured = process.env.SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
  return loadSnapshotFrom(configured);
}

/** 从给定路径读取并校验快照文件。 */
export function loadSnapshotFrom(path: string): Snapshot {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf-8");
  } catch (cause) {
    throw new Error(`快照文件不可读取：${absolute}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`快照文件不是合法 JSON：${absolute}`, { cause });
  }
  return assertSnapshot(parsed, absolute);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown): value is string {
  return typeof value === "string";
}

function assertOptString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function assertSnapshot(value: unknown, source: string): Snapshot {
  if (!isPlainObject(value)) {
    throw new Error(`快照结构无效（顶层必须是对象）：${source}`);
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.schemaVersion !== "number") {
    throw new Error(`快照缺少数字字段 schemaVersion：${source}`);
  }
  if (typeof candidate.isFixture !== "boolean") {
    throw new Error(`快照缺少布尔字段 isFixture：${source}`);
  }
  if (!assertString(candidate.generatedAt)) {
    throw new Error(`快照缺少字符串字段 generatedAt：${source}`);
  }
  if (!Array.isArray(candidate.entries)) {
    throw new Error(`快照缺少数组字段 entries：${source}`);
  }
  if (!Array.isArray(candidate.quarantined)) {
    throw new Error(`快照缺少数组字段 quarantined：${source}`);
  }
  if (!Array.isArray(candidate.sources)) {
    throw new Error(`快照缺少数组字段 sources：${source}`);
  }
  const requiredFields: Array<keyof SnapshotEntry> = [
    "id",
    "title",
    "summary",
    "topic",
    "firstSeenAt",
    "url",
  ];
  for (const [index, entry] of candidate.entries.entries()) {
    if (!isPlainObject(entry)) {
      throw new Error(`entries[${index}] 不是对象：${source}`);
    }
    for (const field of requiredFields) {
      if (!assertString(entry[field])) {
        throw new Error(`entries[${index}] 缺少字符串字段 ${field}：${source}`);
      }
    }
  }
  const quarantineFields: Array<keyof PublicQuarantineRecord> = [
    "originalTitle",
    "targetUrl",
    "reasonCategory",
    "quarantinedAt",
  ];
  for (const [index, record] of candidate.quarantined.entries()) {
    if (!isPlainObject(record)) {
      throw new Error(`quarantined[${index}] 不是对象：${source}`);
    }
    if (!assertOptString(record.guid)) {
      throw new Error(`quarantined[${index}] 的 guid 必须是字符串或 null：${source}`);
    }
    for (const field of quarantineFields) {
      if (!assertString(record[field])) {
        throw new Error(`quarantined[${index}] 缺少字符串字段 ${field}：${source}`);
      }
    }
  }
  const sourceFields: Array<keyof PublicSourceStatus> = [
    "sourceId",
    "lastAttemptedAt",
  ];
  const optSourceFields: Array<keyof PublicSourceStatus> = [
    "lastSucceededAt",
    "lastFailureAt",
    "lastFailureReason",
  ];
  for (const [index, status] of candidate.sources.entries()) {
    if (!isPlainObject(status)) {
      throw new Error(`sources[${index}] 不是对象：${source}`);
    }
    for (const field of sourceFields) {
      if (!assertString(status[field])) {
        throw new Error(`sources[${index}] 缺少字符串字段 ${field}：${source}`);
      }
    }
    for (const field of optSourceFields) {
      if (!assertOptString(status[field])) {
        throw new Error(`sources[${index}] 的 ${field} 必须是字符串或 null：${source}`);
      }
    }
  }
  return candidate as unknown as PublicSnapshot;
}
