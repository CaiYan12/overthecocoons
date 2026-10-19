// 多源夹具专用构建配置（Issue #34）：与主配置同源，只把产物目录隔离到 .snapshot/sources-dist，
// 避免覆盖主 dist（主 dist 由 tests/unit/render.test.ts 断言）。数据由 playwright webServer 注入
// SNAPSHOT_PATH=fixtures/snapshot-sources.json。
import base from "./astro.config.mjs";

export default {
  ...base,
  outDir: "./.snapshot/sources-dist",
};
