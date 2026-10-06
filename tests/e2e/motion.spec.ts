/**
 * Ticket 06 动效层真浏览器测试：GSAP 加载与 Hero Intro、筛选不重播、Header Morph、
 * 时间线进度线/节点激活/分层揭示（方向交替与顺序）、两段式主题切换、View Transition 主题切换
 * （含 ready 超时 skipTransition 兜底与颜色过渡降级）、光标/磁性/tilt（pointer:fine）、
 * reduced-motion 与 GSAP CDN 失败的整体退化、ScrollTrigger 泄漏、截图矩阵。
 *
 * 行为基准：docs/design/prototype-timeline.html 的 v-kinetic 变体（动效参数逐项对齐）。
 * 降级契约：内容直显、无隐藏初态、功能完整（与 Ticket 05 渐进增强一致）。
 */
import { expect, test, type Page } from "@playwright/test";
import {
  channelSpread,
  contrastRatio,
  cursorLabelOpacity,
  designToken,
  parseHexColor,
  pickTopic,
  safeScreenshot,
  samplePixels,
  wheelBy,
} from "./helpers.ts";

const BASE = "/overthecocoons/";
const RING_LENGTH = 163.4;

async function waitClientReady(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-client="ready"]');
}

async function waitMotionOn(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-motion="on"]');
}

/** Hero intro 完成（GSAP 时间线 onComplete 打标记；无动效路径立即打标记）。 */
async function waitIntroDone(page: Page): Promise<void> {
  await page.waitForSelector('html[data-oct-intro="done"]', { timeout: 10_000 });
}

/** 滚过 84px 阈值并等待 Header Morph 滑入（动效模式下 header 首屏隐藏）。 */
async function showHeader(page: Page): Promise<void> {
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

/** 等待两段式主题切换动画结束（html[data-oct-topic-anim] 移除）。 */
async function waitTopicAnimDone(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !document.documentElement.hasAttribute("data-oct-topic-anim"),
    undefined,
    { timeout: 5_000 },
  );
}

/** 等待全屏菜单关闭动画结束（关闭走 GSAP 时间线后 dialog.close()）。 */
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

/** 从 clip-path 字符串提取数值并按 CSS inset 简写语义补齐为 [top, right, bottom, left]。 */
function clipNumbers(value: string): number[] {
  const nums = (value.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (nums.length === 3) return [nums[0]!, nums[1]!, nums[2]!, nums[1]!];
  if (nums.length === 2) return [nums[0]!, nums[1]!, nums[0]!, nums[1]!];
  if (nums.length === 1) return [nums[0]!, nums[0]!, nums[0]!, nums[0]!];
  return nums;
}

test.describe("GSAP 动效层（Hero Intro / Header Morph / 全局进度）", () => {
  test("intro：字符拆分隐藏初态 → 终态可见，ghost 英文回到设计透明度", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // intro 在模块初始化时即开始播放：document_start 起每帧优先采样（本采样器的 rAF
    // 总先于 GSAP ticker 同帧回调入队），记录拆分后未被补间改写的隐藏初态
    await page.addInitScript(() => {
      const w = window as unknown as {
        __octIntroInit?: { ch: number; mask: number; count: number };
      };
      const tick = () => {
        if (!w.__octIntroInit) {
          const ch = document.querySelector<HTMLElement>("[data-herotitle] .ch");
          const kw = ch?.parentElement;
          if (ch && kw) {
            w.__octIntroInit = {
              ch: ch.getBoundingClientRect().top,
              mask: kw.getBoundingClientRect().bottom,
              count: document.querySelectorAll("[data-herotitle] .ch").length,
            };
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 隐藏初态：标题字符已拆分并压在 overflow 遮罩之下（初帧采样，免受加载速度影响）
    await page.waitForFunction(
      () => (window as unknown as { __octIntroInit?: unknown }).__octIntroInit !== undefined,
      undefined,
      { timeout: 10_000 },
    );
    const initialState = await page.evaluate(
      () => (window as unknown as { __octIntroInit: { ch: number; mask: number; count: number } })
        .__octIntroInit,
    );
    expect(initialState.count, "标题已拆分为字符 span").toBeGreaterThan(0);
    expect(initialState.ch, "初态：字符应被压在遮罩下（yPercent 110）").toBeGreaterThanOrEqual(
      initialState.mask - 2,
    );

    await waitIntroDone(page);
    const finalState = await page.evaluate(() => {
      const heroEn = document.querySelector<HTMLElement>("[data-heroen]");
      const ch = document.querySelector<HTMLElement>("[data-herotitle] .ch");
      const kw = ch?.parentElement;
      const rule = document.querySelector<HTMLElement>("[data-herorule]");
      return {
        heroEnOpacity: heroEn ? Number.parseFloat(getComputedStyle(heroEn).opacity) : -1,
        chTop: ch && kw ? ch.getBoundingClientRect().top : -1,
        maskBottom: ch && kw ? kw.getBoundingClientRect().bottom : -1,
        ruleTransform: rule ? getComputedStyle(rule).transform : "",
      };
    });
    expect(finalState.heroEnOpacity, "ghost 英文回到 --ghost-a 设计透明度").toBeCloseTo(0.05, 1);
    expect(finalState.chTop, "终态：字符升入遮罩内（可见）").toBeLessThan(finalState.maskBottom);
    expect(finalState.ruleTransform, "尺规线 scaleX 展开").not.toBe("matrix(0, 0, 0, 0, 0, 0)");
  });

  test("筛选不重播：切主题后 intro 不再初始化（字符节点不重建、ghost 透明度不变）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await waitIntroDone(page);
    await showHeader(page);

    // 在字符节点上打探针：若 intro 重播会重新拆分（节点重建），探针即丢失
    await page.evaluate(() => {
      const ch = document.querySelector<HTMLElement>("[data-herotitle] .ch");
      if (ch) (ch as unknown as { octProbe?: boolean }).octProbe = true;
    });
    await pickTopic(page, "新闻");
    await expect(page.locator(".k-entry .tpc").first()).toHaveText("新闻");
    await expect(page.locator("[data-total]")).toHaveText("23");
    await waitTopicAnimDone(page);

    const probe = await page.evaluate(() => {
      const ch = document.querySelector<HTMLElement>("[data-herotitle] .ch");
      const heroEn = document.querySelector<HTMLElement>("[data-heroen]");
      return {
        probe: ch ? Boolean((ch as unknown as { octProbe?: boolean }).octProbe) : false,
        heroEnOpacity: heroEn ? Number.parseFloat(getComputedStyle(heroEn).opacity) : -1,
        introDone: document.documentElement.hasAttribute("data-oct-intro"),
      };
    });
    expect(probe.probe, "字符节点未重建（intro 未重播）").toBe(true);
    expect(probe.heroEnOpacity, "ghost 透明度保持终态").toBeCloseTo(0.05, 1);
    expect(probe.introDone, "intro 完成标记保持").toBe(true);
  });

  test("Header Morph：首屏隐藏，滚动 84px 后滑入，回顶后滑出", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    const headerY = () =>
      page.evaluate(() => {
        const header = document.querySelector("[data-kheader]");
        if (!header) return 0;
        const transform = getComputedStyle(header).transform;
        return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      });

    expect(await headerY(), "首屏 header 应隐藏（yPercent -100）").toBeLessThan(-60);

    await page.mouse.move(200, 300);
    await wheelBy(page, 300);
    await page.waitForFunction(() => {
      const header = document.querySelector("[data-kheader]");
      if (!header) return false;
      const transform = getComputedStyle(header).transform;
      return transform !== "none" && new DOMMatrixReadOnly(transform).m42 > -5;
    });
    expect(await headerY(), "滚动后 header 滑入").toBeGreaterThan(-5);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => {
      const header = document.querySelector("[data-kheader]");
      if (!header) return false;
      const transform = getComputedStyle(header).transform;
      return transform !== "none" && new DOMMatrixReadOnly(transform).m42 < -60;
    });
    expect(await headerY(), "回顶后 header 滑出").toBeLessThan(-60);
  });

  test("全局进度：readbar scaleX、HUD 百分比大数字与圆环 stroke-dashoffset 随滚动更新", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    expect(await page.locator("[data-readpct]").textContent()).toBe("0%");
    await page.mouse.move(200, 300);
    await wheelBy(page, 2000);
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent !== "0%",
      undefined,
      { timeout: 5_000 },
    );
    const mid = await page.evaluate(() => {
      const readbarTransform = getComputedStyle(document.querySelector("[data-readbar]")!).transform;
      return {
        pct: document.querySelector("[data-readpct]")?.textContent ?? "",
        // T06 收尾项：readbar scaleX 应大于 0——在页面内解析 matrix 首值（a），
        // 原「not.toContain 零矩阵字符串」恒真（该序列化形态不会出现），断言无鉴别力。
        readbarScaleX: readbarTransform === "none" ? 0 : new DOMMatrixReadOnly(readbarTransform).a,
        ring: document.querySelector<SVGCircleElement>("[data-ring]")?.style.strokeDashoffset ?? "",
      };
    });
    expect(mid.pct).toMatch(/^[1-9]\d%$|^100%$/);
    expect(mid.readbarScaleX, "readbar scaleX 应大于 0").toBeGreaterThan(0);
    // Firefox 序列化带单位（"141.196px"）、Chromium 不带，须用 parseFloat 而非 Number
    expect(parseFloat(mid.ring), "圆环 dashoffset 应小于满值").toBeLessThan(RING_LENGTH);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent === "100%",
      undefined,
      { timeout: 5_000 },
    );
  });
});

test.describe("非 Hero 页 header 常显（UI 票 #20）", () => {
  /**
   * 缺陷基准（2026-10-06 实测）：initHeroAndHeader 的初始隐藏语句位于「无 Hero 提前返回」
   * 之前，全部页面首屏 header 都被 yPercent -100 藏起（桌面 -68px / 移动 -60px，bottom=0）。
   * 修复口径：初始隐藏与滚动显隐分支仅作用于存在 Hero 的页面；非 Hero 页 header 常显，
   * 且 scrollY 0–84 区间（含滚过 84 后回落）不得消失。Hero 页行为不变（既有 84px 阈值）。
   * 路径基准为 P0 审计的 6 路径；其中「/」是 Hero 页，按票面验收第 2 条断言行为不变，
   * 不适用「bottom>0」判据（首屏隐藏本就是 Hero 页设计行为，既有 Header Morph 用例在守）。
   */
  const NON_HERO_PATHS = ["about/", "sources/", "principles/", "privacy/", "nope-404/"];
  const VIEWPORTS = [
    { label: "桌面 1440×900", width: 1440, height: 900 },
    { label: "移动 390×844", width: 390, height: 844 },
  ] as const;

  /** header 首屏状态：可见高度（bottom）与品牌链接命中测试是否落在 header 内（交互可达）。 */
  async function headerFirstScreenState(page: Page): Promise<{ bottom: number; reachable: boolean }> {
    return page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("[data-kheader]");
      if (!header) return { bottom: -1, reachable: false };
      const brand = header.querySelector<HTMLElement>(".k-brand");
      const box = brand?.getBoundingClientRect();
      const hit = box
        ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        : null;
      return {
        bottom: header.getBoundingClientRect().bottom,
        reachable: hit !== null && hit.closest("[data-kheader]") === header,
      };
    });
  }

  for (const vp of VIEWPORTS) {
    test(`非 Hero 页首屏 header 可见且可交互（5 路径 × ${vp.label}）`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const path of NON_HERO_PATHS) {
        await page.goto(`${BASE}${path}`);
        await waitClientReady(page);
        await waitMotionOn(page);
        const state = await headerFirstScreenState(page);
        expect(
          state.bottom,
          `${path}：scrollY=0 时 header 应有可见高度（实测缺陷：bottom=0 完全位于视口上方）`,
        ).toBeGreaterThan(0);
        expect(
          state.reachable,
          `${path}：header 品牌链接应可交互命中（不被遮挡、不悬空于视口外）`,
        ).toBe(true);
      }
    });
  }

  for (const vp of VIEWPORTS) {
    test(`非 Hero 页 0–84px 区间 header 不消失：滚入区间与滚过 84 回落均保持可见（${vp.label}）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}about/`);
      await waitClientReady(page);
      await waitMotionOn(page);
      // morph 补间 0.4s：每次滚动后等足补间窗口再断言——若实现错误触发滑出，此刻应已落定
      await page.evaluate(() => window.scrollTo({ top: 40, behavior: "instant" }));
      await page.waitForTimeout(600);
      expect(
        (await headerFirstScreenState(page)).bottom,
        "40px（0–84 区间内）header 不应消失",
      ).toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo({ top: 40, behavior: "instant" }));
      await page.waitForTimeout(600);
      expect(
        (await headerFirstScreenState(page)).bottom,
        "滚过 84 回落 40px 后 header 不应消失（headerShown 不得误触发滑出）",
      ).toBeGreaterThan(0);
    });
  }

  test("Hero 页行为不变：首屏隐藏、滚过 84 滑入（/ × 2 视口，含移动端口径）", async ({ page }) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE);
      await waitClientReady(page);
      await waitMotionOn(page);
      const headerM42 = () =>
        page.evaluate(() => {
          const header = document.querySelector("[data-kheader]");
          if (!header) return 0;
          const transform = getComputedStyle(header).transform;
          return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
        });
      expect(
        await headerM42(),
        // 位移恰好为负的 header 高度（桌面 68 / 移动 60）：完全隐藏时 m42 ≤ -60；
        // 半隐藏态（如 -30）不会满足，判据仍有鉴别力
        `${vp.label}：Hero 页首屏 header 应保持隐藏（既有设计行为）`,
      ).toBeLessThanOrEqual(-60);
      await page.mouse.move(200, 300);
      await wheelBy(page, 300);
      await page.waitForFunction(
        () => {
          const header = document.querySelector("[data-kheader]");
          if (!header) return false;
          const transform = getComputedStyle(header).transform;
          return transform !== "none" && new DOMMatrixReadOnly(transform).m42 > -5;
        },
        undefined,
        { timeout: 15_000 },
      );
      expect(await headerM42(), `${vp.label}：滚过 84px 后 header 滑入`).toBeGreaterThan(-5);
    }
  });
});

test.describe("时间线动效（进度线 / 节点激活 / 分层揭示）", () => {
  test("隐藏初态：摘要 clip、元信息透明、占位图按版面左/右/上方向交替 clip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 不滚动：首屏以下条目应处于隐藏初态（ScrollTrigger once 未触发）
    const states = await page.evaluate(() => {
      const read = (entry: Element) => {
        const sum = entry.querySelector<HTMLElement>(".k-summary");
        const meta = entry.querySelector<HTMLElement>(".k-meta");
        const media = entry.querySelector<HTMLElement>(".k-media");
        const art = entry.querySelector<HTMLElement>(".k-media-art");
        return {
          summaryClip: sum ? sum.style.clipPath : "(missing)",
          metaOpacity: meta ? meta.style.opacity : "(missing)",
          mediaClip: media ? media.style.clipPath : "(missing)",
          artScale: art ? getComputedStyle(art).transform : "(missing)",
        };
      };
      return {
        a: read(document.querySelector(".k-entry.layout-a")!),
        b: read(document.querySelector(".k-entry.layout-b")!),
        c: read(document.querySelectorAll(".k-entry.layout-c")[1]!),
      };
    });
    expect(clipNumbers(states.a.summaryClip), "摘要自上 clip 遮蔽").toEqual([0, 0, 100, 0]);
    expect(states.a.metaOpacity, "元信息隐藏").toBe("0");
    expect(clipNumbers(states.a.mediaClip), "layout-a：图自左揭示（right 100%）").toEqual([
      0, 100, 0, 0,
    ]);
    expect(clipNumbers(states.b.mediaClip), "layout-b：图自右揭示（left 100%）").toEqual([
      0, 0, 0, 100,
    ]);
    // 原型 layout-c 的 from 态是 inset(0 0 100% 0)：bottom 内缩 100%，揭示时底边自顶向下展开（上入）
    expect(clipNumbers(states.c.mediaClip), "layout-c：图自上揭示（bottom 100% 遮蔽）").toEqual([
      0, 0, 100, 0,
    ]);
    for (const state of [states.a, states.b, states.c]) {
      expect(clipNumbers(state.artScale).slice(0, 1)[0], "art 层初态 scale 1.08").toBeCloseTo(
        1.08,
        2,
      );
    }
  });

  test("分层揭示顺序：标题字符先动 → 摘要 clip 释放 → 元信息出现", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 选一个折叠状态且带摘要的条目，安装 rAF 采样器后滚动触发揭示
    await page.evaluate(() => {
      const w = window as unknown as {
        __octReveal?: { ch: number; sum: number; meta: number };
        __octTicks?: number[];
      };
      const entries = [...document.querySelectorAll<HTMLElement>(".k-entry")];
      const entry = entries.find(
        (el) => Number(el.dataset.gi) >= 1 && el.querySelector(".k-summary"),
      );
      if (!entry) throw new Error("找不到带摘要的折叠条目");
      const kw = entry.querySelector<HTMLElement>(".kw");
      const ch = entry.querySelector<HTMLElement>(".ch");
      const sum = entry.querySelector<HTMLElement>(".k-summary");
      const meta = entry.querySelector<HTMLElement>(".k-meta");
      const mark = { ch: -1, sum: -1, meta: -1 };
      const ticks: number[] = [];
      w.__octTicks = ticks;
      const t0 = performance.now();
      const tick = () => {
        ticks.push(performance.now() - t0);
        if (
          mark.ch < 0 &&
          ch &&
          kw &&
          ch.getBoundingClientRect().top < kw.getBoundingClientRect().bottom - 1
        ) {
          mark.ch = performance.now() - t0;
        }
        if (mark.sum < 0 && sum && !getComputedStyle(sum).clipPath.includes("100%")) {
          mark.sum = performance.now() - t0;
        }
        if (mark.meta < 0 && meta && Number.parseFloat(getComputedStyle(meta).opacity) > 0) {
          mark.meta = performance.now() - t0;
        }
        if ((mark.ch >= 0 && mark.sum >= 0 && mark.meta >= 0) || performance.now() - t0 > 4000) {
          w.__octReveal = mark;
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
      (window as unknown as { __octRevealTarget?: HTMLElement }).__octRevealTarget = entry;
    });

    await page.mouse.move(200, 300);
    // 按目标条目实际位置迭代滚进触发区（分层揭示 start: "top 85%"）：单次 wheel 的实际滚动量
    // 因引擎而异（Firefox 实测 900 只滚到 858，条目未进触发区），且须在探针 4s 窗口内触发
    for (let i = 0; i < 8; i++) {
      const state = await page.evaluate(() => {
        const w = window as unknown as { __octReveal?: unknown; __octRevealTarget?: HTMLElement };
        return {
          revealed: w.__octReveal !== undefined,
          top: w.__octRevealTarget?.getBoundingClientRect().top ?? 0,
          inner: window.innerHeight,
        };
      });
      if (state.revealed || state.top <= state.inner * 0.5) break;
      await wheelBy(page, Math.min(Math.max(state.top - state.inner * 0.4, 300), 2400));
      await page.waitForTimeout(120);
    }
    await page.waitForFunction(
      () => (window as unknown as { __octReveal?: unknown }).__octReveal !== undefined,
      undefined,
      { timeout: 8_000 },
    );
    const mark = await page.evaluate(
      () => (window as unknown as { __octReveal: { ch: number; sum: number; meta: number } }).__octReveal,
    );
    expect(mark.ch, "标题字符开始升起").toBeGreaterThanOrEqual(0);
    expect(mark.sum, "摘要 clip 开始释放").toBeGreaterThanOrEqual(0);
    expect(mark.meta, "元信息开始显现").toBeGreaterThanOrEqual(0);
    // 设计错峰为 ch→+80ms→sum→+60ms→meta（motion.ts 时间线 0/0.08/0.14）。mobile WebKit 在
    // dSF3×1440 下 rAF 实测仅 ~7.8fps（帧间隔 >80ms），同帧吞掉错峰导致采样等值：帧间隔
    // 足够细时断言严格先后，粗帧时仅断言顺序不倒置（同时序下 sum 恒不早于 ch、meta 恒不早于 sum）
    const ticks = (await page.evaluate(() => (window as unknown as { __octTicks?: number[] }).__octTicks ?? [])) as number[];
    const deltas = ticks.slice(1).map((t, i) => t - ticks[i]!).filter((d) => d > 0).sort((a, b) => a - b);
    const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)]! : 0;
    const resolvable = medianDelta > 0 && medianDelta <= 70;
    if (resolvable) {
      expect(mark.sum, "摘要晚于标题字符").toBeGreaterThan(mark.ch);
      expect(mark.meta, "元信息晚于摘要").toBeGreaterThan(mark.sum);
    } else {
      expect(mark.sum, "摘要不早于标题字符（粗帧引擎）").toBeGreaterThanOrEqual(mark.ch);
      expect(mark.meta, "元信息不早于摘要（粗帧引擎）").toBeGreaterThanOrEqual(mark.sum);
    }

    // 媒体揭示补间（900ms power4.out）持续到 meta 出现之后：等待 clip 与 art 补间落到终态再断言
    await page.waitForFunction(
      () => {
        const entry = (window as unknown as { __octRevealTarget?: HTMLElement }).__octRevealTarget;
        const clip = entry?.querySelector<HTMLElement>(".k-media")?.style.clipPath ?? "";
        const nums = (clip.match(/-?\d*\.?\d+/g) ?? []).map(Number);
        if (!(nums.length === 4 && nums.every((n) => n === 0))) return false;
        const art = entry?.querySelector<HTMLElement>(".k-media-art");
        if (!art) return true;
        const m = new DOMMatrixReadOnly(getComputedStyle(art).transform);
        return Math.abs(m.a - 1) < 0.005 && Math.abs(m.d - 1) < 0.005;
      },
      undefined,
      { timeout: 8_000 },
    );
    // 终态：媒体 clip 完全释放、art 回到 scale 1
    const final = await page.evaluate(() => {
      const entry = (window as unknown as { __octRevealTarget?: HTMLElement }).__octRevealTarget;
      const media = entry?.querySelector<HTMLElement>(".k-media");
      const art = entry?.querySelector<HTMLElement>(".k-media-art");
      return {
        mediaClip: media ? media.style.clipPath : "",
        artScale: art ? getComputedStyle(art).transform : "",
      };
    });
    expect(clipNumbers(final.mediaClip), "媒体 clip 揭完（900ms power4.out 终态）").toEqual([
      0, 0, 0, 0,
    ]);
    expect(clipNumbers(final.artScale)[0], "art 回到 scale 1").toBeCloseTo(1, 2);
  });

  test("进度线生长与节点仅当前激活：滚动后 scaleY>0、激活节点存在且 HUD 序号跟随", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    await page.mouse.move(200, 300);
    await wheelBy(page, 1600);
    await page.waitForFunction(
      () => document.querySelector(".k-entry.is-active") !== null,
      undefined,
      { timeout: 5_000 },
    );
    // HUD 序号经 yPercent 滚动补间后才改写文本（0.22s）：轮询到与当前激活条目一致
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const active = [...document.querySelectorAll<HTMLElement>(".k-entry.is-active")].map(
              (el) => String(Number(el.dataset.gi) + 1).padStart(2, "0"),
            );
            return {
              active,
              roll: document.querySelector("[data-rollin]")?.textContent ?? "",
              synced: active.includes(document.querySelector("[data-rollin]")?.textContent ?? ""),
            };
          }),
        { timeout: 5_000 },
      )
      .toMatchObject({ synced: true });
    const state = await page.evaluate(() => {
      const progress = [...document.querySelectorAll<HTMLElement>(".k-progress")].find((el) => {
        const transform = getComputedStyle(el).transform;
        return transform !== "none" && new DOMMatrixReadOnly(transform).m22 > 0.01;
      });
      const active = [...document.querySelectorAll<HTMLElement>(".k-entry.is-active")].map(
        (el) => Number(el.dataset.gi),
      );
      const roll = document.querySelector("[data-rollin]")?.textContent ?? "";
      return {
        progressGrown: progress !== undefined,
        active,
        roll,
      };
    });
    expect(state.progressGrown, "进度线 scaleY scrub 生长").toBe(true);
    expect(state.active.length, "存在当前激活节点").toBeGreaterThanOrEqual(1);
    expect(
      state.active.map((gi) => String(gi + 1).padStart(2, "0")),
      "HUD NOW READING 序号应为激活条目之一",
    ).toContain(state.roll);
  });
});

test.describe("两段式主题切换（出 260ms / 入 340ms，日期组头先行）", () => {
  test("切主题经历 out→in 两段动画并留下揭示痕迹，终态内容正确", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await showHeader(page);

    // 记录点击时刻与列表首次 DOM 替换时刻：渲染必须发生在 out 段（260ms）之后
    await page.evaluate(() => {
      const w = window as unknown as { __octClickAt?: number; __octListMut?: number };
      const list = document.querySelector("[data-klist]");
      new MutationObserver(() => {
        if (w.__octListMut === undefined) w.__octListMut = performance.now();
      }).observe(list!, { childList: true });
      w.__octClickAt = performance.now();
    });

    await pickTopic(page, "新闻");
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.hasAttribute("data-oct-topic-anim")),
        { timeout: 2_000 },
      )
      .toBe(true);
    await waitTopicAnimDone(page);

    const times = await page.evaluate(() => {
      const w = window as unknown as { __octClickAt?: number; __octListMut?: number };
      return { click: w.__octClickAt ?? -1, mut: w.__octListMut ?? -1 };
    });
    expect(times.click, "点击时刻已记录").toBeGreaterThanOrEqual(0);
    expect(times.mut - times.click, "列表渲染晚于 out 段开始（≥200ms，原型 out 260ms）").toBeGreaterThan(
      200,
    );

    await expect(page.locator(".k-entry .tpc").first()).toHaveText("新闻");
    await expect(page.locator("[data-total]")).toHaveText("23");
    // 日期组头先行补间（delay .05 + .45s）晚于列表入段（.34s）结束：轮询到落定再断言痕迹
    await expect
      .poll(
        () => page.evaluate(() => document.querySelector<HTMLElement>(".k-day-big")?.style.opacity ?? ""),
        { timeout: 3_000 },
      )
      .toBe("1");
    const residue = await page.evaluate(() => {
      const dayBig = document.querySelector<HTMLElement>(".k-day-big");
      return { transform: dayBig?.style.transform ?? "", opacity: dayBig?.style.opacity ?? "" };
    });
    expect(residue.transform, "日期组头经过 y:26→0 揭示（动效渲染痕迹）").not.toBe("");
    expect(residue.opacity, "日期组头经过 autoAlpha 揭示").toBe("1");
  });
});

test.describe("显示模式切换（View Transition 径向 + 兜底）", () => {
  test("正常路径：data-vt 短暂存在后移除，ghost 透明度随场景重同步", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    // 等 intro 完成再切模式：intro 的 autoAlpha 补间（终值 0.05）若仍在运行，
    // 会按补间捕获的终值覆盖 syncHeroGhost 的深色值——与原型一致的亚秒级边缘，不属本票行为
    await waitIntroDone(page);
    await showHeader(page);

    await page.locator("[data-mode]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"), undefined, {
      timeout: 3_000,
    });
    const ghost = await page.evaluate(
      () =>
        Number.parseFloat(
          getComputedStyle(document.querySelector<HTMLElement>("[data-heroen]")!).opacity,
        ),
    );
    expect(ghost, "深色场景 ghost 强度 0.1（token 重同步）").toBeCloseTo(0.1, 1);
  });

  test("ready 超时兜底：startViewTransition 的 ready 永不 resolve 时强制 skipTransition", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await showHeader(page);

    await page.evaluate(() => {
      const doc = document as unknown as {
        startViewTransition?: (cb: () => void) => {
          ready: Promise<void>;
          finished: Promise<void>;
          skipTransition(): void;
        };
      };
      // 模拟真实「卡死」场景：ready 永不 resolve 且 finished 也悬挂（原型兜底针对的异常）
      doc.startViewTransition = (cb: () => void) => {
        cb();
        (window as unknown as { __octVtStubbed?: boolean }).__octVtStubbed = true;
        return {
          ready: new Promise<void>(() => {}),
          finished: new Promise<void>(() => {}),
          skipTransition() {
            (window as unknown as { __octVtSkipped?: boolean }).__octVtSkipped = true;
          },
        };
      };
    });

    await page.locator("[data-mode]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 3_000 });
    expect(
      await page.evaluate(() => (window as unknown as { __octVtStubbed?: boolean }).__octVtStubbed),
      "stubbed startViewTransition 被调用",
    ).toBe(true);
    // 兜底定时器 250ms 后触发：轮询 skipTransition 调用标记
    await expect
      .poll(
        () => page.evaluate(() => (window as unknown as { __octVtSkipped?: boolean }).__octVtSkipped),
        { timeout: 3_000 },
      )
      .toBe(true);
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-vt"), undefined, {
      timeout: 3_000,
    });
  });

  test("无 View Transition API：降级为 k-themefade 颜色过渡", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await showHeader(page);

    await page.evaluate(() => {
      (document as unknown as { startViewTransition?: unknown }).startViewTransition = undefined;
    });
    await page.locator("[data-mode]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const faded = await page.evaluate(() =>
      document.querySelector<HTMLElement>("[data-kinetic]")!.classList.contains("k-themefade"),
    );
    expect(faded, "颜色过渡降级类短暂生效").toBe(true);
    await page.waitForFunction(
      () => !document.querySelector("[data-kinetic]")!.classList.contains("k-themefade"),
      undefined,
      { timeout: 3_000 },
    );
  });
});

test.describe("全屏菜单动效", () => {
  test("打开：整体 opacity 渐入 + 条目 stagger 痕迹；关闭：动画后 dialog 关闭且焦点返回", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await showHeader(page);

    const openBtn = page.locator("[data-kmenu-open]");
    await openBtn.click();
    await expect(page.locator("[data-kmenu]")).toHaveJSProperty("open", true);
    await page.waitForFunction(() => {
      const menu = document.querySelector<HTMLElement>("dialog[data-kmenu]");
      return menu !== null && Number.parseFloat(getComputedStyle(menu).opacity) > 0.99;
    });
    const staggered = await page.evaluate(() => {
      const item = document.querySelector<HTMLElement>("[data-kmenu] .k-mi");
      return item?.style.transform ?? "";
    });
    expect(staggered, "菜单条目经过 y/rotate stagger（动效痕迹）").not.toBe("");

    await page.keyboard.press("Escape");
    await waitMenuClosed(page);
    await expect(page.locator("[data-kmenu-open]")).toHaveAttribute("aria-expanded", "false");
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-kmenu-open")),
      "焦点返回触发按钮",
    ).toBe(true);
  });
});

test.describe("桌面限定动效（pointer:fine）", () => {
  test("自定义光标跟随并显示语义标签；磁性位移；图片 tilt", async ({ page, isMobile }) => {
    // 移动设备模拟为 pointer:coarse，站点按设计不启用自定义光标/磁性（非缺陷）
    test.skip(isMobile === true, "自定义光标与磁性为 pointer:fine 桌面限定");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 光标：移动后显示，悬停标题链接显示 VIEW
    await page.mouse.move(400, 300);
    await page.waitForFunction(() => {
      const cursor = document.querySelector<HTMLElement>("[data-kcursor]");
      return cursor !== null && Number.parseFloat(getComputedStyle(cursor).opacity) > 0.9;
    });
    // UI 票 #12：自定义光标激活时隐藏系统指针（k-cursor-on 由 initCursor 挂载）
    expect(
      await page.evaluate(() =>
        document.querySelector("[data-kinetic]")?.classList.contains("k-cursor-on"),
      ),
      "自定义光标激活时应挂 k-cursor-on（隐藏系统指针）",
    ).toBe(true);
    const headline = page.locator(".k-entry .k-headline a").first();
    await headline.hover();
    await expect(page.locator("[data-kcursor-label]")).toHaveText("VIEW");
    // ring 放大有 0.3s 补间：轮询到放大终态（2.3）再断言
    await page.waitForFunction(
      () => {
        const ring = document.querySelector<HTMLElement>("[data-kcursor-ring]");
        if (!ring) return false;
        const transform = getComputedStyle(ring).transform;
        return transform !== "none" && new DOMMatrixReadOnly(transform).a > 2;
      },
      undefined,
      { timeout: 3_000 },
    );
    const ringScale = await page.evaluate(() => {
      const ring = document.querySelector<HTMLElement>("[data-kcursor-ring]");
      return ring ? new DOMMatrixReadOnly(getComputedStyle(ring).transform).a : 1;
    });
    expect(ringScale, "ring 放大（difference 混合标签态）").toBeGreaterThan(1.5);

    // 磁性：悬停主题 tab 产生 ≤8px 位移痕迹（先滚过阈值让 header 滑入，tab 才可命中）
    await showHeader(page);
    const tab = page.locator('[data-ktabs] .tab[data-topic="全部"]');
    await tab.hover();
    await page.waitForTimeout(400);
    const tabTransform = await tab.evaluate((el) => el.style.transform);
    expect(tabTransform, "tab 出现磁性位移痕迹").not.toBe("");

    // tilt：悬停占位图左上角（偏离中心，保证角度显著），等待 quickTo 补间到位后解析角度
    const media = page.locator(".k-entry.layout-a .k-media").first();
    await media.hover({ position: { x: 12, y: 12 } });
    await page.waitForFunction(
      () => {
        const t = document
          .querySelector<HTMLElement>(".k-entry.layout-a .k-media .k-media-tilt")
          ?.style.transform ?? "";
        const angles = [...t.matchAll(/rotate[XY]\((-?[\d.]+)deg\)/g)].map((m) =>
          Math.abs(Number.parseFloat(m[1]!)),
        );
        return angles.length >= 2 && angles.some((a) => a > 1);
      },
      undefined,
      { timeout: 3_000 },
    );
    const tiltTransform = await media.evaluate(
      (el) => el.querySelector<HTMLElement>(".k-media-tilt")!.style.transform,
    );
    expect(tiltTransform, "tilt 层出现 rotateX/rotateY").toMatch(/rotateX\(|rotateY\(/);
    const angles = [...tiltTransform.matchAll(/rotate[XY]\((-?[\d.]+)deg\)/g)].map((m) =>
      Math.abs(Number.parseFloat(m[1]!)),
    );
    expect(Math.max(...angles), "倾斜角度超出中心（非零位移写入）").toBeGreaterThan(1);
  });
});

test.describe("自定义光标：可见性与语义分档（UI 票 #14）", () => {
  /** 测试底板：够大，保证「光标处」与「背景处」两个采样点都落在板上。 */
  const BOARD = { id: "cursor-swatch", x: 600, y: 300, width: 240, height: 160 };
  const CENTER = { x: BOARD.x + 120, y: BOARD.y + 80 };
  /** 圆环描边中心线半径（盒 38px + 2px 边框 → 描边占半径 17~19），取 18 命中描边。 */
  const RING_OFFSET = 18;
  const BACKDROP_OFFSET = 30; // 在圆环之外且仍在板上

  async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
  }

  /** 注入已知底色的底板并把光标停上去，返回「点」「环」「邻近背景」三处实测像素。 */
  async function cursorOnBoard(
    page: Page,
    color: string,
  ): Promise<{ dot: readonly number[]; ring: readonly number[]; backdrop: readonly number[] }> {
    await page.evaluate(
      ({ board, color }) => {
        document.getElementById(board.id)?.remove();
        const el = document.createElement("div");
        el.id = board.id;
        el.style.cssText =
          `position:fixed;left:${board.x}px;top:${board.y}px;width:${board.width}px;` +
          `height:${board.height}px;z-index:600;background:${color}`;
        document.querySelector("[data-kinetic]")!.appendChild(el);
      },
      { board: BOARD, color },
    );
    await page.mouse.move(CENTER.x, CENTER.y);
    await page.waitForTimeout(700);
    const [dot, ring, backdrop] = await samplePixels(
      page,
      { x: BOARD.x, y: BOARD.y, width: BOARD.width, height: BOARD.height },
      [
        [CENTER.x - BOARD.x, CENTER.y - BOARD.y],
        [CENTER.x - BOARD.x + RING_OFFSET, CENTER.y - BOARD.y],
        [CENTER.x - BOARD.x + BACKDROP_OFFSET, CENTER.y - BOARD.y],
      ],
    );
    return { dot: dot!, ring: ring!, backdrop: backdrop! };
  }

  test("光标在浅色纸面 / 深色纸面 / accent 暗红底上的渲染对比度均 ≥ 3:1", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile === true, "自定义光标为 pointer:fine 桌面限定");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await page.mouse.move(200, 200); // 让光标显形
    await page.waitForTimeout(400);

    await setTheme(page, "dark");
    const darkPaper = await designToken(page, "--paper");
    await setTheme(page, "light");
    const lightPaper = await designToken(page, "--paper");
    const accent = await designToken(page, "--accent");

    const cases = [
      { name: "浅色纸面", color: lightPaper },
      { name: "深色纸面", color: darkPaper },
      { name: "accent 暗红底", color: accent },
    ];

    for (const item of cases) {
      const { dot, ring, backdrop } = await cursorOnBoard(page, item.color);
      // 采样点自证：背景处必须真是该底板色，否则后面的对比度断言没有意义
      expect(backdrop, `${item.name}：背景采样点应落在底板上`).toEqual(
        parseHexColor(item.color),
      );
      expect(
        contrastRatio(dot, backdrop),
        `${item.name}：光标点与背景的实测渲染对比度（${JSON.stringify(dot)} vs ${JSON.stringify(backdrop)}）`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(ring, backdrop),
        `${item.name}：光标环与背景的实测渲染对比度（${JSON.stringify(ring)} vs ${JSON.stringify(backdrop)}）`,
      ).toBeGreaterThanOrEqual(3);
    }

    // 圆环描边必须是能真实渲染的宽度：Blink 会把 border-width 取整，1.5px 实际只渲染 1px
    const borderWidth = await page.evaluate(
      () => getComputedStyle(document.querySelector<HTMLElement>("[data-kcursor-ring]")!).borderTopWidth,
    );
    expect(borderWidth, "圆环描边应为可真实渲染的 2px（非 1.5px 这类会被取整的值）").toBe("2px");
  });

  test("鼠标离开文档 / 页面失去焦点时，光标与语义标签一起隐藏", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "自定义光标为 pointer:fine 桌面限定");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    const headline = page.locator(".k-entry .k-headline a").first();
    const cursor = page.locator("[data-kcursor]");
    const label = page.locator("[data-kcursor-label]");

    // 文档级 mouseleave（站点以此判定鼠标离开窗口）
    await headline.hover();
    await expect(label).toHaveCSS("opacity", "1");
    await page.evaluate(() => {
      document.documentElement.dispatchEvent(new MouseEvent("mouseleave"));
    });
    await expect(cursor, "光标应隐藏").toHaveCSS("opacity", "0");
    // 此处不断言标签：WebKit 在合成 mouseleave 之后会重放悬停链（out → over），而指针实际仍停在
    // 链接上，标签于是被重新点亮——这是「指针并未真正离开」的模拟假象，真实移出窗口时不会发生
    // （矩阵实测：Chromium/Firefox 无此重放；处置口径记在票 #14）。标签的隐藏由下面的失焦路径
    // 覆盖——两条路径是同一个处理器 onLeaveDoc。

    // 页面失去焦点（切换窗口/应用）：光标与语义标签一起隐藏，不留悬空残影
    await page.mouse.move(200, 200); // 先移开：hover 到同一坐标不会产生 mousemove，光标不会重新显形
    await page.waitForTimeout(200);
    await headline.hover();
    await expect(label).toHaveCSS("opacity", "1");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await expect(cursor, "失焦后光标应隐藏").toHaveCSS("opacity", "0");
    await expect(label, "失焦后语义标签应一起隐藏，不留悬空残影").toHaveCSS("opacity", "0");
  });

  test("语义标签保持主题 accent 原色，不随背景反相漂移", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "自定义光标为 pointer:fine 桌面限定");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 目标选占位版画而非标题链接：链接文字本身是 accent 红，光标压在其上时 difference 会渲染成青绿
    // （实测 [112,217,212]，与标签字形的红通道极差同为 105 打成平手），取样会变成抛硬币。
    // 版画中心是中性底（近白底纹 + 墨色大序号），标签字形是框内唯一的高饱和像素。
    const media = page.locator(".k-entry.layout-a .k-media").first();
    const label = page.locator("[data-kcursor-label]");

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await media.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const mediaBox = await media.boundingBox();
      await page.mouse.move(mediaBox!.x + mediaBox!.width / 2, mediaBox!.y + mediaBox!.height / 2);
      await expect(label, `${theme}：标签应显示语义文案`).toHaveText("OPEN");
      // 淡入补间 0.2s：等透明度到位再采样，否则采到的是半透明字形
      await expect(label, `${theme}：标签应完全淡入`).toHaveCSS("opacity", "1");
      const box = await label.boundingBox();
      expect(box, `${theme}：标签应有可见包围盒`).not.toBeNull();

      // 标签已移出圆环，靠独立补间跟随：仍须居中于光标（圆环 translate 即光标坐标）
      const ringCenter = await page.evaluate(() => {
        const m = new DOMMatrixReadOnly(
          getComputedStyle(document.querySelector<HTMLElement>("[data-kcursor-ring]")!).transform,
        );
        return { x: m.e, y: m.f };
      });
      expect(
        Math.abs(box!.x + box!.width / 2 - ringCenter.x),
        `${theme}：标签应水平居中于光标`,
      ).toBeLessThan(6);
      expect(
        Math.abs(box!.y + box!.height / 2 - ringCenter.y),
        `${theme}：标签应垂直居中于光标`,
      ).toBeLessThan(6);
      const x = Math.floor(box!.x);
      const y = Math.floor(box!.y);
      const width = Math.max(1, Math.ceil(box!.width));
      const height = Math.max(1, Math.ceil(box!.height));

      const points: Array<[number, number]> = [];
      for (let px = 0; px < width; px += 2) {
        for (let py = 0; py < height; py += 2) points.push([px, py]);
      }
      const pixels = await samplePixels(page, { x, y, width, height }, points);
      // 字形芯饱和度远高于背景与光标点（点在同底色上近中性灰），取极差最大者
      const glyph = pixels.reduce((best, p) => (channelSpread(p) > channelSpread(best) ? p : best));
      expect(
        channelSpread(glyph),
        `${theme}：应采到标签字形像素（实测 ${JSON.stringify(glyph)}）`,
      ).toBeGreaterThan(40);
      // accent 为红系（R 最高）；若标签被反相混合漂移，浅色纸面上会变成青绿（G 最高）
      expect(glyph[0], `${theme}：标签渲染色应偏红（R>G），实测 ${JSON.stringify(glyph)}`)
        .toBeGreaterThan(glyph[1]!);
      expect(glyph[0], `${theme}：标签渲染色应偏红（R>B），实测 ${JSON.stringify(glyph)}`)
        .toBeGreaterThan(glyph[2]!);
      // 直接编码回归特征：标签若被反相混合，accent 红会渲染成青绿（G 明显最高）——标签框内不应出现
      // 直接编码回归特征：标签若被反相混合，accent 红会渲染成青绿（G 反超 R 且不低于 B）。
      // 不依赖"哪个像素极差最大"——变异实测该色为 [112,215,204]，与红字形极差同为 103。
      const cyan = pixels.filter((p) => p[1]! > p[0]! + 30 && p[1]! >= p[2]!);
      expect(cyan, `${theme}：标签框内不应出现青绿像素（反相漂移特征）`).toEqual([]);
    }
  });

  test("语义标签完整落在圆环内，不戳出圈外", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "自定义光标为 pointer:fine 桌面限定");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    const label = page.locator("[data-kcursor-label]");
    const targets = [
      ["条目标题链接", ".k-entry .k-headline a"],
      ["占位版画", ".k-entry.layout-a .k-media"],
      ["条目外链", ".k-meta a.ext"],
    ] as const;

    for (const [name, selector] of targets) {
      const target = page.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const box = await target.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(label, `${name} 应显示语义标签`).toHaveCSS("opacity", "1");

      const measured = await page.evaluate(() => {
        const labelEl = document.querySelector<HTMLElement>("[data-kcursor-label]")!;
        const ringEl = document.querySelector<HTMLElement>("[data-kcursor-ring]")!;
        return {
          text: labelEl.textContent ?? "",
          width: labelEl.getBoundingClientRect().width,
          // 圆环为 38px 盒（border-box），语义态放大 2.3 倍 → 外径
          diameter: 38 * new DOMMatrixReadOnly(getComputedStyle(ringEl).transform).a,
        };
      });
      expect(
        measured.width,
        `${name}「${measured.text}」标签宽 ${measured.width.toFixed(1)}px 不应超过圆环直径 ` +
          `${measured.diameter.toFixed(1)}px（超出即文字戳出圈外）`,
      ).toBeLessThanOrEqual(measured.diameter);
    }
  });

  test("语义分档：内容入口完整态、次级控件轻量态、未启用边界项无态", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "自定义光标为 pointer:fine 桌面限定");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    const ringScale = () =>
      page.evaluate(() => {
        const ring = document.querySelector<HTMLElement>("[data-kcursor-ring]");
        if (!ring) return 0;
        const t = getComputedStyle(ring).transform;
        return t === "none" ? 1 : new DOMMatrixReadOnly(t).a;
      });
    const labelOpacity = () =>
      page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.querySelector<HTMLElement>("[data-kcursor-label]")!).opacity,
        ),
      );

    /**
     * 悬停目标并等待补间到位，返回圆环缩放与标签透明度。
     * 用坐标移动鼠标而非 locator.hover()：主题切换是两段式动画，列表与分页器会被脚本重写，
     * WebKit 下 locator 的稳定性门会因此报 "element is not attached"（本票矩阵实测）。
     */
    async function hoverState(
      selector: string,
    ): Promise<{ scale: number; label: number; text: string }> {
      const target = page.locator(selector).first();
      await target.waitFor({ state: "visible", timeout: 5_000 });
      await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(200);
      const box = await target.boundingBox();
      expect(box, `${selector} 应有可见包围盒`).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.waitForTimeout(600);
      return {
        scale: await ringScale(),
        label: await labelOpacity(),
        text: await page.evaluate(
          () => document.querySelector<HTMLElement>("[data-kcursor-label]")?.textContent ?? "",
        ),
      };
    }

    // 完整语义态（内容入口三类）：圆环放大 + 语义标签
    const fullTargets = [
      ["条目标题链接", ".k-entry .k-headline a", "VIEW"],
      ["占位版画", ".k-entry.layout-a .k-media", "OPEN"],
      ["条目外链", ".k-meta a.ext", "LINK"],
    ] as const;
    for (const [name, selector, expected] of fullTargets) {
      const state = await hoverState(selector);
      expect(state.scale, `${name} 应放大到完整语义态`).toBeGreaterThan(2);
      expect(state.label, `${name} 应显示语义标签`).toBeGreaterThan(0.9);
      expect(state.text, `${name} 的语义标签文案`).toBe(expected);
    }

    // 轻量可点击态（次级控件）：圆环轻微放大、不显示标签
    await showHeader(page);
    const softTargets = [
      ["品牌标识", ".k-brand"],
      ["主题筛选 Tab", '[data-ktabs] .tab'],
      ["显示模式按钮", "[data-mode]"],
      ["菜单入口", "[data-kmenu-open]"],
    ] as const;
    for (const [name, selector] of softTargets) {
      const state = await hoverState(selector);
      expect(state.scale, `${name} 应给出轻量可点击态（圆环轻微放大）`).toBeGreaterThan(1.15);
      expect(state.scale, `${name} 不应放大到完整语义态`).toBeLessThan(2);
      expect(state.label, `${name} 不应显示语义标签`).toBe(0);
    }

    // 客户端重渲染后的分页（筛选走客户端，分页器由脚本重写）同样带轻量态
    await pickTopic(page, "新闻");
    // 两段式切换期间列表与分页器会被重写，等动画标记消失再定位
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute("data-oct-topic-anim"),
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(400);
    const pager = await hoverState('.pager .page-btn[data-page="2"]');
    expect(pager.scale, "分页按钮应给出轻量可点击态").toBeGreaterThan(1.15);
    expect(pager.scale, "分页按钮不应放大到完整语义态").toBeLessThan(2);
    expect(pager.label, "分页按钮不应显示语义标签").toBe(0);

    // 未启用的分页边界项：不给任何可点击态
    const disabled = await hoverState('.pager .page-btn[aria-disabled="true"]');
    expect(disabled.scale, "未启用的分页边界项不应有可点击态").toBeCloseTo(1, 2);
    expect(disabled.label, "未启用的分页边界项不应显示语义标签").toBe(0);

    // 页脚导航
    const foot = await hoverState(".k-foot-nav a");
    expect(foot.scale, "页脚导航应给出轻量可点击态").toBeGreaterThan(1.15);
    expect(foot.scale, "页脚导航不应放大到完整语义态").toBeLessThan(2);
    expect(foot.label, "页脚导航不应显示语义标签").toBe(0);

    // 返回顶部：滚到底才出现（.show），同属次级控件
    await page.mouse.move(200, 300);
    await wheelBy(page, 2000);
    await expect(page.locator("[data-ktop]")).toHaveClass(/show/);
    const top = await hoverState("[data-ktop]");
    expect(top.scale, "返回顶部应给出轻量可点击态").toBeGreaterThan(1.15);
    expect(top.scale, "返回顶部不应放大到完整语义态").toBeLessThan(2);
    expect(top.label, "返回顶部不应显示语义标签").toBe(0);
  });
});

test.describe("降级（reduced-motion / GSAP CDN 失败）", () => {
  test("prefers-reduced-motion：内容直显、无隐藏初态、功能完整、进度呈现可用", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(BASE);
    await waitClientReady(page);

    await page.waitForSelector('html[data-oct-motion="off"]');
    const state = await page.evaluate(() => {
      const heroEn = document.querySelector<HTMLElement>("[data-heroen]");
      const header = document.querySelector<HTMLElement>("[data-kheader]");
      const entry = document.querySelector<HTMLElement>(".k-entry");
      const sum = entry?.querySelector<HTMLElement>(".k-summary");
      const meta = entry?.querySelector<HTMLElement>(".k-meta");
      return {
        chars: document.querySelectorAll("[data-herotitle] .ch, .k-headline .ch").length,
        heroEnInlineOpacity: heroEn?.style.opacity ?? "",
        heroEnComputedOpacity: heroEn ? Number.parseFloat(getComputedStyle(heroEn).opacity) : -1,
        headerTransform: header ? getComputedStyle(header).transform : "",
        summaryInlineClip: sum?.style.clipPath ?? "",
        metaInlineOpacity: meta?.style.opacity ?? "",
      };
    });
    expect(state.chars, "不做字符拆分（无隐藏初态）").toBe(0);
    expect(state.heroEnInlineOpacity, "hero 无内联隐藏").toBe("");
    expect(state.heroEnComputedOpacity, "hero 计算透明度可见（非内联断言，T06 收尾项）").toBeGreaterThan(0);
    expect(state.headerTransform, "header 首屏可见").toBe("none");
    expect(state.summaryInlineClip, "摘要无 clip 遮蔽").toBe("");
    expect(state.metaInlineOpacity, "元信息无隐藏").toBe("");
    expect(await cursorLabelOpacity(page), "语义标签不出现（UI 票 #14：标签为独立元素）").toBe(0);

    // 功能完整：筛选分页照常（无动画属性标记）
    await pickTopic(page, "新闻");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator("[data-total]")).toHaveText("23");
    expect(
      await page.evaluate(() => document.documentElement.hasAttribute("data-oct-topic-anim")),
      "无动效标记",
    ).toBe(false);

    // 进度呈现：无 GSAP 的滚动处理器仍更新圆环与百分比
    await page.mouse.move(200, 300);
    await wheelBy(page, 2000);
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent !== "0%",
      undefined,
      { timeout: 5_000 },
    );
    const ring = await page.evaluate(
      () => document.querySelector<SVGCircleElement>("[data-ring]")?.style.strokeDashoffset ?? "",
    );
    expect(parseFloat(ring), "圆环进度更新").toBeLessThan(RING_LENGTH);
    await context.close();
  });

  test("动效库脚本加载失败（Ticket 08 起为自托管 vendor 脚本缺失/失败场景）：本地模块仍运行，整体退化为静态可用", async ({ page }) => {
    // 模拟站内动效库文件不可用（部署不完整或传输失败），降级路径与原 CDN 失败场景一致
    await page.route(/\/vendor\/(gsap|ScrollTrigger)\.min\.js$/, (route) => route.abort());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await page.waitForSelector('html[data-oct-motion="off"]');

    const state = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("[data-kheader]");
      const entry = document.querySelector<HTMLElement>(".k-entry");
      const sum = entry?.querySelector<HTMLElement>(".k-summary");
      return {
        chars: document.querySelectorAll(".ch").length,
        headerTransform: header ? getComputedStyle(header).transform : "",
        summaryInlineClip: sum?.style.clipPath ?? "",
        cursorHidden:
          Number.parseFloat(
            getComputedStyle(document.querySelector<HTMLElement>("[data-kcursor]")!).opacity,
          ) === 0,
      };
    });
    expect(state.chars, "无字符拆分").toBe(0);
    expect(state.headerTransform, "header 可见").toBe("none");
    expect(state.summaryInlineClip, "无 clip 遮蔽").toBe("");
    expect(state.cursorHidden, "自定义光标不出现").toBe(true);
    expect(await cursorLabelOpacity(page), "语义标签不出现（UI 票 #14：标签为独立元素，需单独隐藏）").toBe(0);

    // 静态可用：筛选、翻页、返回顶部（降级下 header 常显，Tab 直接可点）
    await pickTopic(page, "新闻");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await pickTopic(page, "全部");
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await page.mouse.move(200, 300);
    await wheelBy(page, 2000);
    await expect(page.locator("[data-ktop]")).toHaveClass(/show/);
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent !== "0%",
      undefined,
      { timeout: 5_000 },
    );
  });
});

test.describe("ScrollTrigger 泄漏防护", () => {
  test("反复切主题/翻页/开关菜单后触发器数量稳定", async ({ page }) => {
    // 移动 WebKit 上 wheel 降级键盘、菜单/主题动画更慢，30s 默认超时不够
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);
    await waitIntroDone(page);

    const count = () =>
      page.evaluate(
        () =>
          (window as unknown as { ScrollTrigger: { getAll(): unknown[] } }).ScrollTrigger.getAll()
            .length,
      );
    // 缓慢滚过整页：烧掉全部 once:true 揭示触发器（触发后自毁是原型既定行为），
    // 使计数只剩持久触发器（全局/视差/进度线/节点激活），与滚动历史解耦、可复现
    const scrollThrough = async () => {
      await page.evaluate(async () => {
        const step = Math.max(300, Math.floor(window.innerHeight * 0.6));
        for (let y = 0; y <= document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      });
    };
    // 一个完整交互周期：切主题（listCtx revert 重建）→ 翻页往返 → 滚尽烧触发器 → 回顶 → 菜单开关
    const cycle = async () => {
      await showHeader(page);
      await pickTopic(page, "新闻");
      await waitTopicAnimDone(page);
      await page.waitForTimeout(400);
      await scrollThrough();
      await showHeader(page);
      await pickTopic(page, "全部");
      await waitTopicAnimDone(page);
      await page.waitForTimeout(400);
      await page.locator('[data-pager] [aria-label="第 2 页"]').click();
      await expect(page.locator('.k-entry[data-gi="20"]')).toBeVisible();
      await page.locator('[data-pager] [aria-label="第 1 页"]').click();
      await expect(page.locator('.k-entry[data-gi="0"]')).toBeVisible();
      await page.waitForTimeout(400);
      await scrollThrough();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(600);
      for (let round = 0; round < 2; round++) {
        await showHeader(page);
        await page.locator("[data-kmenu-open]").click();
        await expect(page.locator("[data-kmenu]")).toHaveJSProperty("open", true);
        await page.locator("[data-kmenu-close]").click();
        await waitMenuClosed(page);
      }
    };

    await cycle();
    const before = await count();
    await cycle();
    const after = await count();
    expect(
      after,
      "同一路径第二个完整周期后计数应与第一周期一致（listCtx revert 回收，无逐渲染累积）",
    ).toBe(before);
    expect(after, "持久触发器应存在（全局 + 视差 + 进度线/节点激活）").toBeGreaterThan(10);
  });
});

test.describe("桌面限定动效门槛（pointer:fine）", () => {
  test("pointer 非 fine（模拟 coarse）：光标不出现、悬停无磁性位移痕迹", async ({ page }) => {
    // 仅拦截模块初始化读取的 pointer:fine 媒体查询，其余查询透传
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const mql = original(query);
        if (query === "(pointer:fine)") {
          return {
            matches: false,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList;
        }
        return mql;
      }) as typeof window.matchMedia;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 光标：移动鼠标后不得出现（initCursor 未注册监听）
    await page.mouse.move(400, 300);
    await page.mouse.move(500, 320);
    const cursorOpacity = await page.evaluate(
      () =>
        Number.parseFloat(
          getComputedStyle(document.querySelector<HTMLElement>("[data-kcursor]")!).opacity,
        ),
    );
    expect(cursorOpacity, "自定义光标保持隐藏").toBe(0);

    // 磁性：悬停 tab 无 transform 痕迹（先滚过阈值让 header 滑入）
    await showHeader(page);
    const tab = page.locator('[data-ktabs] .tab[data-topic="全部"]');
    await tab.hover();
    await page.waitForTimeout(300);
    expect(await tab.evaluate((el) => el.style.transform), "tab 无磁性位移痕迹").toBe("");

    // tilt：悬停占位图无 3D 旋转痕迹
    const media = page.locator(".k-entry.layout-a .k-media").first();
    await media.hover();
    await page.waitForTimeout(300);
    expect(
      await media.evaluate((el) => el.querySelector<HTMLElement>(".k-media-tilt")!.style.transform),
      "tilt 层无 rotateX/rotateY 痕迹",
    ).toBe("");
  });
});

test.describe("截图矩阵（320/390/768/1024/1440 × 浅/深）", () => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      test(`t06 矩阵 ${width}px ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => {
          localStorage.setItem("overthecocoons.theme", value);
        }, theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(BASE);
        await waitClientReady(page);
        await waitIntroDone(page);

        // 逐步滚到底触发全部 once 揭示，再回顶截图（保证整页截图内容完整呈现）
        await page.evaluate(async () => {
          const step = Math.max(300, Math.floor(window.innerHeight * 0.6));
          for (let y = 0; y <= document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          window.scrollTo(0, 0);
          await new Promise((resolve) => setTimeout(resolve, 600));
        });

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, `${width}px 不应横向破版`).toBeLessThanOrEqual(width);
        await safeScreenshot(page, `test-results/screenshots/t06-${width}-${theme}.png`);
      });
    }
  }
});
