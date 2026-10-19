import { expect, test, type Page } from "@playwright/test";
import { sortedEntries } from "./helpers.ts";

const DETAIL = `/overthecocoons/items/${sortedEntries()[0]!.id}/`;
const PARTS = [".k-detail-back", ".k-headline", ".k-media", ".k-summary", ".k-meta", ".k-detail-ext"];

async function ready(page: Page): Promise<void> {
  await page.goto(DETAIL);
  await page.waitForSelector('html[data-oct-client="ready"]');
}

test("详情逐项入场，首绘不闪现，标题先于图片及正文", async ({ page, isMobile }) => {
  test.skip(isMobile, "桌面同时可见元素的顺序采样，移动滚入另测");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((parts) => {
    const w = window as unknown as { gsap?: {globalTimeline:{timeScale(n:number):void}}; __detailFrames: Array<{pending:boolean; values:number[]}>; __detailSampling: boolean };
    w.__detailFrames = [];
    w.__detailSampling = true;
    addEventListener("pagehide", () => { w.__detailSampling = false; });
    document.addEventListener("load", e => {
      if (e.target instanceof HTMLScriptElement && e.target.src.endsWith("/vendor/gsap.min.js")) w.gsap?.globalTimeline.timeScale(0.5);
    }, true);
    const tick = () => {
      const article = document.querySelector("[data-detail-page]");
      if (article) w.__detailFrames.push({
        pending: document.documentElement.hasAttribute("data-oct-detail-pending"),
        values: parts.map(part => {
          const node = article.querySelector(part);
          if (!node) return 0;
          const style = getComputedStyle(node);
          return style.visibility === "hidden" ? 0 : Number(style.opacity);
        }),
      });
      if (w.__detailSampling && w.__detailFrames.length < 180 && article?.getAttribute("data-detail-motion") !== "done") requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, PARTS);
  await ready(page);
  for (const part of PARTS) {
    const node = page.locator(`[data-detail-page] > ${part}`);
    await node.scrollIntoViewIfNeeded();
    await expect(node).toHaveAttribute("data-detail-reveal", "done");
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as {__detailFrames:Array<{pending:boolean;values:number[]}>;__detailSampling:boolean};
    w.__detailSampling = false;
    return w.__detailFrames;
  });
  expect(frames.some(frame => frame.values.some(value => value > 0 && value < 1)), "必须采到真实中间透明度").toBe(true);
  expect(frames.filter(frame => frame.pending).every(frame => frame.values.every(value => value === 0)), "准备前无直显闪回").toBe(true);
  const starts = PARTS.slice(0, 3).map((_, index) => frames.findIndex(frame => frame.values[index]! > 0.01));
  expect(starts.every(index => index >= 0)).toBe(true);
  expect(starts[1]).toBeGreaterThanOrEqual(starts[0]!);
  expect(starts[2]).toBeGreaterThanOrEqual(starts[1]!);
  await expect(page.locator("[data-detail-page]")).toHaveAttribute("data-detail-motion", "done");
  await expect.poll(() => page.locator("[data-khud] .sec").evaluateAll(nodes => nodes.every(el => Number(getComputedStyle(el).opacity) === 1))).toBe(true);
});

test("详情图片入场后原尺寸、图文对齐与高光接管", async ({ page, isMobile }) => {
  await ready(page);
  const media = page.locator(".k-detail .k-media");
  await media.scrollIntoViewIfNeeded();
  await expect(media).toHaveAttribute("data-detail-reveal", "done");
  const geometry = await page.evaluate(() => {
    const media = document.querySelector<HTMLElement>(".k-detail .k-media")!;
    const summary = document.querySelector<HTMLElement>(".k-detail .k-summary")!;
    return {w:media.clientWidth,h:media.clientHeight,sw:summary.clientWidth,clip:getComputedStyle(media).clipPath,overflow:document.documentElement.scrollWidth-innerWidth};
  });
  expect(geometry.w).toBe(geometry.sw);
  expect(geometry.overflow).toBe(0);
  expect(geometry.clip).toBe("none");
  if (isMobile) {
    await media.tap();
    await expect(media.locator(".k-media-glow")).toHaveCount(0);
  } else {
    await media.hover({position:{x:60,y:60}});
    await expect.poll(() => media.locator(".k-media-glow").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  }
  expect(await media.evaluate(el => el.clientWidth)).toBe(geometry.w);
  expect(await media.evaluate(el => el.clientHeight)).toBe(geometry.h);
});

test("减弱动态及缺少GSAP均静态可读", async ({ page }) => {
  await page.emulateMedia({ reducedMotion:"reduce" });
  await ready(page);
  await expect(page.locator("[data-detail-page]")).toHaveAttribute("data-detail-motion", "static");
  expect(await page.locator(".k-detail .k-headline").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await page.emulateMedia({ reducedMotion:"no-preference" });
  await page.route("**/vendor/gsap.min.js", route => route.abort());
  await ready(page);
  await expect(page.locator("[data-detail-page]")).toHaveAttribute("data-detail-motion", "static");
  expect(await page.locator(".k-detail .k-media").evaluate(el => getComputedStyle(el).visibility)).toBe("visible");
});

test("停钟下键盘焦点直显，超时收尾，pagehide后不重播", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("load", e => {
      if (e.target instanceof HTMLScriptElement && e.target.src.endsWith("/vendor/gsap.min.js")) {
        (window as unknown as {gsap:{globalTimeline:{pause():void}}}).gsap.globalTimeline.pause();
      }
    }, true);
  });
  await ready(page);
  const back = page.locator(".k-detail-back a");
  await back.focus();
  await expect(page.locator(".k-detail-back")).toHaveAttribute("data-detail-reveal","done");
  expect(await page.locator(".k-detail-back").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  const media = page.locator(".k-detail .k-media");
  await media.scrollIntoViewIfNeeded();
  await expect(media).toHaveAttribute("data-detail-reveal", "done");
  expect(await media.evaluate(el => getComputedStyle(el).clipPath)).toBe("none");
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));
    dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));
  });
  await expect(page.locator("[data-detail-page]")).toHaveAttribute("data-detail-motion", "static");
  expect(await page.locator(".k-detail .k-summary").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});

test("入口迟到不重新隐藏已读详情", async ({ page }) => {
  await page.route("**/_astro/*.js", async route => {
    await new Promise(resolve => setTimeout(resolve,1800));
    await route.continue();
  });
  await ready(page);
  await expect(page.locator("[data-detail-page]")).toHaveAttribute("data-detail-motion", "static");
  expect(await page.locator(".k-detail .k-headline").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await expect(page.locator("[data-detail-reveal]")).toHaveCount(0);
});
