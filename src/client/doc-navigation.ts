/** 左右侧栏保持完整高度：能完整放进窗口才吸附，否则随整页滚动，不创建内部滚动区。 */
export function initDocNavigation(): void {
  document.querySelectorAll<HTMLElement>("[data-docnav], [data-khud]").forEach((sidebar) => {
    const isHud = sidebar.hasAttribute("data-khud");
    const stickyAttribute = isHud ? "data-hud-sticky" : "data-docnav-sticky";
    const update = () => {
      const nav = sidebar.querySelector(".k-nav");
      if ((nav && getComputedStyle(nav).display === "none") || (isHud && getComputedStyle(sidebar).flexDirection === "row")) {
        sidebar.removeAttribute(stickyAttribute);
        return;
      }
      const top = parseFloat(getComputedStyle(sidebar).top);
      const fits = Number.isFinite(top) && sidebar.offsetHeight <= innerHeight - top - 24;
      sidebar.toggleAttribute(stickyAttribute, fits);
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(update).observe(sidebar);
    sidebar.addEventListener("focusin", (event) => {
      if (!(event.target instanceof HTMLAnchorElement) || !event.target.matches(":focus-visible")) return;
      const box = event.target.getBoundingClientRect();
      const headerBottom = document.querySelector("[data-kheader]")?.getBoundingClientRect().bottom ?? 0;
      if (box.top < headerBottom + 6 || box.bottom > innerHeight - 6) {
        // 整页焦点滚动也要避开固定页头，不使用任何侧栏内的scrollTop。
        event.target.scrollIntoView({ block: "center", behavior: "instant" });
      }
    });
  });
}
