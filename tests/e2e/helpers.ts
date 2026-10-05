/**
 * 跨浏览器 e2e 共享 helpers（2026-10-04 跨引擎矩阵实测后的测试套件修复）。
 *
 * 依据均为实测，不是假设：
 * - mobile WebKit（WebKit + isMobile）不支持 page.mouse.wheel（协议直接报错）→ 降级为
 *   滚动键；站点把 SCROLL_KEYS 按键记为用户手势（src/client/timeline-view.ts bindScrollTracking）。
 * - Firefox 单次 mouse.wheel 实际滚动量与请求量不一致（三次不同 delta 均停在 scrollY=858）
 *   → 滚动目标一律按 DOM 状态迭代收敛，不假设 wheel 量精确。
 * - ≤767px 视口 .k-tabs display:none（站点设计：主题入口在全屏菜单，kinetic.css 媒体查询）
 *   → 主题切换按当前布局自动选入口。
 * - fullPage 截图在超长页面超过 WebKit 32767px 上限 → 超限退化为视口截图（截图仅留档，
 *   破版断言与截图分离）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { PublicEntry } from "../../src/domain/contract.ts";
import { sortEntriesDesc } from "../../src/lib/timeline.ts";

/** 阅读基准线，与 src/client/timeline-view.ts READ_LINE 保持一致。 */
const READ_LINE = 100;

/**
 * 演示快照条目按渲染口径排序（T04/T05 收尾项：直接导入渲染层 sortEntriesDesc，
 * 不在测试里镜像比较器，避免口径漂移）。读 fixtures/snapshot.json。
 */
export function sortedEntries(): PublicEntry[] {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "snapshot.json"), "utf-8"),
  ) as { entries: PublicEntry[] };
  return sortEntriesDesc(snapshot.entries);
}

/** 用户语义滚动 dy 像素：优先滚轮，不支持滚轮的引擎降级为滚动键。 */
export async function wheelBy(page: Page, dy: number): Promise<void> {
  try {
    await page.mouse.wheel(0, dy);
    return;
  } catch {
    const steps = Math.max(1, Math.round(Math.abs(dy) / 400));
    const key = dy >= 0 ? "PageDown" : "PageUp";
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press(key);
    }
  }
}

/**
 * 把指定 data-gi 条目滚到阅读基准线：程序化 instant 滚动精确定位（不依赖引擎 wheel 步长——
 * Firefox 单次 wheel 不精确、WebKit 移动端 keyboard 每步约 531px 会来回振荡），
 * 滚动前先派发一个合成 keydown（站点把 SCROLL_KEYS 按键记为用户输入，合成事件无默认滚动
 * 副作用），使紧随的 scroll 落在站点 200ms 输入采样窗口内，阅读位置记忆得以触发。
 */
export async function wheelEntryToLine(page: Page, gi: number): Promise<void> {
  const box = await page.locator(`[data-gi="${gi}"]`).boundingBox();
  expect(box, `条目 gi=${gi} 应存在`).not.toBeNull();
  const scrollY = await page.evaluate(() => window.scrollY);
  const target = Math.max(0, scrollY + box!.y - (READ_LINE - 4));
  await page.evaluate((top) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    window.scrollTo({ top, behavior: "instant" });
  }, target);
  await page.waitForTimeout(300);
  const final = await page.locator(`[data-gi="${gi}"]`).boundingBox();
  // 列表尾部条目可能滚到底仍到不了读线（底部钳制），此时以滚到底为准
  const atBottom = await page.evaluate(
    () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1,
  );
  expect(
    atBottom || final!.y <= READ_LINE,
    `条目 gi=${gi} 应滚到阅读基准线（或列表已滚到底）`,
  ).toBe(true);
}

/**
 * 切换主题：桌面布局点 header Tab；移动布局（≤767px，header Tab 隐藏）走全屏菜单——
 * 与真实移动用户路径一致（站点设计如此，非绕过断言）。
 */
export async function pickTopic(page: Page, topic: string): Promise<void> {
  const headerTab = page.locator(`[data-ktabs] .tab[data-topic="${topic}"]`);
  if (await headerTab.isVisible()) {
    await headerTab.click();
    return;
  }
  await page.locator("[data-kmenu-open]").click();
  await page.locator(`.k-menu-topics .tab[data-topic="${topic}"]`).click();
  await page.waitForFunction(
    () => {
      const menu = document.querySelector<HTMLDialogElement>("dialog[data-kmenu]");
      return !menu || !menu.open;
    },
    undefined,
    { timeout: 5_000 },
  );
}

/** 整页截图；像素高超过 WebKit 32767 上限（CSS 高 × devicePixelRatio）时退化为视口截图。 */
export async function safeScreenshot(page: Page, path: string): Promise<void> {
  const { height, dpr } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    dpr: window.devicePixelRatio,
  }));
  await page.screenshot({ path, fullPage: height * dpr <= 32767 });
}
