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

function decimalsForMint(transaction: ParsedSolanaTransaction, mint?: string) {
  if (!mint) return 0;
  if (mint === 'So11111111111111111111111111111111111111112') return 9;
  return transaction.tokenTransfers?.find((transfer) => transfer.mint === mint)?.decimals ?? 0;
}

function formatAmount(amount: number, symbol: string) {
  const digits = amount >= 1000 ? 0 : amount >= 1 ? 2 : 4;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(amount)} ${symbol}`;
}

function titleCase(value: string) {
  if (/^pump([_\s.-]?(fun|amm))?$/i.test(value)) return 'Pump.fun';
  return value.toLowerCase().split(/[_\s-]+/).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function transactionSource(transaction: ParsedSolanaTransaction) {
  const protocol = transaction.summary?.parsedData?.protocol;
  if (typeof protocol === 'string' && protocol) return titleCase(protocol);
  const program = transaction.instructions?.find((instruction) => instruction.programName)?.programName;
  return program ? titleCase(program) : 'Solana';
}

function isPump(source: string) {
  return source.toLowerCase().includes('pump');
}

function swapActivity(
  transaction: ParsedSolanaTransaction,
  base: Omit<NormalizedActivity, 'kind' | 'title' | 'detail'>,
): NormalizedActivity | null {
  const summary = transaction.summary;
  if (summary?.type?.toLowerCase() !== 'swap') return null;

  const data = summary.parsedData ?? {};
  const inputMint = typeof data.input_mint === 'string' ? data.input_mint : undefined;
  const outputMint = typeof data.output_mint === 'string' ? data.output_mint : undefined;
  const inputSymbol = tokenSymbol(inputMint);
  const outputSymbol = tokenSymbol(outputMint);
  const inputAmount = displayAmount(
    typeof data.in_amount === 'string' || typeof data.in_amount === 'number' ? data.in_amount : undefined,
    decimalsForMint(transaction, inputMint),
  );
  const outputRaw = data.actual_out_amount ?? data.out_amount ?? data.output_amount;
  const outputAmount = displayAmount(
    typeof outputRaw === 'string' || typeof outputRaw === 'number' ? outputRaw : undefined,
    decimalsForMint(transaction, outputMint),
  );
  const source = transactionSource(transaction);
  const buy = isPump(source) && !['SOL', 'USDC', 'USDT'].includes(outputSymbol);

  return {
    ...base,
    kind: buy ? 'buy' : 'swap',
    title: buy
      ? `Bought ${formatAmount(outputAmount, outputSymbol)}`
      : `Swapped ${formatAmount(inputAmount, inputSymbol)} to ${formatAmount(outputAmount, outputSymbol)}`,
    detail: buy ? `${source} · spent ${formatAmount(inputAmount, inputSymbol)}` : source,
  };
}

export const solanaAdapter: ChainAdapter<ParsedSolanaTransaction> = {
  chain: 'solana',

  extractAddresses(transaction) {
    const addresses = new Set<string>();
    if (transaction.feePayer) addresses.add(transaction.feePayer);
    transaction.accountKeys?.forEach((address) => addresses.add(address));
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

    const source = transactionSource(transaction);
    const base = {
      chain: 'solana' as const,
      txHash: transaction.signature,
      eventIndex: 0,
      occurredAt: new Date((transaction.blockTime ?? Date.now() / 1000) * 1000),
      source,
      metadata: {
        slot: transaction.slot,
        summaryType: transaction.summary?.type ?? null,
        watchedAddress,
      },
    };

    const swap = swapActivity(transaction, base);
    if (swap) return [swap];

    const stakeInstruction = transaction.instructions?.find((instruction) => {
      const program = instruction.programName ?? '';
      const name = instruction.instructionName ?? '';
      return /stake|marinade|jito/i.test(program) && /stake|delegate|deposit/i.test(name);
    });
    if (transaction.summary?.type?.toLowerCase() === 'stake' || stakeInstruction) {
      const lamports = transaction.nativeTransfers?.reduce((sum, item) => sum + (item.amount ?? 0), 0) ?? 0;
      return [{
        ...base,
        kind: 'stake',
        title: lamports > 0 ? `Staked ${formatAmount(lamports / 1e9, 'SOL')}` : 'Updated SOL stake',
        detail: source,
      }];
    }

    const tokenTransfer = transaction.tokenTransfers?.find((transfer) =>
      transfer.fromUserAccount === watchedAddress || transfer.toUserAccount === watchedAddress,
    );
    if (tokenTransfer) {
      const incoming = tokenTransfer.toUserAccount === watchedAddress;
      return [{
        ...base,
        kind: 'transfer',
        title: `${incoming ? 'Received' : 'Sent'} ${formatAmount(
          displayAmount(tokenTransfer.rawTokenAmount, tokenTransfer.decimals),
          tokenSymbol(tokenTransfer.mint),
        )}`,
        detail: incoming
          ? `From ${tokenTransfer.fromUserAccount?.slice(0, 4) ?? 'unknown'}…${tokenTransfer.fromUserAccount?.slice(-4) ?? ''}`
          : `To ${tokenTransfer.toUserAccount?.slice(0, 4) ?? 'unknown'}…${tokenTransfer.toUserAccount?.slice(-4) ?? ''}`,
      }];
    }

    const nativeTransfer = transaction.nativeTransfers?.find((transfer) =>
      transfer.fromUserAccount === watchedAddress || transfer.toUserAccount === watchedAddress,
    );
    if (nativeTransfer) {
      const incoming = nativeTransfer.toUserAccount === watchedAddress;
      return [{
        ...base,
        kind: 'transfer',
        title: `${incoming ? 'Received' : 'Sent'} ${formatAmount((nativeTransfer.amount ?? 0) / 1e9, 'SOL')}`,
        detail: source,
      }];
    }

    return [{
      ...base,
      kind: 'unknown',
      title: transaction.summary?.description?.slice(0, 140) || 'Interacted on Solana',
      detail: source,
    }];
  },
};
