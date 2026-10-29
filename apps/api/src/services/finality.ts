type SignatureStatus = {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
  err?: unknown;
};

type SignatureStatusesResponse = {
  error?: { code?: number; message?: string };
  result?: { value?: Array<SignatureStatus | null> };
};

type SlotResponse = {
  error?: { code?: number; message?: string };
  result?: number;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function rpcUrl(apiKey: string) {
  const base = (process.env.HELIUS_RPC_URL ?? 'https://mainnet.helius-rpc.com').replace(/\/$/, '');
  return `${base}${base.includes('?') ? '&' : '?'}api-key=${encodeURIComponent(apiKey)}`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function rpcRequest<T>(apiKey: string, method: string, params: unknown[]) {
  const response = await fetch(rpcUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Helius ${method} failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function getFinalizedSlot() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY is not configured');
  const payload = await rpcRequest<SlotResponse>(apiKey, 'getSlot', [{ commitment: 'finalized' }]);
  if (payload.error) {
    throw new Error(`Helius finalized slot failed (${payload.error.code ?? 'unknown'}): ${payload.error.message ?? 'unknown'}`);
  }
  if (!Number.isFinite(payload.result)) throw new Error('Helius finalized slot response is invalid');
  return payload.result as number;
}

export async function waitForFinalizedSignature(
  signature: string,
  options: { pollMs?: number; timeoutMs?: number } = {},
) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY is not configured');

  const pollMs = options.pollMs ?? positiveInteger(process.env.HELIUS_FINALITY_POLL_MS, 200);
  const timeoutMs = options.timeoutMs ?? positiveInteger(process.env.HELIUS_FINALITY_TIMEOUT_MS, 30_000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const payload = await rpcRequest<SignatureStatusesResponse>(
      apiKey,
      'getSignatureStatuses',
      [[signature], { searchTransactionHistory: true }],
    );
    if (payload.error) {
      throw new Error(`Helius finality check failed (${payload.error.code ?? 'unknown'}): ${payload.error.message ?? 'unknown'}`);
    }
    const status = payload.result?.value?.[0];
    if (status?.err != null) throw new Error(`Finalized transaction ${signature} failed`);
    if (status?.confirmationStatus === 'finalized') return;

    await delay(pollMs);
  }

  throw new Error(`Transaction ${signature} did not finalize within ${timeoutMs}ms`);
}
