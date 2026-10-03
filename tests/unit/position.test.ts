/**
 * 阅读位置恢复决策（Ticket 05，纯函数）：
 * - 记忆条目存在于当前筛选列表且位于目标页 → restore（尽量按原条目恢复）；
 * - 记忆条目不在当前筛选列表（内容变化）→ fallback（回退有效页码并播报）；
 * - 记忆条目在列表但不在目标页 → none（用户显式选择的页码优先，不做越页跳转）；
 * - 无记忆 → none。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRestore } from "../../src/client/position.ts";

const PAGE_SIZE = 20;
const list = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `id-${index}` }));

test("无记忆 → 不恢复", () => {
  assert.deepEqual(resolveRestore(list(45), null, 1, PAGE_SIZE), { mode: "none", index: -1 });
});

test("记忆条目在目标页 → restore 并给出列表下标", () => {
  assert.deepEqual(resolveRestore(list(45), "id-5", 1, PAGE_SIZE), { mode: "restore", index: 5 });
  assert.deepEqual(resolveRestore(list(45), "id-25", 2, PAGE_SIZE), { mode: "restore", index: 25 });
});

test("记忆条目在列表但不在目标页 → none（显式页码优先）", () => {
  assert.deepEqual(resolveRestore(list(45), "id-25", 1, PAGE_SIZE), { mode: "none", index: -1 });
  assert.deepEqual(resolveRestore(list(45), "id-5", 2, PAGE_SIZE), { mode: "none", index: -1 });
});

test("记忆条目不在列表（内容变化）→ fallback", () => {
  assert.deepEqual(resolveRestore(list(45), "id-999", 1, PAGE_SIZE), {
    mode: "fallback",
    index: -1,
  });
  // 空列表同样 fallback（切换到空主题）
  assert.deepEqual(resolveRestore([], "id-5", 1, PAGE_SIZE), { mode: "fallback", index: -1 });
});

test("请求页越界收敛到有效页后再比较（回退有效页码）", () => {
  // 23 条共 2 页：记忆条目在第 2 页，请求第 9 页 → 收敛到第 2 页 → restore
  assert.deepEqual(resolveRestore(list(23), "id-21", 9, PAGE_SIZE), {
    mode: "restore",
    index: 21,
  });
  // 记忆条目在第 1 页，请求第 9 页 → 收敛到第 2 页 → 不在目标页 → none
  assert.deepEqual(resolveRestore(list(23), "id-3", 9, PAGE_SIZE), { mode: "none", index: -1 });
});
