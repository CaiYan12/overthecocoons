# 演示数据（fixture）机制

本页说明本仓库演示数据的存放位置、注入方式与标注约定。该机制是后续工单（数据管线、渲染、构建产物断言）共同的测试缝。

## 存放位置

- `fixtures/`（仓库根目录）：**演示数据目录**，存放合成数据，禁止冒充真实新闻。所有演示条目标题以 `【演示】` 开头。
- 当前唯一文件：`fixtures/snapshot.json` —— 合成演示快照，字段结构见下。

## 快照结构（Ticket 02 演进版）

公开快照类型与 `src/domain/contract.ts` 的 `PublicSnapshot` 对齐；时间字段语义（原始时间/收录时间/尝试时间/成功获取时间/快照时间分字段）见该文件头注。

```json
{
  "schemaVersion": 1,
  "isFixture": true,
  "generatedAt": "ISO 8601 快照时间基准",
  "entries": [
    {
      "id": "稳定标识",
      "title": "标题",
      "summary": "摘要",
      "topic": "主题",
      "firstSeenAt": "首次收录时间（ISO 8601）",
      "url": "目标链接"
    }
  ],
  "quarantined": [
    {
      "guid": "原始 GUID 或 null（缺失身份时不兜底造身份）",
      "originalTitle": "原始标题",
      "targetUrl": "目标链接",
      "reasonCategory": "身份冲突｜缺 GUID｜字段校验失败｜协议不合法",
      "quarantinedAt": "隔离时间（ISO 8601）"
    }
  ],
  "sources": [
    {
      "sourceId": "来源 ID",
      "lastAttemptedAt": "尝试时间",
      "lastSucceededAt": "成功获取时间或 null",
      "lastFailureAt": "最近失败时间或 null",
      "lastFailureReason": "最近失败原因或 null"
    }
  ]
}
```

- `isFixture: true` 是演示数据标记：页面据此渲染“演示数据”提示框。真实管线生成的快照该值为 `false`，页面不得再标演示。
- `quarantined` 是隔离条目公开列表（MVP-Q20/Q22 四字段：原始标题、目标链接、隔离原因类别、隔离时间；另附台账已核实的 `guid` 身份依据），随 7 天公开窗口滚动，由 `src/domain/ingestion.ts` 生成。
- `sources` 是公开来源状态：尝试/成功/失败时间分字段记录，不混称“更新成功”。
- 三文件权威契约（state.json / items.json / manifest.json）与合并规则定义在 `src/domain/contract.ts` 与 `src/domain/ingestion.ts`（MVP-Q16）；公开快照仅是其窗口内只读视图。
- 后续工单扩展字段时在此文件与 `src/lib/snapshot.ts` 的校验同步演进，并在本节更新说明。

## 注入方式

- 构建期由 `src/lib/snapshot.ts` 的 `loadSnapshot()` 读取快照：
  - 默认读 `fixtures/snapshot.json`（相对项目根解析）。
  - 设置环境变量 `SNAPSHOT_PATH`（绝对路径，或相对项目根路径）可注入其他快照文件。
- 该模块仅在构建期（Node 环境）执行，不进入浏览器产物；页面本身不发起任何数据请求。
- 文件缺失、JSON 非法或缺少必需字段时构建直接失败，不静默造数据（`tests/unit/snapshot.test.ts` 覆盖）。

## 用法示例

```bash
# 默认演示数据构建
pnpm build

# 注入自定义快照构建（PowerShell）
$env:SNAPSHOT_PATH = "path/to/snapshot.json"; pnpm build
```

## 测试覆盖

- `tests/unit/snapshot.test.ts`：默认路径加载、`SNAPSHOT_PATH` 注入、缺失/非法 JSON/缺字段（含 `quarantined`/`sources`）报错。
- `tests/unit/identity.test.ts`：稳定 ID 规则（64 位 hex、大小写敏感、来源区分、分隔符防注入）。
- `tests/unit/ingestion.test.ts`：五类身份场景、7 天窗口、失败降级、停写语义、公开内容版本。
- `tests/e2e/smoke.spec.ts`：页面含“演示数据”标注、无 `<script>`、基路径资源可达、320/1440px 不破版。
