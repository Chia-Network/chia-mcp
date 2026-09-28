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
import { NETWORK_CONFIGS } from "./types.js";
/** Embedded guide content from chia-for-agents docs. */
const GUIDES = {
    "coin-model": {
        title: "Chia Coinset Model",
        description: "Core concepts: coins (UTXO model), puzzle hashes, coin IDs, spend bundles, conditions, " +
            "CATs, NFTs, DIDs, and 39 common LLM mistakes about Chia vs account-based chains.",
        content: `# Chia Coinset Model — Agent Reference

## Coins (UTXOs)

Chia uses a coin (UTXO) model, not accounts. Each coin has exactly three fields:
- **parent_coin_info** — coin ID of the parent coin (32 bytes)
- **puzzle_hash** — Tree hash (sha256tree) of the CLVM puzzle that locks this coin (32 bytes)
- **amount** — value in mojos (uint64; 1 XCH = 1,000,000,000,000 mojos)

**Coin ID** = SHA256(parent_coin_info + puzzle_hash + amount_bytes)

Amount encoding: big-endian minimal bytes, two's complement. **0 encodes to empty bytes (zero length), NOT 0x00.**

## Spending a Coin

To spend a coin, provide a "solution" (input) to the coin's "puzzle" (CLVM program). The puzzle runs against the solution and produces "conditions" — outputs like:
- CREATE_COIN(puzzle_hash, amount) — create a new coin
- AGG_SIG_ME(public_key, message) — require a BLS signature
- RESERVE_FEE(mojos) — assert minimum fee is present (fee = inputs − outputs)
- ASSERT_HEIGHT_RELATIVE(blocks) — time-lock

There are 35 condition opcodes total (see constants.json for the full list).

## Spend Bundles (Transactions)

A transaction is a SpendBundle: a list of CoinSpends (each: coin + puzzle reveal + solution) plus one aggregated BLS12-381 signature. Multiple coin spends can share a single aggregated signature.

## Key Concepts

- **No accounts, no balances.** "Balance" = sum of unspent coins at a puzzle hash.
- **Coins are immutable.** Spending destroys the old coin and creates new ones.
- **Puzzle hash ≠ address.** Addresses (xch1.../txch1...) are bech32m-encoded puzzle hashes.
- **Fee = sum(inputs) − sum(outputs).** There is no fee field. RESERVE_FEE is an optional assertion that a minimum fee is present.
- **Simultaneous settlement.** All spends in a bundle succeed or fail atomically.

## Token Standards

- **CATs (Chia Asset Tokens):** Fungible tokens. A CAT coin wraps a standard puzzle in a CAT outer puzzle. CATs use 3 decimal places of precision (not 12 like XCH). Dividing a CAT amount by 10¹² gives a value a billion times too small. The outer puzzle hash differs from the inner one, so CATs at an address are NOT returned by querying the address's puzzle hash directly. Use get_coin_records_by_hint with the inner puzzle hash as the hint.
- **NFTs:** Non-fungible tokens using singleton pattern. Each NFT has a unique launcher_id.
- **DIDs:** Decentralized identifiers, also singletons.
- **Offers:** Peer-to-peer atomic swaps. An offer file is a partial spend bundle — no intermediary needed.

## Common LLM Mistakes About Chia (39 items)

- **"Query the balance of address X"** — There is no balance RPC. Sum unspent coins at the puzzle hash. Exclude CATs/NFTs.
- **"Send a transaction to address X"** — Chia doesn't send TO addresses. You spend coins and create new coins locked to a puzzle hash.
- **"What's the gas fee?"** — No gas. Fee = sum(inputs) − sum(outputs), in mojos. RESERVE_FEE is an optional minimum-fee assertion.
- **"Deploy a smart contract"** — No deployment step. Puzzles are revealed at spend time. Every coin IS a smart contract.
- **"Call the approve() function"** — No approve/transferFrom pattern. Offers handle atomic swaps natively.
- **"Check the transaction hash"** — Chia has spend bundle hashes (for mempool), not transaction hashes in the Ethereum sense. Use coin IDs to track specific coins.
- **"What's the nonce?"** — No nonces. Coin IDs are globally unique (derived from parent + puzzle + amount).
- **"Which block confirmed my transaction?"** — Look up the coin's confirmed_block_index, not a transaction receipt.
- **"Read the contract state"** — No persistent contract state. State lives in coins. "Reading state" means finding unspent coins and inspecting their puzzles.
- **"An address is a destination"** — You create a coin locked to a puzzle hash. Nothing is sent to an address. Addresses are just bech32m-encoded puzzle hashes.
- **"Conditions are executed"** — Conditions are asserted and validated, not executed like EVM opcodes. The puzzle runs; the conditions constrain what the spend is allowed to do.
- **"Show me the event logs"** — Chia has no indexed event logs. Condition announcements are ephemeral — they exist only during spend validation and are not stored or indexed on-chain. Parse conditions from get_puzzle_and_solution output.
- **"One address = one wallet balance"** — Wallets derive many addresses from a single seed. Querying one puzzle hash gives a partial result.
- **"CAT amounts use 12 decimal places"** — CATs use 3 decimal places, not 12. Dividing a CAT amount by 10¹² gives a value a billion times too small.
- **"A coin with zero amount is invalid"** — Zero-amount coins are legal. Offer settlement and announcement-only coins often carry zero mojos.
- **"Singleton amount doesn't matter"** — Singletons (NFTs, DIDs) must have an odd amount, conventionally 1 mojo. An even-amount coin is not a valid singleton state coin.
- **"The coin record has no spent field" / "Use .spent to check if a coin is spent"** — The spent boolean IS present in RPC responses (added by a compatibility shim in the RPC layer). But don't rely on it — it's not part of the canonical CoinRecord struct and depends on a compat shim. Use spent_block_index > 0 instead — it's the real serialized field, tells you WHEN, and doesn't depend on the shim.
- **"Every block has a timestamp"** — Only transaction blocks (~36%) have a timestamp. Non-transaction blocks carry no timestamp field.
- **"get_puzzle_and_solution takes the current height"** — It requires exactly spent_block_index from the coin record. Passing any other height fails with INVALID_HEIGHT_FOR_COIN (on upstream nodes) or PUZZLE_SOLUTION_FAILED (on Coinset, which collapses all failure cases into this code). Always get spent_block_index from get_coin_record_by_name first.
- **"Offer files are transactions"** — Offer files are partial spend bundles, not complete transactions. They cannot be submitted to the mempool directly.
- **"The mempool is ordered by fee"** — Chia sorts by fee-per-cost, not absolute fee. A high-cost bundle needs a proportionally higher fee to jump the queue.
- **"A confirmed coin can't be affected by a reorg"** — Chia offers no guaranteed finality. There is no protocol-enforced maximum reorg depth. ~6 blocks for ordinary confidence; ~192 confirmations for Bitcoin-6-equivalent security. Scale confirmations to value at risk.
- **"amount in CREATE_COIN is a normal integer"** — CLVM encodes amounts as big-endian minimal bytes. 0 encodes to empty bytes, not 0x00. Getting this wrong produces incorrect coin IDs.
- **"Farming reward coins have an all-zero parent coin ID"** — They don't. A farming reward coin's parent_coin_info is derived from the genesis challenge and block height. The correct termination condition when walking a lineage is coinbase: true, not a zero-parent check.
- **"The spend bundle has a fee field"** — There is no fee field. Fee = sum(input amounts) − sum(CREATE_COIN output amounts).
- **"The spend bundle hash is a stable transaction ID"** — It is not stable; the hash changes when additional coin spends are aggregated. Track by expected output coin IDs instead.
- **"push_tx returning success: true means the transaction was accepted into the mempool"** — Not always. push_tx can return success: true with status: "PENDING". This means the bundle is held in a side cache (conflict or pending-height cache) and is NOT queued for block inclusion. Always check status, not just success.
- **"Where is the transaction receipt?"** — Chia has no transaction receipts. There is no equivalent of Ethereum's getTransactionReceipt. To verify a transaction's outcome, look up the expected output coin IDs using get_coin_record_by_name — if the coin exists and confirmed_block_index > 0, the spend that created it was included in a block. The spend bundle hash is a mempool handle, not a permanent receipt ID (see mistake about spend bundle hash stability above).
- **"A coin ID and a puzzle hash are interchangeable"** — Both are bytes32, but a coin ID uniquely identifies a specific coin (derived from parent + puzzle hash + amount) while a puzzle hash identifies the locking script. Passing a coin ID to get_coin_records_by_puzzle_hash returns empty results with no error — the RPC accepts any 32-byte value without type-checking, making this a silent failure.
- **"A higher fee always replaces a lower-fee bundle in the mempool"** — Chia RBF requires the replacement to be a strict superset of the original bundle's coin spends, not merely a higher fee. You cannot replace a pending bundle by submitting a different one with a larger fee.
- **"include_spent_coins: true returns only spent coins"** — It returns both spent and unspent coins. The default (false) returns only unspent. Setting true adds spent coins to the result — it does not filter to spent-only. Filter client-side with spent_block_index > 0.
- **"The plural get_coin_records_by_names is a drop-in batch replacement for get_coin_record_by_name"** — It is not. The singular tool returns both spent and unspent coins by default; the plural tool returns only unspent coins by default. Calling the plural tool without include_spent_coins: true silently drops all spent coins — returning an empty result with no error for coins that exist. Always pass include_spent_coins: true when you need the same behavior as the singular tool.
- **"Amounts in RPC JSON are safe to read as numbers"** — Chia amounts are uint64 (max 18,446,744,073,709,551,615). JavaScript Number.MAX_SAFE_INTEGER is 2^53-1. Amounts exceeding this lose precision silently in JSON.parse(), jq, and spreadsheets. Always use BigInt or Python integers for mojo arithmetic.
- **"Solution-supplied amounts are always positive"** — In CLVM, solution-supplied amounts can be negative. A puzzle that doesn't explicitly assert positivity will accept negative values — this was the root cause of the TibetSwap v2 bug, where a missing (> amount 0) assertion allowed negative amounts to reverse trade fees and drain reserves. Always assert (> amount 0) on any solution-supplied value that feeds arithmetic in a puzzle.
- **"I can screen a Chia address for scam associations"** — There is no Chainalysis-style on-chain screening for Chia. Addresses are pure puzzle hashes with no public blacklist, compliance oracle, or risk-score API. Reporting an address as "clean" or "flagged" based on on-chain data alone is not meaningful.
- **"A malformed puzzle hash returns an error"** — It does not. get_coin_records_by_puzzle_hash accepts any 32-byte hex value without type-checking and returns success: true with an empty array if nothing matches. A misencoded puzzle hash silently returns zero results — indistinguishable from a legitimate empty address. Always verify the puzzle hash was derived correctly (e.g., via address_decode).
- **"An offer's coin spends tell you what you would receive"** — They show only the offered side (what the maker is giving up). The requested assets are encoded as ASSERT_PUZZLE_ANNOUNCEMENT conditions referencing the taker's side — not decoded by decode_offer. Do not present decode_offer output as a complete picture of the exchange.
- **"The coin's timestamp tells me when the user sent it"** — A coin's timestamp is the farming timestamp of the transaction block it was created in — set by the winning farmer, not the sender. It reflects when the block was farmed, not when the user broadcast the spend or when it entered the mempool. The gap can be seconds to minutes. Farmer-supplied timestamps are constrained only within a tolerance window and can be slightly non-monotonic across adjacent blocks. Never present timestamp as "the time the user sent this transaction."
- **"An absent key in a JSON response means an empty set"** — An absent key and an empty array are not equivalent. get_coin_records_by_puzzle_hash returns coin_records: [] (explicit empty array) when no coins match. An absent coin_records key indicates a parsing error, truncated response, or wrong endpoint. success: false with no coin_records key is not the same as success: true with coin_records: []. Always verify the expected key is present before treating its absence as "no results."

## uint64 Precision Warning

Chia amounts are uint64 (max 18,446,744,073,709,551,615). JavaScript's Number.MAX_SAFE_INTEGER is 2^53-1 (9,007,199,254,740,991). Amounts exceeding this lose precision in JSON.parse(). The chia-mcp server converts the following fields to strings in all responses: \`amount\`, \`timestamp\`, \`fee\`, \`cost\`, \`space\`, \`weight\`, \`total_iters\`, \`sub_slot_iters\`, \`required_iters\`, \`mempool_cost\`, \`mempool_max_total_cost\`, \`mempool_min_fee_per_cost\`. Use BigInt or Python for arithmetic on these fields — never jq or JavaScript Number.
`,
    },
    "rpc-quickstart": {
        title: "Chia RPC Quickstart",
        description: "Common Chia full node RPC calls with curl examples via Coinset hosted endpoints. " +
            "Covers blockchain state, coin lookups, puzzle/solution inspection, mempool, and fee estimation.",
        content: `# Chia RPC Quickstart — Agent Reference

All RPCs are HTTP POST to Coinset hosted endpoints. No authentication required.

## Endpoints

- **Mainnet:** https://api.coinset.org/<method>
- **Testnet11:** https://testnet11.api.coinset.org/<method>

## Common Calls

### Get blockchain state
\`\`\`bash
curl -s -X POST https://api.coinset.org/get_blockchain_state \\
  -H "Content-Type: application/json" -d '{}'
\`\`\`
Returns: peak height, sync status, difficulty, mempool size, network space.

### Look up a coin by ID
\`\`\`bash
curl -s -X POST https://api.coinset.org/get_coin_record_by_name \\
  -H "Content-Type: application/json" \\
  -d '{"name": "0x<coin_id>"}'
\`\`\`
Returns: coin fields, confirmation height, spent status, timestamp.

### Find coins at a puzzle hash (address lookup)
\`\`\`bash
curl -s -X POST https://api.coinset.org/get_coin_records_by_puzzle_hash \\
  -H "Content-Type: application/json" \\
  -d '{"puzzle_hash": "0x<puzzle_hash>", "include_spent_coins": false}'
\`\`\`
⚠️ Results may be truncated. Page with start_height/end_height. Do NOT sum a partial result as a balance.

### Get puzzle and solution for a spent coin
\`\`\`bash
curl -s -X POST https://api.coinset.org/get_puzzle_and_solution \\
  -H "Content-Type: application/json" \\
  -d '{"coin_id": "0x<coin_id>", "height": <spent_block_index>}'
\`\`\`
Returns: CLVM puzzle reveal and solution. Use get_puzzle_and_solution_with_conditions for parsed conditions.

### Estimate fees
\`\`\`bash
curl -s -X POST https://api.coinset.org/get_fee_estimate \\
  -H "Content-Type: application/json" \\
  -d '{"target_times": [60, 300, 600], "cost": 5000000}'
\`\`\`
cost is in CLVM cost units (not mojos). 5,000,000 is the fee-estimation sample bucket; an actual standard two-input two-output XCH send costs ~17M CLVM cost units.

### Check mempool for a transaction
\`\`\`bash
curl -s -X POST https://api.coinset.org/get_mempool_item_by_tx_id \\
  -H "Content-Type: application/json" \\
  -d '{"tx_id": "0x<spend_bundle_hash>"}'
\`\`\`
Returns the pending transaction if still in mempool. Returns success: false with structuredError.code: "TX_NOT_IN_MEMPOOL" if already confirmed or never submitted. Branch on structuredError.code.

## Key Points

- All amounts are in mojos (1 XCH = 1,000,000,000,000 mojos)
- Puzzle hashes are 0x-prefixed 64-char hex (32 bytes)
- Coin IDs are 0x-prefixed 64-char hex (32 bytes)
- Use python3 or bc for uint64 arithmetic, not jq (precision loss)
- Responses >50KB are automatically truncated by chia-mcp
`,
    },
    recipes: {
        title: "Chia Agent Recipes",
        description: "Step-by-step recipes for common Chia blockchain tasks with failure modes. " +
            "Balance checks, transaction tracing, coin lineage, CAT detection.",
        content: `# Chia Agent Recipes

## Check address balance
**Preferred:** Use get_address_summary — pages through all coins automatically, returns complete flag.
**Manual:** address_decode → get_coin_records_by_puzzle_hash → sum amounts.
⚠️ If truncated: true, the sum is WRONG. Page with start_height/end_height.
⚠️ XCH only — CATs and NFTs use different puzzle hashes and are excluded.
⚠️ Use python3 or bc for arithmetic, not jq (precision loss on uint64).

## Check transaction status
1. get_mempool_item_by_tx_id — if pending, returns spend bundle details.
2. If success: false with code "TX_NOT_IN_MEMPOOL", check the expected output coin: get_coin_record_by_name.
3. If coin exists with confirmed_block_index > 0, the transaction confirmed.
**Failure mode:** Mempool returns success: false (TX_NOT_IN_MEMPOOL) for both "already confirmed" and "never submitted." Branch on structuredError.code.

## Trace where XCH came from
**Preferred:** Use trace_coin_lineage — follows parent links to coinbase automatically.
**Manual:** get_coin_record_by_name → follow parent_coin_info → repeat.
**Failure mode:** If a coin record is not found, check the coin ID and network — full nodes do not prune the coin store.

## Trace where XCH went
1. get_coin_record_by_name — get the coin, note spent_block_index.
2. get_puzzle_and_solution_with_conditions at that height — find CREATE_COIN conditions.
3. Each CREATE_COIN(puzzle_hash, amount) is a child coin. Compute child coin IDs.
**Failure mode:** If response is truncated, fetch by specific coin_id.

## Check if address has CATs
1. address_decode to get the puzzle hash (this is the "inner" puzzle hash).
2. get_coin_records_by_hint with that puzzle hash as the hint.
3. CATs created with hint memos will appear. CATs without hints won't.
⚠️ **Hints are attacker-controlled.** Anyone can create a coin hinting your puzzle hash for a few mojos (fake airdrops). Always verify the asset ID before trusting results.
**Failure mode:** Returns empty if no CATs or if CATs were created without hint memos. Results may include unsolicited/spam coins.

## What You Cannot Do With Full Node RPCs Alone
- Query CAT/NFT balances directly (must parse CAT puzzles; or use Coinset MCP's \`get_address_balance\` / \`list_address_assets\` — ⚠️ XCH totals from Coinset MCP are unreliable; always use chia-mcp's \`get_address_summary\` for XCH)
- Create or sign transactions (requires wallet keys)
- Create or take offers (requires wallet RPC)
- Look up NFT metadata (requires wallet or indexer; or use Coinset MCP's \`get_asset_info\`)
- Get wallet transaction history (must reconstruct from coin records; or use Coinset MCP's \`list_transactions\`)
`,
    },
};
export function registerResources(server, rpc) {
    // Register a resource for each network
    const networks = ["mainnet", "testnet11"];
    for (const network of networks) {
        const config = NETWORK_CONFIGS[network];
        server.resource(`network-${network}`, `chia://network/${network}`, {
            description: `Chia ${network} connection info and current blockchain state. Includes the RPC endpoint URL, address prefix, and live chain state (peak height, sync status, difficulty, mempool size).`,
            mimeType: "application/json",
        }, async (uri) => {
            // Fetch live state for this network
            let state = null;
            try {
                state = await rpc.callOnNetwork(network, "get_blockchain_state");
            }
            catch (err) {
                state = {
                    error: err instanceof Error ? err.message : "Failed to fetch state",
                };
            }
            // Flatten nested blockchain_state if present
            const innerState = state?.blockchain_state ?? state;
            const resource = {
                network: config.name,
                rpc_url: config.url,
                address_prefix: config.prefix,
                blockchain_state: innerState,
            };
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify(resource, null, 2),
                    },
                ],
            };
        });
    }
    // Register guide resources — embedded docs from chia-for-agents
    for (const [slug, guide] of Object.entries(GUIDES)) {
        server.resource(`guide-${slug}`, `chia://guide/${slug}`, {
            description: guide.description,
            mimeType: "text/markdown",
        }, async (uri) => ({
            contents: [
                {
                    uri: uri.href,
                    mimeType: "text/markdown",
                    text: guide.content,
                },
            ],
        }));
    }
}
//# sourceMappingURL=resources.js.map