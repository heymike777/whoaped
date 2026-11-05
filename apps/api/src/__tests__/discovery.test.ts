import { describe, expect, it } from 'vitest';
import { kolscanSnapshot } from '../data/kolscan-profiles.js';

describe('Discovery snapshot', () => {
  it('contains distinct full Solana addresses and safe social links', () => {
    expect(kolscanSnapshot.profiles.length).toBeGreaterThan(100);
    expect(new Set(kolscanSnapshot.profiles.map(profile => profile.address)).size).toBe(kolscanSnapshot.profiles.length);
    for (const profile of kolscanSnapshot.profiles) {
      expect(profile.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(profile.name.length).toBeGreaterThan(0);
      if (profile.twitter) expect(profile.twitter).toMatch(/^https:\/\/(x|twitter)\.com\//);
      if (profile.telegram) expect(profile.telegram).toMatch(/^https:\/\/t\.me\//);
    }
  });
});
