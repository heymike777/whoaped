import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDexTradeLink, buildTokenBuyLink } from '../config/dex-links.js';

const sol = 'So11111111111111111111111111111111111111112';
const token = 'TokenMint11111111111111111111111111111111111';

describe('DEX trade links', () => {
  afterEach(() => {
    delete process.env.DEX_LINK_CONFIG_JSON;
    delete process.env.DEX_LINK_CONFIG_BASE64;
    vi.restoreAllMocks();
  });

  it('uses the safe Jupiter fallback without an empty referral parameter', () => {
    expect(buildTokenBuyLink(token)).toEqual({
      provider: 'jupiter',
      providerName: 'Jupiter',
      url: `https://jup.ag/swap/${sol}-${token}`,
    });
  });

  it('adds a DEX-specific referral query parameter when its code is configured', () => {
    process.env.DEX_LINK_CONFIG_JSON = JSON.stringify({
      pancakeswap: {
        providerName: 'PancakeSwap',
        urlTemplate: 'https://pancakeswap.finance/swap?chain=solana&inputCurrency={inputMint}&outputCurrency={outputMint}',
        referralCode: 'who aped/42',
        referralQueryParam: 'ref',
      },
    });

    expect(buildDexTradeLink('pancakeswap', 'PancakeSwap', sol, token)).toEqual({
      provider: 'pancakeswap',
      providerName: 'PancakeSwap',
      url: `https://pancakeswap.finance/swap?chain=solana&inputCurrency=${sol}&outputCurrency=${token}&ref=who+aped%2F42`,
    });
  });

  it('supports referral codes embedded in a path or custom template', () => {
    process.env.DEX_LINK_CONFIG_BASE64 = Buffer.from(JSON.stringify({
      customdex: {
        providerName: 'Custom DEX',
        urlTemplate: 'https://dex.example/r/{referralCode}/swap/{inputMint}/{outputMint}',
        referralCode: 'partner-code',
      },
    })).toString('base64');

    expect(buildDexTradeLink('customdex', 'Custom DEX', sol, token).url)
      .toBe(`https://dex.example/r/partner-code/swap/${sol}/${token}`);
  });

  it('omits a configured referral query parameter when the code is empty', () => {
    process.env.DEX_LINK_CONFIG_JSON = JSON.stringify({
      orca: {
        urlTemplate: 'https://www.orca.so/swap?inputMint={inputMint}&outputMint={outputMint}',
        referralCode: '',
        referralQueryParam: 'ref',
      },
    });

    expect(buildDexTradeLink('orca', 'Orca', sol, token).url).not.toContain('ref=');
  });

  it('rejects non-HTTPS custom URLs and falls back to Jupiter', () => {
    process.env.DEX_LINK_CONFIG_JSON = JSON.stringify({
      unsafe: { urlTemplate: 'javascript:alert({tokenMint})' },
    });

    expect(buildDexTradeLink('unsafe', 'Unsafe', sol, token)).toMatchObject({
      provider: 'jupiter',
      providerName: 'Jupiter',
      url: `https://jup.ag/swap/${sol}-${token}`,
    });
  });
});
