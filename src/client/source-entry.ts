/**
 * 来源入口的焦点回落（Issue #34 复审 B2）：取消/关闭与应用共用一处实现。
 *
 * 规格对两条路径的要求不同，因此只共享「把焦点还给入口」这件事，滚动由调用方决定：
 * - 取消/关闭/Esc/遮罩：不得改变原滚动位置 → 只用 `focus({ preventScroll: true })`；
 * - 应用：面板退场后列表已重渲染，焦点必须可见 → 额外即时 `scrollIntoView({ block: "nearest" })`
 *   （已在视口内时不产生滚动，桌面右栏即属此情况）。
 */
export function focusEntryButton(
  entry: HTMLElement | null,
  options: { ensureVisible: boolean },
): void {
  if (!entry) return;
  entry.focus({ preventScroll: true });
  if (options.ensureVisible) {
    // 列表替换后，日期目录由 MutationObserver 重建；手机上它位于 HUD 之前。
    // 等这轮目录更新结束再量位置，避免新增日期行把已定位的焦点推出视口。
    queueMicrotask(() => {
      if (document.activeElement !== entry || !entry.isConnected) return;
      entry.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
    });
  }
}
