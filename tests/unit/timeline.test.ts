/**
 * 时间线渲染纯函数（Ticket 04 起，T7 版式诚实化演进）：排序、按日分组、分页、两档版式、
 * 日组头规则、时间格式化、URL 路径。
 * 层级口径见 docs/adr/0003-timeline-hierarchy-and-time-presentation.md：
 * 不设位置型头条档，条目两档由「有无摘要」驱动，日组头规则驱动批次形态。
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
  dayHeadInfo,
  entryLayout,
  formatClock,
  formatDateTime,
  groupEntriesByDay,
  itemPath,
  monthEn,
  pageHeadInfo,
  paginate,
  sortEntriesDesc,
  topicPagePath,
  topicTabs,
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

test("entryLayout：两档版式——有摘要按日内序号奇偶交替（di=0 归偶），无摘要恒为紧凑行（ADR 0003）", () => {
  assert.equal(entryLayout(0, true), "layout-b", "di=0 与其他条目同级，归偶交替（图左）");
  assert.equal(entryLayout(1, true), "layout-a", "di 奇图右");
  assert.equal(entryLayout(2, true), "layout-b", "di 偶图左");
  assert.equal(entryLayout(3, true), "layout-a");
  for (const di of [0, 1, 2, 7, 20]) {
    assert.equal(entryLayout(di, false), "layout-compact", `di=${di} 无摘要恒为紧凑行，不参与交替`);
  }
});

test("dayHeadInfo：同日条目分钟全相同 → 批次形态（批次时刻 + N 条计数）", () => {
  const batch = dayHeadInfo([
    entry({ id: "1", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
    entry({ id: "2", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
    entry({ id: "3", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
  ]);
  assert.deepEqual(batch, { batch: true, clock: "08:57", count: 3 });
});

test("dayHeadInfo：出现不同分钟 → 非批次（条目行显示各自时间）", () => {
  const mixed = dayHeadInfo([
    entry({ id: "1", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
    entry({ id: "2", firstSeenAt: "2026-10-03T08:29:00+08:00" }),
    entry({ id: "3", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
  ]);
  assert.deepEqual(mixed, { batch: false, clock: null, count: 3 });
});

test("dayHeadInfo：跨时区输入按北京时间分钟判定（UTC 00:57 = 北京 08:57，与 +08:00 同批次）", () => {
  const batch = dayHeadInfo([
    entry({ id: "1", firstSeenAt: "2026-10-03T00:57:00Z" }),
    entry({ id: "2", firstSeenAt: "2026-10-03T08:57:00+08:00" }),
  ]);
  assert.deepEqual(batch, { batch: true, clock: "08:57", count: 2 });
});

test("dayHeadInfo：单条条目分钟自相同 → 批次形态「1 条」（规则只看分钟事实，不特判条数）", () => {
  const single = dayHeadInfo([entry({ id: "1", firstSeenAt: "2026-10-03T08:57:00+08:00" })]);
  assert.deepEqual(single, { batch: true, clock: "08:57", count: 1 });
});

test("dayHeadInfo：空组返回非批次零计数", () => {
  assert.deepEqual(dayHeadInfo([]), { batch: false, clock: null, count: 0 });
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

test("pageHeadInfo：轻量页头文案规则（T8，服务端与客户端重渲染共用）", () => {
  // 「全部」第 2 页起：大字为「公共时间线」，页码进说明行
  assert.deepEqual(pageHeadInfo("全部", 2, false), {
    big: "公共时间线",
    sub: "PUBLIC TIMELINE · 第 2 页 · 按收录时间排序",
  });
  // 主题页第 1 页：大字为主题名，无页码段
  assert.deepEqual(pageHeadInfo("新闻", 1, false), {
    big: "新闻",
    sub: "NEWS · 按收录时间排序",
  });
  // 主题页第 3 页：页码段按北京时间口径外的纯页序（不涉时间换算）
  assert.deepEqual(pageHeadInfo("社会", 3, false), {
    big: "社会",
    sub: "SOCIETY · 第 3 页 · 按收录时间排序",
  });
  // 演示快照：说明行带「（演示数据）」后缀（与日组头 k-day-sub 同口径）
  assert.deepEqual(pageHeadInfo("科技", 1, true), {
    big: "科技",
    sub: "TECH · 按收录时间排序（演示数据）",
  });
});

test("URL 路径：主题页与详情页为站点根相对路径（基路径在渲染层拼接）", () => {
  assert.equal(topicPagePath("全部", 1), "/");
  assert.equal(topicPagePath("全部", 2), "/page/2/");
  assert.equal(topicPagePath("新闻", 1), "/topics/news/");
  assert.equal(topicPagePath("社会", 3), "/topics/society/page/3/");
  assert.equal(itemPath("a".repeat(64)), `/items/${"a".repeat(64)}/`);
});

test("topicTabs：按条数降序排列，空主题置后并标记 empty（T9 空主题 tab 降权规则）", () => {
  // 仿 fixture 形态：新闻 23、社会 22，其余主题空
  const entries = [
    ...Array.from({ length: 23 }, (_, i) => entry({ id: `n${String(i).padStart(2, "0")}`, topic: "新闻" })),
    ...Array.from({ length: 22 }, (_, i) => entry({ id: `s${String(i).padStart(2, "0")}`, topic: "社会" })),
  ];
  const tabs = topicTabs(entries);
  assert.deepEqual(
    tabs.map((t) => t.topic),
    // 非空按条数降序（全部 45 > 新闻 23 > 社会 22），空主题按 TOPICS 原序置后
    ["全部", "新闻", "社会", "科技", "文化", "科学", "经济", "环境", "健康", "教育", "艺术", "哲学"],
  );
  assert.equal(tabs[0].count, 45);
  assert.equal(tabs[1].count, 23);
  assert.equal(tabs[2].count, 22);
  for (const tab of tabs.slice(3)) {
    assert.equal(tab.count, 0, `「${tab.topic}」应为零条目`);
    assert.equal(tab.empty, true, `「${tab.topic}」应标记为空主题`);
  }
  for (const tab of tabs.slice(0, 3)) {
    assert.equal(tab.empty, false, `「${tab.topic}」非空，不得标记降权`);
  }
});

test("topicTabs：条数相同时保持 TOPICS 原序（稳定排序，规则确定性、无编辑挑选）", () => {
  const entries = [
    entry({ id: "a", topic: "哲学" }),
    entry({ id: "b", topic: "科技" }),
    entry({ id: "c", topic: "经济" }),
  ];
  const tabs = topicTabs(entries);
  assert.deepEqual(
    tabs.map((t) => t.topic),
    ["全部", "科技", "经济", "哲学", "新闻", "文化", "科学", "社会", "环境", "健康", "教育", "艺术"],
    "三条 1 条主题按原序排列于前，零条目主题按原序置后",
  );
});

test("topicTabs：空快照全部主题 empty，仅「全部」count=0（空快照下各 tab 同为空态）", () => {
  const tabs = topicTabs([]);
  assert.equal(tabs.length, TOPICS.length);
  for (const tab of tabs) {
    assert.equal(tab.count, 0);
    assert.equal(tab.empty, true);
  }
});
