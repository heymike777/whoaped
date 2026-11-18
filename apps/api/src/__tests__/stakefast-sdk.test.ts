import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createStakeFastClient } from '@stakefast/sdk';
import { STAKEFAST_FEE_RECIPIENT } from '@stakefast/sdk/transactions';
import { vi, describe, expect, it } from 'vitest';
import { DEVNET_GENESIS_HASH, STAKEFAST_PROGRAM_ID } from '../config/stakefast.js';
import { anchorDiscriminator, vaultAddress } from '../services/stakefast-accounts.js';

const program = STAKEFAST_PROGRAM_ID;
const wallet = Keypair.fromSeed(Buffer.alloc(32, 1)).publicKey;
const admin = Keypair.fromSeed(Buffer.alloc(32, 2)).publicKey;
const mint = Keypair.fromSeed(Buffer.alloc(32, 3)).publicKey;
const otherMint = Keypair.fromSeed(Buffer.alloc(32, 4)).publicKey;
const otherWallet = Keypair.fromSeed(Buffer.alloc(32, 5)).publicKey;

const account = (data: Buffer) => ({ owner: program.toBase58(), executable: false, data: [data.toString('base64'), 'base64'] });
function fixture(id: bigint, amount: bigint, unlockAt = 0n, token = mint, tokenProgram = TOKEN_2022_PROGRAM_ID, owner = wallet) {
  const vault = vaultAddress(program, admin, id);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from('position'), vault.toBuffer(), owner.toBuffer()], program);
  const vaultData = Buffer.alloc(130);
  anchorDiscriminator('account', 'Vault').copy(vaultData);
  admin.toBuffer().copy(vaultData, 8);
  token.toBuffer().copy(vaultData, 40);
  tokenProgram.toBuffer().copy(vaultData, 72);
  vaultData.writeBigUInt64LE(id, 104);
  vaultData.writeBigUInt64LE(1_000_000_000_000n, 112); // Legacy vault minimum.
  vaultData.writeBigInt64LE(604_800n, 120);
  const positionData = Buffer.alloc(88);
  anchorDiscriminator('account', 'Position').copy(positionData);
  vault.toBuffer().copy(positionData, 8);
  owner.toBuffer().copy(positionData, 40);
  positionData.writeBigUInt64LE(amount, 72);
  positionData.writeBigInt64LE(unlockAt, 80);
  return { vault: vault.toBase58(), position: position.toBase58(), vaultInfo: account(vaultData), positionInfo: account(positionData) };
}

const active = fixture(1n, 9_007_199_254_740_993n);
const unstaking = fixture(2n, 20n, 1_750_000_000n);
const unrelated = fixture(3n, 99n, 0n, otherMint);
const legacy = fixture(4n, 100n, 0n, otherMint, TOKEN_PROGRAM_ID);
const walletAddress = wallet.toBase58();
const mintAddress = mint.toBase58();
const blockhash = admin.toBase58();
const clockAddress = SYSVAR_CLOCK_PUBKEY.toBase58();

function setup(options: { positions?: typeof active[]; missingPosition?: boolean; wrongCluster?: boolean; missingProgram?: boolean; unixTime?: bigint } = {}) {
  const accounts = new Map([active, unstaking, unrelated, legacy].flatMap(item => [
    [item.vault, item.vaultInfo] as const,
    [item.position, options.missingPosition ? null : item.positionInfo] as const,
  ]));
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(options.unixTime ?? 1_750_000_000n, 32);
  accounts.set(clockAddress, { ...account(clock), owner: 'Sysvar1111111111111111111111111111111111111' });
  const queries: Array<{ method: string; params: unknown[] }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    queries.push({ method, params });
    let result;
    switch (method) {
      case 'getGenesisHash': result = options.wrongCluster ? 'wrong' : DEVNET_GENESIS_HASH; break;
      case 'getAccountInfo':
        result = params[0] === program.toBase58()
          ? { value: options.missingProgram ? null : { executable: true } }
          : { value: { owner: TOKEN_2022_PROGRAM_ID.toBase58(), executable: false,
            data: { parsed: { type: 'mint', info: { decimals: 6, isInitialized: true } } } } };
        break;
      case 'getMultipleAccounts':
        result = { context: { slot: 31 }, value: params[0].map((address: string) => accounts.get(address) ?? null) };
        break;
      case 'getProgramAccounts':
        result = { context: { slot: 30 }, value: (options.positions ?? [active, unstaking, unrelated]).map(item => ({
          pubkey: item.position, account: item.positionInfo,
        })) };
        break;
      case 'getLatestBlockhash': result = { value: { blockhash, lastValidBlockHeight: 91 } }; break;
      default: throw new Error(`Unexpected RPC method ${method}`);
    }
    return Response.json({ id, jsonrpc: '2.0', result });
  });
  return { client: createStakeFastClient({ cluster: 'devnet', fetch }), queries };
}

describe('StakeFast SDK', () => {
  it('aggregates one mint across vaults exactly and excludes unstaking from active stake', async () => {
    const { client, queries } = setup();
    const result = await client.getStakedAmount({ wallet: walletAddress, mint: mintAddress });
    expect(result).toMatchObject({
      mint: mintAddress, vault: null, slot: 30, decimals: 6,
      totalAmountRaw: '9007199254741013', activeAmountRaw: '9007199254740993', unstakingAmountRaw: '20',
    });
    expect(result.positions).toHaveLength(2);
    expect(result.positions).toContainEqual({ vault: unstaking.vault, amountRaw: '20', unlockAt: '1750000000' });
    expect(queries.find(query => query.method === 'getProgramAccounts')?.params[1]).toMatchObject({
      commitment: 'finalized', withContext: true, filters: expect.arrayContaining([{ memcmp: { offset: 40, bytes: walletAddress } }]),
    });
    expect(queries.find(query => query.method === 'getMultipleAccounts')?.params[1]).toMatchObject({ minContextSlot: 30 });
  });

  it('derives a single position from a vault and checks an explicit mint', async () => {
    const { client, queries } = setup();
    await expect(client.getStakedAmount({ wallet: walletAddress, vault: active.vault })).resolves.toMatchObject({
      mint: mintAddress, vault: active.vault, slot: 31, totalAmountRaw: '9007199254740993', unstakingAmountRaw: '0',
    });
    expect(queries.some(query => query.method === 'getProgramAccounts')).toBe(false);
    expect(queries.find(query => query.method === 'getMultipleAccounts')?.params[0]).toEqual([active.vault, active.position]);
    await expect(client.getStakedAmount({ wallet: walletAddress, vault: active.vault, mint: otherMint.toBase58() })).rejects.toThrow('different mint');
    expect(queries.filter(query => query.method === 'getGenesisHash')).toHaveLength(1);
  });

  it('returns zero for a valid empty lookup, and throws for an invalid vault or RPC cluster', async () => {
    const { client } = setup({ positions: [], missingPosition: true });
    for (const filter of [{ vault: active.vault }, { mint: mintAddress }]) {
      await expect(client.getStakedAmount({ wallet: walletAddress, ...filter })).resolves.toMatchObject({
        totalAmountRaw: '0', activeAmountRaw: '0', unstakingAmountRaw: '0', positions: [],
      });
    }
    await expect(client.getStakedAmount({ wallet: walletAddress, vault: mintAddress })).rejects.toThrow('Invalid StakeFast vault');
    await expect(setup({ wrongCluster: true }).client.getStakedAmount({ wallet: walletAddress, mint: mintAddress })).rejects.toThrow('wrong cluster');
    await expect(setup({ missingProgram: true }).client.getStakedAmount({ wallet: walletAddress, mint: mintAddress })).rejects.toThrow('not deployed');
  });

  it('rejects a discovered position whose address does not match its vault and wallet', async () => {
    const { client } = setup({ positions: [{ ...active, position: unrelated.position }] });
    await expect(client.getStakedAmount({ wallet: walletAddress, mint: mintAddress })).rejects.toThrow('Invalid StakeFast position');
  });

  it('totals positions from different wallets in the selected vault at one finalized slot', async () => {
    const pending = fixture(1n, 20n, 1_750_000_000n, mint, TOKEN_2022_PROGRAM_ID, otherWallet);
    const { client, queries } = setup({ positions: [active, pending], unixTime: 1_750_000_001n });
    await expect(client.getVaultStats({ vault: active.vault })).resolves.toMatchObject({
      vault: active.vault, mint: mintAddress, decimals: 6, slot: 30, positionCount: 2,
      totalAmountRaw: '9007199254741013', activeAmountRaw: '9007199254740993', unstakingAmountRaw: '20',
    });
    expect(queries.find(query => query.method === 'getProgramAccounts')?.params[1]).toMatchObject({
      commitment: 'finalized', withContext: true, filters: expect.arrayContaining([{ memcmp: { offset: 8, bytes: active.vault } }]),
    });
    expect(queries.find(query => query.method === 'getMultipleAccounts')?.params).toMatchObject([[active.vault], { minContextSlot: 30 }]);
  });

  it('distinguishes a valid empty vault from an invalid vault and rejects unrelated or duplicate positions', async () => {
    const { client } = setup({ positions: [] });
    await expect(client.getVaultStats({ vault: active.vault })).resolves.toMatchObject({
      totalAmountRaw: '0', activeAmountRaw: '0', unstakingAmountRaw: '0', positionCount: 0,
    });
    await expect(client.getVaultStats({ vault: mintAddress })).rejects.toThrow('Invalid StakeFast vault');
    await expect(setup({ positions: [unstaking] }).client.getVaultStats({ vault: active.vault })).rejects.toThrow('different vault');
    await expect(setup({ positions: [active, active] }).client.getVaultStats({ vault: active.vault })).rejects.toThrow('Duplicate');
  });

  it.each([
    { fixture: active, mint, tokenProgram: TOKEN_2022_PROGRAM_ID },
    { fixture: legacy, mint: otherMint, tokenProgram: TOKEN_PROGRAM_ID },
  ])('builds an unsigned stake transaction with the vault token program', async ({ fixture, mint, tokenProgram }) => {
    const { client, queries } = setup();
    const amountRaw = '9007199254740993';
    const built = await client.buildStakeTransaction({ wallet: walletAddress, vault: fixture.vault, mint: mint.toBase58(), amountRaw });
    expect(built).toMatchObject({ cluster: 'devnet', mint: mint.toBase58(), blockhash, lastValidBlockHeight: 91 });
    const tx = Transaction.from(Buffer.from(built.transaction, 'base64'));
    expect(tx.signatures).toEqual([{ publicKey: wallet, signature: null }]);
    expect(tx.recentBlockhash).toBe(blockhash);
    const [ix] = tx.instructions;
    expect(ix.programId.equals(program)).toBe(true);
    expect(ix.data.subarray(0, 8)).toEqual(anchorDiscriminator('global', 'lock'));
    expect(ix.data.readBigUInt64LE(8)).toEqual(BigInt(amountRaw));
    expect(ix.keys.map(key => key.pubkey.toBase58())).toEqual([
      walletAddress, fixture.vault, fixture.position, mint.toBase58(),
      getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram).toBase58(),
      getAssociatedTokenAddressSync(mint, new PublicKey(fixture.vault), true, tokenProgram).toBase58(),
      tokenProgram.toBase58(), SystemProgram.programId.toBase58(), STAKEFAST_FEE_RECIPIENT,
    ]);
    expect(ix.keys.at(-1)).toMatchObject({ isWritable: true, isSigner: false });
    expect(queries.at(-1)).toEqual({ method: 'getLatestBlockhash', params: [{ commitment: 'confirmed', minContextSlot: 31 }] });
  });

  it('builds unstake and claims the full position once the Solana clock reaches the deadline', async () => {
    const { client } = setup();
    const unstake = await client.buildUnstakeTransaction({ wallet: walletAddress, vault: active.vault });
    const [requestIx] = Transaction.from(Buffer.from(unstake.transaction, 'base64')).instructions;
    expect(requestIx.data).toEqual(anchorDiscriminator('global', 'request_unlock'));
    expect(requestIx.keys.map(key => key.pubkey.toBase58())).toEqual([
      walletAddress, active.vault, active.position, SystemProgram.programId.toBase58(), STAKEFAST_FEE_RECIPIENT,
    ]);

    const claim = await client.buildClaimTransaction({ wallet: walletAddress, vault: unstaking.vault });
    const [createAta, withdraw] = Transaction.from(Buffer.from(claim.transaction, 'base64')).instructions;
    const ownerAta = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
    expect(createAta.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(createAta.data).toEqual(Buffer.from([1]));
    expect(createAta.keys[1].pubkey.equals(ownerAta)).toBe(true);
    expect(withdraw.data).toEqual(anchorDiscriminator('global', 'withdraw'));
    expect(withdraw.keys[2].pubkey.toBase58()).toBe(unstaking.position);
    expect(withdraw.keys[4].pubkey.equals(ownerAta)).toBe(true);
    expect(withdraw.keys.at(-1)).toMatchObject({ pubkey: new PublicKey(STAKEFAST_FEE_RECIPIENT), isWritable: true, isSigner: false });
  });

  it('rejects an early claim, a second unstake request, an invalid amount and an empty position', async () => {
    const { client, queries } = setup({ unixTime: 1_749_999_999n });
    await expect(client.buildClaimTransaction({ wallet: walletAddress, vault: unstaking.vault })).rejects.toThrow('cooldown is active');
    await expect(client.buildClaimTransaction({ wallet: walletAddress, vault: active.vault })).rejects.toThrow('Request unstake');
    await expect(client.buildUnstakeTransaction({ wallet: walletAddress, vault: unstaking.vault })).rejects.toThrow('already requested');
    await expect(client.buildStakeTransaction({ wallet: walletAddress, vault: active.vault, amountRaw: '0' })).rejects.toThrow('positive u64');
    await expect(client.buildStakeTransaction({ wallet: walletAddress, vault: unstaking.vault, amountRaw: 1n })).rejects.toThrow('Cancel unstaking');
    await expect(setup({ missingPosition: true }).client.buildUnstakeTransaction({ wallet: walletAddress, vault: active.vault })).rejects.toThrow('No StakeFast position');
    expect(queries.some(query => query.method === 'getLatestBlockhash')).toBe(false);
  });
});
