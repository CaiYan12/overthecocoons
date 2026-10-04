import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { PublicEntry, PublicSnapshot } from "../../src/domain/contract.ts";
import { safeScreenshot } from "./helpers.ts";

const BASE = "/overthecocoons/";

/** 与渲染层一致的排序口径：首次收录时间倒序，同时间按 id 升序（读 fixture 演示快照）。 */
function sortedEntries(): PublicEntry[] {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "snapshot.json"), "utf-8"),
  ) as PublicSnapshot;
  return [...snapshot.entries].sort((a, b) => {
    const byTime = Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
    return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

test.describe("时间线与站点冒烟（Ticket 04）", () => {
  test("基路径下返回 200 且标题正确", async ({ page }) => {
    const response = await page.goto(BASE);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/跳出茧房/);
  });

  test("页面资源全部经基路径可达（无失败请求；Ticket 08 起动效库自托管，基路径外零资源）", async ({ page }) => {
    const failed: string[] = [];
    const offBase: string[] = [];
    // Ticket 08 自托管裁定：动效库已在 /overthecocoons/vendor/ 下，基路径外不再有任何资源
    page.on("requestfailed", (request) => {
      failed.push(`${request.url()} :: ${request.failure()?.errorText}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failed.push(`${response.url()} :: HTTP ${response.status}`);
      }
      const path = new URL(response.url()).pathname;
      if (!path.startsWith(BASE) && path !== "/favicon.ico") {
        offBase.push(response.url());
      }
    });
    await page.goto(BASE);
    // 等待网络空闲，确保样式表等资源已加载
    await page.waitForLoadState("networkidle");
    expect(failed, "不应有失败或 4xx/5xx 请求").toEqual([]);
    expect(offBase, "所有资源都应位于 /overthecocoons/ 前缀下").toEqual([]);
    // 样式表已实际生效（说明 CSS 经基路径加载成功）
    const bodyColor = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyColor, "全局样式应已应用").not.toBe("rgba(0, 0, 0, 0)");
  });

  test("320px 与 1440px 两端均无横向破版，并留存截图", async ({ page }) => {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE);
      await page.waitForLoadState("networkidle");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth, `${width}px 视口不应出现横向滚动`).toBeLessThanOrEqual(width);
      await safeScreenshot(page, `test-results/screenshots/home-${width}.png`);
    }
  });

  test("禁用 JS 后页面仍可读（Hero、条目标题、分页与演示数据标注）", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BASE);
    await expect(
      page.getByRole("heading", { name: /跳\s*出\s*茧\s*房/ }).first(),
    ).toBeVisible();
    await expect(page.getByText(/以下均为演示数据/).first()).toBeVisible();
    // 无 JS 分页兜底：首页存在指向第 2 页的链接
    await expect(page.getByRole("link", { name: "第 2 页" })).toBeVisible();
    // 条目标题是站内详情链接
    const firstTitle = page.locator(".k-entry .k-headline a").first();
    await expect(firstTitle).toBeVisible();
    await expect(firstTitle).toHaveAttribute("href", /\/overthecocoons\/items\//);
    await context.close();
  });

  test("禁用 JS 后关键内容存在（时间线/主题页/空主题/详情页）", async ({ browser }) => {
    // Ticket 05 起站点包含渐进增强脚本；无 JS 语义改为：关键内容在无 JS 上下文仍可读。
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    // 首页：Hero、条目、链接式分页（原「零 script 标签」断言的语义等价替换）
    await page.goto(BASE);
    await expect(page.locator(".k-entry .k-headline a").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "第 2 页" })).toBeVisible();

    // 主题页：新闻有内容
    await page.goto(`${BASE}topics/news/`);
    await expect(page.locator(".k-entry").first()).toBeVisible();
    await expect(page.getByText("演示数据").first()).toBeVisible();

    // 空主题：真实空态与「查看全部」
    await page.goto(`${BASE}topics/philosophy/`);
    await expect(page.getByText("「哲学」暂无内容")).toBeVisible();
    await expect(page.getByRole("link", { name: "查看全部" })).toBeVisible();

    // 详情页：标题与独立百度入口
    const first = sortedEntries()[0]!;
    await page.goto(`${BASE}items/${first.id}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
    await expect(page.getByRole("link", { name: /查看百度搜索结果/ })).toBeVisible();
    await context.close();
  });

  test("详情页直达：/items/<64hex>/ 可达且内容齐备", async ({ page }) => {
    const first = sortedEntries()[0];
    const response = await page.goto(`${BASE}items/${first.id}/`);
    expect(response?.status(), "详情页应 200").toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
    await expect(
      page.getByRole("link", { name: /查看百度搜索结果/ }),
    ).toHaveAttribute("href", first.url);
    await expect(page.getByRole("link", { name: /返回时间线/ })).toBeVisible();
  });

  test("过期/不存在详情本地 404：状态 404 且提示条目已过期或不存在（不冒充 GitHub Pages 验收）", async ({ page }) => {
    const absent = "0".repeat(64);
    const response = await page.goto(`${BASE}items/${absent}/`);
    expect(response?.status(), "不存在的条目应返回 404").toBe(404);
    await expect(page.getByText("条目已过期或不存在")).toBeVisible();
    await expect(page.getByRole("link", { name: /返回公共时间线/ })).toBeVisible();
  });
});
