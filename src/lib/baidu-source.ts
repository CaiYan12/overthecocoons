/**
 * 首源适配器（Ticket 03）：百度热点线索 feed（rss.aishort.top 的 type=baidu 端点）。
 *
 * 职责：编排「获取 → 解析归一化」的尝试循环，产出可直接注入 T02 管线
 * （src/domain/ingestion.ts 的 ingest）的 SourceFetchResult；不做任何文件写入。
 *
 * 工程方案（MVP-Q21-1）：单次运行内最多 2 次尝试、短退避；仍失败按 Q9 降级
 * （由调用方以 ok:false 结果驱动——T02 管线保留旧快照，不伪造条目）。
 * 尝试单元 = 一次 fetchTextOnce + 一次 parseFeed：HTTP 失败、超时、UTF-8 编码失败、
 * XML 解析失败都计入尝试并重试（核查记录中出现过传输 EOF 导致的截断 XML，
 * 重试正是针对该失败形态）。
 *
 * 冻结项（stableId 生成后不可变更，MVP-Q15）：
 * - SOURCE_ID = "baidu-aishort"：来源准入单位是该 feed 端点（聚合服务 aishort.top 的
 *   baidu 输出），而非上游品牌「百度」；命名以 feed 为锚，避免后续接入其他百度相关
 *   feed 时身份混淆。一旦有数据以此 ID 收录，永不更改。
 * - BAIDU_FEED_URL = 用户指定的首源地址。
 *
 * 时间：attemptedAt 为本次尝试开始时刻，succeededAt 为成功解析完成时刻；两者均取自
 * now()（可注入，缺省系统时钟），供管线以 succeededAt 记账（T02 修复环 R1 的基准规则）。
 */
import type { RawEntryInput } from "../domain/ingestion.ts";
import type { SourceFetchResult } from "../domain/ingestion.ts";
import { parseFeed } from "./feed-parse.ts";
import { fetchTextOnce, type FetchTextOptions } from "./source-fetch.ts";

/** 来源 ID（冻结：参与 stableId，生成后不可变更）。 */
export const SOURCE_ID = "baidu-aishort";

/** 用户指定的首源 feed 地址。 */
export const BAIDU_FEED_URL = "https://rss.aishort.top/?type=baidu";

/** 单次运行内对源的最大尝试次数（Q21-1）。 */
export const MAX_ATTEMPTS = 2;

/** 重试间的短退避毫秒数（Q21-1；工程默认值，无规格出处）。 */
export const BACKOFF_MS = 1000;

/**
 * 来源默认主题（mvp-spec.md：首源主题「新闻、社会」，两者结果相同，其他主题暂空，
 * 不按标题猜细分类）。feed 无分类字段，统一取「新闻」；「社会」选择时与「新闻」
 * 等价属渲染层（T04+）的别名语义，不在归一化层展开。
 */
export const SOURCE_DEFAULT_TOPIC = "新闻";

export interface FetchSourceOptions extends FetchTextOptions {
  /** 覆盖默认 feed 地址（测试与未来配置用；生产默认用冻结常量）。 */
  feedUrl?: string;
  now?: () => Date;
  maxAttempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 获取并归一化首源条目；永不抛错，失败以 ok:false 结果返回。 */
export async function fetchSourceEntries(options: FetchSourceOptions = {}): Promise<SourceFetchResult> {
  const feedUrl = options.feedUrl ?? BAIDU_FEED_URL;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const attemptedAt = now().toISOString();

  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const xml = await fetchTextOnce(feedUrl, options);
      const entries: RawEntryInput[] = await parseFeed(xml, {
        sourceId: SOURCE_ID,
        topic: SOURCE_DEFAULT_TOPIC,
      });
      return {
        ok: true,
        sourceId: SOURCE_ID,
        attemptedAt,
        succeededAt: now().toISOString(),
        entries,
      };
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      if (attempt < maxAttempts) {
        await sleep(backoffMs);
      }
    }
  }
  return { ok: false, sourceId: SOURCE_ID, attemptedAt, error: lastError };
}
