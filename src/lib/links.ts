/**
 * 站外链接确定性判定（T13，UI 票 #30）：靛色只承担「点击前就知道将离开本站」的站外信号，
 * 站内链接保持墨/红不动。规则纯函数、构建期与客户端共用：
 *
 * - 可解析为绝对 http(s) URL 且 origin ≠ 站点 origin → 站外；
 * - 相对路径、锚点、非 http(s) 协议（mailto/javascript/data 等）、不可解析与空串 → 不算站外；
 * - siteOrigin 传空串（构建期未配置 site 的兜底）时，绝对 http(s) 一律按站外——宁可染外不漏染外，
 *   站内链接仍走相对路径分支不受影响。
 *
 * 注意：站点部署在 https://caiyan12.github.io/overthecocoons/（astro.config site＝同源主站根），
 * 「↩ 返回主站」（https://caiyan12.github.io/）按本规则判为同源、不染靛——主站根与本站是
 * 同一 origin 的家族内导航（留档 ADR 0005）。
 */

/** 判定 href 是否为站外链接（origin 基准的确定性规则）。 */
export function isExternalUrl(href: string, siteOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (siteOrigin === "") return true;
  return url.origin !== siteOrigin;
}
