import { base64 } from '@scure/base';
import {
  addressBytes, clockUnixTimestamp, decodePosition, decodeVault, isOnCurve, positionAddress, CLOCK_ADDRESS,
  POSITION_DISCRIMINATOR, POSITION_SIZE, POSITION_VAULT_OFFSET, POSITION_WALLET_OFFSET,
} from './accounts.js';
import {
  positionInstructions, serializePositionTransaction, stakeAmount, withdrawalAmounts,
  STAKEFAST_ACTION_FEE_LAMPORTS, STAKEFAST_WITHDRAWAL_FEE_BPS,
} from './transactions.js';

const clusters = {
  devnet: {
    genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    program: '9ekJCKaNpSXKxYZTMhePd5otmQAVQzVDVskC6JZr6hVZ',
    rpcUrl: 'https://api.devnet.solana.com',
  },
  mainnet: {
    genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    program: 'FBnvdpMLZFFPGuANzPHvgRoRdW6LpnkqTxB8o6ntBq2X',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },
};
const tokenPrograms = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const finalized = { commitment: 'finalized' };
const binary = { ...finalized, encoding: 'base64' };

function binaryAccount(account) {
  if (account === null) return null;
  if (typeof account?.owner !== 'string' || typeof account.executable !== 'boolean' ||
    account.data?.[1] !== 'base64' || typeof account.data[0] !== 'string') {
    throw new Error('Invalid Solana account response.');
  }
  return { owner: account.owner, executable: account.executable, data: base64.decode(account.data[0]) };
}

function stakeTotals(positions) {
  let active = 0n;
  let unstaking = 0n;
  for (const position of positions) {
    if (position.unlockAt === 0n) active += position.amount;
    else unstaking += position.amount;
  }
  return {
    totalAmountRaw: (active + unstaking).toString(),
    activeAmountRaw: active.toString(),
    unstakingAmountRaw: unstaking.toString(),
  };
}

export function createStakeFastClient(options) {
  const { cluster, fetch: fetchRpc = globalThis.fetch, timeoutMs = 10_000 } = options;
  if (cluster !== 'devnet' && cluster !== 'mainnet') throw new Error('Select StakeFast devnet or mainnet.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid RPC timeout.');
  const { program, genesis } = clusters[cluster];
  const rpcUrl = options.rpcUrl ?? clusters[cluster].rpcUrl;
  let requestId = 0;
  let ready;

  async function rpc(method, params = []) {
    const id = ++requestId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let body;
    try {
      response = await fetchRpc(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      if (response.ok) body = await response.json();
    } catch {
      throw new Error(`StakeFast RPC request failed for ${method}.`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`StakeFast RPC returned HTTP ${response.status} for ${method}.`);
    if (body?.id !== id || body.error || !('result' in body)) {
      const code = Number.isInteger(body?.error?.code) ? ` (${body.error.code})` : '';
      throw new Error(`StakeFast RPC could not complete ${method}${code}.`);
    }
    return body.result;
  }

  function verifyDeployment() {
    ready ??= (async () => {
      if (await rpc('getGenesisHash') !== genesis) throw new Error(`StakeFast RPC is on the wrong cluster for ${cluster}.`);
      const { value } = await rpc('getAccountInfo', [program, { ...binary, dataSlice: { offset: 0, length: 0 } }]);
      if (value?.executable !== true) throw new Error(`StakeFast is not deployed on ${cluster}.`);
    })().catch(error => {
      ready = undefined;
      throw error;
    });
    return ready;
  }

  async function accounts(addresses, minContextSlot) {
    const { context, value } = await rpc('getMultipleAccounts', [addresses, { ...binary, minContextSlot }]);
    if (value?.length !== addresses.length) throw new Error('Incomplete StakeFast account response.');
    return { slot: context.slot, infos: value.map(binaryAccount) };
  }

  async function readVaultPosition(wallet, vault, mint, includeClock = false) {
    const positionKey = positionAddress(program, vault, wallet);
    const addresses = includeClock ? [vault, positionKey, CLOCK_ADDRESS] : [vault, positionKey];
    const { slot, infos: [vaultInfo, positionInfo, clock] } = await accounts(addresses);
    const settings = decodeVault(vaultInfo, program, vault);
    if (mint && settings.mint !== mint) throw new Error('The StakeFast vault uses a different mint.');
    const position = positionInfo ? decodePosition(positionInfo, program, wallet, positionKey) : null;
    return { slot, settings, position, clock };
  }

  async function byVault(wallet, vault, mint) {
    const { slot, settings, position } = await readVaultPosition(wallet, vault, mint);
    return {
      mint: settings.mint, slot, settings: [settings],
      positions: position ? [position] : [],
    };
  }

  async function scanPositions({ wallet, vault }) {
    const { context: { slot }, value } = await rpc('getProgramAccounts', [program, {
      ...binary, withContext: true,
      filters: [
        { dataSize: POSITION_SIZE },
        { memcmp: { offset: 0, bytes: POSITION_DISCRIMINATOR } },
        { memcmp: { offset: vault ? POSITION_VAULT_OFFSET : POSITION_WALLET_OFFSET, bytes: vault ?? wallet } },
      ],
    }]);
    const seen = new Set();
    const positions = value.map(({ pubkey, account }) => {
      const position = decodePosition(binaryAccount(account), program, wallet, pubkey);
      if (vault && position.vault !== vault) throw new Error('StakeFast position belongs to a different vault.');
      if (seen.has(pubkey)) throw new Error('Duplicate StakeFast position in RPC response.');
      seen.add(pubkey);
      return position;
    });
    return { slot, positions };
  }

  async function byMint(wallet, mint) {
    const { slot, positions: walletPositions } = await scanPositions({ wallet });
    const positionsByVault = new Map(walletPositions.map(position => [position.vault, position]));
    const vaults = [...positionsByVault.keys()].sort();
    const positions = [];
    const settings = [];
    // Position amounts share the scan's slot. Vault mint and token program are immutable.
    for (let start = 0; start < vaults.length; start += 100) {
      const batch = vaults.slice(start, start + 100);
      const { infos } = await accounts(batch, slot);
      for (const [index, vault] of batch.entries()) {
        const config = decodeVault(infos[index], program, vault);
        if (config.mint === mint) {
          settings.push(config);
          positions.push(positionsByVault.get(vault));
        }
      }
    }
    return { mint, slot, settings, positions };
  }

  async function readMintDecimals(mint, minContextSlot, settings) {
    const { value } = await rpc('getAccountInfo', [mint, {
      ...finalized, encoding: 'jsonParsed', minContextSlot,
    }]);
    const parsed = value?.data?.parsed;
    const decimals = parsed?.info?.decimals;
    if (!tokenPrograms.has(value?.owner) || value.executable !== false || parsed?.type !== 'mint' ||
      !parsed.info.isInitialized || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error('Invalid SPL token mint.');
    }
    if (settings.some(config => config.tokenProgram !== value.owner)) {
      throw new Error('StakeFast vault token program does not match the mint.');
    }
    return decimals;
  }

  async function getStakedAmount({ wallet, mint, vault }) {
    addressBytes(wallet);
    if (mint !== undefined) addressBytes(mint);
    if (vault !== undefined) addressBytes(vault);
    if (!mint && !vault) throw new Error('Specify a mint or a StakeFast vault.');
    await verifyDeployment();
    const result = vault ? await byVault(wallet, vault, mint) : await byMint(wallet, mint);
    const decimals = await readMintDecimals(result.mint, result.slot, result.settings);
    const positions = result.positions.map(position => ({
      vault: position.vault, amountRaw: position.amount.toString(),
      unlockAt: position.unlockAt === 0n ? null : position.unlockAt.toString(),
    }));
    return {
      cluster, program, wallet, mint: result.mint, vault: vault ?? null, slot: result.slot, decimals,
      ...stakeTotals(result.positions), positions,
    };
  }

  async function getVaultStats({ vault }) {
    addressBytes(vault);
    await verifyDeployment();
    const { slot, positions } = await scanPositions({ vault });
    const { infos: [vaultInfo] } = await accounts([vault], slot);
    const settings = decodeVault(vaultInfo, program, vault);
    const decimals = await readMintDecimals(settings.mint, slot, [settings]);
    return {
      cluster, program, vault, mint: settings.mint, slot, decimals,
      ...stakeTotals(positions), positionCount: positions.length,
    };
  }

  async function buildPositionTransaction(action, { wallet, vault, mint, amountRaw }) {
    if (!isOnCurve(addressBytes(wallet))) throw new Error('StakeFast transactions require a Solana signing wallet.');
    addressBytes(vault);
    if (mint !== undefined) addressBytes(mint);
    const amount = action === 'lock' ? stakeAmount(amountRaw) : undefined;
    await verifyDeployment();
    const { slot, settings, position, clock } = await readVaultPosition(wallet, vault, mint, action === 'withdraw');
    if (!tokenPrograms.has(settings.tokenProgram)) throw new Error('Unsupported StakeFast vault token program.');
    if (action === 'lock') {
      if (settings.depositsPaused) throw new Error('Deposits are paused for this StakeFast vault.');
      if (position?.unlockAt) throw new Error('Cancel unstaking before adding tokens.');
      if (position) stakeAmount(position.amount + amount);
    } else {
      if (!position) throw new Error('No StakeFast position exists for this wallet and vault.');
      if (action === 'request_unlock' && position.unlockAt !== 0n) throw new Error('Unstaking was already requested.');
      if (action === 'cancel_unlock' && position.unlockAt === 0n) throw new Error('There is no pending unstake request.');
      if (action === 'withdraw') {
        if (position.unlockAt === 0n) throw new Error('Request unstake before claiming.');
        if (clockUnixTimestamp(clock) < position.unlockAt) {
          throw new Error(`StakeFast cooldown is active until Unix time ${position.unlockAt}.`);
        }
      }
    }
    const instructions = positionInstructions({
      program, action, wallet, vault, mint: settings.mint, tokenProgram: settings.tokenProgram, amountRaw: amount,
    });
    // WhoAped's production fee review must use the same position snapshot as the builder.
    const withdrawal = action === 'withdraw' && cluster === 'mainnet' ? withdrawalAmounts(position.amount) : null;
    const { value: lifetime } = await rpc('getLatestBlockhash', [{ commitment: 'confirmed', minContextSlot: slot }]);
    return { cluster, vault, mint: settings.mint, transaction: serializePositionTransaction(instructions, wallet, lifetime),
      blockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight,
      ...(withdrawal ? {
        withdrawal: {
          wallet, grossRaw: withdrawal.gross.toString(), feeRaw: withdrawal.fee.toString(), netRaw: withdrawal.net.toString(),
          feeBps: STAKEFAST_WITHDRAWAL_FEE_BPS, actionFeeLamports: STAKEFAST_ACTION_FEE_LAMPORTS.toString(),
        },
      } : {}) };
  }

  return {
    getStakedAmount,
    getVaultStats,
    buildStakeTransaction: input => buildPositionTransaction('lock', input),
    buildUnstakeTransaction: input => buildPositionTransaction('request_unlock', input),
    buildCancelUnstakeTransaction: input => buildPositionTransaction('cancel_unlock', input),
    buildClaimTransaction: input => buildPositionTransaction('withdraw', input),
  };
}
