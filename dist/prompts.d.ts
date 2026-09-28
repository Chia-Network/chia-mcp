/**
 * MCP prompt definitions for chia-mcp.
 *
 * Each prompt encodes tool sequencing plus failure modes for common Chia tasks.
 * These are the highest-value channel for getting correct behavior into agents
 * at decision time.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerPrompts(server: McpServer): void;
//# sourceMappingURL=prompts.d.ts.map