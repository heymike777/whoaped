import { PublicKey } from '@solana/web3.js';

export const STAKEFAST_PROGRAM_ID = new PublicKey('9ekJCKaNpSXKxYZTMhePd5otmQAVQzVDVskC6JZr6hVZ');
export const WHOAPED_MINT = 'AFkMcpbnwEg328181CCresbTTG52DexwKM7FFo9Hpump';
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const WHOAPED_STAKEFAST_VAULT = new PublicKey('9cDXG53DN4AW1zQeyExn1qeDvFyvRx5rzmUAYiv91Wyi');
const MAINNET_PROGRAM = new PublicKey('FBnvdpMLZFFPGuANzPHvgRoRdW6LpnkqTxB8o6ntBq2X');
const DEFAULT_PRO_MINIMUM_RAW = '1000000000000';

export function stakeFastConfig(env = process.env) {
  if (env.STAKEFAST_DEVNET_ENABLED !== 'true') {
    return {
      cluster: 'mainnet' as const,
      genesisHash: MAINNET_GENESIS_HASH,
      rpcUrl: env.STAKEFAST_MAINNET_RPC_URL || (env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`
        : 'https://api.mainnet-beta.solana.com'),
      program: MAINNET_PROGRAM,
      vault: WHOAPED_STAKEFAST_VAULT,
      mint: new PublicKey(WHOAPED_MINT),
      proMinimumRaw: BigInt(DEFAULT_PRO_MINIMUM_RAW),
    };
  }
  if (!env.STAKEFAST_DEVNET_PREMIUM_VAULT || !env.STAKEFAST_DEVNET_PREMIUM_MINT) {
    throw new Error('StakeFast devnet premium vault and mint are required.');
  }
  const proMinimumRaw = env.STAKEFAST_DEVNET_PRO_MINIMUM_RAW ?? DEFAULT_PRO_MINIMUM_RAW;
  if (!/^\d{1,20}$/.test(proMinimumRaw) || BigInt(proMinimumRaw) > 0xffffffffffffffffn) {
    throw new Error('StakeFast PRO minimum must be an unsigned integer in token base units.');
  }
  return {
    cluster: 'devnet' as const,
    genesisHash: DEVNET_GENESIS_HASH,
    rpcUrl: env.STAKEFAST_DEVNET_RPC_URL || DEVNET_RPC,
    program: STAKEFAST_PROGRAM_ID,
    vault: new PublicKey(env.STAKEFAST_DEVNET_PREMIUM_VAULT),
    mint: new PublicKey(env.STAKEFAST_DEVNET_PREMIUM_MINT),
    proMinimumRaw: BigInt(proMinimumRaw),
  };
}

export type StakeFastConfig = ReturnType<typeof stakeFastConfig>;

export function seekerStakingOffer() {
  const available = stakeFastConfig().cluster === 'mainnet';
  return {
    chain: 'solana' as const,
    provider: 'stakefast' as const,
    status: available ? 'live' as const : 'coming_soon' as const,
    tokenSymbol: 'WHOAPED',
    tokenMint: WHOAPED_MINT,
    amount: Number(BigInt(DEFAULT_PRO_MINIMUM_RAW) / 1_000_000n),
    cooldownSeconds: 604_800,
    cluster: 'mainnet' as const,
    poolAddress: available ? WHOAPED_STAKEFAST_VAULT.toBase58() : null,
    available,
  };
}
