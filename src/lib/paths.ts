/**
 * 站点基路径工具：GitHub Pages 子路径部署（/overthecocoons，astro.config.mjs）。
 * 仅在 Astro/Vite 构建环境使用（依赖 import.meta.env），不进入 Node 单测路径。
 */
export const SITE_BASE: string = import.meta.env.BASE_URL.replace(/\/$/, "");

/** 把站点根相对路径（以 / 开头）拼接为带基路径的 URL。 */
export function siteUrl(path = "/"): string {
  return `${SITE_BASE}${path}`;
}
