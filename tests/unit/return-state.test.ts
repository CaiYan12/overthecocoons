/**
 * 详情返回的来源筛选与阅读位置快照（Issue #35，纯规则）。
 *
 * 口径（规格 Implementation Decisions）：
 * - 快照只存在于当前历史条目的 history.state（`{octFilter:{sources,topic,page,readId}}`）；
 * - 只有 back_forward（含 BFCache 命中）才恢复；navigate / reload / prerender / 未知 → 不恢复；
 * - 结构非法、来源非法、主题未知、页码非正整数 → 无快照（调用方回退到全部来源）。
 * - 与既有 resolveRestore 组合：目标条目仍在交集结果内 → restore；不在 → fallback（回退有效页）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILTER_STATE_KEY, readFilterState, shouldRestore } from "../../src/client/return-state.ts";
import { filterTimeline } from "../../src/lib/source-filter.ts";
import { resolveRestore } from "../../src/client/position.ts";

const ALL = [
  "baidu-aishort",
  "chinanews-society",
  "chinanews-world",
  "chinanews-dxw",
  "geekpark",
  "solidot",
];

/** 构造一份合法 history.state；over 覆盖 octFilter 内字段（传 undefined 表示删掉该键）。 */
function rawState(over: Record<string, unknown> = {}): unknown {
  const filter: Record<string, unknown> = {
    sources: ALL,
    topic: "全部",
    page: 1,
    readId: null,
    ...over,
  };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete filter[key];
  }
  return { [FILTER_STATE_KEY]: filter };
}

test("合法快照：来源按固定次序规范化，其余字段原样读出", () => {
  assert.deepEqual(readFilterState(rawState()), {
    sources: ALL,
    topic: "全部",
    page: 1,
    readId: null,
  });
  assert.deepEqual(readFilterState(rawState({ topic: "科技", page: 2, readId: "abc" })), {
    sources: ALL,
    topic: "科技",
    page: 2,
    readId: "abc",
  });
});

test("来源乱序/重复/含未知 id：只保留已知订阅并按固定次序重排", () => {
  assert.deepEqual(
    readFilterState(rawState({ sources: ["solidot", "geekpark", "solidot", "unknown-source"] })),
    { sources: ["geekpark", "solidot"], topic: "全部", page: 1, readId: null },
  );
  assert.deepEqual(readFilterState(rawState({ sources: ["chinanews-dxw", "baidu-aishort"] })), {
    sources: ["baidu-aishort", "chinanews-dxw"],
    topic: "全部",
    page: 1,
    readId: null,
  });
});

test("来源非法：非数组 / 空数组 / 全部未知 → 无快照", () => {
  for (const sources of ["solidot", null, undefined, {}, [], ["unknown-source"], [1, 2]]) {
    assert.equal(readFilterState(rawState({ sources })), null, `sources=${JSON.stringify(sources)}`);
  }
});

test("主题未知或非字符串 → 无快照", () => {
  for (const topic of ["八卦", "", null, 7, ["科技"], undefined]) {
    assert.equal(readFilterState(rawState({ topic })), null, `topic=${JSON.stringify(topic)}`);
  }
});

test("页码非正整数 → 无快照", () => {
  for (const page of [0, -1, 1.5, "2", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(readFilterState(rawState({ page })), null, `page=${String(page)}`);
  }
});

test("阅读条目：null 或字符串合法；空串归一为 null；其它类型 → 无快照", () => {
  assert.equal(readFilterState(rawState({ readId: null }))?.readId, null);
  assert.equal(readFilterState(rawState({ readId: "id-7" }))?.readId, "id-7");
  assert.equal(readFilterState(rawState({ readId: "" }))?.readId, null);
  // 缺键（旧版本写入的快照）视同无阅读条目，不整体作废
  assert.equal(readFilterState(rawState({ readId: undefined }))?.readId, null);
  for (const readId of [0, 7, {}, []]) {
    assert.equal(readFilterState(rawState({ readId })), null, `readId=${JSON.stringify(readId)}`);
  }
});

test("结构非法：非对象、缺键、内层非对象 → 无快照", () => {
  for (const raw of [null, undefined, "", "octFilter", 7, [], {}, { other: 1 }]) {
    assert.equal(readFilterState(raw), null, `raw=${JSON.stringify(raw)}`);
  }
  for (const inner of [null, "x", 7, [], {}]) {
    assert.equal(readFilterState({ [FILTER_STATE_KEY]: inner }), null, `inner=${JSON.stringify(inner)}`);
  }
});

test("shouldRestore：仅后退/前进（含 BFCache 命中）恢复", () => {
  assert.equal(shouldRestore("back_forward", false), true, "真实跨文档后退");
  assert.equal(shouldRestore("back_forward", true), true, "后退且命中 BFCache");
  assert.equal(shouldRestore("navigate", true), true, "BFCache 命中以 pageshow.persisted 为准");
  for (const navType of ["navigate", "reload", "prerender", undefined, "", "Back_forward"]) {
    assert.equal(shouldRestore(navType, false), false, `navType=${String(navType)}`);
  }
});

test("与 resolveRestore 组合：目标仍在交集结果 → restore；目标消失 → fallback 回退有效页", () => {
  const entries = [
    { id: "a", topic: "科技", sourceId: "geekpark" },
    { id: "b", topic: "科技", sourceId: "geekpark" },
    { id: "c", topic: "科技", sourceId: "solidot" },
  ];
  const restored = readFilterState(
    rawState({ sources: ["geekpark"], topic: "科技", page: 1, readId: "b" }),
  )!;
  const filtered = filterTimeline(entries, restored.topic, restored.sources);
  assert.deepEqual(resolveRestore(filtered, restored.readId, restored.page, 20), {
    mode: "restore",
    index: 1,
  });
  // 目标条目不属于已选来源（内容/来源范围变化）：回退，不制造无效页码
  const stale = readFilterState(
    rawState({ sources: ["geekpark"], topic: "科技", page: 3, readId: "c" }),
  )!;
  const staleFiltered = filterTimeline(entries, stale.topic, stale.sources);
  assert.deepEqual(resolveRestore(staleFiltered, stale.readId, stale.page, 20), {
    mode: "fallback",
    index: -1,
  });
});
