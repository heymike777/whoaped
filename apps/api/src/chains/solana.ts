import type { ChainAdapter, NormalizedActivity } from './types.js';
import { buildDexTradeLink, buildTokenBuyLink } from '../config/dex-links.js';

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
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

type SwapDex = string;

const DEXES: Array<{ id: SwapDex; name: string; aliases: string[]; programIds?: string[] }> = [
  { id: 'jupiter', name: 'Jupiter', aliases: ['jupiter', 'metis', 'juplend', 'jupiterrfq'] },
  { id: 'pumpfun', name: 'Pump.fun', aliases: ['pumpfun', 'pumpswap', 'pumpamm', 'pumpdotfun'] },
  { id: 'meteora', name: 'Meteora', aliases: ['meteora', 'dlmm', 'damm', 'dynamicbondingcurve'] },
  { id: 'orca', name: 'Orca', aliases: ['orca', 'whirlpool'] },
  { id: 'titan', name: 'Titan', aliases: ['titan'] },
  { id: 'raydium', name: 'Raydium', aliases: ['raydium'] },
  { id: 'phoenix', name: 'Phoenix', aliases: ['phoenix', 'phoenixv1', 'phoenixflight'] },
  { id: 'openbook', name: 'OpenBook', aliases: ['openbook', 'openbookv2'] },
  { id: 'manifest', name: 'Manifest', aliases: ['manifest'] },
  { id: 'lifinity', name: 'Lifinity', aliases: ['lifinity'] },
  { id: 'saber', name: 'Saber', aliases: ['saber'] },
  { id: 'saros', name: 'Saros', aliases: ['saros'] },
  { id: 'aldrin', name: 'Aldrin', aliases: ['aldrin'] },
  { id: 'crema', name: 'Crema', aliases: ['crema'] },
  { id: 'invariant', name: 'Invariant', aliases: ['invariant'] },
  { id: 'fluxbeam', name: 'FluxBeam', aliases: ['fluxbeam', 'flux beam'] },
  { id: 'cropper', name: 'Cropper', aliases: ['cropper'] },
  { id: 'mercurial', name: 'Mercurial', aliases: ['mercurial'] },
  { id: 'obric', name: 'Obric', aliases: ['obric'] },
  { id: 'goosefx', name: 'GooseFX', aliases: ['goosefx', 'goose fx'] },
  { id: 'dflow', name: 'DFlow', aliases: ['dflow'] },
  { id: 'okx', name: 'OKX DEX', aliases: ['okxdex', 'okxrouter', 'okx dex'] },
  {
    id: 'byreal',
    name: 'Byreal',
    aliases: ['byreal'],
    programIds: ['REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2', 'REALp6iMBDTctQqpmhBo4PumwJGcybbnDpxtax3ara3'],
  },
  { id: 'humidifi', name: 'HumidiFi', aliases: ['humidifi'] },
  { id: 'tessera', name: 'Tessera', aliases: ['tessera'] },
  { id: 'goonfi', name: 'GoonFi', aliases: ['goonfi', 'goon fi'] },
  { id: 'solfi', name: 'SolFi', aliases: ['solfi', 'sol fi'] },
  { id: 'zerofi', name: 'ZeroFi', aliases: ['zerofi', 'zero fi'] },
  { id: 'bisonfi', name: 'BisonFi', aliases: ['bisonfi', 'bison fi'] },
  { id: 'heaven', name: 'Heaven', aliases: ['heaven'] },
  { id: 'moonit', name: 'Moonit', aliases: ['moonit'] },
  { id: 'boop', name: 'Boop', aliases: ['boop'] },
  { id: 'bonkswap', name: 'BONKswap', aliases: ['bonkswap', 'bonk swap'] },
  { id: 'dexlab', name: 'Dexlab', aliases: ['dexlab'] },
  { id: 'balansol', name: 'Balansol', aliases: ['balansol'] },
  { id: 'sanctum', name: 'Sanctum', aliases: ['sanctum'] },
  { id: 'cykura', name: 'Cykura', aliases: ['cykura'] },
  { id: 'dradex', name: 'Dradex', aliases: ['dradex'] },
  { id: 'penguin', name: 'Penguin', aliases: ['penguinfinance', 'penguin dex'] },
  { id: 'onedex', name: '1DEX', aliases: ['1dex'] },
  { id: 'alphaq', name: 'AlphaQ', aliases: ['alphaq'] },
  { id: 'aquifer', name: 'Aquifer', aliases: ['aquifer'] },
  { id: 'archer', name: 'Archer', aliases: ['archer'] },
  { id: 'binaryfi', name: 'BinaryFi', aliases: ['binaryfi'] },
  { id: 'carrot', name: 'Carrot', aliases: ['carrot'] },
  { id: 'defituna', name: 'DefiTuna', aliases: ['defituna'] },
  { id: 'denali', name: 'Denali', aliases: ['denali'] },
  { id: 'deriverse', name: 'Deriverse', aliases: ['deriverse'] },
  { id: 'flint', name: 'Flint', aliases: ['flint'] },
  { id: 'flux', name: 'Flux', aliases: ['flux'] },
  { id: 'gatorswap', name: 'GatorSwap', aliases: ['gatorswap'] },
  { id: 'gavel', name: 'Gavel', aliases: ['gavel'] },
  { id: 'guacswap', name: 'Guacswap', aliases: ['guacswap'] },
  { id: 'hadron', name: 'Hadron', aliases: ['hadron'] },
  { id: 'helium', name: 'Helium Network', aliases: ['heliumnetwork'] },
  { id: 'huma', name: 'Huma', aliases: ['huma'] },
  { id: 'hylo', name: 'Hylo Exchange', aliases: ['hyloexchange'] },
  { id: 'kipseli', name: 'Kipseli', aliases: ['kipseli'] },
  { id: 'lemmingsfi', name: 'LemmingsFi', aliases: ['lemmingsfi'] },
  { id: 'mswap', name: 'M Swap', aliases: ['mswap'] },
  { id: 'memefun', name: 'MemeFun', aliases: ['memefun'] },
  { id: 'metadao', name: 'MetaDAO', aliases: ['metadao'] },
  { id: 'metric', name: 'Metric', aliases: ['metric'] },
  { id: 'obsidian', name: 'Obsidian', aliases: ['obsidian'] },
  { id: 'omnipair', name: 'Omnipair', aliases: ['omnipair'] },
  { id: 'pancakeswap', name: 'PancakeSwap', aliases: ['pancakeswap'] },
  { id: 'perena', name: 'Perena', aliases: ['perena', 'perenastar'] },
  { id: 'quantum', name: 'Quantum', aliases: ['quantum'] },
  { id: 'quay', name: 'Quay', aliases: ['quay'] },
  { id: 'riptide', name: 'Riptide', aliases: ['riptide'] },
  { id: 'runnerrodeo', name: 'RunnerRodeo', aliases: ['runnerrodeo'] },
  { id: 'scale', name: 'Scale', aliases: ['scaleamm', 'scalevmm'] },
  { id: 'scorch', name: 'Scorch', aliases: ['scorch'] },
  { id: 'solayer', name: 'Solayer', aliases: ['solayer'] },
  { id: 'stabble', name: 'Stabble', aliases: ['stabble', 'stablestable', 'stabbleweighted'] },
  { id: 'stableswap', name: 'Stableswap', aliases: ['stableswap'] },
  { id: 'stepn', name: 'StepN', aliases: ['stepn'] },
  { id: 'taurusfi', name: 'TaurusFi', aliases: ['taurusfi'] },
  { id: 'fantastical', name: 'Fantastical Finance', aliases: ['thefantasticalfinancefactory'] },
  { id: 'tokenswap', name: 'Token Swap', aliases: ['tokenswap'] },
  { id: 'trench', name: 'Trench', aliases: ['trench'] },
  { id: 'trends', name: 'Trends', aliases: ['trends'] },
  { id: 'virtuals', name: 'Virtuals', aliases: ['virtuals'] },
  { id: 'voltr', name: 'Voltr', aliases: ['voltr'] },
  { id: 'whalestreet', name: 'WhaleStreet', aliases: ['whalestreet'] },
  { id: 'woofi', name: 'Woofi', aliases: ['woofi'] },
  { id: 'vault-unstake', name: 'Vault Liquid Unstake', aliases: ['vaultliquidunstake'] },
];

const LAUNCHPADS: Array<{ id: string; name: string; aliases: string[]; programIds?: string[] }> = [
  { id: 'pumpfun', name: 'Pump.fun', aliases: ['pumpfun', 'pumpdotfun'], programIds: [PUMP_FUN_PROGRAM] },
  { id: 'raydium-launchlab', name: 'Raydium LaunchLab', aliases: ['raydiumlaunchlab', 'launchlab'] },
  { id: 'meteora-dbc', name: 'Meteora DBC', aliases: ['meteoradbc', 'dynamicbondingcurve', 'meteoralaunch'] },
  { id: 'jupiter-studio', name: 'Jupiter Studio', aliases: ['jupiterstudio', 'jupstudio'] },
  { id: 'moonit', name: 'Moonit', aliases: ['moonit'] },
  { id: 'boop', name: 'Boop.fun', aliases: ['boopfun', 'boop'] },
  { id: 'bags', name: 'Bags', aliases: ['bagsfm', 'bagsdotfm', 'bagslaunch'] },
  { id: 'believe', name: 'Believe', aliases: ['believeapp', 'believe', 'launchcoin'] },
  { id: 'letsbonk', name: 'LetsBONK.fun', aliases: ['letsbonkfun', 'letsbonk', 'bonkfun'] },
  { id: 'heaven', name: 'Heaven', aliases: ['heaven'] },
  { id: 'moonshot', name: 'Moonshot', aliases: ['moonshot'] },
  { id: 'dexlab', name: 'Dexlab MintingLab', aliases: ['dexlabmintinglab', 'mintinglab'] },
  { id: 'daosfun', name: 'daos.fun', aliases: ['daosfun'] },
  { id: 'sugar', name: 'Sugar', aliases: ['sugarlaunchpad', 'sugar'] },
  { id: 'wavebreak', name: 'Orca Wavebreak', aliases: ['orcawavebreak', 'wavebreak'] },
  { id: 'streamflow', name: 'Streamflow Launchpad', aliases: ['streamflowlaunchpad', 'streamflow'] },
];

type YieldAction = 'deposit' | 'withdraw';

const YIELD_PROTOCOLS: Array<{ id: string; name: string; aliases: string[]; programIds?: string[] }> = [
  { id: 'kamino', name: 'Kamino', aliases: ['kamino', 'klend', 'kvault'] },
  {
    id: 'jupiter-lend',
    name: 'Jupiter Lend',
    aliases: ['jupiterlend', 'jup lend', 'lendamm'],
    programIds: ['jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'],
  },
  { id: 'perena', name: 'Perena', aliases: ['perena', 'numeraire'] },
  { id: 'save', name: 'Save', aliases: ['savefinance', 'solend'] },
  { id: 'marginfi', name: 'marginfi', aliases: ['marginfi', 'mrgn'] },
  { id: 'drift', name: 'Drift Earn', aliases: ['drift', 'driftearn'] },
  { id: 'loopscale', name: 'Loopscale', aliases: ['loopscale'] },
  { id: 'exponent', name: 'Exponent', aliases: ['exponent'] },
  { id: 'ratex', name: 'RateX', aliases: ['ratex', 'rate-x'] },
  { id: 'sanctum', name: 'Sanctum', aliases: ['sanctum', 'infinitypool'] },
  { id: 'jito', name: 'Jito', aliases: ['jito'] },
  { id: 'marinade', name: 'Marinade', aliases: ['marinade'] },
  { id: 'solayer', name: 'Solayer', aliases: ['solayer'] },
  { id: 'fragmetric', name: 'Fragmetric', aliases: ['fragmetric'] },
  { id: 'hylo', name: 'Hylo', aliases: ['hylo'] },
  { id: 'carrot', name: 'Carrot', aliases: ['carrot'] },
  { id: 'lulo', name: 'Lulo', aliases: ['lulo', 'flexlend'] },
  { id: 'meteora-vault', name: 'Meteora Vaults', aliases: ['meteoravault', 'dynamicvault'] },
  { id: 'tulip', name: 'Tulip', aliases: ['tulip'] },
  { id: 'francium', name: 'Francium', aliases: ['francium'] },
  { id: 'port', name: 'Port Finance', aliases: ['portfinance', 'portlending'] },
  { id: 'larix', name: 'Larix', aliases: ['larix'] },
  { id: 'texture', name: 'Texture', aliases: ['texture'] },
  { id: 'jpool', name: 'JPool', aliases: ['jpool'] },
  { id: 'blaze', name: 'BlazeStake', aliases: ['blazestake', 'blaze stake'] },
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

function decodedValue(instruction: ParsedInstruction, ...keys: string[]) {
  const wanted = new Set(keys.map(canonical));
  const entry = Object.entries(instruction.decoded?.args ?? {})
    .find(([key]) => wanted.has(canonical(key)));
  return stringValue(entry?.[1]);
}

function launchpadFor(transaction: ParsedSolanaTransaction) {
  const programIds = new Set((transaction.instructions ?? []).map((instruction) => instruction.programId));
  const candidates = [
    parsedValue(transaction.summary?.parsedData, 'protocol', 'source', 'platform', 'launchpad'),
    transaction.summary?.description,
    ...((transaction.instructions ?? []).flatMap((instruction) => [
      instruction.programName,
      parsedValue(instruction.summary?.parsedData, 'protocol', 'source', 'platform', 'launchpad'),
      instruction.summary?.description,
    ])),
  ].map((value) => canonical(value));
  return LAUNCHPADS.find((launchpad) =>
    launchpad.programIds?.some((programId) => programIds.has(programId))
    || candidates.some((candidate) => launchpad.aliases.some((alias) => candidate.includes(canonical(alias)))),
  );
}

function isLaunchInstruction(instruction: ParsedInstruction) {
  const name = canonical(instruction.instructionName ?? instruction.summary?.type);
  return [
    'create',
    'createv2',
    'createtoken',
    'createnewtoken',
    'launch',
    'launchtoken',
    'launchcoin',
    'initializepool',
    'initializevirtualpool',
    'createpool',
    'createbondingcurve',
    'initpool',
  ].includes(name);
}

function launchActivity(
  transaction: ParsedSolanaTransaction,
  watchedAddress: string,
  base: Omit<NormalizedActivity, 'kind' | 'title' | 'detail'>,
): NormalizedActivity | null {
  const launchpad = launchpadFor(transaction);
  if (!launchpad) return null;

  const instruction = transaction.instructions?.find((candidate) => {
    if (!isLaunchInstruction(candidate)) return false;
    const creator = namedAccount(candidate, 'creator', 'user', 'payer', 'authority', 'owner');
    const parsedCreator = parsedValue(candidate.summary?.parsedData, 'creator', 'user', 'payer', 'authority');
    const attributedCreators = [creator, parsedCreator].filter(Boolean);
    return attributedCreators.length
      ? attributedCreators.includes(watchedAddress)
      : transaction.feePayer === watchedAddress;
  });
  const summaryType = canonical(transaction.summary?.type);
  const summaryIsLaunch = ['tokenlaunch', 'launchtoken', 'createtoken', 'tokencreation'].some((type) =>
    summaryType.includes(type),
  );
  if (!instruction && !(summaryIsLaunch && transaction.feePayer === watchedAddress)) return null;

  const parsedData = instruction?.summary?.parsedData ?? transaction.summary?.parsedData;
  const mint = (instruction ? namedAccount(instruction, 'mint', 'token_mint', 'tokenMint', 'base_mint', 'baseMint', 'new_mint') : undefined)
    ?? (instruction ? decodedValue(instruction, 'mint', 'token_mint', 'tokenMint', 'base_mint', 'baseMint') : undefined)
    ?? parsedValue(parsedData, 'mint', 'token_mint', 'tokenMint', 'base_mint', 'baseMint');
  if (!mint || mint === SOL_MINT) return null;

  const decodedName = instruction ? decodedValue(instruction, 'name', 'token_name', 'tokenName') : undefined;
  const decodedSymbol = instruction ? decodedValue(instruction, 'symbol', 'token_symbol', 'tokenSymbol') : undefined;
  const name = decodedName ?? parsedValue(parsedData, 'name', 'token_name', 'tokenName');
  const symbol = decodedSymbol ?? parsedValue(parsedData, 'symbol', 'token_symbol', 'tokenSymbol') ?? tokenSymbol(mint);
  const buyLink = buildTokenBuyLink(mint);
  return {
    ...base,
    kind: 'launch',
    title: `Launched ${name ? `${name} (${symbol})` : symbol}`,
    detail: launchpad.name,
    source: launchpad.name,
    metadata: {
      ...base.metadata,
      launch: {
        platform: launchpad.id,
        platformName: launchpad.name,
        token: { mint, symbol, ...(name ? { name } : {}) },
        buyUrl: buyLink.url,
        buyProvider: buyLink.provider,
        buyProviderName: buyLink.providerName,
      },
    },
  };
}

function swapDex(transaction: ParsedSolanaTransaction) {
  const programIds = new Set((transaction.instructions ?? []).map((instruction) => instruction.programId));
  const strongCandidates = [
    parsedValue(transaction.summary?.parsedData, 'protocol', 'source', 'platform', 'dex'),
    ...((transaction.instructions ?? []).flatMap((instruction) => [
      parsedValue(instruction.summary?.parsedData, 'protocol', 'source', 'platform', 'dex'),
      instruction.programName,
      instruction.instructionName,
    ])),
  ].map((value) => canonical(value));
  const descriptionCandidates = [
    transaction.summary?.description,
    ...((transaction.instructions ?? []).map((instruction) => instruction.summary?.description)),
  ].map((value) => canonical(value));
  const byProgram = DEXES.find((dex) =>
    dex.programIds?.some((programId) => programIds.has(programId))
    || strongCandidates.some((candidate) =>
      dex.aliases.some((alias) => candidate.includes(canonical(alias))),
    ));
  if (byProgram) return byProgram;
  return DEXES.find((dex) => descriptionCandidates.some((candidate) =>
    dex.aliases.some((alias) => candidate.includes(canonical(alias))),
  ));
}

function matchingYieldProtocol(transaction: ParsedSolanaTransaction) {
  const programIds = new Set((transaction.instructions ?? []).map((instruction) => instruction.programId));
  const candidates = [
    parsedValue(transaction.summary?.parsedData, 'protocol', 'source', 'platform'),
    transaction.summary?.description,
    ...((transaction.instructions ?? []).flatMap((instruction) => [
      instruction.programName,
      instruction.summary?.description,
    ])),
  ].map((value) => canonical(value));
  return YIELD_PROTOCOLS.find((protocol) =>
    protocol.programIds?.some((programId) => programIds.has(programId))
    || candidates.some((candidate) => protocol.aliases.some((alias) => candidate.includes(canonical(alias)))),
  );
}

function yieldActionName(value?: string | null): YieldAction | null {
  const name = canonical(value);
  if (['withdraw', 'redeem', 'unstake', 'remove'].some((verb) => name.includes(verb))) return 'withdraw';
  if (['deposit', 'supply', 'stake', 'addliquidity'].some((verb) => name.includes(verb))) return 'deposit';
  return null;
}

function mintBalanceDeltas(transaction: ParsedSolanaTransaction, watchedAddress: string) {
  const deltas = new Map<string, number>();
  const add = (mint: string, amount: number) => {
    if (!Number.isFinite(amount) || Math.abs(amount) < Number.EPSILON) return;
    deltas.set(mint, (deltas.get(mint) ?? 0) + amount);
  };
  let found = false;
  transaction.accountData?.forEach((account) => {
    if (account.account === watchedAddress && account.nativeBalanceChange) {
      found = true;
      add('So11111111111111111111111111111111111111112', account.nativeBalanceChange / 1e9);
    }
    account.tokenBalanceChanges?.forEach((change) => {
      if (change.userAccount !== watchedAddress || !change.mint) return;
      found = true;
      const raw = typeof change.rawTokenAmount === 'object'
        ? change.rawTokenAmount.tokenAmount
        : change.rawTokenAmount;
      const decimals = typeof change.rawTokenAmount === 'object'
        ? change.rawTokenAmount.decimals ?? change.decimals ?? 0
        : change.decimals ?? 0;
      add(change.mint, displayAmount(raw, decimals));
    });
  });
  if (found) return deltas;
  transaction.nativeTransfers?.forEach((transfer) => {
    const amount = (transfer.amount ?? 0) / 1e9;
    if (transfer.toUserAccount === watchedAddress) add('So11111111111111111111111111111111111111112', amount);
    if (transfer.fromUserAccount === watchedAddress) add('So11111111111111111111111111111111111111112', -amount);
  });
  transaction.tokenTransfers?.forEach((transfer) => {
    if (!transfer.mint) return;
    const amount = displayAmount(transfer.rawTokenAmount, transfer.decimals);
    if (transfer.toUserAccount === watchedAddress) add(transfer.mint, amount);
    if (transfer.fromUserAccount === watchedAddress) add(transfer.mint, -amount);
  });
  return deltas;
}

function yieldActivity(
  transaction: ParsedSolanaTransaction,
  watchedAddress: string,
  base: Omit<NormalizedActivity, 'kind' | 'title' | 'detail'>,
): NormalizedActivity | null {
  const protocol = matchingYieldProtocol(transaction);
  if (!protocol) return null;
  const relevant = transaction.instructions?.filter((instruction) =>
    instructionTouches(instruction, watchedAddress) || transaction.feePayer === watchedAddress,
  ) ?? [];
  const action = yieldActionName(transaction.summary?.type)
    ?? yieldActionName(transaction.summary?.description)
    ?? relevant.map((instruction) => yieldActionName(instruction.instructionName)).find(Boolean)
    ?? relevant.map((instruction) => yieldActionName(instruction.summary?.type)).find(Boolean);
  if (!action) return null;

  const wantedSign = action === 'deposit' ? -1 : 1;
  let assets = [...mintBalanceDeltas(transaction, watchedAddress).entries()]
    .filter(([, amount]) => Math.sign(amount) === wantedSign)
    .map(([mint, amount]) => ({ mint, symbol: tokenSymbol(mint), amount: Math.abs(amount) }))
    .sort((left, right) => right.amount - left.amount);
  if (assets.length > 1) {
    assets = assets.filter((asset) => !(
      asset.mint === 'So11111111111111111111111111111111111111112' && asset.amount < 0.01
    ));
  }
  assets = assets.slice(0, 2);
  if (!assets.length) return null;
  const verb = action === 'deposit' ? 'Deposited' : 'Withdrew';
  const titleAssets = assets.map((asset) => `${formatAmount(asset.amount, asset.symbol).slice(1)}`).join(' + ');
  return {
    ...base,
    kind: 'yield',
    title: `${verb} ${titleAssets}`,
    detail: protocol.name,
    source: protocol.name,
    metadata: {
      ...base.metadata,
      yield: { action, protocol: protocol.id, protocolName: protocol.name, assets },
    },
  };
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
  const summaries = [transaction.summary, ...((transaction.instructions ?? []).map((instruction) => instruction.summary))]
    .filter((summary): summary is ParsedSummary => Boolean(summary));
  const tradeSummary = summaries.find((summary) => {
    const type = canonical(summary.type);
    const description = canonical(summary.description);
    return ['swap', 'buy', 'sell'].some((value) => type.includes(value))
      || ['swap', 'bought', 'sold'].some((value) => description.includes(value));
  });
  const dex = swapDex(transaction);
  if (!dex) return null;
  const isTradeInstruction = transaction.instructions?.some((instruction) =>
    ['swap', 'trade', 'exchange', 'route', 'fillorder'].some((verb) =>
      canonical(instruction.instructionName).includes(verb),
    )) ?? false;
  const isTrade = Boolean(tradeSummary) || isTradeInstruction;
  if (!isTrade) return null;

  const data = tradeSummary?.parsedData ?? transaction.summary?.parsedData;
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
  const tradeLink = buildDexTradeLink(dex.id, dex.name, inputMint, outputMint);
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
        tradeUrl: tradeLink.url,
        tradeProvider: tradeLink.provider,
        tradeProviderName: tradeLink.providerName,
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

    const launch = launchActivity(transaction, watchedAddress, base);
    if (launch) return [launch];

    const swap = swapActivity(transaction, watchedAddress, base);
    if (swap) return [swap];

    const yieldEvent = yieldActivity(transaction, watchedAddress, base);
    if (yieldEvent) return [yieldEvent];

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
