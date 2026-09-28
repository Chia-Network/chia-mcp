/**
 * TypeScript types for Chia full node RPC parameters and responses.
 */

// --- Network configuration ---

export type ChiaNetwork = "mainnet" | "testnet11";

export interface NetworkConfig {
  name: ChiaNetwork;
  url: string;
  prefix: string;
}

export const NETWORK_CONFIGS: Record<ChiaNetwork, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    url: "https://api.coinset.org",
    prefix: "xch",
  },
  testnet11: {
    name: "testnet11",
    url: "https://testnet11.api.coinset.org",
    prefix: "txch",
  },
};

// --- RPC response wrapper ---

export interface RpcResponse<T = unknown> {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

// --- RPC parameter types ---

export interface GetBlockParams {
  header_hash: string;
}

export interface GetBlockRecordByHeightParams {
  height: number;
}

export interface GetBlockRecordsParams {
  start: number;
  end: number;
}

export interface GetBlocksParams {
  start: number;
  end: number;
  exclude_header_hash?: boolean;
  exclude_reorged?: boolean;
}

export interface GetCoinRecordsByPuzzleHashParams {
  puzzle_hash: string;
  include_spent_coins?: boolean;
  start_height?: number;
  end_height?: number;
}

export interface GetCoinRecordsByHintParams {
  hint: string;
  include_spent_coins?: boolean;
  start_height?: number;
  end_height?: number;
}

export interface GetCoinRecordByNameParams {
  name: string;
}

export interface GetCoinRecordsByNamesParams {
  names: string[];
  include_spent_coins?: boolean;
  start_height?: number;
  end_height?: number;
}

export interface GetCoinRecordsByParentIdsParams {
  parent_ids: string[];
  include_spent_coins?: boolean;
  start_height?: number;
  end_height?: number;
}

export interface GetPuzzleAndSolutionParams {
  coin_id: string;
  height: number;
}

export interface GetAdditionsAndRemovalsParams {
  header_hash: string;
}

export interface GetMempoolItemByTxIdParams {
  tx_id: string;
}

export interface GetFeeEstimateParams {
  target_times: number[];
  spend_bundle?: object;
  cost?: number;
}

export interface PushTxParams {
  spend_bundle: object;
}
