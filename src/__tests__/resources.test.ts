import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChiaRpcClient } from "../rpc.js";
import { NETWORK_CONFIGS } from "../types.js";

/**
 * Offline tests for MCP resources.
 * Mocks fetch to simulate blockchain_state responses.
 */
describe("resources (off-chain)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CHIA_NETWORK;
    delete process.env.CHIA_FULL_NODE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("can fetch mainnet blockchain state via callOnNetwork", async () => {
    const mockState = {
      success: true,
      blockchain_state: {
        peak: { height: 5000000 },
        sync: { synced: true, sync_mode: false },
        difficulty: 2816,
        mempool_size: 10,
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockState),
    }));

    const client = new ChiaRpcClient();
    const result: any = await client.callOnNetwork("mainnet", "get_blockchain_state");

    expect(result.success).toBe(true);
    expect(result.blockchain_state.peak.height).toBe(5000000);
  });

  it("can fetch testnet11 blockchain state via callOnNetwork", async () => {
    const mockState = {
      success: true,
      blockchain_state: {
        peak: { height: 100000 },
        sync: { synced: true, sync_mode: false },
        difficulty: 512,
        mempool_size: 0,
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockState),
    }));

    const client = new ChiaRpcClient();
    const result: any = await client.callOnNetwork("testnet11", "get_blockchain_state");

    expect(result.success).toBe(true);
    expect(result.blockchain_state.peak.height).toBe(100000);
  });

  it("callOnNetwork uses correct URL for mainnet", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ChiaRpcClient();
    await client.callOnNetwork("mainnet", "get_blockchain_state");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coinset.org/get_blockchain_state",
      expect.any(Object)
    );
  });

  it("callOnNetwork uses correct URL for testnet11", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ChiaRpcClient();
    await client.callOnNetwork("testnet11", "get_blockchain_state");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://testnet11.api.coinset.org/get_blockchain_state",
      expect.any(Object)
    );
  });

  it("handles RPC error in callOnNetwork gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ success: false, error: "node not synced" }),
    }));

    const client = new ChiaRpcClient();
    await expect(
      client.callOnNetwork("mainnet", "get_blockchain_state")
    ).rejects.toThrow("node not synced");
  });

  it("handles network error in callOnNetwork", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")));

    const client = new ChiaRpcClient();
    await expect(
      client.callOnNetwork("testnet11", "get_blockchain_state")
    ).rejects.toThrow("Network error calling get_blockchain_state on testnet11");
  });

  it("resource data structure matches expected shape", async () => {
    const mockState = {
      success: true,
      blockchain_state: {
        peak: { height: 1000 },
        sync: { synced: true },
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockState),
    }));

    const client = new ChiaRpcClient();

    // Simulate what registerResources does for each network
    for (const network of ["mainnet", "testnet11"] as const) {
      const config = NETWORK_CONFIGS[network];
      let state: unknown = null;
      try {
        state = await client.callOnNetwork(network, "get_blockchain_state");
      } catch (err) {
        state = { error: err instanceof Error ? err.message : "Failed" };
      }

      const resource = {
        network: config.name,
        rpc_url: config.url,
        address_prefix: config.prefix,
        blockchain_state: state,
      };

      expect(resource.network).toBe(network);
      expect(resource.rpc_url).toMatch(/^https:\/\//);
      expect(resource.address_prefix).toBe(network === "mainnet" ? "xch" : "txch");
      expect(resource.blockchain_state).toBeDefined();

      const json = JSON.stringify(resource, null, 2);
      expect(json).toBeTruthy();
      const parsed = JSON.parse(json);
      expect(parsed.network).toBe(network);
    }
  });
});
