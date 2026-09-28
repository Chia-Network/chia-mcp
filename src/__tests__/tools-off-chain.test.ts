import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChiaRpcClient } from "../rpc.js";

/**
 * Off-chain tests for all 34 MCP tools via mocked fetch.
 * Tests the RPC client layer with mock responses matching each tool's RPC method.
 */

// Helper to create a mock fetch that returns a successful JSON response
function mockFetchSuccess(data: Record<string, unknown>) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    text: async () => JSON.stringify({ success: true, ...data }),
  });
}

// Helper to create a mock fetch that returns an RPC error
function mockFetchRpcError(error: string) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    text: async () => JSON.stringify({ success: false, error }),
  });
}

const VALID_HASH = "0x" + "ab".repeat(32);
const VALID_HASH2 = "0x" + "cd".repeat(32);

describe("tools-off-chain (mocked RPC)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CHIA_NETWORK;
    delete process.env.CHIA_FULL_NODE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ─── Blockchain state ───

  describe("get_blockchain_state", () => {
    it("returns blockchain state", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        blockchain_state: { peak: { height: 100 }, sync: { synced: true } },
      }));
      const client = new ChiaRpcClient();
      const result = await client.call("get_blockchain_state");
      expect(result).toHaveProperty("blockchain_state");
    });

    it("handles RPC error", async () => {
      vi.stubGlobal("fetch", mockFetchRpcError("node not synced"));
      const client = new ChiaRpcClient();
      await expect(client.call("get_blockchain_state")).rejects.toThrow("node not synced");
    });
  });

  describe("get_network_info", () => {
    it("returns network info", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        network_name: "mainnet", network_prefix: "xch",
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_network_info");
      expect(result.network_name).toBe("mainnet");
    });
  });

  describe("get_routes", () => {
    it("returns array of routes", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        routes: ["/get_blockchain_state", "/get_block"],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_routes");
      expect(result.routes).toBeInstanceOf(Array);
    });
  });

  describe("get_block_count_metrics", () => {
    it("returns metrics", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        metrics: { compact_blocks: 100, uncompact_blocks: 50 },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block_count_metrics");
      expect(result.metrics).toBeDefined();
    });
  });

  // ─── Blocks ───

  describe("get_block", () => {
    it("returns a full block", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        block: { header_hash: VALID_HASH, height: 1 },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block", { header_hash: VALID_HASH });
      expect(result.block).toBeDefined();
    });

    it("returns data normally for not-found error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: false, error: "block not found", structuredError: { code: "BLOCK_NOT_FOUND" } }),
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block", { header_hash: VALID_HASH });
      expect(result.success).toBe(false);
      expect(result.error).toBe("block not found");
    });
  });

  describe("get_block_record", () => {
    it("returns block record", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        block_record: { header_hash: VALID_HASH, height: 5 },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block_record", { header_hash: VALID_HASH });
      expect(result.block_record).toBeDefined();
    });
  });

  describe("get_block_record_by_height", () => {
    it("returns block record at height", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        block_record: { height: 1, header_hash: VALID_HASH },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block_record_by_height", { height: 1 });
      expect(result.block_record.height).toBe(1);
    });
  });

  describe("get_block_records", () => {
    it("returns block records for range", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        block_records: [{ height: 1 }, { height: 2 }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block_records", { start: 1, end: 3 });
      expect(result.block_records).toHaveLength(2);
    });
  });

  describe("get_blocks", () => {
    it("returns full blocks for range", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        blocks: [{ height: 1, transactions_generator: null }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_blocks", { start: 1, end: 2 });
      expect(result.blocks).toHaveLength(1);
    });
  });

  describe("get_additions_and_removals", () => {
    it("returns additions and removals", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        additions: [{ coin: { amount: 100 } }],
        removals: [],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_additions_and_removals", { header_hash: VALID_HASH });
      expect(result.additions).toBeInstanceOf(Array);
      expect(result.removals).toBeInstanceOf(Array);
    });
  });

  describe("get_block_spends", () => {
    it("returns block spends", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        block_spends: [{ coin_id: VALID_HASH }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block_spends", { header_hash: VALID_HASH });
      expect(result.block_spends).toBeDefined();
    });
  });

  describe("get_block_spends_with_conditions", () => {
    it("returns spends with conditions", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        block_spends_with_conditions: [{ coin_id: VALID_HASH, conditions: [] }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_block_spends_with_conditions", { header_hash: VALID_HASH });
      expect(result.block_spends_with_conditions).toBeDefined();
    });
  });

  describe("get_unfinished_block_headers", () => {
    it("returns headers (possibly empty)", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        headers: [],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_unfinished_block_headers");
      expect(result.headers).toBeInstanceOf(Array);
    });
  });

  describe("get_network_space", () => {
    it("returns network space estimate", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        space: 36000000000000000000,
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_network_space", {
        newer_block_header_hash: VALID_HASH,
        older_block_header_hash: VALID_HASH2,
      });
      // Large uint64 values are returned as strings to prevent precision loss
      expect(typeof result.space === "string" || typeof result.space === "number").toBe(true);
      expect(BigInt(result.space) > 0n).toBe(true);
    });
  });

  // ─── Coins ───

  describe("get_coin_record_by_name", () => {
    it("returns coin record", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_record: {
          coin: { parent_coin_info: VALID_HASH, puzzle_hash: VALID_HASH, amount: 100 },
          confirmed_block_index: 5,
          spent: false,
        },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_record_by_name", { name: VALID_HASH });
      expect(result.coin_record.coin.amount).toBe("100");
    });

    it("returns data normally for coin not found", async () => {
      vi.stubGlobal("fetch", mockFetchRpcError("coin record not found"));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_record_by_name", { name: VALID_HASH });
      expect(result.success).toBe(false);
      expect(result.error).toBe("coin record not found");
    });
  });

  describe("get_coin_records_by_names", () => {
    it("returns multiple coin records", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_records: [
          { coin: { amount: 100 } },
          { coin: { amount: 200 } },
        ],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_records_by_names", {
        names: [VALID_HASH, VALID_HASH2],
      });
      expect(result.coin_records).toHaveLength(2);
    });
  });

  describe("get_coin_records_by_puzzle_hash", () => {
    it("returns coins for puzzle hash", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_records: [{ coin: { amount: 1000 } }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_records_by_puzzle_hash", {
        puzzle_hash: VALID_HASH,
        include_spent_coins: true,
      });
      expect(result.coin_records).toHaveLength(1);
    });
  });

  describe("get_coin_records_by_puzzle_hashes", () => {
    it("returns coins for multiple puzzle hashes", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_records: [{ coin: { amount: 500 } }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_records_by_puzzle_hashes", {
        puzzle_hashes: [VALID_HASH],
      });
      expect(result.coin_records).toBeDefined();
    });
  });

  describe("get_coin_records_by_hint", () => {
    it("returns coins by hint", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_records: [],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_records_by_hint", {
        hint: VALID_HASH,
      });
      expect(result.coin_records).toBeInstanceOf(Array);
    });
  });

  describe("get_coin_records_by_hints", () => {
    it("returns coins by multiple hints", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_records: [],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_records_by_hints", {
        hints: [VALID_HASH],
      });
      expect(result.coin_records).toBeInstanceOf(Array);
    });
  });

  describe("get_coin_records_by_parent_ids", () => {
    it("returns coins by parent IDs", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_records: [{ coin: { parent_coin_info: VALID_HASH } }],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_records_by_parent_ids", {
        parent_ids: [VALID_HASH],
      });
      expect(result.coin_records).toHaveLength(1);
    });
  });

  describe("get_puzzle_and_solution", () => {
    it("returns puzzle and solution", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_solution: {
          coin: { parent_coin_info: VALID_HASH },
          puzzle_reveal: "0xff01",
          solution: "0x80",
        },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_puzzle_and_solution", {
        coin_id: VALID_HASH,
        height: 100,
      });
      expect(result.coin_solution).toBeDefined();
    });

    it("handles error for unspent coin", async () => {
      vi.stubGlobal("fetch", mockFetchRpcError("coin not spent"));
      const client = new ChiaRpcClient();
      await expect(client.call("get_puzzle_and_solution", {
        coin_id: VALID_HASH, height: 100,
      })).rejects.toThrow("coin not spent");
    });
  });

  describe("get_puzzle_and_solution_with_conditions", () => {
    it("returns puzzle, solution, and conditions", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        coin_solution: {
          coin: { parent_coin_info: VALID_HASH },
          puzzle_reveal: "0xff01",
          solution: "0x80",
          conditions: [],
        },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_puzzle_and_solution_with_conditions", {
        coin_id: VALID_HASH,
        height: 100,
      });
      expect(result.coin_solution).toBeDefined();
    });
  });

  describe("get_memos_by_coin_name", () => {
    it("returns memos", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        memos: { [VALID_HASH]: [["0xaabb"]] },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_memos_by_coin_name", {
        coin_name: VALID_HASH,
      });
      expect(result.memos).toBeDefined();
    });
  });

  // ─── Mempool ───

  describe("get_all_mempool_tx_ids", () => {
    it("returns tx IDs array", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        tx_ids: [VALID_HASH, VALID_HASH2],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_all_mempool_tx_ids");
      expect(result.tx_ids).toHaveLength(2);
    });
  });

  describe("get_all_mempool_items", () => {
    it("returns mempool items", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        mempool_items: {},
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_all_mempool_items");
      expect(result.mempool_items).toBeDefined();
    });
  });

  describe("get_mempool_item_by_tx_id", () => {
    it("returns mempool item", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        mempool_item: {
          spend_bundle: {},
          fee: 1000,
          cost: 5000000,
        },
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_mempool_item_by_tx_id", {
        tx_id: VALID_HASH,
      });
      expect(result.mempool_item.fee).toBe("1000");
    });

    it("returns data normally for tx not in mempool", async () => {
      vi.stubGlobal("fetch", mockFetchRpcError("tx not in mempool"));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_mempool_item_by_tx_id", {
        tx_id: VALID_HASH,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("tx not in mempool");
    });
  });

  describe("get_mempool_items_by_coin_name", () => {
    it("returns mempool items for coin", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        mempool_items: [],
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_mempool_items_by_coin_name", {
        coin_name: VALID_HASH,
      });
      expect(result.mempool_items).toBeDefined();
    });
  });

  describe("get_fee_estimate", () => {
    it("returns fee estimates for target times", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        estimates: [0, 0, 0],
        target_times: [60, 300, 600],
        current_fee_rate: 0,
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_fee_estimate", {
        target_times: [60, 300, 600],
      });
      expect(result.estimates).toHaveLength(3);
    });
  });

  describe("get_aggsig_additional_data", () => {
    it("returns aggsig data", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        additional_data: "0xccd5bb71183532bff220ba46c268991a3ff07eb358e8255a65c30a2dce0e5fbb",
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("get_aggsig_additional_data");
      expect(result.additional_data).toBeDefined();
    });
  });

  // ─── Transactions ───

  describe("push_tx", () => {
    it("returns success on valid spend bundle", async () => {
      vi.stubGlobal("fetch", mockFetchSuccess({
        status: "SUCCESS",
      }));
      const client = new ChiaRpcClient();
      const result: any = await client.call("push_tx", {
        spend_bundle: { coin_spends: [], aggregated_signature: "0x" + "00".repeat(96) },
      });
      expect(result.status).toBe("SUCCESS");
    });

    it("handles INVALID_TRANSACTION error", async () => {
      vi.stubGlobal("fetch", mockFetchRpcError("INVALID_TRANSACTION"));
      const client = new ChiaRpcClient();
      await expect(client.call("push_tx", {
        spend_bundle: {},
      })).rejects.toThrow("INVALID_TRANSACTION");
    });
  });

  // ─── Utility tools (address_encode, address_decode, coin_id) ───
  // These are tested in bech32m.test.ts and coin-id.test.ts.
  // Here we verify the RPC layer doesn't break with the params these tools would use.

  describe("HTTP error handling across tools", () => {
    it("handles HTTP 429 rate limit", async () => {
      const mock429 = {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (_: string) => "0" },
        text: async () => "rate limited",
      };
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mock429)
      );
      const client = new ChiaRpcClient();
      await expect(client.call("get_blockchain_state")).rejects.toThrow("HTTP 429");
    });

    it("handles HTTP 404", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      }));
      const client = new ChiaRpcClient();
      await expect(client.call("nonexistent_method")).rejects.toThrow("HTTP 404");
    });
  });
});
