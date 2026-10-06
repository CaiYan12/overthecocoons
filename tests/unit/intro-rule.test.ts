/**
 * 首次 intro 判定（票 #25「Hero 仅首页 + 首次 intro」）分支覆盖。
 *
 * 判定零存储（privacy 约束：sessionStorage 恒空、localStorage 仅主题 key），
 * 来源只有 Navigation Timing 导航类型与 document.referrer 同源性——
 * Astro 静态站无客户端路由，每次站内导航都是完整加载。
 * 规则留档：docs/adr/0004-hero-lightweight-head-intro.md。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldPlayIntro } from "../../src/lib/intro-rule.ts";

const ORIGIN = "https://caiyan12.github.io";
const HERE = `${ORIGIN}/overthecocoons/`;
const OTHER = "https://example.com/page";

test("reload：刷新不重播 intro（用户已在浏览）", () => {
  assert.equal(shouldPlayIntro({ navigationType: "reload", referrer: "", origin: ORIGIN }), false);
});

test("back_forward：历史前进/返回不重播 intro", () => {
  assert.equal(
    shouldPlayIntro({ navigationType: "back_forward", referrer: "", origin: ORIGIN }),
    false,
  );
});

test("navigate 且无 referrer：直接到达（地址栏/书签/新标签）→ 播放", () => {
  assert.equal(shouldPlayIntro({ navigationType: "navigate", referrer: "", origin: ORIGIN }), true);
});

test("navigate 且同源 referrer：站内链接跳转到达 → 跳过", () => {
  assert.equal(
    shouldPlayIntro({ navigationType: "navigate", referrer: HERE, origin: ORIGIN }),
    false,
  );
  assert.equal(
    shouldPlayIntro({ navigationType: "navigate", referrer: `${ORIGIN}/overthecocoons/page/2/`, origin: ORIGIN }),
    false,
    "站内翻页/主题页跳回首页同样跳过",
  );
});

test("navigate 且跨源 referrer：从外部站点进入 → 播放", () => {
  assert.equal(shouldPlayIntro({ navigationType: "navigate", referrer: OTHER, origin: ORIGIN }), true);
});

test("Navigation Timing 不可用（type=null）：退化为纯 referrer 判定", () => {
  assert.equal(shouldPlayIntro({ navigationType: null, referrer: "", origin: ORIGIN }), true);
  assert.equal(shouldPlayIntro({ navigationType: null, referrer: HERE, origin: ORIGIN }), false);
  assert.equal(shouldPlayIntro({ navigationType: null, referrer: OTHER, origin: ORIGIN }), true);
});

test("referrer 不可解析（畸形值）：按无有效来源处理 → 播放", () => {
  assert.equal(
    shouldPlayIntro({ navigationType: "navigate", referrer: "not a url", origin: ORIGIN }),
    true,
  );
});

test("同源判定按 origin 比较：同站不同 scheme（http/https）视为跨源 → 播放", () => {
  assert.equal(
    shouldPlayIntro({ navigationType: "navigate", referrer: "http://caiyan12.github.io/overthecocoons/", origin: ORIGIN }),
    true,
  );
});
