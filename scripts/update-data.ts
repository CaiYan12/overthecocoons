/**
 * data 更新编排 CLI（Ticket 07）：本地演练与工作流运行时的统一入口。
 *
 * 用法：
 *   node scripts/update-data.ts --dir <目录> [选项]
 *
 * 选项：
 *   --init               仅手动初始化（MVP-Q13：只在空存储上执行一次；不抓取、不产快照）。
 *   --fixture            离线演练：注入合成 feed（tests/data/feed-fixtures.ts），不触网。
 *   --store local|git    存储形态（默认 local）：
 *                        local = 本地演练存储（HEAD 以三文件内容摘要模拟，写前检测并发前进）；
 *                        git   = 工作流运行时形态（--expected-sha 必填）。
 *   --expected-sha <sha> data 分支当前 HEAD（工作流以 `git rev-parse HEAD` 提供）；
 *                        对全新的空 data 分支初始化，工作流传字面量 `empty`（空分支占位契约）。
 *
 * 退出码：0 成功（含来源失败但旧数据可信的降级更新）；1 明确失败
 * （缺权威状态 / 损坏停写 / 并发冲突 / 时钟单调 / 初始化拒绝 / 参数错误）。
 *
 * 边界：本 CLI 自身不执行任何 git 命令；git 提交与推送（无强制推送）由工作流
 * 的后续步骤执行，并发冲突的最终裁决在工作流 git push（非快进即拒绝）。
 */
import {
  ClockMonotonicError,
  DataCorruptionError,
  InitializationRefusedError,
  runDataInitialize,
  runDataUpdate,
  StateMissingError,
} from "../src/lib/data-update.ts";
import {
  ConflictError,
  EMPTY_DATA_BRANCH_SHA,
  GitCheckoutDataStore,
  LocalDirDataStore,
} from "../src/lib/data-store.ts";
import { BAIDU_FEED_URL, fetchSourceEntries } from "../src/lib/baidu-source.ts";
import {
  FIXTURE_FEED_HOST,
  buildFeed,
  ITEM_BASIC,
  ITEM_CONTENT_ENCODED,
  ITEM_EMPTY_DESCRIPTION,
  ITEM_EMPTY_WD,
  ITEM_HTML_DESCRIPTION,
  ITEM_LONG_DESCRIPTION,
  ITEM_MULTI_WD,
  ITEM_NO_GUID,
  ITEM_NO_WD,
} from "../tests/data/feed-fixtures.ts";
import type { SourceFetchResult } from "../src/domain/ingestion.ts";

interface CliArgs {
  dir: string;
  init: boolean;
  fixture: boolean;
  store: "local" | "git";
  expectedSha: string | null;
}

function usage(error?: string): never {
  if (error) console.error(`[update-data] 参数错误：${error}`);
  console.error(
    "用法：node scripts/update-data.ts --dir <目录> [--init] [--fixture] [--store local|git] [--expected-sha <sha>]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dir: "", init: false, fixture: false, store: "local", expectedSha: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dir":
        args.dir = argv[++i] ?? usage("--dir 需要一个目录参数");
        break;
      case "--init":
        args.init = true;
        break;
      case "--fixture":
        args.fixture = true;
        break;
      case "--store": {
        const value = argv[++i] ?? usage("--store 需要 local 或 git");
        if (value !== "local" && value !== "git") usage("--store 只接受 local 或 git");
        args.store = value;
        break;
      }
      case "--expected-sha":
        args.expectedSha = argv[++i] ?? usage("--expected-sha 需要一个 SHA 参数");
        break;
      default:
        usage(`未知参数：${arg}`);
    }
  }
  if (args.dir.length === 0) usage("缺少 --dir <目录>（本地演练目录或 data 分支检出目录）");
  if (args.store === "git" && args.expectedSha === null) {
    usage("--store git 需要 --expected-sha（工作流以 git rev-parse HEAD 提供；空 data 分支初始化传字面量 empty）");
  }
  return args;
}

/** fixture 演练的注入 fetch：任何请求都返回合成 feed 文本，不触网。 */
function makeFixtureFetch(): typeof fetch {
  const xml = buildFeed([
    ITEM_BASIC,
    ITEM_MULTI_WD,
    ITEM_NO_WD,
    ITEM_EMPTY_WD,
    ITEM_LONG_DESCRIPTION,
    ITEM_EMPTY_DESCRIPTION,
    ITEM_NO_GUID,
    ITEM_HTML_DESCRIPTION,
    ITEM_CONTENT_ENCODED,
  ]);
  return ((_url: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } }))) as typeof fetch;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = (): Date => new Date();

  // --fixture：走真实适配器（fetchSourceEntries），仅注入 fetch 实现与演练 URL，
  // 保持「获取 → URL 安全校验 → 解析归一化 → ingest」全链路一致，只是不触网。
  const fetchSource = args.fixture
    ? (): Promise<SourceFetchResult> =>
        fetchSourceEntries({
          feedUrl: `${FIXTURE_FEED_HOST}/s?wd=%E5%90%88%E6%88%90%E6%BC%94%E7%BB%83`,
          fetchImpl: makeFixtureFetch(),
          now,
        })
    : undefined;

  const store =
    args.store === "git"
      ? new GitCheckoutDataStore(
          args.dir,
          // 字面量 empty = 空 data 分支占位 HEAD（EMPTY_DATA_BRANCH_SHA 契约）。
          args.expectedSha === "empty" ? EMPTY_DATA_BRANCH_SHA : args.expectedSha!,
        )
      : new LocalDirDataStore(args.dir);

  if (args.init) {
    const result = await runDataInitialize({ store, now });
    console.log(
      `[update-data] 初始化完成（仅手动入口，MVP-Q13）：HEAD=${result.newHeadSha.slice(0, 12)}… ` +
        `stateTakenAt=${result.state.stateTakenAt}；未抓取、未产出快照。`,
    );
    return;
  }

  const result = await runDataUpdate({ store, now, fetchSource });
  const feedUrl = args.fixture ? `${FIXTURE_FEED_HOST}（合成演练源）` : BAIDU_FEED_URL;
  console.log(`[update-data] 更新完成（kind=${result.kind}）：feed=${feedUrl}`);
  console.log(
    `[update-data] HEAD ${result.previousHeadSha.slice(0, 12)}… → ${result.newHeadSha.slice(0, 12)}…；` +
      `窗口条目 ${result.items.items.length} 条；隔离记录 ${result.state.quarantined.length} 条。`,
  );
  const status = result.state.sources[0];
  if (status) {
    console.log(
      `[update-data] 来源状态：lastAttemptedAt=${status.lastAttemptedAt} lastSucceededAt=${status.lastSucceededAt ?? "—"} ` +
        `lastFailureAt=${status.lastFailureAt ?? "—"}${status.lastFailureReason ? `（${status.lastFailureReason}）` : ""}`,
    );
  }
  if (result.kind === "degraded") {
    console.log("[update-data] 来源失败但旧数据可信：已保留窗口内旧条目并记录失败状态（Q9 降级，退出码 0）。");
  }
}

try {
  await main();
} catch (error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[update-data] 失败（${name}）：${message}`);
  if (
    !(
      error instanceof StateMissingError ||
      error instanceof DataCorruptionError ||
      error instanceof ClockMonotonicError ||
      error instanceof ConflictError ||
      error instanceof InitializationRefusedError
    )
  ) {
    console.error("[update-data] 以上为未分类错误，请排查（采集失败已由管线降级处理，不会走到这里）。");
  }
  process.exit(1);
}
