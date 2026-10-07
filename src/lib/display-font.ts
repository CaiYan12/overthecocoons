/**
 * 展示字体（思源宋体 Heavy 子集）常量与固定文案字集来源（T12，UI 票 #29）。
 *
 * 字集规则（票面定稿）：子集只砸在固定大字上——字集由「实际出现在大字号处的固定文案」
 * 决定；条目标题是动态数据，不进固定字集。大字槽位与对应文案：
 * - 站名（.k-brand）与 Hero 标题（.k-hero-title）：跳出茧房
 * - Hero ghost 英文（.k-hero-en）：OVER THE COCOONS
 * - 菜单大字项（.k-mi .lb）：时间线/来源/关于/原则/隐私——长文页 h1（.k-doc h1，
 *   关于/原则/隐私/来源）复用同组字符，无新增
 * - KPageHead 大字（.k-pagehead-big）：「公共时间线」+ 全部 12 主题名（主题页大字显示主题名）
 * - 日组头大字（.k-day-big）与 Hero Latin 日期：英文月份名 + 日期数字
 * - 菜单 ghost 大字（.k-menu-data .ghost）：EN_LABEL 全部英文标签
 * - 数字 0-9 与大写 A-Z 全组（月份名/EN_LABEL/序号/页码的覆盖基座）
 * - 标点取站点固定可见文案中实际出现者（·：：（）、半角冒号与半角连字符——连字符来自
 *   KHero 幽灵日期空快照占位「--」；— 仅出现在 <title> 与注释，不在展示字体槽位，不进字集）
 *
 * 本模块是字集唯一事实源：scripts/derive-display-charset.ts 锚定组件源码提取实际文案
 * 做交叉校验并落盘 scripts/display-charset.txt 与 public/fonts/display-charset.json；
 * tests/unit/display-font.test.ts 以票面独立事实 + 组件源码再提取双端断言。
 * 子集文件与 OFL 许可一次性构建入库；构建与 CI 不依赖任何字体工具。
 */
import { EN_LABEL, monthEn, TOPICS } from "./timeline.ts";

/** 展示字体族名（@font-face 别名——浏览器以 CSS 声明名注册，不要求与字体内部 name 表同名）。 */
export const DISPLAY_FONT_FAMILY = "Source Han Serif SC Heavy Subset";

/** 自托管子集文件名（public/fonts/ 下；BaseLayout preload 与 @font-face 共用）。 */
export const DISPLAY_FONT_FILE = "SourceHanSerifSC-Heavy-Subset.woff2";

/** 站点根相对路径（不带基路径；拼接由 src/lib/paths.ts 的 siteUrl 语义负责）。 */
export const DISPLAY_FONT_PATH = `/fonts/${DISPLAY_FONT_FILE}`;

/** 菜单大字项 = 站点导航 5 项（KMenu .k-mi .lb）；长文页 h1 复用同组（关于/原则/隐私）。 */
export const MENU_LARGE_TEXTS = ["时间线", "来源", "关于", "原则", "隐私"] as const;

/** Hero 标题两行大字（KHero .k-hero-title .line）。 */
export const HERO_TITLE_LINES = ["跳出", "茧房"] as const;

/** 站名（KHeader .k-brand）。 */
export const SITE_NAME = "跳出茧房";

/** Hero ghost 英文（KHero .k-hero-en）。 */
export const HERO_EN = "OVER THE COCOONS";

/** KPageHead 大字「全部」分支文案（pageHeadInfo big 的固定分支）。 */
export const PAGE_HEAD_ALL_BIG = "公共时间线";

/** 大写 A-Z 全组（月份名/EN_LABEL/PUBLIC TIMELINE 等 Latin 大字基座）。 */
const LATIN_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** 数字 0-9 全组（日期大字、菜单序号、页码等）。 */
const DIGITS = "0123456789".split("");

/**
 * 标点：站点固定可见文案中实际出现者（KHero note「首源：… · …」、k-day-sub 分隔符
 * 「 · 」与「（演示数据）」、mode-btn「显示：浅色」、pageHeadInfo sub「 · 」、
 * 日组批次行「hh:mm」的半角冒号、KHero 幽灵日期空快照占位「--」的半角连字符）。
 * 候选须由源码实际存在背书（测试断言）。
 */
const PUNCTUATION = ["·", "：", "（", "）", ":", "-"] as const;

/** 一条字集来源：槽位标识（含票面依据）+ 该槽位固定文案。 */
export interface DisplayTextSource {
  slot: string;
  texts: readonly string[];
}

/** 全部大字槽位的固定文案来源（字集 = 全部来源字符的并集）。 */
export function displayTextSources(): DisplayTextSource[] {
  const months = Array.from({ length: 12 }, (_, i) => monthEn(String(i + 1).padStart(2, "0")));
  return [
    { slot: "站名（.k-brand）", texts: [SITE_NAME] },
    { slot: "Hero 标题（.k-hero-title）", texts: HERO_TITLE_LINES },
    { slot: "Hero ghost 英文（.k-hero-en）", texts: [HERO_EN] },
    { slot: "菜单大字项（.k-mi .lb）+ 长文页 h1（.k-doc h1）", texts: MENU_LARGE_TEXTS },
    { slot: "KPageHead 大字（.k-pagehead-big）", texts: [PAGE_HEAD_ALL_BIG, ...TOPICS] },
    { slot: "日组头大字月份（.k-day-big）与 Hero Latin 日期", texts: months },
    { slot: "菜单 ghost 大字（.k-menu-data .ghost）", texts: Object.values(EN_LABEL) },
    { slot: "数字与大写 Latin 基座", texts: [...DIGITS, ...LATIN_UPPER] },
    { slot: "固定文案实际标点", texts: PUNCTUATION },
  ];
}

/** 字集（去重 + 码点升序；含空格——日组头大字「OCTOBER 07」按空格分词）。 */
export function displayCharset(): string[] {
  const seen = new Set<string>();
  for (const source of displayTextSources()) {
    for (const text of source.texts) {
      for (const ch of text) seen.add(ch);
    }
  }
  seen.add(" ");
  return [...seen].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}
