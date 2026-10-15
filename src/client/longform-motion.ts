import type { Gsap, GsapContext, ScrollTriggerPlugin } from "./motion.ts";

interface RevealTimeline {
  to(target: Element | Element[], vars: Record<string, unknown>, position?: number | string): RevealTimeline;
  play(): RevealTimeline;
  reverse(): RevealTimeline;
  progress(value: number): RevealTimeline;
  kill(): void;
}
interface LongformGsap extends Omit<Gsap, "timeline"> {
  timeline(vars?: Record<string, unknown>): RevealTimeline;
}
interface LongformWindow extends Window {
  gsap?: LongformGsap;
  ScrollTrigger?: ScrollTriggerPlugin;
}
interface RevealGroup {
  anchor: HTMLElement;
  nodes: HTMLElement[];
  targets: HTMLElement[];
  timeline: RevealTimeline;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * 说明页的编辑式揭幕。仅增强显式标记的正文；标题锚点、HUD 外框与目录不参与位移。
 * 用户裁定（2026-10-11）：这套展示动效完整播放，不按 reduced-motion 缩减。
 * 缺库/迟到脚本仍直显；已读内容不重播，焦点和 BFCache 恢复优先于揭幕队列。
 */
export function initLongformMotion(): void {
  const article = document.querySelector<HTMLElement>("[data-longform-motion]");
  if (!article) return;
  const html = document.documentElement;
  const { gsap: g, ScrollTrigger: st } = window as LongformWindow;
  const hud = document.querySelector<HTMLElement>("[data-khud]");
  let context: GsapContext | null = null;
  let cancelled = false;
  let prepared = false;
  const groups: RevealGroup[] = [];
  const restores: Array<() => void> = [];
  const listeners: Array<() => void> = [];
  const release = () => html.removeAttribute("data-oct-doc-pending");
  const clearGroup = (group: RevealGroup) => {
    group.targets.forEach((element) => {
      ["transform", "opacity", "clip-path", "will-change"].forEach((property) => element.style.removeProperty(property));
    });
  };
  const arm = (group: RevealGroup) => {
    if (group.anchor.dataset.docReveal === "done" || group.timer !== undefined) return;
    group.anchor.dataset.docReveal = "playing";
    group.timer = setTimeout(() => finish(group), 1500);
  };
  const finish = (group: RevealGroup) => {
    if (group.timer !== undefined) clearTimeout(group.timer);
    group.timer = undefined;
    group.timeline.progress(1).kill();
    // 不向已暂停的全局时钟再添加set补间；焦点路径同步解除全部遮罩。
    clearGroup(group);
    group.anchor.dataset.docReveal = "done";
  };
  const dispose = () => {
    cancelled = true;
    groups.forEach((group) => { if (group.timer !== undefined) clearTimeout(group.timer); });
    context?.revert();
    context = null;
    listeners.splice(0).forEach((remove) => remove());
    restores.splice(0).reverse().forEach((restore) => restore());
    release();
    html.dataset.octLongform = "static";
  };
  // 1500ms 的 head 兜底已放行时，不再重新隐藏用户看到的内容。
  if (!g || !st || !html.hasAttribute("data-oct-doc-pending")) { dispose(); return; }

  const listen = (target: EventTarget, event: string, handler: EventListener) => {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  };
  const showFocus: EventListener = (event) => {
    if (!(event.target instanceof Element)) return;
    if (!article.contains(event.target) && !hud?.contains(event.target)) return;
    if (!prepared) { dispose(); return; }
    groups.filter((group) => group.nodes.some((node) => node.contains(event.target as Node)))
      .forEach(finish);
  };
  listen(document, "focusin", showFocus);
  listen(window, "pagehide", dispose);
  const styles = getComputedStyle(article.closest("[data-kinetic]") ?? article);
  const seconds = (token: string) => {
    // 生产CSS会把550ms压缩成.55s；按实际单位读取，保留同一产品时长。
    const value = styles.getPropertyValue(token).trim();
    return Number.parseFloat(value) / (value.endsWith("ms") ? 1000 : 1);
  };
  const slow = seconds("--motion-slow");
  const normal = seconds("--motion-normal");
  const fast = seconds("--motion-fast");

  const mark = (element: HTMLElement, attribute: string, value: string) => {
    const previous = element.getAttribute(attribute);
    element.setAttribute(attribute, value);
    restores.push(() => {
      if (previous === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, previous);
    });
  };
  const splitHeading = (heading: HTMLElement) => {
    const children = [...heading.childNodes];
    const label = heading.getAttribute("aria-label");
    heading.setAttribute("aria-label", heading.textContent ?? "");
    const fragment = document.createDocumentFragment();
    const chars = Array.from(heading.textContent ?? "").map((character) => {
      const mask = document.createElement("span");
      mask.className = "k-doc-char-mask";
      mask.setAttribute("aria-hidden", "true");
      const char = document.createElement("span");
      char.className = "k-doc-char";
      char.textContent = character;
      mask.append(char);
      fragment.append(mask);
      return char;
    });
    heading.replaceChildren(fragment);
    restores.push(() => {
      heading.replaceChildren(...children);
      if (label === null) heading.removeAttribute("aria-label");
      else heading.setAttribute("aria-label", label);
    });
    return chars;
  };
  const ruleFor = (anchor: HTMLElement, className: string) => {
    const rule = document.createElement("span");
    rule.className = className;
    rule.setAttribute("aria-hidden", "true");
    anchor.append(rule);
    restores.push(() => rule.remove());
    return rule;
  };
  const groupFor = (anchor: HTMLElement, nodes: HTMLElement[]) => {
    mark(anchor, "data-doc-reveal", "pending");
    const group: RevealGroup = {
      anchor, nodes, targets: [],
      timeline: g.timeline({
        paused: true,
        defaults: { duration: slow, ease: "power3.out" },
        onStart: () => {
          // GSAP 时钟暂停/页面失焦时也不能让正在阅读的内容永久隐藏。
          arm(group);
        },
        onComplete: () => {
          if (group.timer !== undefined) clearTimeout(group.timer);
          group.timer = undefined;
          anchor.dataset.docReveal = "done";
          clearGroup(group);
        },
      }),
    };
    groups.push(group);
    return group;
  };
  const revealHeading = (group: RevealGroup, heading: HTMLElement, title = false) => {
    const chars = splitHeading(heading);
    const rule = ruleFor(heading, "k-doc-rule");
    group.targets.push(...chars, rule);
    g.set(chars, { yPercent: 110, rotation: 2, opacity: 0, willChange: "transform,opacity" });
    g.set(rule, { scaleX: 0, transformOrigin: "left center" });
    group.timeline.to(rule, { scaleX: 1, duration: normal }, 0)
      .to(chars, {
        yPercent: 0, rotation: 0, opacity: 1,
        stagger: { amount: title ? normal : fast },
      }, 0.04);
  };
  const revealBodies = (group: RevealGroup, bodies: HTMLElement[], start = 0.18) => {
    let position = start;
    for (const body of bodies) {
      // 只分解语义块的第一层，保持列表标记、定义列表和表格的原结构。
      const targets = body.matches("ul,ol,dl") ? [...body.children] as HTMLElement[]
        : body.matches("table") ? [...body.querySelectorAll<HTMLElement>("tr")]
        : [body];
      targets.forEach((target) => mark(target, "data-doc-block", ""));
      group.targets.push(...targets);
      g.set(targets, { y: 18, opacity: 0, clipPath: "inset(0% 0% 100% 0%)", willChange: "transform,opacity" });
      group.timeline.to(targets, {
        y: 0, opacity: 1, clipPath: "inset(0% 0% 0% 0%)",
        stagger: { amount: Math.min(normal, Math.max(0, targets.length - 1) * 0.06) },
      }, position);
      position += 0.08;
    }
  };

  const prepare = () => {
    if (cancelled || prepared) return;
    if (!html.hasAttribute("data-oct-doc-pending")) { dispose(); return; }
    try {
      g.registerPlugin(st);
      g.context((self) => {
        context = self;
        const title = article.querySelector<HTMLElement>(":scope > h1");
        const lede = article.querySelector<HTMLElement>(".k-doc-lede");
        if (title) {
          const intro = groupFor(title, lede ? [title, lede] : [title]);
          revealHeading(intro, title, true);
          if (lede) revealBodies(intro, [lede]);
        }
        for (const heading of article.querySelectorAll<HTMLElement>("h2")) {
          const bodies: HTMLElement[] = [];
          let sibling = heading.nextElementSibling;
          while (sibling instanceof HTMLElement && sibling.tagName !== "H2") {
            bodies.push(sibling);
            sibling = sibling.nextElementSibling;
          }
          const group = groupFor(heading, [heading, ...bodies]);
          revealHeading(group, heading);
          revealBodies(group, bodies);
        }
        if (hud) {
          mark(hud, "data-longform-hud", "");
          [...hud.querySelectorAll<HTMLElement>(".sec")].forEach((section, index) => {
            const children = [...section.children] as HTMLElement[];
            const group = groupFor(section, [section]);
            const rule = ruleFor(section, "k-hud-rule");
            group.targets.push(rule, ...children);
            g.set(rule, { scaleX: 0, transformOrigin: "left center" });
            g.set(children, { y: 14, opacity: 0, clipPath: "inset(0% 0% 100% 0%)", willChange: "transform,opacity" });
            const beat = index * 0.06;
            group.timeline.to(rule, { scaleX: 1, duration: normal }, beat)
              .to(children, { y: 0, opacity: 1, clipPath: "inset(0% 0% 0% 0%)", stagger: 0.06 }, beat + 0.08);
          });

        }
        // 每个组只有一条 timeline；快速越过整章时直接收尾，回读不重播。
        groups.forEach((group, index) => {
          st.create({
            id: `longform-${index}`, trigger: group.anchor,
            start: "top 88%", end: "bottom top", once: true,
            animation: group.timeline, onEnter: () => arm(group), onLeave: () => finish(group),
          });
        });
      }, article.closest("[data-kinetic]") ?? article);
      prepared = true;
      html.dataset.octLongform = "on";
      release();
      st.refresh();
    } catch { dispose(); }
  };
  // 复用现有展示字体的300ms等待预算；字体后到不妨碍无测量的逐字遮罩。
  const timer = setTimeout(prepare, 300);
  restores.push(() => clearTimeout(timer));
  document.fonts.ready.then(() => { clearTimeout(timer); prepare(); }, () => { clearTimeout(timer); prepare(); });
}
