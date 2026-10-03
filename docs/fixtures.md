# 演示数据（fixture）机制

本页说明本仓库演示数据的存放位置、注入方式与标注约定。该机制是后续工单（数据管线、渲染、构建产物断言）共同的测试缝。

## 存放位置

- `fixtures/`（仓库根目录）：**演示数据目录**，存放合成数据，禁止冒充真实新闻。所有演示条目标题以 `【演示】` 开头。
- 当前唯一文件：`fixtures/snapshot.json` —— 合成演示快照，字段结构见下。

## 快照结构（Ticket 01 最小版本）

```json
{
  "schemaVersion": 1,
  "isFixture": true,
  "generatedAt": "ISO 8601 时间",
  "entries": [
    {
      "id": "稳定标识",
      "title": "标题",
      "summary": "摘要",
      "topic": "主题",
      "firstSeenAt": "首次收录时间（ISO 8601）",
      "url": "目标链接"
    }
  ]
}
```

- `isFixture: true` 是演示数据标记：页面据此渲染“演示数据”提示框。真实管线生成的快照该值为 `false`，页面不得再标演示。
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

- `tests/unit/snapshot.test.ts`：默认路径加载、`SNAPSHOT_PATH` 注入、缺失/非法 JSON/缺字段报错。
- `tests/e2e/smoke.spec.ts`：页面含“演示数据”标注、无 `<script>`、基路径资源可达、320/1440px 不破版。
