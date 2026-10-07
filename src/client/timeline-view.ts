/**
 * 时间线视图增强（Ticket 05/06）：客户端接管静态链接式筛选与分页（原型 v-kinetic 行为）。
 *
 * 渐进增强契约：
 * - 静态层（T04）是可独立工作的链接式页面；本模块只在存在 [data-klist] 与数据岛时初始化；
 * - 渲染口径复用 src/lib/timeline.ts（sortEntriesDesc/paginate/topicPagePath/entryLayout/dayHeadInfo 等），
 *   不镜像逻辑；DOM 结构与 KEntry/KEmpty/KPager/TimelinePage 输出一致，CSS 不区分两种来源；
 * - 筛选优先于分页；主题切换重置页码；空主题渲染真实空态与「查看全部」；
 * - 主题切换（Ticket 06）：GSAP 可用时走两段式内容过渡（出 260ms blur+scale / 入 340ms，
 *   日期组头先行、条目 +120ms 延迟揭示），列表动效（进度线 scrub/节点激活/分层揭示）随每次
 *   渲染由 motion.onListRendered 重建（listCtx revert 回收，ScrollTrigger 无泄漏）；
 *   丝线 B 版 rail 为静态结构（常驻红线+钉点），进度线 scaleY 叠合其上（T14 恢复）。
 * - 阅读位置仅存于本次访问内存（模块变量，绝不写 localStorage/sessionStorage）：
 *   仅由用户手势（滚轮/触摸/滚动键）触发的滚动记录阅读条目；翻页/切主题返回时尽量按原条目
 *   恢复或回退有效页码并经 aria-live 播报（决策见 ./position.ts）；
 * - 数据来自页面内嵌 JSON 数据岛（与构建同源），解析失败时静默退出，保持静态层可用。
 */
import type { PublicEntry } from "../domain/contract.ts";
import type { ClientData } from "../lib/client-data.ts";
import type { DayHeadInfo } from "../lib/timeline.ts";
import {
  EN_LABEL,
  PAGE_SIZE,
  TOPICS,
  beijingDate,
  dayHeadInfo,
  entryLayout,
  formatClock,
  formatDateTime,
  latestDayStats,
  monthEn,
  pageHeadInfo,
  paginate,
  sortEntriesDesc,
  topicPagePath,
} from "../lib/timeline.ts";
import { isExternalUrl } from "../lib/links.ts";
import { SILK_VIEWBOX, silkSidLabel, silkTexturePaths } from "../lib/silk.ts";
import { animateTopicSwitch, moveIndicator, onListRendered } from "./motion.ts";
import { resolveRestore } from "./position.ts";
import { announce } from "./status.ts";

/** 阅读基准线（视口顶部向下像素数，header 高度量级）：线所在条目视为正在阅读。 */
const READ_LINE = 100;
/** 视为滚动阅读的用户手势按键。 */
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

let base = "";
let isFixture = false;
let sorted: PublicEntry[] = [];
let topic = "全部";
let list: HTMLElement;
let pager: HTMLElement;
let lastReadId: string | null = null;
let rafScheduled = false;
let focusHeaderAllTab = false;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function currentFiltered(): PublicEntry[] {
  return topic === "全部" ? sorted : sorted.filter((entry) => entry.topic === topic);
}

/* ---- 客户端渲染（与 T04 静态输出同构） ---- */

function mediaHtml(entry: PublicEntry): string {
  // T9 版面减负：与 KEntryMedia.astro 同构——无竖排主题词与出血大序号，art 层纯装饰 aria-hidden
  // T14（UI 票 #31）：tilt 中间层恢复（T11 移除撤销），与 KEntryMedia.astro 保持三层同构
  // T13（UI 票 #30）：丝纹由稳定 ID 经 src/lib/silk.ts 构建期/客户端同一函数派生（同构注入）
  const clock = formatClock(entry.firstSeenAt);
  const texture = silkTexturePaths(entry.id)
    .map((p) => `<path class="${p.cls}" d="${p.d}" stroke-width="${p.width}" opacity="${p.opacity}"></path>`)
    .join("");
  return `<div class="k-media" data-cursor="OPEN"><div class="k-media-tilt"><div class="k-media-art" aria-hidden="true"><span class="tag"><i></i><span class="tm">${clock}</span></span><svg class="silk-texture" viewBox="${SILK_VIEWBOX}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${texture}</svg><span class="sid">${silkSidLabel(entry.id)}</span></div></div></div>`;
}

function metaHtml(entry: PublicEntry): string {
  const collected = formatDateTime(entry.firstSeenAt);
  // UI 票 #10：分隔符并入其后段（.seg），折行后「·」出现在行首而非行尾悬挂（与 KEntryMeta.astro 同构）
  // T13：ext 类由确定性规则判定（与构建期同一函数；客户端 origin 即当前站点 origin，与
  // Astro.site 的部署 origin 一致），站外才染靛
  const ext = entry.url
    ? `<span class="seg"><span class="sep">·</span><a class="${isExternalUrl(entry.url, location.origin) ? "ext" : ""}" href="${esc(entry.url)}" target="_blank" rel="noopener" data-cursor="LINK">查看百度搜索结果 ↗</a></span>`
    : "";
  return `<p class="k-meta"><span>百度热点</span><span class="seg"><span class="sep">·</span><span class="tpc">${esc(entry.topic)}</span></span><span class="seg"><span class="sep">·</span>收录 ${collected}</span>${ext}</p>`;
}

function entryHtml(entry: PublicEntry, gi: number, di: number, omitTime: boolean): string {
  const layout = entryLayout(di, Boolean(entry.summary));
  const time = omitTime
    ? ""
    : `<div class="k-time"><time datetime="${entry.firstSeenAt}">${formatClock(entry.firstSeenAt)}</time></div>`;
  const headline = `<h3 class="k-headline"><a href="${base}/items/${entry.id}/" data-detail data-cursor="VIEW">${esc(entry.title)}</a></h3>`;
  const meta = metaHtml(entry);
  let inner: string;
  if (layout === "layout-compact") {
    // 紧凑行（无摘要）：无版画、无摘要段，标题 + meta 紧凑呈现（ADR 0003）
    inner = `<div class="k-text">${headline}${meta}</div>`;
  } else {
    const summary = entry.summary ? `<p class="k-summary">${esc(entry.summary)}</p>` : "";
    const media = mediaHtml(entry);
    if (layout === "layout-a") inner = `<div class="k-text">${headline}${summary}${meta}</div>${media}`;
    else inner = `${media}<div class="k-text">${headline}${summary}${meta}</div>`;
  }
  return `<article class="k-entry ${layout}" data-entry data-gi="${gi}">${time}<div class="k-node-rail" aria-hidden="true"><span class="k-node"></span></div><div class="k-body"><div class="k-body-inner">${inner}</div></div></article>`;
}

function dayHeadHtml(date: string, head: DayHeadInfo, fixtureSuffix: string): string {
  const batch = head.batch
    ? `<p class="k-day-batch">批次 ${head.clock} · ${head.count} 条</p>`
    : "";
  return `<header class="k-day-head"><h2 class="k-day-big">${monthEn(date.slice(5, 7))} ${date.slice(8, 10)}</h2>${batch}<p class="k-day-sub">${date.slice(0, 4)} · 按收录时间排序${fixtureSuffix}</p></header>`;
}

function dayGroupsHtml(slice: PublicEntry[], start: number): string {
  const groups: Array<{ date: string; items: Array<{ entry: PublicEntry; gi: number; di: number }> }> = [];
  slice.forEach((entry, index) => {
    // 日组键按北京时间归属（UI 票 #18）：与 TimelinePage.astro、groupEntriesByDay 同一口径
    const date = beijingDate(entry.firstSeenAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.items.push({ entry, gi: start + index, di: last.items.length });
    } else {
      groups.push({ date, items: [{ entry, gi: start + index, di: 0 }] });
    }
  });
  return groups
    .map((group) => {
      // 日组头规则在分组收敛后按全组条目计算（与 TimelinePage.astro 同口径）
      const head = dayHeadInfo(group.items.map(({ entry }) => entry));
      const fixtureSuffix = isFixture ? "（演示数据）" : "";
      return `<section class="k-day" data-day="${group.date}"><div class="k-line" aria-hidden="true"></div><div class="k-progress" aria-hidden="true"></div><span class="silk-pin-wrap" aria-hidden="true"><span class="silk-pin"></span></span>${dayHeadHtml(group.date, head, fixtureSuffix)}${group.items.map(({ entry, gi, di }) => entryHtml(entry, gi, di, head.batch)).join("")}</section>`;
    })
    .join("");
}

function emptyHtml(emptyTopic: string): string {
  // UI 票 #10：与 KEmpty.astro 保持同文（用户视角，不用规格用语）
  return `<div class="empty"><h3>「${esc(emptyTopic)}」暂无内容</h3><p>首源为百度热点线索，收录与主题映射规则见「来源」页；该主题当前没有可展示的内容。</p><a class="page-btn" data-all data-cursor-soft href="${base}/">查看全部</a></div>`;
}

function renderPager(page: number, totalPages: number, renderTopic: string): void {
  if (totalPages <= 1) {
    pager.innerHTML = "";
    pager.hidden = true;
    return;
  }
  pager.hidden = false;
  const href = (target: number) => `${base}${topicPagePath(renderTopic, target)}`;
  let html =
    page > 1
      ? `<a class="page-btn" data-page="${page - 1}" data-cursor-soft href="${href(page - 1)}" rel="prev" aria-label="上一页">‹</a>`
      : `<span class="page-btn" aria-disabled="true">‹</span>`;
  for (let p = 1; p <= totalPages; p++) {
    html += `<a class="page-btn" data-page="${p}" data-cursor-soft href="${href(p)}"${p === page ? ' aria-current="page"' : ""} aria-label="第 ${p} 页">${pad2(p)}</a>`;
  }
  html +=
    page < totalPages
      ? `<a class="page-btn" data-page="${page + 1}" data-cursor-soft href="${href(page + 1)}" rel="next" aria-label="下一页">›</a>`
      : `<span class="page-btn" aria-disabled="true">›</span>`;
  html += `<span class="of">第 ${page} / ${totalPages} 页</span>`;
  pager.innerHTML = html;
}

/* ---- 同步 header/菜单/HUD/轻量页头 ---- */

/**
 * 轻量页头同步（票 #25）：非首页时间线路由的静态页头（KPageHead）在客户端切主题/翻页后
 * 改写为主题与页码的同一文案口径（pageHeadInfo）；首页是 Hero（无 data-pagehead），空转。
 */
function updatePageHead(renderTopic: string, page: number): void {
  const head = document.querySelector<HTMLElement>("[data-pagehead]");
  if (!head) return;
  const { big, sub } = pageHeadInfo(renderTopic, page, isFixture);
  const bigEl = head.querySelector<HTMLElement>(".k-pagehead-big");
  const subEl = head.querySelector<HTMLElement>(".k-pagehead-sub");
  if (bigEl) bigEl.textContent = big;
  if (subEl) subEl.textContent = sub;
}

function syncTopicUi(nextTopic: string, total: number): void {
  document
    .querySelectorAll<HTMLElement>('[data-ktabs] .tab[data-topic], .k-menu-topics .tab[data-topic]')
    .forEach((tab) => {
      tab.setAttribute("aria-current", tab.dataset.topic === nextTopic ? "true" : "false");
    });
  moveIndicator(nextTopic, false);
  const hudTotal = document.querySelector<HTMLElement>("[data-total]");
  if (hudTotal) hudTotal.textContent = pad2(total);
  const menuTopic = document.querySelector<HTMLElement>("[data-menu-topic]");
  if (menuTopic) menuTopic.textContent = EN_LABEL[nextTopic] ?? "INDEX";
  const menuCount = document.querySelector<HTMLElement>("[data-menu-count]");
  if (menuCount) {
    // 今日条数与 KSite 服务端初值共用 latestDayStats（北京时间日界同一函数），消除双写漂移
    menuCount.textContent = `今日 ${latestDayStats(sorted).count} 条 · 当前主题 ${nextTopic}`;
  }
}

/* ---- 阅读位置追踪（仅用户手势触发的滚动） ---- */

function currentReadingEntryId(): string | null {
  let reading: HTMLElement | null = null;
  for (const element of list.querySelectorAll<HTMLElement>("[data-entry]")) {
    if (element.getBoundingClientRect().top <= READ_LINE) reading = element;
    else break;
  }
  if (!reading) return null;
  const gi = Number(reading.dataset.gi);
  return currentFiltered()[gi]?.id ?? null;
}

function onUserScroll(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const id = currentReadingEntryId();
    if (id) lastReadId = id;
  });
}

/** 阅读位置采样状态：程序化滚动（恢复/回顶）置 paused，用户输入复位（bindScrollTracking）。 */
const samplingState = { paused: false };

function bindScrollTracking(): void {
  // 只在「紧随用户输入（滚轮/触摸/滚动键）」的滚动上采样阅读位置：
  // 程序化滚动（如辅助技术、脚本 scrollIntoView、浏览器行为）不得污染阅读位置记忆。
  // 已知限制（T05 收尾项记录）：滚动条拖拽不产生 wheel/touchmove/滚动键事件，拖拽阅读
  // 不会被采样记忆——方向安全（少记忆而非误记忆），浏览器不在文档层派发滚动条事件，无法可靠识别。
  const USER_INPUT_WINDOW_MS = 200;
  let lastUserInputAt = -Infinity;
  const markInput = () => {
    lastUserInputAt = performance.now();
    samplingState.paused = false;
  };
  window.addEventListener("wheel", markInput, { passive: true });
  window.addEventListener("touchmove", markInput, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (SCROLL_KEYS.has(event.key)) markInput();
  }, true);
  window.addEventListener("scroll", () => {
    if (samplingState.paused) return;
    if (performance.now() - lastUserInputAt <= USER_INPUT_WINDOW_MS) onUserScroll();
  }, { passive: true });
}

/* ---- 视图渲染与恢复 ---- */

function scrollToEntry(index: number): void {
  const element = list.querySelector<HTMLElement>(`[data-gi="${index}"]`);
  if (!element) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  samplingState.paused = true;
  element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function renderView(nextTopic: string, requestedPage: number, options?: { deferredListMotion?: boolean }): void {
  const filtered = nextTopic === "全部" ? sorted : sorted.filter((entry) => entry.topic === nextTopic);
  const decision = resolveRestore(filtered, lastReadId, requestedPage, PAGE_SIZE);
  const { page, totalPages, start, slice } = paginate(filtered, requestedPage);
  const hadFocusInPager = pager.contains(document.activeElement);
  const focusAllTab = focusHeaderAllTab;
  focusHeaderAllTab = false;

  list.innerHTML = filtered.length === 0 ? emptyHtml(nextTopic) : dayGroupsHtml(slice, start);
  renderPager(page, totalPages, nextTopic);
  syncTopicUi(nextTopic, filtered.length);
  updatePageHead(nextTopic, page);
  // 列表动效（进度线 scrub/节点激活/分层揭示）随本次渲染重建；丝线 rail 为静态结构无需重建。
  // 两段式切换时条目揭示延迟 +120ms
  onListRendered(options?.deferredListMotion === true);
  const previousTopic = topic;
  topic = nextTopic;

  let message: string;
  if (filtered.length === 0) {
    message = `已切换主题：${nextTopic}（暂无内容）`;
  } else if (nextTopic !== previousTopic) {
    message = `已切换主题：${nextTopic}，第 ${page} 页，共 ${totalPages} 页`;
  } else {
    message = `已到第 ${page} 页，共 ${totalPages} 页`;
  }
  if (decision.mode === "restore") {
    scrollToEntry(decision.index);
    message += "；已恢复到原阅读位置";
  } else {
    samplingState.paused = true;
    window.scrollTo({ top: 0, behavior: "auto" });
    if (decision.mode === "fallback" && filtered.length > 0 && nextTopic !== previousTopic) {
      // 回退提示仅限主题变化时播报（T05 收尾项）：主题切换后记忆条目不在当前列表，
      // 同主题后续翻页属既有状态，不得重复播报「内容已变化」。记忆保留——
      // 回到包含原条目的主题时仍按原条目恢复（e2e「切主题回退」路径）。
      message += `；内容已变化，原条目不在当前内容中，已回到第 ${page} 页`;
    }
  }
  announce(message);

  // 焦点保持：分页器重渲染后焦点回到当前页按钮；空态「查看全部」回到 header 主题 Tab
  if (hadFocusInPager) {
    pager.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  } else if (focusAllTab) {
    document.querySelector<HTMLElement>(`[data-ktabs] .tab[data-topic="全部"]`)?.focus();
  }
}

function switchTopic(next: string, focusAllTab: boolean): void {
  if (!next || next === topic) return;
  focusHeaderAllTab = focusAllTab;
  // 两段式主题切换（GSAP 可用）：出 260ms → 渲染 → 日期组头先行、条目 +120ms 揭示；
  // 无动效路径直接渲染（render 始终被调用恰好一次）
  animateTopicSwitch(() => renderView(next, 1, { deferredListMotion: true }));
}

/* ---- 初始化 ---- */

function ensurePager(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("[data-pager]");
  if (existing) return existing;
  const created = document.createElement("nav");
  created.className = "pager";
  created.setAttribute("aria-label", "分页");
  list.insertAdjacentElement("afterend", created);
  return created;
}

export function initTimeline(): void {
  const listElement = document.querySelector<HTMLElement>("[data-klist]");
  const island = document.querySelector<HTMLScriptElement>(
    'script[type="application/json"][data-kdata]',
  );
  if (!listElement || !island?.textContent) return;

  let data: ClientData;
  try {
    data = JSON.parse(island.textContent) as ClientData;
  } catch {
    return; // 数据岛损坏：保持静态层，不增强
  }
  if (typeof data?.base !== "string" || !Array.isArray(data?.entries)) return;

  base = data.base;
  isFixture = data.isFixture;
  sorted = sortEntriesDesc(data.entries);
  const initialTopic = listElement.dataset.topic ?? "全部";
  topic = (TOPICS as readonly string[]).includes(initialTopic) ? initialTopic : "全部";
  list = listElement;
  pager = ensurePager();

  // 主题 Tab（header + 全屏菜单）：客户端筛选接管；非时间线页不初始化本模块，链接保持原生导航。
  // 点击当前主题 Tab 与静态链接语义对齐（T05 收尾项）：静态链接指向该主题第 1 页，
  // 客户端等价重置页码渲染，不再静默忽略。
  document
    .querySelectorAll<HTMLAnchorElement>(
      '[data-ktabs] .tab[data-topic], .k-menu-topics .tab[data-topic]',
    )
    .forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        const next = tab.dataset.topic ?? "";
        if (!next) return;
        if (next === topic) {
          animateTopicSwitch(() => renderView(next, 1, { deferredListMotion: true }));
          return;
        }
        switchTopic(next, false);
      });
    });

  // 分页委托（pager 元素持久，仅 innerHTML 重渲染）
  pager.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-page]");
    if (!anchor) return;
    event.preventDefault();
    renderView(topic, Number(anchor.dataset.page));
  });

  // 空态「查看全部」委托
  list.addEventListener("click", (event) => {
    const all = (event.target as Element | null)?.closest<HTMLAnchorElement>("[data-all]");
    if (!all) return;
    event.preventDefault();
    switchTopic("全部", true);
  });

  bindScrollTracking();
  moveIndicator(topic, true);
}
