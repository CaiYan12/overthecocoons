/**
 * 构建产物断言（Ticket 04 起，Ticket 05 演进）：直接读取 dist 文本，验证基路径、时间线倒序与分页结构、
 * 空主题真实空态、详情页与 404、长文页目录、来源页、隐私约束（无统计/广告/外部字体；
 * 脚本仅限本地打包模块与 JSON 数据岛）。
 *
 * 前置条件：先运行 `pnpm build`（`pnpm test` 的脚本顺序已保证 build 在 test:node 之前）。
 * 本测试不启动服务器、不访问网络；GitHub Pages 线上行为另行验收，不在此冒充。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { PublicEntry, PublicSnapshot } from "../../src/domain/contract.ts";
import { sortEntriesDesc, TOPICS, topicPagePath } from "../../src/lib/timeline.ts";

const DIST = join(process.cwd(), "dist");
const BASE = "/overthecocoons";

if (!existsSync(join(DIST, "index.html"))) {
  throw new Error("dist/index.html 不存在：请先运行 pnpm build 再运行产物断言测试");
}

/** 递归收集 dist 下指定后缀文件（相对 dist 的斜杠路径）。 */
function collectFiles(dir: string, ext: string, out: string[] = [], prefix = ""): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) collectFiles(full, ext, out, rel);
    else if (name.endsWith(ext)) out.push(rel);
  }
  return out;
}

const readDist = (rel: string): string => readFileSync(join(DIST, rel), "utf-8");
const htmlFiles = collectFiles(DIST, ".html");
const cssFiles = collectFiles(DIST, ".css");
const jsFiles = collectFiles(DIST, ".js");

const snapshot: PublicSnapshot = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "snapshot.json"), "utf-8"),
) as PublicSnapshot;
const sorted = sortEntriesDesc(snapshot.entries as PublicEntry[]);
const firstEntry = sorted[0];

/** 把 HTML 按 k-entry 起始切分，返回每条条目的文本片段（顺序即渲染顺序）。 */
function entryChunks(html: string): string[] {
  return html.split('<article class="k-entry').slice(1).map((chunk) => chunk);
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? null) : null;
}

test("首页为动态编辑场 v-kinetic 结构：Hero、紧凑 header、三栏、HUD、页脚", () => {
  const html = readDist("index.html");
  assert.ok(html.includes('class="v-kinetic"'), "根容器 .v-kinetic");
  assert.ok(html.includes('class="k-grain"'), "背景材质");
  assert.ok(html.includes('class="k-header"'), "紧凑 header");
  assert.ok(html.includes("OVER THE COCOONS"), "Hero ghost 英文");
  assert.match(html, /<span class="line">跳出<\/span>/, "Hero 双行大字标题（无全角空格）");
  assert.match(
    html,
    /<span class="line l2"><span class="silk-anchor">茧<svg class="silk-static" aria-hidden="true" viewBox="0 0 110 180"/,
    "Hero 第二行大字，「茧」字带丝线静态挂点（T13）",
  );
  assert.ok(html.includes('class="k-hero-rule"'), "尺规线");
  assert.ok(html.includes('class="k-hero-date"'), "Hero 幽灵日期");
  assert.ok(html.includes('class="k-hero-meta"'), "Hero 元信息列表");
  assert.ok(html.includes('class="k-cols hud-first"'), "三栏容器（时间线页 HUD 移动端前置，UI 票 #10）");
  assert.ok(html.includes('class="k-hud"'), "右侧 HUD");
  assert.ok(html.includes("<footer"), "页脚");
});

test("h1 全角空格移除（T5，#22）：Hero 标题模板区块不含 U+3000（读屏按完整词朗读）", () => {
  // 只守 Hero 标题模板（T5 改排版的区块）；条目标题/摘要渲染原文、不改写内容是站点核心约束，
  // 正文里正当的全角空格不构成缺陷，不得扫描全产物 HTML 打红构建（审查裁定，#22）。
  const html = readDist("index.html");
  const heroTitle = html.match(/<h1[^>]*data-herotitle>[\s\S]*?<\/h1>/);
  assert.ok(heroTitle, "index.html 存在 Hero 标题区块（断言前置）");
  assert.ok(!heroTitle[0].includes("\u3000"), "Hero 标题区块不应包含全角空格 U+3000");
});

test("Hero 幽灵日期取最新条目日期（日 + 英文月份 + 年）", () => {
  const html = readDist("index.html");
  const day = firstEntry.firstSeenAt.slice(8, 10);
  const year = firstEntry.firstSeenAt.slice(0, 4);
  assert.ok(
    html.includes(`<span class="d" data-herodate-d>${day}</span>`),
    `应包含最新条目日 ${day}`,
  );
  assert.ok(html.includes(year));
});

test("header 主题导航：12 个主题 tab 链接，当前主题 aria-current=true", () => {
  const html = readDist("index.html");
  const tabsNav = firstMatch(html, /(<nav class="k-tabs"[\s\S]*?<\/nav>)/);
  assert.ok(tabsNav, "应存在 k-tabs 导航");
  const tabs = tabsNav!.match(/<a class="tab(?: tab-empty)?" role="tab" aria-current="(true|false)" data-topic="[^"]+"/g);
  assert.ok(tabs, "应存在 a.tab 元素");
  assert.equal(tabs.length, 12);
  assert.ok(tabsNav!.includes('aria-current="true" data-topic="全部"'));
  // 全屏菜单里还有一份主题列表（T06 挂点），同样 12 个（空主题降权类见 T9 专项断言）
  const menuTopics = firstMatch(html, /(<div class="k-menu-topics"[\s\S]*?<\/div>)/);
  assert.equal((menuTopics?.match(/<a class="tab/g) ?? []).length, 12);
});

test("空主题 tab 降权（T9）：非空主题按条数置前，空主题置后带 tab-empty 类，入口保留为真实链接", () => {
  const html = readDist("index.html");
  const tabsNav = firstMatch(html, /(<nav class="k-tabs"[\s\S]*?<\/nav>)/);
  assert.ok(tabsNav, "应存在 k-tabs 导航");
  const tabs = [
    ...tabsNav!.matchAll(
      /<a class="tab( tab-empty)?" role="tab" aria-current="(?:true|false)" data-topic="([^"]+)"/g,
    ),
  ];
  assert.equal(tabs.length, 12, "12 个主题 tab 全部保留（只降权不删入口）");
  // fixture 前置：全部 45 / 新闻 23 / 社会 22，其余 9 主题为空
  assert.deepEqual(
    tabs.map((m) => m[2]),
    ["全部", "新闻", "社会", "科技", "文化", "科学", "经济", "环境", "健康", "教育", "艺术", "哲学"],
    "非空主题按条数降序置前，空主题按 TOPICS 原序置后（构建期确定，无编辑挑选）",
  );
  const emptyTopics = new Set(["科技", "文化", "科学", "经济", "环境", "健康", "教育", "艺术", "哲学"]);
  for (const [, emptyClass, topic] of tabs) {
    assert.equal(
      Boolean(emptyClass),
      emptyTopics.has(topic),
      `「${topic}」的 tab-empty 类必须与空态判定一致`,
    );
  }
  // 入口保留：空主题 tab 仍指向真实主题页（键盘可达的 <a href>，可达性不降）
  for (const topic of emptyTopics) {
    const slug = topicPagePath(topic, 1);
    assert.ok(
      tabsNav!.includes(`href="${BASE}${slug}"`),
      `空主题「${topic}」tab 仍链接到 ${slug}`,
    );
  }
  // 全屏菜单主题列同步降权
  const menuTopics = firstMatch(html, /(<div class="k-menu-topics"[\s\S]*?<\/div>)/);
  assert.ok(menuTopics, "应存在菜单主题列");
  const menuTabs = [
    ...menuTopics!.matchAll(/<a class="tab( tab-empty)?" role="tab" aria-current="(?:true|false)" data-topic="([^"]+)"/g),
  ];
  assert.equal(menuTabs.length, 12, "菜单主题列同样 12 个入口");
  assert.deepEqual(
    menuTabs.filter((m) => Boolean(m[1])).map((m) => m[2]),
    [...emptyTopics],
    "菜单主题列空主题同样带 tab-empty 类",
  );
});

test("HUD 小标规格（T9）：.k-hud .h 字号 10.5px→11.5px、字距 .3em→.14em（HUD 结构与文案不动）", () => {
  const css = cssFiles.map(readDist).join("\n");
  const rule = css.match(/\.k-hud \.h\{([^}]*)\}/);
  assert.ok(rule, "应存在 .k-hud .h 规则");
  assert.ok(rule[1]!.includes("font-size:11.5px"), `.h 字号应为 11.5px（区间 11–12px 取中）：${rule[1]}`);
  assert.ok(
    rule[1]!.includes("letter-spacing:.14em"),
    `.h 字距应为 .14em（区间 .12–.16em 取中，与 .k-hero-meta 同频）：${rule[1]}`,
  );
});

test("长文页排版对齐（T9）：版宽 62ch 对齐时间线阅读文本，h1 对齐大字族规格，目录对齐左栏导航", () => {
  const css = cssFiles.map(readDist).join("\n");
  const h1 = css.match(/\.k-doc h1\{([^}]*)\}/);
  assert.ok(h1, "应存在 .k-doc h1 规则");
  assert.ok(
    h1[1]!.includes("/1.1 "),
    `h1 行高应对齐 .k-day-big/.k-pagehead-big 的 1.1（原 1.15）：${h1[1]}`,
  );
  assert.ok(
    h1[1]!.includes("letter-spacing:.04em"),
    `h1 字距应对齐大字族的 .04em：${h1[1]}`,
  );
  const body = css.match(/\.k-doc p,\.k-doc li\{([^}]*)\}/);
  assert.ok(body, "应存在 .k-doc p/li 规则");
  assert.ok(
    body[1]!.includes("max-width:62ch"),
    `版宽应对齐时间线阅读文本 .k-summary 的 62ch（原 65ch）：${body[1]}`,
  );
  const lede = css.match(/\.k-doc \.k-doc-lede\{([^}]*)\}/);
  assert.ok(lede, "应存在 .k-doc-lede 规则");
  assert.ok(lede[1]!.includes("max-width:62ch"), `导语版宽同口径 62ch：${lede[1]}`);
  const toc = css.match(/\.k-toc a\{([^}]*)\}/);
  assert.ok(toc, "应存在 .k-toc a 规则");
  assert.ok(
    toc[1]!.includes("padding:7px 0"),
    `目录行距应对齐左栏导航 .k-nav nav a 的 7px 0（原 6px 0）：${toc[1]}`,
  );
});

test("时间线倒序：产物中 k-entry 的 datetime 依渲染顺序单调不增，日期组严格降序", () => {
  const html = readDist("index.html");
  const chunks = entryChunks(html);
  assert.equal(chunks.length, 20, "首页应渲染 20 条（fixture 共 45 条）");
  const times = chunks.map((c) => firstMatch(c, /<time datetime="([^"]+)"/));
  for (const t of times) assert.ok(t, "每条条目应有 <time datetime>");
  for (let i = 1; i < times.length; i++) {
    assert.ok(
      Date.parse(times[i]!) <= Date.parse(times[i - 1]!),
      `第 ${i + 1} 条（${times[i]}）不得晚于第 ${i} 条（${times[i - 1]}）`,
    );
  }
  const days = [...html.matchAll(/<section class="k-day" data-day="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(days.length >= 2, "fixture 应覆盖多日分组");
  for (let i = 1; i < days.length; i++) {
    assert.ok(days[i]! < days[i - 1]!, `日期组应降序：${days[i - 1]} → ${days[i]}`);
  }
});

test("两档版式与数据版画结构正确（有摘要奇偶交替、无摘要紧凑行；无位置型头条档）", () => {
  const html = readDist("index.html");
  const chunks = entryChunks(html);
  const classes = chunks.map((c) => c.match(/^ ([\w-]+)"/)?.[1] ?? null);
  assert.equal(classes[0], "layout-b", "di=0 归偶交替（图左），与其他条目同级（ADR 0003）");
  assert.equal(classes[1], "layout-a", "di 奇图右");
  assert.equal(classes[2], "layout-b", "di 偶图左");
  assert.equal(classes[3], "layout-compact", "gi=3 无摘要 → 紧凑行（fixtures 前置：该条无 summary）");
  assert.ok(!html.includes('k-entry layout-c"'), "layout-c 位置型版式已取消");
  const articleClasses = (html.match(/<article class="k-entry[^"]*"/g) ?? []).join("\n");
  assert.ok(!/\bw[123]\b/.test(articleClasses), "条目不再携带 w1/w2/w3 位置权重类");
  // 第二个日期组首条重新从 di=0 起算
  const secondDayStart = html.indexOf('<section class="k-day" data-day', 1 + html.indexOf('<section class="k-day" data-day'));
  const afterSecondDay = html.slice(secondDayStart);
  const secondDayFirst = entryChunks(afterSecondDay)[0];
  assert.match(secondDayFirst ?? "", /^ layout-b"/, "每个日期组首条独立从 di=0 交替");

  const first = chunks[0]!;
  assert.ok(first.includes('class="k-media"'), "数据版画外层");
  // T14（UI 票 #31）：tilt 中间层恢复（三层 clip → tilt → art；T11 移除撤销）
  assert.ok(first.includes('class="k-media-tilt"'), "tilt 中间层恢复（T14：三层 clip → tilt → art）");
  assert.ok(
    first.includes('class="k-media-art" aria-hidden="true"'),
    "art 层为纯装饰占位（aria-hidden，T9 语义重订）",
  );
  assert.ok(!first.includes("编辑占位图"), "不再以 role=img+aria-label 逐条播报占位图（T9）");
  assert.match(
    first,
    /<span class="tag">\s*<i><\/i>\s*<span class="tm">\d{2}:\d{2}<\/span>/,
    "色块时间保留（T9 版画减负后唯一内容）",
  );
  assert.ok(!first.includes('class="lab"'), "竖排英文主题词已移除（T9：单一主题下逐条重复零信息量）");
  assert.ok(!first.includes('class="num"'), "出血大序号已移除（T9：位置计数由 HUD NOW READING 承担）");
  assert.ok(first.includes('data-cursor="VIEW"'), "T06 光标挂点保留");

  const compact = chunks[3]!;
  assert.ok(!compact.includes('class="k-media"'), "紧凑行无版画（无摘要条目不假装有图）");
  assert.ok(!compact.includes('class="k-summary"'), "紧凑行无摘要段");
  assert.ok(compact.includes('class="k-headline"'), "紧凑行保留标题链接");
  assert.ok(compact.includes('class="k-meta"'), "紧凑行保留元信息");
});

test("日组头规则驱动：fixtures 每日分钟互异 → 无批次行，条目行显示各自时间", () => {
  const html = readDist("index.html");
  assert.ok(!html.includes("k-day-batch"), "fixtures 各日期内分钟互异，不应出现批次行");
  for (const c of entryChunks(html)) {
    assert.match(
      c,
      /<div class="k-time"><time datetime="[^"]+">\d{2}:\d{2}<\/time><\/div>/,
      "混合分钟分支：条目行保留各自时间",
    );
  }
});

test("日组头批次分支接线（T7 审查修复）：合成快照同日分钟全相同，走完整 astro build 渲染路径", async () => {
  // 合成快照：3 条同日条目 firstSeenAt 完全相同（分钟全相同 → dayHeadInfo 批次形态）。
  // 04:54Z 经北京时间换算 = 12:54（UI 票 #18 口径）；isFixture=true 遵守演示数据约定。
  const batchSnapshot: PublicSnapshot = {
    schemaVersion: 1,
    isFixture: true,
    generatedAt: "2026-10-06T04:54:02.396Z",
    entries: ["a", "b", "c"].map((c) => ({
      id: c.repeat(64),
      title: `【演示】批次条目 ${c}`,
      summary: "演示摘要：批次分支接线测试用合成条目。",
      topic: "新闻",
      firstSeenAt: "2026-10-06T04:54:02.396Z",
      url: `https://example.com/s?wd=batch-${c}`,
    })),
    quarantined: [],
    sources: [],
  };
  const snapshotPath = join(tmpdir(), "oct-t7-batch-snapshot.json");
  writeFileSync(snapshotPath, JSON.stringify(batchSnapshot), "utf-8");
  const previousSnapshotPath = process.env.SNAPSHOT_PATH;
  process.env.SNAPSHOT_PATH = snapshotPath;
  process.env.ASTRO_TELEMETRY_DISABLED = "1";
  try {
    // 完整渲染路径 = 真实 astro build（编程式 API，读同一份 astro.config.mjs；
    // outDir 隔离到 node_modules 下（已 gitignore），避免覆盖主 dist 断言产物）
    const { build } = await import("astro");
    await build({ outDir: "./node_modules/.t7-batch-dist", logLevel: "error" });
  } finally {
    if (previousSnapshotPath === undefined) delete process.env.SNAPSHOT_PATH;
    else process.env.SNAPSHOT_PATH = previousSnapshotPath;
    rmSync(snapshotPath, { force: true });
  }
  const html = readFileSync(join(process.cwd(), "node_modules", ".t7-batch-dist", "index.html"), "utf-8");
  assert.ok(html.includes('data-day="2026-10-06"'), "UTC 04:54Z 按北京时间归属 10-06 日组");
  assert.ok(html.includes('class="k-day-batch"'), "批次形态应渲染 k-day-batch 行");
  assert.match(
    html.replace(/\s+/g, " "),
    /批次 12:54 · 3 条/,
    "批次行文本：04:54Z → 北京时间 12:54 · 3 条",
  );
  assert.ok(!html.includes('class="k-time"'), "批次形态下条目行省略 k-time 时间（ADR 0003）");
});

test("分页结构：每页独立 URL、页 2/页 3 存在且条数正确、aria-current 指示当前页", () => {
  assert.equal(sorted.length, 45, "fixture 前置：45 条");
  const page1 = readDist("index.html");
  assert.ok(page1.includes(`href="${BASE}/page/2/"`), "页 1 应链接页 2");
  assert.match(page1, /<a class="page-btn"[^>]*aria-current="page"/, "当前页按钮 aria-current=page");
  assert.ok(page1.includes('<nav class="pager" data-pager'), "分页器存在");

  const page2 = readDist("page/2/index.html");
  assert.equal(entryChunks(page2).length, 20);
  assert.ok(page2.includes(`href="${BASE}/"`), "页 2 应链接页 1");
  assert.ok(page2.includes(`href="${BASE}/page/3/"`), "页 2 应链接页 3");

  const page3 = readDist("page/3/index.html");
  assert.equal(entryChunks(page3).length, 5, "末页为剩余条数");
  assert.ok(!page3.includes(`href="${BASE}/page/4/"`), "末页不得链接不存在的页 4");
});

test("主题筛选页：新闻主题有内容并独立分页；空主题渲染真实空态", () => {
  const news = readDist("topics/news/index.html");
  assert.equal(entryChunks(news).length, 20);
  assert.ok(news.includes(`href="${BASE}${topicPagePath("新闻", 1)}"`), "新闻页内自链");
  const news2 = readDist("topics/news/page/2/index.html");
  assert.equal(entryChunks(news2).length, 3, "新闻 23 条 → 第 2 页 3 条");

  const philosophy = readDist("topics/philosophy/index.html");
  assert.ok(philosophy.includes("「哲学」暂无内容"), "空主题标题");
  assert.ok(
    philosophy.includes("该主题当前没有可展示的内容"),
    "空态说明（用户视角文案，UI 票 #10）",
  );
  assert.ok(philosophy.includes(`href="${BASE}/"`), "查看全部返回入口");
  assert.equal(entryChunks(philosophy).length, 0, "空主题不得渲染条目");
  assert.ok(!philosophy.includes('class="pager" data-pager'), "空主题无分页器");
  assert.match(philosophy, /<span data-total>00<\/span>/, "空主题 HUD 总数为 00");
});

test("T8 Hero 仅时间线第一页：首页保留 Hero，其余时间线路由渲染轻量页头且无 Hero 挂点", () => {
  const index = readDist("index.html");
  assert.ok(index.includes('class="k-hero" data-hero'), "首页保留 Hero（data-hero 挂点）");
  assert.ok(!index.includes("k-pagehead"), "首页不渲染轻量页头");

  const page2 = readDist("page/2/index.html");
  assert.ok(!page2.includes("data-hero"), "分页页不得有 Hero 挂点（T3 header 常显守卫依据）");
  assert.ok(page2.includes('class="k-pagehead"'), "分页页渲染轻量页头");
  assert.match(page2, /class="k-pagehead-big">公共时间线<\/h1>/, "「全部」页头大字");
  assert.match(page2, /class="k-pagehead-sub">PUBLIC TIMELINE · 第 2 页 · 按收录时间排序（演示数据）<\/p>/);

  const news = readDist("topics/news/index.html");
  assert.ok(!news.includes("data-hero"), "主题页不得有 Hero 挂点");
  assert.ok(news.includes('class="k-pagehead"'), "主题页渲染轻量页头");
  assert.match(news, /class="k-pagehead-big">新闻<\/h1>/, "主题页页头大字为主题名");
  assert.match(news, /class="k-pagehead-sub">NEWS · 按收录时间排序（演示数据）<\/p>/);

  const philosophy = readDist("topics/philosophy/index.html");
  assert.ok(!philosophy.includes("data-hero"), "空主题页不得有 Hero 挂点");
  assert.ok(philosophy.includes('class="k-pagehead"'), "空主题页同样渲染轻量页头");
  assert.match(philosophy, /class="k-pagehead-big">哲学<\/h1>/);
});

test("HUD：NOW READING 总数随主题口径变化，来源与快照时间呈现", () => {
  // data-total 是 T06 挂点属性，总数渲染为其元素文本
  assert.match(readDist("index.html"), /<span data-total>45<\/span>/, "全部=45");
  assert.match(readDist("topics/news/index.html"), /<span data-total>23<\/span>/, "新闻=23");
  assert.match(readDist("topics/philosophy/index.html"), /<span data-total>00<\/span>/, "空主题=00");
  const hud = readDist("index.html");
  assert.ok(hud.includes("百度热点"), "SOURCE 名称");
  assert.ok(hud.includes("BAIDU HOT · 热点线索"), "SOURCE 副标");
  assert.match(
    hud,
    /快照 · 每日更新 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}（北京时间）/,
    "快照行：每日更新口径（不写死钟点）+ 北京时间标注一次（UI 票 #18/#15-10）",
  );
  assert.ok(!hud.includes("LIVE"), "LIVE 夸大实时性的文案已移除（UI 票 #15-10）");
  assert.ok(hud.includes('aria-live="polite"'), "aria-live 播报挂点");
});

test("时间呈现口径：可见文本为北京时间（同一换算函数），<time datetime> 保留 UTC 原值", () => {
  const html = readDist("index.html");
  const first = entryChunks(html)[0]!;
  const attr = firstMatch(first, /<time datetime="([^"]+)"/);
  assert.equal(attr, firstEntry.firstSeenAt, "datetime 属性保留数据原值（UTC/来源偏移）");
  const text = firstMatch(first, /<time datetime="[^"]+">(\d{2}:\d{2})<\/time>/);
  assert.equal(
    text,
    firstEntry.firstSeenAt.slice(11, 16),
    "渲染文本经北京时间换算（fixtures +08:00 恒等口径）",
  );
  assert.equal(html.split("北京时间").length - 1, 1, "「北京时间」标注全页仅 HUD 快照行一处");
});

test("详情页：/items/<64hex>/ 直达，标题/摘要/来源/收录时间/主题/占位图与独立百度入口齐备", () => {
  const html = readDist(`items/${firstEntry.id}/index.html`);
  assert.ok(html.includes("<h1"), "详情页 h1");
  assert.ok(html.includes("查看百度搜索结果"), "独立百度搜索入口");
  assert.ok(html.includes(`href="${firstEntry.url}"`), "外链指向条目目标链接");
  assert.ok(
    html.includes('class="k-media-art" aria-hidden="true"'),
    "占位图保留（纯装饰 aria-hidden，T9 语义重订）",
  );
  assert.ok(!html.includes("编辑占位图"), "T9 后全页不再出现「编辑占位图」label");
  assert.ok(!html.includes('class="num"'), "详情页版画不渲染序号（T7：单一条目无快照内位置语境）");
  assert.ok(!html.includes('class="lab"'), "竖排主题词已移除（T9）");
  assert.ok(html.includes('class="tpc"'), "主题标注");
  assert.ok(html.includes(`<time datetime="${firstEntry.firstSeenAt}"`), "收录时间");
  assert.ok(html.includes(`${BASE}/`), "站内链接带基路径");
});

test("404：自定义 404 页含「条目已过期或不存在」与返回时间线入口", () => {
  const html = readDist("404.html");
  assert.ok(html.includes("条目已过期或不存在"));
  assert.ok(html.includes(`href="${BASE}/"`), "返回入口");
});

test("来源页：区分原始平台与 Feed 服务提供者，只写核实信息，公开隔离列表区", () => {
  const html = readDist("sources/index.html");
  assert.ok(html.includes("原始平台"), "原始平台段");
  assert.ok(html.includes("Feed 服务提供者"), "Feed 服务提供者段");
  assert.ok(html.includes("rss.aishort.top"), "源地址");
  assert.ok(html.includes("热搜筛选"), "上游筛选如实说明");
  assert.ok(html.includes("尚未核实"), "未核实事项如实说明");
  // 榜单规则官方出处（2026-10-05 裁定落档）：站内引用百度官方规则页
  assert.ok(html.includes("top.baidu.com/board?page=rule"), "榜单规则官方出处链接");
  assert.ok(html.includes("每 5 分钟更新"), "官方更新节奏如实引用");
  // feed 日期语义已核实（2026-10-05）：pubDate＝上游抓取时间，站内如实说明
  assert.ok(html.includes("上游聚合器"), "pubDate 语义核实结论如实说明");
  assert.ok(html.includes("隔离条目"), "隔离列表区");
  assert.ok(html.includes("baidu-aishort"), "公开来源状态 sourceId");
  assert.ok(html.includes("快照时间"), "快照时间分字段");
  assert.ok(html.includes("成功获取时间"), "成功获取时间分字段（不混称更新成功）");
});

test("隔离表 URL 不可点击（审查修复环 R1-I1）：targetUrl 仅作 <code> 纯文本，全站锚点禁用危险协议", () => {
  const html = readDist("sources/index.html");
  // fixture 构造两条隔离记录：http 与协议不合法（javascript:）——按修复方案 a，两者都不可点击
  assert.ok(html.includes("<code>javascript:alert(1)</code>"), "协议不合法 URL 以纯文本展示");
  assert.ok(
    html.includes("<code>https://example.com/s?wd=demo-quarantine</code>"),
    "http 隔离 URL 同样仅纯文本展示",
  );
  assert.ok(!html.includes('<a href="javascript:'), "javascript: 不得成为可点击锚点");
  assert.ok(
    !html.includes('<a href="https://example.com/s?wd=demo-quarantine"'),
    "隔离表 URL 不得成为可点击锚点",
  );
  // 全站兜底：任何页面不得输出 javascript:/data:/vbscript: 协议的锚点
  for (const rel of htmlFiles) {
    const text = readDist(rel);
    for (const proto of ["javascript:", "data:", "vbscript:"]) {
      assert.ok(!text.includes(`href="${proto}`), `${rel} 存在 ${proto} 协议锚点`);
    }
  }
});

test("长文页（关于/原则/隐私）：存在简版目录（锚点可跳，无 JS 可读）", () => {
  for (const page of ["about", "principles", "privacy"]) {
    const html = readDist(`${page}/index.html`);
    assert.ok(html.includes("本页目录"), `${page} 应含目录`);
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    assert.ok(anchors.length >= 2, `${page} 目录至少两个锚点`);
    for (const anchor of anchors) {
      assert.ok(html.includes(`id="${anchor}"`), `${page} 锚点 ${anchor} 有对应章节 id`);
    }
  }
});

test("演示数据标注：数据型页面带「演示数据」标注", () => {
  assert.ok(readDist("index.html").includes("演示数据"));
  assert.ok(readDist("topics/news/index.html").includes("演示数据"));
  assert.ok(readDist(`items/${firstEntry.id}/index.html`).includes("演示数据"));
});

test("脚本形态（Ticket 05 起允许渐进增强；Ticket 06 起 head 启动主题脚本）：仅限本地打包模块、JSON 数据岛与启动内联脚本，无内联事件处理器", () => {
  assert.ok(jsFiles.length >= 1, "客户端增强应产出至少一个本地打包 JS 文件");
  let moduleSrcCount = 0;
  for (const rel of htmlFiles) {
    const html = readDist(rel);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${rel} 不应包含内联事件处理器`);
    let startupCount = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = match[1] ?? "";
      const body = match[2] ?? "";
      const isIsland = /type="application\/json"/i.test(attrs) && /data-kdata/i.test(attrs);
      const isModuleSrc =
        /type="module"/i.test(attrs) &&
        (() => {
          const src = attrs.match(/src="([^"]+)"/i)?.[1] ?? "";
          if (!src.startsWith(`${BASE}/`)) return false;
          // src 必须真实存在于 dist（去掉基路径与查询串）
          const relPath = src.slice(BASE.length + 1).replace(/\?.*$/, "");
          return jsFiles.includes(relPath) || existsSync(join(DIST, relPath));
        })();
      // Ticket 06 FOUC 裁定：head 内联启动脚本（恢复持久化主题 + 打 data-oct-pending 预绘制遮蔽标记）。
      // 不是内联事件处理器（无 on* 属性）；模块失效由脚本内 1500ms 兜底解除遮蔽，内容不会滞留隐藏。
      const isStartupTheme =
        attrs.trim() === "" &&
        body.includes("overthecocoons.theme") &&
        body.includes("data-oct-pending");
      // Ticket 06：GSAP 自托管双脚本（Ticket 08 裁定，SRI 另测）；无 defer/async（解析期执行，
      // 先于 deferred 模块脚本运行，模块初始化时 window.gsap 必已就绪）
      const isGsapVendor =
        /src="[^"]*\/vendor\/(gsap|ScrollTrigger)\.min\.js"/.test(attrs) &&
        !/\sdefer/i.test(attrs) &&
        !/\sasync/i.test(attrs);
      assert.ok(
        isIsland || isModuleSrc || isStartupTheme || isGsapVendor,
        `${rel} 存在非允许形态的脚本：<script ${attrs}>（仅允许 type=module 的本地打包文件、data-kdata JSON 数据岛、head 启动主题脚本与自托管 GSAP 脚本）`,
      );
      if (isModuleSrc) moduleSrcCount++;
      if (isStartupTheme) startupCount++;
    }
    assert.equal(startupCount, 1, `${rel} 应恰有一个 head 启动主题脚本`);
    const headEnd = html.indexOf("</head>");
    const startupAt = html.indexOf("overthecocoons.theme");
    assert.ok(
      startupAt >= 0 && headEnd >= 0 && startupAt < headEnd,
      `${rel} 启动主题脚本必须在 </head> 之前（首帧前执行，否则无法消除闪色/闪动）`,
    );
  }
  assert.ok(moduleSrcCount >= 1, "应存在客户端增强模块脚本");
  // 数据岛正向断言（T05 收尾项）：只有时间线路径（首页/分页/主题页/主题分页）允许携带，
  // 其余任何页面（详情/来源/长文/404）一律不得出现——对 dist 全量 HTML 逐一判定双向。
  const TIMELINE_PAGE =
    /^(index\.html|page\/\d+\/index\.html|topics\/[^/]+\/index\.html|topics\/[^/]+\/page\/\d+\/index\.html)$/;
  assert.ok(htmlFiles.some((rel) => TIMELINE_PAGE.test(rel)), "产物中应存在时间线页（断言前置）");
  for (const rel of htmlFiles) {
    const hasIsland = readDist(rel).includes("data-kdata");
    if (TIMELINE_PAGE.test(rel)) {
      assert.ok(hasIsland, `${rel} 是时间线页，应内嵌客户端数据岛`);
    } else {
      assert.ok(!hasIsland, `${rel} 非时间线页，不应携带数据岛`);
    }
  }
});

test("动效库（Ticket 06 引入，Ticket 08 自托管）：vendor 双脚本 + SRI + crossorigin，位于客户端模块之前，摘要与 dist 内文件实测一致；预绘制遮蔽与 View Transition 样式就位", () => {
  const GSAP_SRI = "sha384-HOvlOYPIs/zjoIkWUGXkVmXsjr8GuZLV+Q+rcPwmJOVZVpvTSXQChiN4t9Euv9Vc";
  const ST_SRI = "sha384-P8VzCVnT9NBUkMrpcIZrJbA7EBjJvh/fJS6PmP+4nLIM284DtsImIv8D0fFjIkeh";
  const vendorTag = (rel: string, file: string): string | undefined =>
    readDist(rel).match(new RegExp(`<script[^>]*src="[^"]*/vendor/${file}"[^>]*>`, "i"))?.[0];
  for (const rel of htmlFiles) {
    const html = readDist(rel);
    const gsapTag = vendorTag(rel, "gsap\\.min\\.js");
    const stTag = vendorTag(rel, "ScrollTrigger\\.min\\.js");
    assert.ok(gsapTag && stTag, `${rel} 应引用自托管 gsap.min.js 与 ScrollTrigger.min.js`);
    assert.ok(
      !/src="https:[^"]*"/i.test(html),
      `${rel} 不得存在任何外链脚本（动效库已自托管，站点运行期零外链）`,
    );
    for (const [tag, sri, distFile] of [
      [gsapTag!, GSAP_SRI, "vendor/gsap.min.js"],
      [stTag!, ST_SRI, "vendor/ScrollTrigger.min.js"],
    ] as const) {
      assert.ok(tag.includes(`integrity="${sri}"`), `${rel} 脚本应带与官方发布一致的 SRI：${sri}`);
      // SRI 摘要与 dist 内实际文件逐字节校验（防止 vendor 文件被改动而标签失真）。
      // 守卫边界（T08 收尾项记录）：本测试只能证明「标签摘要 = dist 内文件摘要」；
      // 「dist 文件 = 官方发布」由 2026-10-03 下载 cdnjs 原件重算 sha384 + T06 复审独立核验
      // 留档，本测试无法在线复核官方源，两者不可互替。
      const actual = createHash("sha384").update(readFileSync(join(DIST, distFile))).digest("base64");
      assert.equal(`sha384-${actual}`, sri, `${rel} 引用的 SRI 必须等于 dist/${distFile} 实测摘要`);
      assert.ok(tag.includes('crossorigin="anonymous"'), `${rel} GSAP 脚本应带 crossorigin`);
      // 执行顺序保证：GSAP 为解析期阻塞脚本（无 defer/async），模块脚本为 deferred，
      // HTML 语义保证 GSAP 先执行——模块初始化时 window.gsap/window.ScrollTrigger 必已就绪
      assert.ok(!/\sdefer/i.test(tag) && !/\sasync/i.test(tag), `${rel} GSAP 脚本不得 defer/async`);
    }
  }
  const css = cssFiles.map(readDist).join("\n");
  assert.ok(css.includes("data-oct-pending"), "预绘制遮蔽选择器应在构建 CSS 中");
  assert.ok(css.includes("view-transition-old(root)"), "View Transition 径向揭示样式应在构建 CSS 中");
  assert.ok(css.includes("k-themefade"), "无 View Transition API 的颜色过渡降级样式应在构建 CSS 中");
});

test("跨页过渡（T11，#28）：@view-transition 导航规则与 header/grain 的 view-transition-name 进入构建 CSS；恢复的动效样式（T14）随构建在位", () => {
  const css = cssFiles.map(readDist).join("\n");
  assert.match(
    css,
    /@view-transition\s*\{[^}]*navigation:\s*auto/,
    "跨页过渡渐进增强规则（不支持的浏览器静默降级为普通导航）",
  );
  assert.match(css, /view-transition-name:\s*k-header/, "header 应设元素级过渡名（防交叉淡化闪动）");
  assert.match(css, /view-transition-name:\s*k-grain/, "grain 应设元素级过渡名（防交叉淡化闪动）");
  // T14（UI 票 #31）动效回补：tilt 层样式、scroll hint 循环 keyframes 恢复在位
  assert.ok(css.includes("k-media-tilt"), "tilt 层样式恢复（T11 移除撤销）");
  assert.ok(css.includes("perspective"), "tilt 的 perspective 恢复");
  assert.ok(css.includes("preserve-3d"), "tilt 的 transform-style: preserve-3d 恢复");
  assert.ok(css.includes("k-hint"), "scroll hint 循环 @keyframes k-hint 恢复");
});

test("will-change 验收锁定（T14 调整，#31）：构建 CSS 中 will-change 声明数不高于 a1ce4d5 基线水平", () => {
  // T14（UI 票 #31）动效回补后合成层按预期回增（视差 ghost/日期、tilt 层、进度线恢复）。
  // a1ce4d5 基线 7 处：.k-indicator、.k-hero-en、.k-hero-date、.k-headline .ch/.k-hero-title .ch
  // （并集选择器计 1）、.k-media、.k-media-tilt、.k-day .k-progress——断言改为「不高于基线」。
  const css = cssFiles.map(readDist).join("\n");
  const count = css.match(/will-change\s*:/g)?.length ?? 0;
  assert.ok(
    count <= 7,
    `构建 CSS 中 will-change 声明应 ≤7（a1ce4d5 基线水平；当前 7 处），实测 ${count} 处`,
  );
});

test("默认主题初值 auto（T4，UI 票 #21）：所有页面 html 标签为 data-theme=auto，auto 深色映射随 prefers-color-scheme 入构建 CSS", () => {
  for (const rel of htmlFiles) {
    const html = readDist(rel);
    assert.match(
      html,
      /<html[^>]*\sdata-theme="auto"/,
      `${rel} 默认主题初值应为 auto（跟随系统），不得硬编码 light`,
    );
  }
  const css = cssFiles.map(readDist).join("\n");
  assert.match(css, /:root\[data-theme=auto\]/, "auto 深色变量映射应在构建 CSS 中");
  assert.match(
    css,
    /@media \(prefers-color-scheme: ?dark\)[^{]*\{[^@]*?:root\[data-theme=auto\]/,
    "auto 深色映射必须挂在 prefers-color-scheme 媒体查询下（无 JS 亦生效）",
  );
});

test("过场面板死代码已删除（T4，UI 票 #21）：k-transition 样式与 data-ktrans DOM、--z-trans 变量全仓零残留", () => {
  const all = [
    ...htmlFiles.map((rel) => readDist(rel)),
    ...cssFiles.map((rel) => readDist(rel)),
    ...jsFiles.map((rel) => readDist(rel)),
  ].join("\n");
  for (const needle of ["k-transition", "k-trans-num", "k-trans-label", "k-trans-note", "ktrans", "z-trans"]) {
    assert.ok(!all.includes(needle), `构建产物中不得残留死代码标识「${needle}」`);
  }
});

test("数据岛内容与构建快照一致（字段、条数、基路径）", () => {
  for (const rel of ["index.html", "page/2/index.html", "topics/news/index.html"]) {
    const html = readDist(rel);
    const island = firstMatch(
      html,
      /<script[^>]*type="application\/json"[^>]*data-kdata[^>]*>([\s\S]*?)<\/script>/,
    );
    assert.ok(island, `${rel} 应包含数据岛`);
    assert.ok(!island!.includes("<"), "数据岛内容不得包含裸 < 字符");
    const parsed = JSON.parse(island!) as { base: string; isFixture: boolean; entries: PublicEntry[] };
    assert.equal(parsed.base, BASE);
    assert.equal(parsed.isFixture, snapshot.isFixture);
    assert.equal(parsed.entries.length, snapshot.entries.length);
    assert.deepEqual(
      Object.keys(parsed.entries[0]!).sort(),
      ["firstSeenAt", "id", "summary", "title", "topic", "url"],
    );
  }
});

test("自定义光标语义标记覆盖（UI 票 #14）：可点击元素都带标记、未启用控件不带", () => {
  const html = readDist("index.html");
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  const marked = (tag: string) => tag.includes("data-cursor");

  // 首页应同时出现两档标记（断言前置：覆盖不成立时下面的「全带」是空真）
  assert.ok(anchors.some((t) => t.includes('data-cursor="VIEW"')), "应存在完整语义态锚点");
  assert.ok(anchors.some((t) => t.includes("data-cursor-soft")), "应存在轻量可点击态锚点");

  // 完整语义态：内容入口三类的数量（每页 20 条）
  assert.equal(
    anchors.filter((t) => t.includes('data-cursor="VIEW"')).length,
    20,
    "每页 20 条条目标题链接都应带 VIEW",
  );
  assert.equal(
    [...html.matchAll(/data-cursor="OPEN"/g)].length,
    18,
    "标准条目占位版画带 OPEN（首页 20 条中 2 条无摘要走紧凑行，无版画；fixtures 前置）",
  );
  assert.ok(anchors.some((t) => t.includes('data-cursor="LINK"')), "条目外链应带 LINK");

  // 轻量可点击态：次级控件（品牌 / 主题 tab / 模式按钮 / 菜单入口 / 返回顶部 / 分页 / 页脚导航 / 左栏导航 / 菜单项 / HUD）
  assert.match(html, /<a class="k-brand"[^>]*data-cursor-soft/, "品牌标识带轻量态");
  assert.match(html, /<button class="mode-btn"[^>]*data-cursor-soft/, "显示模式按钮带轻量态");
  assert.match(html, /<button class="k-menu-open"[^>]*data-cursor-soft/, "菜单入口带轻量态");
  assert.match(html, /<button class="k-top"[^>]*data-cursor-soft/, "返回顶部带轻量态");
  assert.match(html, /<button class="k-menu-close"[^>]*data-cursor-soft/, "菜单关闭带轻量态");
  assert.match(html, /<a class="k-mi"[^>]*data-cursor-soft/, "菜单导航项带轻量态");

  // 全站契约：所有锚点与按钮都必须带某一档标记（新增可点击元素漏标即失败）
  const unmarkedAnchors = anchors.filter((t) => !marked(t));
  assert.deepEqual(unmarkedAnchors, [], "所有锚点都应带语义标记");
  const unmarkedButtons = buttons.filter((t) => !marked(t));
  assert.deepEqual(unmarkedButtons, [], "所有按钮都应带语义标记");

  // 未启用控件：分页边界项是 <span aria-disabled>，不得给任何可点击态
  const disabledPageBtns = [...html.matchAll(/<span class="page-btn"[^>]*>/g)].map((m) => m[0]);
  assert.ok(disabledPageBtns.length > 0, "首页应有未启用的分页边界项（断言前置）");
  assert.deepEqual(
    disabledPageBtns.filter((t) => marked(t)),
    [],
    "未启用的分页边界项不应带任何可点击态标记",
  );
  assert.ok(!/<span class="of"[^>]*data-cursor/.test(html), "页码说明文本不应带标记");

  // 详情页：返回时间线（站内）与复制链接（按钮）都属次级控件
  const detailRel = htmlFiles.find((rel) => /^items\/[0-9a-f]{64}\/index\.html$/.test(rel));
  assert.ok(detailRel, "产物中应存在详情页（断言前置）");
  const detail = readDist(detailRel!);
  assert.match(detail, /<a href="[^"]*topics\/[^"]*" data-cursor-soft>← 返回时间线<\/a>/, "详情页返回链接带轻量态");
  assert.match(detail, /<button class="ext" type="button" data-copy-link data-cursor-soft/, "复制链接按钮带轻量态");

  // 空态与 404 的出口按钮同样带轻量态
  assert.match(
    readDist("topics/philosophy/index.html"),
    /<a class="page-btn" data-all data-cursor-soft/,
    "空态「查看全部」带轻量态",
  );
  assert.match(
    readDist("404.html"),
    /<a class="page-btn" href="[^"]*" data-cursor-soft>返回公共时间线<\/a>/,
    "404 出口带轻量态",
  );
});

test("隐私约束：无统计/广告/外部字体/CDN 引用（HTML、CSS 与本地 JS 一并检查；Ticket 08 起动效库自托管，产物零外链）", () => {
  const forbidden = [
    "googletagmanager", "google-analytics", "gtag(", "hm.baidu.com", "cnzz",
    "adsbygoogle", "doubleclick", "fonts.googleapis.com", "fonts.gstatic.com",
    "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
  ];
  for (const rel of [...htmlFiles.map((f) => f), ...cssFiles, ...jsFiles]) {
    const text = readDist(rel).toLowerCase();
    for (const marker of forbidden) {
      assert.ok(!text.includes(marker), `${rel} 不应包含 ${marker}`);
    }
  }
  // 站点运行期零外链：任何 HTML 不得外链脚本（GSAP 已自托管），样式表与字体等外链资源一律禁止
  for (const rel of htmlFiles) {
    const html = readDist(rel);
    assert.ok(
      !/<script[^>]*src="https?:/i.test(html),
      `${rel} 不得外链任何脚本（Ticket 08 自托管裁定：站内资源零外链）`,
    );
    assert.ok(
      !/<link[^>]*href="https?:/i.test(html),
      `${rel} 不得外链样式表/字体等资源`,
    );
  }
});

test("基路径：所有 HTML 的本地绝对引用（href/src）都带 /overthecocoons 前缀", () => {
  for (const rel of htmlFiles) {
    const html = readDist(rel);
    const refs = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]!);
    for (const ref of refs) {
      assert.ok(
        ref === BASE || ref.startsWith(`${BASE}/`),
        `${rel} 中的本地引用 ${ref} 未带基路径`,
      );
    }
  }
});

test("样式经基路径加载且含 v4 设计 token（暖纸白/墨黑/暗红）", () => {
  const html = readDist("index.html");
  const cssHref = firstMatch(html, /<link rel="stylesheet" href="([^"]+)"/);
  assert.ok(cssHref?.startsWith(`${BASE}/`), "样式表链接带基路径");
  // 构建产物 CSS 经压缩，token 值统一小写比较
  const css = cssFiles.map(readDist).join("\n").toLowerCase();
  assert.ok(css.includes("--paper:#f8f5ec"), "纸色 token");
  assert.ok(css.includes("--ink:#211e1b"), "墨色 token");
  assert.ok(css.includes("--accent:#8f262b"), "暗红 token");
  assert.ok(css.includes("--serif:georgia"), "衬线字体栈（系统字体，无外部字体）");
  // T14（UI 票 #31）：k-dot 脉动恢复（T1 移除的 k-pulse 回归）
  assert.ok(css.includes("k-pulse"), "k-dot 脉动动画恢复（@keyframes k-pulse 在构建 CSS 中）");
});

test("无 JS 导航兜底：左栏功能导航、页脚导航与页脚主题导航均渲染为真实链接", () => {
  const html = readDist("index.html");
  for (const label of ["时间线", "来源", "关于", "原则", "隐私"]) {
    assert.ok(html.includes(`>${label}</a>`), `导航应包含 ${label} 链接`);
  }
  // 页脚主题导航（T04 收尾项）：≤767px 时 header 主题 Tab 隐藏，无 JS 用户经页脚进入主题页
  for (const topic of TOPICS) {
    assert.ok(
      html.includes(`>${topic}</a>`),
      `页脚主题导航应包含「${topic}」链接（无 JS 主题筛选入口）`,
    );
  }
  assert.ok(html.includes("<nav"), "存在 nav 语义元素");
  assert.ok(html.includes("<article"), "条目使用 article 语义元素");
  assert.ok(html.includes("<dialog"), "全屏菜单保留 dialog 结构（T06 挂点）");
});

test("展示字体子集自托管（T12，#29）：woff2 + OFL + 可机读清单入 dist，全部页面 preload（crossorigin）且指向基路径下同一文件", () => {
  const fontRel = collectFiles(DIST, ".woff2");
  assert.ok(
    fontRel.includes("fonts/SourceHanSerifSC-Heavy-Subset.woff2"),
    `dist/fonts/ 应含展示字体子集，实际：${fontRel.join(", ") || "（无）"}`,
  );
  assert.ok(existsSync(join(DIST, "fonts/OFL.txt")), "OFL 许可文本应随产物部署");
  assert.ok(existsSync(join(DIST, "fonts/display-charset.json")), "字集可机读清单应随产物部署");
  // 子集体积上限（票面：数百 KB 内；超限 = 字集混入冗余）
  const size = statSync(join(DIST, "fonts/SourceHanSerifSC-Heavy-Subset.woff2")).size;
  assert.ok(size <= 500_000, `woff2 体积 ${size} B 超出 500KB 上限`);
  // 每个页面都有 preload（BaseLayout 全局共享），显式 crossorigin 与 as/type（字体请求恒 CORS 模式）
  const preload = /<link rel="preload" as="font" type="font\/woff2" href="([^"]+)" crossorigin="anonymous"/;
  for (const rel of htmlFiles) {
    const m = readDist(rel).match(preload);
    assert.ok(m, `${rel} 应含展示字体 preload 标签`);
    assert.ok(
      m![1]!.startsWith(`${BASE}/fonts/`),
      `${rel} preload href ${m![1]} 应指向基路径下 /fonts/`,
    );
  }
  // preload 与 @font-face 指向同一文件（审查修复后 @font-face 内联于 HTML head，
  // URL 经 BASE_URL 拼接——dev 与产物同一地址，命中同一请求不二次下载）
  const homeHtml = readDist("index.html");
  const faceSrc = homeHtml.match(/@font-face\{[^}]*?url\("?([^)"]+)"?\)/);
  assert.ok(faceSrc, "构建 HTML 应含内联 @font-face");
  assert.ok(faceSrc![1]!.includes("fonts/SourceHanSerifSC-Heavy-Subset.woff2"), "@font-face src 应指向子集文件");
  assert.ok(faceSrc![1]!.startsWith(`${BASE}/fonts/`), `@font-face src ${faceSrc![1]} 应指向基路径下 /fonts/`);
  const preloadHref = readDist("index.html").match(/<link rel="preload" as="font" type="font\/woff2" href="([^"]+)"/)?.[1];
  assert.equal(preloadHref, faceSrc![1], "preload 与 @font-face 应命中同一 URL");
});

test("展示字体接入（T12，#29）：--font-display token + font-display:swap + 票面大字槽位全部切换（兜底栈保持 serif）", () => {
  const css = cssFiles.map(readDist).join("\n");
  // 压缩后引号可能被移除，族名按裸名断言
  assert.ok(css.includes("Source Han Serif SC Heavy Subset"), "@font-face 族名应与字集清单一致");
  assert.match(readDist("index.html"), /font-display: ?swap/, "font-display: swap（内联 @font-face，加载失败/被禁时兜底栈完整可读）");
  assert.match(css, /--font-display:/, "--font-display token 应存在");
  assert.ok(css.includes('var(--font-display)'), "token 应组合子集族名与既有 serif 兜底栈");
  // 票面大字槽位（站名/Hero 标题/Hero ghost/Hero 日期大字/KPageHead 大字/日组头大字/
  // 菜单大字项与序号/菜单 ghost/长文 h1）全部使用 --font-display
  for (const selector of [".k-brand", ".k-hero-en", ".k-hero-title", ".k-hero-date .d", ".k-pagehead-big", ".k-day-big", ".k-mi .no", ".k-mi .lb", ".k-menu-data .ghost", ".k-doc h1"]) {
    const re = new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{[^}]*var\\(--font-display\\)`);
    assert.match(css, re, `${selector} 应使用 --font-display`);
  }
  // 非大字槽位不被波及：正文 h2 与批次行仍走既有 serif（条目标题等动态数据不进子集字集）
  assert.match(css, /\.k-doc h2\{[^}]*var\(--serif\)/, "长文 h2 保持既有 serif（不在大字槽位清单）");
  assert.match(css, /\.k-day-batch\{[^}]*var\(--serif\)/, "日组批次行保持既有 serif（不在大字槽位清单）");
});

test("丝线 B 版 rail 静态呈现（T13，#30；T14 追改灰线）与逐日进度线（T14，#31）：灰线 rail + 日组钉点 + 红色进度线可见，Hero 丝线仅 Hero 页", () => {
  const html = readDist("index.html");
  assert.ok(html.includes('class="k-line"'), "rail 元素在位（T14 追改：旧灰线样式）");
  assert.ok(html.includes('class="silk-pin-wrap"'), "日组 rail 顶钉点");
  assert.equal(
    (html.match(/class="k-line"/g) ?? []).length,
    (html.match(/<section class="k-day"/g) ?? []).length,
    "每个日组各一段 rail",
  );
  assert.equal(
    (html.match(/class="silk-pin-wrap"/g) ?? []).length,
    (html.match(/<section class="k-day"/g) ?? []).length,
    "每个日组各一枚钉点",
  );
  // T14（UI 票 #31）：k-progress 进度线叠合恢复（每个日组一段，rail 之上；ADR 0006 取代 ADR 0005 替代段）
  assert.equal(
    (html.match(/class="k-progress"/g) ?? []).length,
    (html.match(/<section class="k-day"/g) ?? []).length,
    "每个日组各一段进度线（T14 恢复，叠合 rail）",
  );
  // T14 追改：rail 回归旧灰线（1px var(--rule) + 暗色 45% accent 混 rule），无 silk-rail 覆盖残留；
  // 进度线保持 2px accent 可见（a1ce4d5 形态：scaleY(0) 起始 + will-change）
  const css = cssFiles.map(readDist).join("\n");
  assert.match(css, /\.k-day \.k-line\{[^}]*background:var\(--rule\)/, "rail 灰线（旧样式）");
  assert.match(
    css,
    /\[data-theme=dark\] \.k-day \.k-line\{[^}]*color-mix\(in srgb, ?var\(--accent\) 45%, ?var\(--rule\)\)/,
    "rail 暗色 45% accent 混 rule 变体恢复",
  );
  assert.ok(!css.includes(".silk-rail"), "silk-rail 覆盖规则零残留");
  assert.ok(!html.includes("silk-rail"), "HTML 无 silk-rail 类残留");
  assert.match(
    css,
    /\.k-day \.k-progress\{[^}]*transform:scaleY\(0\)/,
    "进度线 scaleY(0) 起始（T14 恢复 a1ce4d5 形态）",
  );
  // Hero 静态丝线仅首页（Hero 仅时间线第一页，票 #25）；主题/分页页 rail 从首个日组顶起
  assert.ok(html.includes('class="silk-anchor"'), "「茧」字丝线挂点");
  for (const rel of ["page/2/index.html", "topics/news/index.html"]) {
    const noHero = readDist(rel);
    assert.ok(!noHero.includes("silk-static"), `${rel} 无 Hero 页不渲染 Hero 丝线`);
    assert.ok(noHero.includes('class="k-line"'), `${rel} rail 照常（灰线）`);
    assert.ok(noHero.includes('class="k-progress"'), `${rel} 进度线照常（T14 恢复）`);
  }
  // 客户端重渲染模板同构：JS bundle 内含 rail/钉点/丝纹/进度线注入
  const js = jsFiles.map(readDist).join("\n");
  assert.ok(js.includes('class="k-line"'), "客户端 dayGroups 模板带 rail（T14 追改灰线，同构）");
  assert.ok(js.includes("silk-pin-wrap"), "客户端 dayGroups 模板带钉点");
  assert.ok(js.includes("silk-texture"), "客户端版画模板注入丝纹（与构建期同一 src/lib/silk.ts）");
  assert.ok(js.includes("k-progress"), "客户端 dayGroups 模板带进度线（T14 恢复，同构）");
});

test("靛色站外信号（T13，#30）：token 两主题入 CSS，外链全染 ext、站内链接零染色（全产物逐锚点判定）", () => {
  const css = cssFiles.map(readDist).join("\n").toLowerCase();
  assert.ok(css.includes("--indigo:#2f5168"), "浅色靛 token");
  assert.ok(css.includes("--indigo:#8db3c9"), "深色靛 token");
  assert.match(css, /a\.ext\{color:var\(--indigo\)/, "外链规则用靛 token（全局 a.ext）");
  assert.match(css, /\.k-hud \.k-link\.ext\{color:var\(--indigo\)/, "HUD 站外链接靛色覆盖（票面优先于原型，ADR 0005）");
  // 全产物逐锚点：class 含 ext ⇔ href 为跨源绝对 http(s)（确定性规则 links.isExternalUrl 的产物级对照）
  const SITE_ORIGIN = "https://caiyan12.github.io";
  let externalCount = 0;
  for (const rel of htmlFiles) {
    for (const m of readDist(rel).matchAll(/<a\b([^>]*)>/g)) {
      const tag = m[1] ?? "";
      const href = tag.match(/href="([^"]*)"/)?.[1] ?? "";
      const cls = tag.match(/class="([^"]*)"/)?.[1] ?? "";
      const hasExt = /(?:^|\s)ext(?:\s|$)/.test(cls);
      let isExternal = false;
      if (/^https?:\/\//.test(href)) {
        isExternal = new URL(href).origin !== SITE_ORIGIN;
      }
      if (isExternal) {
        externalCount++;
        assert.ok(hasExt, `${rel} 站外链接缺 ext 类：${href}`);
        assert.ok(tag.includes('target="_blank"'), `${rel} 站外链接应保持 target=_blank：${href}`);
      } else {
        assert.ok(!hasExt, `${rel} 非站外链接被染 ext（站内不得染靛）：${href || "（无 href）"}`);
      }
    }
  }
  assert.ok(externalCount >= 8, `产物中应存在足量站外链接锚点（条目外链×20 + HUD/长文页），实测 ${externalCount}`);
  // 复制链接按钮不染靛（复制的是本站 URL，站内动作）——断言构建 CSS 中的 button.ext 规则
  assert.match(css, /button\.ext\{[^}]*color:inherit/, "复制链接按钮保持墨色（不伪造站外信号）");
});

test("丝纹确定性注入产物（T13，#30）：标准行版画带丝纹与 ID 前缀，同条目跨页/详情页同纹理、条目间互异", () => {
  const textureOf = (html: string): string =>
    [...html.matchAll(/<svg class="silk-texture"[^>]*>([\s\S]*?)<\/svg>/g)]
      .map((m) => [...m[1]!.matchAll(/ d="([^"]+)"/g)].map((d) => d[1]).join("|"))
      .join("||");
  const idOf = (chunk: string): string | null =>
    chunk.match(new RegExp(`href="${BASE}/items/([0-9a-f]{64})/"`))?.[1] ?? null;

  const indexHtml = readDist("index.html");
  const timelineTextures = new Map<string, string>();
  for (const chunk of entryChunks(indexHtml)) {
    const id = idOf(chunk);
    const tex = textureOf(chunk);
    if (id && tex) timelineTextures.set(id, tex);
  }
  assert.equal(textureOf(indexHtml).split("||").length, 18, "首页 18 个标准行版画各有丝纹（20 条 − 2 紧凑行）");
  assert.equal(timelineTextures.size, 18, "18 条标准行条目均有 ID↔丝纹映射");
  assert.equal(new Set(timelineTextures.values()).size, 18, "不同条目丝纹两两互异（构建期确定性派生）");
  // 紧凑行无版画即无丝纹
  const compactChunk = entryChunks(indexHtml).find((c) => c.startsWith(" layout-compact"))!;
  assert.ok(!compactChunk.includes("silk-texture"), "紧凑行无丝纹（无版画）");

  // 同条目跨页同纹理：新闻主题页中与本页交集的条目
  const newsHtml = readDist("topics/news/index.html");
  for (const chunk of entryChunks(newsHtml)) {
    const id = idOf(chunk);
    const tex = textureOf(chunk);
    if (id && tex && timelineTextures.has(id)) {
      assert.equal(tex, timelineTextures.get(id), `条目 ${id.slice(0, 6)}… 在主题页与首页丝纹一致`);
    }
  }
  // 详情页与时间线同纹理，sid 前缀＝稳定 ID 前 6 位
  const detailHtml = readDist(`items/${firstEntry.id}/index.html`);
  assert.equal(textureOf(detailHtml), timelineTextures.get(firstEntry.id), "详情页丝纹与时间线同条目一致");
  assert.ok(detailHtml.includes(`#${firstEntry.id.slice(0, 6)}…`), "sid 前缀为稳定 ID 前 6 位");
  // aria-hidden 语义不变（T9 口径延续）
  const firstChunk = entryChunks(indexHtml).find((c) => c.includes("silk-texture"))!;
  assert.match(
    firstChunk,
    /<svg class="silk-texture" viewBox="0 0 264 198" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">/,
    "丝纹 SVG 为纯装饰 aria-hidden",
  );
});
