/**
 * 状态播报（Ticket 05）：沿用 T04 预留的 aria-live 区域（KSite 全局 [data-status]）。
 * 区域由静态 HTML 提供，脚本只写文本；元素缺失时静默跳过（不得抛错破坏页面）。
 */
export function announce(message: string): void {
  const status = document.querySelector<HTMLElement>("[data-status]");
  if (status) status.textContent = message;
}
