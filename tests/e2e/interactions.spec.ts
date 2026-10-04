/**
 * Ticket 05 真浏览器交互测试：主题筛选后分页、跨页主题、空态、阅读位置内存语义、
 * 三态主题（含存储拒绝降级）、复制链接（成功/回退/失败）、全屏菜单、返回顶部、脚本失败降级。
 *
 * 行为基准：docs/design/prototype-timeline.html 的 v-kinetic 变体（去掉动效部分，动效属 Ticket 06）。
 * 数据口径：读 fixtures/snapshot.json（与构建同一份演示快照），期望值在文件内推导，不硬编码。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PublicEntry, PublicSnapshot } from "../../src/domain/contract.ts";
import { pickTopic, wheelBy, wheelEntryToLine } from "./helpers.ts";

const BASE = "/overthecocoons/";
const THEME_KEY = "overthecocoons.theme";

/** 与渲染层一致的排序口径：首次收录时间倒序，同时间按 id 升序。 */
function sortedEntries(): PublicEntry[] {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "snapshot.json"), "utf-8"),
  ) as PublicSnapshot;
  return [...snapshot.entries].sort((a, b) => {
    const byTime = Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt);
    return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const sorted = sortedEntries();
const news = sorted.filter((entry) => entry.topic === "新闻");
const societyInPage1 = sorted
  .map((entry, index) => ({ entry, gi: index }))
  .filter(({ entry, gi }) => entry.topic === "社会" && gi < 20);
/** 页 1 内的一条「社会」条目（全局序号），用于切主题回退/恢复测试。 */
const societyGi = societyInPage1[0]!.gi;

/** 等待客户端增强模块就绪（入口模块在 html 上打标记）。 */
async function waitClientReady(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-client="ready"]');
}

/** 滚过 84px 阈值并等待 Header Morph 滑入（Ticket 06 动效：header 首屏隐藏，滚动后出现）。 */
async function showHeader(page: Page): Promise<void> {
  // 指针须落在最小移动视口（412px）内：越界指针的 wheel 事件不派发到页面
  await page.mouse.move(200, 300);
  for (let attempt = 0; attempt < 3; attempt++) {
    await wheelBy(page, 300);
    const state = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      atBottom:
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1,
    }));
    if (state.scrollY <= 84) continue; // wheel 未生效（偶发），重试
    if (state.atBottom) {
      // 列表尾页 focus 分页器停在 maxScroll 底部：向下 wheel 空转且焦点式滚动不触发
      // morph 更新；向上滚一次（位置仍高于 84 阈值）唤醒按当前位置重算
      await wheelBy(page, -200);
    }
    break; // 已滚动：等 morph 补间完成（下方 gate；低帧率/负载下补间按 GSAP lag smoothing 慢速推进）
  }
  try {
    await page.waitForFunction(
      () => {
        const header = document.querySelector("[data-kheader]");
        if (!header) return true;
        const transform = getComputedStyle(header).transform;
        if (transform === "none") return true;
        return new DOMMatrixReadOnly(transform).m42 > -10;
      },
      undefined,
      { timeout: 15_000 },
    );
  } catch (error) {
    // 失败时带出页面状态便于定位（滚动位置 / morph / 客户端就绪标记）
    const state = await page
      .evaluate(() => {
        const header = document.querySelector("[data-kheader]");
        const transform = header ? getComputedStyle(header).transform : "missing";
        return {
          scrollY: Math.round(window.scrollY),
          m42:
            transform === "none"
              ? "none"
              : transform === "missing"
                ? "missing"
                : +new DOMMatrixReadOnly(transform).m42.toFixed(1),
          motion: document.documentElement.getAttribute("data-oct-motion"),
          client: document.documentElement.getAttribute("data-oct-client"),
        };
      })
      .catch(() => null);
    throw new Error(`showHeader 超时，页面状态: ${JSON.stringify(state)}; ${String(error)}`);
  }
}

/** 等待全屏菜单关闭动画结束（Ticket 06：关闭走 GSAP 时间线后 dialog.close()）。 */
async function waitMenuClosed(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const menu = document.querySelector<HTMLDialogElement>("dialog[data-kmenu]");
      return !menu || !menu.open;
    },
    undefined,
    { timeout: 5_000 },
  );
}

/** 等待播报出现指定文案（两段式切换时播报发生在 out 段动画完成后）。 */
async function expectStatusContains(page: Page, text: string): Promise<void> {
  // 两段式切换播报在 out 段（0.26s）完成后；负载下 GSAP lag smoothing 会让补间慢速推进
  await expect.poll(async () => statusText(page), { timeout: 15_000 }).toContain(text);
}

/** 在 window 上做标记，断言后续交互没有发生整页导航（客户端接管）。 */
async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { octMark?: number }).octMark = 1;
  });
}
async function expectSameDocument(page: Page): Promise<void> {
  const mark = await page.evaluate(() => (window as unknown as { octMark?: number }).octMark);
  expect(mark, "交互应发生在同一文档（客户端接管，无整页导航）").toBe(1);
}

/** 把指定条目滚到阅读基准线（用户手势，触发阅读位置追踪）；按 DOM 状态迭代收敛。 */
async function wheelEntryToReadLine(page: Page, gi: number): Promise<void> {
  await wheelEntryToLine(page, gi);
}

async function statusText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector("[data-status]")?.textContent ?? "");
}

test.describe("主题筛选与分页（客户端接管静态链接式分页）", () => {
  test("Tab 点击即时筛选并分页：筛选优先于分页、每页 ≤20、无整页导航", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);
    await markWindow(page);
    await showHeader(page);

    await pickTopic(page, "新闻");
    await expectStatusContains(page, "已切换主题：新闻");
    await expectStatusContains(page, "第 1 页");
    await expectSameDocument(page);

    // 第一页 20 条、全部为新闻、HUD 总数同步为 23、页码指示 1/2
    const entries = page.locator(".k-entry");
    await expect(entries).toHaveCount(20);
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(20).fill("新闻"));
    await expect(page.locator("[data-total]")).toHaveText("23");
    await expect(page.locator('[data-pager] [aria-label="第 2 页"]')).toBeVisible();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute(
      "aria-label",
      "第 1 页",
    );
    // 首条为新闻主题里收录时间最新的一条
    await expect(page.locator('.k-entry[data-gi="0"] time')).toHaveAttribute(
      "datetime",
      news[0]!.firstSeenAt,
    );

    // 翻到第 2 页：剩余 3 条，仍是新闻
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(3);
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(3).fill("新闻"));
    await expect(page.locator('.k-entry[data-gi="20"] time')).toHaveAttribute(
      "datetime",
      news[20]!.firstSeenAt,
    );
    await expect(page.locator('[data-pager] [aria-label="第 2 页"][aria-current="page"]')).toHaveCount(1);
    await expectStatusContains(page, "第 2 页");
    await expectSameDocument(page);

    // 切回全部：45 条、3 页，页码重置为 1（翻页渲染会回顶使 header 滑出，先重新滚入）
    await showHeader(page);
    await pickTopic(page, "全部");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator("[data-total]")).toHaveText("45");
    await expect(page.locator('[data-pager] [aria-label="第 3 页"]')).toBeVisible();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute(
      "aria-label",
      "第 1 页",
    );
  });

  test("跨页主题切换保持筛选：从静态第 2 页进入，切主题后筛选跨页生效", async ({ page }) => {
    await page.goto(`${BASE}page/2/`);
    await waitClientReady(page);
    await markWindow(page);
    await showHeader(page);

    await pickTopic(page, "新闻");
    // 两段式切换的渲染在 out 段后：等播报确认渲染完成，翻页才作用于新主题
    await expectStatusContains(page, "已切换主题：新闻");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(3);
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(3).fill("新闻"));
    await expectSameDocument(page);

    // 切回全部回到第 1 页（主题切换重置页码；翻页渲染回顶使 header 滑出，先重新滚入）
    await showHeader(page);
    await pickTopic(page, "全部");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator('.k-entry[data-gi="0"] time')).toHaveAttribute(
      "datetime",
      sorted[0]!.firstSeenAt,
    );
  });

  test("空主题真实空态与「查看全部」恢复路径", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);
    await showHeader(page);

    await pickTopic(page, "哲学");
    await expectStatusContains(page, "已切换主题：哲学（暂无内容）");
    await expect(page.getByText("「哲学」暂无内容")).toBeVisible();
    await expect(page.locator(".k-entry")).toHaveCount(0);
    await expect(page.locator("[data-total]")).toHaveText("00");
    await expect(page.locator("[data-pager]")).toBeHidden();

    await page.locator("[data-all]").click();
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expectStatusContains(page, "已切换主题：全部");
  });
});

test.describe("阅读位置（仅本次访问内存）", () => {
  test("翻页往返恢复到原条目并播报", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);

    await wheelEntryToReadLine(page, 5);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator('.k-entry[data-gi="20"]')).toBeVisible();

    await page.locator('[data-pager] [aria-label="第 1 页"]').click();
    await expectStatusContains(page, "已恢复到原阅读位置");
    await expect
      .poll(async () => (await page.locator('[data-gi="5"]').boundingBox())?.y ?? 9999, {
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(200);
  });

  test("切主题回退播报：原条目不在当前主题内容中，返回后恢复", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);

    // 阅读页 1 中的一条「社会」条目，然后切到「新闻」（该条目不在新闻内容中）
    await wheelEntryToReadLine(page, societyGi);
    await pickTopic(page, "新闻");
    await expectStatusContains(page, "内容已变化，原条目不在当前内容中");
    await expect(page.locator(".k-entry")).toHaveCount(20);

    // 切回全部：原条目仍在，恢复到原条目（切换渲染回顶使 header 滑出，先重新滚入）
    await showHeader(page);
    await pickTopic(page, "全部");
    await expectStatusContains(page, "已恢复到原阅读位置");
    await expect
      .poll(async () => (await page.locator(`[data-gi="${societyGi}"]`).boundingBox())?.y ?? 9999, {
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(200);
  });

  test("刷新重置：重载后不回到原位置、不播报恢复", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);

    await wheelEntryToReadLine(page, 5);
    await page.reload();
    await waitClientReady(page);

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, "刷新后阅读位置应重置到顶部").toBe(0);
    const status = await statusText(page);
    expect(status, "加载时不播报恢复").not.toContain("已恢复到原阅读位置");
  });
});

test.describe("三态主题（浅色/深色/跟随系统）", () => {
  test("循环切换、html data-theme 同步、项目专属 key 本地保存并在重载后恢复", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);
    await showHeader(page);

    const modeBtn = page.locator("[data-mode]");
    await expect(modeBtn).toHaveText("显示：浅色");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await modeBtn.click();
    await expect(modeBtn).toHaveText("显示：深色");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await statusText(page)).toContain("显示模式：深色");

    await modeBtn.click();
    await expect(modeBtn).toHaveText("显示：跟随系统");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "auto");

    await modeBtn.click();
    await expect(modeBtn).toHaveText("显示：浅色");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // 保存偏好后重载恢复：切到深色 → 重载 → 仍为深色
    await modeBtn.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await waitClientReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("[data-mode]")).toHaveText("显示：深色");
  });

  test("存储被拒（隐私模式模拟）：降级为内存态仍可用，无页面错误", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("denied", "SecurityError");
        },
        configurable: true,
      });
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new DOMException("denied", "SecurityError");
        },
        configurable: true,
      });
    });
    const errors: string[] = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto(BASE);
    await waitClientReady(page);
    await showHeader(page);
    const modeBtn = page.locator("[data-mode]");
    await modeBtn.click();
    await expect(modeBtn).toHaveText("显示：深色");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await modeBtn.click();
    await expect(modeBtn).toHaveText("显示：跟随系统");
    // 交互功能不受存储拒绝影响
    await pickTopic(page, "新闻");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    expect(errors, "存储拒绝不应产生未捕获错误").toEqual([]);
    await context.close();
  });
});

test.describe("隐私断言（持久化仅限主题偏好）", () => {
  test("完整交互流程后：localStorage 仅主题 key，sessionStorage 为空", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);
    await showHeader(page);

    // 完整走一遍会产生状态的交互：主题、翻页、菜单、阅读位置
    await page.locator("[data-mode]").click();
    await pickTopic(page, "新闻");
    // 两段式切换的渲染在 out 段后：等播报确认渲染完成，翻页才作用于新闻（避免交错渲染回页 1）
    await expectStatusContains(page, "已切换主题：新闻");
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await showHeader(page);
    await page.locator("[data-kmenu-open]").click();
    await page.keyboard.press("Escape");
    await waitMenuClosed(page);
    await wheelEntryToReadLine(page, 22);
    await pickTopic(page, "全部");

    // 详情页路径（审查修复环 R2-I1）：copy.ts 所在页面必须在断言捕获范围内——
    // 进入详情页并点击复制按钮（未授予剪贴板权限，走 clipboard 或 execCommand 回退均可），
    // 待复制流程播报完成后，在同一上下文断言存储状态。
    await page.goto(`${BASE}items/${sorted[0]!.id}/`);
    await waitClientReady(page);
    const copyBtn = page.locator("[data-copy-link]");
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect
      .poll(async () => statusText(page), { timeout: 5_000 })
      .toMatch(/链接已复制|复制未成功/);

    const storage = await page.evaluate(() => ({
      local: Object.keys(window.localStorage).map((key) => ({
        key,
        value: window.localStorage.getItem(key),
      })),
      session: Object.keys(window.sessionStorage),
    }));
    expect(
      storage.local.filter((item) => item.key !== THEME_KEY),
      "除主题偏好外不得有任何 localStorage 写入（含详情页交互后）",
    ).toEqual([]);
    const themeValue = storage.local.find((item) => item.key === THEME_KEY)?.value;
    expect(["light", "dark", "auto"]).toContain(themeValue);
    expect(storage.session, "不得写入 sessionStorage").toEqual([]);
  });
});

test.describe("详情页复制链接", () => {
  const detailUrl = `${BASE}items/${sorted[0]!.id}/`;

  test("navigator.clipboard 成功路径：写入门户地址并播报", async ({ browser }) => {
    const context = await browser.newContext();
    let page!: Page;
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      // Playwright WebKit 把 clipboard 权限错误延迟到 newPage 应用时抛出
      page = await context.newPage();
    } catch (error) {
      await context.close();
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      test.skip(true, `当前引擎不提供 clipboard 权限授予：${reason}`);
    }
    await page.goto(detailUrl);
    await waitClientReady(page);

    const copyBtn = page.locator("[data-copy-link]");
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(copyBtn).toBeEnabled();
    await expect
      .poll(async () => statusText(page), { timeout: 5_000 })
      .toContain("链接已复制");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(page.url());
    await context.close();
  });

  test("回退路径：clipboard API 不可用时用 execCommand 复制成功", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        get: () => undefined,
        configurable: true,
      });
    });
    const page = await context.newPage();
    await page.goto(detailUrl);
    await waitClientReady(page);

    await page.locator("[data-copy-link]").click();
    await expect
      .poll(async () => statusText(page), { timeout: 5_000 })
      .toContain("链接已复制");
    await context.close();
  });

  test("失败路径：两条路径都不可用时播报失败", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        get: () => undefined,
        configurable: true,
      });
      document.execCommand = () => false;
    });
    const page = await context.newPage();
    await page.goto(detailUrl);
    await waitClientReady(page);

    await page.locator("[data-copy-link]").click();
    await expect
      .poll(async () => statusText(page), { timeout: 5_000 })
      .toContain("复制未成功");
    await context.close();
  });
});

test.describe("全屏菜单（dialog）", () => {
  test("打开焦点进入、Esc 关闭焦点返回、aria-expanded 同步、连续开合稳定", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);
    await showHeader(page);

    const openBtn = page.locator("[data-kmenu-open]");
    const menu = page.locator("[data-kmenu]");
    const closeBtn = page.locator("[data-kmenu-close]");

    await openBtn.click();
    expect(await page.evaluate(() => document.querySelector("dialog")?.open)).toBe(true);
    await expect(openBtn).toHaveAttribute("aria-expanded", "true");
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-kmenu-close")),
      "打开后焦点应进入菜单（关闭按钮）",
    ).toBe(true);

    await page.keyboard.press("Escape");
    await waitMenuClosed(page);
    await expect(openBtn).toHaveAttribute("aria-expanded", "false");
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-kmenu-open")),
      "关闭后焦点应返回触发按钮",
    ).toBe(true);

    // 连续开合稳定（关闭动画结束后才能再次打开）
    for (let round = 0; round < 2; round++) {
      await openBtn.click();
      expect(await page.evaluate(() => document.querySelector("dialog")?.open)).toBe(true);
      await closeBtn.click();
      await waitMenuClosed(page);
    }
    await expect(menu).toHaveCount(1);
  });

  test("菜单内主题点击：客户端切换主题并关闭菜单、header aria-current 同步", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);
    await markWindow(page);
    await showHeader(page);

    await page.locator("[data-kmenu-open]").click();
    await page.locator('.k-menu-topics .tab[data-topic="新闻"]').click();
    await waitMenuClosed(page);
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator('.k-entry .tpc').first()).toHaveText("新闻");
    await expect(page.locator('[data-ktabs] .tab[data-topic="新闻"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expectSameDocument(page);
  });
});

test.describe("返回顶部", () => {
  test("阈值显隐、点击平滑回到顶部", async ({ page }) => {
    await page.goto(BASE);
    await waitClientReady(page);

    const topBtn = page.locator("[data-ktop]");
    // 指针须落在最小移动视口（412px）内：越界指针的 wheel 事件不派发到页面
  await page.mouse.move(200, 300);
    await wheelBy(page, 1500);
    await page.waitForTimeout(300);
    await expect(topBtn).toHaveClass(/show/);
    await topBtn.click();
    await page.waitForFunction(() => window.scrollY === 0, undefined, { timeout: 5_000 });
  });
});

test.describe("脚本失败降级（无 JS 可读性回归）", () => {
  test("模块脚本被拦截时页面保持静态可读、链接式分页可用、无播报", async ({ page }) => {
    await page.route(/\.js(\?.*)?$/, (route) => route.abort());
    await page.goto(BASE);

    await expect(page.getByRole("heading", { name: /跳\s*出\s*茧\s*房/ }).first()).toBeVisible();
    await expect(page.locator(".k-entry .k-headline a").first()).toBeVisible();
    await expect(page.locator('[data-pager] [aria-label="第 2 页"]')).toBeVisible();
    expect(await statusText(page), "脚本失败不产生播报").toBe("");
    // 主题 tab 仍是真实链接（无 JS 兜底）
    await expect(page.locator('[data-ktabs] .tab[data-topic="新闻"]')).toHaveAttribute(
      "href",
      /\/overthecocoons\/topics\/news\/$/,
    );
  });
});
