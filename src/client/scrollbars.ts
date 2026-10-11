/** 自绘覆盖式纵向滚动条；只控制原生滚动位置，不替换页面滚动容器。 */
export function initScrollbars(): void {
  const html = document.documentElement;
  if (html.dataset.octScrollbars !== "pending") return;
  const pageTrack = document.querySelector<HTMLElement>('[data-scrollbar="page"]');
  const menuTrack = document.querySelector<HTMLElement>('[data-scrollbar="menu"]');
  const menuScroll = document.querySelector<HTMLElement>(".k-menu-inner");
  const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]");
  if (!pageTrack || !menuTrack || !menuScroll || !menu) return;

  let frame = 0;
  const controls = [
    { track: pageTrack, element: null },
    { track: menuTrack, element: menuScroll },
  ].map(({ track, element }) => {
    const thumb = track.querySelector<HTMLElement>(".k-scrollbar-thumb")!;
    let drag: { id: number; y: number; top: number; max: number; travel: number } | null = null;
    const metrics = () => {
      const viewport = element ? element.clientHeight : innerHeight;
      const total = element ? element.scrollHeight : document.documentElement.scrollHeight;
      const top = element ? element.scrollTop : scrollY;
      return { viewport, total, top, max: Math.max(0, total - viewport) };
    };
    const scroll = (top: number) => {
      const value = Math.max(0, Math.min(metrics().max, top));
      if (element) element.scrollTo({ top: value, behavior: "instant" });
      else window.scrollTo({ top: value, behavior: "instant" });
      schedule();
    };
    const paint = () => {
      const { viewport, total, top, max } = metrics();
      track.hidden = max <= 1 || Boolean(element && !menu.open);
      if (track.hidden) return;
      const height = track.clientHeight;
      const size = Math.min(height, Math.max(32, height * viewport / Math.max(1, total)));
      const progress = Math.max(0, Math.min(1, top / Math.max(1, max)));
      const sizeStyle = `${size}px`;
      if (thumb.style.height !== sizeStyle) thumb.style.height = sizeStyle;
      thumb.style.transform = `translateY(${progress * (height - size)}px)`;
      track.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
      track.setAttribute("aria-valuetext", `${Math.round(progress * 100)}%`);
    };
    const endDrag = () => {
      if (drag && track.hasPointerCapture(drag.id)) track.releasePointerCapture(drag.id);
      drag = null;
      track.removeAttribute("data-dragging");
    };
    track.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || element && menu.dataset.menuState !== "open") return;
      event.preventDefault();
      track.focus({ preventScroll: true });
      const { top, max, viewport } = metrics();
      const rect = thumb.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        drag = { id: event.pointerId, y: event.clientY, top, max, travel: Math.max(1, track.clientHeight - rect.height) };
        track.setPointerCapture(event.pointerId);
        track.setAttribute("data-dragging", "");
      } else scroll(top + (event.clientY < rect.top ? -1 : 1) * viewport * 0.9);
    });
    track.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      scroll(drag.top + (event.clientY - drag.y) * drag.max / drag.travel);
    });
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    track.addEventListener("lostpointercapture", endDrag);
    track.addEventListener("wheel", (event) => {
      if (!metrics().max) return;
      event.preventDefault();
      const { top, viewport } = metrics();
      scroll(top + event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport : 1));
    }, { passive: false });
    track.addEventListener("keydown", (event) => {
      const { top, viewport, max } = metrics();
      const values: Record<string, number> = {
        ArrowUp: top - 40, ArrowDown: top + 40,
        PageUp: top - viewport * 0.9, PageDown: top + viewport * 0.9,
        Home: 0, End: max,
      };
      if (!(event.key in values)) return;
      event.preventDefault();
      scroll(values[event.key]!);
    });
    return { paint, endDrag };
  });

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; controls.forEach(control => control.paint()); });
  }
  window.addEventListener("scroll", schedule, { passive: true });
  menuScroll.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  const sizes = new ResizeObserver(schedule);
  sizes.observe(document.body);
  sizes.observe(menuScroll);
  sizes.observe(menuScroll.querySelector(".k-menu-topics")!);
  new MutationObserver(() => {
    if (menu.open) controls[0]!.endDrag();
    if (!menu.open) controls[1]!.endDrag();
    schedule();
  }).observe(menu, { attributes: true, attributeFilter: ["open", "data-menu-state"] });
  window.addEventListener("pagehide", () => {
    controls.forEach(control => control.endDrag());
    cancelAnimationFrame(frame);
    frame = 0;
  });
  window.addEventListener("pageshow", schedule);
  document.fonts.ready.then(schedule);
  html.dataset.octScrollbars = "ready";
  controls.forEach(control => control.paint());
}
