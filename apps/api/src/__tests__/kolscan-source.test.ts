import { describe, expect, it } from 'vitest';

import { kolscanSnapshot } from '../data/kolscan-profiles.js';
import { fetchKolscanProfiles, parseKolscanProfiles } from '../services/kolscan-source.js';
import { kolscanFlightPage } from './fixtures/kolscan-flight.js';

describe('Kolscan public source', () => {
  it('reads current Flight profile arrays independently of field order, ignores foreign wallets and deduplicates timeframe rows', () => {
    const [a, b] = kolscanSnapshot.profiles;
    const html = kolscanFlightPage([
      { wallet_address: a.address, name: 'The "Trader" 🐉', pfp: null, twitch: null, kick: 'https://kick.com/example', telegram: 'https://t.me/example', twitter: 'https://x.com/example' },
      { wallet_address: '0x1234567890abcdef1234567890abcdef12345678', name: 'Not Solana' },
    ], [
      { profit: 100, wallet_address: a.address, name: 'Stale display name' },
      { twitter: 'https://x.com@elsewhere.example/profile', name: 'Another trader', wallet_address: b.address, telegram: 'https://fake@t.me/example' },
      { wallet_address: b.address, name: 'Another trader', profit: 300, timeframe: 7 },
    ]);

    expect(parseKolscanProfiles(html)).toEqual([
      { address: a.address, name: 'The "Trader" 🐉', twitter: 'https://x.com/example', telegram: 'https://t.me/example' },
      { address: b.address, name: 'Another trader', twitter: null, telegram: null },
    ]);
  });

  it('rejects an HTML response without a full profile directory', async () => {
    await expect(fetchKolscanProfiles(async () => new Response('<html>temporarily unavailable</html>'))).rejects.toMatchObject({ parsed: 0 });
  });
});
