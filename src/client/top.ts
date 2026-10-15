import type { Gsap } from "./motion.ts";

/**
 * 返回顶部（Ticket 05）：阈值显隐（scrollY ≥ 400，与原型一致）+ 点击回顶。
 * 平滑滚动尊重 prefers-reduced-motion（减少动态效果时直接跳转）。
 * 圆环进度与 HUD 阅读进度的动态呈现属 Ticket 06，本模块不动。
 */
const SHOW_THRESHOLD = 400;
interface TopGsap extends Omit<Gsap, "set"> {
  set(target: Element, vars: Record<string, unknown>): { progress(value: number): void };
}

export function initTopButton(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-ktop]");
  if (!button) return;
  const face = button.querySelector<HTMLElement>(".k-top-face");
  const { gsap: g } = window as Window & { gsap?: TopGsap };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let shown: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pose = () => ({ y: shown || reduced.matches ? 0 : 10, scale: shown || reduced.matches ? 1 : 0.95 });
  const settle = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (face && g) {
      g.killTweensOf(face);
      // 显式推进 set，祖先时钟暂停时也同步落到终态。
      g.set(face, pose()).progress(1);
      face.style.removeProperty("will-change");
    }
  };
  const update = (instant = false) => {
    const next = window.scrollY >= SHOW_THRESHOLD;
    if (next === shown && !instant) return;
    shown = next;
    button.classList.toggle("show", shown);
    button.tabIndex = shown ? 0 : -1;
    if (shown) button.removeAttribute("aria-hidden");
    else {
      if (document.activeElement === button) button.blur();
      button.setAttribute("aria-hidden", "true");
    }
    if (!face || !g) return; // 缺库时保留 CSS 淡入淡出与原生回顶。
    if (timer !== undefined) clearTimeout(timer);
    g.killTweensOf(face); // 保留当前姿态，反向从当前帧接续；不动磁吸本体。
    if (instant || reduced.matches) {
      settle();
      return;
    }
    const token = shown ? "--motion-normal" : "--motion-fast";
    const value = getComputedStyle(button).getPropertyValue(token).trim();
    // 产物会把 ms 压缩为 s，按实际单位换算。
    const duration = Number.parseFloat(value) / (value.endsWith("ms") ? 1000 : 1);
    face.style.willChange = "transform";
    g.to(face, {
      ...pose(),
      duration,
      ease: shown ? "back.out(0.8)" : "power3.out",
      overwrite: "auto",
      onComplete: settle,
    });
    timer = setTimeout(settle, duration * 1000 + 160);
  };
  window.addEventListener("scroll", () => update(), { passive: true });
  reduced.addEventListener("change", () => update(true));
  window.addEventListener("pagehide", settle);
  window.addEventListener("pageshow", () => update(true));
  update(true);

  button.addEventListener("click", () => {
    if (!shown) return;
    window.scrollTo({ top: 0, behavior: reduced.matches ? "auto" : "smooth" });
  });
}
