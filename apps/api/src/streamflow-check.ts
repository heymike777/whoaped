import { ICluster } from '@streamflow/common';
import { SolanaStakingClient } from '@streamflow/staking';
import { STREAMFLOW_UNSTAKE_SECONDS, streamflowConfig } from './config/staking.js';
import { assertPremiumPool } from './services/streamflow-staking.js';

const config = streamflowConfig();
if (config.cluster !== 'devnet') throw new Error('This check is devnet-only; refusing mainnet.');
const client = new SolanaStakingClient({ clusterUrl: config.rpcUrl, cluster: ICluster.Devnet, commitment: 'finalized' });
const programId = client.getCurrentProgramId('stakePoolProgram').toBase58();
const program = await client.connection.getAccountInfo(client.getCurrentProgramId('stakePoolProgram'), 'finalized');
if (!program?.executable) throw new Error('Streamflow staking program is not executable on devnet.');
console.log(JSON.stringify({ cluster: 'devnet', programId, programReady: true, configuredPool: Boolean(config.poolAddress) }));
if (config.poolAddress) {
  const pool = await client.getStakePool(config.poolAddress);
  assertPremiumPool(config, {
    address: config.poolAddress, mint: pool.mint.toBase58(), stakeMint: pool.stakeMint.toBase58(),
    unstakePeriod: pool.unstakePeriod.toNumber(), minDuration: pool.minDuration.toNumber(), maxDuration: pool.maxDuration.toNumber(),
    freezeStakeMint: pool.freezeStakeMint, autoUnstake: pool.autoUnstake,
  });
  console.log(JSON.stringify({ poolReady: true, poolAddress: config.poolAddress, tokenMint: config.tokenMint,
    unstakePeriod: STREAMFLOW_UNSTAKE_SECONDS, freezeStakeMint: pool.freezeStakeMint }));
}
