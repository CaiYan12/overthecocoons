/**
 * 来源筛选纯规则（Issue #34）：来源并集 × 主题交集、旧百度缺省归属、固定次序、
 * 入口标题/辅文、全选三态与外部输入规范化。
 *
 * 测试缝（规格 Testing Decisions）：只覆盖有业务区分力的纯规则；不绑定内部实现。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBSCRIPTIONS,
  allState,
  entrySourceId,
  filterTimeline,
  normalizeSources,
  selectionSummary,
  selectionTitle,
} from "../../src/lib/source-filter.ts";

interface Row {
  id: string;
  topic: string;
  sourceId?: string;
}

/** 与渲染层同一输入形态：已按首次收录时间倒序，筛选不得改变顺序。 */
const rows: Row[] = [
  { id: "a", topic: "新闻", sourceId: "baidu-aishort" },
  { id: "b", topic: "社会", sourceId: "chinanews-society" },
  { id: "c", topic: "新闻", sourceId: "chinanews-world" },
  { id: "d", topic: "科技", sourceId: "geekpark" },
  { id: "e", topic: "文化", sourceId: "chinanews-dxw" },
  { id: "f", topic: "科技", sourceId: "solidot" },
  // 旧快照兼容：无 sourceId 的条目归属历史百度来源
  { id: "g", topic: "新闻" },
  { id: "h", topic: "社会" },
];

test("订阅顺序固定：百度第一，中新网三个频道分别列出（不按网站合并）", () => {
  assert.deepEqual(
    SUBSCRIPTIONS.map((item) => item.id),
    [
      "baidu-aishort",
      "chinanews-society",
      "chinanews-world",
      "chinanews-dxw",
      "geekpark",
      "solidot",
    ],
  );
  assert.deepEqual(
    SUBSCRIPTIONS.map((item) => item.name),
    ["百度热点", "中新网·社会", "中新网·国际", "中新网·东西问", "极客公园", "Solidot"],
  );
});

test("条目归属来源：显式 sourceId 优先，缺省沿用历史百度归属", () => {
  assert.equal(entrySourceId({ sourceId: "geekpark" }), "geekpark");
  assert.equal(entrySourceId({}), "baidu-aishort");
  assert.equal(entrySourceId({ sourceId: undefined }), "baidu-aishort");
});

test("来源并集：多选来源的条目全部保留，未选来源被排除，输入顺序不变", () => {
  const filtered = filterTimeline(rows, "全部", ["baidu-aishort", "solidot"]);
  assert.deepEqual(filtered.map((row) => row.id), ["a", "f", "g", "h"]);
});

test("来源与主题交集：先取来源并集再与当前主题取交集", () => {
  assert.deepEqual(
    filterTimeline(rows, "社会", ["baidu-aishort", "chinanews-society"]).map((row) => row.id),
    ["b", "h"],
  );
  // 该组合无交集：solidot 没有「社会」条目
  assert.deepEqual(filterTimeline(rows, "社会", ["solidot"]), []);
});

test("零来源集合返回空列表，不退化成「全部」", () => {
  assert.deepEqual(filterTimeline(rows, "全部", []), []);
});

test("入口标题：单源显示来源名，多源与全选显示「多源聚合」", () => {
  assert.equal(selectionTitle(["geekpark"]), "极客公园");
  assert.equal(selectionTitle(["chinanews-society"]), "中新网·社会");
  assert.equal(selectionTitle(["baidu-aishort", "solidot"]), "多源聚合");
  assert.equal(selectionTitle(SUBSCRIPTIONS.map((item) => item.id)), "多源聚合");
});

test("辅文：已选数量以六订阅为分母", () => {
  assert.equal(selectionSummary(SUBSCRIPTIONS.map((item) => item.id)), "已选 6 / 6 个订阅源");
  assert.equal(selectionSummary(["solidot"]), "已选 1 / 6 个订阅源");
  assert.equal(selectionSummary(["solidot", "geekpark"]), "已选 2 / 6 个订阅源");
  assert.equal(selectionSummary([]), "已选 0 / 6 个订阅源");
});

test("全选三态：全选 true、部分 mixed、未选 false", () => {
  assert.equal(allState(SUBSCRIPTIONS.map((item) => item.id)), true);
  assert.equal(allState(["solidot", "geekpark"]), "mixed");
  assert.equal(allState([]), false);
  // 只选一个也是部分选中，不是全选
  assert.equal(allState(["baidu-aishort"]), "mixed");
});

test("外部输入规范化：只保留已知来源、去重并按固定次序重排", () => {
  assert.deepEqual(normalizeSources(["solidot", "baidu-aishort", "solidot"]), [
    "baidu-aishort",
    "solidot",
  ]);
  assert.deepEqual(normalizeSources(SUBSCRIPTIONS.map((item) => item.id).reverse()), [
    "baidu-aishort",
    "chinanews-society",
    "chinanews-world",
    "chinanews-dxw",
    "geekpark",
    "solidot",
  ]);
});

test("外部输入规范化：非数组、空数组、全非法值一律 null", () => {
  for (const raw of [null, undefined, "geekpark", 42, {}, [], ["unknown-source"], [1, 2], ["", " "]]) {
    assert.equal(normalizeSources(raw), null, `应拒绝：${JSON.stringify(raw)}`);
  }
  // 混入未知值时丢弃未知项，保留已知项
  assert.deepEqual(normalizeSources(["geekpark", "unknown-source"]), ["geekpark"]);
});
