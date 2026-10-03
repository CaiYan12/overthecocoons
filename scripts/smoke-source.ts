/**
 * 真实源只读烟测（Ticket 03）：`pnpm smoke:source`。
 *
 * - 只读承诺：仅向首源发起本脚本内的网络读取（经 URL 安全校验、超时与重试编排）；
 *   不写任何文件、不建目录、不改 Git 状态。ingest 在内存中运行，仅用于展示与
 *   T02 管线的集成结果，其输出不持久化。
 * - 证据边界：一次主机可访问不构成 CI 或全网可用性证明；结果与 fixture 单元测试分开报告。
 */
import { ingest, initializeState } from "../src/domain/ingestion.ts";
import { verifyManifest } from "../src/domain/contract.ts";
import { BAIDU_FEED_URL, SOURCE_ID, fetchSourceEntries } from "../src/lib/baidu-source.ts";

const attemptedAt = new Date().toISOString();
console.log(`[smoke] 只读烟测开始：${BAIDU_FEED_URL}`);
console.log(`[smoke] 开始时刻：${attemptedAt}`);

const result = await fetchSourceEntries();
if (!result.ok) {
  console.error(`[smoke] 获取失败：${result.error}`);
  console.error("[smoke] 结论：本次烟测失败（不构成对源的长期可用性判断）。");
  process.exit(1);
}

console.log(`[smoke] 成功获取：attemptedAt=${result.attemptedAt} succeededAt=${result.succeededAt}`);
console.log(`[smoke] 归一化条目数：${result.entries.length}`);

const wdMissing = result.entries.filter((entry) => entry.wd === null).length;
const summaryMissing = result.entries.filter((entry) => entry.summary === null).length;
const overLimit = result.entries.filter((entry) => entry.summary !== null && entry.summary.length > 300).length;
console.log(`[smoke] wd 缺失条目：${wdMissing}；摘要缺失条目：${summaryMissing}；摘要超限条目：${overLimit}`);

// 内存内验证与 T02 管线的集成：初始化 → ingest → 三文件契约自洽复核。
const previous = {
  state: initializeState(SOURCE_ID, result.succeededAt),
  items: { schemaVersion: 1, items: [] },
};
const outcome = ingest(previous, result);
verifyManifest(outcome.state, outcome.items, outcome.manifest);

console.log(`[smoke] 管线集成（内存内）：收录 ${outcome.items.items.length} 条；隔离 ${outcome.state.quarantined.length} 条。`);
for (const record of outcome.state.quarantined) {
  console.log(
    `[smoke] 隔离记录：原因=${record.reasonCategory} guid=${record.guid ?? "null"} 标题=${record.originalTitle} 链接=${record.targetUrl}`,
  );
}
const sample = outcome.items.items.slice(0, 3);
for (const item of sample) {
  console.log(`[smoke] 样例：firstSeenAt=${item.firstSeenAt} 标题=${item.title}`);
  console.log(`[smoke]        链接=${item.url}`);
  console.log(`[smoke]        摘要（${item.summary.length} 字）=${item.summary.slice(0, 60)}…`);
}
console.log("[smoke] 结论：本次只读烟测通过；一次主机可访问不构成 CI 或全网可用性证明。");
