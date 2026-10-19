import { addMediaEntrance, type Gsap, type GsapContext, type ScrollTriggerPlugin } from "./motion.ts";

type Timeline = ReturnType<Gsap["timeline"]>;
interface Group {
  node: HTMLElement;
  timeline: Timeline;
  done: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** 详情阅读顺序入场；首绘门控、焦点直显、时钟停滞与 BFCache 均优先保持可读。 */
export function initDetailMotion(): void {
  const article = document.querySelector<HTMLElement>("[data-detail-page]");
  if (!article) return;
  const html = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const { gsap: g, ScrollTrigger: st } = window as Window & { gsap?: Gsap; ScrollTrigger?: ScrollTriggerPlugin };
  const hud = article.closest(".k-cols")?.querySelector<HTMLElement>("[data-khud]");
  const release = () => html.removeAttribute("data-oct-detail-pending");
  const markStatic = () => { release(); article.dataset.detailMotion = "static"; };
  // 首绘兜底已经显示时，不因迟到的模块再次隐藏内容。
  if (!g || !st || reduced.matches || html.dataset.octMotion !== "on" || !html.hasAttribute("data-oct-detail-pending")) {
    markStatic();
    return;
  }
  let context: GsapContext | null = null;
  let disposed = false;
  const groups: Group[] = [];
  const cleanups: Array<() => void> = [];
  const settle = (group: Group) => {
    group.done = true;
    if (group.timer !== undefined) clearTimeout(group.timer);
    group.timer = undefined;
    group.node.dataset.detailReveal = "done";
    if (groups.every(item => item.done)) article.dataset.detailMotion = "done";
  };
  const finish = (group: Group) => {
    if (group.done) return;
    // 显式推进可穿过暂停的 GSAP 祖先时钟，不能向停钟再添加 set 补间。
    group.timeline.progress(1).kill();
    settle(group);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    groups.forEach(group => { if (group.timer !== undefined) clearTimeout(group.timer); });
    context?.revert();
    context = null;
    cleanups.splice(0).forEach(cleanup => cleanup());
    groups.forEach(group => { delete group.node.dataset.detailReveal; });
    markStatic();
  };
  try {
    const style = getComputedStyle(article.closest("[data-kinetic]") ?? article);
    const token = style.getPropertyValue("--motion-normal").trim();
    const duration = Number.parseFloat(token) / (token.endsWith("ms") ? 1000 : 1);
    if (!Number.isFinite(duration) || duration <= 0) { markStatic(); return; }
    g.context(self => {
      context = self;
      const nodes = [...article.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
      const hudNodes = hud ? [...hud.querySelectorAll<HTMLElement>(".sec")] : [];
      [...nodes, ...hudNodes].forEach((node, index) => {
        const group: Group = { node, timeline: g.timeline({ paused: true }), done: false };
        groups.push(group);
        node.dataset.detailReveal = "pending";
        const position = (index < nodes.length ? index : index - nodes.length + 1) * 0.05;
        if (node.matches(".k-media")) {
          cleanups.push(addMediaEntrance(g, group.timeline, node, position));
        } else {
          // 交互入口仅淡入：避免点击触发焦点直显时位移，导致 pointerup 离开按钮。
          // 正文保留轻抬，所有文本仍可在键盘进入时同步直显。
          const lift = node.querySelector("a, button, input, select, textarea") ? 0 : 12;
          g.set(node, { opacity: 0, y: lift });
          group.timeline.to(node, { opacity: 1, y: 0, duration, ease: "power3.out" }, position);
        }
        group.timeline.to(node, { duration: 0, onComplete: () => settle(group) }, position + (node.matches(".k-media") ? 0.9 : duration));
        st.create({
          trigger: node, start: "top 94%", once: true,
          onEnter: () => {
            if (group.done || disposed) return;
            node.dataset.detailReveal = "playing";
            group.timer = setTimeout(() => finish(group), 1500);
            group.timeline.play();
          },
        });
      });
    }, article.closest("[data-kinetic]") ?? article);
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Node)) return;
      groups.filter(group => group.node.contains(event.target as Node)).forEach(finish);
    };
    const onReduced = () => { if (reduced.matches) dispose(); };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("pagehide", dispose);
    reduced.addEventListener("change", onReduced);
    cleanups.push(() => document.removeEventListener("focusin", onFocus));
    cleanups.push(() => window.removeEventListener("pagehide", dispose));
    cleanups.push(() => reduced.removeEventListener("change", onReduced));
    article.dataset.detailMotion = "on";
    release();
    st.refresh();
  } catch {
    dispose();
  }
}
