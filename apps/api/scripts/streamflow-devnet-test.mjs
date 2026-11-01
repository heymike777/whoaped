/** Devnet-only Streamflow smoke test. Never accepts a mainnet RPC or production mint. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BN from 'bn.js';
import { ICluster } from '@streamflow/common';
import { SolanaStakingClient } from '@streamflow/staking';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

const rpcUrl = process.env.STREAMFLOW_TEST_RPC || 'https://api.devnet.solana.com';
if (!new URL(rpcUrl).hostname.includes('devnet')) throw new Error('Refusing a non-devnet RPC.');
const keypairPath = resolve(process.env.STREAMFLOW_TEST_KEYPAIR_PATH || '../../files/private/streamflow-devnet-wallet.json');
const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const mint = new PublicKey(process.env.STREAMFLOW_TEST_MINT || '5HSZEmt1KXAQRf3sYWVY84B7WBr4AiQ9xnpSvxHwJTL6');
const action = process.argv[2] || 'inspect';
const execute = process.argv.includes('--execute');
const client = new SolanaStakingClient({ clusterUrl: rpcUrl, cluster: ICluster.Devnet, commitment: 'finalized' });
const connection = new Connection(rpcUrl, 'finalized');
const genesisHash = await connection.getGenesisHash();
if (genesisHash !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Refusing RPC: genesis hash is not Solana devnet.');
const invoker = { invoker: keypair };

async function poolAddress() {
  const value = process.env.STREAMFLOW_TEST_POOL;
  if (!value) throw new Error('Set STREAMFLOW_TEST_POOL to the created devnet pool address.');
  return new PublicKey(value);
}

async function submit(label, ixs) {
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ feePayer: keypair.publicKey, recentBlockhash: latest.blockhash }).add(...ixs);
  transaction.sign(keypair);
  const simulation = await connection.simulateTransaction(transaction, [keypair]);
  console.log(JSON.stringify({ action: label, simulationError: simulation.value.err, unitsConsumed: simulation.value.unitsConsumed, logs: simulation.value.logs }));
  if (simulation.value.err) throw new Error(`${label} simulation failed; transaction not sent.`);
  if (!execute) { console.log('Dry run only. Add --execute to submit this devnet transaction.'); return; }
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'finalized');
  if (confirmation.value.err) throw new Error(`${label} landed with error: ${JSON.stringify(confirmation.value.err)}`);
  console.log(JSON.stringify({ action: label, signature, cluster: 'devnet' }));
}

if (action === 'create-pool') {
  const { ixs, publicKey } = await client.prepareCreateStakePoolInstructions({
    mint, nonce: 0, maxWeight: new BN(1_000_000_000), minDuration: new BN(1), maxDuration: new BN(1),
    permissionless: false, freezeStakeMint: true, unstakePeriod: new BN(604800),
    maxTotalStakeCumulative: new BN(0), expiryTs: new BN(0), autoUnstake: false,
  }, invoker);
  console.log(JSON.stringify({ poolAddress: publicKey.toBase58(), mint: mint.toBase58(), authority: keypair.publicKey.toBase58() }));
  await submit(action, ixs);
} else if (action === 'inspect') {
  const address = await poolAddress();
  const pool = await client.getStakePool(address);
  const entries = await client.searchStakeEntries({ authority: keypair.publicKey, stakePool: address });
  console.log(JSON.stringify({ poolAddress: address.toBase58(), mint: pool.mint.toBase58(), stakeMint: pool.stakeMint.toBase58(), unstakePeriod: pool.unstakePeriod.toString(), minDuration: pool.minDuration.toString(), maxDuration: pool.maxDuration.toString(), freezeStakeMint: pool.freezeStakeMint, autoUnstake: pool.autoUnstake,
    entries: entries.map(({ publicKey, account }) => ({ address: publicKey.toBase58(), amountRaw: account.amount.toString(), duration: account.duration.toString(), unstakeTs: account.unstakeTs.toString(), closedTs: account.closedTs.toString() })) }));
} else if (action === 'stake') {
  const address = await poolAddress();
  const { ixs } = await client.prepareStakeInstructions({ nonce: 0, amount: new BN(1_000_000_000_000), duration: new BN(1), stakePool: address, stakePoolMint: mint }, invoker);
  await submit(action, ixs);
} else if (action === 'request-unstake') {
  const address = await poolAddress();
  const entries = await client.searchStakeEntries({ authority: keypair.publicKey, stakePool: address });
  if (entries.length !== 1) throw new Error(`Expected one stake entry, found ${entries.length}.`);
  const ix = await client.programs.stakePoolProgram.methods.requestUnstake().accounts({ stakePool: address, stakeEntry: entries[0].publicKey, authority: keypair.publicKey }).instruction();
  await submit(action, [ix]);
} else if (action === 'withdraw') {
  const address = await poolAddress();
  const { ixs } = await client.prepareUnstakeInstructions({ stakePool: address, stakePoolMint: mint, nonce: 0, shouldClose: false }, invoker);
  await submit(action, ixs);
} else throw new Error(`Unknown action: ${action}`);
