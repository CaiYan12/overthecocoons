import { expect, test } from "@playwright/test";
import { wheelBy } from "./helpers.ts";

const BASE = "/overthecocoons/";
const PAGES = [
  { slug: "about", title: "关于", last: "submit" },
  { slug: "principles", title: "原则", last: "quarantine" },
  { slug: "privacy", title: "隐私", last: "data" },
];

for (const { slug, title, last } of PAGES) {
test(`${title}页保留全站导航，并能返回来源与时间线`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${slug}/`);
  const nav = page.getByRole("complementary", { name: "功能导航" });
  await expect(nav.locator("nav a")).toHaveText(["时间线", "来源", "关于", "原则", "隐私", "返回主站"]);
  await expect(nav.getByRole("link", { name: title, exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "来源", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}sources/`);
  await page.goto(`${BASE}${slug}/`);
  await nav.getByRole("link", { name: "时间线", exact: true }).click();
  await expect(page).toHaveURL(BASE);
});

test(`${title}极矮桌面：整页滚动，键盘能到达每个导航与目录入口`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto(`${BASE}${slug}/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const sidebar = page.locator(".k-docnav");
  const links = sidebar.locator("a");
  await links.first().focus();
  for (let i = 0; i < await links.count(); i++) {
    await expect(links.nth(i)).toBeFocused();
    await expect.poll(async () => {
      const box = await links.nth(i).boundingBox();
      const header = await page.locator("[data-kheader]").boundingBox();
      return box!.y >= header!.y + header!.height && box!.y + box!.height <= 360;
    }, { message: "浏览器完成焦点滚动后，聚焦入口完整可见" }).toBe(true);
    if (i + 1 < await links.count()) await page.keyboard.press("Tab");
  }
  expect(await sidebar.evaluate((el) => el.scrollTop), "侧栏不独立滚动").toBe(0);
  expect(await page.evaluate(() => scrollY), "整页发生滚动").toBeGreaterThan(0);
  expect(await page.locator(".k-toccol").evaluate((el) => el.scrollTop)).toBe(0);
  await links.last().click();
  await expect(page).toHaveURL(`${BASE}${slug}/#${last}`);
});

test(`${title}常规短屏：滚轮由整页处理，目录保持完整高度`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}${slug}/`);
  const nav = page.getByRole("complementary", { name: "功能导航" });
  const toc = page.getByRole("complementary", { name: "本页目录" });
  await toc.scrollIntoViewIfNeeded();
  const box = await toc.boundingBox();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await wheelBy(page, 450);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  expect(await toc.evaluate((el) => el.scrollTop)).toBe(0);
  await nav.locator("nav a").first().scrollIntoViewIfNeeded();
  await nav.getByRole("link", { name: "时间线", exact: true }).click();
  await expect(page).toHaveURL(BASE);
});

test(`${title}跳到最后章节后，可整页返回全站入口`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}${slug}/#${last}`);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  const link = page.getByRole("complementary", { name: "功能导航" }).getByRole("link", { name: "时间线", exact: true });
  await link.scrollIntoViewIfNeeded();
  const header = await page.locator("[data-kheader]").boundingBox();
  await expect.poll(async () => (await link.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await link.click();
  await expect(page).toHaveURL(BASE);
});

for (const width of [1024, 390]) {
  test(`${title}窄屏 ${width}：沿用 MENU，手机目录位于正文之前`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}${slug}/`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator(".k-docnav .k-nav")).toBeHidden();
    const toc = page.locator(".k-toccol");
    if (width === 1024) {
      await expect(toc).toBeHidden();
    } else {
      await expect(toc).toBeVisible();
      const header = await page.locator("[data-kheader]").boundingBox();
      expect((await toc.locator("a").first().boundingBox())!.y, "首个章节入口避开固定页头").toBeGreaterThanOrEqual(header!.y + header!.height);
      const box = await toc.boundingBox();
      const article = await page.locator(".k-doc").boundingBox();
      expect(box!.y + box!.height, "目录先于正文").toBeLessThanOrEqual(article!.y);
      await toc.locator("a").last().click();
      await expect(page).toHaveURL(`${BASE}${slug}/#${last}`);
    }
    await page.locator("[data-kmenu-open]").click();
    await page.locator(`.k-menu-list a[href="${BASE}"]`).click();
    await expect(page).toHaveURL(BASE);
  });
}

test(`${title}无 JS：全站入口和章节锚点仍可使用`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 1440, height: 600 } });
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}${slug}/`);
    await page.getByRole("complementary", { name: "本页目录" }).locator("a").last().click();
    await expect(page).toHaveURL(`${BASE}${slug}/#${last}`);
    await page.getByRole("complementary", { name: "功能导航" }).getByRole("link", { name: "时间线", exact: true }).press("Enter");
    await expect(page).toHaveURL(BASE);
  } finally {
    await context.close();
  }
});
}

test("调整窗口高度后，侧栏继续保持无内部滚动", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto(`${BASE}about/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const last = page.locator(".k-toccol a").last();
  await last.focus();
  await page.setViewportSize({ width: 1440, height: 600 });
  await expect.poll(() => page.locator(".k-docnav").evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole("complementary", { name: "功能导航" }).getByRole("link", { name: "时间线", exact: true }).click();
  await expect(page).toHaveURL(BASE);
});

for (const height of [430, 450]) {
  test(`临界高度 ${height}：完整目录用整页滚动到达`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await page.goto(`${BASE}principles/`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    const last = page.locator(".k-toccol a").last();
    await last.focus();
    expect(await page.locator(".k-docnav").evaluate((el) => el.scrollTop)).toBe(0);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await page.locator(".k-toccol").evaluate((el) => el.scrollTop)).toBe(0);
    const box = await last.boundingBox();
    const header = await page.locator("[data-kheader]").boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    await last.click();
    await expect(page).toHaveURL(`${BASE}principles/#quarantine`);
  });
}
