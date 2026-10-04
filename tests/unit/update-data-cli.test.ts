import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyManifest } from "../../src/domain/contract.ts";

/**
 * Ticket 07 本地演练 CLI（scripts/update-data.ts）端到端检查：
 * - 手动初始化 → fixture 离线更新 → 三文件落盘自洽；
 * - 无权威状态时更新退出非零并给出明确错误（损坏/冲突即失败退出由模块级测试覆盖，
 *   此处验证 CLI 边界把失败映射为非零退出码）。
 * --fixture 注入合成 feed（tests/data/feed-fixtures.ts），不触网。
 */

const ROOT = join(import.meta.dirname, "..", "..");
const CLI = join(ROOT, "scripts", "update-data.ts");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "otc-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, "--dir", dir, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("update-data CLI（本地演练入口）", () => {
  it("--init 手动初始化后 --fixture 离线更新：三文件落盘且自洽", () => {
    const init = runCli(["--init"]);
    assert.equal(init.status, 0, `初始化应成功：${init.stderr}`);
    assert.ok(existsSync(join(dir, "state.json")));
    assert.ok(existsSync(join(dir, "items.json")));
    assert.ok(existsSync(join(dir, "manifest.json")));

    const update = runCli(["--fixture"]);
    assert.equal(update.status, 0, `fixture 更新应成功：${update.stderr}`);
    const state = JSON.parse(readAt(dir, "state.json"));
    const items = JSON.parse(readAt(dir, "items.json"));
    const manifest = JSON.parse(readAt(dir, "manifest.json"));
    verifyManifest(state, items, manifest);
    assert.ok(items.items.length > 0, "fixture feed 应产出条目");
    assert.equal(items.items[0]!.topic, "新闻", "首源默认主题冻结为「新闻」");
  });

  it("无权威状态时更新：退出码非零并输出明确错误", () => {
    const update = runCli(["--fixture"]);
    assert.notEqual(update.status, 0, "缺权威状态必须失败退出");
    assert.match(update.stderr, /权威状态缺失/);
    assert.equal(existsSync(join(dir, "state.json")), false, "不伪造首日数据");
  });

  it("已有权威状态时 --init 被拒绝：退出码非零", () => {
    assert.equal(runCli(["--init"]).status, 0);
    const second = runCli(["--init"]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /初始化拒绝|已存在/);
  });

  it("--store git 缺少 --expected-sha：参数校验失败退出", () => {
    const result = runCli(["--init", "--store", "git"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--expected-sha/);
  });
});

function readAt(base: string, file: string): string {
  return readFileSync(join(base, file), "utf-8");
}
