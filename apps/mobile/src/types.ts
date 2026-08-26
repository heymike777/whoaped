export type Chain = 'solana' | 'ethereum' | 'base';

export type Wallet = {
  id: string;
  name: string;
  address: string;
  chain: Chain;
  status: 'active' | 'syncing' | 'error';
  createdAt: string;
};

export type ActivityKind =
  | 'swap'
  | 'buy'
  | 'stake'
  | 'transfer'
  | 'nft'
  | 'unknown';

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
};

export type FeedState = {
  activities: Activity[];
  isLoading: boolean;
  error: string | null;
  isDemo: boolean;
  refresh: () => Promise<void>;
};
