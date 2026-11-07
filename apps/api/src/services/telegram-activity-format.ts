import type { ParsedSolanaTransaction } from '../chains/solana.js';
import type { NormalizedActivity } from '../chains/types.js';
import type { WalletDocument } from '../db.js';
import { transactionBalanceLines } from './transaction-balances.js';

type RecordValue = Record<string, unknown>;
const kindPriority: Record<NormalizedActivity['kind'], number> = {
  failed: 0, swap: 1, yield: 2, launch: 3, multisig: 4, nft: 5,
  stake: 6, buy: 7, claim: 8, transfer: 9, balance: 10, unknown: 11,
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
  claim: { icon: '🪙', label: 'CLAIM FEES' },
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

function participant(address: string, addressLabels: ReadonlyMap<string, string>) {
  const label = limited(addressLabels.get(address), 40);
  return `${label ? `<b>${html(label)}</b>  ` : ''}<code>${html(shortAddress(address))}</code>`;
}

function actionLines(activity: NormalizedActivity | undefined, transaction: ParsedSolanaTransaction, walletAddress: string, addressLabels: ReadonlyMap<string, string>) {
  if (!activity) return [];
  const metadata = record(activity.metadata);
  if (activity.kind === 'swap') {
    const swap = record(metadata?.swap);
    const steps = Array.isArray(swap?.steps) ? swap.steps : [];
    if (steps.length > 1) {
      const lines = steps.slice(0, 12).flatMap((rawStep, index) => {
        const step = record(rawStep);
        if (!step) return [];
        const input = tokenLeg(step.input);
        const output = tokenLeg(step.output);
        if (!input || !output) return [];
        return [`${index + 1}. <b>${html(input)}</b> → <b>${html(output)}</b> · ${html(limited(step.dexName, 28) || 'DEX')}`];
      });
      if (steps.length > 12) lines.push(`…and ${steps.length - 12} more swaps`);
      const arbitrage = record(swap?.arbitrage);
      if (arbitrage && typeof arbitrage.profit === 'number' && Number.isFinite(arbitrage.profit)) {
        const sign = arbitrage.profit >= 0 ? '+' : '−';
        lines.push(`<b>Net result: ${sign}${html(amount(Math.abs(arbitrage.profit)))} ${html(limited(arbitrage.symbol, 20))}</b>${arbitrage.includesNetworkFee ? ' (incl. network fee)' : ''}`);
      }
      if (lines.length) return lines;
    }
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
  if (activity.kind === 'nft') {
    const nft = record(metadata?.nft);
    if (nft) {
      const label = limited(nft.name, 80) || limited(nft.mint, 44) || 'NFT';
      const price = typeof nft.priceSol === 'number' && Number.isFinite(nft.priceSol)
        ? ` for <b>${html(amount(nft.priceSol))} SOL</b>` : '';
      const verb = nft.action === 'list' ? 'Listed' : nft.action === 'delist' ? 'Delisted'
        : nft.action === 'bid' ? 'Bid on' : nft.action === 'mint' ? 'Minted'
          : nft.action === 'receive' ? 'Received' : nft.action === 'send' ? 'Sent'
            : nft.action === 'transfer' ? 'Transferred' : nft.action === 'burn' ? 'Burned'
              : nft.actor === 'buyer' ? 'Bought' : 'Sold';
      return [`${verb} <b>${html(label)}</b>${nft.action === 'list' || nft.action === 'bid' ? price : ''}`];
    }
  }
  if (activity.kind === 'claim') {
    const claim = record(metadata?.claim);
    const quantity = typeof claim?.amountSol === 'number' && Number.isFinite(claim.amountSol) && claim.amountSol > 0
      ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 9 }).format(claim.amountSol) : '';
    return [quantity ? `Claimed <b>${html(quantity)} SOL</b> in creator fees` : 'Claimed creator fees'];
  }
  if (activity.kind === 'transfer' || activity.kind === 'balance') {
    const outgoing = (transaction.nativeTransfers ?? []).filter(transfer =>
      transfer.fromUserAccount === walletAddress && transfer.toUserAccount &&
      Number.isSafeInteger(transfer.amount) && Number(transfer.amount) > 0,
    );
    if (outgoing.length) {
      const lines = outgoing.slice(0, 3).map(transfer =>
        `↳ <b>${html(amount(Number(transfer.amount) / 1e9))} SOL</b> → ${participant(transfer.toUserAccount!, addressLabels)}`,
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
        `↳ <b>${html(amount(Number(transfer.amount) / 1e9))} SOL</b> ← ${participant(transfer.fromUserAccount!, addressLabels)}`,
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
export function formatTelegramActivity(wallet: WalletDocument, transaction: ParsedSolanaTransaction, activities: NormalizedActivity[], addressLabels: ReadonlyMap<string, string> = new Map()) {
  return formatTelegramActivityGroup([{ wallet, activities }], transaction, addressLabels);
}

export function formatTelegramActivityGroup(
  entries: Array<{ wallet: WalletDocument; activities: NormalizedActivity[] }>,
  transaction: ParsedSolanaTransaction,
  addressLabels: ReadonlyMap<string, string> = new Map(),
) {
  if (!entries.length) throw new Error('A Telegram transaction needs at least one wallet.');
  const failed = transaction.status === 'error' || transaction.transactionStatus === 'ERROR';
  const allActivities = entries.flatMap(({ wallet, activities }) => activities.map(activity => ({ wallet, activity })));
  const primaryEntry = failed ? undefined : [...allActivities].sort((left, right) => kindPriority[left.activity.kind] - kindPriority[right.activity.kind])[0];
  const primary = primaryEntry?.activity;
  const transferWallet = entries.find(({ wallet }) => (transaction.nativeTransfers ?? []).some(transfer => transfer.fromUserAccount === wallet.address))?.wallet
    ?? primaryEntry?.wallet ?? entries[0].wallet;
  const hasTransfer = !failed && primary?.kind === 'balance' && (transaction.nativeTransfers ?? []).some(transfer =>
    entries.some(({ wallet }) => transfer.fromUserAccount === wallet.address || transfer.toUserAccount === wallet.address));
  const kind = failed ? 'failed' : hasTransfer ? 'transfer' : primary?.kind ?? 'unknown';
  const { icon, label } = kindLabels[kind];
  const isArbitrage = kind === 'swap' && Boolean(record(record(primary?.metadata)?.swap)?.arbitrage);
  const source = limited(primary?.source, 28);
  const lines = [
    `${icon} <b>${isArbitrage ? 'ARBITRAGE' : label}</b>${source && !isArbitrage ? ` · ${html(source)}` : ''}`,
  ];
  if (entries.length === 1) {
    const wallet = entries[0].wallet;
    lines.push(`<b>${html(limited(wallet.name, 40) || 'Wallet')}</b>  <code>${html(shortAddress(wallet.address))}</code>`);
  } else {
    lines.push(`${entries.length} tracked wallets`);
  }

  if (failed) lines.push('', 'Transaction failed; only onchain fees may have changed.');
  else {
    const actions = actionLines(primary, transaction, transferWallet.address, addressLabels);
    if (actions.length) lines.push('', ...actions);
    const extra = [...new Set(allActivities.map(({ activity }) => activity).filter(activity => activity !== primary && activity.kind !== 'balance')
      .map(activity => limited(activity.title, 100)).filter(Boolean).map(html))].slice(0, 2);
    if (extra.length) lines.push(...extra);
  }

  lines.push('', '<b>Balance changes</b>');
  for (const { wallet, activities } of entries) {
    if (entries.length > 1) lines.push(`<b>${html(limited(wallet.name, 40) || 'Wallet')}</b>  <code>${html(shortAddress(wallet.address))}</code>`);
    const balances = transactionBalanceLines(transaction, wallet.address, activities).slice(0, 8);
    lines.push(...balances.map(line => `• <code>${html(limited(line, 100))}</code>`));
  }
  return lines.join('\n');
}
