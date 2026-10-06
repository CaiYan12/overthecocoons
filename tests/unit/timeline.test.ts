/**
 * 时间线渲染纯函数（Ticket 04）：排序、按日分组、分页、日内权重三档、时间格式化、URL 路径。
 * 逻辑与 docs/design/prototype-timeline.html 的 v-kinetic 变体一致（di=0 头条 layout-c/w1，
 * di=1 layout-a/w2，其余 w3 且 layout 按 di 奇偶交替）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SnapshotEntry } from "../../src/lib/snapshot.ts";
import {
  EN_LABEL,
  PAGE_SIZE,
  TOPICS,
  TOPIC_SLUGS,
  beijingDate,
  entryWeights,
  formatClock,
  formatDateTime,
  groupEntriesByDay,
  itemPath,
  monthEn,
  paginate,
  sortEntriesDesc,
  topicPagePath,
} from "../../src/lib/timeline.ts";

function entry(partial: Partial<SnapshotEntry> & { id: string }): SnapshotEntry {
  return {
    title: `【演示】${partial.id}`,
    summary: "演示摘要",
    topic: "新闻",
    firstSeenAt: "2026-10-03T08:00:00+08:00",
    url: `https://example.com/s?wd=${partial.id}`,
    ...partial,
  };
}

test("PAGE_SIZE 固定为 20（规格：每页最多 20 条）", () => {
  assert.equal(PAGE_SIZE, 20);
});

test("主题集合：全部 + 固定 11 个主题，顺序与原型一致", () => {
  assert.deepEqual([...TOPICS], [
    "全部", "新闻", "科技", "文化", "科学", "社会",
    "经济", "环境", "健康", "教育", "艺术", "哲学",
  ]);
});

test("主题 slug：除「全部」外均有英文 slug，唯一且全小写字母", () => {
  const slugs = TOPICS.filter((t) => t !== "全部").map((t) => TOPIC_SLUGS[t]);
  for (const slug of slugs) {
    assert.match(slug, /^[a-z]+$/);
  }
  assert.equal(new Set(slugs).size, slugs.length, "slug 不得重复");
  assert.equal(TOPIC_SLUGS["新闻"], "news");
  assert.equal(TOPIC_SLUGS["社会"], "society");
  assert.equal(TOPIC_SLUGS["哲学"], "philosophy");
});

test("EN_LABEL 覆盖全部主题（数据版画竖排词）", () => {
  for (const topic of TOPICS) {
    assert.match(EN_LABEL[topic], /^[A-Z]+$/);
  }
  assert.equal(EN_LABEL["全部"], "INDEX");
  assert.equal(EN_LABEL["新闻"], "NEWS");
});

test("sortEntriesDesc：按 firstSeenAt 倒序，同时间以 id 升序作确定性次序，且不改变输入数组", () => {
  const input = [
    entry({ id: "b", firstSeenAt: "2026-10-02T10:00:00+08:00" }),
    entry({ id: "d", firstSeenAt: "2026-10-03T08:00:00+08:00" }),
    entry({ id: "a", firstSeenAt: "2026-10-02T10:00:00+08:00" }),
    entry({ id: "c", firstSeenAt: "2026-10-03T09:30:00+08:00" }),
  ];
  const output = sortEntriesDesc(input);
  assert.deepEqual(
    output.map((e) => e.id),
    ["c", "d", "a", "b"],
  );
  assert.deepEqual(
    input.map((e) => e.id),
    ["b", "d", "a", "c"],
    "输入数组不得被就地修改",
  );
});

test("groupEntriesByDay：按日期前缀连续分组，保持输入顺序", () => {
  const sorted = [
    entry({ id: "1", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
    entry({ id: "2", firstSeenAt: "2026-10-03T07:12:00+08:00" }),
    entry({ id: "3", firstSeenAt: "2026-10-02T21:30:00+08:00" }),
    entry({ id: "4", firstSeenAt: "2026-10-01T09:05:00+08:00" }),
  ];
  const groups = groupEntriesByDay(sorted);
  assert.deepEqual(
    groups.map((g) => g.date),
    ["2026-10-03", "2026-10-02", "2026-10-01"],
  );
  assert.deepEqual(
    groups[0].entries.map((e) => e.id),
    ["1", "2"],
  );
  assert.deepEqual(
    groups[2].entries.map((e) => e.id),
    ["4"],
  );
});

test("paginate：切片与全局序号起点正确，页码越界收敛到边界", () => {
  const items = Array.from({ length: 45 }, (_, i) => entry({ id: String(i).padStart(2, "0") }));

  const page1 = paginate(items, 1);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.page, 1);
  assert.equal(page1.start, 0);
  assert.equal(page1.slice.length, 20);
  assert.equal(page1.slice[0].id, "00");

  const page3 = paginate(items, 3);
  assert.equal(page3.slice.length, 5);
  assert.equal(page3.start, 40);

  assert.equal(paginate(items, 4).page, 3, "超过总页数收敛到最后一页");
  assert.equal(paginate(items, 0).page, 1, "小于 1 收敛到第一页");

  const empty = paginate([], 1);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.slice.length, 0);
});

test("entryWeights：日内三档权重与版面交替规则（di=0 头条，di 奇偶交替 A/B）", () => {
  assert.deepEqual(entryWeights(0), { layout: "layout-c", weight: "w1" });
  assert.deepEqual(entryWeights(1), { layout: "layout-a", weight: "w2" });
  assert.deepEqual(entryWeights(2), { layout: "layout-b", weight: "w3" });
  assert.deepEqual(entryWeights(3), { layout: "layout-a", weight: "w3" });
  assert.deepEqual(entryWeights(4), { layout: "layout-b", weight: "w3" });
});

test("时间格式化：UTC（Z）输入换算为北京时间输出（规格 #18）", () => {
  assert.equal(formatClock("2026-10-03T04:54:00Z"), "12:54");
  assert.equal(formatDateTime("2026-10-03T04:54:00Z"), "2026-10-03 12:54");
});

test("时间格式化：+08:00 输入即北京时间，数值恒等", () => {
  assert.equal(formatClock("2026-10-03T07:12:00+08:00"), "07:12");
  assert.equal(formatDateTime("2026-10-03T07:12:00+08:00"), "2026-10-03 07:12");
});

test("beijingDate：跨日边界按北京时间归属（UTC 傍晚属北京次日）", () => {
  assert.equal(beijingDate("2026-10-03T15:59:59Z"), "2026-10-03");
  assert.equal(beijingDate("2026-10-03T16:00:00Z"), "2026-10-04");
  assert.equal(formatDateTime("2026-10-03T16:30:00Z"), "2026-10-04 00:30");
  assert.equal(beijingDate("2026-10-03T23:30:00+08:00"), "2026-10-03");
  assert.equal(beijingDate("2026-10-03T20:00:00-05:00"), "2026-10-04");
});

test("时间字符串缺少时区偏移时拒绝换算（会被运行环境本地时区解释，结果不可复现）", () => {
  assert.throws(() => formatClock("2026-10-03T07:12:00"), /缺少时区偏移/);
  assert.throws(() => formatDateTime("2026-10-03T07:12:00"), /缺少时区偏移/);
  assert.throws(() => beijingDate("2026-10-03T07:12:00"), /缺少时区偏移/);
});

test("时间格式化：英文月份映射", () => {
  assert.equal(monthEn("10"), "OCTOBER");
  assert.equal(monthEn("01"), "JANUARY");
});

test("groupEntriesByDay：按北京时间日期分组（UTC 傍晚条目归北京次日，混合偏移口径一致）", () => {
  const sorted = [
    entry({ id: "1", firstSeenAt: "2026-10-04T01:00:00+08:00" }), // 北京 10-04
    entry({ id: "2", firstSeenAt: "2026-10-03T16:30:00Z" }), // 北京 10-04 00:30
    entry({ id: "3", firstSeenAt: "2026-10-03T18:00:00+08:00" }), // 北京 10-03
  ];
  const groups = groupEntriesByDay(sorted);
  assert.deepEqual(
    groups.map((g) => g.date),
    ["2026-10-04", "2026-10-03"],
    "UTC 傍晚条目与北京次日凌晨条目同组",
  );
  assert.deepEqual(
    groups[0]!.entries.map((e) => e.id),
    ["1", "2"],
  );
});

test("URL 路径：主题页与详情页为站点根相对路径（基路径在渲染层拼接）", () => {
  assert.equal(topicPagePath("全部", 1), "/");
  assert.equal(topicPagePath("全部", 2), "/page/2/");
  assert.equal(topicPagePath("新闻", 1), "/topics/news/");
  assert.equal(topicPagePath("社会", 3), "/topics/society/page/3/");
  assert.equal(itemPath("a".repeat(64)), `/items/${"a".repeat(64)}/`);
});
