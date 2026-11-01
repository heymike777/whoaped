import { randomBytes, randomUUID } from 'node:crypto';
import {
  AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction,
  createNoopSigner, createTransactionMessage, getBase58Decoder, getBase64EncodedWireTransaction,
  pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedInstruction } from '@solana-program/token';
import { getAddMemoInstruction } from '@solana-program/memo';
import { collections, type PaymentOrderDocument } from '../db.js';
import { BillingError, PREMIUM_PLANS, TOKEN_PROGRAM, USDC_MINT, type PremiumPlan } from '../config/premium.js';
import { canonicalAccountId, withAccountMutation } from './accounts.js';
import { grantPaidOrder } from './premium-access.js';
import { refreshPaidTrackingPolicy } from './rate-limits.js';

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!process.env.HELIUS_API_KEY) throw new BillingError('Payment verification is temporarily unavailable.');
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { result: T; error?: unknown };
    if (!response.ok || result.error) throw new Error();
    return result.result;
  } catch { throw new BillingError('Solana verification is temporarily unavailable. Your order remains pending.'); }
}
export async function createUsdcOrder(userId: string, plan: PremiumPlan, payer: string, requestKey: string) {
  const recipient = process.env.USDC_TREASURY_ADDRESS;
  if (!recipient) throw new BillingError('USDC checkout is not available yet.');
  try { address(payer); address(recipient); } catch { throw new BillingError('Invalid payment wallet address.'); }
  const mint = address(USDC_MINT), tokenProgram = address(TOKEN_PROGRAM);
  const [source] = await findAssociatedTokenPda({ mint, owner: address(payer), tokenProgram });
  const [destination] = await findAssociatedTokenPda({ mint, owner: address(recipient), tokenProgram });
  const order = await withAccountMutation(userId, async (db, session, accountId) => {
    const existing = await db.paymentOrders.findOne({ userId: accountId, requestKey }, { session });
    if (existing) {
      if (existing.provider !== 'usdc' || existing.plan !== plan || existing.payer !== payer || existing.status !== 'pending' || existing.expiresAt <= new Date()) throw new BillingError('This checkout was already used or expired. Check its payment status before starting another.');
      return existing;
    }
    const now = new Date();
    const recent = await db.paymentOrders.countDocuments({ userId: accountId, provider: 'usdc', createdAt: { $gt: new Date(now.getTime() - 60 * 60_000) } }, { session });
    if (recent >= 10) throw new BillingError('Too many checkout attempts. Please try again later.');
    const pending = await db.paymentOrders.countDocuments({ userId: accountId, provider: 'usdc', status: 'pending', expiresAt: { $gt: now } }, { session });
    if (pending >= 3) throw new BillingError('You already have pending payments. Check their status before starting another.');
    const id = randomUUID();
    const document: PaymentOrderDocument = { _id: id, userId: accountId, provider: 'usdc', currency: 'USDC', plan, amount: PREMIUM_PLANS[plan].usdcAtomic,
      payer, recipient, sourceTokenAccount: source, destinationTokenAccount: destination,
      reference: getBase58Decoder().decode(randomBytes(32)), memo: `whoaped:${id}`, requestKey,
      status: 'pending', createdAt: now, expiresAt: new Date(now.getTime() + 15 * 60_000), nextCheckAt: new Date(now.getTime() + 15_000), checks: 0 };
    await db.paymentOrders.insertOne(document, { session });
    return document;
  });
  const lifetime = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
  const payerSigner = createNoopSigner(address(payer));
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: payerSigner, owner: address(order.recipient!), mint, ata: address(order.destinationTokenAccount!) });
  const transfer = getTransferCheckedInstruction({ source: address(order.sourceTokenAccount!), destination: address(order.destinationTokenAccount!), mint, authority: payerSigner, amount: BigInt(order.amount), decimals: 6 });
  const message = pipe(createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayer(address(payer), m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.value.blockhash), lastValidBlockHeight: BigInt(lifetime.value.lastValidBlockHeight) }, m),
    m => appendTransactionMessageInstructions([createAta, { ...transfer, accounts: [...transfer.accounts, { address: address(order.reference!), role: AccountRole.READONLY }] }, getAddMemoInstruction({ memo: order.memo!, signers: [payerSigner] })], m));
  return { id: order._id, amount: order.amount / 1e6, mint: USDC_MINT, recipient: order.recipient, reference: order.reference, expiresAt: order.expiresAt, transaction: getBase64EncodedWireTransaction(compileTransaction(message)) };
}

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
type ParsedInstruction = { programId: string; parsed?: string | { type?: string; info?: { source?: string; destination?: string; mint?: string; authority?: string; tokenAmount?: { amount?: string; decimals?: number } } } };
export type PaymentTransaction = {
  blockTime?: number | null;
  transaction: { signatures: string[]; message: { accountKeys: Array<{ pubkey: string; signer: boolean }>; instructions: ParsedInstruction[] } };
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
};
export function validateUsdcPayment(order: PaymentOrderDocument, signature: string, tx: PaymentTransaction) {
  if (order.provider !== 'usdc' || !tx.meta || tx.meta.err !== null || !tx.transaction.signatures.includes(signature)) return false;
  if (tx.blockTime == null || tx.blockTime * 1000 < order.createdAt.getTime() - 60_000 || tx.blockTime * 1000 > order.expiresAt.getTime()) return false;
  const message = tx.transaction.message;
  if (!message.accountKeys.some(k => k.pubkey === order.payer && k.signer) || !message.accountKeys.some(k => k.pubkey === order.reference)) return false;
  const memo = message.instructions.some(i => i.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' && i.parsed === order.memo);
  const transfer = message.instructions.some(i => {
    if (i.programId !== TOKEN_PROGRAM || typeof i.parsed !== 'object' || i.parsed?.type !== 'transferChecked') return false;
    const info = i.parsed.info;
    return info?.mint === USDC_MINT && info.source === order.sourceTokenAccount && info.destination === order.destinationTokenAccount
      && info.authority === order.payer && info.tokenAmount?.amount === String(order.amount) && info.tokenAmount.decimals === 6;
  });
  if (!memo || !transfer) return false;
  const index = message.accountKeys.findIndex(k => k.pubkey === order.destinationTokenAccount);
  const after = tx.meta.postTokenBalances?.find(b => b.accountIndex === index && b.mint === USDC_MINT && b.owner === order.recipient && b.uiTokenAmount.decimals === 6);
  const before = tx.meta.preTokenBalances?.find(b => b.accountIndex === index && b.mint === USDC_MINT);
  if (!after || !/^\d+$/.test(after.uiTokenAmount.amount) || before && !/^\d+$/.test(before.uiTokenAmount.amount)) return false;
  return BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? '0') >= BigInt(order.amount);
}
async function settleUsdc(order: PaymentOrderDocument, signature: string) {
  const tx = await rpc<PaymentTransaction | null>('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  if (!tx || !validateUsdcPayment(order, signature, tx)) return false;
  await withAccountMutation(order.userId, async (db, session, accountId) => {
    const current = await db.paymentOrders.findOne({ _id: order._id }, { session });
    if (!current || current.status === 'paid' || current.status === 'refunded') return;
    await grantPaidOrder(db, session, current, accountId, signature, new Date());
    await refreshPaidTrackingPolicy(db, session, accountId, new Date());
  });
  return true;
}
export async function getPaymentOrder(userId: string, id: string) {
  const db = await collections();
  const accountId = await canonicalAccountId(userId, db);
  const order = await db.paymentOrders.findOne({ _id: id, userId: accountId });
  if (!order) throw new BillingError('Payment order not found.');
  return { id: order._id, provider: order.provider, status: order.status, plan: order.plan, expiresAt: order.expiresAt, premiumUntil: order.accessEndsAt ?? null };
}
export async function reportUsdcSignature(userId: string, id: string, signature: string) {
  await getPaymentOrder(userId, id);
  const db = await collections();
  await db.paymentOrders.updateOne({ _id: id, provider: 'usdc', status: 'pending' }, { $set: { signature, nextCheckAt: new Date() } });
  return getPaymentOrder(userId, id);
}
export async function drainUsdcPayments() {
  if (!process.env.HELIUS_API_KEY) return;
  const db = await collections();
  for (let i = 0; i < 5; i++) {
    const now = new Date();
    const order = await db.paymentOrders.findOneAndUpdate({ provider: 'usdc', status: 'pending', nextCheckAt: { $lte: now } }, { $set: { nextCheckAt: new Date(now.getTime() + 60_000) }, $inc: { checks: 1 } }, { sort: { nextCheckAt: 1 }, returnDocument: 'after' });
    if (!order) break;
    try {
      if (order.signature && await settleUsdc(order, order.signature)) continue;
      const signatures = await rpc<Array<{ signature: string; err: unknown }>>('getSignaturesForAddress', [order.reference, { commitment: 'finalized', limit: 10 }]);
      let paid = false;
      for (const item of signatures) if (item.err === null && await settleUsdc(order, item.signature)) { paid = true; break; }
      if (!paid && now.getTime() > order.expiresAt.getTime() + 30 * 60_000) await db.paymentOrders.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'expired' } });
    } catch { await db.paymentOrders.updateOne({ _id: order._id, status: 'pending' }, { $set: { lastError: 'Payment verification will retry automatically' } }); }
  }
}
