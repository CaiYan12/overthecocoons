/**
 * 来源多选面板与时间线交集过滤（Issue #34）——真实构建产物的公开页面交互。
 *
 * 数据：fixtures/snapshot-sources.json（确定性多源夹具，56 条 / 六源 / 主题 科技33·社会9·新闻8·文化6），
 * 由 playwright.config.ts 的第二 webServer 注入构建到 .snapshot/sources-dist 并在 4323 提供服务。
 * 期望值一律从夹具推导（不硬编码实时上游条数），断言只用公开 DOM 语义：可访问名称、可见内容、
 * 真实 URL、条目身份、页码、焦点、滚动与渲染中间帧。面板是否打开只认 `dialog.open`，
 * 不读私有状态机字段 `data-source-state`（规格 Testing Decisions）。
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicEntry } from "../../src/domain/contract.ts";
import { sortEntriesDesc } from "../../src/lib/timeline.ts";
import { filterTimeline } from "../../src/lib/source-filter.ts";
import { contrastRatio, designToken, parseHexColor, pickTopic, samplePixels } from "./helpers.ts";
import {
  ALL,
  BASE,
  SOURCES_BASE,
  applySources,
  dialog,
  entryButton,
  entryIds,
  listStructure,
  openPanel,
  panelSettled,
  ready,
  statusText,
  toggle,
} from "./source-filter-helpers.ts";

test.use({ baseURL: SOURCES_BASE });

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "snapshot-sources.json"), "utf-8"),
) as { entries: PublicEntry[] };
const sorted = sortEntriesDesc(snapshot.entries);

test.describe("入口与面板结构", () => {
  test("时间线 HUD 的 SOURCE 标题是入口；打开后为原生模态「选择来源」", async ({ page }) => {
    await ready(page);
    const entry = entryButton(page);
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("aria-haspopup", "dialog");
    await expect(entry).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await openPanel(page);
    await expect(entry).toHaveAttribute("aria-expanded", "true");
    await expect(dialog(page).getByRole("heading", { name: "选择来源" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "关闭 ✕" })).toBeFocused();
    // 内容型 HUD（详情页）不增加筛选入口
    const href = await page.locator(".k-headline a[data-detail]").first().getAttribute("href");
    await page.goto(href!);
    await page.waitForSelector('html[data-oct-client="ready"]');
    await expect(page.locator("[data-source-open]")).toHaveCount(0);
    await expect(page.locator("[data-ksource]")).toHaveCount(0);
  });

  test("六个订阅名称与次序固定，中新网三频道分别可选", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    const labels = dialog(page).locator(".k-source-option .k-source-label");
    await expect(labels).toHaveText(["百度热点", "中新网·社会", "中新网·国际", "中新网·东西问", "极客公园", "Solidot"]);
    const values = await dialog(page).locator(".k-source-input").evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
    expect(values).toEqual([...ALL]);
    // 逐个可独立选择：只勾 Solidot 时其他五项必须为未选
    for (const id of ALL) await toggle(page, id, id === "solidot");
    for (const id of ALL) {
      await expect(page.locator(`.k-source-input[value="${id}"]`)).toBeChecked({ checked: id === "solidot" });
    }
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
  });

  test("全选三态：全选 → 取消一项变部分 → 全取消为未选", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    const all = dialog(page).locator("[data-ksource-all-input]");
    await expect(all).toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
    await toggle(page, "solidot", false);
    await expect(all).not.toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 5 / 6 个订阅源");
    // 规格：部分/未选时点击全选控件 → 勾满六项（不是清空）
    await dialog(page).locator(".k-source-all").click();
    await expect(all).toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 6 / 6 个订阅源");
    // 全选态再点一次 → 取消全部（零项草稿）
    await dialog(page).locator(".k-source-all").click();
    await expect(all).not.toBeChecked();
    expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(false);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("至少选择一个来源");
    for (const id of ALL) {
      await expect(page.locator(`.k-source-input[value="${id}"]`)).not.toBeChecked();
    }
  });

  test("勾号几何居中且不越出方框（防止定位漂移）", async ({ page }, info) => {
    // 实测取值：方框 16×16、勾号 5×9、笔画 1px。用户实测过旧值 left:4px/top:0
    // 使勾号偏左上 1.5px/3.5px 并溢出框外，这里把「旋转中心 = 方框中心」钉死。
    test.skip(Boolean(info.project.use.isMobile), "桌面精细布局下量取，移动端方块尺寸相同但取样精度受 DPR 影响");
    await ready(page);
    await openPanel(page);
    const geometry = await dialog(page)
      .locator(".k-source-option .k-source-box")
      .first()
      .evaluate((box) => {
        const after = getComputedStyle(box, "::after");
        const rect = box.getBoundingClientRect();
        const num = (v: string) => Number.parseFloat(v);
        const w = num(after.width);
        const h = num(after.height);
        return {
          boxW: rect.width,
          boxH: rect.height,
          // 勾号自身中心（未旋转前的布局盒中心）
          markCx: num(after.left) + w / 2,
          markCy: num(after.top) + h / 2,
          boxCx: rect.width / 2,
          boxCy: rect.height / 2,
          markW: w,
          markH: h,
          transformOrigin: after.transformOrigin,
          borderRight: num(after.borderRightWidth),
          borderBottom: num(after.borderBottomWidth),
        };
      });
    // 旋转中心必须落在元素自身中心（transform-origin: center）
    expect(geometry.transformOrigin).toBe(`${geometry.markW / 2}px ${geometry.markH / 2}px`);
    // 勾号中心 = 方框中心（容差 0.5px 以内，覆盖亚像素取整）
    expect(Math.abs(geometry.markCx - geometry.boxCx)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.markCy - geometry.boxCy)).toBeLessThanOrEqual(0.5);
    // 旋转后可达的最大半径仍落在方框内（对角线半径 = sqrt((5/2)^2+(9/2)^2) ≈ 5.15 < 8）
    const radius = Math.hypot(geometry.markW / 2, geometry.markH / 2);
    expect(radius + geometry.borderRight).toBeLessThanOrEqual(geometry.boxW / 2);
    // 笔画为整像素（Blink 会把 1.5px 取整为 1px，声明 1.5px 只会让意图失真）
    expect(geometry.borderRight).toBe(1);
    expect(geometry.borderBottom).toBe(1);
  });
});

test.describe("草稿隔离与取消族", () => {
  test("勾选只改草稿，正文与入口文案不变；取消后重开回到已应用状态", async ({ page }) => {
    await ready(page);
    const before = await entryIds(page);
    await openPanel(page);
    for (const id of ALL) await toggle(page, id, id === "geekpark");
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
    // 正文与入口文案都不被草稿污染
    expect(await entryIds(page)).toEqual(before);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await openPanel(page);
    for (const id of ALL) await expect(page.locator(`.k-source-input[value="${id}"]`)).toBeChecked();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("Esc 与真遮罩点击都丢弃草稿；面板内部点击不取消", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    await toggle(page, "solidot", false);
    // 内部点击（标题）不关闭
    await dialog(page).getByRole("heading", { name: "选择来源" }).click();
    await expect(dialog(page)).toHaveJSProperty("open", true);
    // Esc 取消
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    // 真遮罩点击：dialog 的盒子只有面板那么大（position:fixed; width:min(560px,…); margin:auto），
    // 所以必须点面板盒子之外的视口区域，事件才落在 dialog 自身（= ::backdrop）。
    await openPanel(page);
    await toggle(page, "solidot", false);
    const box = (await dialog(page).locator(".k-source-surface").boundingBox())!;
    expect(box.y, "桌面面板居中，顶部之外存在遮罩区域").toBeGreaterThan(24);
    await page.mouse.click(8, 8);
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("零项草稿：提示至少选择一个并禁用应用", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    await dialog(page).locator(".k-source-all").click();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("至少选择一个来源");
    await expect(dialog(page).locator("[data-ksource-apply]")).toBeDisabled();
    // 重新勾一项后恢复可用
    await toggle(page, "solidot", true);
    await expect(dialog(page).locator("[data-ksource-apply]")).toBeEnabled();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 1 / 6 个订阅源");
  });
});

test.describe("应用与交集过滤", () => {
  test("应用后按来源并集∩主题更新列表、总数、日期目录与播报", async ({ page }) => {
    await ready(page);
    const expected = filterTimeline(sorted, "全部", ["solidot", "geekpark"]);
    await applySources(page, ["solidot", "geekpark"]);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await expect(page.locator("[data-total]")).toHaveText(String(expected.length));
    const shown = await entryIds(page);
    expect(shown).toEqual(expected.slice(0, 20).map((entry) => entry.id));
    expect(shown.length).toBeLessThanOrEqual(20);
    expect(await statusText(page)).toContain("已应用来源筛选");
    expect(await statusText(page)).toContain("第 1 页");
    // 日期目录同步（按交集结果的日组重建）
    const days = [...new Set(expected.slice(0, 20).map((entry) => entry.firstSeenAt.slice(0, 10)))];
    await expect(page.locator("[data-toc] a")).toHaveCount(days.length);
    await expect(page.locator("[data-toc] a").first()).toContainText(`${days[0]} ·`);
  });

  test("单选显示来源名与已选数量；多选/全选显示「多源聚合」", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await expect(page.locator("[data-source-title]")).toHaveText("极客公园");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 1 / 6 个订阅源");
    await applySources(page, ["geekpark", "solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await applySources(page, ALL);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("等价集合重复应用：只关闭，不重排、不重播、不改变阅读位置", async ({ page }) => {
    await ready(page);
    await applySources(page, ["solidot"]);
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
    const before = await entryIds(page);
    const html = await listStructure(page);
    const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
    const statusBefore = await statusText(page);
    await page.evaluate(() => {
      const list = document.querySelector("[data-klist]")!;
      (window as unknown as { listMutations: number }).listMutations = 0;
      new MutationObserver((records) => {
        if (records.some((record) => record.type === "childList")) (window as unknown as { listMutations: number }).listMutations += 1;
      }).observe(list, { childList: true });
    });
    await applySources(page, ["solidot"]);
    expect(await page.evaluate(() => (window as unknown as { listMutations: number }).listMutations)).toBe(0);
    expect(await listStructure(page)).toBe(html);
    expect(await entryIds(page)).toEqual(before);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBefore);
    expect(await statusText(page)).toBe(statusBefore);
  });

  test("来源与主题双向联动：各保留另一维并回第 1 页", async ({ page }) => {
    await ready(page);
    // 先翻到第 2 页（geekpark 30 条 = 2 页）
    await applySources(page, ["geekpark"]);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 2 页");
    // 改来源 → 保留主题（全部）并回第 1 页
    await applySources(page, ["geekpark", "solidot"]);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 1 页");
    // 选主题 → 保留来源（≤767px 的 header Tab 按站点设计隐藏，pickTopic 走 MENU，与真实移动路径一致）
    await pickTopic(page, "科技");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 2 / 6 个订阅源");
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(await page.locator(".k-entry").count()).fill("科技"));
    // 改来源 → 仍保留当前主题（科技），且回到第 1 页
    // Solidot × 科技 = 5 条 = 单页：既有分页口径为单页时隐藏分页器（见 interactions.spec 单页断言），
    // 所以「回第 1 页」在这一步表现为分页器隐藏、条目从第 1 条开始。
    await applySources(page, ["solidot"]);
    await expect(page.locator('[data-ktabs] .tab[data-topic="科技"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator("[data-pager]")).toBeHidden();
    const expected = filterTimeline(sorted, "科技", ["solidot"]);
    expect(await entryIds(page)).toEqual(expected.map((entry) => entry.id));
    await expect(page.locator(".k-entry .tpc")).toHaveText(Array(await page.locator(".k-entry").count()).fill("科技"));
    // 再选回多页组合，确认页码从第 1 页重新开始（不是沿用上一次的第 2 页）
    await applySources(page, ["geekpark"]);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 1 页");
  });

  test("先筛选后分页：交集结果收敛页数，页码跳转越界被拒", async ({ page }) => {
    await ready(page);
    await applySources(page, ["geekpark"]);
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator("[data-total]")).toHaveText("30");
    await expect(page.locator('[data-pager] [aria-label="第 2 页"]')).toBeVisible();
    await expect(page.locator('[data-pager] [aria-label="第 3 页"]')).toHaveCount(0);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(10);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 2 页");
    // 页码跳转越界：input 的 max 由交集页数决定，reportValidity 拒绝
    const jump = page.locator("[data-page-jump] input");
    await expect(jump).toHaveAttribute("max", "2");
    await jump.fill("3");
    await page.locator("[data-page-jump] button[type=submit]").click();
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveAttribute("aria-label", "第 2 页");
  });
});

test.describe("空态两维放宽", () => {
  test("无交集组合显示真实空态；「全部来源」只放宽来源、「全部主题」只放宽主题", async ({ page }) => {
    await ready(page);
    // Solidot × 社会 = 0（夹具中 Solidot 只有科技）
    await applySources(page, ["solidot"]);
    await pickTopic(page, "社会");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator(".k-entry")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "「社会」在已选来源中暂无内容" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全部来源" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全部主题" })).toBeVisible();
    // 只放宽主题：来源仍是 Solidot
    await page.getByRole("button", { name: "全部主题" }).click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator(".k-entry")).toHaveCount(5);
    await expect(page.locator('[data-ktabs] .tab[data-topic="全部"]')).toHaveAttribute("aria-current", "true");

    // 另起一页验证只放宽来源：主题仍是社会
    await ready(page);
    await applySources(page, ["solidot"]);
    await pickTopic(page, "社会");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await page.getByRole("button", { name: "全部来源" }).click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await expect(page.locator('[data-ktabs] .tab[data-topic="社会"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".k-entry")).toHaveCount(9);
    expect(await statusText(page)).toContain("已恢复全部来源");
  });
});

test.describe("键盘与焦点", () => {
  test("Tab 焦点留在 dialog 内，Space 切换，Esc 取消并把焦点还给入口", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    // 焦点在关闭按钮，Tab 逐步走完全部可聚焦元素。
    // 回绕行为因引擎而异（Chromium 实测短暂落到 document.body、WebKit 落到 dialog 自身、
    // Firefox 到最后一个控件后不回绕而停住），三者都不让焦点逃出面板，
    // 因此只断言规格要求的两件事：焦点不得逃到页面内容，且十个可聚焦控件都被覆盖。
    const readFocus = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const dialog = document.querySelector("dialog[data-ksource]");
        const where = active === document.body ? "none" : dialog?.contains(active) ? "in" : "out";
        const key =
          active instanceof HTMLInputElement
            ? `input:${active.value || "all"}`
            : `${active?.tagName.toLowerCase() ?? "?"}.${active?.className ?? ""}`;
        return { key, where };
      });
    const trail: Array<{ key: string; where: string }> = [await readFocus()];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      trail.push(await readFocus());
    }
    const trailText = trail.map((item) => `${item.key}:${item.where}`).join(" | ");
    expect(trail.every((item) => item.where !== "out"), `焦点不得逃到页面内容：${trailText}`).toBe(true);
    // 1 关闭 + 1 全选 + 6 选项 + 取消 + 应用 = 10 个可聚焦控件全部覆盖
    const visited = new Set(trail.filter((item) => item.where === "in").map((item) => item.key));
    expect(visited.size, `Tab 应覆盖面板内全部控件：${trailText}`).toBeGreaterThanOrEqual(10);
    expect(trail.at(-1)!.where).toBe("in");
    // 键盘 Space 切换复选框
    const input = page.locator('.k-source-input[value="solidot"]');
    await input.focus();
    await page.keyboard.press(" ");
    await expect(input).not.toBeChecked();
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 5 / 6 个订阅源");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(entryButton(page)).toBeFocused();
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
  });

  test("桌面：应用后焦点可见且不产生滚动", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    // 桌面右栏在首屏内（布局事实）：应用后不得为「让焦点可见」而滚动页面。
    const before = await page.evaluate(() => {
      const rect = document.querySelector("button[data-source-open]")!.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(before, "1440×900 下入口本应在首屏内").toBe(true);
    await applySources(page, ["solidot"]);
    await expect(entryButton(page)).toBeFocused();
    await expect(entryButton(page)).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY), "入口本已可见时不得滚动").toBe(0);
    // 几何断言：焦点元素完整可见且不被固定 header 遮挡（toBeInViewport 只判交叠比例）
    const geometry = await page.evaluate(() => {
      const rect = document.querySelector("button[data-source-open]")!.getBoundingClientRect();
      const headerBottom =
        document.querySelector<HTMLElement>("header")?.getBoundingClientRect().bottom ?? 0;
      return { top: rect.top, bottom: rect.bottom, headerBottom, viewport: window.innerHeight };
    });
    expect(geometry.top, "焦点元素不被固定 header 遮挡").toBeGreaterThanOrEqual(geometry.headerBottom - 1);
    expect(geometry.bottom, "焦点元素在视口内").toBeLessThanOrEqual(geometry.viewport + 1);
  });

  test("手机：应用后焦点必须可见（允许滚动），且不被 header 遮挡", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await ready(page);
    // 实测 iPhone 13 的 664px 视口：入口 top 692 > innerHeight 664（首屏之外）
    const before = await page.evaluate(() => {
      const rect = document.querySelector("button[data-source-open]")!.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(before, "390×664 下入口本应在首屏之外").toBe(false);
    await applySources(page, ["solidot"]);
    await expect(entryButton(page)).toBeFocused();
    expect(
      await page.evaluate(() => window.scrollY),
      "焦点可见要求把页面滚到入口处（规格明确要求的可访问性结果）",
    ).toBeGreaterThan(0);
    const geometry = await page.evaluate(() => {
      const rect = document.querySelector("button[data-source-open]")!.getBoundingClientRect();
      const headerBottom =
        document.querySelector<HTMLElement>("header")?.getBoundingClientRect().bottom ?? 0;
      return { top: rect.top, bottom: rect.bottom, headerBottom, viewport: window.innerHeight };
    });
    expect(geometry.top, "焦点元素不被固定 header 遮挡").toBeGreaterThanOrEqual(geometry.headerBottom - 1);
    expect(geometry.bottom, "焦点元素在视口内").toBeLessThanOrEqual(geometry.viewport + 1);
  });

  test("取消不改变原滚动位置（打开 → 取消 → scrollY 不变）", async ({ page }) => {
    await ready(page);
    // 用用户手势语义滚动到中部（站点只把用户手势滚动记入阅读位置，不影响本断言）
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
    // 等滚动位置落定再取基准：移动 WebKit 在布局稳定前可能把 600 落到 607（实测），
    // 直接读会得到一个「还没稳」的基准值，从而把正常行为误判为取消改变了位置。
    await expect
      .poll(async () => {
        const a = await page.evaluate(() => Math.round(window.scrollY));
        await page.waitForTimeout(120);
        const b = await page.evaluate(() => Math.round(window.scrollY));
        return a === b ? a : -1;
      })
      .toBeGreaterThan(0);
    const before = await page.evaluate(() => Math.round(window.scrollY));
    await openPanel(page);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(entryButton(page)).toBeFocused();
    expect(await page.evaluate(() => Math.round(window.scrollY)), "取消不得改变滚动位置").toBe(before);
    // Esc 与关闭按钮同理（同一关闭路径）
    await openPanel(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => Math.round(window.scrollY)), "Esc 取消不得改变滚动位置").toBe(before);
  });
});

test.describe("动效、降级与运行环境", () => {
  test("应用时面板先退场再切列表，退场有真实中间帧", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("[data-ksource]")!;
      const surface = dialog.querySelector<HTMLElement>(".k-source-surface")!;
      const list = document.querySelector("[data-klist]")!;
      const record = { frames: [] as Array<{ t: number; opacity: number; y: number; h: number }>, closeStart: 0, listAt: 0 };
      (window as unknown as { applyRecord: typeof record }).applyRecord = record;
      const sample = () => {
        if (dialog.open) {
          const style = getComputedStyle(surface);
          record.frames.push({
            t: performance.now(),
            opacity: Number(style.opacity),
            y: new DOMMatrixReadOnly(style.transform === "none" ? "" : style.transform).m42,
            h: surface.offsetHeight,
          });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      new MutationObserver((records) => {
        if (!record.listAt && records.some((r) => r.type === "childList")) record.listAt = performance.now();
      }).observe(list, { childList: true });
      document.querySelector<HTMLButtonElement>("button[data-source-open]")!.click();
    });
    await expect(dialog(page)).toHaveJSProperty("open", true);
    await expect(dialog(page).locator(".k-source-surface")).toBeVisible();
    // 必须真的改草稿：草稿等价于已应用集合时应用只关闭面板（规格要求的短路），列表本就不该变。
    await toggle(page, "solidot", false);
    await expect(dialog(page).locator("[data-ksource-note]")).toHaveText("已选 5 / 6 个订阅源");
    await page.evaluate(() => {
      const record = (window as unknown as { applyRecord: { closeStart: number } }).applyRecord;
      record.closeStart = performance.now();
      document.querySelector<HTMLButtonElement>("[data-ksource-apply]")!.click();
    });
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-oct-topic-anim"));
    const record = await page.evaluate(() => (window as unknown as { applyRecord: { frames: Array<{ t: number; opacity: number; y: number; h: number }>; closeStart: number; listAt: number } }).applyRecord);
    // 桌面面板淡出 + 下移 12px；手机面板整块上拉/下拉（opacity 恒 1，位移是面板高度）。
    // 因此中间帧按平台取不同属性：桌面看 opacity，手机看位移占面板高度的比例。
    const mobile = await page.evaluate(() => matchMedia("(max-width: 767px)").matches);
    const closing = record.frames.filter((frame) => frame.t >= record.closeStart);
    expect(closing.length, "退场过程有采样帧").toBeGreaterThan(0);
    const middle = mobile
      ? closing.filter((frame) => frame.y > 4 && frame.y < frame.h - 4)
      : closing.filter((frame) => frame.opacity > 0.02 && frame.opacity < 0.98);
    // 中间帧数量下限按平台取：桌面淡出实测 14 帧；headless WebKit 移动配置的 rAF 明显被节流
    // （实测 280ms 内只有 4 次采样），因此要求至少 2 个中间帧，并额外用「中间帧跨越的时长」
    // 与「终点确实移出」证明这是真实逐帧推进，而不是一次跳变。
    expect(middle.length, mobile ? "上拉退场至少 2 个中间帧" : "淡出退场至少 3 个中间帧").toBeGreaterThanOrEqual(mobile ? 2 : 3);
    expect(
      middle.at(-1)!.t - middle[0]!.t,
      "中间帧跨越足够时长（不是单帧跳变）",
    ).toBeGreaterThan(40);
    const ys = closing.map((frame) => frame.y);
    expect(
      ys.every((y, i) => i === 0 || y >= ys[i - 1]! - 0.5),
      mobile ? "手机面板沿原路向下移出" : "桌面关闭沿原路向下轻落",
    ).toBe(true);
    expect(ys.at(-1), "退场终点确实移开（不是停在原位）").toBeGreaterThan(ys[0]! + 4);
    expect(record.listAt, "列表必须在面板退场开始后才变化").toBeGreaterThan(record.closeStart + 120);
  });

  test("减弱动态：无空间位移、无错峰，保留 opacity 轻淡入淡出", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("[data-ksource]")!;
      const surface = dialog.querySelector<HTMLElement>(".k-source-surface")!;
      const options = [...dialog.querySelectorAll<HTMLElement>(".k-source-option")];
      type Frame = { t: number; opacity: number; y: number; options: number[] };
      const frames: Frame[] = [];
      (window as unknown as { reducedFrames: Frame[] }).reducedFrames = frames;
      const sample = () => {
        if (dialog.open) {
          const style = getComputedStyle(surface);
          frames.push({
            t: performance.now(),
            opacity: Number(style.opacity),
            y: new DOMMatrixReadOnly(style.transform === "none" ? "" : style.transform).m42,
            options: options.map((el) => Number(getComputedStyle(el).opacity)),
          });
        }
      };
      // 用 8ms 定时器而非 rAF 采样：headless 移动 WebKit 的 rAF 明显被节流（实测 160ms 淡入
      // 只拿到 1–2 个中间帧），定时器采样才能稳定观察到 0<opacity<1 的中间态。
      // 采到的仍是浏览器真实渲染出的 computed opacity，不是模拟值。
      const timer = setInterval(sample, 8);
      (window as unknown as { stopReducedSample: () => void }).stopReducedSample = () => clearInterval(timer);
      document.querySelector<HTMLButtonElement>("button[data-source-open]")!.click();
    });
    await expect(dialog(page)).toHaveJSProperty("open", true);
    await page.waitForFunction(
      () => (window as unknown as { reducedFrames: unknown[] }).reducedFrames.length >= 8,
    );
    // 采样器持续记录到关闭之后再读，保证淡出也有帧
    const frames = await page.evaluate(
      () => (window as unknown as { reducedFrames: Array<{ t: number; opacity: number; y: number; options: number[] }> }).reducedFrames,
    );
    // (a) 无空间位移：全程 transform 的 Y 位移恒为 0
    expect(frames.every((frame) => Math.abs(frame.y) < 0.5), "无空间位移").toBe(true);
    // (b) 存在 opacity 中间帧：至少 2 帧 0<opacity<1（淡入；淡出另测）
    const fadeIn = frames.filter((frame) => frame.opacity > 0.02 && frame.opacity < 0.98);
    expect(fadeIn.length, "减弱动态仍有 opacity 淡入中间帧").toBeGreaterThanOrEqual(2);
    // (c) 无错峰：各选项 opacity 与面板同时变化（同一帧内相差 < 0.05）
    for (const frame of fadeIn) {
      const spread = Math.max(...frame.options) - Math.min(...frame.options);
      expect(spread, `选项不得错峰（帧 ${Math.round(frame.t)} 极差 ${spread}）`).toBeLessThan(0.05);
    }
    // 淡出同样保留淡入淡出（不是瞬时消失）
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    const closing = await page.evaluate(() => {
      const all = (window as unknown as { reducedFrames: Array<{ opacity: number }> }).reducedFrames;
      (window as unknown as { stopReducedSample: () => void }).stopReducedSample();
      return all.slice(-24);
    });
    expect(closing.filter((frame) => frame.opacity > 0.02 && frame.opacity < 0.98).length, "淡出也有中间帧").toBeGreaterThanOrEqual(1);
    // 取消后滚动锁释放、面板可再次打开
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await applySources(page, ["solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator(".k-entry").first()).toBeVisible();
  });

  test("动效库加载失败：面板仍能开合与应用", async ({ page }) => {
    await page.route("**/vendor/gsap.min.js", (route) => route.abort());
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-oct-motion", "off");
    await applySources(page, ["solidot"]);
    await expect(page.locator("[data-source-title]")).toHaveText("Solidot");
    await expect(page.locator("[data-total]")).toHaveText("05");
    await openPanel(page);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
  });

  test("停钟：关闭仍能收尾并释放滚动锁", async ({ page }) => {
    await ready(page);
    await openPanel(page);
    await page.evaluate(() => {
      (window as unknown as { gsap: { globalTimeline: { pause(): void } } }).gsap.globalTimeline.pause();
      document.querySelector<HTMLButtonElement>("[data-ksource-close]")!.click();
    });
    await expect(dialog(page)).toHaveJSProperty("open", false, { timeout: 3_000 });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    // 停钟下的退出不能留下 GSAP 写入的内联隐藏样式（面板需可再次打开并显示）
    expect(
      await page.locator(".k-source-surface").evaluate((el) => ({
        opacity: getComputedStyle(el).opacity,
        visibility: getComputedStyle(el).visibility,
        transform: el.style.transform,
      })),
    ).toEqual({ opacity: "1", visibility: "visible", transform: "" });
    // 恢复时钟：evaluate 必须是语句形式——gsap 的 resume() 返回 timeline 自身（含循环引用），
    // 作为返回值交给 Playwright 序列化会挂到超时（实测），语句形式立即返回。
    await page.evaluate(() => {
      (window as unknown as { gsap: { globalTimeline: { resume(): void } } }).gsap.globalTimeline.resume();
    });
    // 恢复后仍可正常开合（终态未污染后续交互）
    await openPanel(page);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
  });

  test("快速开关与进入中取消：不误提交草稿、不残留滚动锁", async ({ page }) => {
    await ready(page);
    const entry = entryButton(page);
    await entry.click();
    await page.locator("[data-ksource-close]").click();
    await entry.click();
    await expect(dialog(page)).toHaveJSProperty("open", true);
    await expect(dialog(page).locator(".k-source-surface")).toBeVisible();
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
    await expect(page.locator("[data-total]")).toHaveText("56");
    // 打开 → 勾选 → 立即 pagehide（离开）：丢弃草稿，不误提交
    await openPanel(page);
    await toggle(page, "solidot", false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("滚动锁不改变页面宽度，背景 overflow 在打开期间为 hidden", async ({ page }) => {
    await ready(page);
    const before = await page.evaluate(() => ({
      gutter: window.innerWidth - document.documentElement.clientWidth,
      width: document.querySelector("[data-kmain]")!.getBoundingClientRect().width,
    }));
    await openPanel(page);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    const during = await page.evaluate(() => ({
      gutter: window.innerWidth - document.documentElement.clientWidth,
      width: document.querySelector("[data-kmain]")!.getBoundingClientRect().width,
    }));
    expect(during).toEqual(before);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("深色主题下面板底色与文字对比度实测 ≥4.5:1", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("overthecocoons.theme", "dark"));
    await ready(page);
    await openPanel(page);
    // 像素采样必须在面板入场淡入结束后进行：autoAlpha 中间帧会把纸面底色与标题一起调亮，
    // 实测移动配置在淡入途中采样得到 2.86:1（真实终态是 13.4:1）——这是测量时机问题，不是配色缺陷。
    await expect
      .poll(() =>
        dialog(page).locator(".k-source-surface").evaluate((el) => Number(getComputedStyle(el).opacity)),
        { timeout: 3_000 },
      )
      .toBe(1);
    await panelSettled(page);
    const heading = dialog(page).getByRole("heading", { name: "选择来源" });
    const box = (await heading.boundingBox())!;
    const surfaceBox = (await dialog(page).locator(".k-source-surface").boundingBox())!;
    // 面板底色：取面板内、标题上方的空白区域
    const bgPoint: [number, number] = [surfaceBox.width / 2, Math.max(4, box.y - surfaceBox.y - 8)];
    const [bg] = await samplePixels(page, surfaceBox, [bgPoint]);
    // 字形：在标题框内取样，取与底色对比最强的一格（抗锯齿边缘不会高估对比）
    const points: Array<[number, number]> = [];
    for (let x = 2; x < box.width - 2; x += 3) {
      for (let y = 2; y < box.height - 2; y += 3) points.push([box.x - surfaceBox.x + x, box.y - surfaceBox.y + y]);
    }
    const samples = await samplePixels(page, surfaceBox, points);
    const best = Math.max(...samples.map((pixel) => contrastRatio(pixel, bg!)));
    expect(best, "深色下面板文字对比度").toBeGreaterThanOrEqual(4.5);
    // 选中态不只靠颜色：勾号 + 边框 + 底色同时在
    const checkedBox = await dialog(page).locator(".k-source-option").first().locator(".k-source-box").evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, border: style.borderTopColor, mark: getComputedStyle(el, "::after").transform };
    });
    expect(checkedBox.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(checkedBox.mark).not.toBe("none");
  });

  test("面板与 MENU 互斥：任一打开时另一个入口不响应", async ({ page }) => {
    await ready(page);
    // 面板打开时点 MENU：模态使背景 inert，用户点不到；这里直接派发 click 验证互斥守卫
    await openPanel(page);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-kmenu-open]")!.click());
    await expect(page.locator("dialog[data-kmenu]")).toHaveJSProperty("open", false);
    await expect(dialog(page)).toHaveJSProperty("open", true);
    await page.locator("[data-ksource-cancel]").click();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    // MENU 打开时点来源入口：同样不叠开面板
    await page.locator("[data-kmenu-open]").click();
    await expect(page.locator("dialog[data-kmenu]")).toHaveJSProperty("open", true);
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-source-open]")!.click());
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("dialog[data-kmenu]")).toHaveJSProperty("open", true);
  });
});

test.describe("触屏与无脚本", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("触屏：面板底部上拉、选项点击生效、无残留 hover", async ({ page }) => {
    await ready(page);
    // 触屏上下文：hover 媒体查询不成立，hover 规则整体不生效
    expect(
      await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches),
    ).toBe(false);
    await entryButton(page).tap();
    await expect(dialog(page)).toHaveJSProperty("open", true);
    await panelSettled(page);
    const surface = await dialog(page).locator(".k-source-surface").boundingBox();
    expect(surface!.y + surface!.height, "面板贴底").toBeGreaterThan(700);
    const option = page.locator('.k-source-option:has(.k-source-input[value="solidot"])');
    await option.tap();
    await expect(page.locator('.k-source-input[value="solidot"]')).not.toBeChecked();
    // 触屏无残留 hover：未选中态边框就是 --rule，没有被 hover 的 accent 覆盖。
    // 先等 160ms 选中态过渡结束——否则读到的是过渡中的 accent，而非 hover 残留（实测）。
    await page.waitForTimeout(240);
    const accent = (parseHexColor(await designToken(page, "--accent"))).join(",");
    const rule = (parseHexColor(await designToken(page, "--rule"))).join(",");
    const state = await option.evaluate((el) => ({
      border: getComputedStyle(el).borderTopColor.replace(/\s/g, ""),
      hoverGate: matchMedia("(hover: hover) and (pointer: fine)").matches,
      hoverMatches: el.matches(":hover"),
    }));
    expect(state.hoverGate, "触屏上下文不匹配 hover 门控媒体查询").toBe(false);
    // 注意：触屏点击后 `:hover` 在部分引擎上仍会匹配到被点元素（浏览器实现差异），
    // 因此判据是「hover 规则不生效 → 边框仍是 --rule」，而不是 :hover 为假。
    expect(state.border, "触屏点击后不得留下 hover 态边框").toBe(`rgb(${rule})`);
    expect(state.border).not.toBe(`rgb(${accent})`);
    await page.locator("[data-ksource-apply]").tap();
    await expect(dialog(page)).toHaveJSProperty("open", false);
    await expect(page.locator("[data-source-dim]")).toHaveText("已选 5 / 6 个订阅源");
    // 面板关闭后入口不应处于 :hover 态，且标题颜色不是 hover 的 accent
    expect(await page.evaluate(() => document.querySelector("[data-source-open]")!.matches(":hover"))).toBe(false);
    const titleColor = await page
      .locator("[data-source-open] .k-source-title")
      .evaluate((el) => getComputedStyle(el).color);
    expect(titleColor.replace(/\s/g, "")).not.toBe(`rgb(${accent})`);
  });
});

test.describe("无 JS 降级", () => {
  test("入口是通往来源说明页的真实链接；静态条目/主题/分页可用", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE}`);
      const entry = page.locator("a[data-source-open]");
      await expect(entry).toHaveAttribute("href", `${BASE}sources/`);
      await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
      await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
      // 静态条目与分页可用
      await expect(page.locator(".k-entry")).toHaveCount(20);
      await page.locator('[data-pager] [aria-label="第 2 页"]').click();
      await page.waitForURL(`${BASE}page/2/`);
      await expect(page.locator(".k-entry")).toHaveCount(20);
      // 主题页静态可用
      await page.goto(`${BASE}topics/tech/`);
      await expect(page.locator(".k-entry .tpc").first()).toHaveText("科技");
      // 入口真导航
      await page.goto(`${BASE}`);
      await page.locator("a[data-source-open]").click();
      await page.waitForURL(`${BASE}sources/`);
      await expect(page.getByRole("heading", { name: "百度热点", exact: false }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("筛选初始化失败（数据岛损坏）：入口仍是通往来源页的链接，静态阅读/主题/分页可用", async ({ page }) => {
    // 只破坏数据岛内容：真实构建产物原样返回，其余脚本照常执行
    await page.route(`${SOURCES_BASE}${BASE}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /(<script type="application\/json" data-kdata[^>]*>)[\s\S]*?(<\/script>)/,
        "$1{\"entries\": broken$2",
      );
      await route.fulfill({ response, body });
    });
    await page.goto(`${BASE}`);
    await page.waitForSelector('html[data-oct-client="ready"]');
    // 时间线视图未就绪 → 不得把静态链接替换为按钮（死按钮）
    await expect(page.locator("button[data-source-open]")).toHaveCount(0);
    const entry = page.locator("a[data-source-open]");
    await expect(entry).toHaveAttribute("href", `${BASE}sources/`);
    await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
    // 静态条目、主题、分页仍可用
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await page.locator('[data-pager] [aria-label="第 2 页"]').click();
    await page.waitForURL(`${BASE}page/2/`);
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await page.goto(`${BASE}topics/tech/`);
    await expect(page.locator(".k-entry .tpc").first()).toHaveText("科技");
    // 入口真导航到来源说明页
    await page.goto(`${BASE}`);
    await page.locator("a[data-source-open]").click();
    await page.waitForURL(`${BASE}sources/`);
    await expect(page.getByRole("heading", { name: "百度热点", exact: false }).first()).toBeVisible();
  });
});

test.describe("视口矩阵（320/390/768/1024/1440 × 明暗）", () => {
  const widths = [320, 390, 768, 1024, 1440];
  for (const width of widths) {
    test(`${width}px：无横溢出、面板定位正确、选项 44px、入口文案正确`, async ({ page }) => {
      for (const theme of ["light", "dark"] as const) {
        await page.addInitScript((value) => localStorage.setItem("overthecocoons.theme", value), theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}`);
        await page.waitForSelector('html[data-oct-client="ready"]');
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        // 无横溢出（页面不得出现横向滚动条）
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(overflow.scrollWidth, `${width}px/${theme} 无横溢出`).toBeLessThanOrEqual(
          overflow.innerWidth + 1,
        );
        // 入口文案
        await expect(page.locator("[data-source-title]")).toHaveText("多源聚合");
        await expect(page.locator("[data-source-dim]")).toHaveText("已选 6 / 6 个订阅源");
        await openPanel(page);
        await panelSettled(page);
        const surface = (await dialog(page).locator(".k-source-surface").boundingBox())!;
        const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
        if (width >= 768) {
          // 桌面：居中纸面模态（左右留白近似相等，且不与视口边缘贴合）
          const left = surface.x;
          const right = viewport.w - (surface.x + surface.width);
          expect(Math.abs(left - right), `${width}px 面板水平居中`).toBeLessThanOrEqual(2);
          expect(surface.y, `${width}px 面板垂直居中`).toBeGreaterThan(8);
          expect(surface.y + surface.height, `${width}px 面板不贴底`).toBeLessThan(viewport.h - 8);
        } else {
          // 手机：底部上拉（贴底、满宽）
          expect(Math.abs(surface.y + surface.height - viewport.h), `${width}px 面板贴底`).toBeLessThanOrEqual(1);
          expect(Math.abs(surface.width - viewport.w), `${width}px 面板满宽`).toBeLessThanOrEqual(1);
        }
        // 选项与操作按钮点击高度 ≥44px
        const heights = await dialog(page)
          .locator(".k-source-option, .k-source-all, .k-source-close, .k-source-apply, .k-source-cancel")
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(Math.min(...heights), `${width}px 控件点击高度 ≥44px`).toBeGreaterThanOrEqual(44);
        // 面板内容不得溢出视口
        expect(surface.height, `${width}px 面板不高于视口`).toBeLessThanOrEqual(viewport.h + 1);
        await page.locator("[data-ksource-cancel]").click();
        await expect(dialog(page)).toHaveJSProperty("open", false);
      }
    });
  }
});
