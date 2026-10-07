/**
 * 站外链接确定性判定单测（T13，UI 票 #30）：靛色只染站外信号，站内链接零变化。
 * 判定规则（纯函数）：可解析为绝对 http(s) URL 且 origin ≠ 站点 origin → 站外；
 * 其余（相对路径、锚点、非 http(s) 协议、不可解析、空串）一律不算站外。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isExternalUrl } from "../../src/lib/links.ts";

const SITE = "https://caiyan12.github.io";

test("站外判定：跨源 http(s) URL 为站外（条目外链、GitHub、百度规则页等）", () => {
  for (const href of [
    "https://www.baidu.com/s?wd=%E6%96%B0%E8%83%BD%E6%BA%90",
    "https://github.com/CaiYan12/overthecocoons/issues/new?template=source-submission.yml",
    "https://rss.aishort.top/?type=baidu",
    "https://top.baidu.com/board?page=rule&tab=realtime",
    "http://example.com/",
  ]) {
    assert.equal(isExternalUrl(href, SITE), true, `${href} 应判为站外`);
  }
});

test("站内不染：同源 URL（含部署基路径与主站根）不是站外", () => {
  for (const href of [
    "https://caiyan12.github.io/overthecocoons/",
    "https://caiyan12.github.io/overthecocoons/items/" + "0".repeat(64) + "/",
    "https://caiyan12.github.io/",
    "https://caiyan12.github.io:443/",
  ]) {
    assert.equal(isExternalUrl(href, SITE), false, `${href} 应判为站内`);
  }
});

test("非绝对 http(s) 一律不算站外：相对路径、锚点、协议不合法与不可解析输入", () => {
  for (const href of [
    "/overthecocoons/items/x/",
    "#providers",
    "mailto:maintainer@example.com",
    "javascript:alert(1)",
    "data:text/html,x",
    "not a url",
    "//protocol-relative.example.com/",
    "",
  ]) {
    assert.equal(isExternalUrl(href, SITE), false, `${href || "（空串）"} 不应判为站外`);
  }
});

test("siteOrigin 未配置（空串）时：绝对 http(s) 按站外处理（安全默认，防漏染）", () => {
  assert.equal(isExternalUrl("https://www.baidu.com/s?wd=x", ""), true);
  assert.equal(isExternalUrl("/overthecocoons/", ""), false);
});
