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
  | 'launch'
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
  tradeUrl?: string;
  tradeProvider?: string;
  tradeProviderName?: string;
};

export type YieldAsset = SwapToken;

export type YieldMetadata = {
  action: 'deposit' | 'withdraw';
  protocol: string;
  protocolName: string;
  assets: YieldAsset[];
};

export type LaunchMetadata = {
  platform: string;
  platformName: string;
  token: Omit<SwapToken, 'amount'>;
  buyUrl: string;
  buyProvider?: string;
  buyProviderName?: string;
};

export type TokenAction = {
  token: Omit<SwapToken, 'amount'>;
  links: Array<{ id: string; label: string; url: string }>;
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
  metadata?: { swap?: SwapMetadata; yield?: YieldMetadata; launch?: LaunchMetadata; tokenActions?: TokenAction[]; [key: string]: unknown };
};

export type FeedState = {
  activities: Activity[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
