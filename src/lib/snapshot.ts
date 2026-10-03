/**
 * 构建期数据注入缝（Ticket 01 约定）：
 * - 默认读取仓库内 `fixtures/snapshot.json`（演示数据，页面必须标注“演示数据”）。
 * - 可用环境变量 `SNAPSHOT_PATH` 注入其他快照文件（绝对路径或相对项目根的路径），
 *   供后续工单把真实管线生成的快照替换进来；本模块只在构建期（Node 环境）执行。
 * - 文件缺失、JSON 非法或缺少必需字段时直接抛错，绝不静默造数据。
 */
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface SnapshotEntry {
  id: string;
  title: string;
  summary: string;
  topic: string;
  firstSeenAt: string;
  url: string;
}

export interface Snapshot {
  schemaVersion: number;
  isFixture: boolean;
  generatedAt: string;
  entries: SnapshotEntry[];
}

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

function assertString(value: unknown): value is string {
  return typeof value === "string";
}

function assertSnapshot(value: unknown, source: string): Snapshot {
  if (typeof value !== "object" || value === null) {
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
  const requiredFields: Array<keyof SnapshotEntry> = [
    "id",
    "title",
    "summary",
    "topic",
    "firstSeenAt",
    "url",
  ];
  for (const [index, entry] of candidate.entries.entries()) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`entries[${index}] 不是对象：${source}`);
    }
    const record = entry as Record<string, unknown>;
    for (const field of requiredFields) {
      if (!assertString(record[field])) {
        throw new Error(`entries[${index}] 缺少字符串字段 ${field}：${source}`);
      }
    }
  }
  return candidate as unknown as Snapshot;
}
