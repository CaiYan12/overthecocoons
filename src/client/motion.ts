/**
 * Kinetic 动效层（Ticket 06）：把原型 v-kinetic（docs/design/prototype-timeline.html）的 GSAP
 * 动效逐项移植到产品页。GSAP Core + ScrollTrigger 自托管于 public/vendor/（3.13.0，
 * BaseLayout 内 SRI 固定）加载；库脚本加载失败或 prefers-reduced-motion 时整体退化为
 * Ticket 05 静态可用状态
 * （内容直显、无隐藏初态、功能完整）。
 *
 * 结构对齐原型：
 * - kineticCtx：Hero Intro / Hero Parallax / Header Morph / 全局进度（进度条/圆环/百分比）/
 *   自定义光标 / 磁性 / tilt，页面生命周期内一次性建立；
 * - listCtx：时间线列表动效（进度线 scaleY scrub、节点激活 toggleClass、分层揭示），
 *   每次客户端重渲染整体 revert 重建（ScrollTrigger 无泄漏）；
 * - cleanups：事件监听器登记，运行时异常时统一回收并退化为无动效路径。
 *
 * 动效参数（duration/ease/阈值/延迟）逐项取自原型 JS；性能约束：只动 transform/opacity/
 * clip-path（filter 仅 blur 两处、letterSpacing 仅标题字符与元信息两处，均为一次性揭示）。
 * 测试挂钩（无行为含义）：html[data-oct-motion="on"|"off"]、html[data-oct-intro="done"]、
 * 两段式切换期间 html[data-oct-topic-anim]。
 */

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

/** 把元素文本拆为 span.kw > span.ch 遮罩字符（与原型 splitChars 一致，重复拆分幂等）。 */
function splitChars(el: Element): HTMLElement[] {
  const text = el.textContent ?? "";
  el.textContent = "";
  const frag = document.createDocumentFragment();
  const chars: HTMLElement[] = [];
  for (const ch of text) {
    const kw = document.createElement("span");
    kw.className = "kw";
    const c = document.createElement("span");
    c.className = "ch";
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
    destroyMotion();
    enabled = false;
    gsap = null;
    st = null;
    html.dataset.octMotion = "off";
    html.removeAttribute("data-oct-pending");
    markIntroDone();
    startFallbackProgress();
  }
}

function initMotionOn(root: HTMLElement): void {
  const html = document.documentElement;
  gsap!.registerPlugin(st);
  heroEn = root.querySelector<HTMLElement>("[data-heroen]");
  // context 对象在回调首行登记：任一初始化抛错时 catch 仍能 revert 全部隐藏初态
  gsap!.context((self) => {
    kineticCtx = self;
    initHeroAndHeader(root);
    initCursor(root);
    initMagnetic(root);
    initTilt(root);
  }, root);
  initResize(root);
  onListRendered(false);
  // 全部隐藏初态就位后解除预绘制遮蔽（head 启动脚本标记，见 kinetic.css）
  html.removeAttribute("data-oct-pending");
  requestAnimationFrame(() => st!.refresh());
}

/* ---- Hero Intro + Header Morph + 全局进度（原型 initHeroMotion + 全局 Trigger） ---- */

function initHeroAndHeader(root: HTMLElement): void {
  const g = gsap;
  const stl = st;
  if (!g || !stl) return;
  const hero = root.querySelector<HTMLElement>("[data-hero]");
  const header = root.querySelector<HTMLElement>("[data-kheader]");
  const ring = document.querySelector<SVGCircleElement>("[data-ring]");
  const pctEl = document.querySelector<HTMLElement>("[data-readpct]");
  const readbar = document.querySelector<HTMLElement>("[data-readbar]");
  const readbarSet = readbar ? g.quickSetter(readbar, "scaleX") : null;
  let headerShown = false;
  let lastPct = -1;

  // Header Morph：首屏隐藏由 GSAP yPercent 控制（CSS 不同时控制 transform）。
  // 显式 y:0 中和预绘制遮蔽期（data-oct-pending）遗留的 CSS translateY(-100%)——
  // 否则 GSAP 首次 set 会把已计算的 -68px 解析进 y 分量，与 yPercent:-100 叠加成 -136px，
  // 且 morph 补间只动 yPercent，header 将永远停在半隐藏位置。
  if (header) g.set(header, { y: 0, yPercent: -100 });
  stl.create({
    start: 0,
    end: "max",
    onUpdate: (self: { scroll(): number; progress: number }) => {
      const y = self.scroll();
      const show = y > HEADER_SHOW_AT;
      if (show !== headerShown) {
        headerShown = show;
        g.to(header, { yPercent: show ? 0 : -100, duration: 0.4, ease: "power3.out" });
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
    return;
  }

  const heroChars: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(".k-hero-title .line").forEach((line) => {
    heroChars.push(...splitChars(line));
  });
  const rule = root.querySelector<HTMLElement>("[data-herorule]");
  const metaItems = [...root.querySelectorAll<HTMLElement>("[data-herometa] li")];
  const dateBig = root.querySelector<HTMLElement>("[data-herodate]");
  const hint = root.querySelector<HTMLElement>("[data-hint]");
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

  // Hero Parallax（scrub，仅主要视觉层）
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
        const headlineLink = entry.querySelector<HTMLElement>(".k-headline a");
        const sum = entry.querySelector<HTMLElement>(".k-summary");
        const meta = entry.querySelector<HTMLElement>(".k-meta");
        const media = entry.querySelector<HTMLElement>(".k-media");
        const art = entry.querySelector<HTMLElement>(".k-media-art");
        // 动效词汇分化：图片揭示方向按版面交替（A 左入 / B 右入 / C 上入）
        const clipFrom = entry.classList.contains("layout-a")
          ? "inset(0 100% 0 0)"
          : entry.classList.contains("layout-b")
            ? "inset(0 0 0 100%)"
            : "inset(0 0 100% 0)";
        const chs = headlineLink ? splitChars(headlineLink) : [];
        if (chs.length) g.set(chs, { yPercent: 110, rotate: 2 });
        if (sum) g.set(sum, { clipPath: "inset(0 0 100% 0)" });
        if (meta) g.set(meta, { autoAlpha: 0, letterSpacing: ".2em" });
        if (media) {
          g.set(media, { clipPath: clipFrom });
          if (art) g.set(art, { scale: 1.08 });
        }
        const tl = g.timeline({ paused: true, defaults: { ease: "power3.out" } });
        if (chs.length) tl.to(chs, { yPercent: 0, rotate: 0, duration: 0.5, stagger: 0.02 }, 0);
        if (sum) tl.to(sum, { clipPath: "inset(0 0 0% 0)", duration: 0.42, ease: "power2.out" }, 0.08);
        if (meta) tl.to(meta, { autoAlpha: 1, letterSpacing: ".04em", duration: 0.3, ease: "power2.out" }, 0.14);
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
    // ready 未按时 resolve（渲染被抑制等异常）时强制跳过，避免整页动画停摆
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
        done();
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

/* ---- 磁性 UI（原型 initMagnetic，≤8px，elastic 回正；仅 pointer:fine） ---- */

function initMagnetic(root: HTMLElement): void {
  if (!window.matchMedia(FINE_POINTER_QUERY).matches) return;
  const elements: Element[] = [
    ...root.querySelectorAll(".k-tabs .tab"),
    root.querySelector("[data-mode]"),
    root.querySelector("[data-kmenu-open]"),
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

/* ---- 图片 3D Tilt（原型 initTilt，rotateX ≤±4° / rotateY ≤±5°；仅 pointer:fine） ---- */

function initTilt(root: HTMLElement): void {
  if (!window.matchMedia(FINE_POINTER_QUERY).matches) return;
  root.querySelectorAll<HTMLElement>(".k-media").forEach((media) => {
    const inner = media.querySelector<HTMLElement>(".k-media-tilt");
    const art = media.querySelector<HTMLElement>(".k-media-art");
    if (!inner || !art) return;
    const rX = gsap!.quickTo(inner, "rotationX", { duration: 0.4, ease: "power3" });
    const rY = gsap!.quickTo(inner, "rotationY", { duration: 0.4, ease: "power3" });
    const onMove = (event: MouseEvent) => {
      const rect = media.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      rX(py * -8);
      rY(px * 10);
    };
    const onEnter = () => gsap!.to(art, { scale: 1.05, duration: 0.45, ease: "power3.out" });
    const onLeave = () => {
      rX(0);
      rY(0);
      gsap!.to(art, { scale: 1, duration: 0.5, ease: "power3.out" });
    };
    media.addEventListener("mousemove", onMove, { passive: true });
    media.addEventListener("mouseenter", onEnter);
    media.addEventListener("mouseleave", onLeave);
    cleanups.push(() => {
      media.removeEventListener("mousemove", onMove);
      media.removeEventListener("mouseenter", onEnter);
      media.removeEventListener("mouseleave", onLeave);
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
