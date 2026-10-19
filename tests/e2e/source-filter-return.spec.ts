/**
 * 详情返回恢复来源筛选与阅读位置（Issue #35）——真实构建产物上的跨文档导航。
 *
 * 数据：fixtures/snapshot-sources.json（六源确定性夹具，56 条），由 playwright.config.ts 的
 * 第二 webServer 注入构建到 .snapshot/sources-dist 并在 4323 提供服务。
 *
 * 关键口径（实测，不是假设）：
 * - Playwright Chromium 默认带 `--disable-back-forward-cache`，所以默认 headless 页面走的是
 *   **非 BFCache 跨文档返回**：`performance.getEntriesByType("navigation")[0].type` 实测为
 *   `"back_forward"`。用例里显式断言它，证明这是真实返回而不是同页切换。
 * - headless 拿不到 BFCache（`pageshow.persisted` 恒 false，即使 ignoreDefaultArgs 放开），
 *   因此 BFCache 用例**先尝试 headless**，未命中就显式 skip 并记录原因，不伪造通过。
 *   该路径留给最终独立验收（不在本循环内用 headful 弹窗换通过）。
 * - 期望值一律从夹具推导（filterTimeline + paginate 同一份生产规则），不硬编码条数。
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicEntry } from "../../src/domain/contract.ts";
import { PAGE_SIZE, paginate, sortEntriesDesc } from "../../src/lib/timeline.ts";
import { filterTimeline } from "../../src/lib/source-filter.ts";

const BASE = "/overthecocoons/";
test.use({ baseURL: "http://127.0.0.1:4323" });

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
/** 阅读基准线，与 src/client/timeline-view.ts READ_LINE 一致。 */
const READ_LINE = 100;

const dialog = (page: Page) => page.locator("dialog[data-ksource]");
const entryButton = (page: Page) => page.locator("button[data-source-open]");

async function waitClientReady(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-client="ready"]');
}

async function ready(page: Page, path = ""): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await waitClientReady(page);
}

async function openPanel(page: Page): Promise<void> {
  await entryButton(page).click();
  await expect(dialog(page)).toHaveAttribute("data-source-state", "open");
}

async function toggle(page: Page, sourceId: string, checked: boolean): Promise<void> {
  const input = page.locator(`.k-source-input[value="${sourceId}"]`);
  if ((await input.isChecked()) !== checked) {
    await page.locator(`.k-source-option:has(.k-source-input[value="${sourceId}"])`).click();
  }
}

async function applySources(page: Page, sources: string[]): Promise<void> {
  await openPanel(page);
  for (const id of ALL) await toggle(page, id, sources.includes(id));
  await page.locator("[data-ksource-apply]").click();
  await expect(dialog(page)).toHaveJSProperty("open", false);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
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

/** 切换主题（≤767px 时 header Tab 隐藏，走全屏菜单，与真实移动路径一致）。 */
async function pickTopic(page: Page, topic: string): Promise<void> {
  const headerTab = page.locator(`[data-ktabs] .tab[data-topic="${topic}"]`);
  if (await headerTab.isVisible()) {
    await headerTab.click();
  } else {
    await page.locator("[data-kmenu-open]").click();
    await page.locator(`.k-menu-topics .tab[data-topic="${topic}"]`).click();
    await page.waitForFunction(() => {
      const menu = document.querySelector<HTMLDialogElement>("dialog[data-kmenu]");
      return !menu || !menu.open;
    });
  }
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
}

/**
 * 把指定 data-gi 条目滚到阅读基准线（用户手势语义：先派发滚动键再 instant 滚动，
 * 使滚动落在站点 200ms 输入采样窗口内，阅读位置被写入 history.state）。
 */
async function readAt(page: Page, gi: number): Promise<void> {
  const box = await page.locator(`[data-gi="${gi}"]`).boundingBox();
  expect(box, `条目 gi=${gi} 应存在`).not.toBeNull();
  const scrollY = await page.evaluate(() => window.scrollY);
  const target = Math.max(0, scrollY + box!.y - (READ_LINE - 4));
  await page.evaluate((top) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    window.scrollTo({ top, behavior: "instant" });
  }, target);
  await page.waitForTimeout(300);
}

/** 当前 history.state 里的来源筛选快照（测试诊断用；生产不暴露任何全局接口）。 */
async function filterState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const state = history.state as Record<string, unknown> | null;
    return (state?.["octFilter"] as Record<string, unknown> | undefined) ?? null;
  });
}

/** 真实跨文档返回：断言导航类型证明不是同页切换。 */
async function goBackAndAssertCrossDocument(page: Page): Promise<void> {
  await page.goBack();
  await waitClientReady(page);
  const type = await page.evaluate(
    () =>
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        ?.type ?? "unknown",
  );
  expect(type, "必须是真实跨文档后退（不是同页切换）").toBe("back_forward");
}

/** 进入第一条可见条目的详情页（真实点击标题链接）。 */
async function openFirstDetail(page: Page): Promise<void> {
  await page.locator(".k-entry .k-headline a[data-detail]").first().click();
  await page.waitForURL(/\/items\//);
  await waitClientReady(page);
}

test.describe("非 BFCache 跨文档返回（主要验收路径）", () => {
  test("单源 + 主题 + 第 2 页 + 阅读位置：返回后全部恢复并播报", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await pickTopic(page, "科技");
    const expected = filterTimeline(sorted, "科技", ["geekpark"]);
    expect(paginate(expected, 1).totalPages).toBe(2);

    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute(
      "aria-label",
      "第 2 页",
    );
    // 第 2 页读 gi=21（页面内第二条）
    await readAt(page, 21);
    const readId = expected[21]!.id;

    await openFirstDetail(page);
    // 快照写在时间线那条历史条目上，进详情后是另一条历史条目
    await goBackAndAssertCrossDocument(page);

    // 来源 / 主题 / 页码 / 日期目录全部恢复
    await expect(page.locator("[data-source-title]")).toHaveText("极客公园");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 1 / 6 个订阅源");
    await expect(page.locator('[data-ktabs] .tab[data-topic="科技"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute(
      "aria-label",
      "第 2 页",
    );
    await expect(page.locator("[data-total]")).toHaveText(
      String(expected.length).padStart(2, "0"),
    );
    // 列表身份与分页一致（不是「看起来对」）
    expect(await entryIds(page)).toEqual(expected.slice(20, 40).map((entry) => entry.id));
    // 阅读位置回到原条目（恢复用即时定位，容差 ≥1px 覆盖亚像素残差）
    await expect
      .poll(async () => (await page.locator(`[data-gi="21"]`).boundingBox())?.y ?? 9999, {
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(READ_LINE + 8);
    expect(await filterState(page), "快照里的阅读条目就是返回前读的那条").toMatchObject({
      sources: ["geekpark"],
      topic: "科技",
      page: 2,
      readId,
    });
    // 播报口径（规格统一定义）
    const status = await statusText(page);
    expect(status).toContain("已恢复来源筛选与阅读位置：极客公园，科技，第 2 页，共 2 页");
  });

  test("多源组合 + 全部主题：返回恢复入口标题与已选数量", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark", "solidot"]);
    const expected = filterTimeline(sorted, "全部", ["geekpark", "solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    expect(await entryIds(page)).toEqual(expected.slice(0, PAGE_SIZE).map((entry) => entry.id));

    await openFirstDetail(page);
    await goBackAndAssertCrossDocument(page);

    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await expect(page.locator('[data-ktabs] .tab[data-topic="全部"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(await entryIds(page)).toEqual(expected.slice(0, PAGE_SIZE).map((entry) => entry.id));
    expect(await statusText(page)).toContain("已恢复来源筛选与阅读位置：极客公园、Solidot，全部");
  });

  test("恢复的是已应用条件：返回后打开面板，草稿初值与恢复集合一致", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark", "solidot"]);
    await openFirstDetail(page);
    await goBackAndAssertCrossDocument(page);

    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await openPanel(page);
    for (const id of ALL) {
      await expect(page.locator(`.k-source-input[value="${id}"]`)).toBeChecked({
        checked: id === "geekpark" || id === "solidot",
      });
    }
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 2 / 6 个订阅源");
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
  });

  test("草稿不恢复：应用 A 后改成 B 但不应用就进详情，返回仍是 A", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await openPanel(page);
    // 改成 B（solidot）但不应用
    for (const id of ALL) await toggle(page, id, id === "solidot");
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);

    await openFirstDetail(page);
    await goBackAndAssertCrossDocument(page);

    await expect(page.locator("[data-source-title]")).toHaveText("极客公园");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 1 / 6 个订阅源");
    expect(await filterState(page)).toMatchObject({ sources: ["geekpark"] });
    await openPanel(page);
    await expect(page.locator('.k-source-input[value="geekpark"]')).toBeChecked();
    await expect(page.locator('.k-source-input[value="solidot"]')).not.toBeChecked();
  });

  test("目标失效：返回前把快照 readId 改成不存在的 id → 回退有效页码并提示", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await pickTopic(page, "科技");
    const expected = filterTimeline(sorted, "科技", ["geekpark"]);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await readAt(page, 22);

    // 篡改时间线这条历史条目的快照：阅读条目换成不存在的 id（模拟内容变化/条目消失）。
    // 必须在离开时间线之前改——详情页是另一条历史条目，改它不会影响返回时的恢复。
    await page.evaluate(() => {
      const state = history.state as Record<string, unknown> | null;
      const filter = (state?.["octFilter"] as Record<string, unknown> | undefined) ?? {};
      history.replaceState({ ...(state ?? {}), octFilter: { ...filter, readId: "missing-entry-id" } }, "");
    });
    expect(await filterState(page)).toMatchObject({ readId: "missing-entry-id" });

    await openFirstDetail(page);
    await goBackAndAssertCrossDocument(page);

    // 来源与主题仍恢复，页码收敛到有效范围（不产生无效页码）
    await expect(page.locator("[data-source-title]")).toHaveText("极客公园");
    await expect(page.locator('[data-ktabs] .tab[data-topic="科技"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    const currentPageLabel = await page
      .locator('[data-pager] [aria-current="page"]')
      .getAttribute("aria-label");
    expect(currentPageLabel, "页码必须在有效范围内").toMatch(/^第 [12] 页$/);
    expect(await entryIds(page)).toEqual(
      expected
        .slice((Number(currentPageLabel!.replace(/\D/g, "")) - 1) * PAGE_SIZE, Number(currentPageLabel!.replace(/\D/g, "")) * PAGE_SIZE)
        .map((entry) => entry.id),
    );
    const status = await statusText(page);
    expect(status).toContain("已恢复来源筛选与阅读位置");
    expect(status, "目标失效必须说明已回退").toContain("原条目不在当前内容中");
    // 不制造无效页码：页码跳转上限等于交集页数
    await expect(page.locator("[data-page-jump] input")).toHaveAttribute(
      "max",
      String(paginate(expected, 1).totalPages),
    );
  });

  test("无残留：返回后无面板/滚动锁/失效光标/滚动条，媒体与揭示状态正常", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await readAt(page, 3);
    await openFirstDetail(page);
    await goBackAndAssertCrossDocument(page);

    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    expect(await page.locator("[data-ksource]").getAttribute("data-source-state")).toBe("closed");
    // 光标仍在其原始容器（未留在 dialog 顶层）
    expect(
      await page.evaluate(() => {
        const cursor = document.querySelector(".k-cursor")!;
        return !document.querySelector("dialog[data-ksource]")!.contains(cursor);
      }),
    ).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-oct-scrollbars", "ready");
    // 恢复不重播入场：标题未被拆字（.ch 为空），摘要/媒体立即可见（不是停在透明初态）
    expect(await page.locator(".k-entry .k-headline .ch").count()).toBe(0);
    await expect(page.locator(".k-entry").first()).toBeVisible();
    await expect(page.locator(".k-entry .k-summary").first()).toHaveCSS("opacity", "1");
    // 媒体未被 addMediaEntrance 接管：无 inline opacity/clip-path 隐藏初态
    expect(
      await page.locator(".k-entry .k-media").first().evaluate((el) => ({
        visibility: getComputedStyle(el).visibility,
        opacity: getComputedStyle(el).opacity,
        clip: (el as HTMLElement).style.clipPath,
      })),
      "恢复不重播媒体入场（无隐藏初态）",
    ).toEqual({ visibility: "visible", opacity: "1", clip: "" });
    // 媒体尺寸/比例保持：桌面是 4/3（.layout-* .k-media），≤767px 是固定高度
    // height: clamp(180px, 52vw, 240px)（kinetic.css 手机规则）。按断点断言真实规则，
    // 不把一个断点的期望套到另一个断点上。
    const media = await page.locator(".k-media").first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        ratio: rect.height / rect.width,
        height: rect.height,
        mobile: matchMedia("(max-width: 767px)").matches,
        vw: window.innerWidth,
      };
    });
    if (media.mobile) {
      const expected = Math.min(240, Math.max(180, media.vw * 0.52));
      expect(media.height, "手机媒体高度按 clamp(180px, 52vw, 240px)").toBeCloseTo(expected, 0);
    } else {
      expect(media.ratio, "桌面列表媒体保持 4/3").toBeGreaterThan(0.72);
      expect(media.ratio, "桌面列表媒体保持 4/3").toBeLessThan(0.78);
    }
  });
});

test.describe("刷新与重新打开重置", () => {
  test("刷新：来源回到全选，主题/页码按 URL 初始化，滚动回顶部，不播报恢复", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await pickTopic(page, "科技");
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await readAt(page, 21);
    expect(await filterState(page)).toMatchObject({ sources: ["geekpark"], page: 2 });

    await page.reload();
    await waitClientReady(page);

    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    // 主题与页码按实际 URL 初始化：客户端翻页不改 URL，所以重载回到该 URL 的静态页（第 1 页）
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute(
      "aria-label",
      "第 1 页",
    );
    expect(await page.evaluate(() => window.scrollY), "刷新后回到顶部").toBe(0);
    const status = await statusText(page);
    expect(status, "刷新不播报恢复").not.toContain("已恢复");
    // 刷新后的新历史条目写的是全选来源（不是旧快照）——直接读 state 判据，避免只看 DOM
    expect(await filterState(page)).toMatchObject({ sources: ALL, topic: "全部", page: 1 });
    // 且列表确实回到全选口径（与来源交集一致，不是只改了入口文案）
    const allExpected = filterTimeline(sorted, "全部", ALL);
    expect(await entryIds(page)).toEqual(allExpected.slice(0, PAGE_SIZE).map((entry) => entry.id));
  });

  test("重新打开：新页面直接访问同一 URL，来源全选、不恢复", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4323" });
    try {
      const first = await context.newPage();
      await ready(first);
      await applySources(first, ["solidot"]);
      await expect(first.locator("[data-source-title]")).toHaveText("Solidot");

      const second = await context.newPage();
      await ready(second);
      await expect(second.locator("[data-source-title]")).toHaveText("多源聚合");
      await expect(second.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
      expect(await statusText(second)).not.toContain("已恢复");
      expect(await filterState(second)).toMatchObject({ sources: ALL });
      await first.close();
      await second.close();
    } finally {
      await context.close();
    }
  });

  test("带主题的静态 URL：刷新后按 URL 主题初始化，来源仍全选", async ({ page }) => {
    await ready(page, "topics/tech/");
    await applySources(page, ["solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await page.reload();
    await waitClientReady(page);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await expect(page.locator('[data-ktabs] .tab[data-topic="科技"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(await statusText(page)).not.toContain("已恢复");
  });
});

test.describe("BFCache 返回（headless 环境通常不命中，未命中即显式 skip）", () => {
  test("命中 BFCache 时 pageshow.persisted === true 且恢复来源筛选", async ({ browser }) => {
    // 用户约束：不弹 headful 窗口。headless 即使放开 --disable-back-forward-cache 也拿不到
    // BFCache（实测），因此这里先尝试，未命中就记录原因并 skip——不伪造通过。
    // 该路径由最终独立验收一次性确认。
    const isolated: Browser = await browser.browserType().launch({
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
    });
    try {
      const context = await isolated.newContext({ baseURL: "http://127.0.0.1:4323" });
      const page = await context.newPage();
      await ready(page);
      await applySources(page, ["geekpark"]);
      await openFirstDetail(page);
      await page.goBack();
      await waitClientReady(page);
      // 只有真正命中 BFCache 才继续：pageshow.persisted 是本用例的前提判据，
      // 拿不到就说明这条路径在本环境根本没被走到，断言「恢复成功」毫无意义。
      const hit = await page.evaluate(() =>
        performance
          .getEntriesByType("pageshow")
          .some((entry) => (entry as PerformanceEntry & { persisted?: boolean }).persisted === true),
      );
      test.skip(
        !hit,
        "本环境（headless Chromium）未命中 BFCache：pageshow.persisted 恒 false，" +
          "该路径未在本轮验收，留给最终独立验收",
      );
      // 命中时模块不重跑，由 pageshow(persisted) 收口；断言恢复结果
      await expect(page.locator("[data-source-title]")).toHaveText("极客公园");
      await expect(page.locator("[data-source-dim]")).toHaveText("已选 1 / 6 个订阅源");
      expect(await statusText(page)).toContain("已恢复来源筛选与阅读位置：极客公园");
      await context.close();
    } finally {
      await isolated.close();
    }
  });
});
