import { expect, test, type Locator, type Page } from "@playwright/test";
import { pickTopic } from "./helpers.ts";
import { mkdirSync } from "node:fs";

const BASE = "/overthecocoons/";
const line = (link: Locator) => link.evaluate((el) => {
  const target = el.querySelector(".k-link-label, .lb") ?? el;
  const style = getComputedStyle(target);
  return { size: Number.parseFloat(style.backgroundSize), duration: style.transitionDuration,
    decoration: style.textDecorationLine, image: style.backgroundImage,
    color: getComputedStyle(el).color, parent: getComputedStyle(el.parentElement!).color,
    position: style.backgroundPosition, height: style.backgroundSize.split(" ")[1] };
});

test("品牌导航标题及动态链接统一LINK；按钮与版画保留原档位", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "自绘光标仅精细指针");
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, "");
  const cursor = page.locator("[data-kcursor-label]");
  for (const selector of [".k-brand", "[data-ktabs] a", ".k-nav a", ".k-headline a", ".k-meta a", ".k-foot-nav a"]) {
    const link = page.locator(selector).first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await expect(cursor, selector).toHaveText("LINK");
    await expect.poll(() => line(link).then(s => s.size), { message: selector }).toBe(100);
    const style = await line(link);
    expect(style.decoration, selector).toBe("none");
    expect(style.color, selector).toBe(style.parent);
  }
  await pickTopic(page, "新闻");
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
  for (const selector of [".k-headline a", ".k-meta a", '.pager a[data-page="2"]', "[data-toc] a"]) {
    const link = page.locator(selector).first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await expect(cursor).toHaveText("LINK");
    await expect.poll(() => line(link).then(s => s.size)).toBe(100);
  }
  const media = page.locator(".k-media").first();
  await media.hover();
  await expect(cursor).toHaveText("OPEN");
  await page.locator("[data-mode]").hover();
  await expect.poll(() => cursor.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(0);
});

async function ready(page: Page, path = "about/") {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('html[data-oct-client="ready"]');
}

test("普通内外链常态继承颜色且无下划线，hover完整行程700ms", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "精细指针hover；触屏另测");
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  const link = page.locator(".k-doc a.ext").first();
  await link.scrollIntoViewIfNeeded();
  await expect.poll(() => link.evaluate((el) => el.closest("section")?.querySelector("h2")?.getAttribute("data-doc-reveal"))).toBe("done");
  await page.mouse.move(1, 1);
  const initial = await line(link);
  expect(initial.decoration).toBe("none");
  expect(initial.color).toBe(initial.parent);
  expect(initial.size).toBe(0);
  expect(initial.duration).toBe("0.7s");
  expect(initial.height).toBe("1px");
  await link.hover();
  expect(await link.evaluate(el => ({ hover: el.matches(":hover"), fine: matchMedia("(hover: hover) and (pointer: fine)").matches }))).toEqual({ hover: true, fine: true });
  await expect.poll(async () => (await line(link)).size).toBe(100);
  expect((await line(link)).color).toBe(initial.parent);
});

test("进退实际帧方向、完整700ms及快速反向接续，HUD不位移不叠线", async ({ page }, info) => {
  test.skip(Boolean(info.project.use.isMobile), "精细指针hover");
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  const link = page.locator("[data-khud] .k-link").first();
  await expect(page.locator("[data-khud] .sec").last()).toHaveAttribute("data-doc-reveal", "done");
  await page.mouse.move(1, 1);
  const box = await link.boundingBox();
  const frames = async (duration: number) => link.evaluate(async (el, duration) => {
    const target = el.querySelector(".k-link-label") ?? el;
    const start = performance.now();
    const out: Array<{ t: number; size: number }> = [];
    await new Promise<void>(resolve => {
      const frame = () => {
        out.push({ t: performance.now() - start, size: parseFloat(getComputedStyle(target).backgroundSize) });
        if (performance.now() - start < duration) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    return out;
  }, duration);
  await link.hover();
  const enter = await frames(760);
  expect(enter.filter(f => f.size > 1 && f.size < 99).length).toBeGreaterThan(3);
  expect(enter.find(f => f.size === 100)!.t).toBeGreaterThan(540);
  expect(enter.find(f => f.size === 100)!.t).toBeLessThan(760);
  expect(enter.every((f, i) => !i || f.size >= enter[i - 1]!.size)).toBe(true);
  await page.mouse.move(1, 1);
  const exit = await frames(760);
  expect(exit.find(f => f.size === 0)!.t).toBeGreaterThan(540);
  expect(exit.every((f, i) => !i || f.size <= exit[i - 1]!.size)).toBe(true);
  await link.hover();
  const partial = await frames(160);
  const before = partial.at(-1)!.size;
  expect(before).toBeGreaterThan(0);
  expect(before).toBeLessThan(100);
  await page.mouse.move(1, 1);
  const reverse = await frames(140);
  expect(reverse[0]!.size).toBeGreaterThan(0);
  expect(Math.abs(reverse[0]!.size - before)).toBeLessThan(18);
  expect(reverse.at(-1)!.size).toBeLessThan(reverse[0]!.size);
  expect(await link.boundingBox()).toEqual(box);
  await expect(page.locator(".k-hud-link-text, .k-hud-link-rule")).toHaveCount(0);
});

test("多行URL逐行画线、MENU仅标签画线且明暗无溢出", async ({ page }, info) => {
  const mobile = Boolean(info.project.use.isMobile);
  await page.setViewportSize({ width: mobile ? 320 : 1440, height: 900 });
  await ready(page, "sources/");
  const url = page.locator('.k-doc a[href="https://www.baidu.com/duty/copyright.html"]');
  await url.scrollIntoViewIfNeeded();
  await expect.poll(() => url.evaluate(el => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) < 0.999 || style.transform !== "none") return false;
    }
    return true;
  })).toBe(true);
  const fragments = await url.evaluate(el => ({ count: el.getClientRects().length, clone: getComputedStyle(el).getPropertyValue("box-decoration-break") || getComputedStyle(el).getPropertyValue("-webkit-box-decoration-break") }));
  expect(fragments.clone).toBe("clone");
  if (mobile) expect(fragments.count).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Shift");
  await url.focus();
  expect((await line(url)).size).toBe(100);
  mkdirSync("audit", { recursive: true });
  await page.screenshot({ path: `audit/links-${info.project.name}-multiline.png` });
  await page.locator("[data-kmenu-open]").click();
  await expect(page.locator("[data-kmenu]")).toHaveAttribute("data-menu-state", "open");
  const menu = page.locator(".k-mi").first();
  await page.keyboard.press("Tab");
  const focused = menu;
  await focused.focus();
  await expect(focused).toBeFocused();
  expect((await line(focused)).size).toBe(100);
  const bounds = await focused.evaluate(el => {
    const label = el.querySelector(".lb")!;
    return { width: el.getBoundingClientRect().width, label: label.getBoundingClientRect().width,
      outer: getComputedStyle(el).backgroundImage, number: getComputedStyle(el.querySelector(".no")!).backgroundImage,
      outline: getComputedStyle(el).outlineStyle };
  });
  expect(bounds.label).toBeLessThan(bounds.width);
  expect(bounds.outer).toBe("none");
  expect(bounds.number).toBe("none");
  expect(bounds.outline).not.toBe("none");
  mkdirSync("audit", { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `audit/links-${info.project.name}-${theme}.png` });
  }
});

for (const javaScriptEnabled of [false, true]) {
  test.describe(javaScriptEnabled ? "缺库与减弱动态" : "无JS原生链接", () => {
    test.use({ javaScriptEnabled, reducedMotion: "reduce", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
    test("键盘焦点即时画线与Enter导航", async ({ page }) => {
      if (javaScriptEnabled) await page.route("**/vendor/*.js", route => route.abort());
      await page.goto(`${BASE}about/`);
      // WebKit 默认的完整键盘访问设置会跳过链接；显式聚焦仍验证键盘模态的真实focus-visible与Enter。
      await page.keyboard.press("Tab");
      const brand = page.locator(".k-brand");
      await brand.focus();
      await expect(brand).toBeFocused();
      const focused = await line(brand);
      expect(focused.size).toBe(100);
      expect(focused.duration).toBe("0s");
      expect(await brand.evaluate(el => getComputedStyle(el).outlineWidth)).toBe("2px");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${BASE}$`));
      await page.waitForLoadState("load");
      expect(await page.evaluate(() => Boolean(document.querySelector("[data-kinetic].k-cursor-on")))).toBe(false);
      if (javaScriptEnabled) {
        const target = page.locator(".k-brand");
        await page.keyboard.press("Tab");
        await target.evaluate(el => (el as HTMLElement).blur());
        await target.hover({ position: { x: 5, y: 5 }, timeout: 5000 });
        expect((await line(target)).size).toBe(100);
        expect((await line(target)).duration).toBe("0s");
      }

    });
  });
}

test("触屏页内导航不留下hover下划线", async ({ page }, info) => {
  test.skip(!info.project.use.isMobile, "触屏配置");
  await ready(page);
  const link = page.locator("[data-toc] a").first();
  await link.tap();
  await expect(page).toHaveURL(/#what$/);
  expect((await line(link)).size).toBe(0);
  expect(await page.evaluate(() => Boolean(document.querySelector("[data-kinetic].k-cursor-on")))).toBe(false);
});
