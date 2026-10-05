# 剩余未完事项报告（2026-10-04 初稿；2026-10-05 deferred minor 全清更新）

范围：全分支终审分诊后的 deferred minor、B-① 人工项（性能/Lighthouse）、未核实项。证据基线：`.superpowers/sdd/mvp-tickets/progress.md`（本地台账）与本轮实测。状态口径：`已解决`＝有提交或实测证据；`open`＝当前工作区仍存在（本轮逐条抽查关键项，见文末核对）。

**2026-10-05 全清裁定（用户指令「deferred minor 41 条全清」）**：第一节 41 条全部处置完毕。处置方式分四类——①代码/测试修复（T01-①②、T02-①②、T03-②、T04-②③④、T05-①②③④⑤、T06-①②④⑤、T07-①②③④、T08-①③④、终审①②）；②已随更早修复闭环的清单误挂（T04-①，`a6e407e` 时代 CSS 已改 `[aria-disabled="true"]` 并删死规则，本轮核查确认）；③取舍裁定记录不改行为（T02-③ 隔离台账重复＝追加式审计流水语义；T03-① DNS rebinding TOCTOU＝冻结单一可信首源威胁模型下风险收益不成比例；T03-③ 确定性失败重试＝结果确定、上限 2 次浪费有界；T03-④ 尾点 FQDN＝fail-closed 取舍留档；T05-② 滚动条拖拽半项＝浏览器不在文档层派发滚动条事件，无法可靠识别，记为已知限制；T06-③ indicator 编排点＝与原型参数一致的已知差异；T08-⑤ SRI 守卫边界＝注记进测试注释；终审④ 数据岛＝随 2026-10-05 性能裁决记为已知限制）；④报告勘误（T03-⑤ 空 description 分层口径勘误——归一化层 `feed-parse.ts` 输出 `summary: null`（缺失），契约 `items.json` 层才落空串，原文「contract 已定义空串语义」未分层；T06-④ 报告数字勘误——motion.ts 行数 736 为误计（评审实测 731、现行 732），「18/27 通过 8 失败」总数算术误（18+8=26），e2e 分组与现行套件不符（实测 motion 27 + interactions 16 + smoke 7 = 50）；勘误正文落在本地台账 task-03/06-report.md，本报告为仓库内权威记录；T08-⑥ GSAP 许可实读 gsap.com/standard-license 落档 `docs/mvp-dependency-evidence.md`）。终审②的实现除 `generatedAt` 外一并校验 `entries[].firstSeenAt` 可解析（同一断言族的自然延伸，超出清单原文、方向安全，此处补记）。下表保留为逐条原始清单（处置口径见各条末尾标注与代码/文档内注释）。

全清验证：`pnpm test` 全绿（astro check 0 error、Node 254/254（原 244 + 新增 10）、e2e chromium 50/50，2026-10-05 本机）。基线复验另发现一处既有失败：治理测试「版本 pin」断言未随 B-② 钉 SHA 更新（非本轮引入，已一并修正断言口径）。

## 一、deferred minor 清单（41 条 open，按票）

| 票 | open | 条目 | 已随修复闭环（不计入 41） |
| --- | --- | --- | --- |
| T01 工程骨架 | 3 | ① e2e 对根路径 `/favicon.ico` 的豁免弱化断言 ② `@types/node 24.19.1` 超出证据文档清单，待补录 ③ snapshot 校验 `entries[]` 内字段分支无用例 | engines 固定（工作流显式 `node-version: 24.18.0`）；环境准备文档化（README，`4455a35`） |
| T02 数据契约 | 3 | ① `parseIsoTime` 宽松校验，后续收紧正则+双检 ② `sources` 数组顺序随更新漂移（展示层噪声） ③ 相同坏条目逐日重复入隔离台账（治理决定） | `assertStateFile` 不交叉校验 `stableId` → **R1 已修**（契约断言+3 用例+生产路径实证）；`verifyManifest` 前置/时钟单调（`4455a35`） |
| T03 首源归一化 | 6 | ① DNS rebinding/内嵌 IPv4 TOCTOU 加固（裁定记 deferred，T07/闸门如需再做） ② 体读取中途超时消息未归一 ③ 确定性校验失败也在重试循环内 ④ 尾点 FQDN 现被拒（fail-closed 取舍，首源无尾点） ⑤ 空 description 报告口径 ⑥ 烟测单机单次口径 | — |
| T04 时间线静态渲染 | 4 | ① KPager `aria-disabled`（`src/components/KPager.astro:21,41`，本轮实查仍在） ② ≤767px 无 JS 主题筛选不可达（页脚补主题链接） ③ fixture guid→id 映射未记入 `docs/fixtures.md` ④ e2e `sortedEntries` 镜像比较器漂移风险（`sortEntriesDesc` 已导出于 `src/lib/timeline.ts:62`，改导入即可） | `.page-btn[disabled]` 死规则（`a6e407e`） |
| T05 交互 | 6 | ① 同主题翻页误播报回退文案（fallback 后缀应仅限主题变化） ② 阅读位置采样不认滚动条拖拽 + 200ms 窗口污染记忆 ③ e2e 镜像比较器（同 T04-④） ④ 数据岛负面断言不全（改正向断言） ⑤ `announce` 连续相同文案不重播 ⑥ `.k-list` 死属性 `data-page` + 同主题 Tab 客户端/静态链接语义分歧 | FOUC 启动脚本（`a6e407e`） |
| T06 动效 | 5 | ① `initMotion` catch 未即时移除 `data-oct-pending`（依赖 1500ms 兜底，建议补一行） ② e2e `readbar scaleX` 断言恒真（首值应 >0） ③ `aria-current`/indicator 编排点与原型差异（已知差异） ④ 报告数字勘误（736→731、18+8、分组标签） ⑤ reduced-motion e2e 补 computed opacity 断言 | GSAP CDN 自托管（`46827b6`） |
| T07 工作流 | 4 | ① 治理测试权限正则只锚顶层 2 空格缩进（job 级 `permissions` 可绕过，T08 复审实测仍开放） ② `scripts/update-data.ts` 静态 import 测试夹具（分层瑕疵） ③ `ls-remote` 瞬时失败静默走初始化路径（方向安全） ④ `update-data.yml` 调用串无测试断言 | 三 action 钉 tag → **B-② 已钉 commit SHA**（本轮，13 处） |
| T08 工作流收尾 | 6 | ① `tests/e2e/smoke.spec.ts:36` `HTTP ${response.status}` 漏 `()`（1 字符，本轮实查仍在） ② 权限正则缩进盲区（= T07-① 同项） ③ `build-deploy.yml:51-58` `GITHUB_REF_NAME="data"` 死分支与过时步骤名（本轮实查仍在） ④ `workflow_dispatch` 建议 deploy 加 `if: github.ref == 'refs/heads/main'` ⑤ SRI 守卫只能证明标签摘要=dist，不能证明=cdnjs 官方（已独立取证过一次） ⑥ GSAP 自托管库许可条款未落档核查 | `.snapshot/` 进 `.gitignore`（`d980882`）；注释过滤核验为非缺陷 |
| 终审新发现 | 4 | ① `assertSnapshot` 不校验 `entries[].id` 为 64hex ② 不校验 `generatedAt` 可解析 ③ `TimelinePage.astro` `data-page` 死属性（= T05-⑥ 同项） ④ 客户端数据岛 41,419 B 内联进每个页面，随 7 天窗口线性膨胀（性能观察，见下节） | — |

**性质说明**：全部为 minor，无一阻塞；其中 ①③ 类“死代码/口径”是清理项，②③ 类“加固”需裁决是否值得做，T04-④/T05-③ 是低成本测试去重。

**本轮新发生（下次清理时纳入）**：`tests/e2e/helpers.ts` 为新增未跟踪文件；`pnpm test:e2e` 已改为仅 chromium（`test:e2e:matrix` 跑 5 项目）——此为用户 2026-10-04 裁决“本机仅 chrome 检测”。

## 二、性能与 Lighthouse（B-① 人工项 ③④，待裁决）

**实测数据（Lighthouse 13.5.0，单轮，headless）**

| 目标 | perf | 关键指标 |
| --- | --- | --- |
| 本地 preview 移动模拟 | 90 | FCP 1.6s / LCP 1.8s / CLS 0 / TBT 350ms |
| 本地 preview 桌面 | 100 | FCP 0.4s / LCP 0.4s / TBT 20ms |
| 线上移动模拟 | **67** | **FCP 3.7s / LCP 3.9s / TBT 400ms / 主线程 7.0s / 总量 96 KiB** |

- a11y / best-practices / seo 三档全部 100；本地与线上请求 host 均仅站点自身域（零第三方外链已实证）。
- 线上 67 为单轮冷缓存模拟节流结果，非统计；本地 vs 线上差距主要在网络侧（GitHub Pages 首字节 310ms），**未做归因分析**。
- 已知结构性观察：数据岛 41,419 B 内联进每个页面，7 天窗口条目增长会线性膨胀（与 Lighthouse 未做因果关联）。

**裁决（2026-10-05，用户裁定）**
1. 性能不立项优化，接受现状并记录为已知限制（线上移动 perf 67 / FCP 3.7s / LCP 3.9s / TBT 400ms 均为已知限制口径；数据岛 41,419 B 内联随同一裁决暂不处理）。
2. Lighthouse 维持单轮口径，不做多轮中位数复测，不把门槛写入验收档。

以下二选一原文留档（已被上述裁决取代）：

**待用户二选一**
1. 立项优化（对象：线上 FCP/LCP、TBT、数据岛内联）——需单独排期，涉及构建策略，不是清理项。
2. 不立项，接受线上 perf 67（记录为已知限制）。

**待用户二选一**
1. Lighthouse 多轮（≥3 次取中位数）复测并把门槛写入验收档。
2. 维持单轮口径，不落门槛。

## 三、未核实/未留证项

| 项 | 状态 | 说明 |
| --- | --- | --- |
| feed 时间（日期）语义 | **已核实落档（2026-10-05）** | 实测裁定：pubDate＝上游聚合器（aishort）抓取/入库时间，非百度发布时间（同批 66 条挤在 11 秒内、GUID 串号同序、恒早于本站收录 2–16 小时）；不构成「可靠发布时间」，产品口径不变；证据见 `docs/mvp-dependency-evidence.md`。残余：跨生成周期 pubDate 稳定性为非阻塞观察项 |
| 百度热搜「榜单规则」浮层文本 | **已获取落档（2026-10-05）** | 正文在规则页 `top.baidu.com/board?page=rule&tab=realtime`（非浮层，静态 HTML 即含五节全文）；已接入站内 sources 页官方出处并落档 `docs/mvp-dependency-evidence.md` |
| GSAP 自托管库许可条款 | **已落档（2026-10-05）** | 实读 gsap.com/standard-license（2025-04-30 生效版）：免费含商用、自托管属许可用途、须保留专有声明——本项目合规；落档 `docs/mvp-dependency-evidence.md`「GSAP 自托管许可落档」节 |
| 手机实机验证 | 无本地证据 | 用户 2026-10-04 口头确认通过，证据不在仓库 |
| B-② 钉 SHA 生效 | 待 push 后验证 | YAML 格式已校验；真正生效需 GitHub Actions 实际运行一次 |
| 跨浏览器矩阵进 CI | 未做（未要求） | 矩阵仅本地跑过（run7/run8 全绿）；CI 不跑 e2e 是既有设计 |

## 四、本轮已闭环（供对照）

- 跨浏览器 e2e 测试套件修复：全矩阵连续两轮 245 passed + 5 skipped / 0 failed；全量 `pnpm test` EXIT=0。
- B-②：13 处 `uses:` 钉 40 位 commit SHA + 版本注释（3 个工作流），YAML 解析与格式校验通过。
- 本机 e2e 收敛为 chromium 单测（`pnpm test:e2e` 50/50，1.6m），5 项目矩阵保留为 `pnpm test:e2e:matrix`。

## 五、需裁决事项汇总

1. deferred minor 41 条：整体继续 deferred / 指定票清理 / 全清（全清工作量约中等，含测试去重与死代码，无行为变更预期）。**已于 2026-10-05 裁定全清并执行完毕（见文首全清裁定与第一节标注）。**
2. 性能立项与否（二节两组二选一）。**已于 2026-10-05 裁决：不立项、记录为已知限制，Lighthouse 维持单轮口径不落门槛（见二节）。**
3. feed 日期语义核实（唯一影响产品标注口径的未核实项）。**已于 2026-10-05 核实并裁定：pubDate＝上游抓取时间、非百度发布时间，产品口径不变；「榜单规则」文本同日获取落档。至此第三节仅余跨生成周期 pubDate 稳定性非阻塞观察项。**
