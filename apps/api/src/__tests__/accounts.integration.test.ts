import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createPrivateKey, sign } from 'node:crypto';
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { AccountLayout, AccountState, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { MAINNET_GENESIS_HASH, stakeFastConfig } from '../config/stakefast.js';
import { anchorDiscriminator, positionAddress } from '../services/stakefast-accounts.js';
import type { Collections } from '../db.js';

let replica: MongoMemoryReplSet;
let database: typeof import('../db.js');
let accounts: typeof import('../services/accounts.js');
let auth: typeof import('../auth.js');
let app: typeof import('../app.js')['app'];
let db: Collections;
const now = new Date();
const address = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const address2 = '11111111111111111111111111111111';
const address3 = 'So11111111111111111111111111111111111111112';
const source = 'mobile-user', target = 'telegram:123';

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv('MONGODB_URI', replica.getUri());
  vi.stubEnv('MONGODB_DATABASE', 'account-link-tests');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  database = await import('../db.js');
  accounts = await import('../services/accounts.js');
  auth = await import('../auth.js');
  app = (await import('../app.js')).app;
  db = await database.collections();
}, 120_000);
afterAll(async () => { await database?.closeDatabase(); await replica?.stop(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  for (const collection of Object.values(db)) await collection.deleteMany({});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }));
  await db.users.insertOne({ _id: source, createdAt: now });
  await db.telegramChats.insertOne({ _id: '123', createdAt: now });
  await db.sessions.insertOne({ _id: 'session', userId: source, tokenHash: auth.hashToken('mobile-token'), createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
  await db.wallets.insertMany([
    { _id: 'mobile-shared', userId: source, address, name: 'Mobile name', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
    { _id: 'mobile-only', userId: source, address: address2, name: 'Mobile only', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
    { _id: 'bot-shared', userId: target, address, name: 'Bot name', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
    { _id: 'other-wallet', userId: 'someone-else', address, name: 'Other account', chain: 'solana', status: 'active', createdAt: now, deletedAt: null },
  ]);
});
async function pendingLink() {
  const link = await accounts.createTelegramLink(source);
  const token = new URL(link.url).searchParams.get('start')!.slice(5);
  await accounts.previewTelegramLink(token, '123');
  return { ...link, token };
}

describe('atomic Telegram account linking (real MongoDB replica set)', () => {
  it('shares finalized staking PRO with Telegram when the bot rollout is enabled', async () => {
    vi.stubEnv('STAKEFAST_DEVNET_ENABLED', 'false');
    vi.stubEnv('TELEGRAM_STAKING_ENABLED', 'false');
    vi.stubEnv('STAKEFAST_MAINNET_RPC_URL', 'https://staking-rpc.test');
    const config = stakeFastConfig();
    const wallet = Keypair.generate();
    const address = wallet.publicKey.toBase58();
    const key = createPrivateKey({ key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8' });
    const vault = Buffer.alloc(130);
    anchorDiscriminator('account', 'Vault').copy(vault);
    new PublicKey('HskTaEWSV7z4YDBsXt2Zks7ELpf4iCWYaGYiH6wuEFuy').toBuffer().copy(vault, 8);
    config.mint.toBuffer().copy(vault, 40);
    TOKEN_2022_PROGRAM_ID.toBuffer().copy(vault, 72);
    vault.writeBigUInt64LE(1n, 104);
    vault.writeBigInt64LE(604800n, 120);
    const position = Buffer.alloc(88);
    anchorDiscriminator('account', 'Position').copy(position);
    config.vault.toBuffer().copy(position, 8);
    wallet.publicKey.toBuffer().copy(position, 40);
    const clock = Buffer.alloc(40);
    clock.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 32);
    const positionKey = positionAddress(config.program, config.vault, wallet.publicKey).toBase58();
    const sourceKey = getAssociatedTokenAddressSync(config.mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID).toBase58();
    const accountInfo = (data: Buffer, executable = false) => ({ executable, owner: config.program.toBase58(), lamports: 1_000_000, rentEpoch: 0, data: [data.toString('base64'), 'base64'] });
    let tokenBalance: bigint | null = null;
    let solBalance = 0;
    const sourceAccount = () => {
      if (tokenBalance === null) return null;
      const data = Buffer.alloc(AccountLayout.span);
      AccountLayout.encode({
        mint: config.mint, owner: wallet.publicKey, amount: tokenBalance, state: AccountState.Initialized,
        delegateOption: 0, delegate: PublicKey.default, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n,
        closeAuthorityOption: 0, closeAuthority: PublicKey.default,
      }, data);
      return { ...accountInfo(data), owner: TOKEN_2022_PROGRAM_ID.toBase58() };
    };
    let simulationError: string | Record<string, unknown> | null = null;
    let simulationLogs: string[] = [];
    const simulationRequests: string[] = [];
    let simulationUnavailable = false;
    const botMessages: string[] = [];
    const botButtons: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];
    const rpcCommitments: string[] = [];
    let vaultScans = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body);
      if (url.startsWith('https://api.telegram.org/')) {
        if (url.endsWith('/sendMessage')) {
          botMessages.push(payload.text);
          botButtons.push(payload.reply_markup.inline_keyboard.flat());
        }
        return Response.json({ ok: true, result: {} });
      }
      let result;
      const context = { slot: 42 };
      switch (payload.method) {
        case 'getGenesisHash': result = MAINNET_GENESIS_HASH; break;
        case 'getAccountInfo':
          if (payload.params[0] === config.mint.toBase58()) {
            result = { context, value: {
              owner: TOKEN_2022_PROGRAM_ID.toBase58(), executable: false,
              data: { parsed: { type: 'mint', info: { isInitialized: true, decimals: 6 } } },
            } };
            break;
          }
          result = { context, value: payload.params[0] === sourceKey ? sourceAccount() : accountInfo(Buffer.alloc(0), true) };
          break;
        case 'getProgramAccounts':
          vaultScans++;
          expect(payload.params[1]).toMatchObject({
            commitment: 'finalized', withContext: true,
            filters: expect.arrayContaining([{ memcmp: { offset: 8, bytes: config.vault.toBase58() } }]),
          });
          result = { context, value: [{ pubkey: positionKey, account: accountInfo(position) }] };
          break;
        case 'getMultipleAccounts':
          if (payload.params[0][0] === address && payload.params[0][1] === sourceKey) {
            expect(payload.params[1].commitment).toBe('confirmed');
            result = { context, value: [
              solBalance ? { ...accountInfo(Buffer.alloc(0)), owner: PublicKey.default.toBase58(), lamports: solBalance } : null,
              sourceAccount(),
            ] };
            break;
          }
          rpcCommitments.push(payload.params[1].commitment);
          result = { context, value: payload.params[0].map((id: string) => id === config.vault.toBase58() ? accountInfo(vault)
            : id === positionKey && position.readBigUInt64LE(72) ? accountInfo(position)
              : id === SYSVAR_CLOCK_PUBKEY.toBase58() ? { ...accountInfo(clock), owner: 'Sysvar1111111111111111111111111111111111111' } : null) };
          break;
        case 'getLatestBlockhash': result = { context, value: { blockhash: wallet.publicKey.toBase58(), lastValidBlockHeight: 90 } }; break;
        case 'getFeeForMessage': result = { context, value: 5000 }; break;
        case 'simulateTransaction':
          expect(payload.params[1]).toMatchObject({ commitment: 'confirmed', encoding: 'base64', sigVerify: false });
          simulationRequests.push(payload.params[0]);
          if (simulationUnavailable) return Response.json({ jsonrpc: '2.0', id: payload.id, error: { code: -32005, message: 'Unavailable' } });
          result = { context, value: { err: simulationError, logs: simulationLogs } };
          break;
        default: throw new Error(`Unexpected RPC call ${payload.method}`);
      }
      return Response.json({ jsonrpc: '2.0', id: payload.id, result });
    }));
    const request = (path: string, data?: object) => app.request(path, {
      method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer mobile-token', 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    const action = { wallet: address, action: 'stake', amountRaw: '1000000000000' };
    const balancesUrl = `/v1/stakefast/wallets/${address}/balances`;
    expect((await app.request(balancesUrl)).status).toBe(401);
    expect((await request('/v1/stakefast/wallets/invalid/balances')).status).toBe(400);
    const emptyBalances = await request(balancesUrl);
    expect(emptyBalances.headers.get('cache-control')).toBe('no-store');
    expect(await emptyBalances.json()).toEqual({
      wallet: address, cluster: 'mainnet', mint: config.mint.toBase58(), whoapedAmountRaw: '0', solLamports: '0',
    });
    tokenBalance = 1_234_000_000_012n;
    solBalance = 12_345_678;
    expect(await (await request(balancesUrl)).json()).toMatchObject({
      whoapedAmountRaw: '1234000000012', solLamports: '12345678',
    });
    expect((await request('/v1/stakefast/transactions', action)).status).toBe(403);
    const challenge = await (await request('/v1/stakefast/challenges', { wallet: address })).json() as { challengeId: string; messageBase64: string };
    const message = Buffer.from(challenge.messageBase64, 'base64');
    expect(message.toString()).toContain('Network: Solana mainnet');
    const proof = { challengeId: challenge.challengeId, signature: sign(null, message, key).toString('base64') };
    expect((await request('/v1/stakefast/link', proof)).status).toBe(200);
    expect((await request('/v1/stakefast/link', proof)).status).toBe(409);
    for (const balance of [null, 999_999_999_999n]) {
      tokenBalance = balance;
      const rejected = await request('/v1/stakefast/transactions', action);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: expect.stringContaining('Not enough WHOAPED') });
    }
    expect(simulationRequests).toHaveLength(0);
    tokenBalance = 1_000_000_000_000n;
    for (const error of ['AccountNotFound', 'InsufficientFundsForFee', { InsufficientFundsForRent: { account_index: 0 } }]) {
      simulationError = error;
      const rejected = await request('/v1/stakefast/transactions', action);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: expect.stringContaining('Not enough SOL') });
    }
    simulationError = { InstructionError: [0, { Custom: 1 }] };
    simulationLogs = ['Program log: Transfer: insufficient lamports 0, need 2000000'];
    const feeRejected = await request('/v1/stakefast/transactions', action);
    expect(feeRejected.status).toBe(400);
    expect(await feeRejected.json()).toEqual({ error: expect.stringContaining('Not enough SOL') });
    simulationUnavailable = true;
    const unavailable = await request('/v1/stakefast/transactions', action);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: expect.stringContaining('Could not check wallet balances') });
    simulationUnavailable = false;
    simulationError = null;
    simulationLogs = [];
    const prepared = await request('/v1/stakefast/transactions', action);
    expect(prepared.status).toBe(200);
    const wire = await prepared.json() as { transaction: string; preflightChecked: boolean };
    expect(wire.preflightChecked).toBe(true);
    expect(simulationRequests.at(-1)).toBe(wire.transaction);
    const transaction = Transaction.from(Buffer.from(wire.transaction, 'base64'));
    expect(transaction.feePayer?.toBase58()).toBe(address);
    expect(transaction.instructions[0].programId.equals(config.program)).toBe(true);

    const link = await pendingLink();
    await accounts.confirmTelegramLink(link.token, '123');
    const { handleTelegramUpdate } = await import('../services/telegram.js');
    const bot = (id: number, text = '/staking') => handleTelegramUpdate({ update_id: id, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text } });
    position.writeBigUInt64LE(999_999_999_999n, 72);
    expect(await (await request('/v1/account')).json()).toMatchObject({ premium: { active: false }, tracking: { tier: 'free' } });
    position.writeBigUInt64LE(1_000_000_000_000n, 72);
    expect(await (await request('/v1/account')).json()).toMatchObject({ premium: { active: true }, tracking: { tier: 'premium' } });
    await bot(4000, '/premium');
    expect(botMessages.at(-1)).toContain('WhoAped Premium · Coming Soon');
    expect(botMessages.at(-1)).not.toContain('Premium active until');
    const pausedMenu = botMessages.at(-1);
    vi.stubEnv('TELEGRAM_STAKING_ENABLED', 'true');
    await bot(4001, '/start');
    expect(botButtons.at(-1)).toContainEqual({ text: '⭐ Staking & PRO', callback_data: 'staking' });
    await bot(4002);
    expect(botMessages.at(-1)).toContain('PRO active through staking.');
    expect(botMessages.at(-1)).toContain('1,000,000 WHOAPED · locked');
    expect(botButtons.at(-1)).toContainEqual({ text: 'Open staking', url: 'https://whoaped.com/staking/' });
    expect(await (await request('/v1/billing/products')).json()).toMatchObject({ premium: { active: true } });
    position.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)) + 604800n, 80);
    await bot(4003);
    expect(botMessages.at(-1)).toContain('PRO inactive.');
    expect(botMessages.at(-1)).toContain('withdrawal opens');
    position.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)) - 1n, 80);
    await bot(4004);
    expect(botMessages.at(-1)).toContain('ready to withdraw');
    expect(botMessages.at(-1)).toContain('The 0.5% WHOAPED fee applies only when you withdraw.');
    const claim = await request('/v1/stakefast/transactions', { wallet: address, action: 'claim' });
    expect(claim.status).toBe(200);
    const claimed = await claim.json() as { transaction: string };
    expect(claimed).toMatchObject({ preflightChecked: true, withdrawal: {
      wallet: address, grossRaw: '1000000000000', feeRaw: '5000000000', netRaw: '995000000000',
      feeBps: 50, actionFeeLamports: '2000000', networkFeeLamports: '5000',
    } });
    expect(simulationRequests.at(-1)).toBe(claimed.transaction);
    expect(Transaction.from(Buffer.from(claimed.transaction, 'base64')).instructions[1].data.readUInt16LE(8)).toBe(50);
    const publicTotals = await Promise.all([app.request('/v1/staking/stats'), app.request('/v1/staking/stats')]);
    for (const total of publicTotals) {
      expect(total.status).toBe(200);
      expect(await total.json()).toEqual({ amountRaw: '1000000000000', decimals: 6, slot: 42 });
    }
    expect(vaultScans).toBe(1);
    vi.stubEnv('TELEGRAM_STAKING_ENABLED', 'false');
    expect(await (await request('/v1/account')).json()).toMatchObject({ premium: { active: false }, tracking: { tier: 'free' } });
    expect(await (await request('/v1/stakefast/status')).json()).toMatchObject({ qualifiesForPremium: false, positions: [{ wallet: address, qualifies: false }] });
    await bot(4005, '/premium');
    expect(botMessages.at(-1)).toBe(pausedMenu);
    const cancel = { wallet: address, action: 'cancel' };
    simulationError = 'InsufficientFundsForFee';
    expect((await (await request('/v1/stakefast/transactions', cancel)).json())).toEqual({ error: expect.stringContaining('Not enough SOL') });
    simulationError = null;
    expect((await request('/v1/stakefast/transactions', cancel)).status).toBe(200);
    position.writeBigInt64LE(0n, 80);
    expect(await (await request('/v1/account')).json()).toMatchObject({ premium: { active: true } });
    expect(rpcCommitments.length).toBeGreaterThan(0);
    expect(rpcCommitments.every(commitment => commitment === 'finalized')).toBe(true);
  });

  it('deletes a linked account and its aliases, revokes sessions and supports safe retries', async () => {
    const link = await pendingLink();
    await accounts.confirmTelegramLink(link.token, '123');
    const expiresAt = new Date(Date.now() + 60_000);
    await db.users.insertOne({ _id: 'older-installation', mergedInto: source, createdAt: now });
    await db.sessions.insertOne({ _id: 'other-session', userId: 'older-installation', tokenHash: auth.hashToken('older-token'), createdAt: now, expiresAt });
    await db.deviceTokens.insertOne({ _id: 'deletion-device', userId: target, token: 'old-push-token', platform: 'ios', createdAt: now, lastSeenAt: now });
    await db.notificationJobs.insertOne({ _id: 'deletion-push', userId: target, deviceTokenId: 'deletion-device', transactionId: 'test',
      title: 'Queued update', body: '', data: {}, status: 'pending', attempts: 0, availableAt: now, createdAt: now });
    await db.telegramJobs.insertOne({ _id: 'deletion-chat-job', chatId: '123', walletId: 'bot-shared', txHash: 'test', slot: 1,
      text: 'Queued update', buttons: [], status: 'pending', attempts: 0, availableAt: now, createdAt: now });
    await db.telegramUpdates.insertOne({ _id: 'queued-update', payload: { message: { chat: { id: 123 }, text: 'private name' } },
      status: 'pending', availableAt: now, createdAt: now, attempts: 0 });
    await db.payboxImports.insertOne({ _id: 'deletion-import', userId: source, stateHash: 'state', clientId: 'client', redirectUri: 'https://example.test', status: 'ready', expiresAt });
    await db.paymentOrders.insertMany([
      { _id: 'settled-order', userId: target, plan: 'month', provider: 'usdc', amount: 1, currency: 'USDC', status: 'paid',
        createdAt: now, expiresAt, paymentId: 'receipt', payer: address, accessEndsAt: expiresAt },
      { _id: 'pending-order', userId: target, plan: 'month', provider: 'usdc', amount: 1, currency: 'USDC', status: 'pending', createdAt: now, expiresAt },
    ]);

    const request = (token?: string) => app.request('/v1/account', { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect((await request()).status).toBe(401);
    expect((await request('wrong-token')).status).toBe(401);
    const responses = await Promise.all([request('mobile-token'), request('mobile-token')]);
    expect(responses.map(response => response.status)).toEqual([204, 204]);

    expect(await db.users.countDocuments()).toBe(0);
    expect(await db.sessions.countDocuments()).toBe(0);
    expect(await db.wallets.distinct('_id')).toEqual(['other-wallet']);
    expect(await db.deviceTokens.countDocuments()).toBe(0);
    expect(await db.notificationJobs.countDocuments()).toBe(0);
    expect(await db.telegramJobs.countDocuments()).toBe(0);
    expect(await db.telegramChats.countDocuments()).toBe(0);
    expect(await db.accountLinks.countDocuments()).toBe(0);
    expect(await db.payboxImports.countDocuments()).toBe(0);
    expect(await db.telegramUpdates.findOne({ _id: 'queued-update' })).toMatchObject({ payload: null, status: 'sent' });
    expect(await db.paymentOrders.findOne({ _id: 'settled-order' })).toMatchObject({ userId: 'deleted-account', paymentId: 'receipt' });
    expect(await db.paymentOrders.findOne({ _id: 'settled-order' })).not.toHaveProperty('payer');
    expect(await db.paymentOrders.findOne({ _id: 'pending-order' })).toBeNull();

    expect(await auth.authenticateSessionToken('mobile-token')).toBeNull();
    expect(await auth.authenticateSessionToken('older-token')).toBeNull();
    const staleWrite = vi.fn();
    await expect(accounts.withAccountMutation(target, staleWrite)).rejects.toBeInstanceOf(accounts.AccountUnavailableError);
    expect(staleWrite).not.toHaveBeenCalled();
  });

  it('shares the failed-transaction preference between app and bot and cancels queued alerts when disabled', async () => {
    const enabled = await app.request('/v1/account/preferences', {
      method: 'PATCH', headers: { Authorization: 'Bearer mobile-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackFailedTransactions: true }),
    });
    expect(enabled.status).toBe(200);
    const link = await pendingLink();
    await accounts.confirmTelegramLink(link.token, '123');
    expect((await accounts.getAccount(source)).preferences.trackFailedTransactions).toBe(true);
    const telegram = await import('../services/telegram.js');
    await telegram.handleTelegramUpdate({ update_id: 98, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text: '/settings' } });
    const settings = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string);
    expect(settings.text).toContain('Failed onchain transactions: On');
    expect(settings.reply_markup.inline_keyboard[0]).toEqual([{ text: '🟢 Failed transactions', callback_data: 'settings:failed:off' }]);
    const message = { message_id: 314, chat: { id: 123, type: 'private' } };
    async function toggle(updateId: number, state: 'on' | 'off') {
      const requestStart = vi.mocked(fetch).mock.calls.length;
      await telegram.handleTelegramUpdate(telegram.telegramUpdateSchema.parse({ update_id: updateId, callback_query: {
        id: `failed-${state}`, data: `settings:failed:${state}`, from: { id: 123 }, message,
      } }));
      const calls = vi.mocked(fetch).mock.calls.slice(requestStart);
      expect(calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['answerCallbackQuery', 'editMessageText']);
      return JSON.parse(calls[1][1]!.body as string);
    }
    await db.deviceTokens.insertOne({ _id: 'failed-device', userId: target, token: 'push-token', platform: 'ios', createdAt: now, lastSeenAt: now });
    const { ingestParsedTransaction } = await import('../services/parsed-transactions.js');
    await ingestParsedTransaction({ signature: 'failed-opt-in', status: 'error', slot: 250, accountKeys: [address] }, { provider: 'helius-parsed-stream' });
    expect(await db.transactions.countDocuments({ userId: target, kind: 'failed', txHash: 'failed-opt-in' })).toBe(1);
    expect(await db.telegramJobs.countDocuments({ txHash: 'failed-opt-in', kind: 'failed', status: 'pending' })).toBe(1);
    expect(await db.notificationJobs.countDocuments({ userId: target, failedTransaction: true, status: 'pending' })).toBe(1);
    const disabled = await toggle(99, 'off');
    expect(disabled).toMatchObject({ chat_id: '123', message_id: 314 });
    expect(disabled.text).toContain('Failed onchain transactions: Off');
    expect(disabled.reply_markup.inline_keyboard[0]).toEqual([{ text: '🔴 Failed transactions', callback_data: 'settings:failed:on' }]);
    expect((await accounts.getAccount(source)).preferences.trackFailedTransactions).toBe(false);
    expect(await db.telegramJobs.countDocuments({ txHash: 'failed-opt-in', status: 'failed' })).toBe(1);
    expect(await db.notificationJobs.countDocuments({ failedTransaction: true, status: 'failed' })).toBe(1);
    await ingestParsedTransaction({ signature: 'failed-opt-out', status: 'error', slot: 251, accountKeys: [address] }, { provider: 'helius-parsed-stream' });
    expect(await db.transactions.countDocuments({ txHash: 'failed-opt-out' })).toBe(0);
    expect(await db.rateEvents.countDocuments({ txHash: 'failed-opt-out' })).toBe(0);
    const reenabled = await toggle(100, 'on');
    expect(reenabled).toEqual({ chat_id: '123', message_id: 314, text: settings.text, reply_markup: settings.reply_markup });
    expect((await accounts.getAccount(source)).preferences.trackFailedTransactions).toBe(true);
  });
  it('merges wallets, sessions, push devices, history and entitlements and shares future writes', async () => {
    await db.deviceTokens.insertOne({ _id: 'device', userId: source, token: 'push-token', platform: 'ios', createdAt: now, lastSeenAt: now });
    const activity = { chain: 'solana' as const, txHash: 'same-signature', eventIndex: 0, slot: 1, kind: 'balance' as const, title: 'Transfer', detail: '', occurredAt: now, metadata: {}, createdAt: now };
    await db.transactions.insertMany([
      { ...activity, _id: 'mobile-tx', userId: source, walletId: 'mobile-shared' },
      { ...activity, _id: 'bot-tx', userId: target, walletId: 'bot-shared' },
      { ...activity, _id: 'unique-tx', txHash: 'unique', userId: source, walletId: 'mobile-shared' },
    ]);
    await db.accountEntitlements.insertMany([
      { _id: 'pro', userId: source, provider: 'apple', externalId: 'receipt-1', feature: 'premium', createdAt: now },
      { _id: 'alerts', userId: target, provider: 'telegram', externalId: 'invoice-1', feature: 'unlimited-alerts', createdAt: now },
    ]);
    const link = await pendingLink();
    expect(link.url).toMatch(/^https:\/\/t.me\/whoapedbot\?start=link_[A-Za-z0-9_-]{43}$/);
    const stored = await db.accountLinks.findOne({ _id: accounts.linkHash(link.token) });
    expect(stored?.code).toBe(link.code);
    expect(JSON.stringify(stored)).not.toContain(link.token);
    const telegram = await import('../services/telegram.js');
    await telegram.handleTelegramUpdate({ update_id: 42, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text: `/start link_${link.token}` } });
    const prompt = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string);
    expect(prompt.text).toContain(link.code);
    const confirmation = prompt.reply_markup.inline_keyboard[0][0].callback_data;
    expect(Buffer.byteLength(confirmation)).toBeLessThanOrEqual(64);
    await telegram.handleTelegramUpdate({ update_id: 43, callback_query: { id: 'confirm', data: confirmation, from: { id: 123, username: 'mike' }, message: { chat: { id: 123, type: 'private' } } } });
    expect((await auth.authenticateSessionToken('mobile-token'))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: target, deletedAt: null })).toBe(2);
    expect((await db.wallets.findOne({ _id: 'mobile-shared' }))?.mergedIntoWalletId).toBe('bot-shared');
    expect((await db.transactions.findOne({ _id: 'mobile-tx' }))?.mergedIntoTransactionId).toBe('bot-tx');
    expect((await db.transactions.findOne({ _id: 'unique-tx' }))?.walletId).toBe('bot-shared');
    expect((await db.deviceTokens.findOne({ _id: 'device' }))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: 'someone-else' })).toBe(1);
    const account = await accounts.getAccount(source);
    expect(account.id).toBe(target);
    expect(account.telegram?.username).toBe('mike');
    expect(account.entitlements.map(e => e.feature).sort()).toEqual(['premium', 'unlimited-alerts']);
    const response = await app.request('/v1/wallets', { headers: { Authorization: 'Bearer mobile-token' } });
    expect((await response.json() as { data: unknown[] }).data).toHaveLength(2);
    const added = await app.request('/v1/wallets', { method: 'POST', headers: { Authorization: 'Bearer mobile-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New app wallet', address: address3, chain: 'solana' }) });
    expect(added.status).toBe(201);
    expect((await db.wallets.findOne({ address: address3 }))?.userId).toBe(target);
    await telegram.handleTelegramUpdate({ update_id: 44, message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, text: '/wallets' } });
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).text).toContain('New app wallet');
    // New chain events fan out to both linked delivery channels.
    const { ingestParsedTransaction } = await import('../services/parsed-transactions.js');
    await ingestParsedTransaction({ signature: 'new-chain-event', slot: 200, accountKeys: [address], nativeTransfers: [{ fromUserAccount: address, toUserAccount: 'receiver', amount: 1_000_000_000 }] }, { provider: 'helius-parsed-stream' });
    expect(await db.telegramJobs.countDocuments({ chatId: '123', txHash: 'new-chain-event' })).toBe(1);
    expect(await db.notificationJobs.countDocuments({ userId: target, deviceTokenId: 'device' })).toBe(1);
  });
  it('requires authentication on all mobile account routes', async () => {
    expect((await app.request('/v1/account')).status).toBe(401);
    expect((await app.request('/v1/account/telegram-link', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/v1/account/telegram-link', { method: 'DELETE' })).status).toBe(401);
  });
  it('lets a new installation recover the same Telegram account and keeps both sessions', async () => {
    const first = await pendingLink();
    await accounts.confirmTelegramLink(first.token, '123');
    await db.users.insertOne({ _id: 'new-installation', createdAt: now });
    await db.sessions.insertOne({ _id: 'new-session', userId: 'new-installation', tokenHash: auth.hashToken('second-token'), createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
    const second = await accounts.createTelegramLink('new-installation');
    const token = new URL(second.url).searchParams.get('start')!.slice(5);
    await accounts.previewTelegramLink(token, '123');
    await accounts.confirmTelegramLink(token, '123');
    expect((await auth.authenticateSessionToken('second-token'))?.userId).toBe(target);
    expect((await auth.authenticateSessionToken('mobile-token'))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: target, deletedAt: null })).toBe(2);
  });
  it('requires a matching chat to open and confirm a link', async () => {
    const link = await pendingLink();
    await expect(accounts.previewTelegramLink(link.token, '456')).rejects.toThrow();
    await expect(accounts.confirmTelegramLink(link.token, '456')).rejects.toThrow();
    expect((await db.users.findOne({ _id: source }))?.mergedInto).toBeUndefined();
  });
  it('rejects expired and cancelled links without merging anything', async () => {
    const link = await pendingLink();
    await db.accountLinks.updateOne({ _id: accounts.linkHash(link.token) }, { $set: { expiresAt: new Date(0) } });
    await expect(accounts.confirmTelegramLink(link.token, '123')).rejects.toThrow();
    const second = await pendingLink();
    await db.accountLinks.updateOne({ _id: accounts.linkHash(second.token) }, { $set: { status: 'cancelled' } });
    await expect(accounts.confirmTelegramLink(second.token, '123')).rejects.toThrow();
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(2);
  });
  it('makes repeated confirmation harmless and prevents replay in another chat', async () => {
    const link = await pendingLink();
    await accounts.confirmTelegramLink(link.token, '123');
    await accounts.confirmTelegramLink(link.token, '123');
    expect(await db.wallets.countDocuments({ userId: target, deletedAt: null })).toBe(2);
    await expect(accounts.confirmTelegramLink(link.token, '456')).rejects.toThrow();
  });
  it('does not allow a second Telegram identity to take over a linked account', async () => {
    await db.telegramChats.updateOne({ _id: '456' }, { $set: { userId: source, createdAt: now } }, { upsert: true });
    // A previously issued link must still re-check identity at confirmation.
    const token = 'a'.repeat(43);
    await db.accountLinks.insertOne({ _id: accounts.linkHash(token), userId: source, code: '123456', status: 'pending', claimedChatId: '123', createdAt: now, expiresAt: new Date(Date.now() + 60_000) });
    await expect(accounts.confirmTelegramLink(token, '123')).rejects.toThrow('another Telegram');
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(2);
  });
  it('serializes wallet writes racing with a merge onto the retained account', async () => {
    const link = await pendingLink();
    await Promise.all([
      accounts.confirmTelegramLink(link.token, '123'),
      accounts.withAccountMutation(source, async (database, session, accountId) => {
        await database.wallets.insertOne({ _id: 'racing-wallet', userId: accountId, address: address3, name: 'Concurrent', chain: 'solana', status: 'active', createdAt: now, deletedAt: null }, { session });
      }),
    ]);
    expect((await db.wallets.findOne({ _id: 'racing-wallet' }))?.userId).toBe(target);
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(0);
  });
  it('rolls back the merge if a dependent write fails', async () => {
    const link = await pendingLink();
    const spy = vi.spyOn(db.accountEntitlements, 'updateMany').mockRejectedValueOnce(new Error('database unavailable'));
    // Use the same collection instances for an explicit transaction to exercise atomic rollback.
    await expect(database.withDatabaseTransaction((_, session) => accounts.mergeAccountData(db, session, source, target, now))).rejects.toThrow('database unavailable');
    spy.mockRestore();
    expect((await db.users.findOne({ _id: source }))?.mergedInto).toBeUndefined();
    expect(await db.wallets.countDocuments({ userId: source, deletedAt: null })).toBe(2);
    expect((await db.accountLinks.findOne({ _id: accounts.linkHash(link.token) }))?.status).toBe('pending');
  });
});
