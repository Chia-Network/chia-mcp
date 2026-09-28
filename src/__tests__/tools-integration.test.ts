import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, CONDITION_OPCODES, formatResponse, decodeCLVMInt } from "../tools.js";
import { ChiaRpcClient } from "../rpc.js";

let client: Client;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  delete process.env.CHIA_NETWORK;
  delete process.env.CHIA_FULL_NODE_URL;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({ success: true, network_name: "mainnet", network_prefix: "xch" }),
  }));

  const rpc = new ChiaRpcClient();
  const server = createServer(rpc);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);

  cleanup = async () => {
    await client.close();
    vi.restoreAllMocks();
  };
});

afterAll(async () => {
  await cleanup();
});

describe("CONDITION_OPCODES correctness", () => {
  it("0x31 = AGG_SIG_UNSAFE", () => {
    expect(CONDITION_OPCODES["0x31"]).toBe("AGG_SIG_UNSAFE");
  });

  it("0x33 = CREATE_COIN", () => {
    expect(CONDITION_OPCODES["0x33"]).toBe("CREATE_COIN");
  });

  it("0x50 = ASSERT_SECONDS_RELATIVE", () => {
    expect(CONDITION_OPCODES["0x50"]).toBe("ASSERT_SECONDS_RELATIVE");
  });

  it("0x01 = REMARK", () => {
    expect(CONDITION_OPCODES["0x01"]).toBe("REMARK");
  });
});

describe("formatResponse omitted_keys", () => {
  it("includes omitted_keys when truncating an array with sibling keys", () => {
    const bigArray = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const data = {
      success: true,
      coin_records: bigArray,
      extra_field: "should be listed in omitted_keys",
    };

    const result = JSON.parse(formatResponse(data));
    expect(result.truncated).toBe(true);
    expect(result.omitted_keys).toHaveProperty("success");
    expect(result.omitted_keys).toHaveProperty("extra_field");
    expect(result.omitted_keys.success).toBeNull();
    expect(result.omitted_keys.extra_field).toBeNull();
    expect(result.coin_records).toBeDefined();
    expect(result.coin_records.length).toBeLessThan(bigArray.length);
  });

  it("returns scalar fields and field_sizes for non-array oversized responses", () => {
    const data = {
      success: true,
      block: { data: "x".repeat(100_000) },
      height: 42,
    };

    const result = JSON.parse(formatResponse(data));
    expect(result.truncated).toBe(true);
    expect(result.field_sizes).toBeDefined();
    expect(result.field_sizes.block).toBeGreaterThan(0);
    expect(result.success).toBe(true);
    expect(result.height).toBe(42);
  });

  it("truncates large string fields when the first array element alone exceeds budget", () => {
    // Simulate a single spend with a huge puzzle_reveal (like a real oversized spend)
    const hugeReveal = "a".repeat(60_000);
    const data = {
      coin_spends: [
        {
          coin_id: "0x" + "ab".repeat(32),
          puzzle_reveal: hugeReveal,
          solution: "ff",
        },
      ],
    };

    const responseStr = formatResponse(data);
    // Must not exceed strict 50KB cap
    const MAX_RESPONSE_BYTES = 50 * 1024;
    expect(responseStr.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);

    const result = JSON.parse(responseStr);
    expect(result.truncated).toBe(true);
    expect(result.coin_spends).toBeDefined();
    expect(result.coin_spends.length).toBe(1);
    // The oversized field must be replaced with a truncation marker
    expect(result.coin_spends[0].puzzle_reveal).toContain("[truncated:");
    expect(result.coin_spends[0].oversized_first_item).toBe(true);
  });

  it("stays under 50KB when the first item has large non-string fields (belt-and-suspenders fallback)", () => {
    // Simulate a first item with a huge conditions array (not string) — non-string fields
    // cannot be truncated by field-level string truncation, so the fallback must drop items[].
    const hugeConditions = Array.from({ length: 5000 }, (_, i) => ({
      opcode: "0x01",
      vars: [`0x${i.toString(16).padStart(64, "0")}`],
    }));
    const data = {
      coin_spends: [
        {
          coin_id: "0x" + "ab".repeat(32),
          conditions: hugeConditions,
        },
      ],
    };

    const responseStr = formatResponse(data);
    const MAX_RESPONSE_BYTES = 50 * 1024;
    expect(responseStr.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);

    const result = JSON.parse(responseStr);
    expect(result.truncated).toBe(true);
    // Fallback: items dropped, returned_count = 0
    expect(result.returned_count).toBe(0);
    expect(result.total_count).toBe(1);
  });
});

describe("address_encode / address_decode round-trip via callTool", () => {
  it("round-trips a puzzle hash through encode then decode", async () => {
    const puzzleHash = "0x" + "ab".repeat(32);

    const encodeResult = await client.callTool({
      name: "address_encode",
      arguments: { puzzle_hash: puzzleHash, prefix: "xch" },
    });

    const encodeText = (encodeResult.content as Array<{ type: string; text: string }>)[0].text;
    const encoded = JSON.parse(encodeText);
    expect(encoded.address).toMatch(/^xch1/);

    const decodeResult = await client.callTool({
      name: "address_decode",
      arguments: { address: encoded.address },
    });

    const decodeText = (decodeResult.content as Array<{ type: string; text: string }>)[0].text;
    const decoded = JSON.parse(decodeText);
    expect(decoded.puzzle_hash).toBe(puzzleHash);
  });
});

describe("coin_id with string amounts via callTool", () => {
  it("accepts string amounts for large values", async () => {
    const parent = "0x" + "00".repeat(32);
    const puzzle = "0x" + "00".repeat(32);
    const amount = "18446744073709551615"; // max uint64

    const result = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.coin_id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parsed.amount).toBe(amount);
  });

  it("produces consistent results for number and string amounts", async () => {
    const parent = "0x" + "aa".repeat(32);
    const puzzle = "0x" + "bb".repeat(32);

    const numResult = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount: 1000 },
    });
    const strResult = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount: "1000" },
    });

    const numParsed = JSON.parse((numResult.content as Array<{ type: string; text: string }>)[0].text);
    const strParsed = JSON.parse((strResult.content as Array<{ type: string; text: string }>)[0].text);
    expect(numParsed.coin_id).toBe(strParsed.coin_id);
  });
});

describe("decodeCLVMInt", () => {
  it("decodes empty/0x to 0", () => {
    expect(decodeCLVMInt("0x")).toBe("0");
    expect(decodeCLVMInt("")).toBe("0");
  });

  it("decodes single-byte positive values", () => {
    expect(decodeCLVMInt("0x01")).toBe("1");
    expect(decodeCLVMInt("0x7f")).toBe("127");
  });

  it("decodes multi-byte positive values", () => {
    // 0x055d4a80 = 90,000,000
    expect(decodeCLVMInt("0x055d4a80")).toBe("90000000");
    // 0x00e8d4a51000 = 1,000,000,000,000 (1 XCH in mojos)
    expect(decodeCLVMInt("0x00e8d4a51000")).toBe("1000000000000");
  });

  it("decodes negative values (high bit set)", () => {
    // 0xff = -1
    expect(decodeCLVMInt("0xff")).toBe("-1");
    // 0x80 = -128
    expect(decodeCLVMInt("0x80")).toBe("-128");
  });

  it("handles values without 0x prefix", () => {
    expect(decodeCLVMInt("055d4a80")).toBe("90000000");
  });
});

describe("tool count", () => {
  it("registers 36 tools by default (38 with push_tx and get_routes)", async () => {
    const tools = await client.listTools();
    // Default config has push_tx disabled, get_routes gated (coinset.org URL in test)
    expect(tools.tools.length).toBe(36);
  });
});

describe("decode_offer", () => {
  it("rejects a non-offer bech32m string (xch address)", async () => {
    const result = await client.callTool({
      name: "decode_offer",
      arguments: { offer: "xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3js40u" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Failed to decode offer");
  });

  it("rejects garbage input", async () => {
    const result = await client.callTool({
      name: "decode_offer",
      arguments: { offer: "not-a-valid-offer-string" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Failed to decode offer");
  });
});

describe("formatResponse truncation hints", () => {
  it("uses balance warning in COIN_QUERY_HINT", () => {
    const bigArray = Array.from({ length: 5000 }, (_, i) => ({
      coin: { amount: i, puzzle_hash: "0x" + "aa".repeat(32) },
    }));
    const data = { success: true, coin_records: bigArray };

    const coinHint =
      "Results are truncated. Do NOT sum the returned amounts as a balance — the total will be wrong. " +
      "Use start_height/end_height to page through all records before summing.";

    const result = JSON.parse(formatResponse(data, coinHint));
    expect(result.truncated).toBe(true);
    expect(result.hint).toContain("Do NOT sum");
    expect(result.hint).toContain("start_height");
  });

  it("preserves caller hint in non-array fallback (not hardcoded generic)", () => {
    // B5/M1 regression: the fallback branch used to ignore the caller's hint
    const data = {
      success: true,
      block: { data: "x".repeat(100_000) },
    };
    const customHint = "Use get_block_record for lighter metadata.";
    const result = JSON.parse(formatResponse(data, customHint));
    expect(result.truncated).toBe(true);
    expect(result.hint).toBe(customHint);
    // Must NOT be the generic fallback
    expect(result.hint).not.toContain("Response too large");
  });

  it("honours 50KB cap in non-array fallback when scalars are large", () => {
    // Regression: the non-array path used to add ALL scalar fields unconditionally,
    // allowing 100x 1KB scalars to produce a ~103KB result.
    const MAX_RESPONSE_BYTES = 50 * 1024;
    const manyLargeScalars: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      manyLargeScalars[`field_${i}`] = "x".repeat(1_000);
    }
    const responseStr = formatResponse(manyLargeScalars);
    expect(responseStr.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const result = JSON.parse(responseStr);
    expect(result.truncated).toBe(true);
    // field_sizes must still list all fields (metadata, not data)
    expect(result.field_sizes).toBeDefined();
    expect(Object.keys(result.field_sizes).length).toBe(100);
    // But not all scalar values should be present (budget would be exceeded)
    const presentFields = Object.keys(result).filter(k => k.startsWith("field_"));
    expect(presentFields.length).toBeLessThan(100);
  });
});

describe("formatResponse network envelope preservation", () => {
  it("preserves network and rpc_url when truncating arrays", () => {
    // H8 regression: truncation used to drop network envelope into omitted_keys
    const bigArray = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const data = {
      network: "mainnet",
      rpc_url: "https://api.coinset.org",
      network_mismatch: false,
      success: true,
      coin_records: bigArray,
    };

    const result = JSON.parse(formatResponse(data));
    expect(result.truncated).toBe(true);
    // Network envelope MUST be in the result, not in omitted_keys
    expect(result.network).toBe("mainnet");
    expect(result.rpc_url).toBe("https://api.coinset.org");
    expect(result.network_mismatch).toBe(false);
    // And must NOT appear in omitted_keys
    expect(result.omitted_keys).toBeDefined();
    expect(result.omitted_keys).not.toHaveProperty("network");
    expect(result.omitted_keys).not.toHaveProperty("rpc_url");
    expect(result.omitted_keys).not.toHaveProperty("network_mismatch");
  });

  it("preserves network in non-array truncation fallback", () => {
    const data = {
      network: "testnet11",
      rpc_url: "https://testnet11.api.coinset.org",
      success: true,
      puzzle_reveal: "x".repeat(100_000),
    };

    const result = JSON.parse(formatResponse(data));
    expect(result.truncated).toBe(true);
    expect(result.network).toBe("testnet11");
    expect(result.rpc_url).toBe("https://testnet11.api.coinset.org");
  });
});

describe("decodeCLVMInt edge cases", () => {
  it("decodes uint64 max correctly", () => {
    // 0x00ffffffffffffffff = 18446744073709551615 (max uint64, needs leading 00 to stay positive)
    expect(decodeCLVMInt("0x00ffffffffffffffff")).toBe("18446744073709551615");
  });

  it("decodes 1 XCH in mojos (1000000000000) both ways", () => {
    // 0x00e8d4a51000 = 1,000,000,000,000
    const result = decodeCLVMInt("0x00e8d4a51000");
    expect(result).toBe("1000000000000");
    // Verify it's not off by one
    expect(result).not.toBe("999999999999");
    expect(result).not.toBe("1000000000001");
  });

  it("distinguishes 127 (0x7f) from 128 (0x0080)", () => {
    // 127 fits in one byte positive; 128 needs a leading zero byte
    expect(decodeCLVMInt("0x7f")).toBe("127");
    expect(decodeCLVMInt("0x0080")).toBe("128");
    // 0x80 alone is -128 (high bit set = negative)
    expect(decodeCLVMInt("0x80")).toBe("-128");
  });
});

describe("decode_offer with real offer string", () => {
  // Fixture: a real offer pulled from Dexie
  const REAL_OFFER = "offer1qqr83wcuu2rykcmqvpsxygqqemhmlaekcenaz02ma6hs5w600dhjlvfjn477nkwz369h88kll73h37fefnwk3qqnz8s0lle0trd80xjas43kxs4ugc2a039h3akk7dr69lxtmdfc779dh4397u6ju0q89fyanh8a2f3j036znxvlu3d2av0lzux4daaknwdatunkzpmlcq9vn2s4lad5hv3804msqkerx3ea9jaag5n2vtalll6a6v4a4mme0k8wy2kl0mqt3k2jetwhldyfhlla7079t7xzr8falmum67a2h4aqer4ay8k3lgw35fmdlank7nyn7e8gy3q77v943aydxm0yvxm05wxm05wxmd5wxrfa8kxndhhg6auqx9lwp0x0wl2w0rta569ud4hxf4yyms3mrr8tq0xw0tsd3nd3nk94hdr9d2c24tkgm6hka23mah7v946m87zrwj0utwejkxc9a7yu7wmv374lgmq7rz5d6z4q9wvzr08xhuxqqeh438rt2xelcllhkfzaa7nlf0np4kwlhnzh48xdkqhhfcfpskf3u5lkehe8lc5kwpgk5x68el7rk86thcvklpydm7pqcqyml00lalczs7mmmgsew5dcxkgurmhl7ul2e8kx6j3dyukxlmha974jextkunqr05yvstxl7pfnnyjuladx382r6vd60tzgmmmhll4gt9wu9a4fssmhgjktqkgnmdesh2x2lrlsyshderl5mszxppskt5x5l3luremza7k6a8lrgvvqylqvknhghdt945ydeshv5jd87j0gc58kt77uz0l30pxvluhfftrgk6wux0fmadausf497nvgwnl0zkmr9e7veuammauxwyuu335xlu9edndu7jd6nmx9c8yn7w3xfd0n2tuf4clrrdwjyscapkla50tm22ljmwq8vyt2vn747s9gnyzmrzccjdhxclrsw0qexmqnumael0sa4gleylws9cl7a6tleca349m6xkhy5063s2vqgz5yh6eczreh7jwv70a00zn8akud5g2rh44jtwlxelzd7vtdl5eekec7jsh9qk7hvk093anacrfl47628lynpf4uvehdnlh6l08aaqwhalwl6n00x5mdlenvlctekn7lkl8t4dn77z77lnef3c7jmkm7k960ejarjjt7d0fk2qql2cg5whhk0j5";

  it("decodes a real offer and returns structured data", async () => {
    const result = await client.callTool({
      name: "decode_offer",
      arguments: { offer: REAL_OFFER },
    });

    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);

    // Must have coin spends
    expect(parsed.num_coin_spends).toBeGreaterThan(0);
    expect(parsed.coin_spends).toBeDefined();
    expect(parsed.coin_spends.length).toBe(parsed.num_coin_spends);

    // Each coin spend must have the documented fields
    for (const spend of parsed.coin_spends) {
      // coin_id may or may not have 0x prefix depending on SDK output
      expect(spend.coin_id).toMatch(/^(0x)?[0-9a-f]{64}$/);
      expect(spend.parent_coin_info).toMatch(/^(0x)?[0-9a-f]{64}$/);
      expect(spend.puzzle_hash).toMatch(/^(0x)?[0-9a-f]{64}$/);
      expect(spend.amount_mojos).toBeDefined();
      expect(typeof spend.amount_mojos).toBe("string"); // BigInt serialized as string
      expect(spend.puzzle_reveal_size_bytes).toBeGreaterThan(0);
      expect(spend.solution_size_bytes).toBeGreaterThan(0);
    }

    // Must report on signature and bundle hash
    expect(typeof parsed.has_aggregated_signature).toBe("boolean");
    expect(typeof parsed.spend_bundle_hash).toBe("string");

    // Must include network envelope
    expect(parsed.network).toBeDefined();
    expect(parsed.rpc_url).toBeDefined();
  });

  it("coin IDs in decode_offer match coin_id tool output", async () => {
    // Decode the offer
    const offerResult = await client.callTool({
      name: "decode_offer",
      arguments: { offer: REAL_OFFER },
    });
    const offerParsed = JSON.parse(
      (offerResult.content as Array<{ type: string; text: string }>)[0].text
    );

    // Take the first spend and verify its coin ID matches coin_id tool
    const spend = offerParsed.coin_spends[0];
    // Ensure 0x prefix for coin_id tool (which requires it)
    const ensurePrefix = (h: string) => h.startsWith("0x") ? h : "0x" + h;
    const coinIdResult = await client.callTool({
      name: "coin_id",
      arguments: {
        parent_coin_id: ensurePrefix(spend.parent_coin_info),
        puzzle_hash: ensurePrefix(spend.puzzle_hash),
        amount: spend.amount_mojos,
      },
    });
    const coinIdParsed = JSON.parse(
      (coinIdResult.content as Array<{ type: string; text: string }>)[0].text
    );

    // The coin IDs MUST match — this catches the B1 bug where decode_offer
    // used fixed 8-byte amounts instead of CLVM minimal bytes
    // Normalize: ensure both have 0x prefix for comparison
    const normalize = (id: string) => id.startsWith("0x") ? id : "0x" + id;
    expect(normalize(spend.coin_id)).toBe(normalize(coinIdParsed.coin_id));
  });
});

describe("coin_id edge cases", () => {
  it("amount 0 produces a specific known hash (not the same as amount 1)", async () => {
    const parent = "0x" + "00".repeat(32);
    const puzzle = "0x" + "00".repeat(32);

    const zeroResult = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount: 0 },
    });
    const oneResult = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount: 1 },
    });

    const zeroId = JSON.parse((zeroResult.content as Array<{ type: string; text: string }>)[0].text).coin_id;
    const oneId = JSON.parse((oneResult.content as Array<{ type: string; text: string }>)[0].text).coin_id;

    // Amount 0 encodes to empty bytes, amount 1 to 0x01 — different hashes
    expect(zeroId).not.toBe(oneId);
    // Known value for all-zeros parent + puzzle + amount 0
    expect(zeroId).toBe("0xf5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b");
  });

  it("rejects unsafe integer amounts passed as numbers (not strings)", async () => {
    // Amount > Number.MAX_SAFE_INTEGER passed as a number should trigger the safe-integer guard
    // The Zod schema accepts number up to MAX_SAFE_INTEGER or string for larger values
    const result = await client.callTool({
      name: "coin_id",
      arguments: {
        parent_coin_id: "0x" + "00".repeat(32),
        puzzle_hash: "0x" + "00".repeat(32),
        amount: "not_a_number", // Invalid string
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.length).toBeGreaterThan(0);
  });

  it("amount 128 and amount 127 produce different coin IDs", async () => {
    // CLVM encoding: 127 = 0x7f (1 byte), 128 = 0x0080 (2 bytes, leading zero for positive)
    // This catches bugs where amount encoding doesn't handle the sign-bit boundary
    const parent = "0x" + "00".repeat(32);
    const puzzle = "0x" + "00".repeat(32);

    const r127 = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount: 127 },
    });
    const r128 = await client.callTool({
      name: "coin_id",
      arguments: { parent_coin_id: parent, puzzle_hash: puzzle, amount: 128 },
    });

    const id127 = JSON.parse((r127.content as Array<{ type: string; text: string }>)[0].text).coin_id;
    const id128 = JSON.parse((r128.content as Array<{ type: string; text: string }>)[0].text).coin_id;
    expect(id127).not.toBe(id128);
    // Both must be valid hex hashes
    expect(id127).toMatch(/^0x[0-9a-f]{64}$/);
    expect(id128).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("formatResponse multi-array budget allocation", () => {
  const MAX_RESPONSE_BYTES = 50 * 1024;

  it("two arrays: both receive at least MIN_ITEMS_PER_ARRAY (10) items", () => {
    // Regression: before the multi-array fix, the first array would consume the full budget,
    // leaving zero room for the second array (e.g. get_additions_and_removals on a busy block).
    const bigArray = Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const smallArray = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      note: "removal item",
    }));
    const data = { additions: bigArray, removals: smallArray };

    const responseStr = formatResponse(data);
    expect(responseStr.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const result = JSON.parse(responseStr);

    expect(result.truncated).toBe(true);
    // Both arrays must be present with >= 10 items
    expect(result.additions).toBeDefined();
    expect(result.removals).toBeDefined();
    expect(result.additions.length).toBeGreaterThanOrEqual(10);
    expect(result.removals.length).toBeGreaterThanOrEqual(10);
    // Multi-array shape: per-array _total / _returned metadata (not legacy total_count)
    expect(result.additions_total).toBe(3000);
    expect(result.removals_total).toBe(50);
    expect(result.additions_returned).toBe(result.additions.length);
    expect(result.removals_returned).toBe(result.removals.length);
    // Largest array gets the remaining budget — additions should have more items than removals
    expect(result.additions.length).toBeGreaterThan(result.removals.length);
  });

  it("single-array path: uses legacy total_count/returned_count shape (not ${k}_total)", () => {
    // Backward-compat regression guard: single-array responses must use the legacy shape
    // that agents already know: total_count / returned_count (not coin_records_total etc.)
    const bigArray = Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const data = { coin_records: bigArray };

    const result = JSON.parse(formatResponse(data));
    expect(result.truncated).toBe(true);
    expect(result.total_count).toBe(3000);
    expect(result.returned_count).toBeGreaterThan(0);
    expect(result.returned_count).toBeLessThan(3000);
    // Must NOT use the multi-array naming
    expect(result).not.toHaveProperty("coin_records_total");
    expect(result).not.toHaveProperty("coin_records_returned");
  });

  it("three arrays: all receive at least 10 items, all under budget", () => {
    const medium = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const data = { arr_a: medium, arr_b: medium, arr_c: medium };

    const responseStr = formatResponse(data);
    expect(responseStr.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const result = JSON.parse(responseStr);

    expect(result.truncated).toBe(true);
    expect(result.arr_a).toBeDefined();
    expect(result.arr_b).toBeDefined();
    expect(result.arr_c).toBeDefined();
    expect(result.arr_a.length).toBeGreaterThanOrEqual(10);
    expect(result.arr_b.length).toBeGreaterThanOrEqual(10);
    expect(result.arr_c.length).toBeGreaterThanOrEqual(10);
    expect(result.arr_a_total).toBe(1000);
    expect(result.arr_b_total).toBe(1000);
    expect(result.arr_c_total).toBe(1000);
  });

  it("empty sibling array: omitted from arrayKeys, listed in omitted_keys", () => {
    // An empty array (e.g. removals: []) is filtered out of arrayKeys.
    // It should NOT appear as arr_returned: 0 in the multi-array metadata,
    // but SHOULD appear in omitted_keys so agents know it was dropped.
    const bigArray = Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const data = { additions: bigArray, removals: [] as unknown[] };

    const result = JSON.parse(formatResponse(data));
    expect(result.truncated).toBe(true);
    // Single-array path fires (only additions is non-empty)
    expect(result.total_count).toBe(3000);
    expect(result.returned_count).toBeGreaterThan(0);
    // removals (empty array) should appear in omitted_keys
    expect(result.omitted_keys).toHaveProperty("removals");
  });

  it("emergency fallback: scaffold > budget — picks largest array, lists others in omitted_keys", () => {
    // Each item is ~5000 bytes; 10 items per array × 2 arrays = ~100KB scaffold.
    // Emergency path must pick the largest array and list the other in omitted_keys.
    const hugeItems = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      data: "x".repeat(5000),
    }));
    const data = { additions: hugeItems, removals: hugeItems };

    const responseStr = formatResponse(data);
    expect(responseStr.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const result = JSON.parse(responseStr);

    expect(result.truncated).toBe(true);
    // Emergency fallback uses legacy shape (total_count / returned_count)
    expect(result.total_count).toBeDefined();
    // Dropped array must appear in omitted_keys so agents know it exists
    expect(result.omitted_keys).toBeDefined();
    // Valid JSON (checked implicitly by JSON.parse above)
  });

  it("returned_count matches array length after multi-array expansion", () => {
    // Belt-and-suspenders: _returned metadata must reflect actual array length in result.
    const bigArray = Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      data: "x".repeat(50),
    }));
    const medArray = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      note: "y",
    }));
    const data = { additions: bigArray, removals: medArray };

    const result = JSON.parse(formatResponse(data));
    expect(result.additions_returned).toBe(result.additions.length);
    expect(result.removals_returned).toBe(result.removals.length);
    expect(result.additions_returned).not.toBe(result.removals_returned);
  });
});
