/**
 * 64 位小写十六进制稳定 ID 形态（领域契约的客户端安全子集）。
 *
 * 独立成模块的原因：契约模块（domain/contract.ts）顶层依赖 node:crypto，
 * 客户端模块图不得触碰——silk.ts 等客户端代码从这里导入 HEX64，
 * contract.ts 转引自此处并保持既有公开 API（re-export）不变。
 */
export const HEX64 = /^[0-9a-f]{64}$/;
