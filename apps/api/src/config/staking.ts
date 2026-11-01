/** Public launch switch is intentionally hard-off until the token, pool and wallet proof flow are approved. */
export const STAKING_LIVE = false;
export const STREAMFLOW_UNSTAKE_SECONDS = 7 * 24 * 60 * 60;
export const PREMIUM_TOKEN_AMOUNT = 1_000_000;

export type StreamflowCluster = 'devnet' | 'mainnet';
export type StreamflowConfig = {
  cluster: StreamflowCluster;
  rpcUrl: string;
  poolAddress: string | null;
  tokenMint: string | null;
  tokenSymbol: string;
  requiredAmountRaw: bigint | null;
};

/** Devnet may be configured independently for read-only verification; no mainnet write is possible here. */
export function streamflowConfig(env: NodeJS.ProcessEnv = process.env): StreamflowConfig {
  const cluster: StreamflowCluster = env.STREAMFLOW_CLUSTER === 'mainnet' ? 'mainnet' : 'devnet';
  const rawAmount = env.STREAMFLOW_REQUIRED_AMOUNT_RAW;
  return {
    cluster,
    rpcUrl: env.STREAMFLOW_RPC_URL || (cluster === 'devnet' ? 'https://api.devnet.solana.com' : ''),
    poolAddress: env.STREAMFLOW_POOL_ADDRESS || null,
    tokenMint: env.STREAMFLOW_TOKEN_MINT || null,
    tokenSymbol: env.STREAMFLOW_TOKEN_SYMBOL || 'TOKEN',
    requiredAmountRaw: rawAmount && /^[1-9][0-9]*$/.test(rawAmount) ? BigInt(rawAmount) : null,
  };
}

export function stakingOffer(env: NodeJS.ProcessEnv = process.env) {
  const config = streamflowConfig(env);
  return {
    chain: 'solana' as const,
    provider: 'streamflow' as const,
    status: 'coming_soon' as const,
    tokenSymbol: config.tokenSymbol,
    tokenMint: config.tokenMint,
    amount: PREMIUM_TOKEN_AMOUNT,
    cooldownSeconds: STREAMFLOW_UNSTAKE_SECONDS,
    cluster: config.cluster,
    poolAddress: null,
    available: STAKING_LIVE,
  };
}
