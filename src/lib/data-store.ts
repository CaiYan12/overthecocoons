/**
 * data 分支存储层（Ticket 07）：三文件契约的读写接口与两种实现。
 *
 * 接口以参数化"当前 HEAD SHA"呈现并发控制（MVP-Q17）：
 * - read() 返回三文件原始文本与读取时的 HEAD SHA；
 * - write(files, expectedHeadSha) 以"读取时的 SHA 未变"为写入前提；
 *   前提不符即抛 ConflictError——该次运行失败，等待下次定时/手动重试；
 *   绝不 force、绝不自动合并、绝不"最后写入者覆盖"。
 *
 * 两种实现：
 * - LocalDirDataStore：本地演练/测试用模拟 data 分支（目录下三个 JSON 文件；
 *   HEAD 以三文件文本的摘要模拟，写前重读检测并发前进）。真实 Git 操作留给工作流运行时。
 * - GitCheckoutDataStore：工作流运行时形态——HEAD SHA 由调用方以 `git rev-parse HEAD`
 *   提供并在构造时传入；本实现只做检出目录内的文件读写与运行中漂移检测，
 *   跨进程冲突的最终裁决由工作流的 git push（非快进即拒绝）兜底。
 *
 * HEAD 摘要约定：sha256(JSON.stringify([stateText, itemsText, manifestText]))。
 * JSON.stringify 的数组形式保证 null（文件缺失）与空串可区分；空 data 分支
 * （三文件全缺）的 HEAD 为 EMPTY_DATA_BRANCH_SHA，初始化写入以此为前提，
 * 防止与并发初始化竞争。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256hex, type ItemsFile, type ManifestFile, type StateFile } from "../domain/contract.ts";

/** 并发冲突：data 分支在读取后已前进（SHA 不符）。该次运行失败，等待重试（MVP-Q17）。 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** data 分支三文件（同一 Git 提交保存，MVP-Q16）。 */
export interface StoredFiles {
  state: StateFile;
  items: ItemsFile;
  manifest: ManifestFile;
}

export interface DataBranchRead {
  /** 读取时的 HEAD SHA（模拟实现为内容摘要；git 形态为调用方提供的真实提交 SHA）。 */
  headSha: string;
  stateText: string | null;
  itemsText: string | null;
  manifestText: string | null;
}

export interface WriteResult {
  /** 写入后的新 HEAD（模拟/git 形态均为写入内容的摘要；真实提交 SHA 由工作流 git 层产生）。 */
  newHeadSha: string;
}

export interface DataStore {
  /** 三文件全缺返回 null（空 data 分支）；部分缺失时返回已存在的文本（缺失为 null）。 */
  read(): Promise<DataBranchRead | null>;
  write(files: StoredFiles, expectedHeadSha: string): Promise<WriteResult>;
}

export const STATE_FILENAME = "state.json";
export const ITEMS_FILENAME = "items.json";
export const MANIFEST_FILENAME = "manifest.json";

/** 空 data 分支的 HEAD（sha256(JSON.stringify([null, null, null]))）。 */
export const EMPTY_DATA_BRANCH_SHA = sha256hex(JSON.stringify([null, null, null]));

/** data 分支 HEAD 摘要：对三文件原始文本计算，任一文件变化即变化。 */
export function dataBranchHeadDigest(
  stateText: string | null,
  itemsText: string | null,
  manifestText: string | null,
): string {
  return sha256hex(JSON.stringify([stateText, itemsText, manifestText]));
}

interface RawTexts {
  stateText: string | null;
  itemsText: string | null;
  manifestText: string | null;
}

function readTextOrNull(dir: string, filename: string): string | null {
  try {
    return readFileSync(join(dir, filename), "utf-8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`data 分支文件不可读取：${join(dir, filename)}`, { cause });
  }
}

function readRawTexts(dir: string): RawTexts | null {
  const texts: RawTexts = {
    stateText: readTextOrNull(dir, STATE_FILENAME),
    itemsText: readTextOrNull(dir, ITEMS_FILENAME),
    manifestText: readTextOrNull(dir, MANIFEST_FILENAME),
  };
  const allAbsent = texts.stateText === null && texts.itemsText === null && texts.manifestText === null;
  return allAbsent ? null : texts;
}

function digestOf(texts: RawTexts): string {
  return dataBranchHeadDigest(texts.stateText, texts.itemsText, texts.manifestText);
}

function serializeFiles(files: StoredFiles): RawTexts {
  return {
    stateText: JSON.stringify(files.state, null, 2) + "\n",
    itemsText: JSON.stringify(files.items, null, 2) + "\n",
    manifestText: JSON.stringify(files.manifest, null, 2) + "\n",
  };
}

function writeRawTexts(dir: string, texts: RawTexts): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STATE_FILENAME), texts.stateText as string, "utf-8");
  writeFileSync(join(dir, ITEMS_FILENAME), texts.itemsText as string, "utf-8");
  writeFileSync(join(dir, MANIFEST_FILENAME), texts.manifestText as string, "utf-8");
}

function shortSha(sha: string): string {
  return sha.length > 12 ? sha.slice(0, 12) + "…" : sha;
}

/** 本地演练/测试用模拟 data 分支：HEAD 以三文件内容摘要模拟，写前重读检测并发前进。 */
export class LocalDirDataStore implements DataStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async read(): Promise<DataBranchRead | null> {
    const texts = readRawTexts(this.#dir);
    if (texts === null) return null;
    return { headSha: digestOf(texts), ...texts };
  }

  async write(files: StoredFiles, expectedHeadSha: string): Promise<WriteResult> {
    // 写前重读：分支相对读取时已前进（内容摘要变化）即拒绝——不覆盖、不合并（MVP-Q17）。
    const current = readRawTexts(this.#dir);
    const currentHead = current === null ? EMPTY_DATA_BRANCH_SHA : digestOf(current);
    if (currentHead !== expectedHeadSha) {
      throw new ConflictError(
        `并发冲突：data 分支已前进（写入前提 ${shortSha(expectedHeadSha)}，当前 ${shortSha(currentHead)}）。` +
          "本次运行失败，等待下次定时/手动重试；不自动合并、不强制推送（MVP-Q17）。",
      );
    }
    const newTexts = serializeFiles(files);
    writeRawTexts(this.#dir, newTexts);
    return { newHeadSha: digestOf(newTexts) };
  }
}

/**
 * 工作流运行时形态：对 data 分支检出目录读写。HEAD SHA 由调用方构造时提供
 * （工作流以 `git rev-parse HEAD` 读取真实提交）。本实现不做任何 git 命令——
 * 跨进程并发冲突由工作流的 git push（非快进即拒绝，无 force）最终兜底；
 * 本实现额外提供运行中漂移检测：读取后检出目录内容被外部改动即拒绝写入。
 * 一次成功写入后本实例的读取前提即失效；重试须重新构造并重新读取。
 */
export class GitCheckoutDataStore implements DataStore {
  readonly #dir: string;
  readonly #headSha: string;
  #readDigest: string | null = null;

  constructor(dir: string, headSha: string) {
    if (typeof headSha !== "string" || headSha.length === 0) {
      throw new Error("GitCheckoutDataStore 需要 data 分支当前 HEAD SHA（git rev-parse HEAD 的输出）");
    }
    this.#dir = dir;
    this.#headSha = headSha;
  }

  async read(): Promise<DataBranchRead | null> {
    const texts = readRawTexts(this.#dir);
    this.#readDigest = texts === null ? EMPTY_DATA_BRANCH_SHA : digestOf(texts);
    if (texts === null) return null;
    return { headSha: this.#headSha, ...texts };
  }

  async write(files: StoredFiles, expectedHeadSha: string): Promise<WriteResult> {
    if (expectedHeadSha !== this.#headSha) {
      throw new ConflictError(
        `并发冲突：写入前提（${shortSha(expectedHeadSha)}）与读取时的 data 分支 HEAD（${shortSha(this.#headSha)}）不符。` +
          "本次运行失败，等待下次重试（MVP-Q17）。",
      );
    }
    if (this.#readDigest === null) {
      throw new Error("写入前必须先 read()（编排顺序错误）");
    }
    const current = readRawTexts(this.#dir);
    const currentDigest = current === null ? EMPTY_DATA_BRANCH_SHA : digestOf(current);
    if (currentDigest !== this.#readDigest) {
      throw new ConflictError(
        "并发冲突：data 分支检出目录在运行中被外部改动（读取时与写入前内容摘要不一致）。" +
          "本次运行失败，等待下次重试（MVP-Q17）。",
      );
    }
    const newTexts = serializeFiles(files);
    writeRawTexts(this.#dir, newTexts);
    return { newHeadSha: digestOf(newTexts) };
  }
}
