import type { ParsedSolanaTransaction } from '../chains/solana.js';

type RpcTransaction = {
  transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } };
  meta?: { preBalances?: number[]; postBalances?: number[] };
};

function hasAccountClosure(transaction: ParsedSolanaTransaction, address: string) {
  return transaction.instructions?.some((instruction) =>
    (instruction.instructionName ?? '').replace(/[^a-z]/gi, '').toLowerCase().includes('close')
    && (transaction.feePayer === address || instruction.rawAccounts?.includes(address)
      || instruction.decoded?.accounts?.some((account) => account.pubkey === address))) ?? false;
}

export function touchedByOpaqueInstruction(transaction: ParsedSolanaTransaction, address: string) {
  // Parsed Events can omit lamport movements made by an undecoded program.
  // Only look up wallets explicitly passed to that instruction.
  return transaction.instructions?.some((instruction) =>
    !instruction.instructionName && instruction.rawAccounts?.includes(address)) ?? false;
}

export function needsNativeReconciliation(transaction: ParsedSolanaTransaction, address: string) {
  return transaction.nativeBalanceChanges?.[address] == null
    && transaction.accountData?.find((account) => account.account === address)?.nativeBalanceChange == null
    && (hasAccountClosure(transaction, address) || touchedByOpaqueInstruction(transaction, address));
}

export async function reconcileNativeBalanceChanges(
  transaction: ParsedSolanaTransaction,
  watchedAddresses: string[],
): Promise<ParsedSolanaTransaction> {
  const missing = [...new Set(watchedAddresses)].filter((address) => needsNativeReconciliation(transaction, address));
  if (!missing.length) return transaction;

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return transaction;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getTransaction',
          params: [transaction.signature, {
            commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1,
          }],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as { result?: RpcTransaction | null; error?: { message?: string } };
      if (result.error || !result.result?.meta || !result.result.transaction?.message?.accountKeys) {
        throw new Error(result.error?.message ?? 'Transaction balances unavailable');
      }
      const { accountKeys } = result.result.transaction.message;
      const { preBalances, postBalances } = result.result.meta;
      if (!preBalances || !postBalances) throw new Error('Transaction balances unavailable');

      const changes = { ...transaction.nativeBalanceChanges };
      for (const address of missing) {
        const index = accountKeys.findIndex((key) => (typeof key === 'string' ? key : key.pubkey) === address);
        if (index < 0 || !Number.isSafeInteger(preBalances[index]) || !Number.isSafeInteger(postBalances[index])) continue;
        changes[address] = postBalances[index] - preBalances[index];
      }
      return Object.keys(changes).length ? { ...transaction, nativeBalanceChanges: changes } : transaction;
    } catch (error) {
      if (attempt === 2) console.warn('Could not reconcile native SOL balance', transaction.signature, error);
      else await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return transaction;
}
