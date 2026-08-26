import type { ChainAdapter, NormalizedActivity } from './types.js';

type TokenAmount = {
  tokenAmount?: number;
  rawTokenAmount?: { tokenAmount?: string; decimals?: number };
};

type TokenTransfer = TokenAmount & {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
};

export type HeliusTransaction = {
  signature?: string;
  timestamp?: number;
  type?: string;
  source?: string;
  description?: string;
  feePayer?: string;
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
  tokenTransfers?: TokenTransfer[];
  accountData?: Array<{ account?: string }>;
  events?: {
    swap?: {
      nativeInput?: { amount?: number };
      nativeOutput?: { amount?: number };
      tokenInputs?: TokenTransfer[];
      tokenOutputs?: TokenTransfer[];
    };
  };
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

function tokenAmount(value?: TokenAmount) {
  if (!value) return 0;
  if (typeof value.tokenAmount === 'number') return value.tokenAmount;
  const raw = Number(value.rawTokenAmount?.tokenAmount ?? 0);
  return raw / 10 ** (value.rawTokenAmount?.decimals ?? 0);
}

function formatAmount(amount: number, symbol: string) {
  const digits = amount >= 1000 ? 0 : amount >= 1 ? 2 : 4;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(amount)} ${symbol}`;
}

function sourceLabel(source?: string) {
  if (!source) return 'Solana';
  return source.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function isPump(source?: string) {
  return Boolean(source?.toUpperCase().includes('PUMP'));
}

export const solanaAdapter: ChainAdapter<HeliusTransaction> = {
  chain: 'solana',

  extractAddresses(transaction) {
    const addresses = new Set<string>();
    if (transaction.feePayer) addresses.add(transaction.feePayer);
    transaction.accountData?.forEach(({ account }) => account && addresses.add(account));
    transaction.nativeTransfers?.forEach(({ fromUserAccount, toUserAccount }) => {
      if (fromUserAccount) addresses.add(fromUserAccount);
      if (toUserAccount) addresses.add(toUserAccount);
    });
    transaction.tokenTransfers?.forEach(({ fromUserAccount, toUserAccount }) => {
      if (fromUserAccount) addresses.add(fromUserAccount);
      if (toUserAccount) addresses.add(toUserAccount);
    });
    return [...addresses];
  },

  normalize(transaction, watchedAddress) {
    const signature = transaction.signature;
    if (!signature) return [];

    const base = {
      chain: 'solana' as const,
      txHash: signature,
      eventIndex: 0,
      occurredAt: new Date((transaction.timestamp ?? Date.now() / 1000) * 1000),
      source: sourceLabel(transaction.source),
      metadata: { heliusType: transaction.type, watchedAddress },
    };

    const swap = transaction.events?.swap;
    if (swap) {
      const inputToken = swap.tokenInputs?.[0];
      const outputToken = swap.tokenOutputs?.[0];
      const inputSymbol = inputToken ? tokenSymbol(inputToken.mint) : 'SOL';
      const outputSymbol = outputToken ? tokenSymbol(outputToken.mint) : 'SOL';
      const inputAmount = inputToken ? tokenAmount(inputToken) : (swap.nativeInput?.amount ?? 0) / 1e9;
      const outputAmount = outputToken ? tokenAmount(outputToken) : (swap.nativeOutput?.amount ?? 0) / 1e9;
      const buy = isPump(transaction.source) && !['SOL', 'USDC', 'USDT'].includes(outputSymbol);

      return [{
        ...base,
        kind: buy ? 'buy' : 'swap',
        title: buy
          ? `Bought ${formatAmount(outputAmount, outputSymbol)}`
          : `Swapped ${formatAmount(inputAmount, inputSymbol)} to ${formatAmount(outputAmount, outputSymbol)}`,
        detail: buy
          ? `Pump.fun · spent ${formatAmount(inputAmount, inputSymbol)}`
          : sourceLabel(transaction.source),
      }];
    }

    if (transaction.type?.includes('STAKE')) {
      const lamports = transaction.nativeTransfers?.reduce((sum, item) => sum + (item.amount ?? 0), 0) ?? 0;
      return [{ ...base, kind: 'stake', title: `Staked ${formatAmount(lamports / 1e9, 'SOL')}`, detail: sourceLabel(transaction.source) }];
    }

    const tokenTransfer = transaction.tokenTransfers?.find((transfer) =>
      transfer.fromUserAccount === watchedAddress || transfer.toUserAccount === watchedAddress,
    );
    if (tokenTransfer) {
      const incoming = tokenTransfer.toUserAccount === watchedAddress;
      return [{
        ...base,
        kind: 'transfer',
        title: `${incoming ? 'Received' : 'Sent'} ${formatAmount(tokenAmount(tokenTransfer), tokenSymbol(tokenTransfer.mint))}`,
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
      return [{ ...base, kind: 'transfer', title: `${incoming ? 'Received' : 'Sent'} ${formatAmount((nativeTransfer.amount ?? 0) / 1e9, 'SOL')}`, detail: sourceLabel(transaction.source) }];
    }

    return [{
      ...base,
      kind: 'unknown',
      title: transaction.description?.slice(0, 140) || 'Interacted on Solana',
      detail: sourceLabel(transaction.source),
    }];
  },
};
