import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket 07 治理入口与工作流定义的 lint 级检查（任务书：本票只交付定义 +
 * 本地可验证的 schema/lint 级检查，不要求实际运行）。
 *
 * 事实依据（2026-10-03 查证 docs.github.com workflow-syntax）：
 * GitHub Actions 的 schedule cron 为 5 段 POSIX 语法（分 时 日 月 周，无秒段）；
 * 任务书所写「7 段 cron」是 Quartz/云开发定时器语法，GitHub 不支持。
 * 每日北京时间 08:00 = UTC 00:00，即五段表达式 `0 0 * * *`。
 */

const ROOT = join(import.meta.dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf-8");
}

/**
 * 权限缩进盲区封堵（T07 收尾项）：三个工作流都只允许顶层 `permissions:` 块。
 * 顶层正则（`^permissions:`）对 job 级（缩进的 permissions:）失明——job 级块可在
 * 不触碰顶层断言的情况下扩大授权，这里对所有工作流统一禁止任何缩进的 permissions 块。
 */
const WORKFLOW_FILES = [
  ".github/workflows/update-data.yml",
  ".github/workflows/init-data.yml",
  ".github/workflows/build-deploy.yml",
];

describe("工作流权限块结构（缩进盲区封堵）", () => {
  for (const file of WORKFLOW_FILES) {
    it(`${file} 只允许顶层 permissions 块，不得出现 job 级缩进块`, () => {
      const yaml = readRepoFile(file);
      assert.match(yaml, /^permissions:\s*$/m, "必须有顶层 permissions 块");
      assert.doesNotMatch(
        yaml,
        /^\s+permissions:\s*$/m,
        "不得出现 job 级（缩进的）permissions 块：权限收紧只经顶层块评审",
      );
    });
  }
});

describe("update-data 工作流定义（定时 + 手动）", () => {
  const yaml = readRepoFile(".github/workflows/update-data.yml");

  it("触发器：UTC 00:00（北京时间 08:00）的 5 段 cron + workflow_dispatch", () => {
    // GitHub cron 为 5 段 POSIX 语法；换算在 YAML 注释中注明。
    assert.match(yaml, /cron:\s*["']0 0 \* \* \*["']/);
    assert.match(yaml, /UTC 00:00[^\n]*北京时间 08:00|北京时间 08:00[^\n]*UTC 00:00/, "换算说明必须注明");
    assert.match(yaml, /^ {2}workflow_dispatch:\s*$/m, "必须支持手动触发");
  });

  it("与 main 推送构建分离：不响应 push / pull_request 触发", () => {
    assert.doesNotMatch(yaml, /^ {2}push:\s*$/m, "data 工作流不得由 push 触发");
    assert.doesNotMatch(yaml, /^ {2}pull_request:\s*$/m, "data 工作流不得由 PR 触发");
  });

  it("代码 checkout 必须显式 ref: main，不得依赖事件默认 SHA（2026-10-20 实测缺陷）", () => {
    // 缺陷经过：GitHub 的 schedule 事件用「工作流文件最后一次被修改时所在 commit」的 SHA，
    // 不是 main 最新 HEAD。10-16 起连续 5 次定时抓取都跑 10-15 的旧代码 cd2d444，只抓百度；
    // 六源代码 f789288（10-19）从未在定时任务中执行，导致线上长期只有 1 个来源。
    const mainIdx = yaml.split("\n").findIndex(line => /- name: Checkout main/.test(line));
    assert.notEqual(mainIdx, -1, "必须存在 Checkout main 步骤");
    const lines = yaml.split("\n");
    const nextStep = lines.findIndex((line, i) => i > mainIdx && /^\s+- name: /.test(line));
    const block = lines.slice(mainIdx, nextStep === -1 ? undefined : nextStep).join("\n");
    assert.match(block, /ref:\s*main\s*$/m, "Checkout main 必须显式 ref: main，否则定时任务会跑陈旧代码");
  });

  it("权限最小化：显式 permissions 块，仅 contents: write", () => {
    assert.match(yaml, /^permissions:\s*$/m, "必须有顶层 permissions 块");
    assert.match(yaml, /^ {2}contents:\s*write\s*$/m);
    // 最小权限：不得出现更宽的授权。
    assert.doesNotMatch(yaml, /write-all/);
    for (const forbidden of ["issues:", "pull-requests:", "packages:", "id-token:", "deployments:"]) {
      assert.doesNotMatch(yaml, new RegExp(`^ {2}${forbidden.replace("-", "\\-")}\\s*write`), `不得授权 ${forbidden} write`);
    }
  });

  it("并发串行控制且不取消排队运行（MVP-Q17：发布串行）", () => {
    assert.match(yaml, /^concurrency:\s*$/m);
    assert.match(yaml, /cancel-in-progress:\s*false/);
  });

  it("写入路径：调用 update-data 编排入口并推送 data 分支；无 force 推送", () => {
    assert.match(yaml, /scripts\/update-data\.ts/, "必须调用本票编排 CLI");
    assert.match(yaml, /git push origin data/, "写入目标是 data 分支");
    // force 检查只针对命令行（注释行允许解释禁令本身）。
    const commandLines = yaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(commandLines, /--force/, "命令中禁止 force 推送");
    assert.doesNotMatch(commandLines, /push\s+-f\b/, "命令中禁止 -f 强推");
  });

  it("调用串与 CLI 契约一致（T07 收尾项：参数漂移报警）", () => {
    // 工作流折叠块（run: >）的换行折叠为空白；断言四个参数齐备且顺序与 CLI 用法一致，
    // 任一参数改名/删除/换序都会使本断言失败，防止 YAML 与 scripts/update-data.ts 漂移。
    const commandLines = yaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.match(
      commandLines,
      /node scripts\/update-data\.ts\s+--store git\s+--dir data-branch\s+--expected-sha "\$\{\{ steps\.head\.outputs\.sha \}\}"/,
      "update-data.yml 的调用串必须与 CLI 契约（--store git --dir <检出> --expected-sha <HEAD>）一致",
    );
  });
});

describe("init-data 工作流定义（初始化仅手动入口，MVP-Q13）", () => {
  const yaml = readRepoFile(".github/workflows/init-data.yml");

  it("仅 workflow_dispatch 触发：无 schedule、无 push、无 pull_request", () => {
    assert.match(yaml, /^ {2}workflow_dispatch:\s*$/m);
    assert.doesNotMatch(yaml, /^ {2}schedule:\s*$/m, "初始化不得定时触发");
    assert.doesNotMatch(yaml, /^ {2}push:\s*$/m);
    assert.doesNotMatch(yaml, /^ {2}pull_request:\s*$/m);
  });

  it("调用 --init 手动初始化入口，权限最小化，禁 force", () => {
    assert.match(yaml, /--init/, "必须调用初始化入口");
    assert.match(yaml, /^permissions:\s*$/m);
    assert.match(yaml, /^ {2}contents:\s*write\s*$/m);
    assert.doesNotMatch(yaml, /--force/);
  });

  it("push 从主检出的孤儿 worktree 执行（审查修复环 R1：凭证策略）", () => {
    // 必须以 git worktree add --orphan 建孤儿树：凭证由 actions/checkout 写在主检出
    // 本地配置（includeIf.gitdir:<检出>/.git 及其 worktrees/* 变体），worktree 命中后者。
    assert.match(yaml, /git worktree add --orphan -b data data-branch/);
    // 命令行（排除注释）里不得再出现裸 git init：对 data-branch 单独 git init 的
    // 新仓库既无 includeIf 也无 extraheader，匿名 push 必失败（R1 Critical 回归守卫）。
    const commandLines = yaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(commandLines, /\bgit init\b/, "不得在检出目录外新建仓库后 push");
    // 不得在 YAML 内手工处理凭证（extraheader/token 注入）——凭证统一由 checkout 配置。
    assert.doesNotMatch(commandLines, /extraheader|AUTHORIZATION|GITHUB_TOKEN/);
  });

  it("ls-remote 区分「分支不存在」与访问失败（T07 收尾项：瞬时网络故障不得误判为可初始化）", () => {
    // --exit-code 语义：0=有匹配引用（data 已存在，须拒绝）；2=无匹配引用（可初始化）；
    // 其余退出码=命令本身失败（如瞬时网络故障），必须同样拒绝初始化并报错，不得继续。
    const commandLines = yaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.match(commandLines, /git ls-remote --exit-code --heads origin data/, "必须探测 data 分支");
    assert.match(commandLines, /-ne 2/, "退出码非 0 且非 2（访问失败）必须拒绝初始化");
    assert.match(commandLines, /拒绝初始化/, "失败分支必须显式报错退出");
  });
});

describe("来源提交 Issue 模板（治理入口）", () => {
  it("issue form 存在且字段对齐治理需要：feed URL、站点说明、申请人确认项", () => {
    const yaml = readRepoFile(".github/ISSUE_TEMPLATE/source-submission.yml");
    assert.match(yaml, /^name:/m, "issue form 必须有 name 前置字段");
    assert.match(yaml, /id:\s*feed-url/, "必须有 feed URL 字段");
    assert.match(yaml, /id:\s*site-description/, "必须有站点说明字段");
    assert.match(yaml, /id:\s*confirmations/, "必须有申请人确认项");
    assert.match(yaml, /type:\s*checkboxes/, "确认项为复选框");
    // 确认项覆盖核心治理约束（AGENTS.md 核心约束 + Q9 人工治理）。
    assert.match(yaml, /收录原则/, "确认项须指向收录原则");
    assert.match(yaml, /人工治理|不自动采纳/, "确认项须声明人工治理");
  });

  it("config.yml 关闭空白 Issue：站外提交一律走治理模板", () => {
    const yaml = readRepoFile(".github/ISSUE_TEMPLATE/config.yml");
    assert.match(yaml, /blank_issues_enabled:\s*false/);
  });
});

describe("站内「提交新来源」入口指向治理模板", () => {
  const TEMPLATE_URL =
    "https://github.com/CaiYan12/overthecocoons/issues/new?template=source-submission.yml";

  it("关于页入口指向 source-submission 模板深链", () => {
    const about = readRepoFile("src/pages/about.astro");
    assert.match(about, new RegExp(TEMPLATE_URL.replace(/[?]/g, "\\?")));
  });

  it("侧栏 HUD 入口指向 source-submission 模板深链", () => {
    const hud = readRepoFile("src/components/KHud.astro");
    assert.match(hud, new RegExp(TEMPLATE_URL.replace(/[?]/g, "\\?")));
  });
});

describe("build-deploy 工作流定义（Ticket 08：main 只读构建 + Pages 部署）", () => {
  const yaml = readRepoFile(".github/workflows/build-deploy.yml");
  // 命令行（排除注释行）：注释允许解释禁令本身。
  const commandLines = yaml
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  it("触发：push main + workflow_dispatch + repository_dispatch(data-updated)；不响应 PR，不由 data 分支 push 触发", () => {
    assert.match(yaml, /^ {6}- main\s*$/m, "push 触发须含 main");
    assert.match(yaml, /^ {2}workflow_dispatch:\s*$/m, "必须支持手动触发");
    assert.match(yaml, /^ {2}repository_dispatch:\s*$/m, "须由 data 更新后的 dispatch 触发");
    assert.match(yaml, /^ {6}- data-updated\s*$/m, "dispatch 事件类型为 data-updated");
    assert.doesNotMatch(yaml, /^ {6}- data\s*$/m, "data 分支 push 不触发（其上无工作流文件）");
    assert.doesNotMatch(yaml, /^ {2}pull_request:\s*$/m, "不得由 PR 触发");
  });

  it("发布接线闭环：update-data 仅在 data 实际前进时发 data-updated dispatch", () => {
    const updateYaml = readRepoFile(".github/workflows/update-data.yml");
    assert.match(updateYaml, /event_type=data-updated/, "update-data 须发出 data-updated 事件");
    assert.match(
      updateYaml,
      /steps\.publish-data\.outputs\.changed == 'true'/,
      "dispatch 必须以三文件实际变化为前提（无变化不触发重建）",
    );
    // dispatch 只调 GitHub API，不扩大权限（contents: write 已覆盖 repository_dispatch 创建）。
    const updateCommands = updateYaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(updateCommands, /actions:|write-all/, "不得扩大 update-data 权限");
  });

  it("权限最小化：contents: read + pages: write + id-token: write；无 contents: write", () => {
    assert.match(yaml, /^permissions:\s*$/m);
    assert.match(yaml, /^ {2}contents:\s*read\s*$/m);
    assert.match(yaml, /^ {2}pages:\s*write\s*$/m);
    assert.match(yaml, /^ {2}id-token:\s*write\s*$/m);
    assert.doesNotMatch(yaml, /^ {2}contents:\s*write\s*$/m, "只读构建不得授予 contents: write");
    assert.doesNotMatch(yaml, /write-all/);
  });

  it("并发串行：group pages 且排队不取消（发布中途取消可能留不一致状态）", () => {
    assert.match(yaml, /^concurrency:\s*$/m);
    assert.match(yaml, /group:\s*pages/);
    assert.match(yaml, /cancel-in-progress:\s*false/);
  });

  it("只读边界：checkout data 分支子目录 + build-snapshot 只读转换；无抓源、无写 data", () => {
    assert.match(yaml, /ref:\s*data\s*$/m, "必须以固定 ref 检出 data 分支");
    assert.match(yaml, /path:\s*data-branch\s*$/m, "data 必须检出为子目录");
    assert.match(yaml, /scripts\/build-snapshot\.ts/, "必须经快照生成 CLI（摘要校验 fail-closed）");
    // 不抓源：update-data 编排 CLI 与烟测不得出现在本工作流（注释行亦不允许，见上过滤）。
    assert.doesNotMatch(commandLines, /scripts\/update-data\.ts/, "只读构建不得调用 update-data 编排");
    assert.doesNotMatch(commandLines, /smoke:source|smoke-source/, "只读构建不得触发来源抓取烟测");
    assert.doesNotMatch(commandLines, /rss-parser/, "构建命令不得直接触碰 rss 抓取");
    // 不写 data：无任何向 data 分支的 git 写操作。
    assert.doesNotMatch(commandLines, /git push[^|]*\bdata\b/, "不得推送 data 分支");
    assert.doesNotMatch(commandLines, /git commit/, "不得产生任何 git 提交");
  });

  it("真实数据构建：SNAPSHOT_PATH 注入；不得回退 fixtures 演示数据", () => {
    assert.match(yaml, /SNAPSHOT_PATH:\s*\.snapshot\/snapshot\.json/, "必须注入 data 生成的快照");
    assert.doesNotMatch(commandLines, /fixtures\/snapshot\.json/, "构建不得使用演示快照");
  });

  it("部署链：官方 upload-pages-artifact + deploy-pages 固定版本；deploy 依赖 build 成功且显式限定 main", () => {
    // B-② 起第三方 action 一律钉 40 位 commit SHA、版本号以行尾注释留档，断言按该口径匹配。
    assert.match(yaml, /actions\/upload-pages-artifact@[0-9a-f]{40} # v5\.0\.0/);
    assert.match(yaml, /actions\/deploy-pages@[0-9a-f]{40} # v5\.0\.1/);
    assert.match(yaml, /^ {10}path:\s*dist\s*$/m, "上传产物为 dist");
    assert.match(yaml, /needs:\s*build\s*$/m, "deploy 必须依赖 build 成功");
    assert.match(yaml, /name:\s*github-pages\s*$/m, "部署进入 github-pages 环境");
    // T08 收尾项：main 保护显式化为部署闸门条件（所有触发形态运行 ref 均为 main，
    // 该条件固化约束——误配置其他 ref 时部署直接跳过而非误发）。
    assert.match(yaml, /if:\s*github\.ref == 'refs\/heads\/main'/, "deploy 必须显式限定 main ref");
  });

  it("版本 pin 与 T07 一致：checkout/setup-node/pnpm 固定版本（B-② 起钉 40 位 commit SHA + 版本注释），锁定可复核", () => {
    assert.match(yaml, /actions\/checkout@[0-9a-f]{40} # v7\.0\.1/);
    assert.match(yaml, /actions\/setup-node@[0-9a-f]{40} # v7\.0\.0/);
    assert.match(yaml, /pnpm\/action-setup@[0-9a-f]{40} # v6\.1\.0/);
    assert.match(yaml, /pnpm install --frozen-lockfile/, "依赖严格按锁文件");
  });
});

/**
 * 发布前门禁（2026-10-20）：完整检查与发布之间的阻断关系。
 *
 * 背景：此前 build-deploy 只跑 install + build，从不跑 check/test，CI 绿灯只证明「能构建」。
 * 这些断言把「门禁存在且位于发布之前」固化为机械检查，防止后人删改后无人察觉。
 */
describe("build-deploy 发布前门禁（检查失败必须阻止部署）", () => {
  const yaml = readRepoFile(".github/workflows/build-deploy.yml");
  const lines = yaml.split("\n");
  /** 返回某一行在文件中的下标，找不到即断言失败（避免 substring 位置比较的边界歧义）。 */
  const lineOf = (needle: RegExp, label: string): number => {
    const index = lines.findIndex(line => needle.test(line));
    assert.notEqual(index, -1, `未找到：${label}`);
    return index;
  };

  const uploadIdx = lineOf(/^\s+- name: Upload Pages artifact\s*$/, "Upload Pages artifact 步骤");
  const generateIdx = lineOf(/^\s+- name: Generate public snapshot from data branch\s*$/, "生产快照生成步骤");
  const checkIdx = lineOf(/^\s+- name: Check types/, "Check types 门禁步骤");
  const fixtureBuildIdx = lineOf(/^\s+- name: Build with fixtures for tests/, "夹具构建步骤");
  const unitIdx = lineOf(/^\s+- name: Unit \+ artifact tests/, "单元与产物测试步骤");
  const e2eIdx = lineOf(/^\s+- name: E2E tests/, "e2e 测试步骤");

  it("四项门禁都存在：check / 夹具 build / test:node / test:e2e", () => {
    assert.match(yaml, /run: pnpm run check/, "必须有类型检查");
    assert.match(yaml, /run: pnpm run test:node/, "必须有单元与产物测试");
    assert.match(yaml, /run: pnpm run test:e2e/, "必须有 e2e");
    assert.match(yaml, /playwright install --with-deps chromium/, "e2e 前须安装 chromium");
  });

  it("门禁全部位于 upload-pages-artifact 之前（失败即 build 失败，deploy 不被调度）", () => {
    for (const [idx, name] of [
      [checkIdx, "Check types"],
      [fixtureBuildIdx, "Build with fixtures"],
      [unitIdx, "Unit + artifact tests"],
      [e2eIdx, "E2E tests"],
    ] as const) {
      assert.ok(idx < uploadIdx, `${name} 必须在上传产物之前，否则失败也可能已发布`);
    }
    // 顺序也须成立：check → 夹具 build → 单元/产物 → e2e。
    assert.ok(checkIdx < fixtureBuildIdx, "check 应在构建前");
    assert.ok(fixtureBuildIdx < unitIdx, "产物断言依赖夹具构建，构建须在前");
    assert.ok(unitIdx < e2eIdx, "e2e 较慢，放在单元测试之后");
  });

  it("夹具构建与生产构建相互隔离：测试构建不得注入 SNAPSHOT_PATH", () => {
    // 夹具构建步骤的**可执行部分** = 从该 name 到下一个 `- name:`，且排除注释行
    // （注释允许解释该约束本身，与本文件既有口径一致）。
    const nextStep = lines.findIndex((line, i) => i > fixtureBuildIdx && /^\s+- name: /.test(line));
    assert.notEqual(nextStep, -1, "夹具构建步骤后应还有步骤");
    const fixtureBlock = lines
      .slice(fixtureBuildIdx, nextStep)
      .filter(line => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(fixtureBlock, /SNAPSHOT_PATH/, "夹具构建不得注入生产快照，否则产物断言测的就不是夹具");
    // 生产构建仍必须注入真实快照（既有约束，重复断言以防被误伤）。
    assert.match(yaml, /SNAPSHOT_PATH: \.snapshot\/snapshot\.json/, "生产构建须注入 data 生成的快照");
  });

  it("门禁不得被移到部署之后，也不得改成并行工作流（并行无先后保证）", () => {
    assert.ok(generateIdx > uploadIdx || generateIdx > unitIdx, "生产快照生成应位于门禁之后");
    assert.match(yaml, /needs:\s*build\s*$/m, "deploy 必须依赖 build 成功——这是阻断生效的机制");
    // 阻断依赖 needs:build，若改成 always() 或增加 always() 条件的 deploy 就会绕过门禁。
    assert.doesNotMatch(yaml, /if:\s*always\(\)/, "不得用 always() 绕过门禁");
  });

  it("分层门禁：data 更新（repository_dispatch）跳过 e2e，但代码推送必须跑全量", () => {
    // 用户裁定（2026-10-20）：data 更新不改代码，同一 commit 重复跑 e2e 无新信息。
    // 该豁免必须**只**针对 repository_dispatch，不得扩大到 push/workflow_dispatch。
    const nextStep = lines.findIndex((line, i) => i > e2eIdx && /^\s+- name: /.test(line));
    assert.notEqual(nextStep, -1, "E2E 步骤后应还有生产构建步骤");
    const e2eBlock = lines.slice(e2eIdx, nextStep).join("\n");
    assert.match(
      e2eBlock,
      /if:\s*github\.event_name != 'repository_dispatch'/,
      "e2e 豁免条件必须精确为 repository_dispatch（不得遗漏，也不得放宽到其它事件）",
    );
    // install 步骤同样跳过，避免为不跑的 e2e 白装浏览器。
    const pwIdx = lineOf(/^\s+- name: Install Playwright browsers/, "Playwright 安装步骤");
    const pwNext = lines.findIndex((line, i) => i > pwIdx && /^\s+- name: /.test(line));
    const pwBlock = lines.slice(pwIdx, pwNext).join("\n");
    assert.match(pwBlock, /if:\s*github\.event_name != 'repository_dispatch'/, "浏览器安装应随 e2e 一同跳过");
    // check / build / test:node 三个秒级门禁**不得**带事件豁免——它们对真实数据变化仍有意义。
    for (const [label, idx] of [["Check types", checkIdx], ["Build with fixtures", fixtureBuildIdx], ["Unit + artifact tests", unitIdx]] as const) {
      const next = lines.findIndex((line, i) => i > idx && /^\s+- name: /.test(line));
      const block = lines.slice(idx, next).join("\n");
      assert.doesNotMatch(block, /if:\s*/, `${label} 不得带事件豁免条件`);
    }
  });

  it("快照 CLI 损坏即拒绝：build-snapshot.ts 调用 verifyManifest，失败退出 1", () => {
    const cli = readRepoFile("scripts/build-snapshot.ts");
    assert.match(cli, /verifyManifest/, "必须做三文件摘要校验（MVP-Q13 停写语义）");
    assert.match(cli, /process\.exit\(1\)/, "校验失败必须非零退出");
    assert.match(cli, /buildPublicSnapshot/, "必须复用管线同一快照生成函数");
    // 只读边界：CLI 不得 import 抓取模块、不得写 data 目录。
    assert.doesNotMatch(
      cli,
      /from "[^"]*(source-fetch|feed-parse|baidu-source)/,
      "快照 CLI 不得引入抓取模块",
    );
    assert.doesNotMatch(cli, /writeFileSync\([^)]*dataDir/, "不得写入 data 目录");
  });

  it("快照时间基准锁定为 state.stateTakenAt：构建期禁用墙钟（同一 data 提交必须产出同一快照）", () => {
    const cli = readRepoFile("scripts/build-snapshot.ts");
    // 裁定（MVP-Q21 构建确定性）：窗口基准取权威状态时刻 state.stateTakenAt，
    // 不取构建墙钟。终审 Important 2：换基准会让同一份数据在 60 条与 0 条之间跳变
    // （实测基准敏感性），行为本身当前正确，缺的是把裁定锁进测试防误改。
    assert.match(
      cli,
      /buildPublicSnapshot\(\s*state\s*,\s*items\s*,\s*state\.stateTakenAt\s*\)/,
      "快照基准必须是 state.stateTakenAt（权威状态时刻），不得改为构建墙钟",
    );
    assert.doesNotMatch(
      cli,
      /Date\.now\(\)|new Date\(/,
      "构建期不得引入墙钟时间：会使同一 data 提交在不同时间构建出不同快照",
    );
  });
});
