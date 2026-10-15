import { expect, test } from "@playwright/test";

test("回顶按钮使用独立线性SVG和轻阴影，隐藏时不进入焦点序", async ({ page }) => {
  await page.goto("/overthecocoons/");
  await page.waitForSelector('html[data-oct-client="ready"]');
  const button = page.locator("[data-ktop]");
  await expect(button).toHaveAttribute("tabindex", "-1");
  await expect(button).toBeHidden();
  await expect(button.locator("svg.k-top-icon path")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo({ top: 399, behavior: "instant" }));
  await expect(button).not.toHaveClass(/show/);
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await expect(button).toHaveClass(/show/);
  await expect(button).toHaveAttribute("tabindex", "0");
  await expect(button).toBeVisible();
  await expect.poll(() => button.locator(".k-top-face").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(1);
  const style = await button.locator(".k-top-face").evaluate(el => {
    const icon = el.querySelector(".k-top-icon")!;
    return {
      shadow: getComputedStyle(el).boxShadow,
      iconWidth: icon.getBoundingClientRect().width,
      iconTransform: getComputedStyle(icon).transform,
    };
  });
  expect(style.shadow).not.toBe("none");
  expect(style.shadow).toContain("2px 5px");
  expect(style.iconWidth).toBeCloseTo(20, 0);
  expect(style.iconTransform).toBe("none");
});

test("滚动显隐有真实轻抬和一次微回弹，快速反向从当前帧接续", async ({ page }) => {
  await page.goto("/overthecocoons/");
  await page.waitForSelector('html[data-oct-client="ready"]');
  const frames = await page.evaluate(async () => {
    const button = document.querySelector<HTMLElement>("[data-ktop]")!;
    const face = button.querySelector<HTMLElement>(".k-top-face")!;
    const frames: Array<{ y: number; scale: number; opacity: number }> = [];
    window.scrollTo({ top: 600, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
    const start = performance.now();
    await new Promise<void>(resolve => {
      const sample = () => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(face).transform);
        frames.push({ y: matrix.m42, scale: matrix.a, opacity: Number(getComputedStyle(button).opacity) });
        if (performance.now() - start < 550) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  expect(frames.some(f => f.y > 0.5 && f.y < 9.9 && f.opacity > 0 && f.opacity < 1)).toBe(true);
  expect(Math.min(...frames.map(f => f.y))).toBeLessThan(-0.01);
  expect(Math.min(...frames.map(f => f.y))).toBeGreaterThan(-1);
  expect(Math.max(...frames.map(f => f.scale))).toBeLessThan(1.015);
  const reversals = await page.evaluate(async () => {
    const face = document.querySelector<HTMLElement>(".k-top-face")!;
    const jumps: number[] = [];
    for (const top of [250, 700, 200, 800]) {
      await new Promise(resolve => setTimeout(resolve, 55));
      const before = new DOMMatrixReadOnly(getComputedStyle(face).transform).m42;
      window.scrollTo({ top, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
      jumps.push(Math.abs(new DOMMatrixReadOnly(getComputedStyle(face).transform).m42 - before));
    }
    return jumps;
  });
  expect(Math.max(...reversals), "反向时不先重置到隐藏或终态").toBeLessThan(0.2);
  await expect.poll(() => page.locator(".k-top-face").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(0);
  await expect(page.locator("[data-ktop]")).toHaveCSS("opacity", "1");
});

test("显隐不争用磁吸坐标，离开后按钮回正", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "磁吸仅用于fine pointer");
  await page.goto("/overthecocoons/");
  await page.waitForSelector('html[data-oct-client="ready"]');
  await page.evaluate(() => window.scrollTo({ top: 800, behavior: "instant" }));
  const button = page.locator("[data-ktop]");
  await button.hover({ position: { x: 48, y: 16 } });
  await expect.poll(() => button.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBeGreaterThan(1);
  const offset = await button.evaluate(el => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.max(Math.abs(matrix.m41), Math.abs(matrix.m42));
  });
  expect(offset).toBeLessThanOrEqual(8);
  await page.evaluate(() => {
    window.scrollTo({ top: 200, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
    window.scrollTo({ top: 800, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
  });
  await page.mouse.move(100, 100);
  await expect.poll(() => button.evaluate(el => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.max(Math.abs(matrix.m41), Math.abs(matrix.m42));
  })).toBeLessThan(0.05);
  await expect.poll(() => button.locator(".k-top-face").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(0);
});

test("减少动态效果时无空间动画，键盘回顶与明暗阴影保持可用", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/overthecocoons/");
  await page.waitForSelector('html[data-oct-client="ready"]');
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  const button = page.locator("[data-ktop]");
  await expect(button).toBeVisible();
  await expect(button.locator(".k-top-face")).toHaveCSS("transform", "none");
  await expect(button.locator(".k-top-face")).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.22) 0px 2px 5px 0px");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(button.locator(".k-top-face")).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.08) 0px 2px 5px 0px");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(button).toHaveAttribute("tabindex", "-1");
  await expect(button).toBeHidden();
  await expect(button).not.toBeFocused();
});

test("缺动效库时仍能回顶，无JS时按钮不可聚焦", async ({ browser }) => {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    if (javaScriptEnabled) await page.route("**/vendor/gsap.min.js", route => route.abort());
    await page.goto("/overthecocoons/");
    const button = page.locator("[data-ktop]");
    if (javaScriptEnabled) {
      await page.waitForSelector('html[data-oct-client="ready"]');
      await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
      await expect(button).toBeVisible();
      await button.click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    }
    await expect(button).toHaveAttribute("tabindex", "-1");
    await expect(button).toBeHidden();
    await context.close();
  }
});

test("暂停GSAP时钟后显隐仍能收尾，恢复后不复活旧补间", async ({ page }) => {
  await page.goto("/overthecocoons/");
  await page.waitForSelector('html[data-oct-client="ready"]');
  await page.evaluate(() => {
    const g = (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap;
    g.globalTimeline.pause();
    window.scrollTo({ top: 600, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
  });
  const face = page.locator(".k-top-face");
  await expect.poll(() => face.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(0);
  await expect(face).not.toHaveAttribute("style", /will-change/);
  await page.evaluate(() => {
    (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume();
  });
  await expect.poll(() => face.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(0);
});
