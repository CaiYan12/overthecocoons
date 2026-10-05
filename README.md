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
| `pnpm smoke:source` | 首源只读烟测：发起真实网络读取，不写任何文件；结果为单机单次口径，不构成对源的可用性证明 |
| `node scripts/update-data.ts --dir <演练目录> --init` | data 权威状态初始化演练（仅手动；不抓取、不产快照） |
| `node scripts/update-data.ts --dir <演练目录> --fixture` | data 更新编排离线演练（注入合成 feed，不触网） |

data 更新编排说明见 `docs/mvp-architecture.md`（工作流与失败控制）与 `docs/mvp-decisions.md`（MVP-Q13–Q18/Q21）；工作流定义在 `.github/workflows/update-data.yml` 与 `init-data.yml`。来源提交走 GitHub Issue 模板（站内「提交新来源」入口）。

## 许可

代码许可证 MIT（见 `LICENSE`）；来源内容不因本项目许可证而重新许可，来源内容的公开使用范围以核实记录为准。

## TODO

剩余未完事项（2026-10-05 状态；逐项证据与已闭环对照见 `docs/remaining-work-report.md`，台账 `.superpowers/sdd/mvp-tickets/progress.md`）。

### 性能与验收裁决（2026-10-05 已裁决）

- [x] 线上性能：裁定不立项优化，接受现状并记录为已知限制（线上移动 perf 67 / FCP 3.7s / LCP 3.9s / TBT 400ms，本地移动 90、桌面 100，Lighthouse 单轮）
- [x] Lighthouse 口径：裁定维持单轮口径，不做多轮中位数复测，不把门槛写入验收档
- [x] 客户端数据岛 41,419 B 内联进每个页面：随性能不立项一并记录为已知限制，暂不处理（仍随 7 天窗口线性膨胀）

### 未核实项（2026-10-05 全部核实落档）

- [x] feed 时间（日期）语义核实：裁定 pubDate＝上游聚合器（aishort）抓取/入库时间，非百度发布时间（同批 66 条挤在 11 秒内、恒早于本站收录 2–16 小时）；产品口径不变（排序用首次收录时间、originalTime 恒 null）；证据见 `docs/mvp-dependency-evidence.md`，结论同步站内 sources 页
- [x] 百度热搜「榜单规则」文本获取：正文在规则页 `top.baidu.com/board?page=rule&tab=realtime`（非浮层），已落档并接入站内 sources 页官方出处（热度排序、每 5 分钟更新）
- [x] GSAP 自托管库许可条款落档核查（2026-10-05 实读 gsap.com/standard-license：免费含商用、自托管属许可用途、须保留版权声明——本项目合规，落档 `docs/mvp-dependency-evidence.md`）
- [ ] 非阻塞观察项：跨生成周期 pubDate 稳定性（feed 实测有缓存，跨约 5 小时生成周期是否漂移未观测；不设截止，多源接入或异常时复核）

### deferred minor（41 条，2026-10-05 全清）

全部 41 条已处置完毕：代码修复 / 测试补强 / 报告勘误 / 取舍裁定记录，逐条处置口径见 `docs/remaining-work-report.md`。

- [x] T01 工程骨架（3）：favicon 豁免收窄为「同源根路径」、snapshot 校验补 entries[] 分支与 64hex/generatedAt 用例、`@types/node 24.19.1` 补录依赖证据文档
- [x] T02 数据契约（3）：`parseIsoTime` 收紧正则 + Date.parse 双检；`sources` 按 sourceId 确定性排序（展示层不再随更新漂移）；隔离台账重复记录裁定保留——台账是追加式审计流水，重复即真实历史
- [x] T03 首源归一化（6）：体读取中途超时消息归一（「读取响应体超时」）；空 description 分层口径勘误（归一化层 null、契约层空串）；烟测单机单次口径注记（AGENTS/README）；DNS rebinding TOCTOU、确定性失败重试、尾点 FQDN 三项裁定维持 fail-closed 现状并记录理由
- [x] T04 时间线静态渲染（4）：KPager `aria-disabled` 核查确认已随 T06 闭环（CSS `[aria-disabled="true"]` 已生效）；页脚新增主题导航（仅 ≤767px 显示，补无 JS 主题入口）；`docs/fixtures.md` 补 guid→id 映射方案；e2e 改导入渲染层 `sortEntriesDesc` 消除镜像比较器
- [x] T05 交互（6）：回退播报仅限主题变化时（记忆保留，回主题仍可恢复）；程序化滚动（恢复/回顶）暂停阅读位置采样，滚动条拖拽记为已知限制；数据岛改「仅时间线路径允许」正向断言；`announce` 连续相同文案清空重写以重播；移除 `.k-list` 死属性 `data-page`；点击当前主题 Tab 与静态链接语义对齐（重置到第 1 页）
- [x] T06 动效（5）：`initMotion` catch 即时移除 `data-oct-pending`（不再依赖 1500ms 兜底）；readbar 断言改解析 matrix 首值 a>0（原断言恒真）；报告数字勘误（736 行、18/27、测试分组）；reduced-motion e2e 补 computed opacity 断言；indicator 编排点差异记为已知差异（参数与原型一致）
- [x] T07 工作流（4）：治理测试封堵 job 级 `permissions` 缩进盲区（三工作流统一禁止）；`scripts/update-data.ts` 夹具改动态导入（生产入口不静态依赖 tests/ 分层）；`init-data` ls-remote 区分「分支不存在」(exit 2) 与访问失败（后者拒绝初始化）；`update-data.yml` 调用串测试断言（CLI 漂移报警）
- [x] T08 工作流收尾（6）：smoke 漏写 `()` 修正；`build-deploy.yml` 删除不可达 `GITHUB_REF_NAME="data"` 死分支 + deploy 显式 `if: github.ref == 'refs/heads/main'`；SRI 守卫边界注记（只证明标签=dist，官方一致性由 2026-10-03 独立取证留档）；GSAP 许可落档（见未核实项）
- [x] 终审新发现（4）：`assertSnapshot` 补 `entries[].id` 64hex 与 `generatedAt`/`firstSeenAt` 可解析校验；`data-page` 死属性（与 T05 同项）；数据岛随性能裁决记为已知限制

顺带修正（不在 41 条内）：治理测试「版本 pin」断言未随 B-② 钉 commit SHA 更新而在基线上失败（基线复验确认既有，非本轮引入），已改按「40 位 SHA + 版本注释」口径匹配。
