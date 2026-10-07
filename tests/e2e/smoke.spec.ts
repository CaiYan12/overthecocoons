import { expect, test } from "@playwright/test";
import { safeScreenshot, sortedEntries } from "./helpers.ts";

const BASE = "/overthecocoons/";

test.describe("时间线与站点冒烟（Ticket 04）", () => {
  test("基路径下返回 200 且标题正确", async ({ page }) => {
    const response = await page.goto(BASE);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/跳出茧房/);
  });

  test("页面资源全部经基路径可达（无失败请求；Ticket 08 起动效库自托管，基路径外零资源）", async ({ page }) => {
    const failed: string[] = [];
    const offBaseAll: string[] = [];
    // Ticket 08 自托管裁定：动效库已在 /overthecocoons/vendor/ 下，基路径外不再有任何资源
    page.on("requestfailed", (request) => {
      failed.push(`${request.url()} :: ${request.failure()?.errorText}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failed.push(`${response.url()} :: HTTP ${response.status()}`);
      }
      const path = new URL(response.url()).pathname;
      if (!path.startsWith(BASE)) {
        offBaseAll.push(response.url());
      }
    });
    await page.goto(BASE);
    // 等待网络空闲，确保样式表等资源已加载
    await page.waitForLoadState("networkidle");
    expect(failed, "不应有失败或 4xx/5xx 请求").toEqual([]);
    // 豁免收窄（T01 收尾项）：仅同源根路径 /favicon.ico（GitHub Pages 约定回退）可豁免，
    // 其余任何 host 上的 /favicon.ico 路径仍计入基路径外资源。
    const siteOrigin = await page.evaluate(() => location.origin);
    const offBase = offBaseAll.filter((url) => {
      const parsed = new URL(url);
      return !(parsed.origin === siteOrigin && parsed.pathname === "/favicon.ico");
    });
    expect(offBase, "所有资源都应位于 /overthecocoons/ 前缀下（仅同源根 favicon 豁免）").toEqual([]);
    // 样式表已实际生效（说明 CSS 经基路径加载成功）
    const bodyColor = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyColor, "全局样式应已应用").not.toBe("rgba(0, 0, 0, 0)");
  });

  test("320px 与 1440px 两端均无横向破版，并留存截图", async ({ page }) => {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE);
      await page.waitForLoadState("networkidle");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth, `${width}px 视口不应出现横向滚动`).toBeLessThanOrEqual(width);
      await safeScreenshot(page, `test-results/screenshots/home-${width}.png`);
    }
  });

  test("禁用 JS 后页面仍可读（Hero、条目标题、分页与演示数据标注）", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BASE);
    await expect(
      page.getByRole("heading", { name: /跳\s*出\s*茧\s*房/ }).first(),
    ).toBeVisible();
    await expect(page.getByText(/以下均为演示数据/).first()).toBeVisible();
    // 无 JS 分页兜底：首页存在指向第 2 页的链接
    await expect(page.getByRole("link", { name: "第 2 页" })).toBeVisible();
    // 条目标题是站内详情链接
    const firstTitle = page.locator(".k-entry .k-headline a").first();
    await expect(firstTitle).toBeVisible();
    await expect(firstTitle).toHaveAttribute("href", /\/overthecocoons\/items\//);
    await context.close();
  });

  test("禁用 JS 后关键内容存在（时间线/主题页/空主题/详情页）", async ({ browser }) => {
    // Ticket 05 起站点包含渐进增强脚本；无 JS 语义改为：关键内容在无 JS 上下文仍可读。
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    // 首页：Hero、条目、链接式分页（原「零 script 标签」断言的语义等价替换）
    await page.goto(BASE);
    await expect(page.locator(".k-entry .k-headline a").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "第 2 页" })).toBeVisible();

    // 主题页：新闻有内容
    await page.goto(`${BASE}topics/news/`);
    await expect(page.locator(".k-entry").first()).toBeVisible();
    await expect(page.getByText("演示数据").first()).toBeVisible();

    // 空主题：真实空态与「查看全部」
    await page.goto(`${BASE}topics/philosophy/`);
    await expect(page.getByText("「哲学」暂无内容")).toBeVisible();
    await expect(page.getByRole("link", { name: "查看全部" })).toBeVisible();

    // 详情页：标题与独立百度入口
    const first = sortedEntries()[0]!;
    await page.goto(`${BASE}items/${first.id}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
    await expect(page.getByRole("link", { name: /查看百度搜索结果/ })).toBeVisible();
    await context.close();
  });

  test("版式诚实化（T7/ADR 0003）：两档版式与日组头规则结构正确（无 JS 上下文即静态层保证）", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(BASE);

    // 无位置型头条档：条目只有 layout-a/b/compact 三类，不再携带 w1/w2/w3 权重类
    const classes = await page.evaluate(() =>
      [...document.querySelectorAll("[data-entry]")].map((el) => el.className),
    );
    expect(classes.length, "首页应渲染 20 条").toBe(20);
    for (const cls of classes) {
      expect(cls).toMatch(/^k-entry (layout-a|layout-b|layout-compact)$/);
    }

    // 紧凑行（fixtures 无摘要条目）：无版画、无摘要段，保留标题链接与条目行时间（混合分钟分支）
    const compact = page.locator(".k-entry.layout-compact").first();
    await expect(compact.locator(".k-media")).toHaveCount(0);
    await expect(compact.locator(".k-summary")).toHaveCount(0);
    await expect(compact.locator(".k-headline a")).toBeVisible();
    await expect(compact.locator(".k-time time")).toBeVisible();

    // 标准条目保留版画与摘要
    const standard = page.locator(".k-entry.layout-b").first();
    await expect(standard.locator(".k-media-art")).toBeVisible();
    await expect(standard.locator(".k-summary")).toBeVisible();

    // T9 版面减负：版画无竖排主题词与出血大序号，色块时间保留，art 层为纯装饰（aria-hidden）
    await expect(standard.locator(".k-media-art .lab")).toHaveCount(0);
    await expect(standard.locator(".k-media-art .num")).toHaveCount(0);
    await expect(standard.locator(".k-media-art .tag .tm")).toBeVisible();
    await expect(standard.locator(".k-media-art")).toHaveAttribute("aria-hidden", "true");

    // 日组头规则（fixtures 每日分钟互异 → 混合分钟分支）：无批次行，日组头为日期大字
    await expect(page.locator(".k-day-batch")).toHaveCount(0);
    await expect(page.locator(".k-day-big").first()).toBeVisible();

    // T9 空主题 tab 降权：非空置前、空主题置后带 tab-empty 类，入口保留且键盘可达
    const tabState = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ktabs] .tab')].map((el) => ({
        topic: el.getAttribute("data-topic"),
        empty: el.classList.contains("tab-empty"),
      })),
    );
    expect(tabState.map((t) => t.topic)).toEqual([
      "全部", "新闻", "社会", "科技", "文化", "科学",
      "经济", "环境", "健康", "教育", "艺术", "哲学",
    ]);
    expect(tabState.filter((t) => t.empty).map((t) => t.topic)).toEqual([
      "科技", "文化", "科学", "经济", "环境", "健康", "教育", "艺术", "哲学",
    ]);
    const emptyTab = page.locator('[data-ktabs] .tab[data-topic="哲学"]');
    await emptyTab.focus();
    await expect(emptyTab, "空主题 tab 键盘可达（入口可达性不降）").toBeFocused();

    // 详情页版画不渲染序号（单一条目无快照内位置语境），其余版画结构保留
    const first = sortedEntries()[0]!;
    await page.goto(`${BASE}items/${first.id}/`);
    await expect(page.locator(".k-media-art .num")).toHaveCount(0);
    await expect(page.locator(".k-media-art .lab")).toHaveCount(0);
    await context.close();
  });

  test("空主题 tab 降权对比度实测（T9）：降权字色对纸面 ≥4.5:1（WCAG AA 正文阈值，浅色主题）", async ({ page }) => {
    await page.goto(BASE);
    // header 背景为 color-mix(paper 84%, transparent) 叠在纸面上，有效背景 = 纸面
    const measured = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const paper = styles.getPropertyValue("--paper").trim();
      const muted = styles.getPropertyValue("--muted").trim();
      const hexToRgb = (hex: string): [number, number, number] => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      const fgColor = getComputedStyle(
        document.querySelector<HTMLElement>('[data-ktabs] .tab[data-topic="哲学"]')!,
      ).color;
      // Chrome 对 color-mix 结果返回 color(srgb r g b / a)（0–1 分量）；旧引擎返回 rgba(r, g, b, a)
      const srgb = fgColor.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
      const rgba = fgColor.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
      let fg: number[];
      let alpha: number;
      if (srgb) {
        alpha = srgb[4] ? Number(srgb[4]) : 1;
        fg = [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])].map((c) => c * 255);
      } else if (rgba) {
        alpha = rgba[4] ? Number(rgba[4]) : 1;
        fg = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
      } else {
        alpha = 0;
        fg = [0, 0, 0];
      }
      const bg = hexToRgb(paper);
      fg = fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
      const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
      // WCAG 对比度恒以较亮者为分子（浅色主题下纸面更亮）
      const lFg = lum(fg);
      const lBg = lum(bg);
      const ratio = (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
      return { ratio, fgColor, muted, paper };
    });
    expect(measured.muted, "断言前置：tokens 应已解析").not.toBe("");
    expect(
      measured.ratio,
      `空主题 tab 降权色 ${measured.fgColor} 对纸面 ${measured.paper} 的对比度`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("详情页直达：/items/<64hex>/ 可达且内容齐备", async ({ page }) => {
    const first = sortedEntries()[0];
    const response = await page.goto(`${BASE}items/${first.id}/`);
    expect(response?.status(), "详情页应 200").toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
    await expect(
      page.getByRole("link", { name: /查看百度搜索结果/ }),
    ).toHaveAttribute("href", first.url);
    await expect(page.getByRole("link", { name: /返回时间线/ })).toBeVisible();
  });

  test("过期/不存在详情本地 404：状态 404 且提示条目已过期或不存在（不冒充 GitHub Pages 验收）", async ({ page }) => {
    const absent = "0".repeat(64);
    const response = await page.goto(`${BASE}items/${absent}/`);
    expect(response?.status(), "不存在的条目应返回 404").toBe(404);
    await expect(page.getByText("条目已过期或不存在")).toBeVisible();
    await expect(page.getByRole("link", { name: /返回公共时间线/ })).toBeVisible();
  });
});

test.describe("展示字体（T12，#29）：自托管思源宋体 Heavy 子集", () => {
  const FAMILY = "Source Han Serif SC Heavy Subset";

  test("preload 标签存在且指向基路径下子集文件；字体实际加载成功（fonts.check 实测）", async ({ page }) => {
    const fontResponses: Array<{ url: string; status: number }> = [];
    page.on("response", (response) => {
      if (response.url().includes("/fonts/")) {
        fontResponses.push({ url: response.url(), status: response.status() });
      }
    });
    await page.goto(BASE);
    const loaded = await page.evaluate(
      (family) =>
        document.fonts.ready.then(() => document.fonts.check(`700 20px "${family}"`)),
      FAMILY,
    );
    expect(loaded, "子集字体应真实加载并可渲染（swap 后）").toBe(true);
    expect(fontResponses.length, "字体请求应实际发生").toBeGreaterThan(0);
    for (const { url, status } of fontResponses) {
      const path = new URL(url).pathname;
      expect(path, "字体请求应在基路径下（零外链）").toMatch(/^\/overthecocoons\/fonts\//);
      expect(status, "字体请求应 200").toBeLessThan(400);
    }
  });

  test("大字槽位 computed font-family 含子集族名（Hero 标题/站名/日组头/KPageHead），兜底栈仍在", async ({ page }) => {
    await page.goto(BASE);
    const families = await page.evaluate(() => ({
      heroTitle: getComputedStyle(document.querySelector("[data-herotitle]")!).fontFamily,
      brand: getComputedStyle(document.querySelector(".k-brand")!).fontFamily,
      dayBig: getComputedStyle(document.querySelector(".k-day-big")!).fontFamily,
    }));
    for (const [slot, family] of Object.entries(families)) {
      expect(family, `${slot} 应应用 --font-display`).toContain(FAMILY);
      expect(family, `${slot} 应保留 Georgia 兜底`).toContain("Georgia");
    }
    // 主题页大字（KPageHead）同样接入
    await page.goto(`${BASE}topics/news/`);
    const pageHead = await page.evaluate(
      () => getComputedStyle(document.querySelector(".k-pagehead-big")!).fontFamily,
    );
    expect(pageHead, "KPageHead 大字应应用 --font-display").toContain(FAMILY);
  });
});
