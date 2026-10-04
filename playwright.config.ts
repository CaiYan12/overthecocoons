import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 5_000 },
  // 并行负载下软件光栅竞争让 GSAP lag smoothing 把 0.26–0.4s 补间拖到 >5s
  // （2026-10-04 矩阵实测：4 workers 时 announce/morph 等待偶发超时，孤立运行全过），
  // 降到 2 workers 换矩阵稳定；单 project 内 50 用例吞吐可接受。
  // 本机日常检测仅 chromium：`pnpm test:e2e`（--project=chromium）；
  // 5 项目全矩阵用 `pnpm test:e2e:matrix`（需另装 firefox/webkit 浏览器）。
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:4321",
  },
  webServer: {
    command: "pnpm exec astro preview --host 127.0.0.1 --port 4321",
    url: "http://127.0.0.1:4321/overthecocoons/",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { browserName: "webkit" },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
