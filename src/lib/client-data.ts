/**
 * 构建期客户端数据岛（Ticket 05）：把公开快照压缩为客户端渲染所需字段，
 * 由时间线页以 `<script type="application/json" data-kdata>` 内嵌，供渐进增强脚本
 * 做即时主题筛选与分页（规格：筛选优先于分页、无 JS 回落链接式页面）。
 *
 * 本模块是纯函数（对象进、字符串出），构建期在 Astro 组件 frontmatter 调用，
 * 也可被 Node 测试直接导入；不做任何 I/O。
 */
import type { PublicEntry, PublicSnapshot } from "../domain/contract.ts";

/** 客户端数据岛结构：基路径、演示标注与公开条目的最小字段集。 */
export interface ClientData {
  /** 站点基路径（如 "/overthecocoons"），客户端用它拼接详情/分页链接。 */
  base: string;
  isFixture: boolean;
  entries: PublicEntry[];
}

/** 从公开快照构造客户端数据（只保留 PublicEntry 六字段，不携带隔离与来源状态）。 */
export function buildTimelineData(snapshot: PublicSnapshot, base: string): ClientData {
  if (typeof base !== "string" || !base.startsWith("/") || base.endsWith("/")) {
    throw new Error(`客户端数据岛基路径必须是以 / 开头、不以 / 结尾的字符串：${String(base)}`);
  }
  return {
    base,
    isFixture: snapshot.isFixture,
    entries: snapshot.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      topic: entry.topic,
      firstSeenAt: entry.firstSeenAt,
      url: entry.url,
    })),
  };
}

/**
 * 序列化为可内嵌 `<script>` 的文本：转义所有 `<`（\u003c），
 * 使 `</script>` 等内容无法提前闭合标签（脚本元素是 raw text，不解析实体）。
 */
export function serializeClientData(data: ClientData): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
