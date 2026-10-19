import { expect, test } from "@playwright/test";

const BASE = "/overthecocoons/";

for (const layout of ["layout-a", "layout-b"]) {
  test(`${layout} 入场同步投影，提前悬停不争抢缩放且完成后接管`, async ({ page, isMobile }) => {
    test.skip(isMobile, "精细指针悬停专项");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForSelector('html[data-oct-client="ready"]');
    const targetId = await page.evaluate(layout => {
      const media = [...document.querySelectorAll<HTMLElement>(`.k-entry.${layout} .k-media`)]
        .find(el => el.getBoundingClientRect().top > innerHeight);
      if (!media) throw new Error("未找到尚未入场的图片");
      const id = media.closest(".k-entry")!.querySelector(".k-headline a")!.getAttribute("href")!;
      const g = (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap;
      g.globalTimeline.pause();
      return id;
    }, layout);
    const entry = page.locator(".k-entry").filter({ has: page.locator(`.k-headline a[href="${targetId}"]`) });
    const media = entry.locator(".k-media");
    await media.scrollIntoViewIfNeeded();
    const state = await media.evaluate(el => {
      type Tween = { vars: Record<string, unknown>; parent: { pause(): void; time(value: number): void } };
      const g = (window as unknown as { gsap: { getTweensOf(el: Element): Tween[] } }).gsap;
      const reveal = g.getTweensOf(el).find(t => t.vars.clipPath);
      if (!reveal) throw new Error("未找到图片入场补间");
      reveal.parent.pause();
      reveal.parent.time(0.3);
      return { opacity: Number(getComputedStyle(el).opacity), clip: getComputedStyle(el).clipPath };
    });
    expect(state.opacity, "投影与图片一起逐渐进入，不在末帧突然出现").toBeGreaterThan(0);
    expect(state.opacity).toBeLessThan(1);
    expect(state.clip, "入场期留出外侧投影空间").toMatch(/-/);
    // 左入布局的左缘、右入布局的右缘，此时均处于已揭开的区域。
    const box = await media.boundingBox();
    await media.hover({ position: { x: layout === "layout-a" ? 12 : box!.width - 12, y: box!.height / 2 } });
    expect(await media.locator(".k-media-glow").evaluate(el => getComputedStyle(el).opacity)).toBe("0");
    const hoverScaleTweens = await media.locator(".k-media-art").evaluate(el => {
      const g = (window as unknown as { gsap: { getTweensOf(el: Element): Array<{vars: Record<string, unknown>}> } }).gsap;
      return g.getTweensOf(el).filter(t => t.vars.scale === 1.05).length;
    });
    expect(hoverScaleTweens, "入场尚未完成时不启动 hover 缩放").toBe(0);
    await media.evaluate(el => {
      const g = (window as unknown as { gsap: {
        getTweensOf(el: Element): Array<{vars: Record<string, unknown>; parent: {time(value: number): void}}>;
        globalTimeline: { resume(): void };
      } }).gsap;
      g.getTweensOf(el).find(t => t.vars.clipPath)!.parent.time(1.01);
      g.globalTimeline.resume();
    });
    // 鼠标保持不动，入场完成后自动接管，不能要求用户重新移入。
    await expect.poll(() => media.locator(".k-media-glow").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    await expect.poll(() => media.locator(".k-media-art").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBeGreaterThan(1.04);
    expect(await media.evaluate(el => getComputedStyle(el).clipPath)).toBe("none");
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`详情图片高光与投影生效，保留21:9与原尺寸（${theme}）`, async ({ page, isMobile }) => {
    test.skip(isMobile, "精细指针悬停专项");
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    const detailPath = await page.locator(".k-entry .k-headline a").first().getAttribute("href");
    expect(detailPath).toMatch(/\/items\/[a-f0-9]{64}\//);
    await page.goto(detailPath!);
    await page.waitForSelector('html[data-oct-client="ready"]');
    const media = page.locator(".k-detail .k-media");
    await media.scrollIntoViewIfNeeded();
    const before = await media.boundingBox();
    expect(await media.evaluate(el => getComputedStyle(el).aspectRatio)).toBe("21 / 9");
    expect(await media.locator(".k-media-art").evaluate(el => getComputedStyle(el).boxShadow)).not.toBe("none");
    const glow = media.locator(".k-media-glow");
    await expect(glow).toHaveCount(1);
    await media.hover({ position: { x: 60, y: 60 } });
    await expect.poll(() => glow.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    const first = await glow.evaluate(el => el.getAttribute("style"));
    await media.hover({ position: { x: before!.width - 60, y: before!.height - 60 } });
    await expect.poll(() => glow.evaluate(el => el.getAttribute("style"))).not.toBe(first);
    await expect.poll(() => media.locator(".k-media-tilt").evaluate(el => el.getAttribute("style"))).toMatch(/rotate[XY]/);
    const after = await media.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 2);
    expect(after!.height).toBeCloseTo(before!.height, 2);
    await page.mouse.move(5, 200);
    await expect.poll(() => glow.evaluate(el => getComputedStyle(el).opacity)).toBe("0");
  });

  test(`图片局部高光跟随、淡出与纸面投影，保留尺寸（${theme}）`, async ({ page, isMobile }) => {
    test.skip(isMobile, "精细指针悬停专项");
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForSelector('html[data-oct-client="ready"]');
    const media = page.locator(".k-entry .k-media").first();
    await media.scrollIntoViewIfNeeded();
    await expect.poll(() => media.evaluate(el => getComputedStyle(el).clipPath)).toBe("none");
    const before = await media.boundingBox();
    const glow = media.locator(".k-media-glow");
    await expect(glow).toHaveCount(1);
    const shadow = await media.locator(".k-media-art").evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
    await media.hover({ position: { x: 35, y: 35 } });
    await expect.poll(() => glow.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    const first = await glow.evaluate(el => getComputedStyle(el).transform);
    await media.hover({ position: { x: before!.width - 35, y: before!.height - 35 } });
    await expect.poll(() => glow.evaluate(el => getComputedStyle(el).transform)).not.toBe(first);
    await expect.poll(() => media.locator(".k-media-tilt").evaluate(el => el.getAttribute("style"))).toMatch(/rotate[XY]/);
    const after = await media.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 2);
    expect(after!.height).toBeCloseTo(before!.height, 2);
    await page.mouse.move(5, 200);
    await expect.poll(() => glow.evaluate(el => getComputedStyle(el).opacity)).toBe("0");
    await expect(media).not.toHaveClass(/is-media-hover/);
  });
}

test("详情图减弱动态及窄屏保持尺寸与静态投影", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE);
  const detailPath = await page.locator(".k-entry .k-headline a").first().getAttribute("href");
  await page.goto(detailPath!);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const media = page.locator(".k-detail .k-media");
  await media.scrollIntoViewIfNeeded();
  await expect(media.locator(".k-media-glow")).toHaveCount(0);
  expect(await media.locator(".k-media-art").evaluate(el => getComputedStyle(el).boxShadow)).not.toBe("none");
  const before = await media.boundingBox();
  if (isMobile) await media.tap();
  else await media.hover();
  await expect(media).not.toHaveClass(/is-media-hover/);
  const after = await media.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width, 2);
  expect(after!.height).toBeCloseTo(before!.height, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("筛选及分页重建后高光和原 tilt 继续工作且无重复层", async ({ page, isMobile }) => {
  test.skip(isMobile, "精细指针悬停专项");
  await page.goto(BASE);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await page.locator('[data-ktabs] [data-topic="新闻"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-oct-topic-anim");
  await page.getByRole("navigation", { name: "分页", exact: true }).getByRole("link", { name: "第 2 页", exact: true }).click();
  // 客户端分页保留当前文档 URL；以分页当前项验证实际视图状态。
  await expect(page.getByRole("navigation", { name: "分页", exact: true }).getByRole("link", { name: "第 2 页", exact: true })).toHaveAttribute("aria-current", "page");
  const media = page.locator(".k-entry .k-media").first();
  await media.scrollIntoViewIfNeeded();
  await expect.poll(() => media.evaluate(el => getComputedStyle(el).clipPath)).toBe("none");
  await media.hover({ position: { x: 25, y: 25 } });
  await expect(media.locator(".k-media-glow")).toHaveCount(1);
  await expect.poll(() => media.locator(".k-media-glow").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await expect.poll(() => media.locator(".k-media-tilt").evaluate(el => el.getAttribute("style"))).toMatch(/rotate[XY]/);
});

test("减弱动态与触屏保留静态投影，无追踪光斑", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const media = page.locator(".k-entry .k-media").first();
  await media.scrollIntoViewIfNeeded();
  await expect(media.locator(".k-media-glow")).toHaveCount(0);
  expect(await media.locator(".k-media-art").evaluate(el => getComputedStyle(el).boxShadow)).not.toBe("none");
  if (isMobile) await media.tap();
  else await media.hover();
  await expect(media).not.toHaveClass(/is-media-hover/);
});

test("触屏普通动态模式不生成鼠标光斑", async ({ page, isMobile }) => {
  test.skip(!isMobile, "触屏专项");
  await page.goto(BASE);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const media = page.locator(".k-entry .k-media").first();
  await media.scrollIntoViewIfNeeded();
  await expect(media.locator(".k-media-glow")).toHaveCount(0);
  await media.tap();
  await expect(media).not.toHaveClass(/is-media-hover/);
});

test("悬停途中切换减弱动态，光斑立即隐藏", async ({ page, isMobile }) => {
  test.skip(isMobile, "精细指针悬停专项");
  await page.goto(BASE);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const media = page.locator(".k-entry .k-media").first();
  await media.scrollIntoViewIfNeeded();
  await expect.poll(() => media.evaluate(el => getComputedStyle(el).clipPath)).toBe("none");
  await media.hover();
  await expect(media).toHaveClass(/is-media-hover/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(media.locator(".k-media-glow")).toBeHidden();
  await expect(media).not.toHaveClass(/is-media-hover/);
});
