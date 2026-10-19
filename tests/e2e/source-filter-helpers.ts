/**
 * 来源筛选两个 spec 的共用页面操作（Issue #34/#35 复审 B2 去重）。
 *
 * 只放「真实用户路径」的公开操作：可访问名称、可见内容、真实 URL、条目身份、页码、焦点、
 * 滚动与渲染中间帧。不读取内部模块变量，也不断言私有状态机字段
 * （`data-source-state` 是实现的记账属性，测试不得依赖；面板是否打开只认 `dialog.open`）。
 */
import { expect, type Page } from "@playwright/test";
import { SUBSCRIPTION_IDS } from "../../src/lib/source-filter.ts";

/** 站点基路径（构建产物按 Astro base 部署）。 */
export const BASE = "/overthecocoons/";
/** 多源夹具产物服务（playwright.config.ts 的第二 webServer）。 */
export const SOURCES_BASE = "http://127.0.0.1:4323";
/** 六个订阅 ID（固定次序，来自生产同一常量，不在测试里另抄一份）。 */
export const ALL: readonly string[] = SUBSCRIPTION_IDS;

export const dialog = (page: Page) => page.locator("dialog[data-ksource]");
export const entryButton = (page: Page) => page.locator("button[data-source-open]");

/** 已构建站点就绪（客户端增强模块执行完成）。 */
export async function ready(page: Page, path = ""): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await waitClientReady(page);
}

export async function waitClientReady(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-client="ready"]');
}

/** 打开面板并等到真正可交互（模态已打开、面板可见、焦点在关闭按钮）。 */
export async function openPanel(page: Page): Promise<void> {
  await entryButton(page).click();
  await expect(dialog(page)).toHaveJSProperty("open", true);
  await expect(dialog(page).locator(".k-source-surface")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "关闭 ✕" })).toBeFocused();
}

/**
 * 等面板入场动效落定：surface 的计算 transform 回到 `none`（入场补间完成 + reset 清内联样式）。
 * 只读渲染后的几何结果，不读实现变量；用于「量尺寸」类断言前避免量到补间中间帧
 * （实测：280ms 入场中量到 43.7px 而非 44px 的点击高度）。
 */
export async function panelSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const surface = document.querySelector<HTMLElement>(
            "dialog[data-ksource] .k-source-surface",
          );
          if (!surface) return false;
          return getComputedStyle(surface).transform === "none";
        }),
      { timeout: 3_000 },
    )
    .toBe(true);
}

/** 按来源 ID 切换面板草稿（真实点击 label，与用户路径一致）。 */
export async function toggle(page: Page, sourceId: string, checked: boolean): Promise<void> {
  const input = page.locator(`.k-source-input[value="${sourceId}"]`);
  if ((await input.isChecked()) !== checked) {
    await page.locator(`.k-source-option:has(.k-source-input[value="${sourceId}"])`).click();
  }
}

/** 点击「应用」并等面板关闭 + 两段式列表切换收尾。 */
export async function apply(page: Page): Promise<void> {
  await page.locator("[data-ksource-apply]").click();
  await expect(dialog(page)).toHaveJSProperty("open", false);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
}

/** 把草稿设为给定来源集合后应用。 */
export async function applySources(page: Page, sources: readonly string[]): Promise<void> {
  await openPanel(page);
  for (const id of ALL) await toggle(page, id, sources.includes(id));
  await apply(page);
}

export async function statusText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector("[data-status]")?.textContent ?? "");
}

/** 当前列表的条目身份（按渲染次序）。 */
export async function entryIds(page: Page): Promise<string[]> {
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
export async function listStructure(page: Page): Promise<string> {
  return page.locator("[data-klist]").evaluate((el) => el.innerHTML.replace(/\sstyle="[^"]*"/g, ""));
}

/** 当前 history.state 里的来源筛选快照（诊断用；生产不暴露任何全局接口）。 */
export async function filterState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const state = history.state as Record<string, unknown> | null;
    return (state?.["octFilter"] as Record<string, unknown> | undefined) ?? null;
  });
}

/** 真实跨文档返回：断言导航类型证明不是同页切换。 */
export async function goBackAndAssertCrossDocument(page: Page): Promise<void> {
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
export async function openFirstDetail(page: Page): Promise<void> {
  await page.locator(".k-entry .k-headline a[data-detail]").first().click();
  await page.waitForURL(/\/items\//);
  await waitClientReady(page);
}
