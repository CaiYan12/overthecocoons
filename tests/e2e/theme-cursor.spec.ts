import { expect, test } from "@playwright/test";
import { parseHexColor } from "./helpers.ts";

// 光标形变的两条路径分别验收（二者互不替代）：
//  1) 正常路径：vt.ready 在看门狗（motion.ts 的 250ms）内 resolve，动画完整播放——断言真实形变与渲染；
//  2) 超时路径：主动把 ready 拖过看门狗，断言设计内的降级成立（无形变、无残影、后续可用）。
// 重负载下 ready 晚于 250ms 时形变被看门狗主动跳过，属设计行为而非缺陷；因此不得放宽阈值、
// 加 retry 或排除用例来掩盖——必须明确报告本次走的是哪条路径。
const WATCHDOG_MS = 250;

/** 形变峰值理论上限：shape 带 12° 旋转，getBoundingClientRect 取旋转后外接盒，
 * scaleX/scaleY = 1.14/0.86 的外接盒宽高比为 1.2000（不是裸的 1.14/0.86 = 1.3256）。 */
const DOM_RATIO_CEILING = 1.2;

test("显示切换光标压扁旋转再回弹，绘制帧不偏离跟随中心（正常路径）", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "自定义光标仅用于 fine pointer");
  await page.goto("/overthecocoons/about/");
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.locator("[data-mode]").hover();
  await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
  await page.evaluate((watchdogMs) => {
    const native = document.startViewTransition.bind(document);
    const samples: Array<{ ratio: number; offset: number; frame: boolean; sx: number; sy: number; rot: number }> = [];
    (window as unknown as { morphFrames: typeof samples }).morphFrames = samples;
    const gsapGet = (el: Element, prop: string) =>
      Number((window as unknown as { gsap?: { getProperty(e: Element, p: string): string } }).gsap?.getProperty(el, prop) ?? "1");
    document.startViewTransition = cb => {
      const started = performance.now();
      const vt = native(cb);
      vt.ready.then(() => {
        // 记录 ready 延迟：超过看门狗时动画会被 motion.ts 主动跳过，本用例必须显式报出该原因，
        // 而不是让断言以「ratio 不足」这种误导性消息失败。
        (document.documentElement as HTMLElement).dataset.morphReadyMs = String(Math.round(performance.now() - started));
        const start = performance.now();
        const endAt = start + 800;
        const shapeEl = document.querySelector<HTMLElement>("[data-kcursor-shape]");
        const sample = () => {
          const ring = document.querySelector("[data-kcursor-ring]")!.getBoundingClientRect();
          const shape = document.querySelector("[data-kcursor-shape]")?.getBoundingClientRect() ?? ring;
          samples.push({
            ratio: shape.width / shape.height,
            offset: Math.hypot(shape.x + shape.width / 2 - ring.x - ring.width / 2, shape.y + shape.height / 2 - ring.y - ring.height / 2),
            frame: document.documentElement.style.getPropertyValue("--vt-cursor-frame").includes("%20matrix("),
            // GSAP 侧真实姿态：补间结束后 inline transform 会被 clearProps 回收，只能在采样窗口内取。
            sx: shapeEl ? gsapGet(shapeEl, "scaleX") : 1,
            sy: shapeEl ? gsapGet(shapeEl, "scaleY") : 1,
            rot: shapeEl ? gsapGet(shapeEl, "rotation") : 0,
          });
          if (performance.now() < endAt) requestAnimationFrame(sample);
          else document.documentElement.dataset.morphSample = "done";
        };
        requestAnimationFrame(sample);
      });
      return vt;
    };
  }, WATCHDOG_MS);
  await page.locator("[data-mode]").click();
  await page.waitForSelector('html[data-morph-sample="done"]');
  const frames = await page.evaluate(() => (window as unknown as { morphFrames: Array<{ ratio: number; offset: number; frame: boolean; sx: number; sy: number; rot: number }> }).morphFrames);

  // 前置判定：本次是否真的走了正常路径。超出看门狗即形变被跳过，直接以可读原因失败。
  const readyMs = Number(await page.evaluate(() => document.documentElement.dataset.morphReadyMs));
  expect(readyMs, `vt.ready 延迟 ${readyMs}ms 超过看门狗 ${WATCHDOG_MS}ms，形变被 motion.ts 主动跳过；本用例要求正常路径（重负载机器请用超时降级用例验收降级行为）`).toBeLessThan(WATCHDOG_MS);

  // 动画逻辑：GSAP 侧真实极值（目标 scaleX 1.14 / scaleY 0.86 / rotation 12°）。
  // 这些值证明「补间确实按设计播放」，与下面的 DOM 外接盒断言互补：属性对但渲染错会被后面抓到。
  const maxSx = Math.max(...frames.map(f => f.sx));
  const minSy = Math.min(...frames.map(f => f.sy));
  const maxRot = Math.max(...frames.map(f => Math.abs(f.rot)));
  expect(maxSx, "压扁峰值 scaleX 应达到设计值 1.14").toBeGreaterThanOrEqual(1.13);
  expect(minSy, "压扁峰值 scaleY 应达到设计值 0.86").toBeLessThanOrEqual(0.87);
  expect(maxRot, "应带 12° 旋转（暗色 -12°）").toBeGreaterThanOrEqual(11);

  // 实际渲染：外接盒峰值比值（理论上限 1.2，实测 1.1999）。
  const maxRatio = Math.max(...frames.map(f => f.ratio));
  expect(maxRatio, `压扁产生可见椭圆（理论上限 ${DOM_RATIO_CEILING}，因 12° 旋转取外接盒）`).toBeGreaterThan(1.19);
  expect(maxRatio, `不应超过旋转外接盒的数学上限`).toBeLessThanOrEqual(DOM_RATIO_CEILING + 0.005);
  expect(Math.min(...frames.map(f => f.ratio)), "恢复时有轻微反向回弹").toBeLessThan(0.995);
  expect(Math.max(...frames.map(f => f.offset)), "形变围绕自身中心，不缩放鼠标坐标").toBeLessThan(0.5);
  expect(frames.some(f => f.frame), "VT独立绘制帧承接相同形变").toBe(true);
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
});

test("显示切换光标形变在 ready 超时后按看门狗降级：无形变、无残影、后续可用（超时路径）", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "自定义光标仅用于 fine pointer");
  await page.goto("/overthecocoons/about/");
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.mouse.move(200, 200);
  await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== "function"), "无 View Transition API");

  // 主动制造超时：让 ready 在 600ms 后才 resolve，必然越过 250ms 看门狗。
  await page.evaluate(() => {
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = cb => {
      const vt = native(cb);
      return {
        ready: new Promise<void>(resolve => setTimeout(() => vt.ready.then(resolve, resolve), 600)),
        finished: vt.finished,
        skipTransition: () => vt.skipTransition(),
        updateCallbackDone: vt.updateCallbackDone,
        types: vt.types,
      } as unknown as ViewTransition;
    };
  });

  await page.locator("[data-mode]").click();
  // 看门狗应已跳过过渡并回收（data-vt 移除）。
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"), null, { timeout: 5_000 });

  // 降级断言：未施加形变、无残留 style、过渡帧已清空、主题已实际切换。
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--vt-cursor-frame")), "过渡绘制帧应已清空").toBe("");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");

  // 无残影 + 后续交互可用：光标仍跟随真实鼠标，再次切换主题仍生效。
  await page.mouse.move(360, 240);
  await expect.poll(() => page.evaluate(() => {
    const ring = document.querySelector("[data-kcursor-ring]")!.getBoundingClientRect();
    return Math.hypot(ring.x + ring.width / 2 - 360, ring.y + ring.height / 2 - 240);
  }), "降级后光标仍跟随真实鼠标").toBeLessThan(6);

  // 移除延迟后恢复默认，验证后续切换正常。
  await page.evaluate(() => { (document as unknown as { __delayed?: boolean }).__delayed = false; });
  await page.reload();
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.mouse.move(200, 200);
  await page.locator("[data-mode]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"));
  await expect(page.locator("[data-kcursor-shape]")).toHaveCSS("transform", "none");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--vt-cursor-frame"))).toBe("");
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
