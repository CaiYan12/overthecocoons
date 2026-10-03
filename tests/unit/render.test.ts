/**
 * 构建产物断言（Ticket 04 起，Ticket 05 演进）：直接读取 dist 文本，验证基路径、时间线倒序与分页结构、
 * 空主题真实空态、详情页与 404、长文页目录、来源页、隐私约束（无统计/广告/外部字体；
 * 脚本仅限本地打包模块与 JSON 数据岛）。
 *
 * 前置条件：先运行 `pnpm build`（`pnpm test` 的脚本顺序已保证 build 在 test:node 之前）。
 * 本测试不启动服务器、不访问网络；GitHub Pages 线上行为另行验收，不在此冒充。
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PublicEntry, PublicSnapshot } from "../../src/domain/contract.ts";
import { sortEntriesDesc, EN_LABEL, topicPagePath } from "../../src/lib/timeline.ts";

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
  assert.ok(html.includes('class="k-cols"'), "三栏容器");
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
  assert.ok(philosophy.includes("这里显示真实空状态"), "空态说明");
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

test("脚本形态（Ticket 05 起允许渐进增强）：仅限本地打包模块与 JSON 数据岛，无内联事件处理器", () => {
  assert.ok(jsFiles.length >= 1, "客户端增强应产出至少一个本地打包 JS 文件");
  let moduleSrcCount = 0;
  let islandCount = 0;
  for (const rel of htmlFiles) {
    const html = readDist(rel);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${rel} 不应包含内联事件处理器`);
    for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = match[1] ?? "";
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
      assert.ok(
        isIsland || isModuleSrc,
        `${rel} 存在非允许形态的脚本：<script ${attrs}>（仅允许 type=module 的本地打包文件与 data-kdata JSON 数据岛）`,
      );
      if (isIsland) islandCount++;
      if (isModuleSrc) moduleSrcCount++;
    }
  }
  assert.ok(moduleSrcCount >= 1, "应存在客户端增强模块脚本");
  // 数据岛只出现在时间线页（需要客户端筛选分页的页面），说明页不携带
  assert.ok(islandCount >= 1, "时间线页应内嵌客户端数据岛");
  for (const page of ["about", "principles", "privacy", "sources"]) {
    assert.ok(
      !readDist(`${page}/index.html`).includes("data-kdata"),
      `${page} 页不应携带数据岛`,
    );
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

test("隐私约束：无统计/广告/外部字体/CDN 引用（HTML、CSS 与本地 JS 一并检查）", () => {
  const forbidden = [
    "googletagmanager", "google-analytics", "gtag(", "hm.baidu.com", "cnzz",
    "adsbygoogle", "doubleclick", "fonts.googleapis.com", "fonts.gstatic.com",
    "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "gsap",
  ];
  for (const rel of [...htmlFiles.map((f) => f), ...cssFiles, ...jsFiles]) {
    const text = readDist(rel).toLowerCase();
    for (const marker of forbidden) {
      assert.ok(!text.includes(marker), `${rel} 不应包含 ${marker}`);
    }
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

test("无 JS 导航兜底：左栏功能导航与页脚导航均渲染为真实链接", () => {
  const html = readDist("index.html");
  for (const label of ["时间线", "来源", "关于", "原则", "隐私"]) {
    assert.ok(html.includes(`>${label}</a>`), `导航应包含 ${label} 链接`);
  }
  assert.ok(html.includes("<nav"), "存在 nav 语义元素");
  assert.ok(html.includes("<article"), "条目使用 article 语义元素");
  assert.ok(html.includes("<dialog"), "全屏菜单保留 dialog 结构（T06 挂点）");
});
