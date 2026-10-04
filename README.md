# 跳出茧房 Over the cocoons

面向公共信息阅读的来源聚合静态站点。拓宽视野为主、日常资讯为辅：无个性化、无登录、无广告、无阅读历史、无第三方统计；公共时间线不按个人行为排序，不人工挑选、排序或推荐单条内容。

当前处于 MVP 开发阶段：静态时间线/详情/说明页与数据采集管线已落地；`data` 分支权威状态由每日更新工作流维护（首次上线前需用户授权）。仓库内 `fixtures/snapshot.json` 为演示数据，站点标注「演示数据」时即非真实抓取结果。

## 本地首次环境准备

前置运行时（仓库已用字段固定，与 CI 一致）：

- Node.js 24.18.0（`package.json` engines）
- pnpm 10.26.2（`package.json` packageManager；可用 `corepack enable pnpm` 启用）

首次步骤：

1. `pnpm install` —— 严格按 `pnpm-lock.yaml` 安装依赖，不跳过锁文件。
2. `pnpm build` —— **构建先于测试**：生成 `dist/`，Playwright e2e 的本地服务器（`astro preview`）依赖它；同时生成 `.astro/` 类型。
3. `pnpm exec playwright install chromium` —— 安装 e2e 所需浏览器。新环境若跳过此步，`pnpm test` 的 e2e 阶段会直接失败。
4. `pnpm test` —— 依次执行 `astro check`（类型检查）、`astro build`、Node 单元测试与 Playwright e2e。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm test:node` | 只跑 Node 单元测试（数据规则、编排、工作流定义 lint） |
| `pnpm smoke:source` | 首源只读烟测：发起真实网络读取，不写任何文件 |
| `node scripts/update-data.ts --dir <演练目录> --init` | data 权威状态初始化演练（仅手动；不抓取、不产快照） |
| `node scripts/update-data.ts --dir <演练目录> --fixture` | data 更新编排离线演练（注入合成 feed，不触网） |

data 更新编排说明见 `docs/mvp-architecture.md`（工作流与失败控制）与 `docs/mvp-decisions.md`（MVP-Q13–Q18/Q21）；工作流定义在 `.github/workflows/update-data.yml` 与 `init-data.yml`。来源提交走 GitHub Issue 模板（站内「提交新来源」入口）。

## 许可

代码许可证 MIT（见 `LICENSE`）；来源内容不因本项目许可证而重新许可，来源内容的公开使用范围以核实记录为准。
