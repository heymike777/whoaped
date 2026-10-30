import { solscanTransactionUrl } from './solscan';

describe('solscanTransactionUrl', () => {
  it('builds a Solscan transaction URL', () => {
    expect(solscanTransactionUrl('abc123')).toBe('https://solscan.io/tx/abc123');
  });

  it('trims and safely encodes the signature', () => {
    expect(solscanTransactionUrl(' signature/value ')).toBe(
      'https://solscan.io/tx/signature%2Fvalue',
    );
  });

  it('rejects an empty signature', () => {
    expect(() => solscanTransactionUrl('  ')).toThrow('A transaction signature is required');
  });
});
