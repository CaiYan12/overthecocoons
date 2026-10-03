/**
 * 详情页复制链接（Ticket 05）：navigator.clipboard 优先，失败回退 execCommand；
 * 成功/失败都经 aria-live 区域播报（MVP-05：复制实际成功/失败）。
 * 按钮静态层 hidden（无 JS 不出现死按钮），脚本初始化时解除 hidden——渐进增强不改静态版式。
 */
import { announce } from "./status.ts";

async function copyViaClipboardApi(text: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒或 API 异常：走回退路径
  }
  return false;
}

function copyViaExecCommand(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function initCopyLink(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-copy-link]");
  if (!button) return;
  button.hidden = false;
  button.addEventListener("click", () => {
    const url = window.location.href;
    void copyViaClipboardApi(url)
      .then((ok) => (ok ? true : copyViaExecCommand(url)))
      .then((ok) => {
        announce(ok ? "链接已复制" : "复制未成功，请手动复制浏览器地址栏中的链接");
      });
  });
}
