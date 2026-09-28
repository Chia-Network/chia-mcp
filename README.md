# chia-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes **36 tools** for querying the Chia blockchain (up to 38 with push_tx and local-node options). Uses [Coinset](https://coinset.org) hosted nodes — no local Chia node required.

## Quick Start

### Claude Desktop

Add to your config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chia": {
      "command": "npx",
      "args": ["-y", "chia-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add chia -- npx -y chia-mcp
claude mcp add chia --env CHIA_NETWORK=testnet11 -- npx -y chia-mcp
```

### Cursor

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "chia": {
      "command": "npx",
      "args": ["-y", "chia-mcp"]
    }
  }
}
```

### VS Code

Add to your User Settings (JSON) or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "chia": {
        "command": "npx",
        "args": ["-y", "chia-mcp"]
      }
    }
  }
}
```

### Testnet

Set `CHIA_NETWORK` to use testnet11:

```json
{
  "mcpServers": {
    "chia": {
      "command": "npx",
      "args": ["-y", "chia-mcp"],
      "env": {
        "CHIA_NETWORK": "testnet11"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHIA_NETWORK` | `mainnet` | Network to connect to: `mainnet` or `testnet11` |
| `CHIA_FULL_NODE_URL` | _(auto from network)_ | Override the full node RPC endpoint URL (e.g., `https://api.coinset.org` or your own node). Local Chia nodes require mTLS client certificates; use a reverse proxy that terminates mTLS since chia-mcp does not support client certificates directly. |
| `CHIA_MCP_ENABLE_PUSH_TX` | _(unset)_ | Set to `1` or `true` to enable the `push_tx` tool (disabled by default for safety) |

## Available Tools

### Blockchain State
- **`get_blockchain_state`** — Current chain state: peak height, sync status, difficulty, sub-slot iters, mempool size, network space estimate.
- **`get_network_info`** — Network name and address prefix (xch/txch).
- **`get_routes`** — List all available RPC endpoints on the node (only available on non-Coinset nodes).

### Blocks
- **`get_block`** — Full block by header hash (transactions, proofs, rewards).
- **`get_block_record`** — Block record by header hash (lighter than full block).
- **`get_block_record_by_height`** — Block record metadata at a height (lighter than full block).
- **`get_block_records`** — Block records for a height range `[start, end)`.
- **`get_blocks`** — Full blocks for a height range `[start, end)`.
- **`get_block_spends`** — All coin spends in a block by header hash.
- **`get_block_spends_with_conditions`** — Coin spends with parsed CLVM conditions by header hash.
- **`get_additions_and_removals`** — All coins created/spent in a block.
- **`get_unfinished_block_headers`** — Unfinished block headers (blocks in progress).
- **`get_block_count_metrics`** — Block count metrics (compact/uncompact counts).

### Coins
- **`get_coin_record_by_name`** — Single coin by its ID (sha256 of parent+puzzle_hash+amount).
- **`get_coin_records_by_names`** — Multiple coins by IDs (batch lookup).
- **`get_coin_records_by_puzzle_hash`** — Coins locked to a puzzle hash, with optional spent/height filters.
- **`get_coin_records_by_puzzle_hashes`** — Coins locked to multiple puzzle hashes (batch lookup).
- **`get_coin_records_by_hint`** — Coins tagged with a hint (common in CAT/NFT transactions).
- **`get_coin_records_by_hints`** — Coins tagged with multiple hints (batch lookup).
- **`get_coin_records_by_parent_ids`** — Coins created by specific parent coins (trace lineage).
- **`get_puzzle_and_solution`** — CLVM puzzle and solution for a spent coin at a given height.
- **`get_puzzle_and_solution_with_conditions`** — Puzzle, solution, AND parsed CLVM conditions for a spent coin.
- **`get_memos_by_coin_name`** — Memos/messages associated with a coin.

### Mempool
- **`get_all_mempool_tx_ids`** — List all pending transaction IDs.
- **`get_all_mempool_items`** — All mempool items with full details (can be large).
- **`get_mempool_item_by_tx_id`** — Single mempool item by transaction ID.
- **`get_mempool_items_by_coin_name`** — Mempool items referencing a specific coin.
- **`get_fee_estimate`** — Fee estimates for target inclusion times.

### Transactions
- **`push_tx`** — Submit a signed spend bundle to the mempool.
- **`get_aggsig_additional_data`** — AGG_SIG additional data for signature verification.

### Network
- **`get_network_space`** — Estimate total network space between two blocks.

### Composite (higher-level queries, multiple RPCs)
- **`get_address_summary`** — Complete balance summary for an address or puzzle hash. Pages through ALL unspent coins to produce an accurate total with a `complete` flag. This is the correct way to check a balance.
- **`decode_offer`** — Decode a Chia offer string (`offer1...`) into a structured summary: coin spends, amounts, coin IDs, puzzle sizes, signature status. Uses the official chia-wallet-sdk for correct parsing.
- **`trace_coin_lineage`** — Trace a coin's ancestry back to its origin (coinbase). Follows parent links up to `max_depth` hops.
- **`summarize_block`** — Compact summary of all coin movements in a block: counts, totals, largest movements, net flow by puzzle hash. Much more useful than raw `get_additions_and_removals` (which can be 1+ MB).

### Utilities (local computation, no RPC)
- **`address_encode`** — Convert a puzzle hash to a bech32m Chia address (xch1.../txch1...).
- **`address_decode`** — Decode a bech32m Chia address back to its puzzle hash.
- **`coin_id`** — Compute a coin ID from parent_coin_id + puzzle_hash + amount.

## Resources

### Network State (live)
- **`chia://network/mainnet`** — Mainnet connection info and live blockchain state.
- **`chia://network/testnet11`** — Testnet11 connection info and live blockchain state.

### Guides (embedded documentation)
- **`chia://guide/coin-model`** — Chia's coin/UTXO model, spend bundles, token standards, and common LLM mistakes.
- **`chia://guide/rpc-quickstart`** — Common RPC calls with curl examples and Coinset endpoints.
- **`chia://guide/recipes`** — Step-by-step recipes for balance checks, transaction tracing, CAT detection — with failure modes.

## How It Works

This server wraps the [Chia full node RPC API](https://docs.chia.net/full-node-rpc/) using Coinset's hosted endpoints:

- **Mainnet:** `https://api.coinset.org/<method>`
- **Testnet11:** `https://testnet11.api.coinset.org/<method>`

All RPC calls are simple HTTP POST requests with JSON bodies. No authentication required.

## Coinset Hosted Node vs Local Node

Most tools work against any Chia full node (Coinset-hosted or your own). Three tools are **Coinset extensions** — they do not exist in `chia-blockchain`'s full node RPC API and will return HTTP 404 against a local node or the simulator:

| Tool | Coinset | Local node / Simulator |
|------|---------|------------------------|
| `get_puzzle_and_solution_with_conditions` | ✅ | ❌ — use `get_puzzle_and_solution` + local CLVM eval |
| `get_memos_by_coin_name` | ✅ | ❌ |
| `get_coin_records_by_hints` | ✅ | ❌ — only singular `get_coin_records_by_hint` exists |

> **Simulator portability:** Code written against Coinset's extended endpoints will not work against the simulator or a local node. The simulator (`chia dev sim`) and standard `chia-blockchain` nodes support the same standard RPC surface. Develop against the simulator using standard RPCs for maximum portability; use Coinset extensions for production querying convenience.

**Shared RPCs:** `get_network_info` and `get_aggsig_additional_data` are shared RPC endpoints available on all Chia services (not full-node-specific). They work on both Coinset and local nodes.

**Deliberately omitted RPCs:** Three upstream full node RPCs are not exposed as tools: `get_constants` (static data better served by `constants.json`), `get_recent_signage_point_or_eos` (internal consensus detail not useful for agents), and `create_block_generator` (timelord/farmer internal). All other full node RPCs are exposed.

## Prompts

The server provides 9 prompts that encode tool sequencing and failure modes for common Chia tasks:

| Prompt | Description |
|--------|-------------|
| `network_status` | Check the current state of a Chia network: peak height, sync status, difficulty, mempool. |
| `address_balance` | Check the XCH balance of a Chia address using `get_address_summary` for accuracy. |
| `coin_lookup` | Look up a specific coin by its coin ID and inspect its details. |
| `trace_lineage` | Trace a coin's parent chain to understand where funds came from. |
| `block_summary` | Summarize a block's contents: transaction count, value moved, top addresses. |
| `transaction_status` | Check whether a transaction is confirmed, in mempool, or dropped. |
| `offer_safety` | Evaluate whether a Chia offer is safe to accept (hidden spends, asset verification, expiry). |
| `token_verification` | Verify whether tokens (CATs) are legitimate by checking the asset ID against trusted registries. |
| `fee_selection` | Determine the appropriate fee for a Chia transaction based on current network conditions. |

## Known Limitations

- **`get_routes` unavailable on Coinset hosted nodes** — Returns HTTP 404. This is a Coinset limitation, not a bug in this server. The tool works when connected to a local Chia node.
- **Large integer precision** — All known uint64 fields (`amount`, `space`, `timestamp`, `weight`, `total_iters`, `sub_slot_iters`, `required_iters`, `fee`, `cost`, `mempool_cost`, `mempool_max_total_cost`, `mempool_min_fee_per_cost`) are string-quoted in responses, and any bare integer ≥16 digits is also quoted, to prevent JavaScript precision loss. The `coin_id` tool also accepts string amounts for values exceeding `Number.MAX_SAFE_INTEGER`.
- **Response truncation** — Responses larger than 50 KB are automatically truncated. Use narrower query parameters (smaller height ranges, specific coin IDs instead of bulk lookups) to avoid truncation.
- **`push_tx` not retried on 429** — When the RPC returns HTTP 429 (rate limit), all methods except `push_tx` are retried once after a delay. `push_tx` is excluded from retry to prevent accidental re-broadcast of transactions.
- **`network_verified` lifecycle** — The `network_verified` field in every response envelope starts as `"pending"` until the first successful RPC probe, then resolves to `true` (match) or `false` (mismatch). If the configured node is unreachable, it resolves to `false` (probe failed).
- **npm audit advisories** — Transitive dependencies from the MCP SDK may report npm audit advisories. These are unreachable in stdio-transport configuration (no HTTP server is exposed). They do not affect the security posture of a standard chia-mcp deployment.

## Install from Source (current method)

Until the package is published to npm, install from source:

```bash
git clone https://github.com/Chia-Network/chia-mcp.git
cd chia-mcp
npm install
npm run build
```

Then use `node /path/to/chia-mcp/dist/index.js` in your MCP client config in place of `npx -y chia-mcp`. For example, in Claude Desktop:

```json
{
  "mcpServers": {
    "chia": {
      "command": "node",
      "args": ["/path/to/chia-mcp/dist/index.js"]
    }
  }
}
```

### Development

```bash
npm test                # Run test suite
npm run dev             # Watch mode (recompiles on changes)
node dist/index.js      # Run the server directly
```

## License

Apache-2.0
