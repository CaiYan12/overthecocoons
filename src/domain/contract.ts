/**
 * 三文件数据契约（MVP-Q16）与稳定身份规则（MVP-Q15）。
 *
 * 本模块是纯规则层：只定义类型、常量、校验与哈希，不做任何文件或网络 I/O。
 * data 分支三个文件在同一个 Git 提交中保存：
 * - state.json  身份台账（无限保留，MVP-Q14）+ 隔离记录 + 来源状态 + 公开内容版本
 * - items.json  当前 7 天窗口内的已接受条目内容
 * - manifest.json 前两个文件的规范序列化摘要与生成信息（损坏校验，MVP-Q13）
 *
 * 时间字段语义（MVP-Q21，分字段记录不混称）：
 * - originalTime        原始时间：来源声称的内容时间，业务语义未核实前管线不得使用（当前首源恒为 null）
 * - firstSeenAt         收录时间：首次收录时间，校验通过并保存权威状态后固定，重复抓取不刷新
 * - lastAttemptedAt     尝试时间：本次对来源发起尝试的时刻
 * - lastSucceededAt     成功获取时间：最近一次完整获取并校验通过的时刻
 * - stateTakenAt / generatedAt / 快照 generatedAt：状态时间、清单生成时间、快照时间，各自独立字段
 */
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;

/**
 * 稳定 ID 摘要输入的分隔符：NUL（\u0000）。
 *
 * 选择理由：XML 1.0 规范不允许 NUL 出现在合法文档的任何位置，因此经 XML 解析得到的
 * GUID 不可能含有 NUL；本站来源 ID 由代码内常量定义（受限标识符），同样不使用 NUL。
 * 这保证分隔符不会出现在元组任一侧、拼接无歧义（防注入）。stableId 对含 NUL 的输入
 * 直接抛错，使该性质成为结构性保证而非约定。
 */
export const ID_SEPARATOR = "\u0000";

const HEX64 = /^[0-9a-f]{64}$/;

export interface LedgerIdentity {
  /** 稳定 ID：sha256(来源 ID + ID_SEPARATOR + 原始 GUID) 的完整 64 位小写十六进制（MVP-Q15）。 */
  stableId: string;
  sourceId: string;
  /** 原始 GUID，保持字符串原样：不转数字、不改大小写。 */
  guid: string;
  /** 首次收录时间（ISO 8601）。重复抓取与内容修订均不刷新（内容规则 1/3）。 */
  firstSeenAt: string;
  /** 搜索关键词指纹（解码后的 wd 精确字符串）。缺失时为空串并以 wdMissing 标注（MVP-Q19）。 */
  wdFingerprint: string;
  wdMissing: boolean;
}

/** 隔离原因类别（MVP-Q22 示例集合）。 */
export const QUARANTINE_REASONS = ["身份冲突", "缺 GUID", "字段校验失败", "协议不合法"] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/**
 * 隔离记录（MVP-Q20/Q22）：隔离不是删除——本记录随台账无限保留；
 * 公开列出所需四字段为 originalTitle / targetUrl / reasonCategory / quarantinedAt。
 */
export interface QuarantineRecord {
  sourceId: string;
  /** 原始 GUID；缺失身份时为 null（不兜底造身份）。 */
  guid: string | null;
  /** 关联的既有稳定 ID；仅身份冲突时填写，其余为 null。 */
  stableId: string | null;
  originalTitle: string;
  targetUrl: string;
  reasonCategory: QuarantineReason;
  quarantinedAt: string;
}

export interface SourceStatus {
  sourceId: string;
  lastAttemptedAt: string;
  lastSucceededAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

export interface StateFile {
  schemaVersion: number;
  /** 状态时间：本权威状态生成时刻。 */
  stateTakenAt: string;
  /** 公开内容版本：仅随可读内容/窗口/隔离列表变化递增，排除仅尝试时间变化（MVP-Q21 第 8 项）。 */
  publicContentVersion: number;
  /** 公开内容摘要：窗口内公开条目与隔离列表的规范序列化 SHA-256。 */
  publicContentDigest: string;
  identities: LedgerIdentity[];
  quarantined: QuarantineRecord[];
  sources: SourceStatus[];
}

export interface ItemEntry {
  stableId: string;
  sourceId: string;
  guid: string;
  title: string;
  /** 纯文本摘要；来源未提供时为空串，不编造（内容规则 6）。 */
  summary: string;
  topic: string;
  url: string;
  firstSeenAt: string;
  originalTime: string | null;
  wdFingerprint: string;
  wdMissing: boolean;
  /** 条目内容版本：从 1 起，标题/摘要/链接/主题修订时递增。 */
  contentVersion: number;
}

export interface ItemsFile {
  schemaVersion: number;
  items: ItemEntry[];
}

export interface ManifestFile {
  schemaVersion: number;
  /** 清单生成时间。 */
  generatedAt: string;
  /** state.json 规范序列化的 SHA-256（损坏校验，MVP-Q13）。 */
  stateSha256: string;
  /** items.json 规范序列化的 SHA-256。 */
  itemsSha256: string;
  publicContentVersion: number;
  publicContentDigest: string;
}

/** 公开条目（与 fixtures/snapshot.json 的 entries 字段一致）。 */
export interface PublicEntry {
  id: string;
  title: string;
  summary: string;
  topic: string;
  firstSeenAt: string;
  url: string;
}

/** 公开隔离记录：Q22 四字段 + 身份依据 guid（台账已核实数据，非未校验内容）。 */
export interface PublicQuarantineRecord {
  guid: string | null;
  originalTitle: string;
  targetUrl: string;
  reasonCategory: string;
  quarantinedAt: string;
}

export interface PublicSourceStatus {
  sourceId: string;
  lastAttemptedAt: string;
  lastSucceededAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

export interface PublicSnapshot {
  schemaVersion: number;
  isFixture: boolean;
  /** 快照时间：本次公开快照的时间基准。 */
  generatedAt: string;
  entries: PublicEntry[];
  quarantined: PublicQuarantineRecord[];
  sources: PublicSourceStatus[];
}

/** 规范 JSON 序列化：键名递归排序，保证同结构同文本，摘要可复核。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** 稳定 ID：完整 SHA-256 hex（64 字符），不截断（MVP-Q15）。 */
export function stableId(sourceId: string, guid: string): string {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    throw new Error("稳定 ID 生成失败：来源 ID 不能为空");
  }
  if (typeof guid !== "string" || guid.length === 0) {
    throw new Error("稳定 ID 生成失败：GUID 不能为空");
  }
  if (sourceId.includes(ID_SEPARATOR) || guid.includes(ID_SEPARATOR)) {
    throw new Error("稳定 ID 生成失败：来源 ID 或 GUID 含分隔符（NUL），拒绝生成以防摘要歧义");
  }
  return sha256hex(sourceId + ID_SEPARATOR + guid);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`契约校验失败：${message}`);
}

function reqString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string") fail(`${path}.${key} 必须是字符串`);
  return value;
}

function reqNonEmptyString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = reqString(obj, key, path);
  if (value.length === 0) fail(`${path}.${key} 不能为空字符串`);
  return value;
}

function optString(obj: Record<string, unknown>, key: string, path: string): string | null {
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "string") fail(`${path}.${key} 必须是字符串或 null`);
  return value;
}

function reqInt(obj: Record<string, unknown>, key: string, path: string, min: number): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    fail(`${path}.${key} 必须是不小于 ${min} 的整数`);
  }
  return value;
}

/** 校验 ISO 8601 可解析的时间字符串（V8 Date.parse；越界月份等返回 NaN 视为无效。注意：V8 对越界“日”会进位而非判 NaN）。 */
export function parseIsoTime(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`无效时间（${label}）：${value}`);
  return ms;
}

function reqIsoTime(obj: Record<string, unknown>, key: string, path: string): string {
  const value = reqString(obj, key, path);
  parseIsoTime(value, `${path}.${key}`);
  return value;
}

function optIsoTime(obj: Record<string, unknown>, key: string, path: string): string | null {
  const value = optString(obj, key, path);
  if (value !== null) parseIsoTime(value, `${path}.${key}`);
  return value;
}

function reqHex64(obj: Record<string, unknown>, key: string, path: string): string {
  const value = reqString(obj, key, path);
  if (!HEX64.test(value)) fail(`${path}.${key} 必须是 64 位小写十六进制`);
  return value;
}

function optHex64(obj: Record<string, unknown>, key: string, path: string): string | null {
  const value = optString(obj, key, path);
  if (value !== null && !HEX64.test(value)) fail(`${path}.${key} 必须是 64 位小写十六进制或 null`);
  return value;
}

function reqArray(obj: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) fail(`${path}.${key} 必须是数组`);
  return value;
}

/** 校验并断言 state.json 结构；不合法即抛错（调用方必须停写，MVP-Q13）。 */
export function assertStateFile(value: unknown): StateFile {
  if (!isPlainObject(value)) fail("state.json 顶层必须是对象");
  const path = "state";
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail(`${path}.schemaVersion 必须是 ${SCHEMA_VERSION}`);
  }
  reqIsoTime(value, "stateTakenAt", path);
  reqInt(value, "publicContentVersion", path, 0);
  reqHex64(value, "publicContentDigest", path);

  const identities = reqArray(value, "identities", path);
  const identityPath = "state.identities[]";
  for (const [index, raw] of identities.entries()) {
    if (!isPlainObject(raw)) fail(`${identityPath}[${index}] 必须是对象`);
    reqHex64(raw, "stableId", identityPath);
    const sourceId = reqNonEmptyString(raw, "sourceId", identityPath);
    if (sourceId.includes(ID_SEPARATOR)) fail(`${identityPath}[${index}].sourceId 含分隔符`);
    const guid = reqNonEmptyString(raw, "guid", identityPath);
    if (guid.includes(ID_SEPARATOR)) fail(`${identityPath}[${index}].guid 含分隔符`);
    reqIsoTime(raw, "firstSeenAt", identityPath);
    reqString(raw, "wdFingerprint", identityPath);
    if (typeof raw.wdMissing !== "boolean") fail(`${identityPath}.wdMissing 必须是布尔值`);
  }

  const quarantined = reqArray(value, "quarantined", path);
  const quarantinePath = "state.quarantined[]";
  for (const [index, raw] of quarantined.entries()) {
    if (!isPlainObject(raw)) fail(`${quarantinePath}[${index}] 必须是对象`);
    reqNonEmptyString(raw, "sourceId", quarantinePath);
    const guid = optString(raw, "guid", quarantinePath);
    if (guid !== null && guid.length === 0) fail(`${quarantinePath}.guid 不能为空串（缺失用 null）`);
    optHex64(raw, "stableId", quarantinePath);
    reqString(raw, "originalTitle", quarantinePath);
    reqString(raw, "targetUrl", quarantinePath);
    const reason = reqString(raw, "reasonCategory", quarantinePath);
    if (!(QUARANTINE_REASONS as readonly string[]).includes(reason)) {
      fail(`${quarantinePath}.reasonCategory 非法值：${reason}`);
    }
    reqIsoTime(raw, "quarantinedAt", quarantinePath);
  }

  const sources = reqArray(value, "sources", path);
  const sourcePath = "state.sources[]";
  for (const [index, raw] of sources.entries()) {
    if (!isPlainObject(raw)) fail(`${sourcePath}[${index}] 必须是对象`);
    reqNonEmptyString(raw, "sourceId", sourcePath);
    reqIsoTime(raw, "lastAttemptedAt", sourcePath);
    optIsoTime(raw, "lastSucceededAt", sourcePath);
    optIsoTime(raw, "lastFailureAt", sourcePath);
    optString(raw, "lastFailureReason", sourcePath);
  }
  return value as unknown as StateFile;
}

/** 校验并断言 items.json 结构。 */
export function assertItemsFile(value: unknown): ItemsFile {
  if (!isPlainObject(value)) fail("items.json 顶层必须是对象");
  const path = "items";
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail(`${path}.schemaVersion 必须是 ${SCHEMA_VERSION}`);
  }
  const items = reqArray(value, "items", path);
  const itemPath = "items.items[]";
  for (const [index, raw] of items.entries()) {
    if (!isPlainObject(raw)) fail(`${itemPath}[${index}] 必须是对象`);
    reqHex64(raw, "stableId", itemPath);
    reqNonEmptyString(raw, "sourceId", itemPath);
    reqNonEmptyString(raw, "guid", itemPath);
    reqString(raw, "title", itemPath);
    reqString(raw, "summary", itemPath);
    reqString(raw, "topic", itemPath);
    reqString(raw, "url", itemPath);
    reqIsoTime(raw, "firstSeenAt", itemPath);
    optIsoTime(raw, "originalTime", itemPath);
    reqString(raw, "wdFingerprint", itemPath);
    if (typeof raw.wdMissing !== "boolean") fail(`${itemPath}.wdMissing 必须是布尔值`);
    reqInt(raw, "contentVersion", itemPath, 1);
  }
  return value as unknown as ItemsFile;
}

/** 校验并断言 manifest.json 结构。 */
export function assertManifestFile(value: unknown): ManifestFile {
  if (!isPlainObject(value)) fail("manifest.json 顶层必须是对象");
  const path = "manifest";
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail(`${path}.schemaVersion 必须是 ${SCHEMA_VERSION}`);
  }
  reqIsoTime(value, "generatedAt", path);
  reqHex64(value, "stateSha256", path);
  reqHex64(value, "itemsSha256", path);
  reqInt(value, "publicContentVersion", path, 0);
  reqHex64(value, "publicContentDigest", path);
  return value as unknown as ManifestFile;
}

/**
 * 损坏校验（MVP-Q13）：重算 state/items 的规范摘要并与 manifest 比对。
 * 任一不符即抛错，调用方必须停写、停发，由人工恢复。
 */
export function verifyManifest(state: StateFile, items: ItemsFile, manifest: ManifestFile): void {
  assertStateFile(state);
  assertItemsFile(items);
  assertManifestFile(manifest);
  const stateSha = sha256hex(canonicalJson(state));
  if (stateSha !== manifest.stateSha256) {
    throw new Error(`数据损坏：state.json 摘要与 manifest.json 不符（${stateSha} ≠ ${manifest.stateSha256}）`);
  }
  const itemsSha = sha256hex(canonicalJson(items));
  if (itemsSha !== manifest.itemsSha256) {
    throw new Error(`数据损坏：items.json 摘要与 manifest.json 不符（${itemsSha} ≠ ${manifest.itemsSha256}）`);
  }
  if (manifest.publicContentVersion !== state.publicContentVersion) {
    throw new Error("数据损坏：manifest.publicContentVersion 与 state 不一致");
  }
  if (manifest.publicContentDigest !== state.publicContentDigest) {
    throw new Error("数据损坏：manifest.publicContentDigest 与 state 不一致");
  }
}
