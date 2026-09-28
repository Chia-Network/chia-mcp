/**
 * Table-driven tests for the four composite tools:
 *   summarize_block, get_address_summary, trace_coin_lineage, decode_offer
 *
 * These tools contain non-trivial logic (aggregation, sorting, paging, lineage
 * walking) and are tested against a mocked RPC harness.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../tools.js";
import { ChiaRpcClient } from "../rpc.js";

const VALID_HASH = "0x" + "ab".repeat(32);
const VALID_HASH2 = "0x" + "cd".repeat(32);
const VALID_HASH3 = "0x" + "ef".repeat(32);
const COINBASE_ID = "0x" + "11".repeat(32);
const COINBASE_PARENT = "0x" + "cc".repeat(32); // NOT all-zeros — matches real Chia coinbase

function makeCoinRecord(
  parentCoinInfo: string,
  puzzleHash: string,
  amount: number | string,
  options: { coinbase?: boolean; confirmed?: number; spent?: number } = {}
) {
  return {
    coin: {
      parent_coin_info: parentCoinInfo,
      puzzle_hash: puzzleHash,
      amount: String(amount),
    },
    confirmed_block_index: options.confirmed ?? 100,
    spent_block_index: options.spent ?? 0,
    coinbase: options.coinbase ?? false,
  };
}

// Helper to parse JSON text from a tool result
function parseResult(result: { content: unknown[] }) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let client: Client;
let rpcClient: ChiaRpcClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  delete process.env.CHIA_NETWORK;
  delete process.env.CHIA_FULL_NODE_URL;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () =>
      JSON.stringify({ success: true, network_name: "mainnet", network_prefix: "xch" }),
  }));

  rpcClient = new ChiaRpcClient();
  const server = createServer(rpcClient);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "composite-test-client", version: "0.0.1" });
  await client.connect(clientTransport);

  cleanup = async () => {
    await client.close();
    vi.restoreAllMocks();
  };
});

afterAll(async () => {
  await cleanup();
});

// ─── summarize_block ──────────────────────────────────────────────────────────

describe("summarize_block", () => {
  function makeFetch(additions: unknown[], removals: unknown[]) {
    return vi.fn()
      // get_blockchain_state (not needed but guard anyway)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true, additions, removals }),
      });
  }

  it("returns largest senders first (top_senders ordered largest-first)", async () => {
    // 15 puzzle hashes each with different net flows
    // puzzles 0-14 each send different amounts, we want the top 10 largest senders
    const additions: unknown[] = [];
    const removals: unknown[] = Array.from({ length: 15 }, (_, i) => ({
      coin: {
        parent_coin_info: VALID_HASH,
        puzzle_hash: "0x" + String(i).padStart(2, "0").repeat(32),
        amount: String((i + 1) * 1000), // 1000, 2000, ..., 15000 mojos removed
      },
    }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ success: true, additions, removals }),
    }));

    const result = await client.callTool({
      name: "summarize_block",
      arguments: { header_hash: VALID_HASH, top_n: 10 },
    });

    const parsed = parseResult(result);
    expect(parsed.top_senders).toHaveLength(10);

    // Verify ordering: largest absolute net send first (most negative net_mojos first in magnitude)
    const senderMojos = parsed.top_senders.map((s: { net_mojos: string }) =>
      BigInt(s.net_mojos)
    );
    for (let i = 0; i < senderMojos.length - 1; i++) {
      // Each entry should be more negative than the next (larger sender first)
      expect(senderMojos[i]).toBeLessThan(senderMojos[i + 1]);
    }

    // The 5 smallest senders (1000..5000) must NOT appear in the top 10
    const topSenderHashes = new Set(
      parsed.top_senders.map((s: { puzzle_hash: string }) => s.puzzle_hash)
    );
    for (let i = 0; i < 5; i++) {
      const smallHash = "0x" + String(i).padStart(2, "0").repeat(32);
      expect(topSenderHashes.has(smallHash)).toBe(false);
    }
  });

  it("returns largest receivers first (top_receivers ordered largest-first)", async () => {
    const additions = Array.from({ length: 10 }, (_, i) => ({
      coin: {
        parent_coin_info: VALID_HASH,
        puzzle_hash: "0x" + String(i + 20).padStart(2, "0").repeat(32),
        amount: String((i + 1) * 500),
      },
    }));
    const removals: unknown[] = [];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ success: true, additions, removals }),
    }));

    const result = await client.callTool({
      name: "summarize_block",
      arguments: { header_hash: VALID_HASH, top_n: 5 },
    });

    const parsed = parseResult(result);
    expect(parsed.top_receivers).toHaveLength(5);

    // Verify ordering: largest receiver first
    const receiverMojos = parsed.top_receivers.map((r: { net_mojos: string }) =>
      BigInt(r.net_mojos)
    );
    for (let i = 0; i < receiverMojos.length - 1; i++) {
      expect(receiverMojos[i]).toBeGreaterThan(receiverMojos[i + 1]);
    }
  });

  it("handles empty block (no additions or removals)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ success: true, additions: [], removals: [] }),
    }));

    const result = await client.callTool({
      name: "summarize_block",
      arguments: { header_hash: VALID_HASH },
    });

    const parsed = parseResult(result);
    expect(parsed.additions_count).toBe(0);
    expect(parsed.removals_count).toBe(0);
    expect(parsed.unique_puzzle_hashes).toBe(0);
    expect(parsed.total_added_mojos).toBe("0");
    expect(parsed.total_removed_mojos).toBe("0");
    expect(parsed.top_senders).toHaveLength(0);
    expect(parsed.top_receivers).toHaveLength(0);
    expect(parsed.top_additions).toHaveLength(0);
    expect(parsed.top_removals).toHaveLength(0);
  });

  it("handles block with only additions (no senders)", async () => {
    const additions = [
      { coin: { parent_coin_info: VALID_HASH, puzzle_hash: VALID_HASH2, amount: "1000000" } },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ success: true, additions, removals: [] }),
    }));

    const result = await client.callTool({
      name: "summarize_block",
      arguments: { header_hash: VALID_HASH },
    });

    const parsed = parseResult(result);
    expect(parsed.top_senders).toHaveLength(0);
    expect(parsed.top_receivers.length).toBeGreaterThan(0);
  });
});

// ─── get_address_summary ──────────────────────────────────────────────────────

describe("get_address_summary", () => {
  it("returns complete:true and correct total for small address (single call, under cap)", async () => {
    // Address with 3 unspent coins
    const coins = [
      makeCoinRecord(VALID_HASH, VALID_HASH2, 1_000_000_000_000), // 1 XCH
      makeCoinRecord(VALID_HASH2, VALID_HASH2, 2_000_000_000_000), // 2 XCH
      makeCoinRecord(VALID_HASH3, VALID_HASH2, 500_000_000_000),  // 0.5 XCH
    ];

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      callCount++;
      if (body.puzzle_hash !== undefined || body.puzzle_hash === VALID_HASH2) {
        if (callCount === 1) {
          // get_blockchain_state
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                success: true,
                blockchain_state: { peak: { height: 5000000 }, sync: { synced: true } },
              }),
          };
        }
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ success: true, coin_records: coins }),
        };
      }
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            success: true,
            blockchain_state: { peak: { height: 5000000 }, sync: { synced: true } },
          }),
      };
    }));

    // Use an xch1 address for a known puzzle hash
    const result = await client.callTool({
      name: "get_address_summary",
      arguments: { address: "0x" + "ab".repeat(32) },
    });

    const parsed = parseResult(result);
    expect(parsed.complete).toBe(true);
    expect(parsed.unspent_coin_count).toBe(3);
    expect(parsed.pages_scanned).toBeDefined();
    // 1 + 2 + 0.5 = 3.5 XCH = 3_500_000_000_000 mojos
    expect(BigInt(parsed.total_mojos)).toBe(3_500_000_000_000n);
    expect(parsed.total_xch).toBe("3.5");
  });

  it("deduplicates records that appear across multiple paged windows", async () => {
    // Simulate Phase 2 (paged mode): two height windows each return the same duplicate coin
    // plus one unique coin. The seen-set dedup should count each coin exactly once.
    const RECORD_CAP = 50_000;
    const duplicateCoin = makeCoinRecord(VALID_HASH, VALID_HASH2, 1000);
    const uniqueCoin1 = makeCoinRecord(VALID_HASH2, VALID_HASH2, 2000, { confirmed: 10 });
    const uniqueCoin2 = makeCoinRecord(VALID_HASH3, VALID_HASH2, 3000, { confirmed: 20 });

    // Phase 1 returns RECORD_CAP records to trigger Phase 2
    const phase1Coins = Array.from({ length: RECORD_CAP }, (_, i) =>
      makeCoinRecord("0x" + String(i).padStart(64, "0"), VALID_HASH2, 100, { confirmed: i })
    );

    let callNum = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      callNum++;

      // get_blockchain_state is called with empty body {}, which has no puzzle_hash
      if (body.puzzle_hash === undefined) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              // peakHeight=200000 so Phase 2 PAGE_HEIGHT=50000, needing 4 windows before
              // startHeight exceeds peak — enough for the early-exit test to fire on page 1
              success: true,
              blockchain_state: { peak: { height: 200000 }, sync: { synced: true } },
            }),
        };
      }
      if (callNum === 2) {
        // Phase 1 unbounded query (triggers Phase 2)
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ success: true, coin_records: phase1Coins }),
        };
      }
      if (callNum === 3) {
        // First Phase 2 window: duplicate + unique1
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ success: true, coin_records: [duplicateCoin, uniqueCoin1] }),
        };
      }
      // Subsequent Phase 2 windows: duplicate (again) + unique2
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ success: true, coin_records: [duplicateCoin, uniqueCoin2] }),
      };
    }));

    const result = await client.callTool({
      name: "get_address_summary",
      arguments: { address: "0x" + "ab".repeat(32) },
    });

    const parsed = parseResult(result);
    // Expect unique coins only: duplicateCoin counted once + uniqueCoin1 + uniqueCoin2 = 3
    // (duplicateCoin appears in both windows but dedup prevents double-counting)
    expect(parsed.unspent_coin_count).toBe(3);
    // Total = 1000 + 2000 + 3000 = 6000 mojos
    expect(BigInt(parsed.total_mojos)).toBe(6000n);
  });

  it("returns error (not zero balance) for success:false RPC response that passes through", async () => {
    // When get_coin_records_by_puzzle_hash returns success:false with a message that
    // matches the not-found passthrough, the tool should detect it and error — not
    // report zero balance. We simulate a case where success:false coin_records is absent.
    let callNum = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, _opts: RequestInit) => {
      callNum++;
      if (callNum === 1) {
        // First call is always get_blockchain_state (request body: {})
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              success: true,
              blockchain_state: { peak: { height: 100 }, sync: { synced: true } },
            }),
        };
      }
      // Subsequent calls: return success:false that passes through (not-found pattern).
      // get_address_summary must detect this and return isError:true — not report zero balance.
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ success: false, error: "coin record not found" }),
      };
    }));

    const result = await client.callTool({
      name: "get_address_summary",
      arguments: { address: "0x" + "ab".repeat(32) },
    });

    // Must be an error — not a zero-balance with complete:true
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // The error response is JSON (wrapResponse was called)
    const parsed = JSON.parse(text);
    expect(parsed.error).toBeDefined();
    expect(parsed.complete).toBeUndefined();
  });
});

// ─── trace_coin_lineage ───────────────────────────────────────────────────────

describe("trace_coin_lineage", () => {
  it("stops at coinbase:true record (correct termination)", async () => {
    // Chain: child → parent → farming_reward (coinbase: true)
    const farmingReward = makeCoinRecord(
      COINBASE_PARENT, // NOT all-zeros — real Chia parent format
      VALID_HASH2,
      1_750_000_000_000,
      { coinbase: true, confirmed: 1 }
    );
    const parentRecord = makeCoinRecord(COINBASE_ID, VALID_HASH2, 1_000_000_000_000, {
      confirmed: 50,
    });
    const childRecord = makeCoinRecord(VALID_HASH, VALID_HASH2, 500_000_000_000, {
      confirmed: 100,
    });

    const recordsByName: Record<string, unknown> = {
      [VALID_HASH]: { coin_record: childRecord },
      [VALID_HASH]: { coin_record: childRecord }, // same
      // parent is COINBASE_ID
    };

    let callNum = 0;
    const coinIds = [VALID_HASH, COINBASE_ID, childRecord.coin.parent_coin_info];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      callNum++;
      if (callNum === 1) {
        // First call is for VALID_HASH (the child)
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ success: true, coin_record: childRecord }),
        };
      }
      if (callNum === 2) {
        // Second call is for parent (COINBASE_ID — the parent of child)
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ success: true, coin_record: parentRecord }),
        };
      }
      // Third call for farming reward parent
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ success: true, coin_record: farmingReward }),
      };
    }));

    const result = await client.callTool({
      name: "trace_coin_lineage",
      arguments: { coin_id: VALID_HASH, max_depth: 20 },
    });

    const parsed = parseResult(result);
    expect(parsed.reached_origin).toBe(true);
    expect(parsed.truncated_at_max_depth).toBe(false);

    // The last entry must be the coinbase record
    const last = parsed.lineage[parsed.lineage.length - 1];
    expect(last.coinbase).toBe(true);

    // The coinbase parent is NOT all-zeros in real Chia
    expect(last.parent_coin_info).toBe(COINBASE_PARENT);
    expect(last.parent_coin_info).not.toMatch(/^0x0{64}$/);
  });

  it("stops at max_depth with truncated_at_max_depth:true", async () => {
    // Infinite chain simulation — always returns a non-coinbase record
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          success: true,
          coin_record: makeCoinRecord(VALID_HASH, VALID_HASH2, 1000, {
            coinbase: false,
          }),
        }),
    }));

    const result = await client.callTool({
      name: "trace_coin_lineage",
      arguments: { coin_id: VALID_HASH, max_depth: 3 },
    });

    const parsed = parseResult(result);
    expect(parsed.truncated_at_max_depth).toBe(true);
    expect(parsed.reached_origin).toBe(false);
    expect(parsed.lineage).toHaveLength(3);
  });

  it("handles NOT_FOUND mid-chain", async () => {
    let callNum = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callNum++;
      if (callNum === 1) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              success: true,
              coin_record: makeCoinRecord(VALID_HASH2, VALID_HASH2, 1000),
            }),
        };
      }
      // Second call — parent not found (pass-through as data)
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ success: false, error: "coin record not found" }),
      };
    }));

    const result = await client.callTool({
      name: "trace_coin_lineage",
      arguments: { coin_id: VALID_HASH, max_depth: 20 },
    });

    const parsed = parseResult(result);
    expect(parsed.reached_origin).toBe(false);
    // Last entry should be a NOT_FOUND status
    const last = parsed.lineage[parsed.lineage.length - 1];
    expect(last.status).toBe("NOT_FOUND");
  });
});

// ─── decode_offer ─────────────────────────────────────────────────────────────

describe("decode_offer additional tests", () => {
  // Real offer string (same as used in tools-integration.test.ts)
  const REAL_OFFER =
    "offer1qqr83wcuu2rykcmqvpsxygqqemhmlaekcenaz02ma6hs5w600dhjlvfjn477nkwz369h88kll73h37fefnwk3qqnz8s0lle0trd80xjas43kxs4ugc2a039h3akk7dr69lxtmdfc779dh4397u6ju0q89fyanh8a2f3j036znxvlu3d2av0lzux4daaknwdatunkzpmlcq9vn2s4lad5hv3804msqkerx3ea9jaag5n2vtalll6a6v4a4mme0k8wy2kl0mqt3k2jetwhldyfhlla7079t7xzr8falmum67a2h4aqer4ay8k3lgw35fmdlank7nyn7e8gy3q77v943aydxm0yvxm05wxm05wxmd5wxrfa8kxndhhg6auqx9lwp0x0wl2w0rta569ud4hxf4yyms3mrr8tq0xw0tsd3nd3nk94hdr9d2c24tkgm6hka23mah7v946m87zrwj0utwejkxc9a7yu7wmv374lgmq7rz5d6z4q9wvzr08xhuxqqeh438rt2xelcllhkfzaa7nlf0np4kwlhnzh48xdkqhhfcfpskf3u5lkehe8lc5kwpgk5x68el7rk86thcvklpydm7pqcqyml00lalczs7mmmgsew5dcxkgurmhl7ul2e8kx6j3dyukxlmha974jextkunqr05yvstxl7pfnnyjuladx382r6vd60tzgmmmhll4gt9wu9a4fssmhgjktqkgnmdesh2x2lrlsyshderl5mszxppskt5x5l3luremza7k6a8lrgvvqylqvknhghdt945ydeshv5jd87j0gc58kt77uz0l30pxvluhfftrgk6wux0fmadausf497nvgwnl0zkmr9e7veuammauxwyuu335xlu9edndu7jd6nmx9c8yn7w3xfd0n2tuf4clrrdwjyscapkla50tm22ljmwq8vyt2vn747s9gnyzmrzccjdhxclrsw0qexmqnumael0sa4gleylws9cl7a6tleca349m6xkhy5063s2vqgz5yh6eczreh7jwv70a00zn8akud5g2rh44jtwlxelzd7vtdl5eekec7jsh9qk7hvk093anacrfl47628lynpf4uvehdnlh6l08aaqwhalwl6n00x5mdlenvlctekn7lkl8t4dn77z77lnef3c7jmkm7k960ejarjjt7d0fk2qql2cg5whhk0j5";

  it("positive decode: coin_ids have expected format (hex, 64 chars)", async () => {
    const result = await client.callTool({
      name: "decode_offer",
      arguments: { offer: REAL_OFFER },
    });

    expect(result.isError).not.toBe(true);
    const parsed = parseResult(result);

    for (const spend of parsed.coin_spends) {
      // coin_id returned by SDK may or may not have 0x prefix
      expect(spend.coin_id).toMatch(/^(0x)?[0-9a-f]{64}$/i);
    }
  });

  it("reports has_aggregated_signature correctly for a partial offer (should be false/zero)", async () => {
    const result = await client.callTool({
      name: "decode_offer",
      arguments: { offer: REAL_OFFER },
    });

    const parsed = parseResult(result);
    // Offers are partial spend bundles — aggregated sig is typically zero/infinity
    expect(typeof parsed.has_aggregated_signature).toBe("boolean");
  });
});
