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

/**
 * 渲染像素采样（UI 票 #14）：对给定区域截一次图，在页面内用 canvas 读回真实 sRGB。
 * points 为相对区域左上角的坐标（CSS px，内部按截图实际缩放换算）。
 *
 * 为什么走像素而不是读 CSS：光标可见性取决于「渲染后与背景的对比」，而 `mix-blend-mode`
 * 是否真正生效、`border-width` 是否被取整，都只体现在渲染结果上（项目既有教训：对比度必须实测勿目测）。
 * 区域必须完整落在视口内——Playwright 对越界 clip 直接报错，不做静默裁剪。
 */
export async function samplePixels(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  points: Array<[number, number]>,
): Promise<Array<[number, number, number]>> {
  const buf = await page.screenshot({ clip });
  return page.evaluate(
    async ({ b64, points, cssWidth }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const scale = img.width / cssWidth;
      return points.map(([px, py]) => {
        const d = ctx.getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
    },
    { b64: buf.toString("base64"), points, cssWidth: clip.width },
  );
}

/** WCAG 相对亮度对比度（1:1 ~ 21:1）。 */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]): number => {
    const channel = rgb.map((n) => {
      const c = n / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channel[0]! + 0.7152 * channel[1]! + 0.0722 * channel[2]!;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (high! + 0.05) / (low! + 0.05);
}

/** 读取站点设计 token 的当前计算值（如 `--paper`），避免在测试里硬编码配色。 */
export async function designToken(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  );
}

/** 解析 `#RGB` / `#RRGGBB` 为 sRGB 三元组（站点设计 token 均为 hex 字面量）。 */
export function parseHexColor(value: string): [number, number, number] {
  const hex = value.trim().replace(/^#/, "");
  const full = hex.length === 3
    ? hex
        .split("")
        .map((c) => c + c)
        .join("")
    : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** 通道极差（饱和度近似），用于在一组像素里挑出字形芯而非背景。 */
export function channelSpread(rgb: readonly number[]): number {
  return Math.max(...rgb) - Math.min(...rgb);
}

/** 语义标签的当前计算透明度（0 = 未显示）。降级与隐藏路径共用，避免各处重复取值。 */
export async function cursorLabelOpacity(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.querySelector<HTMLElement>("[data-kcursor-label]")!).opacity,
    ),
  );
}

