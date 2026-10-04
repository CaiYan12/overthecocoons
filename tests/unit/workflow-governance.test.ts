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

  it("触发：push main + push data + workflow_dispatch；不响应 pull_request", () => {
    assert.match(yaml, /^ {6}- main\s*$/m, "push 触发须含 main");
    assert.match(yaml, /^ {6}- data\s*$/m, "push 触发须含 data（每日更新成功后自动重建发布）");
    assert.match(yaml, /^ {2}workflow_dispatch:\s*$/m, "必须支持手动触发");
    assert.doesNotMatch(yaml, /^ {2}pull_request:\s*$/m, "不得由 PR 触发");
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

  it("部署链：官方 upload-pages-artifact + deploy-pages 固定版本；deploy 依赖 build 成功", () => {
    assert.match(yaml, /actions\/upload-pages-artifact@v5\.0\.0/);
    assert.match(yaml, /actions\/deploy-pages@v5\.0\.1/);
    assert.match(yaml, /^ {10}path:\s*dist\s*$/m, "上传产物为 dist");
    assert.match(yaml, /needs:\s*build\s*$/m, "deploy 必须依赖 build 成功");
    assert.match(yaml, /name:\s*github-pages\s*$/m, "部署进入 github-pages 环境");
  });

  it("版本 pin 与 T07 一致：checkout/setup-node/pnpm 固定版本，锁定可复核", () => {
    assert.match(yaml, /actions\/checkout@v7\.0\.1/);
    assert.match(yaml, /actions\/setup-node@v7\.0\.0/);
    assert.match(yaml, /pnpm\/action-setup@v6\.1\.0/);
    assert.match(yaml, /pnpm install --frozen-lockfile/, "依赖严格按锁文件");
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
});
