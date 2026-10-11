import { expect, test, type Page } from "@playwright/test";

const BASE = "/overthecocoons/";

test("连续单击当前全站标签不重新请求页面或重播目录", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  let documents = 0;
  page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  for (let i = 0; i < 3; i++) await page.locator("[data-knav] [aria-current=page]").click();
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  expect(documents, "重复标签选择不能触发整页导航").toBe(0);
});

test("切换页后静止指针可见，首次移动自定义指针在原位接管", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  test.skip(!(await page.evaluate(() => matchMedia("(pointer:fine)").matches)), "触摸配置不启用自定义指针");
  const target = page.locator('[data-knav] a[href="/overthecocoons/principles/"]');
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect(page).toHaveURL(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const available = await page.locator('[data-knav] [aria-current=page]').evaluate((el) => {
    const custom = Number(getComputedStyle(document.querySelector("[data-kcursor]")!).opacity);
    return getComputedStyle(el).cursor !== "none" || custom > 0;
  });
  expect(available, "静止时必须有系统或自定义指针").toBe(true);
  await page.mouse.move(point.x + 1, point.y);
  await expect(page.locator("[data-kcursor]")).toHaveCSS("opacity", "1");
  const dot = (await page.locator("[data-kcursor-dot]").boundingBox())!;
  expect(Math.abs(dot.x + dot.width / 2 - point.x - 1)).toBeLessThan(1);
  expect(Math.abs(dot.y + dot.height / 2 - point.y)).toBeLessThan(1);
});

test("退场中改选回当前页从当前帧恢复，不瞬间闪回", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  // 在旧页的同一帧里采样并取消，不能把目标页入场也误认作“旧页正在退场”。
  const state = await page.evaluate(() => new Promise<{ before: number; after: number }>((resolve, reject) => {
    // 放慢测试时钟以采样高DPR引擎的退场；产品240ms参数保持不变。
    (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0.5);
    const panel = document.querySelector(".k-toccol")!;
    const sample = () => {
      if (!location.pathname.endsWith("/privacy/")) { reject(new Error("取消前已离开旧页")); return; }
      const before = Number(getComputedStyle(panel).opacity);
      if (before > 0 && before < 0.9) {
        document.querySelector<HTMLAnchorElement>('[data-knav] [aria-current=page]')!.click();
        resolve({ before, after: Number(getComputedStyle(panel).opacity) });
      } else requestAnimationFrame(sample);
    };
    document.querySelector<HTMLAnchorElement>('[data-knav] a[href="/overthecocoons/about/"]')!.click();
    requestAnimationFrame(sample);
  }));
  expect(Math.abs(state.after - state.before), "取消退场不能把透明度瞬间设回1").toBeLessThan(0.01);
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await expect(page).toHaveURL(`${BASE}privacy/`);
});

test("新目录首次绘制后不会再闪回隐藏初态", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/vendor/gsap.min.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __tocPaint: number[] };
    w.__tocPaint = [];
    const sample = () => {
      const panel = document.querySelector(".k-toccol");
      if (panel) w.__tocPaint.push(Number(getComputedStyle(panel).opacity));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  const frames = await page.evaluate(() => (window as unknown as { __tocPaint: number[] }).__tocPaint);
  expect(frames.some((value, index) => index > 0 && value + 0.01 < frames[index - 1]!), "入场透明度只能增长，不能先直显再隐藏").toBe(false);
});

for (const mode of ["reduced", "vendor-failure", "paused-clock"] as const) {
  test(`${mode}：跨页选择仍能完成，不被退场阻塞`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    if (mode === "vendor-failure") await page.route("**/vendor/*.js", (route) => route.abort());
    await page.goto(`${BASE}privacy/`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
    if (mode === "paused-clock") await page.evaluate(() => {
      (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0);
    });
    await page.locator("[data-knav]").getByRole("link", { name: "关于", exact: true }).click();
    await expect(page).toHaveURL(`${BASE}about/`);
    await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  });
}

test("退场期间连续选择以最后目标为准，返回旧页恢复目录", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await page.evaluate(() => {
    (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0.5);
  });
  // 同一事件循环内连续激活，确保第二次选择发生在退场完成之前。
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('[data-knav] a[href="/overthecocoons/about/"]')!.click();
    document.querySelector<HTMLAnchorElement>('[data-knav] a[href="/overthecocoons/principles/"]')!.click();
  });
  await expect(page).toHaveURL(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await page.goBack();
  await expect(page).toHaveURL(`${BASE}privacy/`);
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await expect(page.locator(".k-toccol")).toHaveCSS("transform", "none");
});

test("选当前标签、页内章节与修饰键不启动跨页退场", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await page.locator("[data-knav] [aria-current=page]").click();
  await expect(page).toHaveURL(`${BASE}privacy/`);
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await page.locator('.k-toccol a[href="#third-party"]').click();
  await expect(page).toHaveURL(`${BASE}privacy/#third-party`);
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  // 合成修饰点击只检查是否被拦截，不让测试打开真实新标签页。
  expect(await page.locator('[data-knav] a[href="/overthecocoons/about/"]').evaluate((el) => {
    let prevented = false;
    document.addEventListener("click", (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault(); // 仅由测试取消浏览器新标签页行为。
    }, { once: true });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    el.dispatchEvent(event);
    return prevented;
  })).toBe(false);
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
});

test("切换页面先退场旧目录，再入场新目录；详情页只退场", async ({ page }) => {
  let exitState: { opacity: number; y: number; frames: number[] } | undefined;
  page.on("console", (message) => {
    if (message.text().startsWith("TOC_EXIT ")) exitState = JSON.parse(message.text().slice(9));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect.poll(() => page.locator(".k-toccol").evaluate((el) => el.style.transform)).toBe("");
  await page.evaluate(() => {
    const w = window as unknown as { __tocExit: number[] };
    (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0.5);
    w.__tocExit = [];
    document.addEventListener("click", () => {
      const sample = () => {
        const panel = document.querySelector(".k-toccol");
        if (panel) w.__tocExit.push(Number(getComputedStyle(panel).opacity));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { once: true });
    window.addEventListener("beforeunload", () => {
      const style = getComputedStyle(document.querySelector(".k-toccol")!);
      console.log("TOC_EXIT " + JSON.stringify({ opacity: Number(style.opacity), y: style.transform === "none" ? 0 : new DOMMatrixReadOnly(style.transform).m42, frames: w.__tocExit }));
    });
  });
  await page.locator("[data-knav]").getByRole("link", { name: "关于", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}about/`);
  expect(exitState?.opacity, "导航开始前旧目录已完全退场").toBe(0);
  expect(exitState?.y).toBe(-12);
  expect(exitState?.frames.some((opacity) => opacity > 0 && opacity < 1), "旧目录有实际退场帧").toBe(true);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
  await page.locator("[data-knav]").getByRole("link", { name: "时间线", exact: true }).click();
  await expect(page).toHaveURL(BASE);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator(".k-toccol")).toHaveCount(1);
  const detail = page.locator("[data-detail]").first();
  const href = await detail.getAttribute("href");
  await detail.click();
  await expect(page).toHaveURL(href!);
  await expect(page.locator(".k-toccol")).toHaveCount(0);
});

test("本页目录首次可见时播放入场中间帧，完成后不随滚动重播", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    // 放慢测试时钟，低帧率 WebKit 也能采到多个帧；不修改产品时长或 vendor/SRI。
    document.addEventListener("load", (event) => {
      if (event.target instanceof HTMLScriptElement && event.target.src.endsWith("/vendor/gsap.min.js")) {
        (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0.25);
      }
    }, true);
    const w = window as unknown as { __tocEntrance: Array<{ opacity: number; y: number; overflow: number }> };
    w.__tocEntrance = [];
    const sample = () => {
      const panel = document.querySelector(".k-toccol");
      if (panel) {
        const style = getComputedStyle(panel);
        const sidebar = document.querySelector("[data-docnav]")!;
        w.__tocEntrance.push({ opacity: Number(style.opacity), y: style.transform === "none" ? 0 : new DOMMatrixReadOnly(style.transform).m42,
          overflow: sidebar.scrollHeight - sidebar.clientHeight });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const panel = page.locator(".k-toccol");
  await expect.poll(() => panel.evaluate((el) => el.style.transform)).toBe("");
  const frames = await page.evaluate(() => (window as unknown as { __tocEntrance: Array<{ opacity: number; y: number; overflow: number }> }).__tocEntrance);
  expect(new Set(frames.filter((frame) => frame.opacity > 0 && frame.opacity < 1 && Math.abs(frame.y) > 0).map((frame) => frame.opacity)).size).toBeGreaterThan(1);
  expect(frames.every((frame) => frame.overflow <= 1), "入场不临时撑出整栏滚动条").toBe(true);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(panel).toHaveCSS("opacity", "1");
  await expect(panel).toHaveCSS("transform", "none");
});

test("手机目录入场可被键盘焦点即时结束，窗口变化后不重新隐藏", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // 保持 vendor 内容及 SRI 不变，仅在库加载后放慢测试时钟。
    document.addEventListener("load", (event) => {
      if (event.target instanceof HTMLScriptElement && event.target.src.endsWith("/vendor/gsap.min.js")) {
        (window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } } }).gsap.globalTimeline.timeScale(0.1);
      }
    }, true);
  });
  await page.goto(`${BASE}privacy/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const panel = page.locator(".k-toccol");
  await expect.poll(() => panel.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
  await panel.getByRole("link").first().focus();
  await expect(panel).toHaveCSS("opacity", "1");
  await expect(panel).toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 430 });
  await expect(panel).toHaveCSS("opacity", "1");
  await expect(panel).toHaveCSS("transform", "none");
});

const scale = (page: Page, selector: string, axis: "x" | "y") => page.locator(selector).evaluate((el, axis) => {
  const transform = getComputedStyle(el).transform;
  if (transform === "none") return 1;
  const matrix = new DOMMatrixReadOnly(transform);
  return axis === "x" ? matrix.m11 : matrix.m22;
}, axis);

test("五页目录竖线与上方导航同步推进、到底填满、返回顶部归零", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  for (const slug of ["", "sources/", "about/", "principles/", "privacy/"]) {
    await page.goto(`${BASE}${slug}`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator("[data-toc-progress]")).toHaveCount(1);
    await page.evaluate(() => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * 0.45, behavior: "instant" }));
    await expect.poll(() => scale(page, "[data-toc-progress]", "y")).toBeGreaterThan(0.2);
    await expect.poll(async () => Math.abs(await scale(page, "[data-toc-progress]", "y") - await scale(page, "[data-nav-progress]", "y"))).toBeLessThan(0.002);
    const alignment = await page.locator("[data-toc-progress]").evaluate((el) => {
      const rail = el.getBoundingClientRect();
      // 8px共用绘制框的中央绘制2px轨线，中心位于目录左缘右侧1px。
      return Math.abs(rail.left + rail.width / 2 - el.parentElement!.querySelector("ol")!.getBoundingClientRect().left - 1);
    });
    expect(alignment, "红色进度覆盖目录原有灰色竖线").toBeLessThan(0.5);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect.poll(() => scale(page, "[data-toc-progress]", "y")).toBeGreaterThan(0.999);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => scale(page, "[data-toc-progress]", "y")).toBeLessThan(0.001);
  }
});

test("全站导航标记位于当前页面，而不是固定停在时间线", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}about/`);
  const current = await page.locator(".k-nav [aria-current=page]").boundingBox();
  await expect.poll(async () => {
    const dot = await page.locator("[data-kmarker]").boundingBox();
    // 圆点按视觉裁定比行框中心下移1px。
    return Math.abs(dot!.y + dot!.height / 2 - current!.y - current!.height / 2 - 1);
  }).toBeLessThan(1);
});

test("阅读轨与章节进度实际播放中间帧，滚回顶部回退", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await page.evaluate(() => {
    const w = window as unknown as { gsap: { globalTimeline: { timeScale(n: number): void } }; __navFrames: number[]; __tocRailFrames: number[]; __navSampling: boolean };
    // 仅采样测试放慢时钟，保证移动 WebKit 也能观察短补间；产品时长保持原值。
    w.gsap.globalTimeline.timeScale(0.25);
    const rail = document.querySelector("[data-nav-progress]")!;
    const tocRail = document.querySelector("[data-toc-progress]")!;
    w.__navFrames = [];
    w.__tocRailFrames = [];
    w.__navSampling = true;
    const tick = () => {
      w.__navFrames.push(new DOMMatrixReadOnly(getComputedStyle(rail).transform).m22);
      w.__tocRailFrames.push(new DOMMatrixReadOnly(getComputedStyle(tocRail).transform).m22);
      if (w.__navSampling) requestAnimationFrame(tick);
    };
    tick();
  });
  const top = await page.evaluate(() => {
    const a = document.getElementById("sources")!.getBoundingClientRect().top;
    const b = document.getElementById("window")!.getBoundingClientRect().top;
    return scrollY + (a + b) / 2 - 100;
  });
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), top);
  await expect(page.locator("[data-toc] [aria-current=location]")).toHaveText("来源准入与治理");
  await expect.poll(() => scale(page, "[aria-current=location] .k-toc-meter", "x")).toBeGreaterThan(0.1);
  expect(await scale(page, "[aria-current=location] .k-toc-meter", "x")).toBeLessThan(0.9);
  await expect.poll(() => scale(page, "[data-nav-progress]", "y")).toBeGreaterThan(0.1);
  // 等本次补间结束再收集；不能在低帧率引擎的首个有效插值帧就停止采样。
  await page.waitForFunction(() => {
    const w = window as unknown as { gsap: { getTweensOf(el: Element): Array<{ isActive(): boolean }> } };
    return w.gsap.getTweensOf(document.querySelector("[data-nav-progress]")!).every((t) => !t.isActive());
  });
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __navFrames: number[]; __tocRailFrames: number[]; __navSampling: boolean };
    w.__navSampling = false;
    return { nav: w.__navFrames, toc: w.__tocRailFrames };
  });
  expect(new Set(frames.nav.filter((n) => n > 0.001 && n < 0.99)).size, "导航轨线有多个有效插值帧").toBeGreaterThan(1);
  expect(new Set(frames.toc.filter((n) => n > 0.001 && n < 0.99)).size, "目录轨线有多个有效插值帧").toBeGreaterThan(1);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => scale(page, "[data-nav-progress]", "y")).toBeLessThan(0.001);
  await expect.poll(() => scale(page, "[data-toc-progress]", "y")).toBeLessThan(0.001);
});

test("三页到达末章时目录跟踪最后章节，当前页导航语义不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  for (const [slug, label, id] of [["about", "关于", "submit"], ["principles", "原则", "quarantine"], ["privacy", "隐私", "data"]]) {
    await page.goto(`${BASE}${slug}/`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
    await expect(page.locator(".k-toccol")).toHaveCSS("transform", "none");
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect(page.locator(`[data-toc] a[href="#${id}"]`)).toHaveAttribute("aria-current", "location");
    await expect(page.locator("[data-toc] [aria-current=location]")).toHaveCount(1);
    await expect(page.locator(".k-nav [aria-current=page]")).toHaveText(label!);
    await expect.poll(() => scale(page, "[data-nav-progress]", "y")).toBeGreaterThan(0.999);
  }
});

for (const mode of ["reduced", "vendor-failure"] as const) {
  test(`${mode}：章节与进度仍更新，不依赖空间补间`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    else await page.route("**/vendor/*.js", (route) => route.abort());
    await page.goto(`${BASE}principles/`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator(".k-toccol")).toHaveCSS("opacity", "1");
    await expect(page.locator(".k-toccol")).toHaveCSS("transform", "none");
    const top = await page.evaluate(() => document.getElementById("sources")!.getBoundingClientRect().top + scrollY - 100 + 4);
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), top);
    await expect(page.locator("[data-toc] [aria-current=location]")).toHaveText("来源准入与治理");
    expect(await scale(page, "[data-nav-progress]", "y")).toBeGreaterThan(0);
    expect(await scale(page, "[data-toc-progress]", "y")).toBe(await scale(page, "[data-nav-progress]", "y"));
    const count = await page.evaluate(() => {
      const w = window as unknown as { gsap?: { getTweensOf(el: Element): unknown[] } };
      return w.gsap?.getTweensOf(document.querySelector("[data-toc-marker]")!).length ?? 0;
    });
    expect(count, "降级没有目录位移补间").toBe(0);
  });
}

test("快速往返时每个标记至多一段有效补间，最新章节接管", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  await page.evaluate(() => {
    const w = window as unknown as { gsap: { getTweensOf(el: Element): Array<{ isActive(): boolean }> }; __navMax: number; __navSample: boolean };
    const targets = [...document.querySelectorAll("[data-toc-marker], [data-nav-progress], [data-toc-progress], .k-toc-meter")];
    w.__navMax = 0;
    w.__navSample = true;
    const tick = () => {
      targets.forEach((el) => { w.__navMax = Math.max(w.__navMax, w.gsap.getTweensOf(el).filter((t) => t.isActive()).length); });
      if (w.__navSample) requestAnimationFrame(tick);
    };
    tick();
  });
  for (const top of [800, 100, 1000, 250, 600, 0]) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), top);
    await page.waitForTimeout(25);
  }
  await expect(page.locator("[data-toc] [aria-current=location]")).toHaveText("排序与时间");
  await expect.poll(() => scale(page, "[data-nav-progress]", "y")).toBeLessThan(0.001);
  const count = await page.evaluate(() => {
    const w = window as unknown as { __navMax: number; __navSample: boolean };
    w.__navSample = false;
    return w.__navMax;
  });
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(1);
});

test("运行中切换减动效与恢复，不累积 ScrollTrigger", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const triggerCount = () => page.evaluate(() => (window as unknown as { ScrollTrigger: { getAll(): unknown[] } }).ScrollTrigger.getAll().length);
  const before = await triggerCount();
  for (let i = 0; i < 3; i++) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(triggerCount).toBe(before - 1);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(triggerCount).toBe(before);
  }
});

test("目录随正文滚动更新当前章节，向上滚动返回前一章", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}principles/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  const toc = page.locator("[data-toc]");
  await expect(toc.locator("[aria-current=location]")).toHaveText("排序与时间");
  const top = await page.evaluate(() => document.getElementById("sources")!.getBoundingClientRect().top + scrollY - 100 + 4);
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), top);
  await expect(toc.locator("[aria-current=location]")).toHaveText("来源准入与治理");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(toc.locator("[aria-current=location]")).toHaveText("排序与时间");
  await expect(page.locator(".k-nav [aria-current=page]")).toHaveText("原则");
});

test("导航键盘聚焦即时接管，旧悬停动画不能回写", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}about/`);
  await page.waitForSelector('html[data-oct-client="ready"]');
  test.skip(!(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)), "仅精细指针有悬停补间");
  const nav = page.locator("[data-knav]");
  const dot = page.locator("[data-kmarker]");
  const focused = nav.getByRole("link", { name: "原则", exact: true });
  await nav.getByRole("link", { name: "来源", exact: true }).hover();
  await page.waitForTimeout(40);
  await focused.focus();
  await page.waitForTimeout(300);
  const point = await dot.boundingBox();
  const row = await focused.boundingBox();
  expect(Math.abs(point!.y + point!.height / 2 - row!.y - row!.height / 2 - 1)).toBeLessThan(1);
  await expect(nav.locator("[aria-current=page]")).toHaveText("关于");
});
