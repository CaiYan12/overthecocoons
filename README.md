# 跳出茧房 Over the cocoons

面向公共信息阅读的来源聚合静态站点。拓宽视野为主、日常资讯为辅：无个性化、无登录、无广告、无阅读历史、无第三方统计；公共时间线不按个人行为排序，不人工挑选、排序或推荐单条内容。

站点已上线：https://caiyan12.github.io/overthecocoons/ 以 `data` 分支真实抓取数据运行（每日工作流维护），页面不再标注「演示数据」。`fixtures/snapshot.json` 仅供离线演练与演示模式（`SNAPSHOT_PATH` 注入），非真实抓取结果。

## 本地首次环境准备

前置运行时（仓库已用字段固定，与 CI 一致）：

- Node.js 24.18.0（`package.json` engines）
- pnpm 10.26.2（`package.json` packageManager；可用 `corepack enable pnpm` 启用）

首次步骤：

1. `pnpm install` —— 严格按 `pnpm-lock.yaml` 安装依赖，不跳过锁文件。
2. `pnpm build` —— **构建先于测试**：生成 `dist/`，Playwright e2e 的本地服务器（`astro preview`）依赖它；同时生成 `.astro/` 类型。
3. `pnpm exec playwright install chromium` —— 安装本机日常 e2e（仅 Chromium）所需浏览器；新环境若跳过此步，`pnpm test` 的 e2e 阶段会直接失败。跑全矩阵 `pnpm test:e2e:matrix` 需另装 `firefox` 与 `webkit`（`pnpm exec playwright install firefox webkit`）。
4. `pnpm test` —— 依次执行 `astro check`（类型检查）、`astro build`、Node 单元测试与 Playwright e2e（Chromium 单引擎）。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm test:node` | 只跑 Node 单元测试（数据规则、编排、工作流定义 lint） |
| `pnpm test:e2e` | 只跑 e2e 的 chromium project（本机日常检测口径，50 用例） |
| `pnpm test:e2e:matrix` | 跑全部 5 个 e2e project（chromium/firefox/webkit/mobile-chrome/mobile-safari，需另装 firefox/webkit） |
| `pnpm smoke:source` | 首源只读烟测：发起真实网络读取，不写任何文件 |
| `node scripts/update-data.ts --dir <演练目录> --init` | data 权威状态初始化演练（仅手动；不抓取、不产快照） |
| `node scripts/update-data.ts --dir <演练目录> --fixture` | data 更新编排离线演练（注入合成 feed，不触网） |

data 更新编排说明见 `docs/mvp-architecture.md`（工作流与失败控制）与 `docs/mvp-decisions.md`（MVP-Q13–Q18/Q21）；工作流定义在 `.github/workflows/update-data.yml` 与 `init-data.yml`。来源提交走 GitHub Issue 模板（站内「提交新来源」入口）。

## 许可

代码许可证 MIT（见 `LICENSE`）；来源内容不因本项目许可证而重新许可，来源内容的公开使用范围以核实记录为准。

## TODO

剩余未完事项（2026-10-04 状态；逐项证据与已闭环对照见 `docs/remaining-work-report.md`，台账 `.superpowers/sdd/mvp-tickets/progress.md`）。

### 性能与验收裁决

- [ ] 线上性能：立项优化（线上移动 perf 67 / FCP 3.7s / LCP 3.9s / TBT 400ms，本地移动 90、桌面 100，Lighthouse 单轮）或裁定不立项接受现状
- [ ] Lighthouse 多轮（≥3 次取中位数）复测并把门槛写入验收档，或裁定维持单轮口径
- [ ] 客户端数据岛 41,419 B 内联进每个页面、随 7 天窗口线性膨胀——是否处理

### 未核实项

- [ ] feed 时间（日期）语义核实（影响「可靠发布时间」标注口径）
- [ ] 百度热搜「榜单规则」浮层文本获取（许可核查时实测 `display:none` 未取到）
- [ ] GSAP 自托管库许可条款落档核查（`public/vendor/` 保留 GreenSock 版权头）

### deferred minor（41 条，全部不阻塞）

T01 工程骨架（3）

- [ ] e2e 对根路径 `/favicon.ico` 的豁免弱化断言
- [ ] snapshot 校验的 `entries[]` 内字段分支无用例
- [ ] `@types/node 24.19.1` 超出依赖证据文档清单，补录 `docs/mvp-dependency-evidence.md`

T02 数据契约（3）

- [ ] `parseIsoTime` 宽松校验，收紧正则 + 双检
- [ ] `sources` 数组顺序随更新漂移（展示层噪声）
- [ ] 相同坏条目逐日重复入隔离台账（后续治理决定）

T03 首源归一化（6）

- [ ] DNS rebinding / 内嵌 IPv4 的 TOCTOU 加固（当前记为 deferred）
- [ ] 体读取中途超时消息未归一（fail-closed 不破，仍计入重试）
- [ ] 确定性校验失败也在重试循环内（无害）
- [ ] 公网域名尾点 FQDN 现被拒（fail-closed 取舍，冻结首源无尾点）
- [ ] 报告口径——空 `description` 实为缺失而非空串
- [ ] 烟测结果为单机单次口径

T04 时间线静态渲染（4）

- [ ] KPager `aria-disabled` 禁用态（`src/components/KPager.astro:21,41`）与分页重做一并处理
- [ ] ≤767px 无 JS 主题筛选不可达（页脚补主题链接）
- [ ] fixture guid→id 映射方案未记录进 `docs/fixtures.md`
- [ ] e2e `sortedEntries` 镜像比较器漂移风险（改导入 `sortEntriesDesc`）

T05 交互（6）

- [ ] 同主题翻页误播报回退文案（fallback 后缀应仅限主题变化时）
- [ ] 阅读位置采样不认滚动条拖拽 + 恢复动画 200ms 采样窗口污染记忆
- [ ] e2e 镜像比较器（与 T04 同项，改导入）
- [ ] 数据岛负面断言不全（改「仅时间线路径允许」正向断言）
- [ ] `announce` 连续相同文案不重播
- [ ] `.k-list` 死属性 `data-page` + 同主题 Tab 客户端与静态链接语义分歧

T06 动效（5）

- [ ] `initMotion` catch 未即时移除 `data-oct-pending`（依赖 1500ms 兜底，建议补一行）
- [ ] e2e `readbar scaleX` 断言恒真（首值应 >0）
- [ ] `aria-current`/indicator 编排点推迟到 out 段后（与原型的已知差异）
- [ ] 报告数字勘误（736→731、18+8、测试分组标签）
- [ ] reduced-motion e2e 补 computed opacity 断言

T07 工作流（4）

- [ ] 治理测试权限正则只锚顶层 2 空格缩进（job 级 `permissions` 可绕过）
- [ ] `scripts/update-data.ts` 生产入口静态 import 测试夹具（分层瑕疵）
- [ ] `ls-remote` 瞬时网络失败会静默走初始化路径（方向安全）
- [ ] `update-data.yml` 实际调用串无测试断言（与 CLI 漂移无报警）

T08 工作流收尾（6）

- [ ] `tests/e2e/smoke.spec.ts:36` `HTTP ${response.status}` 漏写 `()`（1 字符）
- [ ] 权限正则缩进盲区（与 T07 同项）
- [ ] `build-deploy.yml` `GITHUB_REF_NAME="data"` 死分支与过时步骤名
- [ ] deploy job 加 `if: github.ref == 'refs/heads/main'` 显式化 main 保护
- [ ] SRI 守卫只能证明标签摘要 = dist 文件摘要，不能证明 = cdnjs 官方
- [ ] GSAP 自托管库自身许可条款未落档（与未核实项一条相关）

终审新发现（4）

- [ ] `assertSnapshot` 不校验 `entries[].id` 为 64hex
- [ ] `assertSnapshot` 不校验 `generatedAt` 可解析
- [ ] `TimelinePage.astro` `data-page` 死属性（与 T05 同项）
- [ ] 数据岛内联膨胀（与性能节一条相关）
