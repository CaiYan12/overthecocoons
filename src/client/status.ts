/**
 * 状态播报（Ticket 05）：沿用 T04 预留的 aria-live 区域（KSite 全局 [data-status]）。
 * 区域由静态 HTML 提供，脚本只写文本；元素缺失时静默跳过（不得抛错破坏页面）。
 *
 * 连续相同文案也要求重播（T05 收尾项）：aria-live 区域只在文本变化时播报，
 * 同文案先清空、下一帧写回，并按序号令牌防止过期回调覆盖更新的播报。
 */
let announceSeq = 0;

export function announce(message: string): void {
  const status = document.querySelector<HTMLElement>("[data-status]");
  if (!status) return;
  announceSeq += 1;
  if (status.textContent !== message) {
    status.textContent = message;
    return;
  }
  const token = announceSeq;
  status.textContent = "";
  requestAnimationFrame(() => {
    if (token === announceSeq) status.textContent = message;
  });
}
