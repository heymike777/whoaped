import type { ParsedSolanaTransaction } from '../chains/solana.js';
import type { NormalizedActivity } from '../chains/types.js';

const symbols: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'WSOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYDshorBZG77ZK1k3m1dAWF: 'USDT',
};
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

function atomic(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return;
  if (typeof value !== 'number' && typeof value !== 'string') return;
  if (!/^-?\d+$/.test(String(value))) return;
  return BigInt(value);
}

function signedAmount(amount: bigint, decimals: number) {
  const digits = (amount < 0n ? -amount : amount).toString().padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return `${amount < 0n ? '−' : '+'}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Wallet-scoped net changes, independent of instruction/activity classification. */
export function transactionBalanceLines(transaction: ParsedSolanaTransaction, address: string, activities: NormalizedActivity[]) {
  const failed = transaction.status === 'error' || transaction.transactionStatus === 'ERROR';
  const labels = { ...symbols };
  for (const activity of activities) {
    const actions = activity.metadata.tokenActions;
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      const token = action?.token;
      if (typeof token?.mint === 'string' && typeof token.symbol === 'string' && !labels[token.mint]) {
        labels[token.mint] = token.symbol.replace(/[\r\n]/g, ' ').slice(0, 24);
      }
    }
  }
  let native = atomic(transaction.nativeBalanceChanges?.[address])
    ?? atomic(transaction.accountData?.find(account => account.account === address)?.nativeBalanceChange);
  if (native == null) {
    if (!failed && transaction.nativeTransfers != null) {
      native = 0n;
      for (const transfer of transaction.nativeTransfers) {
        const amount = atomic(transfer.amount);
        if (amount == null) continue;
        if (transfer.toUserAccount === address) native += amount;
        if (transfer.fromUserAccount === address) native -= amount;
      }
    }
    if (transaction.feePayer === address && atomic(transaction.fee) != null) {
      native = (native ?? 0n) - atomic(transaction.fee)!;
    }
  }
  const tokens = new Map<string, { amount: bigint; decimals: number }>();
  // Parsed Events reports both the SOL funding a WSOL account and the subsequent
  // WSOL transfer. The latter is not a second debit from the watched wallet.
  const syncedAccounts = new Set((transaction.instructions ?? [])
    .filter(instruction => instruction.instructionName?.replace(/[^a-z]/gi, '').toLowerCase() === 'syncnative')
    .flatMap(instruction => instruction.decoded?.accounts?.filter(account => account.name === 'account')
      .map(account => account.pubkey).filter((pubkey): pubkey is string => Boolean(pubkey)) ?? []));
  const closedToWallet = new Set((transaction.instructions ?? [])
    .filter(instruction => instruction.instructionName?.replace(/[^a-z]/gi, '').toLowerCase() === 'closeaccount'
      && instruction.decoded?.accounts?.some(account => account.name === 'destination' && account.pubkey === address))
    .flatMap(instruction => instruction.decoded?.accounts?.filter(account => account.name === 'account')
      .map(account => account.pubkey).filter((pubkey): pubkey is string => Boolean(pubkey)) ?? []));
  const nativeWrapped = new Map<string, bigint>();
  for (const transfer of transaction.nativeTransfers ?? []) {
    const amount = atomic(transfer.amount);
    if (transfer.fromUserAccount !== address || !transfer.toUserAccount || !syncedAccounts.has(transfer.toUserAccount)
      || amount == null || amount <= 0n) continue;
    nativeWrapped.set(transfer.toUserAccount, (nativeWrapped.get(transfer.toUserAccount) ?? 0n) + amount);
  }
  for (const transfer of transaction.nativeTransfers ?? []) {
    const amount = atomic(transfer.amount);
    const funded = transfer.fromUserAccount ? nativeWrapped.get(transfer.fromUserAccount) : undefined;
    if (transfer.toUserAccount !== address || amount == null || funded == null) continue;
    nativeWrapped.set(transfer.fromUserAccount!, funded > amount ? funded - amount : 0n);
  }
  const add = (mint: string | undefined, raw: unknown, decimals: number | undefined, direction = 1n) => {
    const amount = atomic(raw);
    if (!mint || amount == null || decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return;
    const previous = tokens.get(mint);
    if (previous && previous.decimals !== decimals) return;
    tokens.set(mint, { amount: (previous?.amount ?? 0n) + amount * direction, decimals });
  };
  // Failed instructions roll back their transfers; only actual native balance/fee remains.
  if (!failed) {
    for (const account of transaction.accountData ?? []) {
      for (const change of account.tokenBalanceChanges ?? []) {
        if (change.userAccount !== address) continue;
        const raw = change.rawTokenAmount;
        add(change.mint, typeof raw === 'object' ? raw.tokenAmount : raw,
          typeof raw === 'object' ? raw.decimals ?? change.decimals : change.decimals);
      }
    }
    const authoritative = new Set(tokens.keys());
    for (const transfer of transaction.tokenTransfers ?? []) {
      if (!transfer.mint || authoritative.has(transfer.mint)) continue;
      if (transfer.mint === WRAPPED_SOL_MINT && transfer.decimals === 9) {
        const raw = atomic(transfer.rawTokenAmount);
        const source = transfer.fromTokenAccount;
        const destination = transfer.toTokenAccount;
        if (transfer.fromUserAccount === address && source && raw != null && raw > 0n) {
          const funded = nativeWrapped.get(source) ?? 0n;
          const duplicate = raw < funded ? raw : funded;
          nativeWrapped.set(source, funded - duplicate);
          add(transfer.mint, raw - duplicate, 9, -1n);
          continue;
        }
        if (transfer.toUserAccount === address && destination && closedToWallet.has(destination)
          && transaction.nativeTransfers?.some(nativeTransfer => nativeTransfer.fromUserAccount === destination
            && nativeTransfer.toUserAccount === address)) continue;
      }
      if (transfer.toUserAccount === address) add(transfer.mint, transfer.rawTokenAmount, transfer.decimals);
      if (transfer.fromUserAccount === address) add(transfer.mint, transfer.rawTokenAmount, transfer.decimals, -1n);
    }
  }
  const lines: string[] = [];
  if (native != null && native !== 0n) lines.push(`${signedAmount(native, 9)} SOL`);
  for (const [mint, { amount, decimals }] of tokens) {
    if (amount !== 0n) lines.push(`${signedAmount(amount, decimals)} ${labels[mint] ?? mint}`);
  }
  if (!lines.length) lines.push(native != null || tokens.size ? 'No balance changes' : 'Balance changes unavailable');
  return lines;
}
