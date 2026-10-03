/**
 * 获取层（Ticket 03）：单次尝试的 HTTP 文本获取，与解析层严格分离（只产出文本）。
 *
 * 工程方案（MVP-Q21-1）下的职责边界：重试与退避由来源适配器（baidu-source.ts）编排，
 * 本模块负责单次尝试内的失败处理：
 * - 请求前调用 URL 安全校验（url-guard）；重定向以 redirect:"manual" 手工跟随，
 *   每一跳都重新过校验——防止经重定向进入环回/私有地址（用户安全硬约束）。
 * - 超时：AbortSignal.timeout（到达上限即中止请求并报「超时」）。
 * - 非 2xx 状态码（含缺 Location 的 3xx）报错；响应体按字节计量，超过上限中止读取。
 * - 严格 UTF-8 解码（fatal 模式）：非法字节流报错，不产生替换字符静默通过。
 *
 * 本模块不解析 XML；XML 失败处理在解析层（feed-parse.ts）抛错、由适配器计入尝试。
 */
import { validateFetchUrl } from "./url-guard.ts";

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchTextOptions {
  /** 注入的 fetch 实现（测试缝）；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

/** 单次尝试获取文本：URL 校验 →（跟随并逐跳复验重定向）→ 状态检查 → 有界读取 → 严格 UTF-8 解码。 */
export async function fetchTextOnce(url: string, options: FetchTextOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = validateFetchUrl(url);
  let redirects = 0;
  for (;;) {
    const response = await requestOnce(fetchImpl, current.href, timeoutMs);
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`获取失败：HTTP ${response.status} 重定向缺少 Location 头`);
      }
      if (redirects >= maxRedirects) {
        throw new Error(`获取失败：重定向次数超过上限（${maxRedirects}）`);
      }
      redirects += 1;
      // 下一跳请求前重新过安全校验（相对地址按当前跳解析）。
      current = validateFetchUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      throw new Error(`获取失败：HTTP ${response.status}`);
    }
    return await readBodyWithLimit(response, maxBytes);
  }
}

async function requestOnce(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchImpl(url, { redirect: "manual", signal });
  } catch (cause) {
    if (signal.aborted) {
      throw new Error(`获取失败：请求超时（${timeoutMs}ms 内未完成）`, { cause });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`获取失败：网络错误（${message}）`, { cause });
  }
}

/** 有界读取响应体并严格 UTF-8 解码；超过上限即中止读取（不再继续下载）。 */
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader() ?? null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader === null) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw oversizeError(maxBytes);
    }
    return decodeStrictUtf8(buffer);
  }
  let oversize = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          oversize = true;
          throw oversizeError(maxBytes);
        }
        chunks.push(value);
      }
    }
  } finally {
    if (oversize) {
      await reader.cancel().catch(() => {});
    } else {
      reader.releaseLock();
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeStrictUtf8(merged);
}

function oversizeError(maxBytes: number): Error {
  return new Error(`获取失败：响应体超过大小上限（${maxBytes} 字节）`);
}

function decodeStrictUtf8(bytes: Uint8Array): string {
  try {
    // fatal 模式：非法 UTF-8 字节流抛错（默认 ignoreBOM=false 会剥离 BOM）。
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("获取失败：响应体不是合法的 UTF-8 编码");
  }
}
