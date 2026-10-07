/**
 * 显示模式（二态 + 系统初始，维护者 2026-10-07 裁定）：页面打开直接读取系统配色——
 * data-theme=auto + prefers-color-scheme CSS 映射，无 JS 亦生效；显示按钮在浅色 ↔ 深色
 * 间二态切换，「跟随系统」不再是按钮可达态（仅作为未显式选择时的初始行为）。
 * 显式选择持久化（项目专属 key，全站唯一持久化项，隐私规格：仅显示偏好持久化）；历史
 * 遗留的存储值 "auto"（三态时期）视同未选择。存储被拒（隐私模式）降级为内存态。
 * 切换呈现（Ticket 06）：GSAP 可用时走 View Transition 径向揭示（ready 250ms 超时
 * skipTransition 兜底），无 VT API 时降级 k-themefade 颜色过渡；无动效路径直接应用。
 */
import { syncHeroGhost, themeApplyMotion } from "./motion.ts";
import { announce } from "./status.ts";

/** 项目专属存储 key：全站唯一允许写入 localStorage 的键。 */
export const THEME_STORAGE_KEY = "overthecocoons.theme";

type Choice = "light" | "dark";
type Resolved = Choice;

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/** null = 未显式选择（跟随系统）。 */
let choice: Choice | null = null;

function isChoice(value: string | null): value is Choice {
  return value === "light" || value === "dark";
}

function readStored(): Choice | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(value) ? value : null;
  } catch {
    // 存储被拒（隐私模式）：降级为内存态
    return null;
  }
}

function writeStored(value: Choice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // 存储被拒：保持内存态，功能不受影响
  }
}

function systemDark(): boolean {
  return window.matchMedia(SYSTEM_DARK).matches;
}

function resolved(): Resolved {
  return choice ?? (systemDark() ? "dark" : "light");
}

function labelOf(value: Resolved): string {
  return value === "dark" ? "深色" : "浅色";
}

function apply(button: HTMLButtonElement): void {
  document.documentElement.dataset.theme = choice ?? "auto";
  button.textContent = `显示：${labelOf(resolved())}`;
}

export function initTheme(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-mode]");
  if (!button) return;
  choice = readStored();
  apply(button);
  // 未显式选择时跟随系统：系统切换即时反映到按钮标签（配色由 CSS 媒体查询自理）
  const media = window.matchMedia(SYSTEM_DARK);
  const onSystemChange = () => {
    if (choice === null) apply(button);
  };
  if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemChange);
  button.addEventListener("click", () => {
    const next: Choice = resolved() === "dark" ? "light" : "dark";
    choice = next;
    writeStored(next);
    themeApplyMotion(() => {
      apply(button);
      // 深色场景 ghost 透明度随 token 变化（原型 apply 内重同步）
      syncHeroGhost();
      announce(`显示模式：${labelOf(next)}`);
    }, button);
  });
}
