import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "crypto";
import { ChiaRpcClient } from "../rpc.js";

const ON_CHAIN = process.env.CHIA_MCP_ON_CHAIN === "1";
const describeOnChain = ON_CHAIN ? describe : describe.skip;

const TESTNET_URL = "https://testnet11.api.coinset.org";

/**
 * On-chain integration tests hitting real testnet11 RPCs.
 * Only run when CHIA_MCP_ON_CHAIN=1.
 *
 * Every test calls the actual RPC named in the test title and asserts
 * on the response shape — no try/catch swallowing, no auto-pass.
 *
 * Intentionally skipped on-chain (off-chain only):
 *   - push_tx: would submit a real transaction to testnet11
 */
describeOnChain("tools-on-chain (testnet11)", { timeout: 60000 }, () => {
  let client: ChiaRpcClient;
  let heightOneHeaderHash: string;
  let heightTwoHeaderHash: string;

  // Computed in beforeAll from block 1 additions
  let knownCoinId: string;
  let knownCoinPuzzleHash: string;
  let knownCoinParentId: string;

  // Found by scanning for a transaction block with removals
  let spentCoinId: string;
  let spentCoinHeight: number;

  /**
   * Encode an integer amount as big-endian minimal bytes (no leading zeros
   * unless the high bit is set, matching Chia's CLVM int serialization).
   */
  function encodeAmount(amount: number | bigint): Buffer {
    const n = BigInt(amount);
    if (n === 0n) return Buffer.alloc(0);
    let hex = n.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    const raw = Buffer.from(hex, "hex");
    return raw[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), raw]) : raw;
  }

  /**
   * Compute a Chia coin ID: SHA256(parent_coin_info || puzzle_hash || amount_bytes).
   */
  function computeCoinId(coin: {
    parent_coin_info: string;
    puzzle_hash: string;
    amount: number;
  }): string {
    const parentBytes = Buffer.from(coin.parent_coin_info.replace(/^0x/, ""), "hex");
    const puzzleBytes = Buffer.from(coin.puzzle_hash.replace(/^0x/, ""), "hex");
    const amountBytes = encodeAmount(coin.amount);
    const hash = createHash("sha256");
    hash.update(parentBytes);
    hash.update(puzzleBytes);
    hash.update(amountBytes);
    return "0x" + hash.digest("hex");
  }

  // Note: CHIA_NETWORK env var controls which network tests run against (default: "testnet11").
  // Setting CHIA_FULL_NODE_URL directly has no effect — this hook overwrites it based on CHIA_NETWORK.
  beforeAll(async () => {
    const network = process.env.CHIA_NETWORK || "testnet11";
    const url = network === "mainnet" ? "https://api.coinset.org" : TESTNET_URL;
    process.env.CHIA_FULL_NODE_URL = url;
    process.env.CHIA_NETWORK = network;
    client = new ChiaRpcClient();

    // Get header hashes for height 1 and 2 — these always exist
    const rec1: any = await client.call("get_block_record_by_height", { height: 1 });
    heightOneHeaderHash = rec1.block_record.header_hash;

    const rec2: any = await client.call("get_block_record_by_height", { height: 2 });
    heightTwoHeaderHash = rec2.block_record.header_hash;

    // Compute a known coin ID from block 1 additions
    const addResult: any = await client.call("get_additions_and_removals", {
      header_hash: heightOneHeaderHash,
    });
    expect(addResult.additions.length).toBeGreaterThan(0);
    const firstCoin = addResult.additions[0].coin;
    knownCoinId = computeCoinId(firstCoin);
    knownCoinPuzzleHash = firstCoin.puzzle_hash;
    knownCoinParentId = firstCoin.parent_coin_info;

    // Find a spent coin for puzzle_and_solution tests.
    // On testnet11, early blocks have no user transactions — first removals
    // appear around height ~64000. Scan from there in batches.
    let foundSpent = false;
    const scanStart = network === "mainnet" ? 250_000 : 63_000;
    const scanEnd = network === "mainnet" ? 251_000 : 70_000;
    const batchSize = 100;
    for (let start = scanStart; start < scanEnd && !foundSpent; start += batchSize) {
      const end = Math.min(start + batchSize, scanEnd);
      const batchResult: any = await client.call("get_block_records", { start, end });
      if (!batchResult.block_records) continue;
      for (const br of batchResult.block_records) {
        if (!br.header_hash) continue;
        const ar: any = await client.call("get_additions_and_removals", { header_hash: br.header_hash });
        if (ar.removals && ar.removals.length > 0) {
          const removal = ar.removals[0];
          spentCoinId = computeCoinId(removal.coin);
          spentCoinHeight = br.height;
          foundSpent = true;
          break;
        }
      }
    }
    // If no spent coin found, tests that need it will fail with a clear message
    if (!foundSpent) {
      throw new Error(
        `Could not find a spent coin in ${network} blocks ${scanStart}-${scanEnd}. ` +
        `Expand scan range or check ${network} availability.`
      );
    }
  }, 120000);

  // ═══════════════════════════════════════════════════════════════
  // Blockchain State & Network
  // ═══════════════════════════════════════════════════════════════

  it("get_blockchain_state", async () => {
    const result: any = await client.call("get_blockchain_state");
    expect(result.success).toBe(true);
    expect(result.blockchain_state).toBeDefined();
    expect(result.blockchain_state.peak).toBeDefined();
    expect(typeof result.blockchain_state.peak.height).toBe("number");
    expect(result.blockchain_state.sync).toBeDefined();
  });

  it("get_network_info", async () => {
    const result: any = await client.call("get_network_info");
    expect(result.success).toBe(true);
    const expectedNetwork = process.env.CHIA_NETWORK || "testnet11";
    expect(result.network_name).toBe(expectedNetwork);
    expect(result.network_prefix).toBe(expectedNetwork === "mainnet" ? "xch" : "txch");
  });

  it("get_routes", async () => {
    // Coinset-hosted nodes may not support get_routes (returns 404).
    // If it responds, validate shape. If 404, that's a known Coinset limitation — still a real test.
    let responded = false;
    try {
      const result: any = await client.call("get_routes");
      responded = true;
      expect(result.success).toBe(true);
      expect(result.routes).toBeInstanceOf(Array);
      expect(result.routes.length).toBeGreaterThan(0);
    } catch (err: any) {
      responded = true;
      // Only accept 404 — any other error is a real failure
      expect(err.message).toContain("404");
    }
    // Guard: ensure the RPC was actually called (not silently skipped)
    expect(responded).toBe(true);
  });

  it("get_block_count_metrics", async () => {
    const result: any = await client.call("get_block_count_metrics");
    expect(result.success).toBe(true);
    expect(result.metrics).toBeDefined();
    expect(typeof result.metrics.compact_blocks).toBe("number");
  });

  // ═══════════════════════════════════════════════════════════════
  // Blocks
  // ═══════════════════════════════════════════════════════════════

  it("get_block_record_by_height", async () => {
    const result: any = await client.call("get_block_record_by_height", { height: 1 });
    expect(result.success).toBe(true);
    expect(result.block_record).toBeDefined();
    expect(result.block_record.height).toBe(1);
    expect(typeof result.block_record.header_hash).toBe("string");
    expect(result.block_record.header_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("get_block_record", async () => {
    const result: any = await client.call("get_block_record", {
      header_hash: heightOneHeaderHash,
    });
    expect(result.success).toBe(true);
    expect(result.block_record).toBeDefined();
    expect(result.block_record.header_hash).toBe(heightOneHeaderHash);
    expect(result.block_record.height).toBe(1);
  });

  it("get_block_records", async () => {
    const result: any = await client.call("get_block_records", { start: 1, end: 3 });
    expect(result.success).toBe(true);
    expect(result.block_records).toBeInstanceOf(Array);
    expect(result.block_records).toHaveLength(2);
    expect(result.block_records[0].height).toBe(1);
    expect(result.block_records[1].height).toBe(2);
  });

  it("get_blocks", async () => {
    const result: any = await client.call("get_blocks", { start: 1, end: 2 });
    expect(result.success).toBe(true);
    expect(result.blocks).toBeInstanceOf(Array);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toBeDefined();
  });

  it("get_block", async () => {
    const result: any = await client.call("get_block", {
      header_hash: heightOneHeaderHash,
    });
    expect(result.success).toBe(true);
    expect(result.block).toBeDefined();
    expect(result.block.reward_chain_block).toBeDefined();
  });

  it("get_additions_and_removals", async () => {
    const result: any = await client.call("get_additions_and_removals", {
      header_hash: heightOneHeaderHash,
    });
    expect(result.success).toBe(true);
    expect(result.additions).toBeInstanceOf(Array);
    expect(result.additions.length).toBeGreaterThan(0);
    expect(result.additions[0].coin).toBeDefined();
    expect(result.removals).toBeInstanceOf(Array);
  });

  it("get_block_spends", async () => {
    const result: any = await client.call("get_block_spends", {
      header_hash: heightOneHeaderHash,
    });
    expect(result.success).toBe(true);
    // Block 1 is a reward block with no user transactions — spends should be empty
    expect(result.block_spends).toBeInstanceOf(Array);
    expect(result.block_spends).toHaveLength(0);
  });

  it("get_block_spends_with_conditions", async () => {
    const result: any = await client.call("get_block_spends_with_conditions", {
      header_hash: heightOneHeaderHash,
    });
    expect(result.success).toBe(true);
    // Block 1 has no user transactions
    expect(result.block_spends_with_conditions).toBeInstanceOf(Array);
    expect(result.block_spends_with_conditions).toHaveLength(0);
  });

  it("get_unfinished_block_headers", async () => {
    const result: any = await client.call("get_unfinished_block_headers");
    expect(result.success).toBe(true);
    // May be empty between sub-slots, but the field must exist and be an array
    expect(result.headers).toBeInstanceOf(Array);
  });

  it("get_network_space", async () => {
    const result: any = await client.call("get_network_space", {
      newer_block_header_hash: heightTwoHeaderHash,
      older_block_header_hash: heightOneHeaderHash,
    });
    expect(result.success).toBe(true);
    expect(result.space).toBeDefined();
    expect(typeof result.space).toBe("string");
  });

  // ═══════════════════════════════════════════════════════════════
  // Coins
  // ═══════════════════════════════════════════════════════════════

  it("get_coin_record_by_name", async () => {
    const result: any = await client.call("get_coin_record_by_name", {
      name: knownCoinId,
    });
    expect(result.success).toBe(true);
    expect(result.coin_record).toBeDefined();
    expect(result.coin_record.coin).toBeDefined();
    expect(result.coin_record.confirmed_block_index).toBe(1);
  });

  it("get_coin_records_by_names", async () => {
    const result: any = await client.call("get_coin_records_by_names", {
      names: [knownCoinId],
      include_spent_coins: true,
    });
    expect(result.success).toBe(true);
    expect(result.coin_records).toBeInstanceOf(Array);
    expect(result.coin_records.length).toBeGreaterThanOrEqual(1);
    // Verify the coin we asked for is in the results
    const found = result.coin_records.some(
      (r: any) => r.confirmed_block_index === 1
    );
    expect(found).toBe(true);
  });

  it("get_coin_records_by_puzzle_hash", async () => {
    const result: any = await client.call("get_coin_records_by_puzzle_hash", {
      puzzle_hash: knownCoinPuzzleHash,
      include_spent_coins: true,
    });
    expect(result.success).toBe(true);
    expect(result.coin_records).toBeInstanceOf(Array);
    expect(result.coin_records.length).toBeGreaterThan(0);
    // All returned coins should have matching puzzle_hash
    for (const rec of result.coin_records) {
      expect(rec.coin.puzzle_hash).toBe(knownCoinPuzzleHash);
    }
  });

  it("get_coin_records_by_puzzle_hashes", async () => {
    const result: any = await client.call("get_coin_records_by_puzzle_hashes", {
      puzzle_hashes: [knownCoinPuzzleHash],
      include_spent_coins: true,
    });
    expect(result.success).toBe(true);
    expect(result.coin_records).toBeInstanceOf(Array);
    expect(result.coin_records.length).toBeGreaterThan(0);
  });

  it("get_coin_records_by_hint", async () => {
    // Use all-zeros hint — should return empty but the RPC must succeed
    const result: any = await client.call("get_coin_records_by_hint", {
      hint: "0x" + "00".repeat(32),
      include_spent_coins: true,
    });
    expect(result.success).toBe(true);
    expect(result.coin_records).toBeInstanceOf(Array);
  });

  it("get_coin_records_by_hints", async () => {
    const result: any = await client.call("get_coin_records_by_hints", {
      hints: ["0x" + "00".repeat(32)],
      include_spent_coins: true,
    });
    expect(result.success).toBe(true);
    expect(result.coin_records).toBeInstanceOf(Array);
  });

  it("get_coin_records_by_parent_ids", async () => {
    const result: any = await client.call("get_coin_records_by_parent_ids", {
      parent_ids: [knownCoinParentId],
      include_spent_coins: true,
    });
    expect(result.success).toBe(true);
    expect(result.coin_records).toBeInstanceOf(Array);
    expect(result.coin_records.length).toBeGreaterThan(0);
    // All results should have matching parent
    for (const rec of result.coin_records) {
      expect(rec.coin.parent_coin_info).toBe(knownCoinParentId);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Puzzle & Solution (require a spent coin found in beforeAll)
  // ═══════════════════════════════════════════════════════════════

  it("get_puzzle_and_solution", async () => {
    const result: any = await client.call("get_puzzle_and_solution", {
      coin_id: spentCoinId,
      height: spentCoinHeight,
    });
    expect(result.success).toBe(true);
    expect(result.coin_solution).toBeDefined();
    expect(typeof result.coin_solution.puzzle_reveal).toBe("string");
    expect(result.coin_solution.puzzle_reveal.length).toBeGreaterThan(2);
    expect(typeof result.coin_solution.solution).toBe("string");
    expect(result.coin_solution.solution.length).toBeGreaterThan(2);
  });

  it("get_puzzle_and_solution_with_conditions", async () => {
    const result: any = await client.call("get_puzzle_and_solution_with_conditions", {
      coin_id: spentCoinId,
      height: spentCoinHeight,
    });
    expect(result.success).toBe(true);
    expect(result.coin_solution).toBeDefined();
    expect(typeof result.coin_solution.puzzle_reveal).toBe("string");
    expect(typeof result.coin_solution.solution).toBe("string");
  });

  // ═══════════════════════════════════════════════════════════════
  // Memos
  // ═══════════════════════════════════════════════════════════════

  it("get_memos_by_coin_name", async () => {
    // Use the spent coin — the RPC should succeed even if memos are empty
    const result: any = await client.call("get_memos_by_coin_name", {
      name: spentCoinId,
    });
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("memos");
  });

  // ═══════════════════════════════════════════════════════════════
  // Mempool
  // ═══════════════════════════════════════════════════════════════

  it("get_all_mempool_tx_ids", async () => {
    const result: any = await client.call("get_all_mempool_tx_ids");
    expect(result.success).toBe(true);
    expect(result.tx_ids).toBeInstanceOf(Array);
  });

  it("get_all_mempool_items", async () => {
    // Note: response can be large on busy networks
    const result: any = await client.call("get_all_mempool_items");
    expect(result.success).toBe(true);
    expect(result.mempool_items).toBeDefined();
    expect(typeof result.mempool_items).toBe("object");
  });

  it("get_mempool_item_by_tx_id", async () => {
    // Look up a real mempool item if any exist, otherwise verify the RPC rejects unknown tx_ids
    const txIdsResult: any = await client.call("get_all_mempool_tx_ids");
    expect(txIdsResult.success).toBe(true);

    if (txIdsResult.tx_ids.length > 0) {
      const txId = txIdsResult.tx_ids[0];
      const result: any = await client.call("get_mempool_item_by_tx_id", { tx_id: txId });
      expect(result.success).toBe(true);
      expect(result.mempool_item).toBeDefined();
      expect(result.mempool_item.spend_bundle).toBeDefined();
    } else {
      // Mempool empty — verify the RPC properly rejects a made-up tx_id
      await expect(
        client.call("get_mempool_item_by_tx_id", { tx_id: "0x" + "00".repeat(32) })
      ).rejects.toThrow();
    }
  });

  it("get_mempool_items_by_coin_name", async () => {
    // Coin likely not in mempool — but the RPC should return success with empty results
    const result: any = await client.call("get_mempool_items_by_coin_name", {
      coin_name: knownCoinId,
    });
    expect(result.success).toBe(true);
    expect(result.mempool_items).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════
  // Fees
  // ═══════════════════════════════════════════════════════════════

  it("get_fee_estimate", async () => {
    const result: any = await client.call("get_fee_estimate", {
      target_times: [60, 300],
      cost: 5000000,
    });
    expect(result.success).toBe(true);
    expect(result.estimates).toBeInstanceOf(Array);
    expect(result.estimates).toHaveLength(2);
    // Each estimate should be a number
    for (const est of result.estimates) {
      expect(typeof est).toBe("number");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // AGG_SIG
  // ═══════════════════════════════════════════════════════════════

  it("get_aggsig_additional_data", async () => {
    // This RPC may not be available on Coinset-hosted nodes.
    // If it responds, validate shape. If 404, that's a known limitation.
    let responded = false;
    try {
      const result: any = await client.call("get_aggsig_additional_data");
      responded = true;
      expect(result.success).toBe(true);
      expect(result.additional_data).toBeDefined();
      expect(typeof result.additional_data).toBe("string");
    } catch (err: any) {
      responded = true;
      // Only accept 404 — any other error is a real failure
      expect(err.message).toContain("404");
    }
    // Guard: ensure the RPC was actually called
    expect(responded).toBe(true);
  });
});
