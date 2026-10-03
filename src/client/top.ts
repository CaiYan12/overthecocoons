/**
 * 返回顶部（Ticket 05）：阈值显隐（scrollY ≥ 400，与原型一致）+ 点击回顶。
 * 平滑滚动尊重 prefers-reduced-motion（减少动态效果时直接跳转）。
 * 圆环进度与 HUD 阅读进度的动态呈现属 Ticket 06，本模块不动。
 */
const SHOW_THRESHOLD = 400;

export function initTopButton(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-ktop]");
  if (!button) return;

  const update = () => {
    button.classList.toggle("show", window.scrollY >= SHOW_THRESHOLD);
  };
  window.addEventListener("scroll", update, { passive: true });
  update();

  button.addEventListener("click", () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  });
}
