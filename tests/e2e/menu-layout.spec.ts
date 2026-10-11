import { expect, test, type Page } from "@playwright/test";

const BASE = "/overthecocoons/";
async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    };
    return { body: box("body"), brand: box(".k-brand"), main: box(".k-main"),
      gutter: innerWidth - document.documentElement.clientWidth, y: scrollY };
  });
}
async function cycle(page: Page) {
  const before = await geometry(page);
  for (let i = 0; i < 3; i++) {
    await page.locator("[data-kmenu-open]").click();
    await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
    const during = await geometry(page);
    const coverage = await page.locator(".k-menu-surface").evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight &&
        [[0,0],[innerWidth-1,0],[0,innerHeight-1],[innerWidth-1,innerHeight-1]]
          .every(([x,y]) => Boolean(document.elementFromPoint(x!,y!)?.closest("[data-kmenu]")));
    });
    expect(coverage, "MENU 完整覆盖视口及原来滚动条占位的四角").toBe(true);
    for (const key of ["body", "brand", "main"] as const) {
      expect(during[key].left, `${key} opening left`).toBeCloseTo(before[key].left, 3);
      expect(during[key].width, `${key} opening width`).toBeCloseTo(before[key].width, 3);
    }
    expect(during.y).toBe(before.y);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
    const after = await geometry(page);
    expect(after).toEqual(before);
  }
}

test("真实占宽滚动条：连续开关 MENU 不改变正文或固定页头水平几何", async ({ browser, browserName, isMobile, baseURL }) => {
  test.skip(browserName !== "chromium" || isMobile, "独立桌面 Chromium，保留占宽滚动条绘制");
  const classic = await browser.browserType().launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const page = await classic.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
    for (const route of [`${BASE}about/`, BASE]) {
      await page.goto(route);
      await page.waitForSelector('html[data-oct-client="ready"]');
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 300, behavior: "instant" }); });
      await expect.poll(() => page.locator("[data-kheader]").evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-0.1);
      const before = await geometry(page);
      await expect(page.locator("html")).toHaveAttribute("data-oct-scrollbars", "ready");
      expect(before.gutter, "真实绘制滚动条的环境中，自绘增强也不占原生槽位").toBe(0);
      await cycle(page);
    }
    // 在同一浏览器禁用JS，确认该环境确实有15px等非零原生槽位，而非默认隐藏条假绿。
    const fallback = await classic.newPage({ baseURL, javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    await fallback.goto(`${BASE}about/`);
    expect((await geometry(fallback)).gutter).toBeGreaterThan(0);
  } finally { await classic.close(); }
});

test("各浏览器与手机：MENU 连续开关保持主页面位置与宽度", async ({ page }) => {
  await page.goto(`${BASE}about/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await cycle(page);
});
