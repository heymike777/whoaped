import type { ParsedSolanaTransaction } from '../chains/solana.js';
import type { NormalizedActivity } from '../chains/types.js';
import type { WalletDocument } from '../db.js';
import { transactionBalanceLines } from './transaction-balances.js';

type RecordValue = Record<string, unknown>;
const kindPriority: Record<NormalizedActivity['kind'], number> = {
  failed: 0, swap: 1, yield: 2, launch: 3, multisig: 4, nft: 5,
  stake: 6, buy: 7, transfer: 8, balance: 9, unknown: 10,
};
const kindLabels: Record<NormalizedActivity['kind'], { icon: string; label: string }> = {
  failed: { icon: '🔴', label: 'FAILED TRANSACTION' },
  swap: { icon: '🔁', label: 'SWAP' },
  yield: { icon: '💧', label: 'YIELD' },
  launch: { icon: '🚀', label: 'TOKEN LAUNCH' },
  multisig: { icon: '🔐', label: 'MULTISIG' },
  nft: { icon: '🖼', label: 'NFT' },
  stake: { icon: '🔒', label: 'STAKE' },
  buy: { icon: '↗️', label: 'BUY' },
  transfer: { icon: '💸', label: 'TRANSFER' },
  balance: { icon: '◈', label: 'BALANCE CHANGE' },
  unknown: { icon: '◈', label: 'ACTIVITY' },
};

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function limited(value: unknown, max = 80) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '';
}

function html(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-5)}` : address;
}

function amount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: value < 0.0001 ? 9 : 6 }).format(value);
}

function tokenLeg(value: unknown) {
  const token = record(value);
  if (!token) return '';
  const quantity = amount(token.amount);
  const symbol = limited(token.symbol, 20);
  return quantity && symbol ? `${quantity} ${symbol}` : '';
}

function actionLines(activity: NormalizedActivity | undefined, transaction: ParsedSolanaTransaction, walletAddress: string) {
  if (!activity) return [];
  const metadata = record(activity.metadata);
  if (activity.kind === 'swap') {
    const swap = record(metadata?.swap);
    const input = tokenLeg(swap?.input);
    const output = tokenLeg(swap?.output);
    if (input && output) return [`<b>${html(input)}</b>  →  <b>${html(output)}</b>`];
  }
  if (activity.kind === 'yield') {
    const position = record(metadata?.yield);
    const assets = Array.isArray(position?.assets) ? position.assets.slice(0, 3).map(tokenLeg).filter(Boolean) : [];
    const action = position?.action === 'withdraw' ? 'Withdrew' : 'Deposited';
    if (assets.length) return [`${action} <b>${html(assets.join(' + '))}</b>`];
  }
  if (activity.kind === 'launch') {
    const launch = record(metadata?.launch);
    const token = record(launch?.token);
    const symbol = limited(token?.symbol, 24);
    if (symbol) return [`Launched <b>${html(symbol)}</b>`];
  }
  if (activity.kind === 'transfer' || activity.kind === 'balance') {
    const outgoing = (transaction.nativeTransfers ?? []).filter(transfer =>
      transfer.fromUserAccount === walletAddress && transfer.toUserAccount &&
      Number.isSafeInteger(transfer.amount) && Number(transfer.amount) > 0,
    );
    if (outgoing.length) {
      const lines = outgoing.slice(0, 3).map(transfer =>
        `↳ <b>${html(amount(Number(transfer.amount) / 1e9))} SOL</b> → <code>${html(shortAddress(transfer.toUserAccount!))}</code>`,
      );
      if (outgoing.length > 3) lines.push(`↳ and ${outgoing.length - 3} more recipients`);
      return lines;
    }
    const incoming = (transaction.nativeTransfers ?? []).filter(transfer =>
      transfer.toUserAccount === walletAddress && transfer.fromUserAccount &&
      Number.isSafeInteger(transfer.amount) && Number(transfer.amount) > 0,
    );
    if (incoming.length) {
      const lines = incoming.slice(0, 3).map(transfer =>
        `↳ <b>${html(amount(Number(transfer.amount) / 1e9))} SOL</b> ← <code>${html(shortAddress(transfer.fromUserAccount!))}</code>`,
      );
      if (incoming.length > 3) lines.push(`↳ and ${incoming.length - 3} more senders`);
      return lines;
    }
    if (activity.kind === 'balance') return [];
  }
  const title = limited(activity.title, 120);
  return title ? [html(title)] : [];
}

/** One compact Telegram message per transaction, with wallet-scoped net balance changes. */
export function formatTelegramActivity(wallet: WalletDocument, transaction: ParsedSolanaTransaction, activities: NormalizedActivity[]) {
  const failed = transaction.status === 'error' || transaction.transactionStatus === 'ERROR';
  const primary = failed ? undefined : [...activities].sort((left, right) => kindPriority[left.kind] - kindPriority[right.kind])[0];
  const hasTransfer = !failed && primary?.kind === 'balance' && (transaction.nativeTransfers ?? []).some(transfer =>
    transfer.fromUserAccount === wallet.address || transfer.toUserAccount === wallet.address);
  const kind = failed ? 'failed' : hasTransfer ? 'transfer' : primary?.kind ?? 'unknown';
  const { icon, label } = kindLabels[kind];
  const source = limited(primary?.source, 28);
  const walletName = limited(wallet.name, 40) || 'Wallet';
  const lines = [
    `${icon} <b>${label}</b>${source ? ` · ${html(source)}` : ''}`,
    `<b>${html(walletName)}</b>  <code>${html(shortAddress(wallet.address))}</code>`,
  ];

  if (failed) lines.push('', 'Transaction failed; only onchain fees may have changed.');
  else {
    const actions = actionLines(primary, transaction, wallet.address);
    if (actions.length) lines.push('', ...actions);
    const extra = activities.filter(activity => activity !== primary && activity.kind !== 'balance').slice(0, 2)
      .map(activity => limited(activity.title, 100)).filter(Boolean).map(html);
    if (extra.length) lines.push(...extra);
  }

  const balances = transactionBalanceLines(transaction, wallet.address, activities).slice(0, 8);
  lines.push('', '<b>Balance changes</b>', ...balances.map(line => `• <code>${html(limited(line, 100))}</code>`));
  return lines.join('\n');
}
