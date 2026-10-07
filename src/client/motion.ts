/**
 * Kinetic 动效层（Ticket 06）：把原型 v-kinetic（docs/design/prototype-timeline.html）的 GSAP
 * 动效逐项移植到产品页。GSAP Core + ScrollTrigger 自托管于 public/vendor/（3.13.0，
 * BaseLayout 内 SRI 固定）加载；库脚本加载失败或 prefers-reduced-motion 时整体退化为
 * Ticket 05 静态可用状态
 * （内容直显、无隐藏初态、功能完整）。
 *
 * 结构对齐原型：
 * - kineticCtx：Hero Intro / Header Morph / 全局进度（进度条/圆环/百分比）/ 自定义光标，
 *   页面生命周期内一次性建立；
 * - listCtx：时间线列表动效（进度线 scaleY scrub、节点激活 toggleClass、版画 clip 揭示），
 *   每次客户端重渲染整体 revert 重建（ScrollTrigger 无泄漏）；
 * - cleanups：事件监听器登记，运行时异常时统一回收并退化为无动效路径。
 *
 * 动效参数（duration/ease/阈值/延迟）逐项取自原型 JS；性能约束：只动 transform/opacity/
 * clip-path（filter 仅 blur 两处、letterSpacing 仅 Hero ghost 一处，均为一次性揭示）。
 * T11 减动效（UI 票 #28，原型评审裁定）：Hero 视差、版画 tilt、光标磁性、scroll hint 循环、
 * 列表标题拆字升起已移除/转静态；列表揭示保留版画 clip 与节点激活态，摘要 clip 与
 * meta 字距动画已删（后者每帧触发布局），元信息仅余透明度淡入。跨页过渡走原生
 * View Transition（@view-transition，样式见 kinetic.css），不经本模块。
 * T12（UI 票 #29）：Hero 拆字 intro 前等待自托管展示字体就绪（fonts.ready 与 300ms
 * 兜底竞速，见 scheduleIntro）——拆字 intro 不在字体替换后量错；其余路径不等字体。
 * 测试挂钩（无行为含义）：html[data-oct-motion="on"|"off"]、html[data-oct-intro="done"]、
 * 两段式切换期间 html[data-oct-topic-anim]。
 */

import { shouldPlayIntro } from "../lib/intro-rule.ts";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_POINTER_QUERY = "(pointer:fine)";
/** 原型圆环周长（r=26，2πr≈163.36 → 163.4）。 */
const RING_LENGTH = 163.4;
/** Header Morph 滚动阈值（原型 gsap yPercent show=y>84）。 */
const HEADER_SHOW_AT = 84;
/** 自定义光标完整语义态（内容入口）圆环放大倍数（原型 initCursor 值）。 */
const CURSOR_FULL_SCALE = 2.3;
/** 自定义光标轻量可点击态（次级控件）圆环放大倍数（UI 票 #14：只给"可点"信号，不放大到语义态）。 */
const CURSOR_SOFT_SCALE = 1.35;
/**
 * T12（UI 票 #29）：Hero 拆字 intro 前的展示字体就绪等待上限（ms）。
 * 展示字体子集已 preload，正常路径 fonts.ready 在 300ms 内 settle；超时则在
 * 兜底栈上开播（font-display: swap，字体后到由浏览器替换字形，拆字动画只动
 * transform 不测量字宽，不会被替换破坏）——不阻塞、不悬挂。
 */
const FONT_READY_WAIT_MS = 300;

type TweenVars = Record<string, unknown>;
type TweenTarget = Element | Element[] | NodeListOf<Element> | string | null | undefined;

interface GsapContext {
  revert(): void;
}
interface GsapTimeline {
  to(target: TweenTarget, vars: TweenVars, position?: number | string): GsapTimeline;
  fromTo(
    target: TweenTarget,
    fromVars: TweenVars,
    toVars: TweenVars,
    position?: number | string,
  ): GsapTimeline;
  play(): GsapTimeline;
  kill(): GsapTimeline;
}
interface Gsap {
  registerPlugin(plugin: unknown): void;
  set(target: TweenTarget, vars: TweenVars): void;
  to(target: TweenTarget, vars: TweenVars): void;
  fromTo(target: TweenTarget, fromVars: TweenVars, toVars: TweenVars): void;
  killTweensOf(target: TweenTarget): void;
  delayedCall(delay: number, callback: () => void): void;
  context(func: (self: GsapContext) => void, scope?: Element): GsapContext;
  timeline(vars?: TweenVars): GsapTimeline;
  quickSetter(target: TweenTarget, property: string): (value: number) => void;
  quickTo(target: TweenTarget, property: string, vars: TweenVars): (value: number) => void;
}
interface ScrollTriggerPlugin {
  create(vars: TweenVars): unknown;
  getAll(): unknown[];
  refresh(): void;
}
interface MotionWindow extends Window {
  gsap?: Gsap;
  ScrollTrigger?: ScrollTriggerPlugin;
}
interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition(): void;
}
type DocumentWithVT = Document & {
  startViewTransition?: (updateCallback: () => void) => ViewTransitionLike;
};
type DocumentWithFonts = Document & { fonts?: { ready: Promise<unknown> } };

let gsap: Gsap | null = null;
let st: ScrollTriggerPlugin | null = null;
let enabled = false;
let kineticCtx: GsapContext | null = null;
let listCtx: GsapContext | null = null;
const cleanups: Array<() => void> = [];
let heroEn: HTMLElement | null = null;
let menuTl: { kill(): void } | null = null;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 展示字体就绪信号（T12，UI 票 #29）：document.fonts.ready 与 300ms 兜底竞速。
 * fonts API 缺失（极旧引擎）时立即通过——intro 原时序播放；字体加载失败时 ready
 * 照常 settle（swap 语义：兜底栈渲染），不会悬挂。
 */
function fontsReadyOrTimeout(): Promise<void> {
  const fonts = (document as DocumentWithFonts).fonts;
  if (!fonts) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FONT_READY_WAIT_MS);
    fonts.ready.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * 把元素文本拆为 span.kw > span.ch 遮罩字符（与原型 splitChars 一致，重复拆分幂等）。
 * T5 a11y（#22，审查修复）：拆出的 .kw/.ch 标 aria-hidden——读屏不逐字、按命名点完整词朗读。
 * 命名点只保留在语义元素上：T11（#28）起列表标题不再拆字（链接保持纯文本，可访问名即内容）；
 * Hero 的 .line 是 generic 角色（span 容器上 aria-label 属规范禁止项，读屏会忽略），
 * 命名点在 h1[data-herotitle]，由调用方在拆字清空前设置。
 * 二次拆分守卫：text 为空或与现有 label 一致时跳过覆写——同元素再次拆分不得置空已有 label。
 */
function splitChars(el: Element): HTMLElement[] {
  const text = el.textContent ?? "";
  if (
    text &&
    text !== el.getAttribute("aria-label") &&
    !el.matches("span:not([role]), div:not([role])")
  ) {
    el.setAttribute("aria-label", text);
  }
  el.textContent = "";
  const frag = document.createDocumentFragment();
  const chars: HTMLElement[] = [];
  for (const ch of text) {
    const kw = document.createElement("span");
    kw.className = "kw";
    kw.setAttribute("aria-hidden", "true");
    const c = document.createElement("span");
    c.className = "ch";
    c.setAttribute("aria-hidden", "true");
    c.textContent = ch;
    kw.appendChild(c);
    frag.appendChild(kw);
    chars.push(c);
  }
  el.appendChild(frag);
  return chars;
}

function rootElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-kinetic]");
}

function markIntroDone(): void {
  document.documentElement.setAttribute("data-oct-intro", "done");
}

/* ---- 入口 ---- */

export function initMotion(): void {
  const html = document.documentElement;
  const root = rootElement();
  const w = window as MotionWindow;
  const reduced = window.matchMedia(REDUCED_QUERY).matches;
  enabled = Boolean(root && w.gsap && w.ScrollTrigger && !reduced);
  if (enabled) {
    gsap = w.gsap!;
    st = w.ScrollTrigger!;
  }
  html.dataset.octMotion = enabled ? "on" : "off";
  if (!enabled) {
    // 降级：解除 head 启动脚本的预绘制遮蔽，内容直显
    html.removeAttribute("data-oct-pending");
    markIntroDone();
    startFallbackProgress();
    return;
  }
  try {
    initMotionOn(root!);
  } catch {
    // GSAP 运行时异常：整体回收（revert 清除全部隐藏初态），退化为无动效路径。
    // 立即解除预绘制遮蔽（T06 收尾项）：不依赖 head 启动脚本的 1500ms 兜底。
    degradeToStatic();
  }
}

/** 运行时异常的整体退化路径：revert 全部初态、解除预绘制遮蔽、标记 intro 完成并走无动效进度。 */
function degradeToStatic(): void {
  destroyMotion();
  enabled = false;
  gsap = null;
  st = null;
  const html = document.documentElement;
  html.dataset.octMotion = "off";
  html.removeAttribute("data-oct-pending");
  markIntroDone();
  startFallbackProgress();
}

function initMotionOn(root: HTMLElement): void {
  const html = document.documentElement;
  gsap!.registerPlugin(st);
  heroEn = root.querySelector<HTMLElement>("[data-heroen]");
  let introScheduled = false;
  // context 对象在回调首行登记：任一初始化抛错时 catch 仍能 revert 全部隐藏初态
  gsap!.context((self) => {
    kineticCtx = self;
    introScheduled = initHeroAndHeader(root);
    initCursor(root);
  }, root);
  initResize(root);
  onListRendered(false);
  // 预绘制遮蔽解除移交（T12 字体就绪等待，UI 票 #29）：intro 播放页由 scheduleIntro
  // 在「字体就绪 → 拆字与全部隐藏初态就位」后解除（避免「先画静态层 → JS 再隐藏 →
  // 再播 intro」闪动回归，head 启动脚本 1500ms 兜底与本函数异常路径 degradeToStatic
  // 均兜住解除）；跳过 intro / 无 Hero 的页面在此立即解除（内容直显）。
  if (!introScheduled) html.removeAttribute("data-oct-pending");
  requestAnimationFrame(() => st!.refresh());
}

/* ---- Hero Intro + Header Morph + 全局进度（原型 initHeroMotion + 全局 Trigger） ---- */

function initHeroAndHeader(root: HTMLElement): boolean {
  const g = gsap;
  const stl = st;
  if (!g || !stl) return false;
  const hero = root.querySelector<HTMLElement>("[data-hero]");
  const header = root.querySelector<HTMLElement>("[data-kheader]");
  const ring = document.querySelector<SVGCircleElement>("[data-ring]");
  const pctEl = document.querySelector<HTMLElement>("[data-readpct]");
  const readbar = document.querySelector<HTMLElement>("[data-readbar]");
  const readbarSet = readbar ? g.quickSetter(readbar, "scaleX") : null;
  let headerShown = false;
  let lastPct = -1;

  // Header Morph：首屏隐藏由 GSAP yPercent 控制（CSS 不同时控制 transform）。
  // 仅存在 Hero 的页面做首屏隐藏与滚动显隐（UI 票 #20）：非 Hero 页 header 常显——
  // 显隐分支若照跑，headerShown 初值 false 会在回落到 84px 以下时错误触发滑出。
  // 显式 y:0 中和预绘制遮蔽期（data-oct-pending）遗留的 CSS translateY(-100%)——
  // 否则 GSAP 首次 set 会把已计算的 -68px 解析进 y 分量，与 yPercent:-100 叠加成 -136px，
  // 且 morph 补间只动 yPercent，header 将永远停在半隐藏位置。
  if (hero && header) g.set(header, { y: 0, yPercent: -100 });
  stl.create({
    start: 0,
    end: "max",
    onUpdate: (self: { scroll(): number; progress: number }) => {
      const y = self.scroll();
      if (hero) {
        const show = y > HEADER_SHOW_AT;
        if (show !== headerShown) {
          headerShown = show;
          g.to(header, { yPercent: show ? 0 : -100, duration: 0.4, ease: "power3.out" });
        }
      }
      const p = self.progress;
      if (readbarSet) readbarSet(p);
      if (ring) ring.style.strokeDashoffset = String(RING_LENGTH * (1 - p));
      const pct = Math.round(p * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        if (pctEl) pctEl.textContent = `${pct}%`;
      }
      // topBtn 显隐由 top.ts 处理（同阈值 400，避免双写）
    },
  });

  if (!hero) {
    markIntroDone();
    return false;
  }

  const rule = root.querySelector<HTMLElement>("[data-herorule]");
  const metaItems = [...root.querySelectorAll<HTMLElement>("[data-herometa] li")];
  const dateBig = root.querySelector<HTMLElement>("[data-herodate]");
  const hint = root.querySelector<HTMLElement>("[data-hint]");

  // 首次 intro（票 #25）：开场编排仅对「首次到达」播放——判定零存储（privacy 页明文
  // 不写入 sessionStorage，e2e 断言其恒空），规则见 lib/intro-rule.ts（reload/back_forward
  // 或站内同源跳转 → 跳过；直接到达/外源进入 → 播放）。跳过时立即打 data-oct-intro=done
  // 且不建任何隐藏初态（内容直显）；Hero 页滚动显隐（84px 阈值）不受影响。
  // T12（UI 票 #29）：播放路径排程到 scheduleIntro——拆字前先等展示字体就绪。
  let introScheduled = false;
  if (
    !shouldPlayIntro({
      navigationType: readNavigationType(),
      referrer: document.referrer,
      origin: location.origin,
    })
  ) {
    markIntroDone();
  } else {
    introScheduled = true;
    scheduleIntro(root, { rule, metaItems, dateBig, hint });
  }

  // T11（UI 票 #28）：Hero 视差（hero-en/date 滚动位移 scrub）已移除——ghost 英文与幽灵日期
  // 滚动时保持原位；scroll hint 的滚动淡出保留（信息性：提示已离开首屏）。
  if (hint) {
    g.to(hint, {
      autoAlpha: 0,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "60% top", scrub: true },
    });
  }
  return introScheduled;
}

/** Hero intro 编排的隐藏初态依赖（在 initHeroAndHeader 已查询，传入避免重复 query）。 */
interface IntroParts {
  rule: HTMLElement | null;
  metaItems: HTMLElement[];
  dateBig: HTMLElement | null;
  hint: HTMLElement | null;
}

/**
 * T12（UI 票 #29）：Hero 拆字 intro 排程——先等展示字体就绪（document.fonts.ready
 * 与 300ms 兜底竞速，见 fontsReadyOrTimeout），再拆字、置隐藏初态、解除预绘制遮蔽并开播。
 * 拆字在字体替换后不得量错：等字体（≤300ms）或超时后在兜底栈开播（swap 接管），
 * 拆字动画只动 transform 不测量字宽，字形替换不破坏编排。
 * 等待期间 data-oct-pending 遮蔽维持（head 启动脚本 1500ms 兜底解除覆盖本函数
 * 异常路径）；函数内异常走 degradeToStatic（revert 全部初态并解除遮蔽）。
 */
function scheduleIntro(root: HTMLElement, parts: IntroParts): void {
  const { rule, metaItems, dateBig, hint } = parts;
  fontsReadyOrTimeout().then(() => {
    const g = gsap;
    if (!g) return;
    try {
      const heroChars: HTMLElement[] = [];
      // T5 a11y（#22）：h1 是标题唯一的有效命名点——.line 是 generic 角色（span 上 aria-label
      // 属规范禁止项，部分读屏会忽略，而其子树字符又被 aria-hidden 藏起，届时 h1 名将落空），
      // 故在 h1 上补完整标题 label（须在拆字清空前读取各行文本）。
      const heroTitle = root.querySelector<HTMLElement>("[data-herotitle]");
      if (heroTitle) {
        heroTitle.setAttribute(
          "aria-label",
          [...heroTitle.querySelectorAll<HTMLElement>(".line")]
            .map((line) => (line.textContent ?? "").trim())
            .join(""),
        );
      }
      root.querySelectorAll<HTMLElement>(".k-hero-title .line").forEach((line) => {
        heroChars.push(...splitChars(line));
      });
      const ghostA = heroEn
        ? Number.parseFloat(getComputedStyle(root).getPropertyValue("--ghost-a")) || 0.05
        : 0.05;

      // Intro 隐藏初态（总时长 ≤1.4s：0.95+0.4=1.35s）
      if (heroEn) g.set(heroEn, { autoAlpha: 0, y: 40, filter: "blur(12px)", letterSpacing: "0.18em" });
      if (rule) g.set(rule, { scaleX: 0 });
      g.set(heroChars, { yPercent: 110, rotate: 2 });
      if (metaItems.length) g.set(metaItems, { y: 18, autoAlpha: 0 });
      if (dateBig) g.set(dateBig, { autoAlpha: 0, y: 60 });
      if (hint) g.set(hint, { autoAlpha: 0 });

      g.timeline({ defaults: { ease: "power3.out" }, onComplete: markIntroDone })
        .to(
          heroEn,
          { autoAlpha: ghostA, y: 0, filter: "blur(0px)", letterSpacing: "0.02em", duration: 0.7, ease: "power2.out" },
          0,
        )
        .to(rule, { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, 0.15)
        .to(heroChars, { yPercent: 0, rotate: 0, duration: 0.6, stagger: 0.045 }, 0.3)
        .to(dateBig, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.55)
        .to(metaItems, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.06 }, 0.65)
        .to(hint, { autoAlpha: 1, duration: 0.4 }, 0.95);

      // 全部隐藏初态就位后解除预绘制遮蔽（head 启动脚本标记，见 kinetic.css）
      document.documentElement.removeAttribute("data-oct-pending");
      // 300ms 兜底先行、字体 swap 后到的场景：字体 settle 后按真实字形布局刷新触发器
      // （与 initResize 的防抖 refresh 同一模式；字体先就绪时多一次幂等 refresh，无害）
      (document as DocumentWithFonts).fonts?.ready.then(() => st?.refresh());
    } catch {
      degradeToStatic();
    }
  });
}

/** Navigation Timing 导航类型（"navigate" | "reload" | "back_forward" | "prerender"）；API 不可用时 null（判定按 referrer 兜底）。 */
function readNavigationType(): string | null {
  const entry = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return entry?.type ?? null;
}

/* ---- 时间线列表动效（原型 initListMotion；listCtx 随重渲染整体回收） ---- */

export function onListRendered(deferred: boolean): void {
  if (listCtx) {
    listCtx.revert();
    listCtx = null;
  }
  const g = gsap;
  const stl = st;
  if (!enabled || !g || !stl) return;
  const root = rootElement();
  if (!root) return;
  // 两段式主题切换：日期组头先行（delay .05），条目揭示 +120ms 跟进（原型 deferListMotion）
  const delay = deferred ? 0.12 : 0;
  try {
    // context 对象在回调首行登记：回调中途抛错时 catch 仍能 revert 已写入的隐藏初态
    g.context((self) => {
      listCtx = self;
      root.querySelectorAll<HTMLElement>(".k-day").forEach((day) => {
        const prog = day.querySelector<HTMLElement>(".k-progress");
        if (!prog) return;
        g.to(prog, {
          scaleY: 1,
          ease: "none",
          scrollTrigger: { trigger: day, start: "top 72%", end: "bottom 55%", scrub: 0.6 },
        });
      });
      root.querySelectorAll<HTMLElement>(".k-entry").forEach((entry) => {
        const meta = entry.querySelector<HTMLElement>(".k-meta");
        const media = entry.querySelector<HTMLElement>(".k-media");
        const art = entry.querySelector<HTMLElement>(".k-media-art");
        // T11（UI 票 #28）列表揭示瘦身：保留版画 clip 揭示——图片方向按版面交替
        // （A 左入 / B 右入，其余上入兜底；T7 紧凑行无媒体，media 为空时 clip 分支整体跳过）；
        // 标题拆字升起与摘要 clip 揭示已移除（静态直显，链接不再补 aria-label），
        // meta 仅余透明度淡入（原 letterSpacing 字距动画每帧触发布局，已删）。
        const clipFrom = entry.classList.contains("layout-a")
          ? "inset(0 100% 0 0)"
          : entry.classList.contains("layout-b")
            ? "inset(0 0 0 100%)"
            : "inset(0 0 100% 0)";
        if (meta) g.set(meta, { autoAlpha: 0 });
        if (media) {
          g.set(media, { clipPath: clipFrom });
          if (art) g.set(art, { scale: 1.08 });
        }
        const tl = g.timeline({ paused: true, defaults: { ease: "power3.out" } });
        if (meta) tl.to(meta, { autoAlpha: 1, duration: 0.3, ease: "power2.out" }, 0.14);
        if (media) {
          tl.to(media, { clipPath: "inset(0 0% 0 0)", duration: 0.9, ease: "power4.out" }, 0.1);
          if (art) tl.to(art, { scale: 1, duration: 0.9, ease: "power4.out" }, 0.1);
        }
        const gi = Number(entry.dataset.gi ?? 0);
        stl.create({
          trigger: entry,
          start: "top 85%",
          once: true,
          onEnter: () => {
            if (delay) g.delayedCall(delay, () => tl.play());
            else tl.play();
          },
        });
        stl.create({
          trigger: entry,
          start: "top 62%",
          end: "bottom 38%",
          toggleClass: { targets: entry, className: "is-active" },
          onToggle: (self: { isActive: boolean }) => {
            if (self.isActive) setHudIndex(gi);
            // UI 票 #11：变 inactive 且全页已无激活条目（如滚回顶部）→ NOW READING 归位 --
            else if (!root.querySelector(".k-entry.is-active")) setHudIdle();
          },
        });
      });
    }, root);
    stl.refresh();
  } catch {
    // 列表动效异常：回收本批触发器与隐藏初态，列表保持静态可读
    // （listCtx 在回调内登记，TS 流程分析视其为 null——显式宽化读取）
    const ctx = listCtx as GsapContext | null;
    if (ctx) {
      ctx.revert();
      listCtx = null;
    }
  }
}

/* ---- HUD NOW READING 序号滚动（原型 setHudIndex） ---- */

export function setHudIndex(gi: number): void {
  setHudText(pad2(gi + 1));
}

/**
 * NOW READING 归位（UI 票 #11 用户裁定，对原型的一次有意偏离）：
 * 节点激活 toggle 变为 inactive 且全页无激活条目（如滚回顶部）时显示 --，
 * 不保留上一个条目序号——顶部＝尚未开始阅读。
 */
export function setHudIdle(): void {
  setHudText("--");
}

function setHudText(text: string): void {
  const roll = document.querySelector<HTMLElement>("[data-rollin]");
  if (!roll) return;
  if (roll.textContent === text) return;
  if (!enabled || !gsap) {
    roll.textContent = text;
    return;
  }
  gsap.to(roll, {
    yPercent: -110,
    duration: 0.22,
    ease: "power2.in",
    onComplete: () => {
      roll.textContent = text;
      gsap!.fromTo(roll, { yPercent: 110 }, { yPercent: 0, duration: 0.26, ease: "power3.out" });
    },
  });
}

/* ---- 两段式主题切换（原型 setTopic：出 260ms blur+scale / 入 340ms） ---- */

export function animateTopicSwitch(render: () => void): void {
  const listEl = document.querySelector<HTMLElement>("[data-klist]");
  const html = document.documentElement;
  if (!enabled || !gsap || !listEl) {
    render();
    return;
  }
  html.setAttribute("data-oct-topic-anim", "");
  gsap.killTweensOf(listEl);
  gsap.to(listEl, {
    autoAlpha: 0,
    y: -16,
    scale: 0.985,
    filter: "blur(5px)",
    duration: 0.26,
    ease: "power2.in",
    onComplete: () => {
      render();
      const dayBigs = [...(rootElement()?.querySelectorAll<HTMLElement>(".k-day-big") ?? [])];
      if (dayBigs.length) {
        gsap!.fromTo(
          dayBigs,
          { y: 26, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.07, ease: "power3.out", delay: 0.05 },
        );
      }
      gsap!.fromTo(
        listEl,
        { autoAlpha: 0, y: 24, scale: 1.015, filter: "blur(5px)" },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.34,
          ease: "power3.out",
          onComplete: () => {
            gsap!.set(listEl, { clearProps: "filter" });
            html.removeAttribute("data-oct-topic-anim");
          },
        },
      );
    },
  });
}

/* ---- 主题指示器（原型 moveIndicator：GSAP x/width 补间或瞬时定位） ---- */

export function moveIndicator(targetTopic: string, instant: boolean): void {
  const indicator = document.querySelector<HTMLElement>("[data-indicator]");
  const tab = document.querySelector<HTMLElement>(`[data-ktabs] .tab[data-topic="${targetTopic}"]`);
  if (!indicator || !tab) return;
  if (!enabled || !gsap) {
    // 无动效：保持 Ticket 05 的瞬时定位语义
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
    return;
  }
  gsap.to(indicator, {
    x: tab.offsetLeft,
    width: tab.offsetWidth,
    duration: instant ? 0 : 0.45,
    ease: "power3.out",
  });
}

/* ---- 显示模式切换（原型 View Transition 径向 + skipTransition 兜底 + themefade 降级） ---- */

export function themeApplyMotion(apply: () => void, origin: Element | null): void {
  const root = rootElement();
  if (!enabled || !gsap) {
    apply();
    return;
  }
  const doc = document as DocumentWithVT;
  if (typeof doc.startViewTransition === "function") {
    if (origin) {
      const rect = origin.getBoundingClientRect();
      const htmlStyle = document.documentElement.style;
      htmlStyle.setProperty("--vt-x", `${rect.left + rect.width / 2}px`);
      htmlStyle.setProperty("--vt-y", `${rect.top + rect.height / 2}px`);
    }
    document.documentElement.setAttribute("data-vt", "");
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        document.documentElement.removeAttribute("data-vt");
      }
    };
    let vt: ViewTransitionLike;
    try {
      vt = doc.startViewTransition(apply);
    } catch {
      apply();
      done();
      return;
    }
    // 看门狗只管「ready 挂起」：渲染被抑制等异常时 ready 迟迟不 resolve，强制跳过避免整页动画停摆。
    // 摘除 data-vt 的动画收尾只属于 finished——ready 即摘除会让
    // html[data-vt]::view-transition-new(root) 在 vt-clip 起始帧失配、径向动画被取消，
    // 退化为 UA 默认 cross-fade（#19）。
    const timer = setTimeout(() => {
      if (!settled) {
        try {
          vt.skipTransition();
        } catch {
          // skipTransition 异常不阻断
        }
        done();
      }
    }, 250);
    vt.ready
      .then(() => {
        clearTimeout(timer);
      })
      .catch(() => {
        done();
        clearTimeout(timer);
      });
    vt.finished.then(done, done);
  } else if (root) {
    root.classList.add("k-themefade");
    apply();
    setTimeout(() => root.classList.remove("k-themefade"), 480);
  } else {
    apply();
  }
}

/** 主题切换后重同步 Hero ghost 透明度（--ghost-a 随场景 token 变化）。 */
export function syncHeroGhost(): void {
  const root = rootElement();
  if (!enabled || !gsap || !root || !heroEn) return;
  const ghostA = Number.parseFloat(getComputedStyle(root).getPropertyValue("--ghost-a")) || 0.05;
  gsap.set(heroEn, { opacity: ghostA });
}

/* ---- 全屏菜单动效（原型 openMenu/closeMenu；纯 opacity 不用 autoAlpha 保焦点） ---- */

export function menuOpenMotion(menu: HTMLDialogElement, closeButton: HTMLElement): void {
  const g = gsap;
  if (!enabled || !g) return;
  killMenuTl();
  const items = menu.querySelectorAll(".k-mi, .k-menu-topics .tab");
  menuTl = g
    .timeline()
    .fromTo(menu, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "power2.out" })
    .fromTo(
      items,
      { y: 60, rotate: 2, autoAlpha: 0 },
      { y: 0, rotate: 0, autoAlpha: 1, duration: 0.5, stagger: 0.05, ease: "power3.out" },
      "-=.1",
    );
  // 关闭按钮只做 opacity 淡入：autoAlpha 的 visibility:hidden 会让初始焦点失效
  g.fromTo(closeButton, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
}

/** 返回是否走了动画关闭（false = 无动效路径，调用方需立即 menu.close()）。 */
export function menuCloseMotion(menu: HTMLDialogElement, onClosed: () => void): boolean {
  const g = gsap;
  if (!enabled || !g) return false;
  killMenuTl();
  const items = menu.querySelectorAll(".k-mi, .k-menu-topics .tab");
  menuTl = g
    .timeline({ onComplete: onClosed })
    .to(items, { y: -40, autoAlpha: 0, duration: 0.28, stagger: 0.03, ease: "power2.in" })
    .to(menu, { opacity: 0, duration: 0.22, ease: "power2.in" }, "-=.08");
  return true;
}

function killMenuTl(): void {
  if (menuTl) {
    try {
      menuTl.kill();
    } catch {
      // 已回收的 timeline 重复 kill 不阻断
    }
  }
  menuTl = null;
}

/* ---- 自定义光标（原型 initCursor，仅 pointer:fine） ----
   UI 票 #12（用户裁定）：光标就绪时给根加 k-cursor-on 隐藏系统指针——自定义指针成为唯一指针；
   降级路径（reduced-motion / GSAP 失败 / 触屏）不加类，系统指针照常。
   UI 票 #14：反相混合已移到 .k-cursor 容器（写在子元素上会被容器自身的隔离组屏蔽），
   语义标签移出容器独立跟随以保住 accent 原色；语义分两档——
   内容入口 [data-cursor] 走完整态（圆环放大 + 语义标签），次级控件 [data-cursor-soft] 走轻量态
   （圆环轻微放大、不显示标签），未标记元素回到静止态。 */

function initCursor(root: HTMLElement): void {
  if (!window.matchMedia(FINE_POINTER_QUERY).matches) return;
  const cursor = root.querySelector<HTMLElement>("[data-kcursor]");
  const dot = root.querySelector<HTMLElement>("[data-kcursor-dot]");
  const ringEl = root.querySelector<HTMLElement>("[data-kcursor-ring]");
  const labelEl = root.querySelector<HTMLElement>("[data-kcursor-label]");
  if (!cursor || !dot || !ringEl || !labelEl) return;
  root.classList.add("k-cursor-on");
  // 标签是容器的兄弟元素（不在反相组内），自行居中——原先靠圆环的 grid 居中
  gsap!.set(labelEl, { xPercent: -50, yPercent: -50 });
  const dx = gsap!.quickTo(dot, "x", { duration: 0.1, ease: "power3" });
  const dy = gsap!.quickTo(dot, "y", { duration: 0.1, ease: "power3" });
  const rx = gsap!.quickTo(ringEl, "x", { duration: 0.38, ease: "power3" });
  const ry = gsap!.quickTo(ringEl, "y", { duration: 0.38, ease: "power3" });
  const lx = gsap!.quickTo(labelEl, "x", { duration: 0.38, ease: "power3" });
  const ly = gsap!.quickTo(labelEl, "y", { duration: 0.38, ease: "power3" });
  let shown = false;
  /**
   * 语义档位由「指针下的元素」决定，而不是只由 mouseover 事件决定。
   * 浏览器会在布局/动效变化后静默更新（或不更新）hover 节点却不派发 mouseover——实测入场揭示
   * 动效收尾时指针下已是版画但标签不亮；反向则表现为「指针已离开版画、标签仍显示 OPEN」的滞留。
   * 注意：此时连 mousemove 的 event.target 也取自那个陈旧的 hover 节点（实测 target 仍是版画），
   * 所以必须用 elementFromPoint 重新做一次命中测试。档位键去重避免每次移动都重启补间。
   */
  let tierKey: string | null = null;
  const applyTier = (target: Element | null) => {
    const full = target?.closest("[data-cursor]") ?? null;
    const label = full ? (full.getAttribute("data-cursor") ?? "") : "";
    const key = full ? `full:${label}` : target?.closest("[data-cursor-soft]") ? "soft" : "none";
    if (key === tierKey) return;
    tierKey = key;
    if (full) {
      labelEl.textContent = label;
      // 标签与圆环同步放大：标签已不在圆环内，不再继承圆环的 transform
      gsap!.to([ringEl, labelEl], { scale: CURSOR_FULL_SCALE, duration: 0.3, ease: "power3.out" });
      gsap!.to(labelEl, { autoAlpha: 1, duration: 0.2 });
      return;
    }
    gsap!.to(ringEl, {
      scale: key === "soft" ? CURSOR_SOFT_SCALE : 1,
      duration: 0.3,
      ease: "power3.out",
    });
    gsap!.to(labelEl, { scale: 1, autoAlpha: 0, duration: 0.15 });
  };
  /** 按视口坐标重新判定档位（不信任事件自带的 target）。 */
  const applyTierAt = (x: number, y: number) => applyTier(document.elementFromPoint(x, y));
  const onMove = (event: MouseEvent) => {
    if (!shown) {
      shown = true;
      gsap!.to(cursor, { autoAlpha: 1, duration: 0.25 });
    }
    dx(event.clientX);
    dy(event.clientY);
    rx(event.clientX);
    ry(event.clientY);
    lx(event.clientX);
    ly(event.clientY);
    applyTierAt(event.clientX, event.clientY);
  };
  const onOver = (event: MouseEvent) => applyTierAt(event.clientX, event.clientY);
  const onLeaveDoc = () => {
    shown = false;
    // 标签是容器的兄弟元素（UI 票 #14），必须与光标一起隐藏，否则语义态下移出窗口会留下悬空残影
    gsap!.to([cursor, labelEl], { autoAlpha: 0, duration: 0.2 });
  };
  document.addEventListener("mousemove", onMove, { passive: true });
  root.addEventListener("mouseover", onOver);
  document.documentElement.addEventListener("mouseleave", onLeaveDoc);
  // 页面失去焦点（切换窗口/应用）同样隐藏，避免指针冻结在页面上
  window.addEventListener("blur", onLeaveDoc);
  cleanups.push(() => {
    document.removeEventListener("mousemove", onMove);
    root.removeEventListener("mouseover", onOver);
    document.documentElement.removeEventListener("mouseleave", onLeaveDoc);
    window.removeEventListener("blur", onLeaveDoc);
    root.classList.remove("k-cursor-on");
    gsap!.killTweensOf([cursor, dot, ringEl, labelEl]);
  });
}

/* ---- resize：indicator 重定位 + ScrollTrigger 刷新（原型 onResize） ---- */

function initResize(root: HTMLElement): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const current = root.querySelector<HTMLElement>('[data-ktabs] .tab[aria-current="true"]');
      if (current?.dataset.topic) moveIndicator(current.dataset.topic, true);
      st?.refresh();
    }, 150);
  };
  window.addEventListener("resize", onResize);
  cleanups.push(() => {
    window.removeEventListener("resize", onResize);
    if (timer) clearTimeout(timer);
  });
}

/* ---- 无动效路径的全局进度（原型 !MOTION_OK 分支：圆环 + 百分比） ---- */

function startFallbackProgress(): void {
  const ring = document.querySelector<SVGCircleElement>("[data-ring]");
  const pctEl = document.querySelector<HTMLElement>("[data-readpct]");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    if (ring) ring.style.strokeDashoffset = String(RING_LENGTH * (1 - p));
    if (pctEl) pctEl.textContent = `${Math.round(p * 100)}%`;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  cleanups.push(() => window.removeEventListener("scroll", onScroll));
}

/** 整体回收（运行时异常退化用）：revert 全部上下文 + 监听器 + 补间。 */
function destroyMotion(): void {
  if (listCtx) {
    listCtx.revert();
    listCtx = null;
  }
  if (kineticCtx) {
    kineticCtx.revert();
    kineticCtx = null;
  }
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // 单个清理失败不阻断其余回收
    }
  }
  gsap?.killTweensOf("*");
}
