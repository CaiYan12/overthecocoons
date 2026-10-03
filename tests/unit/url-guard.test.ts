import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFetchUrl } from "../../src/lib/url-guard.ts";

/**
 * 服务端请求 URL 安全校验（用户安全硬约束）：
 * 仅允许 http/https；请求前校验 host，拒绝 localhost、环回（127.0.0.1/::1）、
 * 私有（10/172.16-12/192.168/169.254 等 RFC1918/链路本地）与保留地址。
 * 校验是纯字符串检查，不做任何 DNS/网络 I/O。
 */

const ALLOWED = [
  // 真实首源（默认 feed 地址）。
  "https://rss.aishort.top/?type=baidu",
  "http://example.com/x",
  "https://example.com:8443/feed.xml",
  // 公网 IPv4 / IPv6 字面量。
  "https://8.8.8.8/",
  "http://1.1.1.1:8080/",
  "http://[2606:4700::1111]/",
  "http://[2001:4860:4860::8888]/feed",
  // 172.16/12 之外：172.32.0.1 属公网。
  "http://172.32.0.1/",
  "http://11.0.0.1/",
  "http://192.169.1.1/",
];

const BLOCKED: Array<[string, RegExp]> = [
  // 非 http/https 协议。
  ["ftp://example.com/file", /http|https|协议/],
  ["file:///c:/windows/feed.xml", /http|https|协议/],
  ["javascript:alert(1)", /http|https|协议/],
  // 非 URL 字符串。
  ["not a url at all", /URL|解析/],
  // localhost 主机名（大小写与子域）。
  ["http://localhost/", /localhost|主机/],
  ["http://localhost:8080/feed.xml", /localhost|主机/],
  ["http://LOCALHOST/feed.xml", /localhost|主机/],
  ["http://my.localhost/feed.xml", /localhost|主机/],
  // 尾点绕过 localhost 比对（审查修复环 R1，fail-closed 拒绝；%2E 经 WHATWG 解码为 "."）。
  ["http://localhost./", /尾点|localhost|主机/],
  ["http://sub.localhost./", /尾点|localhost|主机/],
  ["http://localhost../", /尾点|localhost|主机/],
  ["http://localhost%2e/", /尾点|localhost|主机/],
  // 环回 IPv4（整个 127/8）。
  ["http://127.0.0.1/", /环回|私有|保留|主机/],
  ["http://127.255.255.254/feed", /环回|私有|保留|主机/],
  // 私有网段（RFC1918）。
  ["http://10.1.2.3/", /私有|保留|主机/],
  ["http://172.16.0.1/", /私有|保留|主机/],
  ["http://172.31.255.255/", /私有|保留|主机/],
  ["http://192.168.1.1/", /私有|保留|主机/],
  // 链路本地。
  ["http://169.254.169.254/meta", /链路本地|保留|主机/],
  // 其他保留 / 特殊用途 IPv4。
  ["http://0.0.0.0/", /保留|主机/],
  ["http://0.1.2.3/", /保留|主机/],
  ["http://100.64.0.1/", /保留|主机/],
  ["http://192.0.0.1/", /保留|主机/],
  ["http://192.0.2.1/", /保留|主机/],
  ["http://192.88.99.1/", /保留|主机/],
  ["http://198.18.0.1/", /保留|主机/],
  ["http://198.51.100.7/", /保留|主机/],
  ["http://203.0.113.9/", /保留|主机/],
  ["http://224.0.0.1/", /保留|主机/],
  ["http://239.1.2.3/", /保留|主机/],
  ["http://240.0.0.1/", /保留|主机/],
  ["http://255.255.255.255/", /保留|主机/],
  // 环回 / 未指定 / IPv4 映射 / ULA / 链路本地 / 文档 / 多播 IPv6。
  ["http://[::1]/", /环回|私有|保留|主机/],
  ["http://[::]/", /保留|主机/],
  ["http://[::ffff:127.0.0.1]/", /环回|私有|保留|主机/],
  ["http://[::ffff:7f00:1]/", /环回|私有|保留|主机/],
  ["http://[::ffff:10.0.0.1]/", /私有|保留|主机/],
  ["http://[fc00::1]/", /私有|保留|主机/],
  ["http://[fd12:3456::1]/", /私有|保留|主机/],
  ["http://[fe80::1]/", /链路本地|保留|主机/],
  ["http://[2001:db8::1]/", /保留|主机/],
  ["http://[ff02::1]/", /保留|主机/],
  ["http://[fec0::1]/", /保留|主机/],
  ["http://[100::1]/", /保留|主机/],
  // NAT64 前缀内嵌私有 IPv4（常见 SSRF 向量）。
  ["http://[64:ff9b::10.0.0.1]/", /私有|保留|主机/],
  ["http://[64:ff9b::7f00:1]/", /环回|私有|保留|主机/],
  // 数字形式伪装的环回（十进制整数 2130706433 = 127.0.0.1）。
  ["http://2130706433/", /环回|私有|保留|主机|数字/],
  // 短点分 / 全数字点分 / 十六进制标签形式的 IP 伪装。
  ["http://127.1/", /环回|私有|保留|主机|数字/],
  ["http://0177.0.0.1/", /环回|私有|保留|主机|数字/],
  ["http://0x7f.0.0.1/", /环回|私有|保留|主机|数字/],
  // userinfo 携带无法绕过 host 校验。
  ["http://user@127.0.0.1/", /环回|私有|保留|主机/],
];

describe("validateFetchUrl：允许公网 http/https 地址", () => {
  for (const url of ALLOWED) {
    it(`允许 ${url}`, () => {
      const parsed = validateFetchUrl(url);
      assert.ok(parsed instanceof URL);
      assert.ok(parsed.protocol === "http:" || parsed.protocol === "https:");
      assert.equal(parsed.href, new URL(url).href);
    });
  }
});

describe("validateFetchUrl：拒绝协议违规与保留/私有主机（每次拒绝都必须有测试）", () => {
  for (const [url, pattern] of BLOCKED) {
    it(`拒绝 ${url}`, () => {
      assert.throws(() => validateFetchUrl(url), pattern);
    });
  }
});
