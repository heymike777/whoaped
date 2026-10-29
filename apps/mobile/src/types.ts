export type Chain = 'solana' | 'ethereum' | 'base';

export type Wallet = {
  id: string;
  name: string;
  address: string;
  chain: Chain;
  status: 'active' | 'syncing' | 'error';
  transactionCount24h: number;
  createdAt: string;
};

export type ActivityKind =
  | 'balance'
  | 'multisig'
  | 'swap'
  | 'yield'
  | 'buy'
  | 'stake'
  | 'transfer'
  | 'nft'
  | 'unknown';

export type SwapDex = string;

export type SwapToken = {
  mint: string;
  symbol: string;
  name?: string;
  amount: number;
  iconUrl?: string;
};

export type SwapMetadata = {
  dex: SwapDex;
  dexName: string;
  input: SwapToken;
  output: SwapToken;
};

export type YieldAsset = SwapToken;

export type YieldMetadata = {
  action: 'deposit' | 'withdraw';
  protocol: string;
  protocolName: string;
  assets: YieldAsset[];
};

export type Activity = {
  id: string;
  walletId: string;
  walletName: string;
  walletAddress: string;
  chain: Chain;
  kind: ActivityKind;
  title: string;
  detail: string;
  source?: string;
  valueUsd?: number;
  signature: string;
  occurredAt: string;
  metadata?: { swap?: SwapMetadata; yield?: YieldMetadata; [key: string]: unknown };
};

export type FeedState = {
  activities: Activity[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
