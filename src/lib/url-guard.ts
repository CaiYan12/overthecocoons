/**
 * 服务端请求 URL 安全校验（用户安全硬约束，Ticket 03）。
 *
 * 规则：
 * - 仅允许 http/https 协议；其余协议一律拒绝。
 * - 请求前校验 host：拒绝 localhost 主机名、环回（IPv4 127/8、IPv6 ::1）、
 *   私有网段（RFC1918：10/8、172.16/12、192.168/16）、链路本地（169.254/16、fe80::/10）
 *   以及其他 IANA 保留/特殊用途地址（0/8、100.64/10、组播、文档地址、240/4 等）。
 * - 拒绝数字形式伪装的主机名（十进制整数如 2130706433 = 127.0.0.1、短点分如 127.1、
 *   前导零八进制如 0177.0.0.1、十六进制标签如 0x7f.0.0.1）。
 *
 * 边界（如实声明）：
 * - 本模块是纯字符串检查，不做 DNS 解析；域名解析结果为私有地址的绕过
 *   （DNS rebinding）不在本层防护范围内，由部署环境（GitHub Actions）网络边界兜底。
 * - 校验对象是请求发起时的 URL；重定向逐跳复验由获取层（source-fetch.ts）对每一跳
 *   重新调用本模块实现。
 */

/** 返回解析后的 URL（协议与 host 均已通过校验）；不合法即抛错。 */
export function validateFetchUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL 安全校验失败：无法解析为合法 URL：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL 安全校验失败：仅允许 http/https 协议，实际为 ${parsed.protocol}`);
  }
  assertHostAllowed(parsed.hostname);
  return parsed;
}

function assertHostAllowed(hostname: string): void {
  // IPv6 字面量在 URL.hostname 中保留方括号。
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    assertIpv6Allowed(hostname.slice(1, -1));
    return;
  }
  if (hostname.length === 0) {
    throw new Error("URL 安全校验失败：主机名为空");
  }
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    throw new Error(`URL 安全校验失败：拒绝 localhost 主机名：${hostname}`);
  }
  // 规范点分十进制 IPv4 字面量（禁止前导零，避免八进制歧义）。
  const CANONICAL_IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (CANONICAL_IPV4.test(lower)) {
    assertIpv4Allowed(parseIpv4(lower));
    return;
  }
  // 其他全数字/点分形式（十进制整数、短点分、前导零、十六进制标签）视为 IP 伪装，一律拒绝。
  if (/^[0-9.]+$/.test(lower)) {
    throw new Error(`URL 安全校验失败：拒绝数字形式的非规范主机名（疑似环回/私有地址伪装）：${hostname}`);
  }
  if (/(^|\.)0[xX][0-9a-fA-F]+$/.test(lower)) {
    throw new Error(`URL 安全校验失败：拒绝十六进制标签的主机名（疑似 IP 伪装）：${hostname}`);
  }
}

type Ipv4 = number; // 0 .. 2^32-1

function parseIpv4(text: string): Ipv4 {
  const parts = text.split(".");
  let value = 0;
  for (const part of parts) {
    value = value * 256 + Number(part);
  }
  return value >>> 0;
}

/** 拒绝环回/私有/链路本地/保留 IPv4（含各 IANA 特殊用途网段）。 */
function assertIpv4Allowed(ip: Ipv4): void {
  const blocked: Array<[Ipv4, Ipv4, string]> = [
    [ipv4("0.0.0.0"), ipv4("0.255.255.255"), "本网络保留"],
    [ipv4("10.0.0.0"), ipv4("10.255.255.255"), "私有地址（RFC1918）"],
    [ipv4("100.64.0.0"), ipv4("100.127.255.255"), "运营商级 NAT 保留"],
    [ipv4("127.0.0.0"), ipv4("127.255.255.255"), "环回地址"],
    [ipv4("169.254.0.0"), ipv4("169.254.255.255"), "链路本地地址"],
    [ipv4("172.16.0.0"), ipv4("172.31.255.255"), "私有地址（RFC1918）"],
    [ipv4("192.0.0.0"), ipv4("192.0.0.255"), "IETF 协议分配保留"],
    [ipv4("192.0.2.0"), ipv4("192.0.2.255"), "文档专用保留地址（TEST-NET-1）"],
    [ipv4("192.88.99.0"), ipv4("192.88.99.255"), "6to4 中继任播保留地址"],
    [ipv4("192.168.0.0"), ipv4("192.168.255.255"), "私有地址（RFC1918）"],
    [ipv4("198.18.0.0"), ipv4("198.19.255.255"), "网络基准测试保留地址"],
    [ipv4("198.51.100.0"), ipv4("198.51.100.255"), "文档专用保留地址（TEST-NET-2）"],
    [ipv4("203.0.113.0"), ipv4("203.0.113.255"), "文档专用保留地址（TEST-NET-3）"],
    [ipv4("224.0.0.0"), ipv4("239.255.255.255"), "多播保留地址"],
    [ipv4("240.0.0.0"), ipv4("255.255.255.255"), "保留地址"],
  ];
  for (const [start, end, label] of blocked) {
    if (ip >= start && ip <= end) {
      throw new Error(`URL 安全校验失败：拒绝${label}：${formatIpv4(ip)}`);
    }
  }
}

function ipv4(text: string): Ipv4 {
  return parseIpv4(text);
}

function formatIpv4(ip: Ipv4): string {
  return [(ip >>> 24) & 255, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join(".");
}

/** 展开 IPv6 为 8 组 16 位整数（支持 :: 缩写与末 32 位内嵌 IPv4）。 */
function expandIpv6(text: string): number[] | null {
  let head: string[];
  let tail: string[] = [];
  const doubleColon = text.split("::");
  if (doubleColon.length > 2) return null;
  if (doubleColon.length === 2) {
    head = doubleColon[0] === "" ? [] : doubleColon[0]!.split(":");
    tail = doubleColon[1] === "" ? [] : doubleColon[1]!.split(":");
    if (head.length + tail.length > 7) return null;
  } else {
    head = text.split(":");
    if (head.length !== 8) return null;
  }
  const groups: number[] = [];
  const headGroups = head.map((group) => parseIpv6Group(group));
  const tailGroups = tail.map((group) => parseIpv6Group(group));
  if (headGroups.includes(null) || tailGroups.includes(null)) return null;
  groups.push(...(headGroups as number[]));
  while (groups.length + tailGroups.length < 8) groups.push(0);
  groups.push(...(tailGroups as number[]));
  return groups;
}

function parseIpv6Group(group: string): number | null {
  if (group.length === 0 || group.length > 4) return null;
  if (!/^[0-9a-fA-F]+$/.test(group)) return null;
  return Number.parseInt(group, 16);
}

/** 拒绝环回/未指定/IPv4 映射/ULA/链路本地/文档/多播 IPv6；末 32 位内嵌 IPv4 复用 IPv4 规则。 */
function assertIpv6Allowed(address: string): void {
  const groups = expandIpv6(address);
  if (groups === null) {
    throw new Error(`URL 安全校验失败：无法解析 IPv6 地址：${address}`);
  }
  const allZero = groups.every((g) => g === 0);
  if (allZero) {
    throw new Error(`URL 安全校验失败：拒绝未指定保留地址（::）：${address}`);
  }
  if (groups[0] === 0 && groups.slice(1, 7).every((g) => g === 0) && groups[7] === 1) {
    throw new Error(`URL 安全校验失败：拒绝环回地址（::1）：${address}`);
  }
  const first5Zero = groups.slice(0, 5).every((g) => g === 0);
  if (first5Zero && (groups[5] === 0 || groups[5] === 0xffff)) {
    // ::/96（IPv4 兼容，已弃用）与 ::ffff:0:0/96（IPv4 映射）：末 32 位按 IPv4 规则复检。
    const embedded = ((groups[6]! << 16) | groups[7]!) >>> 0;
    assertIpv4Allowed(embedded);
    return;
  }
  const first = groups[0]!;
  const label =
    first >= 0xfc00 && first <= 0xfdff
      ? "私有保留地址（ULA fc00::/7）"
      : first >= 0xfe80 && first <= 0xfebf
        ? "链路本地保留地址（fe80::/10）"
        : first >= 0xfec0 && first <= 0xfedf
          ? "已弃用的站点本地保留地址（fec0::/10）"
          : first === 0x0100 && groups[1] === 0
            ? "丢弃专用保留地址（100::/64）"
            : first === 0x2001 && groups[1] === 0x0db8
              ? "文档专用保留地址（2001:db8::/32）"
              : first >= 0xff00 && first <= 0xffff
                ? "多播保留地址（ff00::/8）"
                : null;
  if (label !== null) {
    throw new Error(`URL 安全校验失败：拒绝${label}：${address}`);
  }
  // NAT64 前缀（64:ff9b::/96）：末 32 位内嵌 IPv4 经 NAT64 网关可达，按 IPv4 规则复检，
  // 防止以 64:ff9b::10.0.0.1 之类形式绕过私网限制（常见 SSRF 向量）。
  if (first === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    const embedded = ((groups[6]! << 16) | groups[7]!) >>> 0;
    assertIpv4Allowed(embedded);
  }
}
