/**
 * 构建期文件路径校验（安全加固，2026-10-20）：把 CLI / 环境变量传入的路径限制在项目根内。
 *
 * 背景：Mimosa pre-push 门禁对 `scripts/build-snapshot.ts` 的 `--out` 与
 * `src/lib/snapshot.ts` 的 `SNAPSHOT_PATH` 报了路径穿越（CWE-22）。这两处路径确实来自
 * 「外部输入」（命令行参数、环境变量），虽然实际只由 CI 与本地脚本提供，仍按纵深防御收紧：
 * 解析后必须落在允许的根目录内，越界即抛错并给出明确原因——不静默回退、不猜测意图。
 *
 * 设计取舍：
 * - 保留「绝对路径」能力：CI 与本地脚本可能给出任意绝对路径，但只接受**位于根内**的绝对路径；
 * - 用 `path.resolve` + `path.relative` 判定包含关系（而非字符串前缀比较），避免
 *   `/repo-evil` 冒充 `/repo` 的子路径；`_relative_` 以 `..` 开头或为绝对路径即视为越界；
 * - Windows 盘符大小写差异由 `path.resolve` 统一，比较时不再自行改写大小写。
 *
 * 本模块是纯函数（除 fs 常量外无 I/O），可被 Node 测试直接导入。
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

/** 路径越界（含空路径）时抛出的错误类型，便于调用方区分「参数问题」与「IO 问题」。 */
export class PathOutsideRootError extends Error {
  readonly input: string;
  readonly roots: readonly string[];

  constructor(input: string, roots: readonly string[], detail: string) {
    super(`路径越界（${detail}）：${input} 不在允许的根目录内（${roots.join("、")}）`);
    this.name = "PathOutsideRootError";
    this.input = input;
    this.roots = roots;
  }
}

/**
 * 把 `input` 解析为绝对路径，并要求其落在 `roots` 之一内。
 *
 * @param input 用户/环境变量给出的路径（相对路径按 `roots[0]` 解析）
 * @param roots 允许的根目录列表（必须至少一个，且均为绝对路径）
 * @returns 规范化后的绝对路径
 * @throws PathOutsideRootError 输入为空、含 NUL 字节，或解析后不落在任何根内
 */
export function resolveWithinRoots(input: string, roots: readonly string[]): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new PathOutsideRootError(String(input), roots, "路径为空");
  }
  // NUL 字节会在部分系统调用处截断路径（CWE-158），直接拒绝而不是交给底层。
  if (input.includes("\u0000")) {
    throw new PathOutsideRootError(input, roots, "路径含 NUL 字节");
  }
  if (roots.length === 0) {
    throw new PathOutsideRootError(input, roots, "未配置允许的根目录");
  }
  const absoluteRoots = roots.map((root) => {
    if (!isAbsolute(root)) {
      throw new PathOutsideRootError(input, roots, `根目录必须是绝对路径：${root}`);
    }
    return resolve(root);
  });
  const absoluteTarget = isAbsolute(input) ? resolve(input) : resolve(absoluteRoots[0]!, input);
  const inside = absoluteRoots.some((root) => {
    const rel = relative(root, absoluteTarget);
    // `relative` 返回 "" 表示与根同路径（允许指代根本身）；
    // 以 ".." 开头、或以盘符形式（Windows 跨盘）返回绝对路径，均表示越界。
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  });
  if (!inside) {
    throw new PathOutsideRootError(input, absoluteRoots, "解析后越出根目录");
  }
  return absoluteTarget;
}

/** 单根便捷包装（多数调用点只允许一个根）。 */
export function resolveWithinRoot(input: string, root: string): string {
  return resolveWithinRoots(input, [root]);
}
