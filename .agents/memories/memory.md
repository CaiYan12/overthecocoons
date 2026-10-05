# 项目记忆索引

统领本目录：单条记忆文件名为 `YYYYMMDDHHMM.md`（本地时间，精确到分），本索引按时间倒序登记。读取规则：先读本索引定位，再打开对应条目；记忆是经验与过程沉淀，**当前状态以 AGENTS.md 状态段与 Git 现状为权威**，冲突时以现状为准并复核后修订记忆。

| 记忆文件 | 时间 | 摘要 |
| --- | --- | --- |
| [202610052007](202610052007.md) | 2026-10-05 20:07 | 本仓库本地开发服务器口径：无 `dev` 脚本，用 `pnpm exec astro dev --host 127.0.0.1 --port 4322`。**两点必守**：① 启动前用 `cmd //c "rd /s /q node_modules/.vite"` 预清（Astro dev 强制 optimizeDeps.force，会触发沙箱 safe-delete 守卫；且该清除必须在前台做）；② **端口避开 4321**——那是 playwright `webServer` 的端口且 `reuseExistingServer` 为真，被占用会让 e2e 静默复用 dev 服务器。另记：dev 下 CSS 是 vite JS 模块，校验样式要用浏览器 `getComputedStyle`，curl+grep 取不到 |
| [202610051856](202610051856.md) | 2026-10-05 18:56 | **#14 指针样式革新实现完成（`dccf6b9`，21 文件 +568−51）**：反相混合移到 `.k-cursor` 容器（1.09→17.87:1）、语义标签移出为兄弟元素独立跟随并同步 scale、描边 1.5→2px（Blink 取整）、新增 `data-cursor-soft` 轻量态覆盖全部可点击元素。**复审修复回归**：标签移出容器后 `onLeaveDoc` 只隐藏光标会留悬空残影 → 改为一起隐藏 + 补 window blur。**WebKit 实测机制**：合成 mouseleave 后会重放悬停链（out→over）→ 判定模拟假象，标签隐藏改由失焦路径断言。门禁全绿（Node 255/255、e2e 54/54）、矩阵 257+13。沉淀 `samplePixels`/`contrastRatio`/`designToken` 等像素级测试手法与变异验证法 |
| [202610051736](202610051736.md) | 2026-10-05 17:36 | #12 实现留档提交 `ba48220`（+ 记忆 `8953043`/`77f4779`、忽略规则 `b136a0f`），工作区 `git status` 完全干净；#12 补更正评论修正「不单独提交」一句；门禁全绿口径（check 0 error、build 66 pages、Node 254/254、e2e 50/50）。**两个必守前提**：必须用系统 Node 24（`export PATH="/c/Program Files/nodejs:$PATH"`，否则 18 项 cancelledByParent + exit 1 酷似代码缺陷）、必须前台跑（后台无法批准沙箱升级 → exit 127）；守卫计数按单次工具调用累计。main 领先 origin/main 7 个提交未推送 |
| [202610051712](202610051712.md) | 2026-10-05 17:12 | 用户裁定 **C+D 同票**：发布 Spec **#13**（指针样式革新）+ 票 **#14 / Ticket 13-1**（反相混合移到容器 + 语义标签移出反相层 + 语义覆盖分档），#14 经 REST 挂为 #13 子 issue；**#12 关闭**并留证据评论。踩点：`gh sub-issue` 命令不存在（须走 `POST issues/<n>/sub_issues` + 数据库 id）；票号改 `Ticket 13-1` 以免与 MVP 票序混淆；`.design-flow.json` 仍是 audit 态未更新 |
| [202610051617](202610051617.md) | 2026-10-05 16:17 | 指针样式实测（#12 未提交实现）：`mix-blend-mode: difference` **完全不生效**——`.k-cursor` 自身 `position:fixed` 成隔离组（A/B 隔离实证），浅色纸面 dot 实测对比度仅 1.09:1；修法已验证＝difference 移到容器上（17.87:1），代价是 label 随之反相；`border-width:1.5px` 被 Blink 取整为 1px（#12 该改动无效），亚像素需用 `box-shadow spread`（1.5px→实测 1.67px）；语义标签全站仅 3 类，tab/分页/菜单/模式/返回顶部等可点击但零反馈；沉淀「像素级实测法 + 根因隔离法 + clip 夹紧采样陷阱」 |
| [202610051435](202610051435.md) | 2026-10-05 14:35 | UI 实测审计（playwright 多视口多主题）+ 打磨票 #10 实现：播报 chip、hudMobileFirst 收窄 order:-1、行首分隔符、hero 栅格、空态文案；对比度必须实测勿目测；全局 order 修复会误伤他页；#11 追加：NOW READING 归位 --（偏离原型已裁定）；推送后 Closes #10/#11 |
| [202610051201](202610051201.md) | 2026-10-05 12:01 | 未核实项清零：feed pubDate 裁定＝上游抓取时间非发布时间（口径不变）、榜单规则在规则页非浮层（找错承载位置的教训）、项目无阻塞无待裁决；仅余跨周期 pubDate 稳定性非阻塞观察项 |
| [202610051139](202610051139.md) | 2026-10-05 11:39 | deferred minor 41 条全清完成（全 test 绿 + 矩阵复跑绿）；处置四分类与行为修复要点；治理测试版本 pin 断言随 B-② 失效的基线既有失败教训；e2e 断言侧无 DOMMatrixReadOnly；剩余仅 feed 语义与榜单规则两项 |
| [202610051046](202610051046.md) | 2026-10-05 10:46 | 性能裁决落档：不立项、记录为已知限制，Lighthouse 维持单轮口径不落门槛，数据岛内联暂不处理；deferred 41 条与 feed 语义仍 open；setup-matt-pocock-skills 已配置完成无需重跑 |
| [202610042148](202610042148.md) | 2026-10-04 21:48 | 发布闸门收尾：测试口径、B-② 钉 SHA 生效、剩余事项载荷、本机操作偏好；确立 `.agents/memories`/`.agents/skills` 目录与收尾强制更新记忆约定（项目记忆专用本目录，harness 用户级记忆不受限） |
