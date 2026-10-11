/** 有界页码窗口；静态页与客户端共用，数量不随总页数增长。 */
export type PagerToken = number | "gap";

export function pageWindow(page: number, total: number, edges = 3, radius = 1): PagerToken[] {
  const selected = new Set<number>();
  for (let p = 1; p <= Math.min(edges, total); p++) selected.add(p);
  for (let p = Math.max(1, total - edges + 1); p <= total; p++) selected.add(p);
  for (let p = Math.max(1, page - radius); p <= Math.min(total, page + radius); p++) selected.add(p);
  const pages = [...selected].sort((a, b) => a - b);
  const tokens: PagerToken[] = [];
  pages.forEach((p, i) => {
    const previous = pages[i - 1];
    if (previous !== undefined && p - previous > 1) {
      // 只缺一页时直接补齐，避免用省略号替代单个数字。
      tokens.push(p - previous === 2 ? previous + 1 : "gap");
    }
    tokens.push(p);
  });
  return tokens;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 同一个页码只有一个链接；CSS 容器查询选择密度，无 JS 也适应三栏宽度。 */
export function pagerHtml(page: number, total: number, hrefFor: (page: number) => string, enhanced = false): string {
  const items = new Map<string, { page?: number; order: number; modes: string[] }>();
  for (const [mode, edges, radius] of [["wide", 3, 1], ["compact", 1, 1], ["minimal", 1, 0]] as const) {
    let previous = 0;
    for (const token of pageWindow(page, total, edges, radius)) {
      const key = typeof token === "number" ? `page-${token}` : `gap-${previous}`;
      const item = items.get(key) ?? { page: typeof token === "number" ? token : undefined, order: typeof token === "number" ? token : previous + 0.5, modes: [] };
      item.modes.push(mode);
      items.set(key, item);
      if (typeof token === "number") previous = token;
    }
  }
  const link = (target: number, text: string, label: string, attrs = "") =>
    `<a class="page-btn" data-page="${target}" data-cursor-soft href="${escapeAttribute(hrefFor(target))}" aria-label="${label}"${attrs}>${text}</a>`;
  const previous = page > 1 ? link(page - 1, "‹", "上一页", ' rel="prev"') : '<span class="page-btn" aria-disabled="true">‹</span>';
  const next = page < total ? link(page + 1, "›", "下一页", ' rel="next"') : '<span class="page-btn" aria-disabled="true">›</span>';
  const numbers = [...items.values()].sort((a, b) => a.order - b.order).map((item) => {
    const modes = ` data-density="${item.modes.join(" ")}"`;
    return item.page === undefined
      ? `<span class="pager-gap"${modes} aria-hidden="true">…</span>`
      : link(item.page, String(item.page).padStart(2, "0"), `第 ${item.page} 页`, `${modes}${item.page === page ? ' aria-current="page"' : ""}`);
  }).join("");
  return `<div class="pager-row"><div class="pager-pages">${previous}${numbers}${next}</div><form class="pager-jump" data-page-jump${enhanced ? "" : " hidden"}><input type="number" name="page" min="1" max="${total}" step="1" required inputmode="numeric" placeholder="页码" aria-label="跳转页码（1 至 ${total}）" data-cursor-soft><span class="pager-total" aria-hidden="true">/ ${total}</span><button type="submit" data-cursor-soft>跳转</button></form><span class="of">第 ${page} / ${total} 页</span></div>`;
}
