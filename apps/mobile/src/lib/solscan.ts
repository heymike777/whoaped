export function solscanTransactionUrl(signature: string) {
  const normalized = signature.trim();
  if (!normalized) throw new Error('A transaction signature is required');
  return `https://solscan.io/tx/${encodeURIComponent(normalized)}`;
}
