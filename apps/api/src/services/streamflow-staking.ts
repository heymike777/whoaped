import { ICluster } from '@streamflow/common';
import { SolanaStakingClient } from '@streamflow/staking';
import { PublicKey } from '@solana/web3.js';
import { STREAMFLOW_UNSTAKE_SECONDS, streamflowConfig, type StreamflowConfig } from '../config/staking.js';

export type StreamflowPoolSnapshot = {
  address: string;
  mint: string;
  stakeMint: string;
  unstakePeriod: number;
  minDuration: number;
  maxDuration: number;
  freezeStakeMint: boolean;
  autoUnstake: boolean;
};
export type StreamflowEntrySnapshot = {
  address: string;
  authority: string;
  pool: string;
  amountRaw: bigint;
  duration: number;
  closedTs: number;
  unstakeTs: number;
};

export function assertPremiumPool(config: StreamflowConfig, pool: StreamflowPoolSnapshot) {
  if (!config.poolAddress || !config.tokenMint || !config.requiredAmountRaw || !config.rpcUrl) {
    throw new Error('Streamflow pool configuration is incomplete.');
  }
  if (pool.address !== config.poolAddress || pool.mint !== config.tokenMint) throw new Error('Streamflow pool address or mint mismatch.');
  if (pool.unstakePeriod !== STREAMFLOW_UNSTAKE_SECONDS) throw new Error('Streamflow pool must have a 7-day request-to-unstake period.');
  if (pool.minDuration !== 0 || pool.autoUnstake) throw new Error('Streamflow pool must allow an unlock request at any time.');
  if (!pool.freezeStakeMint) throw new Error('Streamflow receipt tokens must be frozen to prevent transferable Premium access.');
}

export function summarizeStreamflowPosition(config: StreamflowConfig, wallet: string, entries: StreamflowEntrySnapshot[]) {
  const matching = entries.filter(entry => entry.authority === wallet && entry.pool === config.poolAddress && entry.closedTs === 0 && entry.amountRaw > 0n && entry.duration === 0);
  const amountRaw = matching.reduce((sum, entry) => sum + entry.amountRaw, 0n);
  return {
    wallet,
    amountRaw: amountRaw.toString(),
    eligible: config.requiredAmountRaw !== null && amountRaw >= config.requiredAmountRaw,
    entries: matching.map(entry => ({
      address: entry.address,
      amountRaw: entry.amountRaw.toString(),
      status: entry.unstakeTs > 0 ? 'cooldown' as const : 'staked' as const,
      unlockAvailableAt: entry.unstakeTs > 0 ? new Date((entry.unstakeTs + STREAMFLOW_UNSTAKE_SECONDS) * 1000).toISOString() : null,
    })),
  };
}

/** Only inspect an explicitly configured pool. This never grants Premium or submits a transaction. */
export async function inspectStreamflowPosition(wallet: string, config = streamflowConfig()) {
  if (config.cluster !== 'devnet') throw new Error('Only devnet inspection is enabled.');
  if (!config.poolAddress || !config.tokenMint || !config.requiredAmountRaw) throw new Error('Devnet Streamflow pool is not configured.');
  const client = new SolanaStakingClient({ clusterUrl: config.rpcUrl, cluster: ICluster.Devnet, commitment: 'finalized' });
  const pool = await client.getStakePool(config.poolAddress);
  assertPremiumPool(config, {
    address: config.poolAddress,
    mint: pool.mint.toBase58(), stakeMint: pool.stakeMint.toBase58(),
    unstakePeriod: pool.unstakePeriod.toNumber(), minDuration: pool.minDuration.toNumber(), maxDuration: pool.maxDuration.toNumber(),
    freezeStakeMint: pool.freezeStakeMint, autoUnstake: pool.autoUnstake,
  });
  const owner = new PublicKey(wallet);
  const entries = await client.searchStakeEntries({ authority: owner, stakePool: new PublicKey(config.poolAddress) });
  return summarizeStreamflowPosition(config, owner.toBase58(), entries.map(entry => ({
    address: entry.publicKey.toBase58(), authority: entry.account.authority.toBase58(), pool: entry.account.stakePool.toBase58(),
    amountRaw: BigInt(entry.account.amount.toString()), duration: entry.account.duration.toNumber(),
    closedTs: entry.account.closedTs.toNumber(), unstakeTs: entry.account.unstakeTs.toNumber(),
  })));
}
