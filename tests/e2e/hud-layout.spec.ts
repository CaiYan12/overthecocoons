import { expect, test } from "@playwright/test";

const BASE = "/overthecocoons/";

test("右侧栏完整撑开正文行，短屏和页底不覆盖底部信息栏", async ({ page }) => {
  for (const width of [1440, 1024]) {
    for (const height of [360, 600, 900]) {
      await page.setViewportSize({ width, height });
      for (const path of ["", "page/3/", "topics/tech/", "sources/", "privacy/"]) {
        await page.goto(`${BASE}${path}`);
        await page.waitForSelector('html[data-oct-client="ready"]');
        if (path === "page/3/") {
          // 详情页的footer位于grid之外，也必须由完整右栏撑开。
          const detail = await page.locator(".k-headline a").first().getAttribute("href");
          await checkHud();
          await page.goto(detail!);
          await page.waitForSelector('html[data-oct-client="ready"]');
        }
        await checkHud();
      }
      async function checkHud() {
        const hud = page.locator("[data-khud]");
        const before = await hud.evaluate((el) => el.getBoundingClientRect().height);
        await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        const layout = await hud.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return { height: box.height, bottom: box.bottom, footer: document.querySelector("footer")!.getBoundingClientRect().top,
            position: style.position, top: parseFloat(style.top), overflow: style.overflowY, max: style.maxHeight, localScroll: el.scrollTop };
        });
        expect(layout.bottom, `${width}×${height} ${page.url()}`).toBeLessThanOrEqual(layout.footer);
        expect(layout.height).toBeCloseTo(before, 1);
        expect(layout.overflow).toBe("visible");
        expect(layout.max).toBe("none");
        expect(layout.localScroll).toBe(0);
        expect(layout.position).toBe(before <= height - layout.top - 24 ? "sticky" : "static");
      }
    }
  }
});

test("右侧栏无JS仍完整排在页脚之前，手机保留时间线前置和长文后置", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 600 } });
    try {
      const page = await context.newPage();
      for (const path of ["", "privacy/"]) {
        await page.goto(`${BASE}${path}`);
        await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        const layout = await page.evaluate(() => {
          const hud = document.querySelector("[data-khud]")!;
          const box = hud.getBoundingClientRect();
          const main = document.querySelector("[data-kmain]")!.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, mainTop: main.top, mainBottom: main.bottom,
            footer: document.querySelector("footer")!.getBoundingClientRect().top, position: getComputedStyle(hud).position,
            overflow: getComputedStyle(hud).overflowY, horizontal: document.documentElement.scrollWidth - innerWidth };
        });
        expect(layout.bottom).toBeLessThanOrEqual(layout.footer);
        expect(layout.position).toBe("static");
        expect(layout.overflow).toBe("visible");
        expect(layout.horizontal).toBeLessThanOrEqual(1);
        if (width === 390) {
          if (path === "") expect(layout.bottom).toBeLessThanOrEqual(layout.mainTop);
          else expect(layout.top).toBeGreaterThanOrEqual(layout.mainBottom);
        }
      }
    } finally { await context.close(); }
  }
});

test("右侧栏短屏键盘入口由整页滚动显示，缩放后重新判断吸附", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}topics/tech/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const hud = page.locator("[data-khud]");
  await expect(hud).toHaveCSS("position", "sticky");
  await page.setViewportSize({ width: 1440, height: 360 });
  await expect(hud).toHaveCSS("position", "static");
  const links = hud.locator("a");
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
  expect(await hud.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(hud).toHaveCSS("position", "sticky");
});
