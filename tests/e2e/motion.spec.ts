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
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(
    () => {
      const header = document.querySelector("[data-kheader]");
      if (!header) return true;
      const transform = getComputedStyle(header).transform;
      if (transform === "none") return true;
      return new DOMMatrixReadOnly(transform).m42 > -10;
    },
    undefined,
    { timeout: 5_000 },
  );
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
    await page.locator('[data-ktabs] .tab[data-topic="新闻"]').click();
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

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
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
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 2000);
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent !== "0%",
      undefined,
      { timeout: 5_000 },
    );
    const mid = await page.evaluate(() => ({
      pct: document.querySelector("[data-readpct]")?.textContent ?? "",
      readbar: getComputedStyle(document.querySelector("[data-readbar]")!).transform,
      ring: document.querySelector<SVGCircleElement>("[data-ring]")?.style.strokeDashoffset ?? "",
    }));
    expect(mid.pct).toMatch(/^[1-9]\d%$|^100%$/);
    expect(mid.readbar, "readbar scaleX 应大于 0").not.toContain("matrix(1, 0, 0, 0, 0, 0)");
    expect(Number(mid.ring), "圆环 dashoffset 应小于满值").toBeLessThan(RING_LENGTH);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent === "100%",
      undefined,
      { timeout: 5_000 },
    );
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
      const t0 = performance.now();
      const tick = () => {
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

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 900);
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
    expect(mark.sum, "摘要晚于标题字符").toBeGreaterThan(mark.ch);
    expect(mark.meta, "元信息晚于摘要").toBeGreaterThan(mark.sum);

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

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 1600);
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

    await page.locator('[data-ktabs] .tab[data-topic="新闻"]').click();
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
  test("自定义光标跟随并显示语义标签；磁性位移；图片 tilt", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await waitClientReady(page);
    await waitMotionOn(page);

    // 光标：移动后显示，悬停标题链接显示 VIEW ↗
    await page.mouse.move(400, 300);
    await page.waitForFunction(() => {
      const cursor = document.querySelector<HTMLElement>("[data-kcursor]");
      return cursor !== null && Number.parseFloat(getComputedStyle(cursor).opacity) > 0.9;
    });
    const headline = page.locator(".k-entry .k-headline a").first();
    await headline.hover();
    await expect(page.locator("[data-kcursor-label]")).toHaveText("VIEW ↗");
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
        headerTransform: header ? getComputedStyle(header).transform : "",
        summaryInlineClip: sum?.style.clipPath ?? "",
        metaInlineOpacity: meta?.style.opacity ?? "",
      };
    });
    expect(state.chars, "不做字符拆分（无隐藏初态）").toBe(0);
    expect(state.heroEnInlineOpacity, "hero 无内联隐藏").toBe("");
    expect(state.headerTransform, "header 首屏可见").toBe("none");
    expect(state.summaryInlineClip, "摘要无 clip 遮蔽").toBe("");
    expect(state.metaInlineOpacity, "元信息无隐藏").toBe("");

    // 功能完整：筛选分页照常（无动画属性标记）
    await page.locator('[data-ktabs] .tab[data-topic="新闻"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await expect(page.locator("[data-total]")).toHaveText("23");
    expect(
      await page.evaluate(() => document.documentElement.hasAttribute("data-oct-topic-anim")),
      "无动效标记",
    ).toBe(false);

    // 进度呈现：无 GSAP 的滚动处理器仍更新圆环与百分比
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 2000);
    await page.waitForFunction(
      () => document.querySelector("[data-readpct]")?.textContent !== "0%",
      undefined,
      { timeout: 5_000 },
    );
    const ring = await page.evaluate(
      () => document.querySelector<SVGCircleElement>("[data-ring]")?.style.strokeDashoffset ?? "",
    );
    expect(Number(ring), "圆环进度更新").toBeLessThan(RING_LENGTH);
    await context.close();
  });

  test("GSAP CDN 失败：本地模块仍运行，整体退化为静态可用", async ({ page }) => {
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
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

    // 静态可用：筛选、翻页、返回顶部（降级下 header 常显，Tab 直接可点）
    await page.locator('[data-ktabs] .tab[data-topic="新闻"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await page.locator('[data-ktabs] .tab[data-topic="全部"]').click();
    await expect(page.locator(".k-entry")).toHaveCount(20);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 2000);
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
      await page.locator('[data-ktabs] .tab[data-topic="新闻"]').click();
      await waitTopicAnimDone(page);
      await page.waitForTimeout(400);
      await scrollThrough();
      await showHeader(page);
      await page.locator('[data-ktabs] .tab[data-topic="全部"]').click();
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
        await page.screenshot({
          path: `test-results/screenshots/t06-${width}-${theme}.png`,
          fullPage: true,
        });
      });
    }
  }
});
