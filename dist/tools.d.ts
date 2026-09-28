/**
 * MCP tool definitions and handlers for Chia full node RPCs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChiaRpcClient } from "./rpc.js";
export declare function formatResponse(data: unknown, hint?: string): string;
export declare function wrapResponse(data: unknown, rpc: ChiaRpcClient, hint?: string): string;
export declare const CONDITION_OPCODES: Record<string, string>;
/**
 * Decode a CLVM big-endian minimal-bytes hex value to a decimal string.
 * CLVM encodes integers as big-endian two's complement with minimal bytes.
 * An empty value (0x or empty string) is 0.
 */
export declare function decodeCLVMInt(hex: string): string;
/**
 * Encode a mojo amount as big-endian minimal two's-complement bytes (CLVM convention).
 */
export declare function amountToBytes(amount: bigint): Buffer;
/**
 * Compute a Chia coin ID: SHA256(parent_coin_id || puzzle_hash || amount_bytes).
 * Both parent_coin_id and puzzle_hash should be 0x-prefixed hex strings.
 */
export declare function computeCoinId(parentHex: string, puzzleHashHex: string, amount: bigint): string;
export declare function registerTools(server: McpServer, rpc: ChiaRpcClient): void;
export declare function createServer(rpc: ChiaRpcClient): McpServer;
//# sourceMappingURL=tools.d.ts.map