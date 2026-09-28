/**
 * Chia RPC client — HTTP POST to Coinset-hosted full nodes.
 */

import { NETWORK_CONFIGS, type ChiaNetwork, type NetworkConfig } from "./types.js";

/**
 * Thrown when the Chia node returns success:false on an RPC call.
 * Carries the network and rpc_url so callers can include the network envelope
 * in error responses — preventing mainnet/testnet confusion even on error paths.
 */
export class RpcError extends Error {
  readonly network: ChiaNetwork;
  readonly rpcUrl: string;
  readonly structuredError?: Record<string, unknown>;

  constructor(
    message: string,
    network: ChiaNetwork,
    rpcUrl: string,
    structuredError?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RpcError";
    this.network = network;
    this.rpcUrl = rpcUrl;
    this.structuredError = structuredError;
  }
}

/** Default request timeout in milliseconds. Prevents agent hangs on slow/overloaded nodes. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Extended request timeout for paged farming-address queries.
 * Farming addresses with 50k+ coins can take 107s+ at the node level.
 * Used by get_address_summary's Phase 2 windowed paging so individual
 * page requests have a chance to complete on dense addresses.
 */
export const PAGED_QUERY_TIMEOUT_MS = 45_000;

/**
 * Fields converted from number to string in RPC responses for JSON safety.
 * These are uint64 values that can exceed JavaScript's Number.MAX_SAFE_INTEGER (2^53-1).
 * Notably includes `timestamp` — while timestamps currently fit in Number, they are
 * stringified for consistency since they share the uint64 type in the Chia protocol.
 */
const UINT64_FIELDS = new Set([
  "amount", "space", "timestamp", "weight",
  "total_iters", "sub_slot_iters", "required_iters",
  "fee", "cost", "mempool_cost", "mempool_max_total_cost",
  "mempool_min_fee_per_cost",
]);

function ensureUint64Strings(obj: unknown): void {
  if (typeof obj !== "object" || obj === null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) ensureUint64Strings(item);
    return;
  }
  const rec = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(rec)) {
    if (UINT64_FIELDS.has(key) && typeof value === "number") {
      rec[key] = String(value);
    } else if (typeof value === "object" && value !== null) {
      ensureUint64Strings(value);
    }
  }
}

/**
 * Quote integers with 16+ digits that appear outside of JSON string values.
 * Walks character-by-character to avoid corrupting numbers inside quoted strings.
 */
function quoteUnsafeIntegers(text: string): string {
  const result: string[] = [];
  let inString = false;
  let i = 0;
  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\' && i + 1 < text.length) {
        result.push(text[i], text[i + 1]);
        i += 2;
      } else if (text[i] === '"') {
        result.push('"');
        inString = false;
        i++;
      } else {
        result.push(text[i]);
        i++;
      }
    } else if (text[i] === '"') {
      result.push('"');
      inString = true;
      i++;
    } else if (text[i] >= '0' && text[i] <= '9' || (text[i] === '-' && i + 1 < text.length && text[i + 1] >= '0' && text[i + 1] <= '9')) {
      const hasSign = text[i] === '-';
      const start = hasSign ? i + 1 : i;
      i = start;
      while (i < text.length && text[i] >= '0' && text[i] <= '9') i++;
      const numStr = text.slice(start, i);
      const isPlainInt = i >= text.length || (text[i] !== '.' && text[i] !== 'e' && text[i] !== 'E');
      const afterDecimalPoint = start > 0 && text[start - 1] === '.' && !hasSign;
      if (isPlainInt && !afterDecimalPoint && numStr.length >= 16) {
        // Quote the full number including sign
        result.push('"', hasSign ? '-' : '', numStr, '"');
      } else {
        if (hasSign) result.push('-');
        result.push(numStr);
      }
    } else {
      result.push(text[i]);
      i++;
    }
  }
  return result.join('');
}

const NOT_FOUND_CODES = new Set([
  "COIN_RECORD_NOT_FOUND",
  "TX_NOT_IN_MEMPOOL",
  "BLOCK_NOT_FOUND",
  "BLOCK_HEIGHT_NOT_FOUND",
  "BLOCK_HASH_NOT_FOUND",
  "NEWER_BLOCK_NOT_FOUND",
  "OLDER_BLOCK_NOT_FOUND",
]);
const NOT_FOUND_PATTERNS = [/^coin record not found/i, /^not found$/i, /not in mempool/i];

export class ChiaRpcClient {
  private baseUrl: string;
  private network: ChiaNetwork;
  networkMismatch = false;
  /** Tri-state: "pending" until the background probe resolves, then true/false. */
  networkVerified: true | false | "pending" = "pending";

  constructor() {
    const explicitUrl = process.env.CHIA_FULL_NODE_URL;

    // Infer network from recognized Coinset URLs when CHIA_NETWORK is not set.
    // This avoids a race where the server reports "mainnet" before the background
    // get_network_info call resolves, even though the URL points at testnet11.
    const inferredNetworkFromUrl = (() => {
      if (!explicitUrl) return null;
      const url = explicitUrl.toLowerCase();
      if (url.includes("testnet11.api.coinset.org")) return "testnet11";
      if (url.includes("api.coinset.org")) return "mainnet";
      return null;
    })();

    const networkEnv = process.env.CHIA_NETWORK
      ? process.env.CHIA_NETWORK.toLowerCase()
      : (inferredNetworkFromUrl ?? "mainnet");

    if (networkEnv !== "mainnet" && networkEnv !== "testnet11") {
      throw new Error(
        `Invalid CHIA_NETWORK "${networkEnv}". Valid values: "mainnet", "testnet11".`
      );
    }
    this.network = networkEnv as ChiaNetwork;

    // Default URL is the Coinset endpoint for the resolved network.
    this.baseUrl = explicitUrl ?? NETWORK_CONFIGS[this.network].url;

    if (this.baseUrl.endsWith("/")) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  getNetwork(): ChiaNetwork {
    return this.network;
  }

  getNetworkConfig(): NetworkConfig {
    return NETWORK_CONFIGS[this.network];
  }

  getConfigForNetwork(network: ChiaNetwork): NetworkConfig {
    return NETWORK_CONFIGS[network];
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Shared fetch + parse logic for all RPC calls.
   * @param timeoutMs Optional timeout override (defaults to REQUEST_TIMEOUT_MS = 20s).
   *                  Use PAGED_QUERY_TIMEOUT_MS for windowed farming-address queries.
   */
  private async fetchRpc(
    url: string,
    method: string,
    params: Record<string, unknown>,
    label: string,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "chia-mcp/1.0" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(
          `Request to ${label} timed out after ${timeoutMs / 1000}s. ` +
          `Try a more specific query (e.g., narrower height range, single coin ID instead of bulk lookup).`
        );
      }
      const message =
        err instanceof Error ? err.message : "Unknown network error";
      const hint =
        url.includes("localhost") || url.includes("127.0.0.1")
          ? " Hint: Local Chia nodes require mTLS (mutual TLS with client certificates). Use Coinset hosted endpoints or a reverse proxy."
          : "";
      throw new Error(`Network error calling ${label}: ${message}${hint}`);
    }

    if (response.status === 429 && method !== "push_tx") {
      // Consume the 429 response body to allow connection reuse in Node.js's keep-alive pool.
      await response.text().catch(() => "");
      const parsed = parseInt(
        response.headers.get("Retry-After") || "2",
        10
      );
      // Retry-After may be an HTTP-date string (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
      // parseInt returns NaN for date strings; guard against NaN → instant retry
      const retryAfter = Number.isNaN(parsed) ? 2 : parsed;
      const jitter = Math.floor(Math.random() * 1000);
      const delay = Math.min(retryAfter * 1000, 10000) + jitter;
      await new Promise((r) => setTimeout(r, delay));
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "chia-mcp/1.0" },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (retryErr) {
        if (retryErr instanceof DOMException && retryErr.name === "TimeoutError") {
          throw new Error(
            `Retry request to ${label} timed out after ${timeoutMs / 1000}s.`
          );
        }
        const message = retryErr instanceof Error ? retryErr.message : "Unknown network error";
        throw new Error(`Retry request to ${label} failed: ${message}`);
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status} from ${label}: ${body || response.statusText}`
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(
          `Request to ${label} timed out while reading response after ${REQUEST_TIMEOUT_MS / 1000}s. ` +
          `Try a more specific query (e.g., narrower height range, single coin ID instead of bulk lookup).`
        );
      }
      throw new Error(`Failed to read response body from ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }

    let data: Record<string, unknown>;
    try {
      const quotedText = quoteUnsafeIntegers(text);
      data = JSON.parse(quotedText) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON response from ${label}`);
    }

    ensureUint64Strings(data);

    if (data.success === false) {
      const errorMsg =
        typeof data.error === "string" ? data.error : JSON.stringify(data);
      const structuredError = data.structuredError as
        | Record<string, unknown>
        | undefined;

      const isNotFound =
        (structuredError?.code &&
          NOT_FOUND_CODES.has(String(structuredError.code))) ||
        NOT_FOUND_PATTERNS.some((p) => p.test(errorMsg));

      if (isNotFound) return data;

      const structured = structuredError
        ? ` [${JSON.stringify(structuredError)}]`
        : "";
      throw new RpcError(
        `RPC error from ${label}: ${errorMsg}${structured}`,
        this.network,
        this.baseUrl,
        structuredError
      );
    }

    return data;
  }

  /**
   * Call a Chia full node RPC method.
   * @param timeoutMs Optional timeout override. Defaults to REQUEST_TIMEOUT_MS (20s).
   *                  Use PAGED_QUERY_TIMEOUT_MS for windowed farming-address queries.
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    return this.fetchRpc(url, method, params, method, timeoutMs) as Promise<T>;
  }

  /**
   * Call an RPC on a specific network (used for resources).
   */
  async callOnNetwork<T = unknown>(
    network: ChiaNetwork,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const url = `${NETWORK_CONFIGS[network].url}/${method}`;
    return this.fetchRpc(
      url,
      method,
      params,
      `${method} on ${network}`
    ) as Promise<T>;
  }
}
