import { describe, expect, it } from 'vitest';

import { solanaAdapter, type ParsedSolanaTransaction } from '../chains/solana.js';

const wallet = '7V4Qz8VvTtKrpWLDPKyPYxMcBoQvfHBkHjx1hq4hGQPe';
const sol = 'So11111111111111111111111111111111111111112';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function parsedTransaction(overrides: Partial<ParsedSolanaTransaction>): ParsedSolanaTransaction {
  return {
    signature: 'signature',
    slot: 433_950_192,
    blockTime: 1_700_000_000,
    accountKeys: [wallet],
    nativeTransfers: [],
    tokenTransfers: [],
    accountData: [],
    instructions: [],
    ...overrides,
  };
}

describe('solanaAdapter balance changes', () => {
  it.each([
    ['pump_fun', 'create_v2', 'pumpfun', 'Pump.fun'],
    ['raydium_launchlab', 'create_token', 'raydium-launchlab', 'Raydium LaunchLab'],
    ['meteora_dynamic_bonding_curve', 'initialize_virtual_pool', 'meteora-dbc', 'Meteora DBC'],
    ['jupiter_studio', 'launch_token', 'jupiter-studio', 'Jupiter Studio'],
    ['moonit', 'create_pool', 'moonit', 'Moonit'],
    ['boop_fun', 'create', 'boop', 'Boop.fun'],
    ['bags_fm', 'launch_coin', 'bags', 'Bags'],
    ['believe_app', 'launch_coin', 'believe', 'Believe'],
    ['lets_bonk_fun', 'create_token', 'letsbonk', 'LetsBONK.fun'],
    ['orca_wavebreak', 'create_pool', 'wavebreak', 'Orca Wavebreak'],
  ])('recognizes a token launch on %s', (programName, instructionName, platform, platformName) => {
    const mint = 'LaunchMint1111111111111111111111111111111111';
    const payload = parsedTransaction({
      feePayer: wallet,
      instructions: [{
        programName,
        instructionName,
        decoded: {
          args: { name: 'Who Token', symbol: 'WHO' },
          accounts: [
            { name: 'creator', pubkey: wallet },
            { name: 'mint', pubkey: mint },
          ],
        },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'launch',
      title: 'Launched Who Token (WHO)',
      detail: platformName,
      source: platformName,
      metadata: {
        launch: {
          platform,
          platformName,
          token: { mint, symbol: 'WHO', name: 'Who Token' },
          buyUrl: `https://jup.ag/swap/${sol}-${mint}`,
        },
      },
    });
  });

  it('uses Pump.fun program id and only attributes the launch to its creator', () => {
    const otherWallet = 'OtherWallet111111111111111111111111111111111';
    const payload = parsedTransaction({
      feePayer: otherWallet,
      instructions: [{
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        instructionName: 'create',
        decoded: {
          args: { name: 'Not Mine', symbol: 'NOPE' },
          accounts: [
            { name: 'user', pubkey: otherWallet },
            { name: 'mint', pubkey: 'OtherMint11111111111111111111111111111111111' },
          ],
        },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)).toEqual([]);
  });

  it('does not attribute a sponsored launch to the fee payer when another creator is decoded', () => {
    const mint = 'SponsoredMint11111111111111111111111111111111';
    const payload = parsedTransaction({
      feePayer: wallet,
      instructions: [{
        programName: 'pump_fun',
        instructionName: 'create',
        decoded: {
          args: { name: 'Sponsored', symbol: 'SPON' },
          accounts: [
            { name: 'creator', pubkey: 'ActualCreator11111111111111111111111111111111' },
            { name: 'mint', pubkey: mint },
          ],
        },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)).toEqual([]);
  });

  it('does not mistake a generic SPL initialize mint for a token launch', () => {
    const payload = parsedTransaction({
      feePayer: wallet,
      instructions: [{
        programName: 'spl_token_2022',
        instructionName: 'initialize_mint_2',
        decoded: { accounts: [{ name: 'mint', pubkey: 'Mint11111111111111111111111111111111111111' }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)).toEqual([]);
  });

  it.each([
    ['kamino_lending', 'kamino', 'Kamino'],
    ['jupiter_lend_amm', 'jupiter-lend', 'Jupiter Lend'],
    ['perena_numeraire', 'perena', 'Perena'],
    ['solend', 'save', 'Save'],
    ['marginfi', 'marginfi', 'marginfi'],
    ['drift_earn', 'drift', 'Drift Earn'],
    ['loopscale', 'loopscale', 'Loopscale'],
    ['exponent', 'exponent', 'Exponent'],
    ['rate_x', 'ratex', 'RateX'],
    ['sanctum_infinity_pool', 'sanctum', 'Sanctum'],
    ['jito_staking', 'jito', 'Jito'],
    ['marinade_finance', 'marinade', 'Marinade'],
    ['solayer', 'solayer', 'Solayer'],
    ['fragmetric', 'fragmetric', 'Fragmetric'],
    ['hylo', 'hylo', 'Hylo'],
    ['carrot', 'carrot', 'Carrot'],
    ['lulo_flexlend', 'lulo', 'Lulo'],
    ['meteora_dynamic_vault', 'meteora-vault', 'Meteora Vaults'],
    ['tulip', 'tulip', 'Tulip'],
    ['francium', 'francium', 'Francium'],
    ['port_finance', 'port', 'Port Finance'],
    ['larix', 'larix', 'Larix'],
    ['texture', 'texture', 'Texture'],
    ['jpool', 'jpool', 'JPool'],
    ['blaze_stake', 'blaze', 'BlazeStake'],
  ])('creates structured yield deposit metadata for %s', (programName, protocol, protocolName) => {
    const payload = parsedTransaction({
      feePayer: wallet,
      accountData: [{ account: wallet, nativeBalanceChange: -2_000_000_000 }],
      instructions: [{
        programName,
        instructionName: 'deposit',
        decoded: { accounts: [{ name: 'user', pubkey: wallet }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'yield',
      title: 'Deposited 2 SOL',
      detail: protocolName,
      metadata: {
        yield: {
          action: 'deposit',
          protocol,
          protocolName,
          assets: [{ mint: sol, symbol: 'SOL', amount: 2 }],
        },
      },
    });
  });

  it('creates a structured withdrawal and keeps up to two received assets', () => {
    const secondMint = 'SecondMint111111111111111111111111111111111';
    const payload = parsedTransaction({
      feePayer: wallet,
      accountData: [
        { account: wallet, nativeBalanceChange: 1_500_000_000 },
        { account: 'usdc-account', tokenBalanceChanges: [{
          userAccount: wallet,
          mint: usdc,
          rawTokenAmount: { tokenAmount: 25_000_000, decimals: 6 },
        }] },
        { account: 'other-account', tokenBalanceChanges: [{
          userAccount: wallet,
          mint: secondMint,
          rawTokenAmount: { tokenAmount: 3, decimals: 0 },
        }] },
      ],
      instructions: [{
        programName: 'kamino_lending',
        instructionName: 'withdraw_obligation_collateral_and_redeem_reserve_collateral',
        decoded: { accounts: [{ name: 'owner', pubkey: wallet }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'yield',
      title: 'Withdrew 25 USDC + 3 Seco…1111',
      metadata: { yield: { action: 'withdraw', assets: [
        expect.objectContaining({ mint: usdc, amount: 25 }),
        expect.objectContaining({ mint: secondMint, amount: 3 }),
      ] } },
    });
  });

  it('recognizes a Meteora DLMM add-liquidity transaction and uses the parsed liquidity amounts', () => {
    const met = 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL';
    const payload = parsedTransaction({
      signature: '5gd69toC169WBCN9Nq2ygKDYP1Wxfb8g2T8Xer6kLVPLj4Yk7P6Ard967rSt3P9eK6MNikUG71nyvV4ebh9GxFC3',
      feePayer: wallet,
      summary: {
        type: 'add_liquidity',
        description: `${wallet} added liquidity to Meteora DLMM`,
        parsedData: {
          type: 'liquidity',
          protocol: 'meteora_dlmm',
          kind: 'add_liquidity_by_strategy2',
          operation: 'add',
          token_a_mint: met,
          token_a_amount: '17121298',
          token_b_mint: sol,
          token_b_amount: '49850605',
        },
      },
      tokenTransfers: [
        { fromUserAccount: wallet, mint: met, rawTokenAmount: 17_121_298, decimals: 6 },
        { fromUserAccount: wallet, mint: sol, rawTokenAmount: 49_850_605, decimals: 9 },
      ],
      instructions: [{
        programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
        programName: 'lb_clmm',
        instructionName: 'add_liquidity_by_strategy2',
        decoded: { accounts: [{ name: 'sender', pubkey: wallet }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'yield',
      title: 'Added liquidity 17.12 METv…mWQL + 0.049850605 SOL',
      detail: 'Meteora DLMM',
      source: 'Meteora DLMM',
      metadata: { yield: {
        action: 'deposit',
        positionType: 'liquidity',
        protocol: 'meteora-dlmm',
        protocolName: 'Meteora DLMM',
        assets: [
          { mint: met, symbol: 'METv…mWQL', amount: 17.121298 },
          { mint: sol, symbol: 'SOL', amount: 0.049850605 },
        ],
      } },
    });
  });

  it.each([
    ['Jupiter', 'jupiter', 'Jupiter'],
    ['PumpSwap', 'pumpfun', 'Pump.fun'],
    ['Meteora DLMM', 'meteora', 'Meteora'],
    ['Orca Whirlpool', 'orca', 'Orca'],
    ['Titan', 'titan', 'Titan'],
    ['Raydium CPMM', 'raydium', 'Raydium'],
    ['Phoenix', 'phoenix', 'Phoenix'],
    ['OpenBook v2', 'openbook', 'OpenBook'],
    ['Manifest', 'manifest', 'Manifest'],
    ['Lifinity', 'lifinity', 'Lifinity'],
    ['Saber', 'saber', 'Saber'],
    ['Saros', 'saros', 'Saros'],
    ['Aldrin', 'aldrin', 'Aldrin'],
    ['Crema', 'crema', 'Crema'],
    ['Invariant', 'invariant', 'Invariant'],
    ['FluxBeam', 'fluxbeam', 'FluxBeam'],
    ['Cropper', 'cropper', 'Cropper'],
    ['Mercurial', 'mercurial', 'Mercurial'],
    ['Obric', 'obric', 'Obric'],
    ['GooseFX', 'goosefx', 'GooseFX'],
    ['DFlow', 'dflow', 'DFlow'],
    ['OKX DEX Router', 'okx', 'OKX DEX'],
    ['Byreal', 'byreal', 'Byreal'],
    ['HumidiFi', 'humidifi', 'HumidiFi'],
    ['Tessera', 'tessera', 'Tessera'],
    ['GoonFi', 'goonfi', 'GoonFi'],
    ['SolFi', 'solfi', 'SolFi'],
    ['ZeroFi', 'zerofi', 'ZeroFi'],
    ['BisonFi', 'bisonfi', 'BisonFi'],
    ['Heaven', 'heaven', 'Heaven'],
    ['Moonit', 'moonit', 'Moonit'],
    ['Boop', 'boop', 'Boop'],
    ['BONKswap', 'bonkswap', 'BONKswap'],
    ['Dexlab', 'dexlab', 'Dexlab'],
    ['Balansol', 'balansol', 'Balansol'],
    ['Sanctum Router', 'sanctum', 'Sanctum'],
    ['Cykura', 'cykura', 'Cykura'],
    ['Dradex', 'dradex', 'Dradex'],
    ['Penguin Finance', 'penguin', 'Penguin'],
    ['1DEX', 'onedex', '1DEX'],
    ['AlphaQ', 'alphaq', 'AlphaQ'],
    ['Aquifer', 'aquifer', 'Aquifer'],
    ['Archer', 'archer', 'Archer'],
    ['BinaryFi', 'binaryfi', 'BinaryFi'],
    ['Carrot', 'carrot', 'Carrot'],
    ['DefiTuna', 'defituna', 'DefiTuna'],
    ['Denali', 'denali', 'Denali'],
    ['Deriverse', 'deriverse', 'Deriverse'],
    ['Flint', 'flint', 'Flint'],
    ['Flux', 'flux', 'Flux'],
    ['GatorSwap', 'gatorswap', 'GatorSwap'],
    ['Gavel', 'gavel', 'Gavel'],
    ['Guacswap', 'guacswap', 'Guacswap'],
    ['Hadron', 'hadron', 'Hadron'],
    ['Helium Network', 'helium', 'Helium Network'],
    ['Huma', 'huma', 'Huma'],
    ['Hylo Exchange', 'hylo', 'Hylo Exchange'],
    ['Kipseli', 'kipseli', 'Kipseli'],
    ['LemmingsFi', 'lemmingsfi', 'LemmingsFi'],
    ['M Swap', 'mswap', 'M Swap'],
    ['MemeFun', 'memefun', 'MemeFun'],
    ['MetaDAO', 'metadao', 'MetaDAO'],
    ['Metric', 'metric', 'Metric'],
    ['Obsidian', 'obsidian', 'Obsidian'],
    ['Omnipair', 'omnipair', 'Omnipair'],
    ['PancakeSwap', 'pancakeswap', 'PancakeSwap'],
    ['Perena Star V2', 'perena', 'Perena'],
    ['Quantum', 'quantum', 'Quantum'],
    ['Quay', 'quay', 'Quay'],
    ['Riptide', 'riptide', 'Riptide'],
    ['RunnerRodeo', 'runnerrodeo', 'RunnerRodeo'],
    ['Scale AMM', 'scale', 'Scale'],
    ['Scorch', 'scorch', 'Scorch'],
    ['Solayer', 'solayer', 'Solayer'],
    ['Stabble CLMM', 'stabble', 'Stabble'],
    ['Stableswap', 'stableswap', 'Stableswap'],
    ['StepN', 'stepn', 'StepN'],
    ['TaurusFi', 'taurusfi', 'TaurusFi'],
    ['The Fantastical Finance Factory', 'fantastical', 'Fantastical Finance'],
    ['Token Swap', 'tokenswap', 'Token Swap'],
    ['Trench', 'trench', 'Trench'],
    ['Trends', 'trends', 'Trends'],
    ['Virtuals', 'virtuals', 'Virtuals'],
    ['Voltr', 'voltr', 'Voltr'],
    ['WhaleStreet', 'whalestreet', 'WhaleStreet'],
    ['Woofi', 'woofi', 'Woofi'],
    ['VaultLiquidUnstake', 'vault-unstake', 'Vault Liquid Unstake'],
  ])('creates structured swap metadata for %s', (protocol, dex, dexName) => {
    const payload = parsedTransaction({
      summary: {
        type: 'SWAP',
        description: `Swap routed by ${protocol}`,
        parsedData: {
          protocol,
          input_mint: sol,
          output_mint: usdc,
          in_amount: '1250000000',
          actual_out_amount: '25000000',
        },
      },
      tokenTransfers: [
        { mint: sol, decimals: 9 },
        { mint: usdc, decimals: 6 },
      ],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 1.25 SOL → 25 USDC',
      detail: dexName,
      metadata: {
        swap: {
          dex,
          dexName,
          input: { mint: sol, symbol: 'SOL', amount: 1.25 },
          output: { mint: usdc, symbol: 'USDC', amount: 25 },
        },
      },
    });
  });

  it('uses the parsed Meteora venue even when a Pump AMM cleanup instruction is present', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'swap',
        parsedData: {
          protocol: 'meteora_damm_v2',
          input_mint: sol,
          output_mint: usdc,
          in_amount: '1000000000',
          actual_out_amount: '20000000',
        },
      },
      instructions: [{ programName: 'pump_amm', instructionName: 'close_user_volume_accumulator' }],
      tokenTransfers: [{ mint: sol, decimals: 9 }, { mint: usdc, decimals: 6 }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap', source: 'Meteora', metadata: { swap: { dex: 'meteora' } },
    });
  });

  it('does not mistake a PUMP token swap on Phoenix for Pump.fun', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'swap',
        description: `${wallet} swapped SOL for PUMP via Phoenix`,
        parsedData: {
          protocol: 'phoenix',
          input_mint: sol,
          output_mint: usdc,
          in_amount: '100000000',
          actual_out_amount: '5000000',
        },
      },
      tokenTransfers: [{ mint: sol, decimals: 9 }, { mint: usdc, decimals: 6 }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      source: 'Phoenix',
      metadata: { swap: { dex: 'phoenix' } },
    });
  });

  it('recognizes an Orca Whirlpool swap from decoded instructions without a transaction summary', () => {
    const payload = parsedTransaction({
      feePayer: wallet,
      accountData: [
        { account: wallet, nativeBalanceChange: -250_000_000 },
        { account: 'usdc-account', tokenBalanceChanges: [{
          userAccount: wallet,
          mint: usdc,
          rawTokenAmount: { tokenAmount: 6_000_000, decimals: 6 },
        }] },
      ],
      instructions: [{
        programName: 'orca_whirlpool',
        instructionName: 'swap_v2',
        decoded: { accounts: [{ name: 'token_authority', pubkey: wallet }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 0.25 SOL → 6 USDC',
      detail: 'Orca',
      metadata: { swap: { dex: 'orca' } },
    });
  });

  it('recognizes a Jupiter Z order-engine fill for both sides of the swap', () => {
    const taker = '9Xt9Zj9HoAh13MpoB6hmY9UZz37L4Jabtyn8zE7AAsL';
    const payload = parsedTransaction({
      feePayer: wallet,
      accountData: undefined,
      summary: {
        type: 'transfer',
        description: `${taker} transferred 20 USDC to ${wallet}`,
        parsedData: null,
      },
      tokenTransfers: [
        {
          fromUserAccount: taker,
          toUserAccount: wallet,
          mint: usdc,
          rawTokenAmount: 20_000_000,
          decimals: 6,
        },
        {
          fromUserAccount: wallet,
          toUserAccount: wallet,
          mint: sol,
          rawTokenAmount: 207_447_926,
          decimals: 9,
        },
      ],
      instructions: [{
        programId: '61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH',
        programName: 'order_engine',
        instructionName: 'fill',
        decoded: {
          args: { input_amount: '20000000', output_amount: '207447926' },
          accounts: [
            { name: 'taker', pubkey: taker },
            { name: 'maker', pubkey: wallet },
            { name: 'input_mint', pubkey: usdc },
            { name: 'output_mint', pubkey: sol },
          ],
        },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 0.207447926 SOL → 20 USDC',
      detail: 'Jupiter',
      metadata: {
        swap: {
          dex: 'jupiter',
          input: { mint: sol, amount: 0.207447926 },
          output: { mint: usdc, amount: 20 },
        },
      },
    });
    expect(solanaAdapter.normalize(payload, taker)[0]).toMatchObject({
      kind: 'swap',
      title: 'Swapped 20 USDC → 0.207447926 SOL',
      detail: 'Jupiter',
    });
  });

  it('prefers the watched wallet balance deltas for exact swap amounts', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'swap',
        description: 'Jupiter swap',
        parsedData: { protocol: 'Jupiter', input_mint: sol, output_mint: usdc },
      },
      accountData: [
        { account: wallet, nativeBalanceChange: -500_000_000 },
        { account: 'token-account', tokenBalanceChanges: [{
          userAccount: wallet,
          mint: usdc,
          rawTokenAmount: { tokenAmount: 12_345_678, decimals: 6 },
        }] },
      ],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]?.metadata.swap).toEqual(expect.objectContaining({
      input: expect.objectContaining({ amount: 0.5 }),
      output: expect.objectContaining({ amount: 12.345678 }),
    }));
  });

  it('treats a Pump.fun buy summary as a structured swap', () => {
    const payload = parsedTransaction({
      summary: {
        type: 'buy',
        description: `${wallet} bought a token via pump_fun`,
        parsedData: {
          protocol: 'pump_fun',
          input_mint: sol,
          output_mint: usdc,
          in_amount: '100000000',
          actual_out_amount: '2000000',
        },
      },
      tokenTransfers: [{ mint: sol, decimals: 9 }, { mint: usdc, decimals: 6 }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'swap',
      source: 'Pump.fun',
    });
  });

  it('aggregates actual native and token balance changes for the watched wallet', () => {
    const payload = parsedTransaction({
      accountData: [
        { account: wallet, nativeBalanceChange: -100_005_000_000 },
        {
          account: 'associated-token-account',
          tokenBalanceChanges: [{
            userAccount: wallet,
            mint: usdc,
            rawTokenAmount: { tokenAmount: '10000000000', decimals: 6 },
          }],
        },
      ],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'balance',
      title: '−100.01 SOL  ·  +10,000 USDC',
      detail: 'Balance change',
      metadata: { slot: 433_950_192 },
    });
  });

  it('falls back to transfer amounts when account deltas are unavailable', () => {
    const payload = parsedTransaction({
      accountData: undefined,
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'receiver', amount: 80_000_000 }],
      tokenTransfers: [{
        fromUserAccount: 'sender',
        toUserAccount: wallet,
        mint: usdc,
        rawTokenAmount: 1_250_000_000,
        decimals: 6,
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'balance',
      title: '−0.08 SOL  ·  +1,250 USDC',
    });
  });

  it('does not create noisy activity when the watched balance did not change', () => {
    const payload = parsedTransaction({
      summary: { description: `${wallet} created account with 0.00069596 SOL` },
      instructions: [{ programName: 'Compute Budget' }],
    });

    expect(solanaAdapter.normalize(payload, wallet)).toEqual([]);
  });

  it('keeps a Metaplex Core mint semantic and appends its balance change', () => {
    const payload = parsedTransaction({
      feePayer: wallet,
      accountData: [{ account: wallet, nativeBalanceChange: -6_959_600 }],
      instructions: [{
        programId: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
        programName: 'mpl_core',
        instructionName: 'create_v1',
        decoded: { accounts: [{ name: 'owner', pubkey: wallet }] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'nft',
      title: 'Minted Core NFT  ·  −0.0069596 SOL',
      detail: 'Metaplex Core',
    });
  });

  it('keeps a Squads proposal approval even without a balance change', () => {
    const payload = parsedTransaction({
      instructions: [{
        programId: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
        programName: 'squads_multisig_program',
        instructionName: 'proposal_approve',
        decoded: {
          args: { transactionIndex: 42 },
          accounts: [
            { name: 'member', pubkey: wallet },
            { name: 'multisig', pubkey: 'multisig-address' },
          ],
        },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'multisig',
      title: 'Approved Squads proposal #42',
      detail: 'Squads multisig',
    });
  });

  it('shows the direction of a Core NFT transfer for the watched owner', () => {
    const payload = parsedTransaction({
      instructions: [{
        programName: 'metaplex_core',
        instructionName: 'transfer_v1',
        decoded: { accounts: [
          { name: 'authority', pubkey: 'previous-owner' },
          { name: 'new_owner', pubkey: wallet },
        ] },
      }],
    });

    expect(solanaAdapter.normalize(payload, wallet)[0]).toMatchObject({
      kind: 'nft',
      title: 'Received Core NFT',
    });
  });

  it('collects balance, transfer, raw, and decoded accounts once', () => {
    const addresses = solanaAdapter.extractAddresses(parsedTransaction({
      feePayer: wallet,
      accountKeys: [wallet, 'program'],
      accountData: [{
        account: wallet,
        tokenBalanceChanges: [{ userAccount: 'token-owner', mint: sol }],
      }],
      nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'receiver' }],
      instructions: [{
        rawAccounts: ['program', 'raw-account'],
        decoded: { accounts: [{ name: 'authority', pubkey: 'decoded-account' }] },
      }],
    }));
    expect(addresses).toEqual([
      wallet,
      'program',
      'token-owner',
      'receiver',
      'raw-account',
      'decoded-account',
    ]);
  });
});
