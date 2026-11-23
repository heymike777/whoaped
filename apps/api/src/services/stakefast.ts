import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { Connection, PublicKey, VersionedTransaction, type AccountInfo } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import { MongoServerError, type ClientSession } from 'mongodb';
import { createStakeFastClient, type StakeFastVaultStats } from '@stakefast/sdk';
import type { StakeFastConfig } from '../config/stakefast.js';
import { collections, type Collections } from '../db.js';
import { canonicalAccountId, withAccountMutation } from './accounts.js';
import { decodeStakeFastPosition, decodeStakeFastVault, positionAddress } from './stakefast-accounts.js';

export class StakeFastLinkError extends Error {}
export class StakeFastPreflightUnavailableError extends Error {}
const publicKeyPrefix = Buffer.from('302a300506032b6570032100', 'hex');

export function parseStakeFastWallet(value: string) {
  try {
    const wallet = new PublicKey(value);
    if (wallet.toBase58() === value && PublicKey.isOnCurve(wallet.toBytes())) return wallet;
  } catch {
    // Reject malformed and noncanonical wallet addresses consistently.
  }
  throw new StakeFastLinkError('Enter a valid Solana signing wallet.');
}

export async function createStakeFastChallenge(userId: string, wallet: string, config: StakeFastConfig) {
  const address = parseStakeFastWallet(wallet).toBase58();
  return withAccountMutation(userId, async (db, session, accountId) => {
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const message = [
      'WhoAped asks you to link this wallet for StakeFast staking.',
      `Wallet: ${address}`,
      `Account: ${accountId}`,
      `Network: Solana ${config.cluster}`,
      `Vault: ${config.vault.toBase58()}`,
      `Nonce: ${challengeId}`,
      `Expires: ${expiresAt.toISOString()}`,
    ].join('\n');
    await db.stakeFastChallenges.replaceOne({ _id: accountId }, {
      challengeId, message, wallet: address, vault: config.vault.toBase58(), expiresAt,
    }, { session, upsert: true });
    return { challengeId, message, messageBase64: Buffer.from(message, 'utf8').toString('base64'), expiresAt };
  });
}

export async function linkStakeFastWallet(userId: string, challengeId: string, signature: string, config: StakeFastConfig) {
  try {
    return await withAccountMutation(userId, async (db, session, accountId) => {
      const challenge = await db.stakeFastChallenges.findOne({
        _id: accountId, challengeId, vault: config.vault.toBase58(), expiresAt: { $gt: new Date() },
      }, { session });
      if (!challenge) throw new StakeFastLinkError('This wallet challenge expired or was used.');
      const wallet = new PublicKey(challenge.wallet);
      const key = createPublicKey({ key: Buffer.concat([publicKeyPrefix, wallet.toBuffer()]), format: 'der', type: 'spki' });
      const proof = Buffer.from(signature, 'base64');
      if (proof.length !== 64 || proof.toString('base64') !== signature || !verify(null, Buffer.from(challenge.message), key, proof)) {
        throw new StakeFastLinkError('The signature does not match this wallet challenge.');
      }
      await db.stakeFastWallets.updateOne({ _id: challenge.wallet, userId: accountId }, {
        $setOnInsert: { userId: accountId, linkedAt: new Date() },
      }, { session, upsert: true });
      await db.stakeFastChallenges.deleteOne({ _id: accountId, challengeId }, { session });
      return { wallet: challenge.wallet };
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new StakeFastLinkError('This wallet is already linked to another WhoAped account.');
    }
    throw error;
  }
}

export async function unlinkStakeFastWallet(userId: string, wallet: string) {
  const address = parseStakeFastWallet(wallet).toBase58();
  await withAccountMutation(userId, async (db, session, accountId) => {
    await db.stakeFastWallets.deleteOne({ _id: address, userId: accountId }, { session });
    await db.stakeFastChallenges.deleteOne({ _id: accountId, wallet: address }, { session });
  });
}

let rpc: { key: string; connection: Promise<Connection> } | undefined;
async function stakeFastConnection(config: StakeFastConfig) {
  const key = `${config.cluster}:${config.rpcUrl}`;
  if (rpc?.key === key) return rpc.connection;
  const connection = new Connection(config.rpcUrl, {
    commitment: 'finalized',
    disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4_000) }),
  });
  const verified = connection.getGenesisHash().then(hash => {
    if (hash !== config.genesisHash) throw new Error('StakeFast RPC is on the wrong network.');
    return connection;
  }).catch(error => {
    if (rpc?.connection === verified) rpc = undefined;
    throw error;
  });
  rpc = { key, connection: verified };
  return verified;
}

async function readStakeFastStatus(config: StakeFastConfig, wallets: PublicKey[]) {
  const connection = await stakeFastConnection(config);
  const positions: Array<{ wallet: string; amountRaw: string; unlockAt: string | null; qualifies: boolean }> = [];
  let settings;
  // Each RPC response contains the vault and its positions at the same finalized slot.
  for (let offset = 0; offset < Math.max(1, wallets.length); offset += 99) {
    const batch = wallets.slice(offset, offset + 99);
    const [vaultInfo, ...infos] = await connection.getMultipleAccountsInfo([
      config.vault, ...batch.map(wallet => positionAddress(config.program, config.vault, wallet)),
    ], 'finalized');
    const vault = decodeStakeFastVault(vaultInfo, config.program, config.vault);
    if (!vault.mint.equals(config.mint) || !vault.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new Error('StakeFast Premium vault does not match its configured Token-2022 mint.');
    }
    settings = { cooldownSeconds: vault.cooldownSeconds.toString(), depositsPaused: vault.depositsPaused };
    for (const [index, wallet] of batch.entries()) {
      const position = decodeStakeFastPosition(infos[index], config.program, config.vault, wallet);
      positions.push({
        wallet: wallet.toBase58(),
        amountRaw: (position?.amount ?? 0n).toString(),
        unlockAt: position?.unlockAt ? position.unlockAt.toString() : null,
        qualifies: !!position && position.amount >= config.proMinimumRaw && position.unlockAt === 0n,
      });
    }
  }
  return {
    cluster: config.cluster,
    program: config.program.toBase58(),
    vault: config.vault.toBase58(),
    mint: config.mint.toBase58(),
    minimumAmountRaw: config.proMinimumRaw.toString(),
    ...settings,
    positions,
    qualifiesForPremium: positions.some(position => position.qualifies),
  };
}

export async function stakeFastStatus(userId: string, config: StakeFastConfig) {
  const db = await collections();
  const accountId = await canonicalAccountId(userId, db);
  const wallets = await db.stakeFastWallets.distinct('_id', { userId: accountId });
  return readStakeFastStatus(config, wallets.map(wallet => new PublicKey(wallet)));
}

function stakeFastSource(owner: PublicKey, mint: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

function stakeFastSourceBalance(source: PublicKey, info: AccountInfo<Buffer> | null, owner: PublicKey, mint: PublicKey) {
  if (!info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return 0n;
  const tokens = unpackAccount(source, info, TOKEN_2022_PROGRAM_ID);
  return tokens.isInitialized && !tokens.isFrozen && tokens.mint.equals(mint) && tokens.owner.equals(owner) ? tokens.amount : 0n;
}

export async function stakeFastWalletBalances(wallet: string, config: StakeFastConfig) {
  const owner = parseStakeFastWallet(wallet);
  const source = stakeFastSource(owner, config.mint);
  const connection = await stakeFastConnection(config);
  const [sol, tokens] = await connection.getMultipleAccountsInfo([owner, source], 'confirmed');
  const solLamports = sol?.lamports ?? 0;
  if (!Number.isSafeInteger(solLamports) || solLamports < 0) throw new Error('Invalid Solana balance.');
  return {
    wallet: owner.toBase58(),
    mint: config.mint.toBase58(),
    cluster: config.cluster,
    whoapedAmountRaw: stakeFastSourceBalance(source, tokens, owner, config.mint).toString(),
    solLamports: solLamports.toString(),
  };
}

type StakeFastAction = { action: 'stake'; amountRaw: string } | { action: 'unstake' | 'cancel' | 'claim' };
let sdk: { key: string; client: ReturnType<typeof createStakeFastClient> } | undefined;
let publicVaultStats: { rpcUrl: string; expiresAt: number; request: Promise<StakeFastVaultStats> } | undefined;

function stakeFastClient(config: StakeFastConfig) {
  const key = `${config.cluster}:${config.rpcUrl}`;
  if (sdk?.key !== key) sdk = { key, client: createStakeFastClient({ cluster: config.cluster, rpcUrl: config.rpcUrl }) };
  return sdk.client;
}

export async function whoApedVaultTotal(config: StakeFastConfig) {
  if (config.cluster !== 'mainnet') throw new Error('The public staking total requires mainnet.');
  const now = Date.now();
  // Share one finalized position scan across visitors during each cache window.
  if (publicVaultStats?.rpcUrl !== config.rpcUrl || publicVaultStats.expiresAt <= now) {
    publicVaultStats = {
      rpcUrl: config.rpcUrl,
      expiresAt: now + 60_000,
      request: stakeFastClient(config).getVaultStats({ vault: config.vault.toBase58() }),
    };
  }
  const stats = await publicVaultStats.request;
  if (stats.mint !== config.mint.toBase58()) throw new Error('The staking vault uses a different mint.');
  return { amountRaw: stats.totalAmountRaw, decimals: stats.decimals, slot: stats.slot };
}

const insufficientWhoAped = 'Not enough WHOAPED in this wallet to stake that amount.';

async function checkStakeFastFunds(config: StakeFastConfig, owner: PublicKey, input: StakeFastAction, transaction: string) {
  const result = await (async () => {
    const connection = await stakeFastConnection(config);
    if (input.action === 'stake') {
      // StakeFast debits the owner's associated Token-2022 account for this mint.
      const source = stakeFastSource(owner, config.mint);
      const info = await connection.getAccountInfo(source, 'confirmed');
      if (stakeFastSourceBalance(source, info, owner, config.mint) < BigInt(input.amountRaw)) {
        return null;
      }
    }
    const unsigned = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
    // Simulation checks the actual on-chain fee and any account creation rent.
    const [simulation, fee] = await Promise.all([
      connection.simulateTransaction(unsigned, { commitment: 'confirmed', sigVerify: false }),
      input.action === 'claim' && config.cluster === 'mainnet'
        ? connection.getFeeForMessage(unsigned.message, 'confirmed').catch(() => null)
        : null,
    ]);
    const lamports = fee?.value;
    return { ...simulation.value, networkFeeLamports: typeof lamports === 'number' && Number.isSafeInteger(lamports) && lamports >= 0 ? String(lamports) : null };
  })().catch(() => {
    throw new StakeFastPreflightUnavailableError('Could not check wallet balances on Solana. Try again.');
  });
  if (!result) throw new Error(insufficientWhoAped);
  if (!result.err) return result.networkFeeLamports;
  const { err, logs } = result;
  if (err === 'AccountNotFound' || err === 'InsufficientFundsForFee'
    || (typeof err === 'object' && 'InsufficientFundsForRent' in err)
    || logs?.some(log => log.includes('Transfer: insufficient lamports'))) {
    throw new Error('Not enough SOL for staking fees, network fees, or account creation.');
  }
  if (input.action === 'stake' && logs?.includes(`Program ${TOKEN_2022_PROGRAM_ID.toBase58()} failed: custom program error: 0x1`)) {
    throw new Error(insufficientWhoAped);
  }
  throw new Error('Solana could not simulate this transaction. Refresh your staking position and try again.');
}

export async function prepareStakeFastAction(userId: string, wallet: string, input: StakeFastAction, config: StakeFastConfig) {
  const owner = parseStakeFastWallet(wallet);
  const address = owner.toBase58();
  const db = await collections();
  const accountId = await canonicalAccountId(userId, db);
  if (!await db.stakeFastWallets.findOne({ _id: address, userId: accountId })) {
    throw new StakeFastLinkError('Connect this wallet to your WhoAped account first.');
  }
  const client = stakeFastClient(config);
  const query = { wallet: address, vault: config.vault.toBase58(), mint: config.mint.toBase58() };
  const buildPositionAction = {
    unstake: client.buildUnstakeTransaction,
    cancel: client.buildCancelUnstakeTransaction,
    claim: client.buildClaimTransaction,
  };
  const prepared = input.action === 'stake'
    ? await client.buildStakeTransaction({ ...query, amountRaw: input.amountRaw })
    : await buildPositionAction[input.action](query);
  const networkFeeLamports = await checkStakeFastFunds(config, owner, input, prepared.transaction);
  return {
    ...prepared, preflightChecked: true,
    ...(prepared.withdrawal ? { withdrawal: { ...prepared.withdrawal, networkFeeLamports } } : {}),
  };
}

export async function stakeFastConfirmation(signature: string, lastValidBlockHeight: number, config: StakeFastConfig) {
  const connection = await stakeFastConnection(config);
  const { value: [status] } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  if (status?.err) return 'failed' as const;
  if (status?.confirmationStatus === 'finalized') return 'finalized' as const;
  if (!status && await connection.getBlockHeight('finalized') > lastValidBlockHeight) return 'expired' as const;
  return 'pending' as const;
}

export async function stakeFastPremiumAccess(userId: string, config: StakeFastConfig, db: Collections, session?: ClientSession) {
  const wallets = await db.stakeFastWallets.distinct('_id', { userId }, { session });
  if (!wallets.length) return false;
  try {
    return (await readStakeFastStatus(config, wallets.map(wallet => new PublicKey(wallet)))).qualifiesForPremium;
  } catch {
    // A missing or unverified chain state cannot extend a stake-based grant.
    return false;
  }
}
