export type ChainId = 'solana' | 'ethereum' | 'base';

export type NormalizedActivity = {
  chain: ChainId;
  txHash: string;
  eventIndex: number;
  kind: 'balance' | 'multisig' | 'swap' | 'yield' | 'launch' | 'buy' | 'stake' | 'transfer' | 'claim' | 'nft' | 'unknown' | 'failed';
  title: string;
  detail: string;
  source?: string;
  valueUsd?: number;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

export interface ChainAdapter<Payload = unknown> {
  readonly chain: ChainId;
  extractAddresses(payload: Payload): string[];
  normalize(payload: Payload, watchedAddress: string): NormalizedActivity[];
}
