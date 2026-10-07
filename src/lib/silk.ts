/**
 * 丝纹（T13，UI 票 #30）：由条目稳定 ID 派生的构建期确定性 SVG 曲线参数。
 *
 * 设计基准：docs/design/prototype-silk.html B 版（默认态）`.silk-texture`——
 * viewBox 0 0 264 198、两端出血（x -10 → 274）、4 条曲线（1 条灰衬 `s s2` + 3 条 accent 红 `s`），
 * 线宽/透明度档位（1.2/.5、2/.9、1.4/.6、1/.35）直取原型样例；曲线形状由 ID 经
 * FNV-1a 混杂 + mulberry32 PRNG 派生（整数运算按 ECMAScript 规范跨引擎一致，无 Math.random）。
 * 参数为「实现者拟定，总审定稿」（ADR 0005 留档）。
 *
 * 纯函数、零 I/O、无 Node API：构建期（Astro 组件 frontmatter）与客户端重渲染
 * （timeline-view）共用同一实现，保证静态层与客户端渲染的丝纹逐字节同构。
 */

import { HEX64 } from "../domain/contract.ts";

/** 单条丝纹曲线的可渲染参数（属性名与 SVG path 属性一一对应）。 */
export interface SilkPath {
  /** path class：`"s"`（accent 红）或 `"s s2"`（灰衬）。 */
  cls: string;
  /** path d 属性（M + 3 段 C，一位小数定点格式化）。 */
  d: string;
  /** stroke-width（格式化字符串，直接内插 SVG）。 */
  width: string;
  /** opacity（格式化字符串，直接内插 SVG）。 */
  opacity: string;
}

/** viewBox 属性字面量（时间线/详情两个注入点共用，与 VIEW_W/VIEW_H 逐字一致）。 */
export const SILK_VIEWBOX = "0 0 264 198";

/** viewBox 尺寸（与注入处 `<svg viewBox>` 逐字一致）。 */
const VIEW_W = 264;
const VIEW_H = 198;
/** 左右出血常量（与原型样例一致：曲线从 -10 画到 274）。 */
const X_LEFT = -10;
const X_RIGHT = VIEW_W + 10;

/** FNV-1a 32 位混杂（覆盖全部输入字符）。 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32 PRNG：种子确定则序列确定；仅用 | >>> Math.imul，跨引擎逐位一致。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] 内取一位小数的确定值。 */
function pick(rng: () => number, min: number, max: number): number {
  return Math.round((min + rng() * (max - min)) * 10) / 10;
}

/** 定点一位小数格式化（消除浮点尾差，保证序列化稳定）。 */
function fixed(value: number): string {
  return value.toFixed(1);
}

/** 单条曲线档位：y 波动带（克制密度，不超出 viewBox）、控制点摆幅。 */
interface SilkBand {
  cls: string;
  width: string;
  opacity: string;
  yMin: number;
  yMax: number;
  ampMin: number;
  ampMax: number;
}

/** 档位直取原型样例（线宽/透明度）；y 带与摆幅为视觉密度克制的实现者参数（ADR 0005）。 */
const BANDS: readonly SilkBand[] = [
  { cls: "s s2", width: "1.2", opacity: "0.5", yMin: 128, yMax: 190, ampMin: 18, ampMax: 34 },
  { cls: "s", width: "2.0", opacity: "0.9", yMin: 30, yMax: 170, ampMin: 34, ampMax: 62 },
  { cls: "s", width: "1.4", opacity: "0.6", yMin: 50, yMax: 185, ampMin: 26, ampMax: 52 },
  { cls: "s", width: "1.0", opacity: "0.35", yMin: 20, yMax: 140, ampMin: 20, ampMax: 44 },
] as const;

/**
 * 由稳定 ID 派生丝纹曲线参数。
 *
 * @param id 条目稳定 ID（64 位小写十六进制，即 PublicEntry.id）。
 * @returns 4 条曲线的渲染参数（顺序固定：灰衬在前，主红随后）。
 * @throws Error 当 id 不是 64hex 时（契约外输入显式失败）。
 */
export function silkTexturePaths(id: string): SilkPath[] {
  if (!HEX64.test(id)) {
    throw new Error(`丝纹种子必须是 64 位十六进制稳定 ID：${JSON.stringify(id.slice(0, 12))}…`);
  }
  // 双种子混杂：正序 FNV + 逆序 FNV 拼接，让任意位差异充分扩散到整个序列
  const seed = (fnv1a(id) ^ Math.imul(fnv1a([...id].reverse().join("")), 0x9e3779b1)) >>> 0;
  const rng = mulberry32(seed);

  // 锚点 x：中间两个锚位在窄区间内抖动，首尾恒为出血端
  const x1 = pick(rng, 78, 98);
  const x2 = pick(rng, 171, 191);

  return BANDS.map((band) => {
    const ys = [
      pick(rng, band.yMin, band.yMax),
      pick(rng, band.yMin, band.yMax),
      pick(rng, band.yMin, band.yMax),
      pick(rng, band.yMin, band.yMax),
    ];
    const segs = [
      [X_LEFT, x1],
      [x1, x2],
      [x2, X_RIGHT],
    ];
    let d = `M${fixed(X_LEFT)},${fixed(ys[0]!)}`;
    segs.forEach(([fromX, toX], index) => {
      const span = toX - fromX;
      const amp = pick(rng, band.ampMin, band.ampMax);
      const sign = rng() < 0.5 ? -1 : 1;
      const c1y = clampY(ys[index]! + sign * amp);
      const c2y = clampY(ys[index + 1]! - sign * amp);
      d +=
        ` C${fixed(fromX + span * 0.35)},${fixed(c1y)}` +
        ` ${fixed(toX - span * 0.35)},${fixed(c2y)}` +
        ` ${fixed(toX)},${fixed(ys[index + 1]!)}`;
    });
    return { cls: band.cls, d, width: band.width, opacity: band.opacity };
  });
}

/** 控制点 y 收敛回 viewBox 内（曲线本身不过界，控制点也不得过界以保证语法判定简单）。 */
function clampY(value: number): number {
  return Math.min(VIEW_H, Math.max(0, value));
}

/** 版画左下角 ID 前缀标注（原型 `.sid`）：取稳定 ID 前 6 位 + 省略号。 */
export function silkSidLabel(id: string): string {
  if (!HEX64.test(id)) {
    throw new Error(`丝纹标注必须是 64 位十六进制稳定 ID：${JSON.stringify(id.slice(0, 12))}…`);
  }
  return `#${id.slice(0, 6)}…`;
}
