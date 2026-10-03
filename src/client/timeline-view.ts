/**
 * 时间线视图增强（Ticket 05）：客户端接管静态链接式筛选与分页（原型 v-kinetic 行为，去掉动效）。
 *
 * 渐进增强契约：
 * - 静态层（T04）是可独立工作的链接式页面；本模块只在存在 [data-klist] 与数据岛时初始化；
 * - 渲染口径复用 src/lib/timeline.ts（sortEntriesDesc/paginate/topicPagePath/entryWeights 等），
 *   不镜像逻辑；DOM 结构与 KEntry/KEmpty/KPager/TimelinePage 输出一致，CSS 不区分两种来源；
 * - 筛选优先于分页；主题切换重置页码；空主题渲染真实空态与「查看全部」；
 * - 阅读位置仅存于本次访问内存（模块变量，绝不写 localStorage/sessionStorage）：
 *   仅由用户手势（滚轮/触摸/滚动键）触发的滚动记录阅读条目；翻页/切主题返回时尽量按原条目
 *   恢复或回退有效页码并经 aria-live 播报（决策见 ./position.ts）；
 * - 数据来自页面内嵌 JSON 数据岛（与构建同源），解析失败时静默退出，保持静态层可用。
 */
import type { PublicEntry } from "../domain/contract.ts";
import type { ClientData } from "../lib/client-data.ts";
import {
  EN_LABEL,
  PAGE_SIZE,
  TOPICS,
  entryWeights,
  formatClock,
  formatDateTime,
  monthEn,
  paginate,
  sortEntriesDesc,
  topicPagePath,
} from "../lib/timeline.ts";
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

function mediaHtml(entry: PublicEntry, gi: number): string {
  const lab = EN_LABEL[entry.topic] ?? "INDEX";
  const clock = formatClock(entry.firstSeenAt);
  return `<div class="k-media" data-cursor="OPEN"><div class="k-media-tilt"><div class="k-media-art" role="img" aria-label="编辑占位图：${esc(lab)}"><span class="tag" aria-hidden="true"><i></i><span class="tm">${clock}</span></span><span class="lab" aria-hidden="true">${esc(lab)}</span><span class="num" aria-hidden="true">${pad2(gi + 1)}</span></div></div></div>`;
}

function metaHtml(entry: PublicEntry): string {
  const collected = formatDateTime(entry.firstSeenAt);
  const ext = entry.url
    ? ` <span class="sep">·</span> <a class="ext" href="${esc(entry.url)}" target="_blank" rel="noopener" data-cursor="LINK">查看百度搜索结果 ↗</a>`
    : "";
  return `<p class="k-meta">百度热点 <span class="sep">·</span> <span class="tpc">${esc(entry.topic)}</span> <span class="sep">·</span> 收录 ${collected}${ext}</p>`;
}

function entryHtml(entry: PublicEntry, gi: number, di: number): string {
  const { layout, weight } = entryWeights(di);
  const headline = `<h3 class="k-headline"><a href="${base}/items/${entry.id}/" data-detail data-cursor="VIEW ↗">${esc(entry.title)}</a></h3>`;
  const summary = entry.summary ? `<p class="k-summary">${esc(entry.summary)}</p>` : "";
  const media = mediaHtml(entry, gi);
  const meta = metaHtml(entry);
  let inner: string;
  if (layout === "layout-a") inner = `<div class="k-text">${headline}${summary}${meta}</div>${media}`;
  else if (layout === "layout-b") inner = `${media}<div class="k-text">${headline}${summary}${meta}</div>`;
  else inner = `<div class="k-text">${headline}${media}${summary}${meta}</div>`;
  return `<article class="k-entry ${layout} ${weight}" data-entry data-gi="${gi}"><div class="k-time"><time datetime="${entry.firstSeenAt}">${formatClock(entry.firstSeenAt)}</time></div><div class="k-node-rail" aria-hidden="true"><span class="k-node"></span></div><div class="k-body"><div class="k-body-inner">${inner}</div></div></article>`;
}

function dayGroupsHtml(slice: PublicEntry[], start: number): string {
  const groups: Array<{ date: string; items: Array<{ entry: PublicEntry; gi: number; di: number }> }> = [];
  slice.forEach((entry, index) => {
    const date = entry.firstSeenAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.items.push({ entry, gi: start + index, di: last.items.length });
    } else {
      groups.push({ date, items: [{ entry, gi: start + index, di: 0 }] });
    }
  });
  return groups
    .map(
      (group) => `<section class="k-day" data-day="${group.date}"><div class="k-line" aria-hidden="true"></div><div class="k-progress" aria-hidden="true"></div><header class="k-day-head"><h2 class="k-day-big">${monthEn(group.date.slice(5, 7))} ${group.date.slice(8, 10)}</h2><p class="k-day-sub">${group.date.slice(0, 4)} · 按收录时间排序${isFixture ? "（演示数据）" : ""}</p></header>${group.items.map(({ entry, gi, di }) => entryHtml(entry, gi, di)).join("")}</section>`,
    )
    .join("");
}

function emptyHtml(emptyTopic: string): string {
  return `<div class="empty"><h3>「${esc(emptyTopic)}」暂无内容</h3><p>首源为百度热点线索，当前仅映射到「新闻」与「社会」主题。这里显示真实空状态。</p><a class="page-btn" data-all href="${base}/">查看全部</a></div>`;
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
      ? `<a class="page-btn" data-page="${page - 1}" href="${href(page - 1)}" rel="prev" aria-label="上一页">‹</a>`
      : `<span class="page-btn" aria-disabled="true">‹</span>`;
  for (let p = 1; p <= totalPages; p++) {
    html += `<a class="page-btn" data-page="${p}" href="${href(p)}"${p === page ? ' aria-current="page"' : ""} aria-label="第 ${p} 页">${pad2(p)}</a>`;
  }
  html +=
    page < totalPages
      ? `<a class="page-btn" data-page="${page + 1}" href="${href(page + 1)}" rel="next" aria-label="下一页">›</a>`
      : `<span class="page-btn" aria-disabled="true">›</span>`;
  html += `<span class="of">第 ${page} / ${totalPages} 页</span>`;
  pager.innerHTML = html;
}

/* ---- 同步 header/菜单/HUD ---- */

function moveIndicator(target: string): void {
  const indicator = document.querySelector<HTMLElement>("[data-indicator]");
  const tab = document.querySelector<HTMLElement>(`[data-ktabs] .tab[data-topic="${target}"]`);
  if (!indicator || !tab) return;
  indicator.style.width = `${tab.offsetWidth}px`;
  indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
}

function syncTopicUi(nextTopic: string, total: number): void {
  document
    .querySelectorAll<HTMLElement>('[data-ktabs] .tab[data-topic], .k-menu-topics .tab[data-topic]')
    .forEach((tab) => {
      tab.setAttribute("aria-current", tab.dataset.topic === nextTopic ? "true" : "false");
    });
  moveIndicator(nextTopic);
  const hudTotal = document.querySelector<HTMLElement>("[data-total]");
  if (hudTotal) hudTotal.textContent = pad2(total);
  const menuTopic = document.querySelector<HTMLElement>("[data-menu-topic]");
  if (menuTopic) menuTopic.textContent = EN_LABEL[nextTopic] ?? "INDEX";
  const menuCount = document.querySelector<HTMLElement>("[data-menu-count]");
  if (menuCount) {
    const today = sorted[0]?.firstSeenAt.slice(0, 10) ?? "";
    const count = sorted.filter((entry) => entry.firstSeenAt.slice(0, 10) === today).length;
    menuCount.textContent = `今日 ${count} 条 · 当前主题 ${nextTopic}`;
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

function bindScrollTracking(): void {
  // 只在「紧随用户输入（滚轮/触摸/滚动键）」的滚动上采样阅读位置：
  // 程序化滚动（如辅助技术、脚本 scrollIntoView、浏览器行为）不得污染阅读位置记忆。
  const USER_INPUT_WINDOW_MS = 200;
  let lastUserInputAt = -Infinity;
  const markInput = () => {
    lastUserInputAt = performance.now();
  };
  window.addEventListener("wheel", markInput, { passive: true });
  window.addEventListener("touchmove", markInput, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (SCROLL_KEYS.has(event.key)) markInput();
  }, true);
  window.addEventListener("scroll", () => {
    if (performance.now() - lastUserInputAt <= USER_INPUT_WINDOW_MS) onUserScroll();
  }, { passive: true });
}

/* ---- 视图渲染与恢复 ---- */

function scrollToEntry(index: number): void {
  const element = list.querySelector<HTMLElement>(`[data-gi="${index}"]`);
  if (!element) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function renderView(nextTopic: string, requestedPage: number): void {
  const filtered = nextTopic === "全部" ? sorted : sorted.filter((entry) => entry.topic === nextTopic);
  const decision = resolveRestore(filtered, lastReadId, requestedPage, PAGE_SIZE);
  const { page, totalPages, start, slice } = paginate(filtered, requestedPage);
  const hadFocusInPager = pager.contains(document.activeElement);
  const focusAllTab = focusHeaderAllTab;
  focusHeaderAllTab = false;

  list.innerHTML = filtered.length === 0 ? emptyHtml(nextTopic) : dayGroupsHtml(slice, start);
  renderPager(page, totalPages, nextTopic);
  syncTopicUi(nextTopic, filtered.length);
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
    window.scrollTo({ top: 0, behavior: "auto" });
    if (decision.mode === "fallback" && filtered.length > 0) {
      // 空主题的空态播报已说明无内容，不再叠加回退提示
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
  renderView(next, 1); // 主题切换重置页码
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

  // 主题 Tab（header + 全屏菜单）：客户端筛选接管；非时间线页不初始化本模块，链接保持原生导航
  document
    .querySelectorAll<HTMLAnchorElement>(
      '[data-ktabs] .tab[data-topic], .k-menu-topics .tab[data-topic]',
    )
    .forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        switchTopic(tab.dataset.topic ?? "", false);
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
  moveIndicator(topic);
}
