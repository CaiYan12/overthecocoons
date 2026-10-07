/**
 * 丝纹确定性单测（T13，UI 票 #30）：条目稳定 ID → 构建期 SVG 曲线参数的纯函数。
 *
 * 锁定四件事（票面验收）：
 * 1. 同 ID 恒同输出（构建期与客户端重渲染两路注入同构的前提）；
 * 2. 不同 ID 输出不同（版画携带每条独有信息——T9 移除竖排词+序号后的替代物）；
 * 3. 输出为合法 SVG path d 语法（M + 3 段 C，数值有界，可直接内联进 viewBox 0 0 264 198）；
 * 4. 前置校验：非 64 位十六进制稳定 ID 拒绝（调用方传契约 ID，畸形输入必须显式失败）。
 *
 * 另含靛色对比度实测（票面口径：浅 #2F5168 / 深 #8DB3C9，对两主题纸面）——
 * 按 WCAG 2.x 相对亮度公式独立复算，不导入实现，数字即证据。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { silkTexturePaths } from "../../src/lib/silk.ts";

/** 从 fixture 快照取真实稳定 ID（64hex），保证测试跑在真实数据形态上。 */
function fixtureIds(count: number): string[] {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "snapshot.json"), "utf-8"),
  ) as { entries: Array<{ id: string }> };
  return snapshot.entries.slice(0, count).map((entry) => entry.id);
}

const HEX = "0123456789abcdef";
/** 确定性合成 64hex ID（测试自己的固定序列，不依赖被测函数）。 */
function syntheticId(seed: number): string {
  let state = (seed * 2654435761) >>> 0;
  let out = "";
  for (let i = 0; i < 64; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out += HEX[(state >>> 24) & 0xf];
  }
  return out;
}

test("丝纹确定性：同 ID 两次调用输出逐字段相同（构建期与客户端同构前提）", () => {
  for (const id of [...fixtureIds(3), syntheticId(1), syntheticId(2)]) {
    const a = silkTexturePaths(id);
    const b = silkTexturePaths(id);
    assert.deepEqual(b, a, `同 ID ${id} 必须恒同输出`);
  }
});

test("丝纹唯一性：不同 ID 输出不同（真实 fixture ID 与合成 ID 两两相异）", () => {
  const ids = [...fixtureIds(5), ...Array.from({ length: 7 }, (_, i) => syntheticId(i + 3))];
  const serialized = ids.map((id) => JSON.stringify(silkTexturePaths(id)));
  assert.equal(new Set(serialized).size, ids.length, "12 个不同 ID 的丝纹序列化结果必须两两不同");
});

test("丝纹敏感性：ID 单字符变异即改变输出（64hex 各位均参与派生）", () => {
  const base = syntheticId(42);
  const baseline = JSON.stringify(silkTexturePaths(base));
  // 逐位变异：每一位翻转到另一个 hex 值，输出都不得与基准相同
  for (const pos of [0, 7, 15, 31, 47, 63]) {
    const flipped = base[pos] === "0" ? "1" : "0";
    const mutated = base.slice(0, pos) + flipped + base.slice(pos + 1);
    assert.notEqual(
      JSON.stringify(silkTexturePaths(mutated)),
      baseline,
      `第 ${pos} 位变异后丝纹必须不同`,
    );
  }
});

test("丝纹输出为合法 SVG 路径：4 条曲线、类与线宽档位符合规格、d 语法可解析且数值有界", () => {
  for (const id of [...fixtureIds(3), syntheticId(7)]) {
    const paths = silkTexturePaths(id);
    assert.equal(paths.length, 4, "丝纹固定 4 条曲线（原型 B 版观感：1 灰衬 + 3 红）");
    assert.deepEqual(
      paths.map((p) => p.cls),
      ["s s2", "s", "s", "s"],
      "首条为灰衬（s2），其余为 accent 红——与原型 .silk-texture 类名一致",
    );
    assert.deepEqual(
      paths.map((p) => p.width),
      ["1.2", "2.0", "1.4", "1.0"],
      "线宽档位对照原型（1.2/2/1.4/1），格式化一位小数",
    );
    assert.deepEqual(
      paths.map((p) => p.opacity),
      ["0.5", "0.9", "0.6", "0.35"],
      "透明度档位对照原型（.5/.9/.6/.35）",
    );
    for (const p of paths) {
      // d 语法：M-10.0,<y> 后跟 3 段 C（每段 3 个坐标对），终点 x=274.0（两端出血，统一一位小数）
      const m = p.d.match(
        /^M-10\.0,(\d+\.\d)(?: C\d+\.\d,\d+\.\d \d+\.\d,\d+\.\d \d+\.\d,\d+\.\d){3}$/,
      );
      assert.ok(m, `d 不符合生成语法：${p.d}`);
      const numbers = [...p.d.matchAll(/-?\d+\.\d/g)].map((n) => Number(n[0]));
      const ys = numbers.filter((_, i) => i % 2 === 1);
      for (const y of ys) {
        assert.ok(y >= 0 && y <= 198, `y=${y} 越出 viewBox 0 0 264 198：${p.d}`);
      }
      assert.ok(p.d.endsWith(" 274.0," + ys[ys.length - 1]!.toFixed(1)), `终点必须 x=274（右缘出血）：${p.d}`);
      const xs = numbers.filter((_, i) => i % 2 === 0);
      for (const x of xs) {
        assert.ok(x >= -10 && x <= 274, `x=${x} 越出生成区间：${p.d}`);
      }
      for (const key of ["d", "width", "opacity", "cls"] as const) {
        assert.ok(Number.isFinite(Number(p.width)) && Number.isFinite(Number(p.opacity)), "线宽与透明度必须为有限数值");
        assert.equal(typeof p[key], "string");
      }
    }
  }
});

test("丝纹前置校验：非 64hex 稳定 ID 一律拒绝（契约外输入显式失败，不静默生成）", () => {
  for (const bad of ["", "abc", "0".repeat(63), "0".repeat(65), "Z".repeat(64), `${"g".repeat(64)}`]) {
    assert.throws(() => silkTexturePaths(bad), () => true, `非法 ID 应抛错：${bad.slice(0, 20)}…`);
  }
});

/* ---- 靛色站外信号对比度实测（票面色值，独立复算留数） ---- */

/** WCAG 2.x 相对亮度（sRGB 八位 hex）。 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 对比度比值。 */
function contrast(foreground: string, background: string): number {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("靛色站外信号对比度（票面色值独立复算）：浅 #2F5168/纸面、深 #8DB3C9/墨底均 ≥4.5:1", () => {
  const light = contrast("#2F5168", "#F8F5EC");
  const dark = contrast("#8DB3C9", "#191816");
  assert.ok(light >= 4.5, `浅色靛对纸面实测 ${light.toFixed(2)}:1，须 ≥4.5:1`);
  assert.ok(dark >= 4.5, `深色靛对墨底实测 ${dark.toFixed(2)}:1，须 ≥4.5:1`);
  // 留数：实测值区间锁定（原型口径 ≈7.7 / ≈8.0；偏离该区间说明色值被改动）
  assert.ok(light > 7 && light < 8.5, `浅色实测 ${light.toFixed(2)}:1 应落在原型复算区间（≈7.7）`);
  assert.ok(dark > 7 && dark < 8.5, `深色实测 ${dark.toFixed(2)}:1 应落在原型复算区间（≈8.0）`);
});
