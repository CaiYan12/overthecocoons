/**
 * 全屏菜单（Ticket 05/06）：原生 dialog 行为接管（原型 v-kinetic 行为）。
 * - 打开：showModal、aria-expanded=true、焦点移到「关闭」按钮（焦点进入），
 *   GSAP 可用时整体 opacity 渐入 + 条目 stagger（关闭按钮只做纯 opacity 淡入，
 *   不用 autoAlpha——其 visibility:hidden 会让初始焦点失效，与原型一致）；
 * - 关闭（按钮/Esc→cancel）：GSAP 可用时走退出时间线，结束后 menu.close()；
 *   close 事件统一收口——aria-expanded=false、焦点返回触发按钮；
 * - 菜单内主题 Tab：时间线页由 timeline-view 接管为客户端筛选，这里只负责关闭菜单；
 *   非时间线页不拦截，保持静态链接导航（无 JS 兜底语义）。
 * 焦点圈由 dialog 原生提供；连续开合依赖 showModal/close 的可重入性（退出时间线可打断重启动）。
 */
import { menuCloseMotion, menuOpenMotion } from "./motion.ts";

export function initMenu(): void {
  const menu = document.querySelector<HTMLDialogElement>("[data-kmenu]");
  const openButton = document.querySelector<HTMLButtonElement>("[data-kmenu-open]");
  const closeButton = menu?.querySelector<HTMLButtonElement>("[data-kmenu-close]");
  if (!menu || !openButton || !closeButton) return;

  const closeMenu = () => {
    if (!menu.open) return;
    const animated = menuCloseMotion(menu, () => menu.close());
    if (!animated) menu.close();
  };

  openButton.addEventListener("click", () => {
    if (menu.open) return;
    menu.showModal();
    openButton.setAttribute("aria-expanded", "true");
    closeButton.focus();
    menuOpenMotion(menu, closeButton);
  });

  closeButton.addEventListener("click", closeMenu);

  // Esc（原生 cancel）：拦截默认立即关闭，改走统一关闭路径（动效模式下播放退出动画）
  menu.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeMenu();
  });

  menu.addEventListener("close", () => {
    openButton.setAttribute("aria-expanded", "false");
    openButton.focus();
  });

  // 菜单主题点击后关闭菜单；筛选本身由 timeline-view（若存在）拦截
  menu.querySelectorAll<HTMLAnchorElement>(".k-menu-topics .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      closeMenu();
    });
  });
}
