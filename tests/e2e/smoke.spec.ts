import { expect, test } from "@playwright/test";

const BASE = "/overthecocoons/";

test.describe("占位首页冒烟（Ticket 01）", () => {
  test("基路径下返回 200 且标题正确", async ({ page }) => {
    const response = await page.goto(BASE);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/跳出茧房/);
  });

  test("页面资源全部经基路径可达（无失败请求、无跨前缀资源）", async ({ page }) => {
    const failed: string[] = [];
    const offBase: string[] = [];
    page.on("requestfailed", (request) => {
      failed.push(`${request.url()} :: ${request.failure()?.errorText}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failed.push(`${response.url()} :: HTTP ${response.status()}`);
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
      await page.screenshot({
        path: `test-results/screenshots/home-${width}.png`,
        fullPage: true,
      });
    }
  });

  test("禁用 JS 后页面仍可读", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BASE);
    await expect(
      page.getByRole("heading", { name: /跳出茧房/ }),
    ).toBeVisible();
    await expect(page.getByText("演示数据").first()).toBeVisible();
    await context.close();
  });

  test("页面不包含任何 <script> 标签（无 JS 可读的结构性保证）", async ({ page }) => {
    await page.goto(BASE);
    const scriptCount = await page.evaluate(
      () => document.querySelectorAll("script").length,
    );
    expect(scriptCount, "占位首页不应包含脚本标签").toBe(0);
  });
});
