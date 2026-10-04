/**
 * main 只读构建快照生成 CLI（Ticket 08）：data 分支三文件 → 构建期公开快照。
 *
 * 用法：
 *   node scripts/build-snapshot.ts --data-dir <目录> --out <文件>
 *
 * 职责（架构 §main 推送：「读取已保存状态 → 生成快照 → 检查/构建 → 发布，不抓源、
 * 不写首次收录」）：
 *   1. 读取工作流检出的 data 分支三文件（state.json / items.json / manifest.json）；
 *   2. JSON 解析 + verifyManifest 摘要校验——损坏即非零退出，绝不带病构建（MVP-Q13）；
 *   3. buildPublicSnapshot(state, items, state.stateTakenAt) 生成 7 天窗口公开快照。
 *      时间基准取 state.stateTakenAt（权威状态生成时刻）而非构建墙钟：同一 data 提交
 *      在任何时间构建产出同一快照（构建确定性，MVP-Q21「不能读取变化中的分支文件
 *      拼成混合快照」由工作流对固定 ref 的 checkout 保证）；
 *   4. 写出快照 JSON（SNAPSHOT_PATH 注入 astro build）。
 *
 * 边界：本 CLI 只读 data 目录、只写 --out 一个文件；不执行任何抓取（source-fetch /
 * rss-parser 不进入 import 图）、不执行任何 git 命令、不写 data 分支任何文件。
 *
 * 退出码：0 成功；1 明确失败（三文件缺失 / JSON 非法 / 摘要校验失败 / 字段无效 / 参数错误）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ItemsFile,
  type ManifestFile,
  type StateFile,
  verifyManifest,
} from "../src/domain/contract.ts";
import { buildPublicSnapshot } from "../src/domain/ingestion.ts";
import {
  ITEMS_FILENAME,
  MANIFEST_FILENAME,
  STATE_FILENAME,
} from "../src/lib/data-store.ts";

interface CliArgs {
  dataDir: string;
  out: string;
}

function usage(error?: string): never {
  if (error) console.error(`[build-snapshot] 参数错误：${error}`);
  console.error("用法：node scripts/build-snapshot.ts --data-dir <目录> --out <文件>");
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dataDir: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--data-dir":
        args.dataDir = argv[++i] ?? usage("--data-dir 需要一个目录参数");
        break;
      case "--out":
        args.out = argv[++i] ?? usage("--out 需要一个文件参数");
        break;
      default:
        usage(`未知参数：${argv[i]}`);
    }
  }
  if (args.dataDir.length === 0) usage("缺少 --data-dir <目录>（data 分支检出目录）");
  if (args.out.length === 0) usage("缺少 --out <文件>（快照输出路径）");
  return args;
}

function readJsonFile(dir: string, filename: string): unknown {
  const path = `${dir}/${filename}`;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (cause) {
    console.error(`[build-snapshot] data 分支三文件不可读取（拒绝构建，不伪造快照）：${path}`);
    console.error(`  原因：${(cause as Error).message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    console.error(`[build-snapshot] 文件不是合法 JSON（损坏即拒绝构建，MVP-Q13）：${path}`);
    console.error(`  原因：${(cause as Error).message}`);
    process.exit(1);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const state = readJsonFile(args.dataDir, STATE_FILENAME) as StateFile;
  const items = readJsonFile(args.dataDir, ITEMS_FILENAME) as ItemsFile;
  const manifest = readJsonFile(args.dataDir, MANIFEST_FILENAME) as ManifestFile;

  // 摘要校验前置：三文件不自洽即拒绝构建（与更新链同一校验，MVP-Q13 停写语义）。
  try {
    verifyManifest(state, items, manifest);
  } catch (cause) {
    console.error(`[build-snapshot] 数据损坏：三文件摘要校验未通过，拒绝构建（MVP-Q13）：`);
    console.error(`  ${(cause as Error).message}`);
    process.exit(1);
  }

  const snapshot = buildPublicSnapshot(state, items, state.stateTakenAt);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");

  console.log(
    `[build-snapshot] 快照已生成：entries=${snapshot.entries.length} quarantined=${snapshot.quarantined.length} ` +
      `sources=${snapshot.sources.length} generatedAt=${snapshot.generatedAt} ` +
      `(时间基准=state.stateTakenAt，7 天窗口；data 目录 ${args.dataDir} 只读)`,
  );
}

main();
