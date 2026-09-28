# Testing

## Prerequisites

- Node.js >= 18
- npm

## Running Tests

```bash
# Run off-chain tests only (default — no network calls)
npm test

# Run all tests including on-chain (hits real testnet11 RPCs)
npm run test:on-chain

# Run only on-chain tests
CHIA_MCP_ON_CHAIN=1 npx vitest run src/__tests__/tools-on-chain.test.ts
```

## Test Files

| File | Type | Network | Description |
|------|------|---------|-------------|
| `src/__tests__/bech32m.test.ts` | Off-chain | — | Unit tests for bech32m address encode/decode |
| `src/__tests__/coin-id.test.ts` | Off-chain | — | Unit tests for coin ID (SHA256) computation using exported `computeCoinId` / `amountToBytes` from tools.ts |
| `src/__tests__/rpc-client.test.ts` | Off-chain | Mock | RPC client constructor, call(), error handling |
| `src/__tests__/tools-off-chain.test.ts` | Off-chain | Mock | All tools via mocked fetch — validates RPC client integration |
| `src/__tests__/tools-integration.test.ts` | Off-chain | Mock | Integration tests via real McpServer + Client over InMemoryTransport — tests `callTool` round-trips, CONDITION_OPCODES, `formatResponse`, address encode/decode, coin_id |
| `src/__tests__/tools-on-chain.test.ts` | On-chain | testnet11 / mainnet | Integration tests against real Coinset RPCs (network selected via `CHIA_NETWORK` env var) |
| `src/__tests__/response-shape.test.ts` | On-chain | testnet11 | Response field-shape validation against live RPC responses |
| `src/__tests__/tools-composite.test.ts` | Off-chain | Mock | Composite tool logic (get_address_summary, trace_coin_lineage, etc.) |
| `src/__tests__/resources.test.ts` | Off-chain | Mock | MCP resource registration and data shape |

## Coverage Summary

- **36 MCP tools** — all covered (off-chain mock + on-chain where applicable)
- **19 original RPCs + 12 added RPCs** — all tested on-chain against testnet11
- **3 utility tools** (address_encode, address_decode, coin_id) — off-chain unit tests + integration tests via callTool
- **CONDITION_OPCODES** — spot-checked against chia-blockchain source (integration test)
- **formatResponse** — truncation with `omitted_keys`, non-array fallback with `field_sizes` (integration test)
- **`push_tx`** — off-chain only (intentionally skipped on-chain to avoid submitting transactions)

### Not covered

- **uint64 string quoting** — `ensureUint64Strings` in rpc.ts is exercised by on-chain tests but not directly unit-tested in isolation
- **429 retry jitter** — retry logic is tested via mocked fetch but random jitter is not deterministically verified

## Intentionally Skipped (On-chain)

| RPC | Reason |
|-----|--------|
| `push_tx` | Would submit a real transaction to testnet11 |

## Notes

- On-chain tests support **testnet11** (default) and **mainnet** — select via `CHIA_NETWORK=mainnet` or `CHIA_NETWORK=testnet11`
- Coinset hosted RPCs: `https://testnet11.api.coinset.org` (testnet11), `https://api.coinset.org` (mainnet)
- `get_routes` and `get_aggsig_additional_data` may return 404 on Coinset-hosted nodes — tests accept this as a known limitation but verify no other error type occurs
- `beforeAll` in the on-chain suite finds a spent coin by scanning network-appropriate block ranges (testnet11: ~63000-70000, mainnet: ~250000-251000) — if these ranges are insufficient on a future reset, adjust the ranges in the test file
- Off-chain tests mock `global.fetch` via vitest — no network calls made
- `coin-id.test.ts` imports the actual `computeCoinId` and `amountToBytes` functions from `tools.ts` rather than reimplementing the algorithm locally
