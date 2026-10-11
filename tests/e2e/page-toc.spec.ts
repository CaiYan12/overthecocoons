import { expect, test } from "@playwright/test";
import { pickTopic } from "./helpers.ts";

const BASE = "/overthecocoons/";

for (const height of [600, 900]) {
  test(`目录在${height}px窗口滚到页底不覆盖底部信息栏`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    for (const path of ["sources/", "about/", "principles/", "privacy/", ""]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector('html[data-oct-client="ready"]');
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect.poll(async () => page.evaluate(() => {
        const sidebar = document.querySelector("[data-docnav]")!.getBoundingClientRect();
        const footer = document.querySelector("footer")!.getBoundingClientRect();
        return sidebar.bottom - footer.top;
      }), { message: `${path || "时间线"} 目录底部不得进入页脚区域` }).toBeLessThanOrEqual(0);
    }
  });
}

test("目录完整撑开布局，不再裁切或创建内部滚动区", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}sources/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const sidebar = page.locator("[data-docnav]");
  await expect(sidebar).toHaveCSS("max-height", "none");
  await expect(sidebar).toHaveCSS("overflow-y", "visible");
  await expect(page.locator(".k-toccol")).toHaveCSS("overflow-y", "visible");
  const before = await sidebar.evaluate((el) => el.getBoundingClientRect().height);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector("[data-docnav]")!;
    const panel = document.querySelector(".k-toccol")!;
    const last = document.querySelector("[data-toc] li:last-child a")!;
    return { height: sidebar.getBoundingClientRect().height, overflow: sidebar.scrollHeight - sidebar.clientHeight,
      lastBottom: last.getBoundingClientRect().bottom, panelBottom: panel.getBoundingClientRect().bottom,
      footerTop: document.querySelector("footer")!.getBoundingClientRect().top, sidebarBottom: sidebar.getBoundingClientRect().bottom };
  });
  expect(Math.abs(layout.height - before), "页底不再压缩目录高度").toBeLessThan(1);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.lastBottom).toBeLessThanOrEqual(layout.panelBottom);
  expect(layout.sidebarBottom).toBeLessThan(layout.footerTop);
});

test("极矮窗口通过整页滚动让所有目录链接获得可见焦点", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto(`${BASE}sources/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const links = page.locator("[data-docnav] a");
  await links.first().focus();
  for (let i = 0; i < await links.count(); i++) {
    await expect(links.nth(i)).toBeFocused();
    await expect.poll(async () => {
      const box = (await links.nth(i).boundingBox())!;
      const header = (await page.locator("[data-kheader]").boundingBox())!;
      return box.y >= header.y + header.height && box.y + box.height <= 360;
    }).toBe(true);
    if (i + 1 < await links.count()) await page.keyboard.press("Tab");
  }
  expect(await page.locator("[data-docnav]").evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test("来源目录对应真实章节，链接与当前章节可用", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}sources/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const headings = await page.locator(".k-doc h2[id]").evaluateAll((nodes) => nodes.map((el) => ({ id: el.id, label: el.textContent!.trim() })));
  const links = page.locator("[data-toc] a");
  await expect(links).toHaveCount(headings.length);
  for (let i = 0; i < headings.length; i++) {
    await expect(links.nth(i)).toHaveAttribute("href", `#${headings[i]!.id}`);
    await expect(links.nth(i)).toHaveText(headings[i]!.label);
  }
  await links.last().click();
  await expect(page.locator("[data-toc] [aria-current=location]")).toHaveText(headings.at(-1)!.label);
});

test("时间线日期目录随筛选和分页同步，没有陈旧锚点", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE);
  await page.waitForSelector('html[data-oct-client="ready"]');
  let documents = 0;
  page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  const selectTopic = async (topic: string) => {
    await pickTopic(page, topic);
    await expect(page.locator(`[data-ktabs] [data-topic="${topic}"]`)).toHaveAttribute("aria-current", "true");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
  };
  const assertDates = async () => {
    const groups = await page.locator(".k-day").evaluateAll((nodes) => nodes.map((el) => ({ id: el.id, label: `${(el as HTMLElement).dataset.day} · ${el.querySelectorAll(".k-entry").length} 条` })));
    await expect(page.locator("[data-toc] a")).toHaveCount(groups.length);
    for (let i = 0; i < groups.length; i++) {
      await expect(page.locator("[data-toc] a").nth(i)).toHaveAttribute("href", `#${groups[i]!.id}`);
      await expect(page.locator("[data-toc] a").nth(i)).toHaveText(groups[i]!.label);
    }
  };
  await assertDates();
  await selectTopic("新闻");
  await assertDates();
  await page.getByRole("link", { name: "第 2 页", exact: true }).click();
  await assertDates();
  await selectTopic("科技");
  await expect(page.locator("[data-toc] a")).toHaveCount(0);
  await expect(page.locator("[data-toc-empty]")).toBeVisible();
  await selectTopic("全部");
  await assertDates();
  expect(documents, "主题与分页保持客户端切换，目录不能额外发起整页导航").toBe(0);
  const last = page.locator("[data-toc] a").last();
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "location");
});

for (const width of [1440, 390]) {
  test(`新增目录 ${width}px：无 JS 的来源章节与时间线日期锚点可用`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width, height: 844 } });
    const page = await context.newPage();
    try {
      for (const path of ["sources/", ""]) {
        await page.goto(`${BASE}${path}`);
        const link = page.locator("[data-toc] a").last();
        await expect(link).toBeVisible();
        const href = await link.getAttribute("href");
        await link.click();
        await expect(page).toHaveURL(`${BASE}${path}${href}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        await expect.poll(() => page.evaluate(() => document.querySelector("[data-docnav]")!.getBoundingClientRect().bottom - document.querySelector("footer")!.getBoundingClientRect().top)).toBeLessThanOrEqual(0);
      }
    } finally { await context.close(); }
  });
}

test("来源与时间线极矮侧栏：焦点链接保持可见", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 430 });
  for (const path of ["sources/", ""]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    const link = page.locator("[data-toc] a").last();
    await link.focus();
    await expect.poll(async () => (await link.boundingBox())!.y + (await link.boundingBox())!.height).toBeLessThanOrEqual(430);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test("手机新增目录的锚点跳转匹配当前章节或日期", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["sources/", ""]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    const last = page.locator("[data-toc] a").last();
    await last.click();
    await expect(last).toHaveAttribute("aria-current", "location");
  }
});
