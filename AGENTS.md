# AGENTS.md

## 项目背景与当前状态

- 项目：跳出茧房 Over the cocoons。
- 先读 `CONTEXT.md` 领域术语与 `docs/README.md` 文档索引，再读 `docs/mvp-decisions.md` / `docs/mvp-spec.md` 已确认规格、`docs/mvp-architecture.md` / `docs/mvp-implementation-plan.md` 实施建议，以及产品/UI基线。原始 `初版需求细化.md` 示例与未确认项不是实现证据；后续用户明确决定优先于旧记录。
- Ticket 01 工程骨架已建立：Astro 7.3.5 + TypeScript 6.0.3 + Tailwind CSS 4.3.3（`@tailwindcss/vite`），pnpm 10.26.2 锁文件已提交；占位首页（基路径 `/overthecocoons`、无 JS 可读、标注“演示数据”）；四条命令 `pnpm run check` / `build` / `test:node` / `test:e2e` 已在本地全部通过（2026-10-03，Node 24.18.0）。演示数据机制见 `docs/fixtures.md`（`fixtures/` 目录 + `SNAPSHOT_PATH` 注入）。
- Ticket 02 数据契约与身份规则已建立：`src/domain/contract.ts`（三文件契约 state/items/manifest、完整 SHA-256 稳定 ID＝来源 ID+NUL 分隔符+GUID、损坏校验）与 `src/domain/ingestion.ts`（可注入来源的纯函数合并管线：同 GUID 不重计首次收录、内容修订保留时间、wd 关键词冲突/缺 GUID/协议不合法/字段校验失败隔离、7 天窗口滚动、台账无限保留、失败降级保留旧快照、坏状态停写）；`src/lib/snapshot.ts` 公开快照校验随契约演进（新增 `quarantined`/`sources` 字段）。
- Ticket 03 首源归一化接入已建立：`src/lib/url-guard.ts`（服务端请求 URL 安全校验：仅 http/https、拒绝 localhost/环回/私有/链路本地/保留地址与数字形式 IP 伪装、重定向逐跳复验）、`src/lib/feed-parse.ts`（rss-parser 3.13.0 字段映射按其源码核实：GUID 取文本、description→content/contentSnippet；热度后缀移除、摘要 300 字上限、wd 取第一个解码精确串、originalTime 恒 null）、`src/lib/source-fetch.ts`（单次尝试获取：超时、非 2xx、有界读取、严格 UTF-8）、`src/lib/baidu-source.ts`（首源适配：SOURCE_ID 冻结为 `baidu-aishort`、默认 feed `https://rss.aishort.top/?type=baidu`、最多 2 次尝试加短退避、产出可注入管线的 SourceFetchResult）；`pnpm smoke:source` 只读烟测通过（2026-10-03，100 条、0 缺 wd、10 缺摘要、0 隔离）。获取/解析层未被页面导入，build 不隐式抓源；数据落盘工作流属 Ticket 07。
- 产品目标：拓宽视野为主、日常资讯为辅。公共时间线不按个人行为排序；可靠发布时间优先，缺失或语义未知时使用固定首次收录时间并明确标注。
- 核心约束：无个性化、无登录、无广告、无阅读历史、无第三方统计；不人工挑选、排序或推荐单条内容；允许来源准入和明确规则下的治理。
- 首版可单源正式公开。用户指定 `https://rss.aishort.top/?type=baidu`，定位为百度热点线索，首版按本站首次收录时间排序，入口标为“查看百度搜索结果”，移除标题热度后缀，不展示或使用热度排序。
- 首源本身有热搜筛选，不得宣称上游没有算法筛选；feed 时间语义和源内容公开使用许可尚未核实。图片、分类、全文和可靠商业标记在本次 feed 核查中缺失，不得臆造。
- 数据采用成功构建快照的最近 7 天窗口；重复抓取不刷新首次收录时间。每页最多 20 条，主题单选并可选“全部”，筛选后分页，刷新重置；首源默认主题为“新闻”“社会”。
- 摘要优先取源摘要、缺失时取源提供正文的纯文本，最多 300 字；当前首源不额外抓网页补图或正文。缺图或失败保留图片区域，用本站占位图；明确禁止外链时不请求源图。
- MVP 含时间线、主题筛选、来源页、关于／原则／隐私、图片与占位、每日更新、来源提交 Issue 模板；随机漫游、搜索、订阅输出和多源对照留到后续。
- 已确认 Astro + TypeScript、GitHub Actions 每日北京时间 08:00 触发及手动触发、GitHub Pages 子路径 `/overthecocoons`；不增加后端、数据库或用户系统。构建与占位页已落地（见上条），GitHub Actions 工作流与部署尚未创建。
- 代码许可证为 MIT，版权署名 `CaiYan12`，`LICENSE` 已创建。来源内容不因项目许可证而重新许可。
- 首版接受全中文；90/10 仅作后续多源方向，不删减内容凑比例。默认固定 11 个主题，优先映射源明确分类，缺失时用来源默认主题。
- UI 结构、风格与动效已在 `docs/ui-alignment.md` / `docs/ui-design.md` 对齐；后续核实来源使用说明、稳定身份和跨构建状态，并执行真实构建、浏览器、动效与部署验收。
- 原文代码未经验证；实现时必须核对依赖/API、解析和日期异常、抓取失败、去重、内容安全与子路径行为，不能直接复制并宣称可用。
- 产品、UI与MVP-Q1–Q22 已归档确认，规格、架构、依赖证据与实现计划已保存到 docs；MVP-Q13–Q22 于 2026-10-03 继续对齐后确认（初始化手动入口、损坏即停写停发人工恢复、台账无限保留、SHA-256 稳定 ID、三文件契约、并发冲突即失败、仅靠 data 分支历史恢复、wd 规则、隔离条目公开列出及八项工程方案固化）。建议和未验证项保持标注；工程骨架、数据契约/身份规则与首源归一化接入（Ticket 01–03）已建立并本地验证，渲染（Ticket 04）、交互/动效（05/06）、工作流与部署（07/08）尚未实现，GitHub Actions 工作流与部署尚未创建，未做线上验收；后续按用户授权推进。

## Context7

Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

1. Always start with `resolve-library-id` using the library name and the user's question, unless the user provides an exact library ID in `/org/project` format.
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question). Use version-specific IDs when the user mentions a version.
3. `query-docs` with the selected library ID and the user's full question (not single words).
4. Answer using the fetched docs.

## Personal rules

1. **Never guess.** 严禁臆测事实、代码、配置、API、参数、版本、路径、数据结构、运行结果；无法确定先查证，无法查证则询问用户。
2. **Exact identifiers.** 文件名、路径、变量、函数、字段、JSON/YAML Key、参数、URL、命令、包名等必须严格保持实际大小写、拼写、符号和结构，禁止猜测、归一化或自动修正。
3. **Evidence first.** 涉及现有项目时，优先读取源码、配置、测试、日志、抓包及实际输出；实际环境优先于记忆和惯例。
4. **Fact ≠ inference.** 严格区分事实、推论、建议；未经验证不得写成事实，严禁用 “candidate” 等模糊表述掩盖未知。
5. **No fabrication.** 未执行的命令、未运行的测试、未验证的修改不得声称成功。
6. **Minimal change.** 修改前理解现状，只改必要部分；禁止无关重构、依赖升级或改变既有行为。
7. **Verify.** 修改后尽可能测试；无法验证必须明确说明。Debug 遵循：现象→证据→原因→修复→验证；不得把猜测称为 Root Cause，不得把 Workaround 称为 Fix。
8. **Boundaries.** 保护 Secret、隐私和敏感信息；删除、覆盖、重置、发布及外部通信等高风险操作须谨慎。工具权限不等于执行授权。
9. **Correctness.** 用户错了要指出，自己错了要纠正；新证据优先于旧结论，正确性优先于迎合。
10. **Self-improvement.** use /self-improvement 从用户纠正、失败、调试和项目经验中提取可复用规律，避免重复犯错；重要经验沉淀到持久化记忆或项目文档，但不得自行改变核心规则或编造经验。
11. **Diving Workflow.** 复杂任务采用特定 skill **Align→PRD→Issues→Execute**：
    - **Align:** 用 `/grill-me` 或 `/grill-with-docs` 消除歧义，必要时记录 `CONTEXT.md`/ADR；简单任务跳过。
    - **SPEC:** 用 `/to-spec` 固化目标、范围、约束、验收标准。
    - **Issues:** 用 `/to-issues` 拆为可验证的 Vertical Slices。
    - **Execute:** 按 `/implement` 依赖执行；条件允许时 `/tdd`：失败测试→实现→通过→重构→提交。可使用 `/subagent-driven-development`。
12. **Proportionality.** 不为流程而流程；简单任务直接完成，复杂任务才启用完整 Workflow。
13. **Communication.** 直接、结构化、克制，避免夸赞和冗余。证据不足时明确说“不确定”，不得用猜测填空。
14. **Plannings.** 当使用计划模式时，编写计划严格采用分阶段、分步的细化步骤，并设计阶段 checkbox 与验收标准，作业过程中需要随时更新计划状态。每阶段完成后执行构建验证，最终完成时执行实机验证。

### 执行补充

- 所有文本使用 UTF-8；PowerShell 读写中文必须显式指定编码，保护原始需求文档。
- Git 提交、推送、合并、部署及对外通信必须有用户授权，技能中的流程步骤本身不构成授权。
- 不自动修改全局规则或持久化记忆；持久化记忆更新须有用户明确请求。
- `/to-issues` 是用户指定的流程名；本机初始化时实际检测到的是 `to-tickets`，未检测到 `to-issues` 文件夹。不得声称二者等同；执行该阶段前确认可用技能和映射。
- 建立构建/测试配置前，没有应用构建或实机验收可执行。后续报告须区分文件检查、本地运行、浏览器验证与线上部署证据。

## Agent skills

### Issue tracker

需求规格和任务使用 GitHub Issues，通过 `gh` CLI 操作；从实际 Git remote 解析目标仓库。See `docs/agents/issue-tracker.md`.

### Triage labels

采用默认五个 triage 标签，与 canonical roles 一一对应。See `docs/agents/triage-labels.md`.

### Domain docs

采用 single-context：根目录 `CONTEXT.md` + `docs/adr/`，按需创建。See `docs/agents/domain.md`.
