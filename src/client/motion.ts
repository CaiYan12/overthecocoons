/**
 * Kinetic 动效层（Ticket 06）：把原型 v-kinetic（docs/design/prototype-timeline.html）的 GSAP
 * 动效逐项移植到产品页。GSAP Core + ScrollTrigger 自托管于 public/vendor/（3.13.0，
 * BaseLayout 内 SRI 固定）加载；库脚本加载失败或 prefers-reduced-motion 时整体退化为
 * Ticket 05 静态可用状态
 * （内容直显、无隐藏初态、功能完整）。
 *
 * 结构对齐原型：
 * - kineticCtx：Hero Intro / Hero Parallax / Header Morph / 全局进度（进度条/圆环/百分比）/
 *   自定义光标 / 磁性，页面生命周期内一次性建立；
 * - listCtx：时间线列表动效（进度线 scaleY scrub、节点激活 toggleClass、分层揭示），
 *   图片 tilt / 局部高光，每次客户端重渲染整体 revert 重建（ScrollTrigger 无泄漏）；
 * - cleanups：事件监听器登记，运行时异常时统一回收并退化为无动效路径。
 *
 * 动效参数（duration/ease/阈值/延迟）逐项取自原型 JS；性能约束：只动 transform/opacity/
 * clip-path（filter 仅 blur 两处、letterSpacing 仅标题字符与元信息两处，均为一次性揭示）。
 * T14（UI 票 #31，维护者实机审查裁定 A）：T11/T13/T1/T8 的 Q5 减动效全面撤销，
 * 动效恢复到本轮优化前（a1ce4d5）形态——Hero 视差、版画 tilt、光标磁性、scroll hint 循环、
 * 列表标题拆字升起、摘要 clip + meta 字距揭示、逐日进度线 scaleY scrub 全部回归；
 * intro 撤销首次到达判定（T8 shouldPlayIntro 删除，ADR 0004 动效维度被 ADR 0006 取代），
 * 有 Hero 即播。丝线 B 版静态 rail（T13）保留，进度线叠合其上恢复 a1ce4d5 驱动。
 * 跨页过渡仍走原生 View Transition（@view-transition，样式见 kinetic.css），不经本模块。
 * T12（UI 票 #29）：Hero 拆字 intro 前等待自托管展示字体就绪（fonts.ready 与 300ms
 * 兜底竞速，见 scheduleIntro）——拆字 intro 不在字体替换后量错；其余路径不等字体。
 * 测试挂钩（无行为含义）：html[data-oct-motion="on"|"off"]、html[data-oct-intro="done"]、
 * 两段式切换期间 html[data-oct-topic-anim]。
 */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_POINTER_QUERY = "(pointer:fine)";
/** 原型圆环周长（r=26，2πr≈163.36 → 163.4）。 */
const RING_LENGTH = 163.4;
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
  progress(value: number): GsapTimeline;
  kill(): GsapTimeline;
}
interface Gsap {
  registerPlugin(plugin: unknown): void;
  set(target: TweenTarget, vars: TweenVars): void;
  to(target: TweenTarget, vars: TweenVars): void;
  fromTo(target: TweenTarget, fromVars: TweenVars, toVars: TweenVars): void;
  killTweensOf(target: TweenTarget, properties?: string): void;
  delayedCall(delay: number, callback: () => void): void;
  context(func: (self: GsapContext) => void, scope?: Element): GsapContext;
  timeline(vars?: TweenVars): GsapTimeline;
  quickSetter(target: TweenTarget, property: string): (value: number) => void;
  quickTo(target: TweenTarget, property: string, vars: TweenVars): (value: number, startValue?: number) => void;
  getProperty(target: Element, property: string): number | string | null;
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
export type { Gsap, GsapContext, ScrollTriggerPlugin };
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
const tiltCleanups: Array<() => void> = [];
const enteringMedia = new Set<HTMLElement>();
const mediaHoverTakeovers = new WeakMap<HTMLElement, () => void>();
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
 * 把元素文本拆为 span.kw > span.ch 遮罩字符（与原型 splitChars 等价，重复拆分幂等）。
 * T5 a11y（#22，审查修复）：拆出的 .kw/.ch 标 aria-hidden——读屏不逐字、按命名点完整词朗读。
 * 命名点只保留在语义元素上：T11（#28）起列表标题不再拆字（链接保持纯文本，可访问名即内容）；
 * Hero 的 .line 是 generic 角色（span 容器上 aria-label 属规范禁止项，读屏会忽略），
 * 命名点在 h1[data-herotitle]，由调用方在拆字清空前设置。
 * T13（UI 票 #30）：拆分按子节点递归——元素子节点（丝线静态挂点 .silk-anchor 及其内
 * aria-hidden SVG）保持结构原位，只拆其中的文本节点；纯文本行行为与原实现一致。
 * 二次拆分守卫：已存在 .ch（或文本为空）时跳过——同元素再次拆分不得重复包裹或置空 label。
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
  if (el.querySelector(".ch")) return [];
  const chars: HTMLElement[] = [];
  const splitNode = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 元素子节点（T13 .silk-anchor 及其内静态丝线 SVG）保持结构，递归拆其文本
      for (const child of [...node.childNodes]) splitNode(child);
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const frag = document.createDocumentFragment();
    for (const ch of node.textContent ?? "") {
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
    node.parentNode?.replaceChild(frag, node);
  };
  for (const child of [...el.childNodes]) splitNode(child);
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
  // 丝线 dash 残留清理：intro 隐藏初态若已写入（dash=长度）而补间未播，退化后丝线会不可见
  document.querySelectorAll<SVGPathElement>(".silk-static path").forEach((p) => {
    p.style.strokeDasharray = "";
    p.style.strokeDashoffset = "";
  });
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
    initMagnetic(root);
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
  const ring = document.querySelector<SVGCircleElement>("[data-ring]");
  const pctEl = document.querySelector<HTMLElement>("[data-readpct]");
  const readbar = document.querySelector<HTMLElement>("[data-readbar]");
  const readbarSet = readbar ? g.quickSetter(readbar, "scaleX") : null;
  let lastPct = -1;

  // Header 常态显示（维护者裁定）：全站 header 首屏可见、不随滚动隐藏——Header Morph 机制
  // （首屏 yPercent -100 + 84px 阈值显隐）退役，pending 遮蔽期的 header 规则一并移除。
  stl.create({
    start: 0,
    end: "max",
    onUpdate: (self: { scroll(): number; progress: number }) => {
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

  // T14（UI 票 #31）：T8 的首次到达判定（shouldPlayIntro，ADR 0004）撤销——维护者实机审查
  // 裁定 intro 每页重播（ADR 0006），有 Hero 即排程播放（data-oct-intro=done 标记语义不变：
  // 补间完成时打标）。T12 字体就绪等待（#29）保留。
  scheduleIntro(root, { rule, metaItems, dateBig, hint });

  // Hero Parallax（scrub，仅主要视觉层；a1ce4d5 参数直取）
  if (heroEn) {
    g.to(heroEn, {
      yPercent: 26,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.4 },
    });
  }
  if (dateBig) {
    g.to(dateBig, {
      yPercent: 60,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.4 },
    });
  }
  if (hint) {
    g.to(hint, {
      autoAlpha: 0,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "60% top", scrub: true },
    });
  }
  return true;
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
      // 丝线 draw-in（维护者裁定：茧下丝线要有动画）：intro 时自「茧」底画出——
      // 隐藏初态 dash=长度，时间线内 offset→0；no-JS/reduced-motion 路径不经过此处，
      // 丝线保持静态完整（CSS 摆动同样被 data-oct-motion 门控）。
      const silkPaths = [...root.querySelectorAll<SVGPathElement>(".silk-static path")];
      silkPaths.forEach((p) => {
        const len = p.getTotalLength();
        g.set(p, { strokeDasharray: len, strokeDashoffset: len });
      });
      const ghostA = heroEn
        ? Number.parseFloat(getComputedStyle(root).getPropertyValue("--ghost-a")) || 0.05
        : 0.05;

      // Intro 隐藏初态（总时长 ≈1.42s：hint 0.95+0.4；丝线 draw-in 0.5+0.12+0.8 收尾）
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
        .to(silkPaths, { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut", stagger: 0.12 }, 0.5)
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

/* ---- 时间线列表动效（原型 initListMotion；listCtx 随重渲染整体回收） ---- */

export function onListRendered(deferred: boolean): void {
  for (const cleanup of tiltCleanups.splice(0)) cleanup();
  enteringMedia.clear();
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
    // context 对象在回调首行登记：任一初始化抛错时 catch 仍能 revert 全部隐藏初态
    g.context((self) => {
      listCtx = self;
      // 列表替换后重建图片反馈，旧节点的监听器与补间一并回收；详情图共用相同反馈。
      initTilt(root);
      // T14（UI 票 #31）：逐日进度线 scaleY scrub 恢复（a1ce4d5 参数直取）——
      // 叠合于 rail 灰线（T14 追改：silk-rail 红线让位，进度线 accent 在灰线上可见）
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
        const headlineLink = entry.querySelector<HTMLElement>(".k-headline a");
        const sum = entry.querySelector<HTMLElement>(".k-summary");
        const meta = entry.querySelector<HTMLElement>(".k-meta");
        const media = entry.querySelector<HTMLElement>(".k-media");
        // 动效词汇分化：图片揭示方向按版面交替（A 左入 / B 右入，其余上入兜底；
        // T7 紧凑行无媒体，media 为空时 clip 分支整体跳过——拆字升起/摘要/meta 照常）
        const clipFrom = entry.classList.contains("layout-a")
          ? "inset(0 100% 0 0)"
          : entry.classList.contains("layout-b")
            ? "inset(0 0 0 100%)"
            : "inset(0 0 100% 0)";
        // T14：列表标题拆字升起恢复（T11 撤销）；splitChars 为 T13 递归版（T5 aria 语义保留：
        // 链接 a 命名点 + 字符 aria-hidden）
        const chs = headlineLink ? splitChars(headlineLink) : [];
        if (chs.length) g.set(chs, { yPercent: 110, rotate: 2 });
        if (sum) g.set(sum, { clipPath: "inset(0 0 100% 0)" });
        if (meta) g.set(meta, { autoAlpha: 0, letterSpacing: ".2em" });
        const tl = g.timeline({ paused: true, defaults: { ease: "power3.out" } });
        if (chs.length) tl.to(chs, { yPercent: 0, rotate: 0, duration: 0.5, stagger: 0.02 }, 0);
        if (sum) tl.to(sum, { clipPath: "inset(0 0 0% 0)", duration: 0.42, ease: "power2.out" }, 0.08);
        if (meta) tl.to(meta, { autoAlpha: 1, letterSpacing: ".04em", duration: 0.3, ease: "power2.out" }, 0.14);
        if (media) addMediaEntrance(g, tl, media, 0.1, clipFrom);
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

/** 列表与详情共用图片/投影入场及 hover 所有权；返回仅清除等待状态的回收函数。 */
export function addMediaEntrance(
  g: Gsap, timeline: GsapTimeline, media: HTMLElement, position = 0,
  clipFrom = "inset(0% 0% 100% 0%)",
): () => void {
  const art = media.querySelector<HTMLElement>(".k-media-art");
  enteringMedia.add(media);
  g.set(media, { clipPath: clipFrom, autoAlpha: 0 });
  if (art) g.set(art, { scale: 1.08 });
  const finish = () => {
    media.style.clipPath = "none";
    enteringMedia.delete(media);
    mediaHoverTakeovers.get(media)?.();
  };
  timeline.to(media, {
    // 百分比单位保持一致；负边界让阴影随图片渐显，而非最后一帧才露出。
    clipPath: "inset(-20% -20% -20% -20%)", autoAlpha: 1,
    duration: 0.9, ease: "power4.out", onComplete: art ? undefined : finish,
  }, position);
  if (art) timeline.to(art, { scale: 1, duration: 0.9, ease: "power4.out", onComplete: finish }, position);
  return () => { enteringMedia.delete(media); };
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
  if (!enabled || !gsap) {
    roll.textContent = text;
    return;
  }
  // 最新阅读位接管：取消旧退出/进入补间，连同其 onComplete，避免快速滚动时旧数字回写。
  gsap.killTweensOf(roll);
  // A→B→A（包括 --）：B 尚未换字时屏幕仍是 A，但 A 可能已部分退出，须回到可见位置。
  if (roll.textContent === text) {
    gsap.to(roll, { yPercent: 0, duration: 0.26, ease: "power3.out" });
    return;
  }
  // 始态/终态决定方向；-- 是首条之前的阅读位 0，减小序号时上下进出方向对调。
  const fromIndex = roll.textContent === "--" ? 0 : Number(roll.textContent);
  const toIndex = text === "--" ? 0 : Number(text);
  const exitYPercent = toIndex > fromIndex ? -110 : 110;
  gsap.to(roll, {
    yPercent: exitYPercent,
    duration: 0.22,
    ease: "power2.in",
    onComplete: () => {
      roll.textContent = text;
      gsap!.fromTo(roll, { yPercent: -exitYPercent }, { yPercent: 0, duration: 0.26, ease: "power3.out" });
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

/** 原生快照并非跨引擎可靠的实时光标画布。在过渡伪层绘制同一组 GSAP 坐标，
 * 避免正文裁剪、nav 遮挡、旧快照残影及 WebKit 快照未实时更新。仅切换期间更新。 */
function themeCursorFrame(): { draw: () => void; start: () => void; stop: () => void } {
  const cursor = document.querySelector<HTMLElement>("[data-kcursor]");
  const dot = document.querySelector<HTMLElement>("[data-kcursor-dot]");
  const ring = document.querySelector<HTMLElement>("[data-kcursor-ring]");
  const shape = document.querySelector<HTMLElement>("[data-kcursor-shape]");
  const label = document.querySelector<HTMLElement>("[data-kcursor-label]");
  if (!gsap || !cursor || !dot || !ring || !shape || !label || !window.matchMedia(FINE_POINTER_QUERY).matches) {
    return { draw() {}, start() {}, stop() {} };
  }
  const g = gsap;
  const html = document.documentElement;
  const value = (el: Element, property: string) => Number(g.getProperty(el, property));
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
  let frame = 0;
  let stopped = false;
  let previous = "";
  const draw = () => {
    if (stopped) return;
    const colors = getComputedStyle(html);
    const ink = colors.getPropertyValue("--ink").trim();
    const accent = colors.getPropertyValue("--accent").trim();
    const scale = value(ring, "scaleX");
    const angle = value(shape, "rotation") * Math.PI / 180;
    const sx = value(shape, "scaleX"), sy = value(shape, "scaleY");
    const matrix = [Math.cos(angle) * sx, Math.sin(angle) * sx, -Math.sin(angle) * sy, Math.cos(angle) * sy, 0, 0].join(" ");
    const textScale = value(label, "scaleX");
    // 用户裁定：立即使用目标主题墨色，不添加过渡专用双色边缘。
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}">`,
      `<g opacity="${value(cursor, "opacity")}">`,
      `<g transform="translate(${value(ring, "x")} ${value(ring, "y")}) matrix(${matrix})"><circle r="${18 * scale}" fill="none" stroke="${ink}" stroke-width="${2 * scale}"/></g>`,
      `<circle cx="${value(dot, "x")}" cy="${value(dot, "y")}" r="4" fill="${ink}"/></g>`,
      `<text x="${value(label, "x")}" y="${value(label, "y")}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="${9.5 * textScale}" letter-spacing="${1.71 * textScale}" fill="${accent}" opacity="${value(label, "opacity")}">${escape(label.textContent ?? "")}</text></svg>`,
    ].join("");
    if (svg !== previous) {
      previous = svg;
      html.style.setProperty("--vt-cursor-frame", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    }
  };
  const tick = () => {
    if (stopped) return;
    draw();
    frame = requestAnimationFrame(tick);
  };
  draw();
  return { draw, start: tick, stop: () => {
    stopped = true;
    cancelAnimationFrame(frame);
    html.style.removeProperty("--vt-cursor-frame");
  } };
}

let finishThemeTransition: (() => void) | null = null;
let refreshCursorTier: (() => void) | null = null;
let animateThemeCursor: (() => void) | null = null;

export function themeApplyMotion(apply: () => void, origin: Element | null): void {
  const root = rootElement();
  if (!enabled || !gsap) {
    apply();
    return;
  }
  const doc = document as DocumentWithVT;
  if (typeof doc.startViewTransition === "function") {
    finishThemeTransition?.();
    if (origin) {
      const rect = origin.getBoundingClientRect();
      const htmlStyle = document.documentElement.style;
      htmlStyle.setProperty("--vt-x", `${rect.left + rect.width / 2}px`);
      htmlStyle.setProperty("--vt-y", `${rect.top + rect.height / 2}px`);
    }
    document.documentElement.setAttribute("data-vt", "");
    const themeCursor = themeCursorFrame();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let vt: ViewTransitionLike | undefined;
    const done = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        themeCursor.stop();
        window.removeEventListener("pagehide", cancel);
        finishThemeTransition = null;
        document.documentElement.removeAttribute("data-vt");
        requestAnimationFrame(() => refreshCursorTier?.());
      }
    };
    const cancel = () => {
      try { vt?.skipTransition(); } catch { /* 取消异常不阻断回收。 */ } finally { done(); }
    };
    finishThemeTransition = cancel;
    window.addEventListener("pagehide", cancel);
    try {
      vt = doc.startViewTransition(() => { apply(); themeCursor.draw(); });
    } catch {
      apply();
      done();
      return;
    }
    // 看门狗只管「ready 挂起」：渲染被抑制等异常时 ready 迟迟不 resolve，强制跳过避免整页动画停摆。
    // 摘除 data-vt 的动画收尾只属于 finished——ready 即摘除会让
    // html[data-vt]::view-transition-new(root) 在 vt-clip 起始帧失配、径向动画被取消，
    // 退化为 UA 默认 cross-fade（#19）。
    timer = setTimeout(() => {
      if (!settled) {
        try {
          vt?.skipTransition();
        } catch {
          // skipTransition 异常不阻断
        }
        done();
      }
    }, 250);
    vt.ready
      .then(() => {
        clearTimeout(timer);
        if (!settled) { animateThemeCursor?.(); themeCursor.start(); }
      })
      .catch(() => {
        done();
        clearTimeout(timer);
      });
    vt.finished.then(done, done);
  } else if (root) {
    root.classList.add("k-themefade");
    apply();
    animateThemeCursor?.();
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

/* ---- 全屏菜单：不透明面板自顶部覆盖，原路上收；独立于旧全站减动效门控。 ---- */

/* 顶层迁址：showModal 的对话框处于浏览器 top layer，压过一切常规 z-index（--z-cursor:900
   也不例外），全屏菜单打开时光标整体被盖住不可见（用户审查发现）。打开时把光标两件套
   （.k-cursor + .k-cursor-label）迁入菜单元素内——菜单盒为全屏无 transform，fixed 定位
   坐标系与视口一致（坐标不漂）；菜单底为 --ink 深色，difference 混合照常反相可见。
   close 事件迁回原位（含非动画关闭与 Esc 路径）；可重入幂等。 */
let cursorTopLayerHome: Array<{ el: HTMLElement; parent: HTMLElement; next: ChildNode | null }> | null = null;
const cursorCloseHooked = new WeakSet<HTMLElement>();

function moveCursorIntoTopLayer(menu: HTMLElement): void {
  if (cursorTopLayerHome) return;
  const els = [
    document.querySelector<HTMLElement>(".k-cursor"),
    document.querySelector<HTMLElement>(".k-cursor-label"),
  ];
  cursorTopLayerHome = [];
  els.forEach((el) => {
    if (!el || !el.parentElement) return;
    cursorTopLayerHome!.push({ el, parent: el.parentElement, next: el.nextSibling });
    menu.appendChild(el);
  });
  if (!cursorCloseHooked.has(menu)) {
    menu.addEventListener("close", moveCursorBackFromTopLayer);
    cursorCloseHooked.add(menu);
  }
}

function moveCursorBackFromTopLayer(): void {
  if (!cursorTopLayerHome) return;
  [...cursorTopLayerHome].reverse().forEach(({ el, parent, next }) => {
    parent.insertBefore(el, next);
  });
  cursorTopLayerHome = null;
}

export function menuOpenMotion(menu: HTMLDialogElement, onOpened: () => void): boolean {
  const g = (window as MotionWindow).gsap;
  const surface = menu.querySelector<HTMLElement>(".k-menu-surface");
  if (!g || !surface) return false;
  killMenuTl();
  if (enabled) moveCursorIntoTopLayer(menu);
  const items = menu.querySelectorAll(".k-mi, .k-menu-data, .k-menu-topics");
  const duration = motionDuration(menu, "--motion-normal", 280);
  g.set(surface, { yPercent: -100, willChange: "transform" });
  g.set(items, { y: -12, opacity: 0 });
  menuTl = g
    .timeline({ onComplete: onOpened, onUpdate: () => syncMenuPointer(menu, surface) })
    .to(surface, { yPercent: 0, duration, ease: "power3.out" }, 0)
    .to(items, { y: 0, opacity: 1, duration: motionDuration(menu, "--motion-fast", 160),
      stagger: { amount: Math.max(0, duration - 0.08 - motionDuration(menu, "--motion-fast", 160)) }, ease: "power3.out" }, 0.08);
  return true;
}

/** 返回是否走了动画关闭（false = 无动效路径，调用方需立即 menu.close()）。 */
export function menuCloseMotion(menu: HTMLDialogElement, onClosed: () => void): boolean {
  const g = (window as MotionWindow).gsap;
  const surface = menu.querySelector<HTMLElement>(".k-menu-surface");
  if (!g || !surface) return false;
  killMenuTl();
  const items = menu.querySelectorAll(".k-mi, .k-menu-data, .k-menu-topics");
  g.set(surface, { willChange: "transform" });
  menuTl = g
    .timeline({ onComplete: onClosed, onUpdate: () => syncMenuPointer(menu, surface) })
    .to(items, { y: -12, opacity: 0, duration: motionDuration(menu, "--motion-fast", 160), ease: "power3.out" }, 0)
    .to(surface, { yPercent: -100, duration: motionDuration(menu, "--motion-normal", 280), ease: "power3.out" }, 0);
  return true;
}

function motionDuration(element: Element, token: string, fallback: number): number {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  const ms = Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  return (Number.isFinite(ms) && ms > 0 ? ms : fallback) / 1000;
}

function syncMenuPointer(menu: HTMLDialogElement, surface: HTMLElement): void {
  if (!enabled || !rootElement()?.classList.contains("k-cursor-on")) return;
  const dot = menu.querySelector<HTMLElement>("[data-kcursor-dot]");
  if (!dot) return;
  const rect = dot.getBoundingClientRect();
  const next = rect.top + rect.height / 2 >= surface.getBoundingClientRect().bottom ? "exposed" : "covered";
  if (menu.dataset.menuPointer !== next) menu.dataset.menuPointer = next;
}

/** 同步归位也适用于 GSAP 时钟暂停；回收不遗留隐藏样式或旧回调。 */
export function resetMenuMotion(menu: HTMLDialogElement, restoreCursor = true): void {
  killMenuTl();
  menu.removeAttribute("data-menu-pointer");
  const elements = menu.querySelectorAll<HTMLElement>(".k-menu-surface, .k-mi, .k-menu-data, .k-menu-topics");
  // 取消独立 set 补间；父时钟恢复时它们不能再次写回入场初态。
  (window as MotionWindow).gsap?.killTweensOf(elements);
  // clearProps 同时使 GSAP 的 transform 缓存失效；显式 render 不依赖父时钟。
  (window as MotionWindow).gsap?.timeline({ paused: true })
    .to(elements, { clearProps: "transform,opacity,visibility,willChange", duration: 0.001 }).progress(1).kill();
  elements.forEach((el) => {
    for (const property of ["transform", "opacity", "visibility", "will-change"]) el.style.removeProperty(property);
  });
  if (restoreCursor) moveCursorBackFromTopLayer();
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

/* ---- 来源选择面板（Issue #34）：桌面居中轻抬淡入 / 手机底部上拉，280ms 对称进退 ----
   与 MENU 同族编排：外壳 dialog 不参与 transform（顶层定位稳定），位移只作用在
   .k-source-surface；内容（头/选项/提示/操作）160ms 轻显现 + 短错峰。
   关闭沿原路反向并可被打开中断（kill 旧 timeline）；减弱动态/缺库时返回 false，
   调用方立即完成（不创建任何补间，键盘操作不等待逐项显现）。 */
let sourceTl: { kill(): void } | null = null;

function killSourceTl(): void {
  if (sourceTl) {
    try {
      sourceTl.kill();
    } catch {
      // 已回收的 timeline 重复 kill 不阻断
    }
  }
  sourceTl = null;
}

function sourceMotionParts(dialog: HTMLDialogElement): {
  surface: HTMLElement;
  items: Element[];
} | null {
  const surface = dialog.querySelector<HTMLElement>(".k-source-surface");
  if (!surface) return null;
  const items = [
    ...dialog.querySelectorAll(".k-source-head, .k-source-all, .k-source-option, .k-source-note, .k-source-actions"),
  ];
  return { surface, items };
}

/** 打开动效：返回是否走了动画（false = 调用方立即完成）。 */
export function sourcePanelOpenMotion(dialog: HTMLDialogElement, onOpened: () => void): boolean {
  const g = (window as MotionWindow).gsap;
  if (!g || !enabled) return false;
  const parts = sourceMotionParts(dialog);
  if (!parts) return false;
  const { surface, items } = parts;
  killSourceTl();
  moveCursorIntoTopLayer(dialog);
  const duration = motionDuration(dialog, "--motion-normal", 280);
  const fast = motionDuration(dialog, "--motion-fast", 160);
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  if (mobile) g.set(surface, { yPercent: 100, opacity: 1, willChange: "transform" });
  else g.set(surface, { y: 12, scale: 0.985, autoAlpha: 0, willChange: "transform,opacity" });
  g.set(items, { y: 8, opacity: 0 });
  sourceTl = g
    .timeline({ onComplete: onOpened })
    .to(
      surface,
      mobile
        ? { yPercent: 0, duration, ease: "power3.out" }
        : { y: 0, scale: 1, autoAlpha: 1, duration, ease: "power3.out" },
      0,
    )
    .to(items, {
      y: 0,
      opacity: 1,
      duration: fast,
      stagger: { amount: Math.min(0.08, Math.max(0, duration - fast)) },
      ease: "power3.out",
    }, 0.04);
  return true;
}

/** 关闭动效：返回是否走了动画（false = 调用方立即关闭）。 */
export function sourcePanelCloseMotion(dialog: HTMLDialogElement, onClosed: () => void): boolean {
  const g = (window as MotionWindow).gsap;
  if (!g || !enabled) return false;
  const parts = sourceMotionParts(dialog);
  if (!parts) return false;
  const { surface, items } = parts;
  killSourceTl();
  const duration = motionDuration(dialog, "--motion-normal", 280);
  const fast = motionDuration(dialog, "--motion-fast", 160);
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  g.set(surface, { willChange: "transform" });
  sourceTl = g
    .timeline({ onComplete: onClosed })
    .to(items, { y: 8, opacity: 0, duration: fast, ease: "power3.out" }, 0)
    .to(
      surface,
      mobile
        ? { yPercent: 100, duration, ease: "power3.out" }
        : { y: 12, scale: 0.985, autoAlpha: 0, duration, ease: "power3.out" },
      0,
    );
  return true;
}

/** 同步归位也适用于 GSAP 时钟暂停；回收不遗留隐藏样式或旧回调。 */
export function resetSourcePanelMotion(dialog: HTMLDialogElement, restoreCursor = true): void {
  killSourceTl();
  const elements = [
    ...dialog.querySelectorAll<HTMLElement>(".k-source-surface, .k-source-head, .k-source-all, .k-source-option, .k-source-note, .k-source-actions"),
  ];
  (window as MotionWindow).gsap?.killTweensOf(elements);
  // clearProps 同时使 GSAP 的 transform 缓存失效；显式 progress(1) 不依赖父时钟（停钟场景）。
  (window as MotionWindow).gsap?.timeline({ paused: true })
    .to(elements, { clearProps: "transform,opacity,visibility,willChange", duration: 0.001 }).progress(1).kill();
  elements.forEach((el) => {
    for (const property of ["transform", "opacity", "visibility", "will-change"]) el.style.removeProperty(property);
  });
  if (restoreCursor) moveCursorBackFromTopLayer();
}

/* ---- 自定义光标（原型 initCursor，仅 pointer:fine） ----
   UI 票 #12（用户裁定）：光标就绪时给根加 k-cursor-on 隐藏系统指针——自定义指针成为唯一指针；
   降级路径（reduced-motion / GSAP 失败 / 触屏）不加类，系统指针照常。
   UI 票 #14：反相混合已移到 .k-cursor 容器（写在子元素上会被容器自身的隔离组屏蔽），
   语义标签移出容器独立跟随以保住 accent 原色；语义分两档——
   文字链接统一 [data-cursor=LINK]，版画保留 OPEN，均走完整态（圆环放大 + 语义标签）；
   按钮与滚动条 [data-cursor-soft] 继续走轻量态
   （圆环轻微放大、不显示标签），未标记元素回到静止态。 */

function initCursor(root: HTMLElement): void {
  if (!window.matchMedia(FINE_POINTER_QUERY).matches) return;
  const cursor = root.querySelector<HTMLElement>("[data-kcursor]");
  const dot = root.querySelector<HTMLElement>("[data-kcursor-dot]");
  const ringEl = root.querySelector<HTMLElement>("[data-kcursor-ring]");
  const shape = root.querySelector<HTMLElement>("[data-kcursor-shape]");
  const labelEl = root.querySelector<HTMLElement>("[data-kcursor-label]");
  if (!cursor || !dot || !ringEl || !shape || !labelEl) return;
  let themeTl: GsapTimeline | null = null;
  let themeTimer: ReturnType<typeof setTimeout> | undefined;
  const resetThemeMorph = () => {
    clearTimeout(themeTimer);
    themeTl?.kill();
    themeTl = null;
    gsap!.killTweensOf(shape);
    // 强制clearProps同时回收变换缓存，父时钟暂停／恢复也不会复活旧形变。
    gsap!.timeline({ paused: true }).to(shape, { clearProps: "transform", duration: 0.001 }).progress(1).kill();
    shape.style.removeProperty("transform");
  };
  animateThemeCursor = () => {
    if (!root.classList.contains("k-cursor-on")) return;
    clearTimeout(themeTimer);
    themeTl?.kill(); // 保留当前姿态，新点击从当前值接管。
    const duration = motionDuration(root, "--motion-normal", 280);
    const press = Math.min(0.1, duration / 2);
    themeTl = gsap!.timeline({ onComplete: resetThemeMorph })
      .to(shape, { scaleX: 1.14, scaleY: 0.86, rotation: document.documentElement.dataset.theme === "dark" ? -12 : 12,
        duration: press, ease: "power3.out" })
      .to(shape, { scaleX: 1, scaleY: 1, rotation: 0, duration: duration - press, ease: "back.out(1.7)" });
    themeTimer = setTimeout(resetThemeMorph, 1000);
  };
  window.addEventListener("pagehide", resetThemeMorph);
  // 坐标尚未知时保留系统指针；首次真实移动定位完成后才接管，避免换页后指针消失。
  // 标签是容器的兄弟元素（不在反相组内），自行居中——原先靠圆环的 grid 居中
  gsap!.set(labelEl, { xPercent: -50, yPercent: -50 });
  const dx = gsap!.quickTo(dot, "x", { duration: 0.1, ease: "power3" });
  const dy = gsap!.quickTo(dot, "y", { duration: 0.1, ease: "power3" });
  const rx = gsap!.quickTo(ringEl, "x", { duration: 0.38, ease: "power3" });
  const ry = gsap!.quickTo(ringEl, "y", { duration: 0.38, ease: "power3" });
  const lx = gsap!.quickTo(labelEl, "x", { duration: 0.38, ease: "power3" });
  const ly = gsap!.quickTo(labelEl, "y", { duration: 0.38, ease: "power3" });
  let shown = false;
  let pointerX = 0;
  let pointerY = 0;
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
      gsap!.to([ringEl, labelEl], { scale: CURSOR_FULL_SCALE, duration: 0.3, ease: "power3.out", overwrite: "auto" });
      gsap!.to(labelEl, { autoAlpha: 1, duration: 0.2, overwrite: "auto" });
      return;
    }
    gsap!.to(ringEl, {
      scale: key === "soft" ? CURSOR_SOFT_SCALE : 1,
      duration: 0.3,
      ease: "power3.out",
      overwrite: "auto",
    });
    gsap!.to(labelEl, { scale: 1, autoAlpha: 0, duration: 0.15, overwrite: "auto" });
  };
  /** 按视口坐标重新判定档位（不信任事件自带的 target）。 */
  const applyTierAt = (x: number, y: number) => {
    const target = document.querySelector("[data-scrollbar][data-dragging]") ?? document.elementFromPoint(x, y);
    // Chromium 在文档快照期间可能只命中 html：未知命中不能清空现有光标档位。
    if (document.documentElement.hasAttribute("data-vt") && target === document.documentElement) return;
    applyTier(target);
  };
  refreshCursorTier = () => { if (shown) applyTierAt(pointerX, pointerY); };
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    const first = !shown;
    const instant = first || Boolean(document.querySelector("[data-scrollbar][data-dragging]"));
    if (!shown) {
      shown = true;
      tierKey = null;
      gsap!.killTweensOf([cursor, labelEl], "opacity,visibility");
      gsap!.set(labelEl, { autoAlpha: 0 });
    }
    // quickTo 缓存起点：首次接管显式给同一坐标，不能从新页默认原点飞入。
    dx(event.clientX, instant ? event.clientX : undefined);
    dy(event.clientY, instant ? event.clientY : undefined);
    rx(event.clientX, instant ? event.clientX : undefined);
    ry(event.clientY, instant ? event.clientY : undefined);
    lx(event.clientX, instant ? event.clientX : undefined);
    ly(event.clientY, instant ? event.clientY : undefined);
    if (first) {
      gsap!.set(cursor, { autoAlpha: 1 });
      root.classList.add("k-cursor-on");
    }
    applyTierAt(event.clientX, event.clientY);
  };
  const onOver = (event: MouseEvent) => { if (shown) applyTierAt(event.clientX, event.clientY); };
  const onLeaveDoc = () => {
    resetThemeMorph();
    shown = false;
    tierKey = null;
    root.classList.remove("k-cursor-on");
    // 标签是容器的兄弟元素（UI 票 #14），必须与光标一起隐藏，否则语义态下移出窗口会留下悬空残影
    gsap!.to([cursor, labelEl], { autoAlpha: 0, duration: 0.2, overwrite: "auto" });
  };
  // pointerdown.preventDefault 会抑制兼容mousemove；捕获拖拽仍派发pointermove。
  document.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("mouseover", onOver);
  document.documentElement.addEventListener("mouseleave", onLeaveDoc);
  // 页面失去焦点（切换窗口/应用）同样隐藏，避免指针冻结在页面上
  window.addEventListener("blur", onLeaveDoc);
  cleanups.push(() => {
    document.removeEventListener("pointermove", onMove);
    root.removeEventListener("mouseover", onOver);
    document.documentElement.removeEventListener("mouseleave", onLeaveDoc);
    window.removeEventListener("blur", onLeaveDoc);
    root.classList.remove("k-cursor-on");
    gsap!.killTweensOf([cursor, dot, ringEl, labelEl]);
    refreshCursorTier = null;
    animateThemeCursor = null;
    window.removeEventListener("pagehide", resetThemeMorph);
    resetThemeMorph();
  });
}

/* ---- 磁性 UI（原型 initMagnetic，≤8px，elastic 回正；仅 pointer:fine；T14 恢复） ---- */

function initMagnetic(root: HTMLElement): void {
  if (!window.matchMedia(FINE_POINTER_QUERY).matches) return;
  // T14 追改（2026-10-07，用户裁定「暂时先注释」）：header.k-header 内部菜单项与按钮
  // （.k-tabs .tab / [data-mode] / [data-kmenu-open]）的磁吸暂注释——恢复时取消注释三行即可。
  // .k-top 在 header 之外，磁吸保留。
  const elements: Element[] = [
    // ...root.querySelectorAll(".k-tabs .tab"),
    // root.querySelector("[data-mode]"),
    // root.querySelector("[data-kmenu-open]"),
    root.querySelector("[data-ktop]"),
  ].filter((el): el is Element => el !== null);
  for (const el of elements) {
    const target = el as HTMLElement;
    const mx = gsap!.quickTo(target, "x", { duration: 0.3, ease: "power3" });
    const my = gsap!.quickTo(target, "y", { duration: 0.3, ease: "power3" });
    const onMove = (event: MouseEvent) => {
      const rect = target.getBoundingClientRect();
      mx(Math.max(-8, Math.min(8, (event.clientX - rect.left - rect.width / 2) * 0.3)));
      my(Math.max(-8, Math.min(8, (event.clientY - rect.top - rect.height / 2) * 0.3)));
    };
    const onLeave = () => gsap!.to(target, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1,.4)" });
    target.addEventListener("mousemove", onMove, { passive: true });
    target.addEventListener("mouseleave", onLeave);
    cleanups.push(() => {
      target.removeEventListener("mousemove", onMove);
      target.removeEventListener("mouseleave", onLeave);
      gsap!.killTweensOf(target);
    });
  }
}

/* ---- 图片 3D Tilt（原型 initTilt，rotateX ≤±4° / rotateY ≤±5°；仅 pointer:fine；T14 恢复） ---- */

function initTilt(root: HTMLElement): void {
  const hoverQuery = window.matchMedia("(hover: hover)");
  const fineQuery = window.matchMedia(FINE_POINTER_QUERY);
  const reducedQuery = window.matchMedia(REDUCED_QUERY);
  if (!hoverQuery.matches || !fineQuery.matches) return;
  root.querySelectorAll<HTMLElement>(".k-media").forEach((media) => {
    const inner = media.querySelector<HTMLElement>(".k-media-tilt");
    const art = media.querySelector<HTMLElement>(".k-media-art");
    if (!inner || !art) return;
    // 时间线与详情共用光斑；直接移动独立装饰层，不重绘渐变或修改图片几何尺寸。
    const glow = document.createElement("span");
    glow.className = "k-media-glow";
    art.append(glow);
    const rX = gsap!.quickTo(inner, "rotationX", { duration: 0.4, ease: "power3" });
    const rY = gsap!.quickTo(inner, "rotationY", { duration: 0.4, ease: "power3" });
    let hovering = false;
    let lastPointer: PointerEvent | null = null;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !hoverQuery.matches || !fineQuery.matches || reducedQuery.matches) return;
      lastPointer = event;
      if (enteringMedia.has(media)) return;
      hovering = true;
      const rect = media.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      rX(py * -8);
      rY(px * 10);
      const face = art.getBoundingClientRect();
      const x = (event.clientX - face.left) * art.offsetWidth / face.width;
      const y = (event.clientY - face.top) * art.offsetHeight / face.height;
      glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      media.classList.add("is-media-hover");
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !hoverQuery.matches || !fineQuery.matches || reducedQuery.matches) return;
      onMove(event);
      if (!hovering) return;
      gsap!.to(art, { scale: 1.05, duration: 0.45, ease: "power3.out" });
    };
    const onLeave = () => {
      lastPointer = null;
      if (!hovering) return;
      hovering = false;
      media.classList.remove("is-media-hover");
      rX(0);
      rY(0);
      gsap!.to(art, { scale: 1, duration: 0.5, ease: "power3.out" });
    };
    mediaHoverTakeovers.set(media, () => {
      // 入场期间指针可能已静止；重新命中实际画面后接管，避免要求用户再次移入。
      if (lastPointer && media.contains(document.elementFromPoint(lastPointer.clientX, lastPointer.clientY))) {
        onEnter(lastPointer);
      }
    });
    media.addEventListener("pointermove", onMove, { passive: true });
    media.addEventListener("pointerenter", onEnter);
    media.addEventListener("pointerleave", onLeave);
    media.addEventListener("pointercancel", onLeave);
    window.addEventListener("blur", onLeave);
    hoverQuery.addEventListener("change", onLeave);
    fineQuery.addEventListener("change", onLeave);
    reducedQuery.addEventListener("change", onLeave);
    tiltCleanups.push(() => {
      media.removeEventListener("pointermove", onMove);
      media.removeEventListener("pointerenter", onEnter);
      media.removeEventListener("pointerleave", onLeave);
      media.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("blur", onLeave);
      hoverQuery.removeEventListener("change", onLeave);
      fineQuery.removeEventListener("change", onLeave);
      reducedQuery.removeEventListener("change", onLeave);
      media.classList.remove("is-media-hover");
      mediaHoverTakeovers.delete(media);
      glow.remove();
      gsap!.killTweensOf([inner, art]);
    });
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
  for (const cleanup of tiltCleanups.splice(0)) cleanup();
  enteringMedia.clear();
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
