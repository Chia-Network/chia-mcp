/**
 * Response-shape contract tests.
 *
 * Verify that documented response keys actually exist in live responses.
 * These tests catch B3-class bugs where docs promise a field that doesn't exist.
 *
 * Run with: CHIA_NETWORK=testnet11 npm run test:on-chain
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TESTNET_URL = "https://testnet11.api.coinset.org";
const MAINNET_URL = "https://api.coinset.org";

const network = process.env.CHIA_NETWORK || "testnet11";
const BASE_URL = network === "mainnet" ? MAINNET_URL : TESTNET_URL;

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE_URL}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "chia-mcp-tests/1.0",
    },
    body: JSON.stringify(params),
  });
  return resp.json() as Promise<Record<string, unknown>>;
}

describe.skipIf(!process.env.CHIA_MCP_ON_CHAIN)("response shape contracts", () => {
  it("get_blockchain_state has expected top-level keys", async () => {
    const data = await rpc("get_blockchain_state");
    expect(data.success).toBe(true);
    const bs = data.blockchain_state as Record<string, unknown>;
    expect(bs).toBeDefined();
    expect(bs.peak).toBeDefined();
    expect(bs.sync).toBeDefined();
    expect(bs.difficulty).toBeDefined();
    expect(bs.mempool_size).toBeDefined();
  });

  it("get_coin_record_by_name returns success:false with error for nonexistent coin", async () => {
    const data = await rpc("get_coin_record_by_name", {
      name: "0x" + "ab".repeat(32),
    });
    // Documented shape: success: false, not {found: false}
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    // Should NOT have a "found" key
    expect(data).not.toHaveProperty("found");
  });

  it("get_mempool_item_by_tx_id returns success:false for nonexistent tx", async () => {
    const data = await rpc("get_mempool_item_by_tx_id", {
      tx_id: "0x" + "cd".repeat(32),
    });
    // Documented shape: success: false with structuredError, not {found: false}
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data).not.toHaveProperty("found");
  });

  it("get_fee_estimate returns expected fields", async () => {
    const data = await rpc("get_fee_estimate", {
      target_times: [60, 300],
      cost: 5000000,
    });
    expect(data.success).toBe(true);
    expect(data.estimates).toBeDefined();
    expect(data.target_times).toBeDefined();
    expect(data.current_fee_rate).toBeDefined();
    expect(typeof data.current_fee_rate).toBe("number");
  });

  it("get_block_record_by_height returns expected fields", async () => {
    const data = await rpc("get_block_record_by_height", { height: 1 });
    expect(data.success).toBe(true);
    const br = data.block_record as Record<string, unknown>;
    expect(br).toBeDefined();
    expect(br.header_hash).toBeDefined();
    expect(br.height).toBe(1);
    expect(br.farmer_puzzle_hash).toBeDefined();
  });

  it("get_network_info returns network name and prefix", async () => {
    const data = await rpc("get_network_info");
    expect(data.success).toBe(true);
    expect(data.network_name).toBeDefined();
    expect(data.network_prefix).toBeDefined();
  });
});
