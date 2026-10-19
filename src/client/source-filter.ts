/**
 * 来源多选面板状态机（Issue #34）。
 *
 * 职责边界（规格 Implementation Decisions）：
 * - 草稿隔离：打开时复制已应用集合；勾选只改草稿与面板提示，不碰正文；取消族丢弃草稿；
 * - 全选三态：全选控件用 input.indeterminate 表达部分选中，点击时按当前态勾满或清空；
 * - 零项草稿：提示「至少选择一个来源」并禁用应用（正式列表不产生零源状态）；
 * - 应用：非空草稿 → 先完成面板退场，再交给时间线视图切换列表（动效在 motion.ts）；
 *   等价集合只关闭，不渲染、不播报列表变化、不动滚动位置；
 * - 焦点与滚动锁：打开聚焦关闭按钮、关闭回到入口按钮并保证可见；背景 overflow 关闭/pagehide 恢复；
 * - 降级：静态入口是通往来源说明页的真实链接，只有本模块初始化成功后才替换为按钮；
 * - 与 MENU 互斥；不写 history / URL / 长期存储（刷新重置语义不因本票改变）。
 *
 * 已应用集合与入口文案的唯一事实源是时间线视图（src/client/timeline-view.ts 的 syncSourceUi），
 * 本模块只读它、只提交草稿，不另存一份。
 */
import {
  SUBSCRIPTIONS,
  allState,
  normalizeSources,
  selectionSummary,
} from "../lib/source-filter.ts";
import {
  resetSourcePanelMotion,
  sourcePanelCloseMotion,
  sourcePanelOpenMotion,
} from "./motion.ts";

/** 已应用来源集合的持有者（由时间线视图提供）。 */
export interface SourceFilterHost {
  /** 当前已应用的来源集合（固定次序，非空）。 */
  appliedSources(): string[];
  /** 应用新的来源集合：调用方保证集合非空且已规范化。 */
  applySources(next: string[]): void;
}

export function initSourceFilter(host: SourceFilterHost): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-ksource]");
  const entry = document.querySelector<HTMLElement>("[data-source-open]");
  if (!dialog || !entry) return;
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-ksource-close]");
  const cancelButton = dialog.querySelector<HTMLButtonElement>("[data-ksource-cancel]");
  const applyButton = dialog.querySelector<HTMLButtonElement>("[data-ksource-apply]");
  const allInput = dialog.querySelector<HTMLInputElement>("[data-ksource-all-input]");
  const note = dialog.querySelector<HTMLElement>("[data-ksource-note]");
  if (!closeButton || !cancelButton || !applyButton || !allInput || !note) return;
  const options = [...dialog.querySelectorAll<HTMLInputElement>(".k-source-input")].filter(
    (input) => SUBSCRIPTIONS.some((item) => item.id === input.value),
  );
  // 结构不完整（选项数量/次序不符）时保持静态降级入口，不接管
  if (options.length !== SUBSCRIPTIONS.length) return;

  let state: "closed" | "opening" | "open" | "closing" = "closed";
  /** 面板草稿（打开时复制已应用集合）。 */
  let draft = new Set<string>();
  /** 应用后在 onClosed 里提交的来源集合（null = 本次关闭不应用）。 */
  let pendingApply: string[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bodyOverflow = "";
  /** 入口按钮（初始化成功后把静态链接原地替换为按钮，保留子节点与类名）。 */
  let button: HTMLButtonElement | null = null;

  const setState = (next: typeof state): void => {
    state = next;
    dialog.dataset.sourceState = next;
  };
  const stopTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const appliedSources = (): string[] =>
    normalizeSources(host.appliedSources()) ?? SUBSCRIPTIONS.map((item) => item.id);

  /* ---- 面板状态同步（只动草稿与提示，不碰正文） ---- */

  const syncOptions = (): void => {
    for (const input of options) input.checked = draft.has(input.value);
    const state = allState([...draft]);
    allInput.checked = state === true;
    allInput.indeterminate = state === "mixed";
    const invalid = draft.size === 0;
    applyButton.disabled = invalid;
    if (invalid) {
      note.textContent = "至少选择一个来源";
      note.dataset.invalid = "";
    } else {
      note.textContent = selectionSummary([...draft]);
      delete note.dataset.invalid;
    }
  };

  /* ---- 打开 / 关闭 ---- */

  const opened = (): void => {
    if (state !== "opening") return;
    stopTimer();
    resetSourcePanelMotion(dialog, false);
    setState("open");
  };

  const finishClose = (): void => {
    if (state !== "closing") return;
    stopTimer();
    const next = pendingApply;
    pendingApply = null;
    if (dialog.open) dialog.close();
    resetSourcePanelMotion(dialog);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    button?.setAttribute("aria-expanded", "false");
    // 焦点回到入口并保证可见（不把页面顶回顶部）
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!next) return;
    // 应用：面板退场完成后才切换列表（列表动效复用既有两段式切换）
    host.applySources(next);
  };

  const closePanel = (apply: string[] | null = null): void => {
    if (!dialog.open) return;
    if (state === "closing") {
      // 退出中再次提交：最后意图接管，不重复播放退出
      if (apply) pendingApply = apply;
      return;
    }
    stopTimer();
    pendingApply = apply;
    setState("closing");
    timer = setTimeout(finishClose, 1500);
    try {
      if (!sourcePanelCloseMotion(dialog, finishClose)) finishClose();
    } catch {
      finishClose();
    }
  };

  const openPanel = (): void => {
    if (dialog.open) return;
    // 与 MENU 互斥：MENU 打开时不叠开面板
    if (document.querySelector<HTMLDialogElement>("[data-kmenu]")?.open) return;
    draft = new Set(appliedSources());
    syncOptions();
    pendingApply = null;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    setState("opening");
    button?.setAttribute("aria-expanded", "true");
    dialog.querySelector<HTMLElement>(".k-source-body")?.scrollTo(0, 0);
    closeButton.focus({ preventScroll: true });
    timer = setTimeout(opened, 1500);
    try {
      if (!sourcePanelOpenMotion(dialog, opened)) opened();
    } catch {
      opened();
    }
  };

  /* ---- 入口接管：静态链接 → 按钮（仅初始化成功后） ---- */

  const takeover = (): void => {
    if (!(entry instanceof HTMLAnchorElement)) return;
    const created = document.createElement("button");
    created.type = "button";
    created.className = entry.className;
    created.setAttribute("data-source-open", "");
    created.setAttribute("data-cursor-soft", "");
    created.setAttribute("aria-haspopup", "dialog");
    created.setAttribute("aria-expanded", "false");
    for (const attribute of ["data-source-title", "data-source-dim"]) {
      const node = entry.querySelector<HTMLElement>(`[${attribute}]`);
      if (node) created.append(node);
    }
    entry.replaceWith(created);
    button = created;
    created.addEventListener("click", () => {
      if (dialog.open) closePanel();
      else openPanel();
    });
  };

  /* ---- 面板内交互 ---- */

  for (const input of options) {
    input.addEventListener("change", () => {
      if (input.checked) draft.add(input.value);
      else draft.delete(input.value);
      syncOptions();
    });
  }

  allInput.addEventListener("change", () => {
    // 全选控件按「点击后的 checked」判定：勾满 → 全选；取消 → 清空
    draft = new Set(allInput.checked ? SUBSCRIPTIONS.map((item) => item.id) : []);
    syncOptions();
  });

  applyButton.addEventListener("click", () => {
    const next = SUBSCRIPTIONS.map((item) => item.id).filter((id) => draft.has(id));
    if (next.length === 0) {
      syncOptions();
      return;
    }
    const applied = appliedSources();
    const equivalent =
      next.length === applied.length && next.every((id, index) => id === applied[index]);
    closePanel(equivalent ? null : next);
  });

  cancelButton.addEventListener("click", () => closePanel());
  closeButton.addEventListener("click", () => closePanel());

  // Esc（原生 cancel）：拦截默认立即关闭，走统一关闭路径（动效模式下播放退出）
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePanel();
  });

  // 真遮罩点击：只有点在 dialog 自身（surface 之外）才算；面板内部点击不取消
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    closePanel();
  });

  // 外部原生 close() 与 BFCache 回收：恢复样式、滚动锁与焦点
  dialog.addEventListener("close", () => {
    if (dialog.open || state === "closed") return;
    pendingApply = null;
    stopTimer();
    resetSourcePanelMotion(dialog);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    button?.setAttribute("aria-expanded", "false");
    button?.focus({ preventScroll: true });
  });

  // 页面离开：强制收尾（丢弃未提交草稿，不误提交、不残留滚动锁）
  window.addEventListener("pagehide", () => {
    if (state === "closed") return;
    pendingApply = null;
    stopTimer();
    if (dialog.open) dialog.close();
    resetSourcePanelMotion(dialog);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    button?.setAttribute("aria-expanded", "false");
  });

  syncOptions();
  setState("closed");
  takeover();
}
