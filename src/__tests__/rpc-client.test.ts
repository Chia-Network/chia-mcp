import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChiaRpcClient } from "../rpc.js";

describe("ChiaRpcClient", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset env
    delete process.env.CHIA_NETWORK;
    delete process.env.CHIA_FULL_NODE_URL;
    // Mock global fetch
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("defaults to mainnet", () => {
      const client = new ChiaRpcClient();
      expect(client.getNetwork()).toBe("mainnet");
      expect(client.getBaseUrl()).toBe("https://api.coinset.org");
    });

    it("reads CHIA_NETWORK=testnet11", () => {
      process.env.CHIA_NETWORK = "testnet11";
      const client = new ChiaRpcClient();
      expect(client.getNetwork()).toBe("testnet11");
      expect(client.getBaseUrl()).toBe("https://testnet11.api.coinset.org");
    });

    it("CHIA_FULL_NODE_URL overrides default URL", () => {
      process.env.CHIA_FULL_NODE_URL = "http://localhost:8555";
      const client = new ChiaRpcClient();
      expect(client.getBaseUrl()).toBe("http://localhost:8555");
    });

    it("strips trailing slash from URL", () => {
      process.env.CHIA_FULL_NODE_URL = "http://localhost:8555/";
      const client = new ChiaRpcClient();
      expect(client.getBaseUrl()).toBe("http://localhost:8555");
    });

    it("throws on invalid CHIA_NETWORK", () => {
      process.env.CHIA_NETWORK = "badnet";
      expect(() => new ChiaRpcClient()).toThrow('Invalid CHIA_NETWORK "badnet"');
    });
  });

  describe("call()", () => {
    it("sends POST with correct Content-Type and JSON body", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true, data: "test" }),
      });

      const client = new ChiaRpcClient();
      await client.call("get_blockchain_state", { foo: "bar" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.coinset.org/get_blockchain_state",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "chia-mcp/1.0" },
          body: JSON.stringify({ foo: "bar" }),
        })
      );
    });

    it("returns parsed JSON data on success", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true, blockchain_state: { peak: {} } }),
      });

      const client = new ChiaRpcClient();
      const result = await client.call("get_blockchain_state");
      expect(result).toEqual({ success: true, blockchain_state: { peak: {} } });
    });

    it("throws on network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const client = new ChiaRpcClient();
      await expect(client.call("get_blockchain_state")).rejects.toThrow(
        "Network error calling get_blockchain_state: ECONNREFUSED"
      );
    });

    it("throws on HTTP 500", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "server error",
      });

      const client = new ChiaRpcClient();
      await expect(client.call("get_blockchain_state")).rejects.toThrow(
        "HTTP 500 from get_blockchain_state: server error"
      );
    });

    it("throws on invalid JSON response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => "not valid json {{{{",
      });

      const client = new ChiaRpcClient();
      await expect(client.call("get_blockchain_state")).rejects.toThrow(
        "Invalid JSON response from get_blockchain_state"
      );
    });

    it("throws on RPC error (success: false)", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: false, error: "CLVM cost exceeded" }),
      });

      const client = new ChiaRpcClient();
      await expect(client.call("get_blockchain_state")).rejects.toThrow(
        "RPC error from get_blockchain_state: CLVM cost exceeded"
      );
    });

    it("returns data normally for not-found errors", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: false, error: "coin record not found" }),
      });

      const client = new ChiaRpcClient();
      const result: any = await client.call("get_coin_record_by_name", { name: "0x00" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("coin record not found");
    });

    it("sends empty body when no params", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      const client = new ChiaRpcClient();
      await client.call("get_routes");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      );
    });
  });

  describe("quoteUnsafeIntegers (via call)", () => {
    it("does not corrupt floats with 17-digit fractional parts", async () => {
      const responseBody = JSON.stringify({
        success: true,
        ratio: 0.37368768900379071,
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => responseBody,
      });

      const client = new ChiaRpcClient();
      const result: any = await client.call("test_method");
      // The float should survive round-trip without being corrupted
      expect(typeof result.ratio).toBe("number");
      expect(result.ratio).toBeCloseTo(0.37368768900379071, 10);
    });
  });

  describe("timeout during response.text()", () => {
    it("reports a timeout error, not invalid JSON", async () => {
      const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => { throw timeoutError; },
      });

      const client = new ChiaRpcClient();
      await expect(client.call("slow_method")).rejects.toThrow(
        /timed out while reading response/
      );
      // Should NOT say "Invalid JSON"
      await expect(
        (async () => {
          fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => { throw timeoutError; },
          });
          await client.call("slow_method");
        })()
      ).rejects.not.toThrow(/Invalid JSON/);
    });
  });

  describe("callOnNetwork()", () => {
    it("uses mainnet URL for mainnet", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      const client = new ChiaRpcClient();
      await client.callOnNetwork("mainnet", "get_blockchain_state");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.coinset.org/get_blockchain_state",
        expect.any(Object)
      );
    });

    it("uses testnet11 URL for testnet11", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      const client = new ChiaRpcClient();
      await client.callOnNetwork("testnet11", "get_blockchain_state");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://testnet11.api.coinset.org/get_blockchain_state",
        expect.any(Object)
      );
    });

    it("throws on network error with network name in message", async () => {
      fetchMock.mockRejectedValueOnce(new Error("timeout"));

      const client = new ChiaRpcClient();
      await expect(
        client.callOnNetwork("testnet11", "get_blockchain_state")
      ).rejects.toThrow("Network error calling get_blockchain_state on testnet11");
    });
  });

  describe("getNetworkConfig()", () => {
    it("returns mainnet config by default", () => {
      const client = new ChiaRpcClient();
      const config = client.getNetworkConfig();
      expect(config.name).toBe("mainnet");
      expect(config.prefix).toBe("xch");
    });

    it("returns testnet11 config when configured", () => {
      process.env.CHIA_NETWORK = "testnet11";
      const client = new ChiaRpcClient();
      const config = client.getNetworkConfig();
      expect(config.name).toBe("testnet11");
      expect(config.prefix).toBe("txch");
    });
  });

  describe("getConfigForNetwork()", () => {
    it("returns config for any network regardless of current", () => {
      const client = new ChiaRpcClient();
      const tn = client.getConfigForNetwork("testnet11");
      expect(tn.prefix).toBe("txch");
      const mn = client.getConfigForNetwork("mainnet");
      expect(mn.prefix).toBe("xch");
    });
  });
});
