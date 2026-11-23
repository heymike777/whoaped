export type StakeFastCluster = 'devnet' | 'mainnet';

export interface StakeFastClientOptions {
  cluster: StakeFastCluster;
  rpcUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** With both filters, the vault must use the specified mint. */
export type StakeFastAmountQuery = { wallet: string } & (
  { mint: string; vault?: string } | { vault: string; mint?: string }
);

export interface StakeFastPosition {
  vault: string;
  /** Token base units. */
  amountRaw: string;
  /** Unix seconds, or null while the position is active. */
  unlockAt: string | null;
}

export interface StakeFastTotals {
  cluster: StakeFastCluster;
  program: string;
  mint: string;
  /** Finalized slot where the positions were read. */
  slot: number;
  decimals: number;
  totalAmountRaw: string;
  activeAmountRaw: string;
  /** Tokens pending withdrawal, including after the cooldown has elapsed. */
  unstakingAmountRaw: string;
}

export interface StakeFastAmount extends StakeFastTotals {
  wallet: string;
  vault: string | null;
  positions: StakeFastPosition[];
}

export interface StakeFastVaultStats extends StakeFastTotals {
  vault: string;
  /** Open positions, including positions pending withdrawal. */
  positionCount: number;
}

export interface StakeFastTransactionQuery {
  wallet: string;
  vault: string;
  /** If provided, the vault must use this mint. */
  mint?: string;
}

export interface StakeFastStakeQuery extends StakeFastTransactionQuery {
  /** Positive integer in token base units. */
  amountRaw: string | bigint;
}

export interface StakeFastUnsignedTransaction {
  cluster: StakeFastCluster;
  vault: string;
  mint: string;
  /** Unsigned Solana legacy wire transaction encoded as base64. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** Present only for a mainnet claim, from the same position used by the builder. */
  withdrawal?: {
    wallet: string;
    grossRaw: string;
    feeRaw: string;
    netRaw: string;
    feeBps: number;
    actionFeeLamports: string;
  };
}

export interface StakeFastClient {
  getStakedAmount(query: StakeFastAmountQuery): Promise<StakeFastAmount>;
  getVaultStats(query: { vault: string }): Promise<StakeFastVaultStats>;
  buildStakeTransaction(query: StakeFastStakeQuery): Promise<StakeFastUnsignedTransaction>;
  buildUnstakeTransaction(query: StakeFastTransactionQuery): Promise<StakeFastUnsignedTransaction>;
  buildCancelUnstakeTransaction(query: StakeFastTransactionQuery): Promise<StakeFastUnsignedTransaction>;
  buildClaimTransaction(query: StakeFastTransactionQuery): Promise<StakeFastUnsignedTransaction>;
}

export function createStakeFastClient(options: StakeFastClientOptions): StakeFastClient;
