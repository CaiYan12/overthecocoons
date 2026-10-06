/**
 * 状态播报（Ticket 05）：沿用 T04 预留的 aria-live 区域（KSite 全局 [data-status]）。
 * 区域由静态 HTML 提供，脚本只写文本；元素缺失时静默跳过（不得抛错破坏页面）。
 *
 * 连续相同文案也要求重播（T05 收尾项）：aria-live 区域只在文本变化时播报，
 * 同文案先清空、下一帧写回，并按序号令牌防止过期回调覆盖更新的播报。
 *
 * 播报 chip 自动消退（T5，UI 票 #22）：写入后 ANNOUNCE_CLEAR_MS 清空（清空经
 * .live-status:empty → display:none 使 chip 隐藏），重复播报重置计时器。
 * 清空手法：先摘 live 语义（去 role、aria-live=off）再清文本、下一帧恢复——
 * 清空动作不进入播报通道；announce 写入前若处于静默窗口则先恢复语义，后续播报照常。
 */

/** 播报文案写入后到自动清空的时长（ms）。T5 参数「实现者拟定，总审定稿」：取建议区间 4–6s 下限。 */
export const ANNOUNCE_CLEAR_MS = 4000;

const LIVE_ROLE = "status";
const LIVE_LEVEL = "polite";

let announceSeq = 0;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** 恢复 live 语义（与 KSite 静态标记一致；announce 写入前的幂等前置）。 */
function ensureLive(status: HTMLElement): void {
  status.setAttribute("role", LIVE_ROLE);
  status.setAttribute("aria-live", LIVE_LEVEL);
}

function scheduleClear(status: HTMLElement): void {
  if (clearTimer !== null) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    // 静默清空：先摘 live 语义再清文本（清空本身不播报），下一帧恢复语义
    status.removeAttribute("role");
    status.setAttribute("aria-live", "off");
    status.textContent = "";
    requestAnimationFrame(() => ensureLive(status));
  }, ANNOUNCE_CLEAR_MS);
}

export function announce(message: string): void {
  const status = document.querySelector<HTMLElement>("[data-status]");
  if (!status) return;
  announceSeq += 1;
  ensureLive(status);
  if (status.textContent !== message) {
    status.textContent = message;
  } else {
    const token = announceSeq;
    status.textContent = "";
    requestAnimationFrame(() => {
      if (token === announceSeq) status.textContent = message;
    });
  }
  scheduleClear(status);
}
