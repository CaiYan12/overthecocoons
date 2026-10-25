/**
 * 分页跳转后的滚动动效回归（2026-10-25 线上缺陷）：
 *
 * 症状：客户端分页跳转（点页码/输入跳转）后，① NOW READING 不再跟随阅读位置更新；
 * ② 滚回顶部后 Hero 视差等 GSAP 滚动动效不变化（冻结在跳页瞬间的中间值）。
 *
 * 根因：html{scroll-behavior:smooth}（kinetic.css）下，ScrollTrigger._refreshAll 的
 * 「临时内联 auto → 滚到 0 → 测量 → 恢复」舞步在 Chromium 上失效——内联样式写入未经
 * flush，scrollTo 仍按 smooth 异步执行，测量发生在旧滚动位置而缓存滚动值已写 0，
 * 所有元素位置触发器 start/end 整体偏移 −(刷新时的滚动值)。修复：refreshInit 事件中
 * 落内联 auto 并强制 flush（offsetHeight），refresh 收尾清空（motion.ts）。
 *
 * 本 spec 在「滚动状态下客户端翻页」后断言列表节点激活（NOW READING）与 Hero 视差
 * 都随滚动响应；静态链接式翻页与主题切换路径不在此重复（既有覆盖）。
 */
import { expect, test, type Page } from "@playwright/test";
import { wheelBy } from "./helpers.ts";

const BASE = "/overthecocoons/";

async function waitMotionOn(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-motion="on"]');
  await page.waitForSelector('html[data-oct-intro="done"]');
}

/** 日期层在桌面与手机均可见；英文背景层在窄屏按既有 CSS 隐藏。 */
async function heroTransform(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hero = document.querySelector("[data-herodate]");
    return hero ? getComputedStyle(hero).transform : "(missing)";
  });
}

async function scrollToTop(page: Page): Promise<void> {
  // 用户滚动回顶：按实际位置收敛，避免把单次脚本定位后的滚动锚定当成已经到顶。
  // Firefox 单次 wheel 不保证到顶；移动 WebKit 由 wheelBy 使用滚动键。
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  for (let step = 0; step < 16; step++) {
    await wheelBy(page, -2400);
    await page.waitForTimeout(250);
    if (await page.evaluate(() => scrollY === 0)) break;
  }
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.waitForTimeout(700); // scrub 收尾后再取样
}

/** HUD 必须指向当前视口内激活的条目，避免仅保留一个旧数字也能通过。 */
async function expectCurrentReading(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const ordinal = Number(document.querySelector("[data-rollin]")?.textContent?.trim());
    return [...document.querySelectorAll<HTMLElement>(".k-entry.is-active")].some((entry) => {
      const box = entry.getBoundingClientRect();
      return Number(entry.dataset.gi) + 1 === ordinal &&
        box.top <= innerHeight * 0.62 + 1 && box.bottom >= innerHeight * 0.38 - 1;
    });
  })).toBe(true);
}

test.describe("分页跳转后的滚动动效", () => {
  test("客户端翻页后 NOW READING 与 Hero 视差随滚动恢复响应", async ({ page }) => {
    await page.goto(BASE);
    await waitMotionOn(page);

    // 进入阅读状态：NOW READING 显示序号（动效层基线健康）
    await wheelBy(page, 1600);
    await page.waitForTimeout(500);
    await expectCurrentReading(page);

    // 窄栏大页数时数字 2 按分页窗口规则隐藏，使用仍可见的「下一页」入口。
    await page.locator('[data-pager] a[data-page="2"]:visible').first().click();
    await page.waitForSelector('[data-pager] [aria-current="page"][data-page="2"]');
    await page.waitForTimeout(600); // 渲染 + ScrollTrigger.refresh + 回顶滚动启动

    // 跳页后回到顶部再滚动：NOW READING 必须跟随（缺陷态恒为 --）
    await scrollToTop(page);
    await wheelBy(page, 1600);
    await page.waitForTimeout(700);
    await expectCurrentReading(page);

    // 跳页后 Hero 视差随滚动变化（缺陷态冻结在跳页瞬间的中间值）
    await scrollToTop(page);
    const heroAtTop = await heroTransform(page);
    await wheelBy(page, 900);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const heroScrolled = await heroTransform(page);
    expect(heroScrolled).not.toBe(heroAtTop);
    await scrollToTop(page);
    expect(await heroTransform(page)).toBe(heroAtTop);
  });

  test("输入跳转（表单提交）后滚动动效同样保持响应", async ({ page }) => {
    await page.goto(BASE);
    await waitMotionOn(page);
    await wheelBy(page, 1600);
    await page.waitForTimeout(500);

    const input = page.locator("[data-page-jump] input[name='page']");
    await expect(input).toBeVisible();
    await input.fill("3");
    await input.press("Enter");
    await page.waitForSelector('[data-pager] [aria-current="page"][data-page="3"]');
    await page.waitForTimeout(600);

    await scrollToTop(page);
    await wheelBy(page, 1600);
    await page.waitForTimeout(700);
    await expectCurrentReading(page);

    await scrollToTop(page);
    const heroAtTop = await heroTransform(page);
    await wheelBy(page, 900);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await heroTransform(page)).not.toBe(heroAtTop);
  });
});
