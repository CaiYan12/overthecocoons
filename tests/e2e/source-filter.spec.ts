/**
 * 来源多选面板与时间线交集过滤（Issue #34）——真实构建产物的公开页面交互。
 *
 * 数据：fixtures/snapshot-sources.json（确定性多源夹具，56 条 / 六源 / 主题 科技33·社会9·新闻8·文化6），
 * 由 playwright.config.ts 的第二 webServer 注入构建到 .snapshot/sources-dist 并在 4323 提供服务。
 * 期望值一律从夹具推导（不硬编码实时上游条数），断言只用公开 DOM 语义：可访问名称、可见内容、
 * 真实 URL、条目身份、页码、焦点、滚动与渲染中间帧。
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicEntry } from "../../src/domain/contract.ts";
import { sortEntriesDesc } from "../../src/lib/timeline.ts";
import { filterTimeline } from "../../src/lib/source-filter.ts";
import { contrastRatio, pickTopic, samplePixels } from "./helpers.ts";

const BASE = "/overthecocoons/";
const SOURCES_BASE = "http://127.0.0.1:4323";
test.use({ baseURL: SOURCES_BASE });

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "snapshot-sources.json"), "utf-8"),
) as { entries: PublicEntry[] };
const sorted = sortEntriesDesc(snapshot.entries);
const ALL = [
  "baidu-aishort",
  "chinanews-society",
  "chinanews-world",
  "chinanews-dxw",
  "geekpark",
  "solidot",
];

/** 已构建站点就绪（客户端增强模块执行完成）。 */
async function ready(page: Page, path = ""): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('html[data-oct-client="ready"]');
}

const dialog = (page: Page) => page.locator("dialog[data-ksource]");
const entryButton = (page: Page) => page.locator("button[data-source-open]");

async function openPanel(page: Page): Promise<void> {
  await entryButton(page).click();
  await expect(dialog(page)).toHaveJSProperty("open", true);
  await expect(dialog(page)).toHaveAttribute("data-source-state", "open");
}

/** 按来源 ID 切换面板草稿（真实点击 label，与用户路径一致）。 */
async function toggle(page: Page, sourceId: string, checked: boolean): Promise<void> {
  const input = page.locator(`.k-source-input[value="${sourceId}"]`);
  if ((await input.isChecked()) !== checked) await page.locator(`.k-source-option:has(.k-source-input[value="${sourceId}"])`).click();
}

async function apply(page: Page): Promise<void> {
  await page.locator("[data-ksource-apply]").click();
  await expect(dialog(page)).toHaveJSProperty("open", false);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
}

/** 把草稿设为给定来源集合后应用。 */
async function applySources(page: Page, sources: string[]): Promise<void> {
  await openPanel(page);
  for (const id of ALL) await toggle(page, id, sources.includes(id));
  await apply(page);
}

async function statusText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector("[data-status]")?.textContent ?? "");
}

async function entryIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>(".k-entry .k-headline a[data-detail]")].map(
      (anchor) => anchor.getAttribute("href")!.split("/items/")[1]!.replace(/\/$/, ""),
    ),
  );
}

/**
 * 列表结构快照：剔除动画写入的内联样式后再比较。
 * 滚动进度线（.k-progress）与揭示初态由 ScrollTrigger/GSAP 持续改写 style，
 * 与「是否重渲染」无关；结构与文案（标签、类名、data-*、文本）全部保留。
 */
async function listStructure(page: Page): Promise<string> {
  return page.locator("[data-klist]").evaluate((el) => el.innerHTML.replace(/\sstyle="[^"]*"/g, ""));
}

test.describe("入口与面板结构", () => {
  test("时间线 HUD 的 SOURCE 标题是入口；打开后为原生模态「选择来源」", async ({ page }) => {
    await ready(page);
    const entry = entryButton(page);
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("aria-haspopup", "dialog");
    await expect(entry).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await openPanel(page);
    await expect(entry).toHaveAttribute("aria-expanded", "true");
    await expect(dialog(page).getByRole("heading", { name: "选择来源" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "关闭 ✕" })).toBeFocused();
    // 内容型 HUD（详情页）不增加筛选入口
    const href = await page.locator(".k-headline a[data-detail]").first().getAttribute("href");
    await page.goto(href!);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator("[data-source-open]")).toHaveCount(0);
    await expect(page.locator("[data-ksource]")).toHaveCount(0);
  });

  test("六个订阅名称与次序固定，中新网三频道分别可选", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    const labels = dialog(page).locator(".k-source-option .k-source-label");
    await expect(labels).toHaveText(["百度热点", "中新网·社会", "中新网·国际", "中新网·东西问", "极客公园", "Solidot"]);
    const values = await dialog(page).locator(".k-source-input").evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
    expect(values).toEqual(ALL);
    // 逐个可独立选择：只勾 Solidot 时其他五项必须为未选
    for (const id of ALL) await toggle(page, id, id === "solidot");
    for (const id of ALL) {
      await expect(page.locator(`.k-source-input[value="${id}"]`)).toBeChecked({ checked: id === "solidot" });
    }
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
  });

  test("全选三态：全选 → 取消一项变部分 → 全取消为未选", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    const all = dialog(page).locator("[data-ksource-all-input]");
    await expect(all).toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
    await toggle(page, "solidot", false);
    await expect(all).not.toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 5 / 6 个订阅源");
    // 规格：部分/未选时点击全选控件 → 勾满六项（不是清空）
    await dialog(page).locator(".k-source-all").click();
    await expect(all).toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 6 / 6 个订阅源");
    // 全选态再点一次 → 取消全部（零项草稿）
    await dialog(page).locator(".k-source-all").click();
    await expect(all).not.toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("至少选择一个来源");
    for (const id of ALL) {
      await expect(page.locator(`.k-source-input[value="${id}"]`)).not.toBeChecked();
    }
  });
});

test.describe("草稿隔离与取消族", () => {
  test("勾选只改草稿，正文与入口文案不变；取消后重开回到已应用状态", async ({ page }) => {
    await ready(page);
    const before = await entryIds(page);
    await openPanel(page);
    for (const id of ALL) await toggle(page, id, id === "geekpark");
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
    // 正文与入口文案都不被草稿污染
    expect(await entryIds(page)).toEqual(before);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await openPanel(page);
    for (const id of ALL) await expect(page.locator(`.k-source-input[value="${id}"]`)).toBeChecked();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("Esc 与真遮罩点击都丢弃草稿；面板内部点击不取消", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    await toggle(page, "solidot", false);
    // 内部点击（标题）不关闭
    await dialog(page).getByRole("heading", { name: "选择来源" }).click();
    await expect(dialog(page)).toHaveJSProperty("open", true);
    // Esc 取消
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    // 真遮罩点击：dialog 的盒子只有面板那么大（position:fixed; width:min(560px,…); margin:auto），
    // 所以必须点面板盒子之外的视口区域，事件才落在 dialog 自身（= ::backdrop）。
    await openPanel(page);
    await toggle(page, "solidot", false);
    const box = (await dialog(page).locator(".k-source-surface").boundingBox())!;
    expect(box.y, "桌面面板居中，顶部之外存在遮罩区域").toBeGreaterThan(24);
    await page.mouse.click(8, 8);
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("零项草稿：提示至少选择一个并禁用应用", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    await dialog(page).locator(".k-source-all").click();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("至少选择一个来源");
    await expect(dialog(page).locator("[data-ksource-apply]")).toBeDisabled();
    // 重新勾一项后恢复可用
    await toggle(page, "solidot", true);
    await expect(dialog(page).locator("[data-ksource-apply]")).toBeEnabled();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
  });
});

test.describe("应用与交集过滤", () => {
  test("应用后按来源并集∩主题更新列表、总数、日期目录与播报", async ({ page }) => {
    await ready(page);
    const expected = filterTimeline(sorted, "全部", ["solidot", "geekpark"]);
    await applySources(page, ["solidot", "geekpark"]);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await expect(page.locator("[data-total]")).toHaveText(String(expected.length));
    const shown = await entryIds(page);
    expect(shown).toEqual(expected.slice(0, 20).map((entry) => entry.id));
    expect(shown.length).toBeLessThanOrEqual(20);
    expect(await statusText(page)).toContain("已应用来源筛选");
    expect(await statusText(page)).toContain("第 1 页");
    // 日期目录同步（按交集结果的日组重建）
    const days = [...new Set(expected.slice(0, 20).map((entry) => entry.firstSeenAt.slice(0, 10)))];
    await expect(page.locator("[data-toc] a")).toHaveCount(days.length);
    await expect(page.locator("[data-toc] a").first()).toContainText(`${days[0]} ·`);
  });

  test("单选显示来源名与已选数量；多选/全选显示「多源聚合」", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await expect(page.locator("[data-source-title]")).toHaveText("极客公园");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 1 / 6 个订阅源");
    await applySources(page, ["geekpark", "solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await applySources(page, ALL);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("等价集合重复应用：只关闭，不重排、不重播、不改变阅读位置", async ({ page }) => {
    await ready(page);
    await applySources(page, ["solidot"]);
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
    const before = await entryIds(page);
    const html = await listStructure(page);
    const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
    const statusBefore = await statusText(page);
    await page.evaluate(() => {
      const list = document.querySelector("[data-klist]")!;
      (window as unknown as { listMutations: number }).listMutations = 0;
      new MutationObserver((records) => {
        if (records.some((record) => record.type === "childList")) (window as unknown as { listMutations: number }).listMutations += 1;
      }).observe(list, { childList: true });
    });
    await applySources(page, ["solidot"]);
    expect(await page.evaluate(() => (window as unknown as { listMutations: number }).listMutations)).toBe(0);
    expect(await listStructure(page)).toBe(html);
    expect(await entryIds(page)).toEqual(before);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBefore);
    expect(await statusText(page)).toBe(statusBefore);
  });

  test("来源与主题双向联动：各保留另一维并回第 1 页", async ({ page }) => {
    await ready(page);
    // 先翻到第 2 页（geekpark 30 条 = 2 页）
    await applySources(page, ["geekpark"]);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 2 页");
    // 改来源 → 保留主题（全部）并回第 1 页
    await applySources(page, ["geekpark", "solidot"]);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 1 页");
    // 选主题 → 保留来源（≤767px 的 header Tab 按站点设计隐藏，pickTopic 走 MENU，与真实移动路径一致）
    await pickTopic(page, "科技");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(await page.locator(".k-entry").count()).fill("科技"));
    // 改来源 → 仍保留当前主题（科技），且回到第 1 页
    // Solidot × 科技 = 5 条 = 单页：既有分页口径为单页时隐藏分页器（见 interactions.spec 单页断言），
    // 所以「回第 1 页」在这一步表现为分页器隐藏、条目从第 1 条开始。
    await applySources(page, ["solidot"]);
    await expect(page.locator('[data-ktabs] .tab[data-topic="科技"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator("[data-pager]")).toBeHidden();
    const expected = filterTimeline(sorted, "科技", ["solidot"]);
    expect(await entryIds(page)).toEqual(expected.map((entry) => entry.id));
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(await page.locator(".k-entry").count()).fill("科技"));
    // 再选回多页组合，确认页码从第 1 页重新开始（不是沿用上一次的第 2 页）
    await applySources(page, ["geekpark"]);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 1 页");
  });

  test("先筛选后分页：交集结果收敛页数，页码跳转越界被拒", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator("[data-total]")).toHaveText("30");
    await expect(page.locator('[data-pager] [aria-label="第 2 页"]')).toBeVisible();
    await expect(page.locator('[data-pager] [aria-label="第 3 页"]')).toHaveCount(0);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(10);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 2 页");
    // 页码跳转越界：input 的 max 由交集页数决定，reportValidity 拒绝
    const jump = page.locator("[data-page-jump] input");
    await expect(jump).toHaveAttribute("max", "2");
    await jump.fill("3");
    await page.locator("[data-page-jump] button[type=submit]").click();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 2 页");
  });
});

test.describe("空态两维放宽", () => {
  test("无交集组合显示真实空态；「全部来源」只放宽来源、「全部主题」只放宽主题", async ({ page }) => {
    await ready(page);
    // Solidot × 社会 = 0（夹具中 Solidot 只有科技）
    await applySources(page, ["solidot"]);
    await pickTopic(page, "社会");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator(".k-entry")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "「社会」在已选来源中暂无内容" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全部来源" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全部主题" })).toBeVisible();
    // 只放宽主题：来源仍是 Solidot
    await page.getByRole("button", { name: "全部主题" }).click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator(".k-entry")).toHaveCount(5);
    await expect(page.locator('[data-ktabs] .tab[data-topic="全部"]')).toHaveAttribute("aria-current", "true");

    // 另起一页验证只放宽来源：主题仍是社会
    await ready(page);
    await applySources(page, ["solidot"]);
    await pickTopic(page, "社会");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await page.getByRole("button", { name: "全部来源" }).click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await expect(page.locator('[data-ktabs] .tab[data-topic="社会"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".k-entry")).toHaveCount(9);
    expect(await statusText(page)).toContain("已恢复全部来源");
  });
});

test.describe("键盘与焦点", () => {
  test("Tab 焦点留在 dialog 内，Space 切换，Esc 取消并把焦点还给入口", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    // 焦点在关闭按钮，Tab 逐步走完全部可聚焦元素。
    // 回绕行为因引擎而异（Chromium 实测短暂落到 document.body、WebKit 落到 dialog 自身、
    // Firefox 到最后一个控件后不回绕而停住），三者都不让焦点逃出面板，
    // 因此只断言规格要求的两件事：焦点不得逃到页面内容，且十个可聚焦控件都被覆盖。
    const readFocus = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const dialog = document.querySelector("dialog[data-ksource]");
        const where = active === document.body ? "none" : dialog?.contains(active) ? "in" : "out";
        const key =
          active instanceof HTMLInputElement
            ? `input:${active.value || "all"}`
            : `${active?.tagName.toLowerCase() ?? "?"}.${active?.className ?? ""}`;
        return { key, where };
      });
    const trail: Array<{ key: string; where: string }> = [await readFocus()];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      trail.push(await readFocus());
    }
    const trailText = trail.map((item) => `${item.key}:${item.where}`).join(" | ");
    expect(trail.every((item) => item.where !== "out"), `焦点不得逃到页面内容：${trailText}`).toBe(true);
    // 1 关闭 + 1 全选 + 6 选项 + 取消 + 应用 = 10 个可聚焦控件全部覆盖
    const visited = new Set(trail.filter((item) => item.where === "in").map((item) => item.key));
    expect(visited.size, `Tab 应覆盖面板内全部控件：${trailText}`).toBeGreaterThanOrEqual(10);
    expect(trail.at(-1)!.where).toBe("in");
    // 键盘 Space 切换复选框
    const input = page.locator('.k-source-input[value="solidot"]');
    await input.focus();
    await page.keyboard.press(" ");
    await expect(input).not.toBeChecked();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 5 / 6 个订阅源");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(entryButton(page)).toBeFocused();
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("应用后焦点可见且不被重渲染留在不可见位置", async ({ page }) => {
    await ready(page);
    // 应用前入口是否已在视口内：桌面右栏在首屏内（应用后不得产生滚动）；
    // ≤767px 时 HUD 在 Hero 之后、首屏之外（实测 iPhone 13：入口 top 692 > innerHeight 664），
    // 因此「焦点可见」要求把页面滚到入口处——这是规格明确要求的可访问性结果。
    const before = await page.evaluate(() => {
      const rect = document.querySelector("button[data-source-open]")!.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    await applySources(page, ["solidot"]);
    await expect(entryButton(page)).toBeFocused();
    await expect(entryButton(page)).toBeInViewport();
    if (before) expect(await page.evaluate(() => window.scrollY), "已在视口内时不得滚动").toBe(0);
    // 几何断言：焦点元素完整可见且不被固定 header 遮挡（toBeInViewport 只判交叠比例）
    const geometry = await page.evaluate(() => {
      const rect = document.querySelector("button[data-source-open]")!.getBoundingClientRect();
      const headerBottom =
        document.querySelector<HTMLElement>("header")?.getBoundingClientRect().bottom ?? 0;
      return { top: rect.top, bottom: rect.bottom, headerBottom, viewport: window.innerHeight };
    });
    expect(geometry.top, "焦点元素不被固定 header 遮挡").toBeGreaterThanOrEqual(geometry.headerBottom - 1);
    expect(geometry.bottom, "焦点元素在视口内").toBeLessThanOrEqual(geometry.viewport + 1);
  });
});

test.describe("动效、降级与运行环境", () => {
  test("应用时面板先退场再切列表，退场有真实中间帧", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("[data-ksource]")!;
      const surface = dialog.querySelector<HTMLElement>(".k-source-surface")!;
      const list = document.querySelector("[data-klist]")!;
      const record = { frames: [] as Array<{ t: number; opacity: number; y: number; h: number }>, closeStart: 0, listAt: 0 };
      (window as unknown as { applyRecord: typeof record }).applyRecord = record;
      const sample = () => {
        if (dialog.open) {
          const style = getComputedStyle(surface);
          record.frames.push({
            t: performance.now(),
            opacity: Number(style.opacity),
            y: new DOMMatrixReadOnly(style.transform === "none" ? "" : style.transform).m42,
            h: surface.offsetHeight,
          });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      new MutationObserver((records) => {
        if (!record.listAt && records.some((r) => r.type === "childList")) record.listAt = performance.now();
      }).observe(list, { childList: true });
      document.querySelector<HTMLButtonElement>("button[data-source-open]")!.click();
    });
    await expect(dialog(page)).toHaveAttribute("data-source-state", "open");
    // 必须真的改草稿：草稿等价于已应用集合时应用只关闭面板（规格要求的短路），列表本就不该变。
    await toggle(page, "solidot", false);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 5 / 6 个订阅源");
    await page.evaluate(() => {
      const record = (window as unknown as { applyRecord: { closeStart: number } }).applyRecord;
      record.closeStart = performance.now();
      document.querySelector<HTMLButtonElement>("[data-ksource-apply]")!.click();
    });
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    const record = await page.evaluate(() => (window as unknown as { applyRecord: { frames: Array<{ t: number; opacity: number; y: number; h: number }>; closeStart: number; listAt: number } }).applyRecord);
    // 桌面面板淡出 + 下移 12px；手机面板整块上拉/下拉（opacity 恒 1，位移是面板高度）。
    // 因此中间帧按平台取不同属性：桌面看 opacity，手机看位移占面板高度的比例。
    const mobile = await page.evaluate(() => matchMedia("(max-width: 767px)").matches);
    const closing = record.frames.filter((frame) => frame.t >= record.closeStart);
    expect(closing.length, "退场过程有采样帧").toBeGreaterThan(0);
    const middle = mobile
      ? closing.filter((frame) => frame.y > 4 && frame.y < frame.h - 4)
      : closing.filter((frame) => frame.opacity > 0.02 && frame.opacity < 0.98);
    // 中间帧数量下限按平台取：桌面淡出实测 14 帧；headless WebKit 移动配置的 rAF 明显被节流
    // （实测 280ms 内只有 4 次采样），因此要求至少 2 个中间帧，并额外用「中间帧跨越的时长」
    // 与「终点确实移出」证明这是真实逐帧推进，而不是一次跳变。
    expect(middle.length, mobile ? "上拉退场至少 2 个中间帧" : "淡出退场至少 3 个中间帧").toBeGreaterThanOrEqual(mobile ? 2 : 3);
    expect(
      middle.at(-1)!.t - middle[0]!.t,
      "中间帧跨越足够时长（不是单帧跳变）",
    ).toBeGreaterThan(40);
    const ys = closing.map((frame) => frame.y);
    expect(
      ys.every((y, i) => i === 0 || y >= ys[i - 1]! - 0.5),
      mobile ? "手机面板沿原路向下移出" : "桌面关闭沿原路向下轻落",
    ).toBe(true);
    expect(ys.at(-1), "退场终点确实移开（不是停在原位）").toBeGreaterThan(ys[0]! + 4);
    expect(record.listAt, "列表必须在面板退场开始后才变化").toBeGreaterThan(record.closeStart + 120);
  });

  test("减弱动态：取消空间位移与错峰，开合立即完成", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("[data-ksource]")!;
      const surface = dialog.querySelector<HTMLElement>(".k-source-surface")!;
      (window as unknown as { reducedFrames: number[] }).reducedFrames = [];
      const sample = () => {
        if (dialog.open) {
          const style = getComputedStyle(surface);
          (window as unknown as { reducedFrames: number[] }).reducedFrames.push(new DOMMatrixReadOnly(style.transform === "none" ? "" : style.transform).m42);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.querySelector<HTMLButtonElement>("button[data-source-open]")!.click();
    });
    await expect(dialog(page)).toHaveAttribute("data-source-state", "open");
    // 减弱动态下打开是同步完成的（不创建时间线），首帧采样与 state 断言之间存在竞态，
    // 因此等采样器至少跑过一帧再读。
    await page.waitForFunction(() => (window as unknown as { reducedFrames: number[] }).reducedFrames.length > 0);
    const frames = await page.evaluate(() => (window as unknown as { reducedFrames: number[] }).reducedFrames);
    expect(frames.every((y) => Math.abs(y) < 0.5), "无空间位移").toBe(true);
    // 减弱动态下开合立即完成：打开即已 settled，关闭同样不应留下中间态
    expect(await dialog(page).locator(".k-source-surface").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    // 关闭后再走完整的应用流程（面板已关闭，入口可点）
    await applySources(page, ["solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator(".k-entry").first()).toBeVisible();
  });

  test("动效库加载失败：面板仍能开合与应用", async ({ page }) => {
    await page.route("**/vendor/gsap.min.js", (route) => route.abort());
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-oct-motion", "off");
    await applySources(page, ["solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator("[data-total]")).toHaveText("05");
    await openPanel(page);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
  });

  test("停钟：关闭仍能收尾并释放滚动锁", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    await page.evaluate(() => {
      (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap.globalTimeline.pause();
      document.querySelector<HTMLButtonElement>("[data-ksource-close]")!.click();
    });
    await expect(dialog(page)).toHaveJSProperty("open", false, { timeout: 3_000 });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    // 停钟下的退出不能留下 GSAP 写入的内联隐藏样式（面板需可再次打开并显示）
    expect(
      await page.locator(".k-source-surface").evaluate((el) => ({
        opacity: getComputedStyle(el).opacity,
        visibility: getComputedStyle(el).visibility,
        transform: el.style.transform,
      })),
    ).toEqual({ opacity: "1", visibility: "visible", transform: "" });
    // 恢复时钟：evaluate 必须是语句形式——gsap 的 resume() 返回 timeline 自身（含循环引用），
    // 作为返回值交给 Playwright 序列化会挂到超时（实测），语句形式立即返回。
    await page.evaluate(() => {
      (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume();
    });
    // 恢复后仍可正常开合（终态未污染后续交互）
    await openPanel(page);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
  });

  test("快速开关与进入中取消：不误提交草稿、不残留滚动锁", async ({ page }) => {
    await ready(page);
    const entry = entryButton(page);
    await entry.click();
    await page.locator("[data-ksource-close]").click();
    await entry.click();
    await expect(dialog(page)).toHaveAttribute("data-source-state", "open");
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await expect(page.locator("[data-total]")).toHaveText("56");
    // 打开 → 勾选 → 立即 pagehide（离开）：丢弃草稿，不误提交
    await openPanel(page);
    await toggle(page, "solidot", false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("滚动锁不改变页面宽度，背景 overflow 在打开期间为 hidden", async ({ page }) => {
    await ready(page);
    const before = await page.evaluate(() => ({
      gutter: window.innerWidth - document.documentElement.clientWidth,
      width: document.querySelector("[data-kmain]")!.getBoundingClientRect().width,
    }));
    await openPanel(page);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    const during = await page.evaluate(() => ({
      gutter: window.innerWidth - document.documentElement.clientWidth,
      width: document.querySelector("[data-kmain]")!.getBoundingClientRect().width,
    }));
    expect(during).toEqual(before);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("深色主题下面板底色与文字对比度实测 ≥4.5:1", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("overthecocoons.theme", "dark"));
    await ready(page);
    await openPanel(page);
    const heading = dialog(page).getByRole("heading", { name: "选择来源" });
    const box = (await heading.boundingBox())!;
    const surfaceBox = (await dialog(page).locator(".k-source-surface").boundingBox())!;
    // 面板底色：取面板内、标题上方的空白区域
    const bgPoint: [number, number] = [surfaceBox.width / 2, Math.max(4, box.y - surfaceBox.y - 8)];
    const [bg] = await samplePixels(page, surfaceBox, [bgPoint]);
    // 字形：在标题框内取样，取与底色对比最强的一格（抗锯齿边缘不会高估对比）
    const points: Array<[number, number]> = [];
    for (let x = 2; x < box.width - 2; x += 3) {
      for (let y = 2; y < box.height - 2; y += 3) points.push([box.x - surfaceBox.x + x, box.y - surfaceBox.y + y]);
    }
    const samples = await samplePixels(page, surfaceBox, points);
    const best = Math.max(...samples.map((pixel) => contrastRatio(pixel, bg!)));
    expect(best, "深色下面板文字对比度").toBeGreaterThanOrEqual(4.5);
    // 选中态不只靠颜色：勾号 + 边框 + 底色同时在
    const checkedBox = await dialog(page).locator(".k-source-option").first().locator(".k-source-box").evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, border: style.borderTopColor, mark: getComputedStyle(el, "::after").transform };
    });
    expect(checkedBox.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(checkedBox.mark).not.toBe("none");
  });
});

test.describe("触屏与无脚本", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("触屏：面板底部上拉、选项点击生效、无残留 hover", async ({ page }) => {
    await ready(page);
    await entryButton(page).tap();
    await expect(dialog(page)).toHaveAttribute("data-source-state", "open");
    const surface = await dialog(page).locator(".k-source-surface").boundingBox();
    expect(surface!.y + surface!.height, "面板贴底").toBeGreaterThan(700);
    await page.locator('.k-source-option:has(.k-source-input[value="solidot"])').tap();
    await expect(page.locator('.k-source-input[value="solidot"]')).not.toBeChecked();
    await page.locator("[data-ksource-apply]").tap();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 5 / 6 个订阅源");
    // 触屏无残留 hover：面板关闭后入口不应处于 :hover 态
    expect(await page.evaluate(() => document.querySelector("[data-source-open]")!.matches(":hover"))).toBe(false);
  });
});

test.describe("无 JS 降级", () => {
  test("入口是通往来源说明页的真实链接；静态条目/主题/分页可用", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE}`);
      const entry = page.locator("a[data-source-open]");
      await expect(entry).toHaveAttribute("href", `${BASE}sources/`);
      await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
      await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
      // 静态条目与分页可用
      await expect(page.locator(".k-entry")).toHaveCount(20);
      await page.locator('[data-pager] [aria-label="第 2 页"]').click();
      await page.waitForURL(`${BASE}page/2/`);
      await expect(page.locator(".k-entry")).toHaveCount(20);
      // 主题页静态可用
      await page.goto(`${BASE}topics/tech/`);
      await expect(page.locator(".k-entry .tpc").first()).toHaveText("科技");
      // 入口真导航
      await page.goto(`${BASE}`);
      await page.locator("a[data-source-open]").click();
      await page.waitForURL(`${BASE}sources/`);
      await expect(page.getByRole("heading", { name: "百度热点", exact: false }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
