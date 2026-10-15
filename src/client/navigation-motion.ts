import type { Gsap, GsapContext, ScrollTriggerPlugin } from "./motion.ts";

interface NavigationWindow extends Window {
  gsap?: Gsap;
  ScrollTrigger?: ScrollTriggerPlugin;
}
interface Chapter {
  link: HTMLAnchorElement;
  section: HTMLElement;
  meter: HTMLElement;
  start: number;
}

/** 页面语义保持稳定：全站轨线表示阅读进度，目录单独跟踪正文章节。 */
export function initNavigationMotion(): void {
  const nav = document.querySelector<HTMLElement>("[data-knav]");
  const toc = document.querySelector<HTMLElement>("[data-toc]");
  if (!nav && !toc) return;
  const html = document.documentElement;
  const sdk = window as NavigationWindow;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const rail = nav?.querySelector<HTMLElement>("[data-nav-progress]") ?? null;
  const tocRail = toc?.querySelector<HTMLElement>("[data-toc-progress]") ?? null;
  const rails = [rail, tocRail].filter((element): element is HTMLElement => element !== null);
  const navMarker = nav?.querySelector<HTMLElement>("[data-kmarker]") ?? null;
  const currentPage = nav?.querySelector<HTMLElement>("[aria-current=page]") ?? null;
  const marker = toc?.querySelector<HTMLElement>("[data-toc-marker]") ?? null;
  const panel = toc?.closest<HTMLElement>(".k-toccol") ?? null;
  const chapters: Chapter[] = [];
  const collectChapters = () => {
    chapters.length = 0;
    toc?.querySelectorAll<HTMLAnchorElement>("a[href^='#']").forEach((link) => {
      const section = document.getElementById(link.getAttribute("href")!.slice(1));
      const meter = link.querySelector<HTMLElement>(".k-toc-meter");
      if (section && meter) chapters.push({ link, section, meter, start: 0 });
    });
    active = -1;
  };
  let context: GsapContext | null = null;
  let entranceObserver: IntersectionObserver | null = null;
  // 若启动兜底已直显目录，迟到的模块不能再把可读内容藏起来。
  let entranceDone = !html.hasAttribute("data-oct-toc-pending");
  let departure: { kill(): void } | null = null;
  let destination: string | null = null;
  let navigationTimer: ReturnType<typeof setTimeout> | null = null;
  const finishDeparture = () => {
    if (navigationTimer !== null) clearTimeout(navigationTimer);
    navigationTimer = null;
    const href = destination;
    destination = null;
    departure?.kill();
    departure = null;
    if (href) location.assign(href);
  };
  const cancelDeparture = (restoreMotion = false) => {
    if (navigationTimer !== null) clearTimeout(navigationTimer);
    navigationTimer = null;
    destination = null;
    departure?.kill();
    departure = null;
    if (panel) {
      if (restoreMotion && sdk.gsap && !reduced.matches && html.dataset.octMotion === "on") {
        sdk.gsap.to(panel, { opacity: 1, y: 0, duration: 0.24, ease: "power3.out", overwrite: true, clearProps: "opacity,transform" });
      } else sdk.gsap?.set(panel, { clearProps: "opacity,transform" });
    }
  };
  const stopEntranceObserver = () => {
    entranceObserver?.disconnect();
    entranceObserver = null;
  };
  let active = -1;
  let paintRail: (value: number, instant: boolean) => void = () => {};
  let paintMarker: (value: number, instant: boolean) => void = () => {};
  let paintMeters: (index: number, value: number, instant: boolean) => void = () => {};
  let paintNav: (value: number, instant: boolean) => void = () => {};

  const measure = () => {
    const guide = (document.querySelector("[data-kheader]")?.getBoundingClientRect().bottom ?? 68) + 32;
    chapters.forEach((chapter) => { chapter.start = chapter.section.getBoundingClientRect().top + scrollY - guide; });
  };
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const render = (instant = false) => {
    // 时间线主题切换会缩放整个列表；日期坐标要按当前真实几何读取，不能沿用过渡中的缓存。
    if (toc?.hasAttribute("data-timeline-toc")) measure();
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    paintRail(max ? clamp(scrollY / max) : 0, instant);
    if (!chapters.length) return;
    const atEnd = max > 0 && scrollY >= max - 1;
    let index = 0;
    // 原生锚点滚动按整 CSS 像素落定，标题几何仍可带小数（实测92.203px）。
    chapters.forEach((chapter, i) => { if (scrollY + 1 >= chapter.start) index = i; });
    if (atEnd) index = chapters.length - 1;
    const chapter = chapters[index]!;
    const end = Math.min(chapters[index + 1]?.start ?? max, max);
    const progress = atEnd ? 1 : clamp((scrollY - chapter.start) / Math.max(1, end - chapter.start));
    const changed = index !== active;
    if (changed) {
      chapters.forEach(({ link }, i) => {
        if (i === index) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
      active = index;
    }
    paintMarker(chapter.link.offsetTop + chapter.link.offsetHeight / 2, instant);
    paintMeters(index, progress, instant);
  };

  const staticPainters = () => {
    paintRail = (value) => rails.forEach((element) => { element.style.opacity = "1"; element.style.transform = `scaleY(${value})`; });
    paintMarker = (value) => { if (marker) { marker.style.opacity = "1"; marker.style.transform = `translateY(${value}px) translateY(-50%)`; } };
    paintMeters = (index, value) => chapters.forEach((chapter, i) => { chapter.meter.style.transform = `scaleX(${i === index ? value : 0})`; });
    paintNav = (value) => { if (navMarker) navMarker.style.transform = `translateY(${value}px) translateY(-50%)`; };
  };
  const configure = () => {
    // 切换减动效时仍完成已经选择的页面导航。
    if (destination) { finishDeparture(); return; }
    stopEntranceObserver();
    if (navMarker) sdk.gsap?.killTweensOf(navMarker);
    context?.revert();
    context = null;
    staticPainters();
    measure();
    const g = sdk.gsap;
    const st = sdk.ScrollTrigger;
    // 已经直显的降级路径恢复动效时，不把可读目录重新藏起来。
    if (reduced.matches || html.dataset.octMotion !== "on" || !g || !st) entranceDone = true;
    if (!reduced.matches && html.dataset.octMotion === "on" && g && st) {
      try {
        g.context((self) => {
          context = self;
          // 整组入场让标题、轨线与圆点保持相对位置；观察可见区域也覆盖侧栏内部滚动。
          if (panel && !entranceDone && typeof IntersectionObserver !== "undefined") {
            const entrance = g.timeline({ paused: true, onStart: () => { entranceDone = true; } })
              .fromTo(panel, { opacity: 0, y: -12 }, {
                opacity: 1, y: 0, duration: 0.24, ease: "power3.out", clearProps: "opacity,transform",
              });
            entranceObserver = new IntersectionObserver((entries) => {
              if (!entries.some((entry) => entry.isIntersecting)) return;
              stopEntranceObserver();
              entrance.play();
            });
            entranceObserver.observe(panel);
          }
          const railMoves = rails.map((element) => {
            g.set(element, { opacity: 1 });
            return g.quickTo(element, "scaleY", { duration: 0.18, ease: "power3.out" });
          });
          paintRail = (value, instant) => railMoves.forEach((move) => move(value, instant ? value : undefined));
          if (marker) {
            g.set(marker, { opacity: 1, yPercent: -50 });
            const move = g.quickTo(marker, "y", { duration: 0.24, ease: "power3.out" });
            paintMarker = (value, instant) => move(value, instant ? value : undefined);
          }
          const meters = chapters.map(({ meter }) => g.quickTo(meter, "scaleX", { duration: 0.18, ease: "power3.out" }));
          paintMeters = (index, value, instant) => chapters.forEach((_, i) => {
            const progress = i === index ? value : 0;
            meters[i]!(progress, instant ? progress : undefined);
          });
          if (navMarker) {
            g.set(navMarker, { yPercent: -50 });
            paintNav = (value, instant) => {
              g.killTweensOf(navMarker);
              if (instant) g.set(navMarker, { y: value });
              else g.to(navMarker, { y: value, duration: 0.22, ease: "power3.out", overwrite: true });
            };
          }
          st.create({ start: 0, end: "max", onUpdate: () => render(), onRefresh: () => { measure(); render(); } });
        }, document.querySelector("[data-kinetic]") ?? undefined);
      } catch {
        stopEntranceObserver();
        const failed = context as GsapContext | null;
        failed?.revert();
        context = null;
        staticPainters();
      }
    }
    render(true);
    paintNav(0, true);
    html.removeAttribute("data-oct-toc-pending");
  };
  collectChapters();
  configure();
  const list = document.querySelector<HTMLElement>("[data-klist]");
  if (toc?.hasAttribute("data-timeline-toc") && list) {
    // 只观察日期组根节点替换，不观察 GSAP 拆字／样式，避免动画触发目录重建。
    new MutationObserver(() => {
      const rows = document.createDocumentFragment();
      list.querySelectorAll<HTMLElement>(".k-day[data-day]").forEach((day) => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${day.id}`;
        link.setAttribute("data-cursor", "LINK");
        link.tabIndex = 0;
        const label = document.createElement("span");
        label.className = "k-link-label";
        label.textContent = `${day.dataset.day} · ${day.querySelectorAll(".k-entry").length} 条`;
        link.append(label);
        const meter = document.createElement("span");
        meter.className = "k-toc-meter";
        meter.setAttribute("aria-hidden", "true");
        link.append(meter);
        li.append(link);
        rows.append(li);
      });
      const empty = !rows.childNodes.length;
      toc.querySelector("ol")?.replaceChildren(rows);
      toc.hidden = empty;
      const emptyNotice = panel?.querySelector<HTMLElement>("[data-toc-empty]");
      if (emptyNotice) emptyNotice.hidden = !empty;
      collectChapters();
      configure();
    }).observe(list, { childList: true });
  }
  panel?.addEventListener("focusin", (event) => {
    // 原生 Tab 可聚焦尚未揭示的链接；即时完成入场，不让焦点停在透明内容上。
    entranceDone = true;
    stopEntranceObserver();
    const wasEntering = Boolean(panel.style.opacity || panel.style.transform);
    if (destination) cancelDeparture();
    sdk.gsap?.killTweensOf(panel);
    sdk.gsap?.set(panel, { clearProps: "opacity,transform" });
    // 浏览器可能按位移中的坐标执行焦点滚动；归位后按最终几何再次保证链接可见。
    if (wasEntering && event.target instanceof HTMLElement) {
      event.target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  });
  if (nav || panel) {
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      // MENU 自己完成覆盖面板退场，不能再串联左侧目录退场。
      if (link.closest("[data-kmenu]")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
      if (url.pathname === location.pathname && url.search === location.search) {
        // 当前全站标签是幂等选择，不能原生刷新并重播动效；章节锚点仍走原生跳转。
        if (!url.hash && link.matches("[data-nav], .k-brand, .k-foot-nav a")) event.preventDefault();
        if (destination) cancelDeparture(true);
        return;
      }
      const g = sdk.gsap;
      if (reduced.matches || html.dataset.octMotion !== "on" || !g || !panel?.getClientRects().length) return;
      event.preventDefault();
      destination = url.href;
      if (departure) return; // 快速选择只更新目标，不叠加补间或旧导航回调。
      entranceDone = true;
      stopEntranceObserver();
      g.killTweensOf(panel);
      // 后台标签页时钟可能暂停：原生定时器兜底，避免导航被动画永久阻塞。
      navigationTimer = setTimeout(finishDeparture, 1500);
      try {
        departure = g.timeline({ onComplete: finishDeparture }).to(panel, {
          opacity: 0, y: -12, duration: 0.24, ease: "power3.out", overwrite: true,
        });
      } catch { finishDeparture(); }
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) cancelDeparture(); // BFCache 返回不能保留旧页的透明退场终态。
    });
  }
  window.addEventListener("scroll", () => { if (!context) render(true); }, { passive: true });
  window.addEventListener("resize", () => { measure(); render(); paintNav(0, true); }, { passive: true });
  document.fonts?.ready.then(() => { measure(); render(); });
  reduced.addEventListener("change", configure);
  const motionState = new MutationObserver((records) => {
    if (records.some((record) => record.attributeName === "data-oct-motion")) configure();
    else if (!html.hasAttribute("data-oct-topic-anim")) { measure(); render(); }
  });
  motionState.observe(html, { attributes: true, attributeFilter: ["data-oct-motion", "data-oct-topic-anim"] });
  if (nav && navMarker && currentPage) {
    nav.querySelectorAll<HTMLElement>("a[data-nav]").forEach((link) => {
      const offset = () => link.offsetTop + link.offsetHeight / 2 - currentPage.offsetTop - currentPage.offsetHeight / 2;
      link.addEventListener("mouseenter", () => { if (fine.matches) paintNav(offset(), reduced.matches); });
      link.addEventListener("focus", () => paintNav(offset(), true));
    });
    nav.addEventListener("mouseleave", () => paintNav(0, reduced.matches));
    nav.addEventListener("focusout", (event) => { if (!nav.contains(event.relatedTarget as Node | null)) paintNav(0, true); });
  }
}
