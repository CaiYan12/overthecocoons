/** 长文侧栏：按实际可用空间选择目录滚动或整栏兜底，不绑定猜测的高度断点。 */
export function initDocNavigation(): void {
  const sidebar = document.querySelector<HTMLElement>("[data-docnav]");
  const nav = sidebar?.querySelector<HTMLElement>(".k-nav");
  const toc = sidebar?.querySelector<HTMLElement>(".k-toccol");
  if (!sidebar || !nav || !toc) return;

  const update = () => {
    if (getComputedStyle(nav).display === "none") {
      sidebar.removeAttribute("data-scroll-all");
      toc.style.removeProperty("min-height");
      return;
    }
    const style = getComputedStyle(sidebar);
    const available = sidebar.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    // 目录至少留一行可操作空间；再小就改为单一整栏滚动，避免目录成为零高度区域。
    const firstLink = toc.querySelector<HTMLElement>("a");
    if (!firstLink) return;
    const tocStyle = getComputedStyle(toc);
    const minimumToc = firstLink.getBoundingClientRect().height
      + parseFloat(tocStyle.paddingTop) + parseFloat(tocStyle.paddingBottom);
    toc.style.minHeight = `${minimumToc}px`;
    const required = nav.getBoundingClientRect().height + parseFloat(style.rowGap) + minimumToc;
    sidebar.toggleAttribute("data-scroll-all", required > available);
  };
  update();
  window.addEventListener("resize", update, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    // 导航字体、换行或内容尺寸变化也会重新计算；仅观察导航，不受滚动模式切换影响。
    new ResizeObserver(update).observe(nav);
  }
}
