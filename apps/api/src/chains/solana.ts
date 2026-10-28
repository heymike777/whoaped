import type { ChainAdapter, NormalizedActivity } from './types.js';

export type ParsedTokenTransfer = {
  fromUserAccount?: string | null;
  toUserAccount?: string | null;
  fromTokenAccount?: string | null;
  toTokenAccount?: string | null;
  rawTokenAmount?: number | string;
  decimals?: number;
  mint?: string;
};

type ParsedTokenBalanceChange = {
  userAccount?: string | null;
  mint?: string;
  rawTokenAmount?: number | string | {
    tokenAmount?: number | string;
    decimals?: number;
  };
  decimals?: number;
};

export type ParsedSummary = {
  type?: string;
  description?: string;
  parsedData?: Record<string, unknown> | null;
};

export type ParsedInstruction = {
  programId?: string;
  programName?: string | null;
  instructionName?: string | null;
  rawAccounts?: string[];
  summary?: ParsedSummary | null;
  decoded?: {
    args?: Record<string, unknown>;
    accounts?: Array<{ name?: string; pubkey?: string }>;
  } | null;
};

export type ParsedSolanaTransaction = {
  signature: string;
  slot: number;
  blockTime?: number | null;
  feePayer?: string | null;
  accountKeys?: string[];
  status?: 'ok' | 'error';
  transactionStatus?: 'OK' | 'ERROR';
  summary?: ParsedSummary | null;
  nativeTransfers?: Array<{
    fromUserAccount?: string | null;
    toUserAccount?: string | null;
    amount?: number;
  }>;
  tokenTransfers?: ParsedTokenTransfer[];
  accountData?: Array<{
    account?: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: ParsedTokenBalanceChange[];
  }>;
  instructions?: ParsedInstruction[];
};

const KNOWN_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYDshorBZG77ZK1k3m1dAWF: 'USDT',
};

function tokenSymbol(mint?: string) {
  if (!mint) return 'token';
  return KNOWN_SYMBOLS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function displayAmount(raw: number | string | undefined, decimals = 0) {
  const amount = Number(raw ?? 0) / 10 ** decimals;
  return Number.isFinite(amount) ? amount : 0;
}

function formatAmount(amount: number, symbol: string) {
  const absolute = Math.abs(amount);
  const digits = absolute >= 1000 ? 0 : absolute >= 1 ? 2 : 9;
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(absolute);
  return `${amount > 0 ? '+' : '−'}${formatted} ${symbol}`;
}

function addDelta(deltas: Map<string, number>, symbol: string, amount: number) {
  if (!Number.isFinite(amount) || Math.abs(amount) < Number.EPSILON) return;
  deltas.set(symbol, (deltas.get(symbol) ?? 0) + amount);
}

function accountBalanceDeltas(transaction: ParsedSolanaTransaction, watchedAddress: string) {
  const deltas = new Map<string, number>();
  let foundWatchedAccount = false;
  transaction.accountData?.forEach((account) => {
    if (account.account === watchedAddress) {
      foundWatchedAccount = true;
      addDelta(deltas, 'SOL', (account.nativeBalanceChange ?? 0) / 1e9);
    }
    account.tokenBalanceChanges?.forEach((change) => {
      if (change.userAccount !== watchedAddress) return;
      foundWatchedAccount = true;
      const raw = typeof change.rawTokenAmount === 'object'
        ? change.rawTokenAmount.tokenAmount
        : change.rawTokenAmount;
      const decimals = typeof change.rawTokenAmount === 'object'
        ? change.rawTokenAmount.decimals ?? change.decimals ?? 0
        : change.decimals ?? 0;
      addDelta(deltas, tokenSymbol(change.mint), displayAmount(raw, decimals));
    });
  });
  return foundWatchedAccount ? deltas : null;
}

function transferBalanceDeltas(transaction: ParsedSolanaTransaction, watchedAddress: string) {
  const deltas = new Map<string, number>();
  transaction.nativeTransfers?.forEach((transfer) => {
    const amount = (transfer.amount ?? 0) / 1e9;
    if (transfer.toUserAccount === watchedAddress) addDelta(deltas, 'SOL', amount);
    if (transfer.fromUserAccount === watchedAddress) addDelta(deltas, 'SOL', -amount);
  });
  transaction.tokenTransfers?.forEach((transfer) => {
    const amount = displayAmount(transfer.rawTokenAmount, transfer.decimals);
    const symbol = tokenSymbol(transfer.mint);
    if (transfer.toUserAccount === watchedAddress) addDelta(deltas, symbol, amount);
    if (transfer.fromUserAccount === watchedAddress) addDelta(deltas, symbol, -amount);
  });
  return deltas;
}

function balanceActivity(
  transaction: ParsedSolanaTransaction,
  watchedAddress: string,
  base: Omit<NormalizedActivity, 'kind' | 'title' | 'detail'>,
): NormalizedActivity | null {
  const deltas = accountBalanceDeltas(transaction, watchedAddress)
    ?? transferBalanceDeltas(transaction, watchedAddress);
  const changes = [...deltas.entries()]
    .filter(([, amount]) => Math.abs(amount) >= Number.EPSILON)
    .sort((left, right) => {
      if ((left[1] < 0) !== (right[1] < 0)) return left[1] < 0 ? -1 : 1;
      return Math.abs(right[1]) - Math.abs(left[1]);
    });
  if (!changes.length) return null;

  return {
    ...base,
    kind: 'balance',
    title: changes.map(([symbol, amount]) => formatAmount(amount, symbol)).join('  ·  '),
    detail: 'Balance change',
  };
}

export const solanaAdapter: ChainAdapter<ParsedSolanaTransaction> = {
  chain: 'solana',

  extractAddresses(transaction) {
    const addresses = new Set<string>();
    if (transaction.feePayer) addresses.add(transaction.feePayer);
    transaction.accountKeys?.forEach((address) => addresses.add(address));
    transaction.accountData?.forEach(({ account, tokenBalanceChanges }) => {
      if (account) addresses.add(account);
      tokenBalanceChanges?.forEach(({ userAccount }) => userAccount && addresses.add(userAccount));
    });
    transaction.nativeTransfers?.forEach(({ fromUserAccount, toUserAccount }) => {
      if (fromUserAccount) addresses.add(fromUserAccount);
      if (toUserAccount) addresses.add(toUserAccount);
    });
    transaction.tokenTransfers?.forEach(({ fromUserAccount, toUserAccount }) => {
      if (fromUserAccount) addresses.add(fromUserAccount);
      if (toUserAccount) addresses.add(toUserAccount);
    });
    transaction.instructions?.forEach((instruction) => {
      instruction.rawAccounts?.forEach((address) => addresses.add(address));
      instruction.decoded?.accounts?.forEach(({ pubkey }) => pubkey && addresses.add(pubkey));
    });
    return [...addresses];
  },

  normalize(transaction, watchedAddress) {
    if (!transaction.signature) return [];

    const base = {
      chain: 'solana' as const,
      txHash: transaction.signature,
      eventIndex: 0,
      occurredAt: new Date((transaction.blockTime ?? Date.now() / 1000) * 1000),
      metadata: { slot: transaction.slot, watchedAddress },
    };

    const activity = balanceActivity(transaction, watchedAddress, base);
    return activity ? [activity] : [];
  },
};
