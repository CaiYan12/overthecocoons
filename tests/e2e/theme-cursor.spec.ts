import { expect, test } from "@playwright/test";
import { parseHexColor } from "./helpers.ts";

test("显示切换光标压扁旋转再回弹，绘制帧不偏离跟随中心", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "自定义光标仅用于 fine pointer");
  await page.goto("/overthecocoons/about/");
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.locator("[data-mode]").hover();
  await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
  await page.evaluate(() => {
    const native = document.startViewTransition.bind(document);
    const samples: Array<{ ratio: number; offset: number; frame: boolean }> = [];
    (window as unknown as { morphFrames: typeof samples }).morphFrames = samples;
    document.startViewTransition = cb => {
      const vt = native(cb);
      vt.ready.then(() => {
        const start = performance.now();
        const sample = () => {
          const ring = document.querySelector("[data-kcursor-ring]")!.getBoundingClientRect();
          const shape = document.querySelector("[data-kcursor-shape]")?.getBoundingClientRect() ?? ring;
          samples.push({ ratio: shape.width / shape.height, offset: Math.hypot(shape.x + shape.width / 2 - ring.x - ring.width / 2, shape.y + shape.height / 2 - ring.y - ring.height / 2), frame: document.documentElement.style.getPropertyValue("--vt-cursor-frame").includes("%20matrix(") });
          if (performance.now() - start < 800) requestAnimationFrame(sample);
          else document.documentElement.dataset.morphSample = "done";
        };
        requestAnimationFrame(sample);
      });
      return vt;
    };
  });
  await page.locator("[data-mode]").click();
  await page.waitForSelector('html[data-morph-sample="done"]');
  const frames = await page.evaluate(() => (window as unknown as { morphFrames: Array<{ ratio: number; offset: number; frame: boolean }> }).morphFrames);
  expect(Math.max(...frames.map(f => f.ratio)), "压扁产生可见椭圆").toBeGreaterThan(1.15);
  expect(Math.min(...frames.map(f => f.ratio)), "恢复时有轻微反向回弹").toBeLessThan(0.995);
  expect(Math.max(...frames.map(f => f.offset)), "形变围绕自身中心，不缩放鼠标坐标").toBeLessThan(0.5);
  expect(frames.some(f => f.frame), "VT独立绘制帧承接相同形变").toBe(true);
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
});

test("光标形变连续切换从当前姿态接管，暂停时钟后仍能回收", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "自定义光标仅用于 fine pointer");
  await page.goto("/overthecocoons/about/");
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.mouse.move(800, 34);
  await page.evaluate(() => { (document as unknown as { startViewTransition?: unknown }).startViewTransition = undefined; });
  await page.locator("[data-mode]").click();
  await expect.poll(() => page.locator("[data-kcursor-shape]").evaluate(el => getComputedStyle(el).transform)).not.toBe("none");
  const continuity = await page.evaluate(() => {
    const shape = document.querySelector<HTMLElement>("[data-kcursor-shape]")!;
    const before = shape.style.transform;
    (document.querySelector("[data-mode]") as HTMLButtonElement).click();
    return { before, after: shape.style.transform };
  });
  expect(continuity.after, "不先归零再重播").toBe(continuity.before);
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
  await page.locator("[data-mode]").click();
  await expect.poll(() => page.locator("[data-kcursor-shape]").evaluate(el => getComputedStyle(el).transform)).not.toBe("none");
  await page.evaluate(() => {
    const g = (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap;
    g.globalTimeline.pause();
    window.dispatchEvent(new Event("pagehide"));
  });
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
  await page.evaluate(() => { (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume(); });
  await page.waitForTimeout(350);
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
});

test("显示切换期间光标在 nav 上方持续可见并跟随真实鼠标，双向切换无残影", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "自定义光标仅用于 fine pointer");
  await page.goto("/overthecocoons/about/");
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.mouse.move(200, 200);
  await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== "function"), "无 View Transition API");
  await page.evaluate(() => {
    const target = document.createElement("div");
    target.dataset.cursor = "VIEW";
    target.style.cssText = "position:fixed;left:400px;top:200px;width:240px;height:160px;z-index:100;background:var(--surface)";
    target.setAttribute("aria-hidden", "true");
    document.querySelector("[data-kinetic]")!.append(target);
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (callback) => {
      const vt = original(callback);
      vt.ready.then(() => {
        // 慢放浏览器快照动画，保留 GSAP 光标运动，实测中途的绘制层级。
        for (const animation of document.getAnimations()) {
          animation.playbackRate = 0.02;
          animation.currentTime = 150;
        }
        document.documentElement.dataset.cursorProbe = "ready";
      });
      return vt;
    };
  });
  for (const theme of ["dark", "light"]) {
    await page.locator("[data-mode]").click();
    await page.waitForSelector('html[data-cursor-probe="ready"]');
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const expectedInk = parseHexColor(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()));
    for (const y of [34, 300, 34]) {
      await page.mouse.move(14, y);
      await expect.poll(() => page.evaluate((y) => {
        const rect = document.querySelector("[data-kcursor-dot]")!.getBoundingClientRect();
        return Math.hypot(rect.x + rect.width / 2 - 14, rect.y + rect.height / 2 - y);
      }, y)).toBeLessThan(1);
      const image = await page.screenshot({ clip: { x: 0, y: y - 12, width: 40, height: 24 }, animations: "allow" });
      const pixels = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
        const scale = img.width / 40;
        return [[14, 12]].map(([x, y]) => Array.from(ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data).slice(0, 3));
      }, image.toString("base64"));
      const renderState = await page.evaluate(() => ({ opacity: getComputedStyle(document.querySelector("[data-kcursor]")!).opacity, svg: decodeURIComponent(document.documentElement.style.getPropertyValue("--vt-cursor-frame")) }));
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(pixels[0][channel] - expectedInk[channel]), `光标在 y=${y} 实绘为切换后的主题墨色 ${JSON.stringify({ pixels, expectedInk, renderState })}`).toBeLessThanOrEqual(2);
      }
      const frame = await page.evaluate(() => decodeURIComponent(document.documentElement.style.getPropertyValue("--vt-cursor-frame")));
      expect(frame).not.toContain('stroke-width="1"');
    }
    await page.mouse.move(480, 280);
    await page.evaluate(() => {
      delete document.documentElement.dataset.cursorProbe;
      document.getAnimations().forEach((animation) => { animation.playbackRate = 1; });
    });
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"));
    // 静止指针在快照回收后也按真实命中恢复档位，无需再移动一下。
    await expect(page.locator("[data-kcursor-label]")).toHaveCSS("opacity", "1");
    const labelImage = await page.screenshot({ clip: { x: 430, y: 250, width: 100, height: 60 }, animations: "allow" });
    const redPixels = await page.evaluate(async b64 => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > data[i + 1] + 20 && data[i] > data[i + 2] + 20) count++;
      return count;
    }, labelImage.toString("base64"));
    expect(redPixels, "切换后静止指针恢复VIEW标签，并以accent原色实绘").toBeGreaterThan(5);
    await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--vt-cursor-frame"))).toBe("");
  }
});

test("连续显示切换最后目标生效，异常及 pagehide 回收过渡光标", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "自定义光标仅用于 fine pointer");
  await page.goto("/overthecocoons/about/");
  await page.waitForSelector('html[data-oct-motion="on"]');
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== "function"), "无 View Transition API");
  await page.mouse.move(200, 200);
  const button = page.locator("[data-mode]");
  await button.click();
  await button.click();
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"));
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--vt-cursor-frame"))).toBe("");
  for (const failure of ["throw", "timeout", "pagehide"]) {
    await page.evaluate((failure) => {
      const native = document.startViewTransition.bind(document);
      document.startViewTransition = callback => {
        if (failure === "throw") throw new Error("测试启动失败");
        if (failure === "pagehide") return native(callback);
        (callback as () => void)();
        return { ready: new Promise(() => {}), finished: new Promise(() => {}), skipTransition() {} } as unknown as ViewTransition;
      };
    }, failure);
    await button.click();
    if (failure === "pagehide") await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"));
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--vt-cursor-frame"))).toBe("");
    await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
    await page.reload();
    await page.waitForSelector('html[data-oct-motion="on"]');
    await page.mouse.move(200, 200);
  }
});
