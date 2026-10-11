/**
 * 长文动效的浏览器行为回归。这里用独立浏览器与测试采样器观察真实绘制帧；
 * 放慢 GSAP 时钟只提高低帧率引擎的采样机会，不修改产品时长或 vendor/SRI。
 * reduced-motion、迟到入口和 pagehide/pageshow 均为受控模拟，不能替代实机/BFCache 验收。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = "/overthecocoons/";
const PAGES = ["sources", "about", "principles", "privacy"] as const;

interface PaintFrame {
  at: number;
  pending: boolean;
  mode: string | null;
  title: number;
  charY: number | null;
  charHeight: number;
  hudOpacity: number;
  ruleScale: number | null;
}

async function samplePaint(page: Page, speed = 0.5): Promise<void> {
  await page.addInitScript((speed) => {
    const w = window as unknown as {
      gsap?: { globalTimeline: { timeScale(n: number): void } };
      __docPaint: PaintFrame[];
      __docSampling: boolean;
    };
    w.__docPaint = [];
    w.__docSampling = true;
    document.addEventListener("load", (event) => {
      if (event.target instanceof HTMLScriptElement && event.target.src.endsWith("/vendor/gsap.min.js")) {
        w.gsap?.globalTimeline.timeScale(speed);
      }
    }, true);
    const opacity = (el: Element | null): number => {
      if (!el) return 0;
      let value = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none") return 0;
        value *= Number(style.opacity);
      }
      return value;
    };
    const sample = () => {
      const heading = document.querySelector("[data-longform-motion] h1");
      if (heading) {
        const char = heading.querySelector(".k-doc-char");
        const style = char ? getComputedStyle(char) : null;
        const y = style ? (style.transform === "none" ? 0 : new DOMMatrixReadOnly(style.transform).m42) : null;
        const height = char?.getBoundingClientRect().height ?? 0;
        // 门控时原始标题应隐藏；拆字后以遮罩内字符的可见比例衡量，避免把 yPercent 初态当作直显。
        const visible = opacity(char ?? heading) * (y === null ? 1 : Math.max(0, Math.min(1, 1 - Math.max(0, y) / (height || 1))));
        const rule = document.querySelector("[data-longform-hud] .k-hud-rule");
        const transform = rule ? getComputedStyle(rule).transform : null;
        w.__docPaint.push({
          at: performance.now(),
          pending: document.documentElement.hasAttribute("data-oct-doc-pending"),
          mode: document.documentElement.getAttribute("data-oct-longform"),
          title: visible,
          charY: y,
          charHeight: height,
          hudOpacity: opacity(document.querySelector("[data-longform-hud] .sec p") ?? document.querySelector("[data-khud] .sec p")),
          ruleScale: transform === null ? null : transform === "none" ? 1 : new DOMMatrixReadOnly(transform).m11,
        });
      }
      if (w.__docSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, speed);
}

async function paintFrames(page: Page): Promise<PaintFrame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __docPaint: PaintFrame[]; __docSampling: boolean };
    w.__docSampling = false;
    return w.__docPaint;
  });
}

async function ready(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-client="ready"]');
  await expect(page.locator("[data-longform-motion]")).toHaveCount(1);
}

async function titleDone(page: Page): Promise<void> {
  await expect(page.locator("[data-longform-motion] h1")).toHaveAttribute("data-doc-reveal", "done", { timeout: 10_000 });
}

async function visibleContent(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.locator(selector).count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator(selector).evaluateAll((nodes) => nodes.every((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) < 0.999 || style.visibility === "hidden" || style.display === "none") return false;
    }
    const style = getComputedStyle(el);
    const matrix = style.transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    return Math.abs(matrix.m41) < 0.01 && Math.abs(matrix.m42) < 0.01 && style.clipPath === "none";
  }))).toBe(true);
}

test("长文首绘门控：库延迟后正文和HUD不闪回隐藏初态", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await samplePaint(page);
  await page.route("**/vendor/gsap.min.js", async (route) => {
    // 故意制造可观察的网络空档；后续等待以实际状态为准。
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.goto(`${BASE}principles/`);
  await ready(page);
  await titleDone(page);
  await expect(page.locator("[data-longform-hud] .sec").first()).toHaveAttribute("data-doc-reveal", "done", { timeout: 10_000 });
  const frames = await paintFrames(page);
  expect(frames.some((frame) => frame.pending), "延迟空档确实采到正文门控帧").toBe(true);
  expect(frames.filter((frame) => frame.pending).every((frame) => frame.title < 0.01 && frame.hudOpacity < 0.01), "库加载前正文和HUD没有先画出静态层").toBe(true);
  expect(frames.some((frame, i) => i > 0 && frame.title + 0.02 < frames[i - 1]!.title), "标题首次出现后没有重置为隐藏状态").toBe(false);
  expect(frames.some((frame, i) => i > 0 && frame.hudOpacity + 0.02 < frames[i - 1]!.hudOpacity), "HUD首次出现后没有重置为隐藏状态").toBe(false);
});

test("四页正文逐字与HUD揭幕都有实际中间帧，减动效偏好仍完整播放", async ({ page }, testInfo) => {
  // 手机使用真实布局宽度；1440px × 手机DPR会创建非产品场景的巨型软件光栅面。
  const mobile = Boolean(testInfo.project.use.isMobile);
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await samplePaint(page);
  // 用户要求这些新增展示动效不因系统减动效偏好省略。
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const slug of PAGES) {
    await page.goto(`${BASE}${slug}/`);
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-oct-longform", "on");
    await titleDone(page);
    if (mobile) await page.locator("[data-longform-hud]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-longform-hud] .sec").last()).toHaveAttribute("data-doc-reveal", "done", { timeout: 10_000 });
    const frames = await paintFrames(page);
    await testInfo.attach(`${slug}-paint-frames`, { body: JSON.stringify(frames), contentType: "application/json" });
    expect(new Set(frames.filter((frame) => frame.charY !== null && frame.charY > 0.1 && frame.charY < frame.charHeight - 0.1).map((frame) => frame.charY)).size, `${slug} 标题有多个遮罩内位移帧`).toBeGreaterThan(1);
    if (mobile) {
      expect(new Set(frames.filter((frame) => frame.hudOpacity > 0.01 && frame.hudOpacity < 0.99).map((frame) => frame.hudOpacity)).size, `${slug} 手机后置HUD内容有多个揭幕帧`).toBeGreaterThan(1);
    } else {
      const ruleFrames = frames.filter((frame) => frame.ruleScale !== null && frame.ruleScale > 0.01 && frame.ruleScale < 0.99);
      expect(new Set(ruleFrames.map((frame) => frame.ruleScale)).size, `${slug} HUD分隔线有多个扫入帧: ${JSON.stringify(ruleFrames.map((frame) => ({ at: frame.at, scale: frame.ruleScale })))}`).toBeGreaterThan(1);
    }
    await visibleContent(page, "[data-longform-motion] h1 .k-doc-char, [data-longform-hud] .sec p");
  }
});

test("目录锚点位置不随拆字揭示移动，往返滚动不重播已读章节", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  for (const slug of PAGES) {
    await page.goto(`${BASE}${slug}/`);
    await ready(page);
    await titleDone(page);
    const firstHeading = page.locator("[data-longform-motion] h2").first();
    await expect(firstHeading).toHaveAttribute("data-doc-reveal", "done", { timeout: 10_000 });
    const lastLink = page.locator("[data-toc] a").last();
    const href = (await lastLink.getAttribute("href"))!;
    const anchorBefore = await page.evaluate((href) => document.getElementById(href.slice(1))!.getBoundingClientRect().top + scrollY, href);
    await lastLink.click();
    await expect(lastLink).toHaveAttribute("aria-current", "location");
    const lastHeading = page.locator("[data-longform-motion] h2").last();
    await expect(lastHeading).toHaveAttribute("data-doc-reveal", "done", { timeout: 10_000 });
    const position = await page.evaluate((href) => {
      const anchor = document.getElementById(href.slice(1))!;
      return { absolute: anchor.getBoundingClientRect().top + scrollY, top: anchor.getBoundingClientRect().top,
        headerBottom: document.querySelector("[data-kheader]")!.getBoundingClientRect().bottom,
        transforms: [...document.querySelectorAll("[data-longform-motion] h2")].map((el) => getComputedStyle(el).transform) };
    }, href);
    expect(Math.abs(position.absolute - anchorBefore), `${slug} 原生锚点的文档坐标保持稳定`).toBeLessThan(1);
    expect(position.top).toBeGreaterThanOrEqual(position.headerBottom - 1);
    expect(position.transforms.every((transform) => transform === "none"), "只动画标题内部字符，不位移标题锚点").toBe(true);
    await page.evaluate(() => {
      const w = window as unknown as { __docReplay: string[] };
      w.__docReplay = [];
      const headings = [...document.querySelectorAll("[data-longform-motion] h2")];
      for (const heading of [headings[0]!, headings.at(-1)!]) {
        new MutationObserver(() => {
          if (heading.getAttribute("data-doc-reveal") !== "done") w.__docReplay.push(heading.getAttribute("data-doc-reveal") ?? "removed");
        }).observe(heading, { attributes: true, attributeFilter: ["data-doc-reveal"] });
      }
    });
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await expect(page.locator("[data-toc] a").first()).toHaveAttribute("aria-current", "location");
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect(lastLink).toHaveAttribute("aria-current", "location");
    expect(await page.evaluate(() => (window as unknown as { __docReplay: string[] }).__docReplay), "已经完成的章节不会再进入pending/playing").toEqual([]);
    await visibleContent(page, "[data-longform-motion] > section:last-child h2 .k-doc-char, [data-longform-motion] > h2:last-of-type .k-doc-char");
  }
});

test("快速跳章与焦点接管保持可读，页面生命周期收尾不留下隐藏正文", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}about/`);
  await ready(page);
  const originalText = await page.locator("[data-longform-motion]").textContent();
  await page.evaluate(() => {
    (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap.globalTimeline.pause();
  });
  const finalSection = page.locator("[data-longform-motion] section").last();
  const finalLink = finalSection.getByRole("link").last();
  await finalLink.focus();
  await expect(finalLink).toBeFocused();
  await expect(finalSection.locator("h2")).toHaveAttribute("data-doc-reveal", "done");
  await visibleContent(page, "[data-longform-motion] section:last-child .k-doc-char, [data-longform-motion] section:last-child [data-doc-block]");
  const hudLink = page.locator("[data-longform-hud] a").last();
  await hudLink.focus();
  await expect(hudLink).toBeFocused();
  await expect(page.locator("[data-longform-hud] .sec").last()).toHaveAttribute("data-doc-reveal", "done");
  await visibleContent(page, "[data-longform-hud] .sec:last-child p, [data-longform-hud] .sec:last-child .k-hud-link-text");
  await page.evaluate(() => {
    (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume();
    scrollTo({ top: 0, behavior: "instant" });
  });
  await titleDone(page);
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await visibleContent(page, "[data-longform-motion] section:last-child .k-doc-char, [data-longform-motion] section:last-child [data-doc-block]");
  // 合成生命周期事件验证收尾处理；真实BFCache恢复由单独人工/浏览器验收覆盖。
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  expect(await page.locator("[data-longform-motion]").textContent()).toBe(originalText);
  await visibleContent(page, "[data-longform-motion] h1, [data-longform-motion] h2, [data-longform-motion] p, [data-longform-motion] li, [data-khud] p");
});

test("时钟在章节开始前暂停，滚入新章仍由原生兜底解除遮罩", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${BASE}about/`);
  await ready(page);
  await titleDone(page);
  const heading = page.locator("[data-longform-motion] section:last-child h2");
  await expect(heading).toHaveAttribute("data-doc-reveal", "pending");
  await page.evaluate(() => {
    const sdk = window as unknown as { gsap: { globalTimeline: { pause(): void } }; ScrollTrigger: { update(): void } };
    sdk.gsap.globalTimeline.pause();
    const anchor = document.querySelector("[data-longform-motion] section:last-child h2")!;
    scrollTo({ top: anchor.getBoundingClientRect().top + scrollY - innerHeight / 2, behavior: "instant" });
    sdk.ScrollTrigger.update();
  });
  await expect(heading).toHaveAttribute("data-doc-reveal", "done", { timeout: 3000 });
  await visibleContent(page, "[data-longform-motion] section:last-child .k-doc-char, [data-longform-motion] section:last-child [data-doc-block]");
});

test("缺动效库与无JS时四页静态可读，不依赖隐藏初态", async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.route("**/vendor/*.js", (route) => route.abort());
  for (const slug of PAGES) {
    await page.goto(`${BASE}${slug}/`);
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-oct-longform", "static");
    await expect(page.locator("html")).not.toHaveAttribute("data-oct-doc-pending", "");
    await visibleContent(page, "[data-longform-motion] h1, [data-longform-motion] h2, [data-longform-motion] p, [data-longform-motion] li, [data-longform-motion] dt, [data-longform-motion] dd, [data-longform-motion] tr, [data-khud] p");
  }
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const staticPage = await context.newPage();
    for (const slug of PAGES) {
      await staticPage.goto(`${BASE}${slug}/`);
      await expect(staticPage.locator("[data-longform-motion] h1")).toBeVisible();
      await expect(staticPage.locator("html")).not.toHaveAttribute("data-oct-doc-pending", "");
      await visibleContent(staticPage, "[data-longform-motion] h1, [data-longform-motion] h2, [data-longform-motion] p, [data-longform-motion] li, [data-khud] p");
      expect(await staticPage.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  } finally { await context.close(); }
});

test("入口迟到：首绘兜底后保持静态可读，不重新隐藏播放", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await request.get(`${BASE}privacy/`);
  const html = await response.text();
  // 从实际HTML获取模块URL，同时适配dev与构建产物，不推测生成的bundle文件名。
  const moduleURLs = new Set([...html.matchAll(/<script\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /\btype=["']module["']/.test(tag))
    .map((tag) => tag.match(/\bsrc=["']([^"']+)["']/)?.[1])
    .filter((src): src is string => !!src)
    .map((src) => new URL(src.replaceAll("&amp;", "&"), response.url()).href));
  expect(moduleURLs.size, "页面必须存在实际客户端模块入口").toBeGreaterThan(0);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => moduleURLs.has(url.href), async (route) => {
    await held;
    await route.continue();
  });
  await samplePaint(page);
  try {
    await page.goto(`${BASE}privacy/`, { waitUntil: "commit" });
    await expect(page.locator("[data-longform-motion] h1")).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-oct-doc-pending", "");
    await visibleContent(page, "[data-longform-motion] h1, [data-khud] p");
    release();
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-oct-longform", "static");
    await visibleContent(page, "[data-longform-motion] h1, [data-longform-motion] h2, [data-longform-motion] p, [data-khud] p");
    const frames = await paintFrames(page);
    const firstShown = frames.findIndex((frame) => frame.title > 0.99);
    expect(firstShown).toBeGreaterThanOrEqual(0);
    expect(frames.slice(firstShown).every((frame) => frame.title > 0.99 && frame.hudOpacity > 0.99), "1500ms兜底直显后，迟到模块不再重新遮蔽").toBe(true);
  } finally { release(); }
});

test("正文与HUD只动画内部绘制，短屏页脚安全与自然栏高保持不变", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 360 : 844 });
    for (const slug of PAGES) {
      await page.goto(`${BASE}${slug}/`);
      await ready(page);
      await page.evaluate(() => document.fonts.ready);
      const before = await page.locator(".k-hud-boundary").evaluate((el) => el.getBoundingClientRect().height);
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect(page.locator("[data-longform-hud] .sec").last()).toHaveAttribute("data-doc-reveal", "done", { timeout: 10_000 });
      const layout = await page.evaluate(() => {
        const hud = document.querySelector("[data-khud]")!;
        const nav = document.querySelector("[data-docnav]")!;
        const footer = document.querySelector("footer")!.getBoundingClientRect();
        return { height: document.querySelector(".k-hud-boundary")!.getBoundingClientRect().height,
          hudBottom: hud.getBoundingClientRect().bottom, navBottom: nav.getBoundingClientRect().bottom, footerTop: footer.top,
          overflow: getComputedStyle(hud).overflowY, max: getComputedStyle(hud).maxHeight, scroll: hud.scrollTop,
          horizontal: document.documentElement.scrollWidth - innerWidth };
      });
      expect(Math.abs(layout.height - before), `${slug} ${width}px HUD揭示不改变自然栏高`).toBeLessThan(1);
      expect(layout.hudBottom).toBeLessThanOrEqual(layout.footerTop);
      expect(layout.navBottom).toBeLessThanOrEqual(layout.footerTop);
      expect(layout.overflow).toBe("visible");
      expect(layout.max).toBe("none");
      expect(layout.scroll).toBe(0);
      expect(layout.horizontal).toBeLessThanOrEqual(1);
    }
  }
});
