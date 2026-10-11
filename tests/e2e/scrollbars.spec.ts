import { expect, test } from "@playwright/test";

const BASE = "/overthecocoons/";

test("页面滚动条从导航下方开始，响应式切换后不覆盖导航", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}about/`);
    await page.waitForSelector('html[data-oct-scrollbars="ready"]');
    const gap = await page.evaluate(() => {
      const nav = document.querySelector("[data-kheader]")!.getBoundingClientRect();
      const track = document.querySelector('[data-scrollbar="page"]')!.getBoundingClientRect();
      return track.top - nav.bottom;
    });
    expect(gap, "滚动条起点在导航底边下留6px间距").toBeCloseTo(6, 2);
    const track = page.locator('[data-scrollbar="page"]');
    await track.focus(); await page.keyboard.press("End");
    await expect(track).toHaveAttribute("aria-valuenow", "100");
  }
});

for (const scope of ["page", "menu"]) {
test(`${scope} 滚动条悬停有中间帧，捕获拖拽期间自定义点和圆环同步跟随`, async ({ page, isMobile }) => {
  test.skip(isMobile, "悬停和自定义光标是精细鼠标交互");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}about/`);
  await page.waitForSelector('html[data-oct-scrollbars="ready"]');
  if (scope === "menu") {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.locator("[data-kmenu-open]").click();
    await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
  }
  const track = page.locator(`[data-scrollbar="${scope}"]`);
  const thumb = track.locator(".k-scrollbar-thumb");
  await page.mouse.move(200, 450);
  await expect.poll(() => thumb.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(3, 1);
  await page.evaluate((scope) => {
    const track = document.querySelector(`[data-scrollbar="${scope}"]`)!;
    const thumb = track.querySelector(".k-scrollbar-thumb")!;
    const frames: number[] = [];
    (window as unknown as { hoverWidths: number[] }).hoverWidths = frames;
    // 从真实hover事件开始取帧，避免驱动器等待期间先耗尽采样窗口。
    track.addEventListener("pointerenter", () => {
      const end = performance.now() + 500;
      const sample = () => { frames.push(thumb.getBoundingClientRect().width); if (performance.now() < end) requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    }, { once: true });
  }, scope);
  await track.hover();
  await expect.poll(() => thumb.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(6, 1);
  const frames = await page.evaluate(() => (window as unknown as { hoverWidths: number[] }).hoverWidths);
  const box = (await thumb.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(track).toHaveAttribute("data-dragging", "");
  for (const shift of [40, 80, 120]) {
    await page.mouse.move(x - 20, y + shift);
    const error = await page.evaluate(async ({ x, y }) => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const dot = document.querySelector("[data-kcursor-dot]")!.getBoundingClientRect();
      const ring = document.querySelector("[data-kcursor-ring]")!.getBoundingClientRect();
      return Math.max(Math.abs(dot.x + dot.width / 2 - x), Math.abs(dot.y + dot.height / 2 - y),
        Math.abs(ring.x + ring.width / 2 - x), Math.abs(ring.y + ring.height / 2 - y));
    }, { x: x - 20, y: y + shift });
    expect(error, "指针捕获时下一绘制帧内同步跟随").toBeLessThan(1);
  }
  await page.mouse.up();
  await expect(track).not.toHaveAttribute("data-dragging", "");
  expect(frames.filter(w => w > 3.05 && w < 5.95).length, "宽度变化必须有中间帧，不能瞬间跳变").toBeGreaterThan(1);
});
}
test("自绘条同步原生页面，支持键盘、轨道、拖拽且 resize 后比例正确", async ({ page, isMobile }) => {
  await page.goto(`${BASE}about/`);
  await page.waitForSelector('html[data-oct-scrollbars="ready"]');
  const track = page.getByRole("scrollbar", { name: "页面滚动条" });
  await expect(track).toBeVisible();
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(0);
  await track.focus();
  await page.keyboard.press("End");
  await expect(track).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("Home");
  await expect(track).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("PageDown");
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await page.keyboard.press("Home");
  const box = (await track.boundingBox())!;
  await track.click({ position: { x: box.width / 2, y: box.height - 10 } });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  if (!isMobile) {
    await track.focus(); await page.keyboard.press("Home");
    await expect(track).toHaveAttribute("aria-valuenow", "0");
    const thumb = (await track.locator(".k-scrollbar-thumb").boundingBox())!;
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
    await expect(track).not.toHaveAttribute("data-dragging", "");
  }
  await page.setViewportSize({ width: 390, height: 600 });
  await track.focus(); await page.keyboard.press("End");
  await expect(track).toHaveAttribute("aria-valuenow", "100");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("MENU 填满视口与四角，短屏菜单自绘条可滚到最后主题且背景不动", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto(`${BASE}about/`);
  await page.waitForSelector('html[data-oct-scrollbars="ready"]');
  const before = await page.evaluate(() => ({ y: scrollY, width: document.body.getBoundingClientRect().width }));
  await page.locator("[data-kmenu-open]").click();
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
  const cover = await page.evaluate(() => {
    const surface = document.querySelector(".k-menu-surface")!;
    const rect = surface.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      corners: [[0, 0], [innerWidth - 1, 0], [0, innerHeight - 1], [innerWidth - 1, innerHeight - 1]]
        .every(([x,y]) => Boolean(document.elementFromPoint(x!,y!)?.closest("[data-kmenu]"))) };
  });
  expect(cover).toEqual({ x: 0, y: 0, width: 390, height: 500, corners: true });
  await expect(page.getByRole("scrollbar", { name: "页面滚动条" })).toBeHidden();
  const track = page.getByRole("scrollbar", { name: "菜单滚动条" });
  await expect(track).toBeVisible();
  if (!isMobile) {
    const thumb = (await track.locator(".k-scrollbar-thumb").boundingBox())!;
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 70, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.locator(".k-menu-inner").evaluate(el => el.scrollTop)).toBeGreaterThan(10);
    await track.focus(); await page.keyboard.press("Home");
    await expect(track).toHaveAttribute("aria-valuenow", "0");
    await track.hover(); await page.mouse.wheel(0, 60);
    await expect.poll(() => page.locator(".k-menu-inner").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  }
  await track.focus(); await page.keyboard.press("End");
  await expect(track).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator('.k-menu-topics [data-topic="哲学"]')).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(before.y);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  expect(await page.evaluate(() => document.body.getBoundingClientRect().width)).toBe(before.width);
});

test("模块被阻止或无JS时不留下隐藏滚动条，自绘控件不成为空壳", async ({ page, browser, baseURL }) => {
  await page.route("**/src/client/index.ts*", route => route.abort());
  await page.route("**/_astro/*.js", route => route.abort());
  await page.goto(`${BASE}about/`);
  await expect(page.locator("html")).not.toHaveAttribute("data-oct-scrollbars", /.+/, { timeout: 4000 });
  const staticPage = await browser.newPage({ baseURL, javaScriptEnabled: false });
  try {
    await staticPage.goto(`${BASE}about/`);
    // Firefox 本配置的无JS原生基线也返回 none；比较真实基线而不臆造UA行为。
    const nativeWidth = await staticPage.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth),
      { timeout: 3000, message: "增强失效后恢复同一浏览器的原生基线" }).toBe(nativeWidth);
    await expect(page.locator("[data-scrollbar=page]")).toBeHidden();
    await expect(staticPage.locator("[data-scrollbar=page]")).toBeHidden();
  } finally { await staticPage.close(); }
});
