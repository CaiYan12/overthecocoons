import { expect, test, type Page } from "@playwright/test";

const BASE = "/overthecocoons/";
async function ready(page: Page, route = "about") {
  await page.goto(`${BASE}${route}/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
}
async function open(page: Page) {
  await page.locator("[data-kmenu-open]").click();
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
}

for (const preference of ["dark", "light", "auto-dark", "auto-light"] as const) {
  test(`MENU ${preference} 同主题分层与下沿投影，入退全过程不反色`, async ({ page }, testInfo) => {
    const dark = preference.endsWith("dark");
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.addInitScript(value => {
      if (value.startsWith("auto")) localStorage.removeItem("overthecocoons.theme");
      else localStorage.setItem("overthecocoons.theme", value);
    }, preference);
    await ready(page);
    const colors = await page.evaluate(() => {
      const surface = document.querySelector(".k-menu-surface")!;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const rgba = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      };
      const background = getComputedStyle(surface).backgroundColor;
      return { background, panel: rgba(background), page: rgba(getComputedStyle(document.body).backgroundColor) };
    });
    const background = colors.background;
    expect(colors.panel[3], "面板始终不透明").toBe(255);
    for (let channel = 0; channel < 3; channel++) {
      const difference = dark ? colors.panel[channel]! - colors.page[channel]! : colors.page[channel]! - colors.panel[channel]!;
      expect(difference, "浅色略压暗／暗色略提亮，不反转主题").toBeGreaterThan(5);
      expect(difference, "亮度变化克制").toBeLessThan(18);
    }
    const ink = dark ? "rgb(244, 239, 229)" : "rgb(33, 30, 27)";
    await page.evaluate(() => {
      const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
      const surface = menu.querySelector(".k-menu-surface")!;
      const frames: Array<{ state: string; background: string; opacity: string }> = [];
      (window as unknown as { menuColors: typeof frames }).menuColors = frames;
      const sample = () => {
        if (menu.open) frames.push({ state: menu.dataset.menuState!, background: getComputedStyle(surface).backgroundColor, opacity: getComputedStyle(surface).opacity });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.querySelector<HTMLButtonElement>("[data-kmenu-open]")!.click();
    });
    await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
    await expect(page.locator(".k-menu-surface")).toHaveCSS("background-color", background);
    expect(await page.locator(".k-menu-surface").evaluate(el => getComputedStyle(el).boxShadow), "面板有下沿投影").not.toBe("none");
    await expect(page.locator(".k-mi:not([aria-current=page]) .lb").first()).toHaveCSS("color", ink);
    await expect(page.locator("[data-kmenu-close]")).toHaveCSS("color", ink);
    await expect(page.locator(".k-menu .k-scrollbar-thumb")).toHaveCSS("background-color", ink);
    if (testInfo.project.name === "chromium" && !preference.startsWith("auto")) {
      await page.screenshot({ path: testInfo.outputPath(`menu-${preference}.png`), animations: "allow" });
    }
    const captureEdge = testInfo.project.name === "chromium" && !preference.startsWith("auto");
    if (captureEdge) await page.evaluate(() => { (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0.1); });
    await page.locator("[data-kmenu-close]").click();
    if (captureEdge) {
      await page.waitForFunction(() => {
        const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
        const ratio = menu.querySelector(".k-menu-surface")!.getBoundingClientRect().bottom / menu.clientHeight;
        return ratio > 0.45 && ratio < 0.65;
      });
      await page.screenshot({ path: testInfo.outputPath(`menu-${preference}-edge.png`), animations: "allow" });
      await page.evaluate(() => { (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(1); });
    }
    await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
    const frames = await page.evaluate(() => (window as unknown as { menuColors: Array<{ state: string; background: string; opacity: string }> }).menuColors);
    for (const state of ["opening", "closing"]) {
      const samples = frames.filter(frame => frame.state === state);
      expect(samples.length, `${state} 配色采样`).toBeGreaterThan(1);
      expect(samples.every(frame => frame.background === background && frame.opacity === "1"), `${state} 无反色／透明闪光`).toBe(true);
    }
  });
}

test("面板不透明地自顶下拉，关闭沿原路上收，光标坐标不随面板移动", async ({ page, isMobile }) => {
  await ready(page);
  if (!isMobile) await page.mouse.move(200, 600);
  await page.evaluate(() => {
    const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
    const surface = menu.querySelector<HTMLElement>(".k-menu-surface")!;
    const frames: Array<{ state: string; bottom: number; opacity: string; cursorY: number | null; exposed: boolean; legible: boolean }> = [];
    (window as unknown as { menuFrames: typeof frames }).menuFrames = frames;
    const sample = () => {
      if (menu.open) frames.push({ state: menu.dataset.menuState!, bottom: surface.getBoundingClientRect().bottom / menu.clientHeight,
        opacity: getComputedStyle(surface).opacity,
        cursorY: document.querySelector("[data-kcursor-dot]")?.getBoundingClientRect().y ?? null,
        exposed: menu.dataset.menuPointer === "exposed",
        legible: getComputedStyle(document.querySelector("[data-kcursor]")!).mixBlendMode === "normal" &&
          getComputedStyle(document.querySelector("[data-kcursor-dot]")!).backgroundColor === getComputedStyle(menu).color });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>("[data-kmenu-open]")!.click(); });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
  await page.locator("[data-kmenu-close]").click();
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  const frames = await page.evaluate(() => (window as unknown as { menuFrames: Array<{ state: string; bottom: number; opacity: string; cursorY: number | null; exposed: boolean; legible: boolean }> }).menuFrames);
  for (const state of ["opening", "closing"]) {
    const middle = frames.filter(f => f.state === state && f.bottom > 0.005 && f.bottom < 0.995);
    expect(middle.length, `${state} 存在真实下拉／上收中间帧`).toBeGreaterThan(1);
    expect(middle.every(f => f.opacity === "1"), "背景不使用透明度渐变").toBe(true);
    const values = middle.map(f => f.bottom);
    expect(values.every((v, i) => i === 0 || (state === "opening" ? v >= values[i - 1]! - 0.001 : v <= values[i - 1]! + 0.001))).toBe(true);
    if (!isMobile && state === "opening") {
      const cursorY = middle.map(f => f.cursorY!);
      expect(Math.max(...cursorY) - Math.min(...cursorY), "面板移动不改变固定光标坐标").toBeLessThan(1);
      const exposed = middle.filter(f => f.exposed);
      expect(exposed.length, "覆盖边缘外存在光标采样").toBeGreaterThan(0);
      expect(exposed.every(f => f.legible), "透明顶层外使用正常混合的墨色光标").toBe(true);
    }
  }
  await expect(page.locator("[data-kmenu-open]")).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  if (!isMobile) expect(await page.locator("[data-kcursor]").evaluate(el => Boolean(el.closest("dialog")))).toBe(false);
});

test("链接等面板完全退出才发起导航，不串联目录退场", async ({ page }) => {
  await ready(page);
  await open(page);
  await page.evaluate(() => {
    const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
    const original = menu.close.bind(menu);
    menu.close = (...args) => {
      const surface = menu.querySelector(".k-menu-surface")!;
      sessionStorage.setItem("menuExit", JSON.stringify({ ratio: surface.getBoundingClientRect().bottom / menu.clientHeight,
        tocOpacity: getComputedStyle(document.querySelector(".k-toccol")!).opacity }));
      original(...args);
    };
  });
  await page.locator('.k-menu-list a[href="/overthecocoons/privacy/"]').click();
  await expect(page).toHaveURL(`${BASE}privacy/`);
  const end = await page.evaluate(() => JSON.parse(sessionStorage.getItem("menuExit")!));
  expect(end.ratio).toBeLessThan(0.001);
  expect(end.tocOpacity).toBe("1");
});

test("入场中关闭从当前帧上收，重复点击不重播，最后目的地接管且 Esc 可取消", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const sdk = window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } };
    sdk.gsap.globalTimeline.timeScale(0.5);
    document.querySelector<HTMLButtonElement>("[data-kmenu-open]")!.click();
  });
  await page.waitForFunction(() => {
    const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
    const bottom = menu.querySelector(".k-menu-surface")!.getBoundingClientRect().bottom / menu.clientHeight;
    return bottom > 0.2 && bottom < 0.9;
  });
  const delta = await page.evaluate(() => {
    const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
    const surface = menu.querySelector(".k-menu-surface")!;
    const before = surface.getBoundingClientRect().bottom;
    menu.querySelector<HTMLButtonElement>("[data-kmenu-close]")!.click();
    return Math.abs(surface.getBoundingClientRect().bottom - before);
  });
  expect(delta).toBeLessThan(1);
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  await open(page);
  await page.evaluate(() => {
    const links = document.querySelectorAll<HTMLAnchorElement>(".k-menu-list a");
    links[1]!.click(); links[1]!.click(); links[4]!.click();
  });
  await expect(page).toHaveURL(`${BASE}privacy/`);
  await open(page);
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('.k-menu-list a[href="/overthecocoons/sources/"]')!.click();
    document.querySelector("[data-kmenu]")!.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  await expect(page).toHaveURL(`${BASE}privacy/`);
});

test("当前页面重复选择只收起；主题在退出后筛选，说明页主题在退出后导航", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { (window as unknown as { marker: number }).marker = 1; });
  await open(page);
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('.k-menu-list a[aria-current="page"]')!;
    link.click(); link.click(); link.click();
  });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  expect(await page.evaluate(() => (window as unknown as { marker: number }).marker)).toBe(1);
  await open(page);
  await page.locator('.k-menu-topics [data-topic="新闻"]').click();
  await expect(page).toHaveURL(`${BASE}topics/news/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await open(page);
  await page.evaluate(() => {
    const sdk = window as unknown as { gsap: { globalTimeline: { pause(): void; resume(): void } } };
    sdk.gsap.globalTimeline.pause();
    document.querySelector<HTMLAnchorElement>('.k-menu-topics [data-topic="社会"]')!.click();
  });
  await expect(page.locator('[data-ktabs] [data-topic="新闻"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-kmenu]")).toHaveJSProperty("open", true);
  await page.evaluate(() => { (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume(); });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  await expect(page.locator('[data-ktabs] [data-topic="社会"]')).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(`${BASE}topics/news/`);
});

test("GSAP 停钟与加载失败不困住菜单，页面回收恢复整页滚动", async ({ page }) => {
  await ready(page);
  await open(page);
  await page.evaluate(() => {
    (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap.globalTimeline.pause();
    document.querySelector<HTMLButtonElement>("[data-kmenu-close]")!.click();
  });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed", { timeout: 3000 });
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.evaluate(() => { (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume(); });
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(page.locator("[data-kmenu]")).toHaveJSProperty("open", false);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.route("**/vendor/gsap.min.js", route => route.abort());
  await ready(page);
  await open(page);
  await page.locator('.k-menu-list a[href="/overthecocoons/sources/"]').click();
  await expect(page).toHaveURL(`${BASE}sources/`);
});

test("遵循用户完整动效裁定；短屏可读且修饰键保留原生新窗口", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 500 });
  await ready(page);
  await open(page);
  await expect(page.locator("[data-kmenu-close]")).toBeFocused();
  const topic = page.locator('.k-menu-topics [data-topic="新闻"]');
  await topic.scrollIntoViewIfNeeded();
  await expect(topic).toBeInViewport();
  const popupPromise = context.waitForEvent("page");
  await topic.click({ modifiers: ["Control"] });
  const popup = await popupPromise;
  await popup.waitForURL(`${BASE}topics/news/`);
  await popup.close();
  await expect(page.locator("[data-kmenu]")).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
});

test("入场前停钟兜底直显，恢复时钟后退出不使用旧位移缓存", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap.globalTimeline.pause();
    document.querySelector<HTMLButtonElement>("[data-kmenu-open]")!.click();
  });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open", { timeout: 3000 });
  const ratio = await page.evaluate(() => {
    const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
    return menu.querySelector(".k-menu-surface")!.getBoundingClientRect().bottom / menu.clientHeight;
  });
  expect(ratio).toBeCloseTo(1, 3);
  await page.evaluate(() => { (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume(); });
  await page.evaluate(() => {
    const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]")!;
    const frames: number[] = [];
    (window as unknown as { exitFrames: number[] }).exitFrames = frames;
    const sample = () => { if (menu.open) { frames.push(menu.querySelector(".k-menu-surface")!.getBoundingClientRect().bottom / menu.clientHeight); requestAnimationFrame(sample); } };
    requestAnimationFrame(sample);
    document.querySelector<HTMLButtonElement>("[data-kmenu-close]")!.click();
  });
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "closed");
  const frames = await page.evaluate(() => (window as unknown as { exitFrames: number[] }).exitFrames);
  expect(frames.filter(n => n > 0.01 && n < 0.99).length, "恢复后仍有上收中间帧").toBeGreaterThan(1);
});
