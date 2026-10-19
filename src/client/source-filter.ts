/**
 * 来源多选面板状态机（Issue #34）。
 *
 * 职责边界（规格 Implementation Decisions）：
 * - 草稿隔离：打开时复制已应用集合；勾选只改草稿与面板提示，不碰正文；取消族丢弃草稿；
 * - 全选三态：全选控件用 input.indeterminate 表达部分选中，点击时按当前态勾满或清空；
 * - 零项草稿：提示「至少选择一个来源」并禁用应用（正式列表不产生零源状态）；
 * - 应用：非空草稿 → 先完成面板退场，再交给时间线视图切换列表（动效在 motion.ts）；
 *   等价集合只关闭，不渲染、不播报列表变化、不动滚动位置；
 * - 焦点与滚动锁：打开聚焦关闭按钮；关闭回到入口按钮。取消族不改变原滚动位置
 *   （`preventScroll`），应用后焦点必须可见（可滚动，见 ./source-entry.ts）；
 * - 减弱动态：不创建位移/错峰时间线，只做 opacity 轻淡入淡出（motion.ts 的
 *   sourcePanelFadeMotion + kinetic.css 的 reduced 段）；缺库时立即完成开合，两者不混用；
 * - 降级：静态入口是通往来源说明页的真实链接，只有时间线视图真正就绪（host.ready()）
 *   且面板结构完整时才替换为按钮；
 * - 与 MENU 互斥；不写 history / URL / 长期存储（刷新重置语义不因本票改变）。
 *
 * 已应用集合与入口文案的唯一事实源是时间线视图（src/client/timeline-view.ts 的 syncSourceUi），
 * 本模块只读它、只提交草稿，不另存一份。
 */
import {
  SUBSCRIPTION_IDS,
  SUBSCRIPTIONS,
  allState,
  normalizeSources,
  sameSources,
  selectionSummary,
} from "../lib/source-filter.ts";
import {
  resetSourcePanelMotion,
  sourcePanelCloseMotion,
  sourcePanelFadeMotion,
  sourcePanelOpenMotion,
  sourcePointerState,
} from "./motion.ts";
import { focusEntryButton } from "./source-entry.ts";

/** 已应用来源集合的持有者（由时间线视图提供）。 */
export interface SourceFilterHost {
  /** 时间线视图是否真正就绪（数据岛已解析、列表已接管）；未就绪不得接管静态入口。 */
  ready(): boolean;
  /** 当前已应用的来源集合（固定次序，非空）。 */
  appliedSources(): string[];
  /** 应用新的来源集合：调用方保证集合非空且已规范化。 */
  applySources(next: string[]): void;
}

/** 来源多选面板：静态入口 → 按钮接管（时间线视图就绪且结构完整时）。 */
export function initSourceFilter(host: SourceFilterHost): void {
  // 渐进增强前置条件（规格）：筛选能力未成功初始化时保留静态链接入口。
  if (!host.ready()) return;
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
    (input) => SUBSCRIPTION_IDS.includes(input.value),
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
    normalizeSources(host.appliedSources()) ?? [...SUBSCRIPTION_IDS];

  /* ---- 面板状态同步（只动草稿与提示，不碰正文） ---- */

  const syncOptions = (): void => {
    for (const input of options) input.checked = draft.has(input.value);
    const allCheckedState = allState([...draft]);
    allInput.checked = allCheckedState === true;
    allInput.indeterminate = allCheckedState === "mixed";
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
    // 原生 dialog.close() 会把焦点还给打开前的元素，部分引擎（实测移动 WebKit）随焦点
    // 产生一次滚动偏移。取消路径不得改变原滚动位置（规格），因此先记录并复位。
    const scrollBefore = window.scrollY;
    // 先落状态再 close()：close 事件处理器对已收尾的路径直接返回，不重复回收。
    setState("closed");
    if (dialog.open) dialog.close();
    resetSourcePanelMotion(dialog);
    document.body.style.overflow = bodyOverflow;
    button?.setAttribute("aria-expanded", "false");
    // 取消族不得改变原滚动位置（规格）：只用 preventScroll 落焦点。应用路径的
    // 「焦点可见」由列表重渲染后的 renderView(focusSourceEntry) 负责。
    focusEntryButton(button, { ensureVisible: false });
    if (!next && Math.abs(window.scrollY - scrollBefore) > 0.5) {
      // 引擎把焦点滚动一并带出：立即复位到关闭前位置（取消不移动页面）。
      window.scrollTo({ top: scrollBefore, behavior: "instant" });
    }
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
    const fade = sourcePanelFadeMotion(dialog, 0);
    try {
      if (sourcePanelCloseMotion(dialog, finishClose)) {
        timer = setTimeout(finishClose, 1500);
      } else if (fade) {
        // 减弱动态：不创建位移时间线，只等 opacity 淡出（CSS transition）结束
        timer = setTimeout(finishClose, fade);
      } else {
        finishClose();
      }
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
    const fade = sourcePanelFadeMotion(dialog, 1);
    try {
      if (sourcePanelOpenMotion(dialog, opened)) {
        timer = setTimeout(opened, 1500);
      } else if (fade) {
        timer = setTimeout(opened, fade);
      } else {
        // 缺动效库（非减弱动态）：按规格立即完成开合，不混入淡入淡出
        opened();
      }
    } catch {
      opened();
    }
  };

  /* ---- 面板光标可读性（B9：透明 dialog 顶层无法反相，指针在面板外时用墨色） ---- */

  const syncPointer = (event: PointerEvent): void => {
    if (!dialog.open) return;
    const next = sourcePointerState(dialog, event.clientX, event.clientY);
    if (next === null) dialog.removeAttribute("data-source-pointer");
    else if (dialog.dataset.sourcePointer !== next) dialog.dataset.sourcePointer = next;
  };
  document.addEventListener("pointermove", syncPointer, { passive: true });
  window.addEventListener("pagehide", () => {
    document.removeEventListener("pointermove", syncPointer);
  }, { once: true });

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
    draft = new Set(allInput.checked ? SUBSCRIPTION_IDS : []);
    syncOptions();
  });

  applyButton.addEventListener("click", () => {
    const next = SUBSCRIPTION_IDS.filter((id) => draft.has(id));
    if (next.length === 0) {
      syncOptions();
      return;
    }
    // 等价集合只关闭：不渲染、不播报列表变化、不动滚动位置（规格）
    closePanel(sameSources(next, appliedSources()) ? null : next);
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

  // 外部原生 close() 与 BFCache 回收：恢复样式、滚动锁与焦点（不滚动，保持原阅读位置）
  dialog.addEventListener("close", () => {
    if (dialog.open || state === "closed") return;
    pendingApply = null;
    stopTimer();
    resetSourcePanelMotion(dialog);
    setState("closed");
    document.body.style.overflow = bodyOverflow;
    button?.setAttribute("aria-expanded", "false");
    focusEntryButton(button, { ensureVisible: false });
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
