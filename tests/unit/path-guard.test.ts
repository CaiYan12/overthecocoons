/**
 * 构建期路径校验用例（安全加固，2026-10-20）。
 *
 * 目标：把 CLI `--out` 与环境变量 `SNAPSHOT_PATH` 限制在项目根内，同时**不破坏**既有用法
 * （CI 的 `.snapshot/snapshot.json` 相对路径、文档允许的根内绝对路径）。
 *
 * 判定口径（与实现一致）：`path.resolve` 后 `path.relative(root, target)` 不得以 `..` 开头，
 * 也不得是绝对路径——用相对关系而非字符串前缀，避免 `/repo-evil` 冒充 `/repo` 的子路径。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve, sep } from "node:path";
import { PathOutsideRootError, resolveWithinRoot, resolveWithinRoots } from "../../src/lib/path-guard.ts";

const ROOT = resolve("/tmp/otc-root");

test("根内相对路径：原样解析为根下绝对路径", () => {
  assert.equal(resolveWithinRoot("fixtures/snapshot.json", ROOT), join(ROOT, "fixtures", "snapshot.json"));
  assert.equal(resolveWithinRoot(".snapshot/snapshot.json", ROOT), join(ROOT, ".snapshot", "snapshot.json"));
});

test("根内绝对路径：保留绝对路径能力（CI/本地脚本既有用法）", () => {
  const inside = join(ROOT, ".snapshot", "snapshot.json");
  assert.equal(resolveWithinRoot(inside, ROOT), inside);
});

test("根自身：允许指代根目录（relative 为空串）", () => {
  assert.equal(resolveWithinRoot(ROOT, ROOT), ROOT);
});

test("穿越根目录：.. 跳出一律拒绝", () => {
  assert.throws(() => resolveWithinRoot("../outside.json", ROOT), PathOutsideRootError);
  assert.throws(() => resolveWithinRoot("fixtures/../../outside.json", ROOT), PathOutsideRootError);
  assert.throws(() => resolveWithinRoot(join(ROOT, "..", "outside.json"), ROOT), PathOutsideRootError);
});

test("同前缀的兄弟目录：不得被误判为根内（字符串前缀比较的经典漏洞）", () => {
  // /tmp/otc-root-evil 以 /tmp/otc-root 为前缀，但不是其子路径
  const sibling = `${ROOT}-evil${sep}snapshot.json`;
  assert.throws(() => resolveWithinRoot(sibling, ROOT), PathOutsideRootError);
});

test("空路径与 NUL 字节：直接拒绝，不交给底层系统调用", () => {
  assert.throws(() => resolveWithinRoot("", ROOT), PathOutsideRootError);
  assert.throws(() => resolveWithinRoot("fixtures/snap\u0000shot.json", ROOT), PathOutsideRootError);
});

test("根目录必须为绝对路径：相对根属于编程错误", () => {
  assert.throws(() => resolveWithinRoot("fixtures/snapshot.json", "relative/root"), PathOutsideRootError);
});

test("错误信息保留原始输入与根，便于运维定位", () => {
  try {
    resolveWithinRoot("../escape.json", ROOT);
    assert.fail("应当抛出");
  } catch (error) {
    assert.ok(error instanceof PathOutsideRootError);
    assert.equal(error.input, "../escape.json");
    assert.deepEqual(error.roots, [ROOT]);
    assert.match(error.message, /路径越界/);
  }
});

test("多根：命中任一允许根即通过，否则拒绝", () => {
  const second = resolve("/tmp/otc-other-root");
  assert.equal(
    resolveWithinRoots(join(second, "snapshot.json"), [ROOT, second]),
    join(second, "snapshot.json"),
  );
  assert.throws(
    () => resolveWithinRoots("/tmp/otc-third-root/snapshot.json", [ROOT, second]),
    PathOutsideRootError,
  );
});

test("多根：相对路径按第一个根解析", () => {
  assert.equal(resolveWithinRoots("fixtures/snapshot.json", [ROOT, "/tmp/other"]), join(ROOT, "fixtures", "snapshot.json"));
});
