/**
 * 三态显示模式（Ticket 05/06）：浅色 → 深色 → 跟随系统 循环（原型 v-kinetic 行为）。
 * 偏好用项目专属 key 保存在 localStorage（全站唯一持久化项，隐私规格：仅显示偏好持久化）。
 * 存储被拒（隐私模式等 SecurityError）时降级为内存态：切换与播报仍可用。
 * 「跟随系统」由 CSS `:root[data-theme=auto]` + prefers-color-scheme 媒体查询实现，脚本只切属性。
 * 切换呈现（Ticket 06）：GSAP 可用时走 View Transition 径向揭示（ready 250ms 超时
 * skipTransition 兜底），无 VT API 时降级 k-themefade 颜色过渡；无动效路径直接应用。
 */
import { syncHeroGhost, themeApplyMotion } from "./motion.ts";
import { announce } from "./status.ts";

/** 项目专属存储 key：全站唯一允许写入 localStorage 的键。 */
export const THEME_STORAGE_KEY = "overthecocoons.theme";

const MODES = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "auto", label: "跟随系统" },
] as const;

type ModeValue = (typeof MODES)[number]["value"];

// 初值「跟随系统」（T4/UI 票 #21）：与 HTML data-theme="auto" 对齐，模块就绪时无存储
// 不会把跟随系统态打回浅色；有持久化偏好时在 initTheme 内覆盖。循环覆盖三态不变。
let index = MODES.length - 1;

function isModeValue(value: string | null): value is ModeValue {
  return value !== null && MODES.some((mode) => mode.value === value);
}

function readStored(): ModeValue | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isModeValue(value) ? value : null;
  } catch {
    // 存储被拒（隐私模式）：降级为内存态
    return null;
  }
}

function writeStored(value: ModeValue): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // 存储被拒：保持内存态，功能不受影响
  }
}

function apply(button: HTMLButtonElement): void {
  const mode = MODES[index]!;
  document.documentElement.dataset.theme = mode.value;
  button.textContent = `显示：${mode.label}`;
}

export function initTheme(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-mode]");
  if (!button) return;
  const stored = readStored();
  if (stored) index = MODES.findIndex((mode) => mode.value === stored);
  apply(button);
  button.addEventListener("click", () => {
    index = (index + 1) % MODES.length;
    const mode = MODES[index]!;
    themeApplyMotion(() => {
      apply(button);
      // 深色场景 ghost 透明度随 token 变化（原型 apply 内重同步）
      syncHeroGhost();
      announce(`显示模式：${mode.label}`);
    }, button);
    writeStored(mode.value);
  });
}
