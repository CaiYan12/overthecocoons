/**
 * 展示字体字集推导与子集再生成辅助（T12，UI 票 #29）——一次性工具，不进构建与 CI。
 *
 * 职责：
 * 1. 从组件源码锚定提取「大字号处固定文案」的实际字符串（不是手抄：逐槽位正则锚定真实源码）；
 * 2. 交叉校验：每个提取字符都必须 ∈ src/lib/display-font.ts 的 displayCharset()，
 *    且模块常量（站名/Hero 行/菜单项/公共时间线）必须能在源码锚点命中——双向防漂移；
 * 3. 落盘 scripts/display-charset.txt（pyftsubset --text-file 输入）与
 *    public/fonts/display-charset.json（可机读清单，含再生成命令）。
 *
 * 再生成（一次性，工具装在仓库外：python -m pip install --user fonttools brotli）：
 *   node scripts/derive-display-charset.ts
 *   python -m fontTools.subset <SourceHanSerifSC-Heavy.otf 官方原件> ^
 *     --text-file=scripts/display-charset.txt --flavor=woff2 ^
 *     --output-file=public/fonts/SourceHanSerifSC-Heavy-Subset.woff2 ^
 *     --layout-features='*' --name-IDs='*' --recalc-bounds
 *   python scripts/verify-display-font-cmap.py
 *   （官方原件自 adobe-fonts/source-han-serif GitHub releases 下载；第 3 步为
 *     scripts/verify-display-font-cmap.py——用 fontTools 校验 woff2 cmap 覆盖
 *     display-charset.json 全部字符，通过后方可提交）
 *
 * 本脚本只被手动运行：构建、CI 与页面运行期均不依赖它，也不依赖任何字体工具。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  displayCharset,
  displayTextSources,
  DISPLAY_FONT_FAMILY,
  DISPLAY_FONT_FILE,
  HERO_EN,
  HERO_TITLE_LINES,
  MENU_LARGE_TEXTS,
  PAGE_HEAD_ALL_BIG,
  SITE_NAME,
} from "../src/lib/display-font.ts";

const ROOT = join(import.meta.dirname, "..");

interface Anchor {
  slot: string;
  file: string;
  re: RegExp;
}

/** 锚定提取：每条对应一个大字槽位在源码中的真实字符串形态。 */
const ANCHORS: Anchor[] = [
  { slot: "站名（.k-brand）", file: "src/components/KHeader.astro", re: /class="k-brand"[^>]*>([^<]+)</g },
  { slot: "Hero 标题两行（.k-hero-title .line）", file: "src/components/KHero.astro", re: /<span class="line(?: l2)?">([^<]+)<\/span>/g },
  { slot: "Hero ghost 英文（.k-hero-en）", file: "src/components/KHero.astro", re: /data-heroen>([^<]+)</g },
  { slot: "菜单大字项（.k-mi .lb 的 links label）", file: "src/components/KMenu.astro", re: /label: "([^"]+)"/g },
  { slot: "长文页 h1（Longform heading prop）", file: "src/pages", re: /heading="([^"]+)"/g },
  { slot: "来源页 h1（.k-doc h1）", file: "src/pages/sources.astro", re: /<h1>([^<]+)<\/h1>/g },
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

/** 逐锚点提取实际文案字符串（含去重保序）。 */
function extractAnchored(): Array<{ slot: string; texts: string[] }> {
  const out: Array<{ slot: string; texts: string[] }> = [];
  for (const anchor of ANCHORS) {
    const texts: string[] = [];
    if (anchor.file === "src/pages") {
      for (const name of readdirSync(join(ROOT, "src/pages"))) {
        if (!name.endsWith(".astro")) continue;
        for (const m of read(`src/pages/${name}`).matchAll(anchor.re)) texts.push(m[1]!);
      }
    } else {
      for (const m of read(anchor.file).matchAll(anchor.re)) texts.push(m[1]!);
    }
    if (texts.length === 0) {
      throw new Error(`锚点未命中（组件源码结构变化，须同步更新锚点）：${anchor.slot}`);
    }
    out.push({ slot: anchor.slot, texts: [...new Set(texts)] });
  }
  // 主题名（KPageHead 大字分支）与菜单 ghost 英文（.k-menu-data .ghost）来自 timeline.ts 常量块
  const timelineSrc = read("src/lib/timeline.ts");
  const topicsBlock = timelineSrc.match(/export const TOPICS = \[([\s\S]*?)\] as const/);
  if (!topicsBlock) throw new Error("timeline.ts 的 TOPICS 常量块锚点未命中");
  out.push({ slot: "KPageHead 大字主题名（TOPICS）", texts: [...topicsBlock[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) });
  const labelBlock = timelineSrc.match(/export const EN_LABEL: Record<string, string> = \{[\s\S]*?\n\};/);
  if (!labelBlock) throw new Error("timeline.ts 的 EN_LABEL 常量块锚点未命中");
  out.push({ slot: "菜单 ghost 大字（EN_LABEL）", texts: [...labelBlock[0]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((v) => v !== "全部" && v !== "") });
  return out;
}

/** 交叉校验：锚定提取 ⊆ 模块字集；模块常量必须在锚点命中。 */
function crossValidate(anchored: Array<{ slot: string; texts: string[] }>): void {
  const charset = new Set(displayCharset());
  const problems: string[] = [];
  for (const { slot, texts } of anchored) {
    for (const text of texts) {
      for (const ch of text) {
        if (!charset.has(ch)) problems.push(`锚定文案字符不在字集：${slot}「${ch}」(U+${ch.codePointAt(0)!.toString(16).toUpperCase()})`);
      }
    }
  }
  const grounded = anchored.flatMap((a) => a.texts);
  for (const [name, value] of [
    ["SITE_NAME", SITE_NAME], ["HERO_TITLE_LINES", ...HERO_TITLE_LINES], ["HERO_EN", HERO_EN],
    ["MENU_LARGE_TEXTS", ...MENU_LARGE_TEXTS],
  ] as Array<[string, string]>) {
    if (!grounded.includes(value)) problems.push(`display-font.ts 常量 ${name}（${value}）未能在组件源码锚点命中`);
  }
  // 「公共时间线」的固定分支在 timeline.ts（pageHeadInfo），不在组件锚点范围
  if (!read("src/lib/timeline.ts").includes(PAGE_HEAD_ALL_BIG)) {
    problems.push(`display-font.ts 常量 PAGE_HEAD_ALL_BIG（${PAGE_HEAD_ALL_BIG}）未能在 timeline.ts 命中`);
  }
  if (problems.length) throw new Error(`交叉校验失败：\n${problems.join("\n")}`);
}

/** 标点存在性背书：候选标点必须真实出现在对应固定文案源码中。 */
function validatePunctuation(): void {
  const required: Array<[string, string[]]> = [
    ["·", ["src/components/KHero.astro", "src/components/KMenu.astro"]],
    ["：", ["src/components/KHeader.astro", "src/components/KHero.astro"]],
    ["（", ["src/components/KMenu.astro"]],
    ["）", ["src/components/KMenu.astro"]],
    [":", ["src/components/TimelinePage.astro"]],
    ["-", ["src/components/KHero.astro"]],
  ];
  const problems: string[] = [];
  for (const [ch, files] of required) {
    if (!files.some((f) => read(f).includes(ch))) problems.push(`标点「${ch}」未在其固定文案源文件命中`);
  }
  if (problems.length) throw new Error(`标点存在性校验失败：\n${problems.join("\n")}`);
}

function main(): void {
  const anchored = extractAnchored();
  crossValidate(anchored);
  validatePunctuation();
  const charset = displayCharset();
  const text = charset.join("");

  const regenSubset =
    "python -m fontTools.subset <SourceHanSerifSC-Heavy.otf 官方原件> --text-file=scripts/display-charset.txt " +
    "--flavor=woff2 --output-file=public/fonts/SourceHanSerifSC-Heavy-Subset.woff2 --layout-features='*' --name-IDs='*' --recalc-bounds";
  const manifest = {
    family: DISPLAY_FONT_FAMILY,
    file: DISPLAY_FONT_FILE,
    charCount: charset.length,
    charset,
    derivedFrom: displayTextSources().map((s) => s.slot),
    regenerate:
      "1) node scripts/derive-display-charset.ts  2) " + regenSubset +
      "  3) python scripts/verify-display-font-cmap.py",
  };

  mkdirSync(join(ROOT, "public/fonts"), { recursive: true });
  writeFileSync(join(ROOT, "scripts/display-charset.txt"), text + "\n", "utf-8");
  writeFileSync(join(ROOT, "public/fonts/display-charset.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`charset: ${charset.length} chars -> scripts/display-charset.txt + public/fonts/display-charset.json`);
  console.log(`anchors: ${anchored.map((a) => `${a.slot}(${a.texts.length})`).join(", ")}`);
}

main();
