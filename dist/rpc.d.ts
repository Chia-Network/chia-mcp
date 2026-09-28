/**
 * Chia RPC client — HTTP POST to Coinset-hosted full nodes.
 */
import { type ChiaNetwork, type NetworkConfig } from "./types.js";
/**
 * Thrown when the Chia node returns success:false on an RPC call.
 * Carries the network and rpc_url so callers can include the network envelope
 * in error responses — preventing mainnet/testnet confusion even on error paths.
 */
export declare class RpcError extends Error {
    readonly network: ChiaNetwork;
    readonly rpcUrl: string;
    readonly structuredError?: Record<string, unknown>;
    constructor(message: string, network: ChiaNetwork, rpcUrl: string, structuredError?: Record<string, unknown>);
}
/**
 * Extended request timeout for paged farming-address queries.
 * Farming addresses with 50k+ coins can take 107s+ at the node level.
 * Used by get_address_summary's Phase 2 windowed paging so individual
 * page requests have a chance to complete on dense addresses.
 */
export declare const PAGED_QUERY_TIMEOUT_MS = 45000;
export declare class ChiaRpcClient {
    private baseUrl;
    private network;
    networkMismatch: boolean;
    /** Tri-state: "pending" until the background probe resolves, then true/false. */
    networkVerified: true | false | "pending";
    constructor();
    getNetwork(): ChiaNetwork;
    getNetworkConfig(): NetworkConfig;
    getConfigForNetwork(network: ChiaNetwork): NetworkConfig;
    getBaseUrl(): string;
    /**
     * Shared fetch + parse logic for all RPC calls.
     * @param timeoutMs Optional timeout override (defaults to REQUEST_TIMEOUT_MS = 20s).
     *                  Use PAGED_QUERY_TIMEOUT_MS for windowed farming-address queries.
     */
    private fetchRpc;
    /**
     * Call a Chia full node RPC method.
     * @param timeoutMs Optional timeout override. Defaults to REQUEST_TIMEOUT_MS (20s).
     *                  Use PAGED_QUERY_TIMEOUT_MS for windowed farming-address queries.
     */
    call<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
    /**
     * Call an RPC on a specific network (used for resources).
     */
    callOnNetwork<T = unknown>(network: ChiaNetwork, method: string, params?: Record<string, unknown>): Promise<T>;
}
//# sourceMappingURL=rpc.d.ts.map