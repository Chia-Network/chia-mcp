/**
 * MCP resource definitions for Chia network info and guides.
 *
 * The chia://guide/* resources below are CONDENSED rewrites of the full markdown
 * files in chia-for-agents/resources/. They are the canonical source for embedded
 * guide content — there is no code generator. When the source docs change
 * significantly, update these template literals to match.
 *
 * Source files:
 *   - chia://guide/coin-model  ← chia-for-agents/resources/coin-model.md
 *   - chia://guide/rpc-quickstart ← chia-for-agents/resources/rpc-quickstart.md
 *   - chia://guide/recipes ← chia-for-agents/AGENTS.md (recipe table)
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChiaRpcClient } from "./rpc.js";
export declare function registerResources(server: McpServer, rpc: ChiaRpcClient): void;
//# sourceMappingURL=resources.d.ts.map