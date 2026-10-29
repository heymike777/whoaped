import { afterEach, describe, expect, it } from 'vitest';

import { buildTokenActionLinks } from '../config/token-actions.js';

const mint = 'TokenMint11111111111111111111111111111111111';

describe('token action links', () => {
  afterEach(() => {
    delete process.env.TOKEN_ACTION_CONFIG_JSON;
    delete process.env.TOKEN_ACTION_CONFIG_BASE64;
  });

  it('uses the referral-enabled links from Gated by default', () => {
    expect(buildTokenActionLinks(mint)).toEqual([
      { id: 'bonkbot', label: 'BONKbot', url: `https://t.me/bonkbot_bot?start=ref_ceqh3_ca_${mint}` },
      { id: 'gmgn', label: 'GMGN', url: `https://t.me/GMGN_sol_bot?start=i_gSWRgmGL_c_${mint}` },
      { id: 'fomo', label: 'FOMO', url: `https://fomo.family/coin?address=${mint}&chainId=1399811149&r=heymike777&source=share_link` },
      { id: 'dexscreener', label: 'DexScreener', url: `https://dexscreener.com/solana/${mint}` },
    ]);
  });

  it('supports a custom destination set through Base64 config', () => {
    process.env.TOKEN_ACTION_CONFIG_BASE64 = Buffer.from(JSON.stringify({
      custom: { label: 'Custom', urlTemplate: 'https://trade.example/token/{mint}?ref=whoaped' },
    })).toString('base64');
    expect(buildTokenActionLinks(mint)).toEqual([
      { id: 'custom', label: 'Custom', url: `https://trade.example/token/${mint}?ref=whoaped` },
    ]);
  });

  it('rejects unsafe action URLs', () => {
    process.env.TOKEN_ACTION_CONFIG_JSON = JSON.stringify({
      unsafe: { label: 'Unsafe', urlTemplate: 'javascript:alert({mint})' },
    });
    expect(buildTokenActionLinks(mint)).toEqual([]);
  });
});
