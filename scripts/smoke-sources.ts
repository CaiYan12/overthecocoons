/** Read-only, single-host smoke test. Does not initialize/write authoritative state or publish. */
import { fetchSourceEntries } from "../src/lib/baidu-source.ts";
import { fetchNewsSource } from "../src/lib/news-source.ts";
import { NEWS_SOURCES } from "../src/lib/sources.ts";

const fetchers = [() => fetchSourceEntries(), ...NEWS_SOURCES.map(source => () => fetchNewsSource(source))];
for (const fetchSource of fetchers) {
  const result = await fetchSource();
  console.log(JSON.stringify(result.ok
    ? { sourceId: result.sourceId, ok: true, count: result.entries.length, succeededAt: result.succeededAt }
    : { sourceId: result.sourceId, ok: false, error: result.error }));
  if (!result.ok) process.exitCode = 1;
}
