/**
 * 首次 intro 判定（票 #25「Hero 仅首页 + 首次 intro」，纯函数）。
 *
 * 开场编排仅对「首次到达」播放。判定零存储——privacy 页明文不写入 sessionStorage，
 * e2e 断言 sessionStorage 恒空、localStorage 仅主题 key，禁止任何「是否看过 intro」
 * 的持久化；判定来源只有 Navigation Timing 导航类型与 document.referrer 同源性：
 * - reload / back_forward：刷新或历史前进/返回，用户已在浏览 → 跳过；
 * - navigate 且 referrer 与站点同源：站内链接跳转到达 → 跳过；
 * - 其余（navigate 或类型未知，且无 referrer / 跨源 referrer）：直接到达或从外源进入 → 播放。
 * Astro 静态站无客户端路由，每次站内导航都是完整加载，referrer 规则可靠覆盖翻页往返。
 * 规则留档：docs/adr/0004-hero-lightweight-head-intro.md（实现者拟定，总审定稿）。
 */

export interface IntroDecisionInput {
  /** Navigation Timing 导航类型（"navigate" | "reload" | "back_forward" | "prerender"）；API 不可用时传 null。 */
  navigationType: string | null;
  /** document.referrer 原值（空串 = 无来源）。 */
  referrer: string;
  /** 当前站点 origin（location.origin）。 */
  origin: string;
}

/**
 * 是否播放开场 intro：true = 首次到达（播放）；false = 跳过，调用方必须立即
 * 标记 intro 完成（html[data-oct-intro="done"]），不得让 e2e 等待补间收尾。
 */
export function shouldPlayIntro(input: IntroDecisionInput): boolean {
  if (input.navigationType === "reload" || input.navigationType === "back_forward") {
    return false;
  }
  if (!input.referrer) return true;
  try {
    return new URL(input.referrer).origin !== input.origin;
  } catch {
    // 畸形 referrer（按规范不会出现）：按无有效来源处理，不以此跳过 intro
    return true;
  }
}
