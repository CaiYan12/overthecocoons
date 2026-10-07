/**
 * 展示字体字集覆盖断言（T12，UI 票 #29）。
 *
 * 三端锁定（互不互替）：
 * 1. 票面独立事实：票 #29/#17 明文列出的固定大字文案（站名与 Hero、菜单大字项、长文 h1、
 *    KPageHead 大字含全部 12 主题名、日组头日期数字与月份名、Latin）逐字符 ⊆ 字集；
 * 2. 组件源码再提取：正则锚定 KHeader/KHero/KMenu 等真实源码字符串，逐字符 ⊆ 字集——
 *    组件文案改动而字集未跟进时在此变红；
 * 3. 入库清单一致性：public/fonts/display-charset.json 与模块字集逐字符一致（子集文件
 *    由该清单经 pyftsubset 一次性生成；清单漂移 = 字体与站点文案脱钩）。
 * 另断言 woff2 与 OFL 许可文件入库在位、woff2 体积上限（子集应数百 KB 内）。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  displayCharset,
  DISPLAY_FONT_FAMILY,
  DISPLAY_FONT_FILE,
  HERO_TITLE_LINES,
} from "../../src/lib/display-font.ts";
import { EN_LABEL, monthEn, TOPICS } from "../../src/lib/timeline.ts";

const ROOT = join(import.meta.dirname, "../..");
const FONT_FILE = join(ROOT, "public/fonts", DISPLAY_FONT_FILE);
const OFL_FILE = join(ROOT, "public/fonts/OFL.txt");
const MANIFEST_FILE = join(ROOT, "public/fonts/display-charset.json");

/** 票面独立事实（#29/#17 定稿列出的固定大字文案类别，逐条对应票面措辞）。 */
const TICKET_FACT_TEXTS: string[] = [
  "跳出茧房", // 站名与 Hero
  "时间线", "来源", "关于", "原则", "隐私", // 菜单大字项
  "公共时间线", // KPageHead 大字「全部」分支
  ...TOPICS, // KPageHead 大字全部 12 主题名（主题页大字显示主题名）
  "OVER THE COCOONS", // Hero Latin
  ...Array.from({ length: 12 }, (_, i) => monthEn(String(i + 1).padStart(2, "0"))), // 月份名
  ...Object.values(EN_LABEL), // 菜单 ghost 大字
  "0123456789", // 日期数字
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ", // 基础 Latin
  "·：（）:-", // 实际用到标点（— 仅在 <title>/注释，不进展示槽位；- 为 KHero 幽灵日期空快照占位「--」）
  " ", // 日组头大字「OCTOBER 07」空格
];

test("票面固定大字文案逐字符 ⊆ 模块字集（#29/#17 独立事实）", () => {
  const charset = new Set(displayCharset());
  const missing: string[] = [];
  for (const text of TICKET_FACT_TEXTS) {
    for (const ch of text) {
      if (!charset.has(ch)) {
        missing.push(`${text} → 「${ch}」(U+${ch.codePointAt(0)!.toString(16).toUpperCase()})`);
      }
    }
  }
  assert.deepEqual(missing, [], `票面固定文案字符不在字集：\n${missing.join("\n")}`);
});

test("组件源码锚定再提取：站名/Hero/菜单大字逐字符 ⊆ 字集（源码即事实源）", () => {
  const charset = new Set(displayCharset());
  const header = readFileSync(join(ROOT, "src/components/KHeader.astro"), "utf-8");
  const hero = readFileSync(join(ROOT, "src/components/KHero.astro"), "utf-8");
  const menu = readFileSync(join(ROOT, "src/components/KMenu.astro"), "utf-8");

  const brand = header.match(/class="k-brand"[^>]*>([^<]+)</)?.[1];
  assert.equal(brand, "跳出茧房", "KHeader 站名锚点应命中");
  const heroEn = hero.match(/data-heroen>([^<]+)</)?.[1];
  assert.equal(heroEn, "OVER THE COCOONS", "KHero ghost 英文锚点应命中");
  // T13（UI 票 #30）：l2 行「茧」被丝线挂点（.silk-anchor）包裹、挂点内含 aria-hidden SVG——
  // 行文本＝挂点内「茧」+ SVG 之后的「房」，拼回后仍须与票面行文案逐字一致
  const linePlain = hero.match(/<span class="line">([^<]+)<\/span>/)?.[1] ?? "";
  const anchorChar = hero.match(/class="silk-anchor">([^<]+)</)?.[1] ?? "";
  const line2Tail = hero.match(/<\/svg><\/span>([^<]+)<\/span>\s*<\/h1>/)?.[1] ?? "";
  const lines = [linePlain, anchorChar + line2Tail];
  assert.equal(anchorChar, "茧", "丝线挂点应包住「茧」字");
  assert.deepEqual(lines, [...HERO_TITLE_LINES], "KHero 标题两行锚点应命中");
  const labels = [...menu.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(labels.length >= 5, "KMenu 菜单项锚点应命中");

  for (const text of [brand!, heroEn!, ...lines, ...labels]) {
    for (const ch of text) {
      assert.ok(
        charset.has(ch),
        `组件源码文案字符「${ch}」(U+${ch.codePointAt(0)!.toString(16).toUpperCase()}) 不在字集（来自「${text}」）`,
      );
    }
  }
});

test("入库清单 display-charset.json 与模块字集逐字符一致（子集文件的事实源）", () => {
  assert.ok(existsSync(MANIFEST_FILE), "清单文件应已入库（node scripts/derive-display-charset.ts 生成）");
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf-8")) as {
    family: string;
    file: string;
    charCount: number;
    charset: string[];
  };
  assert.equal(manifest.family, DISPLAY_FONT_FAMILY, "清单族名应与模块常量一致");
  assert.equal(manifest.file, DISPLAY_FONT_FILE, "清单文件名应与模块常量一致");
  assert.equal(manifest.charCount, manifest.charset.length, "charCount 应与 charset 数组一致");
  assert.deepEqual(manifest.charset, displayCharset(), "清单字集应与模块字集逐字符一致（顺序含码点序）");
});

test("子集 woff2 与 OFL 许可入库在位；woff2 体积在子集合理上限内", () => {
  assert.ok(existsSync(FONT_FILE), `${DISPLAY_FONT_FILE} 应提交入库（public/fonts/）`);
  assert.ok(existsSync(OFL_FILE), "OFL.txt 应提交入库（思源宋体许可）");
  const ofl = readFileSync(OFL_FILE, "utf-8");
  assert.ok(ofl.includes("SIL OPEN FONT LICENSE"), "OFL.txt 应为 SIL Open Font License 文本");
  // 官方 LICENSE.txt（2.003R）形态：Adobe 版权 + Reserved Font Name「Source」——
  // 完整族名「Source Han Serif」只出现在字体 name 表（已由 cmap/name 校验背书），不在此文本
  assert.ok(ofl.includes("Copyright 2017-2022 Adobe"), "OFL.txt 应含 Adobe 版权声明");
  assert.ok(ofl.includes("Reserved Font"), "OFL.txt 应含 Reserved Font Name 声明");
  const size = statSync(FONT_FILE).size;
  assert.ok(
    size > 10_000,
    `woff2 应为非平凡文件（当前 ${size} B）——空文件/截断说明子集化失败`,
  );
  assert.ok(
    size <= 500_000,
    `woff2 体积 ${size} B 超出 500KB 上限——检查字集是否混入冗余（如整字 CJK 码表）`,
  );
});

test("子集 woff2 的族名与清单一致（@font-face 声明层实测）", () => {
  // 字体文件内部 name 表的一致性由再生成流程背书（--name-IDs='*' 保留官方 name 表，
  // 提交前 fontTools 校验 cmap/许可）；此处断言 @font-face 声明族名与清单一致。
  // 审查修复后 @font-face 内联于 BaseLayout（URL 经 BASE_URL 拼接，dev/产物同一地址）。
  const layout = readFileSync(join(ROOT, "src/layouts/BaseLayout.astro"), "utf-8");
  assert.ok(
    layout.includes(`font-family:"${DISPLAY_FONT_FAMILY}"`),
    "BaseLayout 内联 @font-face 族名应与清单一致",
  );
  assert.ok(layout.includes("set:html={fontFaceCss}"), "@font-face 应经内联 style 注入（dev/产物同 URL）");
});
