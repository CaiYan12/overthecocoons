import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ID_SEPARATOR, stableId } from "../../src/domain/contract.ts";

/**
 * Ticket 02 验收：稳定 ID 为完整 64 位十六进制 SHA-256，
 * 摘要输入为“来源 ID + 分隔符 + 原始 GUID”（MVP-Q15）。
 */
describe("stableId（稳定身份 ID，MVP-Q15）", () => {
  it("输出完整 64 位小写十六进制，且等于来源 ID+分隔符+GUID 的 SHA-256", () => {
    const id = stableId("baidu-hot", "https://www.baidu.com/item?abc");
    assert.match(id, /^[0-9a-f]{64}$/, "稳定 ID 必须是 64 位小写十六进制");
    const manual = createHash("sha256")
      .update("baidu-hot" + ID_SEPARATOR + "https://www.baidu.com/item?abc")
      .digest("hex");
    assert.equal(id, manual);
  });

  it("确定性：同输入恒等同输出", () => {
    assert.equal(stableId("s", "g"), stableId("s", "g"));
  });

  it("GUID 大小写敏感：不归一化、不转小写", () => {
    assert.notEqual(stableId("s", "GUID-abc"), stableId("s", "guid-abc"));
  });

  it("不同来源 ID、相同 GUID 产生不同身份", () => {
    assert.notEqual(stableId("source-a", "g1"), stableId("source-b", "g1"));
  });

  it("同一来源、不同 GUID 产生不同身份", () => {
    assert.notEqual(stableId("source-a", "g1"), stableId("source-a", "g2"));
  });

  it("分隔符不得出现在任一侧：含分隔符的输入直接抛错（防摘要歧义）", () => {
    assert.throws(() => stableId(`a${ID_SEPARATOR}b`, "g"), /分隔符/);
    assert.throws(() => stableId("s", `g${ID_SEPARATOR}`), /分隔符/);
  });

  it("空来源 ID 或空 GUID 抛错", () => {
    assert.throws(() => stableId("", "g"));
    assert.throws(() => stableId("s", ""));
  });
});
