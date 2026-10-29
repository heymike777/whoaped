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

const METAPLEX_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const SQUADS_V4_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

type SwapDex = 'jupiter' | 'pumpfun' | 'meteora' | 'orca' | 'titan' | 'raydium';

const DEXES: Array<{ id: SwapDex; name: string; aliases: string[] }> = [
  { id: 'jupiter', name: 'Jupiter', aliases: ['jupiter', 'metis'] },
  { id: 'pumpfun', name: 'Pump.fun', aliases: ['pumpfun', 'pumpswap', 'pumpamm', 'pump'] },
  { id: 'meteora', name: 'Meteora', aliases: ['meteora', 'dlmm', 'damm'] },
  { id: 'orca', name: 'Orca', aliases: ['orca', 'whirlpool'] },
  { id: 'titan', name: 'Titan', aliases: ['titan'] },
  { id: 'raydium', name: 'Raydium', aliases: ['raydium'] },
];

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

function canonical(value?: string | null) {
  return (value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : undefined;
}

function parsedValue(parsedData: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!parsedData) return undefined;
  const wanted = new Set(keys.map(canonical));
  const entry = Object.entries(parsedData).find(([key]) => wanted.has(canonical(key)));
  return stringValue(entry?.[1]);
}

function swapDex(transaction: ParsedSolanaTransaction) {
  const candidates = [
    parsedValue(transaction.summary?.parsedData, 'protocol', 'source', 'platform', 'dex'),
    transaction.summary?.description,
    ...((transaction.instructions ?? []).flatMap((instruction) => [
      instruction.programName,
      instruction.instructionName,
      instruction.summary?.description,
    ])),
  ].map((value) => canonical(value));
  return DEXES.find((dex) => candidates.some((candidate) =>
    dex.aliases.some((alias) => candidate.includes(canonical(alias))),
  ));
}

function decimalsForMint(transaction: ParsedSolanaTransaction, mint: string) {
  if (mint === 'So11111111111111111111111111111111111111112') return 9;
  const transfer = transaction.tokenTransfers?.find((item) => item.mint === mint && item.decimals != null);
  if (transfer?.decimals != null) return transfer.decimals;
  for (const account of transaction.accountData ?? []) {
    const change = account.tokenBalanceChanges?.find((item) => item.mint === mint);
    if (!change) continue;
    if (typeof change.rawTokenAmount === 'object' && change.rawTokenAmount.decimals != null) {
      return change.rawTokenAmount.decimals;
    }
    if (change.decimals != null) return change.decimals;
  }
  return 0;
}

function inferredSwapLegs(transaction: ParsedSolanaTransaction, watchedAddress: string) {
  const legs: Array<{ mint: string; amount: number }> = [];
  const native = transaction.accountData?.find((account) => account.account === watchedAddress)?.nativeBalanceChange;
  if (native) legs.push({ mint: 'So11111111111111111111111111111111111111112', amount: native / 1e9 });
  transaction.accountData?.forEach((account) => account.tokenBalanceChanges?.forEach((change) => {
    if (change.userAccount !== watchedAddress || !change.mint) return;
    const raw = typeof change.rawTokenAmount === 'object'
      ? change.rawTokenAmount.tokenAmount
      : change.rawTokenAmount;
    const decimals = typeof change.rawTokenAmount === 'object'
      ? change.rawTokenAmount.decimals ?? change.decimals ?? 0
      : change.decimals ?? 0;
    const amount = displayAmount(raw, decimals);
    if (amount) legs.push({ mint: change.mint, amount });
  }));
  return legs;
}

function swapActivity(
  transaction: ParsedSolanaTransaction,
  watchedAddress: string,
  base: Omit<NormalizedActivity, 'kind' | 'title' | 'detail'>,
): NormalizedActivity | null {
  const summaryType = canonical(transaction.summary?.type);
  const description = canonical(transaction.summary?.description);
  const dex = swapDex(transaction);
  if (!dex) return null;
  const isTrade = ['swap', 'buy', 'sell'].some((type) => summaryType.includes(type))
    || ['swap', 'bought', 'sold'].some((verb) => description.includes(verb));
  if (!isTrade) return null;

  const data = transaction.summary?.parsedData;
  const inferred = inferredSwapLegs(transaction, watchedAddress);
  const inputMint = parsedValue(data, 'input_mint', 'inputMint', 'source_mint', 'sourceMint', 'token_in_mint')
    ?? inferred.find((leg) => leg.amount < 0)?.mint;
  const outputMint = parsedValue(data, 'output_mint', 'outputMint', 'destination_mint', 'destinationMint', 'token_out_mint')
    ?? inferred.find((leg) => leg.amount > 0)?.mint;
  if (!inputMint || !outputMint || inputMint === outputMint) return null;

  const inputRaw = parsedValue(data, 'in_amount', 'input_amount', 'inputAmount', 'amount_in');
  const outputRaw = parsedValue(data, 'actual_out_amount', 'out_amount', 'output_amount', 'outputAmount', 'amount_out');
  const inferredInput = inferred.find((leg) => leg.mint === inputMint && leg.amount < 0);
  const inferredOutput = inferred.find((leg) => leg.mint === outputMint && leg.amount > 0);
  const inputAmount = inferredInput
    ? Math.abs(inferredInput.amount)
    : displayAmount(inputRaw, decimalsForMint(transaction, inputMint));
  const outputAmount = inferredOutput
    ? Math.abs(inferredOutput.amount)
    : displayAmount(outputRaw, decimalsForMint(transaction, outputMint));
  if (!inputAmount || !outputAmount) return null;

  const inputSymbol = tokenSymbol(inputMint);
  const outputSymbol = tokenSymbol(outputMint);
  const displayInput = formatAmount(-inputAmount, inputSymbol).slice(1);
  const displayOutput = formatAmount(outputAmount, outputSymbol).slice(1);
  return {
    ...base,
    kind: 'swap',
    title: `Swapped ${displayInput} → ${displayOutput}`,
    detail: dex.name,
    source: dex.name,
    metadata: {
      ...base.metadata,
      swap: {
        dex: dex.id,
        dexName: dex.name,
        input: { mint: inputMint, symbol: inputSymbol, amount: inputAmount },
        output: { mint: outputMint, symbol: outputSymbol, amount: outputAmount },
      },
    },
  };
}

function namedAccount(instruction: ParsedInstruction, ...names: string[]) {
  const wanted = new Set(names.map(canonical));
  return instruction.decoded?.accounts?.find((account) => wanted.has(canonical(account.name)))?.pubkey;
}

function instructionTouches(instruction: ParsedInstruction, watchedAddress: string) {
  return instruction.decoded?.accounts?.some((account) => account.pubkey === watchedAddress) ?? false;
}

function decodedIndex(instruction: ParsedInstruction) {
  const entry = Object.entries(instruction.decoded?.args ?? {})
    .find(([key]) => ['transactionindex', 'proposalindex', 'index'].includes(canonical(key)));
  if (!entry || !['string', 'number', 'bigint'].includes(typeof entry[1])) return '';
  return ` #${String(entry[1])}`;
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

function semanticActivity(
  transaction: ParsedSolanaTransaction,
  watchedAddress: string,
  base: Omit<NormalizedActivity, 'kind' | 'title' | 'detail'>,
): NormalizedActivity | null {
  const relevant = transaction.instructions?.filter((instruction) =>
    instructionTouches(instruction, watchedAddress) || transaction.feePayer === watchedAddress,
  ) ?? [];

  const core = relevant.find((instruction) => {
    const program = canonical(instruction.programName);
    return instruction.programId === METAPLEX_CORE_PROGRAM
      || program === 'mplcore'
      || program === 'metaplexcore';
  });
  if (core) {
    const name = canonical(core.instructionName);
    let title: string | null = null;
    if (['createv1', 'createv2'].includes(name)) title = 'Minted Core NFT';
    if (name === 'transferv1') {
      const newOwner = namedAccount(core, 'new_owner', 'newOwner');
      const previousOwner = namedAccount(core, 'owner', 'authority');
      title = newOwner === watchedAddress
        ? 'Received Core NFT'
        : previousOwner === watchedAddress
          ? 'Sent Core NFT'
          : 'Transferred Core NFT';
    }
    if (name === 'burnv1') title = 'Burned Core NFT';
    if (title) return { ...base, kind: 'nft', title, detail: 'Metaplex Core', source: 'Metaplex Core' };
  }

  const squads = relevant.find((instruction) => {
    const program = canonical(instruction.programName);
    return instruction.programId === SQUADS_V4_PROGRAM || program.includes('squads');
  });
  if (squads) {
    const name = canonical(squads.instructionName);
    const index = decodedIndex(squads);
    const titles: Record<string, string> = {
      proposalcreate: `Created Squads proposal${index}`,
      proposalactivate: `Activated Squads proposal${index}`,
      proposalapprove: `Approved Squads proposal${index}`,
      proposalreject: `Rejected Squads proposal${index}`,
      proposalcancel: `Cancelled Squads proposal${index}`,
      vaulttransactionexecute: `Executed Squads proposal${index}`,
      configtransactionexecute: `Executed Squads config proposal${index}`,
      batchexecute: `Executed Squads batch${index}`,
    };
    const title = titles[name];
    if (title) return { ...base, kind: 'multisig', title, detail: 'Squads multisig', source: 'Squads' };
  }

  return null;
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

    const swap = swapActivity(transaction, watchedAddress, base);
    if (swap) return [swap];

    const semantic = semanticActivity(transaction, watchedAddress, base);
    const balance = balanceActivity(transaction, watchedAddress, base);
    if (semantic) {
      return [{
        ...semantic,
        title: balance ? `${semantic.title}  ·  ${balance.title}` : semantic.title,
      }];
    }
    return balance ? [balance] : [];
  },
};
