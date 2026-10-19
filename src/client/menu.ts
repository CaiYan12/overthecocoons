/** 原生 dialog 保留焦点约束；覆盖面板退完后才执行原生链接／客户端筛选。 */
import { menuCloseMotion, menuOpenMotion, resetMenuMotion } from "./motion.ts";

export function initMenu(): void {
  const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]");
  const openButton = document.querySelector<HTMLButtonElement>("[data-kmenu-open]");
  const closeButton = menu?.querySelector<HTMLButtonElement>("[data-kmenu-close]");
  if (!menu || !openButton || !closeButton) return;

  let state: "closed" | "opening" | "open" | "closing" = "closed";
  let selected: HTMLAnchorElement | null = null;
  let replaying = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bodyOverflow = "";
  const setState = (next: typeof state) => { state = next; menu.dataset.menuState = next; };
  const stopTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const opened = () => {
    if (state !== "opening") return;
    stopTimer();
    resetMenuMotion(menu, false);
    setState("open");
  };
  const finishClose = () => {
    if (state !== "closing") return;
    stopTimer();
    const link = selected;
    selected = null;
    menu.close();
    resetMenuMotion(menu);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    openButton.setAttribute("aria-expanded", "false");
    if (!link) openButton.focus({ preventScroll: true });
    if (link) {
      // 保留时间线筛选及静态链接语义；仅在覆盖面板完全退出后重放一次。
      replaying = true;
      link.click();
      replaying = false;
    }
  };
  const closeMenu = (link: HTMLAnchorElement | null = null) => {
    if (!menu.open) return;
    selected = link;
    if (state === "closing") return; // 最后选择接管，不重复播放退出。
    stopTimer();
    setState("closing");
    timer = setTimeout(finishClose, 1500);
    try { if (!menuCloseMotion(menu, finishClose)) finishClose(); }
    catch { finishClose(); }
  };

  openButton.addEventListener("click", () => {
    if (menu.open) return;
    // 与来源选择面板互斥（Issue #34）：两者都是原生模态，不叠开
    if (document.querySelector<HTMLDialogElement>("[data-ksource]")?.open) return;
    selected = null;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menu.showModal();
    setState("opening");
    openButton.setAttribute("aria-expanded", "true");
    menu.querySelector(".k-menu-inner")?.scrollTo(0, 0);
    closeButton.focus({ preventScroll: true });
    timer = setTimeout(opened, 1500);
    try { if (!menuOpenMotion(menu, opened)) opened(); }
    catch { opened(); }
  });

  closeButton.addEventListener("click", () => closeMenu());

  // Esc（原生 cancel）：拦截默认立即关闭，改走统一关闭路径（动效模式下播放退出动画）
  menu.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeMenu();
  });

  menu.addEventListener("click", (event) => {
    if (replaying || !menu.open || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return;
    event.preventDefault();
    // 当前页面只收起，不刷新重播。主题保留筛选的既有语义。
    const current = !url.hash && url.pathname === location.pathname && url.search === location.search && !link.matches("[data-topic]");
    closeMenu(current ? null : link);
  }, { capture: true });

  // 外部原生 close() 及 BFCache 回收同样恢复样式与整页滚动。
  menu.addEventListener("close", () => {
    if (menu.open || state === "closed") return;
    selected = null;
    stopTimer();
    resetMenuMotion(menu);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    openButton.setAttribute("aria-expanded", "false");
    openButton.focus({ preventScroll: true });
  });
  window.addEventListener("pagehide", () => {
    if (state === "closed") return;
    selected = null;
    stopTimer();
    if (menu.open) menu.close();
    resetMenuMotion(menu);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    openButton.setAttribute("aria-expanded", "false");
  });
  setState("closed");
}
