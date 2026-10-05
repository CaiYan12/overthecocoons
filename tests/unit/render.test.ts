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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PublicEntry, PublicSnapshot } from "../../src/domain/contract.ts";
import { sortEntriesDesc, EN_LABEL, TOPICS, topicPagePath } from "../../src/lib/timeline.ts";

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
  assert.ok(html.includes("跳　出") && html.includes("茧　房"), "Hero 双行大字标题");
  assert.ok(html.includes('class="k-hero-rule"'), "尺规线");
  assert.ok(html.includes('class="k-hero-date"'), "Hero 幽灵日期");
  assert.ok(html.includes('class="k-hero-meta"'), "Hero 元信息列表");
  assert.ok(html.includes('class="k-cols hud-first"'), "三栏容器（时间线页 HUD 移动端前置，UI 票 #10）");
  assert.ok(html.includes('class="k-hud"'), "右侧 HUD");
  assert.ok(html.includes("<footer"), "页脚");
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
  const tabs = tabsNav!.match(/<a class="tab" role="tab" aria-current="(true|false)" data-topic="[^"]+"/g);
  assert.ok(tabs, "应存在 a.tab 元素");
  assert.equal(tabs.length, 12);
  assert.ok(tabsNav!.includes('aria-current="true" data-topic="全部"'));
  // 全屏菜单里还有一份主题列表（T06 挂点），同样 12 个
  const menuTopics = firstMatch(html, /(<div class="k-menu-topics"[\s\S]*?<\/div>)/);
  assert.equal((menuTopics?.match(/class="tab" /g) ?? []).length, 12);
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

test("日内权重三档与数据版画结构正确（每日首条头条，A/B 版面交替）", () => {
  const html = readDist("index.html");
  const chunks = entryChunks(html);
  const classes = chunks.map((c) => {
    const m = c.match(/^ ([\w-]+) ([\w-]+)"/);
    return m ? [m[1], m[2]] : null;
  });
  assert.deepEqual(classes[0], ["layout-c", "w1"], "每日首条为头条（layout-c + w1）");
  assert.deepEqual(classes[1], ["layout-a", "w2"]);
  assert.deepEqual(classes[2], ["layout-b", "w3"]);
  assert.deepEqual(classes[3], ["layout-a", "w3"]);
  // 第二个日期组首条重新从头条权重开始
  const secondDayStart = html.indexOf('<section class="k-day" data-day', 1 + html.indexOf('<section class="k-day" data-day'));
  const afterSecondDay = html.slice(secondDayStart);
  const secondDayFirst = entryChunks(afterSecondDay)[0];
  assert.match(secondDayFirst ?? "", /layout-c w1/, "每个日期组首条独立分配头条权重");

  const first = chunks[0]!;
  assert.ok(first.includes('class="k-media"'), "数据版画外层");
  assert.ok(first.includes('class="k-media-tilt"'), "tilt 层");
  assert.ok(first.includes('class="k-media-art"'), "art 层");
  const firstLab = EN_LABEL[firstEntry.topic];
  assert.match(first, new RegExp(`aria-label="编辑占位图：${firstLab}"`));
  assert.ok(first.includes(`<span class="lab" aria-hidden="true">${firstLab}</span>`), "竖排主题词");
  assert.match(first, /<span class="num" aria-hidden="true">\d{2}<\/span>/, "出血大序号");
  assert.match(first, /<span class="tm">\d{2}:\d{2}<\/span>/, "色块时间");
  assert.ok(first.includes('data-cursor="VIEW ↗"'), "T06 光标挂点保留");
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

test("HUD：NOW READING 总数随主题口径变化，来源与快照时间呈现", () => {
  // data-total 是 T06 挂点属性，总数渲染为其元素文本
  assert.match(readDist("index.html"), /<span data-total>45<\/span>/, "全部=45");
  assert.match(readDist("topics/news/index.html"), /<span data-total>23<\/span>/, "新闻=23");
  assert.match(readDist("topics/philosophy/index.html"), /<span data-total>00<\/span>/, "空主题=00");
  const hud = readDist("index.html");
  assert.ok(hud.includes("百度热点"), "SOURCE 名称");
  assert.ok(hud.includes("BAIDU HOT · 热点线索"), "SOURCE 副标");
  assert.match(hud, /LIVE · 快照 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/, "快照时间");
  assert.ok(hud.includes('aria-live="polite"'), "aria-live 播报挂点");
});

test("详情页：/items/<64hex>/ 直达，标题/摘要/来源/收录时间/主题/占位图与独立百度入口齐备", () => {
  const html = readDist(`items/${firstEntry.id}/index.html`);
  assert.ok(html.includes("<h1"), "详情页 h1");
  assert.ok(html.includes("查看百度搜索结果"), "独立百度搜索入口");
  assert.ok(html.includes(`href="${firstEntry.url}"`), "外链指向条目目标链接");
  assert.ok(html.includes('aria-label="编辑占位图'), "占位图保留");
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
  assert.ok(anchors.some((t) => t.includes('data-cursor="VIEW ↗"')), "应存在完整语义态锚点");
  assert.ok(anchors.some((t) => t.includes("data-cursor-soft")), "应存在轻量可点击态锚点");

  // 完整语义态：内容入口三类的数量（每页 20 条）
  assert.equal(
    anchors.filter((t) => t.includes('data-cursor="VIEW ↗"')).length,
    20,
    "每页 20 条条目标题链接都应带 VIEW ↗",
  );
  assert.equal(
    [...html.matchAll(/data-cursor="OPEN"/g)].length,
    20,
    "每页 20 条占位版画都应带 OPEN",
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
