import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../db.js';

const ORIGIN = 'https://api.paybox.sh';
const RESOURCE = `${ORIGIN}/mcp`;
export type PayboxWallet = { name: string; address: string };
type Import = {
  _id: string; userId: string; stateHash: string; verifier?: string; clientId: string;
  redirectUri: string; expiresAt: Date; status: 'pending' | 'processing' | 'ready' | 'error';
  wallets?: PayboxWallet[];
};
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
async function imports() {
  const collection = (await getDatabase()).collection<Import>('paybox_imports');
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return collection;
}
export function payboxAvailable() {
  try { return new URL(process.env.PAYBOX_REDIRECT_URI ?? '').protocol === 'https:'; } catch { return false; }
}
async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Paybox could not complete the connection. Please reconnect.');
  return response.json();
}
export async function createPayboxImport(userId: string) {
  const redirectUri = process.env.PAYBOX_REDIRECT_URI;
  if (!redirectUri || new URL(redirectUri).protocol !== 'https:') throw new Error('Paybox import is not configured.');
  const db = await imports();
  if (await db.countDocuments({ userId, status: { $in: ['pending', 'processing'] }, expiresAt: { $gt: new Date() } }) >= 3) {
    throw new Error('Finish or cancel the current Paybox connection first.');
  }
  const clients = (await getDatabase()).collection<{ _id: string; clientId: string }>('paybox_clients');
  let registered = await clients.findOne({ _id: redirectUri });
  if (!registered) {
    const client = z.object({ client_id: z.string().min(1) }).parse(await jsonRequest(`${ORIGIN}/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'WhoAped wallet import', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    }));
    await clients.updateOne({ _id: redirectUri }, { $setOnInsert: { clientId: client.client_id } }, { upsert: true });
    registered = await clients.findOne({ _id: redirectUri });
  }
  const clientId = registered!.clientId;
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const id = randomUUID();
  await db.insertOne({ _id: id, userId, stateHash: hash(state), verifier, clientId, redirectUri,
    status: 'pending', expiresAt: new Date(Date.now() + 10 * 60_000) });
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    code_challenge: hash(verifier), code_challenge_method: 'S256', scope: 'mcp', resource: RESOURCE, state });
  return { id, url: `${ORIGIN}/oauth/authorize?${params}` };
}

export function parsePayboxWallets(value: unknown): PayboxWallet[] {
  const data = z.object({ credentials: z.array(z.object({
    kind: z.string(), name: z.string().optional(), metadata: z.object({ address: z.string().optional(), chains: z.array(z.string()).optional() }).optional(),
  })) }).parse(value);
  const seen = new Set<string>();
  return data.credentials.flatMap(item => {
    const address = item.metadata?.address;
    if (item.kind !== 'wallet' || !item.metadata?.chains?.some(chain => chain === 'solana' || chain.startsWith('solana:')) ||
      !address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || seen.has(address)) return [];
    seen.add(address);
    return [{ address, name: item.name?.trim().slice(0, 40) || 'Paybox wallet' }];
  });
}

// MCP Streamable HTTP may return JSON or a finite SSE response.
export async function readMcpResponse(response: Response, id: number): Promise<any> {
  const raw = await response.text();
  const messages = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw.split(/\r?\n\r?\n/).flatMap(event => {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      return data ? [JSON.parse(data)] : [];
    }) : [JSON.parse(raw)];
  const message = messages.find(item => item.id === id);
  if (!message || message.error) throw new Error('Invalid Paybox response.');
  return message.result;
}
async function listWallets(token: string) {
  let session: string | null = null;
  const rpc = async (id: number | null, method: string, params?: object) => {
    const response = await fetch(RESOURCE, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18', ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }),
    });
    if (!response.ok) throw new Error('Paybox wallet access failed.');
    session = response.headers.get('mcp-session-id') ?? session;
    if (id === null) { await response.body?.cancel(); return; }
    return readMcpResponse(response, id);
  };
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'WhoAped', version: '1.0' } });
  await rpc(null, 'notifications/initialized');
  const result = await rpc(2, 'tools/call', { name: 'list_credentials', arguments: {} });
  if (result?.isError) throw new Error('Paybox wallet access failed.');
  const value = result?.structuredContent ?? JSON.parse(result?.content?.find((item: any) => item.type === 'text')?.text ?? '{}');
  return parsePayboxWallets(value);
}
export async function completePayboxImport(state: string, code?: string) {
  const db = await imports();
  const pending = await db.findOneAndUpdate({ stateHash: hash(state), status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'processing' }, $unset: { verifier: '' } }, { returnDocument: 'before' });
  if (!pending) return false;
  try {
    if (!code || !pending.verifier) throw new Error('Connection cancelled.');
    const tokens = z.object({ access_token: z.string().min(1) }).parse(await jsonRequest(`${ORIGIN}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: pending.clientId, code,
        redirect_uri: pending.redirectUri, code_verifier: pending.verifier }).toString(),
    }));
    // Import once: do not request offline_access or persist provider tokens.
    const wallets = await listWallets(tokens.access_token);
    await db.updateOne({ _id: pending._id, status: 'processing' }, { $set: { status: 'ready', wallets } });
    return true;
  } catch {
    await db.updateOne({ _id: pending._id, status: 'processing' }, { $set: { status: 'error' } });
    return false;
  }
}
export async function getPayboxImport(userId: string, id: string) {
  const item = await (await imports()).findOne({ _id: id, userId, expiresAt: { $gt: new Date() } });
  return item ? { status: item.status, wallets: item.wallets ?? [] } : null;
}
export async function deletePayboxImport(userId: string, id: string) {
  await (await imports()).deleteOne({ _id: id, userId });
}
